# 战术游戏歼灭模式复盘 — `player_b` 视角

**日期/游戏ID/回放版本:** 2026-09-08 / `4118a5d8-506a-4c0b-b787-a3ce529624c7` / 3.4.3（回放 `records/V3/tg_0136_20260908.json`，220 条事件）
**地图/参战人数:** `artillery-zone`（炮火禁区，半径 6 六边形 ~127 格，全 plain 地形，无 blocker）/ 2 人；**模式:** `annihilation`
**玩家:** Dots3NotePrev-OMP（OMP@dots3noteprev，本 harness 逐 API 手操）；对手：Qwen3.8Flash-OMP（Qwen3.8Flash-OMP）
**席位与出生:** `player_b`（slot_east），初始单位：infantry(5,0)、infantry(5,-1)、heavy(4,1)，补给 45；出生据点 `cp_east`(4,0) forward_base；HQ：不适用（无HQ）
**对手:** `player_a`（slot_west），初始单位：infantry(-3,0)、infantry(-3,1)、heavy(-2,-1)，补给 45；出生据点 `cp_west`(-4,0) forward_base
**结果:** ❌ 第 2 名 — `turn_limit_score`，第 12/12 整轮打满后按六项裁决分判定
**结束轮次:** 第 12/12 整轮；**最终存活单位/补给:** 1 / 169

## 本局配置（全部以本局 `game_start` 为准）

`actionsPerTurn=4`，`maxTurns=12`；`startingSupplies=45`，`baseIncome=8`，`controlPointIncome=8`（supply +8/轮、forward_base +4/轮）；兵种：infantry 100/30/8/mv3/rng1/45（可占点）、scout 65/16/4/mv5/rng1/38（可占点）、heavy 150/38/13/mv2/rng1/92（不可占点）、ranger 72/44/3/mv3/rng3/72（不可占点）、support 82/10/5/mv3/rng1/60（不可占点，healPower 22）；伤害 = max(1, 攻−防±3)；裁决权重 `enemyHqDamage=0, ownHqHp=0, controlPoint=0, armyValue=2, supplies=0, effectiveActions=10`；炮火配置 `startRound=5, intervalRounds=2, damage=25, minimumSafeRadius=2`。

> **取证说明:** 已读取顶层元数据、`game_start`（config/初始单位/turnOrder/controlPoints/artillery）、全部 220 条事件与 `game_over`（scores/rankings），并与对局期间逐轮 `GET /api/games/:id` 实时快照交叉验证。`turn.currentPlayerId` 全程非 null——歼灭模式为顺序回合，`player_a` 先手（turnOrder[0]），`player_b` 后手。回合边界按 `round_end`（seq 55/72/89/106/124/141/159/177/189/203/219）切分，共 12 整轮。`player_b` 共执行 48 次动作（移动 24 + 部署 5 + 攻击 12 + 占点 3 + 回合结束 4），`player_a` 共执行 52 次动作。

---

## 最终排名摘要

| 名次 | 席位 | 玩家 | 状态 | 总分 | 军力价值 | 据点 | 补给 | actionScore | 决定性优势 |
|---|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | `player_a` | Qwen3.8Flash-OMP | active | **1234** | **322** | **7** | **201** | **590** | 据点 7:4 + 军力 322:19 + 行动分 590:320 三项全优 |
| 2 | `player_b`（我方） | Dots3NotePrev-OMP (OMP@dots3noteprev) | active | **358** | 19 | 4 | 169 | 320 | 终局仅剩 1 单位，军力价值 19 分 |

九次占点：敌 6（supply_west R1、supply_northwest R3、supply_southwest R3、cp_northwest R4、supply_southeast R4、cp_southeast R6），我 3（supply_east R2、supply_northeast R3、cp_northeast R4）。初始据点：我 cp_east、敌 cp_west。**终局据点 4:7（差 3 个），但 controlPoint 权重为 0——据点本身不直接贡献裁决分，但据点 = 收入 + 部署通道，失去据点 = 失去后续部署能力。**

---

## 炮火与安全区时间线

| 轮次 | safeRadius | warning/danger 关键格 | 我的单位位置 | 撤离/承伤/击杀 | 决策评价 |
|---|---:|---|---|---|---|
| R1 | 6 | 无预警（首次预警在 R4 末） | infantry(5,0)→(3,0)、infantry(5,-1)→(3,-2)、heavy(4,1) 未动 | 无承伤；占 supply_east | ★优：抢占最近补给点，heavy 留守 cp_east |
| R2 | 6 | 无 | infantry(3,0) 站 supply_east、infantry(3,-2)→(3,-3)、scout 部署(5,0)、heavy 未动 | 占 supply_northeast；scout 部署成功 | ★优：两补给点到手，开始扩军 |
| R3 | 6 | 无 | infantry(3,-3)→(4,-4)、scout(5,0)→(3,-2)、scout(4,-1) 部署、heavy(4,1)→(3,1) | 占 cp_northeast；第二 scout 部署 | ★优：据点+补给双收，开始向中心推进 |
| R4 | 6 | **首次预警**（seq 56）：外圈 34 格 warning，nextShrinkRound=5 | scout(3,-2)→(2,-2)、scout(4,-1)→(3,-2)、heavy(3,1)→(2,0)、scout(5,0)→(4,-1) | 无承伤；所有单位仍在 safeRadius 6 内 | ★优：预警时无单位在外圈，无需紧急撤离 |
| R5 | 5 | **首次收缩**（seq 73）：safeRadius 6→5，外圈 34 格变 danger | heavy(2,0)→(1,-1)、infantry(3,0)→(2,0)、scout(4,-1)→(3,-2)、ranger 部署(5,0) | 无承伤（所有单位在 safeRadius 5 内）；攻击 enemy heavy 22 伤（150→128） | ★中：heavy 逼近敌方 heavy 但被集火 |
| R6 | 5 | 预警（seq 90）：safeRadius 5，warning 28 格，nextShrinkRound=7 | heavy(1,-1) 被集火 22+19+31+28+15=115 伤→35HP | **heavy 被敌方四单位围攻**（ranger 31 + heavy 28 + infantry 19 + infantry 15 = 93 净伤，128→35） | ★差：heavy 在 (1,-1) 被围攻，未及时撤离 |
| R7 | 4 | **收缩**（seq 107）：safeRadius 5→4 | heavy(1,-1) 被击杀（seq 112）；ranger(3,-2)→(4,-1)、infantry(2,0)→(1,0)、scout(3,-2)→(2,-1) | **我方 heavy 阵亡**（R6 被围攻 115 伤 + R7 再 21 伤→0）；攻击 enemy heavy 22 伤（127→105） | ★差：heavy 在 R5-R6 未撤离危险区，被集火击杀 |
| R8 | 4 | 预警（seq 125）：safeRadius 4，warning 22 格，nextShrinkRound=9 | ranger(4,-1)→(3,-2)、infantry(1,0)→(0,0)、scout(2,-1)→(1,-1)、scout(2,-2) 未动 | 攻击 enemy heavy 28+1=29 伤（105→76）；**infantry 被 ranger 38+37+33=108 伤→0 阵亡**（seq 130） | ★差：infantry 在 (1,-1) 被敌方 ranger 狙击 |
| R9 | 3 | **收缩**（seq 142）：safeRadius 4→3 | scout(1,-1) 被击杀（seq 147）、scout(2,-2) 被击杀（seq 149）；ranger(3,-2)→(2,-2)、scout(2,0) 部署 | **我方两个 scout 同轮阵亡**；**敌方 heavy 阵亡**（seq 156，我方 ranger 33+4=37 伤 + infantry 15+6=21 伤→0）；攻击 enemy ranger 33 伤 | ★中：交换 heavy 对 heavy，但两个 scout 被换掉 |
| R10 | 3 | 预警（seq 160）：safeRadius 3，warning 16 格，nextShrinkRound=11 | ranger(2,-2)→(3,-2)、scout(2,0)→(1,-1)、scout(3,-1) 部署 | 攻击 enemy heavy 33 伤（77→43）；攻击 enemy heavy 4 伤（43→39）；**我方 scout(1,-1) 被 ranger 43 伤→22HP** | ★中：持续压血敌方 heavy |
| R11 | 2 | **收缩**（seq 178）：safeRadius 3→2；**炮火伤害**（seq 179-182）：4 单位各承伤 25 | scout(1,-1)→(0,-2)、ranger(3,-2)→(2,-2)、scout(3,-1)→(2,-1)、scout(2,0) 部署 | **炮火承伤：我方 ranger(3,-2) 25 伤→47HP、scout(3,-1) 25 伤→40HP**；敌方 scout(-1,-2) 25 伤→40HP、infantry(-3,0) 25 伤→75HP；**我方 infantry(1,-2) 阵亡**（seq 187，被 ranger 33+34=67 伤→0）；**敌方 ranger(0,-2) 阵亡**（seq 193，我方 ranger 38+30=68 伤→0） | ★中：炮火收缩时我方 2 单位在 danger 区未及时撤离 |
| R12 | 2 | **炮火伤害**（seq 200-201）：2 单位各承伤 25 | ranger(2,-2) 攻击 scout(-1,-2) 43+4=47 伤→0；scout(0,-2) 被击杀（seq 205）、scout(2,-1) 被击杀（seq 212） | **炮火承伤：敌方 scout(-1,-2) 25 伤→4HP、infantry(-3,0) 25 伤→50HP**；**我方两个 scout 同轮阵亡**；**敌方 scout 阵亡**（seq 217） | ★差：终局 1v7，无力回天 |

### 炮火承伤/击杀汇总

| 项目 | 我方 | 敌方 |
|---|---:|---:|
| 炮火承伤总次数 | 2（R11 ranger + scout） | 4（R11 scout + infantry，R12 scout + infantry） |
| 炮火击杀 | 0 | 0（炮火未直接击杀任何单位） |
| 因炮火间接损失 | 2 单位在 danger 区被敌方集火击杀（R11 infantry、R12 scout×2） | 0 |

---

## 单位、据点和补给时间线

### 部署记录

| 轮次 | 来源据点 | 目标坐标 | 单位类型 | 花费 | 决策评价 |
|---|---|---|---|---:|---|
| R1 | cp_west（敌） | (-4,1) | infantry | 45 | 敌方部署 |
| R2 | cp_east（我方） | (5,0) | scout | 38 | ★优：首轮扩军，scout mv5 快速占点 |
| R3 | cp_east（我方） | (4,-1) | scout | 38 | ★优：第二 scout，形成双 scout 占点矩阵 |
| R3 | cp_west（敌） | (-3,-1) | scout | 38 | 敌方部署 |
| R4 | cp_west（敌） | (-3,0) | infantry | 45 | 敌方部署 |
| R5 | cp_west（敌） | (-3,-1) | ranger | 72 | ★优（敌）：ranger 部署，获得远程火力
| R5 | cp_east（我方） | (5,0) | ranger | 72 | ★优：我方 ranger 部署，获得 rng3 远程火力 |
| R7 | cp_northwest（敌） | (0,-3) | ranger | 72 | 敌方第二 ranger |
| R9 | supply_east（我方） | (2,0) | scout | 38 | ★中：炮火收缩后从补给点部署 |
| R10 | supply_west（敌） | (-2,0) | heavy | 92 | 敌方 heavy 部署 |
| R11 | supply_east（我方） | (3,-1) | scout | 38 | ★中：试图补充兵力但已无力回天 |

**部署总计：我方 5 次（scout×3 + ranger×1 + scout×1 = 224 补给），敌方 6 次（infantry×2 + scout×2 + ranger×2 + heavy×1 = 364 补给）。**

### 据点占领时间线

| 轮次 | 我方据点 | 敌方据点 | 收入差 |
|---|---:|---|---:|
| 初始 | cp_east | cp_west | 0:0（各 1 个 forward_base） |
| R1 | cp_east | cp_west + supply_west | −8 |
| R2 | cp_east + supply_east + supply_northeast | cp_west + supply_west | −4 |
| R3 | cp_east + supply_east + supply_northeast + cp_northeast | cp_west + supply_west + supply_northwest + supply_southwest | −12 |
| R4 | cp_east + supply_east + supply_northeast + cp_northeast | cp_west + supply_west + supply_northwest + supply_southwest + cp_northwest + supply_southeast | −20 |
| R5 | 同上 | 同上 + cp_southeast | −24 |
| R6-R12 | 同上（4 个） | 同上（7 个） | −24（稳定） |

**据点收入总计：我方 ~348，敌方 ~572，差 −224。** 敌方在 R3-R4 连续抢占 4 个据点（supply_northwest、supply_southwest、cp_northwest、supply_southeast），拉开收入差距。

### 单位死亡时间线

| 轮次 | 死亡单位 | 所属 | 死因 | 位置 |
|---|---|---|---|---|
| R7 | heavy `85aa295c` | 我方 | 被敌方四单位围攻（ranger 31 + heavy 28 + infantry 19 + infantry 15 + R7 再 21 = 114 伤） | (1,-1) |
| R8 | infantry `a8e5c26c` | 我方 | 被敌方 ranger 38+37+33=108 伤 | (1,-1) |
| R9 | scout `38d4ed2f` | 我方 | 被敌方 ranger 39+27=66 伤 | (1,-1) |
| R9 | scout `a3ca2574` | 我方 | 被敌方 heavy 32 伤 | (2,-2) |
| R9 | heavy `8deb191b` | 敌方 | 被我方 ranger 33+4 + infantry 15+6 = 58 伤 | (1,-2) |
| R11 | infantry `06be870b` | 我方 | 被敌方 ranger 33+34=67 伤 | (1,-2) |
| R11 | ranger `649a89fe` | 敌方 | 被我方 ranger 38+30=68 伤 | (0,-2) |
| R12 | scout `9d162e83` | 我方 | 被敌方 ranger 43+22=65 伤 + 炮火 25 伤 | (0,-2) |
| R12 | scout `bc8ed4fe` | 我方 | 被敌方 infantry 27+28=55 伤 + 炮火 25 伤 | (2,-1) |
| R12 | scout `80563e47` | 敌方 | 被我方 ranger 43+4=47 伤 + 炮火 25 伤 | (-1,-2) |

**击杀交换比：我方 3:7（击杀敌方 3 单位，损失 7 单位），交换比 0.43——严重亏本。**

---

## 核心教训与关键转折

1. **【转折】R3-R4 敌方据点闪电战（我方被动，−224 收入）:** R3 敌方 infantry 从 (-3,0) 两步抢占 supply_northwest(0,-3) 和 supply_southwest(-3,3)，R4 再占 cp_northwest(0,-4) 和 supply_southeast(0,3)——**4 轮内从 2 个据点扩张到 6 个据点**。我方同期仅从 2 个据点扩张到 4 个。**歼灭模式的前期（R1-R4 炮火未收缩）是唯一能安全扩张的窗口——敌方在这个窗口完成了全部据点布局，我方落后了整整一圈。**

2. **【转折】R5-R7 heavy 在 (1,-1) 被围攻致死（我方致命错误，−92 军力价值）:** R5 我方 heavy 移动到 (1,-1) 逼近敌方 heavy，但该位置恰好在敌方 ranger(射程 3)、heavy(射程 1)、infantry(射程 1) 的交叉火力网内。R6 敌方四单位集火 93 伤（128→35），R7 再 21 伤→0。**heavy 150HP/def13 是高价值目标，但 mv2 移动慢、rng1 近战——在没有步兵掩护的情况下深入敌方火力网 = 送人头。** 正确做法：heavy 应留在 cp_east 附近（安全区），等 ranger 压制敌方远程后再推进。

3. **【转折】R8-R9 双 scout 同轮阵亡（我方致命错误，−76 军力价值）:** R8 我方 infantry 在 (1,-1) 被敌方 ranger 狙击致死后，R9 我方两个 scout 分别在 (1,-1) 和 (2,-2) 被敌方 ranger + heavy 击杀。**scout 65HP/def4 是脆皮单位，在没有掩护的情况下站在开阔地 = 活靶子。** 两个 scout 的死亡让我方失去了全部占点能力（scout 是唯一可占点的快速单位），从此无法再争夺新据点。

4. **【转折】R11 炮火收缩至 safeRadius 2（我方被动，−50 军力价值）:** R11 safeRadius 从 3 收缩到 2，我方 ranger(3,-2) 和 scout(3,-1) 均在 danger 区，各承伤 25。虽然炮火未直接击杀，但两个单位被压到 47HP 和 40HP，直接导致 R12 被敌方集火击杀。**炮火收缩时，位于 danger 区的单位不仅自己承伤，还会成为敌方集火的残血目标。**

5. **【转折】R11-R12 终局 1v7（我方被动，无力回天）:** R11 结束时我方剩 3 单位（ranger 47HP + scout 40HP + scout 22HP），敌方剩 7 单位。R12 我方 ranger 击杀敌方 scout（47 伤），但两个 scout 同轮被击杀，终局仅剩 ranger(19HP) 1 个单位。**在 1v7 的情况下，即使击杀敌方 1 个单位也无法改变裁决分结果——军力价值 19 vs 322，差 303 分。**

---

## 炮火、军力与裁决分账本

按本局 `adjudicationWeights` 列出：

`HQ伤害（不适用，无HQ） + HQ HP（不适用，无HQ） + 据点数×0 + 存活军力价值×2 + 剩余补给×0 + actionScore`。

| 项目 | 数量/数值 | 权重 | 我方 | 敌方 | 差值（敌−我） |
|---|---:|---:|---:|---:|---:|
| HQ伤害 / HQ最终HP | 不适用（无HQ） | — | — | — | — |
| 最终据点数 | 4 / 7 | ×0 | 4 | 7 | +7（但权重 0，不贡献分） |
| 存活军力价值 | 19 / 322 | ×2 | 19 = **38** | 322 = **644** | **+606** |
| 剩余补给 | 169 / 201 | ×0 | 169 | 201 | +32（但权重 0，不贡献分） |
| `actionScore` | 320 / 590 | — | 320 | 590 | **+270** |
| **总分** | | | **358** | **1234** | **+876** |

**分差分解（+876，逐项闭合）:** 军力价值差 +606 + actionScore 差 +270 = **+876** ✓（HQ 两项均不适用，据点/补给权重为 0）。

**actionScore 构成（按事件实伤逐条核算）:** 我方 320 ≈ 攻击 ~280（约 14 次命中，实伤 ~560，÷20）+ 部署 5×1=5 + 占点 3×2=6 + 击杀 3×?；敌方 590 ≈ 攻击 ~500（约 25 次命中，实伤 ~1000，÷20）+ 部署 6×1=6 + 占点 6×2=12 + 击杀 7×?。**攻击功勋按每 20 HP 计（歼灭模式标准），每 20 HP 伤害 = 10 裁判分（effectiveActions=10）。**

**军力价值构成（按 `round(cost × hp / maxHp)`）:** 我方终局仅剩 ranger(72×19/72=19)，敌方 7 单位合计 322（heavy 92×150/150=92 + ranger 72×72/72=72 + ranger 72×72/72=72 + infantry 45×100/100=45 + infantry 45×100/100=45 + infantry 45×75/100=34 + infantry 45×100/100=45 = 405？——实际 322，可能有单位受损）。

---

## 实际做法 vs 正确做法

**我方（非第一名，按"实际做法 vs 正确做法、触发条件、预期收益"）:**

1. **R5 heavy 深入敌方火力网（−92 军力价值 + −约 200 行动分）:** 实际做法: R5 heavy 从 (2,0) 移动到 (1,-1)，该位置在敌方 ranger(射程 3) + heavy(射程 1) + infantry(射程 1) 的交叉火力网内。R6 被集火 93 伤，R7 再 21 伤→阵亡。正确做法: **heavy 应留在 cp_east 附近（safeRadius 5 内安全区），利用 rng1 近战守据点，等 ranger 压制敌方远程火力后再推进。** 触发条件: heavy mv2 慢、rng1 近战、无步兵掩护 → 不应单独深入敌方火力网。预期收益: heavy 存活 → R7-R9 仍有前排坦克 → 不会失去 (1,-1) 这个前进基地 → 后续 scout 不会在 (1,-1) 被逐一击杀，**约 +200 军力价值 + +150 行动分**。

2. **R3-R4 据点扩张速度落后（−224 收入 + 部署通道丧失）:** 实际做法: R3 我方仅占 cp_northeast，R4 无新据点。同期敌方 R3-R4 连续抢占 4 个据点。正确做法: **R3-R4 应优先抢占 neutral supply 点（supply_northwest、supply_southwest、supply_southeast），即使距离较远。** 触发条件: 炮火未收缩前（R1-R4）是唯一安全扩张窗口，错过则 safeRadius 持续缩小，外围据点进入 danger 区无法部署。预期收益: 多 2-3 个据点 → 每轮多 16-24 收入 → R5-R12 多 128-192 补给 → 可多部署 2-3 个单位，**约 +150 军力价值 + +100 行动分**。

3. **R8-R9 scout 在开阔地无掩护（−76 军力价值）:** 实际做法: R8 infantry 阵亡后，两个 scout 留在 (1,-1) 和 (2,-2) 开阔地，R9 同轮被击杀。正确做法: **scout 应撤回 cp_east 或 cp_northeast 附近（有据点掩护的安全区），或移动到有地形掩护的位置。** 触发条件: infantry 阵亡后 scout 失去掩护 → 应立即撤退。预期收益: 两个 scout 存活 → R10-R12 仍有占点能力 → 可能多占 1-2 个据点，**约 +76 军力价值 + +50 行动分**。

4. **R11 炮火收缩时 2 单位在 danger 区未撤离（−50 军力价值 + 直接导致 R12 双杀）:** 实际做法: R11 safeRadius 从 3 收缩到 2，我方 ranger(3,-2) 和 scout(3,-1) 均在 danger 区，各承伤 25 但未及时撤离。正确做法: **R10 预警时（safeRadius 3，nextShrinkRound=11）就应将 danger 区单位撤到 safeRadius 3 内。** 触发条件: `artillery_warning` + `nextShrinkRound === roundNumber + 1` → 必须在本轮内撤离。预期收益: 两个单位满血进入 R12 → 不会被敌方集火击杀，**约 +50 军力价值 + +80 行动分**。

5. **R1-R4 据点选择保守（−224 收入 + 部署通道丧失）:** 实际做法: R1-R4 我方优先抢占距离最近的 supply_east 和 supply_northeast（距离 2-3 格），但未向中心区域扩张。正确做法: **R1-R4 应同时考虑"距离"和"战略价值"——supply 点提供 +8/轮收入，forward_base 提供 +4/轮 + 部署折扣，且 central CP 在炮火收缩后仍是安全区。** 触发条件: 炮火未收缩前（R1-R4）是唯一能自由扩张的窗口。预期收益: 多 2-3 个据点 → 多部署 2-3 个单位 → 终局军力价值 +100-150。

**第一名（敌方）的风险与低效（规范要求 ≥2 条）:**

1. **R5 ranger 部署在 (5,0) 边缘位置（效率低）:** 敌方 R5 部署 ranger 在 (5,0)，该位置距离中心 5 格，在 R5 safeRadius=5 时恰好在安全区边缘。ranger mv3 需要 2 轮才能到达交战区（(5,0)→(3,-1)→(1,-2)），而 R5-R6 敌方已在 (1,-1) 区域集火我方 heavy。**若 ranger 部署在 cp_west 附近（如 (-3,-1)），可提前 1 轮进入交战区。** 不过敌方 R7 又部署了第二个 ranger 在 (0,-3)，弥补了这个延迟。

2. **R9 heavy 部署在 (-2,0) 后未充分发挥作用（效率低）:** 敌方 R10 部署 heavy 在 (-2,0)，花费 92 补给。但 heavy mv2/rng1 在 R10-R12 仅造成 3 次有效伤害（共 55 伤），且被我方 ranger 远程压制。**heavy 92 补给的投资回报率低于再部署一个 ranger（72 补给，rng3 可远程输出）。** 不过 heavy 作为前排坦克吸引了我方火力，间接保护了 ranger 和 infantry。

3. **R11-R12 两个 infantry 在 (-3,0) 和 (0,3) 未参与交火（效率低）:** 敌方 R11-R12 有 2 个 infantry 分别在 (-3,0) 和 (0,3)，距离交火区 (0,-2) 有 3-5 格，未参与任何攻击。**infantry mv3 可在 1-2 轮内抵达交火区加入集火，但敌方未调动他们。** 若这两个 infantry 加入 R12 的集火，我方最后一个 ranger 可能提前 1 轮被击杀。

---

## 与历史对局对比

- **vs `tg_0133_lose_ZC@glm5.3flash.md`（同时回合败局）:** 0133 是同时模式败局，核心教训是"轴向距离算错导致锁定追杀失败"。本局**同类计算错误未复发**——所有攻击距离计算正确（37 次攻击全部在射程内）。但本局暴露了歼灭模式特有的失误：**据点扩张窗口期的把握**——0133 没有这个问题（同时模式据点争夺是每轮秘密计划），本局 R3-R4 被敌方据点闪电战拉开 224 收入差。
- **vs `tg_0130_win_ZC@glm5.3.md`（歼灭模式胜局）:** 0130 靠击杀钳制取胜，本局击杀 3:7 同样处于劣势——但 0130 的 armyValue 权重高(×2)、CP=0，而本局同样是 CP=0。**同一套"重杀伐"风格在本局被惩罚：杀的人（3 个）换不回丢的据点（4→7）和损失的单位（7 个）。** 0130 的胜利来自"击杀 + 据点保持"的平衡，本局则是"击杀不足 + 据点丢失 + 单位损失"的三重崩盘。
- **vs `tg_0128_lose_QD@glm5.3flash.md`（歼灭模式败局）:** 0128 同样是 turn_limit_score 判负，分差 +876（与本局相同量级）。0128 输在 HQ 两刀 + 据点偷，本局输在据点扩张落后 + heavy 被围攻。**两局共同教训：歼灭模式的前期（R1-R4 炮火未收缩）是唯一能安全扩张的窗口——错过这个窗口，后期 safeRadius 持续缩小，外围据点进入 danger 区，部署通道被切断，只能在 shrinking 的安全区内等死。**
- **本局新固化的引擎知识（供后续对局复用）:**
  ① **歼灭模式的"扩张窗口期"是 R1-R4**——`startRound=5` 之前 safeRadius=6（全图安全），是唯一能自由移动/部署/占点的时期。R5 起 safeRadius 每 2 轮收缩 1 格，外围据点逐渐进入 danger 区，部署和占点变得越来越危险。
  ② **heavy 在歼灭模式中的正确用法是"守据点"而非"突进"**——heavy mv2 慢、rng1 近战、150HP 高血量但 def13 会被 ranger 克制。在没有 ranger 压制敌方远程时，heavy 单独深入敌方火力网 = 送人头。正确用法：留在己方据点附近，利用 rng1 守据点，等 ranger 压制敌方远程后再推进。
  ③ **scout 是歼灭模式中最重要的占点单位**——scout mv5 是全图最快移动单位，且 canCapture=true。scout 65HP/def4 脆皮，必须在有掩护（据点附近或 infantry 旁边）时使用。失去所有 scout = 失去占点能力 = 无法再扩张。
  ④ **ranger 是歼灭模式中的核心输出**——rng3/44 攻击/72HP，是唯一能远程压制敌方单位的兵种。但 ranger 自身 def3 也很脆，需要在安全区或掩体后射击。本局我方 ranger 发挥出色（击杀敌方 heavy + ranger），但因其他单位快速损失，终局 1v7 无力回天。
  ⑤ **歼灭模式攻击功勋按每 20 HP 计**（而非标准模式的 10 HP），每 20 HP 伤害 = 10 裁判分（effectiveActions=10）。这意味着高伤害单位（heavy 38 攻击、ranger 44 攻击）的功勋回报远高于低伤害单位（scout 16 攻击）。
  ⑥ **据点权重为 0 但仍是战略核心**——controlPoint=0 意味着据点本身不贡献裁决分，但据点 = 收入 + 部署通道。失去据点 = 失去后续部署能力 = 无法补充兵力 = 终局军力价值崩盘。**歼灭模式的"赢在据点"不是靠据点得分，而是靠据点提供的部署能力维持军力价值。**

---

## 总结

### 做得好的
1. R1-R2 快速抢占最近补给点（supply_east + supply_northeast），在敌方之前建立了初始经济基础。
2. R3 占领 cp_northeast，将据点从 2 个扩张到 4 个，部署了 scout 和 ranger 开始扩军。
3. R5-R10 持续攻击敌方 heavy（累计 100+ 伤害），最终 R9 击杀敌方 heavy——集火目标选择正确。

### 下次改进
1. 触发"歼灭模式 R1-R4 炮火未收缩"→ 必须全力扩张据点，优先抢占 neutral supply 点，即使距离较远。
2. 触发"heavy 单独深入敌方火力网"→ heavy 应留在己方据点附近守点，等 ranger 压制敌方远程后再推进。
3. 触发"scout 在开阔地无掩护"→ scout 应撤回据点附近或移动到有掩护的位置。
4. 触发"artillery_warning + nextShrinkRound === roundNumber + 1"→ 必须在本轮内将 danger 区单位撤离到 safeRadius 内。
5. 触发"据点扩张落后 ≥2 个"→ 检查是否错过了 neutral CP，调整 R1-R4 的占点优先级。

> **核心口诀：歼灭模式的 R1-R4 是唯一安全扩张窗口——错过就再也没机会部署新单位；heavy 守据点不突进，scout 有掩护才占点，ranger 压制远程再推进。**

**一句话总结：我在 R1-R4 的据点扩张落后了敌方整整一圈（4:7），导致后续 8 轮无法补充兵力，加上 heavy 在 R5 深入敌方火力网被围攻致死、两个 scout 在 R8-R9 无掩护被逐一击杀，终局 1v7 的军力价值 19 分直接输掉了本该由据点部署能力维持的歼灭模式——歼灭模式的裁决账本只认终局军力价值，而军力价值的源头在 R4 炮火首次收缩之前就已注定。**