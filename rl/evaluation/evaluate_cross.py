"""跨版本模型对战：让不同观测/动作世代的模型互相对弈。

两个模型的动作空间不同，无法在同一套编码下运行：
- v2.0.0：8 个单位槽 / 38 动作；观测按固定 player_a 视角编码（当时的实现）。
- v2.1.x/v2.2：12 个单位槽 / 54 动作；观测按所选座位视角编码。
- v2.7：54 动作 / 6205 维（槽位和规则特征）；v2.6 及更早版本走冻结快照。

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
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
import torch
from sb3_contrib import MaskablePPO

# rl/ 已重组为 envs/runners/training/evaluation 子目录；把各代码目录挂上 sys.path，
# 让既有的扁平模块名（如 ``import env``）在脚本模式下继续可用。
_RL_ROOT = Path(__file__).resolve().parent.parent
for _sub in ("envs", "runners", "training", "evaluation"):
    _p = str(_RL_ROOT / _sub)
    if _p not in sys.path:
        sys.path.insert(0, _p)

try:
    from env import MAX_ACTIONS as CURRENT_MAX_ACTIONS
    from env import HexGameEnv as CurrentHexGameEnv
    from env import classify_action as classify_current_action
    from env_v200 import MAX_ACTIONS as LEGACY_MAX_ACTIONS
    from env_v200 import HexGameEnv as LegacyHexGameEnv
    from env_v22 import HexGameEnv as V22HexGameEnv
    from env_v24 import HexGameEnv as V24HexGameEnv
    from env_v25 import HexGameEnv as V25HexGameEnv
    from env_v26 import HexGameEnv as V26HexGameEnv
    from env_v27 import HexGameEnv as V27HexGameEnv
except ImportError:  # 兼容 ``python -m rl.evaluation.evaluate_cross`` 等调用方式。
    from rl.envs.env import MAX_ACTIONS as CURRENT_MAX_ACTIONS
    from rl.envs.env import HexGameEnv as CurrentHexGameEnv
    from rl.envs.env import classify_action as classify_current_action
    from rl.envs.env_v200 import MAX_ACTIONS as LEGACY_MAX_ACTIONS
    from rl.envs.env_v200 import HexGameEnv as LegacyHexGameEnv
    from rl.envs.env_v22 import HexGameEnv as V22HexGameEnv
    from rl.envs.env_v24 import HexGameEnv as V24HexGameEnv
    from rl.envs.env_v25 import HexGameEnv as V25HexGameEnv
    from rl.envs.env_v26 import HexGameEnv as V26HexGameEnv
    from rl.envs.env_v27 import HexGameEnv as V27HexGameEnv

# 明细数据默认目录：rl/leaderboard/details/<批次>.jsonl，一局一行。
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_DEFAULT_DETAILS_DIR = _PROJECT_ROOT / "rl" / "leaderboard" / "details"
_SEATS = ("player_a", "player_b")


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--model-a", required=True, help="坐 player_a 座位的模型 zip 路径")
    parser.add_argument("--model-b", required=True, help="坐 player_b 座位的模型 zip 路径")
    parser.add_argument("--name-a", default=None, help="player_a 模型的显示名（默认取文件名）")
    parser.add_argument("--name-b", default=None, help="player_b 模型的显示名（默认取文件名）")
    parser.add_argument("--games", type=int, default=2, help="总对局数（--swap-sides 时按相同种子成对换座）")
    parser.add_argument("--map", dest="map_id", default="default", help="地图 id（默认 default；random 为每局一张对称随机地图）")
    parser.add_argument("--max-rounds", type=int, default=100, help="单局回合数上限，超过记为 draw")
    parser.add_argument("--max-actions", type=int, default=5000, help="单局动作数上限，超过记为 draw")
    parser.add_argument("--stochastic", action="store_true", help="按策略采样而非确定性取最优动作")
    parser.add_argument("--device", default="auto", help="torch 设备：auto / cuda / cpu")
    parser.add_argument("--swap-sides", action="store_true",
                        help="每局交换座位。注意 v2.0.0 编码固定 player_a 视角，交换后旧模型会失真")
    parser.add_argument("--stats-file", default=None,
                        help="每局结果追加到该 JSONL 文件，结束时输出与历史运行累计合并的统计（大样本验收用）")
    parser.add_argument("--details-dir", default=str(_DEFAULT_DETAILS_DIR),
                        help=f"每局明细（事件流回放/战略曲线/动作日志）写入目录，每批次一个 JSONL 文件（默认 {_DEFAULT_DETAILS_DIR}）")
    parser.add_argument("--no-details", action="store_true", help="不写每局明细文件")
    parser.add_argument("--policy-stats", action="store_true",
                        help="每步额外记录模型内部信号（价值估计/策略熵）；需对每个动作多做一次策略前向，跑批耗时约翻倍")
    parser.add_argument("--verbose", action="store_true", help="打印每个动作")
    parser.add_argument("--seed-prefix", default="cross", help="随机图评估种子前缀；配对换边局共享同一种子")
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
    """rl/training/local-worker.ts 的 JSON-lines 客户端（与 rl/training/local_env.py 相同协议）。"""

    def __init__(self):
        npx = shutil.which("npx.cmd") or shutil.which("npx")
        if not npx:
            raise RuntimeError("npx was not found; run npm install first")
        # 本文件位于 rl/evaluation/，项目根需上溯三级。
        root = Path(__file__).resolve().parent.parent.parent
        self.proc = subprocess.Popen(
            [npx, "tsx", "rl/training/local-worker.ts"],
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

    def __init__(self, label: str, model_path: str, side: str, device: str,
                 record_policy_stats: bool = False):
        self.label = label
        self.model_path = model_path
        self.side = side
        self.opponent = "player_b" if side == "player_a" else "player_a"
        self.record_policy_stats = record_policy_stats
        self.model = MaskablePPO.load(model_path, device=device)

        n_actions = int(getattr(self.model.action_space, "n", -1))
        self.n_actions = n_actions
        obs_dim = int(self.model.observation_space.shape[0]) if getattr(self.model.observation_space, "shape", ()) else 0
        if n_actions == LEGACY_MAX_ACTIONS:
            helper_cls, self.version = LegacyHexGameEnv, f"v2.0.0 ({n_actions} 动作)"
        elif n_actions == CURRENT_MAX_ACTIONS:
            helper_cls, self.version = CurrentHexGameEnv, f"v3.0 ({n_actions} 动作)"
        elif n_actions == 54:
            # 同为 54 动作但观测语义按版本分化：按观测维度选编码器，
            # 6205 维 → 冻结的 v2.7 快照；5974 维 → 冻结的 v2.6 兼容环境；
            # 6024 维 → v2.5 快照；3922 维 → v2.1/v2.2 快照。
            if obs_dim == 6205:
                helper_cls, self.version = V27HexGameEnv, f"v2.7/v2.8 ({n_actions} 动作)"
            elif obs_dim == 5974:
                helper_cls, self.version = V26HexGameEnv, f"v2.3-v2.4/v2.6 ({n_actions} 动作)"
            elif obs_dim == 6024:
                helper_cls, self.version = V25HexGameEnv, f"v2.5 ({n_actions} 动作)"
            elif obs_dim == 3922:
                helper_cls, self.version = V22HexGameEnv, f"v2.2 ({n_actions} 动作)"
            else:
                raise ValueError(f"{label}: 54 动作模型的观测维度 {obs_dim} 无法识别（支持 6205 / 6024 / 5974 / 3922）")
        else:
            raise ValueError(
                f"{label}: 动作空间 {n_actions} 无法识别（支持 "
                f"{LEGACY_MAX_ACTIONS}=v2.0.0、54=v2.1-v2.8 或 {CURRENT_MAX_ACTIONS}=v3.0+）"
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

    def act_with_info(self, state: dict[str, Any], stochastic: bool) -> tuple[str, dict[str, Any], dict[str, Any]]:
        """与 act 相同的决策，额外返回本步诊断信息（供明细动作日志使用）。"""
        actions = self.helper._legal_actions(state, self.side)
        if not any(action[0] for action in actions):
            return "end_turn", {}, {"forced": True, "legalActions": 0}
        observation = self.helper._encode_state(state)
        mask = np.asarray([bool(action[0]) for action in actions], dtype=bool)
        action_index, _ = self.model.predict(observation, deterministic=not stochastic, action_masks=mask)
        index = int(action_index)
        if index >= len(actions) or not actions[index][0]:
            return "end_turn", {}, {"forced": True, "legalActions": len(actions), "actionIndex": index}
        info: dict[str, Any] = {"forced": False, "legalActions": len(actions), "actionIndex": index}
        if self.n_actions == CURRENT_MAX_ACTIONS:
            # v3.0 专属：候选序号是 155 动作空间的新决策维度，记录其选用情况。
            intent, candidate = classify_current_action(index)
            info["intent"] = intent
            info["candidate"] = candidate
        if self.record_policy_stats:
            obs_tensor = self.model.policy.obs_to_tensor(np.asarray(observation)[None])[0]
            with torch.no_grad():
                value = self.model.policy.predict_values(obs_tensor)
                dist = self.model.policy.get_distribution(obs_tensor, action_masks=mask)
                info["value"] = float(value.detach().cpu().reshape(-1)[0])
                info["entropy"] = float(dist.entropy().detach().cpu().reshape(-1)[0])
        return actions[index][0], actions[index][1], info

    def act(self, state: dict[str, Any], stochastic: bool) -> tuple[str, dict[str, Any]]:
        action_type, payload, _ = self.act_with_info(state, stochastic)
        return action_type, payload

    @property
    def short(self) -> str:
        return f"{self.label}[{self.side}, {self.version}]"


def reset_command(args, game_index: int) -> dict[str, Any]:
    command: dict[str, Any] = {"cmd": "reset", "mapId": args.map_id}
    if args.map_id == "random":
        # 每局一张对称随机地图；种子由局序派生，同参数评估可复现。
        pair_index = (game_index + 1) // 2 if args.swap_sides else game_index
        command["random"] = {"seed": f"{args.seed_prefix}-{pair_index}", "symmetric": True}
    return command


class EventCollector:
    """按 seq 增量合并 worker 快照的事件尾巴，拼出完整事件流。

    worker 快照默认只携带最近 80 条事件（编码只需最近一回合），但事件带
    单调递增的 seq——每次响应里 seq 大于已见最大值的部分即为本步新增。
    逐步合并即可在零协议改动、近零开销下拿到全量回放。

    尾巴装不下单步全部新增事件时，窗口外的事件已永久丢失。引擎 seq 严格
    连续（src/engine/events.ts：events.length + 1），因此以 seq 断档检测
    窗口滑落：gaps 记录缺失区间，非空即 events 拼不出全量回放，调用方
    应在明细中标记 eventsIncomplete，而不是静默输出残缺数据。

    注意：worker 的 reset 不触发 game_start/round_start 事件（首条动作事件
    seq 即为 1），初始单位与 HQ 的归属从 reset 状态快照播种（seed_ownership）。
    """

    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []
        self._max_seq = 0
        self.gaps: list[tuple[int, int]] = []
        self.unit_owner: dict[str, str] = {}
        self.hq_owner: dict[str, str] = {}

    def seed_ownership(self, state: dict[str, Any]) -> None:
        for unit in state.get("units") or []:
            if unit.get("id"):
                self.unit_owner[unit["id"]] = unit.get("owner")
        for seat, hq in (state.get("headquarters") or {}).items():
            if isinstance(hq, dict) and hq.get("id"):
                self.hq_owner[hq["id"]] = seat

    def absorb(self, state: dict[str, Any]) -> None:
        new_events = sorted(
            (event for event in state.get("events") or []
             if isinstance(event.get("seq"), int) and event["seq"] > self._max_seq),
            key=lambda event: event["seq"],
        )
        if not new_events:
            return
        prev = self._max_seq
        for event in new_events:
            seq = event["seq"]
            if seq != prev + 1:
                self.gaps.append((prev + 1, seq - 1))
            self.events.append(event)
            prev = seq
        self._max_seq = prev


def _round_by_seq(events: list[dict[str, Any]]) -> dict[int, int]:
    """事件 seq → 回合号。

    标准模式的回合并无 round_start 事件，玩家切换时每步都会发 turn_end
    （roundNumber = 发出时的当前回合），是唯一可靠的回合推进标记；
    同时结算模式的 round_start（roundNumber = 新回合）优先采用。
    终局事件跟随最后一个 turn_end 归入结束时的回合，不会被多记一轮。
    """
    rounds: dict[int, int] = {}
    current = 1
    for event in events:
        seq = event.get("seq")
        if isinstance(seq, int):
            rounds[seq] = current
        event_type = event.get("type")
        round_number = (event.get("payload") or {}).get("roundNumber")
        if not isinstance(round_number, int) or round_number <= 0:
            continue
        if event_type == "round_start":
            current = round_number
        elif event_type == "turn_end":
            current = round_number
    return rounds


def _tally_add(tally: dict[str, int], key: Any, amount: int = 1) -> None:
    name = str(key if key is not None else "?")
    tally[name] = tally.get(name, 0) + amount


def _score_view(state: dict[str, Any], seat: str) -> dict[str, Any]:
    return (state.get("adjudication") or {}).get("scores", {}).get(seat) or {}


def _hq_status(state: dict[str, Any], seat: str) -> dict[str, Any]:
    hq = (state.get("headquarters") or {}).get(seat) or {}
    return {"hp": hq.get("hp"), "maxHp": hq.get("maxHp"), "alive": hq.get("alive")}


def _alive_units(state: dict[str, Any]) -> dict[str, dict[str, int]]:
    alive: dict[str, dict[str, int]] = {seat: {} for seat in _SEATS}
    for unit in state.get("units") or []:
        owner = unit.get("owner")
        if unit.get("alive") and owner in alive:
            _tally_add(alive[owner], unit.get("type"))
    return alive


def _owned_control_points(state: dict[str, Any]) -> dict[str, int]:
    counts: dict[str, int] = {seat: 0 for seat in _SEATS}
    for point in state.get("controlPoints") or []:
        if point.get("owner") in counts:
            counts[point["owner"]] += 1
    return counts


def _state_snapshot(state: dict[str, Any]) -> dict[str, Any]:
    """一帧战略快照：双方裁决分 7 分项、补给、HQ、控制点、存活单位构成。"""
    return {
        "round": (state.get("turn") or {}).get("roundNumber"),
        "scores": {seat: _score_view(state, seat) for seat in _SEATS},
        "supplies": {seat: ((state.get("resources") or {}).get(seat) or {}).get("supplies")
                     for seat in _SEATS},
        "headquarters": {seat: _hq_status(state, seat) for seat in _SEATS},
        "controlPoints": _owned_control_points(state),
        "aliveUnits": _alive_units(state),
    }


def _final_summary(state: dict[str, Any]) -> dict[str, Any]:
    """终局完整摘要：引擎结算结果 + 引擎记分板 + 阵亡元信息。"""
    players: dict[str, Any] = {}
    for seat in _SEATS:
        raw = (state.get("players") or {}).get(seat) or {}
        players[seat] = {
            "status": raw.get("status"),
            "eliminatedAt": raw.get("eliminatedAt"),
            "eliminatedBy": raw.get("eliminatedBy"),
            "stats": raw.get("stats") or {},
            "adjudicationScore": raw.get("adjudicationScore"),
        }
    snapshot = _state_snapshot(state)
    return {
        "winner": state.get("winner"),
        "roundNumber": snapshot["round"],
        "result": state.get("result"),
        "players": players,
        "scores": snapshot["scores"],
        "supplies": snapshot["supplies"],
        "headquarters": snapshot["headquarters"],
        "controlPoints": snapshot["controlPoints"],
        "aliveUnits": snapshot["aliveUnits"],
    }


def _empty_side_stats() -> dict[str, Any]:
    return {
        "deploysByType": {}, "deployCost": 0,
        "lossesByType": {}, "killsByType": {},
        "damageDealt": 0, "damageDealtToHq": 0, "damageTaken": 0,
        "incomeTotal": 0, "incomeControlTotal": 0,
        "captures": 0, "steals": 0, "firstCaptureRound": None,
        "comebackSupplies": 0,
    }


def _derive_event_stats(collector: EventCollector) -> dict[str, Any]:
    """从完整事件流聚合双方战术统计。

    unit_death 事件只带阵亡方归属不带击杀方，故 killsByType 取对手
    lossesByType（战斗击杀恒来自对手；炮击死亡不含在内，由 damageTaken 体现）。
    受击方归属靠 unitId/HQ id → 座位 的映射（reset 快照播种，deploy/game_start 补充）。
    """
    events = collector.events
    stats = {seat: _empty_side_stats() for seat in _SEATS}
    unit_owner = collector.unit_owner
    hq_owner = collector.hq_owner
    round_by_seq = _round_by_seq(events)
    for event in events:
        event_type = event.get("type")
        payload = event.get("payload") or {}
        if event_type == "game_start":
            # game_start 嵌入完整开局回放；worker 对局不会触发，仅作兼容兜底。
            for unit in payload.get("units") or []:
                if unit.get("id"):
                    unit_owner[unit["id"]] = unit.get("owner")
            for seat, hq in (payload.get("headquarters") or {}).items():
                if isinstance(hq, dict) and hq.get("id"):
                    hq_owner[hq["id"]] = seat
        elif event_type == "deploy":
            owner = payload.get("owner")
            if owner in stats:
                _tally_add(stats[owner]["deploysByType"], payload.get("unitType"))
                stats[owner]["deployCost"] += payload.get("cost") or 0
            if payload.get("unitId"):
                unit_owner[payload["unitId"]] = owner
        elif event_type == "attack":
            owner = payload.get("owner")
            actual = payload.get("actualDamage") or 0
            if owner in stats:
                stats[owner]["damageDealt"] += actual
                if payload.get("targetKind") == "headquarters":
                    stats[owner]["damageDealtToHq"] += actual
            target_id = payload.get("targetId")
            if payload.get("targetKind") == "headquarters":
                target_owner = hq_owner.get(target_id)
            else:
                target_owner = unit_owner.get(target_id)
            if target_owner in stats:
                stats[target_owner]["damageTaken"] += actual
        elif event_type == "artillery_damage":
            victim = payload.get("owner")
            if victim in stats:
                stats[victim]["damageTaken"] += payload.get("damage") or 0
        elif event_type == "unit_death":
            victim = payload.get("owner")
            if victim in stats:
                _tally_add(stats[victim]["lossesByType"], payload.get("type"))
            unit_owner.pop(payload.get("unitId"), None)
        elif event_type == "control_point_captured":
            owner = payload.get("owner")
            if owner in stats:
                stats[owner]["captures"] += 1
                previous = payload.get("previousOwner")
                if previous and previous != owner:
                    stats[owner]["steals"] += 1
                if stats[owner]["firstCaptureRound"] is None:
                    stats[owner]["firstCaptureRound"] = round_by_seq.get(event.get("seq"))
        elif event_type == "income":
            owner = payload.get("owner")
            if owner in stats:
                stats[owner]["incomeTotal"] += payload.get("amount") or 0
                stats[owner]["incomeControlTotal"] += payload.get("control") or 0
        elif event_type == "comeback_supply":
            owner = payload.get("owner")
            if owner in stats:
                stats[owner]["comebackSupplies"] += payload.get("amount") or 0
    other = {"player_a": "player_b", "player_b": "player_a"}
    for seat, seat_stats in stats.items():
        seat_stats["killsByType"] = dict(stats[other[seat]]["lossesByType"])
    return stats


class DetailWriter:
    """每批次一个明细 JSONL；每局结束立即落盘，跑批中断时已完成对局不丢。"""

    def __init__(self, details_dir: Path | None, batch_id: str):
        self.path = details_dir / f"{batch_id}.jsonl" if details_dir else None
        if self.path:
            self.path.parent.mkdir(parents=True, exist_ok=True)

    def append(self, record: dict[str, Any]) -> None:
        if not self.path:
            return
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    def display_path(self) -> str | None:
        """供 matches.jsonl 摘要引用：项目根内用相对路径，否则绝对路径（posix 风格）。"""
        if not self.path:
            return None
        resolved = self.path.resolve()
        try:
            return resolved.relative_to(_PROJECT_ROOT).as_posix()
        except ValueError:
            return resolved.as_posix()


def play_one_game(worker: EngineWorker, seat_map: dict[str, SideController], args,
                  game_index: int) -> tuple[str | None, int, int, dict[str, Any]]:
    """跑完一局，返回 (winner, acted, rounds, detail)；detail 为该局完整明细。"""
    started_at = time.perf_counter()
    command = reset_command(args, game_index)
    map_seed = (command.get("random") or {}).get("seed")
    collector = EventCollector()
    state = worker.call(command)
    collector.seed_ownership(state)
    collector.absorb(state)

    timeline_by_round: dict[int, dict[str, Any]] = {}
    action_log: list[dict[str, Any]] = []
    acted = 0
    rounds_timeout = False
    while acted < args.max_actions:
        if state.get("phase") == "game_over":
            break
        round_number = int(state.get("turn", {}).get("roundNumber", 1))
        if round_number > args.max_rounds:
            rounds_timeout = True
            break
        # 同一回合的快照互相覆盖，保留的是该回合最后一次动作后的状态。
        timeline_by_round[round_number] = _state_snapshot(state)
        side = state.get("turn", {}).get("currentPlayerId")
        controller = seat_map.get(side)
        if controller is None:
            raise RuntimeError(f"unknown current player: {side!r}")
        action_type, payload, info = controller.act_with_info(state, args.stochastic)
        if args.verbose:
            print(f"  r{round_number} {controller.short}: {action_type} {payload}")
        action_log.append({
            "seat": side,
            "round": round_number,
            "action": {"type": action_type, **payload},
            **info,
        })
        state = worker.apply(side, action_type, payload)
        collector.absorb(state)
        acted += 1
    timeline_by_round[int(state.get("turn", {}).get("roundNumber", 1))] = _state_snapshot(state)

    duration = time.perf_counter() - started_at
    if state.get("phase") == "game_over":
        result = state.get("result") or {}
        end_reason = result.get("reason") or "unknown"
    elif rounds_timeout:
        end_reason = "max_rounds_exceeded"
    else:
        end_reason = "max_actions_exceeded"

    if collector.gaps:
        # 单步新增超过快照尾巴（80 条）才会发生；derived 同样取自事件流，一并失真。
        missing = sum(end - start + 1 for start, end in collector.gaps)
        ranges = "、".join(f"{start}-{end}" if start != end else str(start)
                           for start, end in collector.gaps)
        print(f"  警告：事件流缺失 {missing} 条（seq {ranges}），该局明细 events/derived 不完整"
              f"（timeline/final 不受影响）")

    detail = {
        "schema": 1,
        "meta": {
            "gameIndex": game_index,
            "map": args.map_id,
            "mapSeed": map_seed,
            "models": {seat: {"name": controller.label, "version": controller.version,
                              "path": controller.model_path}
                       for seat, controller in seat_map.items()},
            "params": {
                "swapSides": bool(args.swap_sides),
                "stochastic": bool(args.stochastic),
                "maxRounds": args.max_rounds,
                "maxActions": args.max_actions,
                "device": args.device,
                "seedPrefix": args.seed_prefix,
                "policyStats": bool(args.policy_stats),
            },
            "durationSec": round(duration, 3),
            "eventsIncomplete": bool(collector.gaps),
            "eventGaps": collector.gaps,
        },
        "summary": {
            "winnerSeat": state.get("winner"),
            "endReason": end_reason,
            "rounds": int(state.get("turn", {}).get("roundNumber", 1)),
            "actions": {seat: sum(1 for entry in action_log if entry["seat"] == seat)
                        for seat in _SEATS},
        },
        "final": _final_summary(state),
        "derived": _derive_event_stats(collector),
        "timeline": [timeline_by_round[round_number] for round_number in sorted(timeline_by_round)],
        "actions": action_log,
        "events": collector.events,
    }
    return state.get("winner"), acted, detail["summary"]["rounds"], detail


def main():
    # Windows 控制台默认 GBK，统一改用 UTF-8 输出避免乱码。
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    args = parse_args()
    name_a = args.name_a or Path(args.model_a).name
    name_b = args.name_b or Path(args.model_b).name
    names = {"player_a": name_a, "player_b": name_b}

    details_dir = None if args.no_details else Path(args.details_dir)
    batch_id = f"{args.seed_prefix}-{time.strftime('%Y%m%d_%H%M%S')}-{os.getpid()}"
    writer = DetailWriter(details_dir, batch_id)
    detail_path = writer.display_path()
    if detail_path:
        print(f"明细输出：{detail_path}")

    workers = [EngineWorker()]
    try:
        controllers = {
            side: SideController(names[side], path, side, args.device,
                                 record_policy_stats=args.policy_stats)
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
                    "player_a": SideController(current["player_b"][0], current["player_b"][1], "player_a", args.device,
                                               record_policy_stats=args.policy_stats),
                    "player_b": SideController(current["player_a"][0], current["player_a"][1], "player_b", args.device,
                                               record_policy_stats=args.policy_stats),
                }
                names = {"player_a": current["player_b"][0], "player_b": current["player_a"][0]}
            for controller in controllers.values():
                controller.reset_for_game()

            print(f"— 第 {game_index}/{args.games} 局（{controllers['player_a'].short}"
                  f" vs {controllers['player_b'].short}）")
            winner, acted, rounds, detail = play_one_game(workers[0], controllers, args, game_index)
            seats = {seat: controller.label for seat, controller in controllers.items()}
            writer.append(detail)
            end_reason = detail["summary"]["endReason"]
            final_scores = {seat: (detail["final"]["scores"].get(seat) or {}).get("total")
                            for seat in _SEATS}
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
                "endReason": end_reason,
                "scores": final_scores,
                "actions": detail["summary"]["actions"],
                "durationSec": detail["meta"]["durationSec"],
                "seed": detail["meta"]["mapSeed"],
                "detailFile": detail_path,
            })
            print(f"  结果：{result}（{rounds} 回合 / {acted} 动作 / {end_reason}）")

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
