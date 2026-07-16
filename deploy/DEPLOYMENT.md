# Single-VPS Deployment

This release runs TacticalGame as one Node.js container exposed directly at `http://SERVER_IP:3123`. It is intentionally a single replica: game state and live SSE subscriptions are process-local. Do not add replicas, Docker Swarm, or rolling deployment until the store and event bus are replaced with shared services.

## Security Notice

This deployment has no password gateway and uses unencrypted HTTP. Anyone who can reach TCP port `3123` can access public game pages and APIs. `AUTO_CONTROL_TOKEN` protects control endpoints only; it does not protect game routes or encrypt `X-Player-Token`, `X-Host-Token`, or `X-Control-Token` headers.

Restrict TCP `3123` to trusted source IPs, a VPN, or a private network in the cloud firewall/security group. Do not expose this direct HTTP endpoint broadly on an untrusted network. Add TLS termination and an access policy before broader use.

## Prerequisites

- A Linux VPS with Docker Engine and the Docker Compose plugin.
- SSH key access and a non-root deployment account that can run Docker.
- Git and this repository checked out on the VPS.
- A firewall/security group that exposes SSH and TCP `3123` only to the intended clients.

## First Launch

```bash
cd /srv/tactical-game
git clone <repository-url> .
git checkout feature/deploy
cp .env.example .env
```

Generate a control token and place it in `.env`:

```bash
openssl rand -hex 32
nano .env
chmod 600 .env
```

Keep `PORT=3123`, `HOST=0.0.0.0`, and `TRUST_PROXY=false` in `.env`. Build and launch the one-container stack:

```bash
docker compose up --build --detach
docker compose ps
docker compose logs --follow app
```

Verify direct access from the VPS or an allowed client:

```bash
curl -i http://SERVER_IP:3123/healthz
curl -i http://SERVER_IP:3123/readyz
curl -i http://SERVER_IP:3123/api/maps
```

Each request must return `200`. `docker compose ps` must show only the `app` service with `0.0.0.0:3123->3123/tcp` published.

## State, Backups, And Restarts

Game state is written to `/app/runtime/games.json`, backed by the named `tactical-game-runtime` Docker volume. A normal app-container restart restores that file, but immediately disconnects every SSE client. A process crash can lose only changes that have not completed their synchronous file write.

Back up the volume before upgrades and regularly thereafter:

```bash
mkdir -p backups
docker run --rm \
  -v tactical-game-runtime:/data:ro \
  -v "$PWD/backups":/backup \
  alpine:3.21 sh -c 'tar czf /backup/tactical-game-runtime-$(date +%F-%H%M%S).tgz -C /data .'
```

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

To deploy the latest committed branch version:

```bash
git pull --ff-only origin feature/deploy
docker compose up --build --detach
docker compose ps
docker compose logs --tail=100 app
```

A replacement app container causes a brief interruption and closes all active event streams. Saved games are loaded from the persistent volume.

To roll back, select a preceding verified commit and rebuild the app:

```bash
git log --oneline -5
git checkout <previous-verified-commit>
docker compose up --build --detach
```

Restore the volume backup only when an incompatible game-state format or data corruption requires it.

## Smoke Test

After every deployment, verify directly through port `3123`:

1. `/healthz` and `/readyz` return `200`.
2. `/play.html` and `/spectator.html` load.
3. `/api/maps` returns configured maps.
4. A game can be created, joined, started, and changed with `X-Player-Token`.
5. Player and spectator pages receive new events while left open for more than 30 seconds.
6. Control endpoints reject external requests without `X-Control-Token: $AUTO_CONTROL_TOKEN`.

When secure public access is needed, place a TLS-terminating reverse proxy, cloud load balancer, VPN, or firewall allowlist in front of this service. Keep the application as one replica until game state and SSE fan-out are backed by shared services.
