"""Transformer with variable action pointer scoring and WDL/score/time heads."""
from __future__ import annotations

from dataclasses import asdict, dataclass
import numpy as np
import torch
from torch import nn
from .action_space import TOKEN_DIM, ACTION_DIM


@dataclass
class NetworkConfig:
    d_model: int = 128
    layers: int = 4
    heads: int = 8
    features_dim: int = 384


def collate(observations, device='cpu'):
    if not observations or any(len(o['actions']) == 0 for o in observations):
        raise ValueError('network batches require nonempty legal action dictionaries')
    n, t, a = len(observations), max(len(o['tokens']) for o in observations), max(len(o['actions']) for o in observations)
    tokens = np.zeros((n, t, TOKEN_DIM), np.float32)
    actions = np.zeros((n, a, ACTION_DIM), np.float32)
    pointers = np.zeros((n, a, 2), np.int64)
    token_mask, action_mask = np.zeros((n, t), bool), np.zeros((n, a), bool)
    for i, o in enumerate(observations):
        nt, na = len(o['tokens']), len(o['actions'])
        tokens[i, :nt], actions[i, :na], pointers[i, :na] = o['tokens'], o['actions'], o['pointers']
        token_mask[i, :nt], action_mask[i, :na] = True, True
    return {k: torch.as_tensor(v, device=device) for k, v in locals().items()
            if k in ('tokens', 'actions', 'pointers', 'token_mask', 'action_mask')}


class HexZeroNetwork(nn.Module):
    def __init__(self, config=None):
        super().__init__()
        self.config = config or NetworkConfig()
        c = self.config
        self.input = nn.Linear(TOKEN_DIM, c.d_model)
        layer = nn.TransformerEncoderLayer(c.d_model, c.heads, 4*c.d_model, dropout=0,
                                           batch_first=True, norm_first=True, activation='gelu')
        self.encoder = nn.TransformerEncoder(layer, c.layers, enable_nested_tensor=False)
        self.features = nn.Sequential(nn.Linear(2*c.d_model, c.features_dim), nn.GELU())
        self.policy = nn.Sequential(nn.Linear(ACTION_DIM + 2*c.d_model + c.features_dim, c.d_model),
                                    nn.GELU(), nn.Linear(c.d_model, 1))
        self.wdl = nn.Linear(c.features_dim, 3)
        self.score = nn.Linear(c.features_dim, 1)
        self.time = nn.Linear(c.features_dim, 1)

    def forward(self, batch):
        h = self.encoder(self.input(batch['tokens']), src_key_padding_mask=~batch['token_mask'])
        mask = batch['token_mask'].unsqueeze(-1)
        pooled = (h * mask).sum(1) / mask.sum(1)
        f = self.features(torch.cat((h[:, 0], pooled), -1))
        source, target = (torch.gather(h, 1, batch['pointers'][:, :, i:i+1].expand(-1, -1, h.shape[-1])) for i in (0, 1))
        na = batch['actions'].shape[1]
        logits = self.policy(torch.cat((batch['actions'], source, target, f[:, None].expand(-1, na, -1)), -1)).squeeze(-1)
        return {'policy': logits.masked_fill(~batch['action_mask'], -torch.inf),
                'wdl': self.wdl(f), 'score': self.score(f).squeeze(-1).tanh(),
                'time': torch.nn.functional.softplus(self.time(f).squeeze(-1))}


class NetworkEvaluator:
    def __init__(self, model, device='cpu'):
        self.model, self.device = model, device

    @torch.inference_mode()
    def __call__(self, observation):
        self.model.eval()
        out = self.model(collate([observation], self.device))
        wdl = out['wdl'][0].softmax(-1)
        return out['policy'][0].float().cpu().numpy(), float(wdl[2] - wdl[0])


def losses(out, policy, wdl, score, time, weights=None, consistency=None):
    # Avoid 0 * -inf on padded actions.
    logp = out['policy'].log_softmax(-1).masked_fill(policy == 0, 0)
    per = -(policy * logp).sum(-1)
    per += .75 * nn.functional.cross_entropy(out['wdl'], wdl, reduction='none')
    per += .25 * nn.functional.smooth_l1_loss(out['score'], score, reduction='none')
    per += .10 * nn.functional.smooth_l1_loss(out['time'], time, reduction='none')
    if consistency is not None:
        p = out['policy'].softmax(-1)
        other = consistency['policy'].softmax(-1)
        per += .05 * (p-other).square().sum(-1)
    return (per * (weights if weights is not None else 1)).mean(), per.detach()
