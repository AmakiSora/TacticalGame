"""Gymnasium environment for the standard two-player REST game.

This environment targets ordinary two-player sequential maps.  The local
training wrapper runs the same logic against the in-process TypeScript engine.
"""

from __future__ import annotations

from collections import deque
import time
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

# default is a radius-8 board (217 cells).  Padding keeps the observation and
# action spaces fixed while the encoder still uses the authoritative game.cells.
MAX_CELLS = 217
CELL_FEATURES = 18
GLOBAL_FEATURES = 16
OBSERVATION_SIZE = MAX_CELLS * CELL_FEATURES + GLOBAL_FEATURES
# Stable intent slots.  Slot numbers have the same meaning in every state:
# 0=end turn; then 12 unit slots x 4 intents; then 5 deploy-type slots.
MAX_UNIT_SLOTS = 12
UNIT_INTENTS = ("move", "attack", "heal", "special")
DEPLOY_SLOTS = UNIT_TYPES
MAX_ACTIONS = 1 + MAX_UNIT_SLOTS * len(UNIT_INTENTS) + len(DEPLOY_SLOTS)


def key(q: int, r: int) -> tuple[int, int]:
    return q, r


def distance(a: dict[str, Any], b: dict[str, Any]) -> int:
    dq = int(a["q"]) - int(b["q"])
    dr = int(a["r"]) - int(b["r"])
    return max(abs(dq), abs(dr), abs(-dq - dr))


class HexGameEnv(gym.Env):
    """One RL player versus a configurable goal-directed rule opponent."""

    metadata = {"render_modes": []}

    def __init__(self, base_url: str = "http://127.0.0.1:3100", max_steps: int = 500, opponent_style: str = "mixed", opponent_model: Any | None = None, model_opponent_probability: float = 0.5):
        super().__init__()
        self.base_url = base_url.rstrip("/")
        self.max_steps = max_steps
        if opponent_style not in {"mixed", "aggressive", "defensive", "economy"}:
            raise ValueError("opponent_style must be mixed, aggressive, defensive, or economy")
        if not 0.0 <= model_opponent_probability <= 1.0:
            raise ValueError("model_opponent_probability must be between 0 and 1")
        self.opponent_style = opponent_style
        self.opponent_model = opponent_model
        self.model_opponent_probability = model_opponent_probability
        self.active_opponent_style = opponent_style

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

    def reset(self, *, seed: int | None = None, options: dict[str, Any] | None = None):
        super().reset(seed=seed)
        created = self._request(
            "POST",
            "/api/games",
            {
                "mapId": "default",
                "maxPlayers": 2,
                "participate": True,
                "playerName": "RL Agent",
            },
        )
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

        # Score adjudication (control-point capture, income) settles at turn
        # boundaries, i.e. during/after the opponent response.  Settling the
        # reward after the opponent acts (like v2.0.0) keeps the dominant
        # capture signal inside the reward; settling immediately loses it to
        # the next baseline update and the agent stops contesting points.
        self._play_opponent_until_agent_turn()
        self.state = self._get_state(self.player_token)

        current_score = self._score(self.state)
        reward = float(np.clip((current_score - self.previous_score) / 100.0, -1.0, 1.0))
        reward += self._shaped_reward(before, self._strategic_snapshot(self.state), action_type)
        self.action_counts[action_type] = self.action_counts.get(action_type, 0) + 1
        self.previous_score = current_score

        terminated = self._game_over()
        if terminated:
            reward += 1.0 if self.state.get("winner") == self.owner else -1.0
        truncated = self.steps >= self.max_steps and not terminated
        self.actions = self._legal_actions(self.state, self.owner) if not terminated else []
        info = {"action_type": action_type, "action_counts": dict(self.action_counts)}
        return self._encode_state(self.state), float(np.clip(reward, -2.0, 2.0)), terminated, truncated, info

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

    @staticmethod
    def _shaped_reward(before: dict[str, float], after: dict[str, float], action_type: str) -> float:
        # Small dense signals teach useful direction while adjudication remains
        # the main objective.  Distance shaping is potential-based: moving
        # closer to an unowned CP is positive, moving away is negative.
        reward = (after["control_points"] - before["control_points"]) * 0.7
        reward += (before["enemy_hp"] - after["enemy_hp"]) / 100.0
        reward += (after["own_hp"] - before["own_hp"]) / 160.0
        reward += (before["nearest_cp"] - after["nearest_cp"]) * 0.025
        if action_type == "deploy":
            reward += 0.12
        elif action_type == "attack":
            reward += 0.05
        elif action_type == "end_turn" and before["control_points"] == after["control_points"]:
            reward -= 0.01
        return float(np.clip(reward, -1.0, 1.0))

    @staticmethod
    def _unit_sort_key(unit: dict[str, Any]):
        return (TYPE_INDEX.get(unit.get("type"), 99), int(unit.get("q", 0)), int(unit.get("r", 0)), -int(unit.get("hp", 0)))

    def _choose_opponent_style(self) -> str:
        if self.opponent_model is not None and float(self.np_random.random()) < self.model_opponent_probability:
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

    def _movement_goal(self, unit: dict[str, Any], state: dict[str, Any], owner: str):
        points = [p for p in state.get("controlPoints", []) if p.get("owner") != owner]
        if points and unit.get("canCapture"):
            return min(points, key=lambda point: (distance(unit, point), -int(point.get("q", 0))))
        enemies = [u for u in state.get("units", []) if u.get("alive") and u.get("owner") != owner]
        hqs = [h for h in state.get("headquarters", {}).values() if h.get("alive") and h.get("owner") != owner]
        return min([*enemies, *hqs], key=lambda target: distance(unit, target), default=unit)

    def _fixed_move(self, unit: dict[str, Any], state: dict[str, Any], owner: str, cells, occupied, legacy: bool = False):
        if unit.get("hasMoved") or not (unit.get("actionSpent") or int(state.get("turn", {}).get("actionsUsed", 0)) < int(state.get("config", {}).get("balance", {}).get("actionsPerTurn", 5))):
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

    def _fixed_deploy(self, state: dict[str, Any], owner: str, unit_type: str):
        resources = state.get("resources", {}).get(owner, {}).get("supplies", 0)
        spec = state.get("config", {}).get("units", {}).get(unit_type)
        if not spec or resources < int(spec.get("cost", 10)):
            return None
        origins = []
        hq = state.get("headquarters", {}).get(owner)
        if hq and hq.get("alive"):
            origins.append(hq)
        origins.extend(p for p in state.get("controlPoints", []) if p.get("owner") == owner)
        cells = {key(int(c["q"]), int(c["r"])): c for c in state.get("cells", [])}
        occupied = {(int(u["q"]), int(u["r"])) for u in state.get("units", []) if u.get("alive")}
        occupied.update((int(h["q"]), int(h["r"])) for h in state.get("headquarters", {}).values() if h.get("alive"))
        enemy_hq = next((h for h in state.get("headquarters", {}).values() if h.get("owner") != owner), {"q": 0, "r": 0})
        candidates = []
        for origin in origins:
            for dq, dr in HEX_DIRECTIONS:
                pos = (int(origin["q"]) + dq, int(origin["r"]) + dr)
                cell = cells.get(pos)
                if cell and cell.get("terrain", "plain") == "plain" and pos not in occupied:
                    candidates.append((distance({"q": pos[0], "r": pos[1]}, enemy_hq), origin, pos))
        if not candidates:
            return None
        _, origin, pos = min(candidates, key=lambda item: item[0])
        return {"unitType": unit_type, "fromId": origin["id"], "q": pos[0], "r": pos[1]}

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
            if self.active_opponent_style == "model" and self.opponent_model is not None:
                # 旧模型按它训练时的 38 动作语义行动（逐步排序分槽、严格接近移动），
                # 观测用对手相对视角编码，动作直接取旧动作表，不再经过当前槽位映射。
                legacy_actions = self._legal_actions(self.state, self.opponent, legacy=True)
                legacy_mask = np.asarray([bool(action[0]) for action in legacy_actions], dtype=bool)
                observation = self._encode_from_perspective(self.state, self.opponent)
                legacy_action, _ = self.opponent_model.predict(
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

    def _legal_actions(self, state: dict[str, Any], owner: str, legacy: bool = False):
        """legacy=True 时复现 v2.0.0 的 38 动作语义，供旧模型对手使用。

        v2.0.0 每步按排序取前 8 个单位分槽，移动要求严格接近目标；
        与当前的 12 个稳定槽位和绕路移动不兼容，不能直接按下标映射。
        """
        if state.get("phase") == "game_over":
            return self._empty_actions()

        if legacy:
            units = sorted((u for u in state.get("units", []) if u.get("alive") and u.get("owner") == owner), key=self._unit_sort_key)[:8]
        else:
            units = self._units_for_slots(state, owner)
        enemies = [u for u in state.get("units", []) if u.get("alive") and u.get("owner") != owner]
        hqs = [hq for hq in state.get("headquarters", {}).values() if hq.get("alive") and hq.get("owner") != owner]
        cells = {key(int(c["q"]), int(c["r"])): c for c in state.get("cells", [])}
        occupied = {(int(u["q"]), int(u["r"])) for u in state.get("units", []) if u.get("alive")}
        occupied.update((int(h["q"]), int(h["r"])) for h in state.get("headquarters", {}).values() if h.get("alive"))
        actions_used = int(state.get("turn", {}).get("actionsUsed", 0))
        ap_limit = int(state.get("config", {}).get("balance", {}).get("actionsPerTurn", 5))
        unit_slots = 8 if legacy else MAX_UNIT_SLOTS
        actions = self._empty_actions(1 + unit_slots * len(UNIT_INTENTS) + len(DEPLOY_SLOTS))
        actions[0] = ("end_turn", {})

        def can_activate(unit):
            return bool(unit.get("actionSpent")) or actions_used < ap_limit

        def plain_empty(pos):
            cell = cells.get(pos)
            return cell is not None and cell.get("terrain", "plain") == "plain" and pos not in occupied

        for slot, unit in enumerate(units):
            if unit is None:
                continue
            base = 1 + slot * len(UNIT_INTENTS)
            if can_activate(unit):
                move = self._fixed_move(unit, state, owner, cells, occupied, legacy=legacy)
                if move:
                    actions[base + 0] = ("move", move)
            if not unit.get("hasActed") and can_activate(unit):
                target = self._best_target(unit, enemies, hqs)
                if target:
                    actions[base + 1] = ("attack", {"attackerId": unit["id"], "targetId": target["id"]})
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
                    actions[1 + unit_slots * len(UNIT_INTENTS) + index] = ("deploy", payload)
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
        cells = sorted(state.get("cells", []), key=lambda c: (int(c["q"]), int(c["r"])))[:MAX_CELLS]
        units = [u for u in state.get("units", []) if u.get("alive")]
        control_points = state.get("controlPoints", [])
        hqs = list(state.get("headquarters", {}).values())
        terrain_index = {"plain": 0, "water": 1, "blocker": 2}

        for index, cell in enumerate(cells):
            offset = index * CELL_FEATURES
            terrain = terrain_index.get(cell.get("terrain", "plain"), 0)
            result[offset + terrain] = 1.0

            point = next((p for p in control_points if p["q"] == cell["q"] and p["r"] == cell["r"]), None)
            cp_owner = point.get("owner") if point else None
            result[offset + 3 + (1 if cp_owner == self.owner else 2 if cp_owner else 0)] = 1.0

            unit = next((u for u in units if u["q"] == cell["q"] and u["r"] == cell["r"]), None)
            hq = next((h for h in hqs if h["q"] == cell["q"] and h["r"] == cell["r"]), None)
            if unit:
                result[offset + 6 + (1 if unit["owner"] == self.owner else 2)] = 1.0
                result[offset + 9 + TYPE_INDEX.get(unit.get("type"), 0)] = 1.0
                result[offset + 14] = float(unit.get("hp", 0)) / max(1.0, float(unit.get("maxHp", 1)))
                result[offset + 15] = float(bool(unit.get("hasMoved")))
                result[offset + 16] = float(bool(unit.get("hasActed")))
            elif hq:
                result[offset + 6 + (1 if hq["owner"] == self.owner else 2)] = 1.0

        base = MAX_CELLS * CELL_FEATURES
        own = state.get("resources", {}).get(self.owner, {}).get("supplies", 0)
        other = state.get("resources", {}).get(self.opponent, {}).get("supplies", 0)
        own_hq = state.get("headquarters", {}).get(self.owner, {})
        enemy_hq = state.get("headquarters", {}).get(self.opponent, {})
        values = [
            float(own) / 300.0, float(other) / 300.0,
            float(own_hq.get("hp", 0)) / 200.0,
            float(enemy_hq.get("hp", 0)) / 200.0,
            float(state.get("turn", {}).get("roundNumber", 1)) / 20.0,
            float(state.get("turn", {}).get("actionsUsed", 0)) / 5.0,
            sum(p.get("owner") == self.owner for p in control_points) / max(1, len(control_points)),
            sum(p.get("owner") == self.opponent for p in control_points) / max(1, len(control_points)),
            sum(u.get("owner") == self.owner for u in units) / 20.0,
            sum(u.get("owner") == self.opponent for u in units) / 20.0,
        ]
        result[base:base + len(values)] = np.clip(values, -1.0, 1.0)
        return result
