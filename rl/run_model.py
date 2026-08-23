"""Run a trained MaskablePPO model in an existing REST game.

The model currently expects the default-map observation/action representation
from env.py.  It can act as either player_a or player_b because observations are
encoded from the selected player's perspective.
"""

from __future__ import annotations

import argparse
import time

from sb3_contrib import MaskablePPO

from env import HexGameEnv


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="rl/hex_ppo_v2_default_rule_opponent.zip")
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
    model = MaskablePPO.load(args.model)
    env = HexGameEnv(args.url)
    if getattr(model.action_space, "n", None) != env.action_space.n:
        raise ValueError(
            f"模型动作空间为 {getattr(model.action_space, 'n', '?')}，当前环境需要 {env.action_space.n}; "
            "请使用 v2 模型并从零训练。"
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
        env._apply(action_type, payload, env.player_token)
        acted += 1
        print(f"{acted}: {action_type} {payload}")
        if args.once:
            return


if __name__ == "__main__":
    main()
