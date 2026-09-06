"""evaluate_cross.EventCollector 的 seq 增量合并与空洞检测不变量（pytest）。

Run with:  rl/.venv/Scripts/python.exe -m pytest tests/rl -q

明细数据把 events 定位为 ground truth，但 worker 快照只带最近 80 条事件尾巴：
单步新增超过尾巴容量时，窗口外的事件已永久丢失。合并逻辑依赖"引擎 seq 严格
连续（src/engine/events.ts：seq = events.length + 1）"这一事实，因此 seq 断档
等价于真实丢事件，必须记入 gaps 并在明细 meta 标记 eventsIncomplete，
而不是静默拼出残缺回放。
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

RL_DIR = Path(__file__).resolve().parents[2] / "rl"
# rl/ 已重组为 envs/runners/training/evaluation 子目录；逐个挂上 sys.path，
# 以保持既有的扁平模块名（如 ``import env``）可用。
for _sub in ("envs", "runners", "training", "evaluation"):
    sys.path.insert(0, str(RL_DIR / _sub))

import evaluate_cross  # noqa: E402


def _state(*seqs: int) -> dict:
    return {"events": [{"seq": seq, "type": "attack", "payload": {}} for seq in seqs]}


def test_absorb_merges_overlapping_tails_without_duplicates():
    collector = evaluate_cross.EventCollector()
    collector.absorb(_state(1, 2, 3))
    collector.absorb(_state(2, 3, 4, 5))
    assert [event["seq"] for event in collector.events] == [1, 2, 3, 4, 5]
    assert collector.gaps == []


def test_absorb_ignores_events_without_integer_seq():
    collector = evaluate_cross.EventCollector()
    collector.absorb({"events": [{"type": "attack"}, {"seq": "1"}, {"seq": 1}]})
    assert [event["seq"] for event in collector.events] == [1]
    assert collector.gaps == []


def test_absorb_records_gap_when_window_slides_past_events():
    collector = evaluate_cross.EventCollector()
    collector.absorb(_state(1, 2))
    # 单步新增超过尾巴容量：seq 3..49 被窗口滑落，永久丢失。
    collector.absorb(_state(50, 51, 52))
    assert [event["seq"] for event in collector.events] == [1, 2, 50, 51, 52]
    assert collector.gaps == [(3, 49)]
    assert collector._max_seq == 52


def test_absorb_records_multiple_gaps_and_keeps_counting():
    collector = evaluate_cross.EventCollector()
    collector.absorb(_state(1, 2))
    collector.absorb(_state(10, 11))
    collector.absorb(_state(20, 21))
    assert collector.gaps == [(3, 9), (12, 19)]
    assert collector._max_seq == 21


def test_absorb_sorts_out_of_order_window():
    # 快照尾巴理应有序，但合并逻辑不依赖输入顺序：乱序到达也能正确去重与检测。
    collector = evaluate_cross.EventCollector()
    collector.absorb(_state(3, 1, 2))
    assert [event["seq"] for event in collector.events] == [1, 2, 3]
    assert collector.gaps == []


@pytest.mark.parametrize("bad", [{}, {"events": None}, {"events": []}])
def test_absorb_tolerates_malformed_state(bad):
    collector = evaluate_cross.EventCollector()
    collector.absorb(bad)
    assert collector.events == []
    assert collector.gaps == []
