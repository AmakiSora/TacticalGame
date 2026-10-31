"""并发追加互斥：8 进程同时写同一个 JSONL 时不得丢行或写坏行（pytest）。

真实事故：一次 --jobs 8、8 小时的跑批后，arena/matches.jsonl 里有 5 行只剩「尾巴」，
榜单页显示「已加载（5 条警告）」。本机实测裸 ``open('a')`` 并发追加会丢行/坏行，
``evaluate_cross.append_jsonl`` 用同目录 ``*.lock`` 做跨进程互斥后不再出现。

Run with:  rl/.venv/Scripts/python.exe -m pytest tests/rl -q
"""

from __future__ import annotations

import json
import sys
from multiprocessing import Process
from pathlib import Path

RL_DIR = Path(__file__).resolve().parents[2] / "rl"
sys.path.insert(0, str(RL_DIR / "evaluation"))

import evaluate_cross  # noqa: E402

LINES_PER_PROCESS = 40


def _worker(path_text: str, index: int) -> None:
    path = Path(path_text)
    for i in range(LINES_PER_PROCESS):
        evaluate_cross.append_jsonl(path, {
            "idx": index,
            "i": i,
            "map": "default",
            "players": {"player_a": f"hex_ppo_v3.3.0_w{index}", "player_b": "algo_greedy@v1"},
            "pad": "x" * 300,
        })


def test_append_jsonl_is_atomic_across_processes(tmp_path: Path) -> None:
    target = tmp_path / "matches.jsonl"
    processes = [Process(target=_worker, args=(str(target), index)) for index in range(8)]
    for proc in processes:
        proc.start()
    for proc in processes:
        proc.join()

    lines = [line for line in target.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert len(lines) == 8 * LINES_PER_PROCESS, "并发追加丢行"
    for line in lines:
        json.loads(line)  # 坏行会在这里抛 ValueError
