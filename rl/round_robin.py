"""RL 模型 round-robin 批量对战编排器。

自动发现 rl/models/ 下的可对战模型，两两 × 指定地图批量互打，
结果累积到单个 JSONL，供 script/generateRlLeaderboard.mjs 评分与排行榜页面使用。

- 断点续跑：按（模型对, 地图）统计 JSONL 已有局数，只补差额，已跑对局不重复；
- 每次运行带随机盐 seed-prefix：重跑 random 图必产生新地图（静态图种子不生效，
  但引擎战斗带随机伤害浮动，每局同样不重复）；
- 复用 rl/evaluate_cross.py 子进程，原样保留其跨版本编码路由与配对换座逻辑。

用法示例：

    # 全量（120 对 × 7 图 × 24 局，约 20+ 小时，可分批跑）
    rl/.venv/Scripts/python.exe rl/round_robin.py

    # 先跑随机图池（约 3 小时）
    rl/.venv/Scripts/python.exe rl/round_robin.py --maps random

    # 冒烟测试
    rl/.venv/Scripts/python.exe rl/round_robin.py --maps default --models v2.7.0,v2.4.0,v2.2.0 --games 2

完成后运行 ``npm run rl-leaderboard`` 刷新排行榜数据。
"""

from __future__ import annotations

import argparse
import itertools
import json
import re
import secrets
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

MODEL_RE = re.compile(r"^hex_ppo_(v\d+\.\d+\.\d+)_")
# v1.0.0 为 512 动作旧格式，evaluate_cross.py 无法在进程内互打。
EXCLUDED_VERSIONS = {"v1.0.0"}
DEFAULT_MAPS = "random,default,breach,danger-close,desert,dual-lanes,forge"
DEFAULT_STATS_FILE = Path("rl/leaderboard/matches.jsonl")
# 每次调用的固定开销（torch 导入 + tsx worker 启动 + 模型加载），用于预估耗时。
TASK_OVERHEAD_SEC = 15
SEC_PER_GAME = 3.5


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--maps", default=DEFAULT_MAPS,
                        help=f"逗号分隔地图池（默认 {DEFAULT_MAPS}）")
    parser.add_argument("--games", type=int, default=24,
                        help="每对模型 × 地图的目标总局数（含已跑局数，默认 24）")
    parser.add_argument("--stats-file", default=None,
                        help=f"累积 JSONL 路径（默认 {DEFAULT_STATS_FILE}）")
    parser.add_argument("--salt", default=None,
                        help="地图种子盐（默认时间戳+随机 hex；重跑换盐才会产生新图）")
    parser.add_argument("--jobs", type=int, default=1,
                        help="并行任务数（默认 1；每个任务独立 python+引擎进程，建议 ≤ 物理核数-2）")
    parser.add_argument("--device", default="auto", help="torch 设备：auto / cuda / cpu")
    parser.add_argument("--models", default=None,
                        help="逗号分隔的文件名子串过滤，只评测匹配的模型（冒烟测试用）")
    parser.add_argument("--dry-run", action="store_true", help="只打印任务计划，不实际对战")
    return parser.parse_args()


def resolve_python(root: Path) -> str:
    for candidate in (
        root / "rl" / ".venv" / "Scripts" / "python.exe",
        root / "rl" / ".venv" / "bin" / "python",
    ):
        if candidate.exists():
            return str(candidate)
    return sys.executable


def discover_models(models_dir: Path) -> tuple[list[Path], list[Path]]:
    """返回 (可对战模型列表, 被排除模型列表)，均按文件名排序。"""
    included, excluded = [], []
    for path in sorted(models_dir.glob("*.zip")):
        match = MODEL_RE.match(path.name)
        if match and match.group(1) not in EXCLUDED_VERSIONS:
            included.append(path)
        else:
            excluded.append(path)
    return included, excluded


def count_existing(stats_file: Path) -> dict[tuple[str, str, str], int]:
    """按（地图, 模型 A, 模型 B）统计 JSONL 中已累积的局数。"""
    counts: dict[tuple[str, str, str], int] = {}
    if not stats_file.exists():
        return counts
    for line in stats_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except ValueError:
            continue
        players = record.get("players")
        if not isinstance(players, dict) or len(players) != 2:
            continue
        names = sorted(str(name) for name in players.values())
        map_id = str(record.get("map", ""))
        key = (map_id, names[0], names[1])
        counts[key] = counts.get(key, 0) + 1
    return counts


def build_command(python: str, script: Path, model_a: Path, model_b: Path,
                  map_id: str, games: int, stats_file: Path, seed_prefix: str,
                  device: str) -> list[str]:
    return [
        python, str(script),
        "--model-a", str(model_a),
        "--model-b", str(model_b),
        "--games", str(games),
        "--map", map_id,
        "--swap-sides",
        "--stats-file", str(stats_file),
        "--seed-prefix", seed_prefix,
        "--device", device,
    ]


def format_eta(seconds: float) -> str:
    seconds = max(0, int(seconds))
    hours, rem = divmod(seconds, 3600)
    minutes, secs = divmod(rem, 60)
    if hours:
        return f"{hours}h{minutes:02d}m"
    if minutes:
        return f"{minutes}m{secs:02d}s"
    return f"{secs}s"


class Progress:
    def __init__(self, total: int):
        self.total = total
        self.done = 0
        self.failed = 0
        self.elapsed = 0.0
        self.games = 0
        self._lock = threading.Lock()

    def report(self, label: str, ok: bool, games: int, duration: float, tail: str = "") -> None:
        with self._lock:
            self.done += 1
            if not ok:
                self.failed += 1
            self.elapsed += duration
            self.games += games
            avg = self.elapsed / self.done
            eta = avg * (self.total - self.done)
            status = "OK " if ok else "FAIL"
            rate = games / duration if duration > 0 else 0
            print(f"[{self.done}/{self.total}] {status} {label} "
                  f"（{games} 局 / {duration:.0f}s，{rate:.1f} 局/s）| 剩余约 {format_eta(eta)}",
                  flush=True)
            if not ok and tail:
                for line in tail.strip().splitlines()[-8:]:
                    print(f"    {line}", flush=True)


def run_task(command: list[str], label: str, games: int, progress: Progress) -> None:
    start = time.monotonic()
    ok, tail = False, ""
    try:
        result = subprocess.run(
            command,
            cwd=str(Path(__file__).resolve().parent.parent),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        ok = result.returncode == 0
        tail = result.stderr or result.stdout
    except OSError as exc:
        tail = str(exc)
    duration = time.monotonic() - start
    progress.report(label, ok, games if ok else 0, duration, tail if not ok else "")


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    args = parse_args()

    root = Path(__file__).resolve().parent.parent
    models_dir = root / "rl" / "models"
    stats_file = root / args.stats_file if args.stats_file else root / DEFAULT_STATS_FILE
    maps = [m.strip() for m in args.maps.split(",") if m.strip()]

    included, excluded = discover_models(models_dir)
    if args.models:
        needles = [n.strip() for n in args.models.split(",") if n.strip()]
        included = [m for m in included if any(n in m.name for n in needles)]
        excluded = [m for m in excluded if any(n in m.name for n in needles)]
    if len(included) < 2:
        print(f"错误：可对战模型不足 2 个（当前 {len(included)} 个），无法组成对战。", file=sys.stderr)
        for path in included:
            print(f"  入选：{path.name}", file=sys.stderr)
        return 1

    salt = args.salt or f"{time.strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(2)}"
    python = resolve_python(root)
    evaluate_script = root / "rl" / "evaluate_cross.py"

    print(f"参评模型 {len(included)} 个：")
    for path in included:
        version = MODEL_RE.match(path.name).group(1)
        print(f"  {version:<8} {path.name}")
    if excluded:
        print(f"排除 {len(excluded)} 个（{', '.join(sorted(EXCLUDED_VERSIONS))} 不支持进程内互打）：")
        for path in excluded:
            print(f"  - {path.name}")
    print(f"地图池：{', '.join(maps)}")
    print(f"目标：每对 × 每图 {args.games} 局；累积文件：{stats_file}")
    print(f"seed 盐：{salt}（断点续跑时请固定 --salt 以跳过已有局数）")

    counts = count_existing(stats_file)
    ordered = sorted(included, key=lambda p: p.name)
    tasks: list[dict] = []
    skipped_games = 0
    for map_idx, map_id in enumerate(maps):
        for i, j in itertools.combinations(range(len(ordered)), 2):
            name_a, name_b = ordered[i].name, ordered[j].name
            have = counts.get((map_id, name_a, name_b), 0)
            need = max(0, args.games - have)
            if need % 2 == 1:
                need += 1
            if need <= 0:
                skipped_games += have
                continue
            seed_prefix = f"rr-{salt}-{map_idx}-{i}-{j}"
            tasks.append({
                "model_a": ordered[i], "model_b": ordered[j],
                "map": map_id, "games": need, "seed_prefix": seed_prefix,
            })

    total_games = sum(task["games"] for task in tasks)
    print(f"\n任务：{len(tasks)} 个对战批次，待跑 {total_games} 局"
          f"（已完成 {skipped_games} 局直接跳过）。")
    if not tasks:
        print("所有目标局数已达成，无需补跑。")
        return 0
    print(f"预估耗时：约 {format_eta(len(tasks) * TASK_OVERHEAD_SEC + total_games * SEC_PER_GAME / max(1, args.jobs))}"
          f"（jobs={args.jobs}，单局 ~{SEC_PER_GAME}s + 每批 ~{TASK_OVERHEAD_SEC}s 启动开销）\n")

    if args.dry_run:
        for task in tasks:
            print(f"  {task['model_a'].name} vs {task['model_b'].name} "
                  f"@ {task['map']}：补 {task['games']} 局")
        return 0

    progress = Progress(len(tasks))
    commands = [
        (build_command(python, evaluate_script, task["model_a"], task["model_b"],
                       task["map"], task["games"], stats_file,
                       task["seed_prefix"], args.device),
         f"{task['model_a'].name} vs {task['model_b'].name} @ {task['map']}",
         task["games"])
        for task in tasks
    ]

    start = time.monotonic()
    if args.jobs <= 1:
        for command, label, games in commands:
            run_task(command, label, games, progress)
    else:
        with ThreadPoolExecutor(max_workers=args.jobs) as pool:
            futures = [pool.submit(run_task, command, label, games, progress)
                       for command, label, games in commands]
            for future in as_completed(futures):
                future.result()

    elapsed = time.monotonic() - start
    rate = progress.games / elapsed if elapsed > 0 else 0
    print(f"\n===== 总结 =====")
    print(f"完成批次 {progress.done}/{progress.total}，新增 {progress.games} 局，"
          f"失败 {progress.failed} 批，总用时 {format_eta(elapsed)}（{rate:.1f} 局/s）。")
    if progress.failed:
        print("存在失败批次：可原样重跑（断点续跑会只补差额），失败原因见上方输出。")
    print(f"刷新排行榜数据：npm run rl-leaderboard")
    return 1 if progress.failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
