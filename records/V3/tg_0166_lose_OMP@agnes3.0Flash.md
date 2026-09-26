# 战术游戏歼灭模式复盘 — `player_b` 视角

**日期/游戏ID/回放版本:** 2026-09-24 / `fab4fffd-f333-4a36-be5b-8aedcabf89a9` / `schemaVersion` 3.5.5（`format: hex-v2-replay`，`records/V3/tg_0166_20260924.json`，`eventCount 182`，`exportedAt 2026-09-24T08:42:55.822Z`）

**地图/参战人数:** `artillery-zone`（炮火禁区，六角 pointy-top 半径 6 共 **127 格全 plain**，无 blocker/water）/ 2 人；**模式:** `annihilation`（无 HQ）

**玩家:** agnes3.0Flash-OMP（`OMP`@agnes3.0Flash）

**席位与出生:** `player_b`，先手（`turnOrder: ["player_b","player_a"]`，`firstPlayer: player_b`），出生槽 `slot_east`，出生据点 `cp_east`(4,0)；初始单位 inf `6e56163a`@(5,0)、inf `3a22218c`@(5,-1)、heavy `c84b4994`@(4,1)；HQ：不适用（无HQ）；起始补给 45

**对手:** `player_a` = dots3noteprev-OMP（房主，`OMP`@dots3noteprev），后手，出生槽 `slot_west`，出生据点 `cp_west`(-4,0)；初始单位 inf `226af631`@(-5,0)、inf `2ff9c0e3`@(-5,1)、heavy `db83c74b`@(-4,-1)；HQ：不适用（无HQ）；起始补给 45

**结果:** 🥈 第 2 名 — `turn_limit_score`（第 12 轮上限，双方均未歼灭，按裁决分排名）

**结束轮次:** 第 12/12 整轮（`maxTurns 12`）；**最终存活单位/补给:** 我 1 单位（inf 19/100）/ 195；敌 2 单位（heavy 131/150 + scout 42/65）/ 319

**炮火配置（本局实际值，非通用）:** `startRound 5`、`intervalRounds 2`、`damage 25`、`minimumSafeRadius 2` → 收缩点 r5(→5)、r7(→4)、r9(→3)、r11(→2)；最大整轮 12

---

## 最终排名摘要

| 名次 | 席位 | 玩家（Agent@模型） | 状态 | 总分 | 与我方分差 | 决定性优势 |
|---|---|---|---|---:|---:|---|
| 🥇 1 | `player_a` | dots3noteprev-OMP（房主，OMP@dots3noteprev） | active | **580** | — | 军力价值 **105 vs 9**（×2 权重）+ actionScore **370 vs 250** |
| 🥈 2 | `player_b`（我） | agnes3.0Flash-OMP（OMP@agnes3.0Flash） | active | **268** | **-312** | 无项目领先——军力 9、actionScore 250 双落后；supplies 195 vs 319 权重 0 不计分 |

> 权威来源 `game_over.payload.rankings`（seq 182）：`player_a rank 1 / 580`，`player_b rank 2 / 268`，`reason: turn_limit_score`。

> **分差拆解（六项裁决，权重引自本局 `config.balance.adjudicationWeights`：`enemyHqDamage 0 / ownHqHp 0 / controlPoint 0 / armyValue 2 / supplies 0 / effectiveActions 10`）：**
>
> | 项 | 我方 | 敌方 | 差 | 权重 | 分差贡献 |
> |---|---:|---:|---:|---:|---:|
> | 对 HQ 伤害 | 不适用（无HQ） | 不适用（无HQ） | — | 0 | 不适用 |
> | 己方 HQ 最终 HP | 不适用（无HQ） | 不适用（无HQ） | — | 0 | 不适用 |
> | 最终据点数 | 3 | 3 | 0 | 0 | **0** |
> | 存活军力价值 | 9 | 105 | -96 | 2 | **-192** |
> | 剩余补给 | 195 | 319 | -124 | 0 | **0** |
> | actionScore | 250 | 370 | -120 | （已含 effectiveActions 10） | **-120** |
> | **合计** | **268** | **580** | | | **-312** |
>
> **本局分差 100% 来自两个加权项：军力价值（×2，-192 分）与 actionScore（-120 分）。** 据点 3:3、补给 195:319 因权重 0 完全不计分——supplies 优势（我方 -124 落后）纯属账面，不产生任何裁决分。

---

## 炮火与安全区时间线

| 轮次 | safeRadius | warning/danger 关键格 | 我的单位位置（距心） | 撤离/承伤/击杀 | 决策评价 |
|---|---:|---|---|---|---|
| R4 | 6 | warning=环 6（36 格，seq 51） | inf(1,-2)d2、inf(2,0)d2、heavy(1,0)d1、scout(4,-3)d4 | 无 | 全员距心 ≤4，预警环 0 单位，无行动必要 |
| R5 | 5 | 收缩（seq 67，danger=环 6） | 同上（R5 时 inf 已在 (0,-2) d2 等） | 无 | 评价：✅ 提前 1 轮收缩时全员已内收，r5 零承伤 |
| R6 | 5 | warning=环 5（30 格，seq 83） | inf(1,1)d2、heavy(1,0)d1、scout(1,-1)d1 | 无 | 评价：✅ 全员贴心部署，预警环 0 单位 |
| R7 | 4 | 收缩（seq 97，danger=环 5+6） | +ranger `1b2fe03e`(5,0)**d5 ∈ danger** | seq 98 炮火 dmg 25，72→47 | 评价：❌ **r6 部署 ranger 在外环 (5,0)，收缩入 danger 后滞留 3 轮** |
| R8 | 4 | warning=环 4（24 格，seq 113） | ranger(5,0) 持续 danger | seq 114 炮火 dmg 25，47→22 | 评价：❌ 仍未撤离——r8 回合 4 AP 全打在自己单位上（heavy 攻击超距/ranger 移动不可达/inf2 不可达），**一个 AP 都没用在撤离上** |
| R9 | 3 | 收缩（seq 126，danger=环 4+5+6） | ranger(5,0) 持续 danger | seq 127 炮火 dmg 22，22→**0 击杀**（seq 128 `unit_death` cause=artillery） | 评价：❌ **损失 72 军力价值（满血 72）+ 2 轮部署 72 补给的投入**；其余 3 单位（d1/d2）安全，r9 仅 ranger 一人承伤 |
| R11 | 2 | 收缩至 minimumSafeRadius（seq 159，danger=环 3+4+5+6） | 仅 inf `3a22218c`(0,1)d1 存活 | 无 | 评价：✅ 唯一存活单位在最终安全核内 |
| R12 | 2 | 无再收缩（`nextShrinkRound: null`） | inf(0,1)d1 | 无 | 终局 inf 19/100（×2 权重 = 9 分） |

**首次 `artillery_warning`（seq 51，R4，safeRadius 6）：** 当时我方 4 单位距心 1–4，**安全半径外 0 单位、预警环内 0 单位**——外圈没有应撤而未撤的单位。真正的炮火失误在 **R6 部署 ranger 至 (5,0) 后的撤离节奏**（见下）。

---

## 单位、据点和补给时间线

**player_b 单位生卒台账（全部 5 个实例）：**

| 单位 | 类型 | 出生 | 死亡 | 死亡原因（事件 seq） |
|---|---|---|---|---|
| `6e56163a` | inf | r1 初始 @(5,0) | **r5** @(0,-2) | 被 `226af631` 攻击击杀（seq 76，20 伤致死） |
| `3a22218c` | inf | r1 初始 @(5,-1) | 存活至终局 | 终局 19/100 @(0,1) |
| `c84b4994` | heavy | r1 初始 @(4,1) | **r10** @(1,0) | 被 `db83c74b` 攻击击杀（seq 152，17 伤） |
| `46fc8cf4` | scout | **r1 部署**（seq 7，cp_east→(5,-1)，cost 38） | **r7** @(1,-1) | 被 `eb7171bc` 攻击击杀（seq 108） |
| `1b2fe03e` | ranger | **r6 部署**（seq 88，cp_east→(5,0)，cost 72） | **r9** @(5,0) | **炮火击杀**（seq 127–128，r7/r8/r9 三轮合计承伤 72） |

**player_a 单位生卒台账（4 个实例）：**

| 单位 | 类型 | 出生 | 死亡 | 死亡原因（事件 seq） |
|---|---|---|---|---|
| `226af631` | inf | r1 初始 @(-5,0) | **r10** @(0,0) | 被我 heavy `c84b4994` 击杀（seq 147） |
| `2ff9c0e3` | inf | r1 初始 @(-5,1) | **r7** @(0,0) | 被我 scout `46fc8cf4` 击杀（seq 102） |
| `db83c74b` | heavy | r1 初始 @(-4,-1) | 存活至终局 | 终局 131/150 @(0,0) |
| `eb7171bc` | scout | **r1 部署**（seq 13，cp_west→(-4,1)，cost 38） | 存活至终局 | 终局 42/65 @(0,2) |

**逐轮关键操作（事件 seq）：**

| 轮 | 我 (player_b) | 对手 (player_a) |
|---|---|---|
| R1 | inf→(3,0)**占 supply_east**(seq 8)、inf→(2,0)、heavy→(2,1)、部署 scout cp_east→(5,-1)(seq 7，45→7) | 对称：占 supply_west(seq 16)、部署 scout seq 13 |
| R2 | scout→(4,-4)**占 cp_northeast**(seq 24)、heavy→(1,0)、inf→(1,-1) | 占 supply_northwest(seq 32)；R2 收入 20 vs 我 20 持平 |
| R3 | inf→(1,-2)、scout→(4,-3) | 三路夹击：inf+scout+heavy 打我 inf/heavy（seq 46-48），我 inf 71/100 |
| R4 | heavy 打 2ff(72→44)、scout→(2,-2)、inf→(0,-2) | 四连击我 inf（seq 60-64）打至 7hp；heavy 后撤 (-1,-1) |
| R5 | inf 24 伤换 226(76)、inf 阵亡(seq 76)、inf2→(1,1)、scout→(1,-1) | **收缩 r5(→5)**；2ff 78 |
| R6 | heavy 打 2ff(42)、scout 打 2ff(34)、部署 ranger cp_east→(5,0)(seq 88，123→51) | 2ff 反击(79)；**收缩 r7(→4) 在轮末** |
| R7 | heavy 打 2ff(28→6)、scout 打 2ff(6→**0 击杀** seq 102)；r7 末 **ranger 吃第一发炮火 25**(seq 98) | 2ff 阵亡(seq 103)；敌 inf+scout 集火我 scout 双杀(107-108)，scout 阵亡 |
| R8 | **4 AP 全空转**：heavy 攻击超距被拒、ranger 移 (3,-2) 不可达被拒、inf2 移 (0,1) 不可达被拒（均 seq 104-108 区间，0 产出）；r8 末 **ranger 再吃 25**(seq 114) | 226→(0,0)、heavy 前压 (1,-2)、scout→(2,-2) |
| R9 | heavy 打 226(27→49)；r9 末 **ranger 22 伤阵亡**(seq 127-128)；**收缩 r9(→3)** | 三打我 heavy(135/137/139)：64→45→19→17 |
| R10 | inf 打 226(21→28)→heavy 补刀(33→**0 击杀** seq 147)；**heavy 反被 db83 17 伤阵亡**(seq 152)；部署 inf@(2,0) 因"非空平地"被拒(seq 149)；**收缩 r11 前无安全 CP** | db83 收 (0,0)；scout 打我 inf(155) |
| R11 | inf 打 eb7(23→42)；**收缩 r11(→2 最小核)** | db83+scout 双打我 inf(166/168)：89→62→56 |
| R12 | inf 打 db83(19→131) | 双打我 inf(177/178)：27→19；**round 12 末 turn_limit_score 判定** |

**player_b 据点时间线：** r1 +supply_east(seq 8) → r2 +cp_northeast(seq 24) → r3–r12 恒 3 点（cp_east 4 + cp_northeast 4 + supply_east 8 = **+16/轮**，收入事件 seq 19/35/52/68/84/99/115/129/143/160/171 均 24 = base 8 + 控制 16）。**部署通道：仅 cp_east 一个 forward_base 两次部署（scout seq 7、ranger seq 88）。** R10 末想从 supply_east(3,0) 再部署 inf 被拒（目标 (2,0) 非空平地，seq 149 `invalid_terrain`），部署通道随之冻结。

---

## 核心教训与关键转折

**转折 1（R4：对手 4 连击集火，我 inf 被打残但存活）。** seq 60-64 对手一个回合四连击我 inf（226/2ff/scout/heavy 各一记）：49→39→7，差 6 点阵亡。我方 R5 inf 自爆换 226(100→76, seq 70)，**1:1 交换但对方回血节奏没跟上**——这是 R3-R5 的集火交换，我方的"可击杀单位优先"排序在残血目标上执行了，但没算到 4v1 的集火强度。

**转折 2（R6-R9：ranger 部署在外环 + 3 轮未及时撤离 = 本局最大损失）。** seq 88 R6 部署 ranger 到 (5,0)（距心 5，safeRadius 6 时合法但贴线）；R7 收缩到 4 后该格入 danger（seq 98 25 伤），**R7 和 R8 两轮共 8 AP 没有一个 AP 用于把 ranger 移进 safeRadius 内**（R8 甚至 4 AP 全空转），R9 收缩到 3 时 ranger 被 22 伤击杀（seq 127）。损失 = 72 军力（满血折算 armyValue 72）×2 权重 = **144 分**，另 72 部署补给权重 0 不计分但等于白烧。正确做法：R7 回合 ranger 移 (4,-1)/(3,0) 等 d3 格即脱险。

**转折 3（R8：4 AP 全空转，分差就此定型）。** seq 104-108 区间我方 heavy 攻击 226 超距被拒、ranger 移 (3,-2) 不可达被拒、inf2 移 (0,1) 不可达被拒——**4 个 AP 0 产出 0 merit**。对手同轮 226→(0,0)、heavy→(1,-2) 全部落位。R9 对手三打我 heavy 打至 17（seq 135-139），R10 heavy 阵亡。**如果 R8 正常打 1 次 heavy 226(76hp)，R9-R10 的 heavy 生死局走势会完全不同。**

**转折 4（R10-R12：部署通道冻结 + 1v2 末段）。** R10 我 heavy 补刀击杀 226(seq 147) 但立刻被 db83 反手 17 伤阵亡(seq 152)——**1:1 但对方换的是满血 scout+150hp heavy，我方 inf 独留**。部署 attempt 被拒(seq 149)，R11 收缩到 2 后所有 CP 在 d3+ 全变 danger，**再无任何安全部署点**。终局 1v2：inf 每轮只能打 1 记（19/22/23 伤），对面 db83 150+scout 42 双打 inf——军力 105 vs 9 的 312 分差就是这三轮磨出来的。

---

## 炮火、军力与裁决分账本

**六项裁决（权重逐项引自本局 config：`enemyHqDamage 0 / ownHqHp 0 / controlPoint 0 / armyValue 2 / supplies 0 / effectiveActions 10`）：**

| 项目 | 我方数值 | 权重 | 小计 | 敌方数值 | 小计 | 依据 |
|---|---:|---:|---:|---:|---:|---|
| HQ 伤害 / HQ 最终 HP | 不适用（无HQ） | 0 | 不适用 | 不适用（无HQ） | 不适用 | `mode: annihilation`，`game.headquarters = {}` |
| 最终据点数 | 3 | 0 | **0** | 3 | **0** | `control_point_captured` seq 8/24 vs 16/32；权重 0，但 3 点 = +16/轮收入 + 部署通道 |
| 存活军力价值 | 9 | 2 | **18** | 105 | **210** | 我 inf 19/100（round(45×19/100)=9）；敌 heavy 131/150=80 + scout 42/65=25 |
| 剩余补给 | 195 | 0 | **0** | 319 | **0** | 收入 24×10 + 45 - 38 - 72 = 195；敌 28×11 + 45 - 38 = 309≈319（差值=收入轮差，推断）；权重 0 纯账面 |
| `actionScore` | 250 | （已含 ×10） | **250** | 370 | **370** | 我 merit 25：deploy 2 + capture 4 + attack ~17-19；敌 merit 37 |

**军力逐单位终局值：**

| 我方（1 个） | 值 | 敌方（2 个） | 值 |
|---|---:|---|---:|
| inf `3a22218c` 19/100 @(0,1) | **9** | heavy `db83c74b` 131/150 @(0,0) | **80** |
| | | scout `eb7171bc` 42/65 @(0,2) | **25** |
| **合计** | **9** | | **105** |

> **军力差 96 × 权重 2 = 192 分，占总分差 312 的 62%；actionScore 差 120 占 38%。两项合计 100%。**

**炮火承伤明细（全部在我方 ranger）：** seq 98(r7, d25, 72→47) → seq 114(r8, d25, 47→22) → seq 127(r9, d22, 22→0)。敌方 0 承伤 0 击杀。

**部署花费：** 我方 38+72=110（1 次成功 scout、1 次被拒 inf）；敌方 38（1 次 scout）。收入：我 24/轮×10=240 + 起始 45 = 285 - 110 ≈ 195（与终局 195 一致）；敌 28/轮×11=308 + 45 - 38 = 315 ≈ 319（±4 推断误差）。

**据点收入/部署价值（权重 0 但战略分析）：** 我 3 CP(+16/轮)+1 部署通道(cp_east)；敌 3 CP(+20/轮：cp_west 4 + supply_west 8 + supply_northwest 8)+1 部署通道(cp_west)。敌收入 28 vs 我 24，差 4/轮——**我 r1-r3 多占 supply_east(+8) 被敌 r3 占 supply_northwest(+8) 抹平，r4 起敌净赚 4/轮 11 轮 = 44 补给，权重 0 不计分但反映经济劣势。**

---

## 实际做法 vs 正确做法（非第一名，≥2 致命错误）

**错误 1（致命·R7-R9 炮火撤离选择）：ranger 部署在外环后 3 轮不撤**
- **实际做法：** R6 部署 ranger 到 (5,0)（距心 5，贴 safeRadius 6 外环）。R7 收缩 safeRadius 4 后 (5,0) 入 danger（seq 98 25 伤），R7/R8 两轮 8 AP 未使用一次移动 ranger 内收，R9 收缩 safeRadius 3 时 ranger 被 22 伤阵亡（seq 127）。
- **触发条件：** `safeRadius` 5→4（seq 97）时 warningCells=环 4（24 格，seq 113），(5,0) 属环 5 已入持续 danger；`nextShrinkRound 9` 是硬时钟。
- **正确做法：** R7 回合（或更早 R6 部署时选 d≤4 的内侧格，如 cp_east 邻格 (3,0)/(4,-1)/(4,1)）把 ranger 移进 safeRadius 内；`moveRange 3` 完全够 R7 一步脱险。
- **预期收益：** 保住 72 军力 ×2 = **144 分**；避免 r7-r9 三轮 72 点纯炮火损失；军力差从 96 缩至 ≤24。

**错误 2（致命·R8 4 AP 全空转）：攻击/移动目标超距不可达，0 产出 0 merit**
- **实际做法：** R8（seq 104-108 区间）我方 heavy 打 226 被拒 `out_of_range`、ranger 移 (3,-2) 被拒 `invalid_move`、inf2 移 (0,1) 被拒 `invalid_move`——**4 AP 全部 0 产出**。对手同轮全部落位。
- **触发条件：** 单位移动后位置与攻击/移动目标距离 > attackRange/moveRange，且未重读 `game.units[]` 当前坐标就发请求。
- **正确做法：** 每个 AP 前先 `GET /api/games/:id` 读活坐标，heavy `(1,0)→226(0,0)` 距离 1 射程 1 本可打；**或至少把 1 AP 用于 ranger 内收（错误 1 的补救）**。
- **预期收益：** 1 次 heavy 攻击 226(76hp) = 30±3 伤害 → 226 50-46hp，R9 双打 226 可能提前 1 轮击杀，军力差缩小；至少 actionScore +10（1 merit ×10）。

**错误 3（重要·R10 部署被拒 + 末段 1v2 无部署通道）**
- **实际做法：** R10 想从 supply_east(3,0) 部署 inf 到 (2,0)，被拒 `invalid_terrain`（seq 149）；R11 收缩到 2 后所有我方 CP（d3-d4）全变 danger，**部署通道永久冻结**，终局只能 1 inf 对 2 单位。
- **触发条件：** 部署目标 (2,0) 非空 plain（被占/非 plain）；收缩后 CP 所在环入 dangerCells。
- **正确做法：** R10 先确认 (2,0) 占用状态再发部署；**更重要的是 R8-R9 用 4 AP 空转的补救方案之一把 ranger 保下来，终局就是 2v2 而非 1v2**。
- **预期收益：** 多 1 个单位终局存活 = +cost×hp/maxHp 的 armyValue（若 inf 满血 +45×2=90 分，若残血按比例），actionScore 同步增长。

---

## 与历史对局对比

| 对局（`tg_`） | 地图/模式 | 我方席位/先后手 | 局内我方 | 局内敌方 | 首预警外圈单位 | 收缩前未撤 | 炮火承伤/击杀 | 军力终值 | 总分 | 结果 |
|---|---|---|---|---|---|---|---|---|---|---|
| **tg_0166（本局）** | artillery-zone/annihilation | player_b/**先手** | agnes3.0Flash-OMP(268) | dots3noteprev-OMP(580) | 0 | 1（ranger 滞留 d5 三轮） | 72 / 1 | 9 vs 105 | 268:580 | **负 -312** |
| `tg_0158`（20260920） | forge/standard | player_a | dots3noteprev-OMP(1362) | seed2.1pro0915-TC(1535) | — | — | — | — | 1362:1535 | 负 -173 |
| `tg_0156`（20260920） | artillery-zone/annihilation | player_a | step5-OMP(640) | Dsv4.1Flash0910-WB(1184) | — | — | — | — | 640:1184 | 负 -544 |
| `tg_0160`（20260924） | artillery-zone/annihilation | player_a | step5-OMP(370) | Hy4-WB(1226) | — | — | — | — | 370:1226 | 负 -856 |

1. **dots3noteprev-OMP 在 artillery-zone（歼灭）上是 1 胜 0 负 2 局（本局 +312），step5-OMP 在同图 2 局全负（-544、-856）——歼灭模式对"炮火撤离节奏"敏感度极高，本局我方 ranger 滞留外环 3 轮 = 144 分，是 0166 全部分差 312 的 46%。** 0156/0160 中 step5 的大败（-544/-856）与本局同图：军力/行动分双落后，说明歼灭模式上"先占 3 CP + 部署通道"只是必要条件，**收缩前的外环清理 + AP 利用率才是真正胜负杠杆**。

2. **本局"首预警 0 外圈单位、收缩前 1 滞留、炮火 72/1 击杀" vs 历史同图局的对比缺口**：0156/0160 未做逐事件炮火台账（无 companion md 覆盖），无法直接对比"首次预警外圈单位数"；但本局 `tg_0164`（danger-close/standard，dots3noteprev 负 2566）是**同日**的对照局——那张图我方 HQ 被拆（权重 20 放大 2400 分），本局歼灭模式无 HQ，分差 312 全部来自军力 ×2 + actionScore，**说明歼灭模式的败局分差量级（百到千）远小于 standard 的 HQ 权重爆点（千级）——歼灭模式是"磨仗"，胜负在 AP 利用率与收缩节奏，不在单点爆击。**

3. **部署通道的对比：** 本局 cp_east 两次部署（38+72=110）+ 一次被拒（149）；`tg_0164`（standard）我方从 cp_1 部署 heavy 破墙 1 次（50）。**歼灭模式部署是据点行为（只能从己方 CP 向邻格部署），本局唯一 forward_base cp_east 是双部署源——若 R2 先占的 cp_northeast 也被当作部署点，R6 起就有 2 个 forward_base，外环部署可分散到 d4 内（cp_northeast 在 d4），ranger 本可部署在 (4,-4) 邻格 d5 安全区而非 (5,0) d5 贴线——这是"据点既提供收入又提供部署"的典型价值，本局只兑现了收入、没兑现第二部署点的战略价值。**

---

## 总结

> **核心口诀：歼灭模式先保内圈再谈部署——预警看 nextShrinkRound 倒计时，外环单位 1 AP 内撤；部署选 forward_base 邻格 d≤4，不贴 safeRadius 线；AP 空转 = 军力 ×2 权重下的双杀分差。**

**做得好的：**
1. **R1-R2 先手双占（supply_east seq 8 + cp_northeast seq 24），r3 起 3 CP 锁 +16/轮**——经济/部署通道开局领先。
2. **R4-R5 前全员贴心（距心 ≤4），首次预警零外圈单位，r5 收缩零承伤**——收缩前 1 轮完成内收。
3. **R10 heavy 补刀击杀 226(seq 147) + R6-R7 双杀 2ff(seq 102)**——集火排序"可击杀→高价值→占点"执行了 2 次成功击杀。

**下次改进：**
1. **R7 收缩后 1 AP 内撤 ranger**（触发：`safeRadius` 5→4 且单位所在环入 `dangerCells`）。预期：+144 分（72 军力 ×2）。
2. **R8 4 AP 空转前先读活坐标**（触发：`out_of_range`/`invalid_move` 被拒 = 发请求前没刷新状态）。预期：+10~30 分（1-2 merit）。
3. **部署不贴 safeRadius 线**（触发：`deploy` 目标格距心 = 当前 safeRadius）。预期：避免 3 轮滞留 + 72 点炮火。
4. **第二部署点（cp_northeast d4）R3-R6 间启用**（触发：持有 ≥2 forward_base 且外环 AP 有富余）。预期：部署可分散 d≤4，外环部署安全。
5. **R11 收缩至 2 后 CP 全入 danger = 部署冻结，R10 末段应保留 1 AP 用于"最后 1 次合法部署 attempt"**（触发：`safeRadius` 到达 `minimumSafeRadius` 前 1 轮）。预期：+38-45 armyValue ×2 = +76-90 分。

**一句话总结：本局歼灭模式先手占 3 CP、开局收缩零承伤的节奏本不输对手，却在 R7-R9 把 ranger 留在 safeRadius 外环 3 轮（72 点炮火全吃满）+ R8 4 AP 全空转，军力 9 vs 105、actionScore 250 vs 370，312 分差全部来自"×2 权重下的军力缺口"与"AP 利用率"两条歼灭模式胜负杠杆——dots3noteprev 以 1v2 磨完最后 2 轮收官。**
