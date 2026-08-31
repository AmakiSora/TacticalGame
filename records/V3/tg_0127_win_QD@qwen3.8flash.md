# 战术游戏同时回合模式复盘 — `player_b` 视角

**日期/游戏ID/回放版本:** 2026-08-28 / `932413d1-b0a5-49ab-aa5f-676ebaaadd8b` / 3.3.5（`records/V3/tg_0127_20260828.json`，277条事件）
**地图/参战人数:** `standoff`（对峙之地，半径5 pointy-top 六边形，12块blocker，7个CP：6 supply + 1 repair cp_center）/ 2人；**模式:** simultaneous（同时回合，秘密计划/严格同时结算）
**玩家:** Qwen3.8Flash-QD（QD@qwen3.8flash）；对手：GLM5.3Flash-QD（QD@glm5.3flash）
**席位与出生:** `player_b`，**turnOrder=0**（同阶段确定性处理优先），HQ(-5,0) HP200 def6，初始 2×infantry @(-5,1)(-4,-1) + scout @(-4,0)；对手 HQ(5,0)，初始 2×infantry @(4,1)(5,-1) + scout @(4,0)
**结果:** 🏆 **第1名** — `turn_limit_score`（双方存活到 maxTurn=15，无 HQ 归零 / 无人被淘汰）
**结束轮次:** 第15/15整轮；**HQ最终HP:** 200/200（双方HQ均未被触及）

> 数据来源：服务器 http://117.72.181.8:3123 REST API 实时操作。`turn.currentPlayerId` 与 `turn.currentOwner` 始终为 `null`；信号为 `phase==="active"` 且 `plan.committed` 不含自己。回合操作由我方逐回合 REST 调用执行（`/move` `/attack` `/deploy` `/end-turn`），轮询用 `wait-turn.mjs` 等待 enemy committed。

---

## 本局配置（standoff 特调）

`actionsPerTurn=5`（每轮最多5个计划动作）；`baseIncome=8`，`controlPointIncome=8`；CP types：cp_1~cp_6 为 `supply`（income 8），cp_center 为 `repair`（income 6 + repairAmount 10）；`damageVarianceRange=3`，`minimumDamage=1`；`startingSupplies=120`；`maxTurns=15`；`comebackSupply`: startRound=4, gapPercent=40%, amount=12。
裁决权重：`enemyHqDamage=5, ownHqHp=1, controlPoint=60, armyValue=0.35, supplies=0.25, effectiveActions=6`。
兵种属性：infantry 90/31/7/mv2/rng2/line2/cost55、scout 60/16/4/mv3/rng1/single/cost42、heavy 140/40/9/mv2/rng1/arc/cost100、ranger 68/38/3/mv2/rng3/lock/cost80、support 76/10/5/mv2/rng2/healArc/cost68。HQ 200HP def6。

---

## 最终排名摘要

| 名次 | 席位 | 玩家 | 状态 | 总分 | 关键项 |
|---:|---|---|---|---:|---|
| **1** | **`player_b`** | **Qwen3.8Flash-QD（我）** | 存活 | **1111.35** | CP 5×60=300、armyValue 316×0.35=110.6、actionScore 498、ownHqHp 200、supplies 11×0.25=2.75 |
| 2 | `player_a` | GLM5.3Flash-QD | 存活 | 956.75 | CP 2×60=120、armyValue 465×0.35=162.75、actionScore 456、ownHqHp 200、supplies 72×0.25=18 |

**分差 +154.6**，主要来自 CP 数差（+180）和 actionScore 优势（+42），被敌方军力价值和补给部分抵消。

---

## 计划—结算时间线

| 轮次 | 我的计划 | 对手可见威胁 | 结算结果 | 质量 |
|---|---|---|---|---|
| R1 | deploy+capture cp_4, 部署推进 | 敌方同步 | 3/3 exec; cp_4 占领 | ✅ |
| R2 | 5动作铺经济 | 敌双跳抢cp_center+cp_6 | 5/5 exec; 敌获得cp_center、cp_6 | ✅ 执行 |
| R3 | 5动作,1失败 | 争cp_1方向 | 3exec+1fail; dest conflict 中心格 | ⚠️ |
| R4 | 4动作全成 | 敌抢cp_2、cp_5 | 4/4 exec; 但敌占领成功 | ❌ 失2 CP |
| R5 | 5动作(4+1fail) | 击杀敌 scout 7aceec37 | 4exec+1fail | ✅ 首杀 |
| R6 | 5动作(4+1fail) | 我 2912a911 inf 阵亡 | 4exec+1fail; 敌cp_3 | ⚠️ 交换 |
| R7 | 4动作(3+1fail) | 敌 cp_4 丢失中 | 3exec+1fail | ❌ |
| R8 | 4动作(4+0fail+1miss) | 敌 cp_4 被 ef1ec087 抢走 | 4exec+1miss | ❌ CP 全丢 |
| R9 | 5动作全成 | 击杀 267a2126 敌 inf | 5/5 exec | ✅ |
| R10 | 4动作全成 | 击杀 ef1ec087; aa61b865 抢回 cp_center | 4/4 exec | ✅ 翻盘开始 |
| R11 | 3动作全成 | c320ff1c 抢回 cp_4 | 3/3 exec | ✅ |
| **R12** | **5动作全成：双攻杀 da5aa29b，移c7c08c11→cp_3，移e5c3f3c3→cp_5，deploy inf** | **大翻盘回合** | **5/5 exec; CP 2→4** | **⭐ 核心转折** |
| R13 | 5动作全成：攻杀ef9420ee，移e5c3f3c3→cp_6，移c7c08c11→(-1,3)，deploy ranger，移7b8ee88d | 敌新部署 | 5/5 exec; CP 4→5 | ⭐ |
| R14 | 5动作(4exec+1dest_conflict) | c7c08c11→cp_2 被对方同步争抢失败 | 4exec+1fail | ✅ 持住优势 |
| **R15** | **5动作(3exec+2dest_conflict)** | **c7c08c11→cp_2 和 e5c3f3c3→cp_1 均被对方争抢失败** | **3exec+2fail; 攻击命中2敌** | ⚠️ 奇袭未中但无伤大局 |

**全局动作统计：** 计划67次，成功59次，失败7次（均为 destination_conflict），落空1次。敌相同 67/59/7/1。AP 使用：62/75 有效（浪费 13 AP 在冲突和落空上）。

---

## 核心策略与关键转折

### 转折1：R12 双线奇袭翻 CP（从 2:5 到 4:3）
**局势：** R11 结束时 732.7 vs 1071.1，CP 2:5，落后 338 分。唯一翻盘路径是同时抢占两个空 CP（cp_3 无守、cp_5 无守）。
**计划：** c7c08c11（满血步兵 90HP）走 (-3,1)→(-3,2)→(-3,3) 占 cp_3；e5c3f3c3（60HP 侦察兵）走 (-3,-1)→(-2,-1)→(-1,-2)→(0,-3) 三跳占 cp_5。同时 b2e99adc 游侠锁定击杀 da5aa29b（它站在 (0,-2) 是 cp_5 方向的潜在威胁）。
**结果：** 两路占领全部成功（+120 相对分差），da5aa29b 被 ranger+scout 双攻击累计 37 伤害击杀。对方只攻杀了我的两个伤兵 aa61b865（25HP）和 1438f27f（15HP），交换极为有利。

### 转折2：R13 持续压迫翻 cp_6
**计划：** e5c3f3c3 从 cp_5（0,-3）继续三跳到 cp_6（3,-3）——路径全空、无人阻拦。同时 b2e99adc 锁定攻击 ef9420ee 支援兵（26/76HP，前轮被 3a944b93 消耗过），一击必杀。
**结果：** cp_6 翻转（CP 5:2），敌唯一治疗单位阵亡，失去恢复能力。对方 deploy 新 inf 但无法阻止。

### 转折3：R14-15 destination_conflict 连续封锁 cp_2
**分析：** cp_2（0,3）是对方最后一个可翻的近期目标。对手连续两轮都安排了向 (0,3) 的移动/占位，导致我 R14 c7c08c11→(0,3) 和 R15 同一目标两次失败（destination_conflict）。
**应对：** 虽然 cp_2 未能翻（从 5:2 本可扩大至 6:1），但我转向用攻击消耗敌方 armyValue（R15 命中 63c9dcb3 -34HP、0608b0b6 -24HP），保持 5:2 终局已足够取胜。
**教训：** 对手在 CP 权重极高（60）的局势下会优先保点而非交战，对关键格子的双向预测应预备替代路径或备选目标。

---

## HQ、据点与经济分析

### 据点控制时间线
| 轮次结束 | 我 CP 数 | 敌 CP 数 | 关键事件 |
|---:|---:|---:|---|
| R1 | 1 (cp_4) | 1 (cp_1) | 双方各抢最近点 |
| R2 | 1 | 3 (+cp_6,+cp_center) | 敌 scout 双跳抢占中央 |
| R4 | 1 | 5 (+cp_2,+cp_5) | 敌铺满外环 |
| R6 | 1 | 6 (+cp_3) | 全面落后 |
| R8 | 0 | 7 (cp_4被夺) | 最低谷 |
| R10 | 1 (cp_center翻) | 6 | 反击开始 |
| R11 | 2 (cp_4翻) | 5 | 继续恢复 |
| R12 | 4 (cp_3,cp_5) | 3 | ⭐ 奇袭翻盘 |
| R13 | 5 (cp_6) | 2 | ⭐ 锁定优势 |
| R15终 | 5 | 2 | cp_2,cp_1 争点失败 |

### 经济对比
- 我收入总额：120(初始) + 14轮收入（R1无收入，R2-R15按据点数计算）≈ 120+46×6+38×3+30×6 ≈ 576；总支出（部署）≈ 565（R12 inf 55、R13 inf 55、R14 ranger 80、R15 scout 42 + 前期多次部署）
- 敌方收入更高（大部分轮次持5-7 CP），最终剩 72 未花完，说明中后期有补给但缺乏有效部署位。

### 击杀与被击杀
- 我方击杀（5单位）：7aceec37 scout(R5)、267a2126 inf(R9)、ef1ec087 scout(R10)、da5aa29b inf(R13)、ef9420ee support(R14)
- 敌方击杀（4-5单位）：2912a911 inf(R6)、aa61b865 inf(R12)、1438f27f scout(R12)、3a944b93 inf(R14)、b2e99adc ranger(R15)

---

## 计划动作与六项裁决分账本

### 六项分数明细

| 项目 | 我方 | 权重 | 敌 | 权重 | 依据 |
|---|---:|---:|---:|---:|---|
| HQ 伤害 | 0 | ×5 | 0 | ×5 | 无单位进入攻击范围 |
| 己方 HQ HP | 200 | ×1 | 200 | ×1 | 双方 HQ 全程安全 |
| 据点数 | 5 | ×60 | 2 | ×60 | 核心优势来源 |
| 存活军力价值 | 316 | ×0.35 | 465 | ×0.35 | 劣势项，被 CP 补偿 |
| 剩余补给 | 11 | ×0.25 | 72 | ×0.25 | 我方全部转化为战力 |
| actionScore | 498 (merit 83×6) | 原值 | 456 (merit 76×6) | 原值 |  productive actions 略优 |
| **总分** | **1111.35** | — | **956.75** | — | **分差 +154.6** |

### 计划质量统计
| 统计项 | 我 | 敌 |
|---|---:|---:|
| 总计划动作数 | 67 | 67 |
| 成功执行 | 59 | 59 |
| 失败(dest_conflict) | 7 | 7 |
| 落空(missed) | 1 | 1 |
| AP 利用率 | 88.1% | 88.1% |
| 击杀 | 5 | 4-5 |

---

## 失误与改进

### 风险1：前期（R1-R8）过度分散导致全面落后
**问题：** R1-R8 在 CP 仅有 0-1 个时，AP 用于铺经济/移动，未优先争夺 cp_center。对手 R2 即用 mv3 scout 双跳到 (0,0) 建立中央控制，此后 6 轮无法翻回。到 R8 时 0:7 CP 全面落后，分差 338。
**改进：** 同时模式的 CP 权重 60 极高，开局第 2-3 轮应以 canCapture 单位直奔 cp_center，即使放弃外环 1 个 supply 点。scout mv=3 两轮可达中心（(-4,0)→(0,0) 距离 4，需要 2 步移动），R2 就能争夺。

### 风险2：R14-15 连续被 destination_conflict 封锁 cp_2
**问题：** 同一目标格 (0,3) 连续两轮被对方争抢，浪费 2 AP + 1 AP（R14 c7c08c11 移动、R15 c7c08c11 移动 + e5c3f3c3 移动）。对方已读出我的 cp_2 意图。
**改进：** 当目标被 conflict 封锁后，应换用替代路径（如让 c7c08c11 绕到 (0,2) 下一轮再入 (0,3)），或改为攻击路线（c7c08c11 在 (-1,3) 可 line 攻击 (0,2) 和 (1,1)，对敌 0608b0b6/a1cb56b0 造成 armyValue 伤害），把 AP 转化为确定收益而非赌博。

### 低效1：R12 中 scout 1438f27f（15HP）攻击而非后撤
**影响：** 1438f27f 以 16 攻击攻击 da5aa29b，仅造成 ~9 伤害。下一相位被 da5aa29b 反击致死。如果让 1438f27f 后撤保留（15HP 在下一轮仍有 cp_center 防守价值），或让它直接移动去 cp_5 而不是攻击，整体收益可能更高。
**评估：** 实际影响有限——双攻击确保击杀 da5aa29b（37 总伤害 vs 单 ranger 只有 31，可能不杀）；保留 cp_5 长期安全。但 9 点伤害的 merit 仅 ceil(9/20)=1，效率偏低。

---

## 与历史对局对比

1. **tg_0123_lose_QD@qwen3.8flash（同图/同席位负局）**：该局负于 annihilation 模式，教训是"外环据点沉没后部署通道崩溃"。本局同时回合模式下，CP 不因距离衰减，一旦占领就是永久 +60 分（直到被翻），因此"奇袭翻点"成为核心翻盘手段——R12-R13 连续翻 3 个 CP 直接扭转局面。
2. **tg_0124_win_OMP@minimaxm3（同图，player_a 视角胜 1212:722）**：该局胜方 CP 5:2，armyValue 413:25。与本次相似：CP 控制是唯一决定性因素。本局 CP 同为 5:2 但 armyValue 更低（316:465），说明本局军力交换更频繁但 CP 控制更牢固。
3. **tg_0124_lose_CP@longcat2.0（同图负局）**：败方 CP 全程被压制在 2:5 以下。本局开局同样被压到 0:7，但 R10 后成功翻盘——关键区别是"在 CP 差 4 个时是否敢于集中 AP 做多线奇袭"，tg_0124 败方没有尝试集中突破。

---

## 总结

> **核心口诀：CP 权重 60 = 一切——先读空点距离，每轮至少一个 canCapture 单位站在"对方不一定会去的"CP 格上；锁定射击清障碍，别贪攻击贪占点。**

**一句话总结：R8 跌至 0:7 CP 落后 338 分，R12-R13 双线奇袭翻 3 个空 CP + 锁定击杀支援兵一举翻转到 5:2 领先 180 分，最终靠 CP 权重优势（+300）覆盖 armyValue 劣势（-52）和补给劣势（-15），以 154.6 分差裁决获胜。**

---

*文档生成时间: 2026-08-28*
*回放格式版本: 3.3.5*
*AI模型: QD@qwen3.8flash*
