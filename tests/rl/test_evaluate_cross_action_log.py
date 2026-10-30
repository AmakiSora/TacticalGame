"""evaluate_cross 动作日志契约回归（pytest）。

Run with:  rl/.venv/Scripts/python.exe -m pytest tests/rl -q

`script/generateArenaStats.mjs` 的玩法明细从本地 detail（gitignored）按需派生，
其中动作画像依赖一条约定：逐人模式下引擎拒绝算法动作后，runner 追加的补偿
`end_turn` 必须带 `fallback: True`，派生端才能把它排除在「控制器决策次数」之外、
只计入 rejected。这里用真引擎把该约定钉住（口径见 deriveDetailStats 的实现说明）。
"""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

RL_DIR = Path(__file__).resolve().parents[2] / "rl"
sys.path.insert(0, str(RL_DIR / "evaluation"))

import evaluate_cross  # noqa: E402


class RejectOnceController:
    """第一次决策返回非法动作（模拟引擎拒绝），之后一直 end_turn。"""

    kind = "algorithm"

    def __init__(self) -> None:
        self.label = "reject-once"
        self.version = None
        self.algorithm = "reject-once"
        self.script = ["illegal"]

    def reset_for_game(self) -> None:
        pass

    def act_with_info(self, state, stochastic):
        if self.script:
            self.script.pop()
            # 不存在的单位：引擎拒绝，局面不变
            return "move", {"unitId": "missing-unit", "q": 0, "r": 0}, {"kind": "algorithm"}
        return "end_turn", {}, {"kind": "algorithm"}

    @property
    def short(self) -> str:
        return "reject-once"


@pytest.fixture(scope="module")
def worker():
    engine = evaluate_cross.EngineWorker()
    try:
        yield engine
    finally:
        engine.close()


def test_sequential_fallback_end_turn_marked_for_derivation(worker) -> None:
    args = SimpleNamespace(
        map_id="default", max_rounds=1, max_actions=50, stochastic=False,
        device="cpu", seed_prefix="test-fallback", swap_sides=False,
        policy_stats=False, verbose=False,
    )
    seat_map = {"player_a": RejectOnceController(), "player_b": RejectOnceController()}
    detail = evaluate_cross.play_one_game(worker, seat_map, args, 1)[3]

    log = [item for item in detail["actions"] if item["seat"] == "player_a"]
    # 尝试动作先记一条（不带 fallback），被拒后追加的补偿动作带 fallback 标记。
    assert log[0]["action"]["type"] == "move"
    assert "fallback" not in log[0]
    assert log[1]["action"]["type"] == "end_turn"
    assert log[1]["fallback"] is True
    assert log[1]["failed"] is True
    assert log[1]["error"]


def test_normal_game_has_no_fallback_entries(worker) -> None:
    """无拒绝的普通对局不产生 fallback 条目，派生端不会误扣动作次数。"""
    seat_map = {
        side: evaluate_cross.AlgorithmController("random-annihilation", "random-annihilation", "v1", side, worker)
        for side in ("player_a", "player_b")
    }
    args = SimpleNamespace(
        map_id="artillery-zone", max_rounds=2, max_actions=200, stochastic=False,
        device="cpu", seed_prefix="test-fallback-none", swap_sides=False,
        policy_stats=False, verbose=False,
    )
    detail = evaluate_cross.play_one_game(worker, seat_map, args, 1)[3]

    assert [item for item in detail["actions"] if item.get("fallback")] == []
    assert [item for item in detail["actions"] if item.get("failed")] == []
