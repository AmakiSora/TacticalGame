# REST API

服务端默认监听 `3100`（开发）/ `3123`（生产），请求与响应均为 JSON（SSE 与 `/metrics` 除外）。规则与操作口径以 `skill/` 为准，本文档只描述接口。

## 认证与控制权限

| 凭证 | 传递方式 | 用途 |
|---|---|---|
| 玩家 token | `X-Player-Token: <player.token>` | 玩家自己的操作、读状态、等待与事件流 |
| 观战 token | `X-Spectator-Token: <spectatorToken>` 或 `?spectatorToken=<spectatorToken>` | fog 局只读全量视角（状态 / 事件 / SSE）；建房响应返回一次，不能用于任何写接口。进行中必须带它才能看全量；对局结束（`phase === "game_over"`）后无需该令牌，匿名即全量，且不校验观战令牌（无效/他局令牌也按 public 全量返回，不返回 401） |
| 房主 token | `X-Host-Token: <hostToken>` | 开局、踢人、改人数、跳过回合、强制结算、添加 AI |
| 控制 token | `X-Control-Token: <token>` 或 `?token=<token>` | 删除对局、强制裁决、管理员改名、竞技场跑批 |
| 指标 token | `X-Metrics-Token: <token>` 或 `Authorization: Bearer <token>` | `GET /metrics`（仅在设置 `METRICS_TOKEN` 后启用） |

- `create` 响应同时返回 `hostToken` 与参战玩家的 `player.token`；fog 图另返回只读的 `spectatorToken`（明文只出现这一次，落盘只存哈希，非 fog 图为 `''`）；`join` 只返回玩家 token。
- 控制权限由环境变量 `AUTO_CONTROL_TOKEN` 决定。设置后所有控制请求都必须携带控制 token（常量时间比较；空白值等同未设置），经反向代理转来的请求也一样；未设置时只放行「本机直连」——socket 对端必须是回环地址（`::1`、`::ffff:127.0.0.1`、整段 `127.0.0.0/8`）**且**请求不带任何转发头（`X-Forwarded-For` / `Forwarded` / `X-Real-IP`），与 `TRUST_PROXY` 取值无关；socket 地址缺失（unix socket、已断连）按非本机处理。未配置 token 且非本机 → 401 `control_token_required`；凭证不符 → 401 `invalid_control_token`。
- `TRUST_PROXY=true` 时 `req.ip` 取自客户端可写的转发头，只影响限流分桶与 SSE 的每 IP 配额（控制鉴权不看它）；因此它只能接在你信任的反向代理后面，由代理自己写入转发头，且不要直接暴露应用端口。
- 控制权限覆盖删除对局、强制裁决、管理员改名与竞技场评估的 5 个端点（`/api/arena/eval/status`、`/start`、`/stop`、`/clear-matches`、`/api/arena/leaderboard/regenerate`）；`?token=` 形式仅用于调试，会随请求 URL 进访问日志。
- 失败响应统一为 `{ "error": "<中文说明>", "code": "<英文错误码>" }`。
- 玩法动作接口与 `host/force-resolve`、`host/skip-turn` 支持可选 `Idempotency-Key` 请求头（最长 200 字符，超长 → 400 `invalid_idempotency_key`）：同键同 body 回放首次成功响应、不重复执行（记录保留 24 小时），同键不同 body 返回 409 `idempotency_conflict`；动作按玩家、房主接口按房主分别隔离。
- 读接口支持 `If-None-Match` / `ETag`（`GET /api/games/:id`、skill、回放、RL 模型），命中返回 304。

## 地图

| 方法 | 路径 | 请求体 | 返回 |
|---|---|---|---|
| `GET` | `/api/maps` | - | `{ maps }`，含预览与点数信息 |
| `POST` | `/api/maps/random/preview` | `{ maxPlayers?, random? }` | `{ seed, preview, values }` |

- 随机地图预览按参数现场生成，`maxPlayers` 取 2–8；未传种子时服务端代抽并随响应返回 `seed`，前端回填后保证预览与实际创建一致。
- `values` 是本次各随机参数实际掷出的值，用于参数行内回显。

## 对局管理

| 方法 | 路径 | 请求体 | 返回 |
|---|---|---|---|
| `GET` | `/api/games` | - | `{ games }` |
| `POST` | `/api/games` | `{ mapId, maxPlayers, participate?, playerName? }` | `{ gameId, hostToken, spectatorToken, player: { id, token } \| null, lobby }` |
| `GET` | `/api/games/:id/lobby` | - | 公开大厅摘要，不含凭证；含座位字段 `seatMode` / `seatVersion` / `firstSeat` / `seats` / `layoutSlots`（见下） |
| `POST` | `/api/games/:id/join` | `{ name? }` | `{ player: { id, token }, lobby }` |
| `POST` | `/api/games/:id/start` | host token header | `{ ok: true, game }` |
| `GET` | `/api/games/:id` | player / spectator token header（fog 进行中可匿名；终局匿名即全量） | 按观者投影的状态，不含 token；fog 局额外带 `fog` 字段 |
| `PATCH` | `/api/games/:id/player` | `{ name }` | `{ ok: true, lobby }` |
| `PATCH` | `/api/games/:id/rename` | `{ playerId, name }` + control token | `{ ok: true }`（管理员改任意玩家名） |
| `POST` | `/api/games/:id/leave` | player token header | `{ ok: true }` |
| `DELETE` | `/api/games/:id/players/:playerId` | host token header | `{ ok: true, lobby }` |
| `PATCH` | `/api/games/:id/host/max-players` | `{ maxPlayers }` + host token header | `{ ok: true, lobby }` |
| `PUT` | `/api/games/:id/host/seats` | `{ order, firstSeat?, ifVersion? }` + host token header | `{ ok: true, seatVersion, firstSeat, lobby }`（仅 lobby 期；响应顶层不含 `seats`，最新座位表在 `lobby.seats`；`ifVersion` 失配 → `409 seat_conflict`；`simultaneous` / `royale` / `fog` 下 `firstSeat` 恒为 `0`，见下） |
| `DELETE` | `/api/games/:id/host/seats` | host token header | `{ ok: true, seatVersion, lobby }`（唯一清理编排的接口，回到开局随机） |
| `POST` | `/api/games/:id/host/skip-turn` | host token header（可选 `Idempotency-Key`） | `{ ok: true }`（仅顺序模式；同一轮不能重复跳同一玩家，见下） |
| `POST` | `/api/games/:id/host/eliminate` | `{ playerId }` + host token header | `{ ok: true }` |
| `POST` | `/api/games/:id/force-adjudicate` | control token | `{ ok: true, result }` |
| `DELETE` | `/api/games/:id` | control token | `{ ok: true }` |

- 强制裁决仅适用于进行中的对局，按请求时存活玩家的裁决总分决定胜者；最高分并列则平局。
- 删除对局会同时删除内存状态和持久化文件中的记录。
- 活跃大厅数受 `TACTICAL_GAME_MAX_LOBBIES` 限制（默认 200，设为非正整数时进程启动即报错）：达到上限后建房返回 503 `lobby_capacity`（文案「大厅数量已达上限（<上限>），请等空闲大厅过期后再建房」）并计入 `tactical_lobby_capacity_rejected_total`，用到 80% 起写 warning。
- 保留期：无活动的大厅默认 2 小时（部署用的 `compose.yml` 未显式设置时传 24 小时）、终局对局默认 3 天后归档到 `runtime/archive/`，进行中的对局永不按 TTL 回收；用 `TACTICAL_GAME_LOBBY_TTL_HOURS` / `TACTICAL_GAME_OVER_TTL_HOURS` 覆盖（`0` 关闭对应清理，非法或负数回落默认值并告警）。
- 落盘：每次改动同步原子写 `runtime/store/<gameId>.json`，响应返回时该局快照已在盘上；`runtime/games.json` 是导出与旧版兼容格式，去抖合并写（trailing 250ms、最长 2s 必写），删除对局、归档与进程退出时强制 flush。部署侧取值见 [deploy/DEPLOYMENT.md](../deploy/DEPLOYMENT.md)。
- `host/skip-turn` 只在顺序模式有意义（同时回合骨架的 simultaneous / royale / fog 都没有当前行动玩家，调用返回 409 `game_not_started`，文案「对局不在进行中」）；同一轮内不能重复跳过同一玩家，重复调用返回 409 `round_already_resolved`（文案「本轮已经跳过该玩家，不能重复跳过」）。
- 座位编排（3.8.8）：大厅期房主用 `PUT /api/games/:id/host/seats` 编排座位，`DELETE` 取消编排、回到开局随机。`order` 必须是**当前已加入玩家的一次排列**（长度不符 / 重复 / 含未加入玩家 / 缺人，任一即 `400 invalid_seat_layout`）；房间内还没有玩家时无座位可编排，同样 `400 invalid_seat_layout`（文案「当前没有已加入玩家，无法编排座位」）；`ifVersion` 必须是整数，与当前 `seatVersion` 不等时 → `409 seat_conflict`，响应体带最新 `seatVersion` 与完整 `lobby`，前端可直接重绘、不必重放请求。开局后调用一律 `409 game_already_started`。
- `firstSeat` **按模式区分**：仅顺序模式（`standard` / `annihilation`）有意义，是 0 起的先手座位下标、缺省 0，`turnOrder` 从该座位循环展开；越界（`<0` 或 `>=已加入人数`）→ `400 invalid_seat_layout`（错误文案「先手座位号越界」只会在顺序模式出现）。`simultaneous` / `royale` / `fog` **没有先手概念**（`turnOrder` 只是同一步内的并列处理顺序），服务端忽略该字段、一律存 `0` 并在响应里回 `0`，不报错也不做越界校验；`GET /api/games/:id/lobby` 的 `firstSeat` 在这三个模式下同样恒为 `0`。
- 大厅摘要的座位字段：`seatMode`（`'random'` / `'manual'`）、`seatVersion`、`firstSeat`（0 起；`random` 态恒 0，`simultaneous` / `royale` / `fog` 也恒 0）、`seats[]`（`{ seat, playerId, name, spawnSlotId }`，`seat` 从 1 起、按座位号升序）。`seatMode='random'`（未编排）时出生点（以及顺序模式下的先手）**都还没决定**，`seats[].spawnSlotId` **恒为 `null`**，`seats` 只按加入顺序给座位号；`seatMode='manual'` 时才把 `spawnSlotId` 映射成 `config.layouts[人数][座位下标]`，该人数没有 `layouts` 条目时仍为 `null`。席位 id（`player_a`…）恒按加入顺序分配且不可变，座位号只决定「谁坐哪个出生点」；行动顺位只存在于顺序模式，同时回合骨架（simultaneous / royale / fog）里座位号只是同一步内的结算处理顺序。
- `layoutSlots` 是「本局人数对应的出生点槽位 id 顺序」（即 `config.layouts[已加入人数]`）：与 `seatMode` 无关、**恒给值**，0 人或该人数没有 `layouts` 条目时为 `[]`；`seatMode='manual'` 时 `seats[i].spawnSlotId` 恒等于 `layoutSlots[i]`。关键约束：**槽位 id 是地图 `spawnSlots` 的非连续子序列，不是前 n 个**（例：`multiplayer-ring` 三人局是 `['slot_1','slot_3','slot_5']`，对应 `spawnSlots` 下标 0/2/4），前端做座位→出生点的映射必须按 `slot.id` 匹配，**不能按数组下标**。
- 两套版本线是**独立计数**，但别理解成「成员变动不影响 `stateVersion`」：`PUT` / `DELETE /host/seats` 自身同时推进 `seatVersion` 与 `stateVersion`；成员变动（加入 / 退出 / 被踢）使 `seatVersion` +1，其 `stateVersion` 由 `player_joined` / `player_left` 事件推进（写入事件本身就会推进 `stateVersion`）；开局降级只推进 `seatVersion`，`stateVersion` 随后由 `game_start` 事件推进。因此 join / leave 之后带旧 `If-None-Match` 请求 `GET /api/games/:id` **不会** 304，而是 200 返回含新玩家与最新座位表的状态。fog 局例外：大厅期 `stateVersion` 仍是全局变更计数（大厅没有隐藏单位；`host/max-players`、`host/seats` 不发事件却改状态，全用观者序号会让条件 GET 错误 304）；对局开始后玩家与 `public` 视角改用该观者的观者序号（见「迷雾模式（fog）的观者投影」）。fog 大厅的座位变更请以 `seatVersion` 与 `GET /api/games/:id/lobby` 为准。
- 座位字段的**结构化形态**（`seatMode` / `seatVersion` / `firstSeat` / `seats` / `layoutSlots`）只由 `GET /api/games/:id/lobby` 提供；状态接口里虽有 `seatPlan` 原始字段，但房间页的座位区一律读 `/lobby`，不要从状态接口自己拼座位列表。
- `seatVersion` 的语义是「座位视图可能已变」：`PUT` 成功、`DELETE` 成功、成员进出（`seatPlan` 为空时也一样）都 `+1`。`DELETE` 在本来就未编排时也 `+1`——幂等只承诺最终状态不变，不承诺版本号不变。
- 随机地图建房只有一种写法：`POST /api/games` 用 `mapId: "random"`，玩法模式放在 `random.mode`（`standard` / `annihilation` / `simultaneous` / `royale`）。fog **不支持随机地图**：`random.mode: "fog"` 返回 400 并提示改用内置 fog 图（本期不生成随机迷雾图）。评估控制台的 `random-annihilation` / `random-simultaneous` / `random-royale` 是**跑批批次 id**（批次要靠地图 id 推模式、`matches.jsonl` 靠它归模式），不是可建房地图；传给建房接口返回 `400 invalid_move` 并提示改用 `mapId: "random"` + `random.mode`。
- `GET /api/games` 的每一项带 `gameId`、`mapId`、`mapName`（随机地图为「随机战场」）、`hostName`、`createdAt` 与 `phase` / `mode` / `maxPlayers` / `playerCount` / `players` 等字段。

## 操作

| 方法 | 路径 | 请求体 |
|---|---|---|
| `POST` | `/api/games/:id/deploy` | `{ unitType, fromId, q, r }` |
| `POST` | `/api/games/:id/move` | `{ unitId, q, r }` |
| `POST` | `/api/games/:id/attack` | 顺序模式 `{ attackerId, targetId }`；同时回合骨架（simultaneous / royale / fog）`{ attackerId, q, r }`（指定格子；fog 下对视野外格子即盲射） |
| `POST` | `/api/games/:id/heal` | 顺序模式 `{ supportId, targetId }`；同时回合骨架 `{ supportId, q, r }`（按 `healShape` 区域治疗） |
| `POST` | `/api/games/:id/demolish` | `{ unitId, q, r }` |
| `POST` | `/api/games/:id/end-turn` | `{}`（同时回合骨架 = 确认锁定计划；全员确认即触发结算） |
| `POST` | `/api/games/:id/plan/wait` | 无（同时回合骨架专用，追加一条待命，消耗 1 行动点） |
| `POST` | `/api/games/:id/plan/reorder` | `{ actionIds }`（同时回合骨架专用，原子重排队列；必须是当前队列的一个排列） |
| `POST` | `/api/games/:id/plan/revoke` | `{ actionId }`（同时回合骨架专用，撤回一条排队指令） |
| `POST` | `/api/games/:id/plan/clear` | 无（同时回合骨架专用，清空自己的计划） |
| `POST` | `/api/games/:id/host/force-resolve` | host token header；可选 `{ "repeat": true }`（同时回合骨架专用；可选 `Idempotency-Key`） |

- 部署/移动/攻击/治疗/爆破/结束回合、计划撤回/清空/重排均支持 `Idempotency-Key`。
- `host/force-resolve` 是同时回合骨架专用（simultaneous / royale / fog；其它模式 400 `not_simultaneous_game`），响应 `{ ok, resolved, roundNumber, repeated, phase }`。同一轮已结算、之后又没有新输入（入队 / 提交）时返回 409 `round_already_resolved`（文案「本轮已经结算，等待下一次行动提交后再结算」）；房主可带 `{ "repeat": true }` 显式跳过这一次守卫（响应 `repeated: true`，计入 `tactical_round_force_repeat_total` 并写 warning），用于人工解锁推不动的存量对局。该参数只作用于本次请求（不带它仍然 409），房主可连续调用多次、每次推进一轮，服务端不设次数上限。
- 服务端不提供旧版 `/build`、`/produce`、`/sell` 接口。

## 状态、等待与事件

### 读取状态

`GET /api/games/:id` 通常需要玩家 token；fog 局额外接受观战 token 或匿名访问（进行中匿名是 public 安全视角，`game_over` 后匿名即全量；见下节）。支持 `include=state,events,config,adjudication` 投影与 `If-None-Match`（304）。

### 迷雾模式（fog）的观者投影

观者优先级：合法 `X-Player-Token`（或 `?token=`） > 合法 `X-Spectator-Token`（或 `?spectatorToken=`） > `public`；同时提供时以玩家为准。观战 token 只读，不能进入任何写接口。**fog 局 `phase === "game_over"` 时匿名即全量**：无需观战令牌，返回与观战同权的全量状态和原始事件流（见下方终局说明）。**终局不校验观战令牌**：携带无效或他局观战令牌也按 public 全量处理，不返回 `401 invalid_spectator_token`。进行中：无效观战 token → `401 { error, code: 'invalid_spectator_token' }`；fog 局无任何 token → `public` 安全视角（**不是** 401）。

下表是**进行中**（`phase !== "game_over"`）的投影。`phase === "game_over"` 时 public 与 spectator 同权：`units` / `fog` / `adjudication` / `result` / `players[].stats` / `lastActivityAt` / `players[].adjudicationScore` / `eliminatedBy` 按 spectator 列返回，`events` 为原始全量，`seq` / `lastEventSeq` / `stateVersion` 为全局值，无需观战令牌，也不校验观战令牌（无效/他局令牌也按 public 全量返回）。玩家视角在 `revealFromRound` 到达或 `game_over` 时 `units` 为全量、`fog.revealed` 为 `true`（`lastSeen` 为空），但事件与裁决仍按本人投影。

| 字段 | player | spectator | public |
|---|---|---|---|
| `units` | 本人全部单位 + 视野内敌军；`revealFromRound` 到达后全量 | 全量 | `[]` |
| `fog` | `{ enabled: true, revealed, visibleCells, lastSeen }`（`lastSeen` 只含本人记忆） | `{ enabled: true, revealed: true, visibleCells: 全部可用格, lastSeen: [] }` | `{ enabled: true, revealed: false, visibleCells: [], lastSeen: [] }` |
| `events` | 逐条按**发生时刻固化**的披露投影；`seq` 为观者序号 | 全量；全局 `seq` | 公开事件；`seq` 为 public 观者序号 |
| `adjudication` | 本人完整；他人 `{ playerId, total, rank, hidden: true }` | 全量 | `{ hidden: true }` 整体或省略分项 |
| `result` | 终局后按裁决投影：本人分数完整；他人只有 `{ total, hidden: true }`（`rankings` 保留 `playerId` / `rank` / 状态，仅得分被投影） | 全量 | 所有人只有 `{ total }` 与排名，无分项 |
| `players[].stats` | 只保留本人的；其他玩家整块删除 | 全量 | 全部删除 |
| `stateVersion` | 大厅期全局值；开局后为观者序号（只对可见事件递增） | 全局值 | 大厅期全局值；开局后为 public 观者序号 |
| `lastEventSeq` | 观者序号（只对可见事件递增） | 全局值 | public 观者序号 |
| `lastActivityAt` | 删除（会随隐藏动作变化） | 保留 | 删除 |
| `headquarters` / `controlPoints` / `cells` / `map` / `config` / `turn` / `players` / `resources` / `winner` | 公开（不变）；`players[other].adjudicationScore` 删除；`players[other].eliminatedBy` 只保留给击杀者 | 公开 | 公开（全部 `players[*].adjudicationScore` 与 `eliminatedBy` 删除） |
| `plan` | 只看自己队列 + 公开的 `committed` | 空队列 + `committed` | 空队列 + `committed` |

- 敌方隐藏单位不得经任何字段（`units`、`fog.lastSeen`、事件 payload、`adjudication`、`result`、`players[].stats`）泄露 `unitId` / `type` / `hp` / `q` / `r`。
- **事件披露在发生时刻固化（进行中）**：fog 局写入事件时，按当时视野为每个座位与 `public` 计算披露并随事件持久化；进行中的玩家与公开视角的状态读取、事件补拉、SSE 都只回放该观者的固化结果，不按当前视野重算。观战视角始终是全量事件（仅剥离内部固化表），不代表任一玩家当时的视角。揭雾（`revealFromRound` 到达）之后**新产生**的事件对全体全量，**不回填历史**：已固化的玩家/公开披露保持当时结果。只有不含固化数据的旧事件（4.0.0 及更早写入的 `runtime/store/*.json`）在读取时回落到按当前状态投影；带固化表但缺少该观者条目的事件按隐藏处理，不借当前视野补算。该回落只为兼容旧局，不代表新口径。**`phase === "game_over"` 是终局公开，不是回填**：public/匿名读取改回原始全量事件（含完整 `game_start` 与进行中隐藏的动作，全局 `seq`），不重写任何观者的固化表；玩家本人的历史仍按固化结果回放。`revealFromRound` 的揭雾期（对局未结束）不会解冻 public 的历史固化披露，也不取消令牌要求；它只让之后新产生的事件按揭雾规则披露。
- 固化数据是服务端内部状态（`event.fogViews` / `event.fogSeqs`），只随对局持久化，不出现在状态响应、事件响应、SSE 帧或导出的回放中。
- `adjudication` / `result` 里缺失或标为 `hidden: true` 的分项表示**隐藏**，不是 0 分：进行中的 `public` 视角缺少隐藏单位等重建分项所需的输入，客户端不得用观战/回放里的完整统计或残缺事件补算后当成完整分项；`game_over` 后 public 与观战一致，是完整分项。
- **非本人 `players[].stats` 整块删除**：伤害、击杀、占点、行动点等聚合计数会旁路隐藏行动（未见的交火、占领与治疗都能从计数变化推断），因此 fog 玩家视角只保留自己的 `stats`，其他玩家整个键删除；进行中的 `public` 视角全部删除；`game_over` 后 public 与观战一致保留全量。缺失表示**不可见**，不是 0，也不得用计数反推隐藏单位或隐藏行动。
- 非 fog 模式响应字节不变（状态读取仍需玩家 token；事件补拉保持原有的匿名行为）。
- **fog 的游标进行中是观者序号（`stateVersion` 大厅期除外）**：fog 对局开始后，玩家与 `public` 的 `seq`、`lastEventSeq`、`wait` 的 `afterSeq` / `seq`、SSE `id` 与 `Last-Event-ID`、`stateVersion` 以及 ETag 的版本段，统一使用该观者的连续序号（只对**该观者可见**的事件递增，从 1 起；没有可见事件时为 0）。大厅期没有隐藏单位，`stateVersion` 与 ETag 版本段仍用全局变更计数（`host/max-players`、`host/seats` 不发事件也改状态，用观者序号会让条件 GET 错误 304）。观战视角与非 fog 局沿用全局序号。**`phase === "game_over"` 后 public 改用全局序号**：`seq`、`lastEventSeq`、SSE `id` / `Last-Event-ID`、`stateVersion` 与 ETag 版本段都回到全局值（与观战一致）；玩家视角仍用自己的观者序号。不得把观者序号当全局进度，也不得用两个观者的序号差或 `lastEventSeq` 跳变推断隐藏事件的数量与时机。
- fog 局 ETag 为 `"<id>-<stateVersion>-<planQueueTag>-<includeKey>-<viewerTag>"`（`viewerTag ∈ player:<id> | spectator | anon`），版本段按上一条规则取值（大厅期全局，开局后观者序号，`game_over` 后 public 全局），并带 `Vary: X-Player-Token, X-Spectator-Token`；304 不得跨观者复用。非 fog 局 ETag 与 `stateVersion` 的旧语义不变。

### 长轮询等待

`GET /api/games/:id/wait?afterSeq=<seq>&timeout=<seconds>` 需要玩家 token：

- 有新事件立即返回 `{ changed: true, seq }`，超时返回 `{ changed: false, seq }`。
- `timeout` 默认且最多 25 秒；同一玩家并发等待上限 2 个，超出返回 429 `rate_limit`。
- fog 局的 `afterSeq` 与返回的 `seq` 都是该玩家的**观者序号**：只有该玩家可见的事件才推进它，隐藏事件不会让 `wait` 提前返回（即使全局事件流已经前进）。别用两次 `wait` 的 `seq` 差值估算对手行动数。

### 事件流

`GET /api/games/:id/events?after=<seq>` 返回增量事件；`Accept: text/event-stream` 时建立 SSE（`id:` 为观者序号），断线可用 `Last-Event-ID` 续传。**进行中**的 fog 局，玩家与匿名视角的 `after` / `Last-Event-ID` / 返回事件的 `seq` / SSE `id:` 都是观者序号：服务端先按观者序号过滤，再按发生时刻固化的披露投影；观战视角沿用全局序号。SSE 与非 SSE 使用同一套观者解析与投影，握手时解析观者、逐事件投影，匿名连接只收公开事件，初始补发的历史帧同样投影且不因后续揭雾重算。**`phase === "game_over"` 后**，匿名视角改用全局序号并收到原始全量事件（含完整 `game_start`）；玩家连接仍按观者序号与固化投影。所以“无令牌拿全量”只发生在终局公开，进行中没有该旁路。

事件类型：

`player_joined`, `player_left`, `game_start`, `deploy`, `move`, `attack`, `heal`, `unit_death`, `demolish`, `control_point_captured`, `control_point_neutralized`, `control_point_repair`, `income`, `comeback_supply`, `artillery_warning`, `artillery_shrunk`, `artillery_damage`, `reset_actions`, `turn_skipped`, `turn_end`, `round_end`, `round_start`, `round_resolved`, `plan_committed`, `wait`, `action_failed`, `headquarters_destroyed`, `player_eliminated`, `game_over`, `name_rename`, `bot_failed`

- `game_start` 包含完整玩家列表、出生分配、行动顺序、地图、据点、总部、单位、资源和数值配置，观战页可只靠事件流重放。fog 局**进行中**按观者投影：玩家视角保留全量字段，仅 `units` 裁成本人单位与视野内敌军；观战/回放是全量；**匿名（public）视角只带 `roundNumber`、`mapId`、`mode` 与公开地图几何 `map`**（`id` / `name` / `description` / `mode` / `grid` / `orientation` / `radius` / `terrainCells` / `cells`；这是开局地形，匿名状态的 `map` / `cells` 则是当前地形），不含 `units` / `headquarters` / `players` / `resources` / `controlPoints`，也不含任何单位或总部 id；状态响应的 `events`、`/events` 补拉与 SSE 帧同口径。进行中 public 的固化载荷同样不回填：已固化事件若其 `public` 条目只有 `roundNumber`，升级后仍无地图，旧局请读匿名状态的 `map` / `cells`（4.0.0 及更早没有固化表，回落投影会带上地图）。**`phase === "game_over"` 后**，public 的 `game_start` 与全部历史事件改为原始全量（完整玩家 / 总部 / 单位 / 资源 / 据点 / `config`，全局 `seq`），不再使用 public 固化载荷；玩家视角仍按自己的固化结果。**fog 局的 `payload.config` 必带 `fog`**（与 `game.config.fog` 同值，含 `vision` 与 `revealFromRound`），回放与规则速查以它为视野/揭雾的权威来源；非 fog 局不追加该键，键集保持不变。
- `game_over` 的 `reason` 为 `last_player_standing`、`mutual_annihilation`、`turn_limit_score`、`turn_limit_draw`、`forced_adjudication_score` 或 `forced_adjudication_draw`。新生成的事件流中 `game_over` 是最后一条，最终回合的 `round_end` / `round_resolved` 必定先于它；既有归档回放仍可能保留 3.7.1 之前的旧顺序（`game_over` 后还有终局 `round_resolved`），读取旧回放时不要只按 `game_over` 截断。
- `income` 保留总额字段，并在类型化据点地图中提供 `breakdown` 明细：`pointId`、`name`、`kind`、`amount`。顺序局里非先手座位第一回合的贴目是一条 `base = amount`、`control = 0`、`breakdown = []` 且带 `komi: true` 的 `income` 事件（金额见 [MAP_FORMAT.md](MAP_FORMAT.md)「先手贴目」）。
- `deploy` 中 `cost` 表示实际消耗，`unitCost` 表示单位基础费用，`discount` 表示部署源折扣。
- `control_point_repair` 包含修复据点、单位、修复量和修复后的 `unitHp`，用于回放同步血量。
- `demolish` 包含爆破单位、坐标、原地形、目标地形和行动点信息，回放端用它同步地形变化。
- 同时回合模式有以下专用事件：`plan_committed`（只含 playerId，不泄露计划内容）、`round_resolved`（含每条指令的 `executed/failed/missed/fizzled`）、`round_start`、`action_failed`（冲突落空等未执行的指令及原因）。同时模式的 `attack` 事件带 `q/r/hit`，`hit: false` 表示预测射击落空。
- fog 局的逐事件披露（全部以**事件发生时刻**的视野判定并固化）：
  - **区域攻击**（`line` / `arc`）对第三方逐命中格披露：`hit: true` 且命中格 `(q, r)` 在该时刻对观者可见才保留该条；命中格不可见则整条丢弃，不保留 `q/r`、`damage`、`actualDamage`、`targetHp`。第三方永远收不到 `hit: false`——落空（含锁定游侠的落空）只发给攻击者本人。第三方可见的命中若攻击者不可见，删除 `attackerId` / `owner` / `aimQ` / `aimR` / `shape`，保留命中格、`hit`、伤害/血量与当时可见的目标身份（`targetId` / `targetKind`）；目标也不可见时才删除目标身份。被命中单位的 owner 与总部 owner 按现有 1 轮交火快照规则收到整条。
  - **区域治疗**（`heal`）对第三方逐目标披露：目标在该时刻可见才保留该条（`targetId` / `amount` / `targetHp`），目标不可见则整条丢弃。可见目标但施法者不可见时，再删除 `supportId` / `owner` / `q` / `r`。施法者本人收到全量。
  - **淘汰**：`player_eliminated.payload.eliminatedBy` 只发给被淘汰者本人与击杀者本人，其他玩家与 `public` 删除该键（固化时决定，不随后续视野变化）；`removedUnitIds` 与 `score` 保持原有观者规则。
  - **结算**：`round_resolved` 只保留本人结果，`steps` 等于本人结果条数（`payload.results` 只含本人那一项），不做“可见第三方结果”——避免部分揭示泄露隐藏单位信息。隐藏行动整条丢弃，可部分观察的行动删除敏感键而不是置 `null`；拿不准时丢弃整条，不做部分揭示。
- `action_failed` 只发给行动者本人（失败原因可能间接暴露隐藏单位的位置或存在）。
- `wait` 是同时回合待命动作的结算事件，payload 含 `owner`、`actionId`、`roundNumber`、`step`、`actionsUsed`、`actionsRemaining`。
- `bot_failed` 表示 bot 进程异常，payload 含 `playerId`、`bot`（`rl` / `algorithm`）、`reason`、`restarts`。

## AI 机器人

| 方法 | 路径 | 请求体 | 说明 |
|---|---|---|---|
| `GET` | `/api/rl/models` | - | `{ models, python, runner, requiredActionSpace, supportedActionSpaces }`，带 ETag |
| `GET` | `/api/algorithms` | - | `{ algorithms: [{ id, name, algorithm, description, modes }] }` |
| `POST` | `/api/games/:id/bots` | `{ name?, model }` + host token | 加入 RL 模型 bot，返回 `{ ok, bot, lobby }` |
| `POST` | `/api/games/:id/bots/algorithm` | `{ botType?, name? }` + host token | 加入内置算法 bot，返回 `{ ok, bot, lobby }` |

- 两个 `bots` 接口只在大厅阶段可用，对局开始后返回 409 `game_already_started`。
- RL 模型 bot 仅支持双人顺序对局，模型必须存在于本地 `rl/models/` 且动作空间可识别。
- 算法 bot 的 `botType` 取 `/api/algorithms` 的 `id`，并按注册表 `modes` 与当前对局模式校验。fog 局只接受注册表声明 `modes` 含 `fog` 的算法（首批 `fog-scout`）；RL 模型与其他算法不能加入 fog 局。

## 回放记录

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/records` | `{ records, total }`，只索引 `records/V2`、`records/V3` |
| `GET` | `/api/records/*` | 按 id（如 `V3/tg_0036_20260721.json`）返回回放原文，带 ETag/304 |

- 列表项含 `id`、`version`、`fileName`、`seq`、`gameId`、`mapId`、`mode`、`players`、`winner`、`winnerName`、`reason`、`eventCount`、`date`、`exportedAt`、`bytes`、`sha256`。
- 文件缺失或不在白名单时返回 404 `record_not_found`；索引不可用返回 503 `records_unavailable`。

## 竞技场评估

评估控制台用网页启动 `rl/evaluation/round_robin.py` 跑批。跑批链路属于本地开发功能，镜像缺失时写接口统一返回 501 `arena_eval_unavailable`。除 `participants` 外均需要控制权限。

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/arena/participants` | `{ models, algorithms }`，每条含 `modes` 与 `playerCounts` 的完整参评者清单，由客户端按模式与参赛人数过滤（RL 模型的 `playerCounts` 恒为 `[2]`） |
| `GET` | `/api/arena/eval/status` | 当前跑批状态快照（含命令行、路径、输出尾与维护任务 `auxTask`） |
| `POST` | `/api/arena/eval/start` | 启动跑批，返回 `{ ok, status }` |
| `POST` | `/api/arena/eval/stop` | 停止当前跑批，返回 `{ ok: true }` |
| `POST` | `/api/arena/eval/clear-matches` | 按 `{ mode?, map?, participant?, dryRun? }` 清理 `arena/matches.jsonl` 中的命中对局；`dryRun` 同步返回计数，真删为后台任务并立即返回 `{ ok, auxTask }` |
| `POST` | `/api/arena/leaderboard/regenerate` | 后台重算榜单（榜单脚本 → 玩法统计脚本两步，单次上限 300 秒，超时终止），立即返回 `{ ok, auxTask }` |

`/api/arena/eval/start` 的 body 字段：

| 字段 | 约束 |
|---|---|
| `maps` | 已知地图的非空子集；同一批只能属于同一模式。随机图按模式拆成四个虚拟 id：`random`（标准）、`random-annihilation`、`random-simultaneous`、`random-royale` |
| `playerCount` | 参赛人数，`2`（默认）或 `3`。竞技场三人批支持标准、歼灭、同时回合与大逃杀模式（**不含 fog**），只收注册表同时声明该模式且 `playerCounts` 含 3 的算法（现有 RL 模型是单对手观测编码，不参评），至少 3 个不同算法且不能重复占座，`games` 必须是 6 的倍数 |
| `games` | 2–500，默认 24 |
| `jobs` | 1–16，默认 1 |
| `participants` | 可选过滤，最多 32 项；算法用 `algo:<id>`，RL 模型仅支持标准模式 |
| `salt` | 可选，最长 64 字符 |
| `dryRun` | 试运行，不写入战报 |

- 竞技场的四种模式均已接入跑批：`standard` / `annihilation` 逐动作执行，`simultaneous` / `royale` 计划入队后统一结算。**fog 本期不接入竞技场**：没有 fog 分榜，fog 图设 `modelEval: false`，评估入口不把 fog 列入可选模式。
- **三人跑批（`playerCount: 3`）**：对局带 `playerCount: 3` 与按模式取的 `rulesVersion`（`standard-3p-v1` / `annihilation-3p-v1` / `simultaneous-3p-v1` / `royale-3p-v1`）写入同一份 `arena/matches.jsonl`（模式仍由地图的 `mode` 解析，与双人记录一致），榜单按 `mode × rulesVersion` 另建并列感知 Plackett-Luce 池，与双人 Bradley-Terry 完全分离。计分单元是「六局双向 superblock」（三人阵容 × 地图 × 3 个座位轮换 × 正反方向），只有跑满六局的块进入评分，未跑完的块只计为残块、不进 bootstrap。
- **三人校验**：`playerCount` 非 2/3 → 400 `invalid_player_count`；三人搭配标准/歼灭/同时回合/大逃杀以外的模式 → 400 `mode_not_supported`；地图没有三人布局 → 400 `invalid_maps`；`games` 不是 6 的倍数 → 400 `invalid_games`；`participants` 含 RL 模型 → 400 `mode_not_supported`，含未声明该模式三人支持的算法 → 400 `invalid_participants`；该模式可选算法不足 3 个或同一算法重复占座 → 400 `invalid_participants`。大逃杀只有 `snowflake` 与虚拟图 `random-royale` 提供三人布局。
- `GET /api/arena/eval/status` 快照的 `defaults.playerCounts` 为 `[2, 3]`，每个地图条目带自己的 `playerCounts`（缺省 `[2]`，没有 `layouts` 且没有 `supportedPlayerCounts` 的地图即双人图；随机图报 `2–8`）。
- `jobs` 每个任务是一个独立的 `evaluate_cross.py` 进程（再各自 spawn 一个 node 引擎，模型批还有 torch 推理），不是线程；上限 16 只是产品保护，实际吞吐受物理核数与内存约束，`round_robin.py` 自身建议 ≤ 物理核数−2。实测单任务峰值内存：纯算法批 ~0.3 GB、带模型批 ~1.4 GB（python 端 torch 约 1.1 GB + node 引擎约 0.3 GB），16 路全模型批会超过 16 GB 机器的物理内存。
- 非标准模式没有 RL 模型参评，`participants` 至少需要 2 个该模式算法；不足时返回 400 `invalid_participants`。可用算法以 `GET /api/arena/participants` 返回条目的 `modes` 为准，名称与定位见 [算法 AI](AI_PLAYERS.md#3-算法-ai)。
- 已有跑批进行中时 `start` / `clear-matches` 返回 409 `eval_already_running`。
- 清空旧局的 `participant` 按对局记录里的参与者 id 匹配任一座位：模型为 zip 文件名（精确），算法为 `algo_<name>@<version>`；只传不带版本的 `algo_<name>`（控制台算法下拉即此形式）时匹配该算法的全部版本，升版后旧版本 id 上的历史对局也能一并清理。带版本的 id 仍精确匹配。
- **维护任务 `auxTask`**：`status` 快照新增 `auxTask`（跑批之外的重算榜单 / 清空旧局），字段为 `{ kind: 'regen'|'clear', label, status: 'running'|'finished'|'failed', step, steps, stepLabel, startedAt, finishedAt, outputTail, detail, error }`；`step/steps` 是步骤进度（重算 2 步：榜单 → 玩法统计；清空 3 步：扫描 → 重写 → 完成），`outputTail` 是子脚本 stdout/stderr 的最近 40 行，`detail` 在清空完成时带 `{ removed, total }`。任务只存进程内，重启后丢失。
- 维护任务之间互斥：已有任务运行时再调 `clear-matches`（非 dryRun）或 `leaderboard/regenerate` 返回 409 `aux_task_running` 并附当前 `auxTask`；重算失败不再返回 500，而是任务收尾为 `status: 'failed'` 并带 `error`（控制台展示在日志区）。
- 控制台轮询策略：跑批或维护任务运行时 1s 一次，空闲 3s 一次（前端实现，接口无差别）。

## 运维与 Agent

以下接口除长轮询外均不需要玩家凭证（长轮询需要 `X-Player-Token`）：

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/skill` | 返回 `SKILL.md` 全文，是 agent 的最短引导入口；带 `ETag`，`If-None-Match` 命中返回 304 |
| `GET` | `/api/skill/manifest` | `{ appVersion, files: [{ name, bytes, sha256 }] }`，用于校验本地 skill 副本是否过期 |
| `GET` | `/api/skill/files/:name` | 按文件名下发 skill（`SKILL.md`、`standard.md`、`simultaneous.md`、`review.md` 等；白名单校验，支持 ETag/304） |
| `GET` | `/api/games/:id/wait?afterSeq=<seq>&timeout=<seconds>` | 长轮询：有新事件立即返回 `{ changed: true, seq }`，超时返回 `{ changed: false, seq }`；`timeout` 默认且最多 25 秒，同一玩家并发 2 个，超出返回 429 |
| `GET` | `/healthz` | 进程存活：`{ status: "ok" }` |
| `GET` | `/readyz` | 就绪：正常 `{ status: "ready" }`；启动中返回 503 `{ status: "starting" }`，地图或持久化异常返回 503 `{ status: "degraded", checks }` |
| `GET` | `/metrics` | Prometheus 文本指标；设置 `METRICS_TOKEN` 后需 `X-Metrics-Token` 或 `Authorization: Bearer <token>` |
