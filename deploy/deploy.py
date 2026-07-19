#!/usr/bin/env python3
"""Deploy tactical-game to remote server via SFTP + Docker Compose."""

import paramiko
import os
import secrets
import re
import sys

HOST = "117.72.181.8"
PORT = 22
USERNAME = "root"
PASSWORD = "!9617Cos"
REMOTE_BASE = "/srv/tactical-game"
LOCAL_BASE = "C:/cosmos/github/game"

EXCLUDE_PATTERNS = [
    r'\.git$', r'\.git/.*', r'node_modules/', r'node_modules$',
    r'\.env$', r'\.env\..*', r'dist/', r'dist$', r'coverage/', r'coverage$',
    r'\.idea/', r'\.idea$', r'\.claude/', r'\.claude$', r'\.omp/', r'\.omp$',
    r'\.workbuddy/', r'\.workbuddy$', r'\.github/', r'\.github$',
    r'runtime/', r'runtime$', r'backups/', r'backups$',
    r'\.log$', r'hexstate\.json$', r'state\.json$', r'skill\.zip$',
    r'records/', r'records$', r'deploy/', r'deploy$',
]


def should_exclude(rel_path):
    for p in EXCLUDE_PATTERNS:
        if re.search(p, rel_path):
            return True
    return False


def transfer_files(sftp):
    """Transfer project files to remote server."""
    file_count = 0
    total_size = 0

    for root, dirs, files in os.walk(LOCAL_BASE):
        # Filter directories in-place
        filtered = []
        for d in dirs:
            local_dir = os.path.join(root, d)
            try:
                rel = os.path.relpath(local_dir, LOCAL_BASE).replace("\\", "/")
            except ValueError:
                continue
            if should_exclude(rel):
                continue
            filtered.append(d)
        dirs[:] = filtered

        for f in files:
            local_path = os.path.join(root, f)

            # Skip special device paths
            try:
                rel_path = os.path.relpath(local_path, LOCAL_BASE).replace("\\", "/")
            except ValueError:
                continue

            if should_exclude(rel_path):
                continue

            # Normalize path separators for remote
            remote_path = f"{REMOTE_BASE}/{rel_path}"
            remote_dir = os.path.dirname(remote_path)

            # Ensure remote directory exists
            try:
                sftp.stat(remote_dir)
            except FileNotFoundError:
                # Create directory tree
                parts = remote_dir.replace(REMOTE_BASE, "").strip("/").split("/")
                if parts and parts[0]:
                    path = REMOTE_BASE
                    for part in parts:
                        path = f"{path}/{part}"
                        try:
                            sftp.stat(path)
                        except FileNotFoundError:
                            sftp.mkdir(path)

            sftp.put(local_path, remote_path)
            file_count += 1
            total_size += os.path.getsize(local_path)

            if file_count % 50 == 0:
                print(f"  Transferred {file_count} files...")

    return file_count, total_size


def main():
    print("Connecting to server...")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, PORT, USERNAME, PASSWORD, timeout=15)

    # Create remote directory
    print(f"Creating {REMOTE_BASE}...")
    stdin, stdout, stderr = client.exec_command(f"mkdir -p {REMOTE_BASE}")
    stdout.channel.recv_exit_status()

    # Transfer files
    print("Transferring files...")
    sftp = client.open_sftp()
    file_count, total_size = transfer_files(sftp)
    sftp.close()
    print(f"Transferred {file_count} files ({total_size / 1024 / 1024:.1f} MB)")

    # Create .env file
    token = secrets.token_hex(32)
    print(f"Creating .env with AUTO_CONTROL_TOKEN={token}")
    env_content = f"AUTO_CONTROL_TOKEN={token}\nLOG_LEVEL=info\n"
    stdin, stdout, stderr = client.exec_command(
        f"cat > {REMOTE_BASE}/.env << 'ENVEOF'\n{env_content}ENVEOF"
    )
    stdout.channel.recv_exit_status()

    # Build and start Docker
    print("Building and starting Docker Compose...")
    stdin, stdout, stderr = client.exec_command(
        f"cd {REMOTE_BASE} && docker compose up --build --detach 2>&1"
    )
    # Stream output
    for line in iter(stdout.readline, ""):
        print(f"  {line}", end="")
    exit_code = stdout.channel.recv_exit_status()
    if exit_code != 0:
        err = stderr.read().decode()
        print(f"Build/start failed (exit={exit_code}): {err}")
        client.close()
        sys.exit(1)

    print("\nDeployment complete!")

    # Verify
    print("\nVerifying deployment...")
    cmds = [
        "docker compose ps",
        "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3123/healthz",
        "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3123/readyz",
    ]
    for cmd in cmds:
        stdin, stdout, stderr = client.exec_command(f"cd {REMOTE_BASE} && {cmd}")
        out = stdout.read().decode().strip()
        print(f"  $ {cmd}")
        print(f"  -> {out}")

    client.close()
    print("\nAll done! Server is running at http://117.72.181.8:3123")


if __name__ == "__main__":
    main()