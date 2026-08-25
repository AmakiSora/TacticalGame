"""Run a trained v2.0.0-era MaskablePPO model in an existing REST game.

v2.0.0 模型（38 动作 / 8 单位槽）与当前 v2.1 环境（54 动作）不兼容。
本运行器配合 rl/env_v200.py（v2.0.0 时期 env.py 的原样快照），让旧模型
继续以训练时的表示参与真实 REST 对局。REST 端点在两个版本间一致，
因此仅替换编码/合法动作逻辑即可。

注意：v2.0.0 的观测按固定 player_a 视角编码（当时的实现），因此该模型
坐在 player_b 时属于训练分布之外，强度会失真但仍可正常对局。

由服务器 src/api/bots.ts 按模型的动作空间自动选择本运行器；
也可手动指定：

    python rl/run_model_v200.py --model rl/models/hex_ppo_v2.0.0_*_default_rule_*.zip \
        --game <gameId> --token <playerToken> [--side player_a]
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path

from sb3_contrib import MaskablePPO

from env_v200 import HexGameEnv


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="", help="模型路径；留空自动选择 rl/models 中最新的 v2.0 模型")
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
        candidates = list(Path("rl/models").glob("hex_ppo_v2.0.*_*_*.zip"))
        candidates += list(Path("rl/models").glob("hex_ppo_*_v2.0.*_*.zip"))
        if not candidates:
            raise FileNotFoundError("未找到 v2.0 模型，请先通过 --model 指定模型路径")
        model_path = str(max(candidates, key=lambda path: path.stat().st_mtime))
        print(f"Using latest v2.0 model: {model_path}")
    model = MaskablePPO.load(model_path)
    env = HexGameEnv(args.url)
    if getattr(model.action_space, "n", None) != env.action_space.n:
        raise ValueError(
            f"模型动作空间为 {getattr(model.action_space, 'n', '?')}，"
            f"v2.0.0 运行器需要 {env.action_space.n}；请确认模型版本。"
        )
    env.game_id = args.game
    env.player_token = args.token
    env.owner = args.side
    env.opponent = "player_b" if args.side == "player_a" else "player_a"
    if args.side != "player_a":
        print(
            "[警告] v2.0.0 观测按固定 player_a 视角编码；"
            "该模型坐在 player_b 时决策会失真（仍可正常对局）。"
        )

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
        if not action_type:
            action_type, payload = "end_turn", {}
        env._apply(action_type, payload, env.player_token)
        acted += 1
        print(f"{acted}: {action_type} {payload}")
        if args.once:
            return


if __name__ == "__main__":
    main()
