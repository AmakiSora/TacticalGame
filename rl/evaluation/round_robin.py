"""AI 竞技场 round-robin 批量对战编排器（模型 × 模型 / 模型 × 算法 / 算法 × 算法）。

自动发现 rl/models/ 下的可对战模型与 algorithms/registry.mjs 注册的内置算法，
两两 × 指定地图批量互打，结果累积到单个 JSONL，
供 script/generateArenaLeaderboard.mjs 评分与竞技场页面使用。

- 断点续跑：按（参与者对, 地图）统计 JSONL 已有局数，只补差额，已跑对局不重复；
- 每局完成即写入累积 JSONL（中断只丢进行中的一局），逐局进度行经 ``进度|`` 前缀
  实时透传到控制台，批次完成行与剩余耗时预估按各批预估单独计算；
- 每次运行带随机盐 seed-prefix：重跑 random 图必产生新地图（静态图种子不生效，
  但引擎战斗带随机伤害浮动，每局同样不重复）；
- 复用 rl/evaluation/evaluate_cross.py 子进程，原样保留其跨版本编码路由与配对换座逻辑；
- 算法参与者的名字以 ``algo_`` 前缀 + 版本写入 matches.jsonl（如 algo_threat@v1），
  传参规格为 ``algo:<name>@<version>``（版本取 registry.mjs 的当前标注，保证
  算法升版后历史对局仍归属旧版本 id）；--algorithms none 可退回纯模型循环赛；
- 地图模式从 maps/<id>.json 的 ``mode`` 字段推断（random 固定 standard）；同一批
  只能跑同一模式。standard 之外的模式按注册表 ``ALGORITHM_META.modes`` 只纳入该模式
  算法（同时回合当前有 random-sim / dest-prob / kriegspiel / matrix-eq），RL 模型
  仅支持标准模式，不参与同时模式跑批。

用法示例：

    # 全量标准模式（模型+算法两两 × 5 图 × 24 局，可分批跑）
    rl/.venv/Scripts/python.exe rl/evaluation/round_robin.py

    # 先跑随机图池
    rl/.venv/Scripts/python.exe rl/evaluation/round_robin.py --maps random

    # 同时回合（仅内置算法；两张同时模式地图）
    rl/.venv/Scripts/python.exe rl/evaluation/round_robin.py \
        --maps standoff,molten-throne --games 24

    # 冒烟测试
    rl/.venv/Scripts/python.exe rl/evaluation/round_robin.py --maps default \
        --models v2.7.0 --algorithms greedy,threat --games 2

完成后运行 ``npm run arena-leaderboard`` 刷新排行榜数据。
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
DEFAULT_MAPS = "random,default,breach,danger-close,dual-lanes"
DEFAULT_STATS_FILE = Path("arena/matches.jsonl")
# 评估链路已接入的模式：standard 走逐动作执行，simultaneous 走计划入队/提交；
# annihilation / royale 的炮火缩圈与淘汰流程尚未接入。
SUPPORTED_EVAL_MODES = ("standard", "simultaneous")
# 模型批次的固定开销（torch 导入 + tsx worker 启动 + 模型加载）与单局耗时；
# 纯算法批次不加载模型，开销低一档。单局耗时优先用累积历史均速，缺历史时按
# 模式兜底：同时回合单局远慢于标准模式且地图间差异大（实测对峙之地 ~6s/局、
# 雾杉疏林重算法对 ~160s/局），兜底值取偏保守的中间量。
TASK_OVERHEAD_SEC_MODEL = 15
SEC_PER_GAME_MODEL = 3.5
TASK_OVERHEAD_SEC_ALGO = 6
SEC_PER_GAME_ALGO_STANDARD = 1.0
SEC_PER_GAME_ALGO_SIMULTANEOUS = 20.0
# evaluate_cross.py 每局完成的进度行前缀：实时透传到评估控制台，其余输出仅在
# 批次失败时回显尾部。字面量与前者保持一致（脚本间不经 import 共享）。
GAME_PROGRESS_PREFIX = "进度|"


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--maps", default=DEFAULT_MAPS,
                        help=f"逗号分隔地图池（默认 {DEFAULT_MAPS}）")
    parser.add_argument("--mode", choices=("auto",) + SUPPORTED_EVAL_MODES, default="auto",
                        help="对局模式（默认 auto：按所选地图的 mode 字段推断；同一批不能混模式）")
    parser.add_argument("--games", type=int, default=24,
                        help="每对参与者 × 地图的目标总局数（含已跑局数，默认 24）")
    parser.add_argument("--stats-file", default=None,
                        help=f"累积 JSONL 路径（默认 {DEFAULT_STATS_FILE}）")
    parser.add_argument("--salt", default=None,
                        help="地图种子盐（默认时间戳+随机 hex；重跑换盐才会产生新图）")
    parser.add_argument("--jobs", type=int, default=1,
                        help="并行任务数（默认 1；每个任务独立 python+引擎进程，建议 ≤ 物理核数-2）")
    parser.add_argument("--device", default="auto", help="torch 设备：auto / cuda / cpu")
    parser.add_argument("--models", default=None,
                        help="逗号分隔的文件名子串过滤，只评测匹配的模型（冒烟测试用）")
    parser.add_argument("--algorithms", default=None,
                        help="逗号分隔算法名（缺省=当前模式全部注册算法；none=不带算法，纯模型循环赛）")
    parser.add_argument("--policy-stats", action="store_true",
                        help="透传给 evaluate_cross：每步额外记录价值估计/策略熵，跑批耗时约翻倍")
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
    """返回 (可对战模型, 旧格式排除的模型)，均按文件名排序。"""
    included, excluded = [], []
    for path in sorted(models_dir.glob("*.zip")):
        match = MODEL_RE.match(path.name)
        if not match or match.group(1) in EXCLUDED_VERSIONS:
            excluded.append(path)
        else:
            included.append(path)
    return included, excluded


def load_map_modes(root: Path) -> dict[str, str]:
    """读取 maps/*.json 的 mode 字段；random 固定 standard，缺省字段按 standard。"""
    modes = {"random": "standard"}
    for path in sorted((root / "maps").glob("*.json")):
        try:
            config = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise ValueError(f"无法读取地图 {path.name}：{exc}") from exc
        mode = config.get("mode") if isinstance(config, dict) else None
        modes[path.stem] = mode if isinstance(mode, str) and mode else "standard"
    return modes


def resolve_mode(root: Path, maps: list[str], requested: str) -> str:
    """把地图池解析成唯一对局模式；混模式/未知地图/未接入模式一律拒绝。"""
    if not maps:
        raise ValueError("地图池不能为空")
    map_modes = load_map_modes(root)
    unknown = [map_id for map_id in maps if map_id not in map_modes]
    if unknown:
        raise ValueError(f"未知地图：{', '.join(unknown)}")
    modes = {map_modes[map_id] for map_id in maps}
    if len(modes) != 1:
        detail = "、".join(f"{map_id}={map_modes[map_id]}" for map_id in maps)
        raise ValueError(f"同一批只能跑同一模式，不能混合：{detail}")
    mode = modes.pop()
    if mode not in SUPPORTED_EVAL_MODES:
        raise ValueError(f"地图模式 {mode} 尚未接入评估跑批（当前支持 {' / '.join(SUPPORTED_EVAL_MODES)}）")
    if requested != "auto" and requested != mode:
        raise ValueError(f"--mode {requested} 与地图模式 {mode} 不一致")
    return mode


def discover_algorithms(root: Path, mode: str = "standard") -> list[tuple[str, str]]:
    """读取 algorithms/registry.mjs 的注册算法及当前版本（经 node，避免手工维护第二份名单）。

    返回 (注册名, 版本) 对，两者拼成竞技场参与者 id ``algo_<注册名>@<版本>``。
    只发现支持当前地图模式的算法（注册表 ALGORITHM_META.modes 是唯一口径）；
    不同模式不能混用算法。
    """
    registry_url = (root / "algorithms" / "registry.mjs").as_posix()
    mode_literal = json.dumps(mode)
    script = (f"import('file:///{registry_url}').then(r => console.log("
              f"r.listAlgorithmInfo().filter(i => i.modes.includes({mode_literal}))"
              ".map(i => i.name + '@' + i.version).join(',')))")
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=str(root), capture_output=True, text=True,
        encoding="utf-8", errors="replace",
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or f"node exit {result.returncode}")
    pairs: list[tuple[str, str]] = []
    for token in result.stdout.strip().split(","):
        token = token.strip()
        if not token:
            continue
        name, _, version = token.partition("@")
        pairs.append((name, version or "v1"))
    return pairs


def resolve_algorithms(root: Path, raw: str | None, mode: str = "standard") -> tuple[list[tuple[str, str]], str | None]:
    """把 --algorithms 参数解析成 (注册名, 版本) 清单；node 不可用时降级为空清单并给出警告。"""
    if raw is not None and raw.strip().lower() in ("none", "off", ""):
        return [], None
    try:
        registered = discover_algorithms(root, mode)
    except (OSError, RuntimeError) as exc:
        return [], f"无法读取算法注册表（node 不可用？）：{exc}；本轮不带算法参与者。"
    if raw is None:
        return registered, None
    needles = [n.strip() for n in raw.split(",") if n.strip()]
    names = [name for name, _ in registered]
    unknown = [n for n in needles if n not in names]
    if unknown:
        raise ValueError(f"未注册的算法：{', '.join(unknown)}（可选：{', '.join(names)}）")
    return [pair for pair in registered if pair[0] in needles], None


def _pair_key(map_id: str, name_a: str, name_b: str) -> tuple[str, str, str]:
    """累积统计的键：地图 + 排序后的参与者显示名（座位次序不敏感）。"""
    first, second = sorted((name_a, name_b))
    return (map_id, first, second)


def count_existing(stats_file: Path) -> tuple[dict[tuple[str, str, str], int],
                                              dict[tuple[str, str, str], float]]:
    """按（地图, 参与者 A, 参与者 B）统计 JSONL 已累积局数与总耗时（秒）。

    耗时取记录的 durationSec，供耗时预估用；早期无计时的旧局只计局数、不进样本。
    """
    counts: dict[tuple[str, str, str], int] = {}
    durations: dict[tuple[str, str, str], float] = {}
    if not stats_file.exists():
        return counts, durations
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
        key = (str(record.get("map", "")), names[0], names[1])
        counts[key] = counts.get(key, 0) + 1
        duration = record.get("durationSec")
        if isinstance(duration, (int, float)) and duration > 0:
            durations[key] = durations.get(key, 0.0) + float(duration)
    return counts, durations


def build_command(python: str, script: Path, spec_a: str, spec_b: str,
                  map_id: str, games: int, stats_file: Path, seed_prefix: str,
                  device: str, policy_stats: bool = False) -> list[str]:
    command = [
        python, str(script),
        "--player-a", spec_a,
        "--player-b", spec_b,
        "--games", str(games),
        "--map", map_id,
        "--swap-sides",
        "--stats-file", str(stats_file),
        "--seed-prefix", seed_prefix,
        "--device", device,
    ]
    if policy_stats:
        command.append("--policy-stats")
    return command


def estimate_batch_seconds(task: dict, counts: dict, durations: dict,
                           map_avgs: dict[str, float], mode: str) -> float:
    """逐批次预估耗时（秒）：模型批保持常量；纯算法批单局耗时按
    同图同对累积历史均速 > 同图均速 > 模式兜底 的顺序取值。"""
    if not (task["spec_a"].startswith("algo:") and task["spec_b"].startswith("algo:")):
        return TASK_OVERHEAD_SEC_MODEL + task["games"] * SEC_PER_GAME_MODEL
    per_game: float | None = None
    key = _pair_key(task["map"], task["name_a"], task["name_b"])
    count = counts.get(key, 0)
    if count and key in durations:
        per_game = durations[key] / count
    else:
        per_game = map_avgs.get(task["map"])
    if per_game is None:
        per_game = (SEC_PER_GAME_ALGO_SIMULTANEOUS if mode == "simultaneous"
                    else SEC_PER_GAME_ALGO_STANDARD)
    return TASK_OVERHEAD_SEC_ALGO + task["games"] * per_game


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
    def __init__(self, total: int, estimates: list[float], jobs: int):
        self.total = total
        self.done = 0
        self.failed = 0
        self.elapsed = 0.0
        self.games = 0
        # 各批预估耗时的副本：完成一批清零一项，剩余 ETA = 未完成批次预估和 / 并发数。
        # 比「平均批次耗时 × 剩余批数」更贴近慢批次垫底（如重算法对 × 大地图）的收尾。
        self.remaining_estimates = list(estimates)
        self.jobs = max(1, jobs)
        self._lock = threading.Lock()

    def report(self, index: int, label: str, ok: bool, games: int, duration: float,
               tail: str = "") -> None:
        with self._lock:
            self.done += 1
            if not ok:
                self.failed += 1
            self.elapsed += duration
            self.games += games
            self.remaining_estimates[index] = 0.0
            eta = sum(self.remaining_estimates) / self.jobs
            status = "OK " if ok else "FAIL"
            detail = f"{games} 局 / {format_eta(duration)}"
            if games > 0 and duration > 0:
                rate = games / duration
                # 慢批次按 局/s 会显示成 0.0，低速率改用 s/局 更可读。
                detail += f"，{rate:.1f} 局/s" if rate >= 0.1 else f"，{duration / games:.0f}s/局"
            print(f"[{self.done}/{self.total}] {status} {label}（{detail}）| 剩余约 {format_eta(eta)}",
                  flush=True)
            if not ok and tail:
                for line in tail.strip().splitlines()[-8:]:
                    print(f"    {line}", flush=True)


def run_task(command: list[str], label: str, games: int, progress: Progress,
             task_index: int) -> None:
    start = time.monotonic()
    ok, tail = False, ""
    try:
        proc = subprocess.Popen(
            command,
            cwd=str(Path(__file__).resolve().parent.parent.parent),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        # stderr 由独立线程排空，避免管道写满阻塞子进程；stdout 逐行读，
        # 每局完成的进度行即时透传（8 路并发下带 label 才能分清属于哪批），
        # 其余输出留作失败回显，只保留尾部防长跑积内存。
        stderr_lines: list[str] = []
        stderr_thread = threading.Thread(
            target=lambda: stderr_lines.extend(proc.stderr or []), daemon=True)
        stderr_thread.start()
        stdout_tail: list[str] = []
        for line in proc.stdout or []:
            line = line.rstrip("\n")
            if not line:
                continue
            if line.startswith(GAME_PROGRESS_PREFIX):
                print(f"  [{label}] {line[len(GAME_PROGRESS_PREFIX):]}", flush=True)
            else:
                stdout_tail.append(line)
                if len(stdout_tail) > 200:
                    stdout_tail.pop(0)
        proc.wait()
        stderr_thread.join(timeout=5)
        ok = proc.returncode == 0
        tail = "\n".join(stderr_lines) or "\n".join(stdout_tail)
    except OSError as exc:
        tail = str(exc)
    duration = time.monotonic() - start
    progress.report(task_index, label, ok, games if ok else 0, duration, tail if not ok else "")


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    args = parse_args()

    # 本文件位于 rl/evaluation/，项目根需上溯三级。
    root = Path(__file__).resolve().parent.parent.parent
    models_dir = root / "rl" / "models"
    stats_file = root / args.stats_file if args.stats_file else root / DEFAULT_STATS_FILE
    maps = [m.strip() for m in args.maps.split(",") if m.strip()]

    try:
        mode = resolve_mode(root, maps, args.mode)
    except ValueError as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 1

    if mode == "standard":
        included, excluded = discover_models(models_dir)
        if args.models:
            needles = [n.strip() for n in args.models.split(",") if n.strip()]
            included = [m for m in included if any(n in m.name for n in needles)]
            excluded = [m for m in excluded if any(n in m.name for n in needles)]
    else:
        if args.models:
            print(f"错误：{mode} 模式暂不支持 RL 模型参评（现有模型仅覆盖 standard）。",
                  file=sys.stderr)
            return 1
        included, excluded = [], []

    try:
        algorithm_infos, algo_warning = resolve_algorithms(root, args.algorithms, mode)
    except ValueError as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 1

    # 统一参与者列表：(规格, 显示名)。显示名即 matches.jsonl 中的玩家 id。
    participants: list[tuple[str, str]] = [(str(path), path.name) for path in included]
    participants += [
        (f"algo:{name}@{version}", f"algo_{name}@{version}")
        for name, version in algorithm_infos
    ]
    if len(participants) < 2:
        print(f"错误：可对战参与者不足 2 个（当前 {len(participants)} 个），无法组成对战。", file=sys.stderr)
        return 1

    salt = args.salt or f"{time.strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(2)}"
    python = resolve_python(root)
    evaluate_script = root / "rl" / "evaluation" / "evaluate_cross.py"

    print(f"对局模式：{mode}")
    print(f"参评模型 {len(included)} 个：" if included else "参评模型：无（该模式不参评）")
    for path in included:
        version = MODEL_RE.match(path.name).group(1)
        print(f"  {version:<8} {path.name}")
    if excluded:
        print(f"排除 {len(excluded)} 个（{', '.join(sorted(EXCLUDED_VERSIONS))} 不支持进程内互打）：")
        for path in excluded:
            print(f"  - {path.name}")
    if algorithm_infos:
        print(f"参评算法 {len(algorithm_infos)} 个："
              f"{', '.join(f'{name}@{version}' for name, version in algorithm_infos)}")
    elif (args.algorithms or "").strip().lower() in ("none", "off", ""):
        print("参评算法：无（--algorithms none）")
    if algo_warning:
        print(f"警告：{algo_warning}")
    print(f"地图池：{', '.join(maps)}")
    print(f"目标：每对 × 每图 {args.games} 局；累积文件：{stats_file}")
    print(f"seed 盐：{salt}（断点续跑时请固定 --salt 以跳过已有局数）")

    counts, durations = count_existing(stats_file)
    # 同图均速兜底样本：该图全部带计时历史合并平均，覆盖「新对子尚无历史」的场景。
    map_games: dict[str, int] = {}
    map_seconds: dict[str, float] = {}
    for (map_key, _name_a, _name_b), total_sec in durations.items():
        map_games[map_key] = map_games.get(map_key, 0) + counts.get((map_key, _name_a, _name_b), 0)
        map_seconds[map_key] = map_seconds.get(map_key, 0.0) + total_sec
    map_avgs = {mid: map_seconds[mid] / n for mid, n in map_games.items() if n > 0}
    ordered = sorted(participants, key=lambda part: part[1])
    tasks: list[dict] = []
    skipped_games = 0
    for map_idx, map_id in enumerate(maps):
        for i, j in itertools.combinations(range(len(ordered)), 2):
            name_a, name_b = ordered[i][1], ordered[j][1]
            have = counts.get((map_id, name_a, name_b), 0)
            need = max(0, args.games - have)
            if need % 2 == 1:
                need += 1
            if need <= 0:
                skipped_games += have
                continue
            seed_prefix = f"rr-{salt}-{map_idx}-{i}-{j}"
            tasks.append({
                "spec_a": ordered[i][0], "spec_b": ordered[j][0],
                "name_a": name_a, "name_b": name_b,
                "map": map_id, "games": need, "seed_prefix": seed_prefix,
            })

    total_games = sum(task["games"] for task in tasks)
    print(f"\n任务：{len(tasks)} 个对战批次，待跑 {total_games} 局"
          f"（已完成 {skipped_games} 局直接跳过）。")
    if not tasks:
        print("所有目标局数已达成，无需补跑。")
        return 0
    estimates = [estimate_batch_seconds(task, counts, durations, map_avgs, mode)
                 for task in tasks]
    estimated = sum(estimates) / max(1, args.jobs)
    algo_fallback = (SEC_PER_GAME_ALGO_SIMULTANEOUS if mode == "simultaneous"
                     else SEC_PER_GAME_ALGO_STANDARD)
    print(f"预估耗时：约 {format_eta(estimated)}"
          f"（jobs={args.jobs}，逐批按累积历史均速预估；缺历史时纯算法批 ~{algo_fallback:g}s/局、"
          f"模型批 ~{SEC_PER_GAME_MODEL:g}s/局兜底，另加批次启动开销）\n")

    if args.dry_run:
        for task, estimate in zip(tasks, estimates):
            print(f"  {task['name_a']} vs {task['name_b']} "
                  f"@ {task['map']}：补 {task['games']} 局，预估约 {format_eta(estimate)}")
        return 0

    progress = Progress(len(tasks), estimates, args.jobs)
    commands = [
        (build_command(python, evaluate_script, task["spec_a"], task["spec_b"],
                       task["map"], task["games"], stats_file,
                       task["seed_prefix"], args.device, args.policy_stats),
         f"{task['name_a']} vs {task['name_b']} @ {task['map']}",
         task["games"])
        for task in tasks
    ]

    start = time.monotonic()
    if args.jobs <= 1:
        for index, (command, label, games) in enumerate(commands):
            run_task(command, label, games, progress, index)
    else:
        with ThreadPoolExecutor(max_workers=args.jobs) as pool:
            futures = [pool.submit(run_task, command, label, games, progress, index)
                       for index, (command, label, games) in enumerate(commands)]
            for future in as_completed(futures):
                future.result()

    elapsed = time.monotonic() - start
    rate = progress.games / elapsed if elapsed > 0 else 0
    print(f"\n===== 总结 =====")
    print(f"完成批次 {progress.done}/{progress.total}，新增 {progress.games} 局，"
          f"失败 {progress.failed} 批，总用时 {format_eta(elapsed)}（{rate:.1f} 局/s）。")
    if progress.failed:
        print("存在失败批次：可原样重跑（断点续跑会只补差额），失败原因见上方输出。")
    print(f"刷新排行榜数据：npm run arena-leaderboard")
    return 1 if progress.failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
