"""v3.0.2 探索死锁修复的不变量（pytest）。

Run with:  rl/.venv/Scripts/python.exe -m pytest tests/rl -q

锁死四件可能被静默破坏的事：
1. `classify_action` 覆盖全部 155 个动作且意图正确；
2. **老师（v2.7）的 54 个动作经 `map_v27_action` 全部落在候选 0** —— 这是探索死锁的
   根源，一旦该不变量被破坏（例如映射改动），标签平滑的必要性与 eps 取值都要重估；
3. `smoothed_target` / `masked_smoothed_ce` 是合法分布且不会因 -1e9 屏蔽位而爆炸；
4. `selection_score` 的后手座下界真的能在总分相同时区分断点（v3.0.1 的 350k/480k 反例）。
"""

from __future__ import annotations

import sys
from pathlib import Path

import gymnasium as gym
import numpy as np
import pytest
import torch
from gymnasium import spaces
from torch.nn import functional as F

RL_DIR = Path(__file__).resolve().parents[2] / "rl"
sys.path.insert(0, str(RL_DIR))

import env as E  # noqa: E402
from distill import masked_smoothed_ce, smoothed_target  # noqa: E402
from eval_worker import selection_score, wilson_lower_bound  # noqa: E402
from train import ActionDiversityCallback, resume_custom_objects  # noqa: E402


def test_classify_action_covers_every_index():
    intents = {"end_turn", "move", "attack", "heal", "special", "deploy"}
    for index in range(E.MAX_ACTIONS):
        intent, candidate = E.classify_action(index)
        assert intent in intents
        assert candidate >= 0
    assert E.classify_action(0) == ("end_turn", 0)
    # 每个槽的 12 个动作 = 7 移动 + 3 攻击 + 治疗 + 特殊；候选序号按**意图各自**从 0 编号。
    slot_zero = [E.classify_action(1 + offset) for offset in range(E.SLOT_ACTIONS)]
    assert [intent for intent, _ in slot_zero] == (
        ["move"] * E.MOVE_CANDIDATES
        + ["attack"] * E.ATTACK_CANDIDATES
        + ["heal", "special"]
    )
    assert [candidate for _, candidate in slot_zero] == (
        list(range(E.MOVE_CANDIDATES)) + list(range(E.ATTACK_CANDIDATES)) + [0, 0]
    )
    # 部署槽按兵种分块，每块 DEPLOY_CANDIDATES 个落点。
    for type_index in range(len(E.DEPLOY_SLOTS)):
        for candidate in range(E.DEPLOY_CANDIDATES):
            index = E.DEPLOY_BASE + type_index * E.DEPLOY_CANDIDATES + candidate
            assert E.classify_action(index) == ("deploy", candidate)


def test_teacher_actions_all_land_on_candidate_zero():
    """死锁根源的形式化：老师能做的每一个动作，在 v3.0 里都是某个槽的候选 0。

    因此纯行为克隆的数据里**不存在任何候选 ≥1 的示范**，新维度只能靠 PPO 探索发现；
    而 PPO 的策略梯度只对采样到的动作有信号 —— 这就是必须先做标签平滑的原因。
    """
    for teacher_index in range(E.V27_ACTIONS):
        mapped = E.map_v27_action(teacher_index)
        intent, candidate = E.classify_action(mapped)
        assert candidate == 0, f"v2.7 动作 {teacher_index} 映射到 {intent} 候选 {candidate}"
    # 反向：候选 ≥1 的动作数量 = 155 - 54，它们全部是 v3.0 新增、老师从未示范过的。
    new_actions = [i for i in range(E.MAX_ACTIONS) if E.classify_action(i)[1] >= 1]
    assert len(new_actions) == E.MAX_ACTIONS - E.V27_ACTIONS == 101


def _sample_case(batch: int = 4, n_actions: int = 155):
    generator = torch.Generator().manual_seed(7)
    logits = torch.randn(batch, n_actions, generator=generator)
    mask = torch.rand(batch, n_actions, generator=generator) > 0.6
    mask[:, 0] = True  # end_turn 永远合法，保证每行至少一个合法动作
    actions = torch.zeros(batch, dtype=torch.long)
    for row in range(batch):
        legal = torch.nonzero(mask[row]).flatten()
        actions[row] = legal[int(torch.randint(len(legal), (1,), generator=generator))]
        mask[row, actions[row]] = True
    return logits, mask, actions


def test_smoothed_target_is_a_valid_distribution():
    logits, mask, actions = _sample_case()
    for eps in (0.0, 0.15, 0.3):
        target = smoothed_target(mask, actions, eps)
        legal = mask.to(torch.float32)
        legal_count = legal.sum(dim=-1, keepdim=True)
        # 每行是合法动作上的概率分布：和为 1、非法位严格为 0。
        assert torch.allclose(target.sum(dim=-1), torch.ones(target.shape[0]), atol=1e-5)
        assert torch.all(target[~mask] == 0)
        assert torch.all(target >= 0)
        # 老师动作拿 1-eps+eps/n，其余合法动作均分 eps/n。
        expected_teacher = (1.0 - eps) + eps / legal_count
        got = target.gather(1, actions.unsqueeze(-1))
        assert torch.allclose(got, expected_teacher, atol=1e-6)
        # 非老师的合法位才应等于 eps/n（老师位已被上面的断言覆盖）。
        non_target = mask.clone()
        non_target.scatter_(1, actions.unsqueeze(-1), False)
        expected_others = (eps / legal_count).expand_as(target)
        assert torch.allclose(target[non_target], expected_others[non_target], atol=1e-6)


def test_masked_smoothed_ce_is_finite_and_reduces_to_plain_ce():
    logits, mask, actions = _sample_case()
    # eps=0 必须与原有的掩码交叉熵逐值相同（保证 --label-smoothing 0 可复现 v3.0.1）。
    reference = F.cross_entropy(logits.masked_fill(~mask, -1e9), actions)
    assert torch.allclose(masked_smoothed_ce(logits, mask, actions, 0.0), reference, atol=1e-4)
    # 关键：屏蔽位的 log_prob≈-1e9 绝不能进入求和，否则 loss 会是 1e8 量级甚至 inf/nan。
    for eps in (0.05, 0.15, 0.3):
        value = masked_smoothed_ce(logits, mask, actions, eps)
        assert torch.isfinite(value)
        assert float(value) < 20.0, f"eps={eps} 时 loss={float(value)}，疑似 -1e9 泄漏进求和"
        assert value.requires_grad is False  # 输入不带梯度时结果也不带


def _scenario(min_lb: float, second_wins: int, second_games: int = 48) -> dict:
    return {
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


def test_selection_score_breaks_ties_on_second_seat():
    """v3.0.1 实测反例：350k 与 480k 总分同为噪声内，后手座却差 10pt。

    选择键必须在最弱场景下界相同时把后手座更强的断点排在前面。
    """
    weak = {"scenarios": {"random_rule": _scenario(0.46, 19), "default_champion": _scenario(0.46, 19)}}
    strong = {"scenarios": {"random_rule": _scenario(0.46, 24), "default_champion": _scenario(0.46, 24)}}
    score_weak = selection_score(weak)
    score_strong = selection_score(strong)
    assert len(score_weak) == 5
    assert score_weak[0] == score_strong[0] == pytest.approx(0.46)
    # 第二位是后手座合并下界：38/96 vs 48/96。
    assert score_strong[1] > score_weak[1]
    assert score_weak[1] == pytest.approx(wilson_lower_bound(38, 96))
    assert score_strong[1] == pytest.approx(wilson_lower_bound(48, 96))
    assert score_strong > score_weak


def test_selection_score_handles_empty_and_legacy_results():
    assert selection_score({}) == (-1.0, -1.0, -1.0, -float("inf"), -float("inf"))
    assert selection_score({"scenarios": {}})[0] == -1.0
    # 旧结果 json 没有分座位字段时不应崩溃（用 .get 兜底）。
    legacy = {"scenarios": {"random_rule": {"wilson_lb": 0.5, "cp_mean": 1.0, "mean_reward": 5.0}}}
    score = selection_score(legacy)
    assert score[0] == pytest.approx(0.5)
    assert score[1] == 0.0  # 无后手座数据 → 下界 0


class _FakeLogger:
    def __init__(self):
        self.records: dict[str, float] = {}

    def record(self, key: str, value: float, exclude: object = None) -> None:
        self.records[key] = value


class _FakeModel:
    """sb3 的 `BaseCallback.logger` 是只读 property（`return self.model.logger`），
    所以测试通过注入假 model 来提供 logger，而不是直接赋值 callback.logger。"""

    def __init__(self):
        self.logger = _FakeLogger()


def test_action_diversity_callback_counts_new_candidates():
    callback = ActionDiversityCallback(log_every=4)
    model = _FakeModel()
    callback.model = model
    n_envs = 2
    # 构造两帧：第一帧两个环境都选候选 0（老师行为），第二帧都选 move 候选 3（新维度）。
    frames = [
        (np.array([1, 1 + E.SLOT_ACTIONS]), np.array([[True] * E.MAX_ACTIONS] * n_envs)),
        (np.array([1 + 3, 1 + E.SLOT_ACTIONS + 3]), np.array([[True] * E.MAX_ACTIONS] * n_envs)),
    ]
    for actions, masks in frames:
        callback.locals = {"actions": actions, "action_masks": masks}
        assert callback._on_step() is True
    recorded = model.logger.records
    # 全 True 掩码下，候选 ≥1 的动作下标共 101 个（= 155 - 54，即老师从未示范的那些）：
    #   move 候选 1-6：12 槽 × 6 = 72；attack 候选 1-2：12 槽 × 2 = 24；deploy 候选 1：5 兵种 × 1 = 5。
    move_new = E.MAX_UNIT_SLOTS * (E.MOVE_CANDIDATES - 1)
    attack_new = E.MAX_UNIT_SLOTS * (E.ATTACK_CANDIDATES - 1)
    deploy_new = len(E.DEPLOY_SLOTS) * (E.DEPLOY_CANDIDATES - 1)
    assert move_new + attack_new + deploy_new == E.MAX_ACTIONS - E.V27_ACTIONS == 101
    # 2 帧 × 2 环境；第二帧两个环境都选了 move 候选 3。
    frames_envs = 2 * n_envs
    assert recorded["explore/move_new_rate"] == pytest.approx(2 / (frames_envs * move_new))
    assert recorded["explore/attack_new_rate"] == 0.0
    assert recorded["explore/deploy_new_rate"] == 0.0
    assert recorded["explore/new_candidate_count"] == 2
    assert recorded["explore/new_candidate_rate"] == pytest.approx(
        2 / (frames_envs * (move_new + attack_new + deploy_new))
    )
    assert recorded["explore/legal_actions_mean"] == pytest.approx(E.MAX_ACTIONS)
    assert 0.0 < recorded["explore/new_candidate_rate"] < 1.0
    # 窗口在打印后清零，累计帧数继续增长。
    assert callback._window == 0
    assert callback._total == 4


def test_action_diversity_callback_survives_missing_mask():
    """拿不到 action_masks（或形状不符）时只统计占比，不能抛异常拖垮训练。"""
    callback = ActionDiversityCallback(log_every=2)
    model = _FakeModel()
    callback.model = model
    callback.locals = {"actions": np.array([0, 1 + 3])}
    assert callback._on_step() is True
    callback.locals = {"actions": np.array([0, 1]), "action_masks": np.array([[True] * E.MAX_ACTIONS])}
    assert callback._on_step() is True
    assert "explore/new_candidate_rate" in model.logger.records
    # 形状不符 → 没有合法动作分母，选用率记为 0 而不是崩溃。
    assert model.logger.records["explore/legal_actions_mean"] == 0.0


def test_resume_custom_objects_covers_every_env_driven_hyperparam():
    """环境变量驱动的 PPO 超参必须全部进 custom_objects，否则对续训无效。"""
    overrides = resume_custom_objects(512, 256, 0.02, 0.99, 0.03, 0.2, 10)
    assert set(overrides) == {
        "n_steps", "batch_size", "target_kl", "gamma", "ent_coef", "clip_range", "n_epochs",
    }
    assert overrides["ent_coef"] == 0.03
    assert overrides["target_kl"] == 0.02


class _TinyMaskedEnv(gym.Env):
    """最小 masked 环境，只为验证 sb3 `load` 的 custom_objects 覆盖行为（不拉引擎 worker）。"""

    def __init__(self):
        super().__init__()
        self.action_space = spaces.Discrete(E.MAX_ACTIONS)
        self.observation_space = spaces.Box(-1.0, 1.0, shape=(16,), dtype=np.float32)

    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        return np.zeros(16, dtype=np.float32), {}

    def step(self, action):
        return np.zeros(16, dtype=np.float32), 0.0, True, False, {}

    def action_masks(self):
        mask = np.zeros(E.MAX_ACTIONS, dtype=bool)
        mask[0] = mask[1] = True
        return mask


def test_sb3_load_actually_overrides_checkpoint_ent_coef(tmp_path):
    """回归锁定 v3.0.0/v3.0.1 的死变量 bug。

    蒸馏断点存的是 sb3 默认 ent_coef=0.0，而 `MaskablePPO.load` 以断点值为准，
    只有 custom_objects 里的项会被覆盖。当时 `RL_ENT_COEF` 不在其中，于是整个
    PPO 阶段零熵正则（实测熵 0.94 → 0.78、新候选概率质量 5.5% → 1.4%）。
    """
    from sb3_contrib import MaskablePPO

    env = _TinyMaskedEnv()
    try:
        model = MaskablePPO(
            "MlpPolicy", env, ent_coef=0.0, n_steps=8, batch_size=8, target_kl=None,
            policy_kwargs={"net_arch": []}, device="cpu", verbose=0,
        )
        checkpoint = str(tmp_path / "ckpt")
        model.save(checkpoint)
        reloaded = MaskablePPO.load(
            checkpoint, device="cpu",
            custom_objects=resume_custom_objects(512, 256, 0.02, 0.99, 0.03, 0.2, 10),
        )
        assert reloaded.ent_coef == 0.03, "断点内 ent_coef=0.0 未被覆盖，RL_ENT_COEF 对续训无效"
        assert reloaded.n_steps == 512
        assert reloaded.batch_size == 256
        assert reloaded.target_kl == 0.02
        assert reloaded.gamma == 0.99
        assert reloaded.n_epochs == 10
    finally:
        env.close()
