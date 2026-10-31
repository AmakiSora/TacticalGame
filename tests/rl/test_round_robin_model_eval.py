"""round_robin 的模型评估开关：声明 ``modelEval: false`` 的图只跑算法对算法（pytest）。

背景见 rl/docs/RELEASE_NOTES.md 2026-10-31：whirlpool 的无回合上限 + 港口出兵 + 旋臂隔墙
让当前模型打不出胜负，304 个含模型的批次全是 101 回合平局。这里锁住组批阶段的跳过行为。

Run with:  rl/.venv/Scripts/python.exe -m pytest tests/rl -q
"""

from __future__ import annotations

import sys
from pathlib import Path

RL_DIR = Path(__file__).resolve().parents[2] / "rl"
sys.path.insert(0, str(RL_DIR / "evaluation"))

import round_robin  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]

MODEL = ("rl/models/hex_ppo_v3.3.0_20260923_11.4M.zip", "hex_ppo_v3.3.0_20260923_11.4M.zip")
GREEDY = ("algo:greedy@v1", "algo_greedy@v1")
RANDOM = ("algo:random@v1", "algo_random@v1")
THREAT = ("algo:threat@v1", "algo_threat@v1")


def test_whirlpool_declares_model_eval_disabled():
    policy = round_robin.load_model_eval_policy(ROOT, ["whirlpool", "default", "random"])
    assert list(policy) == ["whirlpool"], "只有声明 modelEval:false 的静态图才拦模型批次"
    assert policy["whirlpool"], "跳过原因不能为空"


def test_plan_tasks_skips_model_batches_on_disabled_map():
    ordered = sorted([GREEDY, RANDOM, MODEL], key=lambda part: part[1])
    tasks, skipped_games, model_skipped = round_robin.plan_tasks(
        ordered, ["whirlpool", "default"], "salt", {}, 2, {"whirlpool": "打不出结果"})

    assert skipped_games == 0
    # whirlpool：模型 × 算法 2 批被跳过；算法对 1 批保留。
    assert model_skipped == {"whirlpool": 2}
    whirlpool = [task for task in tasks if task["map"] == "whirlpool"]
    assert len(whirlpool) == 1
    assert is_algo_pair(whirlpool[0])  # 保留的必须是纯算法对
    # default 未声明，3 对全部照跑。
    assert len([task for task in tasks if task["map"] == "default"]) == 3
    assert all(task["seed_prefix"].startswith("rr-salt-") for task in tasks)


def is_algo_pair(task: dict) -> bool:
    return task["spec_a"].startswith("algo:") and task["spec_b"].startswith("algo:")


def test_plan_tasks_keeps_model_batches_on_enabled_maps():
    ordered = sorted([GREEDY, MODEL], key=lambda part: part[1])
    tasks, _, model_skipped = round_robin.plan_tasks(
        ordered, ["default"], "salt", {}, 2, {})

    assert model_skipped == {}
    assert len(tasks) == 1
    assert "hex_ppo" in tasks[0]["spec_a"] + tasks[0]["spec_b"]


def test_completed_pairs_count_as_skipped_games_not_model_skips():
    ordered = sorted([GREEDY, RANDOM, MODEL], key=lambda part: part[1])
    counts = {("whirlpool", "algo_greedy@v1", "algo_random@v1"): 2}
    tasks, skipped_games, model_skipped = round_robin.plan_tasks(
        ordered, ["whirlpool"], "salt", counts, 2, {"whirlpool": "打不出结果"})

    assert tasks == []
    assert skipped_games == 2
    assert model_skipped == {"whirlpool": 2}


def test_describe_model_skips_mentions_map_and_reason():
    text = round_robin.describe_model_skips({"whirlpool": 2}, {"whirlpool": "打不出结果"})
    assert text == "whirlpool（打不出结果）"


def test_only_algo_pairs_run_when_all_maps_disabled():
    ordered = sorted([GREEDY, RANDOM, THREAT, MODEL], key=lambda part: part[1])
    tasks, _, model_skipped = round_robin.plan_tasks(
        ordered, ["whirlpool"], "salt", {}, 2, {"whirlpool": "打不出结果"})

    assert model_skipped == {"whirlpool": 3}, "1 个模型 × 3 个算法"
    assert len(tasks) == 3, "3 个算法之间的 C(3,2) 对"
    assert all(is_algo_pair(task) for task in tasks)


def test_apply_model_filter_none_means_no_models():
    """控制台只勾算法时传 --models none；缺省才是全部模型。"""
    models = [Path("hex_ppo_v3.3.0_x.zip"), Path("hex_ppo_v2.7.0_y.zip")]

    assert round_robin.apply_model_filter(models, [], None) == (models, [])
    assert round_robin.apply_model_filter(models, [], "none") == ([], [])
    assert round_robin.apply_model_filter(models, [], "off") == ([], [])
    assert round_robin.apply_model_filter(models, [], " v3.3.0 ") == ([models[0]], [])
