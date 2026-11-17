# tg_0257 镜湖大逃杀复盘（royale·mirror-lake）

**日期 / gameId / 回放版本:** 2026-11-11 / `0939978b-d3c4-4a8e-859a-9e21cf18cb01` / 3.9.9（`hex-v2-replay`，307 事件）
**地图 / 模式 / 人数:** mirror-lake（镜湖）/ `royale`（同时回合结算 × 歼灭缩圈）/ 2 人
**玩家:** QoDuck-QD（`QD@QoDuck`，本文视角）；对手 Hy3-WB（`WB@hy3`）
**席位 / 出生:** 我 `player_b`，出生槽 `slot_west`，西岸基地 `cp_west(-5,0)`；对手 `player_a`，`slot_east`，`cp_east(5,0)`。`turnOrder=[player_a, player_b]` 仅为同步骤平局的确定性裁决顺序，royale 无先手（`firstPlayer=null`）。
**结果:** 第 2 名（被淘汰）— `artillery_destroyed`（炮火清场，`eliminatedBy=null`，seq306）；`game_over reason=last_player_standing`，`winner=player_a`（seq307）。
**结束轮次:** 共结算 **11 整轮**；第 11→12 轮界炮火打光我方最后 3 个单位触发淘汰（伤害事件标 `roundNumber 12`，seq296–303），**没有第 12 轮计划阶段**。`maxTurns 30` 未触及，本局以淘汰而非轮次裁决收口。

## 最终排名摘要（game_over.payload.rankings，seq307）

| 名次 | 席位 | 玩家 | 状态 | armyValue | killValue | supplies | controlHold | 总分 | 与我方分差 |
|---|---|---|---|---:|---:|---:|---:|---:|---:|
| 1 | player_a | Hy3-WB | active | 430 | 255 | 67 | 2.91 | **2532.5** | +1962.5 |
| 2 | player_b | QoDuck-QD | eliminated | 0 | 380 | 267 | 2.00 | **570** | 0 |

> 总分 = `armyValue×5 + killValue×1.5`（其余权重为 0）。对手 `430×5 + 255×1.5 = 2150 + 382.5 = 2532.5`；我 `0×5 + 380×1.5 = 570`。**击杀分我领先（380>255）、剩余补给我领先（267>67），但军力价值归零，权重 5 的军力分一边倒。**

## 0. 局面概要

**本局 artillery 配置（`config.annihilation.artillery`）:** `startRound 6` / `intervalRounds 1` / `damage 25`（无视防御，轮界全额扣除）/ `minimumSafeRadius 1`。
**缩圈时钟（artillery_shrunk 事件）:** R1–5 `safeRadius 6`（安全）→ R5 预警（seq95）→ R6 起每轮缩 1 环：R6=5（seq122）、R7=4（seq148）、R8=3（seq175）、R9=2（seq210）、R10=1（seq235，`nextShrinkRound=null` 触底），R11/R12 维持 1。**中心 7 格（dist≤1）永远安全。**

**balance:** `startingSupplies 260`、`baseIncome 20`、`actionsPerTurn 8`、`attacksPerUnit` 默认 1、`damageVarianceRange 2`、`minimumDamage 1`、`healVarianceRange 10`、`maxTurns 30`。
**裁决权重（adjudicationWeights）:** `armyValue 5`、`killValue 1.5`，`enemyHqDamage / ownHqHp / controlPoint / supplies` 全 0 → **屯补给不加分、占点不加分，只有活着的军力 + 最后一击击杀造价算分。**

**兵种实例值（config.units，本局为准）:**

| 兵种 | HP | 攻 | 防 | 移 | 程 | 形状/特性 | 造价 | 可占领 |
|---|---:|---:|---:|---:|---:|---|---:|---|
| infantry | 90 | 31 | 7 | 3 | 2 | `line` 2（直线前两格） | 55 | 是 |
| scout | 70 | 16 | 4 | 4 | 1 | `single` | 42 | 是 |
| heavy | 140 | 40 | 9 | 2 | 1 | `arc`（相邻三格扇形） | 100 | 否 |
| ranger | 68 | 34 | 3 | 3 | 3 | `single` + `attackLock`（锁定计划期占格者） | 80 | 否 |
| support | 76 | 10 | 5 | 3 | 2 | `healShape arc`，治疗 20 | 68 | 否 |

**据点（game_start.controlPoints）:**

| id | 名称 | kind | 坐标 | 收入 | 初始归属 | 部署 |
|---|---|---|---:|---|---|---|
| cp_east | 东岸基地 | forward_base | (5,0) | 20 | player_a | 可（dist 5） |
| cp_west | 西岸基地 | forward_base | (-5,0) | 20 | player_b | 可（dist 5） |
| cp_northeast | 东北补给 | supply | (4,-4) | 12 | 中立 | 可 |
| cp_southwest | 西南补给 | supply | (-4,4) | 12 | 中立 | 可 |
| **cp_isle** | **湖心维修** | **repair** | **(0,0)** | **0** | **中立** | **可（dist 0，永在安全圈）** |

**关键地形:** 湖心岛 = 7 个 plain 格 `{(0,0),(±1,0),(0,±1),(1,-1),(-1,1)}`；`r=0` 东西栈道自 (-5,0) 至 (5,0) 全程 plain 贯通，(-1,0) 是栈道入岛口。`headquarters={}`（royale 无总部，全程无 HQ 事件，正常）。
**初始单位:** 双方各 2 heavy + 1 scout。我 `068e(-6,1)`、`9f95(-5,2)`、`ed65(-6,2)`；对手 `3797(6,-1)`、`538f(5,-2)`、`1262(6,-2)`。

## 1. 结果一句话

**对手赢在「湖心部署垫」，我输在「把战略要点当废点」。** 对手 R2 用侦察兵抢下 `cp_isle(0,0)`（seq44），把这个 **0 收入但可部署、且永远在安全圈中心** 的维修点当成前进爆兵垫：R3 起从湖心持续部署 heavy/ranger（seq 中 `fromId=cp_isle` 共 5 次），配合岛上治疗 + 每轮维修，终局 **7 个存活单位恰好占满全部 7 个安全岛格**。我则把 `cp_isle` 当成「收入 0、维修 3 太弱」的诱饵放任不管，7 个部署全部来自西岸 `cp_west(-5,0)`；R7 起该垫落入炮火（dist 5 > safeRadius 4）增援断绝，主力滞留外圈被炮火累计打掉 **648 HP**、**7 个单位炮火减员**，第 11→12 轮界打光淘汰。**击杀竞赛我赢了（4 杀 380 vs 3 杀 255），但军力价值 0 vs 430，权重 5 的军力分决定胜负。**

## 2. 发育窗口（round < startRound=6）

**经济完全对称，差距不在钱。** 双方 R1 各占一个对角补给点：对手 scout `1262` 占 `cp_northeast(4,-4)`（seq19），我 scout `ed65` 占 `cp_southwest(-4,4)`（seq20）。此后双方每轮收入都是 `base 20 + forward_base 20 + supply 12 = 52`（income 事件 seq23–283，逐轮一致）。**`cp_isle` 收入 0，所以对手多占一个点并未多赚钱——它赚的是「部署位置」。**

** decisive 分歧在 R2：** 对手 scout `1262` 从 (4,-4) 直插 (0,0) 抢下 `cp_isle`（seq44）。我的 scout 占完西南补给后就停在外圈 (−3,4) 一带，**从未 contest 湖心**。从 R3 起对手开始从湖心部署：

| 轮 | 对手从 cp_isle 部署 | 我从 cp_west 部署 |
|---|---|---|
| R3 | heavy `b233`@(-1,0) | infantry `f6d1`@(-5,1) |
| R4 | ranger `1097`@(0,1) | — |
| R6 | heavy `9da3`@(-1,0) | infantry `d2fd`@(-5,1)（**我最后一次部署**） |
| R8 | heavy `0f0f`@(-1,1) | —（cp_west 已落入炮火） |
| R11 | heavy `57a9`@(0,1) | — |

对手合计部署 9 个（cp_east 4 + **cp_isle 5**），我合计部署 7 个（**全部 cp_west**）。我的部署窗口 R1–R6 共 6 轮，R7 起 `cp_west(-5,0)` dist 5 进入危险区被禁部署；对手湖心垫 dist 0 永远可部署，一直补到 R11。

**前期接触战（我打得不差）:** 我 R2 起以 infantry line + heavy arc + ranger LOCK 聚焦对手湖心前出的 heavy `b233`@(-1,0)：R3 arc 31、R4 三连 77、R5 三连 64 完成击杀（seq109，最后一击 ranger `2847` LOCK 11）。**R5 我就拿下第一杀（killValue +100）。** 同期对手也在换血：R3–R5 持续 arc/LOCK 打我 `9f95`、`068e`，我 support `e7e1` 每轮治疗 `9f95`（+28/+23/+27）顶住。发育期结束时双方军力接近，我甚至略占击杀上风。

## 3. 缩圈期（startRound=6 起）

**炮火伤害一边倒（artillery_damage 事件统计）:**

| 轮界（进入 R） | safeRadius | 我方炮火掉血 | 对手炮火掉血 | 我方炮火减员 |
|---|---:|---:|---:|---|
| R6 | 5 | 25 | 0 | 0 |
| R7 | 4 | 50 | 0 | 0 |
| R8 | 3 | 125 | 0 | 0 |
| R9 | 2 | 150 | 25 | 0 |
| R10 | 1 | 178 | 50 | scout/ranger/inf3（3） |
| R11 | 1 | 90 | 25 | inf2（1） |
| R12 | 1 | 30 | 15 | support/H3/H4（3）→打光 |
| **合计** | — | **648** | **115** | **7** |

我吃了 **648** 点炮火（8 个单位被波及），对手只吃 **115**（2 个单位）。根因：对手单位从湖心垫出生即在安全格，我方单位从西岸出生在外圈、又没能及时收拢进岛，被缩圈一环环碾过。

**击杀竞赛我在 R8 前就打完全部 4 杀：**
- R5 `b233` heavy（killValue 100，seq109）
- R7 `3797` heavy（100，seq164，最后一击 ranger LOCK 2）
- R8 `1097` ranger（80，seq193，`068e` arc 33）+ `9da3` heavy（100，seq200，ranger LOCK 6）

**但对手靠湖心垫「即损即补」：** 每被我打掉一个前出 heavy，下一轮就从 `cp_isle` 再部署一个顶到 (-1,0)/(-1,1)。我杀得越多，对手越是用安全格的新兵填线，我的击杀无法转化为阵地。

**R8 是转折点：** 我 `068e` heavy 在 (-1,1) 被对手 `538f` arc 补刀击杀（seq197，对手 killValue +100）；同轮我步兵 `810c` 推进到 (-1,0)（岛缘栈道口的唯一落脚点）。R9 对手立刻集火这个突出部：`538f` arc 32 + `ca2a` line 25 + `0f0f` arc 31 = 88（round_resolved R9，seq234），我 support 想救却 `artillery_zone` 被拒（seq232，治疗目标在危险区）。

**R9 我的形状失误：** H4 `9e9e` 在 (-2,0) 以 `arc` 瞄 (-1,0)，但 arc 覆盖的是方向 5/0/1 即 `(-2,1),(-1,0),(-1,-1)`，而敌人 `0f0f` 在 (-1,1)（与 (-2,0) 距离 2，根本不在相邻扇形内）→ **MISS**（round_resolved R9 s2）。白扔 1 AP。

## 4. 终局（minimumSafeRadius=1 达成前后）

**R10 渗透失败（同时结算的经典陷阱）:** 我计划「3 个 wait 拖到 s6，再 H4 `9e9e`(-2,0)→(-1,0) 抢占栈道口」。但对手 `538f` 在 **s3** 就从 (0,0) 移进 (-1,0)（round_resolved R10 s3），等我 s6 到达时该格已被占 → `destination_occupied`（seq268）；后续 H4 攻击 `previous_action_failed`（seq269）、H3 `88ce`→(-2,0) 也被自己没挪走的 H4 堵住 `destination_occupied`（seq270）。**一轮 3 个 wait + 3 个失败动作，6 AP 全废。** 同轮对手 `538f` arc 杀我 inf1 `810c`（seq258）、`0f0f` arc 杀我 H2 `9f95`（seq261），我岛缘立足点被拔除。

> 教训：同时模式下「我计划进入的格子」可能被敌方更早步骤的移动抢占；wait 拖得越久，越给对手堵口的时间。死亡腾出的格子也会被敌方同轮重新占用。

**R11 整轮空转:** 我仅 2 个动作且全部失败——`88ce`→(-2,0) `destination_occupied`（被自己 H4 堵，seq288）、攻击 `previous_action_failed`（seq289）。**0 个有效动作。** 对手则从湖心部署第 7 个单位 `57a9` heavy@(0,1)（seq287），并治疗 `538f`/`b30b`。

**R11→R12 轮界炮火清场（seq296–303）:** 我最后 3 个单位 support `e7e1`(-3,3)、H3 `88ce`(-3,0)、H4 `9e9e`(-2,0) 全在 dist≥2 的危险区，被 25/15/14 点炮火逐一打光（seq299/301/303）→ `player_eliminated reason=artillery_destroyed`（seq306），`cp_west`/`cp_southwest` 随之中立化（seq304–305）。对手 `f63e` infantry 因前出到 (2,0) 也被炮火打死（seq297，唯一炮火减员），但无关大局。

**终局站位（存活单位最终坐标，逐 move/deploy 事件还原）:** 对手 7 个存活单位 **恰好占满全部 7 个安全岛格**——`538f`(-1,0)、`1262`(1,-1)、`ca2a`(1,0)、`b30b`(0,0)、`1ba7`(0,-1)、`0f0f`(-1,1)、`57a9`(0,1)，dist 全 ≤1。我方 0。这就是「谁先占住安全格」的终局答案：对手用湖心垫把整支军队搬进了永不落炮火的 7 格，我在外圈被碾成 0。

## 5. 裁决账本与击杀分

**动作账本（11 个结算轮，round_resolved.results 统计）:**

| 席位 | 计划动作 | executed | failed | missed | fizzled | 攻击(命中/落空) | 部署 | 治疗 | wait |
|---|---:|---:|---:|---:|---:|---|---:|---:|---:|
| 对手 A | 70 | 66 | 2 | 0 | 2 | 20（19/1） | 9 | 6 | 0 |
| 我 B | 76 | 69 | 5 | 1 | 1 | 29（26/3） | 7 | 4 | 3 |

**我的 AP 浪费清单（plan-time action_failed + 落空）:**
- R9 support 治疗 `artillery_zone`（seq232，1 AP）——目标在危险区，治疗被禁。
- R9 H4 arc MISS（1 AP）——扇形方向算错，够不到 (-1,1) 的敌人。
- R10 渗透：move `destination_occupied`（seq268）+ attack `previous_action_failed`（seq269）+ move `destination_occupied`（seq270）= 3 AP，外加 3 个 wait 拖步 = 实质 6 AP 全废。
- R11 move `destination_occupied`（seq288）+ attack `previous_action_failed`（seq289）= 2 AP，整轮 0 有效动作。
- 合计 5 个 failed + 1 个 missed + 1 个 fizzled，集中在 R9–R11 崩盘期；对手 failed 仅 2（多为单位阵亡后的队列余动作）、fizzled 2（`already_healthy` 满血治疗）。

**击杀分来源（killValue 按最后一击归属，unit_death + round_resolved 命中）:**
- 我 380 = `b233` heavy 100（R5）+ `3797` heavy 100（R7）+ `1097` ranger 80（R8）+ `9da3` heavy 100（R8）。**全部 4 杀在 R8 前完成，R8 后再无击杀。**
- 对手 255 = `068e` heavy 100（R8）+ `810c` infantry 55（R10）+ `9f95` heavy 100（R10）。
- 炮火击杀无归属：我 7 个炮火减员、对手 1 个炮火减员均不计任何人的 killValue。

**军力价值（armyValue）:** 我峰值 10 个单位 → R8 后 9 → R10 后 4 → R11 后 3 → R12 轮界 **0**；对手峰值 12 → 终局 **7**（armyValue 430）。逐轮 armyValue 数值未在回放中直接记录，**无法可靠统计逐轮军力价值曲线**，此处以存活单位数与终局 armyValue 为准。
**补给:** 我终局 267（R6 后无法部署、5 轮收入 260 几乎全囤下），对手 67（持续从湖心爆兵把收入转成军力）。**supplies 权重 0——我囤的 267 补给一分不值，对手的 67 却换成了 430 军力分。**

## 6. 经验教训（可执行）

1. **重新评估「0 收入」据点的战略价值——湖心维修点是部署垫，不是废点。** `cp_isle(0,0)` 收入 0、维修 3 看似鸡肋，但它 **可部署且 dist 0 永在安全圈**，是缩圈图里唯一能无限补兵到终局安全格的垫子。下次镜湖开局：**优先用机动单位（scout）抢湖心，而非只占对角补给点**；哪怕短期少 12 收入，也要拿到这个终局部署权。本局对手 R2 抢岛、我 R2 占补给，胜负手就此定下。

2. **缩圈图必须「向心收敛」，把军力搬进安全格，而不是在外圈换血。** 我 648 点炮火掉血、7 个炮火减员，全因主力滞留 dist 2–5 的外圈。`startRound 6` 前就应规划 inward 路线，R6 起每轮把单位往 dist≤safeRadius 收；**宁可少打一轮输出，也不要在警告环多停留**（damage 25 每轮全额、无视防御，停留 2 轮就掉 50，远超一次换血收益）。终局答案永远是「占住安全格」，对手 7 单位占满 7 岛格就是范本。

3. **击杀竞赛要能转化为阵地，否则只是给对手「即损即补」的消耗。** 我 R8 前 4 杀领先，但对手每损一个就从湖心垫补一个，我的击杀换不到地盘。聚焦火力没错，但**必须配合「占住关键格 + 断敌增援」**：本局我唯一岛缘立足点 inf1@(-1,0) R8 才上去、R10 就被拔，后续渗透又失败。应更早、更坚决地把 heavy 顶进岛格卡住栈道口，而不是反复在外圈 arc 换血。

4. **同时结算的渗透/抢格要算「敌方更早步骤」，别用 wait 把主动权让出去。** R10 我 3 个 wait 拖到 s6 才进 (-1,0)，对手 s3 就堵了口，导致 6 AP 全废、R11 整轮空转。抢关键格应**尽早步骤直接进**（或预判敌方堵口改瞄他格），并记住「死亡腾出的格子会被敌方同轮重占」；队列里前置动作失败会沿依赖链废掉后续动作，排布时给关键移动留容错。

5. **形状攻击先验算覆盖格，再提交。** R9 H4 arc 瞄 (-1,0) 实际覆盖 `(-2,1),(-1,0),(-1,-1)`，够不到 (-1,1) 的敌人而 MISS。`arc` 必须瞄**相邻格**定向、覆盖该格及左右邻格；提交前用 `HEX_DIRECTIONS` 核对目标是否真在扇形内，避免白扔 AP（本局 29 次攻击 3 次落空，其中这次纯属几何算错）。

6. **权重决定运营方向：supplies/controlPoint 权重 0 时，囤补给和占点都不加分。** 我终局 267 补给、2 个据点，却因 armyValue 0 只拿 570 分。`armyValue 5` 才是大头——**收入要尽快转成「活着的、站在安全格的军力」**，而不是银行里的数字。R6 后我部署垫失效就干脆囤钱，等于放弃军力分；正确做法是抢湖心垫继续爆兵，或把现有军力收拢进岛保住 armyValue。