#!/usr/bin/env python3
"""Deploy tactical-game to remote server via SFTP + Docker Compose.

Credentials are read from deploy/.env.deploy (not tracked in git).
Copy deploy/.env.deploy.example to deploy/.env.deploy and fill in the values.

Transfer is incremental: a file is re-uploaded only when its remote size or
mtime differs (mtime is written back after upload, since SFTP put does not
preserve it). The very first run after switching to this script uploads
everything once to establish the timestamp baseline.
"""

import os
import re
import shlex
import stat as stat_module
import sys
from pathlib import Path

import paramiko

ENV_FILE = Path(__file__).resolve().parent / ".env.deploy"

# 与 compose.yml 发布端口一致，健康检查走容器内回环
HEALTH_PORT = 3123


def load_env():
    """Load deploy credentials from .env.deploy file."""
    if not ENV_FILE.exists():
        print(f"ERROR: {ENV_FILE} not found.")
        print(f"Copy deploy/.env.deploy.example to deploy/.env.deploy and fill in the values.")
        sys.exit(1)

    env = {}
    with open(ENV_FILE, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, val = line.partition("=")
                env[key.strip()] = val.strip()
    return env


# --- Load credentials from .env.deploy ---
env = load_env()

HOST = env.get("DEPLOY_HOST") or sys.exit("ERROR: DEPLOY_HOST not set in .env.deploy")
try:
    PORT = int(env.get("DEPLOY_PORT", "22"))
except ValueError:
    sys.exit(f"ERROR: DEPLOY_PORT must be an integer, got {env.get('DEPLOY_PORT')!r}")
USERNAME = env.get("DEPLOY_USER", "root")
PASSWORD = env.get("DEPLOY_PASSWORD", "")
KEY_PATH = env.get("DEPLOY_KEY_PATH", "").strip()
REMOTE_BASE = env.get("DEPLOY_REMOTE_BASE", "/srv/tactical-game")
LOG_LEVEL = env.get("LOG_LEVEL", "info")
PRUNE_REMOTE = env.get("DEPLOY_PRUNE", "0").strip() == "1"
LOCAL_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 认证方式：SSH 密钥优先，密码作为 fallback（也兼作加密密钥的 passphrase）
if KEY_PATH:
    key_path = Path(KEY_PATH).expanduser()
    if not key_path.exists():
        sys.exit(f"ERROR: DEPLOY_KEY_PATH points to a missing file: {KEY_PATH}")
    KEY_PATH = str(key_path)
elif not PASSWORD:
    sys.exit("ERROR: set DEPLOY_PASSWORD or DEPLOY_KEY_PATH in .env.deploy")

# 固定 token 保证历次部署之间调用方（脚本/agent）不失效，也避免把新 token 明文打进部署日志
CONTROL_TOKEN = env.get("CONTROL_TOKEN", "").strip() or sys.exit(
    "ERROR: CONTROL_TOKEN not set in .env.deploy (generate one: openssl rand -hex 32)"
)

EXCLUDE_PATTERNS = [
    r'\.git$', r'\.git/.*', r'node_modules/', r'node_modules$',
    r'\.env$', r'\.env\..*', r'dist/', r'dist$', r'coverage/', r'coverage$',
    r'\.idea/', r'\.idea$', r'\.claude/', r'\.claude$', r'\.omp/', r'\.omp$',
    r'\.workbuddy/', r'\.workbuddy$', r'\.github/', r'\.github$',
    r'runtime/', r'runtime$', r'backups/', r'backups$',
    r'\.log$', r'hexstate\.json$', r'state\.json$', r'skill\.zip$',
    r'records/', r'records$', r'deploy/', r'deploy$',
    # RL 训练产物与 Windows 本地环境体积大且服务器用不上（镜像内重建）
    r'^rl/\.venv', r'^rl/checkpoints', r'^rl/tb', r'^rl/distill',
    r'^rl/models/deprecated', r'^rl/test-output', r'^rl/selfplay', r'__pycache__',
    # 每局明细约 2GB/轮，仅本地弱点分析用（2026-09-08 起移出 git 也不上服务器）
    r'^rl/leaderboard/details',
    # 编辑器 / agent 工具目录与本地状态，与 .gitignore 对齐，不上服务器
    r'\.pi/', r'\.pi$', r'\.zcode/', r'\.zcode$', r'\.qoder/', r'\.qoder$',
    r'\.pytest_cache/', r'\.pytest_cache$', r'\.superpowers/', r'\.superpowers$',
    r'\.meituan-catpaw/', r'\.meituan-catpaw$', r'\.dsh/', r'\.dsh$',
    # 本地调试残留与平台遗留二进制
    r'^events\.json$', r'^body\.json$', r'^nul$', r'sshpass\.exe$',
]


def should_exclude(rel_path):
    for p in EXCLUDE_PATTERNS:
        if re.search(p, rel_path):
            return True
    return False


def needs_upload(sftp, remote_path, local_stat):
    try:
        remote_stat = sftp.stat(remote_path)
    except FileNotFoundError:
        return True
    return (remote_stat.st_size != local_stat.st_size
            or int(remote_stat.st_mtime) != int(local_stat.st_mtime))


def ensure_remote_dir(sftp, remote_dir):
    if remote_dir == REMOTE_BASE:
        return
    try:
        sftp.stat(remote_dir)
        return
    except FileNotFoundError:
        pass
    parts = remote_dir[len(REMOTE_BASE):].strip("/").split("/")
    path = REMOTE_BASE
    for part in parts:
        if not part:
            continue
        path = f"{path}/{part}"
        try:
            sftp.stat(path)
        except FileNotFoundError:
            sftp.mkdir(path)


def transfer_files(sftp):
    """Upload changed files; return (uploaded, skipped, bytes_sent, manifest).

    manifest 是本地仍存在的全部远端相对路径，供 DEPLOY_PRUNE 清理远端残留。
    """
    uploaded = 0
    skipped = 0
    bytes_sent = 0
    manifest = set()

    for root, dirs, files in os.walk(LOCAL_BASE):
        filtered = []
        for d in dirs:
            try:
                rel = os.path.relpath(os.path.join(root, d), LOCAL_BASE).replace("\\", "/")
            except ValueError:
                continue
            if not should_exclude(rel):
                filtered.append(d)
        dirs[:] = filtered

        for f in files:
            local_path = os.path.join(root, f)
            try:
                rel_path = os.path.relpath(local_path, LOCAL_BASE).replace("\\", "/")
            except ValueError:
                continue
            if should_exclude(rel_path):
                continue
            manifest.add(rel_path)

            remote_path = f"{REMOTE_BASE}/{rel_path}"
            local_stat = os.stat(local_path)
            if needs_upload(sftp, remote_path, local_stat):
                ensure_remote_dir(sftp, os.path.dirname(remote_path))
                sftp.put(local_path, remote_path)
                # SFTP put 不保留本地时间戳；回写后下次部署才能靠 mtime 判定"未变更"
                sftp.utime(remote_path, (int(local_stat.st_atime), int(local_stat.st_mtime)))
                uploaded += 1
                bytes_sent += local_stat.st_size
                if uploaded % 50 == 0:
                    print(f"  Uploaded {uploaded} files...")
            else:
                skipped += 1

    return uploaded, skipped, bytes_sent, manifest


# 这些远端路径不属于本次上传清单，prune 时必须保留
PRUNE_PROTECTED_FILES = {".env"}
PRUNE_PROTECTED_PREFIXES = ("backups/",)


def prune_remote(sftp, manifest):
    """Delete remote files under REMOTE_BASE that are no longer present locally."""
    removed = []

    def walk(dir_path):
        for entry in sftp.listdir_attr(dir_path):
            path = f"{dir_path}/{entry.filename}"
            rel = path[len(REMOTE_BASE) + 1:]
            is_dir = entry.st_mode is not None and stat_module.S_ISDIR(entry.st_mode)
            if is_dir:
                walk(path)
                if rel != "backups":
                    try:
                        sftp.rmdir(path)
                    except OSError:
                        pass
            elif (rel not in manifest
                  and rel not in PRUNE_PROTECTED_FILES
                  and not rel.startswith(PRUNE_PROTECTED_PREFIXES)):
                sftp.remove(path)
                removed.append(rel)

    walk(REMOTE_BASE)
    return removed


class InteractiveHostKeyPolicy(paramiko.MissingHostKeyPolicy):
    """TOFU 式主机指纹确认：首次连接询问并持久化，此后指纹变化会直接连接失败。"""

    def __init__(self, known_hosts_file):
        self.known_hosts_file = known_hosts_file

    def missing_host_key(self, client, hostname, key):
        fingerprint = ":".join(f"{b:02x}" for b in key.get_fingerprint())
        if not sys.stdin.isatty():
            raise paramiko.SSHException(
                f"Host key for {hostname} is not in known_hosts and cannot prompt "
                f"non-interactively. Fingerprint: {fingerprint}"
            )
        answer = input(
            f"The authenticity of host '{hostname}' can't be established.\n"
            f"Key fingerprint: {fingerprint}\n"
            f"Accept and save to {self.known_hosts_file}? [y/N] "
        )
        if answer.strip().lower() not in ("y", "yes"):
            raise paramiko.SSHException(f"Host key for {hostname} rejected by user")
        client.get_host_keys().add(hostname, key.get_name(), key)
        try:
            client.save_host_keys()
        except Exception as exc:
            print(f"  note: could not persist host key ({exc}); you will be prompted again")


def connect():
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    known_hosts_file = Path.home() / ".ssh" / "known_hosts"
    try:
        client.load_host_keys(str(known_hosts_file))
    except FileNotFoundError:
        pass
    client.set_missing_host_key_policy(InteractiveHostKeyPolicy(str(known_hosts_file)))
    kwargs = dict(
        hostname=HOST, port=PORT, username=USERNAME, timeout=15,
        banner_timeout=30, auth_timeout=30,
        allow_agent=False, look_for_keys=False,
    )
    if KEY_PATH:
        kwargs["key_filename"] = KEY_PATH
    if PASSWORD:
        kwargs["password"] = PASSWORD
    try:
        client.connect(**kwargs)
    except Exception as exc:
        print(f"ERROR: could not connect to {HOST}:{PORT} as {USERNAME}: {exc}")
        sys.exit(1)
    return client


def fail(client, message):
    print(f"ERROR: {message}")
    client.close()
    sys.exit(1)


def run_cmd(client, cmd, stream=False, check=True):
    """Execute a remote command; returns (exit_code, stdout, stderr)."""
    stdin, stdout, stderr = client.exec_command(cmd)
    if stream:
        for line in iter(stdout.readline, ""):
            print(f"  {line}", end="")
    exit_code = stdout.channel.recv_exit_status()
    out = "" if stream else stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if check and exit_code != 0:
        fail(client, f"command failed (exit={exit_code}): {cmd}\n{err}")
    return exit_code, out, err


def main():
    print(f"Connecting to {HOST}:{PORT} as {USERNAME}...")
    client = connect()
    q = shlex.quote

    print(f"Creating {REMOTE_BASE}...")
    run_cmd(client, f"mkdir -p {q(REMOTE_BASE)}")

    print("Transferring files (unchanged files skipped)...")
    sftp = client.open_sftp()
    uploaded, skipped, bytes_sent, manifest = transfer_files(sftp)
    print(f"Uploaded {uploaded} files ({bytes_sent / 1024 / 1024:.1f} MB), "
          f"skipped {skipped} unchanged")

    if PRUNE_REMOTE:
        removed = prune_remote(sftp, manifest)
        print(f"Pruned {len(removed)} remote files no longer present locally")
        for rel in removed[:20]:
            print(f"  removed {rel}")
        if len(removed) > 20:
            print(f"  ... and {len(removed) - 20} more")
    sftp.close()

    # 远端 .env 由部署脚本统一管理：每次部署按 .env.deploy 重写，服务器上手工改动不保留
    env_content = f"AUTO_CONTROL_TOKEN={CONTROL_TOKEN}\nLOG_LEVEL={LOG_LEVEL}\n"
    run_cmd(client,
            f"cat > {q(REMOTE_BASE)}/.env << 'ENVEOF'\n{env_content}ENVEOF\n"
            f"chmod 600 {q(REMOTE_BASE)}/.env")

    print("Building and starting Docker Compose...")
    run_cmd(client, f"cd {q(REMOTE_BASE)} && docker compose up --build --detach 2>&1",
            stream=True)

    print("\nVerifying deployment...")
    run_cmd(client, f"cd {q(REMOTE_BASE)} && docker compose ps", check=False)
    healthy = True
    for route in ("/healthz", "/readyz"):
        _, out, _ = run_cmd(
            client,
            f"curl -s -o /dev/null -w '%{{http_code}}' http://127.0.0.1:{HEALTH_PORT}{route}",
            check=False,
        )
        code = out.strip()
        print(f"  {route} -> {code or '(no response)'}")
        if code != "200":
            healthy = False

    client.close()
    if not healthy:
        print("\nERROR: health checks failed — inspect 'docker compose logs app' on the server")
        sys.exit(1)
    print(f"\nAll done! Server is running at http://{HOST}:{HEALTH_PORT}")


if __name__ == "__main__":
    main()
