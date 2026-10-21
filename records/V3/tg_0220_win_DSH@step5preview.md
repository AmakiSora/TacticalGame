# tg_0220 狭路相逢复盘（royale·narrow-road）

> 数据来源：房主归档回放 `records/V3/tg_0220_20261012.json`（`format: hex-v2-replay`，`schemaVersion 3.6.1`，`eventCount 214`，`exportedAt 2026-10-12T10:02:06.999Z`）。
> 本文所有数字均取自该回放；对局中的主观记忆只用于定性描述。未从游戏 API 重新拉取事件，未自行生成/覆盖回放。

## 0. 局面概要

| 项 | 值 |
|---|---|
| gameId | `0b087f8c-436f-464e-8a8a-bea3d9165726` |
| 地图 / 模式 / 人数 | `narrow-road` 狭路相逢（pointy 半径 6，59 格 = **21 平原 + 38 阻挡**）/ `royale`（同时回合 × 歼灭缩圈）/ 2 人 |
| 我的席位 / 玩家名 | **player_b / Step5-DSH**，`turnOrder = 0`（**先手**；player_a `turnOrder = 1`） |
| 出生 | `slot_a` → 部署垫 `cp_1` 左据点 `(-5,0)`（d=5）；对手 `slot_b` → `cp_2` 右据点 `(5,0)` |
| 对手 | player_a / MiniMaxM3.1Flash-DSH |
| 我的名次 | **rank 1（win）**，`rankings` 中 player_b rank 1 / player_a rank 2 |
| 终局 | `game_over` `winner = player_b`，`reason = last_player_standing`，第 **15** 轮 |
| 淘汰事件 | seq 211 `player_eliminated`，`reason = army_destroyed`（**战斗清场**，非炮火清场），`eliminatedBy = player_b`；同轮 seq 210 `control_point_neutralized`：`cp_2` 被中立化 |
| 本局 artillery 配置 | `startRound 10` / `intervalRounds 1` / `damage 5` / `minimumSafeRadius 1` |
| 其它配置 | `startingSupplies 20`、`baseIncome 5`、三种 CP kind 的 `income` 全 0、`actionsPerTurn 5`、**`damageVarianceRange 0`、`minimumDamage 1`、全员 `defense = 0` → 战斗伤害完全确定性**、`maxTurns null` |
| 本局权重 | `armyValue 1`、**`killValue 1`**、`controlPoint 0`、**`supplies 0`**、`enemyHqDamage 4` / `ownHqHp 2`（royale 无 HQ，两项恒 0） |
| 终局比分 | player_b **28**（armyValue 8 + killValue 20）；player_a **5**（armyValue 0 + killValue 5） |

**地图结构（回放 `game_start.map.cells` 实测）**：全图 21 个平原格。`r = 0` 一行 `q = −6…6` 共 13 格是唯一通路（狭路），**中心格 `(0,0)` 可通行**（与雪花不同）；两端各是一个 7 格封闭口袋——西口袋 `(-6,0) (-6,1) (-5,−1) (-5,0)=cp_1 (-5,1) (-4,−1) (-4,0)`，东口袋 `(4,0) (4,1) (5,−1) (5,0)=cp_2 (5,1) (6,−1) (6,0)`。口袋对狭路的唯一出口分别是 `(-4,0)→(-3,0)` 与 `(4,0)→(3,0)`。**狭路单格宽 ⇒ 近战接触时每侧只有 1 个单位能进入射程**，这是本图一切战术的物理前提。

全程 `headquarters = {}`，**零 HQ 相关事件**，符合 royale 规则，无异常。

## 1. 结果一句话

我用 54 补给买了 **1 heavy + 1 ranger + 1 support + 4 infantry + 2 scout**（含 1 个射程 3 的 ranger），对手用 48 补给买了 **1 heavy + 6 infantry + 2 scout**（零远程）；在单格宽的狭路上，**射程即兵力**——我的 ranger 从 `(-4,0)` 起覆盖半条狭路，R7–R9 三轮集火（3+3+7+3）确定性命中对手 15 血 heavy（本局最贵单位），R10–R11 又预测+补刀带走一个 infantry，`killValue` 20:5 直接锁死胜局；随后我把 heavy 一步一环收进中心 `(0,0)`（全程零炮伤），对手 6 个 infantry 在 R10–R14 被炮火成片清掉，R15 最后一个被贴脸敲掉，`army_destroyed` 出局。

## 2. 发育窗口（round < startRound = R1–R9）

**爆兵节奏（回放 `deploy` 事件，双方各 9 投）**

| 轮 | 我（player_b） | 对手（player_a） |
|---|---|---|
| R1 | heavy 10 → (-4,0)；infantry 5 → (-4,-1)；infantry 5 → (-5,-1) | heavy 10 → (4,0)；infantry 5 → (5,-1)；scout 4 → (6,-1) |
| R2 | infantry 5 → (-5,1) | scout 4 → (5,1) |
| R4 | support 7 → (-4,-1) | infantry 5 → (4,1) |
| R5 | infantry 5 → (-5,-1) | infantry 5 → (5,-1) |
| R6 | scout 4 → (-6,1)；scout 4 → (-6,0) | infantry 5 → (6,0) |
| R8 | **ranger 9 → (-4,0)** | infantry 5 → (4,1) |
| R9 | —（2 动：移动 + 双集火） | infantry 5 → (4,0) |
| 合计 | **9 单位 / 54 补给**（heavy 1、ranger 1、support 1、infantry 4、scout 2） | **9 单位 / 48 补给**（heavy 1、infantry 6、scout 2） |

**经济与转化**：双方各 14 次 `income`（R2–R15 各 5/轮）+ 起始 20 = **各 90 补给进账**。我花掉 54、终局余 36；对手花掉 48、**终局余 42**。本图 `supplies` 权重为 **0**，那 42 点是纯沉没成本——尤其对手 R9 在我投 ranger 的同一窗口只能再买一个 5 块 infantry（回放 seq 104），火力配置就此定型。

**部署垫与部署窗口**：`cp_1`/`cp_2` 自始至终各归原主，`controlPoints` 1:1（权重 0，无差别）。按本局实际参数推导部署窗口：`cp_1` 在 d=5，`safeRadius` 起始 6、R10 收到 5、R11 收到 4 ⇒ **R11 计划期起 `cp_1` 本身进危险区、部署被拒**；其邻格 `(-4,0)`/`(-4,-1)` 可撑到 R11，R12（safe=3）起全灭。**实际有效部署窗口 = R1–R11，受口袋格位限制实际只用满到 R8。**

**开局三手的关键性**：本图零初始单位，R1 不部署则 R1 结算即 `army_destroyed`。R1 六条 deploy 全部 `executed`，双方踩线过关。

**两个提前量（本局最重要前置动作）**：
- R2 heavy `demolish (-3,-1)`：拆开出海口外侧的阻挡格，此后 infantry 得以从 `(-3,-1)` 侧位接近狭路（R3 移动到 `(-3,-1)`、R5 进 `(-2,0)`）。
- R4 heavy `demolish (-4,1)`：拆开口袋上沿，R6 起两个 scout 才有一条向内的路。两次拆除都只花 1 AP，但决定了后续 5 个单位的行军路线。

## 3. 缩圈期（startRound = R10 起）

**危险区时间线（`artillery_warning` / `artillery_shrunk` / `artillery_damage`）**

| 轮 | safeRadius | dangerCells | 我方掉血 | 对手掉血 | 当轮炮火减员 |
|---|---|---|---|---|---|
| R9 | 6（`artillery_warning`，nextShrinkRound 10，10 格警告环） | 0 | — | — | — |
| R10 | 5 | 10 | 10 | 10 | 我 scout `93a1eada`@(-6,0)；对手 scout `46ce2335`@(6,-1)、`2f021a06`@(5,1) |
| R11 | 4 | 20 | 14 | 15 | 我 infantry `85d1505e`@(-5,-1)、scout `8528c5fc`@(-5,1) |
| R12 | 3 | 30 | 14 | 12 | 我 infantry `47198c23`@(-4,-1)；对手 infantry `b99b8229`@(5,-1)、`7f46f45c`@(5,0)、`5d08a181`@(4,1) |
| R13 | 2 | 40 | 10 | 5 | 我 infantry `e9adfda8`@(-4,1)、support `ad233ec8`@(-3,-1)、**ranger `46a11b92`@(-3,0)** |
| R14 | **1**（`nextShrinkRound = null`，触底） | 52 | 0 | 4 | 对手 infantry `ddcf6019`@(2,0) |
| **合计** | | | **48** | **46** | 我 7 个单位 / 对手 6 个单位 |

`damage = 5` 每轮全额扣除、无视防御 ⇒ **5 血 scout 圈外 1 轮即死、9 血 infantry 2 轮即死、3 血 ranger 1 轮即死**。双方炮火总承伤几乎相同（48:46）、炮火减员也只差 1 个——**本局胜负不在缩圈线，而在接触战的火力结构**。

**我的 heavy 全程零炮伤**：R1 部署于 `(-4,0)`，R5→`(-3,0)`、R10→`(-2,0)`、R12→`(-1,0)`、R13→`(0,0)`。逐轮核对：R10 边界 safe=5 时它在 `(-3,0)`(d3)、R11 边界 safe=4 时在 `(-2,0)`(d2)、R12 边界 safe=3 时在 `(-1,0)`(d1)、R13/R14 边界 safe=2/1 时在 `(0,0)`(d0)——**每一步都刚好提前一环收进新区间，从未落在 danger/warning 上**。这是本局我最满意的一条纪律。

**接触战全过程（同时结算，攻击瞄准格子；本图无 `attackShape`/`attackLock` 配置 ⇒ 全部 `single` 单格预测射击）**

| 轮 | 我方攻击 | 对手攻击 |
|---|---|---|
| R7 | infantry `68af98a0` 瞄 `(-1,0)` → **命中** heavy，3 伤（15→12）。**纯预测**：计划时敌 heavy 在 `(0,0)`、我在 `(-2,0)`，距离 2 超出我射程 1，我预判其推进格 | — |
| R8 | infantry `68af98a0` 瞄 `(-1,0)` → 命中 heavy，3 伤（12→9）。**直击** | heavy `12f955f3` 瞄 `(-2,0)` → 命中我 infantry，5 伤（9→4） |
| R9 | **ranger `46a11b92` 瞄 `(-1,0)` → 7 伤（9→2）；infantry `68af98a0` 同格补 3 伤（实 2）→ heavy 阵亡** | heavy 濒死反扑 `(-2,0)` → 5 伤（实 4）→ 我 infantry 阵亡 |
| R10 | ranger 瞄 `(-1,0)` → **预测命中** infantry `03bcaa46`，7 伤（9→2）。计划时它在 `(0,0)`，同格预判再次生效 | — |
| R11 | heavy 瞄 `(-1,0)` → 直击 5 伤（实 2）→ infantry `03bcaa46` 阵亡 | — |
| R12 | ranger 瞄 `(0,0)` → **落空**（`status: missed`，敌在 `(1,0)`/`(2,0)`） | — |
| R14 | heavy 瞄 `(1,0)` → 命中 infantry `08dec4d9`，5 伤（9→4） | — |
| R15 | heavy 瞄 `(1,0)` → 5 伤（实 4）→ infantry `08dec4d9` 阵亡 | infantry 瞄 `(0,0)` → 命中我 heavy，3 伤（15→12） |

**狭路预测射击为什么稳**：整条狭路只有 `r=0` 一行可走，对手要从东口袋推进到内圈，**必经格是固定的**。R7/R10 两次"瞄它下一步必须踩的格"全部命中；一旦命中就是 7 伤（ranger）起跳，而本图 `damageVarianceRange = 0`，**每一发伤害都可以在计划阶段手算出来**。

**`destination_conflict`**：全局 **0 次**（`round_resolved` 无此 reason，`action_failed` 事件 0 条）。双方走位天然错开，我没有、也没遇到路线封锁型冲突。

## 4. 终局（minimumSafeRadius = 1 达成前后）

- **R13**：我只有 1 条 move——heavy `(-1,0)→(0,0)` 抢占中心；对手 `ddcf6019` `(3,0)→(2,0)`。**同轮界炮火把我在 `(-3,0)` 的 ranger 收掉**（3 血挨 5 伤）。此刻我仅剩 heavy 15 血在 `(0,0)`，对手还有 2 个 infantry：`08dec4d9`@(1,0)（9 血，d=1 永久安全）与 `ddcf6019`@(2,0)（4 血，d=2 已陷）。
- **R14**：圈触底 safe=1，`nextShrinkRound = null`。轮界炮火先替我清掉 `ddcf6019`@(2,0)（4 血挨 5 伤，无归属、双方都不得分）。我 heavy 从 `(0,0)` 打 `(1,0)`，5 伤把 `08dec4d9` 压到 4 血。**对手此轮 `round_resolved` 为 `[]`——零动作**，已无可调动单位。
- **R15**：我 heavy 再打 `(1,0)`，5 伤（实 4）→ `08dec4d9` 阵亡；对手同一个 infantry 同时向 `(0,0)` 还手 3 伤（我 heavy 15→12）。**同时结算下它打不动我、我打死了它**。seq 209 `unit_death cause=attack` → seq 210 `cp_2` 中立化 → seq 211 `player_eliminated army_destroyed` → seq 212 `game_over`。- **花心/最后安全格争夺**：本图 `minimumSafeRadius=1` 且 **`(0,0)` 可通行**，最终安全区是狭路上 3 格 `(-1,0)/(0,0)/(1,0)`（不是雪花的内环六格）。我 R13 就抢下 `(0,0)` 并守住 `(1,0)` 这条唯一接近路线；对手最后一只兵停在 `(1,0)`——**在我的射程内、它自己的射程外**，完全没有反制空间。

## 5. 裁决账本与击杀分

**最终分（`game_over.payload.scores`，权重 `armyValue 1 + killValue 1`，其余 0）**

| 项 | 我 player_b | 对手 player_a |
|---|---:|---:|
| armyValue ×1 | **8** | 0 |
| killValue ×1 | **20** | 5 |
| controlPoints / controlHold（权重 0） | 1 / 1 | 1 / 1 |
| supplies（权重 0） | 36 | **42** |
| **total** | **28** | **5** |

> 对手比我多囤 6 点补给，在 `supplies = 0` 的记分牌下一分不值；反过来它 R9 少的那 4 点差价（ranger 9 vs infantry 5）决定了整条狭路的射程归属。

**击杀造价来源（按最后一击归属，与终局分逐项吻合）**

- 我：R9 击杀 heavy（cost 10）+ R11 击杀 infantry（5）+ R15 击杀 infantry（5）= **20** ✅
- 对手：R9 击杀我 infantry（cost 5）= **5** ✅
- **炮火击杀 13 个单位，双方均不计入 killValue**（seq 117/119/121/135/139/157/159/161/163/176/178/180/193）——R14 那发替我省下 1 AP 的炮火杀同样零归属。

**军力价值曲线（按 `cost × hp/maxHp` 逐轮回放重算，轮末快照）**

| 轮末 | 我 | 对手 | 说明 |
|---|---:|---:|---|
| R1 | 20 | 19 | 起手 3 投 vs 3 投 |
| R4 | 32 | 28 | 我 support 到手 |
| R6 | 45 | 38 | 我 8 单位满编 |
| R8 | 51 | 39 | **ranger 落地** |
| R9 | 49 | 38 | 互换 1 兵（我 −1 廉价换它 −1 昂贵） |
| R10 | 42 | 26 | 它 infantry 掉到 2 血 |
| R11 | 33 | 16 | **它 heavy + 第 2 个 infantry 都没了** |
| R12 | 24 | 10 | 炮火重创双方后排 |
| R13 | 10 | 7 | 我 ranger/support/步兵阵亡，仅剩 heavy |
| R15 | **8** | **0** | 最后一个 infantry 阵亡 |

**计划/执行账本**

- `plan_committed` 30 次 = 15 轮 × 2，无双发超时、无卡表。
- `round_resolved.results`：`deploy:executed 18`、`move:executed 30`、`demolish:executed 2`、`attack:executed 11`、`attack:missed 1`；**`failed` 0 条、`fizzled` 0 条、`destination_conflict` 0 次**。
- 攻击产出：**我 9 发 8 中、造成 38 点伤害（3 次击杀）**；对手 **3 发 3 中、13 点伤害（1 次击杀）**——同时结算下"开火次数"本身就反映双方可接敌单位的数量差。
- AP 用量：**我 33 / 75**（R1 3、R2 2、R3 2、R4 2、R5 3、R6 4、R7 3、R8 2、R9 3、R10 2、R11 2、R12 2、R13 1、R14 1、R15 1）；对手 29 / 75。
- **AP 浪费 2 处（如实记录）**：① R12 ranger 瞄 `(0,0)` 落空——该轮它被友军 heavy 占住 `(-2,0)`、唯一空格是向外的 `(-4,0)`，**实为无法移动下的无成本试射**，但确实没打到东西；② **R13 我只排了 1 条动作，把 ranger 留在 `(-3,0)` 白白挨了轮界炮火**。这一处是真浪费：R12 heavy 已让出 `(-2,0)`，ranger 本可 R13 移动到 `(-2,0)`（safe=2 时 d=2 恰好安全）活下来，R14 就能从 `(-2,0)` 打 `(1,0)`（距离 3，7 伤）配合 heavy 的 5 伤**在 R14 就结束对局**。我把终结战提早一轮的机会漏掉了。

## 6. 经验教训（≥3 条，可执行）

1. **狭路/单格宽地图，把补给换成"射程"而不是"数量"。** 本图 21 个平原格里 13 格是一条直线，近战每侧只容 1 个单位接敌。对手 48 补给买 1 heavy + 6 infantry + 2 scout，**同一时刻最多 1 个步兵能打到我，其余全是待宰队列**；我 54 补给买成 1 heavy + 1 ranger + 1 support + 4 infantry + 2 scout，ranger 站在 `(-4,0)` 就能覆盖半条狭路。可执行：**遇到只有一条通路的地图，先算"每点补给能买到的射程与单发伤害"**——本图 ranger 9 块买 7 伤/射程 3，是性价比最高的火力单位；`damageVarianceRange = 0` 时这个计算是精确的。
2. **预测射击要打在"对手必经格"上，而且越早开火越好。** R7 敌 heavy 在 `(0,0)`、我步兵射程 1 打不到，我瞄它推进必经的 `(-1,0)`，命中；R10 同理再中。可执行：**同时回合下，把攻击目标从"敌人在哪"改成"敌人要走到哪"**——通路唯一的地图这几乎是稳的；三连 chip（3+3+7+3）正好凑满 15 血 heavy，而每一步都在计划阶段就能算出来。
3. **缩圈纪律 = 主力每轮提前一环内收，别让任何高价值单位落在 warning 上。** 我的 heavy 五步走位（`(-4,0)→(-3,0)→(-2,0)→(-1,0)→(0,0)`）每一步都踩在"新区间刚好安全"上，**全程 0 炮伤**；代价是我把 4 个步兵 + 2 个 scout + support 留在了外圈口袋（48 点炮火承伤、7 个单位阵亡）。可执行：**圈缩之前先决定"谁进圈、谁放弃"**——本图 5 AP 只够保 1–2 个单位走位，与其平均用力不如让 heavy/ranger 这类高 `cost` 单位优先内收。
4. **没有合法目标的单位必须移动，不能让它原地等炮。** R13 我的 ranger 在 `(-3,0)` 打不到任何敌人（最近的 `(1,0)` 距离 4 > 射程 3），我却只排了 heavy 一条动作，ranger 当轮界被 5 伤收掉。若 R13 把它移到已让出的 `(-2,0)`，R14 即可与 heavy 双杀 `(1,0)`，对局提早一轮结束。可执行：**每个计划窗口结束前问一遍"这个单位这回合有没有产出？没有就让它往安全区走一步"**；判断依据是当前棋盘的真实连通性（`(-2,0)` 被友军占着时移动会被拒，友军一走掉就立刻补上）。
5. **`supplies` 权重 0 时，囤积就是净亏损；`controlPoint` 权重 0 时据点只值部署权。** 本图双方各进账 90 补给，我花 54、对手花 48，终局补给 36:42 却一分不算。可执行：**开局先读 `adjudicationWeights`**——只要 `supplies = 0`，就把每一轮收入在当轮换成最能提高 `armyValue`/`killValue` 的兵种；`controlPoint = 0` 时据点不需要派兵抢，守住部署垫即可（本局我全程只守 `cp_1`，4 个步兵从没上过据点）。
6. **不要用最贵的单位换最便宜的，除非那是决胜手。** R9 我用 9 血 infantry（cost 5）换掉对手 heavy（cost 10），`killValue` 净 +5，是正交易；但同轮我 infantry 也阵亡，实际是"1 廉价换 1 昂贵 + 我自己也掉 1 个"，等价于 5 换 10。可执行：**换血前先算双方的 `cost` 比**，本图 heavy 10 / ranger 9 / infantry 5 / scout 4，`cost` 差 2.5 倍就意味着一次错误的近距离换血足以输掉整局。

---

**同局交叉核对**：`records/V3/tg_0220_lose_DSH@tr-alpha.md`（对手 player_a 视角）与本文对 15 轮淘汰、`army_destroyed`、`killValue` 20:5、炮火承伤 48:46、唯一 `missed` 出自 R12 等数字完全一致；它自述的三个输因（"重注必须第 9 轮前下"、"警告环那一轮就要撤"、"不要用最贵的兵换最便宜的兵"）与本文第 1/3/6 条互为镜像。

**同图参照**：`records/V3/tg_0218_win_QD@dsv4.1flash0910.md` 与 `records/V3/tg_0218_lose_DSH@tr-alpha.md`（同为 `narrow-road` royale）也得出"单格宽 ⇒ 集火物理不可能 ⇒ 买射程不买数量"的结论；本局以 2 heavy 1 ranger 的中量阵容再次验证，且补充了一条它们没写的：**发育期就应该用 heavy 拆开出海口外侧的阻挡格（本局 R2/R4 各 1 AP），否则 5 个单位全堵在 7 格口袋里，缩圈开始时连往外走的路都没有。**

*本复盘全部数字取自 `records/V3/tg_0220_20261012.json`（gameId `0b087f8c-436f-464e-8a8a-bea3d9165726`）。席位视角：player_b / Step5-DSH（DSH@step5preview）。*
