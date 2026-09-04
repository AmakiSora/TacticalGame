"""Gymnasium environment for the standard two-player REST game (v3.0).

v3.0 gives the policy the "where / whom" decision that v2.x hard-coded:

* Move: 7 destination candidates per unit slot (0 = legacy goal-seeking cell,
  1-6 = farthest reachable cell along each hex direction).
* Attack: 3 target candidates (0 = legacy best target, 1 = lowest-HP,
  2 = highest-attack).
* Deploy: 2 spawn candidates per unit type (0 = legacy closest-to-enemy-HQ,
  1 = closest to the nearest unowned control point).
* Every candidate is described in the observation (destination, distance to
  an open control point, target HP/attack), so action indices are grounded.

Action space Discrete(155); observation 6,715 dims.  v2.7/v2.8 models must use
the frozen ``env_v27`` snapshot via ``run_model_v27.py``.  Reward: shaping is
scaled down and the fixed deploy/attack bonuses are removed so that the
terminal win/loss signal dominates (all configurable through RL_* variables).
"""

from __future__ import annotations

from collections import deque
import json
import os
import time
from pathlib import Path
from typing import Any

import gymnasium as gym
import numpy as np
import requests
from gymnasium import spaces


PLAYER = "player_a"
OPPONENT = "player_b"
UNIT_TYPES = ("infantry", "scout", "heavy", "ranger", "support")
TYPE_INDEX = {name: index for index, name in enumerate(UNIT_TYPES)}
HEX_DIRECTIONS = ((1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1))

# Canonical board: the full radius-10 hexagon (331 cells).  Every map's cells
# map into these fixed slots by absolute (q, r), so positional semantics stay
# consistent across radius 6-10 random maps; smaller maps pad with zeros.
def _canonical_cells(radius: int) -> list[tuple[int, int]]:
    cells = [
        (q, r)
        for q in range(-radius, radius + 1)
        for r in range(-radius, radius + 1)
        if max(abs(q), abs(r), abs(-q - r)) <= radius
    ]
    return sorted(cells)


CANONICAL_CELLS = _canonical_cells(10)
CANONICAL_INDEX = {cell: index for index, cell in enumerate(CANONICAL_CELLS)}
MAX_CELLS = len(CANONICAL_CELLS)
CELL_FEATURES = 18
GLOBAL_FEATURES = 16
# Stable intent slots.  Slot numbers have the same meaning in every state:
# 0=end turn; then 12 unit slots x SLOT_ACTIONS; then deploy slots.
MAX_UNIT_SLOTS = 12
SLOT_FEATURES = 15
RULE_FEATURES_PER_UNIT = 8
GLOBAL_RULE_FEATURES = 11
RULE_FEATURES = len(UNIT_TYPES) * RULE_FEATURES_PER_UNIT + GLOBAL_RULE_FEATURES
# v3.0 hierarchical candidates.
MOVE_CANDIDATES = 1 + len(HEX_DIRECTIONS)   # legacy goal cell + 6 directions
ATTACK_CANDIDATES = 3                        # legacy best, lowest hp, highest attack
DEPLOY_CANDIDATES = 2                        # legacy (toward enemy HQ), toward open CP
UNIT_INTENTS = ("move", "attack", "heal", "special")
SLOT_ACTIONS = MOVE_CANDIDATES + ATTACK_CANDIDATES + 1 + 1
MOVE_OFFSET = 0
ATTACK_OFFSET = MOVE_CANDIDATES
HEAL_OFFSET = MOVE_CANDIDATES + ATTACK_CANDIDATES
SPECIAL_OFFSET = HEAL_OFFSET + 1
DEPLOY_SLOTS = UNIT_TYPES
DEPLOY_BASE = 1 + MAX_UNIT_SLOTS * SLOT_ACTIONS
MAX_ACTIONS = DEPLOY_BASE + len(DEPLOY_SLOTS) * DEPLOY_CANDIDATES
# Candidate descriptors make the action indices observable.
MOVE_CANDIDATE_FEATURES = 4      # valid, q/10, r/10, distance to nearest open CP / 10
ATTACK_CANDIDATE_FEATURES = 4    # valid, hp fraction, attack/60, is HQ
DEPLOY_CANDIDATE_FEATURES = 3    # valid, q/10, r/10
SLOT_CANDIDATE_FEATURES = MOVE_CANDIDATES * MOVE_CANDIDATE_FEATURES + ATTACK_CANDIDATES * ATTACK_CANDIDATE_FEATURES
CANDIDATE_FEATURES = MAX_UNIT_SLOTS * SLOT_CANDIDATE_FEATURES + len(DEPLOY_SLOTS) * DEPLOY_CANDIDATES * DEPLOY_CANDIDATE_FEATURES
BOARD_SIZE = MAX_CELLS * CELL_FEATURES
OBSERVATION_SIZE = (
    BOARD_SIZE
    + GLOBAL_FEATURES
    + MAX_UNIT_SLOTS * SLOT_FEATURES
    + RULE_FEATURES
    + CANDIDATE_FEATURES
)
# Frozen v2.7 layout (54 actions), used to translate v2.7/v2.8 teachers and
# self-play opponents into the v3.0 index space.
V27_ACTIONS = 54
V27_INTENT_TO_OFFSET = {0: MOVE_OFFSET, 1: ATTACK_OFFSET, 2: HEAL_OFFSET, 3: SPECIAL_OFFSET}


def map_v27_action(index: int) -> int:
    """Translate a v2.7 (54-action) index into the equivalent v3.0 index.

    v2.7's single move/attack/deploy choice equals v3.0 candidate 0 of the
    same slot, so the mapping is exact and injective.
    """
    if index == 0:
        return 0
    if index < 1 + MAX_UNIT_SLOTS * 4:
        slot, intent = divmod(index - 1, 4)
        return 1 + slot * SLOT_ACTIONS + V27_INTENT_TO_OFFSET[intent]
    unit_type = index - (1 + MAX_UNIT_SLOTS * 4)
    return DEPLOY_BASE + unit_type * DEPLOY_CANDIDATES


def classify_action(index: int) -> tuple[str, int]:
    """动作下标 → (意图, 候选序号)。供探索监控与动作分布诊断共用。

    候选序号是 v3.0 新增的决策维度：蒸馏老师（v2.7，54 动作）经
    ``map_v27_action`` 全部落在候选 0，因此「候选 ≥ 1 的选用率」直接
    衡量 PPO 是否真的用上了新维度；持续为 0 意味着 155 动作空间在
    行为上退化回 54 动作（v3.0.1 实测：move 候选 1-6 选用率 0.00%）。
    """
    if index == 0:
        return ("end_turn", 0)
    if index < DEPLOY_BASE:
        offset = (index - 1) % SLOT_ACTIONS
        if offset < MOVE_CANDIDATES:
            return ("move", offset)
        if offset < HEAL_OFFSET:
            return ("attack", offset - ATTACK_OFFSET)
        if offset == HEAL_OFFSET:
            return ("heal", 0)
        return ("special", 0)
    return ("deploy", (index - DEPLOY_BASE) % DEPLOY_CANDIDATES)


def env_reward_float(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    return float(raw) if raw else default


def key(q: int, r: int) -> tuple[int, int]:
    return q, r


def distance(a: dict[str, Any], b: dict[str, Any]) -> int:
    dq = int(a["q"]) - int(b["q"])
    dr = int(a["r"]) - int(b["r"])
    return max(abs(dq), abs(dr), abs(-dq - dr))


def _cube(q: int, r: int) -> tuple[int, int, int]:
    return q, -q - r, r


class HexGameEnv(gym.Env):
    """One RL player versus a configurable goal-directed rule opponent."""

    metadata = {"render_modes": []}

    def __init__(self, base_url: str = "http://127.0.0.1:3100", max_steps: int = 500, opponent_style: str = "mixed", opponent_model: Any | None = None, model_opponent_probability: float = 0.5, map_id: str = "default", random_options: dict[str, Any] | None = None, opponent_model_path: str | None = None, self_play_dir: str | None = None, self_play_probability: float = 0.0, anchor_model_path: str | None = None, anchor_probability: float = 0.15, opponent_stochastic_probability: float = 0.0):
        super().__init__()
        self.base_url = base_url.rstrip("/")
        self.max_steps = max_steps
        if opponent_style not in {"mixed", "aggressive", "defensive", "economy"}:
            raise ValueError("opponent_style must be mixed, aggressive, defensive, or economy")
        if not 0.0 <= model_opponent_probability <= 1.0:
            raise ValueError("model_opponent_probability must be between 0 and 1")
        if not 0.0 <= self_play_probability <= 1.0:
            raise ValueError("self_play_probability must be between 0 and 1")
        if not 0.0 <= opponent_stochastic_probability <= 1.0:
            raise ValueError("opponent_stochastic_probability must be between 0 and 1")
        self.opponent_style = opponent_style
        self.opponent_model = opponent_model
        # 子进程（SubprocVecEnv）里模型对象不可序列化，改传路径在子进程内懒加载。
        self.opponent_model_path = opponent_model_path
        self.model_opponent_probability = model_opponent_probability
        # 自对弈：对手从 self_play_dir 的快照阶梯里随机挑一个，随训练变强。
        # 目录为空（训练初期未存过快照）时自动退回规则对手。
        self.self_play_dir = self_play_dir
        self.self_play_probability = self_play_probability
        # 锚点对手：常驻强基准（如上一代最强模型），防策略漂移退化；
        # 自对弈局中按 anchor_probability 固定出场，其余从快照阶梯近期加权抽。
        self.anchor_model_path = anchor_model_path
        if not 0.0 <= anchor_probability <= 1.0:
            raise ValueError("anchor_probability must be between 0 and 1")
        self.anchor_probability = anchor_probability
        # v2.8：按此概率让模型对手（快照/锚点）按策略分布采样动作而非贪心，
        # 避免智能体只学会针对一条确定性走法。
        self.opponent_stochastic_probability = opponent_stochastic_probability
        self._opponent_stochastic = False
        # v2.8 PFSP：按快照路径记录 (对局数, 智能体胜场)，输得多的对手抽得更频繁。
        self._self_play_record: dict[str, list[int]] = {}
        self._self_play_path = ""
        self._self_play_cache: dict[str, Any] = {}
        self.active_opponent_style = opponent_style
        self.map_id = map_id
        self.random_options = dict(random_options) if random_options else {}
        # 旧模型对手（v2.0.0，3922 维观测）需要 env_v22 快照编码器，懒加载。
        self._legacy_env: Any = None
        self._v26_env: Any = None
        # v2.7/v2.8 快照对手（6205 维 / 54 动作）：编码用冻结环境，动作经 map_v27_action 映射。
        self._v27_env: Any = None
        # v3.0 奖励配比：塑形缩小、胜负放大，让终局信号主导。
        self.reward_win = env_reward_float("RL_REWARD_WIN", 5.0)
        self.reward_shaping_scale = env_reward_float("RL_REWARD_SHAPING_SCALE", 0.5)
        self.reward_deploy_bonus = env_reward_float("RL_REWARD_DEPLOY_BONUS", 0.0)
        self.reward_attack_bonus = env_reward_float("RL_REWARD_ATTACK_BONUS", 0.0)

        self.action_space = spaces.Discrete(MAX_ACTIONS)
        self.observation_space = spaces.Box(
            low=-1.0,
            high=1.0,
            shape=(OBSERVATION_SIZE,),
            dtype=np.float32,
        )

        self.game_id = ""
        self.owner = PLAYER
        self.opponent = OPPONENT
        self.player_token = ""
        self.opponent_token = ""
        self.host_token = ""
        self.state: dict[str, Any] = {}
        self.actions: list[tuple[str, dict[str, Any]]] = self._empty_actions()
        self.previous_score = 0.0
        self.steps = 0
        self.unit_slots: dict[str, dict[str, int]] = {PLAYER: {}, OPPONENT: {}}
        self.action_counts: dict[str, int] = {}

    def _request(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
        token: str | None = None,
        host_token: str | None = None,
    ) -> dict[str, Any]:
        headers: dict[str, str] = {}
        if token:
            headers["X-Player-Token"] = token
        if host_token:
            headers["X-Host-Token"] = host_token
        response = None
        for attempt in range(4):
            response = requests.request(
                method,
                f"{self.base_url}{path}",
                json=body,
                headers=headers,
                timeout=15,
            )
            if response.status_code != 429:
                break
            try:
                detail = response.json()
            except ValueError:
                detail = {}
            if detail.get("code") != "rate_limit" or attempt == 3:
                break
            # Handles a transient proxy/server limit. For sustained training,
            # start the local server with TACTICAL_GAME_RATE_LIMIT set higher.
            time.sleep(0.25 * (2 ** attempt))
        assert response is not None
        if not response.ok:
            try:
                detail = response.json()
            except ValueError:
                detail = response.text
            raise RuntimeError(f"{method} {path} failed: {response.status_code} {detail}")
        return response.json() if response.content else {}

    def _build_random_options(self) -> dict[str, Any]:
        """每局随机图参数：默认对称，RL_RANDOM_OPTIONS 与构造参数逐层覆盖。

        种子始终从 np_random 派生，保证 gym seed 下整条训练序列可复现；
        若显式传入了 seed 则作为固定种子使用（所有回合同一张图）。
        """
        options: dict[str, Any] = {"symmetric": True}
        raw = os.environ.get("RL_RANDOM_OPTIONS", "").strip()
        if raw:
            parsed = json.loads(raw)
            if not isinstance(parsed, dict):
                raise ValueError("RL_RANDOM_OPTIONS must be a JSON object")
            options.update(parsed)
        options.update(self.random_options)
        if "seed" not in options:
            options["seed"] = f"ep-{int(self.np_random.integers(0, 2**31 - 1))}"
        return options

    def reset(self, *, seed: int | None = None, options: dict[str, Any] | None = None):
        super().reset(seed=seed)
        body: dict[str, Any] = {
            "mapId": self.map_id,
            "maxPlayers": 2,
            "participate": True,
            "playerName": "RL Agent",
        }
        if self.map_id == "random":
            body["random"] = self._build_random_options()
        created = self._request("POST", "/api/games", body)
        self.game_id = created["gameId"]
        self.player_token = created["player"]["token"]
        self.host_token = created["hostToken"]

        joined = self._request(
            "POST",
            f"/api/games/{self.game_id}/join",
            {"name": "Random Opponent"},
        )
        self.opponent_token = joined["player"]["token"]
        self._request(
            "POST",
            f"/api/games/{self.game_id}/start",
            {},
            host_token=self.host_token,
        )

        self.state = self._get_state(self.player_token)
        self.steps = 0
        self.unit_slots = {PLAYER: {}, OPPONENT: {}}
        self.action_counts = {}
        self.active_opponent_style = self._choose_opponent_style()
        self._play_opponent_until_agent_turn()
        self.actions = self._legal_actions(self.state, self.owner)
        self.previous_score = self._score(self.state)
        return self._encode_state(self.state), {}

    def step(self, action_index: int):
        self.actions = self._legal_actions(self.state, self.owner)
        self.steps += 1

        if action_index < 0 or action_index >= len(self.actions) or not self.actions[action_index][0]:
            return self._encode_state(self.state), -0.05, False, self.steps >= self.max_steps, {"invalid": True}

        action_type, payload = self.actions[action_index]
        before = self._strategic_snapshot(self.state)
        try:
            self._apply(action_type, payload, self.player_token)
        except RuntimeError:
            # A stale/invalid candidate should be mildly penalized, not crash
            # an entire PPO rollout.
            self.state = self._get_state(self.player_token)
            return self._encode_state(self.state), -0.05, self._game_over(), False, {"invalid": True}

        # Refresh before the opponent phase: the loop below gates on
        # self.state's currentPlayerId.  Without this refresh it reads the
        # pre-action state, skips the opponent turn after the agent ends its
        # turn, and the agent then steals a bonus action on the opponent's
        # turn (the engine only checks turn ownership on end-turn).  This
        # corrupted every v2.1.7/v2.1.8 training run.
        self.state = self._get_state(self.player_token)

        # Score adjudication (control-point capture, income) settles at turn
        # boundaries, i.e. during/after the opponent response.  Settling the
        # reward after the opponent acts (like v2.0.0) keeps the dominant
        # capture signal inside the reward; settling immediately loses it to
        # the next baseline update and the agent stops contesting points.
        self._play_opponent_until_agent_turn()
        self.state = self._get_state(self.player_token)

        current_score = self._score(self.state)
        reward = float(np.clip((current_score - self.previous_score) / 100.0, -1.0, 1.0))
        reward += self._shaped_reward(before, self._strategic_snapshot(self.state), action_type) * self.reward_shaping_scale
        self.action_counts[action_type] = self.action_counts.get(action_type, 0) + 1
        self.previous_score = current_score

        terminated = self._game_over()
        if terminated:
            won = self.state.get("winner") == self.owner
            reward += self.reward_win if won else -self.reward_win
            self._record_self_play_result(won)
        truncated = self.steps >= self.max_steps and not terminated
        self.actions = self._legal_actions(self.state, self.owner) if not terminated else []
        info = {"action_type": action_type, "action_counts": dict(self.action_counts)}
        clip = max(2.0, self.reward_win + 1.0)
        return self._encode_state(self.state), float(np.clip(reward, -clip, clip)), terminated, truncated, info

    def action_masks(self) -> np.ndarray:
        """Mask used by sb3-contrib MaskablePPO."""
        return np.asarray([bool(action[0]) for action in self.actions], dtype=bool)

    @staticmethod
    def _empty_actions(size: int = MAX_ACTIONS):
        return [("", {}) for _ in range(size)]

    def _get_state(self, token: str) -> dict[str, Any]:
        return self._request("GET", f"/api/games/{self.game_id}", token=token)

    def _game_over(self) -> bool:
        return self.state.get("phase") == "game_over" or bool(self.state.get("winner"))

    def _score(self, state: dict[str, Any]) -> float:
        score = state.get("adjudication", {}).get("scores", {}).get(self.owner)
        return float(score.get("total", 0.0)) if score else 0.0

    def _apply(self, action_type: str, payload: dict[str, Any], token: str) -> None:
        endpoint = {
            "move": "/move",
            "attack": "/attack",
            "heal": "/heal",
            "deploy": "/deploy",
            "demolish": "/demolish",
            "end_turn": "/end-turn",
        }[action_type]
        self._request("POST", f"/api/games/{self.game_id}{endpoint}", payload, token=token)

    def _strategic_snapshot(self, state: dict[str, Any]) -> dict[str, float]:
        units = [u for u in state.get("units", []) if u.get("alive")]
        own_units = [u for u in units if u.get("owner") == self.owner]
        enemy_units = [u for u in units if u.get("owner") == self.opponent]
        points = state.get("controlPoints", [])
        open_points = [p for p in points if p.get("owner") != self.owner]
        capture_units = [u for u in own_units if u.get("canCapture")]
        distances = [distance(unit, point) for unit in capture_units for point in open_points]
        nearest_cp = min(distances) if distances else 0
        enemy_hp = sum(float(u.get("hp", 0)) for u in enemy_units)
        enemy_hp += sum(float(h.get("hp", 0)) for h in state.get("headquarters", {}).values() if h.get("owner") == self.opponent)
        own_hp = sum(float(u.get("hp", 0)) for u in own_units)
        own_hp += sum(float(h.get("hp", 0)) for h in state.get("headquarters", {}).values() if h.get("owner") == self.owner)
        return {
            "control_points": float(sum(p.get("owner") == self.owner for p in points)),
            "own_units": float(len(own_units)),
            "enemy_hp": enemy_hp,
            "own_hp": own_hp,
            "nearest_cp": float(nearest_cp),
        }

    def _shaped_reward(self, before: dict[str, float], after: dict[str, float], action_type: str) -> float:
        # Small dense signals teach useful direction while adjudication remains
        # the main objective.  Distance shaping is potential-based: moving
        # closer to an unowned CP is positive, moving away is negative.
        # v3.0: the fixed deploy/attack bonuses default to 0 (RL_REWARD_*_BONUS);
        # they rewarded volume of actions rather than outcomes.
        reward = (after["control_points"] - before["control_points"]) * 0.7
        reward += (before["enemy_hp"] - after["enemy_hp"]) / 100.0
        reward += (after["own_hp"] - before["own_hp"]) / 160.0
        reward += (before["nearest_cp"] - after["nearest_cp"]) * 0.025
        if action_type == "deploy":
            reward += self.reward_deploy_bonus
        elif action_type == "attack":
            reward += self.reward_attack_bonus
        elif action_type == "end_turn" and before["control_points"] == after["control_points"]:
            reward -= 0.01
        return float(np.clip(reward, -1.0, 1.0))

    @staticmethod
    def _unit_sort_key(unit: dict[str, Any]):
        return (TYPE_INDEX.get(unit.get("type"), 99), int(unit.get("q", 0)), int(unit.get("r", 0)), -int(unit.get("hp", 0)))

    def _has_model_opponent(self) -> bool:
        return self.opponent_model is not None or bool(self.opponent_model_path)

    def _ensure_opponent_model(self) -> Any:
        """模型对象存在则直接用；只传了路径时在子进程内懒加载（对象不可跨进程序列化）。"""
        if self.opponent_model is None and self.opponent_model_path:
            from sb3_contrib import MaskablePPO
            self.opponent_model = MaskablePPO.load(self.opponent_model_path, device="cpu")
        return self.opponent_model

    def _self_play_snapshots(self) -> list[str]:
        """快照阶梯：按保存时间取最近 8 个（太旧的对手太弱，只保留梯度）。

        按 mtime 而非文件名步数排序：续训时新快照的步数计数器可能低于旧快照，
        时间序才是真正的「最近」。
        """
        if not self.self_play_dir:
            return []
        try:
            files = [path for path in Path(self.self_play_dir).glob("snapshot_*_steps.zip") if path.is_file()]
        except OSError:
            return []
        files.sort(key=lambda path: path.stat().st_mtime)
        return [str(path) for path in files][-16:]

    def _has_anchor(self) -> bool:
        return bool(self.anchor_model_path) and Path(self.anchor_model_path).is_file()

    def _ensure_self_play_model(self) -> Any:
        model = self._self_play_cache.get(self._self_play_path)
        if model is None:
            from sb3_contrib import MaskablePPO
            model = MaskablePPO.load(self._self_play_path, device="cpu")
            if len(self._self_play_cache) >= 8:
                self._self_play_cache.pop(next(iter(self._self_play_cache)))
            self._self_play_cache[self._self_play_path] = model
        return model

    def _record_self_play_result(self, won: bool) -> None:
        """PFSP 记账：只统计快照阶梯对手（锚点固定出场，不参与优先级）。"""
        if self.active_opponent_style != "self" or not self._self_play_path or self._self_play_path == self.anchor_model_path:
            return
        record = self._self_play_record.setdefault(self._self_play_path, [0, 0])
        record[0] += 1
        record[1] += int(won)

    def _self_play_weights(self, snapshots: list[str]) -> np.ndarray:
        """优先虚构自对弈（PFSP）：权重 (1 - 胜率)^2，未交手的快照按 0.5 胜率对待。

        v2.6 的近期加权导致共同适应、v2.7 的均匀采样让已被打穿的旧快照白占样本；
        按“输给谁最多就多打谁”分配对局是两者之间更稳的折中。
        """
        weights = np.empty(len(snapshots), dtype=np.float64)
        for index, path in enumerate(snapshots):
            games, wins = self._self_play_record.get(path, (0, 0))
            # 拉普拉斯平滑：先验 1 胜 1 负，避免单局结果把权重推到 0 或 1。
            win_rate = (wins + 1.0) / (games + 2.0)
            weights[index] = (1.0 - win_rate) ** 2 + 1e-3
        return weights / weights.sum()

    def _choose_opponent_style(self) -> str:
        self._opponent_stochastic = (
            self.opponent_stochastic_probability > 0
            and float(self.np_random.random()) < self.opponent_stochastic_probability
        )
        if self.self_play_probability > 0 and float(self.np_random.random()) < self.self_play_probability:
            snapshots = self._self_play_snapshots()
            if snapshots:
                if self._has_anchor() and float(self.np_random.random()) < self.anchor_probability:
                    self._self_play_path = self.anchor_model_path
                else:
                    self._self_play_path = str(self.np_random.choice(snapshots, p=self._self_play_weights(snapshots)))
                # 清掉已被裁剪快照的记录，避免字典无限增长。
                live = set(snapshots)
                for stale in [path for path in self._self_play_record if path not in live]:
                    del self._self_play_record[stale]
                return "self"
            if self._has_anchor():
                # 训练早期还没有快照时，锚点直接当老师。
                self._self_play_path = self.anchor_model_path
                return "self"
        if self._has_model_opponent() and float(self.np_random.random()) < self.model_opponent_probability:
            return "model"
        if self.opponent_style != "mixed":
            return self.opponent_style
        return str(self.np_random.choice(("aggressive", "mixed")))

    def _encode_from_perspective(self, state: dict[str, Any], owner: str) -> np.ndarray:
        old_owner, old_opponent = self.owner, self.opponent
        self.owner, self.opponent = owner, (OPPONENT if owner == PLAYER else PLAYER)
        try:
            return self._encode_state(state)
        finally:
            self.owner, self.opponent = old_owner, old_opponent

    def _encode_for_legacy_model(self, state: dict[str, Any], owner: str) -> np.ndarray:
        """旧模型对手（v2.0.0，3922 维）用 env_v22 快照编码器产出相对视角观测。

        v2.3 本体的 5974 维观测对旧模型是分布外输入，直接喂会导致
        sb3 维度校验报错或行为失真；快照编码与其训练时逐格一致。
        """
        if self._legacy_env is None:
            try:
                from env_v22 import HexGameEnv as LegacyHexGameEnv
            except ImportError:  # ``python -m rl.train`` 等调用方式。
                from rl.env_v22 import HexGameEnv as LegacyHexGameEnv
            self._legacy_env = LegacyHexGameEnv(base_url="local://legacy-snapshot")
        return self._legacy_env._encode_from_perspective(state, owner)

    def _encode_for_candidate_model(self, model: Any, state: dict[str, Any], owner: str) -> np.ndarray:
        """Encode from a self-play opponent's own observation generation."""
        obs_dim = int(model.observation_space.shape[0])
        if obs_dim == OBSERVATION_SIZE:
            return self._encode_from_perspective(state, owner)
        if obs_dim == 6205:
            return self._v27_helper()._encode_from_perspective(state, owner)
        if obs_dim == 5974:
            if self._v26_env is None:
                try:
                    from env_v26 import HexGameEnv as V26HexGameEnv
                except ImportError:
                    from rl.env_v26 import HexGameEnv as V26HexGameEnv
                self._v26_env = V26HexGameEnv(base_url="local://v26-snapshot")
            return self._v26_env._encode_from_perspective(state, owner)
        if obs_dim == 3922:
            return self._encode_for_legacy_model(state, owner)
        raise ValueError(f"unsupported self-play observation size: {obs_dim}")

    def _v27_helper(self) -> Any:
        if self._v27_env is None:
            try:
                from env_v27 import HexGameEnv as V27HexGameEnv
            except ImportError:
                from rl.env_v27 import HexGameEnv as V27HexGameEnv
            self._v27_env = V27HexGameEnv(base_url="local://v27-snapshot")
        # 槽位分配共享：v2.7 与 v3.0 的 _units_for_slots 逐字相同，同一份字典保证槽位一致。
        self._v27_env.unit_slots = self.unit_slots
        return self._v27_env

    def _candidate_action_mask(self, model: Any, actions, owner: str) -> tuple[np.ndarray, int]:
        """Return (mask in the model's own action space, model action count)."""
        n_actions = int(model.action_space.n)
        if n_actions == MAX_ACTIONS:
            return np.asarray([bool(action[0]) for action in actions], dtype=bool), n_actions
        if n_actions == V27_ACTIONS:
            # v2.7 的每个动作都对应 v3.0 同槽位的候选 0，掩码按映射回收。
            mask = np.zeros(V27_ACTIONS, dtype=bool)
            for index in range(V27_ACTIONS):
                mapped = map_v27_action(index)
                mask[index] = bool(actions[mapped][0])
            return mask, n_actions
        raise ValueError(f"unsupported self-play action space: {n_actions}")

    def _units_for_slots(self, state: dict[str, Any], owner: str) -> list[dict[str, Any] | None]:
        """Keep units in stable action slots as they move or are deployed."""
        live = [u for u in state.get("units", []) if u.get("alive") and u.get("owner") == owner]
        slots = self.unit_slots.setdefault(owner, {})
        live_ids = {str(unit.get("id")) for unit in live}
        for uid in list(slots):
            if uid not in live_ids:
                del slots[uid]
        used = set(slots.values())
        for unit in sorted(live, key=self._unit_sort_key):
            uid = str(unit.get("id"))
            if uid not in slots and len(used) < MAX_UNIT_SLOTS:
                slot = next(index for index in range(MAX_UNIT_SLOTS) if index not in used)
                slots[uid] = slot
                used.add(slot)
        by_id = {str(unit.get("id")): unit for unit in live}
        result: list[dict[str, Any] | None] = [None] * MAX_UNIT_SLOTS
        for uid, slot in slots.items():
            if uid in by_id and 0 <= slot < MAX_UNIT_SLOTS:
                result[slot] = by_id[uid]
        return result

    def _best_target(self, unit: dict[str, Any], enemies: list[dict[str, Any]], hqs: list[dict[str, Any]]):
        targets = [target for target in [*enemies, *hqs] if distance(unit, target) <= int(unit.get("attackRange", 0))]
        if not targets:
            return None
        return max(targets, key=lambda target: (
            10000 if target in hqs else 0,
            int(target.get("maxHp", target.get("hp", 0))) - int(target.get("hp", 0)),
            -int(target.get("hp", 0)),
        ))

    def _attack_candidates(self, unit: dict[str, Any], enemies: list[dict[str, Any]], hqs: list[dict[str, Any]]) -> list[dict[str, Any] | None]:
        """v3.0: ATTACK_CANDIDATES distinct targets in range.

        0 = legacy heuristic (HQ first, then most damaged); 1 = lowest HP unit
        target (finish kills); 2 = highest attack unit target (remove threats).
        Duplicates of an earlier candidate are left empty so every index is a
        genuinely different choice.
        """
        result: list[dict[str, Any] | None] = [None] * ATTACK_CANDIDATES
        in_range = [target for target in [*enemies, *hqs] if distance(unit, target) <= int(unit.get("attackRange", 0))]
        if not in_range:
            return result
        result[0] = self._best_target(unit, enemies, hqs)
        units_in_range = [target for target in in_range if target not in hqs]
        chosen = {id(result[0])}
        if units_in_range:
            lowest = min(units_in_range, key=lambda target: (int(target.get("hp", 0)), -int(target.get("attack", 0))))
            if id(lowest) not in chosen:
                result[1] = lowest
                chosen.add(id(lowest))
            strongest = max(units_in_range, key=lambda target: (int(target.get("attack", 0)), -int(target.get("hp", 0))))
            if id(strongest) not in chosen:
                result[2] = strongest
                chosen.add(id(strongest))
        return result

    def _movement_goal(self, unit: dict[str, Any], state: dict[str, Any], owner: str):
        points = [p for p in state.get("controlPoints", []) if p.get("owner") != owner]
        if points and unit.get("canCapture"):
            return min(points, key=lambda point: (distance(unit, point), -int(point.get("q", 0))))
        enemies = [u for u in state.get("units", []) if u.get("alive") and u.get("owner") != owner]
        hqs = [h for h in state.get("headquarters", {}).values() if h.get("alive") and h.get("owner") != owner]
        return min([*enemies, *hqs], key=lambda target: distance(unit, target), default=unit)

    def _can_move(self, unit: dict[str, Any], state: dict[str, Any]) -> bool:
        if unit.get("hasMoved"):
            return False
        actions_used = int(state.get("turn", {}).get("actionsUsed", 0))
        ap_limit = int(state.get("config", {}).get("balance", {}).get("actionsPerTurn", 5))
        return bool(unit.get("actionSpent")) or actions_used < ap_limit

    def _fixed_move(self, unit: dict[str, Any], state: dict[str, Any], owner: str, cells, occupied, legacy: bool = False):
        if not self._can_move(unit, state):
            return None
        goal = self._movement_goal(unit, state, owner)
        start = key(int(unit["q"]), int(unit["r"]))
        move_range = int(unit.get("moveRange", 0))
        reachable = self._reachable(cells, occupied, start, move_range)
        if not reachable:
            return None
        if legacy:
            # v2.0.0 训练时的移动规则：只允许严格接近目标，不允许绕路。
            current_distance = distance(unit, goal)
            candidates = [pos for pos in reachable if distance({"q": pos[0], "r": pos[1]}, goal) < current_distance]
            if not candidates:
                return None
            pos = min(candidates, key=lambda candidate: distance({"q": candidate[0], "r": candidate[1]}, goal))
            return {"unitId": unit["id"], "q": pos[0], "r": pos[1]}
        # Move directly to the reachable square closest to the strategic goal.
        # `_reachable` already BFS-es around blockers/water, so detours are
        # supported.  The engine teleports the unit to any reachable cell in
        # one action; emitting only the first step wastes AP and slows the
        # agent 3-5x compared to the v2.0.0 movement semantics.
        pos = min(reachable, key=lambda candidate: (distance({"q": candidate[0], "r": candidate[1]}, goal), candidate[0], candidate[1]))
        return {"unitId": unit["id"], "q": pos[0], "r": pos[1]}

    def _move_candidates(self, unit: dict[str, Any], state: dict[str, Any], owner: str, cells, occupied) -> list[dict[str, Any] | None]:
        """v3.0: MOVE_CANDIDATES destinations.

        0 = legacy goal-seeking cell; 1..6 = the reachable cell that projects
        farthest along hex direction d (cube-coordinate dot product), so the
        policy can retreat, flank or hold instead of only rushing the nearest
        control point.  Cells identical to an earlier candidate are dropped so
        indices stay distinct.
        """
        result: list[dict[str, Any] | None] = [None] * MOVE_CANDIDATES
        if not self._can_move(unit, state):
            return result
        start = key(int(unit["q"]), int(unit["r"]))
        reachable = self._reachable(cells, occupied, start, int(unit.get("moveRange", 0)))
        if not reachable:
            return result
        goal = self._movement_goal(unit, state, owner)
        legacy_pos = min(reachable, key=lambda candidate: (distance({"q": candidate[0], "r": candidate[1]}, goal), candidate[0], candidate[1]))
        result[0] = {"unitId": unit["id"], "q": legacy_pos[0], "r": legacy_pos[1]}
        taken = {legacy_pos}
        sx, sy, sz = _cube(*start)
        for direction, (dq, dr) in enumerate(HEX_DIRECTIONS):
            dx, dy, dz = _cube(dq, dr)
            best = None
            best_key = None
            for pos in reachable:
                px, py, pz = _cube(*pos)
                projection = (px - sx) * dx + (py - sy) * dy + (pz - sz) * dz
                if projection <= 0:
                    continue
                # Farthest along the axis first, then closest to the axis,
                # then a stable coordinate tiebreak.
                off_axis = distance({"q": pos[0], "r": pos[1]}, {"q": start[0], "r": start[1]}) * 2 - projection
                candidate_key = (projection, -off_axis, -pos[0], -pos[1])
                if best_key is None or candidate_key > best_key:
                    best, best_key = pos, candidate_key
            if best is None or best in taken:
                continue
            taken.add(best)
            result[1 + direction] = {"unitId": unit["id"], "q": best[0], "r": best[1]}
        return result

    def _deploy_candidates(self, state: dict[str, Any], owner: str, unit_type: str) -> list[dict[str, Any] | None]:
        """v3.0: DEPLOY_CANDIDATES spawn cells.

        0 = legacy (free cell adjacent to an owned origin, closest to the enemy
        HQ); 1 = the free adjacent cell closest to the nearest unowned control
        point (economy-first opening).  Identical cells collapse into 0.
        """
        result: list[dict[str, Any] | None] = [None] * DEPLOY_CANDIDATES
        resources = state.get("resources", {}).get(owner, {}).get("supplies", 0)
        spec = state.get("config", {}).get("units", {}).get(unit_type)
        if not spec or resources < int(spec.get("cost", 10)):
            return result
        origins = []
        hq = state.get("headquarters", {}).get(owner)
        if hq and hq.get("alive"):
            origins.append(hq)
        origins.extend(p for p in state.get("controlPoints", []) if p.get("owner") == owner)
        cells = {key(int(c["q"]), int(c["r"])): c for c in state.get("cells", [])}
        occupied = {(int(u["q"]), int(u["r"])) for u in state.get("units", []) if u.get("alive")}
        occupied.update((int(h["q"]), int(h["r"])) for h in state.get("headquarters", {}).values() if h.get("alive"))
        enemy_hq = next((h for h in state.get("headquarters", {}).values() if h.get("owner") != owner), {"q": 0, "r": 0})
        open_points = [p for p in state.get("controlPoints", []) if p.get("owner") != owner]
        candidates = []
        for origin in origins:
            for dq, dr in HEX_DIRECTIONS:
                pos = (int(origin["q"]) + dq, int(origin["r"]) + dr)
                cell = cells.get(pos)
                if cell and cell.get("terrain", "plain") == "plain" and pos not in occupied:
                    candidates.append((origin, pos))
        if not candidates:
            return result
        origin, pos = min(candidates, key=lambda item: distance({"q": item[1][0], "r": item[1][1]}, enemy_hq))
        result[0] = {"unitType": unit_type, "fromId": origin["id"], "q": pos[0], "r": pos[1]}
        if open_points:
            def cp_distance(item):
                here = {"q": item[1][0], "r": item[1][1]}
                return (min(distance(here, point) for point in open_points), item[1][0], item[1][1])
            origin2, pos2 = min(candidates, key=cp_distance)
            if pos2 != pos:
                result[1] = {"unitType": unit_type, "fromId": origin2["id"], "q": pos2[0], "r": pos2[1]}
        return result

    def _fixed_deploy(self, state: dict[str, Any], owner: str, unit_type: str):
        return self._deploy_candidates(state, owner, unit_type)[0]

    def _play_opponent_until_agent_turn(self) -> None:
        """Use a simple goal-directed rule policy for player_b."""
        guard = 0
        while not self._game_over() and self.state.get("turn", {}).get("currentPlayerId") != self.owner:
            guard += 1
            if guard > 100:
                raise RuntimeError("opponent turn did not finish")
            actions = self._legal_actions(self.state, self.opponent)
            valid = [(index, action) for index, action in enumerate(actions) if action[0]]
            if not valid:
                break
            attacks = [(index, action) for index, action in valid if action[0] == "attack"]
            heals = [(index, action) for index, action in valid if action[0] == "heal"]
            deploys = [(index, action) for index, action in valid if action[0] == "deploy"]
            moves = [(index, action) for index, action in valid if action[0] == "move"]
            self_play_move = None
            if self.active_opponent_style == "self":
                self_play_move = self._self_play_pick(actions)
            if self_play_move is not None:
                index, (action_type, payload) = self_play_move
            elif self.active_opponent_style == "model" and self._has_model_opponent():
                opponent_model = self._ensure_opponent_model()
                # 旧模型按它训练时的 38 动作语义行动（逐步排序分槽、严格接近移动），
                # 观测用对手相对视角编码，动作直接取旧动作表，不再经过当前槽位映射。
                legacy_actions = self._legal_actions(self.state, self.opponent, legacy=True)
                legacy_mask = np.asarray([bool(action[0]) for action in legacy_actions], dtype=bool)
                observation = self._encode_for_legacy_model(self.state, self.opponent)
                legacy_action, _ = opponent_model.predict(
                    observation, deterministic=True, action_masks=legacy_mask
                )
                action_type, payload = legacy_actions[int(legacy_action)]
                if not action_type:
                    self.active_opponent_style = "mixed"
                    index, (action_type, payload) = valid[0]
            else:
                supplies = self.state.get("resources", {}).get(self.opponent, {}).get("supplies", 0)
                if self.active_opponent_style == "aggressive":
                    priority = [attacks, moves, deploys if supplies >= 60 else [], heals]
                elif self.active_opponent_style == "defensive":
                    priority = [attacks, heals, deploys if supplies >= 70 else [], moves]
                else:  # economy/mixed
                    priority = [deploys if supplies >= 90 else [], moves, attacks, heals]
                index, (action_type, payload) = next((group[0] for group in priority if group), valid[0])
            try:
                self._apply(action_type, payload, self.opponent_token)
            except RuntimeError as error:
                if "rate_limit" in str(error):
                    raise
                try:
                    self._apply("end_turn", {}, self.opponent_token)
                except RuntimeError as fallback_error:
                    # A stale action can coincide with the game ending (e.g.
                    # HQ destroyed by the agent's last move); the loop guard
                    # below exits once state shows game_over.
                    if "rate_limit" in str(fallback_error):
                        raise
            self.state = self._get_state(self.player_token)

    def _self_play_pick(self, actions):
        """自对弈快照对手的当前动作；失败（快照被清理/损坏）时降级为 mixed 规则。

        快照与当前环境同为 v2.3 系（54 动作、稳定槽位、同套编码），
        直接按对手视角编码后用当前动作表行动，无需 legacy 分支。
        """
        try:
            model = self._ensure_self_play_model()
            mask, n_actions = self._candidate_action_mask(model, actions, self.opponent)
            observation = self._encode_for_candidate_model(model, self.state, self.opponent)
            action_index, _ = model.predict(observation, deterministic=not self._opponent_stochastic, action_masks=mask)
            index = int(action_index)
            if n_actions == V27_ACTIONS:
                index = map_v27_action(index)
            if index >= len(actions) or not actions[index][0]:
                index = 0  # end_turn 永远合法。
            return index, actions[index]
        except Exception:
            self.active_opponent_style = "mixed"
            self._self_play_path = ""
            return None

    def _legal_actions(self, state: dict[str, Any], owner: str, legacy: bool = False):
        """legacy=True 时复现 v2.0.0 的 38 动作语义，供旧模型对手使用。

        v2.0.0 每步按排序取前 8 个单位分槽，移动要求严格接近目标；
        与当前的 12 个稳定槽位和绕路移动不兼容，不能直接按下标映射。
        """
        if legacy:
            return self._legal_actions_legacy(state, owner)
        if state.get("phase") == "game_over":
            return self._empty_actions()

        units = self._units_for_slots(state, owner)
        enemies = [u for u in state.get("units", []) if u.get("alive") and u.get("owner") != owner]
        hqs = [hq for hq in state.get("headquarters", {}).values() if hq.get("alive") and hq.get("owner") != owner]
        cells = {key(int(c["q"]), int(c["r"])): c for c in state.get("cells", [])}
        occupied = {(int(u["q"]), int(u["r"])) for u in state.get("units", []) if u.get("alive")}
        occupied.update((int(h["q"]), int(h["r"])) for h in state.get("headquarters", {}).values() if h.get("alive"))
        actions_used = int(state.get("turn", {}).get("actionsUsed", 0))
        ap_limit = int(state.get("config", {}).get("balance", {}).get("actionsPerTurn", 5))
        actions = self._empty_actions(MAX_ACTIONS)
        actions[0] = ("end_turn", {})

        def can_activate(unit):
            return bool(unit.get("actionSpent")) or actions_used < ap_limit

        for slot, unit in enumerate(units):
            if unit is None:
                continue
            base = 1 + slot * SLOT_ACTIONS
            if can_activate(unit):
                for index, move in enumerate(self._move_candidates(unit, state, owner, cells, occupied)):
                    if move:
                        actions[base + MOVE_OFFSET + index] = ("move", move)
            if not unit.get("hasActed") and can_activate(unit):
                for index, target in enumerate(self._attack_candidates(unit, enemies, hqs)):
                    if target:
                        actions[base + ATTACK_OFFSET + index] = ("attack", {"attackerId": unit["id"], "targetId": target["id"]})
                if unit.get("type") == "support":
                    heal_range = int(state.get("config", {}).get("units", {}).get("support", {}).get("healRange", unit.get("attackRange", 0)))
                    wounded = [
                        u for u in units
                        if u is not None
                        and u["id"] != unit["id"]
                        and int(u["hp"]) < int(u["maxHp"])
                        and distance(unit, u) <= heal_range
                    ]
                    if wounded:
                        target = max(wounded, key=lambda candidate: int(candidate["maxHp"]) - int(candidate["hp"]))
                        actions[base + HEAL_OFFSET] = ("heal", {"supportId": unit["id"], "targetId": target["id"]})
                if unit.get("type") == "heavy":
                    start = key(int(unit["q"]), int(unit["r"]))
                    for dq, dr in HEX_DIRECTIONS:
                        pos = (start[0] + dq, start[1] + dr)
                        cell = cells.get(pos)
                        if cell and cell.get("terrain") == "blocker" and pos not in occupied:
                            actions[base + SPECIAL_OFFSET] = ("demolish", {"unitId": unit["id"], "q": pos[0], "r": pos[1]})
                            break

        if actions_used < ap_limit:
            for type_index, unit_type in enumerate(DEPLOY_SLOTS):
                for index, payload in enumerate(self._deploy_candidates(state, owner, unit_type)):
                    if payload:
                        actions[DEPLOY_BASE + type_index * DEPLOY_CANDIDATES + index] = ("deploy", payload)
        return actions

    def _legal_actions_legacy(self, state: dict[str, Any], owner: str):
        """v2.0.0 的 38 动作表（8 排序槽 × 4 意图 + 5 部署），供 modelmix 旧对手使用。"""
        if state.get("phase") == "game_over":
            return self._empty_actions(38)
        units = sorted((u for u in state.get("units", []) if u.get("alive") and u.get("owner") == owner), key=self._unit_sort_key)[:8]
        enemies = [u for u in state.get("units", []) if u.get("alive") and u.get("owner") != owner]
        hqs = [hq for hq in state.get("headquarters", {}).values() if hq.get("alive") and hq.get("owner") != owner]
        cells = {key(int(c["q"]), int(c["r"])): c for c in state.get("cells", [])}
        occupied = {(int(u["q"]), int(u["r"])) for u in state.get("units", []) if u.get("alive")}
        occupied.update((int(h["q"]), int(h["r"])) for h in state.get("headquarters", {}).values() if h.get("alive"))
        actions_used = int(state.get("turn", {}).get("actionsUsed", 0))
        ap_limit = int(state.get("config", {}).get("balance", {}).get("actionsPerTurn", 5))
        actions = self._empty_actions(1 + 8 * len(UNIT_INTENTS) + len(DEPLOY_SLOTS))
        actions[0] = ("end_turn", {})

        def can_activate(unit):
            return bool(unit.get("actionSpent")) or actions_used < ap_limit

        for slot, unit in enumerate(units):
            base = 1 + slot * len(UNIT_INTENTS)
            if can_activate(unit):
                move = self._fixed_move(unit, state, owner, cells, occupied, legacy=True)
                if move:
                    actions[base + 0] = ("move", move)
            if not unit.get("hasActed") and can_activate(unit):
                target = self._best_target(unit, enemies, hqs)
                if target:
                    actions[base + 1] = ("attack", {"attackerId": unit["id"], "targetId": target["id"]})
                if unit.get("type") == "support":
                    heal_range = int(state.get("config", {}).get("units", {}).get("support", {}).get("healRange", unit.get("attackRange", 0)))
                    wounded = [u for u in units if u["id"] != unit["id"] and int(u["hp"]) < int(u["maxHp"]) and distance(unit, u) <= heal_range]
                    if wounded:
                        target = max(wounded, key=lambda candidate: int(candidate["maxHp"]) - int(candidate["hp"]))
                        actions[base + 2] = ("heal", {"supportId": unit["id"], "targetId": target["id"]})
                if unit.get("type") == "heavy":
                    start = key(int(unit["q"]), int(unit["r"]))
                    for dq, dr in HEX_DIRECTIONS:
                        pos = (start[0] + dq, start[1] + dr)
                        cell = cells.get(pos)
                        if cell and cell.get("terrain") == "blocker" and pos not in occupied:
                            actions[base + 3] = ("demolish", {"unitId": unit["id"], "q": pos[0], "r": pos[1]})
                            break
        if actions_used < ap_limit:
            for index, unit_type in enumerate(DEPLOY_SLOTS):
                payload = self._fixed_deploy(state, owner, unit_type)
                if payload:
                    actions[1 + 8 * len(UNIT_INTENTS) + index] = ("deploy", payload)
        return actions

    @staticmethod
    def _reachable(cells, occupied, start, move_range):
        visited = {start}
        queue = deque([(start, 0)])
        result = []
        while queue:
            pos, depth = queue.popleft()
            if depth >= move_range:
                continue
            for dq, dr in HEX_DIRECTIONS:
                nxt = (pos[0] + dq, pos[1] + dr)
                if nxt in visited:
                    continue
                visited.add(nxt)
                cell = cells.get(nxt)
                if not cell or cell.get("terrain", "plain") != "plain" or nxt in occupied:
                    continue
                result.append(nxt)
                queue.append((nxt, depth + 1))
        return result

    def _encode_state(self, state: dict[str, Any]) -> np.ndarray:
        result = np.zeros(OBSERVATION_SIZE, dtype=np.float32)
        units = [u for u in state.get("units", []) if u.get("alive")]
        control_points = state.get("controlPoints", [])
        hqs = list(state.get("headquarters", {}).values())
        terrain_index = {"plain": 0, "water": 1, "blocker": 2}
        # 位置索引一次建好；setdefault 保留“取第一个匹配”的旧语义，编码逐位等价。
        point_at: dict[tuple[int, int], dict[str, Any]] = {}
        for point in control_points:
            point_at.setdefault((point["q"], point["r"]), point)
        unit_at: dict[tuple[int, int], dict[str, Any]] = {}
        for unit in units:
            unit_at.setdefault((unit["q"], unit["r"]), unit)
        hq_at: dict[tuple[int, int], dict[str, Any]] = {}
        for hq in hqs:
            hq_at.setdefault((hq["q"], hq["r"]), hq)

        for cell in state.get("cells", []):
            index = CANONICAL_INDEX.get((int(cell["q"]), int(cell["r"])))
            if index is None:
                continue
            offset = index * CELL_FEATURES
            terrain = terrain_index.get(cell.get("terrain", "plain"), 0)
            result[offset + terrain] = 1.0

            pos = (cell["q"], cell["r"])
            point = point_at.get(pos)
            cp_owner = point.get("owner") if point else None
            result[offset + 3 + (1 if cp_owner == self.owner else 2 if cp_owner else 0)] = 1.0

            unit = unit_at.get(pos)
            hq = hq_at.get(pos)
            if unit:
                result[offset + 6 + (1 if unit["owner"] == self.owner else 2)] = 1.0
                result[offset + 9 + TYPE_INDEX.get(unit.get("type"), 0)] = 1.0
                result[offset + 14] = float(unit.get("hp", 0)) / max(1.0, float(unit.get("maxHp", 1)))
                result[offset + 15] = float(bool(unit.get("hasMoved")))
                result[offset + 16] = float(bool(unit.get("hasActed")))
                # 槽 17：归一化攻击力，随机兵种数值因此可被感知。
                result[offset + 17] = float(unit.get("attack", 0)) / 60.0
            elif hq:
                result[offset + 6 + (1 if hq["owner"] == self.owner else 2)] = 1.0
                result[offset + 17] = float(hq.get("defense", 0)) / 15.0

        base = MAX_CELLS * CELL_FEATURES
        config = state.get("config", {})
        balance = config.get("balance", {})
        # 随机地图的回合/行动点/经济参数逐局变化，归一化除数改读本局配置。
        ap_limit = max(1.0, float(balance.get("actionsPerTurn", 5)))
        max_turns = max(1.0, float(balance.get("maxTurns", 20)))
        supply_scale = max(300.0, 2.5 * float(balance.get("startingSupplies", 80)))
        hq_hp_scale = max(1.0, float(config.get("headquartersSpec", {}).get("hp", 180)))
        own = state.get("resources", {}).get(self.owner, {}).get("supplies", 0)
        other = state.get("resources", {}).get(self.opponent, {}).get("supplies", 0)
        own_hq = state.get("headquarters", {}).get(self.owner, {})
        enemy_hq = state.get("headquarters", {}).get(self.opponent, {})
        cells_list = state.get("cells", [])
        impassable = sum(1 for c in cells_list if c.get("terrain", "plain") != "plain")
        values = [
            float(own) / supply_scale, float(other) / supply_scale,
            float(own_hq.get("hp", 0)) / hq_hp_scale,
            float(enemy_hq.get("hp", 0)) / hq_hp_scale,
            float(state.get("turn", {}).get("roundNumber", 1)) / max_turns,
            float(state.get("turn", {}).get("actionsUsed", 0)) / ap_limit,
            sum(p.get("owner") == self.owner for p in control_points) / max(1, len(control_points)),
            sum(p.get("owner") == self.opponent for p in control_points) / max(1, len(control_points)),
            sum(u.get("owner") == self.owner for u in units) / 20.0,
            sum(u.get("owner") == self.opponent for u in units) / 20.0,
            float(config.get("radius", 8)) / 10.0,
            impassable / max(1, len(cells_list)),
        ]
        result[base:base + len(values)] = np.clip(values, -1.0, 1.0)
        slot_base = base + GLOBAL_FEATURES
        own_slots = self._units_for_slots(state, self.owner)
        for slot, unit in enumerate(own_slots):
            if unit is None:
                continue
            offset = slot_base + slot * SLOT_FEATURES
            unit_type = TYPE_INDEX.get(unit.get("type"), 0)
            result[offset] = 1.0
            result[offset + 1 + unit_type] = 1.0
            result[offset + 6] = float(unit.get("q", 0)) / 10.0
            result[offset + 7] = float(unit.get("r", 0)) / 10.0
            result[offset + 8] = float(unit.get("hp", 0)) / max(1.0, float(unit.get("maxHp", 1)))
            result[offset + 9] = float(bool(unit.get("hasMoved")))
            result[offset + 10] = float(bool(unit.get("hasActed")))
            result[offset + 11] = float(bool(unit.get("actionSpent")))
            result[offset + 12] = float(unit.get("attack", 0)) / 60.0
            result[offset + 13] = float(unit.get("moveRange", 0)) / 8.0
            result[offset + 14] = float(unit.get("attackRange", 0)) / 6.0

        rule_base = slot_base + MAX_UNIT_SLOTS * SLOT_FEATURES
        unit_specs = config.get("units", {})
        for index, unit_type in enumerate(UNIT_TYPES):
            spec = unit_specs.get(unit_type, {})
            offset = rule_base + index * RULE_FEATURES_PER_UNIT
            rule_values = [
                float(spec.get("hp", 0)) / 200.0,
                float(spec.get("attack", 0)) / 60.0,
                float(spec.get("defense", 0)) / 20.0,
                float(spec.get("moveRange", 0)) / 8.0,
                float(spec.get("attackRange", 0)) / 6.0,
                float(spec.get("cost", 0)) / 150.0,
                float(spec.get("healPower", 0)) / 60.0,
                float(bool(spec.get("canCapture"))),
            ]
            result[offset:offset + RULE_FEATURES_PER_UNIT] = rule_values

        global_rule_base = rule_base + len(UNIT_TYPES) * RULE_FEATURES_PER_UNIT
        weights = balance.get("adjudicationWeights", {})
        global_rule_values = [
            float(balance.get("startingSupplies", 0)) / 150.0,
            float(balance.get("baseIncome", 0)) / 30.0,
            float(balance.get("controlPointIncome", 0)) / 30.0,
            float(balance.get("damageVarianceRange", 0)) / 10.0,
            float(balance.get("healVarianceRange", 0)) / 15.0,
            float(config.get("headquartersSpec", {}).get("defense", 0)) / 20.0,
            float(weights.get("enemyHqDamage", 0)) / 100.0,
            float(weights.get("ownHqHp", 0)) / 100.0,
            float(weights.get("controlPoint", 0)) / 100.0,
            float(weights.get("armyValue", 0)) / 100.0,
            float(weights.get("supplies", 0)) / 100.0,
        ]
        result[global_rule_base:global_rule_base + GLOBAL_RULE_FEATURES] = global_rule_values

        # v3.0 candidate descriptors: ground every action index in the observation.
        candidate_base = global_rule_base + GLOBAL_RULE_FEATURES
        self._encode_candidates(result, candidate_base, state, own_slots, units, hqs, control_points)
        result[slot_base:] = np.clip(result[slot_base:], -1.0, 1.0)
        return result

    def _encode_candidates(self, result: np.ndarray, base: int, state: dict[str, Any], own_slots, units, hqs, control_points) -> None:
        owner = self.owner
        enemies = [u for u in units if u.get("owner") != owner]
        enemy_hqs = [hq for hq in hqs if hq.get("alive") and hq.get("owner") != owner]
        hq_ids = {str(hq.get("id")) for hq in enemy_hqs}
        cells = {key(int(c["q"]), int(c["r"])): c for c in state.get("cells", [])}
        occupied = {(int(u["q"]), int(u["r"])) for u in units}
        occupied.update((int(h["q"]), int(h["r"])) for h in hqs if h.get("alive"))
        open_points = [p for p in control_points if p.get("owner") != owner]

        def cp_distance(q: int, r: int) -> float:
            if not open_points:
                return 1.0
            return min(distance({"q": q, "r": r}, point) for point in open_points) / 10.0

        game_over = state.get("phase") == "game_over"
        actions_used = int(state.get("turn", {}).get("actionsUsed", 0))
        ap_limit = int(state.get("config", {}).get("balance", {}).get("actionsPerTurn", 5))
        for slot, unit in enumerate(own_slots):
            if unit is None or game_over:
                continue
            offset = base + slot * SLOT_CANDIDATE_FEATURES
            for index, move in enumerate(self._move_candidates(unit, state, owner, cells, occupied)):
                if not move:
                    continue
                at = offset + index * MOVE_CANDIDATE_FEATURES
                result[at] = 1.0
                result[at + 1] = float(move["q"]) / 10.0
                result[at + 2] = float(move["r"]) / 10.0
                result[at + 3] = cp_distance(int(move["q"]), int(move["r"]))
            attack_offset = offset + MOVE_CANDIDATES * MOVE_CANDIDATE_FEATURES
            if unit.get("hasActed") or not (bool(unit.get("actionSpent")) or actions_used < ap_limit):
                continue
            for index, target in enumerate(self._attack_candidates(unit, enemies, enemy_hqs)):
                if not target:
                    continue
                at = attack_offset + index * ATTACK_CANDIDATE_FEATURES
                result[at] = 1.0
                result[at + 1] = float(target.get("hp", 0)) / max(1.0, float(target.get("maxHp", target.get("hp", 1)) or 1))
                result[at + 2] = float(target.get("attack", 0)) / 60.0
                result[at + 3] = float(str(target.get("id")) in hq_ids)

        deploy_base = base + MAX_UNIT_SLOTS * SLOT_CANDIDATE_FEATURES
        if game_over or actions_used >= ap_limit:
            return
        for type_index, unit_type in enumerate(DEPLOY_SLOTS):
            for index, payload in enumerate(self._deploy_candidates(state, owner, unit_type)):
                if not payload:
                    continue
                at = deploy_base + (type_index * DEPLOY_CANDIDATES + index) * DEPLOY_CANDIDATE_FEATURES
                result[at] = 1.0
                result[at + 1] = float(payload["q"]) / 10.0
                result[at + 2] = float(payload["r"]) / 10.0
