"""evaluate_cross 虚拟随机图：按地图 id 给 reset 带上玩法模式（pytest）。

Run with:  rl/.venv/Scripts/python.exe -m pytest tests/rl -q

一张随机图只能属于一种规则，所以四种模式各有一个虚拟地图 id：
``random``（standard，历史口径）/ ``random-annihilation`` / ``random-simultaneous`` /
``random-royale``。本文件锁定两件事：

1. reset 命令只对随机图 id 附加 ``random`` 选项，标准模式不带 ``mode``（同盐同图可复现），
   非标准模式必须带 ``mode``，大逃杀另带 ``noTurnLimit``（静态大逃杀图都没有回合上限）；
2. worker 按该命令生成的配置确实是命名模式（含歼灭/大逃杀的炮火块）。
"""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

RL_DIR = Path(__file__).resolve().parents[2] / "rl"
sys.path.insert(0, str(RL_DIR / "evaluation"))

import evaluate_cross  # noqa: E402
import round_robin  # noqa: E402


def make_args(**overrides) -> SimpleNamespace:
    """只保留 reset_command 用到的字段。"""
    base = dict(map_id="random", seed_prefix="rr-random", swap_sides=False)
    base.update(overrides)
    return SimpleNamespace(**base)


def test_random_map_ids_cover_all_four_modes():
    assert evaluate_cross.RANDOM_MAP_MODES == {
        "standard": "random",
        "annihilation": "random-annihilation",
        "simultaneous": "random-simultaneous",
        "royale": "random-royale",
    }


def test_tables_match_the_orchestrator_exactly():
    """两份 Python 副表必须同方向同内容。

    只更新 round_robin 漏掉这里时，批次仍能从 id 解析出模式、照常开跑，但 reset
    命令不带 ``random``（更没有种子）：worker 用未播种随机源生成图，``mapSeed`` 为
    null，评估不可复现且没有任何报错。这条断言把静默降级变成红灯。
    """
    assert evaluate_cross.RANDOM_MAP_MODES == round_robin.RANDOM_MAP_MODES
    for map_id, mode in [(id_, mode) for mode, id_ in round_robin.RANDOM_MAP_MODES.items()]:
        assert evaluate_cross.random_mode_for_map(map_id) == mode
    assert evaluate_cross.random_mode_for_map("default") is None


def test_standard_random_command_stays_mode_free():
    """标准模式不写 mode：与历史随机图评估的命令逐字一致（同盐同图可复现）。"""
    command = evaluate_cross.reset_command(make_args(), 1)
    assert command == {
        "cmd": "reset",
        "mapId": "random",
        "random": {"seed": "rr-random-1", "symmetric": True},
    }


@pytest.mark.parametrize("map_id, mode", [
    ("random-annihilation", "annihilation"),
    ("random-simultaneous", "simultaneous"),
])
def test_mode_specific_random_command_carries_mode(map_id, mode):
    command = evaluate_cross.reset_command(make_args(map_id=map_id), 2)
    assert command["mapId"] == map_id
    assert command["random"] == {
        "seed": "rr-random-2", "symmetric": True, "mode": mode,
    }


def test_royale_random_command_also_drops_the_turn_limit():
    command = evaluate_cross.reset_command(make_args(map_id="random-royale"), 2)
    assert command["random"] == {
        "seed": "rr-random-2", "symmetric": True, "mode": "royale", "noTurnLimit": True,
    }


def test_static_maps_send_no_random_options():
    for map_id in ("default", "artillery-zone", "standoff", "snowflake"):
        assert evaluate_cross.reset_command(make_args(map_id=map_id), 1) == {
            "cmd": "reset", "mapId": map_id,
        }


def test_swapped_pairs_share_one_seed_per_pair():
    """--swap-sides 的相邻两局必须同图（种子只随「对」变化）。"""
    args = make_args(swap_sides=True)
    seeds = [evaluate_cross.reset_command(args, index)["random"]["seed"] for index in range(1, 5)]
    assert seeds[0] == seeds[1] != seeds[2]
    assert seeds[2] == seeds[3]


@pytest.fixture(scope="module")
def worker():
    engine = evaluate_cross.EngineWorker()
    try:
        yield engine
    finally:
        engine.close()


@pytest.mark.parametrize("map_id, mode", [
    (map_id, mode) for mode, map_id in evaluate_cross.RANDOM_MAP_MODES.items()
])
def test_worker_generates_the_named_mode(worker, map_id, mode):
    """worker 的 reset 必须按 id 生成对应模式的配置，而不是一律标准图。"""
    args = make_args(map_id=map_id)
    state = worker.call(evaluate_cross.reset_command(args, 1))

    assert state["mapId"] == map_id
    assert (state["config"] or {}).get("mode") == mode
    assert state["phase"] == "active"
    assert len(state["config"]["spawnSlots"]) == 2
    if mode in ("annihilation", "royale"):
        assert state["config"].get("annihilation", {}).get("artillery")
        assert not state.get("headquarters")
    else:
        assert len(state["headquarters"]) == 2


def test_worker_royale_random_map_has_no_turn_limit(worker):
    args = make_args(map_id="random-royale")
    state = worker.call(evaluate_cross.reset_command(args, 1))
    assert state["config"]["balance"]["maxTurns"] is None
