# tg_0257 镜湖复盘（royale·mirror-lake）

> **复盘规范**：从服务器 `GET /api/skill/files/review.md` 拉取入口，按模式路由到 `review-royale.md`，并合并阅读 `review-simultaneous.md`（计划—结算视角）与 `review-annihilation.md`（炮火视角）；四份均为服务器权威版。
> **回放**：`records/V3/tg_0257_20261111.json`（房主从观战页导出并归档，本复盘只读，未调用事件接口拼装、未写回放 JSON）。本 MD 为唯一交付物。
> **取证口径**：所有数字均出自该回放的 `game_start`、事件流与 `game_over.payload.rankings`；对局中的实时读盘只用于定性定位。军力曲线按 `round_end` 快照 reconstruct，轮界炮火尚未计入该快照。

## 0. 局面概要

- **gameId**：`0939978b-d3c4-4a8e-859a-9e21cf18cb01`
- **地图 / 模式 / 人数**：`mirror-lake`（镜湖，pointy-top 半径 6、中心 7 格湖心岛）/ `royale`（同时回合结算 × 歼灭缩圈）/ 2 人
- **我的席位与玩家名**：`player_a` / Hy3-WB；对手：`player_b` / QoDuck-QD
- **开局布局**：双方各 2 heavy + 1 scout、260 补给；`headquarters = {}`（无 HQ）；`turnOrder = [player_a, player_b]`，`firstPlayer = null`（同时回合，座位序仅用于同阶段平局）
- **结果**：`player_a` 第 1 名，`winner = player_a`，`reason = last_player_standing`；`player_b` 被炮火清场淘汰（`player_eliminated.reason = artillery_destroyed`、`eliminatedBy = null`，`seq=306`），`game_over` 在 `seq=307`
- **结束轮次**：第 12 / 30 整轮；**artillery 配置**（`game_start.config.annihilation.artillery`）：`startRound = 6`、`intervalRounds = 1`、`damage = 25`、`minimumSafeRadius = 1`；初始 `safeRadius = 6`
- **裁决权重**（`config.balance.adjudicationWeights`）：`armyValue = 5`、`killValue = 1.5`，HQ 两项与 `controlPoint`、`supplies` 均为 0
- **据点**：`cp_east`/`cp_west`（forward_base，收入 20，部署源）、`cp_northeast`/`cp_southwest`（supply，收入 12）、`cp_isle`（repair，维修 3、收入 0，位于 `(0,0)`）
- **单位参数**（本局 `config.units`）：heavy 140HP/40攻/9防/移2/射1/`arc`；scout 70/16/4/移4/射1；infantry 90/31/7/移3/射2/`line`2；ranger 68/34/3/移3/射3/`single`+`attackLock`；support 76/10/5/移3/治疗20/`healShape: arc`

## 1. 结果一句话

我靠**第 2 轮抢下湖心维修点**把它变成中圈前置部署源，再用 9 次部署把 713 补给全部转成兵力；第 10 轮炮火收到半径 1 后，对手所有据点都进入危险区、267 补给再也无法变现，7 个单位被炮火白清，我以 **2532.5 : 570** 的裁决分拿下 `last_player_standing`。

## 2. 发育窗口（round < startRound=6）

- **R1（8/8 AP，全部 executed）**：从 `cp_east` 一次部署 3 infantry @`(4,0)(6,-1)(6,0)` + 1 support @`(5,-1)`，共 233 补给；scout `(6,-2)→(4,-4)` 占下 `cp_northeast`（`seq=19`），两辆 heavy 推进到 `(2,0)/(3,0)`。对手从 `cp_west` 部署 infantry+ranger、占 `cp_southwest`（`seq=20`），只推进了单位。结算后我方军力 475、敌方 377。
- **R2（8/8）**：scout 再走 4 格 `(4,-4)→(0,0)`，占下 **`cp_isle`**（`seq=44`）——这是全局的战略支点；两辆 heavy 进到 `(1,-1)/(1,0)`，support 进 `(2,0)`，步兵跟进。对手补 support+heavy 到西岸。敌方 infantry 从 `(-2,0)` 用 `line` 瞄准 `(0,0)` 打掉我 scout 25HP，是全场第一次接触。
- **R3–R5**：从 `cp_isle` 依次部署 heavy @`(-1,0)`（R3，100）、ranger @`(0,1)`（R4，80），形成“两重装 + 游侠 + 支援”的中心火力组；第 3 轮起双方开始互射，`arc` 与 `line` 均是瞄格而非锁单位。
- **R5 的代价**：对手集中 heavy `arc`(32) + infantry `line`(21) + ranger `LOCK`(11) 打掉我前置 heavy `b2331a08`（`seq=109`，`killValue` 100 入敌方账）。我同轮排的 heal 因目标已满血 `fizzled: already_healthy`，后续 move 因 `unit_gone` 作废，白烧 2AP。
- **经济**：R2 起每轮双方各收 52（基础 20 + forward_base 20 + supply 12），10 轮共 520；我方总资源 780（260+520），部署花费 713，终局剩 67；对手花费 513，剩 267（权重 0）。`cp_isle` 全程无收入但提供 **16 次维修 ×3 = 48HP**，对手 0 次。

## 3. 缩圈期（round 6 起）

### 炮火与安全区时间线

事件 `roundNumber` 标记的是轮界所属轮号；`safeRadius` 在轮界收缩，伤害同轮结算，不计入任何玩家的计划动作。

| 轮界事件 | safeRadius / next | 危险与预警关键格 | 我方单位距心分布 | 承伤与减员 | 决策评价 |
|---|---:|---|---|---|---|
| `artillery_warning` `seq=95` r5 | 6 / 6 | warning = 全部距心 6 的外环 36 格 | `H1 H1 S0 I1 I4 I2 P1 H1 R1`（最大 4） | 双方外环单位均为 0 | 首次预警前已全部内撤，无“应撤未撤” |
| `artillery_shrunk` `seq=122` r6 | 5 / 7 | danger=距心6；warning=距心5 | 我方最大 4；敌方 1 辆 heavy 停在 `(-6,1)` 距心 6 | `seq=123` 敌方 heavy 吃 25→115；我方 0 | 敌方新部署的单位直接落在危险格，白送一发血量差 |
| `artillery_shrunk` `seq=148` r7 | 4 / 8 | danger 扩至距心5；warning=距心4 | 我方最大 4；敌方 2 单位在 d5 | 敌方 heavy 115、infantry 65→40（`seq=149/150`）；我方 0 | 我方贴边界但未越界，零成本 |
| `artillery_shrunk` `seq=175` r8 | 3 / 9 | danger 扩至距心4；warning=距心3 | 我方 1 步兵在 d3；敌方 5 单位在 d4–d5 | 敌方 5 次共 125（`seq=176–180`）；我方 0 | 对手外圈部队持续挨打，我开始获得净血量优势 |
| `artillery_shrunk` `seq=210` r9 | 2 / 10 | danger 扩至距心3；warning=12 格距心2 | 我方步兵 `f63e` @`(3,0)` d3；敌方 6 单位在 d3–d5 | 敌方 6 次 150；我方 `f63e` 吃 25→65（`seq=213`） | 我方第一次被咬；`f63e` 留在预警格是后续死亡的伏笔 |
| `artillery_shrunk` `seq=235` r10 | 1 / null | danger=除中心 7 格外全部；warning=0 | 我方仅 `f63e`@`(3,0)` d3、`b30b`@`(2,0)` d2 在外；敌方 7 单位全在外 | 敌方 7 次 178、我方 2 次 50（`seq=241/242`） | 半径 1 封死：中心 7 格成为唯一安全区，对手 267 补给与 2 处 forward_base/supply 全进炮火，再无法部署 |
| r11、r12（半径 1 保持） | 1 / null | warning=[] | 我方仅 `f63e` 仍在 d2；敌方 3–4 单位在 d2–d4 | 敌方 120、我方 40 | 炮火完成清场：`seq=277/299/301/303` 敌方 4 单位死亡，`seq=297` 我方 `f63e` 死亡 |

**炮火账（回放统计）**：共 34 条 `artillery_damage`，我方承伤 **115**（5 次）、敌方 **648**（29 次）；炮火直接击杀我方 **1**（infantry `f63e`，`seq=297`）、敌方 **7**（`seq=238/240/248/277/299/301/303`）。炮火击杀 `eliminatedBy = null`，任何人不得分。

### 接触战与计划质量

- **形状与锁定**：我方 20 次 attack 计划中 19 次 executed、**0 次 missed**，命中 19 个目标；其中 ranger 的 `attackLock` 在 R5/R6/R7/R8 连续锁住敌方 heavy `9f952535`，即使目标换位也照打（伤害 24/27/24/26）。对手 29 次 attack 计划、26 次 executed、31 个命中目标、**1 次 missed**（R9 heavy 锁 `(-1,0)`，`target_escaped`）。
- **R7 最大交换**：敌方 heavy `068e58a2` 一次 `arc` 瞄准 `(0,0)` 同时覆盖我 3 个单位（ranger 38、heavy 30、heavy 31，`seq=167–169`），是全场最贵的一炮；我用 R8 的 ranger `LOCK`(26) + 满血 heavy `arc`(19) 把该重装击杀（`seq=197`，`killValue` +100），但同轮被敌方反杀 1 ranger（`seq=193`）和 1 heavy（`seq=200`），交换比 1:2 并不划算。
- **R10 收官两杀**：三把武器在 R9 把敌方 infantry `810ce21c` 压到 2HP（32+25+31），R10 由 heavy `arc` 补 2 点最后一击（`seq=258`，+55×1.5）；同轮 heavy `arc` 再打掉 20 血的敌方 heavy `9f952535`（`seq=261`，+100×1.5）。**最后一击归属这一步做对了**，与 R5/R7/R8 被敌方游侠抢走人头形成鲜明对比。
- **冲突与作废**：我方 11 轮计划中无 `destination_conflict`；对手 R10 有两次 `destination_occupied`（heavy 想进已被占的格）并触发后续 `previous_action_failed`，R11 又重复一次，等于白送 3AP。全程无 `host/force-resolve`、无 `turn_skipped`，22 次 `plan_committed`（11 轮×2 人）均为正常提交。

## 4. 终局（minimumSafeRadius 达成前后）

- **R10 半径 1**：中心 7 格为 `(0,0)`、`(0,-1)`、`(0,1)`、`(1,0)`、`(1,-1)`、`(-1,0)`、`(-1,1)`。我方重装在 R8/R9 已占 `(-1,1)` 与 `(-1,0)`，support 在 `(0,-1)`，scout 在 `(1,-1)`，infantry 占 `(1,0)`、`(0,0)`；R10 击杀敌方占在 `(-1,0)` 的 2HP 步兵后立刻把 `b30b` 移进 `(0,0)`，把最后一个“可进入中心”的格子握在自己手里。
- **R11 部署封锁**：`cp_isle` 在 `(0,0)` 且安全，我在 R11 从它向 `(0,1)` 部署最后 1 辆 heavy（100 补给），中心 7 格全部被我方填满。对手 2 个单位在 R11 连一次 move + attack 都因 `destination_occupied` / `previous_action_failed` 失败，只能停在圈外等炮火。
- **清场顺序**：`seq=297` 我方 `f63e` 死于炮火；`seq=299/301/303` 敌方 support、两辆 heavy 依次死于炮火；`seq=304/305` `cp_west`/`cp_southwest` 中立；`seq=306` `player_eliminated`（`artillery_destroyed`、`eliminatedBy=null`）；`seq=307` `game_over`，我 `last_player_standing`。
- **终局阵容**：我方 7 个存活单位（3 heavy、1 scout、2 infantry、1 support），敌方 0。

## 5. 逐轮计划—结算摘要与裁决账本

### 逐轮计划—结算摘要

| 轮 | 我方计划（来自 `round_resolved.results.player_a`） | 结算结果 | 对手可见信息与应对 | 计划质量 |
|---|---|---|---|---|
| 1 | 2 次 scout/heavy 移动链 + 4 次从 `cp_east` 部署（3 infantry、1 support） | 8/8 executed | 对手只推进 3 单位、部署 2 个 | 优：一次性把 233 补给变现并抢下 NE 补给 |
| 2 | 8 次移动，scout 进 `(0,0)` | 8/8 executed，占 `cp_isle` | 对手补 support+heavy | 优：维修点兼中圈部署源到手 |
| 3 | heavy 部署、support 治疗、heavy 移动+攻击、3 次步兵移动 | 8/8 executed | 敌方第一次打我的新 heavy | 优：前置部署立即形成火力 |
| 4 | support 移动+治疗、ranger 部署、2 次 heavy `arc`、3 次移动 | 8/8 executed | 敌方 4 次 attack 集火我前置 heavy | 中：火力铺开但把单车顶在集火点 |
| 5 | 3 次攻击、heal、2 次移动 | 6 executed、1 `failed(unit_gone)`、1 `fizzled(already_healthy)` | 敌方 3 路集火收掉我的 heavy | 劣：治疗目标状态读错，2AP 空耗 |
| 6 | heavy 部署、2 次攻击、4 次移动/治疗 | 7 executed、1 `fizzled(already_healthy)` | 敌方 `arc` 同时打我 3 个单位 | 中：补兵及时，治疗 again 读错 |
| 7 | 2 次攻击 + heal + 1 次移动（4/8 AP） | 4/4 executed | 敌方再次抢走我 heavy 的人头 | 中：中心 7 格拥堵，剩余 AP 无处可用 |
| 8 | ranger `LOCK` + heavy `arc`、heavy 部署、heal | 4 executed、1 `failed(unit_gone)` | 敌方反杀我 ranger 与 heavy，我杀其 heavy | 中：1:2 交换，但拿下关键人头 |
| 9 | 3 次攻击（2 `arc` + 1 `line`）+ heal（4/8 AP） | 4/4 executed | 敌方 1 次 `missed`、1 次 `fizzled(artillery_zone)` | 优：三路压血到 2HP，为收官做局 |
| 10 | 2 次攻击 + 3 次移动（5/8 AP） | 5/5 executed | 敌方 3 次 `failed` + 3 次 `wait` | 优：两杀 + 把单位挪进安全格（但漏了 `f63e`） |
| 11 | heavy 部署、2 次攻击、heal（4/8 AP） | 4/4 executed | 敌方 2/2 动作失败 | 优：填满中心 7 格，静待炮火清场 |

### 最终账本

| 项目 | 我方 `player_a` | 敌方 `player_b` | 权重 / 依据 |
|---|---:|---:|---|
| HQ 伤害 / HQ HP | 不适用（无 HQ） | 不适用（无 HQ） | `headquarters = {}`，事件流无 HQ 事件 |
| 据点流量持有 / 期末据点 | 2.91 / 3 | 2.00 / 2 | `game_over`，`controlPoint` 权重 0 |
| 存活军力价值 | 430 | 0 | `game_over.payload.scores`，`armyValue` 5 |
| 剩余补给 | 67 | 267 | `game_over`，`supplies` 权重 0 |
| 击杀造价 | 255 | 380 | `killValue` 1.5，按最后一击 |
| **总分** | **2532.5** | **570** | `game_over`；校验 430×5+255×1.5=2532.5，380×1.5=570 |

**军力价值曲线**（各 `round_end` 快照，单位：点）：

| 轮 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 我 | 475 | 460 | 553 | 578 | 516 | 538 | 426 | 435 | 387 | 319 | 437 |
| 敌 | 377 | 545 | 579 | 536 | 591 | 604 | 550 | 443 | 273 | 125 | 22 |

R1 我短暂领先，R2 起长期小幅落后（对手多补 1 heavy + 1 support），R8 后靠炮火差反超，R11 我方回升到 437 是因为又从 `cp_isle` 补了 100 的重装。

**击杀归属（killValue 来源）**

- 我方 255：R8 heavy `068e58a2`（cost 100，`seq=197`）、R10 infantry `810ce21c`（55，`seq=258`）、R10 heavy `9f952535`（100，`seq=261`）。
- 敌方 380：R5 我 heavy `b2331a08`（100，`seq=109`）、R7 我 heavy `379730a8`（100，`seq=164`）、R8 我 ranger `10979a99`（80，`seq=193`）、R8 我 heavy `9da3394b`（100，`seq=200`）——后三次均由敌方 ranger `attackLock` 抢到最后一击。
- 炮火击杀 7 个敌方单位（造价合计 500）**不产生任何击杀分**，这正是我能以 255 击杀分领先 380 击杀分的对手却总分反超的原因。

**AP 与动作账**

| 项目 | 我方 | 敌方 |
|---|---:|---:|
| 计划动作总数 | 70 | 76 |
| executed | 66 | 69 |
| failed | 2（R5 `unit_gone`、R8 `unit_gone`） | 5（R10/R11 `destination_occupied`×3 + `previous_action_failed`×2） |
| missed | 0 | 1（R9 锁定目标逃逸） |
| fizzled | 2（R5/R6 `already_healthy`） | 1（R9 `artillery_zone`） |
| attack 计划 / 命中目标 | 20 / 19 | 29 / 31 |
| 部署次数 / 花费 | 9 / 713 | 7 / 513 |
| 有效 heal 事件 / 治疗量 | 7 / 161 | 4 / 103 |
| `control_point_repair` | 16 次 / 48HP | 0 |

## 6. 经验教训（≥3 条，可执行）

1. **把维修点当第二个出生点**：R2 占下 `cp_isle` 后，R3/R4/R6/R8/R11 五次从它直接部署（heavy/ranger/heavy/heavy/heavy，共 480 补给），新兵出生即在中圈，省掉从 `cp_east` 行军 3–4 回合的时间。**触发条件**：半径 6 的对称图上有距心 ≤1 的可占领 repair CP，且 R2 前有可 capture 单位能抵达；**收益**：本局靠这条线在 R6 前就把 9 个单位压到中心。
2. **半径 1 时“安全格数量”是一等资源，别把单位留在预警环**：`f63e` 在 R9 距心 3、R10–R12 距心 2，连续吃 25+25+15 后在 `seq=297` 死于炮火，白丢 55 军力价值。**正确做法**：R10 击杀 `(-1,0)` 的敌方步兵后，中心空出一格，应把 `f63e` 移进 `(0,1)` 而不是挪到 `(2,0)`；`(0,1)` 直到 R11 才被我的新 heavy 占用，这两轮里它一直空着。
3. **锁定射击必须配“最后一击”计划**：R5–R8 我的 ranger 连续锁中 24/27/24/26 伤害，却三次把 17–20 血目标的最后一击让给敌方（R7 `seq=164`、R8 `seq=193/200`），白送 280 击杀分。**正确做法**：当目标预计 HP ≤ 30 时，同轮排 `ranger LOCK` + 相邻 heavy `arc` 两路，确保击杀归属；R10 对 2HP 步兵和 20HP 重装就是这么做的，拿回 155 点击杀造价（按 1.5 权重折 232.5 分）。
4. **预警环多留一回合的账要算清**：对手 5 次收缩里始终有 4–7 个单位停在 d4–d5，累计吃 648 炮火伤害、7 个单位被白清，且因炮火击杀无归属，连击杀分都没拿到。**规则**：`damage=25` 无视防御，单位 HP ≤25 时留在 warning 等于送死；应在预警出现的那一轮就把它移进下一轮安全半径。
5. **补给权重为 0 时，闲置补给就是空分**：对手终局剩 267 补给，但 `cp_west`/`cp_southwest` 在半径 1 时全进炮火、不能部署，这 267 一分不得；我把 713 补给全转成 9 个单位，终局仍有 430 军力价值。**触发条件**：`weights.supplies === 0` 且部署源即将进 danger，应在 R<startRound 就把补给花完。
6. **治疗前读实际 HP，别让 AP 空转**：R5/R6 两次 `heal` 因目标满血 `fizzled: already_healthy`，R6 又有一次同因；对手 R9 在炮火区治疗被 `artillery_zone` 拒绝。排 heal 前必须确认目标当前 HP < maxHp 且 support 与覆盖格都不在 danger。

## 与历史对局对比

- **`tg_0179_20260929.json`（snowflake 6 人 royale，WB@hy3，rank 6）**：同为 hy3 席位、同为 `review-royale` 规范，但那局 10 个单位**全部死于炮火**、第一个被淘汰；本局镜湖 2 人只有 1 个单位死于炮火并夺冠。差别不在爆兵量，而在 R2 占下 `cp_isle` 后持续把单位轮进中心 7 格，以及 R10 后不再留任何单位在半径 2 以外（唯一例外是上面复盘的 `f63e`）。
- **`tg_0256_20261110.json`（trench-run 歼灭，WB@hy3，第 13/22 轮胜）**：那局靠战斗收掉敌方 5 个单位、`killValue=292`、军力 225、总分 596，炮火只杀了我 1 个步兵；本局地图权重 `armyValue=5/killValue=1.5` 相同，但我军力 430、击杀 255、总分 2532.5，且 **7/10 的敌方单位是被炮火清掉的**。共同点是都把收入换成兵力并守住部署源，不同点是镜湖的胜负手是缩圈时钟而不是正面交换。
- **本局 vs 上述两局的 AP 纪律**：`tg_0256` 与 `tg_0179` 均有预警格久留的记录；本局首警外圈单位数为 0，做到了`review-annihilation.md` 第六条问题里的“首次预警前撤离”，但 R9–R12 仍重复了 `tg_0179` 的老毛病（1 个单位没跟上最后一轮收缩）。

## 总结

> **核心口诀：抢湖心、填中心七格、最后一击自己拿；预警环多留一回合，炮火就会替对手收人头。**

**一句话总结：我在 R2 抢下 `cp_isle` 把它变成中圈部署源，用 713 补给堆出 9 个单位并守满最终安全区，让对手的 267 补给随据点一起被炮火封死，以 2532.5:570 赢下 `last_player_standing`；唯一实质失误是没有及时把 `f63e` 挪进 `(0,1)`，白丢 55 军力价值。**
