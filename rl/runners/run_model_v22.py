"""Run v2.1.x / v2.2.x MaskablePPO models (54 actions, 3,922-dim observation).

Uses the immutable ``env_v22`` snapshot for encoding and legal-action logic,
so these models keep their exact training-time representation even after
``env.py`` moved to the v2.3 random-map observation.  v2.3+ models must use
``run_model.py`` instead.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

# rl/ 已重组为 envs/runners/training/evaluation 子目录；把各代码目录挂上 sys.path，
# 让既有的扁平模块名（如 ``from env_v22 import ...``）在脚本模式下继续可用。
_RL_ROOT = Path(__file__).resolve().parent.parent
for _sub in ("envs", "runners", "training", "evaluation"):
    _p = str(_RL_ROOT / _sub)
    if _p not in sys.path:
        sys.path.insert(0, _p)

from sb3_contrib import MaskablePPO

try:
    from env_v22 import HexGameEnv
except ImportError:  # ``python -m rl.runners.run_model_v22`` 等调用方式。
    from rl.envs.env_v22 import HexGameEnv


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="", help="模型路径；留空自动选择 rl/models 中最新的 v2.1/v2.2 模型")
    parser.add_argument("--url", default="http://127.0.0.1:3100")
    parser.add_argument("--game", required=True)
    parser.add_argument("--token", required=True)
    parser.add_argument("--side", choices=("player_a", "player_b"), default="player_a")
    parser.add_argument("--poll-seconds", type=float, default=0.5)
    parser.add_argument("--max-actions", type=int, default=1000)
    parser.add_argument("--stochastic", action="store_true")
    parser.add_argument("--once", action="store_true", help="act once, then exit")
    return parser.parse_args()


def main():
    args = parse_args()
    model_path = args.model
    if not model_path:
        candidates = list(Path("rl/models").glob("hex_ppo_v2.2.*_*_*.zip"))
        candidates += list(Path("rl/models").glob("hex_ppo_*_v2.2.*_*.zip"))
        candidates += list(Path("rl/models").glob("hex_ppo_v2.1.*_*_*.zip"))
        candidates += list(Path("rl/models").glob("hex_ppo_*_v2.1.*_*.zip"))
        if not candidates:
            raise FileNotFoundError("未找到 v2.1/v2.2 模型，请先训练，或通过 --model 指定模型路径")
        model_path = str(max(candidates, key=lambda path: path.stat().st_mtime))
        print(f"Using latest model: {model_path}")
    model = MaskablePPO.load(model_path)
    env = HexGameEnv(args.url)
    if getattr(model.action_space, "n", None) != env.action_space.n:
        raise ValueError(
            f"模型动作空间为 {getattr(model.action_space, 'n', '?')}，v2.2 环境需要 {env.action_space.n}; "
            "动作数不同的模型请使用对应版本的运行器。"
        )
    if getattr(model.observation_space, "shape", (None,))[0] != env.observation_space.shape[0]:
        raise ValueError(
            f"模型观测维度为 {getattr(model.observation_space, 'shape', ('?',))[0]}，v2.2 环境需要 {env.observation_space.shape[0]}；"
            "v2.3+ 随机地图模型请使用 run_model.py。"
        )
    env.game_id = args.game
    env.player_token = args.token
    env.owner = args.side
    env.opponent = "player_b" if args.side == "player_a" else "player_a"

    acted = 0
    while acted < args.max_actions:
        state = env._get_state(env.player_token)
        env.state = state
        if state.get("phase") == "game_over":
            print(f"Game over. Winner: {state.get('winner')}")
            return
        if state.get("players", {}).get(env.owner, {}).get("status") != "active":
            print("This seat is no longer active.")
            return
        if state.get("turn", {}).get("currentPlayerId") != env.owner:
            time.sleep(args.poll_seconds)
            continue

        env.actions = env._legal_actions(state, env.owner)
        if not env.actions:
            print("No legal action; stopping.")
            return
        observation = env._encode_state(state)
        action, _ = model.predict(
            observation,
            deterministic=not args.stochastic,
            action_masks=env.action_masks(),
        )
        index = int(action)
        if index >= len(env.actions):
            index = 0
        action_type, payload = env.actions[index]
        # 兜底：限流则等待重试；其他拒绝（如 action_limit_reached，动作已过期）
        # 改为结束回合，绝不让异常杀死整局。
        while True:
            try:
                env._apply(action_type, payload, env.player_token)
                break
            except RuntimeError as error:
                if "rate_limit" not in str(error):
                    print(f"action rejected ({error}); falling back to end_turn")
                    action_type, payload = "end_turn", {}
                    try:
                        env._apply("end_turn", {}, env.player_token)
                    except RuntimeError as fallback_error:
                        if "rate_limit" not in str(fallback_error):
                            raise
                        print("rate limited; waiting 5s before retry")
                        time.sleep(5)
                        continue
                    break
                print("rate limited; waiting 5s before retry")
                time.sleep(5)
        acted += 1
        print(f"{acted}: {action_type} {payload}")
        if args.once:
            return


if __name__ == "__main__":
    main()
