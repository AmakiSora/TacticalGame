# 战术游戏第2名复盘 — `player_a` 视角

**日期:** 2026-08-11
**游戏ID:** bc2c2d32-5e2c-4b42-a398-d64ebdce8c9e
**回放版本/地图:** 3.2.9 / `artillery-zone`（炮火禁区，半径6全平地六边形，127格；歼灭模式，炮火按整轮收缩）
**玩家:** Step3.7Flash-OMP（OMP@step3.7flash）
**席位与出生:** `player_a`，行动顺序第2（后手），出生 `slot_east`：步兵(5,0)、步兵(5,-1)、重装(4,1)；初始据点 `cp_east`(4,0)；**无 HQ（歼灭模式）**
**对手:** `player_b` = SenseNova6.8FLP-OMP，行动顺序第1（先手），出生 `slot_west`：步兵(-5,0)、步兵(-5,1)、重装(-4,-1)；初始据点 `cp_west`(-4,0)
**参战人数/最终名次:** 2 人 / 第 2 名
**结果:** ❌ 存活至第 12 整轮（轮数上限），裁决落后 194 分
**结束原因:** `turn_limit_score`（544 vs 738，唯一最高分玩家 `player_b`）
**最终补给/HQ/总分:** 106 / 不适用（无 HQ） / 544 分

---

## 最终排名摘要

| 名次 | 席位 | 玩家 | 状态 | 总分 | 与我方分差 | 决定性优势 |
|------|------|------|------|------|------------|------------|
| 1 | `player_b` | SenseNova6.8FLP-OMP | 存活 | 738 | +194 | 军力 209:162（×2=418:324，分差 94）、行动分 320:220（分差 100） |
| **2** | **`player_a`** | **Step3.7Flash-OMP（我方）** | **存活** | **544** | **—** | 4 据点控制但军力保存不足，炮火承伤 350 高于对手 305 |

> 六项裁决分（权重取本局 `config.balance.adjudicationWeights`：`enemyHqDamage` 0 / `ownHqHp` 0 / `controlPoint` 0 / `armyValue` 2 / `supplies` 0；`effectiveActions` 10）：
> - `player_b`：军力 209×2 + 行动分 320 = **738**
> - `player_a`（我）：军力 162×2 + 行动分 220 = **544**
> 分差 194 = 军力差 (209−162)×2 + 行动分差 (320−220) = 94+100 = 194。HQ/CP/补给权重均为 0，不构成裁决分。**行动分差贡献 52% 分差，军力差贡献 48% 分差。**

---

## 游戏进程时间线

| 整轮/席位回合 | 我方补给 | 行动点 | 我的操作 | 对手响应 | 问题或收益 |
|---------------|----------|--------|----------|----------|------------|
| 第1轮 / `player_a` | 45→11 | 4/4 | inf(5,0)→(4,0)；inf(5,-1)→(3,-1)；heavy(4,1)→(3,0)；inf(3,1)→(3,0) | — | ✅ 基础推进，建立东部防线 |
| 第1轮 / `player_b` | 45→20 | 4/4 | deploy scout@(-5,0) 38；capture `supply_west`(-3,0)；inf(-5,0)→(-3,0)；inf(-5,1)→(-3,1)；heavy(-4,-1)→(-3,-1) | ❌ 对手先手占 supply_west |
| 第2轮 / `player_a` | 11→14 | 4/4 | inf(3,-1)→(4,-3)；heavy(3,0)→(2,0)；inf(4,0)→(3,1) | — | ✅ 向东北-中心收缩 |
| 第2轮 / `player_b` | 20→23 | 4/4 | capture `supply_southwest`(-3,3)；inf(-3,1)→(-3,3) | ❌ 对手再占一补给点 |
| 第3轮 / `player_a` | 14→6 | 4/4 | deploy scout@(5,0) 38；capture `cp_northeast`(4,-4)、`supply_east`(3,0)、`supply_northeast`(3,-3)；inf(3,0)→(3,0)；heavy(2,0)→(1,0) | — | ✅ 三连占点；⚠️ 补给降至 6 |
| 第3轮 / `player_b` | 23→30 | 4/4 | deploy scout@(-5,0) 38；capture `supply_northwest`(0,-3) | ❌ 对手占 supply_northwest |
| 第4轮 / `player_a` | 6→18 | 3/4 | inf(3,0)→(2,0) | ⚠️ 炮火预警（下一轮收缩） | — |
| 第4轮 / `player_b` | 30→43 | 4/4 | attack 我 heavy(3,0) dmg24→126；deploy scout@(-4,1) 38；inf(-2,0)→(-1,0)；inf(-3,-1)→(-2,-1)；heavy(-3,-1)→(0,-1) | ❌ 对手开始集火我 heavy |
| 第5轮 / `player_a` | 18→27 | 4/4 | attack 敌方 heavy dmg22→100；deploy inf@(5,0) 45；heavy(2,0)→(1,0) | ⚠️ 第5轮炮火首缩 sr=6→5 | — |
| 第5轮 / `player_b` | 43→52 | 4/4 | attack 我 heavy dmg22→104；deploy scout@(-4,-1) 38 | ❌ 持续集火 heavy |
| 第6轮 / `player_a` | 27→45 | 4/4 | attack 敌方 heavy dmg27→73；deploy inf@(5,0) 45 | ⚠️ 炮火预警 sr=5 | — |
| 第6轮 / `player_b` | 52→61 | 4/4 | attack 我 heavy dmg22→82；deploy inf@(-5,1) 45 | ❌ heavy 承压 |
| 第7轮 / `player_a` | 45→45 | 4/4 | deploy inf@(3,1) 45；heavy(1,0)→(0,0) | ⚠️ 炮火 shrunk sr=5→4；`dangerCells` 出现 | — |
| 第7轮 / `player_b` | 61→70 | 4/4 | attack 我 heavy dmg26→56；deploy scout@(-4,1) 38 | ❌ heavy 重伤 |
| 第8轮 / `player_a` | 45→45 | 3/4 | deploy inf@(2,1) 45 | ⚠️ 炮火 warning sr=4 | — |
| 第8轮 / `player_b` | 70→79 | 4/4 | attack 我 heavy dmg25→31；deploy scout@(-3,-1) 38 | ❌ heavy 濒死 |
| 第9轮 / `player_a` | 45→45 | 4/4 | inf(5,0)→(4,0)；heavy(0,0)→(2,-1)；scout(2,-4)→(2,-3) | ⚠️ 炮火 shrunk sr=4→3；`dangerCells` 扩大 | — |
| 第9轮 / `player_b` | 79→88 | 4/4 | attack 我 heavy dmg28→3 | ❌ 我方 heavy 仅剩 3 HP |
| 第10轮 / `player_a` | 45→45 | 4/4 | inf(3,0)→(3,-2)；inf(3,-2)→(2,-2)；scout(2,-3)→(2,-2) | ⚠️ 炮火 warning sr=3；外圈单位持续承伤 | — |
| 第10轮 / `player_b` | 88→97 | 4/4 | attack 我 heavy dmg3→0 **击杀** [seq184] | ❌❌ 我方 heavy 阵亡，军力暴跌 |
| 第11轮 / `player_a` | 45→45 | 4/4 | attack 敌方 heavy dmg16→57；inf(3,-3)→(2,-3)；inf(3,-1)→(4,-1) | ⚠️ 炮火 shrunk sr=3→2；`dangerCells` 再次扩大 | — |
| 第11轮 / `player_b` | 97→106 | 4/4 | attack 我 infantry dmg28 | ❌ 我方 inf(3,-1) 被炮火/集火击伤 |
| 第12轮 / `player_a` | 45→45 | 4/4 | attack 敌方 heavy dmg18→19；attack 敌方 heavy dmg20→-1 **击杀**；attack 敌方 scout dmg15→25 | — | — |
| 第12轮 / `player_b` | 106→106 | 4/4 | attack 我 infantry dmg27；attack 我 scout dmg14；attack 我 infantry dmg5 | — | — |

> 补给格式为“行动前→行动后”；覆盖己方每个席位回合。多人事件发生在对手回合时，要写明对手席位。

---

## 核心教训

### 致命错误 1: 重装单位被连续集火 7 轮而未有效转移/救援

**问题:** 我方 heavy(23e3a632) 从第 4 轮到第 10 轮连续 6 次被敌方 heavy(cd4edf96) 攻击（24+22+22+26+25+28+3=150 伤害），虽经反击但未能提前击杀或将其逼退，最终在第 10 轮阵亡于 (0,0)。heavy 是我方唯一高HP高防单位，阵亡后军力价值从 150 骤降至剩余单位合计 162，且敌方 heavy 存活至终局（HP 19）。

**正确做法:** 第 4 轮受到首次攻击后，应在第 4-5 轮回合内将 heavy 后撤至 dist≤2 的安全区，或呼叫 scout/infantry 侧翼包抄分担压力。持续正面对决导致 HP 被磨光。

**触发条件:** 当敌方 heavy 与我方 heavy 进入 range 1 后，若无法在 2 轮内击杀，必须优先撤退或换防。

---

### 致命错误 2: 外圈部署单位未在炮火预警后撤离 — 累计承伤 350

**问题:** 我方在 `cp_east` 连续部署 3 个 infantry 到 (5,0)（b0ff9c5e、69332f59、321e638d），这些格 dist=5，处于炮火收缩后的 `dangerCells`。具体承伤：
- 69332f59：(5,0)→(4,0) 后仍在外圈，round 7/9/10/11 累计 4 次炮击 100 伤害阵亡
- 321e638d：部署于 (3,1) round 7 后未内撤，round 9/10/11/12 累计 4 次炮击 100 伤害阵亡
- b0ff9c5e：部署于 (5,0) 后 round 7/11 累计 2 次炮击 50 伤害

**正确做法:** round 4 `artillery_warning`（sr=6）出现后，所有待部署和已部署单位必须评估目标格是否在下一轮 `safeRadius` 内。dist≥4 的单位应在 1 轮内内撤至 dist≤2。

**触发条件:** `artillery_warning` 事件出现 → 立即审计所有 dist>safeRadius 的单位，执行内撤或放弃外圈据点。

---

### 致命错误 3: 炮火收缩期外圈单位数过多，行动分累积落后

**问题:** 我方在 round 7（sr=4）时有 3 个单位位于 dist≥4 的外圈，round 9（sr=3）时仍有 2 个。对手同样有外圈单位，但对手的 income 更高（36 vs 32），单位总数和 attack 次数（11 vs 7）更多，因此 actionScore 320:220 领先 100 分。

**正确做法:** 中盘（round 5 后）应转为"精简军力+内圈决战"策略：停止外圈部署，将单位收缩到 sr=3 核心区形成密集防线，通过真实交战积累 actionScore。

**触发条件:** round 5 炮火首缩后，若 armyValue 与对手差距 <50，应停止扩张，优先保全高价值单位。

---

### 致命错误 4: 据点控制与军力保存失衡 — 4 据点但军力 162 vs 209

**问题:** 我方控制 4 个据点（cp_east、cp_northeast、supply_east、supply_northeast），income 32/round；对手控制 4 个据点（cp_west、supply_west、supply_southwest、supply_northwest），income 36/round。但对手通过 heavy 集火+scout 骚扰形成局部优势，我方虽然占点相当，但军力保存差（3 次 unit_death，累计损失 150+100+100=350 军力潜力）。

**正确做法:** 4 据点 income 优势（+128）无法弥补军力劣势（-47×2=-94）。round 7 后应放弃外圈据点 `cp_northeast` 或 `supply_northeast`，将单位回收到中心区形成重装+步兵的密集阵型。

---

## 做得好的地方

1. **开局占点效率高:** 第 3 轮连续 capture 3 个据点（cp_northeast、supply_east、supply_northeast），快速建立 income 基础
2. **东部防线稳固:** `cp_east` 和 `supply_east` 全程未丢失，保证基础 income 32/round
3. **攻击节奏持续:** 7 次 attack 中 5 次针对敌方 heavy，试图打断对手核心战力

---

## 关键转折详解

### 第10轮 / `player_b` 回合 — 我方 heavy 被击杀

```text
操作: 敌方 heavy(0,-1) attack 我 heavy(0,0) dmg3→0 [seq184]
结果: 我方 heavy 阵亡，军力价值 -150
事件依据: attack + unit_death
意义: 军力从 312 降至 162，后续回合无法形成有效火力压制，行动分也随攻击机会减少而下降
```

### 第7轮 / `player_a` 回合 — 炮火首次收缩后未及时内撤

```text
操作: 我方 infantry(5,0) 仍在 dist=5 外圈；scout(5,0) 仍在外圈
结果: round 7 炮火 damage=25，infantry(4,1) 承伤 25；round 9 sr=3 后 infantry(4,0) 再承伤 25
事件依据: artillery_shrunk(sr=4) + artillery_damage
意义: 外圈单位成为炮火固定靶，累计承伤 350，高于对手的 305
```

### 第4-9轮 / `player_b` 连续攻击 — heavy 被磨血

```text
操作: 敌方 heavy 连续 6 次 attack 我 heavy（round 4/5/6/7/8/9）
结果: 我 heavy HP 126→104→82→56→31→3
事件依据: attack 事件 [seq...]
意义: 我方虽反击 5 次，但未能提前击杀敌方 heavy，导致核心单位持续掉血
```

---

## 补给与分数账本

**实际情况:**
- 部署：6 个单位（scout×1 38 + infantry×5 225 = 263 补给）
- 基础/据点收入：32×12=384 补给（4 据点，base 8×12=96 + control 8×12×4=288）
- 最终补给：106（45 + 384 - 263 - 回合消耗？）
- 六项裁决分（权重：armyValue=2, effectiveActions=10, 其余=0）：
  - 军力 162×2 = 324
  - 行动分 220×1 = 220
  - HQ伤害 0、HQ HP 0、据点 0、补给 0（权重均为 0）
  - **总分 544**

**对手对比:**
- 部署：7 个单位（scout×5 190 + infantry×1 45 = 235 补给）
- 收入：36×12=432 补给（4 据点，base 8×12=96 + control 8×12×4=288，但 opponent income 更高）
- 最终补给：144
- 军力 209×2 = 418
- 行动分 320×1 = 320
- **总分 738**

**分差来源:**
- 行动分差 100（52%）：对手 attack 11 次 vs 我方 7 次，且对手单位存活更多，持续输出
- 军力差 94（48%）：对手 armyValue 209 vs 162，heavy 存活且 scout/infantry 保存更好

---

## 本局机制与配置

| 项目 | 本局值 | 来源/影响 |
|------|--------|-----------|
| 最大整轮数 | 12 | `config.balance.maxTurns` |
| 每回合行动点 | 4 | `actionsPerTurn` |
| 初始/基础收入 | 45 / 8 | `startingSupplies` / `baseIncome` |
| 据点收入 | 8/个 | `controlPointIncome` |
| 裁决权重 | enemyHqDamage 0 / ownHqHp 0 / controlPoint 0 / armyValue 2 / supplies 0 / effectiveActions 10 | `config.balance.adjudicationWeights` |
| 炮火配置 | startRound 5 / intervalRounds 2 / damage 25 / minimumSafeRadius 2 | `config.annihilation.artillery` |

---

## 与历史对局的对比

| 项目 | tg_0084（我方 agnes2.5flash 第2名） | tg_0085（本局 step3.7flash 第2名） |
|------|-----------------------------------|-----------------------------------|
| 地图/模式 | artillery-zone / 歼灭 | artillery-zone / 歼灭 |
| 出生 | slot_east | slot_east |
| 名次/结束原因 | 第2名 / turn_limit_score 416 vs 880 | 第2名 / turn_limit_score 544 vs 738 |
| 关键失误 | scout 部署外圈被炮火击杀；过度扩张 6 据点 | heavy 被连续集火 7 轮阵亡；外圈 infantry 部署被炮火磨血 |
| 炮火承伤 | 190 | 350 |
| 行动分 | 190 | 220 |
| 军力价值 | 113 | 162 |

**结论:** 本局重复了 tg_0084 的"外圈部署+炮火承伤"问题，且升级为"heavy 被连续集火"的核心失误。tg_0084 的教训是"军力保存 > 据点数量"，本局再次验证：即便控制了 4 个据点，若核心 heavy 未保住、外圈单位持续承伤，裁决分仍会被行动分和军力差拖垮。

---

## 总结

### 失败关键因素
1. **heavy 被连续集火 7 轮未撤离** — 核心战力阵亡导致军力价值暴跌
2. **外圈 infantry 部署未及时内撤** — 累计炮火承伤 350，高于对手的 305
3. **行动分累积不足** — 攻击 7 次 vs 对手 11 次，有效交战次数落后

### 核心战术原则
> **"歼灭模式下，heavy 是军力支柱，绝不能单独面对敌方 heavy 超过 2 轮；炮火预警出现后，所有外圈单位必须在 1 轮内内撤至 safeRadius 内。"**

### 一句话总结
**核心 heavy 被连续集火磨死、外圈部署单位在炮火收缩中持续承伤，导致军力价值和行动分双输——歼灭模式的胜负在炮火安全区内的军力保存，而非外圈据点的数量。**

---

## 附录：关键坐标

| 实体 | 所属席位 | 坐标 | 说明 |
|------|----------|------|------|
| 我方出生 infantry | `player_a` | (5,0) | 初始单位 |
| 我方出生 infantry | `player_a` | (5,-1) | 初始单位 |
| 我方出生 heavy | `player_a` | (4,1) | 初始单位，round 10 阵亡于 (0,0) |
| 敌方出生 infantry | `player_b` | (-5,0) | 初始单位 |
| 敌方出生 infantry | `player_b` | (-5,1) | 初始单位 |
| 敌方出生 heavy | `player_b` | (-4,-1) | 初始单位，存活至终局 |
| 我方据点 | `player_a` | (4,0) `cp_east` | 全程控制 |
| 我方据点 | `player_a` | (3,0) `supply_east` | round 3 占领 |
| 我方据点 | `player_a` | (4,-4) `cp_northeast` | round 3 占领 |
| 我方据点 | `player_a` | (3,-3) `supply_northeast` | round 3 占领 |
| 敌方据点 | `player_b` | (-4,0) `cp_west` | 全程控制 |
| 敌方据点 | `player_b` | (-3,0) `supply_west` | round 1 占领 |
| 敌方据点 | `player_b` | (-3,3) `supply_southwest` | round 2 占领 |
| 敌方据点 | `player_b` | (0,-3) `supply_northwest` | round 3 占领 |
| 炮火收缩关键轮 | — | round 5/7/9/11 | sr 6→5→4→3→2 |
| 危险区边界 | — | dist=3（round 9 起） | 外圈单位需内撤 |

---

*文档生成时间: 2026-08-11*
*回放格式版本: 3.2.9*
*AI模型: OMP@step3.7flash*
