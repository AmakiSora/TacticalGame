"""Gumbel root selection plus PUCT interior search over the real TS rules."""
from __future__ import annotations

from dataclasses import dataclass, field
import math
import time
import numpy as np
from .action_space import action_key, encode, state_key
from .env_v5 import HexEnvV5, current_player, terminal_value


@dataclass
class Node:
    state: dict
    player: str
    prior: float = 0.0
    visits: int = 0
    value_sum: float = 0.0
    children: dict[str, 'Node'] = field(default_factory=dict)

    @property
    def value(self):
        return self.value_sum / self.visits if self.visits else 0.0


class GumbelSearch:
    def __init__(self, env: HexEnvV5, evaluator, simulations=32, time_ms=50, root_top_k=32,
                 seed=500000, temperature=0.0):
        self.env, self.evaluator = env, evaluator
        self.simulations, self.time_ms, self.root_top_k = simulations, time_ms, root_top_k
        self.seed, self.temperature = int(seed), float(temperature)
        self.stats = {'simulations': 0, 'fallbacks': 0, 'illegal': 0, 'elapsed_ms': 0.0}

    def _expand(self, node):
        actions = self.env.legal(node.state)
        if not actions:
            return actions, np.zeros(0)
        obs = encode(node.state, actions, node.player)
        logits, _ = self.evaluator(obs)
        logits = np.asarray(logits[:len(actions)], np.float64)
        logits[~np.isfinite(logits)] = -1e9
        logits -= np.max(logits)
        priors = np.exp(logits)
        priors /= priors.sum() or 1
        return actions, priors

    def _rollout(self, root, root_player):
        node = root
        path = []
        for _ in range(256):
            terminal = terminal_value(node.state, root_player)
            if terminal is not None:
                value = terminal
                break
            actions, priors = self._expand(node)
            if not actions:
                value = 0.0
                break
            if not node.children:
                for a, p in zip(actions, priors):
                    child_state = self.env.simulate(node.state, a, self.seed + len(node.children) + self.stats['simulations'] * 7919)
                    node.children[action_key(a)] = Node(child_state, current_player(child_state), float(p))
            path.append(node)
            # PUCT is from the root player's perspective; negate when side changes.
            score = lambda child: child.value + 1.35 * child.prior * math.sqrt(max(1, node.visits)) / (1 + child.visits)
            child = max(node.children.values(), key=score)
            node = child
        else:
            _, value = self.evaluator(encode(node.state, self.env.legal(node.state), current_player(node.state)))
        node.visits += 1
        node.value_sum += value
        for parent in reversed(path):
            parent.visits += 1
            parent.value_sum += value if parent.player == root_player else -value
        return value

    def search(self, state):
        started = time.perf_counter()
        root_player = current_player(state)
        actions = self.env.legal(state)
        if not actions:
            return {'action': {'type': 'end_turn'}, 'policy': [], 'actions': [], 'fallback': True}
        logits, _ = self.evaluator(encode(state, actions, root_player))
        logits = np.asarray(logits[:len(actions)], float)
        rng = np.random.default_rng(self.seed)
        root_scores = logits + rng.gumbel(size=len(actions))
        keep = np.argsort(root_scores)[-min(len(actions), self.root_top_k):]
        # Sequential halving allocates equally among surviving candidates.
        root = Node(state, root_player)
        for i in keep:
            root.children[action_key(actions[i])] = Node(None, root_player, 1 / len(keep))
        for child in root.children.values():
            a = next(a for a in actions if action_key(a) == next(k for k, v in root.children.items() if v is child))
            child.state = self.env.simulate(state, a, self.seed + self.stats['simulations'])
        budget = self.simulations
        for _ in range(budget):
            if (time.perf_counter() - started) * 1000 >= self.time_ms:
                self.stats['fallbacks'] += 1
                break
            self.stats['simulations'] += 1
            self._rollout(root, root_player)
        chosen = max(root.children, key=lambda k: root.children[k].visits) if root.children else action_key(actions[int(np.argmax(logits))])
        counts = np.array([root.children.get(action_key(a), Node({}, '')).visits for a in actions], dtype=np.float64)
        if counts.sum() == 0:
            self.stats['fallbacks'] += 1
            counts = np.exp(logits - logits.max())
        policy = (counts / counts.sum()).tolist()
        self.stats['elapsed_ms'] += (time.perf_counter() - started) * 1000
        return {'action': json_action(chosen, actions), 'policy': policy, 'actions': actions,
                'fallback': self.stats['fallbacks'] > 0, 'stats': dict(self.stats)}


def json_action(key, actions):
    return next(a for a in actions if action_key(a) == key)
