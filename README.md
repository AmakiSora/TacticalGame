# TacticalGame

尖顶六边形、轴坐标 `q/r` 的回合制多人战棋。支持 2-8 名玩家自由混战，玩家争夺地图据点获取补给，在总部或己方据点部署单位，摧毁其他玩家总部并成为最后存活者。除逐人轮流的经典模式与歼灭模式外，`standoff`、`molten-throne`、`mistpine` 等地图提供**同时回合模式**：全员秘密下达指令，服务器统一同时结算，无先手优势、多人无需排队等待；`snowflake`（雪花）与 `narrow-road`（狭路相逢）地图则提供**大逃杀模式（royale）**——同时回合的指令方式叠加歼灭缩圈规则。

当前版本：`3.8.16`。完整版本变更见 [`RELEASE_NOTES.md`](RELEASE_NOTES.md)（编写规范见 [`docs/RELEASE_NOTES_SPEC.md`](docs/RELEASE_NOTES_SPEC.md)）。

## 技术栈

- 后端：Node.js + TypeScript + Fastify
- 前端：原生 HTML/CSS/JS + Canvas
- 数据：内存状态 + 本地持久化文件，服务器重启后恢复对局
- 地图：`maps/*.json` V2 hex 配置
- 对战记录：`records/` 保存导出的回放 JSON、复盘 Markdown 和 AI 日志

## 启动

```bash
npm install
```
```bash
npm run dev
```
默认监听 `0.0.0.0:3100`。页面：

| 路径 | 说明 |
|---|---|
| `http://localhost:3100/` | 首页：模式介绍、单位速览与功能入口 |
| `http://localhost:3100/play.html` | 创建/加入并手动操作（窄屏自动进入手机版） |
| `http://localhost:3100/play-m.html` | 玩家手机版：大厅、触控棋盘与操作抽屉 |
| `http://localhost:3100/spectator.html` | 观战、导入回放、导出 JSON/HTML（窄屏自动进入手机版） |
| `http://localhost:3100/spectator-m.html` | 观战手机版：触控棋盘、回放栏与信息抽屉 |
| `http://localhost:3100/stats.html` | 对局统计看板（模型排行、对位、地图与对局列表） |
| `http://localhost:3100/arena.html` | AI 竞技场：按玩法模式分榜的 RL 模型 × 内置算法榜单、对位矩阵、玩法统计与评估控制台 |
| `http://localhost:3100/entertainment.html` | 娱乐数据看板（回合节奏曲线、战斗群像、势头学、名场面与纪录柜） |
| `http://localhost:3100/map-editor.html` | 本地导入、可视化编辑并导出地图 JSON |

远程使用删除对局、强制裁决、管理员改名等管理接口时设置 `AUTO_CONTROL_TOKEN=<token>`；未设置时仅本机可调用，权限细节见 [docs/API.md](docs/API.md)。

## 统计数据与 Agent 简写

统计页与娱乐页读取 `public/data/stats.json` / `fun-stats.json`，`npm run stats-all` 刷新回放统计与竞技场数据。完整命令、竞技场数据链、性能基线与 Agent 简写对照见 [docs/STATS.md](docs/STATS.md)。

## 对局持久化

服务会把每个对局写到 `runtime/store/<gameId>.json`（临时文件 + `fsync` + 原子替换），启动时自动恢复；`runtime/games.json` 是旧版单文件格式，只在首次升级时导入、创建/删除/退出时导出。`runtime/` 已在 `.gitignore` 中，不会上传 git。

需要回滚或迁移到旧格式时：

```bash
npm run export-state
```

`TACTICAL_GAME_STATE_FILE` 仍可改状态根文件位置；快照目录会放在同一目录的 `store/` 下。测试环境默认不启用持久化，除非显式设置 `TACTICAL_GAME_STATE_FILE`。

## 核心规则

规则唯一规范源是仓库根 `skill/`（服务器经 `GET /api/skill/files/:name` 下发同一份内容）；对局数值一律以本局 `config` 与 `GET /api/games/:id` 的实时状态为准。本节只做速览，不再复写细则：

| 模式 | 内置地图 | 核心机制 | 规范文件 |
|---|---|---|---|
| `standard` 逐人轮流 | `default`、`breach`、`danger-close`、`dual-lanes`、`multiplayer-ring`、`whirlpool` | 有总部、有行动顺序；总部归零淘汰；达到 `maxTurns` 按裁决分定胜负 | [skill/standard.md](skill/standard.md) |
| `annihilation` 歼灭 | `artillery-zone`、`trench-run`（战壕） | 无总部；炮火预告后逐轮向中心收缩；危险区禁部署/治疗/维修；最后存活者获胜 | [skill/annihilation.md](skill/annihilation.md) |
| `simultaneous` 同时回合 | `standoff`、`molten-throne`、`mistpine` | 无行动顺序：先秘密排队，再按行动点分步同时结算；攻击/治疗瞄准格子或方向 | [skill/simultaneous.md](skill/simultaneous.md) |
| `royale` 大逃杀 | `snowflake`、`narrow-road` | 同时回合结算 + 歼灭规则（无总部、炮火收缩、打光即淘汰） | [skill/royale.md](skill/royale.md) |

所有模式共享的速览：

- 尖顶六边形，坐标 `{ q, r }`；`game.cells` 是实际可用格集合（`map.radius` 不等于可走圆盘）；地形只有 `plain` 可通行/部署，`water` 与未爆破的 `blocker` 不可通行。
- 行动点按**单位激活**计：首次部署/移动/攻击/治疗/爆破耗 1 点，同一单位本回合后续合法动作免费，上限 `config.balance.actionsPerTurn`。
- 部署来源、占领限制、治疗与爆破的角色限制、收入与维修规则按模式与地图配置，见对应 skill 文件。
- 裁决公式的权威定义见 [skill/SKILL.md](skill/SKILL.md)「Adjudication score」，实时分数直接读 `GET /api/games/:id` 的 `adjudication`，不要自行重算。
- 歼灭计分、同时回合的分步结算/失败连锁/攻击形状、大逃杀炮火节奏等模式细则只维护在对应 skill 文件。地图清单与逐图数值以 `maps/*.json` 为准（文件名即 mapId）。

## 单位

单位与总部数值**按地图配置**，不要跨图套用：同一兵种在不同地图上数值不同（例如 `mistpine` 步兵 68 血，`default` 为 100；`default` 总部 180 血）。每局读 `game.config.units`、`game.units[]` 的实例字段（`hp` / `attack` / `defense` / `moveRange` / `attackRange` / `cost` / `canCapture` / `healPower`）与 `config.headquartersSpec`；读取口径与战斗掷骰公式见 [skill/SKILL.md](skill/SKILL.md)「Units」，逐图数值与经济配置见 `maps/*.json`。

## REST API

完整接口参考见 [docs/API.md](docs/API.md)。玩家操作带 `X-Player-Token`，房主管理带 `X-Host-Token`；删除对局、强制裁决、管理员改名与竞技场跑批等控制接口使用 `AUTO_CONTROL_TOKEN`（未设置时仅本机可调用）。

常用入口：

| 用途 | 接口 |
|---|---|
| 对局状态 | `GET /api/games/:id`（支持 `include` 投影与 ETag） |
| 等待轮次/事件 | `GET /api/games/:id/wait?afterSeq=<seq>&timeout=<seconds>` |
| 事件流 | `GET /api/games/:id/events`（`Accept: text/event-stream` 时建立 SSE） |
| 玩法动作 | `POST /api/games/:id/{deploy,move,attack,heal,demolish,end-turn}` |
| Agent 技能 | `GET /api/skill`、`/api/skill/manifest`、`/api/skill/files/:name` |
| 健康与指标 | `GET /healthz`、`GET /readyz`、`GET /metrics` |

失败响应统一为 `{ error, code }`；玩法动作支持 `Idempotency-Key` 幂等重试。事件类型与回放格式、AI 机器人、回放库与竞技场评估接口见 [docs/API.md](docs/API.md)。

## 地图格式

地图位于 `maps/`（文件名即 `mapId`），启动时加载并校验；`GET /api/maps` 返回可选地图，浏览器编辑器在 `/map-editor.html`。字段说明、异形地图、无回合上限以及歼灭/大逃杀炮火配置见 [docs/MAP_FORMAT.md](docs/MAP_FORMAT.md)。

## AI 自动对战

项目支持四类 AI：提示词驱动的 LLM AI（`skill/ai-player.mjs`）、强化学习模型（`rl/models/`）、内置算法（`algorithms/`）与外部 LLM 提示词。启动方式、参数、算法清单、自博弈标定与复盘流程见 [docs/AI_PLAYERS.md](docs/AI_PLAYERS.md)；算法实时战绩看 `/arena.html`，实现档案在 `algorithms/docs/algorithms/`。

## 回放与记录

- 观战页可以从在线对局导出回放 JSON 或离线 HTML。
- 导出的 JSON 可在观战页重新导入并按事件流回放。
- 历史对战记录放在 `records/V1`、`records/V2` 和 `records/V3`；V2/V3 记录包含 `schemaVersion`，便于后续回放兼容。历史回放的 `schemaVersion` 表示导出时的回放格式，不随应用版本批量改写。
- 对局 agent 的复盘规范也经 `/api/skill/files/:name` 下发（`review.md` + 各模式文件），保证远程 agent 与本地玩家遵循同一套复盘格式。

## 测试

```bash
npm run build
npm test
```
