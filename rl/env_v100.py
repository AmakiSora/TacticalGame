"""Gymnasium environment for the standard two-player REST game.

This first version intentionally targets only the ``default`` map and the
sequential (non-simultaneous) rules.  It is meant as a small, readable
baseline for training against a random opponent before moving the simulator
in-process for speed.
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
MAX_ACTIONS = 512


def key(q: int, r: int) -> tuple[int, int]:
    return q, r


def distance(a: dict[str, Any], b: dict[str, Any]) -> int:
    dq = int(a["q"]) - int(b["q"])
    dr = int(a["r"]) - int(b["r"])
    return max(abs(dq), abs(dr), abs(-dq - dr))


class HexGameEnv(gym.Env):
    """One RL player versus a random legal-action opponent."""

    metadata = {"render_modes": []}

    def __init__(self, base_url: str = "http://127.0.0.1:3100", max_steps: int = 500):
        super().__init__()
        self.base_url = base_url.rstrip("/")
        self.max_steps = max_steps

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
        self.actions: list[tuple[str, dict[str, Any]]] = []
        self.previous_score = 0.0
        self.steps = 0

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
        self._play_opponent_until_agent_turn()
        self.actions = self._legal_actions(self.state, self.owner)
        self.previous_score = self._score(self.state)
        return self._encode_state(self.state), {}

    def step(self, action_index: int):
        self.actions = self._legal_actions(self.state, self.owner)
        self.steps += 1

        if action_index < 0 or action_index >= len(self.actions):
            return self._encode_state(self.state), -0.05, False, self.steps >= self.max_steps, {"invalid": True}

        action_type, payload = self.actions[action_index]
        try:
            self._apply(action_type, payload, self.player_token)
        except RuntimeError:
            # A stale/invalid candidate should be mildly penalized, not crash
            # an entire PPO rollout.
            self.state = self._get_state(self.player_token)
            return self._encode_state(self.state), -0.05, self._game_over(), False, {"invalid": True}

        self.state = self._get_state(self.player_token)
        self._play_opponent_until_agent_turn()
        self.state = self._get_state(self.player_token)

        current_score = self._score(self.state)
        reward = float(np.clip((current_score - self.previous_score) / 100.0, -1.0, 1.0))
        self.previous_score = current_score

        terminated = self._game_over()
        if terminated:
            reward += 1.0 if self.state.get("winner") == self.owner else -1.0
        truncated = self.steps >= self.max_steps and not terminated
        self.actions = self._legal_actions(self.state, self.owner) if not terminated else []
        return self._encode_state(self.state), float(np.clip(reward, -2.0, 2.0)), terminated, truncated, {}

    def action_masks(self) -> np.ndarray:
        """Mask used by sb3-contrib MaskablePPO."""
        mask = np.zeros(MAX_ACTIONS, dtype=bool)
        mask[: min(len(self.actions), MAX_ACTIONS)] = True
        return mask

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

    def _play_opponent_until_agent_turn(self) -> None:
        """Use a random legal policy for player_b until player_a can act."""
        guard = 0
        while not self._game_over() and self.state.get("turn", {}).get("currentPlayerId") != self.owner:
            guard += 1
            if guard > 100:
                raise RuntimeError("opponent turn did not finish")
            actions = self._legal_actions(self.state, self.opponent)
            if not actions:
                break
            index = int(self.np_random.integers(len(actions)))
            action_type, payload = actions[index]
            try:
                self._apply(action_type, payload, self.opponent_token)
            except RuntimeError as error:
                if "rate_limit" in str(error):
                    raise
                self._apply("end_turn", {}, self.opponent_token)
            self.state = self._get_state(self.player_token)

    def _legal_actions(self, state: dict[str, Any], owner: str):
        if state.get("phase") == "game_over":
            return []

        units = [u for u in state.get("units", []) if u.get("alive") and u.get("owner") == owner]
        enemies = [u for u in state.get("units", []) if u.get("alive") and u.get("owner") != owner]
        hqs = [hq for hq in state.get("headquarters", {}).values() if hq.get("alive") and hq.get("owner") != owner]
        cells = {key(int(c["q"]), int(c["r"])): c for c in state.get("cells", [])}
        occupied = {(int(u["q"]), int(u["r"])) for u in state.get("units", []) if u.get("alive")}
        occupied.update((int(h["q"]), int(h["r"])) for h in state.get("headquarters", {}).values() if h.get("alive"))
        actions_used = int(state.get("turn", {}).get("actionsUsed", 0))
        ap_limit = int(state.get("config", {}).get("balance", {}).get("actionsPerTurn", 5))
        actions = [("end_turn", {})]

        def can_activate(unit):
            return bool(unit.get("actionSpent")) or actions_used < ap_limit

        def plain_empty(pos):
            cell = cells.get(pos)
            return cell is not None and cell.get("terrain", "plain") == "plain" and pos not in occupied

        for unit in units:
            start = key(int(unit["q"]), int(unit["r"]))
            if not unit.get("hasMoved") and can_activate(unit):
                for pos in self._reachable(cells, occupied, start, int(unit.get("moveRange", 0))):
                    if plain_empty(pos):
                        actions.append(("move", {"unitId": unit["id"], "q": pos[0], "r": pos[1]}))

            if not unit.get("hasActed") and can_activate(unit):
                for target in [*enemies, *hqs]:
                    if distance(unit, target) <= int(unit.get("attackRange", 0)):
                        actions.append(("attack", {"attackerId": unit["id"], "targetId": target["id"]}))

                if unit.get("type") == "support":
                    heal_range = int(state.get("config", {}).get("units", {}).get("support", {}).get("healRange", unit.get("attackRange", 0)))
                    for target in units:
                        if target["id"] != unit["id"] and int(target["hp"]) < int(target["maxHp"]) and distance(unit, target) <= heal_range:
                            actions.append(("heal", {"supportId": unit["id"], "targetId": target["id"]}))

                if unit.get("type") == "heavy":
                    for dq, dr in HEX_DIRECTIONS:
                        pos = (start[0] + dq, start[1] + dr)
                        cell = cells.get(pos)
                        if cell and cell.get("terrain") == "blocker" and pos not in occupied:
                            actions.append(("demolish", {"unitId": unit["id"], "q": pos[0], "r": pos[1]}))

        resources = state.get("resources", {}).get(owner, {}).get("supplies", 0)
        origins = []
        hq = state.get("headquarters", {}).get(owner)
        if hq and hq.get("alive"):
            origins.append(hq)
        origins.extend(p for p in state.get("controlPoints", []) if p.get("owner") == owner)
        specs = state.get("config", {}).get("units", {})
        for origin in origins:
            origin_pos = key(int(origin["q"]), int(origin["r"]))
            for unit_type in UNIT_TYPES:
                spec = specs.get(unit_type)
                if not spec or resources < int(spec.get("cost", 10)):
                    continue
                for dq, dr in HEX_DIRECTIONS:
                    pos = (origin_pos[0] + dq, origin_pos[1] + dr)
                    if plain_empty(pos):
                        actions.append(("deploy", {"unitType": unit_type, "fromId": origin["id"], "q": pos[0], "r": pos[1]}))

        return actions[:MAX_ACTIONS]

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
            result[offset + 3 + (1 if cp_owner == PLAYER else 2 if cp_owner else 0)] = 1.0

            unit = next((u for u in units if u["q"] == cell["q"] and u["r"] == cell["r"]), None)
            hq = next((h for h in hqs if h["q"] == cell["q"] and h["r"] == cell["r"]), None)
            if unit:
                result[offset + 6 + (1 if unit["owner"] == PLAYER else 2)] = 1.0
                result[offset + 9 + TYPE_INDEX.get(unit.get("type"), 0)] = 1.0
                result[offset + 14] = float(unit.get("hp", 0)) / max(1.0, float(unit.get("maxHp", 1)))
                result[offset + 15] = float(bool(unit.get("hasMoved")))
                result[offset + 16] = float(bool(unit.get("hasActed")))
            elif hq:
                result[offset + 6 + (1 if hq["owner"] == PLAYER else 2)] = 1.0

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

