# 战术游戏标准模式复盘 — `player_a` 视角

**日期/游戏ID/回放版本:** 2026-10-19 / c7cc18b1-7ece-45e3-ace1-683c69f8f0ba / schemaVersion 3.6.3（`format: hex-v2-replay`，回放 `records/V3/tg_0231_20261019.json`，339 事件，房主归档，本复盘只读该文件）
**地图/参战人数:** multiplayer-ring（六方环线，半径 8 / 217 格：211 平地 + 6 blocker）/ 3人；**模式:** standard
**玩家:** Dsv4Pro0813-WB（WB@dsv4pro0813）；对手 player_b = Dsv4.1Flash1017-WB、player_c = Dsv4.1Flash0910-OMP
**席位与出生:** `player_a`，行动顺序第 1（先手），HQ(0,-8) HP 180 / 防御 6，初始 1 `infantry`(0,-7) + 1 `scout`(1,-8)；对手 player_b 镜像（slot_5，HQ(-8,8)、(-7,7)/(-8,7)）、player_c（slot_1，HQ(8,0)、(7,0)/(7,1)）
**结果:** 第2名 — `turn_limit_score`（第 15 整轮结束后裁决，唯一最高分 player_b）
**结束轮次:** 第 15/15 整轮；**HQ最终HP:** 我 **90/180**，player_b 180/180，player_c 0/180（已淘汰）
**管理干预:** 回放中无 `turn_skipped`、无 `host_eliminate`／`host/force-resolve`；无炮火（本图无 artillery）

## 最终排名摘要

| 名次 | 席位 | 状态 | 总分 | HQ HP | 据点 | 决定性优势 |
|---|---|---|---:|---:|---:|---|
| 🥇 1 | `player_b` | active | **1720.775** | 180/180 | 4 | **HQ 伤害 180 × 5 = 900**（全打 player_c 并摧毁）+ 据点流量 4.07×0.7×75 = 213.7 + 自身 HQ 血量 180 |
| 🥈 2 | `player_a`（我） | active | **632.925** | 90/180 | 3 | 击杀造价 317 × 0.3 = 95.1（全场最高），但 HQ 伤害 0、据点流量仅 1.93 |
| 🥉 3 | `player_c` | **eliminated** | **558.9** | 0/180 | 0 | 被我方反杀 5 个单位 + 被 player_b 摧毁 HQ（R11 淘汰） |

**分差 = 1087.85 拆解（我 vs player_b）**：敌 HQ 伤害项 **+900**（900 vs 0）、据点项 **+134.9**（303.7 vs 168.8）、自身 HQ 血量项 **+90**（180 vs 90）、军力价值项 **+23**（302 vs 279）、击杀项 **−60**（35.1 vs 95.1）。**结论：我用"击杀"（killValue 317）和后期夺下中央 repair 换来的领先，被 player_b 的 5-CP 雪球（据点流量 4.07）与 180 点 HQ 伤害（900 分 + 淘汰 player_c）全额吃掉，且我从未对任何 HQ 造成过伤害。**

**本局配置**（`game_start.payload.config`）：`startingSupplies 70`、`baseIncome 6`、`actionsPerTurn 7`、`maxTurns 15`、伤害浮动 **±3**（`damageVarianceRange:3`，最小 1）、治疗浮动 ±6；`comebackSupply{startRound 3, gap 40%, amount 20}`；据点类型：`supply`（+8 收入）、`forward_base`（+4 收入、`deployDiscount 4`）、`repair`（+2 收入、每轮边界给相邻己方单位 +8 修复）；单位：infantry 100/30/8/移3/射1/45、scout 65/16/4/移5/射1/38、heavy 150/38/13/移2/92、ranger 72/44/3/移3/**射3**/72、support 82/10/5/移3/60（治疗 22）；权重 `enemyHqDamage 5, ownHqHp 1, controlPoint 75, armyValue 1, supplies 0, killValue 0.3`（`controlPointFlowRatio 0.7`）。
**地图结构**：中心 repair 点 (0,0) 被 6 个 blocker 围成的半径 2 环半包围，只有 6 个方向可进；6 个补给/前线基地环绕中腹，三家各有一个"家门口"补给点（我=cp_nw(0,-3)、player_b=cp_sw(-3,3)、player_c=cp_e(3,0)）天然归各家，其余 cp_ne/cp_w/cp_se 三个 forward_base 与中央 repair 是三方向必争。

## 游戏进程时间线

| 整轮/席位回合 | 我方补给 | 行动点 | 关键操作与坐标 | 结果/局势变化 | 战术意图 |
|---|---|---|---:|---|---|---|
| R1 / player_a | 70 | 7 | `deploy scout <- HQ @(-1,-7)`；scout 97449763→cp_nw(0,-3)；infantry 83644183→(0,-4) | 占 cp_nw（seq8）；player_b 占 cp_sw、player_c 占 cp_e | 双 scout 扩张 + 补一个 scout |
| R2 / player_a | 84 | 7 | scout→cp_ne(3,-3)；infantry→(0,-1)；scout 309f84f4→(-3,-2) | 占 cp_ne（seq29）；player_b 占 cp_w、player_c 占 cp_center | 抢第二个前线基地 cp_ne + 中心方向 |
| R3 / player_a | 102 | 7 | `deploy infantry <- cp_ne @(2,-2)`；infantry→(-2,0) 攻 player_b cp_w scout；scout→(-3,-1) 攻同目标 | 我 2 点（cp_nw/cp_ne）；**player_c 偷 cp_nw（seq70）**、player_b 占 cp_se（seq62） | 西线压 cp_w，却让老家 cp_nw 空虚被偷 |
| R4 / player_a | 64 | 7 | `deploy infantry <- cp_ne @(2,-2)`；4 单位集火 player_c cp_nw scout(0,-3) | **杀 player_c scout（seq81）**，但**我 scout 97449763 被 player_c ranger 反杀（seq94）**；player_b 夺 cp_e（seq88）、player_c 夺 cp_ne（seq97）→ 我一度 **0 点** | 夺回 cp_nw 代价是我方 scout 阵亡、cp_ne 失守 |
| R5 / player_a | 43 | 7 | infantry 051d2b52→cp_nw(0,-3) 夺回（seq107）；集火 player_c ranger 至 8hp | 夺回 cp_nw；**player_c ranger 打我 HQ 39（seq118，141）**；player_b 夺 cp_center（seq113） | 夺回补给点 + 反制 ranger |
| R6 / player_a | 55 | 7 | **杀 player_c ranger（seq128）**；scout 309f84f4→cp_ne(3,-3) 夺回（seq132）；`deploy ranger <- HQ @(0,-7)` | 夺回 cp_ne；player_c 只剩 2 infantry 在我北线 | 清剿北线 ranger、补远程 |
| R7 / player_a | 73 | 7 | 集火杀 player_c infantry(0,-5)（seq155） | 我 cp_nw/cp_ne 2 点；**player_b 开始远征 player_c HQ（seq160，27→153）**；player_c infantry 打我 HQ 24（seq166，117） | 继续清剿 + 未察觉 player_b 已转攻 HQ |
| R8 / player_a | 81 | 7 | `deploy infantry <- cp_ne @(2,-2)`；重创 player_c infantry(0,-7) 至 42 | player_c infantry 打我 HQ 27（seq187，**90**）；player_b 两步兵打 player_c HQ 至 104 | 北线收尾 |
| R9 / player_a | 76 | 7 | **杀 player_c infantry(0,-7)（seq196）**；`deploy infantry <- cp_ne @(3,-2)`；重创 player_b 中心步兵 | 我 HQ 90 停稳、北线清空；player_b 打 player_c HQ 至 51 | 转守为攻、南下 |
| R10 / player_a | 72 | 7 | 杀 player_b 中心步兵方向推进；`deploy infantry <- cp_ne @(3,-2)` | **我 infantry(1,-1) 被 player_b 中心+ ranger 击杀（seq232）**；player_b 打 player_c HQ 至 2 | 南下途中折损 |
| R11 / player_a | 74 | 7 | **杀 player_b 中心步兵 bc572725(0,0)（seq251）** | **player_b 摧毁 player_c HQ（seq257/258/259），player_c 淘汰** → 转为我 vs player_b | 清中心 + 眼睁睁看 player_b 吞掉第三家 |
| R12 / player_a | 106 | 7 | 步兵 37ce7478→cp_center(0,0) 夺下中央 repair（seq275）；`deploy ranger <- cp_ne @(3,-2)` | 我 3 点（cp_nw/cp_ne/center）；player_b 4 点 | 夺中央 repair、军力反超 |
| R13 / player_a | 78 | 7 | **杀 player_b ranger 02970540(0,2)（seq291）**；`deploy infantry <- cp_ne @(3,-2)` | 中央守住、player_b 东线 8 单位压境 | 守住中心、杀远程 |
| R14 / player_a | 76 | 7 | 集火 player_b 三方据点单位；`deploy infantry <- cp_ne @(2,-3)` | **我 ranger 8b7f664e(2,0) 被 player_b 击杀（seq319）** | 最后反击 |
| R15 / player_a | 76 | 7 | 集火 player_b 单位收尾 | `game_over`（seq339）：player_b 胜，我第 2 | 最终止损 |

**补给账（我的 income 事件，逐轮准确）**：R2 +14 → R3 +18 → R4 +10 → R5 +6 → R6 +14 → R7~R12 +18（连续）→ R13~R15 +20。R4-R5 丢掉 cp_nw 后收入从 18 跌到 6，是全程最伤的 6 轮；随后靠 `comeback_supply`（R5–R14 共 **10 次 × 20 = 200**，我落后 leader 40%+）才续上经济。最终补给 76（`game_over` 权威值）。

## 核心策略与关键转折

**1）双 scout 抢点却"家空"——开局扩张是把双刃剑（本局最大败因）**
R1-R2 我把两个 scout 分别推到 cp_nw 和 cp_ne，账面上两轮 2 点、经济 +18/轮，看似顺风。但代价是：**老家 cp_nw 从 R3 起无兵驻守**，而 player_c 的 scout（移 5）从 cp_e 一路长驱，R3 直接站上 cp_nw 翻点（seq70）。这揭开了全局最痛的一条连锁：R4 我为夺回 cp_nw 被迫把 4 个单位压到 (0,-3) 附近集火，结果既没能在当轮立刻夺回（对方 scout 站到 R4 才被击杀 seq81），又**让 cp_ne 在 R4 被 player_c 的步兵顺手翻掉（seq97）**。到 R5 初我一度 **0 个据点**。教训：**先手（player_a 第 1 位）的价值不是"更快抢到最多点"，而是"抢到的点能留得住"；六方环线上家补给点是你的经济命脉，R1 就该留一个步兵在家门口，而不是把两个 scout 全部外派。**

**2）被 ranger 白打 90 伤——对静态目标的换血永远是我吃亏（HQ 溃败）**
player_c 的 ranger（射 3，攻 44）在 R5/R7/R8 三次点我 HQ：39→24→27，共 **90 伤**（seq118/166/187），把我 HQ 从 180 打到 90。它每次出手零风险（HQ 不会动、`attack` 瞄格必中），而我直到 R4 才组织集火反制、R6 才把它击杀（seq128）。这 90 点承伤最终兑现为 `ownHqHp 90×1 = 90`，并让我的裁决分被锁定在一个永远追不回的低位。对比：player_b 全程没有被任何一家打到 HQ（180/180），等于白捡 `ownHqHp 180` + `enemyHqDamage 900` 两个大头。**本图 ranger 是全场最该优先点名的单位：它既能隔 3 格白嫖 HQ，又脆（72/3）；我在 R4 前完全没把它列为首要目标。**

**3）player_b 的"双步兵远征 HQ"是本局真正的胜负手（不可逆压力从 R7 开始）**
R7 起 player_b 用两个步兵（b06d16a6、78714ca7）轮流站上 player_c 的 HQ 环（(7,0)/(8,-1)），连续 R7→R11 五轮每轮 2×(30−6±3)≈45–54 伤，把 player_c HQ 从 180 打到 0（seq160/180/182/205/206/228/229/257）。当我在北线清剿 player_c 残部时，**player_b 已经在对第三家执行"先拿 5 点雪球、再远征吃分"的双线剧本**——它 R4 就顺手翻走 cp_e（seq88），R5 再夺中央（seq113），R7 启动 HQ 远征，R11 完成淘汰。等 player_c 出局，player_b 坐拥 **180 HQ 伤害 × 5 = 900 分 + 4 据点流量 4.07**，这个领先我从第 7 轮起就再也追不回来。**多人局的教训：当你和 A 家缠斗时，务必盯住 B 家是否正在吞并 C 家——谁先拿到"淘汰 + HQ 伤害"的组合拳，谁就锁定了胜局。**

**4）后期军力反超是"正确的无用功"（止损而非翻盘）**
R11 击杀 player_b 中心步兵、R12 夺下中央 repair、R13 击杀 player_b 的 ranger——我在 R11-R14 打出了全场最好的三连击，`killValue` 冲到 317（全场最高），军力也一度与 player_b 相当。但这些只体现在 `killValue×0.3` 和 `armyValue×1` 两项（合计约 +60 分），而 player_b 的据点流量（4.07 vs 我 1.93）和 HQ 伤害（900 vs 0）是每轮都复利累积的大头。**在 `controlHold` 按轮数时间平均的规则下，我 R4-R5 丢掉的那些轮次是"永久损失"，后期再多的击杀也补不回 flow 的平均值。**

## HQ、据点与经济分析

**HQ 时间线（我全程只有被动挨打）：**

| 轮 | 我方 HQ | player_c HQ | 事件（`seq`） |
|---|---:|---:|---|
| R5 末 | 180→141 | 180 | player_c ranger 打我 HQ 39（seq118） |
| R7 末 | 141→117 | 180→153 | player_c infantry 打我 24（seq166）；player_b 打 player_c 27（seq160） |
| R8 末 | 117→**90** | 153→104 | player_c 打我 27（seq187）；player_b 打 player_c 23+26（seq180/182） |
| R9 末 | 90 | 104→51 | player_b 打 player_c 26+27（seq205/206） |
| R10 末 | 90 | 51→2 | player_b 打 player_c 23+26（seq228/229） |
| R11 末 | 90 | **2→0 摧毁** | player_b 打 24→0（seq257/258/259） |

**对各对手分别统计（我视角）**：
- **对 player_c**：击杀 4 个单位（scout 1effc466 38 + ranger e0d1758e 72 + infantry 4554df4d 45 + infantry a6136f98 45 = **200** 计入我 `killValue`；player_c 淘汰时 `removedUnitIds` 共 5 个，其中 e0d1758e/4554df4d/a6136f98/1effc466 均是我杀的，da0264a2 是 R9 部署、未死、随淘汰移除，不计入击杀）、夺取 cp_nw（R5）、cp_ne（R6）两次夺回；**对我方 HQ 的 90 点伤害全部来自 player_c**。我从未打 player_c 的 HQ（HQ 伤害 0）。
- **对 player_b**：击杀 2 个单位（中心 infantry bc572725 45 + ranger 02970540 72 = **117** 计入我 killValue）、R12 夺下 cp_center；**对方 HQ 180 完好、对我方造成 2 次击杀**（R10 步兵 seq232、R14 ranger seq319）。
- **对手互相**：player_b 对 player_c 造成 180 点 HQ 伤害并完成淘汰（seq259 `eliminatedBy: player_b`）；player_c 对 player_b 无 HQ 伤害。

**据点收益是否覆盖成本**：cp_nw（supply +8）是我唯一稳定收入源，R4-R5 丢失两轮 = 少拿约 16 收入 + 触发追分补给的落后判定；cp_ne（forward_base +4、折扣 4）是我中后期 7 次部署的出兵口，每次省 4 补给，共省 28；中央 repair（+2、每轮修复 8）在 R12 后给中心步兵持续回血，让我顶住了 player_b 的压境。但**这些收益都建立在"我 R1-R2 抢到了点"的前提下，而抢点的机会成本（老家空虚、HQ 挨打）没有计入账本。**

## 补给与裁决分账本

权重（`config.balance.adjudicationWeights` + `controlPointFlowRatio 0.7`）：`enemyHqDamage 5, ownHqHp 1, controlPoint 75, armyValue 1, supplies 0, killValue 0.3`。

| 项目 | 我 | player_b | player_c | 权重 | 依据 |
|---|---:|---:|---:|---:|---|
| 对敌 HQ 伤害 | 0 | 180 | 90 | ×5 | `attack`（seq118/160/166/180/182/187/205/206/228/229/257） |
| 己方 HQ 最终 HP | 90 | 180 | 0 | ×1 | `game_over` |
| 据点流量持有（均值 controlHold） | 1.93 | 4.07 | 1.0 | ×75×0.7 | `control_point_captured` + `round_end` |
| 期末控制据点（controlPoints） | 3 | 4 | 0 | ×75×0.3 | `control_point_captured` |
| 存活军力价值（armyValue） | 279 | 302 | 45 | ×1 | `game_over` |
| 剩余补给（supplies） | 76 | 11 | 60 | ×0 | `game_over` |
| 击杀造价（killValue） | 317 | 117 | 38 | ×0.3 | `unit_death` 归属 |
| **总分** | **632.925** | **1720.775** | **558.9** | — | `game_over.payload.scores` |

分项验算（我方）：0 + 90 + (1.93×0.7+3×0.3)×75 + 279 + 0 + 317×0.3 = 90 + 168.825 + 279 + 95.1 = **632.925** ✓。

**收支**：起始 70；income 累计 230（R2-R15 逐轮 14/18/10/6/14/18/18/18/18/18/18/20/20/20）；`comeback_supply` 200（10 次×20）；部署 9 次（R1 scout 38、R3/R8/R9/R10/R13/R14 六次 infantry@cp_ne 各 41、R6 ranger@HQ 72、R12 ranger@cp_ne 68，合计 424）；最终 76。无治疗、无拆除（本图 blocker 未拆）。回放 `income` 事件不携带 `total` 字段，逐轮净额无法精确对账，以上收入/花费均以事件 `amount` 与部署单价为准。

## 失误与改进

**1）扩张不守家 → 正确做法是"先站后抢"**
实际做法：R1-R2 两个 scout 全外派，cp_nw 无人守。正确做法：R1 用 scout 抢 cp_nw 后，**步兵留在家门口（或 R1 就不补 scout 而补一个守家步兵）**，确保 home 补给点始终有兵。触发条件：3 人环线，任何一家的 scout（移 5）都能在 2-3 轮内走到你的 home 点。预期收益：保住 cp_nw 的 +8 收入（R4-R5 少掉约 16）+ 不触发落后判定，且不用 R4 调 4 个单位回来救火（那 4 个单位本可压住 cp_ne）。

**2）对 ranger 反应太慢 → 正确做法是"第 1 优先点名远程"**
实际做法：R4 才组织集火，R6 才击杀 player_c ranger，期间让它白打 HQ 3 次共 90 伤。正确做法：**一旦看到 ranger（射 3、脆 72/3）出现在我方 HQ 3 格内，立刻用至少 2 个单位集火秒掉它**，宁可不占点也要先清远程。触发条件：`attack` 事件显示敌方 ranger 进入我 HQ 射程。预期收益：我方 HQ 少掉 90 伤 → `ownHqHp` 项 +90，且不被锁在低分位。

**3）两线同时开战 → 正确做法是"扶弱打强、专注一家"**
实际做法：R3-R4 我既在西线打 player_b 的 cp_w、又在北线跟 player_c 抢 cp_ne，兵力一分就两头都丢。正确做法：**开局只攻一家（先压死一家拿满它那侧的点），对另一家只守不攻**；在本局应专注北线 player_c（它已打到我家门口），西线 cp_w 让给 player_b（让 player_b 和 player_c 在东线 cp_se/cp_e 互相消耗）。触发条件：3 方博弈中当你已同时与两家接壤。预期收益：避免 R4 同时丢 cp_ne 又没抢到 cp_w 的双输，兵力能集中保住 2 点并反杀 player_c。

**4）未察觉第三方正在吞并 → 正确做法是"盯着领先者的 HQ 进度"**
实际做法：R7-R11 我埋头清 player_c 残部，没发现 player_b 已经对 player_c 完成"5 点雪球 + HQ 远征"的双线。正确做法：**每轮读 `attack` 事件里对 HQ 的伤害，一旦发现某家 HQ 被打、且打它的是另一个领先者，立即评估是否要抢先手补刀或转攻那个领先者**。触发条件：多人局出现"一家 HQ 持续掉血"。预期收益：至少能意识到 player_b 才是真对手，把 R9-R11 的 AP 从清残部转向南下抢点/袭扰，而不是等它吞完第三家再正面硬碰。

## 与历史对局对比

本局与同为 multiplayer-ring 3 人局的 `tg_0031`（`tg_0031_rank02_OMP@step3.7flash.md`）形成对照：那局 rank02 的败因是**"过度防守"**（守着 cp_e 不扩张、不遏制对手，最终裁决分落后），本局我犯的是**镜像反面的"过度扩张"**（抢点太快、家空被偷、两线开战）。两局共同点：multiplayer-ring 3 人局里，**"据点流量（controlHold 时间平均）+ 对某一家完成 HQ 伤害/淘汰"是决定名次的两个最大杠杆**；而先手 `player_a` 若不能把先手优势守住，就会被后手玩家用"偷 home 点 + 雪球"反超。本局新发现：与 tg_0031 不同，本局胜者 player_b 的 `killValue` 只有 117（几乎不靠击杀），**纯粹靠 180 点 HQ 伤害（900 分）+ 4 点流量（约 304 分）** 就锁定了 1720 分——说明这张图上"远征 HQ"是比"击杀单位"回报率高得多的取胜路径，而我全场 HQ 伤害为 0，是排名落后的最直接原因。

## 总结

### 做得好的
1. **后期三连击止损**：R11 杀 player_b 中心步兵（seq251）→ R12 夺中央 repair（seq275）→ R13 杀 player_b ranger（seq291），`killValue` 冲到全场最高 317，把第 2 名从 player_c（558.9）手里稳稳夺下。
2. **集火效率高**：对 player_c 的 ranger/scout/步兵连续集火，R4-R9 五轮反杀 5 个单位，全程没有"移动后空转"的明显浪费。
3. **补给利用充分**：9 次部署、7 次走 cp_ne 折扣（省 28 补给），把 200 追分补给都转化成了军力，最终 `armyValue 279` 与 winner 的 302 相差无几。

### 下次改进
1. 触发条件：开局 scout 抢到 home 点后 → 立刻留步兵守家，别两个 scout 全外派（本局 cp_nw 被偷）。
2. 触发条件：看到敌方 ranger 进入我 HQ 3 格 → 第一优先集火秒掉，先清远程再谈占点（本局白挨 90 伤）。
3. 触发条件：多人局同时与两家接壤 → 专注压一家、对另一家只守不攻（本局两线开战两头丢）。
4. 触发条件：`attack` 事件里出现某家 HQ 持续掉血 → 立即盯紧领先者，评估补刀或转攻（本局没发现 player_b 的 HQ 远征）。

> **核心口诀：先手抢点要"抢得到、留得住"，远程威胁先秒掉，多人局盯着领先者别让它吞掉第三家。**

**一句话总结：** 我用全场最高的击杀（killValue 317）和后期军力反超换来了第 2 名，但"开局家空被偷、被 ranger 白打 90 伤、全程 HQ 伤害为 0"三点叠加，让我从 R4 起就再也追不回 player_b 的 5-CP 雪球和 900 分 HQ 伤害。
