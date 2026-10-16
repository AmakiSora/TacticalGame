from rl.v5.action_space import action_index, encode, state_key
from rl.v5.replay import PrioritizedReplay, Sample


def test_replay_strata_and_restore(tmp_path):
    replay = PrioritizedReplay(4, seed=9)
    sample = Sample({}, [{'type': 'end_turn'}], [1.0], 1, 0.2, 3, 'default', 'player_a')
    for i in range(4): replay.add(sample, i + 1)
    assert replay.quotas()[('default', 'player_a')] == 4
    path = tmp_path / 'replay.json'; replay.save(path)
    restored = PrioritizedReplay.load(path)
    assert restored.sample(2, map_id='default', seat='player_a')[0]


def test_action_schema_uses_full_payload_and_semantic_key():
    state = {'config': {'balance': {'actionsPerTurn': 1, 'maxTurns': None, 'deployFromHq': True}, 'units': {}, 'headquartersSpec': {}},
             'mapId': 'x', 'map': {}, 'cells': [], 'resources': {'player_a': {}},
             'turn': {'roundNumber': 1, 'actionsUsed': 0, 'currentPlayerId': 'player_a'}, 'phase': 'active',
             'winner': None, 'artillery': None, 'result': None, 'units': [], 'headquarters': {},
             'controlPoints': [], 'players': {'player_a': {'stats': {}}, 'player_b': {'stats': {}}}}
    actions = [{'type': 'move', 'unitId': 'u', 'q': 2, 'r': -1}, {'type': 'end_turn'}]
    assert action_index(actions, actions[0]) == 0
    assert state_key(state) == state_key({**state, 'rngState': 123, 'tokens': {'player_a': 'hidden'}})
    assert encode(state, actions)['actions'].shape[0] == 2
