# TacticalGame

尖顶六边形、轴坐标 `q/r` 的回合制多人战棋。两名玩家争夺地图据点获取补给，在总部或己方据点部署单位，最终摧毁敌方总部获胜。

当前版本：`2.1.3`。完整版本变更见 [`RELEASE_NOTES.md`](RELEASE_NOTES.md)。

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

## 核心规则

- 地图为尖顶六边形，坐标为 `{ q, r }`。
- 当前内置地图为 `default`（六角前线）和 `desert`（裂谷控制区），半径均为 `8`；有效格满足 `max(abs(q), abs(r), abs(-q-r)) <= radius`。
- 地形：`plain` 可通行/部署，`water` 和 `blocker` 不可通行/部署。
- 每方开局有总部、2 个步兵、1 个侦察兵、80 补给；不同地图可调整初始坐标。
- **每回合最多消耗 5 个行动点**（`config.balance.actionsPerTurn`）。首次操作一个单位（部署/移动/攻击/治疗）消耗 1 点并「激活」该单位；同一单位在本回合内的后续动作免费。行动点用尽后，只能继续操作已激活的单位。这是为防止资源碾压方操作过多单位而设的硬上限。
- 每个单位每回合可移动一次、行动一次。
- 移动使用路径搜索，不能穿过水域、阻挡、单位或总部。
- 攻击/治疗只按六边形距离判断，不做视线阻挡。
- 只有步兵和侦察兵可占领据点；站在据点上结束己方回合即占领。
- 回合切换后，新当前玩家获得基础收入 10 + 每个己方据点 15。
- 可从己方总部或己方据点向相邻空白平地部署单位。
- 摧毁敌方总部立即获胜。
- 若双方完成第 20 回合后仍未摧毁总部，系统按优势分裁决：敌方总部已损血×4 + 己方总部当前 HP×2 + 己方据点数×120 + 存活部队价值×2 + 剩余补给×1。分高者胜；完全同分才记录为平局。

## 单位

| 类型 | HP | 攻击 | 防御 | 移动 | 射程 | 费用 | 角色 |
|---|---:|---:|---:|---:|---:|---:|---|
| `infantry` | 100 | 28 | 8 | 3 | 1 | 45 | 占点与守点 |
| `scout` | 70 | 18 | 4 | 5 | 1 | 40 | 快速抢点 |
| `heavy` | 145 | 36 | 14 | 2 | 1 | 90 | 抗线突破 |
| `ranger` | 75 | 46 | 3 | 2 | 3 | 75 | 远程输出 |
| `support` | 80 | 12 | 5 | 3 | 1 | 60 | 治疗支援 |

总部：HP 200，防御 8。

> 经济说明：基础收入 10/回合，每个己方据点额外 +15。配合 5 行动点上限，囤积补给无法快速转化为兵力，避免雪球。

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
| `POST` | `/api/games/:id/end-turn` | `{}` |

旧版 `/build`、`/produce`、`/sell` 已移除。

### 事件

`GET /api/games/:id/events?after=<seq>` 返回增量事件；`Accept: text/event-stream` 时建立 SSE。

事件类型：

`game_start`, `deploy`, `move`, `attack`, `heal`, `unit_death`, `control_point_captured`, `income`, `reset_actions`, `turn_end`, `headquarters_destroyed`, `game_over`, `name_rename`

`game_start` 包含完整地图、据点、总部、单位、资源和数值配置，观战页可只靠事件流重放。`game_over` 的 `reason` 为 `headquarters_destroyed`、`turn_limit_score` 或 `turn_limit_draw`。

## 地图格式

地图位于 `maps/`，文件名就是 `mapId`（例如 `default.json` 对应 `mapId: "default"`）。服务启动时会加载并校验地图配置，`GET /api/maps` 返回可选地图：

```json
{
  "grid": "hex",
  "orientation": "pointy",
  "radius": 8,
  "terrainCells": [{ "q": 0, "r": 1, "terrain": "water" }],
  "controlPoints": [{ "id": "cp_c", "name": "中央阵地", "q": 0, "r": 0 }],
  "headquarters": {
    "player_a": { "q": -8, "r": 0 },
    "player_b": { "q": 8, "r": 0 }
  },
  "startingUnits": [{ "owner": "player_a", "type": "infantry", "q": -7, "r": 0 }],
  "units": {},
  "headquartersSpec": { "hp": 200, "defense": 8 },
  "balance": { "startingSupplies": 80, "baseIncome": 10, "controlPointIncome": 15, "damageVarianceRange": 3, "minimumDamage": 1, "healVarianceRange": 6, "actionsPerTurn": 5, "maxTurns": 20, "adjudicationWeights": { "enemyHqDamage": 4, "ownHqHp": 2, "controlPoint": 120, "armyValue": 2, "supplies": 1 } }
}
```

未列在 `terrainCells` 的有效格默认为 `plain`。

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

AI 策略优先级：击毁总部、击杀低血单位、治疗友军、战略部署、抢占据点/推进总部。第 8 回合后或拥有 3 个据点时优先转入总部压力；第 15 回合后按裁决分优化行动。行动失败时会记录 API 错误并尝试下一个候选动作，不会在同一个非法动作上紧密重试。

## 回放与记录

- 观战页可以从在线对局导出回放 JSON 或离线 HTML。
- 导出的 JSON 可在观战页重新导入并按事件流回放。
- 历史对战记录放在 `records/V1` 和 `records/V2`；V2 记录包含 `schemaVersion`，便于后续回放兼容。

## 测试

```bash
npm run build
npm test
```
