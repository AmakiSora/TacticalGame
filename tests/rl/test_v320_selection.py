"""v3.2.0 评估场景与 best 选择键分离（A6）的不变量（pytest）。

Run with:  rl/.venv/Scripts/python.exe -m pytest tests/rl -q

背景（见 rl/docs/plans/v3.2.0.md）：v3.2.0 要在评估里加跑 threat/greedy/field 三个
**内置算法**对手场景，但初期**不进 best 选择键**。理由与 v3.0.2 的 OOD 教训同源——
算法场景在训练早期必然低胜率，若进 `min_wilson_lb`，best 会系统性偏向"对模型强但对
算法弱"的早期断点（v3.0.2 的 best 因此挑中了 10 万步断点）。

这里锁四件事：
1. 算法场景**只记录**，不影响选择键（相同分布内场景 → 相同五元组）；
2. ``in_selection`` 缺省为 True，旧结果 JSON 向后兼容，v3.0.3 的三条语义不变；
3. 场景元数据（``_`` 前缀）**不能**透传给环境构造器，且键名与构造器参数必须对得上；
4. 算法场景用「算法分支 + 概率 1.0」表达，而不是 ``opponent_style="algorithm"``
   ——后者会被 ``HexGameEnv.__init__`` 的规则风格校验直接拒掉。
"""

from __future__ import annotations

import inspect
import sys
from pathlib import Path

RL_DIR = Path(__file__).resolve().parents[2] / "rl"
for _sub in ("envs", "runners", "training", "evaluation"):
    sys.path.insert(0, str(RL_DIR / _sub))

import local_env  # noqa: E402
from eval_worker import ALGO_EVAL_NAMES, build_scenarios, selection_score, split_scenario, wilson_lower_bound  # noqa: E402


def _scenario(min_lb: float, second_wins: int = 24, second_games: int = 48, *, map_id: str | None = "random", in_selection: bool | None = None) -> dict:
    scenario = {
        "wilson_lb": min_lb,
        "cp_mean": 1.8,
        "mean_reward": 10.0,
        "hq_damage_mean": 40.0,
        "scout_deploy_share": 0.12,
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
    if in_selection is not None:
        scenario["in_selection"] = in_selection
    return scenario


# --------------------------------------------------------------------------- 选择键


def test_algo_scenarios_are_recorded_but_do_not_move_the_key():
    """算法场景（in_selection=False）即使下界为 0，也不能改变选择键。"""
    without_algo = {"scenarios": {
        "random_rule": _scenario(0.46),
        "random_champion": _scenario(0.55),
    }}
    with_algo = {"scenarios": {
        "random_rule": _scenario(0.46),
        "random_champion": _scenario(0.55),
        "random_algo_threat": _scenario(0.0, in_selection=False),
        "random_algo_greedy": _scenario(0.05, in_selection=False),
        "random_algo_field": _scenario(0.02, in_selection=False),
    }}
    assert selection_score(with_algo) == selection_score(without_algo)
    score = selection_score(with_algo)
    assert score[0] == 0.46, "算法场景的下界泄漏进了最弱场景键"
    assert score[2] == (0.46 + 0.55) / 2
    # 后手座合并也只统计参与选择的场景。
    assert score[1] == wilson_lower_bound(48, 96)


def test_missing_in_selection_defaults_to_true():
    """旧结果 JSON 无 in_selection 字段 → 视为参与选择（与 map 字段的兼容处理同构）。"""
    legacy = {"scenarios": {
        "random_rule": _scenario(0.46),
        "random_champion": _scenario(0.55),
    }}
    score = selection_score(legacy)
    assert score[0] == 0.46
    assert score[2] == (0.46 + 0.55) / 2


def test_excluded_scenarios_alone_still_yield_usable_key():
    """全部场景都被排除（例如只开了算法场景的调参跑法）时不能返回空哨兵。

    返回哨兵会让 `score > best_score` 永远为假，best_model 永远不被保存。
    """
    only_algo = {"scenarios": {"random_algo_threat": _scenario(0.0, in_selection=False)}}
    score = selection_score(only_algo)
    assert score[0] == 0.0
    assert score != (-1.0, -1.0, -1.0, -float("inf"), -float("inf"))


def test_ood_and_algo_exclusions_compose():
    """OOD（map 不符）与算法场景（in_selection=False）是两条独立规则，可同时生效。"""
    results = {"scenarios": {
        "random_rule": _scenario(0.46),
        "default_champion": _scenario(0.0, map_id="default"),
        "random_algo_threat": _scenario(0.0, in_selection=False),
    }}
    score = selection_score(results)
    assert score[0] == 0.46
    assert score[2] == 0.46


# --------------------------------------------------------------------------- 场景构造


def test_algo_scenarios_are_gated_by_the_flag():
    """默认不加算法场景；开了之后恰好是 threat/greedy/field 三个，mcts 不进池。"""
    off = build_scenarios("random", "mixed", "champion.zip")
    assert not any("algo" in name for name in off)

    on = build_scenarios("random", "mixed", "champion.zip", algo_scenarios=True)
    assert {name for name in on if "algo" in name} == {f"random_algo_{a}" for a in ALGO_EVAL_NAMES}
    assert "mcts" not in " ".join(on), "mcts 是算法里最弱的一个（对最新模型 48-59%），不应进评估池"


def test_algo_scenario_marks_itself_as_recorded_only():
    """算法场景必须带 _selection=False 与更小的局数；未标注的场景默认参与选择。"""
    scenarios = build_scenarios("random", "mixed", "champion.zip", algo_scenarios=True)
    algo = scenarios["random_algo_threat"]
    assert algo["_selection"] is False
    assert algo["_episodes"] == 48
    assert algo["algorithm_opponent_probability"] == 1.0
    assert algo["algorithm_epsilon"] == 0.0, "评估要量算法真身，不做确定性扰动"
    assert "_selection" not in scenarios["random_rule"]
    assert scenarios["random_rule"]["map_id"] == "random"


def test_algorithm_scenario_uses_the_flag_not_a_style_name():
    """算法对手由 algorithm_opponent_probability=1.0 表达。

    `opponent_style` 只接受 mixed/aggressive/defensive/economy，写成 "algorithm"
    会在 `HexGameEnv.__init__` 直接 ValueError —— 场景字典必须是能构造出环境的。
    """
    scenarios = build_scenarios("random", "mixed", "", algo_scenarios=True)
    for name, kwargs in scenarios.items():
        assert kwargs["opponent_style"] in {"mixed", "aggressive", "defensive", "economy"}, name


def test_scenario_kwargs_match_the_env_constructor():
    """所有场景键都必须是 LocalHexGameEnv 的真实构造参数（元数据一律 _ 前缀）。

    键名写错时不会在构造时报错而是 TypeError，且只有跑到评估才炸；这里提前拦住。
    """
    parameters = set(inspect.signature(local_env.LocalHexGameEnv.__init__).parameters)
    scenarios = build_scenarios("random", "mixed", "champion.zip", algo_scenarios=True)
    for name, kwargs in scenarios.items():
        env_kwargs, in_selection, episodes = split_scenario(kwargs, 96)
        unknown = set(env_kwargs) - parameters
        assert not unknown, f"{name} 含未知构造参数 {unknown}"
        assert not any(key.startswith("_") for key in env_kwargs)
        assert isinstance(in_selection, bool)
        assert episodes >= 2


def test_split_scenario_honours_overrides_and_defaults():
    """_episodes 覆盖全局局数；缺省时沿用全局值，旧场景语义不变。"""
    env_kwargs, in_selection, episodes = split_scenario(
        {"map_id": "random", "opponent_style": "mixed", "_selection": False, "_episodes": 48}, 96
    )
    assert env_kwargs == {"map_id": "random", "opponent_style": "mixed"}
    assert in_selection is False
    assert episodes == 48

    _, in_selection_default, episodes_default = split_scenario({"map_id": "random"}, 96)
    assert in_selection_default is True
    assert episodes_default == 96


def test_algo_scenarios_stay_on_the_training_map():
    """算法场景用训练地图：它们要被当作分布内读数来跟踪，只是暂不进选择键。"""
    for name, kwargs in build_scenarios("random", "mixed", "", algo_scenarios=True).items():
        if "algo" in name:
            assert kwargs["map_id"] == "random"
