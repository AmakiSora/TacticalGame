# 战术游戏歼灭模式复盘 — `player_a` 视角

**日期/游戏ID/回放版本:** 2026-10-05 / `eaa19719-f829-4723-abcf-0d53501efd58` / schemaVersion **3.5.10**（回放 [`records/V3/tg_0199_20261005.json`](tg_0199_20261005.json)，`format: hex-v2-replay`，300 条事件，exportedAt 2026-10-04T18:16:25Z，`game_start` = seq3，`game_over` = seq300）
**地图/参战人数:** `artillery-zone`（炮火禁区，hex / pointy / radius 6，127 格全 `plain`；12 据点 = 6×`forward_base`@d4 + 6×`supply`@d3）/ **2 人**；**模式:** annihilation
**玩家:** Hy4-WB（`WB@hy4`，逐次调用 REST API 手操，`wait-turn.mjs` 前台阻塞轮询，未使用 `ai-player.mjs` 代打）
**席位与出生:** `player_a`；slot_east，出生控制点 `cp_east`(4,0)（forward_base，income 4，d4，开局已归我）；初始单位 infantry `a1b79313`@(5,0)、infantry `81600c05`@(5,-1)、heavy `948dd1c7`@(4,1)，起始补给 45；**HQ：不适用（无 HQ，`headquarters:{}`）**
**行动顺序:** `turnOrder=["player_a","player_b"]`，`firstPlayer=player_a` ⇒ **我方每轮先手**
**对手:** `player_b` Dsv4Pro0813-QD（QD@dsv4pro0813；slot_west，出生控制点 `cp_west`(-4,0)，初始 infantry `5487b14d`@(-5,0)、infantry `83ae11f4`@(-5,1)、heavy `3c8f1a74`@(-4,-1)）
**结果:** 第 2 名/2 — **败** — `last_player_standing`（我方 `player_eliminated` seq299，reason **`artillery_destroyed`**：最后一支单位 `411edb76`（A7）在 R15 被炮火击杀致军队归零；全局**无** `turn_skipped`、**无** `host_eliminated`，房主无任何管理干预，以下得失全部归因于战术决策）
**结束轮次:** 第 15/**20** 整轮（`maxTurns: 20`，未到上限，因全歼提前结束）；**最终存活单位/补给:** 我方 0 / 221；对手 5 / 202

**本图裁决权重**（`game_start.payload.config.balance.adjudicationWeights`）：`enemyHqDamage: 0`、`ownHqHp: 0`、`controlPoint: 0`、`armyValue: 2`、`supplies: 0`、`effectiveActions: 10` ⇒ **据点与补给一分不值**，只有「存活军力价值」和「行动功绩」计分。
**本图炮火配置**（`config.annihilation.artillery`）：`startRound=5`、`intervalRounds=2`、`damage=25`、`minimumSafeRadius=**1**`（⚠️ 与我在同一张图打的 `tg_0188` 的 `minimumSafeRadius=2` 不同，本图会一路收缩到只剩中心 7 格）。
**本图行动点**（`balance.actionsPerTurn: 4`）：move 1 AP、attack 1 AP、**deploy 1 AP**（本局 R8 seq137/138 同回合两次部署即为证明）。其余：`startingSupplies: 45`、`baseIncome: 8`、`supply` 收入 8、`forward_base` 收入 4、`damageVarianceRange: 3`。

---

## 最终排名与淘汰

| 名次 | 席位 | 玩家 | 状态 | 总分 | armyValue（×2） | actionScore（merit×10） | 据点（权重0） | 补给（权重0） | 主要死亡/优势原因 |
|---|---|---|---|---:|---:|---:|---:|---:|---|
| 🥇 1 | `player_b` | Dsv4Pro0813-QD | active | **996** | 123 → **246** | **750**（merit 75） | 5 | 202 | 3 只 **ranger**（射程 3 / 攻 44）全程压制；**8 次交战击杀**；造成 887 点伤害；AP 54/56 |
| 🥈 2 | `player_a` | Hy4-WB（我） | **eliminated**（`artillery_destroyed`） | **460** | **0 → 0** | 460（merit 46） | **6（最多）** | **221（最多）** | **11 支单位全部阵亡**，其中 **7 支死于对手 ranger**；造成 393 点伤害、仅 1 次击杀；AP 51/56 |

**分差拆解（可核对，460 − 996 = −536）：**

| 来源 | 差值 | 说明 |
|---|---:|---|
| armyValue | **−246** | 我归零 / 敌 123（`stu` heavy 65hp×92/150=40.0 + 3×ranger 22hp×72/72=66.0 + infantry 38hp×45/100=17.0 ≈ 123） |
| actionScore（merit） | **−290** | 攻击 merit 我 28 / 敌 61 → **−330**；部署 merit 我 8 / 敌 6 → +20；占点 merit 我 10 / 敌 8 → +20 |
| 据点 / 补给 / HQ | **0** | 权重全部为 0（HQ 两项不适用），我 6 点 221 补给 **一分不值** |

**一句话扣账：输分几乎全部来自「远程缺位（−330）+ 军力清零（−246）」，而我在权重为 0 的据点数和补给数上反而是全场第一。**

---

## 炮火与安全区时间线

危险判定：`danger = d > safeRadius`（`src/engine/artillery.ts`），`warning` = 下一轮将沉降的那一环；伤害在**每轮开始按上一轮末站位**结算 ⇒ **预警轮是唯一撤离窗口**。收缩节奏：R5 6→5、R7 5→4、R9 4→3、R11 3→2、R13 2→**1**（`nextShrinkRound=null`，到底）。

| 轮次 | 事件(seq) | safeRadius | warning / danger | 我方单位位置（该轮**末**） | 撤离 / 承伤 / 死亡 | 决策评价 |
|---|---|---:|---|---|---|---|
| R4 | `artillery_warning` **seq57** | 6 | 下轮沉 d6 环（36 格） | A1(3,0)d3、A2(3,-2)d3、A3(2,2)d4、A4(3,1)d4、A5(2,-1)d2、A6(2,0)d2 | **危险环内 0 单位**，零承伤 | ✅ **Q1 答案：首次预警时外圈 0 单位** |
| R5 | `artillery_shrunk` **seq75** | 6→**5** | danger = d6（36 格） | A1(2,-3)、A2(3,-3)d3、A4(0,2)、A5(2,-1)、A6(2,0)、A7(1,2)d3 | 零承伤 | ✅ 全员已在 d≤3 |
| R6 | `artillery_warning` **seq95** | 5 | 下轮沉 d5 | 见「逐轮位置」 | 零承伤 | ✅ |
| R7 | `artillery_shrunk` **seq114** | 5→**4** | danger = d≥5（66 格） | 最外 A7(3,1)d4、A1(3,-2)d3 | 零承伤 | ✅ |
| R8 | `artillery_warning` **seq134** | 4 | **下轮沉 d4 环** | A7 由 (3,1)→(3,0)d3 ✅；**但我 seq137 随即把 A9 部署到 (4,-1)，正落在 d4 环里** | — | ❌ **一边撤 A7、一边把新兵投进同一条环**，自相矛盾 |
| R9 | `artillery_shrunk` **seq152** | 4→**3** | danger = d≥4（90 格） | A9(4,-1)**d4**、A2(3,-3)d3、A11(2,-2)d2 | `artillery_damage` A9 −25 → hp75 | ❌ **完全可避免**：A9 当轮及此后**从未移动** |
| R10 | `artillery_warning` **seq175** | 3 | **下轮沉 d3 环（含 A2@(3,-3)）** | A1(2,-1)、A2(3,-3)、A7(2,0)、A8(1,-1)、A9(4,-1)、A10(0,-1)、A11(2,-2) | —（承伤自 R11 起） | ❌ **4 AP 全用于移动，却没移动那两个该撤的**；且 45 补给未投放（本局最后一个合法部署窗口） |
| R11 | `artillery_shrunk` **seq195** | 3→**2** | danger = d≥3（108 格）；**我全部 6 个据点在此环内 ⇒ deploy 永久非法** | A2(3,-3)、A7(2,0)d2、A8(1,0)、A9(4,-1)、A10(0,-1)、A11(2,-2) | A2 −25(hp75)、A9 −25(hp25) | ❌❌ **致命**：我现金永远花不出去了 |
| R12 | `artillery_warning` **seq219** | 2 | 下轮沉 d2（含 A7@(2,0)、A11@(2,-2)） | A2(3,-3)、A7(2,0)、A10(0,-1)、A11(1,-1) | A2 −25(hp50)、**A9 −25(hp0)，seq222 `unit_death` `cause:"artillery"`** | ❌ A9 累计吃满 100 点纯炮火，0 输出 |
| R13 | `artillery_shrunk` **seq239** | 2→**1** | danger = d≥2（120 格），只剩中心 7 格 | A2(3,-3)、A7(2,0)、A11(1,-1) | A2 −25(hp25)、A7 −25(hp75)；同轮 A10 被 B8 击杀、A11 只剩 1 支机动单位 | ❌ 安全区已被敌 5 支单位占满，我无落位空间 |
| R14 | — | 1 | danger = d≥2 | 只剩 A7(2,0) | A2 −25(hp0) **seq266 `cause:"artillery"`**；A7 −25(hp50) | ❌ A2 在 (3,-3) 停滞 12 轮后被炮火清空 |
| R15 | — | 1 | 同上 | — | **A7 −13(hp0) seq292 `cause:"artillery"`** → seq299 `player_eliminated` | 终局 |

**炮火账：** 我方总承伤 **263**（11 次 `artillery_damage`），对手 **304**（14 次）。我方 263 点**全部落在 3 支单位上**：A9 100、A2 100、A7 63，且这 3 支**全部以 `cause:"artillery"` 阵亡**——即我方承伤 100% 转化为损失，没有一点是「值得的诱敌」。对手同样丢 3 支给炮火（B2/B4/B5），但它多出 2 支 ranger 撑到最后。

---

## 单位、据点和补给时间线

### 我方 11 支单位的完整归宿

| 单位 | 类型 / 造价 | 出生或部署（来源据点 → 坐标 / 当时是否危险） | 贡献 | 结局 |
|---|---|---:|---|---|
| A1 `a1b79313` | infantry 45 | 出生 (5,0) | 占 `supply_east`(R1)、`cp_northeast`(R3) = merit 4；**0 次攻击** | R11 seq214 死于 **B8 ranger** @(1,-1) |
| A2 `81600c05` | infantry 45 | 出生 (5,-1) | 占 `supply_northeast`(R2) = merit 2；**此后 12 轮零移动、零攻击** | R14 seq266 `cause:"artillery"` @(3,-3) |
| A3 `948dd1c7` | **heavy 92** | 出生 (4,1) | R3 打 B2 30；深入西南后被围 | R5 seq92 死于 **B6 ranger** @(-2,4)（我唯一重装） |
| A4 `910571fc` | infantry 45 | R1 seq7 `cp_east`(d4,安全) → (3,1) | 占 `cp_southeast`(R2)、`supply_southeast`(R3) = merit 4；R6 打 B5 21 | R8 seq146 死于 **B6 ranger** @(2,1) |
| A5 `70fec1fc` | infantry 45 | R3 seq44 `supply_east`(d3,安全) → (3,-1) | R6/7/8/9 连打 B1，**R9 完成本局我唯一击杀**（seq161） | 同轮 R9 seq167 被 **B6 ranger** 点掉 @(1,-1) |
| A6 `9d6d3822` | infantry 45 | R4 seq60 `supply_east`(d3,安全) → (2,0) | R9 打 B1 23 | R10 seq189 死于 **B8 ranger** |
| A7 `411edb76` | infantry 45 | R5 seq80 `supply_southeast`(d3,安全) → (1,2) | R11–14 四轮输出累计 70 伤害 | R15 seq292 `cause:"artillery"` @(2,0) |
| A8 `febd81a1` | infantry 45 | R6 seq102 `supply_northeast`(d3,安全) → (2,-2) | R11/12 打 B7 共 42 | R12 seq235 死于 **B8 ranger**（同轮被三打一 100 点） |
| A9 `8de48de0` | infantry 45 | R8 seq137 `cp_east`(**d4，已在 R9 预警环**) → (4,-1) | **无** | R12 seq222 `cause:"artillery"`（吃 100 点，从未移动） |
| A10 `fc9dbfe3` | infantry 45 | R8 seq138 `supply_northeast`(d3,安全) → (2,-3) | R11/12/13 打 B4 共 68 | R13 seq262 死于 **B8 ranger** @(0,-1) |
| A11 `1349f06b` | infantry 45 | R9 seq157 `supply_northeast`(d3,安全) → (2,-2) | R13/14 打 B3 31、打 B7 20 | R14 seq287 死于 B3 heavy @(1,-1) |

**结构性事实：我方 8 次部署**全部是 infantry（45/射程 1/攻 30）；**对手 6 次部署**为 3 infantry + **3 ranger**（R5 seq90、R9 seq172、R10 seq190，均 72/射程 3/攻 44）。
我方 11 支单位中 **7 支死于对手 ranger**（B6 杀 3、B8 杀 4），**我全程没有一个能打到射程 3 的单位**——这是本局最硬的账。

### 据点 / 收入 / 部署通道

| 轮次 | 占领（merit 2/次） | 我方补给（轮末） | 我方部署 | 对手补给（轮末） | 对手部署 |
|---|---|---:|---|---:|---|
| R1 | `supply_east`(A1) | 0 | A4 infra @cp_east 45 | 12 | B4 infra @cp_west 45 |
| R2 | `cp_southeast`(A4)、`supply_northeast`(A2) | 20 | — | 32 | — |
| R3 | `cp_northeast`(A1)、`supply_southeast`(A4) | 7 | A5 @supply_east 45 | 23 | B5 @supply_west 45 |
| R4 | — | 6 | A6 @supply_east 45 | 63 | — |
| R5 | — | 5 | A7 @supply_southeast 45 | 31 | **B6 ranger** @supply_southwest 72 |
| R6 | — | 4 | A8 @supply_northeast 45 | 26 | B7 infra @supply_west 45 |
| R7 | — | **48（闲置）** | **无部署** | 66 | — |
| R8 | — | 2 | A9 @cp_east 45 + A10 @supply_northeast 45 | 106 | — |
| R9 | — | 1 | A11 @supply_northeast 45 | 74 | **B8 ranger** @supply_west 72 |
| R10 | — | **45（未投放）** | **无部署 ← 最后一个合法窗口** | 42 | **B9 ranger** @supply_west 72 |
| R11 | — | 89 | 不可能：6 个据点全在 danger | 82 | 不可能（d≥3 已沉降） |
| R12–R14 | — | 133 / 177 / **221** | 无 | 122 / 162 / **202** | 无 |

- 我方收入峰值 **44/轮** = 基础 8 + 3 个 forward_base（`cp_east`/`cp_northeast`/`cp_southeast`，@d4，4/个 = 12）+ 3 个 supply（`supply_east`/`supply_northeast`/`supply_southeast`，@d3，8/个 = 24）；对手 **40/轮**（5 个据点）。**我收入更高、据点更多，却输了 536 分**——`controlPoint`/`supplies` 权重为 0 的直接体现。
- **部署通道关闭点：** `src/engine/deployment.ts:26` 规定来源据点**或**目标格在 danger 区内即 `invalid_deploy`。`cp_*`（d4）自 R9 起落入 danger；全部 `supply_*`（d3）自 **R11** 起落入 danger ⇒ **R10 之后我再也没有任何合法部署来源**。R10 我手握 45 补给、仍有合法组合（如 `supply_east`(3,0) → 邻格 (2,0)d2，当时为空），却把 4 AP 全花在移动上。
- **据点中立：** 全程 9 次 `control_point_captured` **全部来自中立抢占**（`previousOwner: null`），从未被对手夺走；6 次 `control_point_neutralized` 全部发生在 **R15 我方被淘汰时**一次性清空。⇒ **据点在整局都全额产出收入，我没有因为丢点损失任何收入；我损失的是把收入变成兵力的时间和通道。**
- **补给转化：** 我方总收入 45+536=581，花 360（8×45），转化率 **62%**，终局闲置 **221**；对手 45+508=553，花 351，转化率 63.5%，闲置 202。两边都大量闲置，但对手把同样多的钱换成了 ranger 而非 infantry。

---

## 六个必答问题

**Q1｜首次 `artillery_warning` 时外圈有多少单位，哪些应撤而未撤？**
首次预警 R4 seq57（warning = d6 环 36 格，next=5）：我方 6 支单位全在 d2–d4，**危险环内 0 支**，当时无需撤离。真正第一支踩进预警环的是 **R8**：A7@(3,1)d4（我当轮已 ✅ 撤到 (3,0)），但同一轮我又把 **A9 部署到 (4,-1)d4** —— 明撤一个、暗投一个。此后 A9 一直站在 d4/danger，吃满 100 点炮火阵亡。此外 **A2 自 R2 起在 (3,-3) 停了 12 轮**，R10 seq175 已被点名进预警环仍不动，随后连续 4 轮挨炸阵亡。

**Q2｜每次 `artillery_shrunk` 前 `dangerCells`/`warningCells` 如何改变路线和占点优先级？**
warning/danger 规模：R5 36 → R7 66 → R9 90 → R11 108 → R13 120 格。R7 之后所有「向外/向边上抢点」的动作都失去意义，而我在 R7 仍把 A7、A1、A8 往东北/东外围（(3,1)、(3,-2)、(3,-1)）调动——**方向与安全区收缩完全相反**。正确做法应从 R7 起只做两件事：把已有部队压进 d≤2、把补给换成能进 d≤2 的兵。

**Q3｜`artillery_damage` 的总承伤、击杀和死亡原因，能否通过提前移动避免？**
我方承伤 263 / 11 次，全部集中于 A9(100)、A2(100)、A7(63)，三者均以 `cause:"artillery"` 死亡。
- A9：100% 可避免 —— 不部署到 d4，或 R9–R11 任一轮花 1 AP 挪进 d≤3。
- A2：100% 可避免 —— 它零任务价值（占领不依赖驻军，因 `control_point_neutralized` 从未因离开发生），早挪进来还能多打几次。
- A7：部分可避免 —— R13 安全区缩到 r=1 只剩 7 格，而对手当时仍有 5 支单位占据中心，我确实缺少落位；根因是前中期没换血，导致最后一圈无兵位可争。

**Q4｜哪些据点既提供收入又提供部署来源；据点中立后损失了多少资源/增援选择？**
12 个据点全部兼具两职（`forward_base` 4/轮、`supply` 8/轮，且都是 `deploy.fromId`）。我方的 6 个：`cp_east`(4,0)d4、`cp_northeast`(4,-4)d4、`cp_southeast`(0,4)d4、`supply_east`(3,0)d3、`supply_northeast`(3,-3)d3、`supply_southeast`(0,3)d3。
关键点：**它们全程没有被中立，收入一分未少**（R4–R14 稳定 44/轮），**但部署通道按距离被逐条掐断**：d4 的三个 forward_base 在 R9 失效，d3 的三个 supply 在 R11 失效。也就是说我损失的不是收入，而是 **R10 之后 176 点补给（R11–R14 四轮收入）彻底无法变现**，以及最后 4 轮「用钱补兵」这个唯一翻盘手段。

**Q5｜集火是否按「可击杀 → 高价值 → 占点」排序，交换比是否值得？**
**否。** 对照最鲜明的一组：
- 我 **R11**：3 次攻击分别打 B4(24)、B7(19)、B3(15)，合计 58 伤害，**0 击杀**。
- 敌 **R12**：3 次攻击全部砸向 A8（32+37+31=100），**当轮击杀**。
同样 3 AP，对手换掉我一整支 45 造价单位并取得高额 merit（2+2+2=6）。我还把 5 次攻击（85 伤害）持续投给 B3 heavy 却没能击杀——它带着 65hp 活到终局，贡献了对手 armyValue 的 1/3。**全场交换比：我 1 杀 vs 敌 8 杀；我造成 393 伤害 vs 敌 887。**

**Q6｜六项裁决分的结果是什么？**
见下节账本。HQ 两项写「不适用（无 HQ）」，`controlPoint`、`supplies` 权重为 0 不进总分（我在这两项上反而是全场第一：6 点 / 221 补给）。

---

## 核心教训与关键转折

**转折一（R5，最贵的一支部队白送）｜A3 heavy 深入西南被 4 打 1**
A3 从 (4,1) 一路走到 (-2,3)/(-2,4)，闯进 B2、B3、B5 与刚部署的 ranger **B6** 的交叉火力网。它在 R3 出手 1 次后，R4 被 B3/B2/B5 三次共计 61 点（20+27+18+16），R5 又被追打三发（25+15+29）至死（seq92）。**它给对手送了 ⌈20/20⌉+⌈27/20⌉+⌈18/20⌉+⌈16/20⌉+⌈25/20⌉+⌈15/20⌉+⌈29/20⌉ = 10 点 merit（=100 分），而我自己只拿到 2 点。** 一进一出近 240 分的摆动。

**转折二（R5–R10，技术路线被彻底碾压）｜对手 3 只 ranger vs 我 0 只远程**
对手在 R5/R9/R10 部署 3 只 ranger（72/射程 3/攻 44），我从头到尾只有 8 只 infantry（射程 1/攻 30）。结果是纯粹的单向输出：**我 11 支单位里 7 支死于 ranger，而我没有任何一次攻击够得着它们。** 攻击 merit 28 vs 61（**−330 分**）几乎全部由此产生。我在 R7 有 48、R8 有 92 补给，本可在 R8 起少投 1–2 只 infantry、换出 1 只 ranger 改变整个交战结构。

**转折三（R8–R12，炮火窗口管理失败）｜A9 被投进已公示的危险环并再未挪动**
`artillery_warning` seq134 明确公示「d4 环下一轮沉降」，我一边把 A7 从 d4 撤出，一边 seq137 把 A9 部署到 (4,-1)d4。它此后零移动、零攻击、零占领，连吃 R9–R12 四轮共 100 点炮火后死亡。**我 263 点炮火承伤里 76% 来自 A9+A2 两支「零产出」单位。**

**转折四（R11，部署通道永久关闭）｜钱变成负数直觉**
R11 起我 6 个据点全部落在 danger（`d > 2`），`deploy` 永久非法。R10 我手握 45 补给且仍有合法投放（如 `supply_east`(3,0) → 空位 (2,0)d2），却把 4 AP 全部用于移动；此后 R11–R14 又累积 176 补给，全部烂在账上。**最后安全圈的胜负取决于谁先把钱换成兵，我在窗口关闭前一轮放弃了这个动作。**

---

## 炮火、军力与裁决分账本

| 项目 | 我方（`player_a`） | 对手（`player_b`） | 权重 | 依据 |
|---|---:|---:|---:|---|
| HQ 伤害 / HQ 最终 HP | **不适用（无 HQ）** | **不适用（无 HQ）** | 0 / 0 | `mode: annihilation`，`headquarters: {}`，无 `headquarters_damage` / `headquarters_destroyed` 事件 |
| 最终据点数 | 6 | 5 | `controlPoint: 0`（**权重 0，不构成裁决分**） | `control_point_captured`×9 + 出生点；`game_over.scores.controlPoints` |
| 存活军力价值 | **0**（全歼） | 123 | `armyValue: 2` → **0 分 / 246 分** | `game_over.scores.armyValue`；期末 ArmyValue ≈ Σ cost×hp/maxHp |
| 剩余补给 | **221** | 202 | `supplies: 0`（**权重 0，不构成裁决分**） | `income` 累计 − 部署花费；`game_over.scores.supplies` |
| actionScore | 460（merit 46 = 部署 8 + 占点 10 + **攻击 28**） | 750（merit 75 = 部署 6 + 占点 8 + **攻击 61**） | `effectiveActions: 10` | `src/engine/actionScore.ts`：deploy=1、capture=2、attack=⌈伤害/20⌉、move=0 |
| 炮火承伤 | **263**（11 次） | 304（14 次） | —（非独立裁决项） | `artillery_damage` 事件合计 |
| 被炮火击杀 | **3**（A9 seq222、A2 seq266、A7 seq292，均 `cause:"artillery"`） | 3（B2 seq268、B4 seq270、B5 seq272） | —（非独立裁决项） | `unit_death.payload.cause` |
| 交战击杀 / 被击杀 | 1（B1 seq161） / **8** | **8** / 1 | — | 攻击事件使 `targetHp=0` 后紧跟 `unit_death` |
| 造成伤害 | 393（19 次攻击） | **887**（35 次攻击） | — | Σ `attack.payload.actualDamage` |
| 部署花费 | 360（8×infantry 45） | 351（3×45 + 3×ranger 72） | — | `deploy.payload.cost` |
| 据点收入合计 | 536（R2–R14，峰值 44/轮） | 508（R1–R14，峰值 40/轮） | 权重 0 | `income.payload.amount` |
| 行动点使用 | 51/56（R5、R9、R13 各少 1，R14 少 2） | 54/56 | — | `move/attack/deploy.payload.actionsUsed` 逐轮取最大值 |
| **总分** | **460** | **996** | — | `game_over.payload.scores.total` |

---

## 实际做法 vs 正确做法

**致命错误 1｜全近战的单一兵种配置（触发条件：对手 R5 出现第一只 ranger 时）**
- 实际：看到对手 R5 seq90 部署 ranger（射程 3/攻 44）后，我 R6/R8/R9 继续部署 infantry（射程 1/攻 30）。结果 7 支单位被 ranger 点杀，我没有一次反击够得着。
- 正确：一旦发现对手有远程单位，**优先级立刻从「多造步兵」切换为「至少先出 2 只 ranger（72）」以拉平射程**。补给上完全可行：R8 我有 92 补给，可用「少投 1 只 infantry + 延后 1 轮」换出 1 只 ranger；即便是 R8 之后，也可以用 R9/R10 的 44/轮在最后一个窗口前凑出一只。ranger 的 merit 效率也更高：单次 44 伤害 = ⌈44/20⌉ = **3 merit**，而 infantry 30 伤害只有 2 merit。

**致命错误 2｜把补给当成「存着以后用」（触发条件：R7 及 R10 出现可部署现金且 `nextShrunkRound` 已公示时）**
- 实际：R7 手握 48 补给不部署；R10 手握 45 补给（最后一个合法部署窗口）4 AP 全用于移动。终局闲置 221。
- 正确：`supplies` 权重为 **0**，`armyValue` 权重为 **2**——1 点补给留在手里是 0 分，变成兵就是 **2 分 + 后续每回合的输出机会**。规则应是：**只要 `deploy` 合法（来源据点与目标格都不在 danger）且现金够，优先 deploy；而且部署目标必须瞄准 d≤(当前 safeRadius−1) 的格子**，否则下一轮就要为它付 25 点血。

**致命错误 3｜预警轮把 AP 花在别处（触发条件：`artillery_warning` 出现、且我有单位落在 warning 环时）**
- 实际：R8 收到 d4 环预警后仍把新兵投进 d4；R10 收到 d3 环预警（A2 被点名）后 4 AP 全用于挪别的单位，A2 未动。
- 正确：**预警环内的单位必须在该回合第一优先级挪出**，因为伤害按上一轮末站位在次轮开始结算——预警轮是唯一窗口（这与我在 `tg_0188`、`tg_0171` 同一张图上得到的结论完全一致，本局又犯了同样的错）。

**次一级问题｜重装使用与集火排序。** A3 作为唯一重装（150hp）应在多打一中承担「伤害海绵」角色跟团行动，而不是孤身穿插；同时在自身 AP 有限时应锁定一个「本回合可击杀」的目标打完，而不是把伤害平摊到三个目标（R11 三打零杀，对照对手 R12 三打一击杀）。

---

## 与历史对局对比

对照组为我在**同一张地图 `artillery-zone`** 打的 `tg_0188`（`records/V3/tg_0188_rank01_WB@hy4.md`，3 人局，`54d393e6…`，3.5.9，第 1 名 / turn_limit_score），两局均为同一 agent（`WB@hy4`）在同一份服务器 `skill/` 规范下逐回合 API 手操，可作为同质对照：

| 指标 | `tg_0188`（第 1 名） | `tg_0199`（第 2 名） | 变化 |
|---|---:|---:|---|
| 模式 / 人数 / 先手 | annihilation / 3 人 / **每轮末位**（后手） | annihilation / 2 人 / **每轮先手** | — |
| `minimumSafeRadius` | **2**（R11 到底） | **1**（R13 到底，只剩 7 格） | ⚠️ 本图收缩更狠 |
| 首次预警时外圈单位数 | 0（危险环 d6 内 0 支） | 0（同样 0 支） | 持平 |
| 炮火总承伤 | 93 | **263** | ❌ **+170，严重恶化** |
| 死于炮火的单位 | 2（均为 ranger，造价 72×2） | **3**（infantry 45×3） | ❌ 恶化 |
| 部署构成 | **含 2 只 ranger**（72×2）+ 其它 | **0 只 ranger**，8 只 infantry | ❌ **关键差异** |
| 补给转化率 | **83%**（294 变现，余 63） | **62%**（360 变现，余 221） | ❌ 恶化 |
| 交战击杀 : 阵亡 | **5 : 2** | **1 : 11** | ❌ 崩溃 |
| 造成总伤害 | —（全场唯一击杀者） | 393 vs 敌 887 | ❌ 劣势 2.3 倍 |
| AP 使用 | 44/48 | 51/56 | ≈持平 |
| 最终 armyValue | 214 | **0** | ❌ 全军覆没 |
| 结果 | 🏆 第 1 名 1088 | 第 2 名 460 | — |

**结论：** `tg_0188` 赢的核心是「把 294 补给几乎全变现 + 用 ranger 拿到 5:0 交换」；本局我把这两件事**同时做反了**——既没有 ranger（0 只 vs 当年 2 只），又把 221 补给闲置（转化率 62% vs 83%），于是交换比从 5:2 崩到 1:11。而 `tg_0188` 里被我点名两次的「预警轮不撤离」错误，本局不但重现（R8 的 A9），还升级成了「直接把新兵部署进已公示的危险环」——这是最不能原谅的一处退步。

---

## 总结

> **核心口诀：预警先动脚、补给不留夜；射程不对称必败，远程要么有、要么躲——没有第三条路。**

**一句话总结：** 我拿着全场最高的据点数和最多的现金，却造了 8 只射程 1 的步兵去硬碰对手 3 只射程 3 的游侠，最终 11 支单位全灭、7 支死于够不着的箭下，把应该变现的 221 补给原封不动带进了坟墓。
