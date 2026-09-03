"""Train MaskablePPO locally against the simple rule opponent.

Training calls the TypeScript engine directly, so no HTTP server is needed.
Configuration is controlled with environment variables for fresh training,
resume, checkpoints, TensorBoard, and periodic masked evaluation.

RL_NUM_ENVS > 1 时用 SubprocVecEnv 并行多个训练环境（每个环境一个独立的
tsx 引擎 worker 进程），样本吞吐成倍提升；GPU 负责 PPO 更新。Windows 上子进程用
spawn 启动，因此 make_train_env 必须是模块级可 pickle 的工厂，对手模型也只能传路径、
由子进程内懒加载（对象不可跨进程序列化）。
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
import torch
from sb3_contrib import MaskablePPO
from sb3_contrib.common.wrappers import ActionMasker
from stable_baselines3.common.callbacks import BaseCallback, CheckpointCallback
from stable_baselines3.common.monitor import Monitor
from stable_baselines3.common.vec_env import DummyVecEnv, SubprocVecEnv

from local_env import LocalHexGameEnv


def mask_fn(env):
    return env.action_masks()


def make_train_env(map_id: str, opponent_style: str, model_opponent_probability: float, opponent_model_path: str, self_play_dir: str, self_play_probability: float, anchor_model_path: str, anchor_probability: float, map_mix: list[tuple[str, float]], opponent_stochastic_probability: float = 0.0):
    """模块级工厂：返回可被 spawn 子进程 pickle 的 env 构造器。每个环境自带一个引擎 worker。"""

    def _init():
        # 子进程里只跑对手模型的单样本推理；torch 默认按核数开线程，
        # N 个环境 × 核数个线程会互相争抢，单线程反而更快。
        torch.set_num_threads(1)
        env = LocalHexGameEnv(
            map_id=map_id,
            opponent_style=opponent_style,
            model_opponent_probability=model_opponent_probability,
            opponent_model_path=opponent_model_path or None,
            self_play_dir=self_play_dir or None,
            self_play_probability=self_play_probability,
            anchor_model_path=anchor_model_path or None,
            anchor_probability=anchor_probability,
            map_mix=map_mix,
            opponent_stochastic_probability=opponent_stochastic_probability,
        )
        return Monitor(env)

    return _init


def make_lr_schedule(lr_start: float, lr_end: float):
    """学习率线性衰减：progress_remaining 1→0 对应起始值→终点值。

    治后期胜率震荡（v2.2.0 峰值 90%→终点 45%）的标准手段；续训时经
    MaskablePPO.load(learning_rate=...) 覆盖，进度按本次 learn 的总步数计。
    """

    def schedule(progress_remaining: float) -> float:
        return lr_end + (lr_start - lr_end) * progress_remaining

    return schedule


def env_str(name: str, default: str) -> str:
    value = os.environ.get(name, "")
    return value.strip() or default


def env_int(name: str, default: int, *, minimum: int | None = None) -> int:
    parsed = int(env_str(name, str(default)))
    if minimum is not None and parsed < minimum:
        raise ValueError(f"{name} must be >= {minimum}")
    return parsed


def env_float(name: str, default: float) -> float:
    return float(env_str(name, str(default)))


def parse_map_mix(raw: str) -> list[tuple[str, float]]:
    result: list[tuple[str, float]] = []
    for entry in raw.split(","):
        name, separator, weight = entry.strip().partition(":")
        if not name:
            continue
        result.append((name, float(weight) if separator else 1.0))
    if any(weight <= 0 for _, weight in result):
        raise ValueError("RL_TRAIN_MAP_MIX weights must be positive")
    return result


def tensorboard_available() -> bool:
    try:
        import tensorboard  # noqa: F401
        return True
    except ImportError:
        return False


def latest_model_path(map_id: str) -> str:
    patterns = (
        f"hex_ppo_*_*_{map_id}_*.zip",  # 新命名: hex_ppo_<版本>_<日期>_<地图>_<对手>_<步数>
        f"hex_ppo_{map_id}_rule_*_*_*.zip",  # 兼容旧命名
        f"hex_ppo_v2_{map_id}_rule_opponent_*.zip",  # 旧时间戳命名
    )
    candidates: list[Path] = []
    for root in ("rl/models", "rl"):
        for pattern in patterns:
            candidates += list(Path(root).glob(pattern))
    if not candidates:
        return ""
    return str(max(candidates, key=lambda path: path.stat().st_mtime))


def opponent_model_path(map_id: str) -> str:
    configured = env_str("RL_OPPONENT_MODEL", "")
    if configured:
        return configured[:-4] if configured.endswith(".zip") else configured
    patterns = (
        f"hex_ppo_{map_id}_rule_v2.0.0_*.zip",
        f"hex_ppo_v2.0.0_*_{map_id}_rule_*.zip",
        f"hex_ppo_v2_{map_id}_rule_opponent_*.zip",
    )
    candidates: list[Path] = []
    for root in (Path("rl/models"), Path("rl")):
        for pattern in patterns:
            candidates.extend(root.glob(pattern))
    result = max(candidates, key=lambda path: path.stat().st_mtime) if candidates else None
    return str(result.with_suffix("")) if result else ""


def champion_model_path() -> str:
    """Find the strongest frozen 5974-dim champion for v2.7 anchoring."""
    candidates = list(Path("rl/models").glob("hex_ppo_v2.4.*_random_selfplay_*.zip"))
    if not candidates:
        candidates = list(Path("rl/models").glob("hex_ppo_v2.3.*_random_selfplay_*.zip"))
    return str(max(candidates, key=lambda path: path.stat().st_mtime)) if candidates else ""


def ensure_zip_suffix(path: str) -> str:
    """sb3 的 save 只在“无扩展名”时才补 .zip，而版本号中的点会被误判为扩展名。"""
    return path if path.endswith(".zip") else f"{path}.zip"


def sanitize_delivery_zip(zip_path: str, fallback_lr: float) -> bool:
    """清洗交付模型：把学习率调度闭包替换为常数。

    启用学习率衰减后，模型保存会把 lr 调度闭包经 cloudpickle 序列化进 zip；
    该闭包在异构机器上反序列化可能直接段错误（v2.3.3 部署时服务器 load 即 SIGSEGV，
    本地却正常）。推理只需策略权重，交付前把 learning_rate 改为常数、移除
    lr_schedule 字段即可；未来续训时 load(learning_rate=schedule) 会重新注入调度。
    """
    import io
    import json
    import shutil
    import zipfile

    try:
        with zipfile.ZipFile(zip_path, "r") as archive:
            names = archive.namelist()
            data = json.loads(archive.read("data").decode("utf-8"))
            lr_entry = data.get("learning_rate")
            if not isinstance(lr_entry, dict) or ":serialized:" not in lr_entry:
                return False
            data["learning_rate"] = fallback_lr
            data.pop("lr_schedule", None)
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as rewritten:
                for name in names:
                    payload = json.dumps(data).encode("utf-8") if name == "data" else archive.read(name)
                    rewritten.writestr(name, payload)
    except Exception:
        return False
    tmp_path = zip_path + ".tmp"
    with open(tmp_path, "wb") as handle:
        handle.write(buffer.getvalue())
    shutil.move(tmp_path, zip_path)
    return True


def resolve_device() -> str:
    requested = env_str("RL_DEVICE", "auto").lower()
    if requested not in {"auto", "cpu", "cuda"}:
        raise ValueError("RL_DEVICE must be auto, cpu, or cuda")
    available = torch.cuda.is_available()
    if requested == "cuda" and not available:
        raise RuntimeError(
            "RL_DEVICE=cuda was requested, but this Python environment has no CUDA-enabled PyTorch. "
            "Install a CUDA PyTorch build first."
        )
    device = "cuda" if requested == "auto" and available else requested
    if device == "auto":
        device = "cpu"
    print(f"[train] device={device} torch={torch.__version__} cuda_available={available}", flush=True)
    return device


class AsyncEvalCallback(BaseCallback):
    """Evaluate checkpoints in a background subprocess (v2.8).

    Every ``eval_freq`` timesteps the current policy is saved to a temp zip and
    ``rl/eval_worker.py`` plays the paired-seed validation games against all
    scenarios while rollouts keep running.  At most one evaluation is in flight;
    if the previous one has not finished the new trigger is skipped (logged),
    so evaluation cost never blocks training.  Best-checkpoint selection uses
    the weakest scenario's Wilson lower bound instead of the raw win rate,
    which stops single lucky 40-game samples from overwriting the best model.
    """

    def __init__(self, *, map_id: str, opponent_style: str, anchor_model: str, eval_freq: int, n_eval_episodes: int, best_model_save_path: str, eval_dir: str, seed_prefix: int = 27_000, wait_at_end: bool = True):
        super().__init__()
        self.map_id = map_id
        self.opponent_style = opponent_style
        self.anchor_model = anchor_model
        self.eval_freq = max(1, eval_freq)
        self.n_eval_episodes = max(2, n_eval_episodes + n_eval_episodes % 2)
        self.best_model_save_path = best_model_save_path
        self.eval_dir = Path(eval_dir)
        self.seed_prefix = seed_prefix
        self.wait_at_end = wait_at_end
        self.best_score = (-1.0, -1.0, -float("inf"), -float("inf"))
        self.best_step = 0
        self._pending: tuple[subprocess.Popen, str, str, int] | None = None
        self._skipped = 0
        self.history: list[dict[str, Any]] = []

    def _launch(self) -> None:
        self.eval_dir.mkdir(parents=True, exist_ok=True)
        step = int(self.num_timesteps)
        model_zip = str(self.eval_dir / f"eval_{step}.zip")
        result_json = str(self.eval_dir / f"eval_{step}.json")
        self.model.save(model_zip)
        command = [
            sys.executable, str(Path(__file__).resolve().parent / "eval_worker.py"),
            "--model", model_zip, "--out", result_json,
            "--map", self.map_id, "--opponent-style", self.opponent_style,
            "--episodes", str(self.n_eval_episodes), "--seed-prefix", str(self.seed_prefix),
        ]
        if self.anchor_model:
            command += ["--anchor", self.anchor_model]
        env = {**os.environ, "PYTHONUTF8": "1"}
        process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace", env=env)
        self._pending = (process, model_zip, result_json, step)
        print(f"[eval] step={step:>8d} launched {self.n_eval_episodes} paired games per scenario in background", flush=True)

    def _collect(self, block: bool) -> bool:
        if self._pending is None:
            return False
        process, model_zip, result_json, step = self._pending
        if not block and process.poll() is None:
            return False
        _, stderr = process.communicate()
        self._pending = None
        try:
            if process.returncode != 0 or not os.path.exists(result_json):
                print(f"[eval] step={step} evaluation failed (rc={process.returncode}): {stderr.strip()[-800:]}", flush=True)
                return True
            with open(result_json, encoding="utf-8") as handle:
                results = json.load(handle)
            self._record(step, results, model_zip)
        finally:
            for path in (model_zip, result_json):
                try:
                    os.remove(path)
                except OSError:
                    pass
        return True

    def _record(self, step: int, results: dict[str, Any], model_zip: str) -> None:
        try:
            from eval_worker import selection_score
        except ImportError:  # ``python -m rl.train``
            from rl.eval_worker import selection_score

        scenarios = results.get("scenarios", {})
        for name, scenario in scenarios.items():
            self.logger.record(f"eval/{name}_win_rate", scenario["win_rate"])
            self.logger.record(f"eval/{name}_wilson_lb", scenario["wilson_lb"])
            print(
                f"[eval:{name}] step={step} win_rate={scenario['win_rate']:.0%} wilson_lb={scenario['wilson_lb']:.0%} "
                f"cp={scenario['cp_mean']:.2f} mean_reward={scenario['mean_reward']:+.3f} over {scenario['games']} paired games",
                flush=True,
            )
        if not scenarios:
            return
        score = selection_score(results)
        is_best = score > self.best_score
        if is_best:
            self.best_score = score
            self.best_step = step
            os.makedirs(self.best_model_save_path, exist_ok=True)
            shutil.copy(model_zip, os.path.join(self.best_model_save_path, "best_model.zip"))
        mean_win_rate = float(np.mean([s["win_rate"] for s in scenarios.values()]))
        self.logger.record("eval/win_rate", mean_win_rate)
        self.logger.record("eval/min_wilson_lb", score[0])
        self.logger.record("eval/control_points", score[2])
        self.logger.record("eval/mean_reward", score[3])
        # 结果晚于训练步数到达，随下一次常规 dump 写入 TB；eval/evaluated_step 记录真实评估步数。
        self.logger.record("eval/evaluated_step", step)
        self.history.append({"step": step, "score": score, "scenarios": scenarios})
        print(
            f"[eval] step={step:>8d} min_wilson_lb={score[0]:.0%} mean_wilson_lb={score[1]:.0%} "
            f"mean_win_rate={mean_win_rate:.0%} cp={score[2]:.2f} mean_reward={score[3]:+.3f}"
            f"{' <- new best' if is_best else ''}",
            flush=True,
        )

    def _on_step(self) -> bool:
        self._collect(block=False)
        if self.num_timesteps % self.eval_freq != 0:
            return True
        if self._pending is not None:
            self._skipped += 1
            print(f"[eval] step={self.num_timesteps} skipped: previous evaluation still running (skipped {self._skipped} so far)", flush=True)
            return True
        self._launch()
        return True

    def _on_training_end(self) -> None:
        if self._pending is not None and self.wait_at_end:
            print("[eval] waiting for the last background evaluation to finish...", flush=True)
            self._collect(block=True)


class MaskableEvalCallback(BaseCallback):
    """Legacy inline evaluation (v2.7).  Kept for RL_EVAL_MODE=inline."""

    def __init__(self, eval_envs: dict[str, Any], eval_freq: int, n_eval_episodes: int, best_model_save_path: str, seed_prefix: int = 27_000):
        super().__init__()
        self.eval_envs = eval_envs
        self.eval_freq = max(1, eval_freq)
        self.n_eval_episodes = max(2, n_eval_episodes + n_eval_episodes % 2)
        self.best_model_save_path = best_model_save_path
        self.seed_prefix = seed_prefix
        self.best_score = (-1.0, -1.0, -float("inf"), -float("inf"))

    def _on_step(self) -> bool:
        if self.num_timesteps % self.eval_freq != 0:
            return True
        print(f"[eval] step={self.num_timesteps:>8d} playing {self.n_eval_episodes} games...", flush=True)
        scenario_scores: list[tuple[float, float, float]] = []
        for scenario, eval_env in self.eval_envs.items():
            rewards: list[float] = []
            wins = 0
            control_points: list[int] = []
            for episode in range(self.n_eval_episodes):
                try:
                    pair_index = episode // 2
                    owner = "player_a" if episode % 2 == 0 else "player_b"
                    observation, _ = eval_env.reset(
                        seed=self.seed_prefix + pair_index,
                        options={"owner": owner},
                    )
                    done = False
                    total = 0.0
                    while not done:
                        action, _ = self.model.predict(
                            observation,
                            deterministic=True,
                            action_masks=eval_env.action_masks(),
                        )
                        observation, reward, terminated, truncated, _ = eval_env.step(int(action))
                        total += float(reward)
                        done = terminated or truncated
                    rewards.append(total)
                    base_env = eval_env
                    while hasattr(base_env, "env"):
                        base_env = base_env.env
                    if base_env.state.get("winner") == base_env.owner:
                        wins += 1
                    control_points.append(sum(p.get("owner") == base_env.owner for p in base_env.state.get("controlPoints", [])))
                except Exception as error:
                    print(f"[eval:{scenario}] episode {episode} failed: {error}", flush=True)
            if rewards:
                win_rate = wins / len(rewards)
                cp_mean = float(np.mean(control_points)) if control_points else 0.0
                mean_reward = float(np.mean(rewards))
                scenario_scores.append((win_rate, cp_mean, mean_reward))
                self.logger.record(f"eval/{scenario}_win_rate", win_rate)
                print(
                    f"[eval:{scenario}] win_rate={win_rate:.0%} cp={cp_mean:.2f} "
                    f"mean_reward={mean_reward:+.3f} over {len(rewards)} paired games",
                    flush=True,
                )
        if not scenario_scores:
            return True
        win_rates = [score[0] for score in scenario_scores]
        mean_win_rate = float(np.mean(win_rates))
        min_win_rate = min(win_rates)
        cp_mean = float(np.mean([score[1] for score in scenario_scores]))
        mean_reward = float(np.mean([score[2] for score in scenario_scores]))
        selection_score = (min_win_rate, mean_win_rate, cp_mean, mean_reward)
        is_best = selection_score > self.best_score
        if is_best:
            self.best_score = selection_score
            self.model.save(os.path.join(self.best_model_save_path, "best_model"))
        self.logger.record("eval/mean_reward", mean_reward)
        self.logger.record("eval/win_rate", mean_win_rate)
        self.logger.record("eval/min_win_rate", min_win_rate)
        self.logger.record("eval/control_points", cp_mean)
        print(
            f"[eval] step={self.num_timesteps:>8d} min_win_rate={min_win_rate:.0%} "
            f"mean_win_rate={mean_win_rate:.0%} cp={cp_mean:.2f} mean_reward={mean_reward:+.3f}"
            f"{' <- new best' if is_best else ''}",
            flush=True,
        )
        return True


class SnapshotCallback(BaseCallback):
    """定期保存策略快照供自对弈对手使用（原子写入，只保留最近 keep 个）。

    快照频率单位与 CheckpointCallback 的 save_freq 相同：回调调用次数，
    并行环境下 1 次调用 = RL_NUM_ENVS 帧。
    """

    def __init__(self, snapshot_dir: str, save_freq: int, keep: int = 20):
        super().__init__()
        self.snapshot_dir = Path(snapshot_dir)
        self.save_freq = max(1, save_freq)
        self.keep = max(2, keep)

    def _on_step(self) -> bool:
        if self.n_calls % self.save_freq != 0:
            return True
        self.snapshot_dir.mkdir(parents=True, exist_ok=True)
        steps = int(self.num_timesteps)
        tmp = self.snapshot_dir / f"snapshot_{steps}_steps_tmp.zip"
        target = self.snapshot_dir / f"snapshot_{steps}_steps.zip"
        self.model.save(str(tmp))
        os.replace(tmp, target)
        # 按保存时间裁剪（续训时步数计数器可能与旧快照错位，时间序才可靠）。
        snapshots = sorted(self.snapshot_dir.glob("snapshot_*_steps.zip"), key=lambda path: path.stat().st_mtime)
        for stale in snapshots[: max(0, len(snapshots) - self.keep)]:
            try:
                stale.unlink()
            except OSError:
                pass
        return True


def main() -> None:
    map_id = env_str("RL_MAP_ID", "default")
    opponent_style = env_str("RL_OPPONENT_STYLE", "mixed")
    # 与 rl/RELEASE_NOTES.md 顶部条目的版本号保持一致，每次变更训练环境时同步更新。
    model_version = env_str("RL_MODEL_VERSION", "v2.8.0")
    total_timesteps = env_int("RL_TIMESTEPS", 500_000, minimum=1)
    run_stamp = time.strftime("%Y%m%d-%H%M%S")
    run_date = run_stamp[:8]
    load_path = env_str("RL_LOAD_MODEL", "")
    save_freq = env_int("RL_SAVE_FREQ", 20_000, minimum=1)
    checkpoint_dir = env_str("RL_CHECKPOINT_DIR", f"rl/checkpoints/{map_id}/{run_stamp}")
    tb_dir = env_str("RL_TB_LOG", "rl/tb")
    # v2.8：评估默认改为后台子进程（RL_EVAL_MODE=async），频率放宽到 5 万步、
    # 每场景 48 局配对；v2.7.1 主进程每 1 万步串行 120 局把有效 fps 砍掉一半。
    eval_mode = env_str("RL_EVAL_MODE", "async")
    if eval_mode not in {"async", "inline"}:
        raise ValueError("RL_EVAL_MODE must be async or inline")
    eval_freq = env_int("RL_EVAL_FREQ", 50_000 if eval_mode == "async" else 10_000, minimum=0)
    eval_episodes = env_int("RL_EVAL_EPISODES", 48 if eval_mode == "async" else 20, minimum=1)
    # 随机地图上 v2.0.0 模型对手属于分布外对手，默认只用规则对手；
    # 需要时可用 RL_MODEL_OPPONENT_PROB 显式开启。
    default_model_prob = 0.0 if map_id == "random" else 0.5
    model_opponent_probability = env_float("RL_MODEL_OPPONENT_PROB", default_model_prob)
    # v2.7 uses 30% rule opponents and 70% self-play. Within self-play,
    # 40% anchor probability gives the fixed champion 28% of all episodes.
    default_self_play_prob = 0.70 if map_id == "random" else 0.0
    self_play_probability = env_float("RL_SELF_PLAY_PROB", default_self_play_prob)
    # 快照目录按模型版本隔离：观测世代不同的旧快照（如 5974 维）不混入新世代阶梯。
    snapshot_dir = env_str("RL_SNAPSHOT_DIR", f"rl/selfplay/{map_id}/{model_version}")
    snapshot_freq = env_int("RL_SNAPSHOT_FREQ", 5_000, minimum=1)
    snapshot_keep = env_int("RL_SNAPSHOT_KEEP", 20, minimum=2)
    anchor_model = env_str("RL_ANCHOR_MODEL", "")
    anchor_probability = env_float("RL_ANCHOR_PROB", 0.40)
    # v2.8：模型对手（快照/锚点）有 30% 的局按策略分布采样动作，防止只学会针对一条贪心走法。
    opponent_stochastic_probability = env_float("RL_OPPONENT_STOCHASTIC_PROB", 0.30)
    default_map_mix = "random:0.7,default:0.15,dual-lanes:0.075,forge:0.075" if map_id == "random" else ""
    map_mix = parse_map_mix(env_str("RL_TRAIN_MAP_MIX", default_map_mix))
    opponent_kind = "selfplay" if self_play_probability > 0 else "modelmix"
    model_path = env_str(
        "RL_MODEL_PATH",
        f"rl/models/hex_ppo_{model_version}_{run_date}_{map_id}_{opponent_kind}_{total_timesteps}",
    )
    # v2.8：默认 8 个并行环境。6 物理核 / 12 逻辑核机器上实测（含锚点对手推理）：
    # 4 环境 170 fps、8 环境 238 fps；子进程 torch 单线程化后比 v2.7.1 的 42 有效 fps 提升约 5 倍。
    num_envs = env_int("RL_NUM_ENVS", 8, minimum=1)
    # 网络宽度：6024 维观测压进默认 64 宽是信息瓶颈，256 起步。
    # 仅对从零训练生效；续训时架构以模型内保存的 policy_kwargs 为准
    # （sb3 加载时会校验，不一致直接报错，避免默默用错架构）。
    net_width = env_int("RL_NET_WIDTH", 256, minimum=16)
    policy_kwargs = {"net_arch": {"pi": [net_width, net_width], "vf": [net_width, net_width]}}
    lr_start = env_float("RL_LEARNING_RATE", 3e-4)
    lr_end = env_float("RL_LR_END", 3e-5)
    lr_schedule = make_lr_schedule(lr_start, lr_end)
    # 常数学习率模式：续训微调时避免 callable lr 经 cloudpickle 序列化进断点，
    # 防止异构环境反序列化段错误（见 sanitize_delivery_zip 背景）。
    use_constant_lr = env_str("RL_LR_MODE", "schedule") == "constant"
    learning_rate: Any = lr_start if use_constant_lr else lr_schedule
    # v2.8 PPO 稳定性：v2.7.1 日志 approx_kl 常驻 0.02-0.03、clip_fraction 0.16-0.20，
    # 对 PPO 偏高，与历代“后期震荡/终点退化”一致。target_kl 提前截断更新轮次，
    # n_steps/batch_size 加大降低梯度噪声。续训时同样生效（load 后覆盖）。
    n_steps = env_int("RL_N_STEPS", 512, minimum=1)
    batch_size = env_int("RL_BATCH_SIZE", 256, minimum=1)
    target_kl_raw = env_str("RL_TARGET_KL", "0.02")
    target_kl: float | None = None if target_kl_raw.lower() in {"0", "none", "off"} else float(target_kl_raw)
    device = resolve_device()

    # 并行环境（子进程）里模型对象不可序列化：主进程只解析路径，由子进程懒加载。
    resolved_opponent_path = ""
    if model_opponent_probability > 0:
        if map_id == "random":
            print("[train] 注意：v2.0.0 模型对手只在 default 地图训练过，随机地图上为分布外对手", flush=True)
        resolved_opponent_path = opponent_model_path(map_id)
        if resolved_opponent_path:
            print(f"[train] model opponent={resolved_opponent_path} probability={model_opponent_probability:.0%}", flush=True)
        else:
            print("[train] no v2.0 opponent model found; using rule opponents only", flush=True)
    else:
        print("[train] model opponents disabled; using rule opponents only", flush=True)

    Path(model_path).parent.mkdir(parents=True, exist_ok=True)
    Path(checkpoint_dir).mkdir(parents=True, exist_ok=True)
    best_dir = Path(checkpoint_dir) / "best"
    best_dir.mkdir(parents=True, exist_ok=True)
    if self_play_probability > 0:
        Path(snapshot_dir).mkdir(parents=True, exist_ok=True)
        print(
            f"[train] self-play probability={self_play_probability:.0%} snapshots={snapshot_dir} "
            f"every {snapshot_freq} calls keep={snapshot_keep}（训练初期无快照时自动用规则对手）",
            flush=True,
        )

    if load_path in {"auto", "latest"}:
        candidates = [model_path, model_path + ".zip"]
        if load_path == "latest":
            latest = latest_model_path(map_id)
            if latest:
                candidates.insert(0, latest)
        load_path = next((candidate for candidate in candidates if os.path.exists(candidate)), "")
    if load_path and not (os.path.exists(load_path) or os.path.exists(load_path + ".zip")):
        raise FileNotFoundError(f"RL_LOAD_MODEL 指向的模型不存在: {load_path}")

    resume = bool(load_path)
    if self_play_probability > 0 and not anchor_model:
        anchor_model = load_path if resume and (os.path.exists(load_path) or os.path.exists(load_path + ".zip")) else champion_model_path()
    # 锚点对手：防自对弈策略漂移退化的常驻强对手；未显式指定时续训默认用被续训的模型自身。
    if anchor_model and not os.path.exists(anchor_model):
        raise FileNotFoundError(f"RL_ANCHOR_MODEL 指向的模型不存在: {anchor_model}")
    if anchor_model:
        print(f"[train] anchor opponent={anchor_model}（自对弈局 {anchor_probability:.0%} 出场，其余快照阶梯近期加权）", flush=True)
    if not resume and (os.path.exists(model_path) or os.path.exists(model_path + ".zip")) and env_str("RL_ALLOW_OVERWRITE", "0") != "1":
        raise FileExistsError(
            f"模型已存在: {model_path}. 设置 RL_ALLOW_OVERWRITE=1 才允许覆盖，或换一个 RL_MODEL_PATH。"
        )
    run_name = f"ppo_{map_id}_{run_stamp}" + ("_resume" if resume else "")
    print(
        f"[train] map={map_id} mode={'resume' if resume else 'fresh'} envs={num_envs} "
        f"net={net_width}x{net_width}{'(from checkpoint)' if resume else ''} "
        f"lr={'constant ' + str(lr_start) if use_constant_lr else f'schedule {lr_start}->{lr_end}'} "
        f"n_steps={n_steps} batch={batch_size} target_kl={target_kl} "
        f"timesteps={total_timesteps}{'(incremental)' if resume else ''} "
        f"map_mix={map_mix or [(map_id, 1.0)]} opponent_stochastic={opponent_stochastic_probability:.0%}",
        flush=True,
    )

    if tensorboard_available():
        tb_log = tb_dir
    else:
        print("[train] tensorboard 未安装,跳过 TB 日志;需要时运行: python -m pip install tensorboard")
        tb_log = None

    # 并行训练环境：每个环境一个独立引擎 worker；sb3 通过 env_method("action_masks")
    # 从各子环境收集动作掩码，无需 ActionMasker 包装。单环境用 DummyVecEnv 保持同构。
    env_fns = [
        make_train_env(map_id, opponent_style, model_opponent_probability, resolved_opponent_path, snapshot_dir if self_play_probability > 0 else "", self_play_probability, anchor_model if self_play_probability > 0 else "", anchor_probability, map_mix, opponent_stochastic_probability)
        for _ in range(num_envs)
    ]
    env = SubprocVecEnv(env_fns) if num_envs > 1 else DummyVecEnv(env_fns)
    eval_envs: dict[str, Any] = {}
    try:
        if resume:
            print(f"[train] loading model from {load_path}")
            try:
                # 续训同样应用 v2.8 的 PPO 稳定性参数：n_steps 改变需要重建 rollout buffer，
                # sb3 在 load 时按新 n_steps 重新分配缓冲，安全。
                model = MaskablePPO.load(
                    load_path, env=env, device=device, learning_rate=learning_rate,
                    custom_objects={"n_steps": n_steps, "batch_size": batch_size, "target_kl": target_kl},
                )
            except ValueError as error:
                if "Action spaces do not match" in str(error) or "Observation spaces do not match" in str(error):
                    raise RuntimeError(
                        f"模型与当前 v2.1 环境不兼容: {load_path}。旧模型的动作空间与当前环境不同，"
                        "请清除 RL_LOAD_MODEL 后从零训练 v2.1 模型。"
                    ) from error
                raise
            model.tensorboard_log = tb_log
        else:
            model = MaskablePPO(
                "MlpPolicy",
                env,
                learning_rate=lr_schedule,
                policy_kwargs=policy_kwargs,
                n_steps=n_steps,
                batch_size=batch_size,
                gamma=env_float("RL_GAMMA", 0.99),
                ent_coef=env_float("RL_ENT_COEF", 0.01),
                clip_range=env_float("RL_CLIP_RANGE", 0.2),
                n_epochs=env_int("RL_N_EPOCHS", 10, minimum=1),
                target_kl=target_kl,
                tensorboard_log=tb_log,
                device=device,
                verbose=1,
            )

        callbacks: list[BaseCallback] = [CheckpointCallback(
            save_freq=save_freq,
            save_path=checkpoint_dir,
            name_prefix=Path(model_path).name,
        )]
        if self_play_probability > 0:
            # 快照是子进程自对弈对手的唯一来源；原子写入避免读到半截 zip。
            callbacks.append(SnapshotCallback(snapshot_dir, snapshot_freq, snapshot_keep))
        if eval_freq > 0 and eval_mode == "async":
            callbacks.append(AsyncEvalCallback(
                map_id=map_id,
                opponent_style=opponent_style,
                anchor_model=anchor_model,
                eval_freq=eval_freq,
                n_eval_episodes=eval_episodes,
                best_model_save_path=str(best_dir),
                eval_dir=str(Path(checkpoint_dir) / "eval_tmp"),
            ))
            print(f"[train] async eval every {eval_freq} steps x {eval_episodes} games per scenario (background subprocess)")
        elif eval_freq > 0:
            eval_envs["random_rule"] = ActionMasker(
                LocalHexGameEnv(map_id=map_id, opponent_style=opponent_style), mask_fn,
            )
            if anchor_model:
                eval_envs["random_champion"] = ActionMasker(LocalHexGameEnv(
                    map_id=map_id,
                    opponent_style=opponent_style,
                    self_play_probability=1.0,
                    anchor_model_path=anchor_model,
                    anchor_probability=1.0,
                ), mask_fn)
                eval_envs["default_champion"] = ActionMasker(LocalHexGameEnv(
                    map_id="default",
                    opponent_style=opponent_style,
                    self_play_probability=1.0,
                    anchor_model_path=anchor_model,
                    anchor_probability=1.0,
                ), mask_fn)
            callbacks.append(MaskableEvalCallback(
                eval_envs,
                eval_freq=eval_freq,
                n_eval_episodes=eval_episodes,
                best_model_save_path=str(best_dir),
            ))
            print(f"[train] eval every {eval_freq} steps x {eval_episodes} games")

        model.learn(
            total_timesteps=total_timesteps,
            callback=callbacks,
            tb_log_name=run_name,
            reset_num_timesteps=not resume,
        )
        # 交付模型优先用评估选出的 best 断点：训练终点模型常在后期震荡中退化，
        # 实测 v2.2.0 终点 0:8 而同期 best 对 v2.0.0 16:0。未启用评估时退回终点模型。
        final_model_path = ensure_zip_suffix(model_path)
        best_zip = best_dir / "best_model.zip"
        if best_zip.exists():
            shutil.copy(best_zip, final_model_path)
            print(f"[train] best eval checkpoint delivered to {final_model_path}")
        else:
            model.save(final_model_path)
            print(f"[train] final model saved to {final_model_path} (no eval checkpoint; endpoint model)")
        if sanitize_delivery_zip(final_model_path, lr_start):
            print("[train] delivery sanitized: learning-rate schedule closure replaced by constant")
        print(f"[train] checkpoints in {checkpoint_dir}/")
    finally:
        for eval_env in eval_envs.values():
            eval_env.close()
        env.close()


if __name__ == "__main__":
    main()
