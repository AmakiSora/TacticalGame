"""Out-of-process evaluation for train.py (v2.8).

Plays deterministic paired-seed games for one saved checkpoint against the
validation scenarios and writes a JSON summary.  train.py launches this as a
subprocess so evaluation no longer stalls rollout collection (in v2.7.1 the
inline evaluation cut effective training fps roughly in half).

Usage (normally invoked by train.py):
    python rl/eval_worker.py --model <ckpt.zip> --out <result.json>
        --map random --opponent-style mixed --episodes 48 --seed-prefix 27000
        [--anchor <champion.zip>]
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path
from typing import Any

import numpy as np

# rl/ 已重组为 envs/runners/training/evaluation 子目录；把各代码目录挂上 sys.path，
# 让既有的扁平模块名（如 ``from local_env import ...``）在脚本模式下继续可用。
_RL_ROOT = Path(__file__).resolve().parent.parent
for _sub in ("envs", "runners", "training", "evaluation"):
    _p = str(_RL_ROOT / _sub)
    if _p not in sys.path:
        sys.path.insert(0, _p)

from local_env import LocalHexGameEnv  # noqa: E402


def wilson_lower_bound(wins: int, games: int, z: float = 1.96) -> float:
    """95% Wilson score lower bound; the robust replacement for raw win rate.

    40 games at 60% has a lower bound around 45%, so a checkpoint only beats
    the incumbent when the improvement is bigger than the sampling noise.
    """
    if games <= 0:
        return 0.0
    p = wins / games
    denominator = 1.0 + z * z / games
    centre = p + z * z / (2.0 * games)
    margin = z * math.sqrt(p * (1.0 - p) / games + z * z / (4.0 * games * games))
    return max(0.0, (centre - margin) / denominator)


def build_scenarios(map_id: str, opponent_style: str, anchor_model: str) -> dict[str, dict[str, Any]]:
    """Scenario -> LocalHexGameEnv kwargs.  Mirrors the v2.7 validation set."""
    scenarios: dict[str, dict[str, Any]] = {
        "random_rule": {"map_id": map_id, "opponent_style": opponent_style},
    }
    if anchor_model:
        champion = {
            "opponent_style": opponent_style,
            "self_play_probability": 1.0,
            "anchor_model_path": anchor_model,
            "anchor_probability": 1.0,
        }
        scenarios["random_champion"] = {"map_id": map_id, **champion}
        scenarios["default_champion"] = {"map_id": "default", **champion}
    return scenarios


def play_scenario(model: Any, env: LocalHexGameEnv, episodes: int, seed_prefix: int) -> dict[str, Any]:
    episodes = max(2, episodes + episodes % 2)
    wins = 0
    rewards: list[float] = []
    control_points: list[int] = []
    failures = 0
    # 分座位记账：配对换座下 episode 索引为偶数的局坐 player_a（先手）、奇数索引坐 player_b（后手）。
    seat_wins = {"first": 0, "second": 0}
    seat_games = {"first": 0, "second": 0}
    for episode in range(episodes):
        seat = "first" if episode % 2 == 0 else "second"
        try:
            observation, _ = env.reset(
                seed=seed_prefix + episode // 2,
                options={"owner": "player_a" if seat == "first" else "player_b"},
            )
            done = False
            total = 0.0
            while not done:
                action, _ = model.predict(observation, deterministic=True, action_masks=env.action_masks())
                observation, reward, terminated, truncated, _ = env.step(int(action))
                total += float(reward)
                done = terminated or truncated
            rewards.append(total)
            won = env.state.get("winner") == env.owner
            wins += int(won)
            seat_wins[seat] += int(won)
            seat_games[seat] += 1
            control_points.append(sum(p.get("owner") == env.owner for p in env.state.get("controlPoints", [])))
        except Exception as error:  # 单局失败不拖垮整轮评估。
            failures += 1
            print(f"[eval-worker] episode {episode} failed: {error}", file=sys.stderr, flush=True)
    games = len(rewards)

    def seat_report(name: str) -> dict[str, Any]:
        played = seat_games[name]
        return {
            "games": played,
            "wins": seat_wins[name],
            "win_rate": seat_wins[name] / played if played else 0.0,
            "wilson_lb": wilson_lower_bound(seat_wins[name], played),
        }

    return {
        "games": games,
        "wins": wins,
        "failures": failures,
        "win_rate": wins / games if games else 0.0,
        "wilson_lb": wilson_lower_bound(wins, games),
        "seat_first": seat_report("first"),
        "seat_second": seat_report("second"),
        "cp_mean": float(np.mean(control_points)) if control_points else 0.0,
        "mean_reward": float(np.mean(rewards)) if rewards else 0.0,
    }


def evaluate(model_path: str, map_id: str, opponent_style: str, anchor_model: str, episodes: int, seed_prefix: int, device: str = "cpu") -> dict[str, Any]:
    from sb3_contrib import MaskablePPO

    # 学习率调度闭包只在续训时有用；评估用常数替代，避免 cloudpickle 反序列化问题。
    model = MaskablePPO.load(
        model_path,
        device=device,
        custom_objects={"learning_rate": 0.0, "lr_schedule": lambda _: 0.0},
    )
    results: dict[str, Any] = {"model": model_path, "scenarios": {}}
    for name, kwargs in build_scenarios(map_id, opponent_style, anchor_model).items():
        env = LocalHexGameEnv(**kwargs)
        try:
            results["scenarios"][name] = play_scenario(model, env, episodes, seed_prefix)
        finally:
            env.close()
    return results


def selection_score(results: dict[str, Any]) -> tuple[float, float, float, float, float]:
    """Lexicographic best-checkpoint key: weakest scenario, then second-seat LB.

    后手座下界进第二位是因为 v3.0.1 的实测反例：350k 与 480k 两个断点对 v2.7.0
    总分 49:47 vs 50:46（噪声内相同），但后手座 39.6% vs **50.0%** 差 10pt。
    只看总分或最弱场景会挑中座位严重不对称的断点，而后手座能力正是历代短板
    （v2.8.0 仅 29.2%）。
    """
    scenarios = list(results.get("scenarios", {}).values())
    if not scenarios:
        return (-1.0, -1.0, -1.0, -float("inf"), -float("inf"))
    lbs = [float(s["wilson_lb"]) for s in scenarios]
    second_wins = sum(int(s.get("seat_second", {}).get("wins", 0)) for s in scenarios)
    second_games = sum(int(s.get("seat_second", {}).get("games", 0)) for s in scenarios)
    return (
        min(lbs),
        wilson_lower_bound(second_wins, second_games),
        float(np.mean(lbs)),
        float(np.mean([s["cp_mean"] for s in scenarios])),
        float(np.mean([s["mean_reward"] for s in scenarios])),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--map", default="random")
    parser.add_argument("--opponent-style", default="mixed")
    parser.add_argument("--anchor", default="")
    parser.add_argument("--episodes", type=int, default=48)
    parser.add_argument("--seed-prefix", type=int, default=27_000)
    parser.add_argument("--device", default="cpu")
    args = parser.parse_args()

    results = evaluate(args.model, args.map, args.opponent_style, args.anchor, args.episodes, args.seed_prefix, args.device)
    tmp = args.out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(results, handle, ensure_ascii=False, indent=2)
    os.replace(tmp, args.out)
    for name, scenario in results["scenarios"].items():
        print(
            f"[eval-worker:{name}] win_rate={scenario['win_rate']:.0%} wilson_lb={scenario['wilson_lb']:.0%} "
            f"first={scenario['seat_first']['win_rate']:.0%} second={scenario['seat_second']['win_rate']:.0%} "
            f"cp={scenario['cp_mean']:.2f} mean_reward={scenario['mean_reward']:+.3f} over {scenario['games']} paired games",
            flush=True,
        )


if __name__ == "__main__":
    main()
