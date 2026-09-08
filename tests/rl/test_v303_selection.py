"""v3.0.3 best 选择键拆分的不变量（pytest）。

Run with:  rl/.venv/Scripts/python.exe -m pytest tests/rl -q

背景（v3.0.2 的管线教训，见 rl/docs/RELEASE_NOTES.md）：训练期评估场景含分布外
静态图（default_champion）时，`min_wilson_lb` 选择键被 OOD 崩塌主导，系统性偏向
训练早期断点——v3.0.2 的训练期 best 挑中 10 万步断点（96 局验收仅 53:43），
而同次训练的 1.4M 断点累计 123:69。

锁死三件可能被静默破坏的事：
1. 分布外场景（map != 训练地图）**不参与**选择键，只在 TB/日志里记录；
2. 分布内场景（random_*）完整决定五元组选择键；
3. 旧版结果 JSON（场景无 map 字段）向后兼容：全部按分布内处理。
"""

from __future__ import annotations

import sys
from pathlib import Path

RL_DIR = Path(__file__).resolve().parents[2] / "rl"
for _sub in ("envs", "runners", "training", "evaluation"):
    sys.path.insert(0, str(RL_DIR / _sub))

from eval_worker import selection_score, wilson_lower_bound  # noqa: E402


def _scenario(min_lb: float, second_wins: int = 24, second_games: int = 48, *, map_id: str | None = "random") -> dict:
    scenario = {
        "wilson_lb": min_lb,
        "cp_mean": 1.8,
        "mean_reward": 10.0,
        "seat_first": {"wins": 30, "games": 48, "win_rate": 0.625, "wilson_lb": 0.48},
        "seat_second": {
            "wins": second_wins,
            "games": second_games,
            "win_rate": second_wins / second_games,
            "wilson_lb": wilson_lower_bound(second_wins, second_games),
        },
    }
    if map_id is not None:
        scenario["map"] = map_id
    return scenario


def test_ood_scenario_is_recorded_but_not_selected():
    """v3.0.2 教训的形式化：default OOD 崩塌（下界 0%）不能把 best 拖向弱断点。

    两份结果只有 default_champion 不同：random 场景完全相同 → 选择键必须完全相同。
    """
    with_ood = {"scenarios": {
        "random_rule": _scenario(0.46),
        "random_champion": _scenario(0.55),
        "default_champion": _scenario(0.0, map_id="default"),
    }}
    without_ood = {"scenarios": {
        "random_rule": _scenario(0.46),
        "random_champion": _scenario(0.55),
    }}
    assert selection_score(with_ood) == selection_score(without_ood)
    score = selection_score(with_ood)
    assert score[0] == 0.46, "OOD 场景的下界泄漏进了最弱场景键"
    assert score[2] == (0.46 + 0.55) / 2
    # 后手座合并下界也只统计分布内场景（2 × 24/48）。
    assert score[1] == wilson_lower_bound(48, 96)


def test_in_distribution_scenarios_fully_decide_the_key():
    """分布内最弱场景变化必须反映在选择键第一位上。"""
    weak = {"scenarios": {"random_rule": _scenario(0.30), "random_champion": _scenario(0.55)}}
    strong = {"scenarios": {"random_rule": _scenario(0.46), "random_champion": _scenario(0.55)}}
    assert selection_score(strong) > selection_score(weak)
    assert selection_score(weak)[0] == 0.30


def test_legacy_results_without_map_field_count_everything():
    """旧版 eval_worker 的结果 JSON 没有 map 字段：全部按分布内处理（向后兼容）。"""
    legacy = {"scenarios": {
        "random_rule": _scenario(0.46, map_id=None),
        "default_champion": _scenario(0.10, map_id=None),
    }}
    score = selection_score(legacy)
    assert score[0] == 0.10, "无 map 字段的场景应视为分布内参与选择"
    assert score[2] == (0.46 + 0.10) / 2


def test_all_ood_results_fall_back_to_all_scenarios():
    """极端情况：全部场景都是分布外（如静态图为主训）时退回旧行为，不能返回空哨兵。"""
    only_ood = {"scenarios": {"default_champion": _scenario(0.33, map_id="default")}}
    score = selection_score(only_ood)
    assert score[0] == 0.33
    assert score[1] == wilson_lower_bound(24, 48)


def test_train_map_parameter_switches_the_distribution():
    """训练地图本身是静态图（map_id=default）时，分布内外定义随参数切换。"""
    results = {"scenarios": {
        "random_rule": _scenario(0.20, map_id="default"),
        "random_champion": _scenario(0.55, map_id="default"),
        "default_champion": _scenario(0.40, map_id="random"),
    }}
    score = selection_score(results, train_map="default")
    assert score[0] == 0.20
    # 同一份结果按 random 视角看：default 场景反而是分布内。
    score_random_view = selection_score(results, train_map="random")
    assert score_random_view[0] == 0.40
