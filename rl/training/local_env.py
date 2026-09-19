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
    from rl.envs.env import HexGameEnv, OPPONENT, PLAYER
except ImportError:  # 脚本模式（``python rl/training/train.py``）：入口已把 rl/envs 挂上 sys.path。
    from env import HexGameEnv, OPPONENT, PLAYER


class LocalHexGameEnv(HexGameEnv):
    # v3.2.0：算法对手需要进程内引擎，本环境正好持有一个 worker。
    SUPPORTS_ALGORITHM_OPPONENT = True

    def __init__(self, map_id: str = "default", max_steps: int = 500, opponent_style: str = "mixed", opponent_model: Any | None = None, model_opponent_probability: float = 0.5, random_options: dict[str, Any] | None = None, opponent_model_path: str | None = None, self_play_dir: str | None = None, self_play_probability: float = 0.0, anchor_model_path: str | None = None, anchor_probability: float = 0.15, map_mix: list[tuple[str, float]] | None = None, opponent_stochastic_probability: float = 0.0, algorithm_opponent: str | None = None, algorithm_opponent_probability: float = 0.0, algorithm_mix: dict[str, float] | None = None, algorithm_epsilon: float = 0.0):
        super().__init__(base_url="local://engine", max_steps=max_steps, opponent_style=opponent_style, opponent_model=opponent_model, model_opponent_probability=model_opponent_probability, map_id=map_id, random_options=random_options, opponent_model_path=opponent_model_path, self_play_dir=self_play_dir, self_play_probability=self_play_probability, anchor_model_path=anchor_model_path, anchor_probability=anchor_probability, opponent_stochastic_probability=opponent_stochastic_probability, algorithm_opponent=algorithm_opponent, algorithm_opponent_probability=algorithm_opponent_probability, algorithm_mix=algorithm_mix, algorithm_epsilon=algorithm_epsilon)
        self.map_mix = list(map_mix or [])
        if self.map_mix:
            if any(not name or weight <= 0 for name, weight in self.map_mix):
                raise ValueError("map_mix entries require a map name and positive weight")
            total = sum(weight for _, weight in self.map_mix)
            self.map_mix = [(name, weight / total) for name, weight in self.map_mix]
        # 最近一次 reset/apply 返回的快照；None 表示必须真正向 worker 查询。
        self._cached_state: dict[str, Any] | None = None
        # v3.2.0 消融（阶段 A 复盘补）：算法通道的**累计**诊断计数器。
        # 与 env.py 里逐局清零的那三个不同，这三个跨局累加、只在 reset 时把"已结束局"
        # 的读数搬进来。原因：训练日志按 2 万帧一个窗口采样，采样时刻各并行环境都停在
        # 局中途，逐局计数器直接读出来是"半局残值"，既不可比也不可做差分。
        # 累计值 + 窗口差分才让"opponent_rejections 持续增长就停"这条止损线真正可执行。
        self._finished_algorithm_episodes = 0
        self._finished_algorithm_actions = 0
        self._finished_opponent_rejections = 0
        # 本文件位于 rl/training/，项目根需上溯三级。
        root = Path(__file__).resolve().parent.parent.parent
        npx = shutil.which("npx.cmd") or shutil.which("npx")
        if not npx:
            raise RuntimeError("npx was not found; run npm install first")
        self.worker = subprocess.Popen(
            [npx, "tsx", "rl/training/local-worker.ts"],
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

    def decide(self, owner: str, algorithm: str) -> dict[str, Any]:
        """走 worker 的 decide 通道，让内置算法 AI 出一个动作。

        **返回值是【决策结果】**（``{"action": {...}}`` 或 ``{"endTurn": True}``），
        不是游戏快照：``_rpc`` 取的是 worker 响应里的 ``state`` 字段，而
        ``handleCommand("decide")`` 返回的是 ``handleCommand`` 的返回值本身。
        decide 不改变游戏状态，因此调用方**不要**把它赋给 ``self.state`` /
        ``self._cached_state``——那会直接改坏引擎状态。

        与 ``rl/evaluation/evaluate_cross.py`` 的 ``AlgorithmController`` 同源：
        worker 内部为整个对局持有唯一 game 实例，算法每次 decide 从快照重建上下文。
        """
        return self._rpc({"cmd": "decide", "owner": owner, "algorithm": algorithm})

    def _algorithm_decide(self) -> dict[str, Any]:
        return self.decide(self.opponent, self.active_algorithm)

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
        # v3.2.0 消融（阶段 A 复盘补）：把刚结束这一局的诊断读数搬进累计值，再清零本局。
        # 必须在清零**之前**搬，且必须在这里做——本 reset 走 super(HexGameEnv, self).reset，
        # 跳过了基类 reset，基类那三行清零不会执行。
        self._finished_algorithm_episodes += self.algorithm_episodes
        self._finished_algorithm_actions += self.algorithm_actions
        self._finished_opponent_rejections += self.opponent_rejections
        self.algorithm_episodes = 0
        self.algorithm_actions = 0
        self.opponent_rejections = 0
        # v3.2.0：本 reset 走 super(HexGameEnv, self).reset，**跳过**基类 reset，
        # 所以兵种 novelty / 部署统计必须在这里独立清零，否则跨局累积。
        self._deployed_types = set()
        self.deploy_counts = {}
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

    def algorithm_stats(self) -> dict[str, int]:
        """算法对手通道的训练期诊断读数（累计值，含当前进行中的一局）。

        由 ``ActionDiversityCallback`` 每窗口经 ``env_method`` 拉取一次并取窗口差分。
        三个字段的用途：

        - ``algorithm_episodes``  实际抽中算法对手的局数 → 除以总局数即实际配比，
          与 ``RL_ALGO_OPPONENT_PROB`` 对照，验证"课程是否真的落地"。
        - ``algorithm_actions``   算法座位实际产出的动作数。配置了池却长期不涨
          说明 decide 通道静默失效。
        - ``rejections``          对手动作被引擎拒绝、降级为 end_turn 的次数。
          **持续增长**说明算法返回的 payload 与引擎校验不一致（合法性回归）。

        返回累计值而非本局值：训练日志是定时采样，逐局计数在采样点上是"半局残值"，
        取差分才是可解释的窗口增量。
        """
        finished_episodes = getattr(self, "_finished_algorithm_episodes", 0)
        finished_actions = getattr(self, "_finished_algorithm_actions", 0)
        finished_rejections = getattr(self, "_finished_opponent_rejections", 0)
        return {
            "algorithm_episodes": finished_episodes + self.algorithm_episodes,
            "algorithm_actions": finished_actions + self.algorithm_actions,
            "rejections": finished_rejections + self.opponent_rejections,
        }

    def close(self):
        if getattr(self, "worker", None) and self.worker.poll() is None:
            self.worker.terminate()
            self.worker.wait(timeout=5)
        super().close()
