"""AI 竞技场 round-robin 批量对战编排器（模型 × 模型 / 模型 × 算法 / 算法 × 算法）。

自动发现 rl/models/ 下的可对战模型与 algorithms/registry.mjs 注册的内置算法，
两两 × 指定地图批量互打，结果累积到单个 JSONL，
供 script/generateArenaLeaderboard.mjs 评分与竞技场页面使用。

- 断点续跑：按（参与者对, 地图）统计 JSONL 已有局数，只补差额，已跑对局不重复；
- 每次运行带随机盐 seed-prefix：重跑 random 图必产生新地图（静态图种子不生效，
  但引擎战斗带随机伤害浮动，每局同样不重复）；
- 复用 rl/evaluation/evaluate_cross.py 子进程，原样保留其跨版本编码路由与配对换座逻辑；
- 算法参与者的名字以 ``algo_`` 前缀 + 版本写入 matches.jsonl（如 algo_threat@v1），
  传参规格为 ``algo:<name>@<version>``（版本取 registry.mjs 的当前标注，保证
  算法升版后历史对局仍归属旧版本 id）；--algorithms none 可退回纯模型循环赛。

过期模型（``arena/model-status.json`` 登记，见 ``script/modelStatus.mjs``）**不自动参评**：
它们的 zip 仍在 rl/models/ 下、历史对局也仍在评分池里（与「作废」不同），只是不再
参与新一轮评估——过期原因只有一个：名次已沉底，继续陪跑只拉长新模型的评估时长。
要临时让过期模型陪打，用 ``--models`` 显式点名即可（点名优先于过期排除）。
登记表只在**文件不存在**（纯算法开发机）时按「无过期」处理；存在但损坏则报错退出，
不降级为「无过期」——那会把过期模型重新拉回对手池陪跑，正是本机制要省掉的开销
（唯一允许降级的消费端是线上服务 ``src/api/bots.ts``，口径见 ``script/modelStatus.mjs`` 头注）。

用法示例：

    # 全量（模型+算法两两 × 7 图 × 24 局，可分批跑）
    rl/.venv/Scripts/python.exe rl/evaluation/round_robin.py

    # 先跑随机图池
    rl/.venv/Scripts/python.exe rl/evaluation/round_robin.py --maps random

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
# 过期模型登记表（唯一事实来源，与 script/modelStatus.mjs 同读一份）。
MODEL_STATUS_FILE = Path("arena/model-status.json")
DEFAULT_MAPS = "random,default,breach,danger-close,desert,dual-lanes,forge"
DEFAULT_STATS_FILE = Path("arena/matches.jsonl")
# 模型批次的固定开销（torch 导入 + tsx worker 启动 + 模型加载）与单局耗时；
# 纯算法批次不加载模型，开销与单局都低一档。用于预估耗时。
TASK_OVERHEAD_SEC_MODEL = 15
SEC_PER_GAME_MODEL = 3.5
TASK_OVERHEAD_SEC_ALGO = 6
SEC_PER_GAME_ALGO = 1.0


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--maps", default=DEFAULT_MAPS,
                        help=f"逗号分隔地图池（默认 {DEFAULT_MAPS}）")
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
                        help="逗号分隔算法名（缺省=全部注册算法；none=不带算法，纯模型循环赛）")
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


MODEL_STATUS_VERSION_RE = re.compile(r"^v\d+\.\d+\.\d+$")
MODEL_STATUS_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def parse_expired_entries(raw, source: Path) -> dict[str, dict]:
    """校验登记表结构并返回 {版本: 条目}；非法一律抛 ValueError。

    校验口径与 script/modelStatus.mjs 的 parseModelStatus 逐条对齐（版本格式、
    file 版本段一致性、重复登记、expiredAt、reason 非空），由跨语言契约测试
    tests/rl/test_model_status_contract.py 钉死「两侧接受/拒绝同一份登记表」。
    """
    if not isinstance(raw, dict) or not isinstance(raw.get("expired"), list):
        raise ValueError(f"{source}: 缺少顶层 expired 数组")
    result: dict[str, dict] = {}
    for idx, item in enumerate(raw["expired"]):
        at = f"{source} expired[{idx}]"
        if not isinstance(item, dict):
            raise ValueError(f"{at}: 必须是对象")
        version = item.get("version")
        if not isinstance(version, str) or not MODEL_STATUS_VERSION_RE.match(version):
            raise ValueError(f"{at}: version 需形如 v3.0.3，实际 {version!r}")
        file = item.get("file")
        if not isinstance(file, str) or not file.endswith(".zip"):
            raise ValueError(f"{at}: file 需是 .zip 文件名，实际 {file!r}")
        match = MODEL_RE.match(file)
        if not match or match.group(1) != version:
            raise ValueError(f"{at}: file 的版本段与 version 不一致（{file} vs {version}）")
        if version in result:
            raise ValueError(f"{at}: 版本 {version} 重复登记")
        expired_at = item.get("expiredAt")
        if not isinstance(expired_at, str) or not MODEL_STATUS_DATE_RE.match(expired_at):
            raise ValueError(f"{at}: expiredAt 需形如 2026-09-19")
        if not str(item.get("reason") or "").strip():
            raise ValueError(f"{at}: reason 不能为空")
        result[version] = item
    return result


def load_expired_versions(root: Path) -> dict[str, dict]:
    """读取 arena/model-status.json 的过期登记，返回 {版本: 条目}。

    过期 ≠ 作废：过期模型的 zip 仍在 rl/models/、历史对局仍留在竞技场评分池里，
    只是不再参与新一轮评估。登记表是唯一事实来源（JS/TS 侧见 script/modelStatus.mjs），
    不要在别处再写一份版本名单。文件缺失（纯算法开发机）按「无过期」处理；
    文件损坏或结构非法抛 ValueError 中止——降级成「无过期」会把过期模型重新
    拉进对手池陪跑，正是本机制要省掉的开销。
    """
    path = root / MODEL_STATUS_FILE
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as exc:
        raise ValueError(f"{path}: 读取/解析失败（{exc}）") from exc
    return parse_expired_entries(raw, path)


def discover_models(
    models_dir: Path, expired_versions: dict[str, dict] | None = None,
) -> tuple[list[Path], list[Path], list[Path]]:
    """返回 (可对战模型, 旧格式排除的模型, 已过期的模型)，均按文件名排序。"""
    expired_versions = expired_versions or {}
    included, excluded, expired = [], [], []
    for path in sorted(models_dir.glob("*.zip")):
        match = MODEL_RE.match(path.name)
        if not match or match.group(1) in EXCLUDED_VERSIONS:
            excluded.append(path)
        elif match.group(1) in expired_versions:
            expired.append(path)
        else:
            included.append(path)
    return included, excluded, expired


def discover_algorithms(root: Path) -> list[tuple[str, str]]:
    """读取 algorithms/registry.mjs 的注册算法及当前版本（经 node，避免手工维护第二份名单）。

    返回 (注册名, 版本) 对，两者拼成竞技场参与者 id ``algo_<注册名>@<版本>``。
    """
    registry_url = (root / "algorithms" / "registry.mjs").as_posix()
    script = (f"import('file:///{registry_url}').then(r => console.log("
              "r.listAlgorithmInfo().map(i => i.name + '@' + i.version).join(',')))")
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


def resolve_algorithms(root: Path, raw: str | None) -> tuple[list[tuple[str, str]], str | None]:
    """把 --algorithms 参数解析成 (注册名, 版本) 清单；node 不可用时降级为空清单并给出警告。"""
    if raw is not None and raw.strip().lower() in ("none", "off", ""):
        return [], None
    try:
        registered = discover_algorithms(root)
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


def count_existing(stats_file: Path) -> dict[tuple[str, str, str], int]:
    """按（地图, 参与者 A, 参与者 B）统计 JSONL 中已累积的局数。"""
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


def estimate_batch_seconds(spec_a: str, spec_b: str, games: int) -> float:
    """按批次构成粗估耗时：纯算法批不加载模型，明显更快。"""
    pure_algo = spec_a.startswith("algo:") and spec_b.startswith("algo:")
    if pure_algo:
        return TASK_OVERHEAD_SEC_ALGO + games * SEC_PER_GAME_ALGO
    return TASK_OVERHEAD_SEC_MODEL + games * SEC_PER_GAME_MODEL


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
            cwd=str(Path(__file__).resolve().parent.parent.parent),
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

    # 本文件位于 rl/evaluation/，项目根需上溯三级。
    root = Path(__file__).resolve().parent.parent.parent
    models_dir = root / "rl" / "models"
    stats_file = root / args.stats_file if args.stats_file else root / DEFAULT_STATS_FILE
    maps = [m.strip() for m in args.maps.split(",") if m.strip()]

    try:
        expired_versions = load_expired_versions(root)
    except ValueError as exc:
        print(f"错误：{exc}；修好登记表（或暂时删除）再跑，不降级为「无过期」。", file=sys.stderr)
        return 1
    included, excluded, expired = discover_models(models_dir, expired_versions)
    if args.models:
        needles = [n.strip() for n in args.models.split(",") if n.strip()]
        # --models 显式点名优先于过期排除：点名过期模型时它仍按原样回到对手池（审计/复现用）。
        picked = [m for m in included if any(n in m.name for n in needles)]
        picked += [m for m in expired if any(n in m.name for n in needles)]
        expired = [m for m in expired if not any(n in m.name for n in needles)]
        included = picked
        excluded = [m for m in excluded if any(n in m.name for n in needles)]

    try:
        algorithm_infos, algo_warning = resolve_algorithms(root, args.algorithms)
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

    print(f"参评模型 {len(included)} 个：")
    for path in included:
        version = MODEL_RE.match(path.name).group(1)
        print(f"  {version:<8} {path.name}")
    if excluded:
        print(f"排除 {len(excluded)} 个（{', '.join(sorted(EXCLUDED_VERSIONS))} 不支持进程内互打）：")
        for path in excluded:
            print(f"  - {path.name}")
    if expired:
        print(f"已过期 {len(expired)} 个（不再参与新一轮评估；zip 与历史对局均保留，"
              f"登记见 arena/model-status.json）：")
        for path in expired:
            print(f"  - {MODEL_RE.match(path.name).group(1):<8} {path.name}")
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

    counts = count_existing(stats_file)
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
    estimated = sum(estimate_batch_seconds(task["spec_a"], task["spec_b"], task["games"])
                    for task in tasks) / max(1, args.jobs)
    print(f"预估耗时：约 {format_eta(estimated)}"
          f"（jobs={args.jobs}，模型批 ~{SEC_PER_GAME_MODEL}s/局+{TASK_OVERHEAD_SEC_MODEL}s 启动，"
          f"纯算法批 ~{SEC_PER_GAME_ALGO}s/局+{TASK_OVERHEAD_SEC_ALGO}s 启动）\n")

    if args.dry_run:
        for task in tasks:
            print(f"  {task['name_a']} vs {task['name_b']} "
                  f"@ {task['map']}：补 {task['games']} 局")
        return 0

    progress = Progress(len(tasks))
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
    print(f"刷新排行榜数据：npm run arena-leaderboard")
    return 1 if progress.failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
