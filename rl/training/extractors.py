"""v3.0 structured feature extractors for MaskablePPO.

The flat v3.0 observation is a concatenation of:

    [board 331 x 18] [global 16] [unit slots 12 x 15] [rules 51] [candidates 12 x 40 + 30]

``HexBoardExtractor`` slices that vector back into structured parts and runs a
small Transformer encoder over the 331 board cells (each cell = 18 features +
a learned positional embedding), pools it, and concatenates the pooled board
summary with an MLP over the remaining scalar features.  The MLP policy head
in sb3 (``net_arch``) then sits on top of this ``features_dim`` output.

Selected with ``RL_EXTRACTOR=hex_transformer``; ``RL_EXTRACTOR=mlp`` keeps
the v2.x flatten behaviour so the two can be compared on equal footing.
Weights are shared between actor and critic (``share_features_extractor``),
which keeps the parameter count and compute close to the v2.4 MLP.
"""

from __future__ import annotations

import torch
from gymnasium import spaces
from stable_baselines3.common.torch_layers import BaseFeaturesExtractor
from torch import nn

try:
    from rl.envs.env import (
        BOARD_SIZE, CELL_FEATURES, MAX_CELLS, OBSERVATION_SIZE,
    )
except ImportError:  # 脚本模式：入口已把 rl/envs 挂上 sys.path。
    from env import (  # type: ignore
        BOARD_SIZE, CELL_FEATURES, MAX_CELLS, OBSERVATION_SIZE,
    )


class HexBoardExtractor(BaseFeaturesExtractor):
    """Transformer over hex cells + MLP over scalar features."""

    def __init__(
        self,
        observation_space: spaces.Box,
        d_model: int = 64,
        n_heads: int = 4,
        n_layers: int = 2,
        ff_mult: int = 2,
        scalar_hidden: int = 256,
        features_dim: int = 512,
        dropout: float = 0.0,
    ):
        obs_dim = int(observation_space.shape[0])
        if obs_dim != OBSERVATION_SIZE:
            raise ValueError(f"HexBoardExtractor expects {OBSERVATION_SIZE}-dim observations, got {obs_dim}")
        super().__init__(observation_space, features_dim=features_dim)
        self.scalar_dim = obs_dim - BOARD_SIZE
        self.cell_proj = nn.Linear(CELL_FEATURES, d_model)
        self.pos_embed = nn.Parameter(torch.zeros(1, MAX_CELLS, d_model))
        nn.init.normal_(self.pos_embed, std=0.02)
        # Empty (padded) cells carry all-zero terrain one-hots; mask them out
        # of attention so radius-6 maps do not attend to 200 phantom cells.
        layer = nn.TransformerEncoderLayer(
            d_model=d_model, nhead=n_heads, dim_feedforward=d_model * ff_mult,
            dropout=dropout, batch_first=True, norm_first=True, activation="gelu",
        )
        self.encoder = nn.TransformerEncoder(layer, num_layers=n_layers, enable_nested_tensor=False)
        self.board_norm = nn.LayerNorm(d_model)
        # Pool: masked mean + masked max -> 2 * d_model.
        self.scalar_net = nn.Sequential(
            nn.Linear(self.scalar_dim, scalar_hidden), nn.GELU(),
            nn.Linear(scalar_hidden, scalar_hidden), nn.GELU(),
        )
        self.out = nn.Sequential(
            nn.Linear(2 * d_model + scalar_hidden, features_dim), nn.GELU(),
        )

    def forward(self, observations: torch.Tensor) -> torch.Tensor:
        batch = observations.shape[0]
        board = observations[:, :BOARD_SIZE].reshape(batch, MAX_CELLS, CELL_FEATURES)
        scalars = observations[:, BOARD_SIZE:]
        # Terrain one-hot occupies features 0..2; a real cell has exactly one set.
        present = board[:, :, :3].sum(dim=-1) > 0.5  # (B, N)
        tokens = self.cell_proj(board) + self.pos_embed
        # key_padding_mask: True = ignore.  Guard against all-masked rows.
        pad_mask = ~present
        pad_mask = pad_mask & (present.sum(dim=1, keepdim=True) > 0)
        encoded = self.encoder(tokens, src_key_padding_mask=pad_mask)
        encoded = self.board_norm(encoded)
        weights = present.unsqueeze(-1).to(encoded.dtype)
        denom = weights.sum(dim=1).clamp(min=1.0)
        mean_pool = (encoded * weights).sum(dim=1) / denom
        max_pool = encoded.masked_fill(~present.unsqueeze(-1), float("-inf")).max(dim=1).values
        max_pool = torch.where(torch.isfinite(max_pool), max_pool, torch.zeros_like(max_pool))
        scalar_features = self.scalar_net(scalars)
        return self.out(torch.cat([mean_pool, max_pool, scalar_features], dim=-1))


def build_policy_kwargs(extractor: str, net_width: int) -> dict:
    """Policy kwargs for train.py.  ``mlp`` reproduces the v2.4+ configuration."""
    if extractor == "mlp":
        return {"net_arch": {"pi": [net_width, net_width], "vf": [net_width, net_width]}}
    if extractor == "hex_transformer":
        import os
        # 深度/宽度可调：RL_TF_LAYERS（默认 1）、RL_TF_DIM（默认 64）。
        # 实测 2 层在 8 环境下把训练 fps 从 300 压到 104（GPU 更新 + 子进程 CPU 对手推理），
        # 1 层约为其一半开销；棋力差异留给 v3.0 验收比较。
        n_layers = int(os.environ.get("RL_TF_LAYERS", "1") or 1)
        d_model = int(os.environ.get("RL_TF_DIM", "64") or 64)
        return {
            "features_extractor_class": HexBoardExtractor,
            "features_extractor_kwargs": {"d_model": d_model, "n_heads": 4, "n_layers": n_layers, "features_dim": 512},
            "share_features_extractor": True,
            "net_arch": {"pi": [net_width], "vf": [net_width]},
        }
    raise ValueError("RL_EXTRACTOR must be mlp or hex_transformer")
