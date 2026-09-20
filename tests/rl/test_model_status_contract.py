"""过期登记表（arena/model-status.json）的跨语言契约测试（pytest）。

登记表有两个解析实现：``script/modelStatus.mjs`` 的 parseModelStatus（JS 侧：
榜单/统计脚本与服务端 bots.ts 共用）与 ``rl/evaluation/round_robin.py`` 的
load_expired_versions（Python 编排侧，镜像实现）。两边的错误口径同为
「文件缺失 = 无过期；存在但结构非法 = 抛错拒绝」，本文件用同一份 fixture
钉死这个契约，防止任何一侧放松校验后悄悄分叉：

  - 合法登记表：两侧都接受，且 (version, expiredAt, reason) 逐项一致；
  - 非法登记表：两侧都拒绝（JS 抛错退出码非 0 / Python 抛 ValueError）；
  - 登记表缺失：两侧都按「无过期」处理；
  - 版本号提取正则（MODEL_VERSION_RE vs MODEL_RE）对同一批文件名行为一致；
  - 仓库真实的 arena/model-status.json 两侧解析一致。

Run with:  rl/.venv/Scripts/python.exe -m pytest tests/rl -q
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
# 与 tests/rl/test_algorithm_opponent.py 同款：rl/ 下是分目录的扁平模块。
for _sub in ("envs", "runners", "training", "evaluation"):
    sys.path.insert(0, str(REPO_ROOT / "rl" / _sub))

from round_robin import MODEL_RE, load_expired_versions  # noqa: E402

if shutil.which("node") is None:
    pytest.skip("node 不在 PATH，无法跑 JS 侧对照", allow_module_skip=True)

MODEL_STATUS_URL = "file:///" + (REPO_ROOT / "script" / "modelStatus.mjs").as_posix()

# 把登记表交给 parseModelStatus：接受则打印规范化条目，拒绝则退出码非 0。
JS_PARSE = (
    "import(process.env.MODEL_STATUS_MODULE).then(async m => {"
    "const fs = await import('node:fs');"
    "try {"
    "const { entries } = m.parseModelStatus("
    "fs.readFileSync(process.env.MODEL_STATUS_FIXTURE, 'utf8'), 'fixture');"
    "process.stdout.write(JSON.stringify("
    "entries.map(e => [e.version, e.expiredAt, e.reason])));"
    "} catch (err) { console.error(err.message); process.exit(1); }"
    "}, err => { console.error(err); process.exit(1); })"
)

# loadModelStatus 读不存在的文件：契约是返回空名单而不是抛错。
JS_LOAD_MISSING = (
    "import(process.env.MODEL_STATUS_MODULE).then(m => {"
    "const { entries } = m.loadModelStatus(process.env.MODEL_STATUS_FIXTURE);"
    "process.stdout.write(JSON.stringify(entries));"
    "}, err => { console.error(err); process.exit(1); })"
)

# 文件名 → 版本段（null 表示不符合交付命名规范）。
JS_VERSION_OF = (
    "import(process.env.MODEL_STATUS_MODULE).then(m => {"
    "process.stdout.write(JSON.stringify("
    "JSON.parse(process.env.MODEL_STATUS_FILES).map(f => m.versionOfModelFile(f))),"
    ")}, err => { console.error(err); process.exit(1); })"
)

VALID_FILE_A = "hex_ppo_v2.3.2_20260829_random_selfplay_800000.zip"
VALID_FILE_B = "hex_ppo_v2.5.0_20260830_random_selfplay_2000000.zip"


def run_node(script: str, **extra_env: str) -> subprocess.CompletedProcess:
    env = {**os.environ, "MODEL_STATUS_MODULE": MODEL_STATUS_URL, **extra_env}
    return subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=str(REPO_ROOT), capture_output=True, text=True,
        encoding="utf-8", errors="replace", env=env,
    )


def write_registry(root: Path, text: str) -> Path:
    (root / "arena").mkdir(parents=True, exist_ok=True)
    (root / "arena" / "model-status.json").write_text(text, encoding="utf-8")
    return root


def js_parse(root: Path) -> list:
    result = run_node(JS_PARSE, MODEL_STATUS_FIXTURE=str(root / "arena" / "model-status.json"))
    assert result.returncode == 0, f"JS 侧拒绝了 Python 侧接受的登记表：{result.stderr}"
    return json.loads(result.stdout)


def py_parse(root: Path) -> dict[str, dict]:
    return load_expired_versions(root)


def valid_doc() -> str:
    return json.dumps({
        "note": "契约测试登记表",
        "expired": [
            {"version": "v2.3.2", "file": VALID_FILE_A, "expiredAt": "2026-09-19",
             "reason": "全图沉底，无突出图", "evidence": "各图名次"},
            {"version": "v2.5.0", "file": VALID_FILE_B, "expiredAt": "2026-09-20",
             "reason": "  两侧空白应被 trim 后一致  "},
        ],
    })


def normalized(entries) -> list:
    """把两侧结果统一成 [(version, expiredAt, trimmed reason)] 并按版本排序。"""
    if isinstance(entries, dict):
        rows = [(v, e["expiredAt"], str(e.get("reason") or "").strip()) for v, e in entries.items()]
    else:
        rows = [(v, d, str(r).strip()) for v, d, r in entries]
    return sorted(rows)


def test_valid_registry_both_sides_agree(tmp_path):
    root = write_registry(tmp_path, valid_doc())
    js_rows = js_parse(root)
    py_rows = py_parse(root)
    assert normalized(js_rows) == normalized(py_rows)
    assert {row[0] for row in js_rows} == {"v2.3.2", "v2.5.0"}


BAD_REGISTRIES = [
    pytest.param("{ not json", id="非法 JSON"),
    pytest.param(json.dumps({"expired": None}), id="缺顶层 expired 数组"),
    pytest.param(json.dumps({"expired": "v2.3.2"}), id="expired 不是数组"),
    pytest.param(json.dumps({"expired": ["字符串条目"]}), id="条目不是对象"),
    pytest.param(json.dumps({"expired": [{
        "version": "2.3.2", "file": VALID_FILE_A, "expiredAt": "2026-09-19", "reason": "x"}]}),
        id="version 缺 v 前缀"),
    pytest.param(json.dumps({"expired": [{
        "version": "v2.3.2", "file": VALID_FILE_B, "expiredAt": "2026-09-19", "reason": "x"}]}),
        id="file 版本段与 version 不一致"),
    pytest.param(json.dumps({"expired": [{
        "version": "v2.3.2", "file": "hex_ppo_v2.3.2_20260829_random_selfplay_800000.tar.gz",
        "expiredAt": "2026-09-19", "reason": "x"}]}),
        id="file 不是 zip"),
    pytest.param(json.dumps({"expired": [{
        "version": "v2.3.2", "file": VALID_FILE_A, "expiredAt": "2026/09/19", "reason": "x"}]}),
        id="expiredAt 非 ISO 日期"),
    pytest.param(json.dumps({"expired": [{
        "version": "v2.3.2", "file": VALID_FILE_A, "expiredAt": "2026-09-19", "reason": "   "}]}),
        id="reason 为空白"),
    # Python 的 re $ 允许尾部换行而 JS 的 $ 不允许：version 带换行会入字典但
    # 匹配不上 discover_models 的版本段（过期模型静默回池），必须与 JS 同拒。
    pytest.param(json.dumps({"expired": [{
        "version": "v2.3.2\n", "file": VALID_FILE_A, "expiredAt": "2026-09-19", "reason": "x"}]}),
        id="version 尾部换行"),
    pytest.param(json.dumps({"expired": [{
        "version": "v2.3.2", "file": VALID_FILE_A, "expiredAt": "2026-09-19\n", "reason": "x"}]}),
        id="expiredAt 尾部换行"),
    pytest.param(json.dumps({"expired": [
        {"version": "v2.3.2", "file": VALID_FILE_A, "expiredAt": "2026-09-19", "reason": "x"},
        {"version": "v2.3.2", "file": VALID_FILE_A, "expiredAt": "2026-09-20", "reason": "y"},
    ]}), id="同一版本重复登记"),
]


@pytest.mark.parametrize("text", BAD_REGISTRIES)
def test_bad_registry_both_sides_reject(tmp_path, text):
    root = write_registry(tmp_path, text)
    with pytest.raises(ValueError):
        load_expired_versions(root)
    result = run_node(JS_PARSE, MODEL_STATUS_FIXTURE=str(root / "arena" / "model-status.json"))
    assert result.returncode != 0, "JS 侧接受了 Python 侧拒绝的登记表"


def test_missing_registry_is_no_expired_on_both_sides(tmp_path):
    assert py_parse(tmp_path) == {}
    result = run_node(JS_LOAD_MISSING, MODEL_STATUS_FIXTURE=str(tmp_path / "arena" / "model-status.json"))
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == []


def test_version_regex_parity():
    files = [
        VALID_FILE_A,
        "hex_ppo_v3.2.0_20260918_random_selfplay_10000000.zip",
        "hex_ppo_v3.0.1_20260904_distilled.zip",
        "random.zip",
        "hex_ppo_v23.2_20260829_x.zip",
        "",
    ]
    result = run_node(JS_VERSION_OF, MODEL_STATUS_FILES=json.dumps(files))
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == [(MODEL_RE.match(f) or [None, None])[1] for f in files]


def test_repo_registry_parses_identically():
    """仓库真实登记表（in-repo fixture）两侧解析一致。"""
    js = run_node(JS_PARSE, MODEL_STATUS_FIXTURE=str(REPO_ROOT / "arena" / "model-status.json"))
    assert js.returncode == 0, js.stderr
    assert normalized(json.loads(js.stdout)) == normalized(load_expired_versions(REPO_ROOT))
    assert load_expired_versions(REPO_ROOT), "真实登记表不应为空（首批已过期 3 个模型）"
