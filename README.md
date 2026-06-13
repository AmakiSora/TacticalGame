# 六边形占点经济战棋

尖顶六边形、轴坐标 `q/r` 的回合制多人战棋。两名玩家争夺地图据点获取补给，在总部或己方据点部署单位，最终摧毁敌方总部获胜。

## 技术栈

- 后端：Node.js + TypeScript + Fastify
- 前端：原生 HTML/CSS/JS + Canvas
- 数据：内存存储，服务器重启后对局丢失
- 地图：`maps/*.json` V2 hex 配置

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
| `http://localhost:3000/play.html` | 创建/加入并手动操作 |
| `http://localhost:3000/spectator.html` | 观战、回放、导出 |

## 核心规则

- 地图为尖顶六边形，坐标为 `{ q, r }`。
- 默认地图半径为 `8`，有效格满足 `max(abs(q), abs(r), abs(-q-r)) <= radius`。
- 地形：`plain` 可通行/部署，`water` 和 `blocker` 不可通行/部署。
- 每方开局有总部、2 个步兵、1 个侦察兵、80 补给。
- 每个单位每回合可移动一次、行动一次。
- 移动使用路径搜索，不能穿过水域、阻挡、单位或总部。
- 攻击/治疗只按六边形距离判断，不做视线阻挡。
- 只有步兵和侦察兵可占领据点；站在据点上结束己方回合即占领。
- 回合切换后，新当前玩家获得基础收入 15 + 每个己方据点 20。
- 可从己方总部或己方据点向相邻空白平地部署单位。
- 摧毁敌方总部立即获胜。

## 单位

| 类型 | HP | 攻击 | 防御 | 移动 | 射程 | 费用 | 角色 |
|---|---:|---:|---:|---:|---:|---:|---|
| `infantry` | 100 | 28 | 8 | 3 | 1 | 40 | 占点与守点 |
| `scout` | 70 | 18 | 4 | 5 | 1 | 35 | 快速抢点 |
| `heavy` | 160 | 36 | 16 | 2 | 1 | 80 | 抗线突破 |
| `ranger` | 75 | 42 | 3 | 2 | 3 | 65 | 远程输出 |
| `support` | 80 | 12 | 5 | 3 | 1 | 55 | 治疗支援 |

总部：HP 240，防御 10。

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

`game_start` 包含完整地图、据点、总部、单位、资源和数值配置，观战页可只靠事件流重放。

## 地图格式

地图位于 `maps/`：

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
  "headquartersSpec": { "hp": 240, "defense": 10 },
  "balance": {}
}
```

未列在 `terrainCells` 的有效格默认为 `plain`。

## AI 自动对战

```bash
npm run dev
node skill/ai-player.mjs --side a
node skill/ai-player.mjs --side b --game <gameId>
```

AI 策略优先级：击毁总部、击杀低血单位、抢占据点、部署补强、推进总部、治疗友军。

## 测试

```bash
npm run build
npm test
```
