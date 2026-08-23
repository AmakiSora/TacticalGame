"""Train MaskablePPO locally against the random legal-action opponent.

Training calls the TypeScript engine directly, so no HTTP server is needed.
Configuration is controlled with environment variables for fresh training,
resume, checkpoints, TensorBoard, and periodic masked evaluation.
"""

from __future__ import annotations

import os
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
        self.best_mean_reward = -float("inf")

    def _on_step(self) -> bool:
        if self.num_timesteps % self.eval_freq != 0:
            return True
        print(f"[eval] step={self.num_timesteps:>8d} playing {self.n_eval_episodes} games...", flush=True)
        rewards: list[float] = []
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
                    observation, reward, terminated, truncated, _ = self.eval_env.step(int(action))
                    total += float(reward)
                    done = terminated or truncated
                rewards.append(total)
            except Exception as error:
                print(f"[eval] episode {episode} failed: {error}", flush=True)
        if not rewards:
            return True
        mean_reward = float(np.mean(rewards))
        is_best = mean_reward > self.best_mean_reward
        if is_best:
            self.best_mean_reward = mean_reward
            self.model.save(os.path.join(self.best_model_save_path, "best_model"))
        print(
            f"[eval] step={self.num_timesteps:>8d} mean_reward={mean_reward:+.3f} "
            f"over {len(rewards)} games{' <- new best' if is_best else ''}",
            flush=True,
        )
        return True


def main() -> None:
    map_id = env_str("RL_MAP_ID", "default")
    total_timesteps = env_int("RL_TIMESTEPS", 500_000, minimum=1)
    model_path = env_str("RL_MODEL_PATH", f"rl/hex_ppo_v2_{map_id}_rule_opponent")
    load_path = env_str("RL_LOAD_MODEL", "")
    save_freq = env_int("RL_SAVE_FREQ", 20_000, minimum=1)
    checkpoint_dir = env_str("RL_CHECKPOINT_DIR", f"rl/checkpoints/{map_id}")
    tb_dir = env_str("RL_TB_LOG", "rl/tb")
    eval_freq = env_int("RL_EVAL_FREQ", 10_000, minimum=0)
    eval_episodes = env_int("RL_EVAL_EPISODES", 20, minimum=1)
    device = resolve_device()

    Path(model_path).parent.mkdir(parents=True, exist_ok=True)
    Path(checkpoint_dir).mkdir(parents=True, exist_ok=True)
    best_dir = Path(checkpoint_dir) / "best"
    best_dir.mkdir(parents=True, exist_ok=True)

    if load_path == "auto":
        candidates = [model_path, model_path + ".zip"]
        load_path = next((candidate for candidate in candidates if os.path.exists(candidate)), "")
    if load_path and not (os.path.exists(load_path) or os.path.exists(load_path + ".zip")):
        raise FileNotFoundError(f"RL_LOAD_MODEL 指向的模型不存在: {load_path}")

    resume = bool(load_path)
    run_name = f"ppo_{map_id}_{time.strftime('%Y%m%d-%H%M%S')}" + ("_resume" if resume else "")
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

    env = ActionMasker(LocalHexGameEnv(map_id=map_id), mask_fn)
    eval_env = None
    try:
        if resume:
            print(f"[train] loading model from {load_path}")
            model = MaskablePPO.load(load_path, env=env, device=device)
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
            eval_env = ActionMasker(LocalHexGameEnv(map_id=map_id), mask_fn)
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
        model.save(model_path)
        print(f"[train] final model saved to {model_path}.zip")
        print(f"[train] checkpoints in {checkpoint_dir}/")
    finally:
        if eval_env is not None:
            eval_env.close()
        env.close()


if __name__ == "__main__":
    main()
