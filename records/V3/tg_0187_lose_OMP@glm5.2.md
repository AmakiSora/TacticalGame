# 战术游戏标准模式复盘 — `player_a` 视角

**日期/游戏ID/回放版本:** 2026-09-30 / `2d5057f1-04dc-4a02-bcf1-d2ebc2a8b94a` / schemaVersion 3.5.9
**地图/参战人数:** `multiplayer-ring`（半径 8 六边形盘，217 格，6 个 blocker 围成距中心 2 的内环半屏障；7 据点：`cp_center`(0,0) repair / `cp_e`(3,0) supply / `cp_ne`(3,-3) forward_base / `cp_nw`(0,-3) supply / `cp_w`(-3,0) forward_base / `cp_sw`(-3,3) supply / `cp_se`(0,3) forward_base）/ 2 人
**玩家:** GLM5.2-OMP（OMP @ glm5.2）
**席位与出生:** `player_a`，行动顺序第 1（先手），HQ(-8,0)
**结果:** ❌ 第 2 名 — `turn_limit_score`
**结束轮次:** 第 15/15 整轮（打满）；**HQ 最终 HP:** 180/180（双方全程零 HQ 伤害）

## 最终排名摘要

| 名次 | 席位 | 玩家 | 状态 | 总分 | 与我方分差 | 决定性优势 |
|---|---|---|---|---:|---:|---|
| 1 | player_b | Dsv4.1Flash0910-WB | active | 1141 | +637 | 据点 6:1（+375）、军力 367:128（+239）、actS 138:88（+50）——cp_center 步兵海持续压制 |
| 2 | player_a | GLM5.2-OMP（我） | active | 504 | — | 仅守住 cp_w，3 次偷据点（cp_ne/cp_se/cp_e）均被对手反夺，杀敌不换据点 |

裁决权重（本局 `balance.adjudicationWeights`）：`enemyHqDamage=5, ownHqHp=1, controlPoint=75, armyValue=1, supplies=1`，`effectiveActions=2`（标准模式默认）。全程无任何 HQ 攻击事件，`enemyHqDamage` 两边皆 0——胜负完全由据点存量与军力决定。

## 游戏进程时间线

（补给列 = 我回合开始时余量；AP=7/回合；坐标为 axial {q,r}）

| 整轮/席位回合 | 我补给 | 关键操作与坐标 | 结果/局势变化 | 战术意图 |
|---|---:|---|---|---|
| R1 我 | 70→32 | scout(-7,-1)→cp_w(-3,0) 占；infantry(-7,0)→(-4,0)；部署 scout@(-8,1) cost38 | cp_w→我（forward_base，折扣4）；我 1 CP | 抢西侧 forward_base + 建 capturer |
| R1 对 | 70→0 | scout(7,1)→cp_e(3,0) 占；infantry(7,0)→(4,0)；部署 2 scout@(7,1)(7,0) cost76 | cp_e→对手；对手**透支**补给到 0（76>70，地板0）；对手 1 CP 4 单位 | 对手双 scout 抢点+暴兵 |
| R2 我 | 42→8 | scout cp_w→cp_nw(0,-3) 占（连跳）；scout(-8,1)→(-3,1)；infantry(-4,0)→(-3,2)；从 cp_w 部署 scout@(-3,-1) cost34 折扣4 | cp_nw→我；我 2 CP；用足 cp_w 折扣 | 利用 CP 粘性连占 + 折扣部署 |
| R2 对 | 0→14 | scout cp_e→cp_center(0,0) 占；infantry→cp_e 驻守；2 scout 推进 (2,2)(2,1) | cp_center→对手（repair，自愈）；对手 2 CP | 抢中央 swing CP |
| R3 我 | 26 | infantry(-3,2)→cp_sw(-3,3) 占；scout(-3,1)→cp_w 驻守；scout(-3,-1)→(0,-1) 枢纽 | cp_sw→我；我 3 CP 全驻守 | 驻守化拒止（单位占格则对手无法踏入夺点） |
| R3 对 | 14 | scout center→cp_se(0,3) 占；scout(2,1)→cp_ne(3,-3) 占；infantry→center 驻守；攻我 hub scout 28伤 | cp_ne/cp_se→对手；对手 4 CP；我 hub scout 65→37 | 对手 scout 连跳占东侧 3 CP |
| R4 我 | 52 | hub scout(0,-1)→(0,-2) 阻断 center→cp_nw 路径；存钱 | 我 3 CP 不变；布局 cp_ne 偷取 | (0,-2) 一子三用：堵 cp_nw、cp_ne 偷取位、安全 |
| R4 对 | 30→9 | 从 cp_center 部署 infantry@(-1,0) cost45 | 对手 4 CP，3 infantry 开始压我 cp_w | 对手用 repair CP 当 deploy 源出步兵 |
| R5 我 | 78→10 | 从 cp_w 部署 ranger@(-2,-1) cost68 折扣4 | 我 3 CP；ranger 到位（唯一 range3 杀手） | 攒钱出 ranger 击杀对手 scout 驻守 |
| R5 对 | 9→33 | infantry(-1,0)→(-2,0) 攻我 cp_w scout 27伤(65→38) | 对手 4 CP；我 cp_w 驻守变脆 | 对手 infantry 压 cp_w |
| R6 我 | 36 | hub(0,-2)→(1,-3) 开路；ranger(-2,-1)→(0,-2) 攻 cp_ne 驻守 42伤(65→23)；cp_w scout 攻 infantry 9伤 | cp_ne 驻守残血 23；ranger 落 (0,-2) | 攻后可移：ranger 攻 cp_ne 后本可撤，但被包围 |
| R6 对 | 33 | 从 cp_center 部署 infantry@(0,-1)；2 infantry 夹击 ranger（24+25=49伤，72→23）； | ranger 危殆；我 3 CP | 对手双 infantry 围杀我 ranger |
| R7 我 | 62 | ranger 攻 cp_ne 驻守 40伤→**击杀**；hub(1,-3)→cp_ne(3,-3) **偷取** | cp_ne→我；**我 4 CP 反超（cp_w/cp_nw/cp_sw/cp_ne）** | ranger 换杀+偷点，高杠杆 |
| R7 对 | 12 | infantry 攻 ranger 25伤→**ranger 阵亡**；2 infantry 推进 (3,-2)(2,-3)；攻我 hub 28伤(37→9) | 我 4 CP 但 **ranger 已亡**（唯一 range3 单位）；hub 9hp 危殆 | 对手围杀 ranger，夺回主动 |
| R8 我 | 92→24 | 从 cp_w 部署 2nd ranger@(-3,1) cost68；hub(9hp) 攻 infantry 6伤 | 我 4 CP；2nd ranger 到位 | 再出 ranger 续攻 |
| R8 对 | 32 | 攻 hub 24伤→**hub 阵亡**；infantry→cp_ne(3,-3) **反夺**；攻我 cp_nw scout 27伤(65→38) | cp_ne→对手；我 3 CP；cp_nw/cp_w scout 均 38hp | 对手夺回 cp_ne + 压我北/西 |
| R9 我 | 50 | cp_nw scout 攻 infantry 9伤；2nd ranger(-3,1)→(-2,2) 攻 cp_se 驻守 41伤(65→24) | cp_se 驻守残血；ranger 安全位(无对手邻接) | 转攻南侧 cp_se（scout 驻守，2击杀） |
| R9 对 | 52 | 从 cp_se 部署 infantry@(0,2) cost41 折扣4；攻我 cp_nw scout 23伤(38→15) | 对手 4 CP；我 cp_nw scout 15hp 危殆 | 对手 reinforce cp_se 区 |
| R10 我 | 76 | 2nd ranger 攻 cp_se 驻守 39伤→**击杀**；infantry(-3,3)→cp_se(0,3) **偷取**；cp_nw scout 攻 infantry 6伤 | cp_se→我；**我 4 CP 反超（cp_w/cp_nw/cp_sw/cp_se）**；但 infantry 离开 cp_sw→cp_sw 空虚 | ranger 换杀+偷点 |
| R10 对 | 35 | infantry(1,-3)→cp_nw(0,-3) **反夺**；infantry(0,2)→cp_sw(-3,3) **反夺**（我 cp_sw 无驻守！）；部署 infantry@(2,-2)；攻 2nd ranger 27伤(72→45) | **cp_nw+cp_sw 同时被夺**；我骤降至 2 CP（cp_w/cp_se） | 对手趁我调走 cp_sw 驻守连夺两城 |
| R11 我 | 90→56 | 2nd ranger(-2,2)→(0,2) 攻 cp_e scout 41伤(65→24)；从 cp_w 部署 scout@(-3,-1) cost34 | cp_e scout 残血；我 2 CP | 转攻东侧 cp_e（scout 驻守） |
| R11 对 | 14 | 从 cp_center 部署 infantry@(0,1)；cp_e scout 逃至 (1,0)；攻 2nd ranger 29伤(45→16) | cp_e 无驻守（opp sticky）；我 ranger 16hp 危殆 | 对手弃 cp_e 救 scout + 围杀 ranger |
| R12 我 | 70 | 2nd ranger 攻 cp_e scout 38伤→**击杀**；infantry(0,3)→cp_e(3,0) **偷取** | cp_e→我；**我 3 CP（cp_w/cp_se/cp_e）**；但 infantry 离开 cp_se→cp_se 空虚 | ranger 临死换杀+偷 cp_e |
| R12 对 | 5 | 攻 2nd ranger 29伤→**2nd ranger 阵亡**；2 infantry 攻我 cp_e infantry（24+22=46伤，100→54） | 我 3 CP 但**2nd ranger 亡**；cp_e infantry 54hp | 对手围杀我第 2 个 ranger |
| R13 我 | 92(+comeback20→112?) | cp_e infantry 攻 opp infantry 25伤；从 cp_w 部署 2 infantry@(-2,0)(-4,0) cost82 | 我部署 2 durable 驻守预备；actS+army | 转化补给为军力+actS |
| R13 对 | 33 | 3 infantry 攻我 cp_e infantry（21+19+21=61伤）→**击杀**并**反夺 cp_e**；部署 infantry@(-1,0) | cp_e→对手；我 2 CP（cp_w/cp_se）；comeback_supply+20 | 对手 3 步兵定点清除我 cp_e 驻守 |
| R14 我 | 44 | cp_w scout(-3,0)→(-4,1) 撤退保单位；infantry(-2,0,79hp)→cp_w(-3,0) **durable 驻守**；部署 infantry@(-2,0) cost41；新 infantry 攻 opp(-1,0) 25伤 | cp_w 换 durable 驻守（79hp，能撑过终审）；actS | 死守 cp_w 到终审 + 赚分 |
| R14 对 | 16→36 | infantry(2,0)→cp_se(0,3) **反夺**（我 cp_se 无驻守）；部署 infantry@(2,-2) | cp_se→对手；我仅 1 CP（cp_w）；comeback+20 | 对手补刀空虚据点 |
| R15 我 | 33 | infantry(-2,0) 攻 opp(-1,0) 19伤；scout(-3,-1)→(-2,-1)（攻击失败，dist2 超 range1，**空转1AP**） | 我 1 CP；actS+ | 最后赚分 |
| R15 对 | 11 | 部署 infantry@(-1,-2) cost45；多步兵攻击 | r15 round_end → **game_over** | 终审判定 |
| **终审** | — | `game_over` winner=player_b, reason=turn_limit_score | **1141 vs 504，对手胜** | 据点 6:1 + 军力 367:128 压制 |

## 核心策略与关键转折

**策略1：CP 粘性连占 + 驻守拒止。** 验证了引擎 `captureControlPoints` 无 revert 逻辑——占后单位离开不丢，需敌方 capturer 站上去才能夺。R1-R3 我用 scout(moveRange5) 连跳占 cp_w→cp_nw→cp_sw，并发现"已占 CP 有单位驻守时对手无法踏入（占格阻挡）"，用驻守拒止对手偷取。R3 我 3 CP 全驻守，对手无法夺。**这是本局我执行最成功的策略。**

**策略2：ranger 换杀+偷点的高杠杆连段。** 利用 attack 设 `hasActed`、move 查 `hasMoved`——ranger 可"先攻击再移动"。R7/R10/R12 三次用 ranger 击杀对手 scout 驻守（65hp，2击杀）+ 立即用 capturer 踏入偷取（cp_ne/cp_se/cp_e），单次净杠杆 +150（CP 翻转）+ 杀 scout -38 军力。**杠杆正确，但 ranger 自身暴露导致阵亡（见转折2）。**

**策略3：存钱出 ranger 做 range3 唯一杀器。** 对手 6 个单位多为 scout/infantry（range1），ranger(attack44,range3) 可从安全距离 2 击杀 scout、3 击杀 infantry。R5/R8 两次攒钱（68 each，cp_w 折扣4）出 ranger。方向正确——没有 ranger 时我无力击杀对手 tanky infantry 驻守（22 dmg/hit 杀 100hp 需 5 回合）。

**转折1（R7）：偷 cp_ne 反超 4-3，但 ranger 被双 infantry 围杀。** R6 我把 ranger 落到 (0,-2)，该格 6 邻全堵（2 对手 infantry + 我 cp_nw/hub scout + 2 blocker），ranger 被困；R7 对手 2 infantry 夹击（24+25+25）杀掉我唯一 range3 单位。**从此我丧失高效击杀能力，只能用步兵/scout 缓慢磨对手 100hp infantry 驻守——这是不可逆压力的起点。**

**转折2（R10）：偷 cp_se 换 cp_nw+cp_sw，净 -1 CP。** 我把 cp_sw 的步兵调去 cp_se 偷点，cp_sw 瞬间空虚（sticky 但无驻守），对手当回合连夺 cp_nw（infantry@1,-3 邻接）和 cp_sw（infantry@0,2→-3,3 dist3）两城。**偷一城丢两城**——这是本局最大失误，4-3 领先骤变 2-4 落后。

**转折3（R8-R13）：对手 cp_center 步兵海压制。** 对手从 cp_center（repair CP，deploy 源，discount0）持续出 infantry（R4/R6/R11/R13/R15 共 5 个 45-cost），加 forward_base 折扣出的 3 个（41-cost），累计 8 个步兵。这些 durable 步兵（100hp/def8）压我脆弱的 scout 驻守（65hp/def4，每回合吃 27 伤 2-3 回合被杀+夺点）。我无足够 durable 单位替换驻守，陷入拆东墙补西墙，CP 从 4 一路掉到 1。

## HQ、据点与行动点分析

- **HQ：** 双方 HQ 全程 180/180，零攻击事件。本局是纯据点+军力局，HQ 伤害权重5 从未生效。HQ 仅作 deploy 源（我 cp_w/HQ；对手 cp_center/cp_ne/cp_se/cp_nw 多源）。
- **据点收益账：**
  - `cp_w`(forward_base, 我)：收入4/回合 + 部署折扣4（为我省 4×7 部署 = 28 supplies）。是我全程唯一稳守据点。
  - `cp_nw`/`cp_sw`(supply, 收入8)：高收入，但驻守 scout 脆弱，R10 被夺后我损失 16/回合收入。
  - `cp_center`(repair, 对手)：收入2 低，但**deploy 源 + 每回合自愈相邻 8hp**（R14/R15 触发 repair 事件）+ 中央枢纽。对手把它当步兵工厂，性价比极高——这是我未争夺的 swing CP（R2 对手 scout 一步占走，我再无能力夺回，因 repair 自愈+infantry 驻守）。
  - `cp_e`(supply 8)/`cp_ne`/`cp_se`(forward_base 4)：对手东侧，我 3 次偷取均被反夺。
- **行动点：** 7/回合基本用足。低效处：R15 scout→(-2,-1) 后攻击失败（dist2 超 range1），**空转 1 AP**；R6-R7 ranger 两次行动都因暴露被围杀，"用对 AP 给错单位"。
- **先手（player_a 第1顺序）：** 争夺同回合 CP 时对手（第2）末动夺点占优——R2 center 对手末动抢走。我偷点后对手总能末动反夺（R8 cp_ne、R10 cp_nw/cp_sw、R13 cp_e），这是先手方的结构性劣势，本局被放大。

## 补给与六项裁决分账本

裁决公式：`HQ伤害×5 + 己方HQ HP×1 + 据点数×75 + 军力价值×1 + 剩余补给×1 + actionScore`（actS 已含 effectiveActions×2，不再乘权重）。

| 项目 | 我 | 对手 | 权重 | 事件/配置依据 |
|---|---:|---:|---:|---|
| 对手 HQ 伤害 | 0 | 0 | 5 | 全程无 `attack` 命中 HQ |
| 己方 HQ 最终 HP | 180 | 180 | 1 | `game_over` |
| 最终控制据点数 | 1 | 6 | 75 | `control_point_captured` 流转 |
| 存活军力价值 | 128 | 367 | 1 | `game_over` 终态 |
| 剩余补给 | 33 | 6 | 1 | `income`/部署流水 |
| actionScore | 88 | 138 | — | 行动事件（actS=merit×2） |
| **总分** | **504** | **1141** | — | `game_over.payload.scores` |

**收入/花费流水（事件依据）：**
- 基础收入 6/回合；据点收入按类型 supply=8 / forward_base=4 / repair=2。
- 我回合开始补给轨迹：R1=70（部署后32）→R2=42→R3=26→R4=52→R5=78→R6=36→R7=62→R8=92→R9=50→R10=76→R11=90→R12=70→R13=92→R14=44→R15=33（`income`+`deploy` 事件累计）。
- `comeback_supply`：我 R13+20、R14+20（落后 leader ≥40% gap 触发，`startRound=3`）。对手从未触发（始终领先）。
- 我的部署：8 单位 cost 365（3 scout 106 + 2 ranger 136 + 3 infantry 123），全部用 cp_w 折扣4（ranger 68、infantry 41、scout 34）。
- 对手部署：10 单位 cost 424（2 scout 76 + 8 infantry 348：5×45 from cp_center + 3×41 from forward_base）。**对手 8 步兵海**是军力 367 的来源。
- 我攻击 13 次 340 伤；对手攻击 584 伤。我阵亡 5 单位（2 ranger + 2 scout + 1 infantry），对手阵亡 3 scout。**我用 340 伤换对手 3 个 scout（-114 军力），但对手用 584 伤换我 5 单位（-239 军力）——交换比严重亏损。**

## 失误与改进

1. **R6 把 ranger 落到 (0,-2) 被困围杀（实际做法）vs 应从 range3 安到位攻击后即撤（正确做法）。** 触发条件：ranger 在(0,-2) 6 邻全堵（2 opp infantry + 我 2 scout + 2 blocker），R7 被双 infantry 24+25+25=74 伤击杀。预期收益：ranger 存活则可继续 range3 安全击杀对手 scout/infantry 驻守，守住 cp_ne 或续偷 cp_se/cp_e。**改法：ranger 攻击位选无对手邻接的 (-2,2) 类安全格（如 R9 那样），绝不进入步兵 range1 圈。**

2. **R10 偷 cp_se 调走 cp_sw 驻守导致连丢两城（实际）vs 应保留 cp_sw 驻守、用独立 capturer 偷点（正确）。** 触发条件：cp_sw infantry→cp_se 偷取后 cp_sw 空虚，对手 infantry@0,2 与@1,-3 当回合末动连夺 cp_sw+cp_nw。预期收益：保留 cp_sw 驻守则 4-3 领先可维持，ranger 续杀 cp_se 驻守后再偷。**改法：偷点前确保有 spare capturer（部署的 scout）或确认原据点对手当回合够不着；"偷一城必不丢一城"是粘性据点局铁律。**

3. **scout 驻守 CP 太脆 vs 应早部署 infantry/heavy durable 驻守。** 触发条件：scout 65hp/def4，对手 infantry 30 atk 每回合 27 伤，2-3 回合杀+夺点；我 cp_nw/cp_w scout 均 38hp 被持续磨死。预期收益：durable 驻守（infantry 100hp/def8 或 heavy 150hp/def13）可多撑 3-4 回合，争取 ranger 击杀窗口。**改法：争夺性据点用 infantry 驻守，scout 只做高速占取后即移交。**

4. **2 个 ranger 都被围杀（R7/R12）vs 应给 ranger 配 screen/escort。** ranger 72hp/def3 脆，单独前出必被步兵 range1 围杀。改法：ranger 行动有步兵/ scout 前置遮挡，或始终从对手 moveRange 外的安全格出击。

## 与历史对局对比

- **tg_0135_lose_ZC@glm5.2.md**（同模型 glm5.2，simultaneous/standoff，2 人，第15轮终审负）：那局核心口诀"杀伐的胜利若不兑换成据点控制，就只是给对手做嫁衣"——**本局完美复现此教训**。我 R7/R10/R12 三次用 ranger 换杀对手 scout（赢了每一场局部交火，340:584 虽输总伤但击杀比 3:5 不算差），但每次偷取的据点（cp_ne/cp_se/cp_e）都被对手当回合或次回合反夺，**杀伤从未固化为据点存量**，终局 1:6 据点完败。同模型 glm5.2 在据点权重高的标准/同时局，共同的失败模式是"战术动作漂亮但据点留存失败"。
- **tg_0184_lose_OMP@qwen3.8v27b.md**（同 agent OMP，annihilation/artillery-zone，第12轮终审负 710:944）：那局教训"集火纪律落后 + 单兵连送 ranger 进危险盒"。**本局重蹈覆辙**——我 2 个 ranger（R5/R8 部署共 136 supplies）分别在 R7/R12 被对手步兵围杀，136 造价打水漂；与 tg_0184 的"R10 把 37 血 ranger 放进 (0,0) 被先手带走"如出一辙。**OMP agent 在 ranger 使用上反复犯"孤兵前出被围杀"的错。**
- 本局新发现：standard 模式下对手以 **repair CP（cp_center）作为步兵工厂**（deploy 源 + 自愈 + 枢纽）出 8 步兵海，对 scout 驻守形成降维打击——此前记录未见此打法，值得在后续 standard 局警惕并优先争夺/破坏 repair CP。

## 总结

### 做得好的
1. R1-R3 利用 CP 粘性连占 cp_w/cp_nw/cp_sw 并全驻守，一度 4-3 反超（R7、R10、R12 三度领先）。
2. R7/R10/R12 三次 ranger 换杀+偷点连段，单次杠杆 +150，战术设计正确（attack后可移、2击杀 scout、即时踏入偷取）。
3. R14 末局死守：cp_w 换 durable 79hp infantry 驻守撑过 R15 终审，保住最后 1 据点（75 分）。

### 下次改进
1. ranger 永远从无对手邻接的安全格出击，攻击后即撤，绝不进入步兵 range1 包围圈。
2. 偷据点前必须有 spare captainer 或确认原据点对手当回合夺不到——"偷一城不丢一城"。
3. 争夺性据点用 infantry/heavy durable 驻守，scout 仅高速占取后移交；优先争夺/破坏对手 repair CP 步兵工厂。
> **核心口诀：粘性据点局，杀敌不守点等于白杀——ranger 出击必带退路，偷城必不丢城，争点必用 durable 驻守。**

**一句话总结：我三次用 ranger 换杀对手 scout 并偷取 cp_ne/cp_se/cp_e 三度反超，却因 ranger 孤兵被围杀（R7/R12）和偷点调走驻守连丢两城（R10），杀伤从未固化为据点存量，被对手 cp_center 步兵海从 4-3 一路压到 1-6，终审 504:1141 完败——再次验证"杀伐胜利不兑换据点就是给对手做嫁衣"。**
