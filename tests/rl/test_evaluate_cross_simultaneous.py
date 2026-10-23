"""evaluate_cross 同时回合循环回归（pytest）。

Run with:  rl/.venv/Scripts/python.exe -m pytest tests/rl -q

覆盖 ``play_one_game`` 在 simultaneous 地图上的驱动路径：
- 计划动作被引擎拒绝时继续重选，不提前提交；
- 重试达到上限或行动点用尽后按已排队列兜底提交；
- 全员提交后统一结算并推进回合；
- 明细仍能拿到完整事件流（无 seq 缺口）。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

RL_DIR = Path(__file__).resolve().parents[2] / "rl"
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RL_DIR / "evaluation"))

import evaluate_cross  # noqa: E402


def make_args(**overrides) -> SimpleNamespace:
    """只保留 play_one_game / _play_simultaneous / _build_detail 用到的字段。"""
    base = dict(
        map_id="standoff",
        max_rounds=1,
        max_actions=200,
        stochastic=False,
        device="cpu",
        seed_prefix="test-sim",
        swap_sides=False,
        policy_stats=False,
        verbose=False,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


class ScriptedController:
    """按脚本返回动作的算法座位；legal 步骤向 random-sim 借一个合法计划动作。"""

    kind = "algorithm"

    def __init__(self, side: str, worker: evaluate_cross.EngineWorker, script: list[str]):
        self.side = side
        self.worker = worker
        self.label = f"scripted-{side}"
        self.spec = f"algo:{self.label}"
        self.algorithm = "random-sim"
        self.version = "算法 random-sim@v2"
        self.script = list(script)
        self._legal = evaluate_cross.AlgorithmController(
            self.label, "random-sim", "v2", side, worker)

    def reset_for_game(self) -> None:
        pass

    def act_with_info(self, state, stochastic):
        step = self.script.pop(0) if self.script else "end_turn"
        if step == "legal":
            return self._legal.act_with_info(state, stochastic)
        if step == "illegal":
            # 不存在的单位：引擎计划期即拒绝，局面不变。
            return "move", {"unitId": "missing-unit", "q": 0, "r": 0}, {"kind": "algorithm"}
        return "end_turn", {}, {"kind": "algorithm", "decision": "end_turn"}

    @property
    def short(self) -> str:
        return f"{self.label}[{self.side}]"


@pytest.fixture(scope="module")
def worker():
    engine = evaluate_cross.EngineWorker()
    try:
        yield engine
    finally:
        engine.close()


def play(worker, seat_map, args) -> dict:
    detail = evaluate_cross.play_one_game(worker, seat_map, args, 1)[3]
    assert detail["meta"]["eventsIncomplete"] is False
    assert detail["meta"]["eventGaps"] == []
    return detail


def seat_log(detail: dict, side: str) -> list[dict]:
    return [entry for entry in detail["actions"] if entry["seat"] == side]


def test_rejected_action_does_not_commit_and_round_advances(worker):
    seat_map = {
        "player_a": ScriptedController("player_a", worker, ["illegal", "legal", "end_turn"]),
        "player_b": ScriptedController("player_b", worker, ["end_turn"]),
    }
    detail = play(worker, seat_map, make_args())

    log = seat_log(detail, "player_a")
    assert log[0]["action"]["type"] == "move"
    assert log[0]["failed"] is True, "被拒绝的动作必须记录失败"
    assert not log[1].get("failed"), "拒绝后应继续重选合法动作，而不是直接提交"
    assert log[1]["action"]["type"] != "end_turn"
    assert log[-1]["action"]["type"] == "end_turn"
    assert log[-1].get("commit") is True

    # 双方提交后触发统一结算：roundNumber 推进到 2，随后按 max_rounds 收尾。
    assert detail["summary"]["rounds"] == 2
    assert detail["summary"]["endReason"] == "max_rounds_exceeded"
    resolved = [event for event in detail["events"] if event["type"] == "round_resolved"]
    assert [event["payload"]["roundNumber"] for event in resolved] == [1]


def test_fallback_commit_after_rejection_cap(worker):
    seat_map = {
        "player_a": ScriptedController("player_a", worker, ["illegal"] * 30),
        "player_b": ScriptedController("player_b", worker, ["end_turn"]),
    }
    detail = play(worker, seat_map, make_args())

    log = seat_log(detail, "player_a")
    assert 1 < len(log) <= 20, "应在重试若干次后受上限约束，而不是一次失败就提交"
    assert all(entry.get("failed") for entry in log), "兜底提交前不应出现合法入队"
    assert not any(entry.get("commit") for entry in log), "兜底提交不写入动作日志"

    # 兜底提交与对手提交仍能触发结算。
    assert detail["summary"]["rounds"] == 2
    assert detail["summary"]["endReason"] == "max_rounds_exceeded"
    resolved = [event for event in detail["events"] if event["type"] == "round_resolved"]
    assert [event["payload"]["roundNumber"] for event in resolved] == [1]


def test_full_queue_rejection_falls_back_immediately(worker):
    """行动点用尽后仍尝试排队：一次拒绝即转兜底提交，不在重选上限内空转。"""
    budget = int(json.loads(
        (ROOT / "maps" / "standoff.json").read_text(encoding="utf-8"))["balance"]["actionsPerTurn"])
    seat_map = {
        "player_a": ScriptedController("player_a", worker, ["legal"] * budget + ["illegal"] * 30),
        "player_b": ScriptedController("player_b", worker, ["end_turn"]),
    }
    detail = play(worker, seat_map, make_args())

    log = seat_log(detail, "player_a")
    queued_ok = [entry for entry in log if not entry.get("failed")]
    failed = [entry for entry in log if entry.get("failed")]
    assert len(queued_ok) == budget, "budget 个合法动作应全部入队"
    assert len(failed) == 1, "队列已满后的排队尝试应一次拒绝即转兜底提交，而非重试到上限"
    assert not any(entry.get("commit") for entry in log), "兜底提交不写入动作日志"
    assert detail["summary"]["rounds"] == 2
    resolved = [event for event in detail["events"] if event["type"] == "round_resolved"]
    assert [event["payload"]["roundNumber"] for event in resolved] == [1]


def test_random_sim_selfplay_resolves_two_rounds(worker):
    seat_map = {
        side: evaluate_cross.AlgorithmController("random-sim", "random-sim", "v2", side, worker)
        for side in ("player_a", "player_b")
    }
    detail = play(worker, seat_map, make_args(max_rounds=2))

    # 两轮均完成「入队 → 全员提交 → 统一结算」，第三轮在预算检查处收尾。
    assert detail["summary"]["rounds"] == 3
    assert detail["summary"]["endReason"] == "max_rounds_exceeded"
    resolved = [event["payload"]["roundNumber"]
                for event in detail["events"] if event["type"] == "round_resolved"]
    assert resolved == [1, 2]

    for side in ("player_a", "player_b"):
        commits = [entry for entry in seat_log(detail, side) if entry.get("commit")]
        assert len(commits) == 2, "每个座位每轮应提交一次计划"
