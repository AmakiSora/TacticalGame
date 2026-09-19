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


# v3.2.0：参与评估的内置算法对手（mcts 除外，见 build_scenarios 的说明）。
ALGO_EVAL_NAMES = ("threat", "greedy", "field")
# 算法场景默认局数。比 champion 场景（96 局）少：算法是确定性策略、方差本就小，
# 而三个算法场景若也跑 96 局，评估开销会翻倍。可用 --algo-episodes 调整（冒烟用）。
ALGO_EVAL_EPISODES = 48


def build_scenarios(map_id: str, opponent_style: str, anchor_model: str, algo_scenarios: bool = False, algo_episodes: int = ALGO_EVAL_EPISODES) -> dict[str, dict[str, Any]]:
    """Scenario -> LocalHexGameEnv kwargs.  Mirrors the v2.7 validation set.

    v3.2.0：``algo_scenarios=True`` 追加三个**内置算法**对手场景（threat/greedy/
    field），它们只记录、初期不参与 best 选择（``_selection: False``，理由见
    ``selection_score``）。

    注意构造参数口径：算法对手不是 ``opponent_style="algorithm"``——``opponent_style``
    只接受四个规则风格，算法是由 ``algorithm_opponent_probability=1.0`` 决定的
    ``_choose_opponent_style`` 分支。``opponent_style`` 此时只是永不触发的规则兜底。

    mcts 不进池：实测它对最新模型只有 48-59%，是算法里最弱的一个，纳入评估只会
    白烧评估预算。
    """
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
    if algo_scenarios:
        for algorithm in ALGO_EVAL_NAMES:
            scenarios[f"random_algo_{algorithm}"] = {
                "map_id": map_id,
                "opponent_style": opponent_style,
                "algorithm_opponent": algorithm,
                "algorithm_opponent_probability": 1.0,
                # 评估要量的是算法真身的强度，不做确定性扰动。
                "algorithm_epsilon": 0.0,
                "_selection": False,
                # 算法场景降为 48 局（champion 场景 96 局），控制评估总开销。
                "_episodes": algo_episodes,
            }
    return scenarios


def split_scenario(kwargs: dict[str, Any], default_episodes: int) -> tuple[dict[str, Any], bool, int]:
    """把场景字典拆成 (环境构造参数, 是否参与 best 选择, 本场景局数)。

    ``_`` 前缀的键是评估管线的元数据，绝不能透传给 ``LocalHexGameEnv``（构造器会
    因未知参数报 TypeError）。旧结果 JSON / 旧场景不带这些键时按「参与选择 + 用全局
    局数」处理，保持向后兼容。
    """
    env_kwargs = {name: value for name, value in kwargs.items() if not name.startswith("_")}
    in_selection = bool(kwargs.get("_selection", True))
    episodes = int(kwargs.get("_episodes", default_episodes))
    return env_kwargs, in_selection, episodes


def play_scenario(model: Any, env: LocalHexGameEnv, episodes: int, seed_prefix: int, seed_stride: int = 1) -> dict[str, Any]:
    episodes = max(2, episodes + episodes % 2)
    # v3.2.0（评估功效修正）：种子必须**散布**而非顺序取。
    # 原实现 ``seed_prefix + episode // 2`` 使 ``--episodes N`` 只覆盖「前 N/2 个种子」这一
    # 特定子集 —— 实测前 24 个种子在 greedy 场景比其余 252 局难 21pt，导致 48 局口径下
    # 「A1–A3 +6.7pt」纯属子集偏差（300 局下为 0.0pt）。seed_stride > 1 时种子以大步长跨越
    # 整个种子空间，用小局数换取低偏差估计；默认 1 保持历史行为与历史可比性。
    seed_stride = max(1, int(seed_stride))
    wins = 0
    rewards: list[float] = []
    control_points: list[int] = []
    failures = 0
    # 分座位记账：配对换座下 episode 索引为偶数的局坐 player_a（先手）、奇数索引坐 player_b（后手）。
    seat_wins = {"first": 0, "second": 0}
    seat_games = {"first": 0, "second": 0}
    # v3.2.0 验收读数：HQ 伤害（裁决分数里的 headquartersDamage）与兵种构成。
    # 门禁是「对 4 算法总胜率 ≥ 50%」+「HQ 伤害 ≥ 60」+「侦察兵占比 ≥ 20%」，
    # 后两项必须能在每次评估里直接读到，否则只能等手工离线分析。
    hq_damage: list[float] = []
    own_hq_hp: list[float] = []
    scout_deploy_shares: list[float] = []
    scout_board_shares: list[float] = []
    for episode in range(episodes):
        seat = "first" if episode % 2 == 0 else "second"
        try:
            observation, _ = env.reset(
                seed=seed_prefix + (episode // 2) * seed_stride,
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
            score = env.state.get("adjudication", {}).get("scores", {}).get(env.owner, {}) or {}
            hq_damage.append(float(score.get("headquartersDamage", 0.0)))
            # 自家 HQ 剩余血量：A4 刻意没给"被打 HQ"加负向奖励（见 test_v320_shaping
            # 的不对称断言），这条读数就是用来验证"加了打 HQ 的奖励后，自己 HQ 有没有
            # 被打得更狠"（R2 风险：奖励改动破坏已学策略）。
            own_hq_hp.append(float((env.state.get("headquarters", {}).get(env.owner, {}) or {}).get("hp", 0.0)))
            # deploy 侧占比：直接对应"侦察兵占比 ≥ 20%"门禁（v3.1.1 实测 8%）。
            deployments = getattr(env, "deploy_counts", {}) or {}
            deploy_total = sum(deployments.values())
            scout_deploy_shares.append(deployments.get("scout", 0) / deploy_total if deploy_total else 0.0)
            # 盘面侧占比：终局存活单位里的侦察兵比例，反映"出得少但活下来的多吗"。
            own_units = [u for u in env.state.get("units", []) if u.get("alive") and u.get("owner") == env.owner]
            scout_alive = sum(1 for u in own_units if u.get("type") == "scout")
            scout_board_shares.append(scout_alive / len(own_units) if own_units else 0.0)
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
        "hq_damage_mean": float(np.mean(hq_damage)) if hq_damage else 0.0,
        "own_hq_hp_mean": float(np.mean(own_hq_hp)) if own_hq_hp else 0.0,
        "scout_deploy_share": float(np.mean(scout_deploy_shares)) if scout_deploy_shares else 0.0,
        "scout_board_share": float(np.mean(scout_board_shares)) if scout_board_shares else 0.0,
    }


def evaluate(model_path: str, map_id: str, opponent_style: str, anchor_model: str, episodes: int, seed_prefix: int, device: str = "cpu", algo_scenarios: bool = False, algo_episodes: int = ALGO_EVAL_EPISODES, seed_stride: int = 1) -> dict[str, Any]:
    from sb3_contrib import MaskablePPO

    # 学习率调度闭包只在续训时有用；评估用常数替代，避免 cloudpickle 反序列化问题。
    model = MaskablePPO.load(
        model_path,
        device=device,
        custom_objects={"learning_rate": 0.0, "lr_schedule": lambda _: 0.0},
    )
    results: dict[str, Any] = {"model": model_path, "scenarios": {}}
    for name, kwargs in build_scenarios(map_id, opponent_style, anchor_model, algo_scenarios, algo_episodes).items():
        env_kwargs, in_selection, scenario_episodes = split_scenario(kwargs, episodes)
        env = LocalHexGameEnv(**env_kwargs)
        try:
            entry = play_scenario(model, env, scenario_episodes, seed_prefix, seed_stride)
            # 场景实际使用的地图：selection_score 用它区分分布内/分布外场景。
            entry["map"] = env_kwargs["map_id"]
            # v3.2.0：是否参与 best 选择。算法场景为 False（只记录）。
            entry["in_selection"] = in_selection
            results["scenarios"][name] = entry
        finally:
            env.close()
    return results


def selection_score(results: dict[str, Any], train_map: str = "random") -> tuple[float, float, float, float, float]:
    """Lexicographic best-checkpoint key over **in-distribution** scenarios.

    五元组：(分布内最弱场景下界, 分布内后手座合并下界, 分布内平均下界, 占点, 回报)。

    v3.0.3 起分布外静态图场景（如 default_champion）只记录、不参与选择：
    v3.0.2 的教训——评估场景含训练分布外（default）时，min_wilson_lb 会被 OOD
    崩塌主导，系统性偏向训练早期断点（训练期 best 挑中 10 万步断点、96 局验收仅
    53:43，而同次训练的 1.4M 断点累计 123:69）。分布外的表现照常写入 TB 与日志，
    供人工观察，但不再影响 best 选择。

    后手座下界进第二位是因为 v3.0.1 的实测反例：350k 与 480k 两个断点对 v2.7.0
    总分 49:47 vs 50:46（噪声内相同），但后手座 39.6% vs **50.0%** 差 10pt。
    只看总分或最弱场景会挑中座位严重不对称的断点，而后手座能力正是历代短板
    （v2.8.0 仅 29.2%）。

    v3.2.0：算法场景带 ``in_selection: False``，同样只记录不参与选择（旧结果 JSON
    无该字段时默认 True，与 map 字段的向后兼容处理同构）。原因与 v3.0.2 的 OOD 教训
    相同：训练早期对算法必然低胜率，若进选择键会系统性偏向"对模型强但对算法弱"的
    早期断点。等阶段 B 后期对算法胜率稳定过 40% 后再单独开启。
    """
    scenarios = list(results.get("scenarios", {}).values())
    if not scenarios:
        return (-1.0, -1.0, -1.0, -float("inf"), -float("inf"))
    in_dist = [
        s for s in scenarios
        if s.get("map", train_map) == train_map and s.get("in_selection", True)
    ]
    if not in_dist:
        # 全部场景被排除（如以静态图为主训，或只跑了算法场景）时退回旧行为：
        # 全场景参与选择，避免返回空哨兵让 best 永远不被更新。
        in_dist = [s for s in scenarios if s.get("in_selection", True)] or scenarios
    lbs = [float(s["wilson_lb"]) for s in in_dist]
    second_wins = sum(int(s.get("seat_second", {}).get("wins", 0)) for s in in_dist)
    second_games = sum(int(s.get("seat_second", {}).get("games", 0)) for s in in_dist)
    return (
        min(lbs),
        wilson_lower_bound(second_wins, second_games),
        float(np.mean(lbs)),
        float(np.mean([s["cp_mean"] for s in in_dist])),
        float(np.mean([s["mean_reward"] for s in in_dist])),
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
    # v3.2.0（评估功效修正）：种子步长。默认 1 = 顺序取种子（历史行为）；
    # 大 stride 让「前 N/2 个种子」散布到整个种子空间，用少量局数换低偏差估计。
    parser.add_argument("--seed-stride", type=int, default=1)
    parser.add_argument("--device", default="cpu")
    # v3.2.0：算法对手评估场景（默认关，阶段 B 由 RL_EVAL_ALGO=1 打开）。
    parser.add_argument("--algo-scenarios", action="store_true")
    parser.add_argument("--algo-episodes", type=int, default=ALGO_EVAL_EPISODES)
    args = parser.parse_args()

    results = evaluate(args.model, args.map, args.opponent_style, args.anchor, args.episodes, args.seed_prefix, args.device, args.algo_scenarios, args.algo_episodes, args.seed_stride)
    tmp = args.out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(results, handle, ensure_ascii=False, indent=2)
    os.replace(tmp, args.out)
    for name, scenario in results["scenarios"].items():
        print(
            f"[eval-worker:{name}] win_rate={scenario['win_rate']:.0%} wilson_lb={scenario['wilson_lb']:.0%} "
            f"first={scenario['seat_first']['win_rate']:.0%} second={scenario['seat_second']['win_rate']:.0%} "
            f"cp={scenario['cp_mean']:.2f} mean_reward={scenario['mean_reward']:+.3f} "
            f"hq_damage={scenario['hq_damage_mean']:.1f} scout_deploy={scenario['scout_deploy_share']:.0%} "
            f"over {scenario['games']} paired games",
            flush=True,
        )


if __name__ == "__main__":
    main()
