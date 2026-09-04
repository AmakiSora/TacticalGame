# 战术游戏同时回合模式第4名复盘 — `player_e` 视角

**日期/游戏ID/回放版本:** 2026-09-04 / `e1c2844c-157f-4e97-97a1-71f6ca5a0ef8` / `3.4.1`
**地图/参战人数:** `standoff`（对峙之地） / 6人；**模式:** `simultaneous`
**玩家:** Qwen3.8Max0902-QD（`QD@qwen3.8max0902`）
**席位与出生:** `player_e`，`slot_6`，HQ(5,-5)，`turnOrder=5`（同阶段确定性处理时最后结算，仅用于打破平局）
**结果:** ⚪ 第4名 — `turn_limit_score`（`player_b` 以 1909.7 分裁决获胜）
**结束轮次:** 第 15/15 整轮；**HQ 最终 HP:** 200/200（全程未被攻击）

> **模式说明：** `simultaneous` 无 `turn.currentPlayerId`（始终为 `null`）；每轮所有存活玩家在计划窗口秘密排队动作，全部提交（或房主 `host/force-resolve`）后统一结算；结算严格按固定阶段顺序：deploy → move → demolish → attack+heal → deaths → CP capture → adjudication → comeback → 下一轮 income+repair。队列列表顺序 ≠ 执行优先级。

---

## 最终排名摘要（`game_over.payload.rankings`，seq 661）

| 名次 | 席位 | 玩家 | 状态 | 总分 | HQ伤害 | 己方HQ | CP | 军力价值 | 补给 | actionScore | 决定性优势 |
|---:|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | `player_b` | Hy4-WB | active | **1909.7** | 192 | 200 | 1 | 152 | 2 | 636 | HQ 伤害 192×5 = **960 分**（占总分 50%）+ 最高 actionScore |
| 2 | `player_c` | Dsv4Pro0813-WB | active | **1598.1** | 123 | 200 | 1 | 256 | 158 | 594 | HQ 伤害 615 + 最高军力 256 |
| 3 | `player_a` | GLM5.3Flash-QD | active | **966.9** | 0 | 200 | 3 | 244 | 14 | 498 | **3 个 CP**（含 R14 从我手中夺走的 cp_6）= 180 分 |
| **4** | **`player_e`** | **Qwen3.8Max0902-QD（我）** | **active** | **767.6** | **0** | **200** | **0** | **166** | **22** | **504** | **—** |
| 5 | `player_d` | Dsv4Flash0731-OMP | active | 592.95 | 8 | 77 | 1 | 117 | 36 | 366 | HQ 已被打到 77（-123 ownHqHp） |
| 6 | `player_f` | Qwen3.8V27B-OMP | eliminated | 357.9 | 0 | 0 | 1 | 84 | 66 | 252 | 早期 HQ 归零淘汰，分数冻结 |

> **裁决权重（本局 `config.balance.adjudicationWeights`）：** enemyHqDamage=5, ownHqHp=1, controlPoint=60, armyValue=0.35, supplies=0.25, effectiveActions=6。
>
> **我方账本核算：** HQ 伤害 0×5=0 + 己方 HQ 200×1=200 + CP 0×60=0 + 军力 166×0.35=58.1 + 补给 22×0.25=5.5 + actionScore 504 = **767.6**（与 `game_over` 完全一致）。
>
> **actionScore 溯源：** actionMerit = 攻击 ceil(621/10 逐次)=75 + 部署 7 + 占点 2 = 84；×effectiveActions 6 = 504 ✓。

---

## 计划—结算时间线（每轮：我方计划 / 对手可见推断 / `round_resolved` 结果 / 计划质量）

> 本局 `actionsPerTurn=5`；起始补给 120；base income 8/轮；CP 收入 8（`supply` 类）；comeback supply 从 R4 起，落后 40% 时每轮 +12（我 R7–R14 连续 8 轮触发，共 +96）。
>
> 坐标以我方视角（HQ 在东北角 (5,-5)）。

| 轮次 | 我的计划（单位/目标格） | 对手可见信息与可能反应 | `round_resolved` 结果 | 计划质量 |
|---|---|---|---|---|
| **R1** | 3×move：scout(4,-4)→(3,-3)；inf(4,-5)→(2,-3)；inf(5,-4)→(3,-2)。全 3 AP 铺中央 | 各方同时向中央推进；`player_b` 3 move 抢东 CP；`player_a` 3 move 抢北 CP | 全部 executed；我抢到 **cp_6**(3,-3)（seq 37），成为 6 个初始 CP 中最早落位的之一 | ✅ 开局标准，经济+分数双收 |
| **R2** | deploy ranger@(5,-4) cost 80；inf(3,-2) LINE E 射 (3,-1)（打 `player_b` 6a50dade 与 6b4470bf）；inf(2,-3) LINE NW 射 (2,-4)（预测） | 敌方能看到我 ranger 落地但不知锁定目标；`player_b` 单位仍在东北 | ranger deploy ✓；LINE E 双命中（6a50dade 22 + 6b4470bf 26）；LINE NW **missed**（敌人未走到 (2,-4)） | ✅ 2/3 命中，ranger 落地建立锁定威慑 |
| **R3** | deploy inf@(4,-4) cost 55；ranger LOCK (4,-1) 射 6a50dade；inf(2,-3) LINE E 射 (3,-1)；inf(3,-3) LINE W 射 (0,-3)（打 `player_a` d84fb17f + 2c0a7e9a） | ranger LOCK 一旦锁定，除非目标逃出射程 3 否则必中；LINE W 是远程覆盖 | 全部 executed；ranger 34 dmg；LINE E 26 dmg；LINE W 23+26 双命中（`player_a` 2 单位受创） | ✅ 4/4 全命中，本轮打出最高单次伤害 |
| **R4** | move inf(3,-3)→(3,-4) 抢占 cp_6 邻格；ranger LOCK (4,-2) 射 29484f1d；inf(4,-4) LINE E 射 (3,-1) 补刀 6a50dade；inf(3,-4) LINE W 射 (0,-3)；inf(4,-4) LINE SW 射 (4,-2) | 敌方可能撤退 wounded 单位；`player_a` d84fb17f 残血 | 5/5 executed；**首次击杀**：LINE E 击杀 6a50dade（`player_b` inf，8 补刀）；LOCK 29 dmg；LINE W 26 dmg；LINE SW 22 dmg | ✅ 5 AP 全开，1 kill + 4 命中 |
| **R5** | move inf(2,-3)→(3,-3)；move inf(3,-4)→(4,-5)；ranger LOCK (4,-2)；inf(4,-4) LINE SW (4,-2) | 敌方 29484f1d 可能移动逃出 LOCK 范围 | move 双 ✓；ranger LOCK **missed (target_escaped)**；LINE SW **missed** | ⚠️ 2/4，**首次 LOCK 失效**（敌人逃出射程 3） |
| **R6** | deploy inf@(2,-3) cost 55（从 cp_6）；move inf(5,-4)→(4,-2)；move inf(4,-4)→(3,-2)；inf(4,-2) LINE W 射 (1,-3) 打 `player_a` d84fb17f | 敌方可能撤退 d84fb17f；cp_6 提供部署原点 | 4/4 executed；LINE W 命中 27 dmg（d84fb17f HP 逼近残血） | ✅ 全命中 |
| **R7** | move inf(4,-5)→(5,-4) 回防；inf(4,-2) LINE W 射 (1,-3) 补刀；inf(3,-2) LINE NW 射 (2,-4)；ranger LOCK (4,-1) 射 c0984faa；inf(5,-4) LINE E 射 (3,-1) 打 29484f1d | 敌方 c0984faa 与 29484f1d 已残；LOCK 必中除非逃射程 | 5/5 executed；**2 kills**：LINE W 击杀 d84fb17f（14 补刀）+ LINE E 击杀 29484f1d（0 补刀，net HP 归零）；LINE NW 23 dmg；LOCK 30 dmg | ✅✅ **本局最佳轮**：5 AP + 2 kill + 全命中 |
| **R8** | move inf(3,-2)→(3,-3)；ranger LOCK (4,-1) 射 c0984faa；inf(4,-4) LINE NW 射 (2,-4) 打 02ce57f4 | c0984faa 已被 R7 打到 30 HP；LOCK 必中 | 3/3 executed；ranger LOCK 32 dmg；LINE NW 23 dmg（02ce57f4 HP 44） | ✅ 全命中；但 ranger 已暴露，下一轮可能被集火 |
| **R9** | deploy inf@(4,-5) cost 55；ranger LOCK (4,-1) 射 c0984faa（补刀击杀）；inf(4,-4) LINE W 射 (2,-3) 打 02ce57f4 | c0984faa 已残；ranger 自身 HP 也低，可能被换杀 | deploy ✓；ranger LOCK 28 dmg **KILL c0984faa**（同轮 ranger 被反杀，同归于尽）；LINE W 21 dmg | ✅ 换杀成功（ranger 80 成本换 `player_b` 一个单位） |
| **R10** | deploy inf@(4,-4) cost 55；inf(4,-5) LINE W 射 (2,-3) 预测 02ce57f4 | 02ce57f4 可能撤退 | deploy ✓；LINE W **missed**（02ce57f4 已移动） | ⚠️ 1/2，deploy 落地但攻击落空 |
| **R11** | 2 AP：inf(4,-4) LINE NW 射 (2,-4)；inf(3,-3) LINE W 射 (2,-3) | 敌方 `player_b` 9e40ef14 与 `player_a` d725df9f 都在 (2,-3)/(2,-4) 附近 | 2/2 executed；LINE NW 27 dmg 9e40ef14；LINE W 29 dmg d725df9f | ✅ 双命中 |
| **R12** | 3 AP：inf(4,-4) LINE W 射 (1,-3)；inf(3,-3) LINE NW 射 (2,-4)；inf(4,-5) LINE SW 射 (3,-4) | 敌方 9e40ef14 已残（R11 后 HP 33） | LINE W 双命中（9e40ef14 29 dmg + d725df9f 31 dmg）；LINE NW **missed**；LINE SW 4 dmg **KILL 9e40ef14** | ✅ 2/3 + 1 kill |
| **R13** | deploy inf@(3,-4) cost 55（从 cp_6）；move inf(4,-4)→(3,-3) 守 cp_6；inf(4,-5) LINE SW 射 (3,-4) 预测 | cp_6 已被敌方盯上；deploy 到 cp_6 邻格建立防线 | deploy ✓；move **failed (destination_conflict)**（`player_a` b702ffef 也移向 (3,-3)）；LINE SW **missed** | ❌ 1/3，**关键失败**：move 冲突导致 cp_6 防守失败 |
| **R14** | deploy inf@(4,-3) cost 55（从 cp_6）；inf(3,-4) LINE SW 射 (1,-2) 打 02ce57f4；inf(4,-4) LINE W 射 (2,-4) 打 b702ffef；inf(4,-5) LINE SW 射 (3,-5) 预测 | 敌方 b702ffef 在 (2,-4)，02ce57f4 在 (1,-2)；两者都可能移动 | deploy ✓；**3 个 LINE 攻击全部 missed**（02ce57f4 移到 (2,-2)；b702ffef 移到 (3,-3) = cp_6！）；**cp_6 被 `player_a` 夺走**（seq 618） | ❌❌ **灾难轮**：1/4 命中，丢失 cp_6（-60 分，`player_a` +60） |
| **R15** | 4 AP：inf(3,-4) LINE SE 射 (3,-3)；inf(4,-4) LINE SW 射 (3,-3)；inf(4,-3) LINE W 射 (3,-3)；inf(4,-5) LINE SW 射 (3,-4) 预测 | b702ffef 已占据 cp_6 (3,-3)，02ce57f4 在 (2,-3) 附近；3 个 LINE 都瞄 (3,-3) 集中火力 | 3/4 executed；LINE SE 24 dmg b702ffef；LINE SW 26 dmg b702ffef + 1 dmg **KILL 02ce57f4**；LINE W 10 dmg **KILL b702ffef**（夺回 cp_6 失败，因为占点判定在攻击之后）；LINE SW **missed** | ✅ 3/4 + 2 kill，**但为时已晚**：cp_6 已在 R14 易主，本轮击杀 b702ffef 不能立即夺回 |

---

## 核心策略与关键转折（≥3）

### 转折 1（R7）：单轮 2 kill + 5/5 全命中 — 本局最高光时刻

R7 我打出 **5 AP 全命中 + 2 kill**：
- inf(4,-2) LINE W 射 (1,-3) 补刀击杀 `player_a` d84fb17f（14 伤害，HP 归零）
- inf(5,-4) LINE E 射 (3,-1) 与 `player_b` 29484f1d 互射，net HP 归零击杀（actualDamage=0 但 killed=true，说明同轮对方也打了我，净 HP 结算后死亡）
- ranger LOCK (4,-1) 30 dmg 打 c0984faa
- inf(3,-2) LINE NW 23 dmg 打 02ce57f4

**战术分析：** 此轮成功的关键是 **多方向 LINE 交叉覆盖 + ranger LOCK 锁定残血**。LINE 攻击在 simultaneous 模式下是"预测射击"——瞄准敌人**当前所在格**，如果敌人不移动就必中。R7 我判断 d84fb17f 已残（R6 被打到 27 HP）且被夹击，很可能原地不动或向后撤，LINE W 覆盖 (1,-3) 正好是其撤退路线。29484f1d 同理。

**收益：** 单轮 +2 kill，actionMerit 暴涨（29484f1d 击杀 + d84fb17f 击杀 + 其他命中），本轮为我 actionScore 504 中贡献约 90+ 分。

### 转折 2（R9）：Ranger LOCK 同归于尽 — 用 80 成本换 `player_b` 一个单位

R9 我 ranger（HP 已低，R8 被反打）LOCK c0984faa（HP 28），结算时 ranger 32 dmg 击杀 c0984faa，但同轮 c0984faa 的攻击也命中 ranger，net HP 归零，**双双阵亡**。

**战术分析：** simultaneous 模式下攻击是同时结算的，互相射击的单位可以同轮同归于尽（规范第三节"净 HP"）。ranger 成本 80，c0984faa 是 `player_b` 的 infantry（成本 55），表面看是亏的（80 vs 55）。但考虑到：
1. ranger 已残（HP 15），下一轮很可能被白杀
2. c0984faa 是 `player_b` 的主力输出，击杀后 `player_b` 失去一个 LINE 攻击点
3. 我方 actionMerit 因这次击杀 +3（28/10 ceil = 3），actionScore +18

**收益：** 用即将报废的 ranger 换掉敌方主力，同时赚取 merit。这是 simultaneous 模式下"残血单位价值最大化"的标准操作。

### 转折 3（R13–R14）：destination_conflict + 3 LINE 全 miss — cp_6 失守的连锁灾难

**R13：** 我计划 move inf(4,-4)→(3,-3) 守 cp_6，但 `player_a` 的 b702ffef 也移向 (3,-3)，触发 **destination_conflict**，双方 move 全部失败。同时 LINE SW 预测 (3,-4) 也 missed。本轮 1/3 命中，cp_6 防守失败。

**R14：** 我计划 3 个 LINE 攻击：
- inf(3,-4) LINE SW 射 (1,-2) 打 02ce57f4 → **missed**（02ce57f4 移到 (2,-2)）
- inf(4,-4) LINE W 射 (2,-4) 打 b702ffef → **missed**（b702ffef 移到 (3,-3) = cp_6！）
- inf(4,-5) LINE SW 射 (3,-5) 预测 → **missed**

**结果：** b702ffef 成功移动到 cp_6 (3,-3)，回合结束时占据 cp_6，**`player_a` 从 `player_e` 手中夺走 cp_6**（seq 618）。

**战术分析：** 这是本局最致命的连锁失误：
1. **R13 destination_conflict** 暴露了我"用 move 占格防守"的思路在 simultaneous 模式下不可靠——敌人同时 move 到同一格，双方都失败，但敌人还有备选单位可以后续占点。
2. **R14 三个 LINE 攻击全部瞄"敌人当前格"**，但 simultaneous 模式下敌人会移动，单格预测命中率极低。我应该用 **LINE 覆盖敌人可能的移动路线**（如 b702ffef 在 (2,-4)，可能移到 (3,-3)/(3,-4)/(2,-3)，LINE W 只覆盖 (2,-4) 和 (1,-4)，完全没覆盖 (3,-3)）。
3. **cp_6 丢失 = -60 分（我）+60 分（`player_a`）**，直接拉开 120 分差距。如果 cp_6 保住，我总分将是 887.6，超过 `player_a` 的 966.9？不，还是低于 `player_a`（因为 `player_a` 还有 cp_5 和 cp_center）。但至少能稳居第 3。

**正确做法：**
- R13 不应 move 到 (3,-3) 与敌人抢格，而应 **deploy 一个 infantry 到 cp_6 邻格**（如 (3,-4) 或 (4,-3)），用新单位占据 cp_6 的"护卫位"，让敌人无法直接 move 到 cp_6。
- R14 应放弃"单格预测"，改用 **LINE 覆盖 cp_6 本身**（如 inf(4,-4) LINE W 射 (3,-3)，覆盖 cp_6 格），即使 b702ffef 不在 (3,-3)，也能阻止其他敌人移入。
- 或者用 **ranger LOCK**（但我 R9 已换杀，无 ranger）——这是 simultaneous 模式下唯一"必中"的攻击方式，对关键目标应保留 ranger。

### 转折 4（R15）：最后一轮 3 LINE 集中火力 (3,-3) — 2 kill 但 cp_6 已失

R15 我孤注一掷，3 个 LINE 全部瞄 (3,-3)（cp_6 格，b702ffef 所在）：
- inf(3,-4) LINE SE 射 (3,-3)：24 dmg b702ffef
- inf(4,-4) LINE SW 射 (3,-3)：26 dmg b702ffef + 1 dmg **KILL 02ce57f4**（02ce57f4 正好移到 (3,-3) 附近被 LINE 覆盖）
- inf(4,-3) LINE W 射 (3,-3)：10 dmg **KILL b702ffef**

**结果：** 2 kill，但 **cp_6 未夺回**——因为占点判定在攻击结算之后，b702ffef 死亡时 cp_6 仍归 `player_a`，且我没有单位能移动到 cp_6（所有 inf 都已用完 AP 攻击）。

**战术分析：** 这是 simultaneous 模式下"最后一轮"的典型困境：
- 攻击和移动不能同时做（每单位每轮最多 1 个动作）
- 即使击杀了占点单位，如果没有步兵同时移动到该格，CP 不会易主
- 正确做法应是：**1 个 inf 攻击 b702ffef，2 个 inf 移动到 cp_6 邻格**，回合结束时用步兵占据 cp_6。但 R15 我选择全攻击，失去了最后翻盘机会。

---

## HQ、据点与经济分析

### HQ 伤害

| 席位 | 我对该席位 HQ 伤害 | 该席位对我 HQ 伤害 | 分析 |
|---|---:|---:|---|
| `player_b` | 0 | 0 | 我方 ranger 曾锁定 `player_b` 单位但从未攻击 HQ；`player_b` 也未攻击我 HQ |
| `player_c` | 0 | 0 | 无交集 |
| `player_d` | 0 | 0 | 无交集 |
| `player_a` | 0 | 0 | `player_a` 忙于抢 cp_6，未攻击我 HQ |
| `player_f` | 0 | 0 | `player_f` 早期被淘汰 |

**结论：** 我方 HQ 全程 200/200 未被攻击（ownHqHp +200 分），但也未对任何敌方 HQ 造成伤害（enemyHqDamage 0 分）。`player_b` 靠 192 HQ 伤害拿到 960 分（占总分 50%），这是我与冠军的最大差距。

**反思：** standoff 地图 HQ 在边角（我 HQ 在 (5,-5)），距离中央交战区远，LINE 攻击射程 2 难以覆盖。要攻击敌方 HQ 需要 **ranger（射程 3 + LOCK）** 或 **heavy（arc 扇形）** 推进到敌方 HQ 附近。我全局只 deploy 了 1 个 ranger（R2，R9 换杀），从未 deploy heavy，这是 HQ 伤害为 0 的根本原因。

### 据点控制

| CP | 名称 | 类型 | 初始所有者 | 最终所有者 | 我方控制轮次 | 收入贡献 |
|---|---|---|---|---|---|---|
| cp_1 | 东侧哨点 | supply | `player_b` | `player_b` | 0 | 0 |
| cp_2 | 东南哨点 | supply | `player_f` | null（neutralized） | 0 | 0 |
| cp_3 | 西南哨点 | supply | `player_d` | `player_d` | 0 | 0 |
| cp_4 | 西侧哨点 | supply | `player_c` | `player_c` | 0 | 0 |
| cp_5 | 西北哨点 | supply | `player_a` | `player_a` | 0 | 0 |
| **cp_6** | **东北哨点** | **supply** | **`player_e`（我）** | **`player_a`（R14 夺走）** | **R1–R13（13 轮）** | **13 × 8 = 104 补给** |
| cp_center | 中心维修站 | repair | `player_a` | `player_a` | 0 | 0 |

**分析：**
- 我方 **仅控制 cp_6 一个 CP**，且 R14 被 `player_a` 夺走，最终 CP 数 = 0。
- cp_6 是 supply 类型，每轮 +8 补给，13 轮共 +104 补给（占总收入 216 的 48%）。
- 丢失 cp_6 直接导致：
  - R15 income 从 16 降到 8（-8）
  - 裁决分 CP 项从 60 降到 0（-60）
  - `player_a` 裁决分 CP 项从 120（2 CP）升到 180（3 CP）（+60）
  - **净分差：-120 分**（我 -60，`player_a` +60）

**反思：** cp_6 位于 (3,-3)，是我方 HQ (5,-5) 到中央的必经之路，也是 `player_a`（HQ 在 (0,-5)）南下扩张的目标。R13 我试图用 move 占格防守，但 destination_conflict 失败；R14 我试图用 LINE 攻击阻止 b702ffef，但 3 个 LINE 全部 miss。**正确做法应是：R12–R13 连续 deploy 2 个 infantry 到 cp_6 邻格（(3,-4)/(4,-3)/(2,-3)），形成"护卫群"，让敌人无法单单位 move 到 cp_6。**

### 经济与部署

| 项目 | 数值 | 说明 |
|---|---:|---|
| 起始补给 | 120 | `config.balance.startingSupplies` |
| 总收入 | 216 | 14 轮 × 16（base 8 + cp_6 8），R15 仅 base 8 |
| comeback 补给 | 96 | R7–R14 连续 8 轮，每轮 +12（`comebackSupply.amountPerRound`） |
| 总部署花费 | 410 | 1 ranger（80）+ 6 infantry（55×6） |
| 最终补给 | 22 | 120 + 216 + 96 - 410 = 22 ✓ |

**部署清单：**

| 轮次 | 单位 | 原点 | 目标格 | 成本 | 结果 |
|---|---|---|---|---:|---|
| R2 | ranger | HQ(5,-5) | (5,-4) | 80 | R9 换杀 c0984faa 后阵亡 |
| R3 | infantry | HQ | (4,-4) | 55 | R7 阵亡 (3,-3) |
| R6 | infantry | cp_6(3,-3) | (2,-3) | 55 | R8 阵亡 (2,-3) |
| R9 | infantry | HQ | (4,-5) | 55 | R15 阵亡 (4,-5)（被 `player_a` ranger LOCK 击杀） |
| R10 | infantry | HQ | (4,-4) | 55 | 存活 HP 90 |
| R13 | infantry | cp_6 | (3,-4) | 55 | 存活 HP 90 |
| R14 | infantry | cp_6 | (4,-3) | 55 | 存活 HP 90 |

**分析：**
- 7 次部署，6 个 infantry + 1 个 ranger，**无 heavy、无 support、无 scout**。
- heavy（成本 100，HP 140，attack 40，arc 扇形）是 simultaneous 模式下"区域封锁"利器，但我从未 deploy。
- support（成本 68，HP 76，heal 20 arc）可区域治疗，但我从未 deploy。
- scout（成本 42，HP 60，moveRange 3）机动性强，但我初始 1 个 scout 全程被困在 HQ 旁（HP 2，无法移动）。

**反思：** 我方部署策略过于单一（全 infantry），缺乏 heavy 的 arc 扇形覆盖和 support 的区域治疗。如果 R4–R5 攒够 100 补给 deploy 1 个 heavy，配合 infantry LINE 攻击，可形成"heavy arc 压制 + infantry LINE 收割"的组合，大幅提高命中率和 kill 数。

---

## 计划动作与六项裁决分账本

### 计划动作统计

| 项目 | 数值 | 说明 |
|---|---:|---|
| 总计划动作 | 52 | R1–R15 累计 |
| 成功执行 | 41 | 78.8% |
| 攻击落空（missed） | 10 | target_escaped / 敌人未走到预测格 |
| 失败（failed） | 1 | R13 destination_conflict |
| AP 浪费 | 11 | 10 missed + 1 failed，每次浪费 1 AP |

**按轮次 AP 效率：**

| 轮次 | 计划 | 成功 | 落空 | 失败 | 效率 |
|---|---:|---:|---:|---:|---:|
| R1 | 3 | 3 | 0 | 0 | 100% |
| R2 | 3 | 2 | 1 | 0 | 67% |
| R3 | 4 | 4 | 0 | 0 | 100% |
| R4 | 5 | 5 | 0 | 0 | 100% |
| R5 | 4 | 2 | 2 | 0 | 50% |
| R6 | 4 | 4 | 0 | 0 | 100% |
| R7 | 5 | 5 | 0 | 0 | 100% |
| R8 | 3 | 3 | 0 | 0 | 100% |
| R9 | 3 | 3 | 0 | 0 | 100% |
| R10 | 2 | 1 | 1 | 0 | 50% |
| R11 | 2 | 2 | 0 | 0 | 100% |
| R12 | 3 | 2 | 1 | 0 | 67% |
| R13 | 3 | 1 | 1 | 1 | 33% |
| R14 | 4 | 1 | 3 | 0 | 25% |
| R15 | 4 | 3 | 1 | 0 | 75% |

**分析：** R1–R9 平均效率 89%（高），R10–R15 平均效率 58%（低）。后期效率下降的原因：
1. 敌人学会移动躲避 LINE 攻击（R14 三个 LINE 全 miss）
2. 我方单位减少，攻击选择受限
3. destination_conflict 风险增加（R13）

### 六项裁决分账本

| 项目 | 数值 | 权重 | 得分 | 说明 |
|---|---:|---:|---:|---|
| enemy HQ damage | 0 | 5 | 0 | 未攻击任何敌方 HQ |
| own HQ HP | 200 | 1 | 200 | HQ 全程未被攻击 |
| control points | 0 | 60 | 0 | cp_6 R14 丢失，最终 0 CP |
| army value | 166 | 0.35 | 58.1 | 4 单位：scout HP2（1）+ 3 inf HP90（55×3=165） |
| supplies | 22 | 0.25 | 5.5 | 剩余补给 |
| action score | 504 | — | 504 | merit 84 × effectiveActions 6 |
| **总分** | | | **767.6** | |

**actionMerit 分解：**

| 来源 | 计算 | merit |
|---|---|---:|
| 攻击 | 38 次 attack 事件，总 actualDamage 621，逐次 ceil(dmg/10) | 75 |
| 部署 | 7 次 deploy | 7 |
| 占点 | 1 次 CP capture（cp_6 R1） | 2 |
| 治疗 | 0 次 heal | 0 |
| 拆除 | 0 次 demolish | 0 |
| **总计** | | **84** |

---

## 失误与改进（非第一名，必须给出实际计划 vs 正确计划）

### 失误 1：R13 move 到 (3,-3) 触发 destination_conflict — cp_6 防守失败

**实际计划：** R13 move inf(4,-4)→(3,-3)，试图用 move 占格防守 cp_6。

**结果：** `player_a` b702ffef 也 move 到 (3,-3)，触发 destination_conflict，双方 move 全部失败。cp_6 防守失败，R14 b702ffef 成功占据 cp_6。

**正确计划：** R13 不应 move 到 (3,-3)，而应 **deploy 1 个 infantry 到 cp_6 邻格**（如 (3,-4) 或 (4,-3)），用新单位占据"护卫位"。同时 inf(4,-4) 应 LINE W 射 (3,-3) 覆盖 cp_6 格，阻止敌人移入。

**触发条件：** 当敌人单位距离我方 CP 仅 1 格，且我方有 AP 和补给 deploy 时，应优先 deploy 护卫而非 move 占格。

**预期收益：** cp_6 保住 = +60 分（CP 项）+ 8 补给/轮（R14–R15 共 +16）= 至少 +76 分。总分将从 767.6 升到 843.6+，可能超过 `player_a`（966.9）？不，仍低于 `player_a`，但能稳居第 3。

### 失误 2：R14 三个 LINE 攻击全部瞄"敌人当前格" — 单格预测命中率极低

**实际计划：** R14 三个 LINE 攻击分别瞄 (1,-2)、(2,-4)、(3,-5)，都是敌人 R13 结束时的位置。

**结果：** 敌人全部移动，3 个 LINE 全部 missed。

**正确计划：** LINE 攻击应 **覆盖敌人可能的移动路线**，而非单格预测。例如：
- b702ffef 在 (2,-4)，可能移到 (3,-3)/(3,-4)/(2,-3)/(1,-4)。inf(4,-4) LINE W 覆盖 (3,-4)/(2,-4)/(1,-4)，应改瞄 (3,-4) 或 (2,-4)（覆盖更多格）。
- 02ce57f4 在 (1,-2)，可能移到 (2,-2)/(1,-1)/(0,-2)。inf(3,-4) LINE SW 覆盖 (2,-3)/(1,-2)/(0,-1)，应改瞄 (2,-3)（覆盖敌人可能移动到的格）。
- 或者放弃攻击，改用 **move 到 cp_6 邻格** 建立防线。

**触发条件：** 当敌人单位距离我方 CP 或关键格仅 1–2 格，且 simultaneous 模式下敌人会移动时，LINE 攻击应覆盖"敌人可能移动到的格"，而非"敌人当前格"。

**预期收益：** 如果 R14 至少 1 个 LINE 命中，可阻止 b702ffef 占据 cp_6，或击杀 b702ffef。cp_6 保住 = +60 分 + 8 补给/轮。

### 失误 3：全局无 heavy / support deploy — 缺乏区域覆盖和治疗

**实际计划：** 7 次 deploy 全部是 infantry（6）或 ranger（1），无 heavy、无 support。

**结果：** 
- 缺乏 heavy 的 arc 扇形覆盖（3 格扇形，可同时打多个敌人）
- 缺乏 support 的区域治疗（arc 治疗，可恢复多个友军 HP）
- 我方单位 HP 持续下降，无法持久作战

**正确计划：** R4–R5 攒够 100 补给 deploy 1 个 heavy（成本 100），配合 infantry LINE 攻击形成"heavy arc 压制 + infantry LINE 收割"组合。R8–R9 deploy 1 个 support（成本 68），治疗残血单位，延长作战时间。

**触发条件：** 当补给 ≥ 100 且我方缺乏区域覆盖时，应优先 deploy heavy；当补给 ≥ 68 且我方有残血单位时，应 deploy support。

**预期收益：** heavy arc 攻击可同时打 2–3 个敌人，提高命中率和 kill 数；support 治疗可恢复 20 HP/次，延长我方单位寿命。预计 actionMerit 可提高 20–30，actionScore +120–180，总分 +120–180。

### 失误 4：从未攻击敌方 HQ — enemyHqDamage = 0

**实际计划：** 全局攻击全部针对敌方单位，从未攻击敌方 HQ。

**结果：** enemyHqDamage = 0，损失 5 × N 分（N 为可造成的 HQ 伤害）。`player_b` 靠 192 HQ 伤害拿到 960 分。

**正确计划：** R2 deploy ranger 后，应利用 ranger 射程 3 + LOCK 的特性，推进到敌方 HQ 附近（如 `player_f` HQ 在 (0,5)，`player_d` HQ 在 (-5,5)），LOCK 攻击 HQ。或 R5+ deploy heavy，推进到敌方 HQ 附近，arc 攻击 HQ。

**触发条件：** 当我方有 ranger（射程 3）或 heavy（arc）且敌方 HQ 距离 ≤ 3 格时，应优先攻击 HQ。

**预期收益：** 每 1 点 HQ 伤害 = 5 分。如果造成 100 HQ 伤害 = +500 分，总分将从 767.6 升到 1267.6，可能超过 `player_c`（1598.1）？不，仍低于 `player_c`，但能稳居第 3 或第 2。

---

## 与历史对局对比

| 项目 | `tg_0117_rank04_WB@glm5.2.md`（6人 artillery-zone 歼灭） | `tg_0089_rank04_OMP@minimaxm3.md`（6人 artillery-zone 歼灭） | **本局 `tg_0132_rank04_QD@qwen3.8max0902`**（6人 standoff 同时） |
|---|---|---|---|
| 地图/模式 | artillery-zone / annihilation | artillery-zone / annihilation | **standoff / simultaneous** |
| 名次 | 4/6 | 4/6 | **4/6** |
| 总分 | 484 | 506 | **767.6** |
| CP 控制 | 2（supply_east + forward_base） | 1 | **0**（cp_6 R14 丢失） |
| HQ 伤害 | 0（无 HQ 模式） | 0（无 HQ 模式） | **0**（未攻击敌方 HQ） |
| 军力价值 | 57 | 38 | **166** |
| actionScore | 370 | 356 | **504** |
| 部署次数 | 2 | 3 | **7** |
| 击杀数 | 2 | 5 | **7** |
| 损失数 | 3 | 4 | **6** |
| AP 效率 | 未统计 | 未统计 | **78.8%** |

**分析：**
- 本局 actionScore（504）高于 tg_0117（370）和 tg_0089（356），说明 simultaneous 模式下攻击命中按 10 HP 计 merit（而非 20 HP），鼓励高频攻击。
- 本局 CP 控制（0）低于 tg_0117（2）和 tg_0089（1），说明 standoff 地图 CP 争夺更激烈，cp_6 位于中央交战区，易被多方争夺。
- 本局击杀数（7）高于 tg_0117（2）和 tg_0089（5），说明 simultaneous 模式下 LINE 攻击 + ranger LOCK 组合可有效收割残血敌人。
- 本局损失数（6）也高于 tg_0117（3）和 tg_0089（4），说明 simultaneous 模式下互相射击同归于尽风险高，单位寿命短。

**历史教训迁移：**
- `tg_0117_rank04` 指出"重装孤军深入中心绞肉机"是致命错误。本局我未 deploy heavy，避免了此错误，但也失去了 heavy 的 arc 覆盖优势。
- `tg_0089_rank04` 指出"5 击杀但 rank04，因为 armyValue 仅 38"。本局我 7 击杀但 armyValue 166（高于 tg_0089），说明 deploy 数量多可提高 armyValue，但 CP 控制为 0 仍是致命短板。

---

## 总结

> **核心口诀：每单位只押一个动作，LINE 攻击覆盖敌人移动路线而非当前格，CP 防守用 deploy 护卫而非 move 占格，ranger LOCK 留给关键目标，heavy arc 是区域封锁利器。**

**一句话总结：** **本局以 767.6 分获第 4 名，7 击杀 + 504 actionScore 表现尚可，但 cp_6 R14 被 `player_a` 夺走（destination_conflict + 3 LINE 全 miss 连锁失误）导致 CP 项归零，加上从未攻击敌方 HQ（enemyHqDamage = 0）和缺乏 heavy/support deploy，与冠军 `player_b`（1909.7 分，靠 192 HQ 伤害 = 960 分）差距悬殊。**
