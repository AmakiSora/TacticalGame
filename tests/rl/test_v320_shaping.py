"""v3.2.0 奖励塑形改动（A4 HQ 项 / A5 兵种 novelty）的不变量（pytest）。

Run with:  rl/.venv/Scripts/python.exe -m pytest tests/rl -q

背景（见 rl/docs/plans/v3.2.0.md）：竞技场 11424 局算法对模型对局里，算法胜率 83.5%，
而模型赢下的局 HQ 伤害 85.7、输掉的局只有 6.7（算法平均 134.5）；兵种构成上模型 85%
只出步兵、0% 支援（算法 36% 步兵 + 44% 侦察兵 + 11% 支援）。A4/A5 就是针对这两点，
但奖励是最容易"改了没生效"或"改了反而教坏策略"的地方，所以这里锁四件事：

1. HQ 伤害项与推进势能的**符号与量级**；
2. 推进势能只在**己方单位名册不变**时计分——否则"单位阵亡/新增"会让最近距离跳变，
   被当成撤退或推进来打分，形成错误梯度甚至"送死→重部署"的刷分路径；
3. novelty 每兵种每局**只触发一次**（有界，上限 5 × 权重）；
4. 三项权重全为 0 时，奖励与 v3.x **逐位相同**（可安全回退）。

奖励项的读取口径（默认值即代码内常量）见 env.py 的 DEFAULT_REWARD_* 与
``env_reward_float``；``_deployed_types`` 有两处 reset（env.py 与 local_env.py），
漏清一处就会跨局累积，因此额外用 inspect 断言两处都清了。
"""

from __future__ import annotations

import inspect
import sys
from pathlib import Path

import pytest

RL_DIR = Path(__file__).resolve().parents[2] / "rl"
for _sub in ("envs", "runners", "training", "evaluation"):
    sys.path.insert(0, str(RL_DIR / _sub))

from env import (  # noqa: E402
    DEFAULT_REWARD_HQ_DAMAGE,
    DEFAULT_REWARD_HQ_PUSH,
    DEFAULT_REWARD_NEW_UNIT_TYPE,
    HexGameEnv,
)
from local_env import LocalHexGameEnv  # noqa: E402


def _snap(**overrides: float) -> dict[str, float]:
    """一份完整的战略快照，字段与 _strategic_snapshot 的输出同构。

    单测直接构造快照（而不是喂 state 走 _strategic_snapshot）是为了隔离各项：
    state 里敌 HQ 血量同时喂给 enemy_hp 与 enemy_hq_hp，直接构造才能确认
    新项各自的增减量，而不是两项混在一起。
    """
    base: dict[str, float] = {
        "control_points": 2.0,
        "own_units": 3.0,
        "enemy_hp": 500.0,
        "own_hp": 500.0,
        "nearest_cp": 2.0,
        "enemy_hq_hp": 180.0,
        "own_hq_hp": 180.0,
        "hq_pressure": 5.0,
        "hq_pressure_valid": 1.0,
    }
    base.update(overrides)
    return base


def _env(monkeypatch: pytest.MonkeyPatch, **weights: float) -> HexGameEnv:
    """按给定权重构造环境（不联网：__init__ 不发请求，reset 才发）。"""
    for name, value in weights.items():
        monkeypatch.setenv(f"RL_REWARD_{name.upper()}", str(value))
    return HexGameEnv()


def _unit(owner: str, q: int, r: int, hp: int = 60, kind: str = "infantry", can_capture: bool = True) -> dict:
    return {"id": f"{owner}-{q}-{r}", "owner": owner, "alive": True, "q": q, "r": r, "hp": hp, "type": kind, "canCapture": can_capture}


def _hq(owner: str, q: int, r: int, hp: int = 180, alive: bool = True) -> dict:
    return {"owner": owner, "alive": alive, "q": q, "r": r, "hp": hp}


def _state(own_units: list[dict], enemy_units: list[dict], enemy_hq: dict, own_hq: dict | None = None) -> dict:
    return {
        "units": [*own_units, *enemy_units],
        "controlPoints": [],
        "headquarters": {
            "player_a": own_hq or _hq("player_a", 0, 0),
            "player_b": enemy_hq,
        },
    }


# --------------------------------------------------------------------------- A4 快照字段


def test_snapshot_reports_hq_hp_and_pressure(monkeypatch):
    """hq_pressure 是己方最靠近敌 HQ 的单位的六角距离，敌 HQ 血量单列。"""
    env = HexGameEnv()
    env.owner, env.opponent = "player_a", "player_b"
    # 己方两单位：一个距敌 HQ(6,0) 6 格，一个 2 格 → 取 2。
    snap = env._strategic_snapshot(_state(
        [_unit("player_a", 0, 0), _unit("player_a", 4, 0)],
        [_unit("player_b", 1, 1)],
        _hq("player_b", 6, 0, hp=120),
    ))
    assert snap["hq_pressure"] == 2.0
    assert snap["hq_pressure_valid"] == 1.0
    assert snap["enemy_hq_hp"] == 120.0
    assert snap["own_hq_hp"] == 180.0


def test_snapshot_marks_pressure_undefined_without_own_units(monkeypatch):
    """己方单位全灭时 hq_pressure 必须标为无效（否则会被读成"已抵达敌 HQ"）。"""
    env = HexGameEnv()
    env.owner, env.opponent = "player_a", "player_b"
    snap = env._strategic_snapshot(_state([], [_unit("player_b", 1, 1)], _hq("player_b", 6, 0)))
    assert snap["hq_pressure_valid"] == 0.0
    assert snap["hq_pressure"] == 0.0
    assert snap["own_units"] == 0.0


def test_snapshot_marks_pressure_undefined_when_enemy_hq_destroyed(monkeypatch):
    """敌 HQ 已毁（alive=False）时同样无定义，并且 hq 血量归零而不是残留。"""
    env = HexGameEnv()
    env.owner, env.opponent = "player_a", "player_b"
    snap = env._strategic_snapshot(_state(
        [_unit("player_a", 4, 0)],
        [_unit("player_b", 1, 1)],
        _hq("player_b", 6, 0, hp=0, alive=False),
    ))
    assert snap["hq_pressure_valid"] == 0.0
    assert snap["enemy_hq_hp"] == 0.0


def test_dead_units_do_not_count_as_pressure(monkeypatch):
    """距离只算存活单位——阵亡单位残留在 units 里不应拉近 hq_pressure。"""
    env = HexGameEnv()
    env.owner, env.opponent = "player_a", "player_b"
    dead = _unit("player_a", 5, 0)
    dead["alive"] = False
    snap = env._strategic_snapshot(_state([dead, _unit("player_a", 0, 0)], [], _hq("player_b", 6, 0)))
    assert snap["hq_pressure"] == 6.0


# --------------------------------------------------------------------------- A4 奖励项


def test_own_hq_damage_is_not_rewarded(monkeypatch):
    """A4 只加"打敌 HQ"的正向项，**不**给"被打 HQ"加负向项——这是刻意的不对称。

    自己的 HQ 掉血已经被 own_hp 项（−Δ/160）与裁决分差（ownHqHp 权重）覆盖两次；
    再加一项惩罚会让"缩在家里"变得更有吸引力，是对已学策略的方向性改动。这条断言
    是为了防止后来者顺手把一个对称项加进来（那需要单独的训练验证，见 R2 风险）。
    """
    env = _env(monkeypatch, hq_damage=DEFAULT_REWARD_HQ_DAMAGE, hq_push=0.0, new_unit_type=0.0)
    assert env._shaped_reward(_snap(), _snap(own_hq_hp=80.0), "attack") == pytest.approx(0.0)


def test_hq_damage_term_magnitude(monkeypatch):
    """每 100 点敌 HQ 伤害 = 权重本身（默认 0.15）。"""
    env = _env(monkeypatch, hq_damage=DEFAULT_REWARD_HQ_DAMAGE, hq_push=0.0, new_unit_type=0.0)
    reward = env._shaped_reward(_snap(), _snap(enemy_hq_hp=80.0), "attack")
    assert reward == pytest.approx(DEFAULT_REWARD_HQ_DAMAGE)


def test_hq_push_rewards_approach_and_punishes_retreat(monkeypatch):
    """推进势能：距离减少为正、增加为负，量级 = Δ距离 × 权重。"""
    env = _env(monkeypatch, hq_damage=0.0, hq_push=DEFAULT_REWARD_HQ_PUSH, new_unit_type=0.0)
    closer = env._shaped_reward(_snap(hq_pressure=5.0), _snap(hq_pressure=3.0), "move")
    farther = env._shaped_reward(_snap(hq_pressure=5.0), _snap(hq_pressure=8.0), "move")
    assert closer == pytest.approx(2.0 * DEFAULT_REWARD_HQ_PUSH)
    assert farther == pytest.approx(-3.0 * DEFAULT_REWARD_HQ_PUSH)


def test_hq_push_requires_stable_roster(monkeypatch):
    """名册一变（deploy / 阵亡）就跳过推进项，避免把"新单位出现在己方 HQ"当成撤退。"""
    env = _env(monkeypatch, hq_damage=0.0, hq_push=DEFAULT_REWARD_HQ_PUSH, new_unit_type=0.0)
    # 名册不变 + 距离变远 → 该项本应给出 -3 × 0.02。
    assert env._shaped_reward(_snap(hq_pressure=5.0), _snap(hq_pressure=8.0), "move") < 0
    # 名册从 3 变 4（deploy）：同样距离变化必须完全不计分。
    grown = env._shaped_reward(_snap(hq_pressure=5.0), _snap(hq_pressure=8.0, own_units=4.0), "deploy")
    assert grown == pytest.approx(env.reward_deploy_bonus)


def test_hq_push_does_not_reward_wiping_out_own_units(monkeypatch):
    """送死不能换奖励：单位全灭时势能失效 → 该项为 0，而不是"距离归零"的正奖励。

    没有 hq_pressure_valid 标记时，己方单位全灭会让最近距离从 3 跳到 0，
    白拿 +3 × 0.02 的推进奖励，形成"送死→重新部署"的刷分路径。
    """
    env = _env(monkeypatch, hq_damage=0.0, hq_push=DEFAULT_REWARD_HQ_PUSH, new_unit_type=0.0)
    wiped = env._shaped_reward(
        _snap(hq_pressure=3.0, hq_pressure_valid=1.0, own_units=1.0),
        _snap(hq_pressure=0.0, hq_pressure_valid=0.0, own_units=0.0),
        "move",
    )
    assert wiped == pytest.approx(0.0)


def test_zero_weights_reproduce_previous_shaping(monkeypatch):
    """三项权重全 0 时与 v3.x 奖励逐位相同（可安全回退）。"""
    env = _env(monkeypatch, hq_damage=0.0, hq_push=0.0, new_unit_type=0.0)
    before = _snap(control_points=1.0, enemy_hp=400.0, own_hp=420.0, nearest_cp=5.0)
    after = _snap(control_points=2.0, enemy_hp=380.0, own_hp=410.0, nearest_cp=3.0,
                  enemy_hq_hp=60.0, hq_pressure=1.0)
    reward = env._shaped_reward(before, after, "move")
    expected = 0.7 + 20.0 / 100.0 + (-10.0) / 160.0 + 2.0 * 0.025
    assert reward == pytest.approx(expected)


# --------------------------------------------------------------------------- A5 novelty


def test_novelty_bonus_fires_once_per_type_per_episode(monkeypatch):
    """首次部署某兵种给一次奖励；同兵种再次部署不再给；换兵种再给。"""
    env = _env(monkeypatch, hq_damage=0.0, hq_push=0.0, new_unit_type=DEFAULT_REWARD_NEW_UNIT_TYPE)
    before, after = _snap(), _snap()
    assert env._shaped_reward(before, after, "deploy", "scout") == pytest.approx(DEFAULT_REWARD_NEW_UNIT_TYPE)
    assert env._shaped_reward(before, after, "deploy", "scout") == pytest.approx(0.0)
    assert env._shaped_reward(before, after, "deploy", "support") == pytest.approx(DEFAULT_REWARD_NEW_UNIT_TYPE)
    assert env._deployed_types == {"scout", "support"}


def test_novelty_does_not_fire_for_non_deploy_actions(monkeypatch):
    """move/attack 不消耗 novelty 额度，也不因带 unit_type 而误发奖励。"""
    env = _env(monkeypatch, hq_damage=0.0, hq_push=0.0, new_unit_type=DEFAULT_REWARD_NEW_UNIT_TYPE)
    assert env._shaped_reward(_snap(), _snap(), "move", "scout") == pytest.approx(0.0)
    assert env._deployed_types == set()
    # 额度没被消耗：随后的 deploy 仍然拿得到。
    assert env._shaped_reward(_snap(), _snap(), "deploy", "scout") == pytest.approx(DEFAULT_REWARD_NEW_UNIT_TYPE)


def test_novelty_bonus_is_bounded(monkeypatch):
    """上限 = 兵种数 × 权重：novelty 每兵种每局一次，不能被刷。"""
    env = _env(monkeypatch, hq_damage=0.0, hq_push=0.0, new_unit_type=DEFAULT_REWARD_NEW_UNIT_TYPE)
    types = ("infantry", "scout", "heavy", "ranger", "support")
    total = sum(env._shaped_reward(_snap(), _snap(), "deploy", kind) for kind in types * 3)
    assert total == pytest.approx(len(types) * DEFAULT_REWARD_NEW_UNIT_TYPE)


def test_deploy_without_unit_type_is_ignored(monkeypatch):
    """payload 缺 unitType 时（异常路径）不能把空串记进 novelty 集合。"""
    env = _env(monkeypatch, hq_damage=0.0, hq_push=0.0, new_unit_type=DEFAULT_REWARD_NEW_UNIT_TYPE)
    assert env._shaped_reward(_snap(), _snap(), "deploy", "") == pytest.approx(0.0)
    assert env._deployed_types == set()


def test_both_reset_paths_clear_per_episode_state(monkeypatch):
    """_deployed_types / deploy_counts 必须在两处 reset 都清零。

    基类 HexGameEnv.reset 走 HTTP；LocalHexGameEnv.reset 用
    super(HexGameEnv, self).reset(...) **跳过**基类实现，所以只改一处会跨局累积
    ——novelty 奖励会在第一局之后彻底失效，且不报错。
    """
    for func in (HexGameEnv.reset, LocalHexGameEnv.reset):
        source = inspect.getsource(func)
        assert "self._deployed_types = set()" in source, f"{func.__qualname__} 未清空兵种 novelty 集合"
        assert "self.deploy_counts = {}" in source, f"{func.__qualname__} 未清空部署统计"


def test_per_episode_state_exists_before_reset(monkeypatch):
    """__init__ 里就要有初值：step/info 可能在 reset 之前被读到。"""
    env = HexGameEnv()
    assert env._deployed_types == set()
    assert env.deploy_counts == {}
