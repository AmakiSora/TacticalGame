# 战术游戏同时回合模式复盘 — `player_b` 视角

**日期/游戏ID/回放版本:** 2026-11-07 / `20fb493e-72f9-425a-a0c2-d0a568565faf` / `hex-v2-replay` schemaVersion 3.9.5
**地图/参战人数:** `standoff`（对峙之地，半径 5，7 个据点）/ 2 人；**模式:** simultaneous
**玩家:** Hy4-WB（WB@hy4，`player_b`） vs QoDuck-QD（QODUCK@qoder，`player_a`）
**席位与出生:** `player_b`，HQ(5,0) 200HP/防6；出生 scout(4,0)、infantry(4,1)、infantry(5,-1)。`turnOrder=["player_b","player_a"]`、`firstPlayer=null`、`turn=null` 仅用于同行动点内打破平局的确定性处理；本模式**无先手**，`turn.currentPlayerId` / `turn.currentOwner` 恒为 `null`，每轮都是「秘密计划 → 全员提交锁定 → 按行动点逐步同时结算」。
**结果:** 🏆 第1名 — `last_player_standing`（敌方 HQ 被摧毁）
**结束轮次:** 第 14/15 整轮（R14 `round_end.steps=2`、`gameOver=true`，HQ 归零后本轮提前终止）；**HQ最终HP:** 我方 200/200，敌方 0/200

> **取证声明：** 数据来源为房主归档回放 `records/V3/tg_0252_20261107.json`（259 条事件，`schemaVersion 3.9.5`，`finalResult.winner=player_b`）。本文所有数字均出自该文件，未调 `/api/games/:id/events` 重新拼装事件，未写任何 `tg_*.json`。回放不含未提交/未结算的队列内容，故「计划动作数」一律按 `round_resolved.results` 统计。本局 `game_start.payload.mode` 与 `config.mode` 均为 `simultaneous`，因此只遵循 `review-simultaneous.md` v3.1（V3），未套用其他模式的模板或单位表。

## 最终排名摘要

| 名次 | 席位 | 状态 | 总分 | HQ HP | 期末据点 | 决定性优势 |
|---|---|---|---:|---:|---:|---|
| 1 | `player_b` (Hy4-WB) | active | **1749.20** | 200/200 | 6 | 累计 HQ 伤害 200（×5 = 1000 分）+ 己方 HQ 全程满血（200 分）+ 据点流量持有 5.0 对 1.77、期末 6:1 |
| 2 | `player_a` (QoDuck-QD) | eliminated | 166.64 | 0/200 | 1 | 无；仅击杀我方 1 个 ranger（killValue 80），HQ 伤害 0 |

**分差 1582.56。** `game_over.payload.rankings` 中我是唯一 `rank:1` 且 `status:active`，对手 `rank:2` / `eliminated`（`reason=headquarters_destroyed`，`eliminatedBy=player_b`），故按规范命名为 `win`。淘汰时 `neutralizedPointIds=["cp_4"]`，但 `game_over.scores` 是淘汰瞬间的冻结快照，仍记对手期末 1 个据点。

**本局配置（`game_start.payload.config`）：** `startingSupplies 120`、`baseIncome 8`、supply 点 +8/轮、中心 repair 点 +6/轮且 `repairAmount 10`、`actionsPerTurn 5`、`attacksPerUnit 1`（默认）、`maxTurns 15`、`damageVarianceRange 3`、`minimumDamage 1`、`healVarianceRange 6`；权重 `enemyHqDamage 5 / ownHqHp 1 / controlPoint 60 / armyValue 0.35 / supplies 0 / killValue 0.15`；`comebackSupply` 第 4 轮起、分差 >40% 时 +12/轮。兵种：infantry 90HP/31攻/7防/移2/射2/`line` 长2/55费、scout 60HP/16攻/4防/移3/射1/42费、heavy 140HP/40攻/9防/移2/`arc`/100费、ranger 68HP/38攻/3防/移2/射3/`single`+`attackLock`/80费、support 76HP/治疗20/`arc`/68费。据点：cp_1(3,0)、cp_2(0,3)、cp_3(-3,3)、cp_4(-3,0)、cp_5(0,-3)、cp_6(3,-3) 为 supply，cp_center(0,0) 为 repair。

> **同时回合的结算骨架（每轮都必须按此读事件）：** 计划窗口读取公开棋盘与自己的 `plan.myQueue`（对手队列不可见）→ 队列位置即行动点，第 N 条与所有玩家第 N 条同时结算，每条含 `wait` 都消耗 1 AP → `/end-turn` 是**提交并锁定**，不是立即执行，提交后不可撤回。本局 R1–R14 每轮各有 2 条 `plan_committed`（共 28 条），双方提交齐才结算，**无** `host/force-resolve`、**无** `turn_skipped` 等管理操作。每个行动点内部固定顺序：级联预检 → 部署/移动（先移出、再移入的到达判定）→ 爆破 → 攻击与净治疗 → 死亡/淘汰；全部行动点结束后才占领据点 → 轮次裁决 → 追赶补给 → 下一轮收入与维修。同一行动点内没有先后，只有平局时按 `turnOrder` 确定性处理。

## 计划—结算时间线

每轮队列上限 5 AP。「对手」一栏只依据结算后公开事件与开局可见棋盘推断，**不声称 API 暴露了对手的秘密队列**。本局 `round_resolved` 的动作类型只有 `move/deploy/attack/wait`，**双方均无成功治疗结算**（敌方 R11 部署 support(-4,0)，但全程无 `heal` / `out_of_range` / `already_healthy` 条目），故各轮「治疗覆盖」统一为「无」。攻击形状：ranger 为 `single` 且 `locked=true`，infantry 为 `line`（覆盖射线上前两格）、`locked=false`；R12 起打 HQ 用 `single` 瞄固定格 (-5,0)、`locked=false`。

| 轮次 | 我的计划（单位/目标格） | 对手可见信息与可能反应 | `round_resolved` 结果 | 计划质量 |
|---|---|---|---|---|
| R1 | 5/5 AP：scout(4,0)→(3,0) 占 cp_1；inf(4,1)→(2,2)→(0,3) 占 cp_2；inf(5,-1)→(4,-2)→(3,-3) 占 cp_6 | 对称开局，双方出生边角距中心 4–5 格，无接触距离；敌方 scout(-4,0) move 3 可一步到中心 | 我方 5/5 `executed`，一轮吃 3 点；敌方仅 4 条，占 cp_4 并用 s4 部署 ranger(-4,0)。R1 末 3:1。冲突格无；治疗无 | **高**：用「同一单位跨两个行动点各走 2 格」把流量持有从第一个整轮就开始累计 |
| R2 | 5/5 AP：scout(3,0)→(0,0) 抢 cp_center；cp_1 部署 ranger(2,0)[80]；cp_2 部署 inf(1,2)[55]；inf(0,3)→(0,1)；inf(3,-3)→(1,-2) | 敌方 scout 仍在 (-3,0)/西侧，抢中心是公开可见的竞速；敌方另两路可吃 cp_3/cp_5 | 5/5 `executed`；cp_center→我、cp_3/cp_5→敌。R2 末 4:3；收入我 32（8+3×8）敌 16。冲突格无 | **高**：夺下唯一 repair 点，此后 7 次 `control_point_repair` 全归我 |
| R3 | 5/5 AP：inf(1,2)→(0,3) 回守 cp_2；inf(1,-2)→(3,-3) 回守 cp_6；ranger(2,0)→(1,0)；ranger 锁 (-2,0)；inf(0,1)→(2,1) | 敌方 ranger(-2,0) 带 `attackLock`，会锁我前压单位；我方 scout 在 (0,0) 是显眼靶 | 5/5 `executed`。s4 我方 `single`+锁定命中敌 ranger 37（68→31）；敌方 s1 锁定命中我 scout 37（60→23）。同 step 双方互有命中，无先手可言 | 中高：首次锁定交火，逼出敌方唯一远程 HP；两路回守防偷点 |
| R4 | 5/5 AP：ranger 锁 (-1,0)；scout(0,0)→(3,0) 换防；ranger(1,0)→(0,0)；部署 ranger(1,-1)[80]；inf(2,1)→(1,1) | 敌方 ranger 仅 31HP 且必在射程泡内；敌方 inf(0,-1) 明显要冲中心 | 4 `executed` / 1 `failed`。s1 锁定 37（实际 31）**击杀敌方唯一 ranger**；s3 我方与敌方 inf 同抢 (0,0) → **双方 `destination_conflict`**；敌方 s5 `unit_gone`（ranger 已死）。cp_center 首次维修 +10 | **高**：低 roll 必杀 `38−3−3=32 > 31HP`；冲中心失败反而阻止敌方占点，等价 1 AP 换一次否决 |
| R5 | 5/5 AP：inf(1,1)→(0,0)；双 ranger 锁 (0,-1) ×2；inf(3,-3)→(2,-3)→(0,-3) 夺 cp_5 | 敌方 inf(0,-1) 满血、仍在中心门口；另有一支 inf 在西南 | 4 `executed` / 1 `failed`。s1 我方与敌方 inf **又同抢 (0,0) → 双方 `destination_conflict`**；s2/s3 锁定 30+31 把敌 inf 打到 29；双段行军夺 cp_5。R5 末 5:2 | 中高：连续两轮用冲突封锁中心；但 s1 是明知会撞的冗余补位 |
| R6 | 5/5 AP：inf(1,1)→(0,0) 补位；双 ranger 锁 (0,-1) ×2；cp_center 部署 ranger(0,1)[80]；inf `line` 瞄 (0,-1) | 敌方 29HP inf 会移动躲集火；center 是公开部署源 | 4 `executed` / 1 `missed`。s2/s3 锁定 28+1 **击杀敌 inf**（`unit_death` R6 s3）；s5 `line` 瞄 (0,-1) **落空**（目标已死/移出覆盖格），白耗 1 AP | 中：三把 ranger 成型；但把非锁定 `line` 排在击杀之后是明显错序 |
| R7 | 5/5 AP：三把 ranger 锁 (-2,0) ×3；center inf `line` 瞄 (-2,0)；cp_center 部署 inf(-1,1)[55] | 敌方 inf 在 (-2,0) 附近前压，属会移动的机动目标 | 4 `executed` / 1 `missed`。三发锁定 31+32+27 **击杀敌 inf**（`unit_death` R7 s3）；s4 `line` 同格 **落空**，目标已移出射线覆盖 | 中：锁定网稳定，但仍保留了一发低命中率的预测火力 |
| R8 | 5/5 AP：双 ranger 锁 (-1,3)；两发 inf `line` 瞄 (-1,3)；ranger 锁 (-1,-2) | 敌方一支 inf 在 (-1,3) 附近，另一支在 (-1,-2)，均可 move 2 逃逸 | 4 `executed` / 1 `missed`。s1/s2 锁定 31+28、s4 `line` 命中 23，把 (-1,3) 残兵打到 **8HP**；s3 `line` **落空**；s5 锁定 29 把 (-1,-2) 打到 61HP | 中：`line` 覆盖格与敌人最终位置错配，两发中只有一发有效 |
| R9 | 5/5 AP：ranger 锁 (-1,2) 收残兵；inf(-1,1)→(-3,3) 夺 cp_3；ranger 锁 (0,-2)；ranger 锁 (0,-2)；inf `line` 瞄 (0,-2) | 敌方 8HP 残兵与 (-1,-2) 方向机动单位都是公开可见的逃逸威胁 | 3 `executed` / 2 `missed`。s1 锁定 31（实际 8）**秒掉残兵**（`unit_death` R9 s1）；s2 夺 cp_3，据点 **6:1**；s3 锁定 31 打到 30HP；**s4 锁定 `missed(target_escaped)`、s5 `line` 落空**，2 AP 打空。敌方首次触发 `comeback_supply +12`（分差 47.5%） | 中：占点胜势确立，但 s4/s5 押同一格且都未留保底 |
| R10 | 5/5 AP：ranger 锁 (-1,-2)；inf `line` 瞄 (-1,-2)；ranger(1,0)→(-1,1)；ranger 锁 (-3,0)；cp_center 部署 ranger(-1,0)[80] | 敌方守 cp_4 的 scout 在 (-3,0)，是固定格上的可锁目标 | 3 `executed` / 2 `missed`。**s1 锁定 `target_escaped`、s2 `line` 落空**（连续第 3、4 个 AP 打空）；s4 锁定 31 把敌 scout 打到 29HP；s5 部署第四把 ranger | **低**：全局最差的一轮，40% AP 花在追击一个会跑的目标上 |
| R11 | 5/5 AP：ranger 锁 (-3,0) 收 scout；center inf(0,0)→(-2,1)；同 inf→(-3,0) 占 cp_4；ranger 锁 (-2,-2)；cp_center 部署 ranger(0,-1)[80] | 敌方 inf(-4,2) 同样能到 (-2,1)；敌方另在 HQ 部署 support(-4,0) | 3 `executed` / 2 `failed`。s1 锁定 31（实际 29）**击杀敌 scout**（`unit_death` R11 s1）；**s2 与敌方 inf 同抢 (-2,1) → 双方 `destination_conflict`，s3 同单位第二跳立刻 `previous_action_failed` 作废**，占 cp_4 失败；s4 锁定 32（实际 30）**击杀敌 inf**（`unit_death` R11 s4）；s5 部署第五把 ranger。敌方也 2 条 `failed`。双方攻击均无治疗覆盖 | 中：单轮双杀很漂亮，但作废链吃掉 2 AP 与一个据点 |
| R12 | 5/5 AP：ranger(-1,0)→(-2,0) 进入 HQ 射程；`single` 瞄 HQ(-5,0)；inf(-1,1)→(-3,1)；`single` 瞄 HQ；ranger(0,-1)→(-2,-1) | HQ 永不移动，是唯一必中靶；敌方只能用 `line` 反击我前压单位 | 5/5 `executed`。s2 命中 HQ **35**、s4 命中 HQ **30**，HQ 200→135，本局首度 HQ 伤害；敌方 s2 两发 `line` 各 28 命中我方单位。治疗：敌方 support 未产生治疗结算 | **高**：胜负手。`enemyHqDamage=5/点`，一发约 30 伤 ≈ 150 分，远高于一个据点的 60 分 |
| R13 | 5/5 AP：三发 `single` 瞄 HQ(-5,0)；inf(0,1)→(-1,0)；inf(1,-1)→(-1,-1) | 敌方已无远程单位，HQ 血量公开；敌方 `line` 只能打到我前压 ranger | 5/5 `executed`。三发 HQ **34+32+29=95**，HQ 135→40；敌方 s2 `line` 命中我 ranger 29（打至 11HP）。敌方 1 条 `failed`。comeback +12（分差 87.4%） | **高**：把 HQ 压到一发可终结的血线，同时补齐终结炮台站位 |
| R14 | 2 条进入结算：`single` 瞄 HQ(-5,0) ×2（第三发未进入结算，本轮 `steps=2` 即终止） | 敌方 11HP 我方 ranger 是公开的被集火目标，但其炮击已排入 s1 | 2/2 `executed`。s1 我方 HQ **35**（HQ 40→5），**同一行动点敌方 `line` 31（实际 11）击杀我方 ranger**（`unit_death` R14 s1）；s2 第二发 HQ 名义 30、**实际 5** 把 HQ 打到 **0** → `headquarters_destroyed` → `player_eliminated` → `game_over`。cp_4 中立化 | **高**：净 HP 规则下「先开火再死」——死亡单位仍完成已排攻击，胜利不受影响 |

**逐轮 AP 与冲突汇总：** 我方 14 轮共 **67** 条动作进入结算（R1–R13 每轮 5 条，R14 仅 2 条）；敌方 **60** 条（多轮只排 3–4 条）。名义上限 14×5=70 AP/人。冲突格集中在 `(0,0)`（R4 s3、R5 s1）与 `(-2,1)`（R11 s2），三次均造成**双方** `destination_conflict`；本局**未出现**同 step 双方互换格位的腾格/交换案例。所有 `failed`/`missed` 动作仍消耗 1 AP；我方 7 次部署全部 `executed`，无「失败部署不扣补给」的实例可核验。

## 核心策略与关键转折

1. **R1 双段行军抢经济（开局转折）：** 用「同一单位跨两个行动点各走 2 格」的一轮 5 AP 同时吃下 cp_1 / cp_2 / cp_6 三个安全 supply 点，而对手把 1 AP 花在部署 ranger 上只拿到 1 点。因为 `controlPoint` 权重 60 中有 70% 计「每整轮平均持有数」，第一整轮就开始累计的领先会滚到终局：`game_over.scores.controlHold` 为 **5.00 : 1.77**（按 R1–R13 共 13 个 `controlHoldCounted=true` 的整轮平均，R14 `gameOver=true` 不再计入）。R2 再拿 cp_center，此后 7 次 `control_point_repair` 全归我。

2. **R3–R4 锁定点名拔掉敌方唯一远程（预测火力转折）：** 同时模式下攻击瞄的是**格子/方向**而非单位，只有 `attackLock` 的 ranger 例外。R3 s4 我锁定 37 伤把敌方 ranger 打到 31HP，敌方 s1 同轮也锁定打我 scout 37——同 step 双方互有命中，不存在「先手击杀阻止开火」。R4 s1 用低 roll 下界计算 `38(攻) − 3(防) − 3(方差) = 32 > 31HP` 保证击杀，且锁定射击只要目标没逃出射程泡就必中。敌方 ranger 在**同一 step** 也打出一发 32 伤锁定（把我方单位打到 1HP）——被击杀单位仍完成已排攻击，这正是净 HP 结算的体现，同一现象在 R14 s1 再次决定终局。此后敌方再无远程 DPS，我方能安全地用中心部署源持续产 ranger。

3. **R4/R5/R11 的 `destination_conflict` 反预测（冲突转折）：** 同一行动点内任意玩家的移动/部署争同一格会**全部失败**。R4 s3 与 R5 s1 连续两轮我方与敌方 inf 同抢中心 (0,0)，双方都失败，结果是我方保住 cp_center 归属、敌方两次占点企图落空；R11 s2 同抢 (-2,1) 同样双方失败，但同一单位排在 s3 的第二跳立刻被 `previous_action_failed` 作废，形成「1 次冲突 → 2 AP 全废」的作废链。这类互相否决在领先方手里等价于用 1 AP 换掉对手一次成功占点，但必须避免把关键动作串在同一单位后面。

4. **R14 s1 的净 HP / 同归于尽（终局转折）：** 同一行动点内伤害与治疗先汇总再判死亡，**死亡单位仍完成已排攻击**。敌方 `line` 在 s1 以 31 点（实际 11 点）击杀我 11HP ranger 的同时，该 ranger 的 HQ 炮击仍 `executed` 打出 35；s2 第二发把 HQ 剩余 5HP 打空。因此「保脆弱炮台存活」并不是终局必要条件——把攻击排进队列本身就已经锁定了输出。

5. **R12 识别权重杠杆（胜负手）：** 本局 `enemyHqDamage = 5/点`，一发 ranger 打 HQ 约 30 点就是约 150 分，远超一个据点的 60 分；而 HQ 永不移动，`single` 瞄 (-5,0) 是全局唯一必中靶。R12–R14 共 **7 发** HQ 炮击全部命中（R12 35/30、R13 34/32/29、R14 35/5），累计实际伤害 **200**（名义 damage 合计 225，最后一发被 HQ 剩余 5HP 截断），把敌方 HQ 从 200 打到 0，比 `maxTurns=15` 提前 1 轮以实际摧毁 HQ 结束，而不是拖到强制裁决。对手全程 HQ 伤害 0。

## HQ、据点与经济分析

- **HQ 伤害与 HP：** 我方累计对敌 HQ 伤害 **200**（7 发全中，命中率 100%）；敌方对我方 HQ 伤害 **0**，我方 HQ 全程 200/200。仅这两项就贡献 `200×5 + 200×1 = 1200` 分，占我方总分的 68.6%、占分差的 75.8%。`headquarters_destroyed` 发生在 R14，随后 `player_eliminated(reason=headquarters_destroyed)` → `game_over(winner=player_b, reason=last_player_standing)`。
- **击杀 / 被击杀：** 回放共 7 次 `unit_death`，我方击杀 6（R4 敌方 ranger 80、R6/R7/R9/R11 敌方 infantry 55×4=220、R11 敌方 scout 42 → `killValue 342`），敌方击杀 1（R14 我方 ranger 80 → `killValue 80`）。按最后一击归属入账，非致命伤害不直接得分。
- **占点轨迹（9 次 `control_point_captured`）：** R1 我 cp_1/cp_2/cp_6、敌 cp_4（3:1）；R2 我 cp_center、敌 cp_3/cp_5（4:3）；R5 我夺 cp_5（5:2）；R9 我夺 cp_3（6:1）；R14 敌方淘汰时 cp_4 中立化。**期末 6:1**，`game_over.scores.controlHold` 流量持有 **5.00 : 1.77**（按 R1–R13 共 13 个 `controlHoldCounted=true` 的整轮平均）。中心 repair 点从 R2 起归我，共 7 次 `control_point_repair`（R4 1 次、R12/R13/R14 各 2 次）。
- **收入与支出：** 起始各 120；`income` 各 13 次，我方 **600**（R2 32，R3–R5 各 38，R6–R9 各 46，R10–R14 各 54）、敌方 **288**（R2 16，R3–R5 各 32，R6–R9 各 24，R10–R14 各 16）。敌方另有 5 次 `comeback_supply +12`（R9–R13，分差 47.5% → 87.4%）共 **60**。部署：我方 7 次共 **510**（ranger×5=400、infantry×2=110，其中 5 次从 cp_center 出兵），敌方 6 次共 **368**（ranger 80、infantry×4=220、support 68）。**结余校验：我 120+600−510 = 210、敌 120+288+60−368 = 100**，与 `game_over.scores.supplies` 完全一致。`supplies` 权重为 0，结余本身不计分——本局把多余补给全部转成了 ranger 军力，方向正确。
- **同时结算如何改变开火先后与救援：** 无先手意味着「先手击杀以阻止对方开火」不存在，R3 双方锁定互中、R14 s1 我方 ranger 死亡仍完成炮击都是这一规则的直接结果；所有行动点结束后才统一占点与裁决，因此 R14 只结算 2 个 step 就因 `gameOver=true` 终止，本轮后续已排动作不再执行。也因为「先移出、再移入」的到达判定，同 step 双方抢同一空格时不是「谁快谁进」，而是全部 `destination_conflict` 失败，中心归属在多轮里靠这种互相否决维持，而不是靠驻军防守。

## 计划动作与裁决分账本

| 席位 | 进入结算的计划动作 | 成功 `executed` | 失败 `failed` | 落空 `missed` | 失效 `fizzled` | 主要 AP 浪费原因 |
|---|---:|---:|---:|---:|---:|---|
| `player_b`（我） | **67** | **56** | 4 | 7 | 0 | `destination_conflict` 3、`previous_action_failed` 1；预测 `line` 打空 5、锁定 `target_escaped` 2 |
| `player_a` | **60** | **54** | 6 | 0 | 0 | `destination_conflict` / `destination_occupied` / `unit_gone` / `previous_action_failed` 等移动撞车 |

- 我方成功率 **83.6%**（56/67），敌方 **90.0%**（54/60）。`action_failed` 事件共 10 次，与双方 `failed` 合计 10 条一致。失败/落空动作**仍消耗 AP**（我方浪费 11 AP），失败部署不扣补给（本局我方无失败部署）。
- 攻击命中：我方 32 发、命中 25 发（**78.1%**），实际伤害合计 688（含 HQ 200）；敌方 8 发全中（100%），实际伤害 212，但全部打在单位上、HQ 伤害 0。我方 7 次落空全部发生在 R6–R10 的追击阶段；R12–R14 我方 7 发 HQ 炮击与敌方 4 发 `line` 共 **11 发攻击零落空**。
- 裁决分按本局权重计算（据点项按默认 `controlPointFlowRatio=0.7` 反算，结果与 `game_over.scores.total` 完全吻合）：

| 项目 | 权重 | `player_b`（我） | `player_a` |
|---|---:|---:|---:|
| 累计 HQ 伤害 | 5 | 200×5 = **1000** | 0 |
| 己方 HQ HP | 1 | 200×1 = **200** | 0 |
| 据点（流量 0.7 + 期末 0.3） | 60 | (5.0×0.7 + 6×0.3)×60 = **318** | (1.77×0.7 + 1×0.3)×60 = **92.34** |
| 存活军力价值 | 0.35 | 514×0.35 = **179.9** | 178×0.35 = **62.3** |
| 剩余补给 | 0 | 210×0 = **0** | 100×0 = **0** |
| 击杀造价 `killValue` | 0.15 | 342×0.15 = **51.3** | 80×0.15 = **12** |
| **总分** | — | **1749.20** | **166.64** |

> 分差 1582.56 中 **1200 分来自 HQ 双向**（对敌 1000 + 己方满血 200），据点净胜 +225.66、军力 +117.6、击杀 +39.3。屯兵、补给与击杀都不是主要领先来源；「据点流量 + 稳定锁定网」负责把局面撑到能安全推塔，「HQ 伤害」负责把分差拉开。

## 失误与改进

1. **R9 s4/s5 与 R10 s1/s2 连续 4 AP 追击扑空（最贵低效）：** 实际计划是把两把 ranger 的 `attackLock` 与两发 infantry `line` 全部押在 (0,-2) / (-1,-2) 这两个敌方机动单位当前格上；结果是 2 次 `target_escaped` + 2 次 `line` 落空，40% 的 R10 AP 白耗。**正确做法**：对低 HP 且 `moveRange≥2` 的目标，锁定射击只保证「未逃出射程泡」时命中，因此要么在同一 step 用两把位置不同的 ranger 分别锁定、覆盖不同逃逸方向，要么直接把 AP 转去打固定靶（HQ / 站立在 CP 上的单位）；非锁定 `line` 只用于覆盖敌方**必经**格而非当前格。**触发条件**：目标 HP 低于一发伤害、且我方只剩单发锁定可用时，禁止再叠加两发非锁定火力押同一格。**预期收益**：省下约 4 AP，按后期节奏可提前 1 轮进入 HQ 射程。

2. **R11 s2→s3 的作废链吃掉一个据点：** 实际计划是让 center 的同一支 infantry 在相邻两个行动点先冲 (-2,1)、再奔 (-3,0) 占 cp_4；s2 与敌方 inf 同抢 (-2,1) 触发双方 `destination_conflict`，s3 立刻被 `previous_action_failed` 作废，2 AP 与 cp_4 一起丢失。**正确做法**：占点这类多跳计划不要串在同一单位上——用两支不同单位分别承担两段移动，或在两段之间插 `wait` 把第二跳后移、先让冲突暴露；更稳的是直接站上目标 CP 格，逼对手单方面 `destination_occupied`。**触发条件**：目标格是敌方同样可达的中立/争夺格（尤其靠近敌方出生侧）时。

3. **R4 s3、R5 s1 连续两轮明知会撞仍冲 (0,0)：** 反预测上确实阻止了敌方进中心，但每次都实付 1 AP，且第二轮完全可预判。**正确做法**：第一轮用冲突封锁后，第二轮改为让已有单位**站上**中心格（敌方再撞就是 `destination_occupied` 单方面失败），或把补位动作换成 `wait` 保留 AP。**触发条件**：同一格已连续发生过一次双方 `destination_conflict`。

4. **R11 的一次越距瞄准被 `invalid_attack` 拒绝（局内定性记录，未进入回放结算）：** 曾试图让 ranger(1,-1) 瞄 (-2,-2)，六角距离实际为 4 > `attackRange 3`，被服务器拒绝后及时改成从 cp_center 部署 ranger。**正确做法**：入队前统一按 `dist = max(|Δq|, |Δr|, |Δs|)`（`s = −q−r`）核算射程，不能把直角/曼哈顿直觉套到六角坐标。**触发条件**：任何跨 3 格以上的瞄准格。该拒绝不属于回放中的 `round_resolved` 结果，故不计入上文任何统计。

5. **R9–R11 才迟迟转火 HQ（路径依赖）：** 从 R9 起敌方已无远程单位、据点 6:1、我方手握三把 ranger，理论上 R9–R10 就能把 ranger 推到 (-3,0) 开始破塔，但实际把 AP 继续花在清残兵与占 cp_4 上，直到 R12 才首次炮击 HQ。**正确做法**：一旦确认「敌方远程已清零 + 我方 HQ 无威胁」，立刻把新增部署的 ranger 直接投向 HQ 射程格，按 `5 分/点` 的边际收益重排优先级；清残兵（0.15/造价）与再占一点（60 分）都远低于一发 HQ 炮击（约 150 分）。**触发条件**：敌方 ranger 全部阵亡且我方据点 ≥5。**预期收益**：可提前约 2–3 轮结束对局，并减少 R13/R14 被 `line` 反击的损失。

> 注意：以上 `failed` / `missed` / `destination_conflict` 都是**确定性**的同时结算规则结果，不是随机事件；规划时可预知并规避，不能归因于运气。

## 与历史对局对比

- **`records/V3/tg_0247_win_WB@hy4.md`（同 agent WB、同模型 hy4、同 `standoff`/2 人，schemaVersion 3.9.4，247 事件）：** 那局计划 61 条、成功 47、失败 10、落空 4，攻击命中率 **82.6%**，据点期末 4:3 / 流量 3.58:3.25，R13 摧毁 HQ（同为 7 发共 200 点），总分 **1525.36 : 341.75**（分差 1183.61）。本局计划 67 条、成功 56、失败 **4**（撞车类从 10 降到 4）、落空 7，命中率 **78.1%**（因 R9–R10 押同一格而略降），据点期末 **6:1** / 流量 **5.0:1.77**，R14 摧毁 HQ，总分 **1749.20 : 166.64**（分差 **1582.56**）。结论：本局把「移动/部署撞车」控制得明显更干净、中央据点从 R2 守到终局（那局曾一度 2:5 落后再夺回），多出的约 224 分主要来自据点流量与存活军力；但**预测火力命中率退步**，说明「减少撞车」与「减少追击扑空」是两条需要分别维护的纪律。两局共同验证了 `enemyHqDamage=5` 的破塔路线在 3.9.x 上稳定复现。
- **`records/V3/tg_0244_win_WB@dsv4pro0813.md`（同 `standoff`/2 人）：** 那局据点同样 6:1、流量 4.36:1.73，但**双方 HQ 伤害均为 0**，第 12 轮以 `forced_adjudication_score` 结束，总分 **671.27 : 353.96**（分差 317.31），计划 55 条 / 失败 2 / 落空 6。本局据点控制相近、AP 浪费更少（失败 4 vs 2、落空 7 vs 6 基本持平），却因 200 点 HQ 伤害把分差放大约 **5 倍**并提前以实际淘汰收尾。两局说明「据点压制」与「HQ 破塔」是两条独立胜利路径，后者每点伤害 5 分的权重效率远高于前者的 60 分/点据点。
- **`records/V3/tg_0122_win_WB@hy3.md`（旧版本，`turn_limit_score` 打满 15 轮，1357 分）：** 该局最贵的教训是「第 1–4、6–7、12–14 轮共 **12 次** `move→(0,0)` 因 `destination_conflict` 失败，反复争夺中立 repair 中心浪费 AP」，以及「分散地图应优先 ranger/infantry 而非 heavy」。本局的修正非常直接：R2 一次性抢下 cp_center 后**长期控住**（7 次维修全归我），中心相关冲突只有 3 次且都是主动反预测阻挡、不是盲冲；兵种全程只用 ranger 与 infantry（5 把 ranger、2 把新增 infantry），完全不出 heavy、不出 support，验证了 hy3 的结论。注意该局是旧版本、含行动功勋/不同权重口径，故只比较冲突格、中心控制与兵种选择，不直接比较总分。

## 总结

> **核心口诀：队列位置就是行动点，先铺路再出手；前一步失手，后续全作废；同时无先手，锁定与必中的 HQ 才是稳定输出。**

**一句话总结：靠首轮双段行军抢占 3 个安全哨点、R2 拿下中心维修站后长期控住，用 5 把游侠的锁定网逐轮拔掉敌方远程与前压单位把据点打到 6:1，末段抓住 `enemyHqDamage=5` 的权重在 R12–R14 连打 7 发共 200 点 HQ 伤害，第 14 轮以「死亡单位仍完成炮击」的净 HP 规则摧毁敌方 HQ 直接淘汰对手，以 1749.20 : 166.64 取胜。**
