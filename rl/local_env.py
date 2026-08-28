"""Local-engine version of the RL environment.

It reuses the observation and legal-action code from env.py, but calls the
TypeScript engine through one persistent JSON-lines worker instead of HTTP.
No game server is required while training.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

try:
    from .env import HexGameEnv, OPPONENT, PLAYER
except ImportError:  # ``python rl/train.py`` puts rl/ on sys.path.
    from env import HexGameEnv, OPPONENT, PLAYER


class LocalHexGameEnv(HexGameEnv):
    def __init__(self, map_id: str = "default", max_steps: int = 500, opponent_style: str = "mixed", opponent_model: Any | None = None, model_opponent_probability: float = 0.5, random_options: dict[str, Any] | None = None, opponent_model_path: str | None = None):
        super().__init__(base_url="local://engine", max_steps=max_steps, opponent_style=opponent_style, opponent_model=opponent_model, model_opponent_probability=model_opponent_probability, map_id=map_id, random_options=random_options, opponent_model_path=opponent_model_path)
        root = Path(__file__).resolve().parent.parent
        npx = shutil.which("npx.cmd") or shutil.which("npx")
        if not npx:
            raise RuntimeError("npx was not found; run npm install first")
        self.worker = subprocess.Popen(
            [npx, "tsx", "rl/local-worker.ts"],
            cwd=root,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )

    def _rpc(self, command: dict[str, Any]) -> dict[str, Any]:
        if self.worker.poll() is not None or self.worker.stdin is None or self.worker.stdout is None:
            raise RuntimeError("local engine worker exited")
        self.worker.stdin.write(json.dumps(command) + "\n")
        self.worker.stdin.flush()
        line = self.worker.stdout.readline()
        if not line:
            raise RuntimeError("local engine worker returned no response")
        response = json.loads(line)
        if not response.get("ok"):
            raise RuntimeError(response.get("error", "local engine error"))
        return response["state"]

    def reset(self, *, seed: int | None = None, options: dict[str, Any] | None = None):
        super(HexGameEnv, self).reset(seed=seed)
        self.player_token = "agent"
        self.opponent_token = "opponent"
        command: dict[str, Any] = {"cmd": "reset", "mapId": self.map_id}
        if self.map_id == "random":
            # 每局一张新的对称随机地图；种子从 np_random 派生，gym seed 可复现。
            command["random"] = self._build_random_options()
        self.state = self._rpc(command)
        # 随机座位：智能体坐 player_b 时，模型对手恰好坐在它的主场 player_a，
        # 相对视角编码与 v2.0.0 的原生编码完全一致，对手即满血真身。
        if float(self.np_random.random()) < 0.5:
            self.owner, self.opponent = OPPONENT, PLAYER
        else:
            self.owner, self.opponent = PLAYER, OPPONENT
        self.steps = 0
        self.unit_slots = {PLAYER: {}, OPPONENT: {}}
        self.action_counts = {}
        self.active_opponent_style = self._choose_opponent_style()
        self._play_opponent_until_agent_turn()
        self.actions = self._legal_actions(self.state, self.owner)
        self.previous_score = self._score(self.state)
        return self._encode_state(self.state), {}

    def _get_state(self, token: str) -> dict[str, Any]:
        return self._rpc({"cmd": "state"})

    def _apply(self, action_type: str, payload: dict[str, Any], token: str) -> None:
        self._rpc({"cmd": "apply", "owner": self.owner if token == "agent" else self.opponent, "action": {"type": action_type, **payload}})

    def close(self):
        if getattr(self, "worker", None) and self.worker.poll() is None:
            self.worker.terminate()
            self.worker.wait(timeout=5)
        super().close()
