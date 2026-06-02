# 战棋多人对战游戏 — 设计文档

## 概述

一款现代军事风格的战棋多人对战游戏。玩家通过 REST API 控制己方势力，建造基地、生产单位、采集资源，并摧毁敌方总部。提供只读的 Web 观战前端，支持实时观看对局。

**主题**：现代军事作战 — 基地建设、资源采集、单位生产、战术对抗。

## 架构

基于 Fastify（Node.js）的事件驱动单进程架构。

```
[玩家 API 客户端] ←REST→ [Fastify API 层] ←→ [事件总线] ←→ [游戏引擎]
                                                            ↕
                                                        [状态存储]
                                                            ↕
                                                  [Web 前端 (SSE)]
```

### 组件

1. **API 层** — Fastify HTTP 服务器，对外暴露 REST 接口和 SSE 推送
2. **事件总线** — 进程内 EventEmitter，解耦指令提交与执行
3. **游戏引擎** — 验证指令、执行游戏逻辑、发出状态变更事件
4. **状态存储** — 内存中的游戏状态（地图、建筑、单位、资源、回合、事件日志）
5. **Web 前端** — Fastify 托管的静态 HTML/JS/CSS，使用 Canvas 渲染棋盘

## 游戏状态模型

### 地图

- 30×30 网格
- 所有格子为平坦地形，无地形效果
- 固定位置分布有采矿点（见开局设定）

> 地形系统将在后续迭代中加入。

### 资源

```typescript
interface Resources {
  gold: number;
}
```

- 玩家起始拥有 100 金币
- 采矿器每回合产出金币（见采矿器建筑）

### 建筑

```typescript
interface Building {
  id: string;
  owner: 'player_a' | 'player_b';
  type: 'headquarters' | 'barracks' | 'miner';
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  buildProgress: number;    // 剩余建造回合数（0 = 已完工）
  isBuilding: boolean;      // 是否正在建造中
}
```

### 建筑类型

| 类型 | 生命 | 建造时间 | 费用 | 说明 |
|------|------|---------|------|------|
| 总部 | 200 | 0（预建） | — | 主基地，被摧毁即游戏结束。可生产步兵。 |
| 兵营 | 100 | 2 回合 | 50 金 | 可生产各类军事单位 |
| 采矿器 | 60 | 1 回合 | 30 金 | 必须建在采矿点上，每回合产出 15 金 |

### 生产队列

可生产单位的建筑拥有生产队列：

```typescript
interface ProductionQueue {
  buildingId: string;
  queue: { type: UnitType; turnsRemaining: number }[];
}
```

- 总部：可生产步兵（费用 40，1 回合）
- 兵营：可生产步兵（40，1 回合）、狙击手（60，2 回合）、坦克（80，3 回合）、医疗兵（50，1 回合）
- 每个建筑同时只能生产一个单位
- 生产时立即扣除金币

### 单位

```typescript
interface Unit {
  id: string;
  owner: 'player_a' | 'player_b';
  type: 'infantry' | 'sniper' | 'tank' | 'medic';
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  moveRange: number;
  attackRange: number;
  alive: boolean;
  hasMoved: boolean;
  hasAttacked: boolean;
}
```

### 单位类型

| 类型 | 生命 | 攻击 | 防御 | 移动 | 射程 | 费用 | 生产时间 | 说明 |
|------|------|------|------|------|------|------|---------|------|
| 步兵 | 100 | 20 | 8 | 3 | 1 | 40 | 1 回合 | 均衡的前线单位 |
| 狙击手 | 60 | 35 | 3 | 2 | 4 | 60 | 2 回合 | 高伤害、脆弱、远程 |
| 坦克 | 150 | 25 | 15 | 2 | 1 | 80 | 3 回合 | 重装甲、缓慢、强力 |
| 医疗兵 | 70 | 5 | 5 | 3 | 1 | 50 | 1 回合 | 可治疗相邻友方单位 |

### 回合状态

```typescript
interface TurnState {
  turnNumber: number;
  currentOwner: 'player_a' | 'player_b';
  phase: 'waiting_command' | 'executing' | 'game_over';
}
```

### 事件

```typescript
interface GameEvent {
  seq: number;
  type: 'game_start' | 'move' | 'attack' | 'heal' | 'unit_death'
      | 'build' | 'build_complete' | 'produce' | 'produce_complete'
      | 'mine' | 'base_destroyed' | 'turn_end' | 'game_over';
  timestamp: number;
  payload: Record<string, unknown>;
}
```

## 建造系统

### 建造范围

玩家只能在友方对象（单位或建筑）曼哈顿距离 2 格以内的位置进行建造。

```
以 (5, 5) 处的对象为中心，可建造的位置：
  . . . . X . . . .
  . . . X X X . . .
  . . X X X X X . .
  . X X X O X X X .
  . . X X X X X . .
  . . . X X X . . .
  . . . . X . . . .
```

### 建造流程

1. 玩家发送 `POST /build`，参数 `{type, x, y}`
2. 引擎验证：金币是否足够？是否在建造范围内？格子是否为空？
3. 扣除金币，放置建筑，设置 `isBuilding = true`，`buildProgress = 建造所需回合数`
4. 每回合结束时：所有在建建筑的 `buildProgress` 减 1
5. 当 `buildProgress = 0` 时：建筑变为可用状态，发出 `BuildComplete` 事件

### 生产流程

1. 玩家发送 `POST /produce`，参数 `{buildingId, unitType}`
2. 引擎验证：建筑是否已完工？该建筑能否生产此单位？金币是否足够？
3. 扣除金币，将单位加入建筑的生产队列
4. 每回合结束时：所有在产单位的 `turnsRemaining` 减 1
5. 当 `turnsRemaining = 0` 时：单位在建筑旁的空格子上生成，发出 `ProduceComplete` 事件

### 采矿流程

- 每个已完工的采矿器在其所属玩家的回合开始时产出 15 金
- 采矿点是地图上的固定位置
- 采矿器必须建在采矿点格子上

## API 接口

### 认证

每局游戏有两个玩家：`player_a`（创建者）和 `player_b`（加入者）。创建游戏时，服务器为每个玩家生成唯一的 API Token。玩家在所有操作请求中必须通过 `X-Player-Token` 请求头携带 Token。

### 玩家 API

| 接口 | 方法 | 请求体 | 说明 |
|------|------|--------|------|
| `/api/games` | POST | `{mapSeed?}` | 创建新对局，返回 `gameId`、`playerAToken` |
| `/api/games/:id/join` | POST | — | 加入对局，返回 `playerBToken` |
| `/api/games/:id` | GET | `X-Player-Token` 请求头 | 获取游戏状态（地图、建筑、单位、资源、回合） |
| `/api/games/:id/build` | POST | `{type, x, y}` | 建造建筑 |
| `/api/games/:id/produce` | POST | `{buildingId, unitType}` | 在建筑中生产单位 |
| `/api/games/:id/move` | POST | `{unitId, x, y}` | 移动单位 |
| `/api/games/:id/attack` | POST | `{attackerId, targetId}` | 攻击单位或建筑 |
| `/api/games/:id/heal` | POST | `{medicId, targetId}` | 医疗兵治疗相邻友方单位 |
| `/api/games/:id/end-turn` | POST | — | 结束当前回合 |

### 观战 API

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/games/:id/events` | GET | 获取所有事件（`Accept: text/event-stream` 时为 SSE 流） |
| `/api/games/:id/events?after=N` | GET | 获取第 N 条之后的事件（轮询用） |
| `/` | GET | Web 观战前端 |

### 错误响应

所有错误返回 `{error: string, code: string}`：

| 错误码 | 含义 |
|--------|------|
| `not_your_turn` | 不是当前玩家的回合 |
| `insufficient_gold` | 金币不足 |
| `out_of_build_range` | 2 格内无友方对象 |
| `cell_occupied` | 目标格子已有建筑或单位 |
| `not_mining_point` | 采矿器必须建在采矿点上 |
| `building_not_ready` | 建筑仍在建造中 |
| `cannot_produce` | 该建筑无法生产此类型单位 |
| `unit_not_found` | 单位不存在或不属于当前玩家 |
| `invalid_move` | 目标格子超出移动范围 |
| `invalid_attack` | 目标超出攻击范围或本回合已行动 |
| `game_over` | 游戏已结束 |

## 开局设定

- 30×30 地图
- 每个玩家起始拥有：1 个总部、100 金币、无单位

**玩家 A**（左侧）：
- 总部位于 `(4, 15)`

**玩家 B**（右侧）：
- 总部位于 `(25, 15)`

**采矿点**（中立共享）：
- `(10, 5)`、`(10, 15)`、`(10, 25)`
- `(19, 5)`、`(19, 15)`、`(19, 25)`

## 回合流程

1. 玩家轮询 `GET /api/games/:id`，发现 `currentOwner` 为自己
2. **收入阶段**（自动）：所有已完工的采矿器为当前玩家产出金币
3. 玩家按任意顺序发出指令：
   - `POST /build` — 放置建筑（消耗金币，开始建造）
   - `POST /produce` — 在已完工的建筑中排队生产单位（消耗金币）
   - `POST /move` — 移动单位
   - `POST /attack` — 攻击
   - `POST /heal` — 治疗
4. 玩家发送 `POST /end-turn`：
   - 所有在建建筑的 `buildProgress` 减 1，完工的发出 `BuildComplete`
   - 所有在产单位的 `turnsRemaining` 减 1，完成的生成单位并发出 `ProduceComplete`
   - 重置所有单位的行动标记（`hasMoved`、`hasAttacked`）
   - 切换 `currentOwner`
   - 发出 `TurnEnd`
5. 每次操作后，引擎检查任一总部是否被摧毁 → 发出 `BaseDestroyed` + `GameOver`

### 伤害计算

```
基础伤害 = 攻击方攻击力 - 防御方防御力
最终伤害 = max(1, 基础伤害 + random(-3, 3))
```

### 治疗计算（医疗兵）

```
治疗量 = 25 + random(0, 10)
目标生命值 = min(目标最大生命值, 目标当前生命值 + 治疗量)
```

## Web 前端（观战）

- Fastify 在 `/` 路径托管静态文件
- Canvas 棋盘渲染
- 通过 SSE 连接 `/api/games/:id/events` 实时更新
- 事件回放：加载完整事件日志，支持播放/暂停/调速
- 可视元素：网格、建筑、单位、采矿点、生命条、资源显示

## 数据持久化

- MVP：仅内存存储，服务器重启后对局丢失
- 后续：可选文件或数据库持久化

## 技术栈

- **运行时**：Node.js 20+
- **框架**：Fastify 5
- **语言**：TypeScript
- **前端**：原生 HTML/CSS/JS + Canvas API
- **构建**：tsx（开发）、tsc + node（生产）

## 项目结构

```
game/
├── src/
│   ├── server.ts          # Fastify 服务器入口
│   ├── api/
│   │   ├── games.ts       # 对局 CRUD 路由
│   │   ├── actions.ts     # 玩家操作路由（建造、生产、移动、攻击、治疗）
│   │   └── events.ts      # SSE 和事件轮询路由
│   ├── engine/
│   │   ├── engine.ts      # 核心游戏引擎（回合管理、操作验证）
│   │   ├── building.ts    # 建筑逻辑、建造、生产队列
│   │   ├── units.ts       # 单位定义和移动
│   │   ├── resources.ts   # 金币经济、采矿
│   │   └── combat.ts      # 伤害和治疗计算
│   ├── events/
│   │   └── bus.ts         # 事件总线和事件类型
│   └── state/
│       └── store.ts       # 内存游戏状态存储
├── public/
│   ├── index.html         # 前端入口
│   ├── style.css
│   └── app.js             # Canvas 渲染和 SSE 客户端
├── package.json
└── tsconfig.json
```
