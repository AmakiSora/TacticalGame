"""三人评估（标准 / 歼灭 / 同时回合 / 大逃杀）：六局双向轮换、manifest 续跑与并列名次（pytest）。"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace

RL_DIR = Path(__file__).resolve().parents[2] / "rl"
sys.path.insert(0, str(RL_DIR / "evaluation"))

import evaluate_cross  # noqa: E402
import round_robin  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
PARTICIPANTS = [
    ("algo:greedy@v1", "algo_greedy@v1"),
    ("algo:random@v1", "algo_random@v1"),
    ("algo:threat@v1", "algo_threat@v1"),
]
NAMES = {name for _spec, name in PARTICIPANTS}
ANNIHILATION_PARTICIPANTS = [
    ("algo:random-annihilation@v1", "algo_random-annihilation@v1"),
    ("algo:shrinkroll@v1", "algo_shrinkroll@v1"),
    ("algo:vortex@v1", "algo_vortex@v1"),
]
SIMULTANEOUS_PARTICIPANTS = [
    ("algo:dest-prob@v2", "algo_dest-prob@v2"),
    ("algo:random-sim@v2", "algo_random-sim@v2"),
    ("algo:tempo@v1", "algo_tempo@v1"),
]
ROYALE_PARTICIPANTS = [
    ("algo:random-royale@v1", "algo_random-royale@v1"),
    ("algo:echelon@v1", "algo_echelon@v1"),
    ("algo:apex@v1", "algo_apex@v1"),
]


def test_six_game_manifest_balances_seats_first_turn_and_pair_order():
    manifest = round_robin.build_three_player_manifest(
        PARTICIPANTS, "multiplayer-ring", "rr-test-0-0-1-2", 6)
    games = manifest["games"]
    assert manifest["playerCount"] == 3
    assert manifest["rulesVersion"] == round_robin.THREE_PLAYER_RULES_VERSION
    assert len(games) == 6
    assert {game["direction"] for game in games} == {"forward", "reverse"}

    for name in NAMES:
        assert sum(game["seatOrder"][0] == name for game in games) == 2
        assert sum(game["seatOrder"][1] == name for game in games) == 2
        assert sum(game["seatOrder"][2] == name for game in games) == 2
    for first in NAMES:
        for second in NAMES:
            if first == second:
                continue
            assert sum(
                game["seatOrder"].index(first) < game["seatOrder"].index(second)
                for game in games
            ) == 3
    assert all(game["manifestHash"] == manifest["manifestHash"] for game in games)
    assert len({game["gameSeed"] for game in games}) == 1
    assert round_robin.build_three_player_manifest(
        PARTICIPANTS, "multiplayer-ring", "other-salt", 6)["manifestHash"] != manifest["manifestHash"]


def test_annihilation_manifest_freezes_its_own_rules_version():
    manifest = round_robin.build_three_player_manifest(
        ANNIHILATION_PARTICIPANTS, "artillery-zone", "rr-annihilation", 6, mode="annihilation")
    assert manifest["mode"] == "annihilation"
    assert manifest["rulesVersion"] == round_robin.THREE_PLAYER_RULES_VERSIONS["annihilation"]
    assert manifest["rulesVersion"] == "annihilation-3p-v1"
    # 标准榜仍是默认别名，模式不同则 hash 不同（跨模式无法续跑）。
    assert manifest["rulesVersion"] != round_robin.THREE_PLAYER_RULES_VERSION
    standard = round_robin.build_three_player_manifest(
        ANNIHILATION_PARTICIPANTS, "artillery-zone", "rr-annihilation", 6)
    assert standard["rulesVersion"] == "standard-3p-v1"
    assert standard["manifestHash"] != manifest["manifestHash"]


def test_three_player_plan_carries_the_annihilation_mode_into_every_task(tmp_path):
    stats = tmp_path / "matches.jsonl"
    tasks, skipped = round_robin.plan_three_player_tasks(
        ANNIHILATION_PARTICIPANTS, ["artillery-zone", "random-annihilation"],
        "rr-annihilation-plan", {}, 6, stats, mode="annihilation")
    assert skipped == 0
    assert [task["map"] for task in tasks] == ["artillery-zone", "random-annihilation"]
    for task in tasks:
        schedule = json.loads(Path(task["schedule_file"]).read_text(encoding="utf-8"))
        assert schedule["mode"] == "annihilation"
        assert schedule["rulesVersion"] == "annihilation-3p-v1"
        assert len(schedule["games"]) == 6


def test_three_player_manifest_rejects_unknown_modes():
    # 四种内置模式全部有三人分榜；未知模式仍在冻结 manifest 前就被挡住。
    round_robin.build_three_player_manifest(
        SIMULTANEOUS_PARTICIPANTS, "standoff", "rr-simultaneous", 6, mode="simultaneous")
    try:
        round_robin.build_three_player_manifest(
            ROYALE_PARTICIPANTS, "snowflake", "rr-unsupported", 6, mode="team-deathmatch")
    except ValueError as exc:
        assert "team-deathmatch" in str(exc)
    else:
        raise AssertionError("unknown three-player mode must be rejected")


def test_royale_manifest_freezes_its_own_rules_version():
    manifest = round_robin.build_three_player_manifest(
        ROYALE_PARTICIPANTS, "snowflake", "rr-royale", 6, mode="royale")
    assert manifest["mode"] == "royale"
    assert manifest["rulesVersion"] == "royale-3p-v1"
    assert manifest["rulesVersion"] == round_robin.THREE_PLAYER_RULES_VERSIONS["royale"]
    assert len(manifest["games"]) == 6
    # 计划大逃杀局的 ETA 需要该模式的单局成本（缩圈 + 淘汰比同时回合更久）。
    assert round_robin.THREE_PLAYER_COST_PER_GAME["royale"] > 0
    assert round_robin.THREE_PLAYER_COST_PER_GAME["royale"] > round_robin.THREE_PLAYER_COST_PER_GAME["standard"]


def test_three_player_plan_carries_the_royale_mode_into_every_task(tmp_path):
    stats = tmp_path / "matches.jsonl"
    tasks, skipped = round_robin.plan_three_player_tasks(
        ROYALE_PARTICIPANTS, ["snowflake", "random-royale"],
        "rr-royale-plan", {}, 6, stats, mode="royale")
    assert skipped == 0
    assert [task["map"] for task in tasks] == ["snowflake", "random-royale"]
    for task in tasks:
        schedule = json.loads(Path(task["schedule_file"]).read_text(encoding="utf-8"))
        assert schedule["mode"] == "royale"
        assert schedule["rulesVersion"] == "royale-3p-v1"
        assert len(schedule["games"]) == 6


def test_simultaneous_manifest_freezes_its_own_rules_version():
    manifest = round_robin.build_three_player_manifest(
        SIMULTANEOUS_PARTICIPANTS, "standoff", "rr-simultaneous", 6, mode="simultaneous")
    assert manifest["mode"] == "simultaneous"
    assert manifest["rulesVersion"] == "simultaneous-3p-v1"
    assert len(manifest["games"]) == 6
    # 计划同时回合局的 ETA 需要该模式的单局成本，缺键会在跑批前直接 KeyError。
    assert round_robin.THREE_PLAYER_COST_PER_GAME["simultaneous"] > 0


def test_three_player_plan_carries_the_simultaneous_mode_into_every_task(tmp_path):
    stats = tmp_path / "matches.jsonl"
    tasks, skipped = round_robin.plan_three_player_tasks(
        SIMULTANEOUS_PARTICIPANTS, ["standoff", "random-simultaneous"],
        "rr-sim-plan", {}, 6, stats, mode="simultaneous")
    assert skipped == 0
    assert [task["map"] for task in tasks] == ["standoff", "random-simultaneous"]
    for task in tasks:
        schedule = json.loads(Path(task["schedule_file"]).read_text(encoding="utf-8"))
        assert schedule["mode"] == "simultaneous"
        assert schedule["rulesVersion"] == "simultaneous-3p-v1"
        assert len(schedule["games"]) == 6


def test_resume_uses_only_the_missing_tail_of_the_same_manifest(tmp_path):
    stats = tmp_path / "matches.jsonl"
    manifest = round_robin.build_three_player_manifest(
        PARTICIPANTS, "multiplayer-ring", "rr-resume-0-0-1-2", 6)
    records = []
    for game in manifest["games"][:3]:
        records.append({
            "map": "multiplayer-ring",
            "playerCount": 3,
            "players": dict(zip(("player_a", "player_b", "player_c"), game["seatOrder"])),
            "manifestHash": manifest["manifestHash"],
            "schedule": game,
        })
    stats.write_text("\n".join(json.dumps(record) for record in records) + "\n", encoding="utf-8")

    existing = round_robin.count_three_player_existing(stats)
    tasks, skipped = round_robin.plan_three_player_tasks(
        PARTICIPANTS, ["multiplayer-ring"], "resume", existing, 6, stats)

    assert skipped == 0
    assert len(tasks) == 1
    assert tasks[0]["games"] == 3
    schedule = json.loads(Path(tasks[0]["schedule_file"]).read_text(encoding="utf-8"))
    assert [game["gameIndex"] for game in schedule["games"]] == [4, 5, 6]
    assert schedule["manifestHash"] == manifest["manifestHash"]


def test_plan_rejects_non_six_multiple_and_unsupported_maps():
    assert round_robin.map_supports_player_count(ROOT, "multiplayer-ring", 3)
    assert round_robin.map_supports_player_count(ROOT, "whirlpool", 3)
    assert round_robin.map_supports_player_count(ROOT, "standoff", 3)
    assert round_robin.map_supports_player_count(ROOT, "random-simultaneous", 3)
    assert round_robin.map_supports_player_count(ROOT, "snowflake", 3)
    assert round_robin.map_supports_player_count(ROOT, "random-royale", 3)
    assert not round_robin.map_supports_player_count(ROOT, "narrow-road", 3)
    assert not round_robin.map_supports_player_count(ROOT, "mistpine", 3)
    assert not round_robin.map_supports_player_count(ROOT, "default", 3)
    try:
        round_robin.plan_three_player_tasks(PARTICIPANTS, ["multiplayer-ring"], "x", {}, 5, ROOT / "x.jsonl")
    except ValueError as exc:
        assert "6 的倍数" in str(exc)
    else:
        raise AssertionError("five-game target must be rejected")


def test_schedule_reset_uses_three_seats_and_deterministic_game_seed():
    manifest = round_robin.build_three_player_manifest(
        PARTICIPANTS, "multiplayer-ring", "rr-reset", 6)
    game = manifest["games"][3]
    args = SimpleNamespace(
        map_id="multiplayer-ring", seed_prefix="ignored", swap_sides=False,
        schedule_by_index={game["gameIndex"]: game},
    )
    command = evaluate_cross.reset_command(args, game["gameIndex"])
    assert command == {
        "cmd": "reset",
        "mapId": "multiplayer-ring",
        "playerCount": 3,
        "seatOrder": ["player_a", "player_b", "player_c"],
        "firstSeat": 0,
        "gameSeed": game["gameSeed"],
    }


def test_rank_groups_preserve_ties_and_use_adjudication_on_timeout():
    seats = {"player_a": "A", "player_b": "B", "player_c": "C"}
    result = {
        "result": {
            "rankings": [
                {"playerId": "player_a", "status": "active", "score": {"total": 100}},
                {"playerId": "player_b", "status": "eliminated", "score": {"total": 80}},
                {"playerId": "player_c", "status": "eliminated", "score": {"total": 80}},
            ],
        },
    }
    assert evaluate_cross.rank_groups(result, seats) == [["A"], ["B", "C"]]
    timeout = {
        "adjudication": {
            "rankings": [
                {"playerId": "player_c", "status": "active", "score": {"total": 50}},
                {"playerId": "player_a", "status": "active", "score": {"total": 50}},
                {"playerId": "player_b", "status": "active", "score": {"total": 50}},
            ],
        },
    }
    assert evaluate_cross.rank_groups(timeout, seats) == [["C", "A", "B"]]
