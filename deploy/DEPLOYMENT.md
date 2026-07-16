# Single-VPS Deployment

This release runs TacticalGame as one Node.js container behind a password-protected Caddy proxy. It is intentionally a single replica: game state and live SSE subscriptions are process-local. Do not add replicas, Docker Swarm, or rolling deployment until the store and event bus are replaced with shared services.

## Prerequisites

- A Linux VPS with Docker Engine and the Docker Compose plugin.
- SSH key access and a non-root deployment account that can run Docker.
- A firewall that exposes SSH and the selected proxy port only. The application container does not publish port `3100`.
- Git and this repository checked out on the VPS.

For an initial IP-only test, this stack uses HTTP at `http://SERVER_IP:8080`. Basic authentication protects every route, but HTTP does not encrypt credentials. Use this only while access is restricted and move to a domain with HTTPS before any broader network exposure.

## First Launch

```bash
cd /srv/tactical-game
git clone <repository-url> .
cp .env.example .env
```

Edit `.env` on the server:

1. Set a long random `AUTO_CONTROL_TOKEN`.
2. Set `CADDY_AUTH_USER`.
3. Generate a password hash and place the complete bcrypt value in `CADDY_AUTH_HASH`:

```bash
docker run --rm caddy:2.10.0-alpine \
  caddy hash-password --plaintext 'choose-a-long-password'
```

4. Keep `PROXY_PORT=8080` for IP testing, or change it after firewall rules are configured.

Build and launch the two-container stack:

```bash
docker compose up --build --detach
docker compose ps
docker compose logs --follow
```

The proxy is the only public endpoint. Confirm the application container has no published host port:

```bash
docker compose ps
curl -i http://SERVER_IP:8080/healthz
curl -u "$CADDY_AUTH_USER:YOUR_PASSWORD" http://SERVER_IP:8080/readyz
curl -u "$CADDY_AUTH_USER:YOUR_PASSWORD" http://SERVER_IP:8080/api/maps
```

The first request must return `401`; the authenticated readiness and maps requests must return `200`.

## State, Backups, And Restarts

Game state is written to `/app/runtime/games.json`, backed by the named `tactical-game-runtime` Docker volume. A normal app-container restart restores that file, but immediately disconnects every SSE client. A process crash can lose only changes that have not completed their synchronous file write.

Back up the volume before upgrades and regularly thereafter:

```bash
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

```bash
git fetch origin
git checkout <release-tag-or-commit>
docker compose build app
docker compose up --detach --no-deps app
docker compose ps
docker compose logs --tail=100 app
```

A replacement app container causes a brief interruption and closes all active event streams. Saved games are loaded from the persistent volume. To roll back, check out the preceding verified commit and repeat the same build/up commands. Restore the volume backup only when an incompatible game-state format or data corruption requires it.

## Smoke Test

After every deployment, use the password-protected URL to verify:

1. `/healthz` and `/readyz` return `200`.
2. `/play.html` and `/spectator.html` load.
3. `/api/maps` returns configured maps.
4. A game can be created, joined, started, and changed with `X-Player-Token`.
5. Player and spectator pages receive new events while left open for more than 30 seconds.
6. Control endpoints reject external requests without `X-Control-Token: $AUTO_CONTROL_TOKEN`.

## Move To A Domain And HTTPS

When a domain is available, point its DNS A/AAAA records to the VPS, expose ports `80` and `443`, and replace the IP-testing site address in `deploy/Caddyfile` with the domain name. Map host ports `80:80` and `443:443` in `compose.yml`, mount Caddy data/config volumes, and allow Caddy to obtain and renew the certificate automatically. Keep Basic Auth enabled until an application-level identity model is introduced.

Do not log query strings or authorization headers at the proxy. The application redacts its player, host, and control token headers; browser SSE URLs intentionally omit player tokens.
