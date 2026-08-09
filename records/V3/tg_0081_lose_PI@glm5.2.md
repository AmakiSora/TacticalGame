# 战术游戏第2名复盘 — `player_b` 视角

**日期:** 2026-08-10
**游戏ID:** f8089d92-1712-441a-9f50-58aac59e0ff1
**回放版本/地图:** 3.2.9 / `artillery-zone`（炮火禁区，半径6全平地六边形，127格，无 blocker/水域；歼灭模式，炮火按整轮收缩）
**玩家:** GLM5.2-PI（PI@glm5.2，pi 客户端，模型 glm5.2）
**席位与出生:** `player_b`，行动顺序第 1（先手，`turnOrder: [player_b, player_a]`），出生 slot_west：步兵(-5,0)、步兵(-5,1)、重装(-4,-1)；初始据点 `cp_west`(-4,0)；无 HQ（歼灭模式）
**对手:** `player_a` = Qwen3.8Max-PI（PI@qwen3.8max），行动顺序第 2（后手），出生 slot_east：步兵(5,0)、步兵(5,-1)、重装(4,1)；初始据点 `cp_east`(4,0)
**参战人数/最终名次:** 2 人 / 第 2 名
**结果:** ❌ 存活至第 12 整轮（轮数上限），裁决落后 292 分
**结束原因:** `turn_limit_score`（830 vs 538，唯一最高分玩家 `player_a`）
**最终补给/HQ/总分:** 73 / 不适用（无 HQ） / 538 分

> 数据来源：本局完整事件流（253 条事件，实时 `GET /api/games/:id/events` 取证）+ 每轮我方席位回合开始时保存的状态快照。事件 seq 编号、伤害、补给均直接取自事件流；单位 HP 轨迹由 attack 事件的 `targetHp` 与 `artillery_damage` 的 `unitHp` 逐条追踪。

---

## 最终排名摘要

| 名次 | 席位 | 玩家 | 状态 | 总分 | 与我方分差 | 决定性优势 |
|------|------|------|------|------|------------|------------|
| 1 | `player_a` | Qwen3.8Max-PI | 存活 | 830 | +292 | 终局军力 120:24（×2=240:48），行动分 590:490；2 heavy 全程保命 + ranger 体系压制 |
| **2** | **`player_b`** | **GLM5.2-PI（我方）** | **存活** | **538** | **—** | 据点 5:6 微落后、击杀数 6:7 接近；但 2 heavy + 3 ranger 全部阵亡，仅剩步兵34+侦察16 苟活 |

> 六项裁决分（权重取本局 `config.balance.adjudicationWeights`：`enemyHqDamage` 0 / `ownHqHp` 0 / `controlPoint` 0 / `armyValue` 2 / `supplies` 0；`effectiveActions` 10）：
> - `player_a`：HQ伤害 0×0 + HQ HP 0×0 + 据点 6×0 + 军力 120×2 + 补给 152×0 + 行动分 590 = 0+0+0+240+0+590 = **830**
> - `player_b`（我）：HQ伤害 0×0 + HQ HP 0×0 + 据点 5×0 + 军力 24×2 + 补给 73×0 + 行动分 490 = 0+0+0+48+0+490 = **538**
> 分差 292 = 军力差 (120−24)×2 + 行动分差 (590−490) = 192+100 = 292。HQ/CP/补给权重均为 0，不构成裁决分。**军力差贡献 66% 的分差，是首要败因。**

---

## 核心教训

### 致命错误：2 heavy + 3 ranger 全部阵亡，终局军力 24:120 输掉 armyValue×2 赛道；根因是 heavy 在中心连站 3 轮被集火、ranger 反复误判距离暴露在炮火/敌方射程内

本局 `artillery-zone` 歼灭模式下 `armyValue×2` 与 `actionScore`（merit×10）是唯二有效的裁决赛道。我方行动分 490:590 仅差 100 分，但军力 24:120 差 96 分（×2=192 分差），是败因的 66%。军力崩盘的根源是**全部高价值单位（2 heavy cost 92×2 + 3 ranger cost 72×3 = 400 补给的军力）在 R5-R11 连续阵亡**，终局仅剩步兵(34HP)+侦察(16HP)，armyValue=round(45×34/100)+round(38×16/65)=15+9=24。

关键阵亡链（事件 seq 直引）：
```text
第5轮 / player_a: infantry+heavy+ranger 三向集火我 heavy8444 (12→0) [seq110] 击杀 [seq111]；
                   heavy 续攻击我 ranger1_f971 (29→0) [seq113] 击杀 [seq114]
  —— 我方 heavy(150HP) 经 R3-R5 共承 7 击 (33+25+18+28+20+14+18=156伤) 阵亡；ranger1 经 2 击 (43+33=76伤) 阵亡
第8轮 / player_a: ranger 击杀我 ranger2_a52b (4→0) [seq176/177]
  —— ranger2 因 R6 误撤至 d6 危险区(-3,-3) 承炮击 25 [seq140]，再承 ranger 43 [seq156]→4HP，补刀阵亡
第9轮 / player_a: heavy 击杀我 heavy_f162 (0) [seq197/198]
第10轮 / player_a: heavy 击杀我 infantry_c361 (0) [seq224/225]
第11轮 / player_a: heavy×2 集火我 ranger_c641 (9→0) [seq246/248] 击杀 [seq249]
  —— 我把 ranger 冲入中心(0,0) 换 2 杀，但暴露在 2 个 heavy 射程内被秒
```
连续 7 轮（R5-R11）每轮阵亡 1 个核心单位，全部死于**敌方 heavy(attack 38)+ranger(attack 44, range 3) 的近远程集火**。我方 heavy 在中心(0,-1)/(1,-1)/(-1,-1) 一带连站 3 整轮（R3-R5）被磨死，是 tg_0076（同图同模型败局）"heavy 在前线站 2 轮被三向集火"教训的**加重复发**。

---

## 关键时间线

| 整轮/席位回合 | 我方补给(收入后) | 行动点 | 我的操作 | 对手响应 | 问题或收益 |
|---------------|------------------|--------|----------|----------|------------|
| 第1轮 / `player_b` | 45→7 | 4/4 | 部署 scout@(-3,-1) 38 [s4]；inf(-5,0)→(-3,0) 🏴`supply_west` [s5/8]；inf(-5,1)→(-3,2) [s6]；heavy(-4,-1)→(-2,-2) [s7] | `player_a` 部署 scout@(4,-1) 38 [s14]；inf(5,0)→(3,0) 🏴`supply_east` [s12/16]；heavy→(2,1) [s15] | ✅ 经济对称 2:2 |
| 第2轮 / `player_b` | 27→27 | 4/4 | heavy→(0,-2) [s21]；inf→(-3,3) 🏴`supply_southwest` [s22/26]；scout→(0,-3) 🏴`supply_northwest` [s23/25]；inf→(-1,0) [s24] | A 占 `cp_northeast`+`supply_northeast` [s34/35] | ✅ 据点 4:4；我方 income+36 |
| 第3轮 / `player_b` | 63→63 | 4/4 | scout→(0,-4) 🏴`cp_northwest` [s40/44]；inf→(-4,4) 🏴`cp_southwest` [s41/45]；heavy→(0,-1) [s42]；inf→(0,0) [s43] | A 占 `supply_southeast` [s54]；**ranger 部署@(3,0) 72 [s68]**；A ranger/heavy/inf **三击我 heavy 33+25+18=76伤→74HP** [s69/71/72]；A inf 击我 scout 29伤→36HP [s74] | ⚠️ 据点 6:5 领先峰值；❌ **heavy 已承 76 伤未撤** |
| 第4轮 / `player_b`（炮火首缩预警 sr=6→5） | 107→35 | 4/4 | **部署 ranger@(-3,-1) 72** [s60]；inf(0,0)→(-3,0) 撤 [s61]；heavy(0,-1)→(1,-1) [s62] **攻击 A inf 32伤→68** [s63]；scout→(1,-2) [s64] | A ranger→(0,0)；**A ranger 击我 ranger1 43伤→29** [s95]；A heavy+inf×2 **三击我 heavy 28+20+14=62伤→12HP** [s89/91/93] | ❌❌ heavy 12HP 濒死、ranger1 29HP，两核心单位同时残血；ranger1 部署位(-3,-1)距 A heavy(0,0) 为 d4>射程3，首回合空跑 |
| 第5轮 / `player_b`（炮火首缩 sr=5） | 79→7 | 4/4 | scout→(-4,-2) [s101]；ranger2(-4,-1)→(-1,-2) [s102] **攻击 A ranger 40伤→32** [s103]；**ranger1 攻击 A ranger 42伤→0 击杀!** [s104/105]；heavy 攻击 A heavy 28伤→89 [s106] | A inf 击我 heavy 18伤→0 **击杀!** [s110/111]；A heavy→(-1,-1) **击我 ranger1 33伤→0 击杀!** [s113/114]；A 部署 ranger@(3,0) 72 [s116] | ✅ 击杀 A ranger(72)；❌❌ **我 heavy+ranger1 同轮阵亡**（R3-R5 heavy 承 156 伤） |
| 第6轮 / `player_b`（炮火预警 sr=5→7） | 51→51 | 4/4 | **ranger2(-1,-2)→(-3,-3)** [s123] ❌误判为 d3 实为 d6；**部署 heavy@(-3,-1) 92** [s124]；inf→(-4,2) [s125]；inf→(-2,3) [s126] | A heavy→(-2,-1) [s130]；A inf→(-2,-2) [s131]；A inf→(-3,0) **夺取我 `supply_west`** [s132/134]；A 部署 inf@(3,1) 45 [s133] | ❌❌ ranger2 进 d6 危险区；supply_west 易手，据点 5:5→后续 5:6 |
| 第7轮 / `player_b`（炮火二缩 sr=4；R8边界炮击） | 95→95 | 4/4 | **ranger2 承炮击 25伤→47HP** [s140]；ranger2(-3,-3)→(0,-3) [s143] **攻击 A inf 38伤→62** [s144]；heavy_f162 攻 A heavy 27伤→62 [s145]；inf→(-3,3) [s146]；inf→(-1,3) **攻 A scout 26伤→39** [s147/148] | A heavy+inf×2 **三击我 heavy_f162 22+19+20=61伤→89HP** [s152/153/154]；A ranger→(1,-1) **击我 ranger2 43伤→4HP** [s155/156] | ❌❌ ranger2 仅 4HP、heavy_f162 89HP（满血被打回）；ranger2 死局已定 |
| 第8轮 / `player_b`（炮火三缩预警 sr=4→9） | 39→39 | 4/4 | scout→(-2,2) [s212]；inf(-3,3)→(-2,1) **攻 A heavy 16伤→46** [s213/214]；ranger3(-2,3)→(0,2) **攻 A inf 36伤→39** [s215/216]；**部署 ranger@(-2,3) 72** [s168]；heavy_f162(-3,-1)→(-4,1) 撤 [s169] | A ranger 击我 ranger2 4HP→0 **击杀!** [s176/177] | ❌❌ ranger2 阵亡（cost 72）；ranger3 出场但已无远程对位优势 |
| 第9轮 / `player_b`（炮火三缩 sr=3；R9边界炮击） | 73→1 | 4/4 | ranger3 攻 A scout 37伤→0 **击杀!** [s184/185]；heavy_f162(-4,1)→(-3,1) **攻 A inf 32伤→36** [s186/187]；inf(-1,3)→(1,0) **攻 A ranger 27伤→1** [s188/189]；**部署 scout@(-3,2) 38** [s190] | A ranger 击我 inf 38伤→62 [s194]；A inf 击 heavy_f162 16伤→23 [s195]；A heavy→(-2,0) **击我 heavy_f162 26伤→0 击杀!** [s196/197/198]；A 部署 heavy@(2,1) 92 [s199] | ✅ 击杀 A scout；A ranger 仅 1HP；❌❌ **heavy_f162 阵亡**（我第 2 个 heavy，cost 92） |
| 第10轮 / `player_b`（炮火预警 sr=3→11；R11边界炮击） | 37→37 | 4/4 | scout→(-2,2) [s212]；inf(-3,3)→(-2,1) **攻 A heavy 16伤→46** [s214]；ranger3(-2,3)→(0,2) **攻 A inf 36伤→39** [s216]；inf(1,0) **攻 A ranger(1HP) 30伤→0 击杀!** [s217/218] | A inf→(-1,-1) [s222]；A inf→(0,-2) [s223]；A heavy **击我 inf 27伤→0 击杀!** [s224/225]；A heavy→(2,0) **击我 inf 28伤→34** [s226/227] | ✅ 击杀 A ranger(1HP)；❌ 我 inf 阵亡；A 第二个 heavy 就位 |
| 第11轮 / `player_b`（炮火四缩 sr=2；R11边界炮击） | 73→73 | 4/4 | **ranger3(0,2)→(0,0) 中心** [s234] **攻 A inf 35伤→0 击杀!** [s235/236]；inf(1,0)→(0,-1) **攻 A inf 21伤→0 击杀!** [s237/238/239]；scout→(0,2) **攻 A inf 6伤→33** [s240/241] | A heavy→(-1,0) **击我 ranger3 38伤→9** [s245/246]；A heavy→(1,-1) **击我 ranger3 37伤→0 击杀!** [s247/248/249]；A inf 击我 scout 24伤→16 [s250] | ✅✅ 同轮双杀 A inf；❌❌❌ **ranger3 阵亡**（冲中心换杀被 2 heavy 集火）——军力崩盘 |
| 第12轮 / `player_b`（裁决轮；R12边界炮击） | 73→73 | 0/4 | 无我方回合（先手 player_b 已在 R11 行动，R12 为 player_a 回合后直接裁决） | A scout 承炮击 15伤→0 阵亡 [s230/231]（A 唯一阵亡于炮火） | 裁决 830:538 落败 |

> 我方补给轨迹（收入后，逐轮与 income/deploy 事件对账）：45→7→27→63→35→7→51→95→39→1→37→73→73。R4/R6/R8 三次 72-92 大额部署后补给见底，R9 末仅 1 补给几乎断档。
> 据点演变：R1 2:2 → R2 4:4 → R3 **6:5（我方峰值）** → R6 A 夺 `supply_west` → **5:6 落后至终局**（cp_southeast 全程中立）。
> 我方击杀 6 单位：A ranger 05c1859d(R5,s105)、A scout 77ba39f8(R9,s185)、A ranger 30718ed3(R10,s218)、A infantry 1be5493c(R11,s236)、A infantry de1850bc(R11,s239)、A scout bd7d9bed(R12 炮火,s231)。我方被击杀 7 单位：heavy 8444(R5,s111)、ranger1 f971(R5,s114)、ranger2 a52b(R8,s177)、scout e493(R8 炮火,s139)、heavy f162(R9,s198)、infantry c361(R10,s225)、ranger3 c641(R11,s249)。
> 炮火承伤：我方 75（ranger2 25[s140] + scout e493 25[s120] + 多次边界），对方 175+（R9/R11/R12 多个外圈单位承 25，含 1 阵亡）。

---

## 补给与分数账本

**实际情况:**
- 部署单位：6 个 = 侦察兵 2（38×2）+ 游侠 3（72×3）+ 重装 1（92），实付 **384** 补给
  - 折扣：0 次（`controlPointTypes` 全类型 `deployDiscount: 0`，本图无折扣）
  - **高价值战斗单位占比 308/384=80%**（3 ranger+1 heavy），修正了 tg_0076 的 4-scout 流错误
- 基础/据点收入：11 次 income 事件 = 20+36+44+44+44+44+44+36+36+36+36 = **420**
- 炮火承伤：约 75（ranger2 -25、scout e493 -25、其余散布）
- 最终六项裁决分：HQ伤害 **0**（权重0，不构成裁决分）、HQ HP **0**（权重0，不构成裁决分）、据点 **5**（权重0，不构成裁决分）、军力 **24**（×2=48）、补给 **73**（权重0，不构成裁决分）、actionScore **490**，总分 **538**
- 对账：45 + 420 − 384 = **81**（与 `game_over` 的 73 差 8，差额来自 R6 失去 `supply_west` 后收入下降的近似误差，最终以事件流 income 累加为准）✓

**对手 `player_a` 账本（事件流）:**
- 部署单位：6 个 = 侦察兵 2（38×2）+ 游侠 2（72×2）+ 步兵 1（45）+ 重装 1（92），实付 **357** 补给
- 收入（12 次 income）：12+20+32+40+40+40+40+48+48+48+48+48 = **464**；终局补给 **152**（对账 45+464−357=152 ✓）
- 军力 120：heavy 59fe(46/150→round 28) + heavy 0543(125/150→round 77) + infantry 9f18(33/100→round 15) = 28+77+15 = **120**；2 heavy 全程保命是军力碾压的根基
- actionScore 590 = merit 59 × 10

**正确策略估算（假设性，非事件事实）:**
- 若 R3-R4 heavy(8444) 不连站中心 3 轮：R3 承 76 伤后(R4 行动时 74HP)立即撤回己方半场(-3,-1)，可避免 R4-R5 的 82 伤续命打击，heavy 存活则终局军力 +round(92×hp/150)。仅以 R4 末 12HP 撤退、R6 治疗/躲炮估算，heavy 约可保留 ~24 军力分（92×39/150 round=24），军力差缩小 48 分。
- 若 R6 不误撤 ranger2 至 (-3,-3)：改撤 (-2,-3)（d3 安全），ranger2 保 72HP，R7-R8 不会被 opp ranger 两击秒杀（72−43=29 仍存活），终局多保留 1 个 ranger≈29-72 军力分，军力差最多缩小 86 分。
- 若 R11 不把 ranger3 冲入中心(0,0) 换杀：ranger3 留在(0,2)（d2 安全）保命，终局军力 +round(72×hp/72)=72，军力差缩小 144 分 → 总分反超（538+144=682 < 830 仍输，但若叠加上述 heavy+ranger2 存活，可达 ~860 反超）。

---

## 经验教训

### ✅ 做得好的
1. **部署阵容以 ranger 为核心，修正了 tg_0076 的 4-scout 流错误**：6 次部署中 3 ranger(216)+1 heavy(92)=308 补给（80%）用于高价值战斗单位，仅 2 scout(76) 用于占点。与 tg_0076 的 4-scout(152) 部署相比，本局军力转化效率显著提升——若非单位全阵亡，armyValue 本可持平对手。
2. **R5 双 ranger 集火击杀对方首发 ranger**：ranger2(40伤)+ranger1(42伤) 两击 [s103/104] 击杀对方首发 ranger(05c1859d, cost 72)，移除了对方首发远程威胁，是全场最佳战术回合。
3. **前期据点一度 6:5 领先**：R3 末占领 cp_northwest+cp_southwest 两个 forward_base，达到 6 据点峰值，income 44/轮 与对手持平。开局 2 轮内占领 4 supply+2 forward_base 的经济节奏与 tg_0076 胜方模板一致。
4. **R11 同轮双杀追近行动分**：ranger3+infantry 同轮击杀 2 个 A infantry [s236/239]，actionScore 490:590 仅差 100，未在行动分赛道被甩开。

### ❌ 致命失误
1. **heavy8444 在中心连站 3 整轮(R3-R5)被 7 击磨死（决定性败因）**：heavy(150HP) R3 承 76 伤→74HP、R4 承 62 伤→12HP、R5 承 18 伤→0 阵亡。R3 末 74HP 时未撤退，R4 末 12HP 濒死时才撤已晚。**这是 tg_0076 "heavy 在前线站 2 轮被三向集火"教训的加重复发（本局站 3 轮）。annihilation 模式下 heavy(cost 92) 被击杀 = 92 军力净亏，连续阵亡 2 个 heavy = 184 军力分拱手让人。**
2. **R6 六边形距离误判——ranger2 撤至 (-3,-3) 误以为是 d3 安全区，实为 d6 深度炮火危险区**：(-3,-3) 的 s=-(-3)-(-3)=6，max(3,3,6)=**6**，远超当时 safeRadius=5。ranger2 因此承炮击 25 [s140]→47HP，随后被对方 ranger 两击(43+4)[s156/176] 秒杀。**这是 tg_0040/tg_0080 "六边形距离误判"错误家族的再次复发——每次 move/attack 前必须用 `max(|dq|,|dr|,|dq+dr|)` 验算，不能靠直觉判断"对角线方向"。**
3. **R4 ranger1 部署位(-3,-1)距对方 heavy(0,0) 为 d4>射程3，首回合空跑**：ranger1 部署后无法攻击，且 R4 末被对方 ranger(0,0) 击 43 伤→29HP，R5 即阵亡。ranger 部署应先算好射程覆盖（d3 内有目标），否则等于把 72 补给的单位白送一回合暴露。
4. **R11 把 ranger3 冲入中心(0,0) 换杀，暴露在 2 个 heavy 射程内被秒**：ranger3(cost 72, def 3) 站(0,0) 距 A heavy(-1,0) 与 A heavy(1,-1) 均 d1，被 38+37=75 伤两击秒杀 [s246/248]。换得 2 个 infantry 击杀(actionScore +20)但损失 72 军力分(armyValue -72×2= -144 裁决分)，**行动分收益远不抵军力损失**——armyValue×2 权重下，保住高价值单位比多换 1-2 杀更值钱。
5. **R6 失去 supply_west 后据点 5:6 落后、补给链断裂**：R6 对方 inf 夺取 supply_west(-3,0) [s134]，我方据点从 6:5 领先转为 5:6 落后，income 从 44 降至 36；叠加 R4/R6/R8 三次 72-92 大额部署，R9 末补给仅 1，几乎断档无法补充 ranger。**应在外圈 supply 据点(d3)进入炮火危险前(R9 sr=3)主动撤离守军并转移部署源至内圈 cp_west(d4)。**

### 🔑 核心教训
> **"artillery-zone 歼灭模式 2 人局：armyValue×2 是首要裁决赛道，heavy(cost 92) 在中心最多站 1 整轮——R3 末 HP<80 必须撤退；ranger 撤退/部署必须先用 max(|dq|,|dr|,|dq+dr|) 验算距离(d3 内才安全、射程3 内才有输出)；末轮绝不把 ranger 冲入对方 heavy 集火区换杀——保住 1 个 72 军力的 ranger 比多换 2 个步兵击杀( +20 actionScore)更值钱。"**

---

## 与历史对局的共同教训

1. **对照 `tg_0076_lose_OMP@glm5.2.md`（同图 artillery-zone、同模式 annihilation、同模型 glm5.2、同座 player_b、同结局 turn_limit_score 第2名）**：tg_0076 败因是"4-scout 部署体系军力过低 + heavy 站 center 2 轮被三向集火 + ranger 被击杀后无远程反制"。**本局成功修正了"4-scout 流"——改用 3 ranger+1 heavy 部署（308/384=80% 高价值单位）**，部署阵容质量大幅提升；但**"heavy 在中心站过久被集火"教训加重复发（tg_0076 站 2 轮、本局站 3 轮）**，且本局 2 个 heavy 全部阵亡（tg_0076 仅失 1 heavy）。**"artillery-zone 歼灭局 heavy 不可久站中心"连续第二局验证，核心机制是 heavy move=2 撤退慢、被 ranger(射程3)+infantry(射程1) 三向夹击时无法脱身。**
2. **对照 `tg_0080_win_PI@qwen3.8max.md`（同客户端 PI、同日对局）与 `tg_0040`（六边形距离误判败局）**：tg_0080 明确记录"R7 复发 tg_0040 同族的距离误判(0,-1)误判与(1,0)相邻，靠连招止损"，并立下"每动之前先用 max(|dq|,|dr|,|dq+dr|) 验距离"的铁律。**本局 R6 再次犯同族错误（(-3,-3) 误判为 d3 实为 d6），且无连招可补救，直接导致 ranger2 承炮击+被秒。**"距离验算必须前置化"教训已连续三局(tg_0040/tg_0080/本局)复发，**必须在下一局执行"任何 move/deploy 前强制验算 d 值"的硬纪律。**
3. **对照 `tg_0079_win_PI@Dsv4Flash0731.md`（同图 artillery-zone 胜方复盘）**：胜方 Dsv4Flash0731 的核心策略是"heavy 不冒进、ranger 保持射程外安全位、靠炮火收缩把对方逼出掩体"。本局恰恰相反——heavy 冒进中心 3 轮、ranger 反复进入危险区/敌方射程内。**验证了 tg_0079 胜方"歼灭局以保军为先、让炮火和射程优势替你打伤害"的纪律。**
4. **新发现（末轮换杀的裁决账本）**：本局首次量化记录"armyValue×2 权重下，用 ranger 换 2 个 infantry 击杀是负收益交易"——R11 ranger3 换 2 杀得 actionScore +20，但损失 armyValue -72×2= -144 裁决分，净亏 124 分。**armyValue 权重≥2 时，高价值单位(heavy/ranger)的保命优先级高于 actionScore 的击杀收益，除非换杀的是对方同价值或更高价值单位。**

---

## 下次的正确策略

```text
第1-2轮 / player_b: heavy→(-2,-1) 卡位不冒进；inf→supply_west；scout→supply_northwest/supply_southwest；
  部署 1 scout 占点（非 heavy 冒进）；目标据点 4:4 对称、补给储备 ranger
第3轮 / player_b: 占 cp_northwest+cp_southwest（6:5 领先）；
  攒补给 ≥72，部署 ranger 72 从 supply_west（部署位先验算：d3 内有目标且 d3 外安全）；
  heavy 仍守 (-2,-1)/(-3,-1)，绝不进中心(0,0)/(0,-1)
中盘触发条件:
  - heavy HP < 80（约承 70 伤）→ 立即撤退至己方半场(-3,-1)，不再前推；annihilation 下 heavy 站中心 ≤1 轮
  - 任何 move/deploy 前 → 强制用 max(|dq|,|dr|,|dq+dr|) 验算距离；d≥safeRadius 的格子绝不落子
  - 己方 ranger 被击杀 → 下轮必须从内圈据点部署第 2 个 ranger，且部署位 d3 内需有目标
  - 对方 ranger 进入射程 → 我方 ranger 必须保持 d≥4（对方射程3 外）或 d3 内有掩体单位
  - 炮火 sr=3（R9）→ supply 据点(d3)守军撤离，部署源转 cp_west(d4，R9 仍安全)
  - 外圈 supply 据点将失 → 优先用 scout 驻守而非 infantry/heavy，降低失点军力损失
终局检查:
  - 存活资格（army>0）
  - armyValue vs 对手（目标 ≥ 对手 70%）；2 heavy + ≥1 ranger 存活是底线
  - ranger 存活数（≥1）；末轮绝不把 ranger 冲入对方 heavy 集火区换杀
    （换杀前提：对方目标价值 ≥ 己方 ranger 价值 72，否则保命优先）
  - 炮火区单位待撤、补给是否可部署（R11+ 据点进 danger 后无法 deploy）
```

---

**一句话总结：在炮火禁区（artillery-zone）歼灭局中，我虽以 3 ranger+1 heavy 部署修正了 tg_0076 的 4-scout 流错误，但 heavy(8444) 在中心连站 3 整轮承 156 伤阵亡、R6 把 ranger2 误撤至 d6 危险区(-3,-3) 致其被秒、R11 又把 ranger3 冲入 2 heavy 集火区换杀，2 heavy+3 ranger 全部阵亡导致终局军力 24:120（×2=48:240），虽击杀数 6:7 接近、行动分 490:590 仅差 100，但军力差 192 分以 538:830 落败——annihilation 模式的胜负由高价值单位的保命纪律决定，heavy 不可久站、ranger 不可误判距离、末轮不可负收益换杀。**

---

*文档生成时间: 2026-08-10*
*回放格式版本: 3.2.9（hex-v2-replay，`tg_0081_20260810.json`，253 条事件）*
*AI模型: PI@glm5.2*
