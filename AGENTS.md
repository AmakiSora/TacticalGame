# AGENTS.md

TacticalGame：六角战棋（Node.js + TypeScript + Fastify，前端原生 JS + Canvas）。三种模式：`standard` 逐人轮流、`annihilation` 歼灭（炮火收缩圈）、`simultaneous` 同时回合（地图 `standoff`）。详情见 [README.md](README.md)。

## 命令

```bash
npm run dev          # 开发服务器，端口 3100（生产 3123）
npm run build && npm test   # 交付前必须通过
npm run version      # 改版本号必须用它（版本分散在 package.json/README/skill 等多处）
npm run stats-all    # 刷新统计看板数据
```

Node >= 24 <25，ESM。RL 测试：`npm run test:rl`（需 `rl/.venv`）。

## 结构

- `src/api/` 路由（games/actions/auth/events/skill），`src/engine/` 纯规则引擎，`src/state/store.ts` 内存状态 + 落盘 `runtime/games.json`
- `maps/*.json` 地图（文件名即 mapId），`public/` 前端，`skill/` 玩法技能规范源，`tests/` vitest 与 src 镜像
- `deploy/` 单 VPS 部署（[DEPLOYMENT.md](deploy/DEPLOYMENT.md)），`rl/` 强化学习训练，`records/` 回放存档

## 约束

- **单副本**：状态与 SSE 均为进程内，勿引入多副本/负载均衡。
- **`skill/` 是规范源**：服务器经 `/api/skill/files/:name` 提供；`.zcode`/`.pi`/`.qoder` 下只是拷贝。
- gitignored 勿提交：`runtime/`、`deploy/logs/`、`.env*`、`rl/models/`、根目录临时 `*.json`。
- **版本号由当前分支决定**：`release/x.y.z` 分支上版本必须等于 `x.y.z`，新建 release 分支后先 `npm run version x.y.z` 对齐（脚本会同步 package.json/README/skill 等全部引用处）；feature 等开发分支不主动 bump 版本。交付前可 `npm run check-version` 校验一致性。
- 分支：发布用 `release/x.y.z`，中文 conventional commits。

## 玩游戏（agent 对战）

按仓库根 `skill/SKILL.md` 的流程：从用户提示取服务器地址（IP → `http://<IP>:3123`）→ `GET /api/skill` 拉规范技能 → 按对局 `game.config.mode` 拉对应模式文件（standard/annihilation/simultaneous.md）并只遵循它 → 自己调 REST 接口（读状态 → 推理 → 操作）。认证头 `X-Player-Token` / `X-Host-Token`。对局中只可运行 `wait-turn.mjs`（等待用）；勿用 `ai-player.mjs` 代打。
