"""Bounded prioritized replay with map/seat/terminal strata and exact restore."""
from __future__ import annotations
from dataclasses import dataclass, asdict
import json
import random
from pathlib import Path
import numpy as np


@dataclass
class Sample:
    observation: dict
    legal_actions: list
    policy: list
    wdl: int
    score: float
    time_to_terminal: float
    map_id: str
    seat: str
    terminal_reason: str = 'unknown'
    priority: float = 1.0


class PrioritizedReplay:
    def __init__(self, capacity=500_000, alpha=.6, seed=500000):
        if capacity < 1: raise ValueError('capacity must be positive')
        self.capacity, self.alpha = int(capacity), float(alpha)
        self.rng = random.Random(seed)
        self.data, self.priorities, self.position = [], [], 0

    def add(self, sample, priority=None):
        sample = sample if isinstance(sample, Sample) else Sample(**sample)
        p = max(1e-6, float(priority if priority is not None else sample.priority))
        sample.priority = p
        if len(self.data) < self.capacity:
            self.data.append(sample); self.priorities.append(p)
        else:
            self.data[self.position], self.priorities[self.position] = sample, p
        self.position = (self.position + 1) % self.capacity

    def update_priorities(self, indices, values):
        for i, p in zip(indices, values):
            if 0 <= i < len(self.data): self.priorities[i] = self.data[i].priority = max(1e-6, float(p))

    def _eligible(self, map_id=None, seat=None):
        return [i for i, s in enumerate(self.data) if (map_id is None or s.map_id == map_id) and (seat is None or s.seat == seat)]

    def sample(self, batch_size, map_id=None, seat=None, beta=.4):
        ids = self._eligible(map_id, seat)
        if not ids: raise ValueError('replay stratum is empty')
        weights = np.asarray([self.priorities[i] ** self.alpha for i in ids], float)
        weights /= weights.sum()
        chosen = self.rng.choices(ids, weights=weights, k=int(batch_size))
        probs = np.asarray([weights[ids.index(i)] for i in chosen])
        importance = (len(ids) * probs) ** (-beta); importance /= importance.max() or 1
        return [self.data[i] for i in chosen], chosen, importance.astype(np.float32)

    def quotas(self):
        result = {}
        for s in self.data:
            result[(s.map_id, s.seat)] = result.get((s.map_id, s.seat), 0) + 1
        return result

    def save(self, path):
        path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({'version': '5.0.0', 'capacity': self.capacity, 'alpha': self.alpha,
                                    'position': self.position, 'rng': self.rng.getstate(),
                                    'data': [asdict(s) for s in self.data], 'priorities': self.priorities},
                                   default=lambda value: value.tolist() if hasattr(value, 'tolist') else str(value)), encoding='utf-8')

    @classmethod
    def load(cls, path):
        raw = json.loads(Path(path).read_text(encoding='utf-8'))
        if raw.get('version') != '5.0.0': raise ValueError('unsupported replay version')
        obj = cls(raw['capacity'], raw['alpha']); obj.position = raw['position']
        def tuples(value):
            return tuple(tuples(x) for x in value) if isinstance(value, list) else value
        obj.rng.setstate(tuples(raw['rng'])); obj.data = [Sample(**s) for s in raw['data']]; obj.priorities = raw['priorities']
        return obj
