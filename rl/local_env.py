"""Local-engine version of the RL environment.

It reuses the observation and legal-action code from env.py, but calls the
TypeScript engine through one persistent JSON-lines worker instead of HTTP.
No game server is required while training.

v2.8: the worker's ``apply``/``reset`` replies already carry the post-action
snapshot, so ``_get_state`` serves that cached snapshot instead of issuing a
second round trip (the engine only mutates through those two commands).  The
training env also asks the worker to drop the event tail it never reads.
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
    def __init__(self, map_id: str = "default", max_steps: int = 500, opponent_style: str = "mixed", opponent_model: Any | None = None, model_opponent_probability: float = 0.5, random_options: dict[str, Any] | None = None, opponent_model_path: str | None = None, self_play_dir: str | None = None, self_play_probability: float = 0.0, anchor_model_path: str | None = None, anchor_probability: float = 0.15, map_mix: list[tuple[str, float]] | None = None, opponent_stochastic_probability: float = 0.0):
        super().__init__(base_url="local://engine", max_steps=max_steps, opponent_style=opponent_style, opponent_model=opponent_model, model_opponent_probability=model_opponent_probability, map_id=map_id, random_options=random_options, opponent_model_path=opponent_model_path, self_play_dir=self_play_dir, self_play_probability=self_play_probability, anchor_model_path=anchor_model_path, anchor_probability=anchor_probability, opponent_stochastic_probability=opponent_stochastic_probability)
        self.map_mix = list(map_mix or [])
        if self.map_mix:
            if any(not name or weight <= 0 for name, weight in self.map_mix):
                raise ValueError("map_mix entries require a map name and positive weight")
            total = sum(weight for _, weight in self.map_mix)
            self.map_mix = [(name, weight / total) for name, weight in self.map_mix]
        # 最近一次 reset/apply 返回的快照；None 表示必须真正向 worker 查询。
        self._cached_state: dict[str, Any] | None = None
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
            # 宿主控制台代码页（如中文 Windows 的 936）可能传染给子进程链，
            # 导致偶发的非 UTF-8 输出；解码容错避免直接崩掉整个训练。
            errors="replace",
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
        active_map = self.map_id
        if self.map_mix:
            names = [name for name, _ in self.map_mix]
            probabilities = [weight for _, weight in self.map_mix]
            active_map = str(self.np_random.choice(names, p=probabilities))
        # 当前观测不读事件日志，让 worker 不再序列化事件尾部。
        command: dict[str, Any] = {"cmd": "reset", "mapId": active_map, "eventTail": 0}
        if active_map == "random":
            # 每局一张新的对称随机地图；种子从 np_random 派生，gym seed 可复现。
            command["random"] = self._build_random_options()
        self._cached_state = None
        self.state = self._rpc(command)
        self._cached_state = self.state
        # 随机座位：智能体坐 player_b 时，模型对手恰好坐在它的主场 player_a，
        # 相对视角编码与 v2.0.0 的原生编码完全一致，对手即满血真身。
        forced_owner = (options or {}).get("owner")
        if forced_owner not in (None, PLAYER, OPPONENT):
            raise ValueError("reset option owner must be player_a or player_b")
        if forced_owner is not None:
            self.owner = forced_owner
            self.opponent = OPPONENT if forced_owner == PLAYER else PLAYER
        elif float(self.np_random.random()) < 0.5:
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
        # worker 只有一局游戏，状态只经 reset/apply 变化且两者都回传新快照，
        # 缓存命中时无需再发一次 state 往返（此前每步 4 次 state 全是冗余）。
        if self._cached_state is not None:
            return self._cached_state
        self._cached_state = self._rpc({"cmd": "state"})
        return self._cached_state

    def _apply(self, action_type: str, payload: dict[str, Any], token: str) -> None:
        command = {"cmd": "apply", "owner": self.owner if token == "agent" else self.opponent, "action": {"type": action_type, **payload}}
        try:
            self._cached_state = self._rpc(command)
        except RuntimeError:
            # 引擎拒绝动作：保守起见让下一次 _get_state 真正查询，防止半途变更被漏掉。
            self._cached_state = None
            raise

    def close(self):
        if getattr(self, "worker", None) and self.worker.poll() is None:
            self.worker.terminate()
            self.worker.wait(timeout=5)
        super().close()
