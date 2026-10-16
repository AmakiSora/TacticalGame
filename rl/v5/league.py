"""PFSP league registry with normalized map×seat probability masses."""
from __future__ import annotations
from dataclasses import dataclass, asdict
import json
import random
from pathlib import Path


@dataclass
class Opponent:
    name: str
    kind: str
    path: str | None = None
    frozen: bool = True
    games: int = 0
    wins: int = 0
    losses: int = 0

    @property
    def score(self): return (self.wins + .5 * max(0, self.games - self.wins - self.losses)) / max(1, self.games)


class League:
    def __init__(self, seed=500000): self.members, self.rng = {}, random.Random(seed)
    def add(self, member):
        if member.name in self.members: raise ValueError('duplicate league member')
        self.members[member.name] = member
    def add_snapshot(self, name, path, kind='main'): self.add(Opponent(name, kind, str(path), True))
    def record(self, name, result):
        o = self.members[name]; o.games += 1
        if result > 0: o.wins += 1
        elif result < 0: o.losses += 1
    def probabilities(self, cells):
        if not cells: raise ValueError('league has no map-seat cells')
        # PFSP: hard opponents get more mass, with explicit floor/ceiling and normalized output.
        raw = []
        for name, map_id, seat, win_rate in cells:
            weakness = max(.05, min(.35, .65 - float(win_rate)))
            raw.append((name, map_id, seat, weakness))
        total = sum(x[3] for x in raw)
        return [{"name": n, "map_id": m, "seat": s, "probability": p / total} for n, m, s, p in raw]
    def sample(self, cells):
        dist = self.probabilities(cells); x = self.rng.random(); acc = 0
        for item in dist:
            acc += item['probability']
            if x <= acc: return item
        return dist[-1]
    def save(self, path):
        p = Path(path); p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({'version': '5.0.0', 'members': [asdict(x) for x in self.members.values()],
                                 'rng': self.rng.getstate()}), encoding='utf-8')
    @classmethod
    def load(cls, path):
        raw = json.loads(Path(path).read_text(encoding='utf-8')); obj = cls()
        if raw.get('version') != '5.0.0': raise ValueError('unsupported league version')
        for x in raw['members']: obj.add(Opponent(**x))
        def tuples(value):
            return tuple(tuples(x) for x in value) if isinstance(value, list) else value
        obj.rng.setstate(tuples(raw['rng'])); return obj
