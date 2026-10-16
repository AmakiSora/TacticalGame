"""Isolated JSONL transport and observable-state branch simulator."""
from __future__ import annotations

import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import threading

ROOT = Path(__file__).resolve().parents[2]


class EngineWorker:
    def __init__(self, timeout: float = 30):
        node = shutil.which('node')
        if not node or not (ROOT / 'node_modules/tsx/dist/cli.mjs').exists():
            raise RuntimeError('Node 24 and npm install are required')
        self.timeout = timeout
        self.proc = subprocess.Popen(
            [node, str(ROOT / 'node_modules/tsx/dist/cli.mjs'), 'rl/v5/engine-worker.ts'],
            cwd=ROOT, env={**os.environ, 'VITEST': '1'}, stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8', bufsize=1,
        )
        self.responses = queue.Queue()
        self.errors = []
        self.lock = threading.Lock()
        self.reader = threading.Thread(target=self._read, daemon=True)
        self.reader.start()
        threading.Thread(target=self._stderr, daemon=True).start()

    def _read(self):
        for line in self.proc.stdout:
            self.responses.put(line)
        self.responses.put(None)

    def _stderr(self):
        for line in self.proc.stderr:
            self.errors.append(line.rstrip())
            self.errors[:] = self.errors[-20:]

    def call(self, command):
        with self.lock:
            if self.proc.poll() is not None:
                raise RuntimeError('v5 worker exited: ' + '\n'.join(self.errors))
            self.proc.stdin.write(json.dumps(command, allow_nan=False) + '\n')
            self.proc.stdin.flush()
            try:
                line = self.responses.get(timeout=self.timeout)
            except queue.Empty:
                self.close()
                raise TimeoutError('v5 engine RPC timed out; worker closed') from None
            if line is None:
                raise RuntimeError('v5 worker EOF: ' + '\n'.join(self.errors))
            reply = json.loads(line)
            if not reply['ok']:
                raise ValueError(reply['error'])
            return reply['state']

    def close(self):
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait(timeout=5)
        for stream in (self.proc.stdin, self.proc.stdout, self.proc.stderr):
            if stream and not stream.closed:
                stream.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


class HexEnvV5:
    def __init__(self, worker=None):
        self.worker = worker or EngineWorker()
        self.owns_worker = worker is None
        self.state = None

    def reset(self, map_id='default', map_seed=0, combat_seed=0, random_options=None):
        self.state = self.worker.call(dict(cmd='reset', mapId=map_id, mapSeed=str(map_seed),
                                          combatSeed=int(combat_seed), random=random_options or {}))
        return self.state

    def legal(self, state):
        return self.worker.call(dict(cmd='legal', state=state))

    def simulate(self, state, action, seed):
        return self.worker.call(dict(cmd='simulate', state=state, action=action, seed=int(seed)))

    def step(self, action):
        self.state = self.worker.call(dict(cmd='apply', action=action))
        return self.state

    def decide(self, algorithm, seed=0):
        return self.worker.call(dict(cmd='decide', algorithm=algorithm, seed=int(seed)))

    def close(self):
        if self.owns_worker:
            self.worker.close()


def current_player(state):
    return state['turn']['currentPlayerId'] or state['turn']['currentOwner']


def terminal_value(state, player):
    if state['phase'] != 'game_over':
        return None
    return 0.0 if state.get('winner') is None else (1.0 if state['winner'] == player else -1.0)
