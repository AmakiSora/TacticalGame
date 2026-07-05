# TacticalGame

尖顶六边形、轴坐标 `q/r` 的回合制多人战棋。两名玩家争夺地图据点获取补给，在总部或己方据点部署单位，最终摧毁敌方总部获胜。

当前版本：`2.4.1`。完整版本变更见 [`RELEASE_NOTES.md`](RELEASE_NOTES.md)。

## 技术栈

- 后端：Node.js + TypeScript + Fastify
- 前端：原生 HTML/CSS/JS + Canvas
- 数据：内存存储，服务器重启后对局丢失
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
| `http://localhost:3100/play.html` | 创建/加入并手动操作 |
| `http://localhost:3100/spectator.html` | 观战、导入回放、导出 JSON/HTML |
| `http://localhost:3100/control.html` | 自动对战控制台 |
| `http://localhost:3100/map-editor.html` | 本地导入、可视化编辑并导出地图 JSON |

远程访问自动对战控制 API 时建议设置：

```bash
AUTO_CONTROL_TOKEN=<your-token> npm run dev
```

未设置 `AUTO_CONTROL_TOKEN` 时，控制 API 只允许本机访问。

## 核心规则

- 地图为尖顶六边形，坐标为 `{ q, r }`。
- 当前内置地图为 `default`（六角前线）、`desert`（裂谷控制区）、`dual-lanes`（双线抉择）和 `breach`（破障行动），半径均为 `8`；有效格满足 `max(abs(q), abs(r), abs(-q-r)) <= radius`。
- 地形：`plain` 可通行/部署，`water` 和 `blocker` 不可通行/部署。
- 每方开局有总部；默认图和沙漠图提供 2 个步兵、1 个侦察兵、80 补给，`dual-lanes` 不提供免费单位而是给 208 补给让玩家自行部署。
- **每回合最多消耗 5 个行动点**（`config.balance.actionsPerTurn`）。首次操作一个单位（部署/移动/攻击/治疗）消耗 1 点并「激活」该单位；同一单位在本回合内的后续动作免费。行动点用尽后，只能继续操作已激活的单位。这是为防止资源碾压方操作过多单位而设的硬上限。
- 每个单位每回合可移动一次、行动一次。
- 移动使用路径搜索，不能穿过水域、阻挡、单位或总部。
- 攻击/治疗只按六边形距离判断，不做视线阻挡。
- 只有步兵和侦察兵可占领据点；站在据点上结束己方回合即占领。
- 回合切换后，新当前玩家获得基础收入 + 己方据点收入；旧地图使用统一 `controlPointIncome`，类型化据点地图按据点类型分别计算。
- 可从己方总部或己方据点向相邻空白平地部署单位；`forward_base` 据点可按地图配置降低从该点部署的实际费用。
- `repair` 据点会在拥有者行动开始时修复站上或距离 1 格内的己方受伤单位；总部和敌军不会被修复，每个单位每回合最多被据点修复一次。
- 重装单位可花费本回合行动爆破相邻 `blocker` 地形，将其永久变为 `plain`。爆破遵循行动点上限；已移动但未行动的重装可继续爆破，爆破后不能攻击或治疗。
- 摧毁敌方总部立即获胜。
- 若双方完成第 15 回合后仍未摧毁总部，系统按优势分裁决：敌方总部已损血×4 + 己方总部当前 HP×2 + 己方据点数×120 + 存活部队价值×2 + 剩余补给×1。分高者胜；完全同分才记录为平局。

## 单位

| 类型 | HP | 攻击 | 防御 | 移动 | 射程 | 费用 | 角色 |
|---|---:|---:|---:|---:|---:|---:|---|
| `infantry` | 100 | 30 | 8 | 3 | 1 | 45 | 占点与守点 |
| `scout` | 65 | 16 | 4 | 5 | 1 | 38 | 快速抢点 |
| `heavy` | 150 | 38 | 13 | 2 | 1 | 92 | 抗线突破 |
| `ranger` | 72 | 44 | 3 | 2 | 3 | 78 | 远程输出 |
| `support` | 82 | 10 | 5 | 3 | 1 | 60 | 治疗支援 |

总部：HP 180，防御 6。

> 经济说明：`default` 和 `desert` 仍使用基础收入 10/回合、每个己方据点额外 +12；`dual-lanes` 使用类型化据点收入，并以 208 开局补给替代免费初始单位。配合 5 行动点上限，囤积补给无法快速转化为兵力，避免雪球。

## REST API

所有操作类请求需要 `X-Player-Token: <token>`。

### 对局

| 方法 | 路径 | 请求体 | 返回 |
|---|---|---|---|
| `GET` | `/api/maps` | - | `{ maps }` |
| `GET` | `/api/games` | - | `{ games }` |
| `POST` | `/api/games` | `{ mapId?, name? }` | `{ gameId, playerAToken }` |
| `POST` | `/api/games/:id/join` | `{ name? }` | `{ playerBToken }` |
| `GET` | `/api/games/:id` | token header | 完整状态，不含 token |
| `PATCH` | `/api/games/:id/rename` | `{ playerId, name }` | `{ ok: true }` |

### 操作

| 方法 | 路径 | 请求体 |
|---|---|---|
| `POST` | `/api/games/:id/deploy` | `{ unitType, fromId, q, r }` |
| `POST` | `/api/games/:id/move` | `{ unitId, q, r }` |
| `POST` | `/api/games/:id/attack` | `{ attackerId, targetId }` |
| `POST` | `/api/games/:id/heal` | `{ supportId, targetId }` |
| `POST` | `/api/games/:id/demolish` | `{ unitId, q, r }` |
| `POST` | `/api/games/:id/end-turn` | `{}` |

旧版 `/build`、`/produce`、`/sell` 已移除。

### 事件

`GET /api/games/:id/events?after=<seq>` 返回增量事件；`Accept: text/event-stream` 时建立 SSE。

事件类型：

`game_start`, `deploy`, `move`, `attack`, `heal`, `unit_death`, `demolish`, `control_point_captured`, `control_point_repair`, `income`, `reset_actions`, `turn_end`, `headquarters_destroyed`, `game_over`, `name_rename`

`game_start` 包含完整地图、据点、总部、单位、资源和数值配置，观战页可只靠事件流重放。`game_over` 的 `reason` 为 `headquarters_destroyed`、`turn_limit_score` 或 `turn_limit_draw`。

`income` 事件保留总额字段，并在类型化据点地图中提供 `breakdown` 明细：`pointId`、`name`、`kind`、`amount`。`deploy` 事件中 `cost` 表示实际消耗，`unitCost` 表示单位基础费用，`discount` 表示部署源折扣。`control_point_repair` 事件包含修复据点、单位、修复量和修复后的 `unitHp`，用于回放同步血量。

`demolish` 事件包含爆破单位、坐标、原地形、目标地形和行动点信息，回放端用它同步地形变化。

### 自动控制

自动控制 API 用于浏览器控制台和外部调度器。设置 `AUTO_CONTROL_TOKEN` 后，请通过 `X-Control-Token: <token>` 请求头或 `?token=<token>` 访问。

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/control/status` | 查看控制器状态、当前对局、最近日志和配置 |
| `GET` | `/api/control/config` | 读取自动控制配置 |
| `PUT` | `/api/control/config` | 保存自动控制配置 |
| `POST` | `/api/control/start` | 启动自动控制；`bootstrap` 开启时由服务端创建并加入对局 |
| `POST` | `/api/control/pause` | 暂停回合结束后的自动触发 |
| `POST` | `/api/control/resume` | 恢复自动触发 |
| `POST` | `/api/control/stop` | 停止自动控制并取消事件订阅 |
| `POST` | `/api/control/manual` | 向指定玩家发送一次手动提示 |
| `GET` | `/api/control/logs` | 拉取增量日志 |
| `GET` | `/api/control/logs/stream` | 通过 SSE 推送状态和日志 |

## 地图格式

地图位于 `maps/`，文件名就是 `mapId`（例如 `default.json` 对应 `mapId: "default"`）。服务启动时会加载并校验地图配置，`GET /api/maps` 返回可选地图：

浏览器地图编辑器位于 `http://localhost:3100/map-editor.html`。它只做本地导入、可视化编辑和导出 JSON；导出的文件需要手动放入 `maps/`，再重启服务或重新加载配置后使用。

```json
{
  "grid": "hex",
  "orientation": "pointy",
  "radius": 8,
  "terrainCells": [{ "q": 0, "r": 1, "terrain": "water" }],
  "controlPoints": [{ "id": "cp_c", "name": "中央阵地", "q": 0, "r": 0, "kind": "supply" }],
  "headquarters": {
    "player_a": { "q": -8, "r": 0 },
    "player_b": { "q": 8, "r": 0 }
  },
  "startingUnits": [{ "owner": "player_a", "type": "infantry", "q": -7, "r": 0 }],
  "units": {},
  "headquartersSpec": { "hp": 180, "defense": 6 },
  "balance": {
    "startingSupplies": 80,
    "baseIncome": 10,
    "controlPointIncome": 12,
    "controlPointTypes": {
      "supply": { "income": 12, "deployDiscount": 0, "repairAmount": 0 },
      "forward_base": { "income": 8, "deployDiscount": 8, "repairAmount": 0 },
      "repair": { "income": 8, "deployDiscount": 0, "repairAmount": 10 }
    },
    "damageVarianceRange": 3,
    "minimumDamage": 1,
    "healVarianceRange": 6,
    "actionsPerTurn": 5,
    "maxTurns": 15,
    "adjudicationWeights": { "enemyHqDamage": 4, "ownHqHp": 2, "controlPoint": 120, "armyValue": 2, "supplies": 1 }
  }
}
```

未列在 `terrainCells` 的有效格默认为 `plain`。

据点可选 `kind`：`supply`、`forward_base`、`repair`。如果地图没有任何据点写 `kind`，引擎使用旧规则：统一 `balance.controlPointIncome`、无部署折扣、无据点维修。如果任意据点写了 `kind`，则该地图所有据点都必须写 `kind`，并且 `balance.controlPointTypes` 必须完整配置三种类型的 `income`、`deployDiscount`、`repairAmount`。裁决分始终按据点数量计算，不按据点类型加权。

## AI 自动对战

```bash
npm run dev
node skill/ai-player.mjs --side a --name "AI A"
node skill/ai-player.mjs --side b --game <gameId> --name "AI B"
node skill/ai-player.mjs --side a --game <gameId> --token <playerAToken>
```

AI 默认会持续轮询并自动处理后续己方回合，直到游戏结束、达到 `--max-turns`，或命令被停止。只有明确想让它只行动一个己方回合时才使用 `--once`。

常用参数：

| 参数 | 说明 |
|---|---|
| `--url <url>` | API 地址，默认 `http://localhost:3100` |
| `--side <a|b>` | 选择玩家 A 或 B |
| `--game <gameId>` | 加入或重连已有对局 |
| `--token <token>` | 用已有 token 重连指定席位 |
| `--map <mapId>` | 创建对局时选择地图，默认 `default` |
| `--max-turns <n>` | 最多处理多少个己方回合，默认 `80` |
| `--once` | 只处理当前或下一个己方回合 |

AI 策略优先级：击毁总部、击杀低血单位、治疗友军、战略部署、抢占据点/推进总部。第 8 回合后或拥有 3 个据点时优先转入总部压力；第 12 回合后按裁决分优化行动。行动失败时会记录 API 错误并尝试下一个候选动作，不会在同一个非法动作上紧密重试。

### 自动对战控制台

`control.html` 用于管理双边 pi 自动对战。控制台可以配置双方 provider、model、name、session、skill、常规提示、bootstrap 提示和高级命令；支持保存配置、启动、暂停、恢复、停止、发送手动指令和查看日志。

默认运行数据保存在 `runtime/auto-control/`：

- `config.json`：控制台配置
- `state.json`：控制器状态、最后事件序号和当前子进程
- `logs.jsonl`：控制日志

配置中可用占位符：

| 占位符 | 含义 |
|---|---|
| `{gameId}` | 当前对局 ID |
| `{token}` | 对应玩家 token |
| `{side}` / `{owner}` | `player_a` 或 `player_b` |
| `{name}` | 对应玩家名称 |

### autoRunPi 脚本

`script/autoRunPi.mjs` 是基于观战事件的命令行调度器，不需要玩家 token 即可轮询事件；它会在一方结束回合后调用另一方 pi，并把断点状态写入 `script/.autoRun-<gameId>.json`。

连接已有对局：

```bash
node script/autoRunPi.mjs <gameId> --a-session .pi/session/player-a.jsonl --b-session .pi/session/player-b.jsonl
```

自动创建并加入对局：

```bash
node script/autoRunPi.mjs --bootstrap --a-session .pi/session/player-a.jsonl --b-session .pi/session/player-b.jsonl --a-start-prompt "创建一局 default 地图对局" --b-start-prompt "加入对局 {gameId}"
```

常用参数：

| 参数 | 说明 |
|---|---|
| `--base-url <url>` | 服务地址，默认 `http://localhost:3100` |
| `--provider <provider>` | 双方默认 pi provider，默认 `new-api` |
| `--a-provider <provider>` / `--b-provider <provider>` | 分别设置双方 provider |
| `--a-model <model>` / `--b-model <model>` | 分别设置双方模型，默认 `step-3.7-flash` |
| `--a-name <name>` / `--b-name <name>` | 分别设置双方 pi 名称 |
| `--skill <path>` | pi skill 路径，默认 `.pi/skills/skill` |
| `--interval <sec>` | 事件轮询间隔，默认 `2` |
| `--timeout <sec>` | 等待一方结束回合的超时重试秒数，默认 `10` |
| `--fresh` | 忽略断点状态从头开始 |

## 回放与记录

- 观战页可以从在线对局导出回放 JSON 或离线 HTML。
- 导出的 JSON 可在观战页重新导入并按事件流回放。
- 历史对战记录放在 `records/V1` 和 `records/V2`；V2 记录包含 `schemaVersion`，便于后续回放兼容。历史回放的 `schemaVersion` 表示导出时的回放格式，不随应用版本批量改写。

## 测试

```bash
npm run build
npm test
```
