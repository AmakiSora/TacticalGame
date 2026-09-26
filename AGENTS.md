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
- `arena/` AI 竞技场数据（`matches.jsonl` 对战记录入 git，`details/` 每局明细 gitignored）；页面 `/arena.html`（RL 模型 × 内置算法混榜 + 评估控制台，后端 `src/api/arenaEval.ts`）；算法注册表 `algorithms/registry.mjs`（含展示名，bot 清单/榜单/控制台同源）

## 约束

- **单副本**：状态与 SSE 均为进程内，勿引入多副本/负载均衡。
- **`skill/` 是规范源**：服务器经 `/api/skill/files/:name` 提供；`.zcode`/`.pi`/`.qoder` 下只是拷贝。
- gitignored 勿提交：`runtime/`、`deploy/logs/`、`.env*`、`rl/models/`、`temp/`、`arena/details/`、根目录临时 `*.json`。
- **版本号由当前分支决定**：`release/x.y.z` 分支上版本必须等于 `x.y.z`，新建 release 分支后先 `npm run version x.y.z` 对齐（脚本会同步 package.json/README/skill 等全部引用处）；feature 等开发分支不主动 bump 版本。交付前可 `npm run check-version` 校验一致性。
- **发版日志**：`RELEASE_NOTES.md` 按 [docs/RELEASE_NOTES_SPEC.md](docs/RELEASE_NOTES_SPEC.md) 编写（SemVer 分类：新增/变更/修复/移除/测试与验证）；`## x.y.z` 标题格式不可改，bump 脚本依赖它插入占位小节。**只写相对上一个已发布版本的对外变化**：读者视角是「上一版本 → 本版本」，开发分支上的内部反复（未发布过的文件/地图被替换、返工、措辞更名、测试内部适配）不进日志，这类产物一律按最终形态写成新增/变更；配套的内部动作不写，仍然成立的测试事实可进「测试与验证」。
- 分支：发布用 `release/x.y.z`，中文 conventional commits。
- **Windows `/tmp` 陷阱**：Git Bash 的 `/tmp` 是 `AppData\Local\Temp`，node 却把 `/tmp/x` 解析成 `C:\tmp\x`（旧会话残留处），`curl > /tmp/a.json` 后 node 读它会拿到陈旧数据，看似服务端状态交替。快照用 `curl | node` 管道直读；落盘用 `temp/` 相对路径或 `C:/` 绝对路径，读回前校验 gameId。

## 玩游戏（agent 对战）

按仓库根 `skill/SKILL.md` 的流程：从用户提示取服务器地址（IP → `http://<IP>:3123`）→ 校验 skill 新鲜度：`GET /api/skill/manifest` 与本地副本比对（sha256 优先，版本号兜底），一致直接用本地副本、不一致才重新 `GET /api/skill` 拉全文 → 按对局 `game.config.mode` 拉对应模式文件（standard/annihilation/simultaneous.md，始终从服务器拉）并只遵循它 → 自己调 REST 接口（读状态 → 推理 → 操作）。认证头 `X-Player-Token` / `X-Host-Token`。对局中只可运行 `wait-turn.mjs`（等待用，从服务器下载）；勿用 `ai-player.mjs` 代打。**对局产生的临时文件（下载的 `wait-turn.mjs`、状态快照、事件/调试输出等）一律写到 `temp/<gameId>/<玩家名>/`，不要落在仓库根目录**——详细约定见 SKILL.md 的 Scratch files 节。

局后总结经验（复盘）走 `skill/review.md`（服务器 `GET /api/skill/files/review.md`）：它按模式路由到 `review-standard/annihilation/simultaneous.md`，并规定复盘 MD 的 `records/V3/` 命名（顺序号由用户提示给出）。**回放 JSON 由房主从前端观战页导出归档，agent 只读不写**（同局多个 agent 都写复盘时避免争写冲突）；复盘 MD 是唯一交付物，不落 `temp/`。
