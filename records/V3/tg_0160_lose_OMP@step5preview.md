# 战术游戏歼灭模式复盘 — `player_a` 视角（对局总结 tg_0160）

**日期/游戏ID/回放版本:** 2026-09-24 / `918739bf-a52c-4bbf-a180-872ccde72b01` / `schemaVersion 3.5.5`（`format: hex-v2-replay`，`records/V3/tg_0160_20260924.json`，`exportedAt 2026-09-23T20:03:45.815Z`，`eventCount 214`）
**地图/参战人数:** `artillery-zone`（炮火禁区，半径 6 pointy-top，127 格**全 plain**、无 blocker/水域；6×`forward_base` 在 dist4 外环 + 6×`supply` 在 dist3 内环）/ 2 人；**模式:** `annihilation`
**玩家:** `player_a` = step5-OMP（`OMP`@step5preview）
**席位与出生:** `player_a`，出生槽 `slot_east`，行动顺序第 1 位（先手，`turnOrder: ["player_a","player_b"]`），出生据点 `cp_east`(4,0)；初始单位 infantry `4345d40d`@(5,0)、infantry `b30b19cd`@(5,-1)、heavy `5ff591c6`@(4,1)；**HQ：不适用（无HQ）**
**对手:** `player_b` = Hy4-WB（`WB`@hy4），出生槽 `slot_west`，初始单位 infantry `a33cb960`@(-5,0)、infantry `80b05356`@(-5,1)、heavy `069ea11f`@(-4,-1)，出生据点 `cp_west`(-4,0)
**结果:** ❌ 第 2 名 — `turn_limit_score`（打满 `maxTurns=12` 整轮，按 `armyValue×2 + actionScore` 裁决，winner=`player_b`；全程无 `player_eliminated`、无 `mutual_annihilation`、无 `turn_skipped`/`host_eliminated`，房主未干预）
**结束轮次:** 第 12/12 整轮；**最终存活单位/补给:** 2 / 145

## 最终排名与淘汰

| 名次 | 席位 | 状态 | 总分 | 军力价值×2 | 据点 | 主要死亡/优势原因 |
|---|---|---|---:|---:|---:|---|
| 1 | `player_b`（Hy4-WB） | active | **1226** | 586（293×2） | 6 | 第 4 轮起 6 据点满经济（44 收入/轮 vs 我 28），滚出 9 单位、418 补给军备，炮火承伤 175 仍靠数量压死 |
| 2 | `player_a`（step5-OMP） | active | **370** | 50（25×2） | 3 | 军力被逐轮消耗（6 死 vs 敌 3 死），零炮火承伤也救不回经济差 |

终局军力明细（无双删）：我军仅剩 `b30b19cd` infantry 55HP@(1,-2)（价值 25）；敌军 7 单位存活（价值 293）。**全程无人被歼灭淘汰，9 次 `unit_death` 全部为战斗致死，炮火 0 击杀。**

## 炮火与安全区时间线

配置（本局 `game_start`）：`startRound=5, intervalRounds=2, damage=25, minimumSafeRadius=2`，实测收缩 R5→rad5、R7→rad4、R9→rad3、R11→rad2；`dangerCells = dist > safeRadius`（dist3 在 rad3 当轮仍安全，rad2 起才危险——本篇 dist 均按 `max(|dq|,|dr|,|ds|)` 重算，纠正在对局中一度误算 (3,-3) 为 d6 的错误，实为 **d3**）。

| 轮次 | safeRadius | warning/danger 关键格 | 我的单位(dist) | 对手关键单位(dist) | 撤离/承伤/击杀 | 决策评价 |
|---|---:|---|---|---|---|---|
| R1-R3 | 6 | 无 warning | 全部 d≤3 | 全部 d≤4 | 无 | ✅ 开局单位在最内三环 |
| R4（`artillery_warning`） | 6 | warning = **d6 环** | 最远 (3,1)d4 | 最远 (0,-4)d4、(-4,4)d4 | **双方 0 单位在 warning 环** | ✅ 空预警，无需动作 |
| R5（shrunk） | 5 | danger = d≥6 | 全部 d≤4 | 全部 d≤4 | 0 承伤 | ✅ |
| R6（warning） | 5 | warning = **d5 环** | (3,1)d4（新 ranger） | (0,-4)d4 | 双方 0 单位在环上 | ✅ |
| R7（shrunk） | 4 | danger = d≥5 | 全部 d≤4 | (0,-4)d4 仍安全 | 0 承伤 | ✅ 但 R7 我把 scout 部署在 (4,-1)d4 = **下一档 warning 环**，属自找 |
| R8（warning） | 4 | warning = **d4 环** | (4,-1)d4 新 scout 在环上（当轮移至 (1,-2)d2 逃离，同轮战死） | **(0,-4)d4 在环上未撤** | 0 承伤 | ⚠️/❌ 我的撤离是被动正确；对手 ES2 `836b30aa` 占着 `cp_northwest` 拒撤，R9 必吃 25 |
| R9（shrunk） | 3 | danger = d≥4 | (3,-3)d3 安全；**`cp_east`(4,0)d4 落入 danger → 我的部署通道断** | 开局 ES2 (0,-4)d4 吃 25（65→40） | 我 0 : 敌 25 | ❌ 我只试了 `cp_east` 被拒就判定"双方都无法部署"，未尝试 `supply_east`(3,0)d3 / `supply_northeast`(3,-3)d3 两个合法原点（rad3 下 d3 安全） |
| R10（warning） | 3 | warning = **d3 环** | **(3,-3)d3 在环上，当轮撤至 (1,-2)d2** | ES2 退 (0,-3)d3、新部署 (-3,1)d3、(-1,-2)d3、(-2,-1)d3 全在环上 | 0 承伤 | ✅ 本局唯一一次主动预警撤离，执行正确；对手四单位拒撤 |
| R11（shrunk） | 2 | danger = d≥3 | 全部 d≤2 | (0,-3)d3、(0,-3) 四张 d3 脸 | **敌 4 单位各吃 25**（ES1 65→40、`c7756e9e` 100→75、`6c710b75` 100→75、`cb9d8cbc` 100→75） | 我 0 : 敌 100 |
| R12（damage） | 2 | danger = d≥3 | 0 | `6c710b75`(-2,-1)、`cb9d8cbc`(-3,1) 仍赖在 d3，再各吃 25（→50） | 我 0 : 敌 50 | 对手连续两轮零撤离纪律 |

**规范六问作答：**
1. **首次 `artillery_warning`（R4）外圈单位数：双方均为 0**（warning 环为 d6，我最远 (3,1) 只有 d4）。该撤未撤的名单从 R8 才开始积累，且全是敌方位。
2. **各次收缩对路线/占点优先级的影响：** R5/R7 零影响；**R9 收缩把 `cp_east`（d4）打成 danger，直接切断我的部署通道**（`invalid_deploy: cannot deploy inside the artillery zone`，实测）；R10 warning( d3 环 )命中 `(3,-3)` 上的守军 I2，被迫内撤——**据点未中立化（占点单位离开不丢 CP，本局 0 次 `control_point_neutralized`），收入照发**，这是相反的好消息。
3. **`artillery_damage` 总账：我 0（0 事件）: 敌 175（7 次事件、5 单位，其中 `6c710b75`、`cb9d8cbc` 各中两发）**；炮火击杀 0:0。敌方 175 点全部可通过 R8/R10 撤离避免；我方 0 点中约 25 点也差点送掉（R7 scout 误降 d4 warning 环），靠当轮移走躲过。
4. **既供收入又供部署的据点：** 我峰值 3 个——`cp_east`(d4，部署通道，R9 断)、`supply_east`(3,0)d3、`supply_northeast`(3,-3)d3（收入 28/轮 + **本应继续可用的部署通道直到 R10**）。敌方峰值 6 个——`cp_west`(d4)×1 次部署、`supply_west`(-3,0)d3×5 次、`supply_northwest`(0,-3)d3×2 次（**通道活到 R10**）。差距不在据点数本身，在**据点环位：d3 supply 环比 d4 forward_base 晚两轮进 danger**。
5. **集火排序：** 遵守"可击杀→高价值"：R5-R6 双单位合击敌 ranger（72 价值，82 伤害三轮收掉）、R7-R9 三击收 E1 步兵、R10-R12 磨 EH。**但交换比难看（我军 6 死 : 敌 3 死，战斗伤害 571 吃 : 363 出）**，根因是 4v9 的接战面，不是选靶错误；R8 明知 3 敌围剿仍送 65HP scout 去补刀 4HP 的敌 ranger 是过度投刃。
6. **轮数上限裁决：** HQ 伤害/HQ HP 两项**不适用（无HQ）**；据点权重 0（终局 3:6，不计分）；`supplies` 权重 0（我烂在仓库 145、敌 91，均计 0）；`armyValue` 权重 2：我 25→**50**，敌 293→**586**；`actionScore` 直接计入：我 320、敌 640。**总分 370:1226，分差 856 = 军力 536 + 行动 320。**

## 单位、据点和补给时间线

**经济账（events `income` 逐轮核对）：** 起始双方各 45。我军收入 R2=20 → R3-R12=28×10（`cp_east`4+`supply_east`8+`supply_northeast`8+base8，第 3 轮起锁死）；敌军 R1=12 → R2=20 → R3=36（4 据点）→ R4-R12=44×9（6 据点）。累计我军 300，敌军 464。

**部署账（`deploy`×13，我方 4 / 敌方 9）：**

| 轮 | 我方 | 来源据点 | 落点(环) | 敌方 | 来源据点 | 落点(环) |
|---|---|---|---|---|---|---|
| R1 | infantry 45 | cp_east | (4,-1)d4 | scout 38 | cp_west | (-3,-1)d3 |
| R3 | — | | | scout 38 | supply_northwest | (0,-4)d4（占 `cp_northwest` 就地当守军） |
| R4 | **ranger 72** | cp_east | (3,1)d4 | ranger 72 | supply_northwest | (0,-2)d1 |
| R5 | — | | | infantry 45 | supply_west | (-2,-1)d3 |
| R6 | infantry 45 | cp_east | (3,1)d4 | infantry 45 | supply_west | (-2,0)d2 |
| R7 | scout 38 | cp_east | (4,-1)d4 | infantry 45 | supply_west | (-3,1)d4 |
| R8 | — | | | infantry 45 | supply_northwest | (-1,-2)d3 |
| R9 | **应部署未部署** | `supply_east`(d3) 合法 | (3,-1)/(2,0) 等 | infantry 45 | supply_west | (-2,-1)d3 |
| R10 | **应部署未部署** | 同上 | 同上 | infantry 45 | supply_west | (-3,1)d3 |
| R11-R12 | 双方全部据点进 danger，部署归零 | | | 同左 | | |

我军共花 200 补给出 4 单位，敌军花 418 出 9 单位；**R9/R10 我各握 61/89 补给却零新增军力（白丢约 2×45 军力价值 = 180 裁决分 + 20 行动分）**，终局 145 补给烂仓（权重 0，不构成裁决分）。

**capture 账（`control_point_captured`×7，我方 2 / 敌方 5）：** R1 我取 `supply_east`(3,0)，敌取 `supply_west`(-3,0)；R2 我取 `supply_northeast`(3,-3)，敌连取 `supply_northwest`(0,-3) 与 `supply_southwest`(-3,3)；R3 敌再取 `cp_northwest`(0,-4) 与 `cp_southwest`(-4,4)。**R3 结束后敌 6:我 3，此后再未翻转——本局实际在第三轮已经结束。**

**战斗时间线（`attack`×42，我方 15 击 363 伤害 / 敌方 21 击 571 伤害；`unit_death`×9）：**
- R3 敌 E1+EH 双打我的 I3：22+27（100→51）
- R4 敌 ER+EH 双打 I3：37+32（→0 阵亡）← 转折点
- R5 我 R→ER 40、H→EH 27、I1→E1 20；敌 ER→R 40、EH→R 32、E1→I1 25（我的 ranger 72→0 阵亡）
- R6 我 I1→ER 28、H→EH 22；敌 ER/E1/EH 三打 I1：33+23+28（75→0 阵亡）
- R7 我 H→E1 27；敌 EH/E1/ER 三打 H：24+18+29（150→79）
- R8 我 scout→ER 14（ER 4→0 阵亡）、H→E1 33；敌 EH/E1/E3 三打 scout：32+28+28（65→0 阵亡）
- R9 我 H→E1 28（E1 20→0 阵亡）、I4→EH 17；敌 EH+E3 双打 H：25+19（79→35）
- R10 我 H→E3 33、I4→EH 16；敌 EH+E3 双打 H：26+15（35→0 阵亡）
- R11 我 I2→ES2 26、I4→EH 15；敌 EH+E3 双打 I4：30+21（100→49）
- R12 我 I2→ES2 23（ES2 14→0 阵亡）、I4→E3 19；敌 EH+E3 收 I4：32+21（→0 阵亡），`6c710b75`/`c7756e9e` 收尾 I2：22+23（100→55，终局价值 25）

## 核心教训与关键转折

1. **【炮火 → 据点】R9 收缩是本局第二次死亡通知，我却读错了行动项。** `cp_east`(d4) 进 danger 只是关掉一个部署通道；同轮我的两个 d3 据点（`supply_east`、`supply_northeast`）仍合法可部署（实测拒绝语只针对 d4 原点）。我按"全部据点都进 danger"的臆测停掉整条增援线，R9/R10 白丢 2 个单位。触发条件：收缩 warning/拒绝语出现时，**逐个枚举己方据点 dist 与 safeRadius 的关系**，而不是取第一个原点被拒后的结论。
2. **【接战】R3 把 I3 单独送到 (0,0) 是战术死局的起点。** 当时 EH(-2,0)、E1(-3,0) 距其 2 格，我的 H/I1 还在 3 格外；R4 敌 ranger 上线后 (0,0) 成夹角，I3 两轮蒸发。触发条件：无重甲/无第二接应单位时，**不把轻甲步兵提前钉在敌方两单位夹角格**。正确做法：I3 停 (1,0)，H 占 (0,2)，等敌方先动。
3. **【集火】R5-R6 对敌 ranger 的 82 伤害合击用了双单位两轮，同期我方中心被反打掉 1 步兵 + 1 ranger。** 不是不该杀 ranger（72 价值该杀），而是**该用射程单位在 3 格外消耗，而不是把 I1 贴上去换血**——R6 I1 突进 (1,-2) 攻击 ER 的 28 伤害换来三打一的 84，是我军第二轮崩盘的直接原因。
4. **【炮火纪律】本局唯一做满分的项目：零炮火承伤。** R10 warning(d3 环)命中守军 I2，当轮撤到 (1,-2)d2；对比对手连续两轮无视预警白送 175。教学结论：**"d3 环在 R9/R10 是黄牌格，能撤就撤"**——但前提是 R8 时别把新兵部署进 warning 环（我的 (4,-1) scout）。

## 炮火、军力与裁决分账本

本局 `adjudicationWeights`：`enemyHqDamage=0, ownHqHp=0, controlPoint=0, armyValue=2, supplies=0, effectiveActions=10`。

| 项目 | 我（player_a） | 敌（player_b） | 权重 | 依据 |
|---|---:|---:|---:|---|
| HQ伤害 | 不适用（无HQ） | 不适用（无HQ） | 0 | `mode: annihilation` |
| HQ最终HP | 不适用（无HQ） | 不适用（无HQ） | 0 | 同上 |
| 最终据点数 | 3 | 6 | 0 | `control_point_captured`×7（我 2 敌 5，开局据点各 1） |
| 存活军力价值 | 25（1 残兵 55HP） | 293（7 单位） | **×2** | `game_over.scores` |
| 剩余补给 | 145 | 91 | 0 | `income` 累计 300/464，部署花 200/418，期初各 45 |
| `actionScore` | 320 | 640 | ×10 计 | 行动事件（部署 4/9、占点 2/5、攻击 363/571 伤害换算） |
| 炮火承伤/击杀 | **0 / 0** | **175 / 0** | — | `artillery_damage`×7 全在敌手；`unit_death`×9 全为战斗致死 |
| **总分** | **370** | **1226** | — | `game_over.payload.scores` |

**分差解剖：** 856 = 军力项差 536 + 行动项差 320。军力差的根源不是单次交换（我战斗伤害 363 vs 敌 571，差距 208 点输在接战面数量），而是**部署量 200 vs 418**——418-200=218 的军备差，乘以权重 2 后恰为 536 的几乎全部来源。

## 实际做法 vs 正确做法

1. **致命错误①（R3，触发条件：敌方重甲/第二单位 2 格内）：** 独兵推进至 (0,0)。实际：I3 两轮被合击蒸发。正确：轻甲不破秩，贴着重甲(0,2)与 I1(1,0) 布三角，逼对手先交第一轮。
2. **致命错误②（R9-R10，触发条件：任一据点部署被 `invalid_deploy` 拒绝）：** 停止全部部署，145 补给烂仓。实际：2 个 d3 据点可继续出步兵至 R10。正确：拒绝后枚举全部己方据点 `dist vs safeRadius`，换原点再部署；d3 据点比 d4 据点晚两轮禁部署，order 应是"d3 supply → d4 forward"。
3. **低效行动③（R7-R8）：** scout 落 (4,-1) 进 warning 环，再自杀式补刀 4HP 敌 ranger。实际：38 补给换掉 ER 最后一滴（本可由任意单位完成）。正确：scout 占无主 `cp_southeast`(0,4) 或留守 d3 格；补刀交给贴得住的残血单位。
4. **本局做对、须保持：** R10 主动撤离 warning 环（0 炮火承伤）、R1-R2 连下两个 supply 点、对 ER 的集火序列（可击杀→高价值排序本身没错，错在执行位）。

## 与历史对局对比

| 指标 | tg_0160（本局，OMP@step5preview） | tg_0156（OMP@step5preview，同图，2 名） | tg_0156 对手 WB@Dsv4.1Flash0910（同图，1 名） |
|---|---:|---:|---:|
| 首次 warning(d6) 外圈单位 | 0 : 0 | 0 : 0 | 0 : 0 |
| 各次收缩前未撤离单位数 | 敌 4+2+2（R11/R12 连环） | 我 2 : 敌 2（R11） | 0 |
| 炮火承伤 | **我 0 : 敌 175** | 我 50 : 敌 100 | 敌视角承伤少 |
| 炮火/战斗击杀 | 炮火 0:0，战斗 我 3 : 敌 6 | 炮火 0:0，战斗 0:0 | — |
| 峰值据点/收入 | 3 : 6（28 : 44） | 6 : 4 | 6 : 4 |
| 最终死亡原因 | 全战斗致死，`turn_limit_score` | 同左 | 同左 |
| 排名 | 第 2（370:1226） | 第 2（640:1184） | 第 1（1184:640） |

**跨局结论：同一张 `artillery-zone` 上，OMP 已两次以“第 2 名 + `turn_limit_score`”收场，胜负手完全一致——R3 前能否把东侧两个 d3 supply 环拿到手并守住**。0156 我峰值曾到 6 据点仍输在中期被连偷 2 个；本局从 R3 起就 3:6 再未翻身。0156 的胜者（WB）与本局胜者（Hy4-WB）都握住了 `supply_west`+`supply_northwest`+`supply_southwest` 三件套并持续用 d3 据点出到 R10；0152（同图）胜者同样走了这条路。**"先手方拿 d3 环"应写进开局 checklist：R1 两步兵去最近两个 supply 点，比 R1 部署一个 45 兵力更接近胜利。**

## 总结

> **核心口诀：收缩环先杀远据点——d3 supply 环比 d4 forward_base 晚两轮禁部署，部署通道跟着据点环位活；一个据点部署被拒时，枚举全部据点再下结论。**

**一句话总结：零炮火承伤、3 个击杀、363 伤害全部合格，输在 R3 就被判了死刑——歼灭模式的军备权在 d3 据点环里，先手方第一轮不 all-in 抢环，后面十二轮都在还债。**
