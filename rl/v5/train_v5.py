"""v5 training entry point. It refuses to launch unless --execute is explicit."""
from __future__ import annotations
import argparse, json, os, random, time
from pathlib import Path
import numpy as np
import torch
from .action_space import SCHEMA_HASH
from .env_v5 import EngineWorker, HexEnvV5
from .league import League, Opponent
from .network import HexZeroNetwork, NetworkConfig
from .replay import PrioritizedReplay
from .checkpoint import save_checkpoint
from .action_space import encode
from .network import NetworkEvaluator, collate, losses
from .search import GumbelSearch


DEFAULT = {
    'version': '5.0.0', 'seed': 500000, 'mode': 'standard',
    'network': {'d_model': 128, 'layers': 4, 'heads': 8, 'features_dim': 384},
    'search': {'type': 'gumbel_sequential_halving', 'simulations': 8, 'root_top_k': 32, 'time_ms': 50},
    'replay': {'capacity': 500000, 'alpha': .6},
    'curriculum': {'teacher_probability': .5, 'self_play_probability': .2},
}


def load_config(path):
    raw = json.loads(Path(path).read_text(encoding='utf-8')) if path else {}
    config = json.loads(json.dumps(DEFAULT));
    for key, value in raw.items(): config[key] = value if not isinstance(value, dict) else {**config.get(key, {}), **value}
    if config['version'] != '5.0.0' or config['mode'] != 'standard': raise ValueError('v5 config must be version 5.0.0 standard')
    return config


def write_manifest(run, config, worker):
    manifest = worker.call({'cmd': 'manifest'})
    (run / 'map_manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    (run / 'schema.json').write_text(json.dumps({'version': '5.0.0', 'action_schema': SCHEMA_HASH}, indent=2), encoding='utf-8')


def collect_and_update(env, model, optimizer, replay, config, steps, seed):
    """Small, resumable Expert Iteration loop used by the explicit execute path."""
    evaluator = NetworkEvaluator(model)
    state = env.reset('default', map_seed=seed, combat_seed=seed ^ 0xA5A5A5A5)
    trajectory = []
    for step in range(int(steps)):
        actions = env.legal(state)
        obs = encode(state, actions)
        search = GumbelSearch(env, evaluator, simulations=config['search']['simulations'],
                              root_top_k=config['search']['root_top_k'], time_ms=config['search']['time_ms'], seed=seed + step)
        result = search.search(state)
        sample = {'observation': obs, 'legal_actions': actions, 'policy': result['policy'],
                  'wdl': 1, 'score': 0.0, 'time_to_terminal': 0.0,
                  'map_id': state['mapId'], 'seat': 'player_a'}
        replay.add(sample)
        trajectory.append(replay.data[-1])
        state = env.step(result['action'])
        if state['phase'] == 'game_over':
            winner = state.get('winner'); player = state.get('players', {}).get('player_a')
            value = 1 if winner == 'player_a' else (-1 if winner else 0)
            for sample_i in trajectory:
                sample_i.wdl = 2 if value > 0 else (0 if value < 0 else 1)
                sample_i.score = float(value)
                sample_i.time_to_terminal = len(trajectory)
            trajectory.clear(); state = env.reset('default', map_seed=seed + step + 1, combat_seed=seed + step + 1)
        # One sample update keeps the command resumable and bounds memory.
        if trajectory and step % 8 == 0:
            sample_i = replay.data[-1] if replay.data else None
            if sample_i:
                batch = collate([sample_i.observation])
                out = model(batch)
                policy = torch.as_tensor([sample_i.policy], dtype=torch.float32)
                target = torch.tensor([sample_i.wdl], dtype=torch.long)
                loss, _ = losses(out, policy, target, torch.tensor([sample_i.score]), torch.tensor([sample_i.time_to_terminal], dtype=torch.float32))
                optimizer.zero_grad(); loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0); optimizer.step()
    return state


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--config', type=Path, required=True); p.add_argument('--run-id', default='s0')
    p.add_argument('--output-root', type=Path, default=Path('rl/test-output/v5'))
    p.add_argument('--execute', action='store_true', help='actually start collection/training; omitted by design for setup')
    p.add_argument('--steps', type=int, default=0)
    args = p.parse_args(argv); cfg = load_config(args.config)
    run = args.output_root / args.run_id; run.mkdir(parents=True, exist_ok=True)
    (run / 'config.json').write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding='utf-8')
    if not args.execute:
        print(json.dumps({'version': '5.0.0', 'run': str(run), 'training_started': False, 'next': 'add --execute to run'}, ensure_ascii=False)); return 0
    if args.steps <= 0: raise SystemExit('--steps must be positive with --execute')
    seed = int(cfg['seed']); random.seed(seed); np.random.seed(seed); torch.manual_seed(seed)
    with EngineWorker() as worker:
        write_manifest(run, cfg, worker)
        model = HexZeroNetwork(NetworkConfig(**cfg['network']))
        optimizer = torch.optim.AdamW(model.parameters(), lr=3e-4)
        replay = PrioritizedReplay(cfg['replay']['capacity'], cfg['replay'].get('alpha', .6), seed)
        league = League(seed); league.add(Opponent('main', 'main', frozen=False))
        env = HexEnvV5(worker)
        collect_and_update(env, model, optimizer, replay, cfg, args.steps, seed)
        replay.save(run / 'replay.json'); league.save(run / 'league.json')
        save_checkpoint(run / 'checkpoint.pt', model, optimizer, cfg, args.steps, run / 'replay.json', run / 'league.json')
    print(json.dumps({'version': '5.0.0', 'run': str(run), 'training_started': True, 'steps': args.steps})); return 0


if __name__ == '__main__': raise SystemExit(main())
