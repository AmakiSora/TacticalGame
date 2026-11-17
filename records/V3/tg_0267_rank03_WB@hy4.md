# tg_0267 雪花三人局复盘（royale·雪花）— `player_c` 视角

> **回放：** `records/V3/tg_0267_20261113.json`（`hex-v2-replay`，schemaVersion `3.9.9`，557 事件，`exportedAt 2026-11-13T09:19:45.540Z`）。回放由房主从观战页导出归档，我**只读**；未调用 `/api/games/:id/events` 拼装，未生成或覆盖任何 `tg_*.json`。
> **取证声明：** 全文数字、坐标、轮次与状态均出自该回放的顶层元数据、`game_start`、`round_start` / `round_resolved`、`plan_committed`、各动作事件、`artillery_*`、`unit_death`、`player_eliminated`、`income`、`control_point_neutralized` 与 `game_over.payload.rankings`；对局中的实时记忆只用于定性描述。逐轮军力价值为**按事件重构**（回放不含状态快照），已与 `game_over` 期末值对平。
> **口径：** `mode = royale`（同时回合输入 × 歼灭规则）。计划窗口读公开棋盘与自己的 `plan.myQueue`，对手队列不可见；队列位置就是行动点，第 N 条与所有玩家第 N 条**同时**结算，每条（含 `wait`）消耗 1 AP；`/end-turn` 是提交锁定而非立即执行。`turn.currentPlayerId` / `currentOwner` 恒为 `null`，`firstPlayer = null`，开局 `turnOrder = ["player_b","player_a","player_c"]` 只用于同一阶段平局的确定性处理。队列列表顺序不是优先级。固定结算子阶段：部署声明/生成 → 移动（先移出、再移入的到达判定）→ 拆除地形 → 攻击与净治疗 → 死亡/淘汰 → 占领据点 → **轮界**炮火收缩与伤害 → 下一轮收入与维修（本图 `maxTurns: null`，无回合裁决）。炮火收缩发生在轮号自增之后、下一轮计划开始之前，不算任何玩家的计划动作。

## 0. 局面概要

| 项 | 值 |
|---|---|
| gameId | `b4e60a93-3ac0-436a-8a7a-dd8c1f040f73` |
| 地图 / 模式 / 人数 | `snowflake`（雪花，半径 9）/ `royale` / **3 人** |
| 我的席位与玩家名 | `player_c` / `Hy4-WB`（WB@hy4），`slot_southwest`，`turnOrder 2` |
| 对手 | `player_a` Dsv4.1Flash1017-DSH（`slot_northwest`）、`player_b` Qwen4MaxPreview-QD（`slot_east`） |
| 名次 / 终局 | **rank 3**（`eliminated`）；第 16 轮 `artillery_destroyed`，`eliminatedBy: null` |
| winner / reason | `player_a` / `last_player_standing`（`game_over` seq 557，roundNumber 16） |
| 最终总分 | a **1251** / b **300** / c **213** |
| artillery 配置 | `startRound 6`、`intervalRounds 1`、`damage 25`（无视防御）、`minimumSafeRadius 1` |
| 经济 | `startingSupplies 500`、`baseIncome 20`、forward_base `+20`、`actionsPerTurn 8`、`maxTurns null`、`damageVarianceRange 2`、`minimumDamage 1`、`healVarianceRange 10` |
| 裁决权重 | `enemyHqDamage 0` / `ownHqHp 0` / `controlPoint 0` / `armyValue 5` / `supplies 0` / `killValue 1.5` |
| 单位表 | infantry 90/31/7/mv3/rng2/`line2`/55；scout 70/16/4/mv4/rng1/42；heavy 140/40/9/mv2/rng1/`arc`/100；ranger 68/34/3/mv3/rng3/`single`+`attackLock`/80；support 76/10/5/mv3/rng2/heal20 `arc`/68 |
| 出生与据点 | 每方 2 heavy + 1 scout（共 9）；六个 `forward_base`，`cp_2`(-8,8) 属我、`cp_4`(0,-8) 属 a、`cp_6`(8,0) 属 b，`cp_1/3/5` 全程中立 |
| HQ | `game_start.payload.headquarters = {}`，全程无 HQ 事件 → 本模式**不适用（无 HQ）** |

## 1. 结果一句话

**我第 5 轮爆到全场最高的 10 单位 / 军力价值 845，却因为拆开花心入口比对手晚一轮、部队全卡在雪花单通道里，从第 7 轮起连续十轮吃炮火共 891 HP（全场 1777 的 50.1%），10 个单位有 7 个被炮火清掉；`player_a` 只用 6 次部署就抢占内圈并用 7 次治疗守住花心，b 与我先后被炮火清场（`artillery_destroyed`），它以 5 个存活单位按 `last_player_standing` 夺冠。**

## 2. 发育窗口（round < 6）

### 2.1 经济与爆兵节奏

- 三方每轮收入 40，回放 `income` 累计：我 **560**（14 次）、a **560**、b **480**（12 次，第 14 轮淘汰）。
- 部署（`deploy` 事件共 20）：我 **7 次 / 603**（r1 五连：ranger→(-7,8)、heavy→(-8,7)、heavy→(-9,9)、infantry→(-8,9)、support→(-7,7)，共 403；r5 再补 2 heavy→(-7,8)/(-7,7)，共 200）；a **6 次 / 548**（4 heavy + 1 support + 1 ranger）；b **7 次 / 576**（2 heavy + 3 ranger + 2 support）。我是**部署最多、花费最高**的一家。
- 军力价值（事件重构，轮末）：r1 `a 642 / b 490 / c 645` → **r5 峰值 `a 752 / b 818 / c 845`（我 10 单位 / 1144HP，全场第一）**。
- 据点：回放**无** `control_point_captured` 事件，`cp_1/3/5` 全程无归属；三方都保住了自己唯一的部署垫，额外外圈据点没有转化为收益。我全程只有 `cp_2` 六个邻格可部署，r1 五连部署直接把六个格填满，此后每轮必须先腾格才能再部署。

### 2.2 拆墙与通道（本局第一个分水岭）

| 轮 | player_a | player_b | player_c（我） |
|---|---|---|---|
| r1 | `(-1,-5)` 西北出口 | `(6,-1)` 东出口 | `(-6,6)` 西南外围 |
| r2 | — | `(6,1)` | — |
| r3 | **`(-1,-1)` 花心北门** | **`(2,-1)` 花心东门** | — |
| r4 | — | — | **`(-2,2)` 花心西南门** |

三方各自需要两道爆破才能从出生角落进花心六格。a、b 都在**第 3 轮**打开花心门，我拖到**第 4 轮**——我把 r2/r3 的 AP 全花在 8 个链式移动与跟进上，只用一个 heavy 分两轮拆墙。这 1 轮的差距让 a 的侦察兵抢先进入 `(-1,0)`，并直接决定了后面 r5–r8 每一次抢 `(-1,1)`/`(-1,0)` 都是我在追、它在守。

### 2.3 预警时的状态

r5 `artillery_warning`：`safeRadius 9`、`warningCells 54`、`nextShrinkRound 6`。此时我 10 个单位全部位于 c3–c9，其中 8 个在 r6 之后会陆续进危险区；但我在 r5 仍执行了 2 次部署 + 抢中心格的计划，没有做 evacuation 排程。

## 3. 缩圈期（round 6–12）

### 3.1 炮火时间线与我的承伤

| 轮 | safeRadius | danger / warning 格 | 我的承伤（次数/HP/单位） | 决策评价 |
|---:|---:|---:|---|---|
| r5 | 9 | 0 / 54（预警） | — | 仍在爆兵，未做撤离排程 |
| r6 | 8 | 54 / 48 | 0 | 全员尚在 c≤8，安全 |
| r7 | 7 | 102 / 42 | 1 次 / 25 / 1 | 1 台 heavy 落 c8，开始滚雪球 |
| r8 | 6 | 144 / 36 | 2 次 / 50 / 2 | 通道排队，后排挪不动 |
| r9 | 5 | 180 / 30 | 3 次 / 75 / 3 | 仍以抢中心格为主，未倒序疏散 |
| r10 | 4 | 210 / 24 | 4 次 / 100 / 4 | 4 台在圈外 |
| r11 | 3 | 234 / 18 | 4 次 / 100 / 4 | 4 台在圈外 |
| r12 | 2 | 252 / 12 | **7 次 / 175 / 7** | 最差一轮，超过半数单位同时吃伤害 |
| r13 | 1 | 264 / 0（触底） | **8 次 / 170 / 8** | 缩圈触底，中心格单位全灭 |
| r14 | 1 | — | 5 次 / 115 / 5 | 只剩 c2+ 单位 |
| r15 | 1 | — | 4 次 / 80 / 4 | 剩 2 台 |
| r16 | 1 | — | 1 次 / 1 / 1 | support 1HP 清零 → 淘汰 |

**圈外承伤合计：我 891、b 640、a 246**（全场 1777）。我一家占了 50.1%，是 a 的 3.6 倍。回放中无 `invalid_deploy` / `invalid_heal` 事件；但 r13 起我的 support 位于 c3 危险区，`heal` 在 r13 因 `previous_action_failed` 作废，此后未再出现治疗事件，与"support/target/aim 不得在危险区"的约束一致。

### 3.2 接触战：形状、锁定与撞车

- **r6（我第一次击杀）**：我以 heavy `arc` 瞄 `(-1,0)` 命中 a 的 scout（42 造价），配合 ranger 先削血；`unit_death` seq 184 `cause: attack`。这是同时结算下"预测格命中"的成功例：目标留在瞄准格上。
- **r8（两发落空）**：我 ranger + scout 各瞄 `(1,0)`，但 b 的残血 scout 已不在该格，两条 `missed`，`locked:false`；同一轮 a 的 `arc` 反而击杀了 b 的 scout。**教训：非锁定射击只在敌人停留时有效。**
- **r10（我第二次击杀）**：ranger `single` + `attackLock` 瞄 `(1,-1)`，锁定 b 的 heavy `24d3edca`（100 造价）完成击杀。锁定机制（目标未逃出射程 3 即必中）是我本局最可靠的输出手段，全场 7 次锁定射击。
- **r12（护送失败）**：我两发分别瞄 `(1,0)` 打出 25 + 8，把目标从 94 削到 61 HP 却**没拿到最后一击**；同轮 a 用两个 `arc` 同时扫掉 b 的两个 ranger，独得 160 killValue。打高血量单位做"半吊子削血"是纯亏。
- **撞车**：全场 `action_failed` 41 条，我占 20 条；`round_resolved` 里我 `destination_occupied` 11、`destination_conflict` 3、`previous_action_failed` 5。r5、r7、r8 我连续三次把"heavy 抢 `(-1,1)`/`(-1,0)`"放在队列第一步，与 a 同格双向 `destination_conflict`，随后同一单位的 `attack` 被 `previous_action_failed` 连锁作废，r9、r11 又各有 4 条链式移动因"到达排在离开前"而 `destination_occupied`。

### 3.3 治疗战（第二个分水岭）

| 席位 | heal 次数 | 治疗总量 | support 位置 |
|---|---:|---:|---|
| a | **7** | **175 HP** | 长期停在 `(-1,-1)`（c2，r13 前安全），覆盖中心格重装 |
| c（我） | 3 | 79 HP | `(-2,2)`→`(-3,1)`，r13 起在危险区 |
| b | 0 | 0 | support 全被炮火清掉 |

a 的 7 次区域治疗（29/23/24/24/24/21/30）把它四个中心格 heavy 反复拉回高血量；我 r10–r12 才把 support 推到治疗位，且 r13 之后 heal 彻底失效。同样有 support，一方 175、一方 79，终局换血因此一边倒。

## 4. 终局（minimumSafeRadius 达成前后）

- **r13（safeRadius 1，264 危险格，`nextShrinkRound: null`）**：中心 `(0,0)` 是障碍，真正可站的只有内圈六格。我在此轮同时损失 5 个单位——3 台 heavy（`e196d6e7`/`445f3556`/`190d01a9`）被炮火清掉，scout `a173238d`(0,1) 被 a 的 `arc` 击杀、ranger `05604f76`(-2,2) 被 a 的锁定 `single` 击杀；a 的 support `57d8867a` 也在 `(-1,-1)` 被炮火清掉。我的中心格占位从 2 归零，a 保留 5 个单位全在内圈。军力价值 r13 末：`a 186 / b 11 / c 174`。
- **r14**：a、b 均无计划动作（b 已淘汰），我 5 个动作全 executed。轮界炮火清掉 b 最后一台 heavy `02b7393f`，`player_eliminated(player_b, artillery_destroyed, eliminatedBy: null)`，`cp_6` 中立化，b 定格 rank 2 / 300 分。
- **r15**：我用最后 2 个动作（heavy `arc` + support `single`）打出 34 伤害，a 用 2 发完成 40 伤害并击杀我的 heavy `b99b5715`；同轮炮火带走 `52150d51`、`a5500a91`。
- **r16**：我最后一台 support `78db6115` 1 HP 在 `(-3,1)` 被炮火造成 1 点伤害后死亡 → `player_eliminated(player_c, artillery_destroyed, eliminatedBy: null)`，`cp_2` 中立化。`game_over`：`last_player_standing`，a 以 5 个存活单位（16/11/61/67/10 HP）收官，rank 1 / 1251 分。
- **关键**：我和 b 都是**炮火清场**出局，不是被 a 战斗打光；a 的 424 killValue 中有 122 来自收掉我的 scout/ranger、100 来自我的最后一台 heavy。

## 5. 裁决账本与击杀分

### 5.1 终局分数（权重来自本局 `adjudicationWeights`）

| 项目 | player_c（我） | player_a | 权重 | 依据 |
|---|---:|---:|---:|---|
| HQ 伤害 / HQ 最终 HP | 不适用（无 HQ） | 不适用（无 HQ） | — | `headquarters = {}` |
| 据点流量持有 / 期末据点 | 1 / 1 | 1 / 1 | 0 | `control_point_*`、`round_end`；**权重 0，不构成裁决分** |
| 存活军力价值 | 0 | **123** | 5 | `game_over.payload.scores`；`armyValue = Σ round(cost×hp/maxHp)` |
| 剩余补给 | 457 | 512 | 0 | `income` 与部署支出；**权重 0** |
| 击杀造价 `killValue` | 142 | 424 | 1.5 | `attack` / `unit_death` 最后一击归属 |
| 炮火承伤 / 因炮火减员 | 891 HP / 7 单位 | 246 HP / 1 单位 | — | `artillery_damage` / `unit_death cause=artillery`，非独立裁决项 |
| **总分** | **213** = 0×5 + 142×1.5 | **1251** = 123×5 + 424×1.5 | — | `game_over.payload.scores` |

`player_b`：0×5 + 200×1.5 = 300。三方 `supplies`、`controlPoint`、HQ 权重全 0，**军力价值 + 击杀造价才是真实竞赛**，屯兵与囤补给不加分。

### 5.2 击杀造价明细（最后一击归属；炮火击杀无归属）

| 轮 | 击杀者 | 受害者 | 造价 | 形状 / 锁定 |
|---:|---|---|---:|---|
| r6 | **c** | a scout | 42 | `arc` |
| r8 | a | b scout | 42 | `arc` |
| r8 | b | a heavy | 100 | `single` / 锁定 |
| r9 | b | a heavy | 100 | `single` / 锁定 |
| r10 | **c** | b heavy | 100 | `single` / 锁定 |
| r12 | a | b ranger ×2 | 160 | `arc` ×2 |
| r13 | a | c scout + c ranger | 42 + 80 | `arc` + `single` 锁定 |
| r15 | a | c heavy | 100 | `single` / 锁定 |

合计 `a 424 / b 200 / c 142`，与 `game_over` 完全对平。全场 24 次 `unit_death`：10 次 `cause=attack`、14 次 `cause=artillery`（a 1、b 6、**c 7**）。

### 5.3 计划动作与 AP 浪费账本

| 席位 | 计划动作 | executed | failed | missed | 浪费率 |
|---|---:|---:|---:|---:|---:|
| player_a | 102 | 82 | 13 | 7 | 19.6% |
| player_b | 89 | 80 | 8 | 1 | 10.1% |
| **player_c** | **111** | **88** | **20** | **3** | **20.7%** |

我 111 条构成：`move 71`、`attack 27`、`deploy 7`、`heal 4`、`demolish 2`；AP 上限 8×15 = 120，**23 个 AP 白耗**：`destination_occupied 11`、`previous_action_failed 5`、`destination_conflict 3`、`missed(single) 2`、`target_escaped 1`、`unit_gone 1`。失败移动/攻击/治疗照扣 AP，失败部署不扣补给（我的 7 次部署全部 executed）。

### 5.4 火力与军力价值曲线

| 席位 | 出手 / 命中 | 命中率 | 实际伤害 | 锁定次数 | heal 次数 / 量 |
|---|---:|---:|---:|---:|---:|
| player_a | 29 / 22 | 75.9% | 660 | 4 | 7 / 175 |
| player_b | 16 / 15 | 93.8% | 352 | 13 | 0 / 0 |
| **player_c** | **23 / 20** | **87.0%** | **484** | 7 | 3 / 79 |

军力价值（事件重构，轮末，与 `game_over` 期末值对平）：

| 轮 | a | b | c（我） |
|---:|---:|---:|---:|
| r1 | 642 | 490 | 645 |
| **r5** | 752 | 818 | **845（峰值，10 单位）** |
| r8 | 515 | 590 | 769 |
| r10 | 410 | 367 | 597 |
| r12 | 305 | 41 | 352 |
| r13 | 186 | 11 | 174（该轮损失 5 单位） |
| r14 | 147 | 0 | 89 |
| r15 | 123 | 0 | 1 |
| game_over | **123** | 0 | **0** |

曲线说明一切：我在 r5 领先 93 分（对 a），但 r7 起每轮被炮火削 25–175 HP，而 a 的曲线下降主要来自与 b 的换血、且始终有 7 次治疗托底；到 r13 触底时 a 的 5 个单位全在安全格，我的 10 个单位已散落在 c2–c7。

## 6. 经验教训（可执行）

1. **爆兵量必须受通道容量约束，而不是受补给约束**。`snowflake` 六条放射走廊是单车道，`cp_2` 只有 6 个相邻部署格；我 r1 五连部署 + r5 两连，换来 r5 峰值 845 军力，却让 10 个单位排成一条走不动的纵队，最终 7 个死于炮火、圈外承伤 891。**正确做法**：把 r1 部署压到 2–3 个（heavy + ranger + support），把 AP 换成"先遣 3–4 个精锐在 r5 前推进到 c2/c1"，并让 support 跟在先遣队里；**触发条件**：`artillery_warning` 出现（本局 r5）时圈外单位 > 4 就立刻停止部署。**预期收益**：按 a 的 246 承伤量级，少烧 600+ HP 约等于多留 4 台满血 heavy 到 r13。

2. **两道墙要在前 3 轮并行拆完，别分 4 轮**。我 r1 拆外围 `(-6,6)`、r4 才拆花心 `(-2,2)`；a、b 都在 r3 拆开花心门（a `(-1,-1)`、b `(2,-1)`）。**正确做法**：第 1 轮就用两台 heavy 各拆一道（每单位每轮 1 次 `demolish`），r2–r3 让 scout 与 heavy 直接穿门进内圈；**触发条件**：赛前跑一次"拆墙代价场"，看到"到中心需拆 2 道"就把两道墙排进同一轮。**预期收益**：与对手同步（而非晚 1 轮）抢中心格，直接消除 r5–r8 那 3 次 `destination_conflict`。

3. **support 的位置就是终局换血量**。a 用 7 次 heal / 175 HP 把四个内圈 heavy 反复奶满，我只有 3 次 / 79 HP 且 r13 后完全失效。**正确做法**：`safeRadius ≤ 3`（本局 r11）之前把 support 送进 c1 内圈格或紧贴内圈的 c2 安全格，每轮 `heal` 覆盖中心格重装；**触发条件**：一旦 support 落在 `dangerCells`，立刻用最高优先级把它挪回安全半径内，否则治疗会被禁。**预期收益**：按 25 HP/轮的炮火速度，175 HP 治疗≈替内圈部队抵掉 7 轮缩圈。

4. **链式队列改为"独立动作在前、依赖动作在后"**。23 个浪费里有 11 个 `destination_occupied`、5 个 `previous_action_failed`，几乎全部来自"抢格移动 → 同单位攻击 → 后续单位补腾出的格"这条链。**正确做法**：攻击/治疗这类不依赖位置的动作排前，移动排后；任何"前车离开、后车进入"拆成两个行动点，且同一格每轮只由一个单位声明；抢空中心格时用 `wait` 把 move 延后到对手可能的 step 之后。**触发条件**：队列里出现"两个单位目标格相同"或"某动作依赖前一动作腾格"就重排。**预期收益**：按 20.7% → 10% 的浪费率，全局多出约 12 个有效 AP。

5. **只打能拿到最后一击的目标，别给对手做嫁衣**。r12 我两发把 `(1,0)` 的高血量目标从 94 削到 61，没拿到击杀；同轮 a 两个 `arc` 收掉 b 两个 ranger 独得 160 killValue；r13 我的 scout/ranger、r15 我的 heavy 又被 a 收掉，共送它 222 分。**正确做法**：优先锁定 HP ≤ 单次伤害的可击杀单位（`attackLock` 的 ranger 最稳），把高血量削血留到本方还有后续攻击能补刀时；**触发条件**：目标残血且相邻有敌方远程/arc 单位时，默认最后一击会被抢，改打别的目标。**预期收益**：`killValue` 权重 1.5，每多抢一个 heavy 就是 150 分。

6. **残血先撤，炮火纪律高于补刀**。我 10 个单位里 7 个 `cause=artillery`，最后一个 support 是 1 HP 在 `(-3,1)` 被轮界 1 点伤害清掉；`damage 25` 无视防御，heavy 140HP 看似能扛 5 轮，但 move 2 追不上每轮收 1 格的圈。**正确做法**：从 r5 预警起按"最外圈优先"倒序疏散，每轮把外圈单位往内挪满 2 格；宁可放弃 1–2 台残血，也不让整条纵队一起吃伤害；**触发条件**：单位所在格 c2c > 下一轮 `safeRadius` 时，撤退移动排在攻击之前。**预期收益**：避免 r12（7 台 / 175 HP）与 r13（8 台 / 170 HP）两次集中放血。

### 实际计划 vs 正确计划速查

| 轮次 | 我的实际计划 | 正确计划 | 触发条件 | 预期收益 |
|---|---|---|---|---|
| r1–r5 | 7 次部署 / 603 补给，10 单位 | 3–4 次部署 + 提前拆第二道墙，6–7 单位精锐前压 | `artillery_warning` / 拆墙代价场 = 2 | 少烧 600+ HP，与对手同步进内圈 |
| r5、r7、r8 | 队列首步抢 `(-1,1)`/`(-1,0)`，撞车连锁作废 | 独立攻击在前、移动在后；同格只声明一次 | 队列含依赖格 | 省下 3 次 conflict + 5 次连锁作废 |
| r10–r13 | support 在 c2/c3，仅 3 次 heal | support 进内圈，每轮 heal | `safeRadius ≤ 3` | 治疗量 79 → 175 量级 |
| r12 | 削 `(1,0)` 高血量目标 33 HP | 锁定可击杀残血 / 分散火力 | 目标 HP > 单次伤害×2 | 抢回 160 量级 killValue |
| r12–r16 | 8 台同时留在圈外 | 倒序疏散，弃车保先遣 | c2c > 下轮 safeRadius | 避免 `artillery_destroyed` |

## 7. 与历史对局 / 同局其他视角对比

- **同局赢家视角** `records/V3/tg_0267_rank01_DSH@dsv4.1flash1017.md`：其复盘自述"r3 拆 `(-1,-1)` 打开花心入口是本局最重要的先手"、"前 5 轮用 4 个重装抢占内圈"、"圈外伤害合计 246"。与我的 891 承伤、r4 才开门形成直接对照——**同一张图、同一套炮火时钟，差距不在爆发力而在内圈到位的早晚**。
- **同局第 2 名视角** `records/V3/tg_0267_rank02_QD@qwen4maxpreview.md`：它同样 `artillery_destroyed`（r14），并总结"炮火纪律高于一切""先切奶妈，再磨 heavy"——与本复盘 §6.3 独立得出同一结论，可互相印证。
- **历史雪花胜局** `records/V3/tg_0209_win_PI@kimik3.md`（royale·雪花，2 人）：其结论"赢在炮火纪律 + 先手拆开心脏墙""疏散要倒序走、宁可弃车""提前两轮清空前车位"，并记载 6 单位全死于炮火、战斗 0 阵亡仍能夺冠——说明**雪花局的胜负手是灼烧里程而非账面军力**，我这局恰好反着做。
- **历史雪花六人胜局** `records/V3/tg_0179_rank01_ZC@glm5.3flash.md`（royale·雪花，6 人）：全场炮击 5572 点、50 单位死于炮火；"谁的内圈席位多、谁的灼烧里程短，谁就活到最后"；其 §6 还指出"部署位次 = 行军位次，support 要么最后造、要么不造"，与我 r1 就把 support 排在纵队中段、全程只治疗 79 HP 完全吻合。
- 注意：上述两篇历史对局版本更早（含 `actionScore` 行动分，本局 3.9.9 已移除），**只比较炮火/撤离/通道等战术结论，不套用其计分口径或单位表**；同模型但不同模式的 `records/V3/tg_0264_win_WB@hy4.md` 是 `standoff` / `simultaneous`（无缩圈），同样不作跨图数字对比。

## 总结

> **核心口诀：雪花只有六条单车道——先拆两道门、再谈爆兵；预警一响就倒序疏散，support 必须站在内圈；同时结算里，最后一击才算分，抢不到的格别抢。**

**一句话总结：我用全场最高的第 5 轮军力（845）换来了全场最高的炮火承伤（891 HP），因为晚一轮进内圈、把 10 个单位堵在单通道里，最终和 player_b 一样被炮火清场；赢家 player_a 只造 6 个兵，却靠 r3 开门、内圈占位和 7 次治疗把 246 点承伤撑成了 1251 分的冠军。**
