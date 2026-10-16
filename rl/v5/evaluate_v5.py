"""Dry-run and paired-seed evaluator; model is mandatory for real evaluation."""
from __future__ import annotations
import argparse, json, hashlib
from pathlib import Path
from .env_v5 import EngineWorker, HexEnvV5, terminal_value
from .network import HexZeroNetwork, NetworkConfig, NetworkEvaluator
from .search import GumbelSearch
from .action_space import encode
import torch


def load_model(path, device='cpu'):
    raw = torch.load(path, map_location=device, weights_only=False)
    if raw.get('version') != '5.0.0': raise ValueError('checkpoint is not v5.0.0')
    model = HexZeroNetwork(NetworkConfig(**raw['config']['network'])); model.load_state_dict(raw['model']); model.eval(); return model


def play(env, evaluator, map_id, seed, simulations=8, max_actions=5000):
    state = env.reset(map_id, map_seed=seed, combat_seed=seed ^ 0x9E3779B9); actions = 0; log = []
    while state['phase'] == 'active' and actions < max_actions:
        search = GumbelSearch(env, evaluator, simulations=simulations, seed=seed + actions)
        result = search.search(state); action = result['action']; state = env.step(action); actions += 1
        log.append({'action': action, 'search': result.get('stats', {})})
    return {'winner': state.get('winner'), 'draw': state['phase'] != 'game_over', 'actions': actions, 'log': log}


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('--checkpoint', required=True, type=Path)
    p.add_argument('--map', default='default'); p.add_argument('--games', type=int, default=2); p.add_argument('--quick', action='store_true')
    p.add_argument('--output', type=Path, default=Path('rl/test-output/v5/evaluation.jsonl')); args = p.parse_args(argv)
    model = load_model(args.checkpoint); evaluator = NetworkEvaluator(model)
    records = []
    with EngineWorker() as worker:
        env = HexEnvV5(worker)
        for i in range(args.games): records.append(play(env, evaluator, args.map, 500000 + i, 8 if args.quick else 32))
    args.output.parent.mkdir(parents=True, exist_ok=True); args.output.write_text('\n'.join(json.dumps(x) for x in records) + '\n', encoding='utf-8')
    print(json.dumps({'games': len(records), 'output': str(args.output), 'training_started': False})); return 0


if __name__ == '__main__': raise SystemExit(main())
