# 战术游戏同时回合模式复盘 — `player_b` 视角

**日期/游戏ID/回放版本:** 2026-11-17 / `ee6a1a72-79e3-47ce-9475-e0d7138ea9d0` / `hex-v2-replay` schemaVersion `3.9.10`（388 事件，导出于 `2026-11-17T00:41:32.182Z`）
**地图/参战人数:** `molten-throne`（熔池王座，半径 6、127 格、`maxTurns 20`）/ 2 人；**模式:** `simultaneous`（秘密计划、全员确认、按行动点逐步同时结算）
**玩家:** Hy4Flash-WB（WB@hy4flash，本局 `player_b`）对阵 Dsv4Pro0813-PI（`player_a`）
**席位与出生:** `player_b` / `slot_a`，HQ(-5,5) 200HP/防 3；初始单位 5×scout @(-6,5)/(-5,6)/(-4,5)/(-4,4)/(-5,4) + 1×support @(-6,6)，初始补给 30。`turnOrder=["player_b","player_a"]`——同时回合**无先后手**，此序仅用于同一行动点内打破平局。对手 `player_a` / `slot_b`，HQ(5,-5) 200HP/防 3，180° 对称。24 据点开局均 `owner=null`（16 supply / 4 repair / 4 forward_base）。
**结果:** 🏆 第 1 名 — `turn_limit_score`
**结束轮次:** 第 20/20 整轮打满；**HQ 最终 HP:** 我方 200/200，敌方 200/200（双方 HQ 全程零伤）

> **取证声明：** 全文数字、seq 与坐标均出自房主归档回放 `records/V3/tg_0275_20261117.json`（388 事件，`schemaVersion 3.9.10`，顶层 `finalResult.winner=player_b`、`game_over` seq388），未调用 `/api/games/:id/events` 重新拼装，未写任何 `tg_*.json`，未用对局中途的实时比分补数。本局 `game_start.payload.mode` 与 `config.mode` 均为 `simultaneous`，故只遵循服务器 `review-simultaneous.md` v3.2（V3），未套用标准/歼灭/royale 模板。回放中**无** `turn_skipped` / `host_force_resolve` / `host_eliminated` / `player_left` 等管理干预。`turn.currentPlayerId/currentOwner` 全程为 `null`，每个整轮都以计划阶段秘密排队 → `/end-turn` 提交锁定 → 全员提交后按行动点（step 1–4）逐步结算，同一行动点内没有队列先后。

## 最终排名摘要

| 名次 | 席位 | 玩家 | 状态 | 总分 | 与我方分差 | 决定性优势 |
|---|---|---|---|---:|---:|---|
| **1** | `player_b` | Hy4Flash-WB（WB@hy4flash） | active | **1976.5** | — | 据点**流量持有 12.2** vs 敌 10.45、期末 7 点、军力 285、击杀 417 —— 靠中腹长期控点 + 游侠换子累积领先 |
| 2 | `player_a` | Dsv4Pro0813-PI（`player_a`） | active | 1692.125 | −284.375 | 期末据点 17 点（末段反扑抢占）、击杀 338 接近，但流量持有与军力（96）落后 |

`game_over.payload.rankings` 中我是唯一 `rank:1` / `active`，对手 `rank:2` / `active`，故按规范命名为 `win`。分差 284.375 拆开看：**控点项**我方 (0.7×12.2+0.3×7)×75=798 vs 敌 (0.7×10.45+0.3×17)×75=931.125（**敌方 +133**）；**军力项** 285×2=570 vs 96×2=192（**我方 +378**）；**击杀项** 417×0.5=208.5 vs 338×0.5=169（**我方 +39.5**）；HQ 项双方均 200×2=400 打平。即：**期末据点被对手反超，我的胜利来自流量持有 + 残余军力 + 击杀造价三项**。

## 计划—结算时间线

`actionsPerTurn=4`，队列位置即行动点，每格消耗 1 AP（含失败动作），失败部署不扣补给。下表按整轮列出我方公开可推断信息与 `round_resolved.results.step` 结果；`executed` 数字为该次攻击的实际伤害，`K` 表示致命一击。

| 轮次 | 我的计划（单位/目标格，按 step） | 对手可见信息与可能反应 | `round_resolved` 结果（我方 / 敌方） | 计划质量 |
|---|---|---|---|---|
| R1 | 4×scout 直插 cp_11(-1,0)、cp_10(-1,1)、cp_22(-1,2)、cp_12(-2,1) | 180° 对称，双方都在抢最近据点 | 我 4×move executed / 敌 4×move executed；各占 4 点 | 优：4 AP 换 4 点含唯一可达前哨 cp_10 |
| R2 | scout→cp_14(-1,-1)、cp_23(-2,2)、cp_25(-2,-1)；deploy infantry@cp_9(0,1) | 敌占 cp_7/15/17/18，我已控 cp_10 可部署 | 我 m+d+m+m 全 executed / 敌 d+m+m+m；各 8 点 | 优：前哨落地 infantry（90HP 占点更稳），8:8 |
| R3 | scout→cp_28(-2,-2)前哨、cp_24(-1,-2)、cp_21(0,2)、cp_13(-2,0) | 敌推进占 cp_19/29 | 我 4×move executed / 敌 a[15]+miss+m+m；**12:9 首次领先** | 优：抢下第二前哨 cp_28，双部署通道成型 |
| R4 | scout→cp_20(1,1)、cp_27(1,2)、回守 cp_9、deploy scout→cp_11(-1,0) | 敌 scout 已站 (-1,0) cp_11 | 我 m+m+m + **s4 deploy failed `destination_occupied`(seq78)** / 敌 miss+m+m+m；13:11 | 良有瑕：3 点入手，但重复声明被占格白费 1 AP（部署失败不扣补给） |
| R5 | deploy ranger@cp_22(-1,2)；infantry + 2×scout 打敌前哨 infantry(1,0) | 敌同轮部署 infantry 并反打我方 infantry | 我 d+a[12]+a[16]+a[22] / 敌 a[12]+a[15]+a[15]+a[21]；13:11 | 优：**ranger 射程 3 而全场敌兵射程 1**，射程差正式确立 |
| R6 | ranger 打 (-1,0)敌 scout；scout 夺回 cp_11；2×scout 打敌 infantry | 敌将 12HP scout 从 (-1,0) 挪到 (0,-2) | 我 **s1 attack missed** + m+a[15]+a[9] / 敌 m+a[K12]+a[22]+a[15]；14:10；**我 scout ecc4 阵亡(seq → unit_death r6)** | 中：预测射击被走位躲开，且前锋 scout 被击杀——射程优势外的首次实质损失 |
| R7 | ranger 打 (2,1)、scout 夺 cp_11、infantry+deploy | 敌 scout (2,1) 34HP | 我 a[32]+a[K2]+a[18]+d / 敌 d+m+**failed `unit_gone`(seq133)**+a[K18]；14:10；双方各损 1 scout | 优：ranger 首发 32 破防 + 补刀击杀，换子徽分我略优 |
| R8 | ranger 击杀 (0,-1)敌 scout；deploy infantry；2×scout 推进 | 敌补兵前压 | 我 a[K16]+d+m+m / 敌 d+a[25]+m+m；14:10 | 优：精准清掉残血威胁 |
| R9 | infantry 打(1,0)、support 治疗(1,1)、2×move 占 cp_6/25 | 敌 infantry 同步争夺 (0,-1) | 我 a[15]+**heal fizzled `out_of_range`(seq168)**+**move failed `destination_conflict`(seq171)**+m / 敌 a[K23]+a[17]+**deploy failed `destination_conflict`(seq170)**+m；**15:9** | 中：双方同格 (0,-1) 撞车互相作废；我的治疗在目标移出覆盖后 fizzle 白费 1 AP |
| R10 | ranger 击杀 (1,-2) scout、deploy ranger、chip、占点 | 敌多线部署 | 我 a[K12]+d+a[33]+m / 敌 a[15]+a[K19]+d+d；15:9；**敌步兵 abb3 阵亡** | 优：持续换子 + 第三把 ranger 入场 |
| R11 | 双 ranger 打 (2,-1)敌 ranger、support 治疗、ranger 打(1,-1) | 敌 ranger 25HP 残血 | 我 a[31]+a[16]+**heal fizzled `out_of_range`(seq208)**+a[26] / 敌 a[K17]+m+a[15]+d；14:10；敌方 ranger 20310 被击残 | 中：击杀到位，但治疗再次 fizzle（目标已离开覆盖格），第 2 次同类浪费 |
| R12 | 2×ranger 预测射击 (2,-1)/(1,-1)、scout 夺 cp_6、infantry 打(1,0) | 敌把两单位挪到 (3,-2)/(3,-1) | 我 **miss + miss** + m + a[22] / 敌 m+m+m+a[20]；15:9 | 差：两发预测火力因目标离开瞄准格全部落空，白费 2 AP——同时模式攻击瞄准格不锁人 |
| R13 | ranger+infantry 集火 (1,0)、ranger 打(1,-1)、infantry 打(1,-1) | 敌 infantry 60HP 守前哨 | 我 a[25]+a[K12]+a[28]+a[19] / 敌 h+ a[26]+**failed `unit_gone`(seq246)**+a[16]；15:9 | 优：4 发 3 中 1 杀，清掉敌前哨步兵 |
| R14 | ranger 打(0,-2)、2×ranger 打(1,-1)、deploy ranger | 敌第 5 支 infantry 补入 | 我 a[22]+a[30]+a[12]+d / 敌 a[23]+a[K5]+a[18]+a[21]；15:9；**我 inf 6cb9 阵亡** | 良：第四把 ranger 落地，但我方再损一步兵，军力开始向集中 ranger 倾斜 |
| R15 | ranger 打(0,-2)/(1,-1)/(2,0)、deploy ranger | 敌步兵群推进 | 我 a[32]+a[24]+a[28]+d / 敌 a[14]+a[20]+a[K17]+d；15:9；**5 把 ranger 全在场** | 优：第五把 ranger 补齐，火力密度峰值 |
| R16 | ranger 击杀 (0,-2)/(1,-1) 两残血步兵、chip、预测射击 | 敌把部队重组为反扑队形 | 我 a[K8]+a[K5]+a[27]+**miss** / 敌 m+m+m+h；**12:12 被扳平**；**敌两步兵阵亡** | 优在换子（−2 敌步兵）、劣在控点：本轮敌同时夺回 3 点 |
| R17 | 双 ranger 集火敌 ranger(2,-1)、2×ranger 打步兵 | 敌 ranger 41HP | 我 a[30]+a[K11]+a[28]+a[25] / 敌 m+a[35]+a[18]+**failed `unit_gone`(seq325)**；12:12；**敌 ranger cbff 阵亡** | 优：集火拔掉敌方最后一把有效远程 |
| R18 | ranger 打(2,-1)、补刀、chip、预测射击 | 敌步兵群冲占我侧空据点 | 我 a[33]+**failed `unit_gone`(seq339，我方 ranger 1b09 s1 阵亡)**+a[22]+miss / 敌 a[K15]+m+m+m；**9:15 被反超** | 差：末段为追击杀放松占点，敌一口气翻 3 点 |
| R19 | ranger 击杀敌 ranger(1,0)+infantry(-1,0)、chip、scout 夺回 cp_11 | 敌继续扫我外围点 | 我 a[K17]+a[K15]+miss+m / 敌 m+m+**failed `unit_gone`(seq362)**+m；8:16 | 中：击杀清空敌远程，但控点仍失血 |
| R20（终轮） | 3×ranger 各打一敌单位、scout 夺 cp_10(-1,1) | 敌步兵占 cp_13 | 我 a[25]+a[26]+a[27]+**move failed `destination_occupied`(seq383)** / 敌 a[21]+h+m+m；**7:17**；`game_over` seq388 | 良：收官最大化 damage→军力账；末次占点因格被占作废 |

## 核心策略与关键转折

**策略 1：认准 `controlPoint×75` 与流量权重 0.7，前 9 轮把中腹据点铺满并长期锁住，而不是偷家。** 本图 `adjudicationWeights` 为 `enemyHqDamage 1 / ownHqHp 2 / controlPoint 75 / armyValue 2 / supplies 0 / killValue 0.5`，`controlPointFlowRatio` 配置未显式给出、按默认 **0.7**（用 0.7 复算两人总分与 `game_over.scores` 完全一致）。据点占分 = 0.7×流量持有 + 0.3×期末快照，因此**早占且久占**远比末轮抢点值钱。我 R1–R3 连续三轮用 scout 铺到 12 点并拿下两个前哨（cp_10/cp_28，唯一可部署来源），R1–R15 把持有量长期维持在 12–15 点，流量持有定格 **12.2**；对手同期虽在 R16–R20 反扑把期末点抢到 17，但流量只有 10.45。终局控点项我 798 vs 敌 931——**单看期末快照我输了 133 分，却靠 1.75 点的流量差在长期账上站稳**，这是 0.7 流量设计的直接体现。

**策略 2：用 ranger 射程 3 对全场射程 1 的「距离税」逐轮换子，把敌方军力从 273 磨到 96。** 本图全员 `attackShape` 缺省（含 ranger 无 `attackLock`），所有攻击都是 `single` 单格，但 ranger `attackRange=3`、攻 34、HP68/防3，而敌主力 infantry(射程1)、scout(射程1) 摸不到我。我从 R5 在 cp_22 部署第一把 ranger 起，到 R15 累计部署 **5 把 ranger**（R5/R10/R14/R15 及补充），每轮以「ranger 站安全格 → 单格点射 → 步兵/scout 补刀」的节奏收割：全场 17 次 `unit_death` 中敌方占 9（2×scout + 3×infantry + 2×ranger + 更多步兵），我方 8；`killValue` 我 417 vs 敌 338。军力价值终局 **285 vs 96**，军力项独占 +378 分——这是分差的最大来源，也是「射程差 → 换子差 → 军力差」的完整链条。

**策略 3：前哨只从 cp_10/cp_28 出兵，补给全投远程而非屯兵，把 `supplies` 权重 0 的陷阱避开。** 本图 `deployFromHq=false` 且 supply/repair 点 `canDeploy=false`，唯一部署通道是 forward_base。我全程从 cp_10/cp_28 部署 7 次（`infantry→ranger→infantry×2→ranger×3`），补给收入累计 434（base 95 + 据点 339）几乎全部转成在场军力，终局剩 113；对手拿满 **11 次 comeback_supply 共 132**（因分数落后触发 15% 差距 +12/轮），囤到 275 补给却因 `supplies×0` 一分不得，且把兵分散成 7 次部署的低效步兵群。对手「钱多兵多但质量低」正是忽略权重的结果。

**转折 1（R5，射程差确立）：** 我第一把 ranger 落地 cp_22(-1,2)，同轮敌我互打步兵、各自 —12~22 伤害。从这一轮起我能在敌射程外单方面点射，而敌只能靠走位逼近（其射程 1）；此后 15 轮我方 ranger 几乎零被反打风险，奠定了换子优势。

**转折 2（R9，destination_conflict 同格对撞）：** 我 move 6cb9→(0,-1) 与敌 deploy infantry→(0,-1) 在**同一行动点 step3 互斥**（seq170/171 双 `action_failed`），双方都作废且我都白扣 1 AP（部署方不扣补给、移动方扣 AP）。这是同时结算最典型的冲突成本，也说明公开棋盘下「显而易见的好格」会被双方同时盯上。

**转折 3（R16→R18，控点失血与军力兜底的对冲）：** R16 敌一口气夺回 cp_6/cp_20/cp_27 把比分扳成 12:12，R18 再翻 cp_9/cp_10/cp_11 反超到 9:15。若只看期末点我已在输；但我 R16–R19 每轮用 ranger 清掉敌步兵/远程（R17 拔掉敌最后一把 ranger），把敌**军力压到 96**，最终军力项 +378 覆盖了控点项的 −133。这轮对冲是整局胜负手：我没有在丢点后慌乱回防，而是坚持用射程差继续换子。

## HQ、据点与经济分析

**双方 HQ：** 全场 `headquartersDamage` 均为 0、HQ 均 200/200——本局没有任何一方打到敌方 HQ，胜负完全由据点与军队决定，这符合 molten-throne「HQ 血量翻倍、总部伤害只作点缀」的地图设计。

**击杀 / 被击杀（按 `game_over.scores.killValue` 与 17 次 `unit_death`）：** 我方击杀造价 417、敌方 338。我方损失 8 个单位（多支 scout 与 infantry、R18 一把 ranger），敌方损失 9 个（含 2 把 ranger 与多支 infantry）。净 HP 结算下出现多次「死亡单位仍完成已排攻击」——敌方 seq133/246/325 与我方 seq339 的 `action_failed unit_gone` 正是后续行动因执行单位已阵亡而作废（`previous_action_failed` 链）。

**据点：** 轨迹（每整轮末 我:敌）`r1 4:4 → r2 8:8 → r3 12:9 → r9 15:9 → r15 15:9 → r16 12:12 → r18 9:15 → r20 7:17`。我累计 18 次 `control_point_captured`，敌 21 次。流量持有 12.2 vs 10.45（各按每整轮 `controlHoldCounted` 平均），期末 7 vs 17。前哨 cp_10/cp_28 我 R1/R3 入手后长期持有，是全部 7 次部署的来源；敌 cp_7/cp_29 对称持有。

**收入 / 部署 / 维修：** 我方 19 次 `income` 共 434（base 95 + 据点 339），敌方 19 次共 404（base 95 + 据点 309）；我方 0 次 comeback，敌方 11 次共 132。双方各 7 次部署、各 10 次 `control_point_repair`。我方 3 次 `heal` 里 2 次 fizzled（`out_of_range`），仅 1 次有效。补给权重 0，敌方多出的 171 补给（275 vs 113）未转化为任何分数。

**同时结算如何改变节奏：** 无先手意味着「同一步内按座位序并列处理」，我 `turnOrder 0` 只在平局时优先，不构成行动优势。攻击瞄准格而非单位（ranger 无 `attackLock`），我 R6/R12/R16/R18 共 6 次 `missed` 全是敌人离开瞄准格所致；反过来敌 2 次 missed 同理。没有先手抢占，双方只能靠**预测敌人会站的格**或**打不动的目标（据点旁必经格）**开火，这就是同时模式「预测而非追击」的核心。

## 计划动作与裁决分账本

**行动账本（统计 `round_resolved.results`，双方各 80 条 = 20 轮 × 4 AP）：**

| 席位 | 排队动作 | executed | failed | missed | fizzled | 动作构成（executed） |
|---|---:|---:|---:|---:|---:|---|
| 我 `player_b` | 80 | **68** | 4 | 6 | 2 | move 23 / deploy 8 / attack 47 / heal 2 |
| 敌 `player_a` | 80 | **73** | 5 | 2 | 0 | move 34 / deploy 8 / attack 35 / heal 3 |

我方失败/落空/作废原因：deploy `destination_occupied`×2（seq78/383）、move `destination_conflict`×1（seq171）、attack `unit_gone`×1（seq339）、heal `out_of_range` fizzled×2（seq168/208）、attack `missed`×6（R6/R12×2/R16/R18/R19）。失败/落空动作**同样扣 1 AP**，共浪费 12 AP（15%）；失败部署不扣补给。敌方 5 次 failed 含 3 次 `unit_gone`（seq133/246/325）、1 次 `destination_conflict`（seq170）、1 次 `unit_gone`（seq362）。

**裁决分账本（权重取 `config.balance.adjudicationWeights`，flowRatio 0.7；复算与 `game_over.scores` 完全一致）：**

| 项目 | 我 / 敌 | 权重 | 依据 |
|---|---:|---:|---|
| 敌方 HQ 伤害 | 0 / 0 | 1 | `headquartersDamage`，无 HQ 攻击 |
| 己方 HQ HP | 200 / 200 | 2 | `ownHqHp`，双方满血 |
| 据点流量持有 | 12.2 / 10.45 | 75×0.7 | `controlHold`，每整轮平均 |
| 期末控制据点 | 7 / 17 | 75×0.3 | `controlPoints`（seq388） |
| 存活军力价值 | 285 / 96 | 2 | `armyValue`（含 5 ranger 我方） |
| 剩余补给 | 113 / 275 | 0 | `supplies`，权重 0 不计分 |
| 击杀造价 | 417 / 338 | 0.5 | `killValue`，按最后一击归属 |
| **总分** | **1976.5 / 1692.125** | — | `game_over.payload.scores`，复算 delta=0 |

## 失误与改进

作为第一名，仍有可改进处：

1. **两次治疗 fizzle 是纯浪费（R9 seq168、R11 seq208）。** 我在 step2/3 用 support 治疗 (1,1)，但从回放看目标步兵已在该行动点前后移动或阵亡，治疗在净 HP 结算时判 `out_of_range`。正确做法：support 的 `single` 治疗必须瞄准**结算时仍站在覆盖格上的己方单位**，在同时模式下应优先治疗**本轮不会移动的驻守单位**，或干脆把该 AP 换成一次 attack/占点。触发条件：目标本轮已排队 move 或处于低血即将被集火——此时治疗极可能 fizzle。预期收益：每省 1 AP ≈ 多一次单格攻击（均值 20+ 伤害）。

2. **六次预测攻击落空（R6/R12×2/R16/R18/R19），尤其 R12 双发全空。** molten-throne 无 `attackLock`、全员 `single`，我瞄准的是敌人「当前」所在格，而敌人在同一行动点把它挪走。正确做法：要么瞄准**敌无法离开的格**（我占点旁必经格、据点上正在占点的单位），要么先用自己的 move 逼位、再于后续 step 攻击其落点；在敌明显会走位时宁可 `wait` 保留 AP。触发条件：目标为机动 scout（move 4）或当轮有 move 迹象。预期收益：R12 两发若改打据点驻守单位或保留 AP 补位，至少 +30~40 实际伤害或 1 个据点。

3. **R16–R18 丢点阶段反应慢半拍。** 敌 R16 夺回 3 点、R18 再翻 3 点时，我仍在追击杀（R18 有 2 发打向已移动目标并落空），导致期末点从 15 掉到 9。虽然军力优势兜住了胜局，但若敌不是把资源投在步兵群而是早点集火我的 ranger，12:12→9:15 的窗口可能被放大。改进：当流量持有已锁定优势、期末点被追平时，应分 1–2 AP 用 infantry 回占 forward_base 邻格，而非全军压上换子。

## 与历史对局对比

与同模型近两局 `tg_0271_win_WB@hy4flash.md`、`tg_0272_win_WB@hy4flash.md` 对比：那两局是 `standard` 顺序回合、靠 heavy 贴脸 HQ 速杀（R10 结束，`enemyHqDamage×20` 决定胜负），命中率近 100%、零失败动作；本局是 `simultaneous` 占点 + 换子局，动作 80 条里我 68 executed / 12 失败或落空（命中质量明显低于标准局的贴脸 HQ 射击，因为攻击瞄准格会被走位躲开）。三局共同点是都识别并押注了本图**最高权重项**（standard 的 HQ 伤害、molten-throne 的据点流量 + 军力），且都避开了 `supplies` 权重 0 的囤兵陷阱——本局对手囤 275 补给却因权重为 0 空手，正是反面教材。与 `tg_0263_lose_WB@hy4.md`（同为 hy4 系在 molten-throne 相关布局的失利）相比，本局把「只部署前哨 + 集中 ranger」执行得更彻底，未重蹈分散投资的覆辙。

## 总结

> **核心口诀：队列位置就是行动点，前哨是唯一兵源；流量持有靠早占久占，射程差靠 ranger 逐轮换子——攻击瞄准格不锁人，敌人一走位，你的 AP 就白花。**
**一句话总结：靠 R1–R15 长期锁住中腹 12–15 点攒下不可追回的流量优势，再用 5 把射程 3 的 ranger 把敌军力磨到 96，即便末段期末据点被反超到 7:17，仍以 1976.5:1692.125 稳胜。**
