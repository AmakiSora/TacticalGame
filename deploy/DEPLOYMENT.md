# 单 VPS 部署

本项目以单个 Node.js 容器运行，直接暴露在 `http://SERVER_IP:3123`。这是刻意的单副本设计：对局状态与实时 SSE 订阅都在进程内，在把状态存储和事件总线换成共享服务之前，不要加副本、Docker Swarm 或滚动发布。

部署从工作站发起：`deploy/deploy.py` 通过 SFTP 把工作区上传到 VPS，再在服务器上执行 `docker compose up --build --detach`。VPS **不需要** git 检出——回滚时在本地检出旧提交后重新部署即可（见「更新与回滚」）。

## 安全须知

本部署没有密码网关，且使用未加密的 HTTP。任何能访问 TCP `3123` 的人都可以访问公开的游戏页面和 API。`AUTO_CONTROL_TOKEN` 只保护管理接口（删除对局、强制裁决、管理员改名、竞技场评估控制），不保护游戏路由，也不加密 `X-Player-Token`、`X-Host-Token`、`X-Control-Token` 请求头。控制接口的「本机免令牌」只对不带任何转发头的回环直连生效，经反向代理转来的请求必须带 token。

请在云防火墙/安全组中把 TCP `3123` 限制到可信来源 IP、VPN 或内网。不要把该 HTTP 端点直接暴露在不可信网络上。需要更广泛使用时，先加 TLS 终结与访问策略。

## 前置条件

工作站（运行 `deploy.py` 的机器）：

- Python 3 与 `paramiko`（`pip install paramiko`）。
- 能通过 SSH 访问 VPS。

VPS：

- Docker Engine 与 Docker Compose 插件。
- 一个位于 `docker` 组的部署账号（建议非 root）。
- 防火墙/安全组只对预期客户端开放 SSH 与 TCP `3123`。

## 配置 deploy/.env.deploy

复制 `deploy/.env.deploy.example` 为 `deploy/.env.deploy` 并填写。该文件保存服务器凭证，已加入 gitignore，切勿提交。

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DEPLOY_HOST` / `DEPLOY_PORT` | 是 | 服务器地址、SSH 端口（默认 22）。 |
| `DEPLOY_USER` | 否 | 默认 `root`；建议改用 `docker` 组内的专用账号。 |
| `DEPLOY_KEY_PATH` | 二选一 | SSH 私钥，优先使用。 |
| `DEPLOY_PASSWORD` | 二选一 | 密码认证回退；同时用作私钥口令。 |
| `DEPLOY_REMOTE_BASE` | 否 | 远程项目目录，默认 `/srv/tactical-game`。 |
| `CONTROL_TOKEN` | 是 | 写入远程 `.env` 的 `AUTO_CONTROL_TOKEN`。多次部署之间必须保持不变，否则调用管理接口的脚本/agent 会失效。可用 `openssl rand -hex 32` 生成。 |
| `LOG_LEVEL` | 否 | 写入远程 `.env`（默认 `info`）。 |
| `METRICS_TOKEN` | 否 | 设置后 `/metrics` 需要 `x-metrics-token`（或 `Authorization: Bearer`）。仅在可信网络中留空。 |
| `TACTICAL_GAME_TOKEN_PEPPER` | 否 | 存储玩家/房主 token 的 HMAC pepper，跨重启与备份必须保持不变；省略时服务器会在卷上生成 `runtime/token-pepper`。 |
| `DEPLOY_PRUNE` | 否 | 设为 `1` 时删除远程项目目录下本地已不存在的文件。 |

主机密钥按 `~/.ssh/known_hosts` 校验。首次连接（或 known_hosts 中没有该主机记录）时，脚本会提示接受并保存指纹（TOFU）；非交互环境下遇到未知主机密钥会中止部署。指纹发生变化时连接一律失败。

## 应用环境变量

`deploy/deploy.py` 只重写 `AUTO_CONTROL_TOKEN`、`LOG_LEVEL`、`METRICS_TOKEN` 三个变量（其余变量由 `compose.yml` 的 `environment` 固定或取默认值），因此这三个之外的值要改 `compose.yml` 并重新部署。下表「默认」列是未设环境变量时的代码默认值；部署实际生效值还受 `compose.yml` 透传默认的影响，两者不一致时以部署环境为准。

| 变量 | 默认 | 作用与建议 |
| --- | --- | --- |
| `AUTO_CONTROL_TOKEN` | 无（必填） | 控制接口凭证，来自 `deploy/.env.deploy` 的 `CONTROL_TOKEN`。设置后所有控制请求都要带 `X-Control-Token`（或 `?token=`，仅调试用，会进访问日志）。未设置时只放行「不带任何转发头的回环直连」，所以**开了反向代理却没设 token 时，代理转来的控制请求一律 401**。该接口能拉起竞技场训练子进程，建议用 32 字节随机串（短于 16 字符会在启动时告警）。 |
| `TRUST_PROXY` | `compose.yml` 固定为 `false` | 设为 `true` 时 `req.ip` 取自 `X-Forwarded-For`。只适用于「应用端口仅由你信任的反向代理访问」的部署：代理必须自己写入转发头并覆盖客户端自带的同名头，应用端口不要直接暴露。限流分桶与 SSE 的每 IP 配额都按 `req.ip` 计算，转发头可被客户端伪造，接错反代等于把限流分桶交给客户端。 |
| `METRICS_TOKEN` | 空 | 设置后 `/metrics` 必须带 `X-Metrics-Token` 或 `Authorization: Bearer`。留空时 `/metrics` 对能访问端口的人开放，请用防火墙或反代把该路径限制在内网。 |
| `TACTICAL_GAME_MAX_LOBBIES` | `200` | 活跃大厅上限；达到上限后建房返回 503 `lobby_capacity`（容量保护，不是故障），请等空闲大厅过期。设为非正整数会让进程启动即失败。`compose.yml` 未透传该变量，要调整上限需在 `compose.yml` 的 `environment` 里显式设置。 |
| `TACTICAL_GAME_LOBBY_TTL_HOURS` | `2` | 大厅多久无活动后归档（代码默认 2 小时）；`0` 关闭清理，非法或负数回落默认值并告警。`compose.yml` 以 `${TACTICAL_GAME_LOBBY_TTL_HOURS:-24}` 透传，未显式设置时部署后按 24 小时归档，要按 2 小时需在部署环境设置 `TACTICAL_GAME_LOBBY_TTL_HOURS=2`。 |
| `TACTICAL_GAME_OVER_TTL_HOURS` | `72`（3 天） | 终局对局保留期；进行中的对局永不按 TTL 回收。`compose.yml` 以同值透传。 |

`AUTO_CONTROL_TOKEN` 与 `TACTICAL_GAME_TOKEN_PEPPER` 必须跨部署保持不变：前者变了会让调用管理接口的脚本/agent 失效，后者变了会让现有 token 全部认证失败。

## 部署

在仓库根目录执行：

```bash
python deploy/deploy.py
```

脚本会：

1. 通过 SSH 连接（优先私钥，回退密码）。
2. 增量上传 `REMOTE_BASE` 下的文件——只有远端大小或 mtime 不同时才重传，未变化的文件跳过。首次运行会全量上传一次以建立时间戳基线，之后常规部署只传变化文件（大头是约 230 MB 的 `rl/models`，很少变化）。
3. 按 `CONTROL_TOKEN` / `LOG_LEVEL` / `METRICS_TOKEN` 重写 `REMOTE_BASE/.env`。该文件完全由脚本管理，服务器上的手工修改不会在下次部署后保留。
4. 执行 `docker compose up --build --detach`（输出实时回显）。
5. 从服务器回环地址检查 `/healthz` 与 `/readyz` 返回 `200`；任一检查失败脚本以非零退出码结束。

设置 `DEPLOY_PRUNE=1` 时，会删除旧部署遗留的文件（改名后的源码、已移除的产物）；`.env` 与 `backups/` 始终受保护。

## 部署日志

每次运行都会写入 `deploy/logs/deploy-<YYYYMMDD-HHMMSS>.log`（控制台输出同步镜像到该文件）。日志包含：

- 带时间戳的阶段起止行：连接 / 文件传输 / 写入 .env / 构建启动 / 健康检查。
- 逐行带时间戳的远程构建输出——部署卡住时，看日志尾部即可定位到具体步骤。
- 结束汇总：各阶段耗时、总体结果（成功/失败），失败时标明出错的阶段；健康检查失败会附带观察到的状态码。

最多保留最近 30 份日志；`deploy/logs/` 已加入 gitignore，也不会上传。

## 状态、备份与重启

对局状态按局存放在 `/app/runtime/store/<gameId>.json`，由名为 `tactical-game-runtime` 的 Docker 卷承载。每次改动同步写这一局的快照（先写临时文件、`fsync`，再原子替换），响应返回时该局快照已经在盘上；上一份快照保留为 `<gameId>.json.prev`。`/app/runtime/games.json` 是旧版单文件格式，同时用作导出格式：首次升级时导入，运行中的改动去抖合并写出（trailing 250ms、最长 2s 必写），删除对局、归档与进程退出时强制 flush，因此可以用导出的文件回滚到 3.6.x。损坏的快照或损坏的旧版文件会归档为 `*.corrupt-*`，而不是静默清空状态；3.6.x 的明文 token 会在加载时迁移为哈希。该卷还保存 `runtime/records-index.json`、`runtime/token-pepper` 与 `runtime/archive/`（过期大厅 / 已结束对局）。

过期大厅（代码默认 2 小时；`compose.yml` 未显式设置时实际为 24 小时）与已结束对局（默认 3 天）会归档到 `runtime/archive/`，每 10 分钟清理一次。可用 `TACTICAL_GAME_LOBBY_TTL_HOURS` / `TACTICAL_GAME_OVER_TTL_HOURS` 覆盖（设为 0 关闭对应的清理；非法或负数回落默认值并告警）；进行中的对局永不自动删除。若设置了 `TACTICAL_GAME_TOKEN_PEPPER`，请跨重启保持不变并纳入密钥备份，否则现有 token 将无法通过认证。

应用容器正常重启会恢复状态，但会立即断开所有 SSE 客户端。进程崩溃最多丢失尚未完成同步快照写入的那一次改动；`games.json` 可能落后几秒，但它只用于导出与旧版兼容。

`/readyz` 会做一次轻量深度检查：地图表已加载且状态目录可写。成功时仍精确返回 `{"status":"ready"}`；写权限或地图加载失败返回 `503` 与 `status: degraded`，从而让无法持久化状态的部署在健康检查阶段失败，而不是带病运行。

升级前以及之后定期备份该卷（在 VPS 上、项目目录内执行）：

```bash
mkdir -p backups
docker run --rm \
  -v tactical-game-runtime:/data:ro \
  -v "$PWD/backups":/backup \
  alpine:3.21 sh -c 'tar czf /backup/tactical-game-runtime-$(date +%F-%H%M%S).tgz -C /data .'
```

`backups/` 不会上传，也不会被清理。

只在堆栈停止时恢复：

```bash
docker compose down
docker run --rm \
  -v tactical-game-runtime:/data \
  -v "$PWD/backups":/backup:ro \
  alpine:3.21 sh -c 'rm -rf /data/* && tar xzf /backup/FILE.tgz -C /data'
docker compose up --detach
```

除非明确要删除全部已保存对局，否则不要执行 `docker compose down --volumes`。

## 更新与回滚

部署本地检出的最新提交：再次执行 `python deploy/deploy.py`。替换应用容器会造成短暂中断，并关闭所有活动事件流；已保存的对局会从持久卷恢复。

回滚：在工作站检出上一个已验证提交并重新部署：

```bash
git log --oneline -5
git checkout <previous-verified-commit>
python deploy/deploy.py
```

只存在于新版本的文件不会影响旧构建（镜像只读取自身 COPY 的文件），但仍留在服务器上；可在下次部署时用 `DEPLOY_PRUNE=1` 清理。只有在旧版状态格式不兼容或数据损坏时，才需要恢复卷备份。

当前状态格式是 `runtime/store/` 下的逐局快照；3.7 之前的构建只读 `runtime/games.json`。回滚到更旧的构建前，先让容器优雅停止（SIGTERM 会导出 `games.json`），或执行 `docker compose exec app npm run export-state`；否则请恢复卷备份。

## 冒烟检查

每次部署后，直接通过 `3123` 端口验证：

1. `/healthz` 与 `/readyz` 返回 `200`（部署脚本会断言；失败时查看 `docker compose logs app`）。
2. `/play.html` 与 `/spectator.html` 能正常加载。
3. `/api/maps` 返回已配置的地图。
4. 能创建、加入、开始一局，并用 `X-Player-Token` 完成操作。
5. 玩家页与观战页保持打开 30 秒以上时能收到新事件。
6. 管理接口（删除对局、强制裁决、管理员改名、竞技场评估控制）在不带 `X-Control-Token: $AUTO_CONTROL_TOKEN` 时拒绝外部请求；请求带任何转发头（经反代）时「本机免令牌」不生效，必须带 token。

需要安全的公网访问时，在本服务前放置 TLS 终结反向代理、云负载均衡、VPN 或防火墙白名单。在状态与 SSE 扇出改为共享服务之前，保持单副本运行。
