"""v3.0 environment invariants (pytest).

Run with:  rl/.venv/Scripts/python.exe -m pytest tests/rl -q

These lock down the three things the v3.0 action space could silently break:
the 54 -> 155 teacher mapping, agreement between the action mask and the
candidate descriptors in the observation, and the shape/reward contract.
Games are played against the cheap rule opponent so the suite stays fast.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

RL_DIR = Path(__file__).resolve().parents[2] / "rl"
sys.path.insert(0, str(RL_DIR))

import env as E  # noqa: E402
from local_env import LocalHexGameEnv  # noqa: E402


@pytest.fixture(scope="module")
def game_env():
    env = LocalHexGameEnv(map_id="random", opponent_style="mixed")
    yield env
    env.close()


def test_action_and_observation_sizes():
    assert E.MAX_ACTIONS == 1 + E.MAX_UNIT_SLOTS * E.SLOT_ACTIONS + len(E.DEPLOY_SLOTS) * E.DEPLOY_CANDIDATES
    assert E.MAX_ACTIONS == 155
    assert E.SLOT_ACTIONS == E.MOVE_CANDIDATES + E.ATTACK_CANDIDATES + 2
    assert E.OBSERVATION_SIZE == 6715
    # The first 6205 dims stay bit-compatible with the frozen v2.7 layout.
    assert E.BOARD_SIZE + E.GLOBAL_FEATURES + E.MAX_UNIT_SLOTS * E.SLOT_FEATURES + E.RULE_FEATURES == 6205


def test_v27_action_mapping_is_injective_and_ordered():
    mapped = [E.map_v27_action(index) for index in range(E.V27_ACTIONS)]
    assert len(set(mapped)) == E.V27_ACTIONS
    assert max(mapped) < E.MAX_ACTIONS
    assert mapped[0] == 0
    # Slot 0: move / attack / heal / special land on candidate 0 of each group.
    assert mapped[1] == 1 + E.MOVE_OFFSET
    assert mapped[2] == 1 + E.ATTACK_OFFSET
    assert mapped[3] == 1 + E.HEAL_OFFSET
    assert mapped[4] == 1 + E.SPECIAL_OFFSET
    # Deploy slots map to candidate 0 of each unit type.
    for type_index in range(len(E.DEPLOY_SLOTS)):
        assert mapped[1 + E.MAX_UNIT_SLOTS * 4 + type_index] == E.DEPLOY_BASE + type_index * E.DEPLOY_CANDIDATES


def _candidate_base() -> int:
    return E.BOARD_SIZE + E.GLOBAL_FEATURES + E.MAX_UNIT_SLOTS * E.SLOT_FEATURES + E.RULE_FEATURES


def _assert_candidates_match_mask(observation: np.ndarray, mask: np.ndarray) -> None:
    """Every candidate's validity bit must equal its action-mask entry."""
    base = _candidate_base()
    for slot in range(E.MAX_UNIT_SLOTS):
        slot_base = base + slot * E.SLOT_CANDIDATE_FEATURES
        for index in range(E.MOVE_CANDIDATES):
            bit = observation[slot_base + index * E.MOVE_CANDIDATE_FEATURES]
            action = 1 + slot * E.SLOT_ACTIONS + E.MOVE_OFFSET + index
            assert bool(bit) == bool(mask[action]), f"move slot={slot} candidate={index}"
        attack_base = slot_base + E.MOVE_CANDIDATES * E.MOVE_CANDIDATE_FEATURES
        for index in range(E.ATTACK_CANDIDATES):
            bit = observation[attack_base + index * E.ATTACK_CANDIDATE_FEATURES]
            action = 1 + slot * E.SLOT_ACTIONS + E.ATTACK_OFFSET + index
            assert bool(bit) == bool(mask[action]), f"attack slot={slot} candidate={index}"
    deploy_base = base + E.MAX_UNIT_SLOTS * E.SLOT_CANDIDATE_FEATURES
    for type_index in range(len(E.DEPLOY_SLOTS)):
        for index in range(E.DEPLOY_CANDIDATES):
            bit = observation[deploy_base + (type_index * E.DEPLOY_CANDIDATES + index) * E.DEPLOY_CANDIDATE_FEATURES]
            action = E.DEPLOY_BASE + type_index * E.DEPLOY_CANDIDATES + index
            assert bool(bit) == bool(mask[action]), f"deploy type={type_index} candidate={index}"


def test_rollout_contract(game_env):
    """300 random-legal steps: shapes, mask agreement, no invalid actions."""
    rng = np.random.default_rng(0)
    observation, _ = game_env.reset(seed=1234)
    assert observation.shape == (E.OBSERVATION_SIZE,)
    invalid = 0
    finished = 0
    reward_clip = max(2.0, game_env.reward_win + 1.0)
    for _ in range(300):
        mask = game_env.action_masks()
        assert mask.shape == (E.MAX_ACTIONS,)
        assert mask[0], "end_turn must always be legal while the game is live"
        _assert_candidates_match_mask(observation, mask)
        action = int(rng.choice(np.flatnonzero(mask)))
        observation, reward, terminated, truncated, info = game_env.step(action)
        assert observation.shape == (E.OBSERVATION_SIZE,)
        assert -reward_clip <= reward <= reward_clip
        invalid += int(bool(info.get("invalid")))
        if terminated or truncated:
            finished += 1
            observation, _ = game_env.reset()
    assert invalid == 0, "a masked-legal action was rejected by the engine"
    assert finished > 0, "no episode completed in 300 steps"


def test_move_candidates_are_distinct_and_reachable(game_env):
    """Direction candidates must be different cells, and all of them reachable."""
    rng = np.random.default_rng(7)
    game_env.reset(seed=99)
    seen_multi_candidate_unit = False
    for _ in range(120):
        state = game_env.state
        cells = {E.key(int(c["q"]), int(c["r"])): c for c in state.get("cells", [])}
        occupied = {(int(u["q"]), int(u["r"])) for u in state.get("units", []) if u.get("alive")}
        occupied.update((int(h["q"]), int(h["r"])) for h in state.get("headquarters", {}).values() if h.get("alive"))
        for unit in game_env._units_for_slots(state, game_env.owner):
            if unit is None:
                continue
            candidates = game_env._move_candidates(unit, state, game_env.owner, cells, occupied)
            positions = [(c["q"], c["r"]) for c in candidates if c]
            assert len(positions) == len(set(positions)), "duplicate move candidate emitted"
            if len(positions) > 1:
                seen_multi_candidate_unit = True
            reachable = set(game_env._reachable(cells, occupied, E.key(int(unit["q"]), int(unit["r"])), int(unit.get("moveRange", 0))))
            for position in positions:
                assert position in reachable, f"move candidate {position} is not reachable"
        mask = game_env.action_masks()
        _, _, terminated, truncated, _ = game_env.step(int(rng.choice(np.flatnonzero(mask))))
        if terminated or truncated:
            game_env.reset()
    assert seen_multi_candidate_unit, "never observed a unit with more than one move candidate"


def test_reward_config_defaults_favour_the_terminal_signal(game_env):
    assert game_env.reward_win == 5.0
    assert game_env.reward_shaping_scale == 0.5
    assert game_env.reward_deploy_bonus == 0.0
    assert game_env.reward_attack_bonus == 0.0
