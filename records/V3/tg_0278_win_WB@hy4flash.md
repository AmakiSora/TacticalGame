# 战术游戏歼灭模式复盘 — `player_a` 视角

**日期/游戏ID/回放版本:** 2026-11-24 / `bb78cc1e-5b9e-4c56-9bcc-0cbdcdab4b00` / `hex-v2-replay` `schemaVersion 3.9.11`（288 事件，导出于 `2026-11-23T23:39:35.598Z`，本地 11-24）
**地图/参战人数:** `artillery-zone`（炮火禁区，半径 6、127 格、`maxTurns 20`、`actionsPerTurn 4`）/ 2 人；**模式:** `annihilation`（逐人回合 × 歼灭缩圈，无 HQ）
**玩家:** Hy4Flash-WB（WB@hy4flash，本局 `player_a`）对阵 HungerG-QD（`player_b`，房主）
**席位与出生:** `player_a` / `slot_west`，出生据点 `cp_west (-4,0)`；初始单位 2×infantry `(-5,0)`/`(-5,1)` + 1×heavy `(-4,-1)`，初始补给 45（R1 先手贴目 +12 → 57）；对手 `player_b` / `slot_east`，出生据点 `cp_east (4,0)`，初始 2×infantry + 1×heavy、补给 45（R1 先部署 infantry −45 → 0，无贴目）。**HQ：不适用（无HQ）**，回放 `mode = config.mode = annihilation`。
**结果:** 🏆 第 1 名 — `last_player_standing`（`game_over` seq288，`winner: player_a`）
**结束轮次:** 第 15/20 整轮；**最终存活单位/补给:** 6 / 195（对手 0 / 179）

> **取证声明：** 全文数字、seq、坐标与归属均出自房主归档回放 `records/V3/tg_0277_20261124.json`；未调用 `/api/games/:id/events` 拼装回放，未生成、下载或覆盖任何 `tg_*.json`，未用对局中途记忆的数字补写。回放中无 `turn_skipped` / `host_eliminated` / `host_force_resolve` 等管理干预事件；`player_eliminated`（seq287）由炮火结算触发、非房主操作。仅采用服务器 `review.md` → `review-annihilation.md` v3.1（V3）规范。

## 最终排名与淘汰

| 名次 | 席位 | 状态 | 总分 | 军力价值 | 期末据点 | 主要死亡/优势原因 |
|---|---|---|---:|---:|---:|---|
| **1** | `player_a`（WB@hy4flash） | active | **549.5** | **185** | 5 | 我方 5 个单位死于攻击，但全程 8 次部署 + 6 次攻击击杀累计 `killValue 359`，终局 6 单位存活 |
| 2 | `player_b`（HungerG-QD） | eliminated | 120 | 0 | 3 | 6 个单位死于攻击、最后 1 个步兵在第 13–15 轮连续吃炮火后 `unit_death cause: artillery`（seq283）；`player_eliminated.reason = artillery_destroyed`（seq287） |

`game_over.payload.rankings` 中我只此一人 `rank:1`，故文件按 `win` 命名。分差 **429.5** 的构成：军力项 `(185−0)×2 = +370`（86.2%），击杀项 `(359−240)×0.5 = +59.5`（13.8%）；据点与补给权重均为 0，不构成裁决分。对手 `killValue 240` 来自击杀我方 5 个单位（45+45+60+45+45），我方被击杀的 5 个单位全部 `cause: attack`，没有被炮火打死的单位。

## 炮火与安全区时间线

炮火配置（回放 `game_start.payload.config.annihilation.artillery`）：`startRound 5`、`intervalRounds 2`、`damage 25`、`minimumSafeRadius 1`。预警出现在第 4/6/8/10/12 轮，收缩出现在第 5/7/9/11/13 轮，安全半径 6→5→4→3→2→1，末次 `nextShrinkRound: null`。

| 轮次 | 事件 / seq | safeRadius | warning / danger 关键格 | 我的单位位置（事件时刻） | 撤离 / 承伤 / 击杀 | 决策评价 |
|---|---|---:|---|---|---|---|
| R4 | `artillery_warning` seq58 | 6 | 预警 36 格（外圈 q=±6 环等），danger 0 | 5 单位全在半径 ≤2：`(-1,3)` 附近以外均内圈 | 0 单位在预警环，无需撤离；当轮部署 support 到 `(0,-2)`（seq72） | 优：第一次预警只作信息，没有打断占点/扩军 |
| R5 | `artillery_shrunk` seq79 | 5 | danger 36（半径6环），warn 0，next=7 | 5 单位均在半径 ≤3 | 0 承伤；本轮击杀敌 infantry（seq94/95，+45） | 优：缩圈首刀落空，双方都未交学费 |
| R6 | `artillery_warning` seq102 | 5 | 预警 30 格，danger 0，next=7 | 我 6 / 敌 4 单位，均不在预警环 | 0 承伤；本轮把 support 从 `(0,-2)` 拉到 `(-1,-2)`（seq117） | 良：开始把脆皮支援后撤，但仍在半径 2，离敌 heavy 过近 |
| R7 | `artillery_shrunk` seq125 | 4 | danger 66，warn 0，next=9 | 我 7 / 敌 5 单位，0 在危险环 | 0 承伤；本轮 3 个单位被攻击打死（seq129/133/136），击杀敌 ranger（seq142/143，+72） | 中：缩圈无损，但交战损失集中在支援/步兵，换到敌方远程算划算 |
| R8 | `artillery_warning` seq151 | 4 | 预警 24 格，danger 0，next=9 | 我 5 / 敌 4 单位，0 在预警环 | 0 承伤；三 infantry 集火敌 heavy 至 11HP，seq170 击杀（+92） | 优：预警窗口没有被外圈单位牵制，全力完成本局最大单笔击杀 |
| R9 | `artillery_shrunk` seq175 | 3 | danger 90，warn 0，next=11 | 我 infantry `0f9a` 在 `(-3,-1)`（半径4）落入危险区 | `artillery_damage` seq176：该步兵 −25→75HP；当轮已撤至 `(-3,0)`（seq189，半径3） | 差：R8 把该单位推到 `(-3,-1)` 换击杀，缩圈前一刻未算半径，白吃 25 点；好在下一回合立刻内移 |
| R10 | `artillery_warning` seq196 | 3 | 预警 18 格（半径3环），danger 0，next=11 | 我方 3 单位在半径3：`(-3,0)`、`(-2,-1)`、`(0,-3)`；敌 1 单位 `(2,-3)` 在环上 | 我把其中 2 个移到 `(-2,0)`/`(-1,-1)`（seq211/212），`(0,-3)` 步兵在敌回合被击杀（seq200/201）；R11 收缩时我方存活单位 0 承伤 | 优中带损：**首次真正按预警撤离**，2 个存活单位退出下一圈危险区，但预警中的第 3 个单位是靠对手动手才离圈；敌 `(1,-3)` 步兵 R11 吃 −25（seq219） |
| R11 | `artillery_shrunk` seq218 | 2 | danger 108，warn 0，next=13 | 我方 ranger `c2d7` 在 `(-1,-2)`（半径3）、敌 infantry `ca0c` 在 `(1,-3)`（半径3） | 双方各吃 25：seq220 我 ranger 72→47，seq219 敌步兵 100→56；我 two infantry+ranger 击杀敌 support（seq234，+60）与 infantry（seq238，+45） | 中：及时拿到两笔击杀，但 ranger 收圈当口仍在危险环，且我随后把它移到 `(-2,-2)`（半径4）而非内圈 |
| R12 | `artillery_warning` seq243 | 2 | 预警 12 格（半径2环），danger 0，next=13 | 我方 inf `(-2,0)`、`(0,-2)` 在环上；敌 2 单位在环上 | ranger 在 `(-2,-2)` 再吃 25→22（seq244）；当轮把 ranger 移到 `(-1,0)`、其余全部进半径≤1（seq253/256/257/258），击杀敌最后一兵以外的 infantry（seq254/255，+45） | 优中带错：**最终撤离执行到位**（R13 收缩时我方 0 承伤），但 ranger 因上一步误判多吃一轮 25 |
| R13 | `artillery_shrunk` seq261 | 1 | danger 120，warn 0，next=null | 我 6 单位全在半径≤1；敌最后 infantry `6a28` 在 `(2,-2)`（半径2） | 敌 −25→45（seq262），其攻击仍打到我 inf（seq265）；我方不再追击外圈 | 优：半径1封顶后，安全格全在我手里，让炮火替我放血 |
| R14 | （无新收缩） | 1 | danger 120，warn 0 | 敌最后 infantry 从 `(3,-2)` 走回 `(2,-2)`（seq275），仍在半径2 | 敌 −25→20（seq272）；其攻击打我 inf 23（seq276） | 优：不追出安全圈，避免把胜利交给交换 |
| R15 | `unit_death` seq283 → `game_over` seq288 | 1 | danger 120 | 敌 infantry `6a28` 在 `(2,-2)` | 炮火 −20→0（seq282），`cause: artillery`；3 个敌方据点中立（seq284–286），`player_eliminated artillery_destroyed`（seq287），我 `last_player_standing` | 炮火击杀**无归属、不计 killValue**；但清掉最后一个敌军即触发胜利 |

炮火账本：`artillery_damage` 共 7 条。我方承伤 **75**（inf `0f9a` R9 25；ranger `c2d7` R11 25 + R12 25），**0 个单位死于炮火**；敌方承伤 **95**（inf `ca0c` R11 25；inf `6a28` R13 25 + R14 25 + R15 20），**1 个单位死于炮火**（seq283）。双方吃炮火的 7 条里有 4 条可通过提前一回合内移避免（我方 ranger 的 2 条 + 敌方最后步兵的 3 条中至少 2 条）。

## 单位、据点和补给时间线

本图单位实例值：infantry 100HP/攻30/防8/移3/程1/费45/可占点；scout 65/16/4/移5/程1/费38/可占点（本局双方均未部署）；heavy 150/38/13/移2/程1/费92；ranger 72/44/3/移3/**程3**/费72；support 82/10/5/移3/程1/费60/治疗22。`damageVarianceRange 3`、`minimumDamage 1`、`healVarianceRange 6`；伤害 = 38−13±3 等按低roll规划，击杀按最后一击归属。据点：`supply` 收入8、`forward_base` 收入4，三类均 `deployDiscount 0`，所有类型均可部署（无 `canDeploy:false`）。

| 轮次 | 我方关键动作（每轮 4 AP，括号为 seq） | 对手响应 / 事件 | 我方补给（回合开始→结束） |
|---|---|---|---|
| R1 | `cp_west` 部署 infantry@`(-3,0)`（12）占 `supply_west`（16）；heavy→`(-2,-1)`、两 infantry→`(-2,-2)`/`(-3,2)`（13/14/15） | 敌 `cp_east` 部署 infantry@`(3,0)`（4）、3 次移动（5–7）占 `supply_east`（8） | 45+12 komi=57 → 12 |
| R2 | heavy 移到 `(0,-1)` 打敌 infantry −32（29/30）；infantry 移到 `(0,0)` 补 −24（31/32，敌残 44）；两 infantry 占 `supply_northwest`(0,-3)、`supply_southwest`(-3,3)（33–36） | 敌 4 次移动推进到 `(1,-1)/(3,-3)/(2,0)/(1,0)` 并占 `supply_northeast`（21–25） | 12+20=32 → 32（未部署） |
| R3 | heavy 打残敌 infantry 至 15（50/51）；`supply_northwest` 部署 infantry@`(1,-3)`（52）；infantry 打到敌 infantry 75（53）；占 `supply_southeast`（54/55） | 敌 3 发集火把我 `(0,0)` infantry 打到 23（41/43/45）、`supply_east` 部署 infantry（46） | 32+36=68 → 23 |
| R4 | 我 `(0,0)` infantry 被 heavy 打死（61/62，敌 +45）；`supply_northwest` 部署 support@`(0,-2)`（72）治疗 heavy +23→137（73）；heavy 打敌 heavy −28（74）；infantry 打敌 infantry −20（75） | 敌 4 次攻击打我 heavy 共36、support −20、infantry −22（63–68） | 23+44=67 → 7 |
| R5 | support 治疗 heavy +28→150（91）、退到 `(-1,-2)`（92）；heavy 移 `(2,-1)` 击杀敌 infantry 15HP（93/94/95，+45）；infantry 打敌 infantry −19（96/97）；部署 infantry@`(0,-2)`（98）打敌 heavy −18（99） | 敌 heavy 打 support −31（83）、两 infantry 打我 infantry/infantry −22/−23（84/86）、另一步兵打 heavy −15（85） | 7+44=51 → 6 |
| R6 | support 攻敌 heavy 1 并退 `(-2,-2)`（116/117）；部署 infantry@`(-1,-2)`（118）打 heavy −18（119）；heavy 打敌 ranger −33（120）；infantry 移 `(1,0)` 补 −30（121/122），ranger 残 9HP | 敌 `supply_east` 部署 ranger@`(2,0)`（105）并打我 infantry −39（106）；infantry 补 −20 使该兵 18HP（107）；heavy 打 support −34→17（110）；infantry 打 infantry −22（112） | 6+44=50 → 5 |
| R7 | heavy 移 `(1,0)` 击杀敌 ranger 9HP（141/142/143，+72）；两 infantry 集火敌 heavy 至 47（144–146）；部署 infantry@`(1,-3)`（147）打敌 infantry −25（148） | 敌 ranger 反杀我 18HP infantry（128/129，敌 +45）、两 infantry 杀我 16HP infantry（130–133，敌 +45）、heavy 杀 support（134–136，敌 +60） | 5+44=49 → 4 |
| R8 | 三 infantry 集火敌 heavy：−19、−17、−11 击杀（165–171，+92）；部署 infantry@`(0,-2)`（172） | 敌 heavy 打我 infantry −32（154）、两 infantry 打新兵 −23/−19（156/158）、部署 support@`(3,-2)`（160）治疗 infantry +26→81（161） | 4+44=48 → 3 |
| R9 | 我 `(-3,-1)` infantry 吃炮火 −25（176）后移到 `(-3,0)`（189）；infantry 退 `(0,-3)`（190）；heavy 打敌 infantry −32（191）；另一 infantry 打敌 infantry −21（192/193） | 敌 4 次移动 + 3 次攻击：把我 `(1,-3)` infantry 打到 17，heavy −14（179–185） | 3+44=47 → 47（未部署） |
| R10 | 2 次内撤（211/212）；`supply_northwest` 部署 ranger@`(-1,-2)`（213）**免费首发**打敌 support −42（214）；heavy 补 −32 使 support 残 8（215） | 敌 infantry 击杀我 `(0,-3)` 的 17HP infantry（199/200/201，敌 +45）；support 移到 `(1,-1)` 治疗 infantry +21（202/207） | 47+44=91 → 19 |
| R11 | infantry 移 `(1,-1)` 击杀敌 support 8HP（232/233/234，+60）；另一 infantry 打敌 infantry −20 至 36（235/236）；ranger 移 `(-2,-2)` 后击杀该 infantry（237/238/239，+45）；heavy 打敌最后 infantry −30（240） | 炮火双方各 −25（219/220）；敌 3 次攻击打我 infantry −23、heavy −18/−1，support 撤走（223–228） | 19+44=63 → 63（未部署） |
| R12 | ranger 移到 `(-1,0)` 击杀敌 infantry 24HP（253/254/255，+45）；infantry 移到 `(-1,1)`、`(0,0)`、`(0,-1)` 全部进半径≤1（256–258） | 敌最后 infantry 打我 heavy −20（247）并移到 `(2,-2)`（248）；另一 infantry 移到 `(-1,1)`（249）后被击杀 | 63+44=107 → 107（未部署） |
| R13 | 无我方行动（所有单位已在安全环，敌最后单位在外圈） | 敌 infantry 吃炮火 −25→45（262），打我 infantry −21（265）后移到 `(3,-2)`（266） | 107+44=151 → 151 |
| R14 | 无我方行动 | 敌 infantry 再吃 −25→20（272），从 `(3,-2)` 回 `(2,-2)`（275）并打我 infantry −23（276） | 151+44=195 → 195 |
| R15 | 无我方行动 | 炮火 seq282 击杀敌最后 infantry（seq283）；3 据点中立（284–286）；`player_eliminated` seq287；`game_over` seq288 | 195 → 195 |

**据点与部署通道：** 我方期末 5 点：`cp_west`、`supply_west`、`supply_northwest`、`supply_southwest`、`supply_southeast`（seq16/35/36/55 全部在 R1–R3 拿下）；敌方 3 点：`cp_east`、`supply_east`、`supply_northeast`（seq8/25），直至 seq284–286 才在淘汰时中立。我方 8 次部署：`cp_west` 1 次（R1 infantry）、`supply_northwest` 7 次（R3/R5/R6/R7/R8 infantry、R4 support、R10 ranger），共花 **402**；敌方 4 次部署（`cp_east` R1 infantry、`supply_east` R3 infantry/R6 ranger、`supply_northeast` R8 support），共花 **222**。R11 安全半径降到 2 后，我方所有据点坐标半径均 ≥3，已无合法部署来源；因此 R10 的 ranger 是本局最后一次部署。**收入总额我方 552、敌方 356**（含 R1 我 komi +12）；期末剩余补给 195 vs 179（`supplies` 权重 0，仅代表未转化为军力的资源）。治疗 4 次：我方 support 在 R4/R5 给 heavy +23/+28（seq73/91），敌方 support 在 R8/R10 给 infantry +26/+21（seq161/207）——敌方支援多撑了 3 轮，直到 R11 被我集火击杀。

## 核心教训与关键转折

1. **R1–R3 抢点 + 将补给变军力（经济转折）：** 开局 4 AP 全部用于部署/移动占点，R1 拿 `supply_west`（seq16），R2 拿 `supply_northwest`/`supply_southwest`（seq35/36），R3 拿 `supply_southeast`（seq55）；我方收入从 12（komi）→20→36→44，敌方停在 28。R4 起我每轮 44 收入、对手 28，**多出的 16/轮 = 约每 3 轮一把 infantry**，这是后期能连续补 6 把步兵 + 1 把 ranger 的根基。
2. **R4 预警后不误撤 vs R9 迟撤的对照（炮火转折）：** R4 首次 `artillery_warning`（seq58）外圈 36 格，但双方 10 个单位全在半径 ≤3，故没有为了“看起来该撤”而空跑；R8 三 infantry 为击杀 heavy 推 `0f9a` 到 `(-3,-1)`，R9 缩到半径3 时它是唯一在危险环的我方单位，白吃 25（seq176）。随后 R10 预警（seq196）我方 3 个半径3单位中，2 个在己方回合内撤到 ≤2，另 1 个 `(0,-3)` 步兵在敌回合被击杀（seq200/201）；R11/R13 两次收缩我方存活单位 0 承伤——**预警后一轮内撤完，比“多换一发伤害”更值**。
3. **R7–R8 集火顺序兑现为 killValue（交换转折）：** R6 我 heavy+R1 infantry 把敌 ranger 打到 9HP（seq120/122），R7 heavy 一击收掉（seq142/143，+72），直接废掉敌射程3优势；R8 三 infantry 把敌 heavy 从 150 打到 11 再收（seq165–171，+92），是本局最大单笔 killValue。两笔合计 164，占我方 `killValue 359` 的 45.7%。优先顺序确实是“可击杀残血 → 高价值重型/远程 → 占点单位”，而非平均 chip。
4. **R10 ranger 落地 + 免费首发打断治疗链（终局转折）：** 在 `supply_northwest` 部署 ranger（seq213，成本72）后立刻免费攻击敌 support −42（seq214），heavy 补 −32（seq215）；R11 击杀 support（seq234，+60）与 infantry（seq238，+45）。敌方 R8/R10 两次治疗（seq161/207）本可把步兵反复拉满，支援一死，其军力从 R10 后的 167 一路掉到 0。
5. **R12 全员进半径1 + 据点淘汰（收官转折）：** 预警半径2环出现时（seq243），我把 ranger 移到 `(-1,0)`、三名步兵填进 `(0,0)`/`(-1,1)`/`(0,-1)`（seq253/256/257/258），同时击杀敌倒数第二兵（seq254/255）。敌最后一个步兵被关在 `(2,-2)` 外圈，R13/R14/R15 连吃 25/25/20 后炮火阵亡（seq282/283），3 个据点中立（seq284–286），触发 `last_player_standing`。**炮火击杀无归属，但它替我完成了最后一击**。

## 炮火、军力与裁决分账本

按回放 `config.balance.adjudicationWeights`：`enemyHqDamage 0`、`ownHqHp 0`、`controlPoint 0`、`armyValue 2`、`supplies 0`、`killValue 0.5`；`controlPointFlowRatio 0.7`。规范公式（HQ 两项写“不适用（无HQ）”，不填 0 冒充可分析数据）：

`不适用（无HQ） + 不适用（无HQ） + (controlHold×0.7 + 期末据点×0.3)×0 + 存活军力×2 + 剩余补给×0 + 击杀造价×0.5`

| 项目 | 我方 / 敌方 | 权重 | 依据与折算 |
|---|---:|---:|---|
| HQ伤害 / HQ最终HP | **不适用（无HQ）** / **不适用（无HQ）** | 0 / 0 | `mode=annihilation`，回放无 HQ 对象；不参与公式 |
| 据点流量持有 / 期末据点数 | `controlHold 4.71` / `2.93`；`5` / `3` | controlPoint `0` | `control_point_captured` seq8/16/25/35/36/55 + 14 条 `round_end`；权重0 → 得分0，但决定 44 vs 28 的收入与部署通道 |
| 存活军力价值 | `185` / `0` | `2` | `game_over.payload.scores`；我方 6 单位、敌方 0；得分 `370` vs `0` |
| 剩余补给 | `195` / `179` | `0` | 收入总 552/356 − 部署花费 402/222 + 起始/贴目；权重0 → 得分0 |
| 击杀造价 `killValue` | `359` / `240` | `0.5` | 我方最后一击：inf45(seq95)+ranger72(seq143)+heavy92(seq171)+support60(seq234)+inf45(seq239)+inf45(seq255)=359；敌方：inf45(seq62)+inf45(seq129)+inf45(seq133)+support60(seq136)+inf45(seq201)=240；得分 `179.5` vs `120` |
| 炮火承伤 / 击杀 | 承伤 75 / 95；炮火击杀 0 / 1 | — | `artillery_damage` 7 条、`unit_death cause: artillery` seq283；非独立裁决项，炮火击杀无归属不计分 |
| 单位死亡原因 | 我：5 攻击 / 0 炮火；敌：6 攻击 / 1 炮火 | — | `unit_death` 12 条（seq62/95/129/133/136/143/171/201/234/239/255/283） |
| **总分** | **549.5** / **120** | — | `game_over.payload.scores`；`370 + 179.5 = 549.5`，`0 + 120 = 120` |

据点权重虽为 0，仍须按战略价值看：我方 4 个 `supply` + 1 个 `forward_base` 是 44/轮收入；敌方 2 supply + 1 forward_base 是 28/轮。第 15 轮 `player_b` 被淘汰时 `neutralizedPointIds = [cp_east, supply_east, supply_northeast]`（seq284–286），其收入通道和部署来源同时归零，但此时对局已结束，对排名无额外影响；我方全程未丢据点，也就没有因中立而损失收入/增援。

## 实际做法 vs 正确做法

第一名也复盘风险与低效，以下 3 条均以回放为准：

1. **R3 把 infantry 推到 `(0,0)` 当最前点（seq31/32）→ R4 被 3 发集火打死（seq61/62，敌 +45）。** 触发条件：该兵血量 23、距敌 heavy `(1,-1)` 1 格、距另两 infantry `(1,0)`/`(2,-2)` 均在 3 格内，而我方 support 尚未部署。正确做法：R3 打完 −24 后应把该兵后撤到 `(−1,0)` 并与 heavy 贴住，或先用 1 AP 在 `supply_northwest` 部署 support 再前压；把 45 造价送到对手击杀账上，直接造成我方 `killValue` 从 0 变 45。
2. **R4 把 support 部署在 `(0,-2)`（seq72）后仅治疗（seq73），没有立刻后撤；R5/R6 连吃 heavy −31（seq83）、−34（seq110），R7 阵亡（seq135/136，敌 +60）。** 触发条件：敌 heavy 已在 `(1,-1)`、infantry 在 `(2,-2)`，support 距两者均 ≤2；`healRange` 回退到 `attackRange 1`，必须贴身才能治疗，等于把自己送到近战线上。正确做法：先让 heavy 前顶、support 落在 `(-1,-2)` 等半径1格，或治疗当回合就移到 `(-2,-2)` 之外；60 造价支援存活到终局可多提供约 120 军力分（权重2）。
3. **R11 把中炮火的 ranger 从 `(-1,-2)` 移到 `(-2,-2)`（seq237），半径从 3 变 4，仍在外圈，R12 再吃 25→22HP（seq244）。** 触发条件：R11 `safeRadius 2`，`(-2,-2)` 的 `max(|−2|,|−2|,|4|)=4`，半径反而变大。正确做法：R11 直接像 R12 seq253 那样移到 `(-1,0)`（半径1），省下 25HP 和一次无效位移；这是我方 75 点炮火承伤中唯一完全可避免且无战术收益的部分。

## 与历史对局对比

对照同为 WB@hy4flash 的两局历史回放，只比较可核实的数字；三局模式/地图/权重不同，分数不能直接横比，仅作路线对照。数据分别出自 `records/V3/tg_0274_20261117.json` 的 `tg_0274_lose_WB@hy4flash.md` 与 `records/V3/tg_0271_20261116.json` 的 `tg_0271_win_WB@hy4flash.md`。

| 对局 | 模式/地图 | 首次预警外圈单位 | 炮火承伤（我/敌） | 炮火死亡（我/敌） | 最终 `killValue`（我/敌） | 终局军力（我/敌） | 结果 |
|---|---|---|---:|---:|---:|---:|---|
| **本局 0277** | annihilation·artillery-zone | R4 预警 36 格，**0 单位**在环内 | **75 / 95** | 0 / 1 | **359 / 240** | **185 / 0** | 第1名，R15 `last_player_standing` |
| 0274 | royale·narrow-road | R9 预警 10 格；该局复盘记载外圈已有 inf `(5,1)`、heavy `(6,-1)`，另 scout `(3,0)`（未逐格核数，无法可靠统计环内精确单位数） | 32 / 5 | 3 / 1 | 30 / 32 | 0 / 23 | 第2名，`artillery_destroyed` |
| 0271 | royale·mirror-lake | R5 预警 36 格（回放未逐数环内单位，**无法可靠统计**） | 240 / 440 | 1 / 4 | 605 / 477 | 48 / 0 | 第1名，R16 `last_player_standing` |

- 与 **0274 惨败**比：那局首轮预警已有 2 个单位站在外环，累计承伤 32、3 个单位被炮火清掉，终局军力归零；本局首次预警时 0 单位在环内，整局我方 0 炮火死亡，说明“预警窗口先把外圈清空”比事后补救更有效。两局我方 `killValue` 从 30 提升到 359，终局军力从 0 变成 185，胜负随之倒转。
- 与 **0271 大胜**比：那局靠 arc/ranger 锁定拿到 605:477 的击杀差，但自己也吃 240 炮火、1 个单位死于炮火；本局击杀差更小（+119）且炮火承伤只有 75，靠的是 44 vs 28 的经济差持续补兵 + 把敌军赶出半径1安全圈。两局都验证：**在有 `killValue` 权重的图上，主动集火残血/高价值目标 > 屯兵；但炮火伤害必须尽量由对手承担。**
- 三局均无 HQ 得分项；0274 的 `artillery_destroyed` 与 0271/0277 的 `last_player_standing` 也提醒：被炮火清场与被战斗清场在淘汰原因上必须分开写，不能混作“被打崩”。

## 总结

> **核心口诀：预警先清空外圈，补给先变部署通道；残血集火拿造价，最后把对手留在圈外。**
> **一句话总结：第 1–3 轮抢下 4 个补给点把收入做到 44/轮，第 4–12 轮按预警逐圈内撤并用 8 次部署和 7 笔击杀把敌方军力打到 0，终局以 549.5:120、6:0 存活单位在第 15 轮靠炮火清掉最后一个敌军，拿下 `last_player_standing`。**
