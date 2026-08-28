"""Run a v1-era (512-action) MaskablePPO model in a REST game.

The two ``random_opponent`` weights predate the fixed intent-slot action
space.  They must keep using ``env_v100.py`` so their dynamic action ordering
and observation encoding remain exactly as trained.
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path

from sb3_contrib import MaskablePPO

from env_v100 import HexGameEnv


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="", help="模型路径；留空自动选择 random_opponent 模型")
    parser.add_argument("--url", default="http://127.0.0.1:3100")
    parser.add_argument("--game", required=True)
    parser.add_argument("--token", required=True)
    parser.add_argument("--side", choices=("player_a", "player_b"), default="player_a")
    parser.add_argument("--poll-seconds", type=float, default=0.5)
    parser.add_argument("--max-actions", type=int, default=1000)
    parser.add_argument("--stochastic", action="store_true")
    parser.add_argument("--once", action="store_true")
    return parser.parse_args()


def main():
    args = parse_args()
    model_path = args.model
    if not model_path:
        candidates = list(Path("rl/models").glob("hex_ppo_*random_opponent*.zip"))
        if not candidates:
            raise FileNotFoundError("未找到 512 动作 random_opponent 模型")
        model_path = str(max(candidates, key=lambda path: path.stat().st_mtime))
        print(f"Using latest model: {model_path}")

    model = MaskablePPO.load(model_path)
    env = HexGameEnv(args.url)
    if getattr(model.action_space, "n", None) != env.action_space.n:
        raise ValueError(
            f"模型动作空间为 {getattr(model.action_space, 'n', '?')}，"
            f"v1 运行器需要 {env.action_space.n}；请确认模型版本。"
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
        if index < 0 or index >= len(env.actions) or not env.actions[index][0]:
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
