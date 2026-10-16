"""Variable-length tokens and full-payload actions; no unit/cell/action cap."""
from __future__ import annotations

import copy
import hashlib
import json
import math
import numpy as np

TYPES = ('infantry', 'scout', 'heavy', 'ranger', 'support')
INTENTS = ('end_turn', 'move', 'attack', 'heal', 'demolish', 'deploy')
TOKEN_DIM, ACTION_DIM = 64, 32
SCHEMA = {'version': '5.0.0', 'tokens': TOKEN_DIM, 'actions': ACTION_DIM,
          'types': TYPES, 'intents': INTENTS, 'layout': 'entity-rules-pointer-v1'}


def digest(obj):
    return hashlib.sha256(json.dumps(obj, sort_keys=True, separators=(',', ':'),
                                    ensure_ascii=False, allow_nan=False).encode()).hexdigest()


SCHEMA_HASH = digest(SCHEMA)


def action_key(action):
    return json.dumps(action, sort_keys=True, separators=(',', ':'))


def action_index(actions, action):
    key = action_key(action)
    for i, candidate in enumerate(actions):
        if action_key(candidate) == key:
            return i
    raise ValueError('action is absent from full legal dictionary: ' + key)


def state_key(state):
    """Semantic observable key: no UUIDs, event timestamps, tokens or hidden RNG."""
    keep = {k: state.get(k) for k in ('config', 'mapId', 'map', 'cells', 'resources',
                                     'turn', 'phase', 'winner', 'artillery', 'result')}
    keep['units'] = sorted(({k: v for k, v in u.items() if k != 'id'}
                            for u in state['units'] if u['alive']), key=lambda u: (u['owner'], u['q'], u['r']))
    keep['headquarters'] = {p: {k: v for k, v in h.items() if k != 'id'}
                            for p, h in state['headquarters'].items()}
    keep['controlPoints'] = [{k: v for k, v in p.items() if k not in ('id', 'name')}
                             for p in state['controlPoints']]
    keep['players'] = {p: {k: v for k, v in x.items() if k in ('stats', 'status', 'adjudicationScore')}
                       for p, x in state['players'].items()}
    return digest(keep)


def _number(x):
    return math.copysign(math.log1p(abs(float(x))) / 10, float(x))


def _hash_features(key):
    return np.frombuffer(hashlib.sha256(key.encode()).digest()[:8], dtype=np.uint8).astype(np.float32) / 127.5 - 1


def _scalars(obj, prefix=''):
    if isinstance(obj, dict):
        for key in sorted(obj):
            yield from _scalars(obj[key], prefix + '.' + key)
    elif isinstance(obj, (int, float, bool)) or obj is None:
        yield prefix, obj


def encode(state, actions, owner=None):
    owner = owner or state['turn']['currentPlayerId'] or 'player_a'
    enemy = 'player_b' if owner == 'player_a' else 'player_a'
    rows, entities = [], {}

    def row(kind, entity=None, tag=''):
        x = np.zeros(TOKEN_DIM, np.float32)
        x[kind] = 1
        x[8:16] = _hash_features(tag)
        if entity:
            x[16:18] = [entity.get('q', 0) / 12, entity.get('r', 0) / 12]
            who = entity.get('owner')
            x[18:21] = [who == owner, who == enemy, who is None]
            if entity.get('type') in TYPES:
                x[21 + TYPES.index(entity['type'])] = 1
            for i, key in enumerate(('hp', 'maxHp', 'attack', 'defense', 'moveRange', 'attackRange',
                                     'cost', 'healPower', 'hasMoved', 'hasActed', 'actionSpent', 'canCapture', 'alive')):
                x[26+i] = _number(entity.get(key, 0))
            if 'id' in entity:
                entities[entity['id']] = len(rows)
        rows.append(x)
        return x

    global_row = row(0, tag=state['mapId'])
    b = state['config']['balance']
    global_row[16:22] = [_number(state['turn']['roundNumber']), _number(state['turn']['actionsUsed']),
                          _number(b['actionsPerTurn']), float(b['maxTurns'] is None),
                          _number(b['maxTurns'] or 0), float(owner == 'player_a')]
    for cell in sorted(state['cells'], key=lambda c: (c['q'], c['r'])):
        x = row(1, cell)
        x[40 + ('plain', 'water', 'blocker').index(cell['terrain'])] = 1
    for u in sorted((u for u in state['units'] if u['alive']), key=lambda u: (u['q'], u['r'])):
        row(2, u)
    for h in state['headquarters'].values():
        row(3, h)
    for cp in state['controlPoints']:
        row(4, cp, cp.get('kind') or 'untyped')
    # Every numeric standard-mode rule receives a key-tagged token, including defaults.
    rules = copy.deepcopy({'balance': b, 'units': state['config']['units'],
                           'headquartersSpec': state['config']['headquartersSpec']})
    rules['balance'].setdefault('deployFromHq', True)
    for key, value in _scalars(rules):
        x = row(5, tag=key)
        x[16:18] = [float(value is None), _number(value or 0)]
    for player in (owner, enemy):
        for key, value in _scalars({'resources': state['resources'].get(player, {}),
                                   'stats': state['players'][player]['stats']}):
            x = row(6, tag=key)
            x[16:18] = [float(player == owner), _number(value)]
    descriptors = np.zeros((len(actions), ACTION_DIM), np.float32)
    pointers = np.zeros((len(actions), 2), np.int64)
    for i, a in enumerate(actions):
        x = descriptors[i]
        x[INTENTS.index(a['type'])] = 1
        if a.get('unitType') in TYPES:
            x[6 + TYPES.index(a['unitType'])] = 1
        source = a.get('unitId', a.get('attackerId', a.get('supportId', a.get('fromId'))))
        target = a.get('targetId')
        pointers[i] = [entities.get(source, 0), entities.get(target, 0)]
        x[11:13] = [a.get('q', 0) / 12, a.get('r', 0) / 12]
        x[13:15] = [float(source is not None), float(target is not None)]
    return {'tokens': np.asarray(rows), 'actions': descriptors, 'pointers': pointers}


def rotate_view(state, actions, turns=1, reflect=False):
    """Matched axial-coordinate augmentation; IDs and action indices remain intact."""
    def transform(obj):
        if isinstance(obj, dict):
            out = {k: transform(v) for k, v in obj.items()}
            if 'q' in obj and 'r' in obj:
                q, r = obj['q'], obj['r']
                if reflect:
                    q, r = r, q
                for _ in range(turns % 6):
                    q, r = -r, q+r
                out['q'], out['r'] = q, r
            return out
        return [transform(v) for v in obj] if isinstance(obj, list) else obj
    return transform(state), transform(actions)
