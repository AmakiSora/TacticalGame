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
from collections import Counter
from pathlib import Path
from typing import Any

import numpy as np
import torch
from sb3_contrib import MaskablePPO
from sb3_contrib.common.wrappers import ActionMasker
from stable_baselines3.common.callbacks import BaseCallback, CheckpointCallback
from stable_baselines3.common.monitor import Monitor
from stable_baselines3.common.vec_env import DummyVecEnv, SubprocVecEnv

# rl/ 已重组为 envs/runners/training/evaluation 子目录；把各代码目录挂上 sys.path，
# 让既有的扁平模块名（如 ``from env import ...``）在脚本模式下继续可用。
_RL_ROOT = Path(__file__).resolve().parent.parent
for _sub in ("envs", "runners", "training", "evaluation"):
    _p = str(_RL_ROOT / _sub)
    if _p not in sys.path:
        sys.path.insert(0, _p)

from env import (
    ATTACK_CANDIDATES,
    DEFAULT_REWARD_HQ_DAMAGE,
    DEFAULT_REWARD_HQ_PUSH,
    DEFAULT_REWARD_NEW_UNIT_TYPE,
    DEPLOY_BASE,
    DEPLOY_CANDIDATES,
    MOVE_CANDIDATES,
    TYPE_INDEX,
    classify_action,
    env_reward_float,
)
from extractors import build_policy_kwargs
from local_env import LocalHexGameEnv


def mask_fn(env):
    return env.action_masks()


def make_train_env(map_id: str, opponent_style: str, model_opponent_probability: float, opponent_model_path: str, self_play_dir: str, self_play_probability: float, anchor_model_path: str, anchor_probability: float, map_mix: list[tuple[str, float]], opponent_stochastic_probability: float = 0.0, algorithm_mix: dict[str, float] | None = None, algorithm_opponent_probability: float = 0.0, algorithm_epsilon: float = 0.0):
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
            algorithm_mix=algorithm_mix,
            algorithm_opponent_probability=algorithm_opponent_probability,
            algorithm_epsilon=algorithm_epsilon,
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


def parse_algorithm_mix(raw: str) -> dict[str, float]:
    """``"threat:0.4,field:0.3,greedy:0.3"`` → ``{"threat": 0.4, ...}``。

    权重不必归一（env 侧会归一）；名字是否已注册由 worker 在首次 decide 时校验
    （注册表在 JS 侧，训练脚本不复制一份，避免双份清单漂移）。
    """
    result: dict[str, float] = {}
    for entry in raw.split(","):
        name, separator, weight = entry.strip().partition(":")
        if not name:
            continue
        result[name] = float(weight) if separator else 1.0
    if any(weight <= 0 for weight in result.values()):
        raise ValueError("RL_ALGO_MIX weights must be positive")
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
    """Find the strongest frozen v2.7 champion (6205-dim / 54 actions) for v3.0 anchoring.

    v3.0 translates the 54-action teacher into its own index space via
    ``env.map_v27_action``, so the previous generation can still anchor.
    """
    for pattern in ("hex_ppo_v2.7.*_random_selfplay_*.zip", "hex_ppo_v2.8.*_random_selfplay_*.zip", "hex_ppo_v2.4.*_random_selfplay_*.zip"):
        candidates = list(Path("rl/models").glob(pattern))
        if candidates:
            return str(max(candidates, key=lambda path: path.stat().st_mtime))
    return ""


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


def resume_custom_objects(n_steps: int, batch_size: int, target_kl: float | None, gamma: float, ent_coef: float, clip_range: float, n_epochs: int) -> dict[str, Any]:
    """续训时必须覆盖的断点内超参，否则对应的 RL_* 环境变量对 resume 完全无效。

    sb3 的 ``load`` 以断点保存的值为准，只有 ``custom_objects`` 里的项会被覆盖。
    v3.0.0/v3.0.1 的 ``RL_ENT_COEF`` 就是这样成为死变量的：``distill.py`` 建的断点
    存的是 sb3 默认 **0.0**，于是整个 PPO 阶段零熵正则，策略熵从 0.94 一路压到 0.78、
    新候选概率质量从 5.5% 掉到 1.4%。新增环境变量驱动的超参时记得同步这里。
    """
    return {
        "n_steps": n_steps,
        "batch_size": batch_size,
        "target_kl": target_kl,
        "gamma": gamma,
        "ent_coef": ent_coef,
        "clip_range": clip_range,
        "n_epochs": n_epochs,
    }


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
    the weakest **in-distribution** scenario's Wilson lower bound instead of the
    raw win rate, which stops single lucky samples from overwriting the best
    model.  v3.0.3: out-of-distribution static-map scenarios (default_champion)
    are logged but excluded from the key — v3.0.2's key was dominated by the
    default OOD collapse and picked the weak 100k checkpoint over 1.4M.
    """

    def __init__(self, *, map_id: str, opponent_style: str, anchor_model: str, eval_freq: int, n_eval_episodes: int, best_model_save_path: str, eval_dir: str, seed_prefix: int = 27_000, wait_at_end: bool = True, algo_scenarios: bool = False, algo_episodes: int = 48, best_warmup_steps: int = 0, seed_stride: int = 1):
        super().__init__()
        self.map_id = map_id
        self.opponent_style = opponent_style
        self.anchor_model = anchor_model
        # v3.2.0：评估是否加跑算法对手场景（RL_EVAL_ALGO，默认关；阶段 B 再开）。
        self.algo_scenarios = algo_scenarios
        self.algo_episodes = max(2, algo_episodes)
        self.eval_freq = max(1, eval_freq)
        self.n_eval_episodes = max(2, n_eval_episodes + n_eval_episodes % 2)
        self.best_model_save_path = best_model_save_path
        self.eval_dir = Path(eval_dir)
        self.seed_prefix = seed_prefix
        # v3.2.0（评估功效修正）：种子步长。默认 1 = 顺序取种子（历史行为）。
        # > 1 时让「前 N/2 个种子」散布到整个种子空间，用少量局数换低偏差估计。
        self.seed_stride = max(1, int(seed_stride))
        self.wait_at_end = wait_at_end
        # v3.2.0 消融（阶段 A 复盘补）：best 选择键的**热身期**（相对本次续训起点的步数）。
        # 阶段 A 的 best 被**第一个**评估点（8.9M，仅训入 9.6 万帧）占住，此后 1.2M 帧
        # 一次都没被超越，交付物因此约等于起点；v3.1.1、v3.0.2 也有同一现象。
        # 根因是分布漂移期评估读数方差远大于真实改进，选择键于是系统性地把"离起点最近
        # 的断点"当成 best。热身期内只记录、不更新 best，让基线由漂移稳定后的读数来定。
        # 0 = 关闭（保持历史行为）。若全程都在热身期内，则不产出 best，交付退回终点模型。
        self.best_warmup_steps = max(0, int(best_warmup_steps))
        self._best_suppressed = 0
        # 五元组：(最弱场景下界, 后手座合并下界, 平均下界, 占点, 回报)。
        self.best_score = (-1.0, -1.0, -1.0, -float("inf"), -float("inf"))
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
            "--seed-stride", str(self.seed_stride),
        ]
        if self.anchor_model:
            command += ["--anchor", self.anchor_model]
        if self.algo_scenarios:
            command += ["--algo-scenarios", "--algo-episodes", str(self.algo_episodes)]
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

    def _within_best_warmup(self, step: int) -> bool:
        """本次续训是否还处在 best 选择的热身期内（见 ``best_warmup_steps``）。

        起点取自 ``model._num_timesteps_at_start``（sb3 载入断点时记录），所以热身期
        是"本次续训新增了多少帧"的窗口，而不是绝对步数——续训每次都从几百万步开始，
        用绝对步数做门槛等于永远不热身。
        """
        if self.best_warmup_steps <= 0:
            return False
        start = int(getattr(self.model, "_num_timesteps_at_start", 0) or 0)
        return (step - start) < self.best_warmup_steps

    def _record(self, step: int, results: dict[str, Any], model_zip: str) -> None:
        try:
            from eval_worker import selection_score
        except ImportError:  # ``python -m rl.training.train``
            from rl.training.eval_worker import selection_score

        scenarios = results.get("scenarios", {})
        for name, scenario in scenarios.items():
            self.logger.record(f"eval/{name}_win_rate", scenario["win_rate"])
            self.logger.record(f"eval/{name}_wilson_lb", scenario["wilson_lb"])
            first = scenario.get("seat_first", {})
            second = scenario.get("seat_second", {})
            self.logger.record(f"eval/{name}_first_seat", first.get("win_rate", 0.0))
            self.logger.record(f"eval/{name}_second_seat", second.get("win_rate", 0.0))
            # v3.2.0 验收门禁读数：HQ 伤害 ≥ 60、侦察兵占比 ≥ 20%（v3.1.1 实测 19.7 / 8%）。
            self.logger.record(f"eval/{name}_hq_damage", scenario.get("hq_damage_mean", 0.0))
            self.logger.record(f"eval/{name}_own_hq_hp", scenario.get("own_hq_hp_mean", 0.0))
            self.logger.record(f"eval/{name}_scout_deploy", scenario.get("scout_deploy_share", 0.0))
            print(
                f"[eval:{name}] step={step} win_rate={scenario['win_rate']:.0%} wilson_lb={scenario['wilson_lb']:.0%} "
                f"first={first.get('win_rate', 0.0):.0%} second={second.get('win_rate', 0.0):.0%} "
                f"cp={scenario['cp_mean']:.2f} mean_reward={scenario['mean_reward']:+.3f} "
                f"hq_damage={scenario.get('hq_damage_mean', 0.0):.1f} scout={scenario.get('scout_deploy_share', 0.0):.0%} "
                f"over {scenario['games']} paired games",
                flush=True,
            )
        if not scenarios:
            return
        # v3.0.3：分布外静态图场景（如 default_champion）不进选择键，只记录。
        # v3.0.2 的 min_wilson_lb 被 default OOD 崩塌主导，best 挑中了 10 万步弱断点。
        ood = [s for s in scenarios.values() if s.get("map", self.map_id) != self.map_id]
        ood_note = ""
        if ood:
            ood_lb = min(float(s["wilson_lb"]) for s in ood)
            self.logger.record("eval/ood_min_wilson_lb", ood_lb)
            ood_note = f" ood_lb={ood_lb:.0%}(recorded only)"
        # v3.2.0：算法场景（in_selection=False）同样只记录。它们的下界在训练早期必然
        # 很低，进选择键会系统性偏向"对模型强但对算法弱"的早期断点。
        excluded = [s for s in scenarios.values() if not s.get("in_selection", True)]
        algo_note = ""
        if excluded:
            algo_lb = min(float(s["wilson_lb"]) for s in excluded)
            self.logger.record("eval/algo_min_wilson_lb", algo_lb)
            self.logger.record("eval/algo_mean_win_rate", float(np.mean([s["win_rate"] for s in excluded])))
            self.logger.record("eval/algo_hq_damage", float(np.mean([s.get("hq_damage_mean", 0.0) for s in excluded])))
            algo_note = f" algo_lb={algo_lb:.0%}(recorded only)"
        score = selection_score(results)
        warmup = self._within_best_warmup(step)
        is_best = (not warmup) and score > self.best_score
        if warmup:
            self._best_suppressed += 1
            self.logger.record("eval/best_selection_active", 0.0)
        else:
            self.logger.record("eval/best_selection_active", 1.0)
        if is_best:
            self.best_score = score
            self.best_step = step
            os.makedirs(self.best_model_save_path, exist_ok=True)
            shutil.copy(model_zip, os.path.join(self.best_model_save_path, "best_model.zip"))
        # 只对参与选择的场景求均值，否则算法场景（早期低胜率）会把这条读数压低，
        # 跨版本比较就失去意义。
        selected = [s for s in scenarios.values() if s.get("in_selection", True)] or list(scenarios.values())
        mean_win_rate = float(np.mean([s["win_rate"] for s in selected]))
        self.logger.record("eval/win_rate", mean_win_rate)
        self.logger.record("eval/min_wilson_lb", score[0])
        self.logger.record("eval/second_seat_lb", score[1])
        self.logger.record("eval/control_points", score[3])
        self.logger.record("eval/mean_reward", score[4])
        # 结果晚于训练步数到达，随下一次常规 dump 写入 TB；eval/evaluated_step 记录真实评估步数。
        self.logger.record("eval/evaluated_step", step)
        self.history.append({"step": step, "score": score, "scenarios": scenarios})
        warmup_note = f" [best 选择热身中，已抑制 {self._best_suppressed} 次]" if warmup else ""
        print(
            f"[eval] step={step:>8d} min_wilson_lb={score[0]:.0%} second_seat_lb={score[1]:.0%} "
            f"mean_wilson_lb={score[2]:.0%} mean_win_rate={mean_win_rate:.0%} cp={score[3]:.2f} "
            f"mean_reward={score[4]:+.3f}{ood_note}{algo_note}"
            f"{' <- new best' if is_best else ''}{warmup_note}",
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

    def __init__(self, eval_envs: dict[str, Any], eval_freq: int, n_eval_episodes: int, best_model_save_path: str, seed_prefix: int = 27_000, seed_stride: int = 1):
        super().__init__()
        self.eval_envs = eval_envs
        self.eval_freq = max(1, eval_freq)
        self.n_eval_episodes = max(2, n_eval_episodes + n_eval_episodes % 2)
        self.best_model_save_path = best_model_save_path
        self.seed_prefix = seed_prefix
        # v3.2.0（评估功效修正）：与 AsyncEvalCallback 同义，默认 1 = 历史行为。
        self.seed_stride = max(1, int(seed_stride))
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
                        seed=self.seed_prefix + pair_index * self.seed_stride,
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


class ActionDiversityCallback(BaseCallback):
    """记录 rollout 中实际采样到的动作分布（v3.0.2 探索监控）。

    v3.0.1 的诊断结论：蒸馏把老师（v2.7，54 动作）的行为克隆到候选 0，新增的
    move 方向 1-6 / attack 候选 1-2 / deploy 候选 1 在合法时选用率 **0.00%**，
    策略熵 0.85-1.15 nats 而 25 个合法动作的均匀分布为 3.2 nats——155 动作空间
    在行为上退化回 54 动作，v3.0 “去哪、打谁”的决策权没有兑现。

    这个回调把「探索是否被打开」变成训练期可见指标，不必等训练结束后跑离线探针。
    核心读数 `explore/new_candidate_rate` 持续为 0 就说明标签平滑/熵系数仍不足以
    打破死锁，应立即止损调参而不是白烧几小时。

    数据取自 collect_rollouts 的局部变量：sb3 在 env.step 之后、on_step 之前调用
    update_locals，因此 actions 与 action_masks 严格配对（同一批环境）。
    """

    def __init__(self, log_every: int = 20_000):
        super().__init__()
        self.log_every = max(1, log_every)
        self._picked: Counter = Counter()
        self._legal: Counter = Counter()
        # v3.2.0 (A5)：**窗口内**的兵种部署计数（与 _picked 的累计语义不同，这里每窗口
        # 清零，因为兵种坍缩是"当前策略还有没有多样性"的问题，累计值会被早期窗口稀释）。
        self._deploy_types: Counter = Counter()
        # v3.2.0 消融（阶段 A 复盘补）：算法通道累计读数的上次快照，用于取窗口差分。
        # 初值全 0（而非首次读到的值），这样第一个窗口报的是"自开局累计"，不漏数据。
        self._last_opponent_totals: dict[str, int] = {
            "algorithm_episodes": 0, "algorithm_actions": 0, "rejections": 0,
        }
        self._stats_unavailable = False
        self._window = 0
        self._total = 0

    def _on_step(self) -> bool:
        actions = self.locals.get("actions")
        if actions is None:
            return True
        flat = np.asarray(actions).reshape(-1)
        self._window += len(flat)
        self._total += len(flat)
        for value in flat:
            index = int(value)
            self._picked[classify_action(index)] += 1
            # classify_action 把 deploy 折成候选序号（丢掉了兵种），兵种由下标反推：
            # DEPLOY_BASE 之后每 DEPLOY_CANDIDATES 个动作对应一个兵种。
            if index >= DEPLOY_BASE:
                self._deploy_types[(index - DEPLOY_BASE) // DEPLOY_CANDIDATES] += 1
        masks = self.locals.get("action_masks")
        if masks is not None:
            table = np.asarray(masks)
            # SubprocVecEnv 下为 (n_envs, n_actions)；形状不符时只统计占比、不统计选用率。
            if table.ndim == 2 and table.shape[0] == len(flat):
                for row in table:
                    for index in np.nonzero(row)[0]:
                        self._legal[classify_action(int(index))] += 1
        if self._window >= self.log_every:
            self._log_window()
        return True

    def _opponent_totals(self) -> dict[str, int] | None:
        """汇总各并行环境里算法通道的**累计**诊断读数（v3.2.0 消融补）。

        三个计数器（实际抽中算法对手的局数 / 算法产出的动作数 / 被引擎拒绝的次数）
        此前只存在于 `env.py` 与 `tests/`，训练日志从不打印 —— 结果是 §6 那条
        「`opponent_rejections` 持续增长 → 停」的止损线在整个阶段 A 里**无法执行**。

        `env_method` 是 sb3 对 `SubprocVecEnv` 的标准跨进程通道（`action_masks`
        走的就是同一条路），每窗口调用一次、每进程一次同步往返，开销可忽略。
        环境不支持该方法时只降级一次并打一条告警，不刷屏。
        """
        if self._stats_unavailable:
            return None
        try:
            values = self.training_env.env_method("algorithm_stats")
        except Exception as error:  # noqa: BLE001 — 任何环境不支持都只降级，不影响训练
            self._stats_unavailable = True
            print(f"[opponent] 算法通道监控不可用，已关闭该读数: {type(error).__name__}: {error}", flush=True)
            return None
        totals = {"algorithm_episodes": 0, "algorithm_actions": 0, "rejections": 0}
        for value in values:
            if not isinstance(value, dict):
                continue
            for key in totals:
                totals[key] += int(value.get(key, 0))
        return totals

    def _new_candidate_counts(self, intent: str | None) -> tuple[int, int]:
        """(候选序号 ≥ 1 的被选中次数, 合法次数)；intent=None 表示全部意图。"""
        picked = sum(c for (name, cand), c in self._picked.items() if cand >= 1 and (intent is None or name == intent))
        legal = sum(c for (name, cand), c in self._legal.items() if cand >= 1 and (intent is None or name == intent))
        return picked, legal

    def _log_window(self) -> None:
        if not self._picked:
            return
        parts: list[str] = []
        for intent in ("move", "attack", "deploy"):
            picked, legal = self._new_candidate_counts(intent)
            if legal:
                rate = picked / legal
                self.logger.record(f"explore/{intent}_new_rate", rate)
                parts.append(f"{intent} {rate:.2%}")
        picked, legal = self._new_candidate_counts(None)
        overall = picked / legal if legal else 0.0
        self.logger.record("explore/new_candidate_rate", overall)
        self.logger.record("explore/new_candidate_count", picked)
        legal_total = sum(self._legal.values())
        legal_mean = legal_total / self._window if self._window else 0.0
        self.logger.record("explore/legal_actions_mean", legal_mean)
        # v3.2.0 (A5)：兵种多样性读数。type_entropy 是窗口内部署兵种分布的香农熵
        # （5 兵种均匀 = ln5 ≈ 1.61 nats，只出同一种 = 0）；scout_share 直接对应
        # v3.2.0 的验收门禁「侦察兵占比 ≥ 20%」（v3.1.1 实测 8%）。窗口后清空。
        deploy_total = sum(self._deploy_types.values())
        if deploy_total:
            counts = np.asarray(list(self._deploy_types.values()), dtype=np.float64)
            shares = counts / deploy_total
            entropy = float(-(shares * np.log(shares)).sum())
            scout_share = self._deploy_types.get(TYPE_INDEX["scout"], 0) / deploy_total
            self.logger.record("deploy/type_entropy", entropy)
            self.logger.record("deploy/scout_share", scout_share)
            parts.append(f"deploy_entropy {entropy:.2f} scout {scout_share:.1%}")
        # v3.2.0 消融补：算法通道体检。`algo_ep` 是窗口内实际抽中算法对手的局数，
        # 除以窗口内局数即实际配比；`rejections` 持续增长说明算法 payload 与引擎
        # 校验不一致。三者任一异常都应立刻停，而不是等训练跑完再看评估。
        totals = self._opponent_totals()
        if totals is not None:
            previous = self._last_opponent_totals
            window_episodes = totals["algorithm_episodes"] - previous["algorithm_episodes"]
            window_actions = totals["algorithm_actions"] - previous["algorithm_actions"]
            window_rejections = totals["rejections"] - previous["rejections"]
            self._last_opponent_totals = totals
            reject_rate = window_rejections / window_actions if window_actions else 0.0
            self.logger.record("opponent/algorithm_episodes", totals["algorithm_episodes"])
            self.logger.record("opponent/algorithm_actions", totals["algorithm_actions"])
            self.logger.record("opponent/rejections", totals["rejections"])
            self.logger.record("opponent/algorithm_episodes_window", window_episodes)
            self.logger.record("opponent/rejections_window", window_rejections)
            self.logger.record("opponent/rejection_rate_window", reject_rate)
            parts.append(
                f"algo_episodes +{window_episodes} algo_actions +{window_actions} "
                f"rejections +{window_rejections} reject_rate {reject_rate:.2%}"
            )
        print(
            f"[explore] frames={self._total} new_candidate_rate={overall:.3%} "
            f"({' | '.join(parts) if parts else 'no mask data'}) legal_mean={legal_mean:.1f}",
            flush=True,
        )
        self._picked.clear()
        self._legal.clear()
        self._deploy_types.clear()
        self._window = 0


def main() -> None:
    map_id = env_str("RL_MAP_ID", "default")
    opponent_style = env_str("RL_OPPONENT_STYLE", "mixed")
    # 与 rl/RELEASE_NOTES.md 顶部条目的版本号保持一致，每次变更训练环境时同步更新。
    model_version = env_str("RL_MODEL_VERSION", "v3.0.0")
    total_timesteps = env_int("RL_TIMESTEPS", 500_000, minimum=1)
    run_stamp = time.strftime("%Y%m%d-%H%M%S")
    run_date = run_stamp[:8]
    load_path = env_str("RL_LOAD_MODEL", "")
    save_freq = env_int("RL_SAVE_FREQ", 20_000, minimum=1)
    checkpoint_dir = env_str("RL_CHECKPOINT_DIR", f"rl/checkpoints/{map_id}/{run_stamp}")
    tb_dir = env_str("RL_TB_LOG", "rl/tb")
    # v2.8：评估搬到后台子进程（RL_EVAL_MODE=async），不阻塞 rollout。
    # v3.0.2：频率 5 万→**10 万步**、单场景 48→**96 局**。总评估开销不变（同样每步 0.96 局），
    # 但单次决策的抽样噪声减半：48 局胜率标准差约 ±23pt，实测 default_champion 在 14 次评估中
    # 出现过 27%~79%，而 best 选择键取最弱场景下界——等于让噪声决定交付哪个断点
    # （350k 与 480k 总分同为噪声内，后手座却差 10pt）。
    eval_mode = env_str("RL_EVAL_MODE", "async")
    if eval_mode not in {"async", "inline"}:
        raise ValueError("RL_EVAL_MODE must be async or inline")
    eval_freq = env_int("RL_EVAL_FREQ", 100_000 if eval_mode == "async" else 10_000, minimum=0)
    eval_episodes = env_int("RL_EVAL_EPISODES", 96 if eval_mode == "async" else 20, minimum=1)
    # v3.2.0：是否在评估里加跑 threat/greedy/field 三个算法场景。默认关——算法场景
    # 只记录、不进 best 选择键（见 eval_worker.selection_score），阶段 B 再开。
    eval_algo_scenarios = env_int("RL_EVAL_ALGO", 0, minimum=0) > 0
    # 算法场景局数单独可控。**注意**（v3.2.0 实测修正）：原注释写「算法是确定性策略、
    # 方差小」，这只对**单局**成立 —— 48 局（24 个顺序种子）的**子集偏差**可达 8pt：
    # 同一份 v3.1.1，48 局给 46.3%、300 局给 54.3%。给算法场景设判据时应 ≥192 局，
    # 或配合 RL_EVAL_SEED_STRIDE 用大步长跨越整个种子空间。
    eval_algo_episodes = env_int("RL_EVAL_ALGO_EPISODES", 48, minimum=2)
    # v3.2.0（评估功效修正）：评估种子步长。默认 1 = 顺序取种子（历史行为，保持历史可比性）。
    # > 1 时种子以大步长跨越整个空间，用少量局数换低偏差估计（见 eval_worker.play_scenario）。
    eval_seed_stride = env_int("RL_EVAL_SEED_STRIDE", 1, minimum=1)
    # v3.2.0 消融（阶段 A 复盘补）：best 选择键热身期，单位是**本次续训新增的帧数**。
    # 默认 0 = 关闭，保持历史行为。阶段 A 的交付物之所以约等于起点，就是因为选择键
    # 让第一个评估点（+9.6 万帧）占住了 best 且再未被超越——见 AsyncEvalCallback 注释。
    best_warmup_steps = env_int("RL_BEST_WARMUP_STEPS", 0, minimum=0)
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
    # v3.2.0：规则算法对手（threat/field/greedy/mcts）走 local-worker 的 decide 通道。
    # 该概率是**对局占比**（算法分支在 _choose_opponent_style 里优先级最高，不被
    # self-play 概率稀释）。mcts 默认不进池：它对最新模型的胜率最低（48-59%）。
    algorithm_opponent_probability = env_float("RL_ALGO_OPPONENT_PROB", 0.0)
    algorithm_mix = parse_algorithm_mix(env_str("RL_ALGO_MIX", ""))
    # 算法是确定性策略，留 10% 随机合法动作打断"确定性走法"的过拟合。
    algorithm_epsilon = env_float("RL_ALGO_EPSILON", 0.10)
    if not 0.0 <= algorithm_opponent_probability <= 1.0:
        raise ValueError("RL_ALGO_OPPONENT_PROB must be between 0 and 1")
    if not 0.0 <= algorithm_epsilon <= 1.0:
        raise ValueError("RL_ALGO_EPSILON must be between 0 and 1")
    if algorithm_opponent_probability > 0 and not algorithm_mix:
        raise ValueError("RL_ALGO_OPPONENT_PROB > 0 requires RL_ALGO_MIX (e.g. threat:0.4,field:0.3,greedy:0.3)")
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
    # v3.0：RL_EXTRACTOR=hex_transformer（默认）在 331 格上跑小 Transformer 再接策略头；
    # mlp 保持 v2.4 的纯 MLP 以便同条件对比。
    extractor = env_str("RL_EXTRACTOR", "hex_transformer")
    policy_kwargs = build_policy_kwargs(extractor, net_width)
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
    # v3.0.2：这四个超参以前只在【从零训练】分支里读环境变量，续训时走 sb3 的 load，
    # 断点内保存的值优先——而 distill.py 造的断点 ent_coef 是 sb3 默认 **0.0**，
    # 于是 RL_ENT_COEF 对续训成了死变量：v3.0.0/v3.0.1 整个 PPO 阶段零熵正则，
    # 策略熵从 0.94 一路压到 0.78、新候选概率质量从 5.5% 掉到 1.4%。现在统一在 load 时覆盖。
    gamma = env_float("RL_GAMMA", 0.99)
    ent_coef = env_float("RL_ENT_COEF", 0.01)
    clip_range = env_float("RL_CLIP_RANGE", 0.2)
    n_epochs = env_int("RL_N_EPOCHS", 10, minimum=1)
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
    if algorithm_opponent_probability > 0:
        print(
            f"[train] algorithm opponents probability={algorithm_opponent_probability:.0%} mix={algorithm_mix} "
            f"epsilon={algorithm_epsilon:.0%}（进程内 decide 通道；该概率即对局占比，不被 self-play 稀释）",
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
    # v4.0.0：从零训练世代必须显式关掉自动锚点。否则本分支会把 v2.7/v2.8 历史冠军
    # 悄悄放进对手池（虽不加载为起点，但违背「不从任何历史版本开始」的约束，
    # 且 54 动作旧锚点经 map_v27_action 只覆盖候选 0，会拉偏新动作空间的探索）。
    no_auto_anchor = env_str("RL_NO_AUTO_ANCHOR", "0") == "1"
    if self_play_probability > 0 and not anchor_model and not no_auto_anchor:
        # v3.0：从蒸馏冷启动断点续训时，锚点必须是真正的上一代冠军而不是断点本身
        # （蒸馏产物只是老师的近似）。RL_ANCHOR_FROM_LOAD=1 恢复“续训锚定自身”的旧行为。
        anchor_from_load = env_str("RL_ANCHOR_FROM_LOAD", "0") == "1"
        if anchor_from_load and resume and (os.path.exists(load_path) or os.path.exists(load_path + ".zip")):
            anchor_model = load_path
        else:
            anchor_model = champion_model_path()
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
        f"extractor={extractor} net={net_width}{'(from checkpoint)' if resume else ''} "
        f"lr={'constant ' + str(lr_start) if use_constant_lr else f'schedule {lr_start}->{lr_end}'} "
        f"n_steps={n_steps} batch={batch_size} target_kl={target_kl} "
        f"ent_coef={ent_coef} gamma={gamma} clip={clip_range} epochs={n_epochs} "
        f"timesteps={total_timesteps}{'(incremental)' if resume else ''} "
        f"map_mix={map_mix or [(map_id, 1.0)]} opponent_stochastic={opponent_stochastic_probability:.0%} "
        f"algo_opponent={algorithm_opponent_probability:.0%}{algorithm_mix or ''} eps={algorithm_epsilon:.0%}",
        flush=True,
    )
    # v3.2.0 奖励项（A4/A5）：打印实际生效值，避免"以为改了其实没生效"。
    print(
        f"[train] reward hq_damage={env_reward_float('RL_REWARD_HQ_DAMAGE', DEFAULT_REWARD_HQ_DAMAGE)} "
        f"hq_push={env_reward_float('RL_REWARD_HQ_PUSH', DEFAULT_REWARD_HQ_PUSH)} "
        f"new_unit_type={env_reward_float('RL_REWARD_NEW_UNIT_TYPE', DEFAULT_REWARD_NEW_UNIT_TYPE)} "
        f"shaping_scale={env_reward_float('RL_REWARD_SHAPING_SCALE', 0.5)} win={env_reward_float('RL_REWARD_WIN', 5.0)}",
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
        make_train_env(map_id, opponent_style, model_opponent_probability, resolved_opponent_path, snapshot_dir if self_play_probability > 0 else "", self_play_probability, anchor_model if self_play_probability > 0 else "", anchor_probability, map_mix, opponent_stochastic_probability, algorithm_mix, algorithm_opponent_probability, algorithm_epsilon)
        for _ in range(num_envs)
    ]
    env = SubprocVecEnv(env_fns) if num_envs > 1 else DummyVecEnv(env_fns)
    eval_envs: dict[str, Any] = {}
    try:
        if resume:
            print(f"[train] loading model from {load_path}")
            try:
                # 续训同样应用本次环境变量的 PPO 超参：n_steps 改变需要重建 rollout buffer，
                # sb3 在 load 时按新 n_steps 重新分配缓冲，安全。
                model = MaskablePPO.load(
                    load_path, env=env, device=device, learning_rate=learning_rate,
                    custom_objects=resume_custom_objects(
                        n_steps, batch_size, target_kl, gamma, ent_coef, clip_range, n_epochs,
                    ),
                )
            except ValueError as error:
                if "Action spaces do not match" in str(error) or "Observation spaces do not match" in str(error):
                    raise RuntimeError(
                        f"模型与当前 v2.1 环境不兼容: {load_path}。旧模型的动作空间与当前环境不同，"
                        "请清除 RL_LOAD_MODEL 后从零训练 v2.1 模型。"
                    ) from error
                raise
            model.tensorboard_log = tb_log
            # sb3 的 load 不恢复 verbose；不设则续训日志里没有 rollout/train 表。
            model.verbose = 1
        else:
            # 与续训路径一致地应用 RL_LR_MODE：此前这里硬编码 lr_schedule，
            # 导致从零训练时 RL_LR_MODE=constant 被静默忽略（续训路径才是唯一生效的）。
            model = MaskablePPO(
                "MlpPolicy",
                env,
                learning_rate=learning_rate,
                policy_kwargs=policy_kwargs,
                n_steps=n_steps,
                batch_size=batch_size,
                gamma=gamma,
                ent_coef=ent_coef,
                clip_range=clip_range,
                n_epochs=n_epochs,
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
        # 探索监控：每 2 万帧（8 环境约 2500 次回调）汇报一次新候选选用率。
        callbacks.append(ActionDiversityCallback(env_int("RL_EXPLORE_LOG_EVERY", 20_000, minimum=1)))
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
                algo_scenarios=eval_algo_scenarios,
                algo_episodes=eval_algo_episodes,
                best_warmup_steps=best_warmup_steps,
                seed_stride=eval_seed_stride,
            ))
            print(
                f"[train] async eval every {eval_freq} steps x {eval_episodes} games per scenario (background subprocess)"
                f"{' + algo scenarios x ' + str(eval_algo_episodes) if eval_algo_scenarios else ''}"
                f"{'；best 选择热身期 ' + str(best_warmup_steps) + ' 帧' if best_warmup_steps > 0 else ''}"
                f"{'；评估种子步长 ' + str(eval_seed_stride) + '（>1 = 低偏差采样）' if eval_seed_stride > 1 else ''}"
            )
        elif eval_freq > 0:
            # v3.2.0：inline 模式的环境是手工搭的，没走 build_scenarios，因此不认
            # RL_EVAL_ALGO。显式告警而不是静默忽略——否则"开了算法评估却没数据"很难查。
            if eval_algo_scenarios:
                print("[train] 警告：RL_EVAL_ALGO=1 仅在 RL_EVAL_MODE=async 下生效，当前 inline 模式已忽略")
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
                seed_stride=eval_seed_stride,
            ))
            print(f"[train] eval every {eval_freq} steps x {eval_episodes} games"
                  f"{'（种子步长 ' + str(eval_seed_stride) + '）' if eval_seed_stride > 1 else ''}")

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
