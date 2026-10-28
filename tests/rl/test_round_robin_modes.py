"""round_robin 地图模式推断：同时回合跑批与混模式拒绝（pytest）。

Run with:  rl/.venv/Scripts/python.exe -m pytest tests/rl -q
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

RL_DIR = Path(__file__).resolve().parents[2] / "rl"
sys.path.insert(0, str(RL_DIR / "evaluation"))

import round_robin  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


def test_load_map_modes_reads_map_files_and_defaults_random_to_standard():
    modes = round_robin.load_map_modes(ROOT)
    assert modes["random"] == "standard"
    assert modes["default"] == "standard"
    assert modes["artillery-zone"] == "annihilation"
    assert modes["standoff"] == "simultaneous"
    assert modes["molten-throne"] == "simultaneous"
    assert modes["snowflake"] == "royale"
    assert modes["narrow-road"] == "royale"


def test_supported_modes_cover_all_four_and_split_plan_modes():
    assert set(round_robin.SUPPORTED_EVAL_MODES) == {
        "standard", "simultaneous", "annihilation", "royale"}
    # 计划队列模式（入队 + 全员提交后统一结算）只有这两种。
    assert set(round_robin.PLAN_MODES) == {"simultaneous", "royale"}


def test_resolve_mode_infers_and_validates_requested_mode():
    assert round_robin.resolve_mode(ROOT, ["standoff", "molten-throne"], "auto") == "simultaneous"
    assert round_robin.resolve_mode(ROOT, ["standoff"], "simultaneous") == "simultaneous"
    assert round_robin.resolve_mode(ROOT, ["random", "default"], "auto") == "standard"
    assert round_robin.resolve_mode(ROOT, ["artillery-zone"], "auto") == "annihilation"
    assert round_robin.resolve_mode(ROOT, ["snowflake", "narrow-road"], "auto") == "royale"
    assert round_robin.resolve_mode(ROOT, ["snowflake"], "royale") == "royale"


def test_resolve_mode_rejects_mixed_and_mismatched_pools():
    with pytest.raises(ValueError, match="不能混合"):
        round_robin.resolve_mode(ROOT, ["random", "standoff"], "auto")
    with pytest.raises(ValueError, match="不能混合"):
        round_robin.resolve_mode(ROOT, ["artillery-zone", "snowflake"], "auto")
    with pytest.raises(ValueError, match="不一致"):
        round_robin.resolve_mode(ROOT, ["standoff"], "standard")
    with pytest.raises(ValueError, match="未知地图"):
        round_robin.resolve_mode(ROOT, ["nope"], "auto")
    with pytest.raises(ValueError, match="不能为空"):
        round_robin.resolve_mode(ROOT, [], "auto")
