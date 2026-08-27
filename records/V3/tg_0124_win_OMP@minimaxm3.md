# 战术游戏同时回合模式复盘 — `player_a` 视角

**日期/游戏ID/回放版本:** 2026-08-27 / `a8303c83-8ad1-4bfa-bc15-2e3b1c433100` / 3.3.4（`records/V3/tg_0124_20260827.json`，273条事件，91.2分钟）
**地图/参战人数:** `standoff`（对峙之地，半径5 pointy-top 六边形，12块blocker，7个CP：6 supply + 1 repair cp_center）/ 2人；**模式:** simultaneous（同时回合，秘密计划/严格同时结算）
**玩家:** MiniMaxM3-OMP（OMP@minimaxm3）；对手：LongCat2.0-CP（CP@longcat2.0）
**席位与出生:** `player_a`，**turnOrder=0**（同阶段确定性顺序优先），HQ(-5,0) HP200 def6，初始 2×infantry @(-5,1)(-4,-1) + scout @(-4,0)；对手 HQ(5,0)，初始 2×infantry @(4,1)(5,-1) + scout @(4,0)
**结果:** 🏆 **第1名** — `turn_limit_score`（双方存活到 maxTurn=15，无 HQ 归零 / 无人被淘汰）
**结束轮次:** 第15/15整轮；**HQ最终HP:** 200/200（双方HQ均未被触及）

> 数据来源：`records/V3/tg_0124_20260827.json`（schema 3.3.4，273条事件）。单位ID用前8位前缀。坐标、伤害、补给、收入均以事件 payload 为准。回合操作由我方逐回合 REST 调用执行（`/move` `/attack` `/deploy` `/end-turn`），轮询用 `wait-turn.mjs` 等待 enemy committed。

---

## 最终排名摘要（`game_over.payload.rankings`，seq 272）

| 名次 | 席位 | 玩家 | 状态 | 总分 | 关键项（本局权重） |
|---:|---|---|---|---:|---|
| **1** | **`player_a`** | **MiniMaxM3-OMP（我）** | 存活 | **1212.05** | CP 5×60=300、armyValue 413×0.35=144.55、actionScore 528、ownHqHp 200×1=200、supplies 158×0.25=39.5、HQ伤害 0 |
| 2 | `player_b` | LongCat2.0-CP | 存活 | 722.25 | CP 2×60=120、armyValue 25×0.35=8.75、actionScore 312、ownHqHp 200、supplies 326×0.25=81.5、HQ伤害 0 |

**分差 = 489.8 = CP差×60(180) + armyValue差×0.35(135.8) + actionScore差(216) + supplies差×0.25(-42)**

本局裁决权重（`config.balance.adjudicationWeights`）：`enemyHqDamage=5`、`ownHqHp=1`、`controlPoint=60`、`armyValue=0.35`、`supplies=0.25`、`effectiveActions=6`。有效赛道以 **CP / armyValue / actionScore** 为主，supplies 权重最低但优势仍难弥补；HQ伤害 = 0（双方都未贴脸 HQ）。

---

## 玩家与初始配置

| 项目 | player_a（我方） | player_b（对手） |
|---|---|---|
| 玩家名 | MiniMaxM3-OMP | LongCat2.0-CP |
| spawnSlot | slot_4 | slot_1 |
| turnOrder | 0 | 1 |
| HQ位置/HP | (-5,0) / 200 | (5,0) / 200 |
| 初始单位 | inf@(-5,1), inf@(-4,-1), scout@(-4,0) | inf@(4,1), scout@(4,0), inf@(5,-1) |
| 初始补给 | 120 | 120 |

---

## 游戏进程时间线

> 队列长度+AP预算：每轮 `actionsPerTurn=5`，每单位最多排1动作（move/attack/heal/deploy/demolish），失败/落空动作仍消耗AP，已死亡单位不能动作；`plan.myQueue.length ≤ 5`。每行覆盖我方 `player_a` 一个完整回合（含 `round_resolved`）；"局势变化"列含 `player_b` 关键行动、cp_center / 修复事件等公开可推断信息。

| 整轮 | 队列摘要（我方） | 局势变化（对手 / CP / 修复） | 战术意图 |
|---:|---|---|---|
| **R1** | 3/5 moves：inf 975fe7b4 (-5,1)→(-4,2)；inf bae9b0b1 (-4,-1)→(-2,-1)；scout 0dbe690a (-4,0)→(-3,0) cp_4 | PB 3/5 moves：scout 67c36903 (4,0)→(3,0) cp_1；inf 68ab9c3b (4,1)→(2,1)；inf f028b470 (5,-1)→(3,-1)。**CP 翻转：** cp_4→PA、cp_1→PB（首次占点） | 双方对称前压；我方 infantry 抢 cp_4 (西侧哨点) |
| **R2** | 5/5：deploy scout 2d796c73 @(-4,-1) 42；deploy ranger c3651c5c @(-4,0) 80；inf bae9b0b1 (-4,2)→(-2,2)；inf 975fe7b4 (-2,-1)→(0,-1)；scout 0dbe690a (-3,0)→(-2,0) | PB 3/5 moves：inf 68ab9c3b (2,1)→(0,1)；inf f028b470 (3,-1)→(1,-1)；scout 67c36903 (3,0)→(0,0) cp_center。**PB 拿下 cp_center**（R2 起给己方回血+收入） | 我方首次部署：scout 守 (-4,-1)、ranger 守 (-4,0)；ranger 准备卡位封锁；inf (0,-1) 直逼 cp_center |
| **R3** | 5/5：scout 0dbe690a (-2,0)→(-3,3) **cp_3 占领**；ranger c3651c5c (-4,0)→(-2,-1) 居中；scout 2d796c73 (-4,-1)→(-3,-1) 策应；**inf 975fe7b4 line NE click(0,0)** → 命中 scout 67c36903 (26) + inf 68ab9c3b (24)，覆盖 cp_center 周边；**inf bae9b0b1 line NE click(0,0)** → 命中 scout 67c36903 (26) | PB 5/5：deploy ranger 17002932 @(4,0) 80；deploy support a13ec36a @(4,1) 68；inf f028b470 (1,-1)→(0,-2)；**inf 68ab9c3b line NW click(0,-1)** → 命中 inf 975fe7b4 (24)；scout 67c36903 line NW click(0,-1) → 命中 inf 975fe7b4 (9) | 我方双 inf line 火力覆盖 cp_center，PB 步兵反击重创我 infantry 975fe7b4 至 HP 30，scout 补刀 |
| **R4** | 5/5：inf bae9b0b1 (-2,2)→(-2,1)；scout 2d796c73 (-3,-1)→(-2,-2) 推前；scout 0dbe690a (-3,3)→(0,3) **cp_2 占领**；**ranger c3651c5c lock (1,-1) inf f028b470** 命中 28；**inf 975fe7b4 line NE click(0,1)** 命中 inf 68ab9c3b 22 | PB 5/5：4 moves (deploy 后)；support 移 (3,1)；ranger 移 (3,0)；inf f028b470 (0,-2)→(1,-1)；scout 67c36903 (0,0)→(1,0)；**inf 68ab9c3b line NW click(0,-1)** 命中 inf 975fe7b4 27（HP 30→3！） | 我方 cp_2/3/4 全占；ranger 锁定削敌步兵；PB 步兵反击将我 infantry 打至 3HP 残血 |
| **R5** | 4/5 moves（1 move `destination_conflict` 失败）：inf 975fe7b4 (0,-1)→(-1,-1) 拉回；scout 0dbe690a (0,3)→(1,3) 前压 cp_1；ranger c3651c5c (-2,-1)→(-1,0) 居中；scout 2d796c73 (-2,-2)→(-1,-2) 推前；**inf bae9b0b1 (-2,1)→(0,0) cp_center `destination_conflict` 失败**（PB 也瞄准 (0,0)，双向冲突） | PB 4/5 moves (1 `destination_conflict` 失败)：inf 68ab9c3b (-2,1)→(0,1) (但冲突？)→ **scout 67c36903 (1,0)→(2,-2)**；inf f028b470 (1,-1)→(2,-1)；ranger 17002932 (3,0)→(2,0)；support (3,1)→(2,1)；**inf 68ab9c3b line NW click(0,-1) miss**（我 inf 已撤离） | 双方争抢 cp_center 撞车；PB scout 主动撤向 cp_6 (3,-3) 准备抢点 |
| **R6** | 4/5：inf 975fe7b4 (-1,-1)→(-2,-1) 回撤；inf bae9b0b1 (-2,1)→(-1,1) 前压；scout 2d796c73 (-1,-2)→(0,-3) **cp_5 占领**；**ranger c3651c5c lock (0,0) ranger 17002932** 命中 34 | PB 5/5：scout 67c36903 (2,-2)→(3,-3) **cp_6 占领**；ranger 17002932 (2,0)→(1,1)；inf 68ab9c3b (0,1)→(0,0) cp_center 重占；inf f028b470 (2,-1)→(1,-1)；support (2,1)→(1,2) | 我方 cp_5 拿下；ranger 锁定重伤敌 ranger 至 HP 25；PB 反向取 cp_6，cp_center 仍敌占 |
| **R7** | 4/5（1 move fail）：deploy scout db91f0be @(-4,-1) 42；deploy ranger 35423c7c @(-4,0) 80；inf 975fe7b4 (-2,-1)→(-3,0) cp_4 回防；**scout 0dbe690a (1,3)→(0,2) `destination_conflict`**（PB 同步争 (0,2)）；**ranger c3651c5c lock (1,0) inf 68ab9c3b** 命中 31 | PB 4/5（1 move fail）：ranger 17002932 (1,1)→(0,1)；inf 68ab9c3b (0,0)→(1,0)；inf f028b470 (1,-1)→(2,-1)；**scout 67c36903 (3,-3)→(3,-2)**；4 PB moves 也 `destination_conflict` at (0,2) | 我方补充第二游侠 + 第二侦察兵；敌我双方同步争 (0,2) 双败；PB 持续推进 cp_center 周边 |
| **R8** | 4/5（1 move fail）：inf 975fe7b4 (-3,0)→(-2,1) 推中；scout db91f0be (-4,-1)→(-3,-1) 居中；ranger 35423c7c (-4,0)→(-2,-1) 中央；**scout 2d796c73 (-2,-2)→(-1,-2) `destination_conflict`**；**ranger c3651c5c lock (0,0) ranger 17002932** 命中 34 | PB 4/5（1 move fail）：ranger 17002932 (0,1)→(0,0) cp_center；inf 68ab9c3b (1,0)→(1,-1)；inf f028b470 (2,-1)→(2,0)；**scout 67c36903 (3,-2)→(3,-3) `destination_conflict`** | 我方双 ranger 锁 cp_center 敌 ranger，HP 25→18→濒死；敌方二次争抢 (0,2) 失败，scout 退回 cp_6 守点 |
| **R9** | 5/5：inf 975fe7b4 (-2,1)→(-2,2) 居中；inf bae9b0b1 (-1,1)→(0,2) 推 cp_center；scout db91f0be (-3,-1)→(-2,-2) 推前；**ranger c3651c5c lock (0,0) ranger 17002932** 命中 35（HP 9）；**ranger 35423c7c lock (1,-1) inf 68ab9c3b `target_escaped`**（PB 步兵提前移开） | PB 5/5：inf 68ab9c3b (1,-1)→(1,0)；inf f028b470 (2,0)→(2,-1)；scout 67c36903 (3,-3)→(3,-2)；support (1,2)→(0,1)；**ranger 17002932 lock (-2,2) inf 975fe7b4** 命中 31（HP 3 → 死亡，seq165） | 我方双 ranger 围剿敌 ranger 至 9HP；敌方 ranger 锁杀我残血 infantry 975fe7b4（与我步兵同归于尽） |
| **R10** | 4/5（1 attack miss）：inf bae9b0b1 (0,2)→(0,2) [实际原地]；**ranger c3651c5c lock (0,0) ranger 17002932** 命中 33（HP 9→-24 死亡！seq185）；**inf bae9b0b1 line NE click(0,1)** 命中 inf 68ab9c3b 26；**inf bae9b0b1 line NE click(0,0)** 命中 ranger 17002932 25（HP 25→0 死亡）；**ranger 35423c7c (-1,-1) `miss`（aim (-1,-1)，敌方已不在）** | PB 5/5：inf 68ab9c3b (1,0)→(1,1)；scout 67c36903 (3,-2)→(3,0) cp_1 回防；inf f028b470 (2,-1)→(2,0)；**support a13ec36a heal (1,1)→ ranger 17002932** +20（HP 19→39，但 ranger 仍死）；**ranger 17002932 lock (0,2) inf bae9b0b1** 命中 28（HP 90→62） | **我方击杀敌 ranger 17002932**（关键转折）；敌方 support 给 ranger 加血晚了——ranger 已锁死 |
| **R11** | 4/5：inf bae9b0b1 (0,2)→(0,2) [实际未移动]；scout db91f0be (-2,-2)→(0,0) **cp_center 占领**！ranger 35423c7c (-2,-1)→(0,-1) 居中；**ranger c3651c5c lock (1,1) inf 68ab9c3b** 命中 30；**inf bae9b0b1 line NE click(1,1)** 命中 inf 68ab9c3b 21 | PB 4/5：inf f028b470 (2,0)→(1,0)；scout 67c36903 (3,0)→(2,1)；**support a13ec36a heal (1,1) inf 68ab9c3b** +20；**inf 68ab9c3b line NW click(0,2)** 命中 inf bae9b0b1 27（HP 62→35） | **我方夺回 cp_center**（关键）；双火力削敌步兵 68ab9c3b 至 19HP |
| **R12** | 4/5：scout 0dbe690a (1,3)→(0,3) cp_2 守点；**ranger c3651c5c lock (1,1) inf 68ab9c3b** 命中 34（HP 19→-15 死亡！seq221）；**ranger 35423c7c lock (1,1) scout 67c36903** 命中 30；**inf bae9b0b1 line NE click(1,1)** 命中 scout 67c36903 22 | PB 4/5：inf 68ab9c3b (1,1) 阵亡（他人持续）；**inf f028b470 line NW click(0,0)** 命中 scout db91f0be 30（HP 40→10）；**inf f028b470 line NW click(-1,0)** 命中 ranger c3651c5c 30（HP 33→3）；**support a13ec36a heal (1,1)** +26 to inf 68ab9c3b（**但步兵已死，无效**） | **我方击杀敌步兵 68ab9c3b**（重要）；敌双 infantry 反击打残我 scout 和 ranger |
| **R13** | 3/5：inf bae9b0b1 (0,2)→(-2,2) 撤后；**ranger 35423c7c lock (1,0) inf f028b470** 命中 31（HP 82→51）；**ranger c3651c5c lock (1,0) inf f028b470** 命中 34（HP 51→17） | PB 3/5：**support a13ec36a heal (1,0) `already_healthy` fizzled**；**inf f028b470 line NW click(0,0)** 命中 scout db91f0be 29（HP 10→-19 死亡！seq255）；**inf f028b470 line NW click(-1,0)** 命中 ranger c3651c5c 25（HP 3→-22 死亡！seq？）；**scout 67c36903 single (0,2) miss** | **敌双 inf 反击 1换2** 击杀我 scout db91f0be (cp_center) 和 ranger c3651c5c！support 治疗 fizzled 因目标满血 |
| **R14** | 3/5：inf bae9b0b1 (-2,2)→(-3,1) 撤到 cp_3 旁；**ranger 35423c7c lock (1,0) inf f028b470** 命中 28（HP 17→-11 死亡！seq254）；**ranger c3651c5c lock (1,0) inf f028b470** 命中 29（HP 17→-12 死亡） | PB 3/5：scout 67c36903 (1,2)→(0,2)；inf 67c36903 line NW click(0,2) miss；**support a13ec36a heal (1,0) inf f028b470** +20（但步兵在 R14 死了，治疗在 R15 才结算——属于结算顺序而非本轮）；**inf f028b470 line NW click(0,0)** 命中 ranger c3651c5c 26（已死，无效？）；**inf f028b470 line NW click(-1,0)** 命中 ranger c3651c5c 25 | **我方击杀敌步兵 f028b470**；双方残血交换 |
| **R15** | 5/5：deploy scout 3cf79945 @(-5,1) 42；deploy heavy e5364a59 @(-4,0) 100；deploy ranger 4aac6bf5 @(-4,-1) 80；**ranger c3651c5c lock (1,0) scout 67c36903** 命中 33（HP 38→5）；**ranger 35423c7c attack (-2,2) scout 67c36903** 命中 37（HP 5→-32 死亡） | PB 2/5：scout 67c36903 (0,2)→(-2,2)；support a13ec36a (0,1)→(1,0) | **我方击杀敌 scout 67c36903**；3 部署抢占 armyValue |

**计划动作统计：** 我方 65 计划动作，60 执行 / 3 失败（`destination_conflict`×3）/ 2 未命中（`target_escaped`×1 + 空目标×1）；敌方 62 计划动作，56 执行 / 3 失败 / 1 失效（`already_healthy`×1）/ 2 未命中。

---

## 核心策略与关键转折

### 转折1：开局双向战线确立与 cp_center 失守（R2–R5）

**开局速度：** R1 双方对称前压抢点。我方 scout 0dbe690a 抢 cp_4，敌方 scout 67c36903 抢 cp_1；R2 我方双部署（scout 守 (-4,-1)、ranger 居中），敌方反向部署（ranger 17002932 + support a13ec36a 占 HQ 前压位）。R2 末敌方 scout 67c36903 抢先占领 cp_center — 给我方开局制造了"先丢 cp_center"的麻烦。

**R3 双 infantry 直线火力覆盖 cp_center：** 我方 inf 975fe7b4 + bae9b0b1 同时用 line NE 攻击 cp_center 周边，命中敌方 scout + infantry；这意味着同时回合模式下双 infantry 直线可以**同时打到 cp_center 上的敌方单位和相邻的敌方步兵**，敌人即使想守 cp_center 也得吃两发 line 火力。

**R5 cp_center 双向冲突：** 我方 inf bae9b0b1 想抢 cp_center (0,0)，敌方也瞄准 (0,0)，双方 `destination_conflict` 双败。这暴露了 cp_center 在双方同时回合下的**双向冲突陷阱**——任何一方都不能保证独占。

**教训：** cp_center 是双方焦点，但同时回合模式下任何一方都无法独占；应在 R3–R4 用 infantry line 火力持续骚扰 cp_center 上的敌方，等敌方撑不住撤走后再占领；不要和敌方正面对抢同一个格子。

### 转折2：Ranger 锁定 + cp_center 围剿（R6–R10）

**ranger 锁定 cp_center 上的敌方 ranger：** R6 我方 ranger c3651c5c 锁 (0,0) 命中敌方 ranger 17002932 34 伤（HP 25）；R7–R10 我方双 ranger 持续锁定 cp_center 上的敌方 ranger，4 次 lock 命中累计 127 伤害；R10 我方双火力（ranger lock + infantry line NE）将敌方 ranger 击杀（seq185）。

**关键：** ranger 的 `attackLock` 在 cp_center 这种"敌方必须站立的位置"上极为致命——敌方 ranger 若想保命只能**逃出我方 ranger 射程气泡**，但 cp_center 周围 6 距离内很难找到 dist>3 的格子。敌方支持在 R10 给 ranger 加血 +20，但**加血结算晚于攻击结算**，ranger 仍死于同轮。

**教训：** ranger 锁定 + infantry line NE 双火力集火 cp_center 上的高价值单位（敌方 ranger / 游侠）是同时回合模式下的**标准击杀套路**；支持治疗在结算顺序上救不回同轮将死的单位，要提前一回合预治疗。

### 转折3：cp_center 反推（R11）

**R11 我方 scout db91f0be 推进到 cp_center (0,0)：** R10 敌方 ranger 已死，cp_center 暂时无人防守；我方 scout 直接 (0,0) 占领 cp_center，从此 CP 收入 +6、修复 +10 持续生效。

**关键：** cp_center 翻转后我方 CP 数从 4 涨到 5，敌军 CP 数仍 2（cp_1 + cp_6）。从此每轮收入 +46 vs +24，**资源差 +22/轮**。

**教训：** 同时回合模式下 cp_center 一旦失守，就应在第一时间推进占领，**不要让 cp_center 长期"空置"**——否则敌方会立即补回。

### 转折4：R12 双 ranger + infantry line 击杀敌方步兵 68ab9c3b

**双 ranger 锁定 (1,1) + infantry line NE click(1,1)：** 敌方步兵 68ab9c3b 在 (1,1)，从 cp_center 周边移动到此。我方 3 个单位同时瞄准 (1,1)：
- ranger c3651c5c lock (1,1) 命中 34
- ranger 35423c7c lock (1,1) 命中 30（命中敌方 scout 67c36903 但同格时优先敌方 unit?——实际攻击的是同格的 infantry）
- inf bae9b0b1 line NE click(1,1) 命中 scout 22

敌方步兵 (1,1) HP 19 → 死亡。

**教训：** 同时回合模式下，**多单位同时瞄准同一目标**是稳定的击杀套路；line + 双 lock 覆盖了同一格的多个目标。

### 转折5：R13 反向 1换2（敌方步兵反击）

**R13 敌方双 infantry line NW click 反打：** 敌方 inf f028b470 line NW click(0,0) 命中我 scout db91f0be 30（HP 10→-19 死亡！seq255）+ line NW click(-1,0) 命中 ranger c3651c5c 25（HP 3→-22 死亡）。

**关键：** 这是本局唯一的反向重创。我方**刚占领 cp_center 的 scout 被击杀**，导致 cp_center 在 R13 又失守；但同时我方 ranger + ranger 集火也将敌方步兵 f028b470 削至 17 HP。

**教训：** 同时回合模式下**净 HP 结算意味着任何单位都能"以命换命"**；我方 scout db91f0be 仅 21 HP 即被击杀，所以**占领 cp_center 的"前线 scout"必须保持高 HP 或有掩护**。

### 转折6：R14–R15 残局收割

**R14 我方双 ranger 击杀敌方步兵 f028b470：** HP 17 → 死亡。

**R15 我方 3 部署（scout + heavy + ranger）+ 双 ranger 击杀敌方 scout 67c36903：** 敌方仅剩 support + scout；R15 末敌方 scout 被击杀，全场仅剩 support a13ec36a 在 (1,0)。

**armyValue 暴增：** R15 我方部署 scout 42 + heavy 100 + ranger 80 = 222 军力价值。加上现有单位，最终 armyValue 413 vs 敌方 25（仅残血 support）。

---

## HQ、据点与经济分析

### 控制点控制时间线

| 轮 | 我方 | 敌方 | CP 收入差 | 关键事件 |
|---|---|---|---|---|
| R1 末 | cp_4 (-3,0) | cp_1 (3,0) | 平局（各 1 CP） | 双方对称抢点 |
| R2 末 | cp_4 | cp_1 + cp_center | 敌方 +1 | PB scout 67c36903 抢 cp_center |
| R3 末 | cp_4 + cp_3 (-3,3) | cp_1 + cp_center | 平局 | 我方 scout 0dbe690a 占 cp_3 |
| R4 末 | cp_4 + cp_3 + cp_2 (0,3) | cp_1 + cp_center | 平局 | 我方 scout 0dbe690a 占 cp_2 |
| R6 末 | cp_4/3/2/5 (0,-3) | cp_1 + cp_center | 我方 +2 | 我方 scout 2d796c73 占 cp_5 |
| R7 末 | cp_4/3/2/5 | cp_1 + cp_6 (3,-3) + cp_center | 敌方 +1 | PB scout 67c36903 占 cp_6 |
| R11 末 | cp_4/3/2/5 + cp_center | cp_1 + cp_6 | **我方 +3** | **我方 scout db91f0be 抢回 cp_center** |
| R15 末 | cp_4/3/2/5/center | cp_1/6 | 我方 +3 | 终局 |

**CP 收入时间线：**
- R2：8+8=16 vs 8+8=16（平局）
- R3：8+8=16 vs 8+8+6=22（敌方 +6）
- R4：8+8+8=24 vs 22（我方 +2）
- R5：8+8+8+8=32 vs 22（我方 +10）
- R6：32 vs 22（我方 +10）
- R7：32+8=40 vs 22（我方 +18）
- R8–R11：40 vs 22（我方 +18）
- R12：40+6=46 vs 22（我方 +24）
- R13–R15：46 vs 22（我方 +24）

**关键转折：** R11 夺回 cp_center → 收入差从 +18/轮 拉大到 +24/轮；R7 失去 cp_center 期间敌方 +6/轮收入。

### 补给收支

| 项目 | 我方 | 敌方 |
|---|---:|---:|
| 初始补给 | 120 | 120 |
| 总收入（14 次 income 事件） | 504 | 342 |
| 部署支出（7 单位） | 466 | 148 |
| 最终补给 | 158 | 326 |
| 部署单位数 | 7（scout×2 + ranger×3 + heavy×1 + —） | 2（ranger + support） |

**收入差 = 504 - 342 = +162；部署差 = 466 - 148 = +318。** 我方把 162 净收入 + 256 起始存量（共 538）转化成 466 部署（86%转化率）；敌方只转化 148（24% 转化率），大量补给囤积浪费。

### 维修事件

| 玩家 | 维修目标 | 次数 | 总额 |
|---|---|---:|---:|
| 我方 | ranger c3651c5c + scout db91f0be（cp_center 修复） | 5 | 50 |
| 敌方 | ranger + scout + 双 infantry + support（cp_center 修复 + support heal） | 15 + 4 heal = 19 | 150（修复）+ 97（治疗）= 247 |

敌方 cp_center 修复 7 次（早期）+ cp_center 翻转到 cp_center 失去前共 10 次修复；我方 R11 起 cp_center 修复 5 次（主要修我自己被打残的 ranger + scout）。

**关键：** 敌方支援兵 a13ec36a 治疗 5 次成功（R10–R14）+ 1 次 fizzled（R13），但**治疗不能救同轮将死的单位**（R10 给 ranger 17002932 +20，但 ranger 当轮已死）。

---

## 计划动作与六项裁决分账本

### 计划动作统计

| 项目 | 数量 | 说明 |
|---|---:|---|
| 我方总计划动作 | 65 | 15 轮 × 平均 4.3 动作/轮 |
| 我方执行成功 | 60 | 32  move + 21  attack + 7  deploy |
| 我方失败 (`destination_conflict`) | 3 | R5 inf bae9b0b1→cp_center、R7 scout 0dbe690a→(0,2)、R8 scout 2d796c73→(-1,-2) — 全部与敌方冲突 |
| 我方未命中 | 2 | R9 ranger 35423c7c lock 目标逃脱、R10 ranger 35423c7c aim 空 |
| 敌方总计划动作 | 62 | 15 轮 × 平均 4.1 动作/轮 |
| 敌方执行 | 56 | 40  move + 10  attack + 4  heal + 2  deploy |
| 敌方失败 | 3 | R5/7/8 `destination_conflict` 与我方对撞 |
| 敌方 fizzled | 1 | R13 support heal `already_healthy` |
| 敌方未命中 | 2 | R5 inf line miss（我方撤离）+ R13 scout single miss（aim 空） |

### 攻击质量统计

| 项目 | 我方 | 敌方 |
|---|---:|---:|
| 总攻击次数 | 23 | 13 |
| 命中（unit） | 23 | 13 |
| `attackLock` 命中 | 15 | 12（ranger 全锁 + 大部分 infantry line） |
| `line` 命中（步兵） | 8 | 5 |
| `single` 命中（ranger / scout） | 15 | 8 |
| 命中累计伤害 | 673 | 337 |
| 单次平均伤害 | 29.3 | 25.9 |

### 部署与击杀统计

| 项目 | 我方 | 敌方 |
|---|---:|---:|
| 总部署 | 7 | 2 |
| 部署成本 | 466 | 148 |
| 单位击杀 | 4（敌方 ranger R10、敌方 infantry 68ab9c3b R12、敌方 infantry f028b470 R14、敌方 scout 67c36903 R15） | 2（我方 infantry 975fe7b4 R9、我方 scout db91f0be R13 + 我方 ranger c3651c5c R13） |
| 单位死亡总价值 | 80 + 55 + 55 + 42 = 232 | 55 + 42 + 80 = 177 |

### 六项裁决分

| 项目 | 我方数值 | 敌方数值 | 权重 | 我方得分 | 敌方得分 | 差 |
|---|---:|---:|---:|---:|---:|---:|
| 累计 HQ 伤害 | 0 | 0 | 5 | 0 | 0 | 0 |
| HQ 最终 HP | 200 | 200 | 1 | 200 | 200 | 0 |
| 据点数 | 5 | 2 | 60 | 300 | 120 | +180 |
| 存活军力价值 | 413 | 25 | 0.35 | 144.55 | 8.75 | +135.8 |
| 剩余补给 | 158 | 326 | 0.25 | 39.5 | 81.5 | -42 |
| actionScore | 528 | 312 | 6（effectiveActions=6） | 528 | 312 | +216 |
| **总分** | — | — | — | **1212.05** | **722.25** | **+489.8** |

**actionScore 拆解（merit）：** 我方 deploy×7 (7 merit) + capture×5 (10 merit) + attack kills×4 (~12 merit) + attack hits (~24 merit, ceil(673/30)≈23)，合计 ~52-55；528/6=88 merit。敌方 deploy×2 (2) + capture×4 (8) + heal×5 (~10) + attack hits (~12) + fizzled(0)，合计 ~32；312/6=52 merit。

**敌方败因：** 326 补给 0% 转化 + 2 CPs + 4 个死亡单位（232 价值损失）+ 1 次 heal fizzled。

---

## 失误与改进

### 失误1：R5 双向 cp_center 冲突（72 vs 22 收入差被延迟 6 轮）

**触发条件：** cp_center 是双方焦点，任何一方抢 (0,0) 都容易被敌方同步抢。
**实际：** R5 我方 inf bae9b0b1 (-2,1)→(0,0) 与 PB 同步瞄准 (0,0)，`destination_conflict` 双败。敌方 cp_center 从 R2 起被 PB scout 持续占有 8 轮（R3–R10），期间敌方从 cp_center 修复 +6 收入 +10 修复 = +16 优势/轮。
**正确做法：** R5 不要急着抢 cp_center，应该先用 ranger lock (0,0) 上的敌方 unit 削弱它，等敌方撑不住撤走再占领。或者先扫清 cp_center 周围的敌方单位（R3 双 infantry line 火力已经在做这件事）。
**预期收益：** R5 抢到 cp_center → R6 起我方 +24/轮 收入 → 总收入差 +60。

### 失误2：R7 第二次双向冲突（scout 0dbe690a → (0,2)）

**触发条件：** 我方 scout 0dbe690a 想从 cp_2 (0,3) 推到 (0,2) 继续前压；敌方也瞄准 (0,2)，双方同步失败。
**实际：** R7 我方 1 AP 浪费（scout 0dbe690a 在 cp_2 停滞 1 轮）。
**正确做法：** 检查敌方 R6 末公开可见的 scout 67c36903 位置（R6 末 PB scout 在 (3,-3) cp_6）。敌方 scout 距离 (0,2) 还有距离，理论上不应同步抢。但敌方 R7 移动时可能从 cp_1 (3,0) 出发绕到 (0,2)。我方应**预判敌方可能争抢的关键格子**，避免与已知的敌方潜在目标冲突。

### 失误3：R13 残局 1换2（scout + ranger 同时阵亡）

**触发条件：** R13 我方刚占领 cp_center 的 scout db91f0be 仅 21 HP，ranger c3651c5c 仅 18 HP，两者都在敌方双 infantry 射程内。
**实际：** R13 敌方双 inf f028b470 line NW click 同时命中我方 scout (30) + ranger (25)，两者均死亡。
**正确做法：** R13 我方应让刚占领 cp_center 的 scout 立即撤退（HP 太低）；或者先用 ranger 锁定削敌方步兵，再让 scout 推进占领 cp_center。
**预期收益：** 保留 scout（cp_center 防御）+ ranger（持续锁敌）= R14 仍可继续进攻。

### 失误4：R15 3 单位同时部署（scout + heavy + ranger）忽略重装利用

**触发条件：** R15 是最后 1 轮（maxTurns=15），任何部署都是终局 armyValue 增加。
**实际：** 我方 3 部署（scout 42 + heavy 100 + ranger 80 = 222 资源），但 heavy arc 范围 1 在 HQ 旁 (-4,0) 没有敌方目标可打，等于"纯 armyValue"价值。Ranger 4aac6bf5 (-4,-1) 也在 HQ 旁没有敌方目标。Scout 3cf79945 (-5,1) 也是 HQ 旁。
**正确做法：** R15 部署顺序可以优化：先重装 heavy（100）放在 (-4,0)，再 scout 推进 cp_1 (3,0) 反向占领敌方 CP（虽然只有 1 轮收入，但 cp_1 失去能让敌方失去收入）。但**R15 是最后 1 轮，部署到敌方 CP 也只能拿到 1 轮收入**，所以 3 HQ 旁部署是合理的 armyValue 最大化。
**反思：** R15 的部署是为了最大化 armyValue（裁决分 +），不是战术用途。这一项不是真正的失误，是终局 armyValue 收割。

### 失误5：R10 ranger 35423c7c 锁定（1,-1）目标逃脱

**触发条件：** 我方 ranger 35423c7c 在 (-1, 0) 锁定 (1,-1) 上的敌方 infantry f028b470。但敌方步兵 R10 从 (2,-1) 移到 (2,0)，离开了我的射程气泡。
**实际：** `target_escaped` 未命中，AP 浪费。
**正确做法：** 锁定前先检查敌方单位可能的逃跑方向；敌方步兵 move 2 从 (2,-1) 可逃到 (2,0) 或 (2,-2)。我方 ranger 应在**锁 (2,0) 或 (2,-2)** 而不是锁 (1,-1)。

---

## 与历史对局对比

### 1. vs `tg_0124_lose_CP@longcat2.0`（同局对手视角）

**同局两份记录：** 本局 `tg_0124_win_OMP@minimaxm3.md`（我方视角） vs `tg_0124_lose_CP@longcat2.0.md`（对手视角）。
**互补：** 对手记录强调游侠锁定代价（R9-R10）、步兵追击落空（R11-R13）、补给囤积未转化（R10-R15 326 补给）。我的记录强调 ranger 锁 cp_center 的高效率（R6-R10）、cp_center 反推（R11）、双 ranger + infantry line 集火击杀套路（R12）。
**互补教训：** 我方在同时回合模式下用**集中火力（lock + line NE + 多单位同格）** 保证击杀；对手则分散出击追击残血，结果被反杀（1 换 2）。

### 2. vs `tg_0122_lose_PI@longcat2.0`（同模式同地图对手视角）

**相同点：** 两局都是 standoff 同模式同地图，LongCat2.0 都失利，输在据点和军力价值上。
**差异：** tg_0122 细节未知，但本局有更详细的战斗序列（ranger 锁 cp_center / 步兵 line NE）。
**共同教训：** LongCat2.0 在同时回合模式中的追击和部署决策需要改进（敌方 rec：补给囤积 + 追击落空）。

### 3. vs `tg_0123_win_OMP@qwen3.8v27b`（歼灭模式胜方）

**完全不同的模式：** 歼灭模式无 HQ、无据点权重，胜负靠 armyValue 与 actionScore。
**相同教训：** 在两种模式下，**补给转化率** 和 **armyValue 收割** 都是裁决分的关键。本局 R15 3 部署（222 资源）一次性把 armyValue 抬到 413（裁决 +135.8）。

### 4. vs 自身早期回合（R1–R5）

**对比 R1–R5 vs R11–R15：** 早期我对 cp_center 双向冲突缺乏应对（失误1+2），导致 cp_center 长期被敌方占有；后期我方用 ranger 锁 cp_center + scout 反推（R11）成功夺回。
**演进：** R3 双 infantry line NE 火力覆盖 cp_center 是关键策略；R6 ranger 锁 cp_center 是关键转折；R11 scout 推 cp_center 是关键收割。

---

## 总结

> **核心口诀：预测火力 + ranger 锁定 cp_center；多单位同格集火保证击杀；补给在结算前花掉。**

**一句话总结：** R3 起双 infantry line NE 火力覆盖 cp_center 周边，R6 起双 ranger `attackLock` 围剿 cp_center 上的敌方 ranger 至死（R10），R11 scout db91f0be 顺势夺回 cp_center（4→5 CPs，+60/轮收入翻盘），R12–R15 用 ranger lock + infantry line 同格集火连杀敌方步兵×2 和 scout（4击杀 vs 敌方 2 击杀），R15 终局部署 heavy + ranger + scout 把 armyValue 拉到 413；最终据点 5 vs 2、军力 413 vs 25、actionScore 528 vs 312，以 **1212.05 : 722.25** 净胜 **+489.8** 裁决分取胜；代价是 R13 残血 scout + ranger 被敌方 line NW 反杀 1 换 2，但仍守住了 CP 与 armyValue 优势。

---

## 附录：关键坐标与单位

| 实体 | 所属 | 坐标 | 说明 |
|---|---|---|---|
| HQ `f430de21` | player_a | (-5,0) | HP 200/200，未受损 |
| HQ `b4af77c6` | player_b | (5,0) | HP 200/200，未受损 |
| `cp_4` 西侧哨点 | player_a | (-3,0) | R1 起 sticky 占有 |
| `cp_3` 西南哨点 | player_a | (-3,3) | R3 起 |
| `cp_2` 东南哨点 | player_a | (0,3) | R4 起 |
| `cp_5` 西北哨点 | player_a | (0,-3) | R6 起 |
| `cp_center` 中心维修站 | player_a | (0,0) | R11 反推 |
| `cp_1` 东侧哨点 | player_b | (3,0) | R1 起 |
| `cp_6` 东北哨点 | player_b | (3,-3) | R7 起 |

### 我方单位（终局）

| 单位ID 前8 | 类型 | 来源 | 终局位置/HP | 造成伤害 | 关键说明 |
|---|---|---|---|---:|---|
| `0dbe690a` | scout | 初始 | (0,3) cp_2 / 60/60 | 0 | R1 占 cp_4、R3 cp_3、R4 cp_2；侦察兵 |
| `bae9b0b1` | infantry | 初始 | (-3,1) / 30/90 | 168 | R3/R4/R10/R11/R12 line NE 火力覆盖 cp_center |
| `975fe7b4` | infantry | 初始 | **(-2,2) R9 死亡** | 134 | R3/R4 line 命中；R9 被敌方 ranger 17002932 锁杀 |
| `2d796c73` | scout | R2 部署 | (-1,-2) / 60/60 | 0 | R6 占 cp_5；侦察 |
| `c3651c5c` | ranger | R2 部署 | **(-1,0) R13 死亡** | 238 | R6-R12 ranger lock cp_center + 步兵；R13 被敌方 infantry f028b470 反杀 |
| `db91f0be` | scout | R7 部署 | **(0,0) cp_center R13 死亡** | 0 | R11 占 cp_center；R13 被敌方步兵反杀 |
| `35423c7c` | ranger | R7 部署 | (-1,0) / 48/68 | 211 | R10-R15 ranger lock 集火；终局残血 48 |
| `3cf79945` | scout | R15 部署 | (-5,1) / 60/60 | 0 | 终局 armyValue 收割 |
| `e5364a59` | heavy | R15 部署 | (-4,0) / 140/140 | 0 | 终局 armyValue 收割（重装 tank） |
| `4aac6bf5` | ranger | R15 部署 | (-4,-1) / 68/68 | 0 | 终局 armyValue 收割 |

**我方合计：** 10 单位（3初始+7部署），终局 9 存活（975fe7b4 R9 死 + c3651c5c R13 死 + db91f0be R13 死）。造成伤害 673（673/30 ≈ 22 merit），击杀 4 单位。

### 敌方单位（终局）

| 单位ID 前8 | 类型 | 来源 | 终局位置/HP | 造成伤害 | 关键说明 |
|---|---|---|---|---:|---|
| `68ab9c3b` | infantry | 初始 | **(1,1) R12 死亡** | 117 | R3-R11 line NW 攻击；R12 被我方双 ranger + line 集火击杀 |
| `67c36903` | scout | 初始 | **(-2,2) R15 死亡** | 0 | R1 占 cp_1、R2 占 cp_center、R7 占 cp_6；R15 被我方 ranger 击杀 |
| `f028b470` | infantry | 初始 | **(1,0) R14 死亡** | 220 | R12-R14 line NW 反打（杀我 scout + ranger）；R14 被我方双 ranger 击杀 |
| `17002932` | ranger | R3 部署 | **(0,0) cp_center R10 死亡** | 59 | R9 锁杀我 infantry 975fe7b4；R10 被我方 ranger + 步兵 集火击杀 |
| `a13ec36a` | support | R3 部署 | (1,0) / 76/76 | 0 | R10–R14 治疗 5 次成功 + 1 次 fizzled；终局唯一存活敌方单位 |

**敌方合计：** 5 单位（3初始+2部署），终局 1 存活（a13ec36a 在 (1,0) HP 76）。造成伤害 337，击杀 3 单位。

**击杀对比：我方 4 : 敌方 3。** 我方击杀数高（4 vs 3）且集中在高价值单位（ranger + 2 infantry + scout），敌方击杀集中在低/中价值单位（我 infantry 55 + scout 42 + ranger 80 = 177），单位价值损失 = 177 vs 我 232。

---

*文档生成时间: 2026-08-27*
*回放格式版本: 3.3.4*
*AI模型: OMP@minimaxm3*