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
import time
from pathlib import Path
from typing import Any

import numpy as np
from sb3_contrib import MaskablePPO

try:
    from env import MAX_ACTIONS as CURRENT_MAX_ACTIONS
    from env import HexGameEnv as CurrentHexGameEnv
    from env_v200 import MAX_ACTIONS as LEGACY_MAX_ACTIONS
    from env_v200 import HexGameEnv as LegacyHexGameEnv
    from env_v22 import HexGameEnv as V22HexGameEnv
    from env_v24 import HexGameEnv as V24HexGameEnv
    from env_v25 import HexGameEnv as V25HexGameEnv
except ImportError:  # 兼容 ``python -m rl.evaluate_cross`` 等调用方式。
    from rl.env import MAX_ACTIONS as CURRENT_MAX_ACTIONS
    from rl.env import HexGameEnv as CurrentHexGameEnv
    from rl.env_v200 import MAX_ACTIONS as LEGACY_MAX_ACTIONS
    from rl.env_v200 import HexGameEnv as LegacyHexGameEnv
    from rl.env_v22 import HexGameEnv as V22HexGameEnv
    from rl.env_v24 import HexGameEnv as V24HexGameEnv
    from rl.env_v25 import HexGameEnv as V25HexGameEnv


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--model-a", required=True, help="坐 player_a 座位的模型 zip 路径")
    parser.add_argument("--model-b", required=True, help="坐 player_b 座位的模型 zip 路径")
    parser.add_argument("--name-a", default=None, help="player_a 模型的显示名（默认取文件名）")
    parser.add_argument("--name-b", default=None, help="player_b 模型的显示名（默认取文件名）")
    parser.add_argument("--games", type=int, default=2, help="总对局数（每局结束后交换座位需开 --swap-sides）")
    parser.add_argument("--map", dest="map_id", default="default", help="地图 id（默认 default；random 为每局一张对称随机地图）")
    parser.add_argument("--max-rounds", type=int, default=100, help="单局回合数上限，超过记为 draw")
    parser.add_argument("--max-actions", type=int, default=5000, help="单局动作数上限，超过记为 draw")
    parser.add_argument("--stochastic", action="store_true", help="按策略采样而非确定性取最优动作")
    parser.add_argument("--device", default="auto", help="torch 设备：auto / cuda / cpu")
    parser.add_argument("--swap-sides", action="store_true",
                        help="每局交换座位。注意 v2.0.0 编码固定 player_a 视角，交换后旧模型会失真")
    parser.add_argument("--stats-file", default=None,
                        help="每局结果追加到该 JSONL 文件，结束时输出与历史运行累计合并的统计（大样本验收用）")
    parser.add_argument("--verbose", action="store_true", help="打印每个动作")
    return parser.parse_args()


def seat_breakdown(records: list[dict[str, Any]]) -> list[str]:
    """按模型 × 座位统计胜局；确定性策略互打方差极高，分座位是拆穿先手效应的必要维度。"""
    games: dict[str, dict[str, int]] = {}
    wins: dict[str, dict[str, int]] = {}
    for record in records:
        for seat, name in record["players"].items():
            games.setdefault(name, {})[seat] = games.get(name, {}).get(seat, 0) + 1
            if record["winner"] == name:
                wins.setdefault(name, {})[seat] = wins.get(name, {}).get(seat, 0) + 1
    lines = []
    for name, by_seat in games.items():
        parts, total_w, total_g, draws = [], 0, 0, 0
        for seat in ("player_a", "player_b"):
            g = by_seat.get(seat, 0)
            if not g:
                continue
            w = wins.get(name, {}).get(seat, 0)
            parts.append(f"{seat} 座 {w} 胜/{g} 局")
            total_w += w
            total_g += g
        draws = sum(1 for r in records if r["winner"] == "draw" and name in r["players"].values())
        suffix = f"，平 {draws}" if draws else ""
        lines.append(f"  {name}: 共 {total_w}/{total_g}{suffix}（{'；'.join(parts)}）")
    return lines


def load_stats(stats_file: Path, pair: set[str], map_id: str) -> list[dict[str, Any]]:
    """读累计文件，只保留同一模型对与同一地图的记录。"""
    records: list[dict[str, Any]] = []
    if not stats_file.exists():
        return records
    for line in stats_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except ValueError:
            continue
        if record.get("map") != map_id:
            continue
        if set(record.get("players", {}).values()) != pair:
            continue
        records.append(record)
    return records


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
            errors="replace",
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
        obs_dim = int(self.model.observation_space.shape[0]) if getattr(self.model.observation_space, "shape", ()) else 0
        if n_actions == LEGACY_MAX_ACTIONS:
            helper_cls, self.version = LegacyHexGameEnv, f"v2.0.0 ({n_actions} 动作)"
        elif n_actions == CURRENT_MAX_ACTIONS:
            # 同为 54 动作但观测语义按版本分化：按观测维度选编码器，
            # 5974 维 → 当前环境（v2.6，与 v2.3/v2.4 编码逐格一致，统一用当前本体）；
            # 6024 维 → v2.5 快照；3922 维 → v2.1/v2.2 快照。
            if obs_dim == 5974:
                helper_cls, self.version = CurrentHexGameEnv, f"v2.3-v2.4/v2.6 ({n_actions} 动作)"
            elif obs_dim == 6024:
                helper_cls, self.version = V25HexGameEnv, f"v2.5 ({n_actions} 动作)"
            elif obs_dim == 3922:
                helper_cls, self.version = V22HexGameEnv, f"v2.2 ({n_actions} 动作)"
            else:
                raise ValueError(f"{label}: 54 动作模型的观测维度 {obs_dim} 无法识别（支持 6024 / 5974 / 3922）")
        else:
            raise ValueError(
                f"{label}: 动作空间 {n_actions} 无法识别（支持 "
                f"{LEGACY_MAX_ACTIONS}=v2.0.0 或 {CURRENT_MAX_ACTIONS}=v2.1+）"
            )
        # helper 仅用于纯计算（合法动作/编码），不做任何网络或子进程操作。
        # 注意：v2.2 helper 在随机地图上属分布外（编码只覆盖半径 8 的 217 格、
        # 归一化常数为静态图数值），观察到的正是旧模型面对未知地图的退化量。
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


def reset_command(args, game_index: int) -> dict[str, Any]:
    command: dict[str, Any] = {"cmd": "reset", "mapId": args.map_id}
    if args.map_id == "random":
        # 每局一张对称随机地图；种子由局序派生，同参数评估可复现。
        command["random"] = {"seed": f"cross-{game_index}", "symmetric": True}
    return command


def play_one_game(worker: EngineWorker, seat_map: dict[str, SideController], args, game_index: int) -> tuple[str | None, int, int]:
    state = worker.call(reset_command(args, game_index))
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
        records: list[dict[str, Any]] = []

        for game_index in range(1, args.games + 1):
            if args.swap_sides and game_index > 1:
                # 交换座位：重建控制器以匹配新的 owner 视角。
                # 注意：必须按当前座位映射取模型路径/名字——上一次重建后控制器
                # 的 label 已与初始 names 字典相反，直接取 names[side] 会导致
                # 第 3 局起座位反复失效（v2.5.0 验收时踩到）。
                current = {seat: (controller.label, controller.model_path) for seat, controller in controllers.items()}
                controllers = {
                    "player_a": SideController(current["player_b"][0], current["player_b"][1], "player_a", args.device),
                    "player_b": SideController(current["player_a"][0], current["player_a"][1], "player_b", args.device),
                }
                names = {"player_a": current["player_b"][0], "player_b": current["player_a"][0]}
            for controller in controllers.values():
                controller.reset_for_game()

            print(f"— 第 {game_index}/{args.games} 局（{controllers['player_a'].short}"
                  f" vs {controllers['player_b'].short}）")
            winner, acted, rounds = play_one_game(workers[0], controllers, args, game_index)
            seats = {seat: controller.label for seat, controller in controllers.items()}
            if winner in (None, "draw"):
                tally["draw"] += 1
                winner_label = "draw"
                result = "平局（达到回合/动作上限）"
            else:
                winner_name = names.get(winner, winner)
                tally[winner_name] = tally.get(winner_name, 0) + 1
                winner_label = winner_name
                result = f"胜者：{winner_name}"
            records.append({
                "ts": time.strftime("%Y-%m-%d %H:%M:%S"),
                "map": args.map_id,
                "players": seats,
                "winner": winner_label,
                "rounds": rounds,
            })
            print(f"  结果：{result}（{rounds} 回合 / {acted} 动作）")

        print("\n===== 总结（本次运行）=====")
        for name in (name_a, name_b, "draw"):
            print(f"{name}: {tally.get(name, 0)}")
        print("分座位（本次运行）：")
        for line in seat_breakdown(records):
            print(line)

        if args.stats_file:
            stats_file = Path(args.stats_file)
            stats_file.parent.mkdir(parents=True, exist_ok=True)
            with stats_file.open("a", encoding="utf-8") as handle:
                for record in records:
                    handle.write(json.dumps(record, ensure_ascii=False) + "\n")
            cumulative = load_stats(stats_file, {name_a, name_b}, args.map_id)
            print(f"\n===== 累计统计（{stats_file.name}，{len(cumulative)} 局）=====")
            for line in seat_breakdown(cumulative):
                print(line)
    finally:
        for worker in workers:
            worker.close()


if __name__ == "__main__":
    main()
