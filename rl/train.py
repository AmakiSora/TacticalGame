"""Train PPO against the random opponent in env.py."""

import os

from sb3_contrib import MaskablePPO
from sb3_contrib.common.wrappers import ActionMasker

from local_env import LocalHexGameEnv


def mask_fn(env):
    return env.action_masks()


map_id = os.environ.get("RL_MAP_ID", "default")
env = ActionMasker(LocalHexGameEnv(map_id=map_id), mask_fn)

model = MaskablePPO(
    "MlpPolicy",
    env,
    learning_rate=3e-4,
    n_steps=256,
    batch_size=64,
    gamma=0.99,
    verbose=1,
)

total_timesteps = int(os.environ.get("RL_TIMESTEPS", "100000"))
model.learn(total_timesteps=total_timesteps)
model_path = os.environ.get("RL_MODEL_PATH", f"rl/hex_ppo_{map_id}_random_opponent")
model.save(model_path)
env.close()
