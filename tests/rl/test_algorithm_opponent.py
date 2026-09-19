"""v3.2.0 规则算法对手接入（pytest）。

Run with:  rl/.venv/Scripts/python.exe -m pytest tests/rl -q

P0 只锁一件事：threat / field / greedy / mcts 四个内置算法能作为
``LocalHexGameEnv`` 的对手打完整局——决策经 local-worker 的 ``decide`` 通道，
算法返回的引擎原生 payload 被 ``apply`` 原样接受（rejections 为 0），
且 ``decide`` 的返回值不会被误当成游戏快照污染缓存。

数据依据：算法在竞技场以 83.5% 胜率碾压全部 17 个历史模型，根因是训练对手池
从未包含这类策略形态。诊断与方案见 ``rl/docs/plans/v3.2.0.md``。
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

RL_DIR = Path(__file__).resolve().parents[2] / "rl"
# 与 tests/rl/test_env_v300.py 同款：rl/ 下是分目录的扁平模块。
for _sub in ("envs", "runners", "training", "evaluation"):
    sys.path.insert(0, str(RL_DIR / _sub))

import env as E  # noqa: E402
from local_env import LocalHexGameEnv  # noqa: E402

ALGORITHMS = ("threat", "field", "greedy", "mcts")
# 40 步已覆盖开局/部署/交火/抢点，而跑满 500 步单局要 30s+——
# P0 验证的是通道可用与状态机完整，不是对局长度。
MAX_STEPS = 40


def make_env(algorithm: str, *, epsilon: float = 0.0, **kwargs) -> LocalHexGameEnv:
    return LocalHexGameEnv(
        map_id="random",
        opponent_style="mixed",
        max_steps=MAX_STEPS,
        algorithm_mix={algorithm: 1.0},
        algorithm_opponent_probability=1.0,
        algorithm_epsilon=epsilon,
        **kwargs,
    )


def play_episode(env: LocalHexGameEnv, seed: int) -> int:
    """随机合法动作陪跑到底，返回智能体步数。"""
    observation, _ = env.reset(seed=seed)
    assert observation.shape == (E.OBSERVATION_SIZE,)
    assert np.isfinite(observation).all()
    steps = 0
    terminated = truncated = False
    while not (terminated or truncated):
        mask = env.action_masks()
        legal = np.flatnonzero(mask)
        # actions[0] 永远是 end_turn，因此掩码不可能全 False。
        assert len(legal) > 0
        _, reward, terminated, truncated, _ = env.step(int(env.np_random.choice(legal)))
        assert np.isfinite(reward)
        steps += 1
        assert steps <= MAX_STEPS + 1, "环境未在 max_steps 处截断"
    return steps


@pytest.mark.parametrize("algorithm", ALGORITHMS)
def test_algorithm_opponent_plays_two_episodes(algorithm):
    """每个算法当两局对手：不崩、payload 全被引擎接受、座位状态机完整。"""
    env = make_env(algorithm)
    try:
        for episode in range(2):
            play_episode(env, seed=1000 + episode)
            assert env.active_opponent_style == "algorithm"
            assert env.active_algorithm == algorithm
            # 对手坐先手时 reset 里就已走完整个开局回合，坐后手则整局累计；
            # 两种座位下都必须有动作，否则说明 decide 通道静默失效。
            assert env.algorithm_actions > 0, "算法座位零动作——通道未生效"
            # 算法返回引擎原生 payload，应当零拒绝。种子固定，结果可复现。
            assert env.opponent_rejections == 0, "算法动作被引擎拒绝，合法性回归"
    finally:
        env.close()


def test_epsilon_one_keeps_episode_legal():
    """ε=1（全部用随机合法动作）时对手仍能跑完整局——A3 的极端下界。"""
    env = make_env("greedy", epsilon=1.0)
    try:
        play_episode(env, seed=2000)
        assert env.active_opponent_style == "algorithm"
        assert env.algorithm_actions > 0
        assert env.opponent_rejections == 0
    finally:
        env.close()


def test_decide_returns_decision_not_snapshot():
    """``decide`` 的返回值是决策对象，写错语义会直接改坏引擎状态。"""
    env = make_env("greedy")
    try:
        env.reset(seed=7)
        cached = env._cached_state
        assert isinstance(cached, dict) and "phase" in cached

        decision = env.decide(env.opponent, "greedy")
        assert "phase" not in decision, "decide 返回的是决策对象，不是游戏快照"
        assert "action" in decision or decision.get("endTurn") is True

        # 决策不改变游戏状态：缓存对象必须还是同一份，且仍可零往返取用。
        assert env._cached_state is cached
        assert env._get_state("agent") is cached
        assert env._cached_state["phase"] == cached["phase"]
    finally:
        env.close()


def test_algorithm_probability_zero_skips_algorithms():
    """配了池但概率为 0 → 不启用算法对手（默认关闭语义）。"""
    env = LocalHexGameEnv(
        map_id="random",
        algorithm_mix={"threat": 1.0},
        algorithm_opponent_probability=0.0,
    )
    try:
        env.reset(seed=11)
        assert env.active_opponent_style != "algorithm"
        assert env.active_algorithm == ""
    finally:
        env.close()


def test_mix_is_normalized_and_drawn_from_pool():
    env = LocalHexGameEnv(
        map_id="random",
        algorithm_mix={"threat": 3.0, "greedy": 1.0},
        algorithm_opponent_probability=1.0,
    )
    try:
        assert env.algorithm_opponent_pool == {"threat": 0.75, "greedy": 0.25}
        seen = set()
        for seed in range(6):
            env.reset(seed=seed)
            assert env.active_opponent_style == "algorithm"
            seen.add(env.active_algorithm)
        assert seen <= {"threat", "greedy"}
    finally:
        env.close()


def test_base_http_env_rejects_algorithm_opponents():
    """基类走 HTTP，没有进程内 worker：配置错误必须在构造时报出，不能静默降级。"""
    with pytest.raises(ValueError, match="local engine worker"):
        E.HexGameEnv(algorithm_mix={"threat": 1.0}, algorithm_opponent_probability=1.0)
    with pytest.raises(ValueError, match="requires algorithm_opponent"):
        E.HexGameEnv(algorithm_opponent_probability=0.5)
    with pytest.raises(ValueError, match="between 0 and 1"):
        LocalHexGameEnv(algorithm_mix={"threat": 1.0}, algorithm_opponent_probability=1.5)
    with pytest.raises(ValueError, match="between 0 and 1"):
        LocalHexGameEnv(algorithm_mix={"threat": 1.0}, algorithm_opponent_probability=1.0, algorithm_epsilon=2.0)
    with pytest.raises(ValueError, match="positive"):
        LocalHexGameEnv(algorithm_mix={"threat": 0.0}, algorithm_opponent_probability=0.5)


def test_parse_algorithm_mix_defaults_and_validation():
    """RL_ALGO_MIX 的解析与校验（train.py 侧，配错会静默退化成空池）。"""
    train = pytest.importorskip("train")
    assert train.parse_algorithm_mix("") == {}
    assert train.parse_algorithm_mix("threat") == {"threat": 1.0}
    assert train.parse_algorithm_mix("threat:0.4,field:0.3,greedy:0.3") == {
        "threat": 0.4,
        "field": 0.3,
        "greedy": 0.3,
    }
    with pytest.raises(ValueError, match="positive"):
        train.parse_algorithm_mix("threat:0")
    with pytest.raises(ValueError, match="positive"):
        train.parse_algorithm_mix("threat:-1")
