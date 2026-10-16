"""v5 inference runner. It only loads a signed v5 checkpoint and uses full legal actions."""
from __future__ import annotations
import argparse, json
from pathlib import Path
from rl.v5.action_space import SCHEMA_HASH, encode
from rl.v5.env_v5 import EngineWorker, HexEnvV5
from rl.v5.evaluate_v5 import load_model
from rl.v5.network import NetworkEvaluator
from rl.v5.search import GumbelSearch


class V5Controller:
    def __init__(self, checkpoint, simulations=32, time_ms=50):
        self.model = load_model(checkpoint); self.evaluator = NetworkEvaluator(self.model)
        self.simulations, self.time_ms = simulations, time_ms
    def act(self, env, state, seed=500000):
        return GumbelSearch(env, self.evaluator, self.simulations, self.time_ms, seed=seed).search(state)['action']


def main(argv=None):
    p = argparse.ArgumentParser(); p.add_argument('--checkpoint', required=True); p.add_argument('--map', default='default'); p.add_argument('--dry-run', action='store_true'); args = p.parse_args(argv)
    if args.dry_run:
        print(json.dumps({'version': '5.0.0', 'schema_hash': SCHEMA_HASH, 'checkpoint': args.checkpoint, 'training_started': False})); return 0
    raise SystemExit('REST/arena orchestration is provided by evaluate_v5.py; use --dry-run for loader checks')

if __name__ == '__main__': raise SystemExit(main())
