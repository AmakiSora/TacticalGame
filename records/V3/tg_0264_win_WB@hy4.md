# 战术游戏同时回合模式复盘 — `player_b` 视角

**日期/游戏ID/回放版本:** 2026-11-12 / `81bceb54-adde-4e87-af81-bfd0f99367b3` / `hex-v2-replay` schemaVersion `3.9.9`
**地图/参战人数:** `standoff`（对峙之地，半径 5、91 格、7 个据点）/ 2 人；**模式:** `simultaneous`
**玩家:** Hy4-WB（WB@hy4，本局 `player_b`）对阵 Qwen4MaxPreview-QD（QD@qwen4maxpreview，`player_a`）
**席位与出生:** `player_b` / `slot_4`（**西侧**），HQ(-5,0) 200HP/防6；初始单位 scout `0d23104e`@(-4,0)、infantry `3ca5db26`@(-5,1)、infantry `369629f7`@(-4,-1)，出生时 7 个据点全部 `owner=null`。对手 `player_a` / `slot_1`（东侧），HQ(5,0)。`turnOrder=["player_a","player_b"]`、`firstPlayer=null`；**本模式无先手**，`turn.currentPlayerId` / `turn.currentOwner` 恒为 `null`，座位序只用于同一行动点内平局的确定性处理。
**结果:** 🏆 第 1 名 — `last_player_standing`（`headquarters_destroyed` → `player_eliminated` → `game_over`）
**结束轮次:** 第 10/15 整轮（R10 `round_end.gameOver=true`、`steps=2`，HQ 归零后本轮提前终止）；**HQ 最终 HP:** 我方 200/200，敌方 0/200

> **取证声明：** 全文数字、seq 与坐标均出自房主归档回放 `records/V3/tg_0264_20261112.json`（202 事件，`schemaVersion 3.9.9`，顶层 `finalResult.winner=player_b`），未调用 `/api/games/:id/events` 重新拼装，未写任何 `tg_*.json`，未凭对局中途读到的实时比分补数（回放不含逐轮裁决快照）。回放不含未提交/未结算的队列内容，故「计划动作数」一律按 `round_resolved.results` 统计。本局 `game_start.payload.mode` 与 `config.mode` 均为 `simultaneous`，因此只遵循 `review-simultaneous.md` v3.1（V3），未套用歼灭/标准模式的模板或单位表。
>
> **结算骨架（每轮必按此读）：** 计划窗口读取公开棋盘与自己的 `plan.myQueue`（对手队列不可见）→ 队列位置即行动点，第 N 条与所有玩家第 N 条同时结算，每条含 `wait` 都消耗 1 AP → `/end-turn` 是**提交并锁定**，不是立即执行。R1–R10 每轮各有 2 条 `plan_committed`（共 20 条），双方提交齐才结算；**无** `host/force-resolve`、**无** `turn_skipped`、**无** `player_left` 等管理干预。每个行动点内部固定子阶段：级联预检 → 部署/移动（**先移出、再移入**的到达判定）→ 爆破 → 攻击与净治疗 → 死亡/淘汰；全部行动点结束后才占领据点 → 轮次裁决 → 追赶补给 → 下一轮收入与维修。同一行动点内没有先后。事件类型统计中**无任何炮火事件**（simultaneous 模式无缩圈），也无 `host` 类管理事件。
>
> **本局配置（`game_start.payload.config`）：** `startingSupplies 120`、`baseIncome 8`、supply 点 +8/轮、中心 `cp_center` 为 repair（income 6 / `repairAmount 10`）、`actionsPerTurn 5`、`attacksPerUnit 1`（默认）、`maxTurns 15`、`damageVarianceRange 3`、`minimumDamage 1`；权重 `enemyHqDamage 5 / ownHqHp 1 / controlPoint 60 / armyValue 0.35 / supplies 0 / killValue 0.15`，`controlPointFlowRatio 0.7`（默认）；`comebackSupply` 第 4 轮起、分差 >40% 时 +12/轮。兵种：infantry 90HP/31攻/7防/移2/射2/`line` 长2/55费、scout 60HP/16攻/4防/移3/射1/42费、heavy 140HP/40攻/9防/移2/`arc`/100费、ranger 68HP/38攻/3防/移2/射3/`single`+`attackLock`/80费、support 76HP/治疗20/`arc`/68费。据点 `cp_1`(3,0)、`cp_2`(0,3)、`cp_3`(-3,3)、`cp_4`(-3,0)、`cp_5`(0,-3)、`cp_6`(3,-3) 为 supply，`cp_center`(0,0) 为 repair。

## 最终排名摘要

| 名次 | 席位 | 状态 | 总分 | HQ HP | 期末据点 | 决定性优势 |
|---|---|---|---:|---:|---:|---|
| **1** | `player_b`（Hy4-WB） | active | **1452.04** | **200/200** | 3 | 累计对敌 HQ 伤害 **200**（7 发全中，`×5` = **1000 分**）+ 己方 HQ 全程满血（200 分），R10 直接摧毁敌方 HQ 结束比赛 |
| 2 | `player_a`（Qwen4MaxPreview-QD） | eliminated | 332.12 | 0/200 | 4（淘汰瞬间快照） | 据点流量持有 3.56 对 3.22、`killValue 392` 对 232 均占优；但 `headquartersDamage 0`，对我方 HQ 全程零伤害 |

**分差 1119.92。** `game_over.payload.rankings` 中我是唯一 `rank:1` / `active`，对手 `rank:2` / `eliminated`（seq199 `player_eliminated.reason=headquarters_destroyed`、`eliminatedBy=player_b`），故按规范命名为 `win`。淘汰时 `removedUnitIds` 7 个、`neutralizedPointIds=["cp_1","cp_2","cp_6","cp_center"]`，但 `game_over.scores` 是淘汰瞬间的冻结快照，仍记对手期末 4 个据点。

## 计划—结算时间线

每轮队列上限 5 AP。攻击形状：ranger 为 `single` 且 `locked=true`（点击格在计划时有敌方单位则锁定，命中移动目标）；infantry 为 `line`（沿六向射线覆盖前 2 格，对每个覆盖格内敌人独立伤害 roll）；打 HQ 用 `single` 瞄固定格 (5,0)。「对手」一栏只依据开局可见棋盘与上一轮 `round_resolved` 的公开结果推断，**不声称 API 暴露了秘密队列**。双方全程未部署 support、无 `heal` / `fizzled` 事件，故各轮**治疗覆盖均为「无」**。

| 轮次 | 我的计划（队列 5 条 = 5 AP） | 对手可见信息与可能反应 | `round_resolved` 结果（含冲突格 / 形状覆盖 / 失败原因） | 计划质量 |
|---|---|---|---|---|
| **R1** | 5/5：scout(-4,0)→(-3,0) 占 `cp_4`；inf(-4,-1)→(-2,-2)→(0,-3) 双段占 `cp_5`；inf(-5,1)→(-4,2)→(-3,3) 双段占 `cp_3` | 对称开局，双方出生边角距中心 4–5 格，无接触距离 | 5/5 `executed`，一轮吃 3 点；对手 5/5 `executed`：scout(4,0)→(1,0)→(0,0) 占 `cp_center`、inf 占 `cp_1`、r5 从 HQ 部署 inf(4,0)。R1 末据点 **3:2**。冲突格无、治疗无 | **高**：用「同一单位跨两个行动点各走 2 格」把流量持有从第一个整轮就开始累计 |
| **R2** | 5/5：inf(0,-3)→(0,-1)；`line` 瞄(0,0)（覆盖 (0,0)/(0,1)）；`cp_4` 部署 ranger(-2,0)[80]；inf(-3,3)→(-1,3)→(0,3) 抢 `cp_2` | 对手 scout 已在中心 (0,0) 且带 repair +10/轮；其新 inf(4,0) 可双段行军抢点 | 我方 4 `executed`/1 `failed`：`line` 命中中心 scout 26（seq31）；**s5 `failed(destination_occupied)`**——对手同轮 s2/s3 双段行军先站上 (0,3)，据点 `cp_2` 归敌。对手 4/1（s5 `line` 瞄(1,-3) `missed`）。R2 末 3:4，治疗无 | 中：识破中心 repair 的价值并压制，但抢 `cp_2` 排在两个移动之后、被对手更早的行动点抢先 |
| **R3** | 5/5：`line` 瞄(0,0)；ranger(-2,0) 锁(0,0)；inf(0,-1)→(0,0) 占中心；`cp_5` 部署 ranger(0,-2)[80]；inf(-1,3) `line` 瞄(0,3) | 中心 scout R2 挨 26 后 34HP，R3 轮边界 `cp_center` repair +10 → 44HP；对手可能补位或撤 | 我方 4/1：**s1 `line` 同时命中 scout 24 与 inf 25**（覆盖 (0,0)/(0,1)）；s2 锁定 32 实际 20 **击杀敌方 scout**（seq53 `unit_death`）；**s3 `failed(destination_conflict)`**——双方同 step 都向 (0,0) 移动，全部失败；s5 `line` 命中 (0,3) 守军 26。对手 4/1（s3 同格冲突）。治疗无 | 中高：低 roll 必杀的锁定集火成功；但双方连续同格冲突，中心空置仍归敌 |
| **R4** | 5/5：`line` 瞄(0,0)；两把 ranger 锁(0,1)；inf(0,-1)→(0,0) 占中心；inf(-1,3) `line` 瞄(0,3) | 对手 (0,1) inf 75HP、中心新部署 inf(1,0)，明显要守中心 | 我方 4/1：s1 `line` 命中 (0,0)/(0,1) 两敌 22+24；s2/s3 双锁定 31+30 实际 20 **击杀 (0,1) inf**（seq76）；**s4 `failed(destination_occupied)`**（中心被对手 s1 先占）；s5 `line` 命中 (0,3) 22。对手 4/1（s4 `unit_gone`）。治疗无 | 中高：三发集火换掉一个 55 造价步兵；占中心动作连续第 3 轮落空 |
| **R5** | 5/5：`line` 瞄(0,0)；两把 ranger 锁(0,0)；scout(-3,0)→(0,0) 占中心；`cp_4` 部署 ranger(-2,-1)[80] | 对手中心守军 78HP（含 repair），另有 inf(3,-3) 与 (3,0) | **我方 5/5 全 `executed`**：s1 `line` 27 + s2 锁定 29 + s3 锁定 31 实际 22 **击杀中心守军**（seq97）；**s4 scout 冲进已清空的 (0,0)，`cp_center` 归我**（seq102 `control_point_captured` R5）；s5 部署第 3 把 ranger。对手 3/5（s3/s4 两发 `line` 预测打空），并部署 ranger(1,0)[80]。据点 **4:3**、比分反超。治疗无 | **高**：本局第一次「先清守军、后一步占点」的正确时序，终于拿下 repair 点 |
| **R6** | 5/5：两把 ranger 锁(1,0) 打敌方新 ranger；ranger(-2,-1)→(-1,-1) 进射程后锁(1,0)；残血 inf `line` 瞄(0,3) | 敌方 ranger(1,0) 68HP 会锁定点名我中心 scout 或 14HP 的 ranger(0,-2) | 我方 3 `executed`/1 `missed`/1 `failed`：s1/s2 两发锁定名义 36+36、实际 36+32（68 打 68HP）**击杀敌方 ranger**（seq116）；s3 移动成功；**s4 第三把 ranger 瞄(1,0) `missed`**（目标已在 s2 死亡）；**s5 `failed(unit_gone)`**（inf 已被敌方 s2 `line` 击杀，seq115）。对手 4/1（s5 `unit_gone`）。我方另损失 14HP ranger(0,-2)（seq112）。治疗无 | 中：拔掉对手唯一远程，但两发打在已死/已阵亡单位上，2 AP 作废 |
| **R7** | 5/5：ranger(-1,-1)→(1,-1)→(3,-1) **双段推进**；第 3 步 `single` 瞄 HQ(5,0)；`cp_center` 部署第 4 把 ranger(1,0)[80]；ranger(-2,0)→(0,-1) | 对手中路 3 个 inf，最近在 (0,0)/(1,-1)；其 HQ(5,0) 永不移动 | **我方 5/5 全 `executed`**：三段突击链完整落地，`single` 命中 HQ **31**（seq136），`hqdmg` 从 0 起算；s4 以 `cp_center` 部署第 4 把 ranger（计划时中心仍归我——R5 夺回、本轮结算后才易手，正是「占领在全部行动点结束后」的规则体现）。对手 4/1：两发 `line` 集火**击杀我中心 scout**（seq137）、inf 抢回 (0,0)，seq142 `control_point_captured` 使 `cp_center` 归敌；s5 `failed(destination_occupied)`。治疗无 | **高（本局胜负手）**：识别 `enemyHqDamage 5` 杠杆，用「同一单位跨多个行动点连续移动」在一轮内从 (-1,-1) 推到 (3,-1) 并开火；代价是中心失守 |
| **R8** | 5/5：ranger(4,-1) 打 HQ；ranger(1,0)→(3,0) 后打 HQ；ranger(0,-1)→(2,-1) 前压；ranger(3,-1)→(4,-1) 贴近并闪避 | 对手 inf 会用 `line` 瞄 (1,0)/(2,-1) 等前压路线 | **我方 5/5 全 `executed`**：两发 HQ **32+31**（seq151/155），HQ 169→106；移动既推进又躲开对手 s1/s5 的两发 `line` 之一。对手 4/1（s3 `line` 瞄(1,0) `missed`），另两发 `line` 打中我 ranger。治疗无 | **高**：两发必中 + 移动兼闪避，HG 伤害开始滚雪球 |
| **R9** | 5/5：两把 ranger 打 HQ；ranger(2,-1)→(3,-1) 后打 HQ；ranger(3,0)→(4,0) 贴脸 | 对手 3 个 inf 已能 `line` 覆盖 (2,-1)/(3,-1)；补给 213 可能部署 heavy 挡路 | 我方 **2 `executed` / 3 `failed`**：s1/s2 两发 HQ **35+33**（seq170/172），HQ 106→38；**s1/s2 对手两发 `line` 先击杀我 ranger(2,-1)**（seq173），导致 **s3 移动 `unit_gone`、s4 攻击 `unit_gone` 连废 2 AP**；**s5 `failed(destination_conflict)`**——我 (3,0)→(4,0) 与对手 s5 从 HQ 部署 heavy→(4,0) 同 step 争同格，双方都失败（**失败部署不扣 100 补给**）。对手 4/1。治疗无 | 中低：HQ 输出到位，但把 3 条动作串在同一把残血 ranger 后面，一次阵亡触发整条作废链 |
| **R10** | **2 条**（主动只排 2 发，剩余 3 AP 未用）：ranger(3,0, 17HP) `single` 瞄 HQ；ranger(4,-1, 68HP) `single` 瞄 HQ | HQ 38HP，两发最低 29+29=58 必杀；对手只剩 3 个 inf，来不及推进到我 HQ(-5,0) | **双方仅 step1–2 进入结算**（`round_end.steps=2`、`gameOver=true`）。我方 2/2 `executed`：s1 HQ **35**（38→3，同时该 17HP ranger 被敌方 s1 `line` 击杀 seq191，但按净 HP 规则**死亡单位仍完成已排攻击**）；**s2 HQ 名义 34、实际 3 截断**（seq193）→ seq194 `headquarters_destroyed` → seq199 `player_eliminated` → seq202 `game_over`。四据点中立，比赛结束。治疗无 | **高**：把终结火力放在最早两个行动点、分属两个单位，规避了作废链；同一行动点「先开火再死」兑现净 HP |

**逐轮 AP 与冲突汇总：** R1–R9 每轮双方各 5 条、R10 各 2 条，共 **47 条/人**进入结算；名义上限 10×5=50 AP/人，我方实际用 47（R10 主动留 3 AP 未用），敌方 47。所有 `failed`/`missed` 动作**仍消耗 1 AP**；**失败部署不扣补给**（唯一可核验实例：R9 s5 敌方 heavy→(4,0) `destination_conflict`）。冲突格集中在 **(0,0)**（R3 s3 双方 `destination_conflict`；R2 s5 / R4 s4 我方 `destination_occupied`）与 **(4,0)**（R9 s5 双方 `destination_conflict`）。本局**未出现**同 step 双方互换格位成功的腾格/交换案例；也未出现 `previous_action_failed` 字样——作废链以 **`unit_gone`** 形式出现（R6 s5、R9 s3/s4），即单位在更早行动点被净 HP 结算击杀后，其后续已排动作失效。R10 `game_over` 提前终止，两方队列余量未进入结算、回放不含未结算内容，**R10 未排的 3 AP 无法从回放进一步核验**。

## 核心策略与关键转折

1. **R1 双段行军抢流量持有（开局转折）：** 本图 `controlPoint 60` 且 `controlPointFlowRatio 0.7` 计时间平均持有，越早占点越值。用「同一单位跨两个行动点各走 2 格」在 R1 一轮内吃下 `cp_4`/`cp_5`/`cp_3` 三个 supply 点，第一个整轮就把 `controlHold` 记上 3；对手 R1 用同样手法拿到 `cp_1` + 中心的 2 点。R1 末 3:2，是我全程据点不落后于对手多数轮次的基础。

2. **R3/R4 的 `attackLock` 低 roll 必杀与 `destination_conflict` 反预测（中路转折）：** ranger 的锁定射击在计划时点点击有敌方单位的格，结算时只要目标未逃出射程泡就必中——R3 s2 锁定 32 实际 20 补掉中心 scout、R4 s2/s3 双锁定 31+30 清掉 (0,1) 步兵、R5 s1–s3 `line`+双锁定清掉 78HP 中心守军、R6 s1/s2 双锁定清掉敌方唯一 ranger，四次集火全部达成。同时 R3 s3 双方同冲 (0,0) 全部 `destination_conflict`，R2 s5 / R4 s4 我方两次 `destination_occupied`——这三次占点失败共耗 3 AP，但也说明「同一行动点内没有先后、先移出再移入」的规则下，占点必须排在**守军被清掉之后的行动点**。

3. **R5 的正确时序（据点争夺转折）：** 前四轮我都是「先排队冲中心、再打守军」或同轮并行，全部落空。R5 改成 s1 `line` + s2/s3 锁定先把中心守军打死，**s4 才让 scout 进 (0,0)**，一次成功，`cp_center` 归我并吃到 R7 的 +10 维修。这是本局唯一一次完整走对「清除 → 到达」的因果顺序。

4. **R7 的杠杆识别与三段突击链（胜负手）：** 当时我据点 4:3、`killValue` 232，但中路消耗战已连续三轮互有伤亡、比分仅小幅领先。识别出 `enemyHqDamage 5` 意味着**一发 ranger 打 HQ 约 30 点 ≈ 150 分，远高于一个据点的边际收益**，且 HQ 永不移动、是 `single` 必中靶。于是利用「同一单位可跨多个行动点多次行动」，让一把 ranger 在 R7 的 s1/s2 连走两段 2 格（(-1,-1)→(1,-1)→(3,-1)），s3 直接瞄 (5,0) 打出 31 点；s4/s5 再部署与推进另两把。从 R7 到 R10 共 **7 发 HQ 炮击全部命中**（31/32/31/35/33/35/34，名义合计 231，实际 200，最后一发因 HQ 仅剩 3HP 截断为 3），`200×5 = 1000 分`——占我总分的 68.9%、占分差的 89.3%。

5. **R10 净 HP / 先开火再死（终局转折）：** 同一行动点内伤害先汇总再判死亡，**死亡单位仍完成已排攻击**。R10 s1 我 17HP 的 ranger 在打出 HQ 35 点的同一行动点被敌方 `line` 击杀（seq191），输出照常入账；s2 另一把 ranger 把剩余 3HP 打空。`headquarters_destroyed` 发生在 step2，随后 `player_eliminated` → `game_over`，第 10 轮提前结束（比 `maxTurns=15` 早 5 轮）。把终结火力分散到两个单位、排在最前两个行动点，正是规避 R9 那种 `unit_gone` 作废链的正解。

## HQ、据点与经济分析

**HQ 伤害与 HP：** 我累计对敌 HQ 伤害 **200/200**（7 发 `single` 全中，命中率 100%，R7 起每轮 1–2 发）；敌方对我方 HQ 伤害 **0**，我方 HQ 全程 200/200。仅 `200×5 + 200×1 = 1200` 分就占我方总分的 82.6%。HQ 轨迹：R7 200→169、R8 169→106、R9 106→38、R10 38→0。

**据点（我 3 / 敌 4，流量持有 3.22 / 3.56）：** `control_point_captured` 9 次——R1 我取 `cp_3`/`cp_4`/`cp_5`、敌取 `cp_1`/`cp_center`；R2 敌取 `cp_2`/`cp_6`；R5 我夺回 `cp_center`；R7 敌再夺回 `cp_center`。R10 淘汰时 `cp_1`/`cp_2`/`cp_6`/`cp_center` 四个点中立。`control_point_repair` 6 次共 +60，其中**对手 5 次**（R3/R4/R5/R9/R10）、我方仅 R7 一次——中心 repair 点的持续治疗基本被对手吃掉。据点项我方 `(3.22×0.7 + 3×0.3)×60 = 189.24`，敌方 `(3.56×0.7 + 4×0.3)×60 = 221.52`，**我方在这一项反而落后 32.28 分**；说明胜负完全由 HQ 杠杆决定，而非据点控制。

**击杀与军力：** `unit_death` 10 次——我损失 6 个（R5 inf、R6 ranger、R6 inf、R7 scout、R9 ranger、R10 ranger），对手损失 4 个（R3 scout、R4 inf、R5 inf、R6 ranger），终局我方仅剩 1 把 ranger（`armyValue 80`）。`killValue` 我 232 = 42+55+55+80（按被击杀单位造价、最后一击归属），对手 392 = 55+80+55+42+80+80，即**换子账我方是亏的**（`×0.15` 后 34.8 对 58.8）。这也印证了规范强调的：内置图 `armyValue 0.35` / `killValue 0.15` 权重都很低，屯兵和清剿不是领先来源。

**收入与部署：** 起始 120。`income` 我 9 次共 **300**（R2–R10，每轮 32，R6/R7 因多占 1 点达 38），敌 9 次共 **314**；另有 `comeback_supply` 2 次共 +24（R8/R9 各 +12，分差 57.4% / 71.9%）全部给落后的对手。部署：我 4 次全是 ranger（R2 `cp_4`、R3 `cp_5`、R5 `cp_4`、R7 `cp_center`）共 **320**；敌 4 次（3×inf 55 + 1×ranger 80）共 **245**，另有 R9 一次 heavy 部署失败不扣费。核对：我方 120+300−320 = **100**、敌方 120+314+24−245 = **213**，与 `game_over.scores.supplies` 完全一致。四把 ranger 全部成为 HQ 炮台或中路锁定火力，是把补给转成 `enemyHqDamage` 的关键。

**同时结算如何改变开火先后：** 没有先手，双方第 N 条同时结算，因此「先集火再补刀」必须靠**同一轮内不同行动点的先后**（如 R5 s1–s3 清守军、s4 占点），而非抢先手；同理「先开火再死」不是时序技巧而是净 HP 规则（R10 s1）。对手看不到我的队列，但我的推进路线（西侧→(3,-1)→HQ）在棋盘上完全公开，R9 对手两发 `line` 精准点掉我 (2,-1) 的 ranger，就是明证。

## 计划动作与裁决分账本

**计划质量**（按 `round_resolved.results`；R10 因 `game_over` 只记录 step1–2，队列余量未进入结算、回放不含，无法可靠统计 R10 未排部分）：

| 席位 | 进入结算的计划动作 | 成功 `executed` | 失败 `failed` | 落空 `missed` | 失效 `fizzled` | 命中/成功率 | 主要 AP 浪费原因 |
|---|---:|---:|---:|---:|---:|---:|---|
| `player_b`（我） | **47** | **39** | 7 | 1 | 0 | **83.0%** | `destination_occupied` 2（R2 s5、R4 s4）、`destination_conflict` 2（R3 s3、R9 s5）、`unit_gone` 3（R6 s5、R9 s3/s4）、预测 `missed` 1（R6 s4） |
| `player_a` | **47** | **38** | 5 | 4 | 0 | 80.9% | `destination_conflict` 2、`destination_occupied` 1、`unit_gone` 2、预测 `line` 落空 4（R2/R5×2/R8） |

- **HQ 炮击命中率 7/7 = 100%**（固定靶，`single` 无 `attackLock` 也必中）；对手全部 `line` 预测火力有 4 次落空。
- 我方 7 次 `failed` 中有 **3 次是 R9 一条 `unit_gone` 作废链**（残血 ranger 在 s1/s2 被击杀 → s3 移动、s4 攻击连带失效，再叠加 s5 撞格），单轮 3 AP 作废；这是本局最大的计划质量缺口。
- `fizzled` 0 次：双方全程未部署 support、无治疗动作，故无治疗失效。
- 失败部署不扣补给：R9 s5 敌方 heavy 部署 `destination_conflict`，其补给收支核对未扣 100。

**裁决分账本**（权重取本局 `config.balance.adjudicationWeights`，`controlPointFlowRatio 0.7`）：

| 项目 | 我方数值 | 权重 | 我方得分 | 敌方数值 | 敌方得分 | 依据 |
|---|---:|---:|---:|---:|---:|---|
| 累计 HQ 伤害 | **200** | **5** | **1000.00** | 0 | 0 | 7 条 `attack.targetKind=headquarters` + `game_over.scores` |
| 己方 HQ HP | 200 | 1 | 200.00 | 0 | 0 | `headquarters_destroyed` |
| 据点流量持有 / 期末据点 | 3.22 / 3 | 60（0.7 流量） | 189.24 | 3.56 / 4 | 221.52 | `control_point_captured` 9 次、10 个 `round_end`（R10 `gameOver=true` 不计 flow） |
| 存活军力价值 | 80 | 0.35 | 28.00 | 148 | 51.80 | `game_over.scores.armyValue` |
| 剩余补给 | 100 | **0**（权重0，不构成裁决分） | 0 | 213 | 0 | `income` 18 条 + `deploy` 8 条 + `comeback_supply` 2 条 |
| 击杀造价 `killValue` | 232 | 0.15 | 34.80 | 392 | 58.80 | `unit_death` 10 次，最后一击归属 |
| **总分** | — | — | **1452.04** | — | **332.12** | `game_over.payload.scores`，逐项相加完全吻合 |

## 失误与改进

第一名，按要求列风险与低效计划（含触发条件与预期收益）：

| # | 实际计划 | 触发条件 | 代价 | 正确做法 / 预期收益 |
|---|---|---|---|---|
| 1 | R2 s5 / R3 s3 / R4 s4 连续三次把「占点移动」排在守军未清或对手同 step 也冲同一格时，累计 3 次 `destination_occupied` / `destination_conflict` | 对手也在抢同一格，或格上仍有守军；同时回合**同一行动点内没有先后** | 3 AP 作废，中心 repair 点直到 R5 才拿下，对手多吃 3 次 +10 维修 | 把占点排在「集火清除守军之后的行动点」（R5 已验证有效），或用 `wait` 把到达延后一格避开对手峰值；预期可提前 2–3 轮控制中心、多 20–30 分据点项 |
| 2 | R6 s4/s5 与 R9 s3/s4 把多条动作串在**同一个残血单位**后面：目标已死或单位已在更早行动点阵亡，导致 `missed` + `unit_gone` 共 4 AP 作废 | 该单位血量偏低（R9 的 ranger 仅 38HP），且对手 `line` 能覆盖其所在格；净 HP 结算在行动点末才判死亡 | 4 AP 作废，其中 R9 单轮 3 AP 全废 | 残血单位只排 1 条动作；把终结火力分散到不同单位并排在最前两个行动点（R10 已验证有效）；预期节省 4 AP，可多 1–2 发 HQ 炮击或一次部署 |
| 3 | R9 s5 我方 (3,0)→(4,0) 与敌方 heavy 部署同 step 争同格，双方 `destination_conflict` | 前压格恰好是对手 HQ 的相邻部署格，路线公开可预测 | 1 AP 作废（但也顺带否决了对手一次部署，属等价交换） | 前压改选反预测格（如 (4,-1) 已在手、`(3,1)`），避免把关键贴脸动作放在对手部署口；预期省 1 AP 且保住贴脸站位 |
| 4 | 战略层面：R1–R6 沉迷中路清剿与中心争夺，直到 R7 才第一次打 HQ | 前 6 轮据点与 `killValue` 互有领先、比分胶着，容易被「多杀几个单位」牵住 | 若对手在 R7 前先部署 2 把 ranger 反打我 HQ（其 R9 补给已达 213，够 2 把 ranger），`hqdmg` 权重 5 会被对手反向利用 | 在 R5 拿到 4 据点优势时就应把 1–2 把 ranger 分兵推 HQ 射程，而非全压中路；预期提前 1–2 轮结束、降低被反打风险 |

**注：** 回放的失败原因是 `unit_gone` 而非 `previous_action_failed`，两者机制不同——前者是单位在更早行动点被净 HP 结算击杀，后者是同一单位前一条动作硬失败。本局 `previous_action_failed` 出现次数为 **0**，但 `unit_gone` 造成的连锁作废同样要把关键动作与残血单位解耦，不能混为一谈。

## 与历史对局对比

引用同为 `standoff` / `simultaneous`、同 agent `WB@hy4` 的两局胜局，以及紧邻的上一局（不同模式，仅作决策风格对照）：

| 对比项 | 本局 `tg_0264`（胜） | `tg_0252_win_WB@hy4.md`（胜，2026-11-07） | `tg_0247_win_WB@hy4.md`（胜，2026-11-05） |
|---|---|---|---|
| 结束轮次 | **第 10/15**（最早） | 第 14/15 | 第 13/15 |
| HQ 伤害 / 发数 | **200 / 7 发全中（100%）** | 200 / 7 发全中（100%） | 200 / 7 发（R13 一发截断） |
| 计划动作 / 成功率 | **47 条 / 83.0%**（39 executed） | 67 条（14 轮，R14 仅 2 条） | 61 条 / 47 成功（约 77%） |
| 冲突格 | `(0,0)` 三次 + `(4,0)` 一次；`previous_action_failed` 0 次，`unit_gone` 3 次 | `(0,0)` R4/R5、`(-2,1)` R11 共 3 次双方冲突；有 1 条 `previous_action_failed` 作废链 | `(0,0)` R3/R4、`(-1,0)` R11 共 3 次；双方各 1 条作废链 |
| 中央 repair 点控制 | **R5–R6（2 轮）**，对手 7 轮；repair 6 次我仅 1 次 | R2 起长期持有，7 次 repair 全归我 | 多次易手，据点最终 4:3 |
| 据点流量持有 / 期末 | **3.22 / 3**（两项均落后对手 3.56 / 4） | **5.00 / 6**（压倒性） | 4 / 4 |
| 总分 / 分差 | **1452.04 / 1119.92** | 1749.20 / 1582.56 | 1525.36 / 1183.61 |

**结论：** 三局的共同胜负手都是 `enemyHqDamage 5`——7 发 ranger 打满 200 点拿到 1000 分，且都靠 `attackLock` 集火 + `single` 打固定 HQ 格收尾。本局的差异是**最激进也最高效**：据点控制、换子、`killValue` 三项全部落后于对手（3.22 对 3.56、6 死对 4 死、232 对 392），却因为 R7 就完成「一轮内双段推进 + 开火」而把 HQ 炮击窗口提前了 5 轮，用 47 条计划动作（历史两局 61–67 条）在 10 轮结束比赛。代价是计划质量并非最高：`unit_gone` 作废链导致 R9 单轮 3 AP 全废，而 `tg_0252` 靠长期持有中心 repair 与 6:1 据点把总分推到 1749.20，说明**「早打 HQ」与「稳占中心」是两条都能赢的路线，前者更快、容错更低**。

紧邻的 `records/V3/tg_0263_lose_WB@hy4.md`（上一局，`artillery-zone` / `annihilation`，败）可作为决策风格对照：那一局输在收缩期被动等待炮火磨死对手、并浪费最后的部署窗口让 151 补给冻结；本局反过来在识别出最高权重杠杆后**主动把资源转成 HQ 输出**，且四把 ranger 的 320 补给全部花在能打分的位置上，没有冻结浪费。两局模式不同（歼灭模式无 HQ、权重 `armyValue 2`），故不比较具体分数，只对照「是否把补给换算成当前权重下最值钱的产出」。

## 总结

> **核心口诀：队列位置就是行动点，先清守军再到达、先铺路再出手；同一残血单位后面别串动作，最高权重的靶子要最早打。**

**一句话总结：本局据点、击杀、军力三项全面落后于对手，却靠 R1 抢流量持有打底、R5 走对「清除→占点」时序、R7 起识别 `enemyHqDamage 5` 并用「一轮内双段推进 + 7 发 HQ 全中」把 200 点 HQ 伤害换成 1000 分，在第 10 轮直接摧毁敌方 HQ 提前结束比赛，以 1452.04 : 332.12 获胜 —— 同时回合里，赢的不是换子，而是把 AP 押在权重最高的固定靶上。**
