"""训练环境对虚拟随机图 id 的处理（pytest）。

Run with:  rl/.venv/Scripts/python.exe -m pytest tests/rl -q

回归点：worker 接受 ``random`` / ``random-<mode>`` 四个虚拟随机图 id 后，训练环境不能
只在 ``map_id == "random"`` 时才附带随机参数——否则 ``map_mix`` 写非标准随机图 id 会
生成一张无种子的图，gym seed 不再可复现。静态图路径必须保持「不取 np_random」不变。
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

RL_DIR = Path(__file__).resolve().parents[2] / "rl"
# 与 test_env_v300.py 同口径：按子目录挂 sys.path，保留扁平模块名。
for _sub in ("envs", "runners", "training", "evaluation"):
    sys.path.insert(0, str(RL_DIR / _sub))

import local_env  # noqa: E402
import round_robin  # noqa: E402


class _OptionsHost:
    """只持有 ``_build_random_options`` 需要的两个属性，避免真的拉起 worker。"""

    # 借用真实实现（它只读 np_random / random_options / 环境变量），不复制逻辑。
    _build_random_options = local_env.LocalHexGameEnv._build_random_options

    def __init__(self, seed: int = 7) -> None:
        self.np_random = np.random.default_rng(seed)
        self.random_options: dict[str, object] = {}


@pytest.fixture(autouse=True)
def _clean_random_env(monkeypatch):
    """训练环境读取的两个随机域环境变量不应影响本文件的断言。"""
    monkeypatch.delenv("RL_RANDOM_OPTIONS", raising=False)
    monkeypatch.delenv("RL_RANDOM_CORNER_BOOST", raising=False)


def test_random_map_ids_match_the_evaluation_table():
    """两处 Python 副表必须同步；漏一个就会静默生成无种子随机图。"""
    assert set(local_env.RANDOM_MAP_IDS) == set(round_robin.RANDOM_MAP_MODES.values())


@pytest.mark.parametrize("map_id", [
    "random",
    "random-annihilation",
    "random-simultaneous",
    "random-royale",
])
def test_virtual_random_map_ids_get_a_seeded_option_set(map_id):
    options = local_env.LocalHexGameEnv._random_options_for(_OptionsHost(), map_id)
    assert options is not None
    assert options["symmetric"] is True
    assert str(options["seed"]).startswith("ep-")


def test_static_maps_never_touch_the_random_stream():
    host = _OptionsHost()
    assert local_env.LocalHexGameEnv._random_options_for(host, "default") is None
    assert local_env.LocalHexGameEnv._random_options_for(host, "snowflake") is None
    assert local_env.LocalHexGameEnv._random_options_for(host, "random") is not None


def test_same_gym_seed_reproduces_the_same_random_map_seed():
    first = local_env.LocalHexGameEnv._random_options_for(_OptionsHost(11), "random-royale")
    second = local_env.LocalHexGameEnv._random_options_for(_OptionsHost(11), "random-royale")
    assert first == second
    other = local_env.LocalHexGameEnv._random_options_for(_OptionsHost(12), "random-royale")
    assert first != other
