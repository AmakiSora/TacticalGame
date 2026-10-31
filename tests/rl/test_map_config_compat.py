"""地图配置 × 冻结环境快照的兼容性回归（pytest）。

跑批时的真实事故：标准模式把 `whirlpool`（`balance.maxTurns: null`、`balance.deployFromHq: false`）
放进图池后，304 个含模型的对战批次全部在第一局就异常退出——16 个模型撞 `float(None)`，
3 个旧模型撞引擎的 `invalid_deploy`。两类都由「地图配置合法、env 快照没建模」引起，
所以这里直接对**每张地图 × 每个 env 世代**做纯计算校验（不起 worker、不加载 torch）：

1. `_encode_state` 必须能编码该图的配置且输出有限值（覆盖 maxTurns=null 的归一化）；
2. `deployFromHq: false` 的图，helper 不得给出以总部为起点的 deploy（否则引擎必拒）。

Run with:  rl/.venv/Scripts/python.exe -m pytest tests/rl -q
"""

from __future__ import annotations

import importlib
import json
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
RL_DIR = ROOT / "rl"
MAPS_DIR = ROOT / "maps"
for _sub in ("envs", "runners", "training", "evaluation"):
    sys.path.insert(0, str(RL_DIR / _sub))

# evaluate_cross.py 会按动作空间/观测维度路由到这些快照；v2.6 复用 v2.4 的实现，不单列。
ENV_MODULES = ("env", "env_v27", "env_v25", "env_v24", "env_v22", "env_v200", "env_v100")
# 观测里用 maxTurns 做回合进度归一化的世代（其余世代不读该字段）。
TURN_LIMIT_MODULES = ("env", "env_v27", "env_v25", "env_v24")

HEX_DIRECTIONS = ((1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1))
MAP_PATHS = sorted(MAPS_DIR.glob("*.json"))


def _board_cells(config: dict) -> list[dict]:
    """按地图自己的口径取棋盘格：异形图读 playableCells，其余按 radius 铺满六角。"""
    terrain_at = {(int(c["q"]), int(c["r"])): c.get("terrain", "plain") for c in config.get("terrainCells", [])}
    playable = config.get("playableCells")
    if playable:
        coords = [(int(c["q"]), int(c["r"])) for c in playable]
    else:
        radius = int(config.get("radius", 8))
        coords = [
            (q, r)
            for q in range(-radius, radius + 1)
            for r in range(-radius, radius + 1)
            if max(abs(q), abs(r), abs(q + r)) <= radius
        ]
    return [{"q": q, "r": r, "terrain": terrain_at.get((q, r), "plain")} for q, r in coords]


def _state_for(config: dict, turn_limit: object = "from-map") -> dict:
    """构造一份最小但字段齐全的引擎状态。

    总部放在一对相邻空地上，并让出相邻格，这样「允许总部出兵」的地图一定能产出候选、
    「禁止总部出兵」的地图只能靠据点（本状态没有据点，因此候选必为空）。
    """
    cells = _board_cells(config)
    plain = sorted({(int(c["q"]), int(c["r"])) for c in cells if c.get("terrain", "plain") == "plain"})
    hq_pos = neighbor = None
    for pos in plain:
        for dq, dr in HEX_DIRECTIONS:
            candidate = (pos[0] + dq, pos[1] + dr)
            if candidate in plain:
                hq_pos, neighbor = pos, candidate
                break
        if hq_pos:
            break
    assert hq_pos and neighbor, "地图没有一对相邻空地，无法构造出兵候选"
    far = next(pos for pos in reversed(plain) if pos not in (hq_pos, neighbor))

    balance = dict(config.get("balance") or {})
    if turn_limit == "delete":
        balance.pop("maxTurns", None)
    elif turn_limit != "from-map":
        balance["maxTurns"] = turn_limit
    return {
        "config": {**config, "balance": balance},
        "cells": cells,
        "units": [
            {
                "id": "unit_b", "owner": "player_b", "type": "infantry",
                "q": far[0], "r": far[1], "alive": True,
                "hp": 10, "maxHp": 10, "attack": 10,
                "hasMoved": False, "hasActed": False, "actionSpent": False,
                "moveRange": 2, "attackRange": 1,
            }
        ],
        "headquarters": {
            "player_a": {"id": "hq_a", "owner": "player_a", "q": hq_pos[0], "r": hq_pos[1], "alive": True, "hp": 200, "defense": 5},
            "player_b": {"id": "hq_b", "owner": "player_b", "q": far[0], "r": far[1], "alive": True, "hp": 200, "defense": 5},
        },
        "controlPoints": [],
        "resources": {"player_a": {"supplies": 300}, "player_b": {"supplies": 300}},
        "turn": {"roundNumber": 3, "actionsUsed": 0, "currentPlayerId": "player_a"},
    }


def _env(module_name: str):
    module = importlib.import_module(module_name)
    env = module.HexGameEnv()
    env.owner = "player_a"
    env.opponent = "player_b"
    return module, env


def _load(map_path: Path) -> dict:
    return json.loads(map_path.read_text(encoding="utf-8"))


@pytest.mark.parametrize("map_path", MAP_PATHS, ids=lambda path: path.stem)
@pytest.mark.parametrize("module_name", ENV_MODULES)
def test_frozen_env_can_encode_every_map(map_path: Path, module_name: str) -> None:
    """任何合法地图配置都必须能被各代快照编码（maxTurns=null 曾让 16 个模型整批崩）。"""
    module, env = _env(module_name)
    observation = env._encode_state(_state_for(_load(map_path)))
    assert observation.shape == (module.OBSERVATION_SIZE,)
    assert np.isfinite(observation).all(), f"{module_name} 在 {map_path.stem} 上产出非有限值"


@pytest.mark.parametrize("map_path", MAP_PATHS, ids=lambda path: path.stem)
@pytest.mark.parametrize("module_name", ENV_MODULES)
def test_frozen_env_never_deploys_from_disabled_hq(map_path: Path, module_name: str) -> None:
    """deployFromHq=false 的图只能从据点出兵；helper 给总部起点会让引擎 invalid_deploy。"""
    _, env = _env(module_name)
    if not hasattr(env, "_fixed_deploy"):
        pytest.skip(f"{module_name} 没有 _fixed_deploy")
    config = _load(map_path)
    state = _state_for(config)
    deploy = env._fixed_deploy(state, "player_a", "infantry")
    if (config.get("balance") or {}).get("deployFromHq") is False:
        assert deploy is None, f"{module_name} 在 {map_path.stem} 上仍从总部出兵：{deploy}"
    else:
        assert deploy is not None, f"{module_name} 在 {map_path.stem} 上没能给出总部出兵候选"
        assert deploy["fromId"] == "hq_a"


@pytest.mark.parametrize("module_name", TURN_LIMIT_MODULES)
@pytest.mark.parametrize("map_path", MAP_PATHS, ids=lambda path: path.stem)
def test_null_turn_limit_normalises_like_missing_default(map_path: Path, module_name: str) -> None:
    """无回合上限按缺省 20 归一化：null 与「键缺失」必须编码出同一条观测。"""
    config = _load(map_path)
    _, null_env = _env(module_name)
    _, missing_env = _env(module_name)
    with_null = null_env._encode_state(_state_for(config, turn_limit=None))
    without_key = missing_env._encode_state(_state_for(config, turn_limit="delete"))
    assert np.array_equal(with_null, without_key)
    assert np.isfinite(with_null).all()
