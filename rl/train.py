"""Train MaskablePPO locally against the simple rule opponent.

Training calls the TypeScript engine directly, so no HTTP server is needed.
Configuration is controlled with environment variables for fresh training,
resume, checkpoints, TensorBoard, and periodic masked evaluation.
"""

from __future__ import annotations

import os
import shutil
import time
from pathlib import Path

import numpy as np
import torch
from sb3_contrib import MaskablePPO
from sb3_contrib.common.wrappers import ActionMasker
from stable_baselines3.common.callbacks import BaseCallback, CheckpointCallback

from local_env import LocalHexGameEnv


def mask_fn(env):
    return env.action_masks()


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


def ensure_zip_suffix(path: str) -> str:
    """sb3 的 save 只在“无扩展名”时才补 .zip，而版本号中的点会被误判为扩展名。"""
    return path if path.endswith(".zip") else f"{path}.zip"


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


class MaskableEvalCallback(BaseCallback):
    """Evaluate with action masks and save the best mean episode reward."""

    def __init__(self, eval_env, eval_freq: int, n_eval_episodes: int, best_model_save_path: str):
        super().__init__()
        self.eval_env = eval_env
        self.eval_freq = max(1, eval_freq)
        self.n_eval_episodes = max(1, n_eval_episodes)
        self.best_model_save_path = best_model_save_path
        self.best_score = (-1.0, -float("inf"), -float("inf"))

    def _on_step(self) -> bool:
        if self.num_timesteps % self.eval_freq != 0:
            return True
        print(f"[eval] step={self.num_timesteps:>8d} playing {self.n_eval_episodes} games...", flush=True)
        rewards: list[float] = []
        wins = 0
        control_points: list[int] = []
        action_totals = {"deploy": 0, "attack": 0, "move": 0, "end_turn": 0}
        for episode in range(self.n_eval_episodes):
            try:
                observation, _ = self.eval_env.reset()
                done = False
                total = 0.0
                while not done:
                    action, _ = self.model.predict(
                        observation,
                        deterministic=True,
                        action_masks=self.eval_env.action_masks(),
                    )
                    observation, reward, terminated, truncated, info = self.eval_env.step(int(action))
                    total += float(reward)
                    action_type = info.get("action_type")
                    if action_type in action_totals:
                        action_totals[action_type] += 1
                    done = terminated or truncated
                rewards.append(total)
                base_env = self.eval_env
                while hasattr(base_env, "env"):
                    base_env = base_env.env
                if base_env.state.get("winner") == base_env.owner:
                    wins += 1
                control_points.append(sum(p.get("owner") == base_env.owner for p in base_env.state.get("controlPoints", [])))
            except Exception as error:
                print(f"[eval] episode {episode} failed: {error}", flush=True)
        if not rewards:
            return True
        mean_reward = float(np.mean(rewards))
        win_rate = wins / len(rewards)
        cp_mean = float(np.mean(control_points)) if control_points else 0.0
        # Production selection follows gameplay outcomes first: win rate,
        # then average control points, then shaped reward as a tie-breaker.
        selection_score = (win_rate, cp_mean, mean_reward)
        is_best = selection_score > self.best_score
        if is_best:
            self.best_score = selection_score
            self.model.save(os.path.join(self.best_model_save_path, "best_model"))
        self.logger.record("eval/mean_reward", mean_reward)
        self.logger.record("eval/win_rate", win_rate)
        self.logger.record("eval/control_points", cp_mean)
        print(
            f"[eval] step={self.num_timesteps:>8d} mean_reward={mean_reward:+.3f} "
            f"win_rate={win_rate:.0%} cp={cp_mean:.2f} "
            f"deploy={action_totals['deploy']} attack={action_totals['attack']} move={action_totals['move']} "
            f"over {len(rewards)} games{' <- new best' if is_best else ''}",
            flush=True,
        )
        return True


def main() -> None:
    map_id = env_str("RL_MAP_ID", "default")
    opponent_style = env_str("RL_OPPONENT_STYLE", "mixed")
    opponent_kind = "modelmix"
    # 与 rl/RELEASE_NOTES.md 顶部条目的版本号保持一致，每次变更训练环境时同步更新。
    model_version = env_str("RL_MODEL_VERSION", "v2.2.1")
    total_timesteps = env_int("RL_TIMESTEPS", 500_000, minimum=1)
    run_stamp = time.strftime("%Y%m%d-%H%M%S")
    run_date = run_stamp[:8]
    model_path = env_str(
        "RL_MODEL_PATH",
        f"rl/models/hex_ppo_{model_version}_{run_date}_{map_id}_{opponent_kind}_{total_timesteps}",
    )
    load_path = env_str("RL_LOAD_MODEL", "")
    save_freq = env_int("RL_SAVE_FREQ", 20_000, minimum=1)
    checkpoint_dir = env_str("RL_CHECKPOINT_DIR", f"rl/checkpoints/{map_id}/{run_stamp}")
    tb_dir = env_str("RL_TB_LOG", "rl/tb")
    eval_freq = env_int("RL_EVAL_FREQ", 10_000, minimum=0)
    eval_episodes = env_int("RL_EVAL_EPISODES", 20, minimum=1)
    model_opponent_probability = env_float("RL_MODEL_OPPONENT_PROB", 0.5)
    device = resolve_device()

    old_model_path = opponent_model_path(map_id)
    opponent_model = None
    if old_model_path:
        print(f"[train] model opponent={old_model_path} probability={model_opponent_probability:.0%}", flush=True)
        opponent_model = MaskablePPO.load(old_model_path, device="cpu")
    else:
        print("[train] no v2.0 opponent model found; using rule opponents only", flush=True)

    Path(model_path).parent.mkdir(parents=True, exist_ok=True)
    Path(checkpoint_dir).mkdir(parents=True, exist_ok=True)
    best_dir = Path(checkpoint_dir) / "best"
    best_dir.mkdir(parents=True, exist_ok=True)

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
    if not resume and (os.path.exists(model_path) or os.path.exists(model_path + ".zip")) and env_str("RL_ALLOW_OVERWRITE", "0") != "1":
        raise FileExistsError(
            f"模型已存在: {model_path}. 设置 RL_ALLOW_OVERWRITE=1 才允许覆盖，或换一个 RL_MODEL_PATH。"
        )
    run_name = f"ppo_{map_id}_{run_stamp}" + ("_resume" if resume else "")
    print(
        f"[train] map={map_id} mode={'resume' if resume else 'fresh'} "
        f"timesteps={total_timesteps}{'(incremental)' if resume else ''}",
        flush=True,
    )

    if tensorboard_available():
        tb_log = tb_dir
    else:
        print("[train] tensorboard 未安装,跳过 TB 日志;需要时运行: python -m pip install tensorboard")
        tb_log = None

    env = ActionMasker(LocalHexGameEnv(map_id=map_id, opponent_style=opponent_style, opponent_model=opponent_model, model_opponent_probability=model_opponent_probability), mask_fn)
    eval_env = None
    try:
        if resume:
            print(f"[train] loading model from {load_path}")
            try:
                model = MaskablePPO.load(load_path, env=env, device=device)
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
                learning_rate=env_float("RL_LEARNING_RATE", 3e-4),
                n_steps=env_int("RL_N_STEPS", 256, minimum=1),
                batch_size=env_int("RL_BATCH_SIZE", 64, minimum=1),
                gamma=env_float("RL_GAMMA", 0.99),
                ent_coef=env_float("RL_ENT_COEF", 0.01),
                clip_range=env_float("RL_CLIP_RANGE", 0.2),
                n_epochs=env_int("RL_N_EPOCHS", 10, minimum=1),
                tensorboard_log=tb_log,
                device=device,
                verbose=1,
            )

        callbacks: list[BaseCallback] = [CheckpointCallback(
            save_freq=save_freq,
            save_path=checkpoint_dir,
            name_prefix=Path(model_path).name,
        )]
        if eval_freq > 0:
            eval_env = ActionMasker(LocalHexGameEnv(map_id=map_id, opponent_style=opponent_style, opponent_model=opponent_model, model_opponent_probability=model_opponent_probability), mask_fn)
            callbacks.append(MaskableEvalCallback(
                eval_env,
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
        print(f"[train] checkpoints in {checkpoint_dir}/")
    finally:
        if eval_env is not None:
            eval_env.close()
        env.close()


if __name__ == "__main__":
    main()
