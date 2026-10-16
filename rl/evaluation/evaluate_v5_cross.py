"""v5 evaluation contract and paired-result statistics.

The actual old-model adapters stay in ``evaluate_cross.py``. This module only
adds v5 manifest/seed bookkeeping and never changes or imports old training
environments until a caller explicitly asks for a cross-generation run.
"""
from __future__ import annotations
import argparse, hashlib, json, math
from pathlib import Path


def paired_bootstrap(records, key='score', rounds=2000, seed=500000):
    """95% paired bootstrap interval; maps/seats remain grouped by ``pair``."""
    import random
    groups = {}
    for row in records:
        groups.setdefault(row.get('pair', row.get('map', 'all')), []).append(float(row[key]))
    values = [sum(v) / len(v) for v in groups.values() if v]
    if not values: raise ValueError('no evaluation records')
    rng = random.Random(seed); means = []
    for _ in range(rounds):
        sample = [values[rng.randrange(len(values))] for _ in values]
        means.append(sum(sample) / len(sample))
    means.sort(); return {'mean': sum(values)/len(values), 'low': means[int(.025*rounds)], 'high': means[int(.975*rounds)-1], 'groups': len(values)}


def checkpoint_manifest(path):
    path = Path(path); raw = json.loads(path.read_text(encoding='utf-8')) if path.suffix == '.json' else None
    if raw is not None and raw.get('version') != '5.0.0': raise ValueError('checkpoint manifest version mismatch')
    return {'path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'version': '5.0.0'}


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('--checkpoint', required=True, type=Path)
    p.add_argument('--records', type=Path); args = p.parse_args(argv)
    out = checkpoint_manifest(args.checkpoint)
    if args.records:
        rows = [json.loads(x) for x in args.records.read_text(encoding='utf-8').splitlines() if x.strip()]
        out['bootstrap'] = paired_bootstrap(rows)
    print(json.dumps(out, ensure_ascii=False)); return 0


if __name__ == '__main__': raise SystemExit(main())
