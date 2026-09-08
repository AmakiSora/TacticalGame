# TacticalGame

尖顶六边形、轴坐标 `q/r` 的回合制多人战棋。支持 2-8 名玩家自由混战，玩家争夺地图据点获取补给，在总部或己方据点部署单位，摧毁其他玩家总部并成为最后存活者。除逐人轮流的经典模式与歼灭模式外，`standoff`（对峙之地）地图提供**同时回合模式**：全员秘密下达指令，服务器统一同时结算，无先手优势、多人无需排队等待。

当前版本：`3.4.6`。完整版本变更见 [`RELEASE_NOTES.md`](RELEASE_NOTES.md)。

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
| `http://localhost:3100/play.html` | 创建/加入并手动操作（窄屏自动进入手机版） |
| `http://localhost:3100/play-m.html` | 玩家手机版：大厅、触控棋盘与操作抽屉 |
| `http://localhost:3100/spectator.html` | 观战、导入回放、导出 JSON/HTML（窄屏自动进入手机版） |
| `http://localhost:3100/spectator-m.html` | 观战手机版：触控棋盘、回放栏与信息抽屉 |
| `http://localhost:3100/spectator2.html` | 新版全息观战台，支持实时观战与回放复盘 |
| `http://localhost:3100/stats.html` | 对局统计看板（模型排行、对位、地图与对局列表） |
| `http://localhost:3100/entertainment.html` | 娱乐数据看板（行为画像、趣味事实、单位偏好与极限记录） |
| `http://localhost:3100/map-editor.html` | 本地导入、可视化编辑并导出地图 JSON |

### 统计数据

统计页和娱乐数据页都是纯静态页面，分别读取 `public/data/stats.json` 与 `public/data/fun-stats.json`，不访问对局 API。数据由脚本扫描 `records/V2` 与 `records/V3` 回放生成：

```bash
npm run stats
# 等价于 node script/generateStats.mjs

npm run fun-stats
# 等价于 node script/generateFunStats.mjs

npm run stats-all
# 依次刷新两份统计数据
```

新增或更新回放后运行 `npm run stats-all` 即可同时刷新两个看板。

远程使用删除对局、强制裁决、管理员改名等管理接口时建议设置：

```bash
AUTO_CONTROL_TOKEN=<your-token> npm run dev
```

未设置 `AUTO_CONTROL_TOKEN` 时，这些管理接口只允许本机访问。

## 对局持久化

服务会把当前对局保存到 `runtime/games.json`，启动时自动恢复。`runtime/` 已在 `.gitignore` 中，不会上传 git。

如需改保存位置：

```bash
TACTICAL_GAME_STATE_FILE=/path/to/games.json npm run dev
```

测试环境默认不启用持久化，除非显式设置 `TACTICAL_GAME_STATE_FILE`。

## 核心规则

- 地图可声明 `mode: "annihilation"` 进入「歼灭模式」。该模式不生成总部，每名玩家开局拥有一个出生据点和地图配置的初始部队；最后一个单位死亡时立即淘汰，仅剩一名玩家时获胜。
- 歼灭模式的炮火会先预告、再按配置轮次向地图中心收缩。危险区单位在每个整轮开始时同时受到无视防御的炮火伤害，危险区内禁止部署、治疗和据点维修；炮火同时消灭所有剩余玩家时判定同归于尽。
- 歼灭模式按有效行动贡献值计算行动分：部署/爆破记 1 点，实际伤害/治疗每 20 HP 向上折算 1 点，占领据点记 2 点，纯移动不计分；贡献值默认每点折算 10 分。玩家淘汰时会冻结其裁决分，终局排名不会因单位清理而把已淘汰玩家全部记为 0 分。
- 地图可声明 `mode: "simultaneous"` 进入「同时回合模式」（当前仅 `standoff` 对峙之地，2/3/6 人对称布局，标准 HQ 胜负规则）。该模式没有行动顺序：每回合所有玩家在**计划阶段**通过普通动作接口把指令**入队而不执行**（可撤回，`POST /api/games/:id/plan/revoke` 撤回单条、`plan/clear` 清空），`end-turn` 表示确认锁定；全员确认后（或房主 `host/force-resolve` 强制）服务器**严格同时结算**。
  - **每单位每回合仅一个动作**：移动 或 攻击 或 治疗（支援） 或 爆破（重装），四选一；部署独立计点，新单位当回合不能行动。每个排队动作消耗 1 行动点，队列长度上限 = `actionsPerTurn`（standoff 为 5）。
  - **攻击改为瞄准格子/方向**：`POST /attack` 请求体为 `{ attackerId, q, r }`，可点击范围由地图为每个兵种配置的 `attackShape` 决定（未配置默认 `single`）：`single` = 射程内任选一格；`line`（步兵）= 点击格须在正六方向射线上，覆盖该方向前 `length` 格（默认 2），**射线上所有敌人各自独立结算伤害**；`arc`（重装）= 点击相邻格定向，覆盖该格及其左右相邻共 3 格扇形。结算按移动/部署后的棋盘判定覆盖格内敌方单位/敌方总部（友军免伤、空格落空即浪费）。`attackLock: true` 的兵种（游侠）在计划时点击格上若站着敌方单位则**锁定**该单位：结算时只要目标未逃出攻击者的射程圈，无论移动到哪里都命中，逃出射程才落空（`missed`，reason `target_escaped`）——这是反风筝的核心机制。
  - **目的格冲突全部失败**：跨玩家的移动/部署指向同一格时全部失败（`action_failed`，reason `destination_conflict`），不返还行动点、失败部署不扣补给；自己队列内的重复目标格在入队时直接拒绝。
  - 移动路径按计划时刻棋盘计算（所有单位视为障碍）；爆破产生的平地在移动结算后才生效。**治疗为区域效果**：`POST /heal` 请求体为 `{ supportId, q, r }`，覆盖形状由 `healShape` 配置（支援兵为 `arc` 三格扇形；默认 `single`），入队要求计划时覆盖格内至少一名友军，结算时覆盖格内所有受伤友军各自掷治疗量；目标移出覆盖格则落空（`out_of_range`），覆盖格内无人受伤则 `already_healthy`。
  - **净血量同时结算**：目标 HP = 当前 HP + 全部治疗 − 全部承受伤害，结果 > 0 则存活；同回合互杀成立，阵亡攻击者的炮弹仍然落地。
  - 第 1 回合无收入；自第 2 回合起，回合边界给**所有**存活玩家同时发放收入与维修点治疗。占点在结算结束时按单位站位判定。standoff 对局为 15 回合上限、每出生位仅 2 步兵 + 1 侦察起始（重装/游侠/支援均为部署兵种），基础收入 8、外围 supply 据点收入 8、总部 200 血；为压低屯兵，军力/补给裁决权重分别为 0.35/0.25，有效行动权重为 6。
  - 其他玩家的计划队列严格保密：`GET /api/games/:id` 仅返回 `plan.myQueue`（自己的队列）与 `plan.committed`（已确认名单）。
- 地图为尖顶六边形，坐标为 `{ q, r }`。
- 当前内置地图包含旧双人地图、`multiplayer-ring` 多人环形地图、仅支持 4 人的异形地图 `four-corners` 和同时回合模式的 `standoff`（对峙之地，2/3/6 人）；每张地图会声明支持的玩家人数。旧地图默认使用 `radius` 内的完整六边形，异形地图通过 `playableCells` 显式声明实际存在的格子。
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
- 总部归零的玩家被淘汰，其裁决分会在清场前冻结，随后单位移除、据点转为中立、资源冻结；对局继续。
- 仅剩一名存活玩家时立即获胜。
- 达到地图配置的最大轮数时，仅存活玩家参与裁决。分数按地图 `balance.adjudicationWeights` 计算：累计总部伤害×W_dmg + 己方总部当前 HP×W_hp + 己方据点数×W_cp + 存活部队价值×W_army + 剩余补给×W_sup + 有效行动贡献值×W_action。部署/爆破记 1 点，实际伤害/治疗每 20 HP 向上折算 1 点，占领据点记 2 点，纯移动不计分；同时模式的攻击命中改为每 10 HP 贡献 1 点，专门提高战斗行为的行动分。权重因图而异（例如 default 为 5/2/90/2/1，有效行动默认 2/贡献值）；唯一最高分获胜，并列最高则平局。歼灭模式有效行动默认 10/贡献值。

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

玩家操作类请求需要 `X-Player-Token: <token>`；房主管理请求需要 `X-Host-Token: <hostToken>`。房主身份与玩家身份分离，房主可不参战。

### 对局

| 方法 | 路径 | 请求体 | 返回 |
|---|---|---|---|
| `GET` | `/api/maps` | - | `{ maps }` |
| `GET` | `/api/games` | - | `{ games }` |
| `POST` | `/api/games` | `{ mapId, maxPlayers, participate?, playerName? }` | `{ gameId, hostToken, player: { id, token } \| null, lobby }` |
| `GET` | `/api/games/:id/lobby` | - | 公开大厅摘要，不含凭证 |
| `POST` | `/api/games/:id/join` | `{ name? }` | `{ player: { id, token }, lobby }` |
| `POST` | `/api/games/:id/start` | host token header | `{ ok: true, game }` |
| `GET` | `/api/games/:id` | token header | 完整状态，不含 token |
| `PATCH` | `/api/games/:id/player` | `{ name }` | `{ ok: true }` |
| `POST` | `/api/games/:id/leave` | player token header | `{ ok: true }` |
| `DELETE` | `/api/games/:id/players/:playerId` | host token header | `{ ok: true, lobby }` |
| `POST` | `/api/games/:id/host/skip-turn` | host token header | `{ ok: true }` |
| `POST` | `/api/games/:id/host/eliminate` | `{ playerId }` + host token header | `{ ok: true }` |
| `POST` | `/api/games/:id/force-adjudicate` | control token | `{ ok: true, result }` |
| `DELETE` | `/api/games/:id` | control token | `{ ok: true }` |

强制裁决仅适用于进行中的对局，按请求时存活玩家的裁决总分决定胜者；最高分并列则平局。删除、强制裁决和管理员改名接口使用控制权限：设置 `AUTO_CONTROL_TOKEN` 后需要 `X-Control-Token: <token>` 或 `?token=<token>`；未设置时仅允许本机请求。删除对局会同时删除内存状态和持久化文件中的记录。

### 操作

| 方法 | 路径 | 请求体 |
|---|---|---|
| `POST` | `/api/games/:id/deploy` | `{ unitType, fromId, q, r }` |
| `POST` | `/api/games/:id/move` | `{ unitId, q, r }` |
| `POST` | `/api/games/:id/attack` | 顺序模式 `{ attackerId, targetId }`；同时模式 `{ attackerId, q, r }`（指定格子） |
| `POST` | `/api/games/:id/heal` | `{ supportId, targetId }` |
| `POST` | `/api/games/:id/demolish` | `{ unitId, q, r }` |
| `POST` | `/api/games/:id/end-turn` | `{}`（同时模式 = 确认锁定计划；全员确认即触发结算） |
| `POST` | `/api/games/:id/plan/revoke` | `{ actionId }`（同时模式专用，撤回一条排队指令） |
| `POST` | `/api/games/:id/plan/clear` | 无（同时模式专用，清空自己的计划） |
| `POST` | `/api/games/:id/host/force-resolve` | 无（房主强制立即结算，未确认者按现有队列参与） |

旧版 `/build`、`/produce`、`/sell` 已移除。

### 事件

`GET /api/games/:id/events?after=<seq>` 返回增量事件；`Accept: text/event-stream` 时建立 SSE。

事件类型：

`player_joined`, `player_left`, `game_start`, `deploy`, `move`, `attack`, `heal`, `unit_death`, `demolish`, `control_point_captured`, `control_point_neutralized`, `control_point_repair`, `income`, `comeback_supply`, `artillery_warning`, `artillery_shrunk`, `artillery_damage`, `reset_actions`, `turn_skipped`, `turn_end`, `round_end`, `round_start`, `round_resolved`, `plan_committed`, `action_failed`, `headquarters_destroyed`, `player_eliminated`, `game_over`, `name_rename`

`game_start` 包含完整玩家列表、出生分配、行动顺序、地图、据点、总部、单位、资源和数值配置，观战页可只靠事件流重放。`game_over` 的 `reason` 为 `last_player_standing`、`turn_limit_score`、`turn_limit_draw`、`forced_adjudication_score` 或 `forced_adjudication_draw`。

`income` 事件保留总额字段，并在类型化据点地图中提供 `breakdown` 明细：`pointId`、`name`、`kind`、`amount`。`deploy` 事件中 `cost` 表示实际消耗，`unitCost` 表示单位基础费用，`discount` 表示部署源折扣。`control_point_repair` 事件包含修复据点、单位、修复量和修复后的 `unitHp`，用于回放同步血量。

`demolish` 事件包含爆破单位、坐标、原地形、目标地形和行动点信息，回放端用它同步地形变化。

同时回合模式新增四类事件：`plan_committed`（某玩家确认本回合计划，只含 playerId 不泄露内容）、`round_resolved`（回合结算汇总，含每个玩家每条指令的结果 `executed/failed/missed/fizzled`）、`round_start`（新回合计划阶段开启）、`action_failed`（冲突落空等未执行的指令及原因）。同时模式的 `attack` 事件带 `q/r/hit` 字段，`hit: false` 表示预测射击落空。

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
    "adjudicationWeights": { "enemyHqDamage": 5, "ownHqHp": 2, "controlPoint": 90, "armyValue": 2, "supplies": 1 }
  }
}
```

异形地图可另外声明 `"playableCells": [{ "q": 0, "r": 0 }, { "q": 1, "r": 0 }]`。该字段可选；省略时，加载器按 `max(abs(q), abs(r), abs(-q-r)) <= radius` 展开完整六边形。声明时可组成任意连通的凹形、凸形或带孔洞边界，但每个坐标仍须位于 `radius` 包络内。加载后所有地图都会得到完整权威格子列表，移动、部署、爆破、寻路和绘图都以该列表为准。`GET /api/maps` 的 `preview.cells` 也始终返回已经解析并带地形的预览格子。

歼灭模式地图另外声明 `mode: "annihilation"`、`annihilation.artillery`，并让每个 `spawnSlots[]` 通过 `controlPointId` 关联一个唯一出生据点。炮火参数包含首次生效轮次 `startRound`、收缩间隔 `intervalRounds`、每轮伤害 `damage` 和最终安全半径 `minimumSafeRadius`。当前内置歼灭模式地图“炮火禁区”（`artillery-zone`）支持 2、3、6 人，采用六向旋转对称出生布局，共 12 轮：第 1–4 轮争夺内圈补给点，第 5–8 轮利用额外收入扩军，第 9–12 轮外圈与内圈据点依次被炮火覆盖。炮火在第 4 轮预告、第 5 轮首次收缩，此后每两轮收缩一层。

未列在 `terrainCells` 的可用格默认为 `plain`。地图编辑器支持添加和移除地块，并可维护 2–8 个出生槽及对应人数布局；移除包含对象的格子会被阻止，避免隐式丢失配置。

据点可选 `kind`：`supply`、`forward_base`、`repair`。如果地图没有任何据点写 `kind`，引擎使用旧规则：统一 `balance.controlPointIncome`、无部署折扣、无据点维修。如果任意据点写了 `kind`，则该地图所有据点都必须写 `kind`，并且 `balance.controlPointTypes` 必须完整配置三种类型的 `income`、`deployDiscount`、`repairAmount`。裁决分始终按据点数量计算，不按据点类型加权。

## AI 自动对战

```bash
npm run dev
node skill/ai-player.mjs --side a --name "AI A"
node skill/ai-player.mjs --side b --game <gameId> --name "AI B"
node skill/ai-player.mjs --side player_c --game <gameId> --token <playerToken>
```

AI 默认会持续轮询并自动处理后续己方回合，直到游戏结束、达到 `--max-turns`，或命令被停止。只有明确想让它只行动一个己方回合时才使用 `--once`。

常用参数：

| 参数 | 说明 |
|---|---|
| `--url <url>` | API 地址，默认 `http://localhost:3100` |
| `--side <a-h|player_a-player_h>` | 选择玩家席位 |
| `--game <gameId>` | 加入或重连已有对局 |
| `--token <token>` | 用已有 token 重连指定席位 |
| `--map <mapId>` | 创建对局时选择地图，默认 `default` |
| `--max-turns <n>` | 最多处理多少个己方回合，默认 `80` |
| `--once` | 只处理当前或下一个己方回合 |

AI 在标准模式中的策略优先级：击毁总部、击杀低血单位、治疗友军、战略部署、抢占据点/推进总部。第 8 回合后或拥有 3 个据点时优先转入总部压力；第 12 回合后按裁决分优化行动。歼灭模式改为优先脱离炮火预警/危险区并向最近敌军推进，不再寻找总部或以占点裁决为主目标。行动失败时会记录 API 错误并尝试下一个候选动作，不会在同一个非法动作上紧密重试。

## 回放与记录

- 观战页可以从在线对局导出回放 JSON 或离线 HTML。
- 导出的 JSON 可在观战页重新导入并按事件流回放。
- 历史对战记录放在 `records/V1`、`records/V2` 和 `records/V3`；V2/V3 记录包含 `schemaVersion`，便于后续回放兼容。历史回放的 `schemaVersion` 表示导出时的回放格式，不随应用版本批量改写。

## 测试

```bash
npm run build
npm test
```
