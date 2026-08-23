"""Train PPO against the random opponent in env.py."""

import os

from sb3_contrib import MaskablePPO
from sb3_contrib.common.wrappers import ActionMasker

from local_env import LocalHexGameEnv


def mask_fn(env):
    return env.action_masks()


env = ActionMasker(LocalHexGameEnv(), mask_fn)

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
model.save("rl/hex_ppo_random_opponent")
env.close()
