"""跨版本模型对战：让 v2.0.0（38 动作）与 v2.1（54 动作）模型互相对弈。

两个模型的动作空间不同，无法在同一套编码下运行：
- v2.0.0：8 个单位槽 / 38 动作；观测按固定 player_a 视角编码（当时的实现）。
- v2.1.x：12 个单位槽 / 54 动作；观测按所选座位视角编码。

本脚本通过 rl/local-worker.ts 在进程内跑引擎（无需启动游戏服务器），
对每个座位使用其模型训练时期的编码与合法动作生成逻辑：

    rl/.venv/Scripts/python.exe rl/evaluate_cross.py \
        --model-a rl/models/hex_ppo_v2.0.0_20260824_default_rule_500000.zip \
        --model-b rl/models/hex_ppo_v2.1.1_20260825_default_rule_mixed_500000.zip \
        --games 4

注意：v2.0.0 的编码固定以 player_a 为己方视角，因此旧模型默认固定坐
player_a；如确需交换座位请加 --swap-sides（旧模型表现会失真）。
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

import numpy as np
from sb3_contrib import MaskablePPO

try:
    from env import MAX_ACTIONS as CURRENT_MAX_ACTIONS
    from env import HexGameEnv as CurrentHexGameEnv
    from env_v200 import MAX_ACTIONS as LEGACY_MAX_ACTIONS
    from env_v200 import HexGameEnv as LegacyHexGameEnv
except ImportError:  # 兼容 ``python -m rl.evaluate_cross`` 等调用方式。
    from rl.env import MAX_ACTIONS as CURRENT_MAX_ACTIONS
    from rl.env import HexGameEnv as CurrentHexGameEnv
    from rl.env_v200 import MAX_ACTIONS as LEGACY_MAX_ACTIONS
    from rl.env_v200 import HexGameEnv as LegacyHexGameEnv


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--model-a", required=True, help="坐 player_a 座位的模型 zip 路径")
    parser.add_argument("--model-b", required=True, help="坐 player_b 座位的模型 zip 路径")
    parser.add_argument("--name-a", default=None, help="player_a 模型的显示名（默认取文件名）")
    parser.add_argument("--name-b", default=None, help="player_b 模型的显示名（默认取文件名）")
    parser.add_argument("--games", type=int, default=2, help="总对局数（每局结束后交换座位需开 --swap-sides）")
    parser.add_argument("--map", dest="map_id", default="default", help="地图 id（默认 default）")
    parser.add_argument("--max-rounds", type=int, default=100, help="单局回合数上限，超过记为 draw")
    parser.add_argument("--max-actions", type=int, default=5000, help="单局动作数上限，超过记为 draw")
    parser.add_argument("--stochastic", action="store_true", help="按策略采样而非确定性取最优动作")
    parser.add_argument("--device", default="auto", help="torch 设备：auto / cuda / cpu")
    parser.add_argument("--swap-sides", action="store_true",
                        help="每局交换座位。注意 v2.0.0 编码固定 player_a 视角，交换后旧模型会失真")
    parser.add_argument("--verbose", action="store_true", help="打印每个动作")
    return parser.parse_args()


class EngineWorker:
    """rl/local-worker.ts 的 JSON-lines 客户端（与 rl/local_env.py 相同协议）。"""

    def __init__(self):
        npx = shutil.which("npx.cmd") or shutil.which("npx")
        if not npx:
            raise RuntimeError("npx was not found; run npm install first")
        root = Path(__file__).resolve().parent.parent
        self.proc = subprocess.Popen(
            [npx, "tsx", "rl/local-worker.ts"],
            cwd=root,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )

    def call(self, command: dict[str, Any]) -> dict[str, Any]:
        if self.proc.poll() is not None or self.proc.stdin is None or self.proc.stdout is None:
            raise RuntimeError("local engine worker exited")
        self.proc.stdin.write(json.dumps(command) + "\n")
        self.proc.stdin.flush()
        line = self.proc.stdout.readline()
        if not line:
            raise RuntimeError("local engine worker returned no response")
        response = json.loads(line)
        if not response.get("ok"):
            raise RuntimeError(response.get("error", "local engine error"))
        return response["state"]

    def apply(self, side: str, action_type: str, payload: dict[str, Any]) -> dict[str, Any]:
        action = {"type": action_type, **payload}
        return self.call({"cmd": "apply", "owner": side, "action": action})

    def close(self):
        if getattr(self, "proc", None) and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.proc.kill()


class SideController:
    """一个座位的选手：加载模型并使用其训练版本的编码/合法动作逻辑。"""

    def __init__(self, label: str, model_path: str, side: str, device: str):
        self.label = label
        self.model_path = model_path
        self.side = side
        self.opponent = "player_b" if side == "player_a" else "player_a"
        self.model = MaskablePPO.load(model_path, device=device)

        n_actions = int(getattr(self.model.action_space, "n", -1))
        if n_actions == CURRENT_MAX_ACTIONS:
            helper_cls, self.version = CurrentHexGameEnv, f"v2.1 ({n_actions} 动作)"
        elif n_actions == LEGACY_MAX_ACTIONS:
            helper_cls, self.version = LegacyHexGameEnv, f"v2.0.0 ({n_actions} 动作)"
        else:
            raise ValueError(
                f"{label}: 动作空间 {n_actions} 无法识别（支持 "
                f"{LEGACY_MAX_ACTIONS}=v2.0.0 或 {CURRENT_MAX_ACTIONS}=v2.1）"
            )
        # helper 仅用于纯计算（合法动作/编码），不做任何网络或子进程操作。
        self.helper = helper_cls()
        self.helper.owner = side
        self.helper.opponent = self.opponent
        if helper_cls is LegacyHexGameEnv and side != "player_a":
            print(f"[警告] {label}: v2.0.0 观测按固定 player_a 视角编码，"
                  f"坐在 {side} 时表现为训练分布之外，结果可能失真。")

    def reset_for_game(self):
        # 清空 v2.1 的稳定槽位记录，使其与新对局的部署状态一致。
        self.helper.unit_slots = {"player_a": {}, "player_b": {}}

    def act(self, state: dict[str, Any], stochastic: bool) -> tuple[str, dict[str, Any]]:
        actions = self.helper._legal_actions(state, self.side)
        if not any(action[0] for action in actions):
            return "end_turn", {}
        observation = self.helper._encode_state(state)
        mask = np.asarray([bool(action[0]) for action in actions], dtype=bool)
        action_index, _ = self.model.predict(observation, deterministic=not stochastic, action_masks=mask)
        index = int(action_index)
        if index >= len(actions) or not actions[index][0]:
            return "end_turn", {}
        return actions[index]

    @property
    def short(self) -> str:
        return f"{self.label}[{self.side}, {self.version}]"


def play_one_game(worker: EngineWorker, seat_map: dict[str, SideController], args) -> tuple[str | None, int, int]:
    state = worker.call({"cmd": "reset", "mapId": args.map_id})
    acted = 0
    while acted < args.max_actions:
        if state.get("phase") == "game_over":
            break
        if int(state.get("turn", {}).get("roundNumber", 1)) > args.max_rounds:
            return None, acted, int(state.get("turn", {}).get("roundNumber", 1))
        side = state.get("turn", {}).get("currentPlayerId")
        controller = seat_map.get(side)
        if controller is None:
            raise RuntimeError(f"unknown current player: {side!r}")
        action_type, payload = controller.act(state, args.stochastic)
        if args.verbose:
            print(f"  r{state.get('turn', {}).get('roundNumber', '?')} {controller.short}: {action_type} {payload}")
        state = worker.apply(side, action_type, payload)
        acted += 1
    return state.get("winner"), acted, int(state.get("turn", {}).get("roundNumber", 1))


def main():
    # Windows 控制台默认 GBK，统一改用 UTF-8 输出避免乱码。
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    args = parse_args()
    name_a = args.name_a or Path(args.model_a).name
    name_b = args.name_b or Path(args.model_b).name
    names = {"player_a": name_a, "player_b": name_b}

    workers = [EngineWorker()]
    try:
        controllers = {
            side: SideController(names[side], path, side, args.device)
            for side, path in (("player_a", args.model_a), ("player_b", args.model_b))
        }
        tally: dict[str, int] = {name_a: 0, name_b: 0, "draw": 0}

        for game_index in range(1, args.games + 1):
            if args.swap_sides and game_index > 1:
                # 交换座位：重建控制器以匹配新的 owner 视角。
                controllers = {
                    "player_a": SideController(name_b, args.model_b, "player_a", args.device),
                    "player_b": SideController(name_a, args.model_a, "player_b", args.device),
                }
            for controller in controllers.values():
                controller.reset_for_game()

            print(f"— 第 {game_index}/{args.games} 局（{controllers['player_a'].short}"
                  f" vs {controllers['player_b'].short}）")
            winner, acted, rounds = play_one_game(workers[0], controllers, args)
            if winner in (None, "draw"):
                tally["draw"] += 1
                result = "平局（达到回合/动作上限）"
            else:
                winner_name = names.get(winner, winner)
                tally[winner_name] = tally.get(winner_name, 0) + 1
                result = f"胜者：{winner_name}"
            print(f"  结果：{result}（{rounds} 回合 / {acted} 动作）")

        print("\n===== 总结 =====")
        for name in (name_a, name_b, "draw"):
            print(f"{name}: {tally.get(name, 0)}")
    finally:
        for worker in workers:
            worker.close()


if __name__ == "__main__":
    main()
