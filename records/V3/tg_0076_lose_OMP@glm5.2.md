# 战术游戏第2名复盘 — `player_b` 视角

**日期:** 2026-08-07
**游戏ID:** 122faef3-68aa-4721-affa-6316fb41fb04
**回放版本/地图:** 3.2.9 / `artillery-zone`（炮火禁区，半径6全平地六边形，127格，无 blocker/水域；歼灭模式，炮火按整轮收缩）
**玩家:** GLM5.2-OMP（OMP@glm5.2，Oh My Pi 客户端，模型 glm5.2）
**席位与出生:** `player_b`，行动顺序第 2（后手，`turnOrder: [player_a, player_b]`），出生 slot_west：步兵(-5,0)、步兵(-5,1)、重装(-4,-1)；初始据点 `cp_west`(-4,0)；无 HQ（歼灭模式）
**对手:** `player_a` = KimiK3-WB（WB@kimik3），行动顺序第 1（先手），出生 slot_east：步兵(5,0)、步兵(5,-1)、重装(4,1)；初始据点 `cp_east`(4,0)
**参战人数/最终名次:** 2 人 / 第 2 名
**结果:** ❌ 存活至第 12 整轮（轮数上限），裁决落后 164 分
**结束原因:** `turn_limit_score`（1010 vs 846，唯一最高分玩家 `player_a`）
**最终补给/HQ/总分:** 108 / 不适用（无 HQ） / 846 分

> 数据来源：本局完整事件流（250 条事件，实时 `GET /api/games/:id/events` 取证）+ 每轮我方席位回合开始时保存的状态快照。事件 seq 编号、伤害、补给均直接取自事件流。

---

## 最终排名摘要

| 名次 | 席位 | 玩家 | 状态 | 总分 | 与我方分差 | 决定性优势 |
|------|------|------|------|------|------------|------------|
| 1 | `player_a` | KimiK3-WB | 存活 | 1010 | +164 | 终局军力 200:128（×2=400:256），行动分 610:590；2 ranger 远程压制体系全程主宰交火 |
| **2** | **`player_b`** | **GLM5.2-OMP（我方）** | **存活** | **846** | **—** | 据点 5:5 持平、炮火仅承 50 伤（对方承 225 伤）；但核心单位（ranger/heavy/support）连续 5 轮被集火阵亡 |

> 六项裁决分（权重取本局 `config.balance.adjudicationWeights`：`enemyHqDamage` 0 / `ownHqHp` 0 / `controlPoint` 0 / `armyValue` 2 / `supplies` 0；`effectiveActions` 10）：
> - `player_a`：HQ伤害 0×0 + HQ HP 0×0 + 据点 5×0 + 军力 200×2 + 补给 105×0 + 行动分 610 = 0+0+0+400+0+610 = **1010**
> - `player_b`（我）：HQ伤害 0×0 + HQ HP 0×0 + 据点 5×0 + 军力 128×2 + 补给 108×0 + 行动分 590 = 0+0+0+256+0+590 = **846**
> 分差 164 = 军力差 (200−128)×2 + 行动分差 (610−590) = 144+20 = 164。HQ/CP/补给权重均为 0，不构成裁决分。

---

## 核心教训

### 致命错误：4-scout 部署体系军力值过低，核心战斗单位（ranger/heavy/support）连续 5 轮被集火阵亡，终局军力 128:200 输掉唯一有意义的赛道

本局 `artillery-zone` 歼灭模式下 `armyValue×2` 与 `actionScore`（merit×10）是唯二有效的裁决赛道。我方行动分 590:610 仅差 20 分，但军力 128:200 差 72 分（×2=144 分差），是败因的 87%。军力落后的根源是**部署阵容选择错误**：7 次部署中 4 次是侦察兵（cost 38×4=152），仅 1 ranger（72）+ 1 support（60）+ 1 infantry（45）；对手 7 次部署是 4 infantry（45×4）+ 2 ranger（72×2）+ 1 support（60），高成本战斗单位占比远高于我方。

关键事件链：
```text
第7轮 / player_a: 部署 ranger@(4,-1) 72 [seq124]；ranger+infantry 集火我 ranger 3e5e7b7a (13→0) [seq126/128] 击杀 [seq129]
第9轮 / player_a: ranger+infantry+infantry 三击集火我 heavy 44bda4ee (33→16→0) [seq165/166/168] 击杀 [seq169]
第10轮 / player_a: heavy+ranger+infantry 三击集火我 infantry 3426c3b2 (49→12→0) [seq189/190/191] 击杀 [seq192]
第11轮 / player_a: ranger+ranger 双击集火我 support b7049f0f (40→0) [seq212/213] 击杀 [seq214]
第12轮 / player_a: heavy 一击击杀我 scout afe35f2f (15→0) [seq233/234]
```
连续 5 轮（R7-R12）每轮阵亡 1 个核心单位，全部死于**敌方 2 ranger（attack 44, range 3）的远程集火**。我方 ranger 在 R7 被击杀后再无远程反制能力，只能用 scout（attack 16）和 infantry（attack 30）近战硬扛对方 ranger 的射程 3 白嫖。**这是 tg_0075（同图同模式败局）教训的完全重复：scout 流（65hp）无法对抗 ranger+heavy 体系。**

---

## 关键时间线

| 整轮/席位回合 | 我方补给(收入后) | 行动点 | 我的操作 | 对手响应 | 问题或收益 |
|---------------|------------------|--------|----------|----------|------------|
| 第1轮 / `player_a` | — | 4/4 | — | 部署 inf@(3,1) 45 [seq4]；inf(5,0)→(3,0) 🏴 `supply_east` [seq5/8]；inf(5,-1)→(3,-2)；heavy(4,1)→(2,2) | 对称开局 2:2 |
| 第1轮 / `player_b` | 45→57→19 | 4/4 | heavy(-4,-1)→(-2,-1)；inf(-5,0)→(-3,0) 🏴 `supply_west` [seq13/16]；inf(-5,1)→(-3,2)；部署 scout@(-3,-1) 38 [seq15] | — | ✅ 经济对称 2:2 |
| 第2轮 / `player_a` | — | 4/4 | — | inf(3,-2)→(3,-3) 🏴 `supply_northeast` [seq25]；inf(3,1)→(0,3) 🏴 `supply_southeast` [seq26]；heavy(2,2)→(1,1)；inf(3,0)→(1,0) | ⚠️ A 抢 4 点 |
| 第2轮 / `player_b` | 19→39→1 | 4/4 | scout(-3,-1)→(0,-3) 🏴 `supply_northwest` [seq34]；heavy(-2,-1)→(0,-1)；inf(-3,2)→(-3,3) 🏴 `supply_southwest` [seq35]；部署 scout@(-4,-1) 38 [seq33] | — | ✅ 4:4 对称，但补给见底 |
| 第3轮 / `player_a` | — | 4/4 | — | heavy(1,1)→(0,0) **攻击我 heavy 25伤** [seq41]；inf(1,0)→(1,-1) **攻击我 heavy 20伤** [seq43]；inf(3,-3)→(1,-3) **攻击我 scout 27伤(38→12)** [seq45]；部署 inf@(3,1) 45 [seq46] | ❌ 我 heavy 105HP、scout 12HP，两个单位残血 |
| 第3轮 / `player_b` | 1→37 | 4/4 | scout(-4,-1)→(-4,4) 🏴 `cp_southwest` [seq56]；scout(0,-3)→(0,-4) 🏴 `cp_northwest` [seq55]；inf(-3,0)→(-1,0) **攻击 A heavy 16伤(111)** [seq54]；heavy(0,-1) **攻击 A heavy 23伤(127)** [seq53] | — | ✅ 据点 6:4 暂时领先；⚠️ 但残血单位未撤离 |
| 第4轮 / `player_a` | — | 4/4 | — | inf(1,-3)→(0,-3) 🏴 `supply_northwest`（夺回）[seq67]；inf(0,-3) **攻击我 scout 26伤(12→0)** → **击杀！** [seq63/84]；heavy(0,0) **攻击我 heavy 28伤(77)** [seq64]；inf(1,-1) **攻击我 heavy 19伤(58)** [seq65]；部署 inf@(4,1) 45 [seq66] | ❌❌ 我 scout 阵亡（首个单位损失）；heavy 58HP |
| 第4轮 / `player_b` | 37→73→1 | 4/4 | inf(-1,0) **攻击 A heavy 19伤(92)** [seq71]；scout(0,-4)→(-2,-1) 撤离；**部署 ranger@(-2,0) 72** [seq73] **攻击 A heavy 29伤(63)** [seq74]；inf(-3,0)→(-1,1)；heavy(0,-1)→(-2,1) 撤退 | — | ✅ ranger 出场，但补给再次见底 |
| 第5轮 / `player_a`（炮火首缩 sr=5） | — | 4/4 | — | inf(1,-1)→(-1,-2) **攻击我 scout(0,-4) 24伤→击杀！** [seq83/84]；inf(0,-3)→(-1,-1) **攻击我 ranger 30伤(42)** [seq86]；heavy(0,0)→(2,0) 撤退；部署 inf@(4,-1) 45 [seq88] | ❌❌ 第二个 scout 阵亡；ranger 42HP |
| 第5轮 / `player_b` | 1→37 | 4/4 | ranger **攻击 A inf 38伤(62)** [seq92]；heavy(-2,1)→(-1,0)；inf(-1,1)→(0,-1) **攻击 A inf 27伤(35)** [seq95]；inf(-1,1) **攻击 A inf 25伤(10)** [seq96]；inf(-3,3)→(-1,1)；ranger(-2,0)→(-3,1) | — | ✅ 将 A inf 压至 10HP |
| 第6轮 / `player_a`（炮火预警 sr=5→7） | — | 4/4 | — | inf(-1,-1) **攻击我 heavy 19伤(39)** [seq104]；heavy(2,0)→(3,0) 撤退；inf(4,-1)→(2,-1) | ⚠️ heavy 39HP 危险 |
| 第6轮 / `player_b` | 37→73→13 | 4/4 | **部署 support@(-2,0) 60** [seq111]；inf(0,-1) **攻击 A inf(10) 19伤→击杀！** [seq112/113]；**support 治疗 heavy +23(39→62)** [seq114]；ranger(-3,1)→(-1,2) **攻击 A inf 34伤(66)** [seq116]；heavy(-1,0)→(-3,2) 撤退 | — | ✅ 击杀 A inf；heavy 回血；但补给紧张 |
| 第7轮 / `player_a`（炮火二缩 sr=4） | — | 4/4 | — | **部署 ranger@(4,-1) 72** [seq124]；inf(2,-1)→(0,1) **攻击我 ranger 29伤(13)** [seq126]；inf(0,3)→(0,2) **攻击我 ranger 25伤→击杀！** [seq128/129]；inf(4,1)→(2,1) | ❌❌❌ **我 ranger 阵亡（cost 72）**；失去唯一远程反制 |
| 第7轮 / `player_b` | 13→49→4 | 4/4 | inf(-1,1)→(0,0)；scout(-4,4)→(-2,2)；**部署 inf@(-2,-1) 45** [seq136]；inf(0,-1) **攻击 A inf 22伤(44)** [seq137]；inf(0,0) **攻击 A inf 23伤(21)** [seq138] | — | ⚠️ 将 A inf 压至 21HP，但失去 ranger 后火力骤降 |
| 第8轮 / `player_a`（炮火预警 sr=4→9） | — | 4/4 | — | ranger(4,-1)→(2,-1) **攻击我 inf 39伤(61)** [seq145]；**部署 support@(4,-1) 60** [seq146]；inf(1,-1) **攻击我 inf 23伤(38)** [seq147]；inf(0,1) **攻击我 inf 21伤(79)** [seq148] | ❌ A 双 ranger 体系成型；我 inf 38HP |
| 第8轮 / `player_b` | 4→40→2 | 4/4 | inf(0,0) **攻击 A inf(2) 19伤→击杀！** [seq153/177]；heavy(-3,2)→(-1,1)；support(-2,0)→(-1,0)；**support 治疗 inf +28(38→66)** [seq156]；部署 scout@(-3,-1) 38 [seq152] | — | ✅ 击杀 A inf（第 3 杀）；但补给见底 |
| 第9轮 / `player_a`（炮火三缩 sr=3） | — | 4/4 | — | ranger(2,-1) **攻击我 heavy 29伤(33)** [seq165]；inf(0,1) **攻击我 heavy 17伤(16)** [seq166]；inf(0,2)→(-1,2) **攻击我 heavy 20伤→击杀！** [seq168/169]；support 治疗 A heavy +22(63→85) [seq171] | ❌❌❌ **我 heavy 阵亡（cost 92，最大单位损失）** |
| 第9轮 / `player_b` | 2→38→0 | 4/4 | inf(0,0) **攻击 A inf(2) 23伤→击杀！** [seq176/177]；support 治疗 inf +26 [seq178]；inf(0,-1)→(1,-1) **攻击 A ranger 29伤(43)** [seq180]；**部署 scout@(-2,0) 38** [seq175] | — | ✅ 击杀 A inf（第 4 杀）；但 heavy 已失，军力崩盘 |
| 第10轮 / `player_a`（炮火预警 sr=3→11） | — | 4/4 | — | heavy(3,0)→(1,0) **攻击我 inf 30伤(49)** [seq189]；ranger(2,-1) **攻击我 inf 37伤(12)** [seq190]；inf(0,1) **攻击我 inf 23伤→击杀！** [seq191/192]；**部署 ranger@(2,0) 72** [seq193] | ❌❌ **我 inf 阵亡**；A 第二个 ranger 出场 |
| 第10轮 / `player_b` | 0→36 | 4/4 | inf(-2,-1)→(0,0) **攻击 A inf(1,0) 20伤(80)** [seq201]；inf(1,-1) **攻击 A ranger 24伤(19)** [seq198]；support(0,-1) **治疗 inf +8** [seq202]；scout(-3,-1)→(0,-2) 撤入安全区 | — | ⚠️ A ranger 仅 19HP，但下轮先手可能被治疗 |
| 第11轮 / `player_a`（炮火四缩 sr=2） | — | 4/4 | — | ranger(2,-1)→(1,-2) **攻击我 support 42伤(40)** [seq212]；ranger(2,0) **攻击我 support 40伤→击杀！** [seq213/214]；inf(0,1)→(-1,0)；inf(3,1)→(1,1) | ❌❌❌ **我 support 阵亡（cost 60）**；失去治疗能力 |
| 第11轮 / `player_b` | 36→72 | 4/4 | inf(1,-1) **攻击 A ranger(19) 30伤→击杀！** [seq220/221]；scout(-2,0) **攻击 A inf 11伤(69)** [seq222]；inf(0,0)→(0,1) **攻击 A inf 21伤(4)** [seq225]；scout(-2,2) **攻击 A inf 5伤(95)** [seq224] | — | ✅ 击杀 A ranger（第 5 杀）；但 support 已失 |
| 第12轮 / `player_a` | — | 4/4 | — | heavy(1,0)→(0,-1) **攻击我 scout 31伤→击杀！** [seq233/234]；ranger(2,0) **攻击我 inf 34伤(66)** [seq235]；inf(-1,0) **攻击我 scout 23伤(42)** [seq236]；inf(1,1) **攻击我 inf 23伤(77)** [seq237] | ❌ 第 6 个单位阵亡 |
| 第12轮 / `player_b` | 72→108 | 4/4 | scout(-2,0) **攻击 A inf 10伤(59)** [seq241]；scout(-2,2) **攻击 A inf 10伤(85)** [seq242]；inf(1,-1)→(2,-1) **攻击 A inf(4) 19伤→击杀！** [seq244/245]；inf(0,1) **攻击 A support(7) 23伤→击杀！** [seq246/247] | — | ✅ 最后 2 杀（第 6/7 杀）；但终局裁决已定 |

> 我方补给轨迹（收入后，逐轮与 income/deploy 事件对账吻合）：45 → 57 → 19 → 39 → 1 → 37 → 73 → 1 → 37 → 73 → 13 → 49 → 4 → 40 → 2 → 38 → 0 → 36 → 72 → 终局 108。
> 据点演变：R1 2:2 → R2 4:4 → R3 **6:4（我方峰值）** → R4 A 夺回 supply_northwest → **5:5 持平至终局**。
> 我方击杀 5 单位：A inf 8fd1bfe4(R6)、A inf d0e1f476(R9)、A ranger b33d0507(R11)、A inf 23dced65(R12)、A support 907227be(R12)；我方被击杀 6 单位：scout cec00b3f(R4)、scout cec00b3f(R5)、ranger 3e5e7b7a(R7)、heavy 44bda4ee(R9)、inf 3426c3b2(R10)、support b7049f0f(R11)、scout afe35f2f(R12)。炮火承伤：我方 50（仅 scout afe35f2f R9/R10 各 -25），对方 225（9 次命中分散在 3 个外圈单位）。

---

## 补给与分数账本

**实际情况:**
- 部署单位：7 个 = 侦察兵 4（38×4）+ 游侠 1（72）+ 支援 1（60）+ 步兵 1（45），实付 **329** 补给
  - 折扣：0 次（`controlPointTypes` 全类型 `deployDiscount: 0`，本图无折扣）
- 基础/据点收入：12 次 income 事件 = 12+20+36×10 = **392**（R1 12→R2 20→R3+ 每轮 36，5 据点 × 收入合计 28/轮 + 基础 8 = 36）
- 炮火承伤：50（仅 scout afe35f2f 在 R9/R10 各承 25，R12 被敌方 heavy 补刀阵亡）
- 最终六项裁决分：HQ伤害 **0**（权重0，不构成裁决分）、HQ HP **0**（权重0，不构成裁决分）、据点 **5**（权重0，不构成裁决分）、军力 **128**（×2=256）、补给 **108**（权重0，不构成裁决分）、actionScore **590**，总分 **846**
- 对账：45 + 392 − 329 = **108**（终局补给，与 `game_over` 一致）✓

**对手 `player_a` 账本（事件流）:**
- 部署单位：7 个 = 步兵 4（45×4）+ 游侠 2（72×2）+ 支援 1（60），实付 **384** 补给
- 收入（11 次 income）：20+36×2+44×8 = **444**；终局补给 **105**（对账 45+444−384=105 ✓）
- 军力 200：heavy(85/150→52) + inf×3(85+25+59→38+11+27) + ranger(72/72→72) = 52+38+11+27+72 = **200**；armyValue 按 `round(cost×hp/maxHp)` 计算，对方 5 个存活单位中 3 个满血/近满血
- 炮火承伤：225（9 次命中：infantry 23dced65 承 75、infantry 90d2b7ad 承 75、support 907227be 承 75；均为外圈距离 ≥3 的单位）
- actionScore 610 = merit 61 × 10（部署 7 + 占点 4×2 + 攻击 ~40 + 治疗 ~6 ≈ 61）

**正确策略估算（假设性，非事件事实）:**
- 若 R1-R2 的 2 次 scout 部署（76 补给）改为 1 ranger（72 补给），R7 ranger 被击杀后仍有第 2 个 ranger 反制对方双 ranger 体系，军力差可缩小约 72（ranger cost 72 vs scout cost 38×2=76），终局军力可能 200:200 持平，总分追平甚至反超。
- 若 R6 heavy 在 58HP 时撤退至 (-3,2) 后不返回前线，R9 不被三向集火击杀（cost 92），军力多保留 ~52 分（92×39/150 round=24，vs 0），军力差缩小 48 分。

---

## 经验教训

### ✅ 做得好的
1. **前期经济对称、据点一度领先**：R3 末据点 6:4 领先（占领 cp_northwest + cp_southwest 两个 forward_base），R4 被夺回 supply_northwest 后 5:5 持平至终局。开局 2 轮内占领 4 个 supply + 2 个 forward_base，经济收入与对手完全对称（392 vs 444，差额仅来自先手 R1 多 1 轮收入）。
2. **炮火规避优秀**：全程仅 1 个 scout 承受 50 点炮火伤害（R9/R10），对方承伤 225（9 次命中）。R9 炮火三缩 sr=3 前成功将 scout 从 (-3,-1) 撤至 (0,-2)，R11 四缩 sr=2 前所有单位已在距离 ≤2 内圈。**这是 tg_0075 败局中"未撤离炮区单位被持续磨血"教训的成功修正。**
3. **残血追杀纪律**：R6 将 A inf 8fd1bfe4 从 10HP 补刀击杀 [seq112/113]；R8 将 A inf d0e1f476 从 2HP 击杀 [seq153/177]；R11 将 A ranger b33d0507 从 19HP 击杀 [seq220/221]。5 次击杀中有 3 次是对残血单位的补刀。
4. **support 治疗体系有效**：R6 部署 support 后 4 次治疗（heavy +23、inf +28、inf +26、inf +8），累计回血 85 HP，在 R6-R10 维持了前线的持续作战能力。R8 的 support+infantry combo（治疗 28 + 补刀击杀）是全场最佳回合。

### ❌ 致命失误
1. **4-scout 部署体系军力值过低（决定性败因）**：7 次部署中 4 次是侦察兵（cost 38×4=152），仅 1 ranger + 1 support + 1 infantry。对手 7 次部署含 2 ranger（72×2=144）+ 4 infantry（45×4=180）+ 1 support（60），高成本战斗单位占比远高。`armyValue×2` 权重下，同补给买 ranger（72）比买 2 scout（76）军力分更高且攻击力翻倍（44 vs 16×2=32）+ 射程 3 vs 1。**终局军力 128:200，×2=256:400，144 分差占总分差 164 的 87%。这是 tg_0075 败局"scout 流硬扛 ranger 体系"教训的完全重复。**
2. **ranger 被集火阵亡后无远程反制（R7 转折点）**：我方唯一 ranger（3e5e7b7a，cost 72）在 R5 被打至 42HP，R7 被 A inf+inf 双击 54 伤击杀 [seq126/128]。此后对方 2 ranger（attack 44, range 3）全程白嫖我方近战单位——R8 打我 inf 62 伤、R9 打我 heavy 46 伤、R10 打我 inf 37 伤、R11 打我 support 82 伤。**失去 ranger 后我方 attack 最高的单位是 infantry（30, range 1），完全无法反制射程 3 的 ranger。**
3. **heavy 在前线暴露过久被三向集火（R9 阵亡）**：heavy 44bda4ee（cost 92，最高价值单位）R3 被打至 105HP→R4 被打至 58HP→R6 治疗回 62HP→R9 被三击 66 伤击杀。R4 撤退至 (-2,1) 后 R6 又前推至 (-1,0)，在对方 heavy+ranger+infantry 三向射程内站了 2 整轮。**annihilation 模式下 heavy（cost 92）被击杀 = 92 军力净亏，相当于 2.4 个 scout 的价值。**
4. **R7 后补给见底无法补充 ranger**：R7 末补给仅 4，R8 末仅 2，R9 末 0——连续 3 轮无法部署高成本单位。根因是 R4 部署 ranger 花光 72 补给后，R5-R7 每轮仅收入 36 但 R6 部署 support 60、R7 部署 infantry 45，补给链断裂。**应在 R4 部署 ranger 后 R5-R6 停止部署 1 轮攒补给，确保 R7 能出第 2 个 ranger。**
5. **终局 R11-R12 部署源被炮火冻结**：R11 炮火四缩 sr=2 后，所有 supply 据点（距离 3）和部分 forward_base（距离 4）进入 danger zone，无法部署。R11-R12 各有 72/108 补给但无法转化为军力。**应在 R9-R10 炮火三缩前将部署重心转移至内圈 forward_base（cp_west 距离 4，R9 仍安全），而非继续从 supply_west（距离 3，R9 进入 danger）部署。**

### 🔑 核心教训
> **"artillery-zone 歼灭模式 2 人局：armyValue×2 是唯一裁决赛道，部署阵容必须以 ranger（72/44攻/射程3）为核心而非 scout（38/16攻/射程1）；ranger 被击杀后必须立即补充第 2 个 ranger，否则对方 ranger 全程白嫖近战单位；heavy（cost 92）在前线最多站 1 整轮，第 2 轮必须撤退——连续 5 轮阵亡核心单位等于把军力分拱手让人。"**

---

## 与历史对局的共同教训

1. **对照 `tg_0075_lose_OMP@minimaxm3.md`（同图 artillery-zone、同模式 annihilation、同座 player_b 后手、同结局 turn_limit_score 第2名）**：tg_0075 败因是"heavy 站 center 3 整轮被三向集火蒸发 + scout 流硬扛 heavy+ranger 体系 + R8-R10 连续 0 deploy"。本局 heavy 同样在 R9 被三向集火击杀（虽只站 2 轮而非 3 轮），同样以 4 scout 部署对抗对方 ranger 体系。**"artillery-zone 歼灭模式 scout 流必败"连续第二局验证（tg_0075/本局），核心机制是 scout attack 16 无法穿透 ranger 的射程 3 白嫖。**
2. **对照 `tg_0075_win_OMP@Dsv4Flash0731.md`（同图胜方复盘）**：胜方 Dsv4Flash0731 的核心策略是"6 次部署全部 72-92 cost 高价值单位（ranger×2 + heavy + infantry×3），收入即军力"。本局我方 7 次部署中 4 次是 38 cost scout，部署总额 329 vs 对方 384，**军力转化效率天差地别——验证了 tg_0075 胜方"annihilation 不囤积、全部转高 cost 军力"的铁律。**
3. **新发现（ranger 反制缺失的连锁效应）**：本局首次记录了"ranger 被击杀后无远程反制"的完整连锁——R7 ranger 阵亡后，R8-R11 连续 4 轮对方 2 ranger 累计造成 62+46+37+82=227 点伤害（占对方总输出的 60%+），我方 4 个单位（inf/heavy/inf/support）全部死于 ranger 参与的集火。**annihilation 模式下 ranger 是唯一射程 3 单位，失去 ranger = 失去交火主动权。**
4. **炮火规避的成功与局限**：本局炮火承伤 50 vs 对方 225，规避能力远优于 tg_0075（对方 9 次命中 vs 我方 2 次）。但炮火规避不能弥补军力差距——对方在炮火中损失 225 HP 仍以军力 200:128 获胜，证明**在 armyValue×2 权重下，部署阵容质量比炮火规避更重要**。

---

## 下次的正确策略

```text
第1轮 / player_b: heavy→(-2,-1) 推位；inf→supply_west 占领；inf→(-3,2) 南线；
  补给 45 → 部署 1 infantry 45（非 scout），保留 heavy+3inf+1新inf 的纯战斗阵容
第2轮 / player_b: scout→supply_northwest；scout→supply_southwest（用初始 0 部署的 scout 占点）；
  heavy→(0,-1) 中心；攒补给不部署（为 R3 ranger 储备）
第3轮 / player_b: 占 cp_northwest + cp_southwest（6:4 领先）；
  **部署 ranger 72**（从 supply_west，此时补给 ≈ 37+36=73，够出 ranger）；
  heavy 站中心仅 1 轮，R4 立即撤退
中盘触发条件:
  - 己方 ranger 被击杀 → 下轮必须部署第 2 个 ranger（优先级高于一切）
  - heavy HP < 60 → 立即撤退至己方半场，不再前推
  - 对方部署第 2 个 ranger → 我方必须同时维持 ≥1 ranger 在射程内反制
  - 炮火 sr=3（R9）→ 所有 supply 据点（距离 3）守军撤离，部署源转 cp_west（距离 4，R9 仍安全）
  - 补给 > 72 且有合法部署源 → 优先部署 ranger/heavy，绝不部署 scout（除非仅需占点）
终局检查: 存活资格（army > 0）、军力值 vs 对手（目标 ≥ 对手 80%）、ranger 存活数、
  炮火区单位待撤、补给是否可部署（R11+ 据点进 danger 后无法 deploy）
```

---

**一句话总结：在炮火禁区（artillery-zone）歼灭局中，我用 4-scout 部署体系（38×4=152 补给）对抗对方的 2-ranger+4-infantry 体系（384 补给），R7 唯一 ranger 被集火击杀后失去远程反制能力，R9 heavy（cost 92）被三向 66 伤击杀，R11 support 被双 ranger 82 伤击杀，连续 5 轮阵亡核心单位导致终局军力 128:200（×2=256:400），虽据点 5:5 持平、炮火仅承 50 伤、行动分 590:610 仅差 20，但军力差 144 分以 846:1010 落败——annihilation 模式的胜负不是炮火规避决定的，而是部署阵容的军力密度决定的。**
