# Single-VPS Deployment

This release runs TacticalGame as one Node.js container exposed directly at `http://SERVER_IP:3123`. It is intentionally a single replica: game state and live SSE subscriptions are process-local. Do not add replicas, Docker Swarm, or rolling deployment until the store and event bus are replaced with shared services.

Deployment is driven from a workstation: `deploy/deploy.py` pushes the working tree over SFTP to the VPS and runs `docker compose up --build --detach` there. The VPS does **not** need a git checkout — rollback is done by checking out an older commit locally and redeploying (see Updating And Rollback).

## Security Notice

This deployment has no password gateway and uses unencrypted HTTP. Anyone who can reach TCP port `3123` can access public game pages and APIs. `AUTO_CONTROL_TOKEN` protects admin endpoints only (delete game, force adjudication, admin rename); it does not protect game routes or encrypt `X-Player-Token`, `X-Host-Token`, or `X-Control-Token` headers.

Restrict TCP `3123` to trusted source IPs, a VPN, or a private network in the cloud firewall/security group. Do not expose this direct HTTP endpoint broadly on an untrusted network. Add TLS termination and an access policy before broader use.

## Prerequisites

Workstation (where `deploy.py` runs):

- Python 3 with `paramiko` (`pip install paramiko`).
- SSH reachability of the VPS.

VPS:

- Docker Engine and the Docker Compose plugin.
- A deployment account in the `docker` group (non-root recommended).
- A firewall/security group that exposes SSH and TCP `3123` only to the intended clients.

## Configure deploy/.env.deploy

Copy `deploy/.env.deploy.example` to `deploy/.env.deploy` and fill in the values. This file holds server credentials and is gitignored; never commit it.

| Variable | Required | Notes |
| --- | --- | --- |
| `DEPLOY_HOST` / `DEPLOY_PORT` | yes | Server address, SSH port (default 22). |
| `DEPLOY_USER` | no | Defaults to `root`; prefer a dedicated account in the `docker` group. |
| `DEPLOY_KEY_PATH` | one of | SSH private key; preferred auth method. |
| `DEPLOY_PASSWORD` | one of | Password auth fallback; also used as the key passphrase. |
| `DEPLOY_REMOTE_BASE` | no | Remote project directory, default `/srv/tactical-game`. |
| `CONTROL_TOKEN` | yes | Value written to the remote `.env` as `AUTO_CONTROL_TOKEN`. Must stay stable across deploys so scripts/agents calling admin endpoints keep working. Generate with `openssl rand -hex 32`. |
| `LOG_LEVEL` | no | Written to the remote `.env` (default `info`). |
| `METRICS_TOKEN` | no | When set, `/metrics` requires `x-metrics-token` (or `Authorization: Bearer`). Leave unset only on trusted networks. |
| `TACTICAL_GAME_TOKEN_PEPPER` | no | HMAC pepper for stored player/host tokens. Must stay stable across restarts and backups; if omitted, the server generates `runtime/token-pepper` on the volume. |
| `DEPLOY_PRUNE` | no | Set `1` to delete remote files under the project directory that no longer exist locally. |

Host keys are verified against `~/.ssh/known_hosts`. On the first connect (or when the known_hosts file has no entry for the host) the script prompts to accept and save the fingerprint (TOFU); in non-interactive environments an unknown host key aborts the deploy. A changed fingerprint always fails the connection.

## Deploy

From the repository root:

```bash
python deploy/deploy.py
```

The script:

1. Connects over SSH (key preferred, password fallback).
2. Uploads files under `REMOTE_BASE` incrementally — a file is re-sent only when its size or mtime differs remotely; unchanged files are skipped. The first run uploads everything once to establish the timestamp baseline; afterwards routine deploys transfer only changed files (the bulk of the tree is the ~230 MB `rl/models` payload, which rarely changes).
3. Rewrites `REMOTE_BASE/.env` from `CONTROL_TOKEN`/`LOG_LEVEL`. This file is fully managed by the script — manual edits on the server do not survive a deploy.
4. Runs `docker compose up --build --detach` (streamed to the console).
5. Verifies `/healthz` and `/readyz` return `200` from the server's loopback; the script exits non-zero if either check fails.

With `DEPLOY_PRUNE=1`, files left on the server by previous deploys (renamed sources, removed artifacts) are deleted; `.env` and `backups/` are always protected.

## Deploy Logs

Every run writes `deploy/logs/deploy-<YYYYMMDD-HHMMSS>.log` (the console output is mirrored there). The log records:

- Stage start/finish lines with timestamps: 连接 / 文件传输 / 写入 .env / 构建启动 / 健康检查.
- Streamed remote build output, line by line with timestamps — if a deploy hangs, the log tail shows exactly where.
- A final summary listing each stage's duration, the overall result (成功/失败), and on failure the stage that failed; health check failures include the observed status codes.

The 30 most recent logs are kept; `deploy/logs/` is gitignored and excluded from upload.

## State, Backups, And Restarts

Game state is stored per game under `/app/runtime/store/<gameId>.json`, backed by the named `tactical-game-runtime` Docker volume. Each write goes to a temporary file, is `fsync`ed, and atomically replaces that game's snapshot; the previous snapshot is kept as `<gameId>.json.prev`. `/app/runtime/games.json` is now the legacy/export format: it is imported on first upgrade and written by `npm run export-state` or on shutdown, so you can roll back to 3.6.x with the exported file. Corrupt snapshots or a corrupt legacy file are archived as `*.corrupt-*` instead of silently clearing state, and plaintext tokens from 3.6.x are migrated to hashes on load. The volume also holds `runtime/records-index.json`, `runtime/token-pepper`, and `runtime/archive/` (expired lobby / finished games).

Expired lobbies (default 24h) and finished games (default 7 days) are archived to `runtime/archive/` and removed every 10 minutes. Override with `TACTICAL_GAME_LOBBY_TTL_HOURS` / `TACTICAL_GAME_OVER_TTL_HOURS` (0 disables that sweep); active games are never auto-deleted. If you set `TACTICAL_GAME_TOKEN_PEPPER`, keep it stable across restarts and include it in your secret backup, otherwise existing tokens stop authenticating.

A normal app-container restart restores state, but immediately disconnects every SSE client. A process crash can lose only changes that have not completed their synchronous snapshot write.

`/readyz` now performs a light deep check: map table loaded and the state directory writable. It still returns exactly `{"status":"ready"}` on success; a write-permission or map-load failure returns `503` with `status: degraded`, so a deploy that cannot persist state fails its health check instead of running half-broken.

Back up the volume before upgrades and regularly thereafter (run on the VPS, from the project directory):

```bash
mkdir -p backups
docker run --rm \
  -v tactical-game-runtime:/data:ro \
  -v "$PWD/backups":/backup \
  alpine:3.21 sh -c 'tar czf /backup/tactical-game-runtime-$(date +%F-%H%M%S).tgz -C /data .'
```

`backups/` is excluded from upload and from pruning.

Restore only while the stack is stopped:

```bash
docker compose down
docker run --rm \
  -v tactical-game-runtime:/data \
  -v "$PWD/backups":/backup:ro \
  alpine:3.21 sh -c 'rm -rf /data/* && tar xzf /backup/FILE.tgz -C /data'
docker compose up --detach
```

Never run `docker compose down --volumes` unless intentionally deleting every saved game.

## Updating And Rollback

To deploy the latest committed state of the local checkout, run `python deploy/deploy.py` again. A replacement app container causes a brief interruption and closes all active event streams; saved games are loaded from the persistent volume.

To roll back, check out the previous verified commit on the workstation and redeploy:

```bash
git log --oneline -5
git checkout <previous-verified-commit>
python deploy/deploy.py
```

Files that only exist in newer revisions are ignored by the old build (the image only consumes the files it copies), but they stay on the server; clean them up with `DEPLOY_PRUNE=1` on the next deploy. Restore a volume backup only when an incompatible game-state format or data corruption requires it.

3.7.0 stores game state as per-game snapshots under `runtime/store/`; pre-3.7 builds only read `runtime/games.json`. Before rolling back to an older build, let the container stop gracefully (SIGTERM exports `games.json`) or run `docker compose exec app npm run export-state`; otherwise restore a volume backup.

## Smoke Test

After every deployment, verify directly through port `3123`:

1. `/healthz` and `/readyz` return `200` (the deploy script asserts this; check `docker compose logs app` on failure).
2. `/play.html` and `/spectator.html` load.
3. `/api/maps` returns configured maps.
4. A game can be created, joined, started, and changed with `X-Player-Token`.
5. Player and spectator pages receive new events while left open for more than 30 seconds.
6. Admin endpoints (delete game, force adjudication, admin rename) reject external requests without `X-Control-Token: $AUTO_CONTROL_TOKEN`.

When secure public access is needed, place a TLS-terminating reverse proxy, cloud load balancer, VPN, or firewall allowlist in front of this service. Keep the application as one replica until game state and SSE fan-out are backed by shared services.
