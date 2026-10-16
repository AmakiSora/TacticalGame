"""Strict v5 checkpoint metadata and resumability helpers."""
from __future__ import annotations
import json, platform, random
from pathlib import Path
import numpy as np
import torch
from .action_space import SCHEMA_HASH


def save_checkpoint(path, model, optimizer, config, step, replay_path=None, league_path=None):
    payload = {'version': '5.0.0', 'schema_hash': SCHEMA_HASH, 'step': int(step),
               'config': config, 'model': model.state_dict(), 'optimizer': optimizer.state_dict(),
               'rng': {'python': random.getstate(), 'numpy': np.random.get_state(),
                       'torch': torch.get_rng_state().tolist()},
               'runtime': {'python': platform.python_version(), 'torch': torch.__version__},
               'replay_path': str(replay_path) if replay_path else None,
               'league_path': str(league_path) if league_path else None}
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True); torch.save(payload, path)


def load_checkpoint(path, model, optimizer=None, map_location='cpu'):
    raw = torch.load(path, map_location=map_location, weights_only=False)
    if raw.get('version') != '5.0.0' or raw.get('schema_hash') != SCHEMA_HASH:
        raise ValueError('checkpoint is not a compatible v5.0.0 artifact')
    model.load_state_dict(raw['model'])
    if optimizer is not None and raw.get('optimizer'): optimizer.load_state_dict(raw['optimizer'])
    return raw
