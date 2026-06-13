# 战棋多人对战游戏

现代军事题材的回合制战棋游戏。两名玩家通过 REST API 控制各自势力，建造建筑、生产单位、移动攻击，摧毁敌方总部即可获胜。

## 技术栈

- 后端：Node.js + TypeScript + Fastify
- 前端：原生 HTML/CSS/JS（观战 + 手动操作 UI）
- 数据：内存存储（`GameStore`），重启后数据丢失
- 地图：JSON 配置文件驱动（`maps/` 目录），支持多地图

## 启动

```bash
npm install
npm run dev
```

服务器默认监听 `0.0.0.0:3000`。可通过环境变量修改端口：

```bash
PORT=8080 npm run dev
```

启动后控制台会打印所有可用页面和 API 端点。

## Web 界面

| 路径 | 说明 |
|------|------|
| `http://localhost:3000/spectator.html` | 观战页面，查看所有对局 |
| `http://localhost:3000/play.html` | 操作页面，创建/加入对局并手动操作 |

## REST API 完整参考

所有操作类请求需要在 Header 中携带 `X-Player-Token: <token>`。请求体为 JSON，Content-Type 为 `application/json`。

### 对局管理

| 方法 | 路径 | 说明 | 请求体 | 返回 |
|------|------|------|--------|------|
| `GET` | `/api/games` | 列出所有对局 | — | `{ games: [...] }` |
| `GET` | `/api/games/:id` | 获取对局详情（需 token） | — | 完整 GameState（不含 tokens） |
| `POST` | `/api/games` | 创建对局 | `{ mapId?, name? }` | `{ gameId, playerAToken }` |
| `POST` | `/api/games/:id/join` | 加入对局 | `{ name? }` | `{ playerBToken }` |
| `PATCH` | `/api/games/:id/rename` | 重命名玩家（无需 token） | `{ playerId, name }` | `{ ok: true }` |

### 游戏操作

| 方法 | 路径 | 说明 | 请求体 |
|------|------|------|--------|
| `POST` | `/api/games/:id/build` | 建造建筑 | `{ type, x, y }` |
| `POST` | `/api/games/:id/produce` | 生产单位 | `{ buildingId, unitType }` |
| `POST` | `/api/games/:id/move` | 移动单位 | `{ unitId, x, y }` |
| `POST` | `/api/games/:id/attack` | 攻击目标 | `{ attackerId, targetId }` |
| `POST` | `/api/games/:id/heal` | 医疗兵治疗 | `{ medicId, targetId }` |
| `POST` | `/api/games/:id/sell` | 出售建筑（返还 80% 费用） | `{ buildingId }` |
| `POST` | `/api/games/:id/end-turn` | 结束回合 | — |

### 查询

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/games/:id/events?after=<seq>` | 获取对局事件流（增量轮询 / SSE） |
| `GET` | `/api/maps` | 列出所有可用地图 |

### 事件 SSE

`GET /api/games/:id/events` 支持两种模式：
- **普通 HTTP**：Accept 头不含 `text/event-stream` 时，返回 `{ events: [...] }`
- **SSE 流**：Accept 头含 `text/event-stream` 时，建立 SSE 长连接，实时推送事件。可用 `?close=true` 在发送完历史事件后自动关闭连接（用于测试）

## 建筑一览

以下为默认地图 (`maps/default.json`) 的数值，不同地图可能不同。

| `type` | 名称 | 费用 | HP | 防御 | 建造时间 | 攻击 | 射程 | 每回合攻击次数 | 功能 |
|--------|------|------|-----|------|----------|------|------|---------------|------|
| `headquarters` | 总部 | — | 200 | — | — | — | — | — | 初始建筑，被摧毁则失败 |
| `barracks` | 兵营 | 50 | 100 | — | 2 | — | — | — | 生产所有兵种 |
| `miner` | 采矿器 | 30 | 60 | — | 1 | — | — | — | 每回合产金 +15 |
| `bunker` | 碉堡 | 70 | 120 | 10 | 2 | 24 | 2 | 2 | 可攻击的防御建筑 |
| `wall` | 墙 | 20 | 50 | 5 | 1 | — | — | — | 障碍物，阻挡移动 |

## 单位一览

以下为默认地图 (`maps/default.json`) 的数值。

| `type` | 名称 | 费用 | HP | 攻击 | 防御 | 移动 | 射程 | 生产时间 |
|--------|------|------|-----|------|------|------|------|----------|
| `infantry` | 步兵 | 40 | 100 | 40 | 8 | 3 | 1 | 1 |
| `sniper` | 狙击手 | 60 | 60 | 70 | 3 | 2 | 4 | 2 |
| `tank` | 坦克 | 80 | 150 | 50 | 15 | 2 | 1 | 3 |
| `medic` | 医疗兵 | 50 | 70 | 10 | 5 | 3 | 1 | 1 |

## 地图

游戏支持多地图，地图文件位于 `maps/` 目录。通过 `GET /api/maps` 查看可用地图，创建对局时可通过 `mapId` 指定。

| 地图 ID | 名称 | 尺寸 | 特点 |
|---------|------|------|------|
| `default` | 默认地图 | 20×20 | 标准对称地图，4 个采矿点 |
| `desert` | 沙漠战场 | 25×25 | 大型地图，矿产稀缺，地形复杂 |

## 游戏规则

- **回合制**：Player A 先手。每回合可进行任意次操作，操作完毕后调用 `end-turn` 移交回合
- **初始资金**：默认 100 金（由地图配置决定）
- **回合收入**：基础收入 +5 金，每个已建造的采矿器额外 +15 金
- **建造范围**：建筑 2 格、墙 4 格范围内需有己方单位或建筑
- **采矿器限制**：必须建在采矿点（mining point）上
- **生产限制**：单位必须生产在对应建筑相邻格（上下左右），且建筑需已完成建造
- **每回合行动**：每个单位每回合可移动一次 + 攻击/治疗一次（`hasMoved` 和 `hasAttacked` 独立）
- **伤害计算**：`max(最小伤害1, 攻击力 - 防御力 + 随机浮动[-3,+3])`
- **治疗**：医疗兵治疗 25 + 随机[0,10]，射程 1
- **胜利条件**：摧毁敌方总部
- **出售建筑**：返还建造费用的 80%，总部不可出售，建造中的建筑不可出售

## 事件类型

事件通过 `GET /api/games/:id/events?after=<seq>` 获取，`after` 为上次收到的事件序号（增量轮询）。

| 事件类型 | 说明 |
|----------|------|
| `game_start` | 对局开始（含完整初始状态） |
| `build` | 开始建造 |
| `build_tick` | 建造进度推进 |
| `build_complete` | 建造完成 |
| `produce` | 开始生产单位 |
| `produce_complete` | 单位生产完成 |
| `move` | 单位移动 |
| `attack` | 攻击结算 |
| `heal` | 治疗结算 |
| `unit_death` | 单位死亡 |
| `base_destroyed` | 建筑被摧毁 |
| `mine` | 采矿收入 |
| `base_income` | 基础收入 |
| `sell` | 出售建筑 |
| `reset_actions` | 回合结束，重置行动标记 |
| `turn_end` | 回合切换 |
| `game_over` | 游戏结束 |
| `name_rename` | 玩家改名 |

## 测试

```bash
npm test
```

## 文档

详细设计规格见 `docs/superpowers/specs/2026-06-03-tactical-game-design.md`。
