# 战术游戏歼灭模式复盘 — `player_a` 视角

**日期/游戏ID/回放版本:** 2026-08-27 / `6fce3079-32cf-49bd-9e84-65dc54e62ed9` / 3.3.4
**地图/参战人数:** `artillery-zone`（炮火禁区，半径6全平地六边形，12个据点）/ 2人；**模式:** annihilation
**玩家:** Qwen3.8v27b-OMP（OMP@qwen3.8v27b）
**席位与出生:** `player_a`，行动顺序第1（`turnOrder: [player_a, player_b]`），`slot_east`，初始 2×infantry @(5,0)、(5,-1) + heavy @(4,1)，初始控制点 `cp_east` @(4,0)；HQ：不适用（无HQ）
**对手:** Qwen3.8Flash-QD（`player_b`，`slot_west`，后手）
**结果:** 🏆第1名 — `turn_limit_score`
**结束轮次:** 第12/12整轮（满12整轮后裁决，seq 216）
**最终存活单位/补给:** 6 / 113（对手 1 / 217）
**裁决总分:** 996（armyValue 258×2=516 + actionScore 480；controlPoints 4、supplies 113 权重0，不构成裁决分）

> 数据来源：回放 `records/V3/tg_0123_20260827.json`（schema 3.3.4，216条事件）。单位ID使用8位前缀；坐标、伤害、补给、收入、炮火与 seq 均以事件 payload 为准。我方回合操作经 `skill/play-hex-api-game` 逐回合执行，事件类型/seq 已与回放核对。

## 玩家与最终排名（`game_over.payload.rankings`，seq 216）

| 名次 | 席位 | 玩家 | 状态 | 总分 | 关键项（本局权重） |
|---:|---|---|---|---:|---|
| **1** | **`player_a`** | **Qwen3.8v27b-OMP（我）** | 存活 | **996** | armyValue 258×2=516、actionScore 480、CP 4×0、supplies 113×0 |
| 2 | `player_b` | Qwen3.8Flash-QD | 存活 | 462 | armyValue 41×2=82、actionScore 380、CP 5×0、supplies 217×0 |

本局裁决权重（`config.balance.adjudicationWeights`）：`enemyHqDamage=0`、`ownHqHp=0`、`controlPoint=0`、`armyValue=2`、`supplies=0`、`effectiveActions=10`。有效赛道只有 **armyValue×2** 与 **actionScore（actionMerit×10）**；据点和补给只通过收入、部署与行动 merit 间接影响胜负。

---

## 游戏进程时间线

> 补给格式为“回合初→回合末”；行动点为“已用/4”。每行覆盖我方 `player_a` 一个席位回合；“局势变化”列含 `player_b` 关键行动与整轮边界炮火。炮火配置：`startRound=5`、`intervalRounds=2`、`damage=25`、`minimumSafeRadius=2`。

| 整轮/席位回合 | 补给 | 行动点 | 关键操作与坐标 | 局势变化（含 `player_b`/炮火） | 战术意图 |
|---|---:|---:|---|---|---|
| 第1轮 / `player_a` | 45→7 | 4/4 | 从 `cp_east` 部署 scout `d497c5b2`@(3,1)（38，seq4）；inf `3f92419c`(5,0)→(3,0) **占 `supply_east`**（seq8）；inf `2308ef74`(5,-1)→(3,-2)；heavy `dc86a82e`(4,1)→(2,2) | `player_b` 镜像占 `supply_west`（seq16），从 `cp_west` 部署 scout `d840f7c7`@(-4,1)（38） | 抢东侧首个补给点，部署侦察单位 |
| 第2轮 / `player_a` | 7→27 | 4/4 | inf `2308ef74`(3,-2)→(3,-3) **占 `supply_northeast`**（seq25）；scout `d497c5b2`(3,1)→(0,3) **占 `supply_southeast`**（seq26）；inf `3f92419c`(3,0)→(1,0)；heavy `dc86a82e`(2,2)→(1,1) | `player_b` 占 `supply_southwest`（seq34）、部署 scout `1395423c`@(-4,-1) | 一口气补两个 supply，R3起 4CP 收入36/轮 |
| 第3轮 / `player_a` | 27→63 | 4/4 | 从 `cp_east` 部署 scout `b085ad35`@(3,1)（38，seq39）；inf `3f92419c`(1,0)→(-1,0)，攻敌 inf `8cc9c9aa`(-2,0) 23（100→77，seq41）；heavy `dc86a82e`(1,1)→(0,0)；scout `d497c5b2`(0,3)→(0,1) | `player_b` inf `3613962c` 攻我 scout `d497c5b2` 29，heavy `86c95647` 前压至(-1,-1)，inf `8cc9c9aa` 攻我 `3f92419c` 19 | 前压步兵开第一刀；⚠️ scout `d497c5b2` 站位过前被削到 36 |
| 第4轮 / `player_a` | 63→61 | 4/4 | inf `3f92419c` 攻 `8cc9c9aa` 19（58，seq58）；heavy `dc86a82e`(0,0)→(0,-1) 攻敌 heavy `86c95647`(-1,-1) 28（150→122，seq59-60）；scout `d497c5b2`(0,1)→(1,2) 后撤；inf `2308ef74`(3,-3)→(1,-1) 支援 | `player_b` `3613962c` 攻我 23、`86c95647` 攻我 heavy 26，`1395423c` 占 `supply_northwest`（seq70）；**R4 首次炮火预警**（seq55，safe6→5） | 开始集火敌 heavy；scout 撤出前线 |
| 第5轮 / `player_a` | 61→97 | 4/4 | heavy `dc86a82e` 攻 `86c95647` 23（122→84?→99 递推，seq76）；inf `3f92419c` 攻 `86c95647` 15；inf `2308ef74`(1,-1)→(0,0) 攻 `3613962c` 24（100→76，seq78-79）；scout `b085ad35`(3,1)→(1,1) | **R5 收缩 safe6→5**（seq73）；`player_b` 从 `cp_west` 部署 ranger `a5beff64`@(-3,-1)（72），重装改向 | 三单位集火敌 heavy + 削敌步兵 |
| 第6轮 / `player_a` | 97→133 | 4/4 | inf `3f92419c` 攻 `86c95647` 20（濒死前输出）；heavy `dc86a82e` 攻 `86c95647` 26；inf `2308ef74` 攻 `3613962c` 20（56）；scout `b085ad35`(1,1)→(0,1) 攻 `3613962c` 5（51） | `player_b` ranger `a5beff64` 攻我 inf `3f92419c` 36→**击杀**（seq101-102）；`3613962c` 攻我 scout `b085ad35` 23；heavy `86c95647` 后撤至(-2,-1) | 用被围死的 `3f92419c` 换最后一刀；敌 heavy 被我压回 |
| 第7轮 / `player_a` | 133→169 | 4/4 | heavy `dc86a82e`(0,-1)→(-1,-1) 攻 `86c95647`(-2,-1) 22；inf `2308ef74`(0,0)→(-1,-2) 攻 `86c95647` 20 → **击杀敌 heavy**（seq111-115）；scout `b085ad35` 攻 `3613962c` 6（45）；从 `cp_east` 部署 ranger `15574e58`@(3,1)（72，seq117） | **R7 收缩 safe5→4**（seq108）；`player_b` 无重大动作，scout `1395423c` 转向 | 双路夹击杀掉敌方核心 heavy（92） |
| 第8轮 / `player_a` | 169→133 | 4/4 | heavy `dc86a82e`(-1,-1) 攻 inf `8cc9c9aa`(-1,0) 28（58→30，seq129）；inf `2308ef74`(-1,-2)→(0,-1) 攻 `8cc9c9aa` 23（→7）；scout `b085ad35` 攻 `3613962c` 7（38）；ranger `15574e58`(3,1)→(1,1) | **R8 预警 safe4→3（seq126）**；`player_b` ranger `a5beff64` 攻我 heavy 34、`8cc9c9aa` 攻 18、`3613962c` 攻我 scout 27，从 `cp_west` 部署 heavy `e78b7eae`@(-3,0)（92，seq140） | 双杀线逼近；敌方补出第二台 heavy 反击 |
| 第9轮 / `player_a` | 133→169 | 4/4 | inf `2308ef74` 攻 `8cc9c9aa` 24 → **击杀**（seq149-150）；heavy `dc86a82e`(-1,-1)→(-2,-1) 攻敌 ranger `a5beff64` 34（47→13，seq152）；ranger `15574e58`(1,1) 攻 `3613962c` 33（seq153）；scout `b085ad35` 攻 `3613962c` 11 → **击杀**（seq154-155） | **R9 收缩 safe4→3（seq143）**，炮火打敌 `d840f7c7`(-4,4)、`1395423c`(-1,-3)、`a5beff64`(-3,-1) 各-25；`player_b` 新 heavy `e78b7eae` 攻我 heavy 27 → **击杀我 heavy `dc86a82e`**（seq159-160） | 双杀敌步兵；牺牲性压敌 ranger；我方 heavy 换掉敌 heavy 后被新车补刀 |
| 第10轮 / `player_a` | 169→205 | 4/4 | 从 `supply_east` 部署 heavy `e181c11e`@(2,0)（92，seq169，**来源由 `cp_east` 迁移**）；scout `b085ad35`(0,1)→(0,2)；inf `2308ef74`(0,-1)→(-1,0) 攻敌 ranger `a5beff64` 24 → **击杀**（seq171-173）；从 `supply_east` 部署 ranger `cfde134e`@(2,1)（72，seq174） | **R10 预警 safe3→2（seq166）**；`player_b` 无新单位（收入被囤） | `cp_east`(d4) 已入危险区，改从仍安全的 `supply_east`(d3) 补兵；清掉敌唯一远程 |
| 第11轮 / `player_a` | 205→113 | 4/4 | inf `2308ef74`(-1,0)→(0,-1)；scout `d497c5b2`(1,2)→(0,1) 撤出危险区；heavy `e181c11e`(2,0)→(1,0)；ranger `cfde134e`(2,1)→(2,0) 撤出危险区 | **R11 收缩 safe3→2（seq180）**：炮火打我方 `d497c5b2`(-25)、`cfde134e`(-25)，同时打敌 `d840f7c7`(-25)、`1395423c`(-25)、heavy `e78b7eae`(-25)；敌 scout 均降至 15，重装降至 125 | 把两个 d=3 单位撤进半径2，代价本人吃50炮火，但敌三单位吃75 |
| 第12轮 / `player_a` | 113→113 | 4/4 | inf `2308ef74` 攻 scout `1395423c` 28 → **击杀**（seq202-203）；ranger `15574e58` 攻 scout `d840f7c7` 43 → **击杀**（seq204-205）；heavy `e181c11e`(1,0)→(-1,0) 攻敌 heavy `e78b7eae` 28；ranger `cfde134e`(2,0)→(1,0) 攻敌 heavy 30（125→67） | `player_b` 终局仅剩 heavy `e78b7eae`(-2,0)67，攻我 heavy 22；满轮裁决 | 清光敌双 scout，双路再压敌 heavy 打残；锁定 armyValue 与行动分 |

---

## 我方关键策略与执行效果

1. **R1–R2 抢齐 3 个东侧 supply，R3 起 4CP 收入 36/轮**
   - 结果：✅ 有效。`supply_east`(R1)、`supply_northeast`/`supply_southeast`(R2) 落地，加初始 `cp_east`，从 R3 起每轮 +36（base8 + cp_east4 + 3×supply8）。
   - 对照：对手虽拿了 5 个据点（`cp_west`+`cp_southwest`+3×supply，R5 起 +40/轮），但补给只会囤积不转化为军力；我 36/轮 的节奏支撑了 **5 次部署 312**（scout 76、ranger 144、heavy 92）。据点权重 0，优先服务收入与部署通道，占 west 侧无用。

2. **开局即前压，中路步兵交换建立击杀优势**
   - 结果：✅ 有效。R3 我把初始 inf `3f92419c` 顶到 (-1,0) 先手削敌 inf；R4–R6 用 `3f92419c`(濒死被围) 当“最后一击载体”连续对敌 heavy 输出 20+15+19，直到 R6 被敌 ranger 收掉。它 4 攻共 77 伤后阵亡，换掉敌巡逻节奏。
   - 对照：对手 R3–R6 把火力撒在我 `3f92419c`/scout/heavy 上，未形成对任何我方的击杀以外的单点集火；我方则始终围绕“先砍最弱兵，再砍高价值车”推进。

3. **R7 双路集火击杀敌方核心 heavy `86c95647`（92）**
   - 结果：✅ 有效。我方 heavy `dc86a82e`(22) + inf `2308ef74`(20) 双路把敌 heavy(灌至 0)击毙（seq115），去掉敌方坦克后第 8 回合起我方前场彻底摆脱重甲对线压力。依次击杀敌人顺序符合“可击杀单位→高价值单位”：R7 敌 heavy → R9 双 inf → R10 敌 ranger → R12 双 scout。

4. **R10 部署来源从 `cp_east` 迁到 `supply_east`，保住内圈扩张**
   - 结果：✅ 有效。`cp_east`(d4) 在 R9 半径 3 时已入危险区，且是唯一初始部署垫；R10 果断把重装 `e181c11e` 与 ranger `cfde134e` 从仍安全的 `supply_east`(d3, 距中心3) 落地，两单位赶到中路形成 R12 对敌 heavy 的夹击。据点被炮火吃掉前“向内迁移”是本局部署通道管理的关键。

5. **R11 撤离半径2 保护军力，让敌方吃足炮火**
   - 结果：✅ 有效。R11 收缩前我把 `d497c5b2`(1,2)、`cfde134e`(2,1)、heavy `e181c11e`(1,0)、inf `2308ef74`(0,-1) 全部移入安全半径，我方 2 单位共吃 50 炮火；而敌方 scout `d840f7c7`、`1395423c`、heavy `e78b7eae` 3 单位共吃 75，两只 scout 被削到 15，直接被我 R12 补刀。整局炮火换血 **我方-50 vs 敌方-175**。

6. **终局 armyValue + actionScore 双领先**
   - 结果：✅ 有效。终局我方 6 单位存活（armyValue 258）vs 敌方 1 残车（41），×2 后 516 vs 82；actionScore 480 vs 380（`effectiveActions=10`）。R12 四发全部落到击杀/压车，无空转。

---

## 我方关键失误与风险

1. **前期 scout `d497c5b2` 前压过深，白吃 55 战斗伤**
   - 事实：R3 我把 scout 推到 (0,1) 后被 `3613962c` 29、`86c95647` 26 连打（65→36），R4 才后撤到 (1,2)，R9 仍在 (1,2) 被炮火再削。终局它 11/65，value 仅 6。
   - 评估：侦察单位不该贴住主力前线；若早一轮后撤到 (0,2)/(1,1) 可省约 30 无谓承伤。属小失误，不影响胜负。

2. **重装 `dc86a82e` 长期暴露在敌 ranger 射程，R9 被新 heavy 收掉**
   - 事实：R5–R8 我 heavy(-1,-1)/(0,-1) 顶在(-1,-1)，连续被敌 ranger `a5beff64`(射程3) 28+34 与步兵 8cc9c9 17+18 削减，hp 124→79→27，R9 被敌第二台 heavy `e78b7eae` 27 击杀（seq160）。
   - 取舍：该 heavy 已在本局完成最大功绩（R7 击毙敌核心 heavy），换掉 92 车虽痛但不清算错误；教训是**当敌方有射程3的 ranger 时，我方 melee 坦克应尽量与 ranger 保持 >2 格或先清 ranger**。若 R9 先集火打残敌 ranger 再撤 heavy，可省 27 承伤。

3. **R11 inf `2308ef74` 追击越界浪费半回合**
   - 事实：R11 我让 inf 移到 (0,-1) 意图补刀敌 scout `1395423c`(-1,-2)，实则 (0,-1) 距目标为 2（越出 melee 1 格），攻击被伺服器拒绝（`invalid_attack` out of range）。
   - 教训：每发 attack 前需按中心距复核（`max(|dq|,|dr|,|dq+dr|)`）；本局另有多处因截断 unitId 导致的 `target_not_found` 重试，属于执行冗余，需在取 id 时用完整值。

4. **让敌方拿到 5 据点（+40/轮）但未转化为威胁**
   - 事实：对手 `supply_northwest`(R4)、`cp_southwest`(R3) 全被我放掉，敌终局补给 217 是我方 113 的近 2 倍。但敌人把补给囤在银行（终局只部署 4 个单位 240），未兑换成存活军力，故不构成裁决威胁。**教训：在 `controlPoint=0`、`supplies=0` 的地图上，放外圈据点换资源安全区是合理的，但要盯住对方是否把补给换成单位。**

---

## 单位结算（8位 ID 前缀）

### 我方 player_a

| 单位 | 类型/来源 | 终局位置/结局 | HP | value | 造成伤害 | 承受战斗伤 | 被治疗 | 炮伤 | 关键说明 |
|---|---|---|---|---|---:|---:|---:|---:|---:|---|
| `3f92419c` | infantry/初始 | R6 阵亡 @(-1,0) | 0/100 | 0 | 77 | 100+ | 0 | 0 | R1 占 `supply_east`；R4–R6 濒死连刀敌 heavy，R6 被敌 ranger 36 击杀 |
| `2308ef74` | infantry/初始 | (0,-1) | 100/100 | 45 | 145+ | 0 | 0 | 0 | R2 占 `supply_ne`；R7 参与杀敌 heavy；R9 杀 `8cc9c9`、R10 杀 ranger、R12 杀 `1395423c` |
| `dc86a82e` | heavy/初始 | R9 阵亡 @(-2,-1) | 0/150 | 0 | 130+ | 144+ | 0 | 0 | R7 击毙敌核心 heavy `86c95647`；R9 被新 heavy `e78b7eae` 27 击杀 |
| `d497c5b2` | scout/R1 部署 | (0,1) | 11/65 | 6 | 0 | 55 | 0 | 25 | R2 占 `supply_se`；前期前压吃伤，R11 吃炮火 |
| `b085ad35` | scout/R3 部署 | (0,2) | 15/65 | 9 | 29 | 50 | 0 | 0 | R6–R9 削敌 inf `3613962c`（含 R9 击杀补刀 11） |
| `15574e58` | ranger/R7 部署 | (1,1) | 72/72 | 72 | 76 | 0 | 0 | 0 | R9 击杀 `3613962c`(33)；R12 击杀 `d840f7c7`(43)；全程未受伤 |
| `e181c11e` | heavy/R10 部署 | (-1,0) | 128/150 | 78 | 28 | 22 | 0 | 0 | R10 从 `supply_east` 落地；R12 攻敌 heavy 28 |
| `cfde134e` | ranger/R10 部署 | (1,0) | 47/72 | 47 | 30 | 0 | 0 | 25 | R11 吃炮火 25；R12 攻敌 heavy 30 |
| **合计** | 8 单位（3初始+5部署） | 6 存活 | 437 | **258** | **515** | **~410** | 0 | **50** | 终局 armyValue=258；击杀 6 |

### 对手 player_b

| 单位 | 类型/来源 | 终局位置/结局 | HP | value | 造成伤害 | 承受战斗伤 | 被治疗 | 炮伤 | 关键说明 |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---|
| `8cc9c9aa` | infantry/初始 | R9 阵亡 | 0/100 | 0 | 54 | 100+ | 0 | 0 | R1 占 `supply_west`；R5–R9 被我削，R9 被 `2308ef74` 24 击杀 |
| `3613962c` | infantry/初始 | R9 阵亡 | 0/100 | 0 | 70+ | 100+ | 0 | 0 | R6–R9 被我 scout+ranger 集火，R9 被 `15574e58`+`b085ad35` 击杀 |
| `86c95647` | heavy/初始 | R7 阵亡 | 0/150 | 0 | 71+ | 150+ | 0 | 0 | 敌方核心车，R4–R7 被我三单位集火，R7 被我双路击杀 |
| `d840f7c7` | scout/R1 部署 | R12 阵亡 | 0/65 | 0 | 0 | 45 | 0 | 50 | R2/R3 占 `supply_sw`、`cp_sw`；R9/R11 吃炮火×2，R12 被我 ranger 43 击杀 |
| `1395423c` | scout/R2 部署 | R12 阵亡 | 0/65 | 0 | 0 | 53 | 0 | 50 | R4 占 `supply_nw`；R9/R11 吃炮火×2 至 15，R12 被我 inf 28 击杀 |
| `a5beff64` | ranger/R5 部署 | R10 阵亡 | 0/72 | 0 | 102 | 71 | 0 | 25 | 敌方远程，R6 杀我 `3f92419c`、R5–R8 削我 heavy；R9 吃炮火，R10 被我 inf 24 击杀 |
| `e78b7eae` | heavy/R8 部署 | (-2,0) | 67/150 | 41 | 58 | 58 | 0 | 25 | 敌方第二台 heavy，R9 杀我 `dc86a82e`；R11 吃炮火，R12 被我双 unit 压至 67 |
| **合计** | 7 单位（3初始+4部署） | 1 存活 | 67 | **41** | **~501** | **~577** | 0 | **175** | 终局 armyValue=41；击杀 2 |

> **击杀差 6:2。** 我方 6 杀（重装+2inf+2scout+ranger），死亡仅 `3f92419c`(R6) 与 `dc86a82e`(R9)；对方 2 杀（我 scout 与 heavy 各 1），且双方均无治疗单位。炮火：我方 2 单位共吃 50，对方 4 单位共吃 175，其中双 scout 被炮火削至可击杀。

---

## 炮火与安全区时间线

| 轮次 | 事件 | safeRadius | 关键格（d>safe） | 我方单位位置 / 结果 |
|---:|---|---:|---|---|
| R4 | 首次 `artillery_warning`（seq55） | 6 | warning 仅 d=6 外环 | 我方全单位 d≤3，无风险 |
| R5 | `artillery_shrunk`（seq73） | 5 | 无 d≥6 | 我方零承伤 |
| R6 | `artillery_warning`（seq90） | 5 | warning 外环 | 我方在 d≤2 附近 |
| R7 | `artillery_shrunk`（seq108） | 4 | d>4 变险 | 我方 `dc86a82e`(-1,-1,d2)、infB(-1,-2,d2) 安全；ranger(3,1,d3) 安全 |
| R8 | `artillery_warning`（seq126） | 4 | `cp_east`(4,0,d4) 预告将险 | 我方无单位站险；但部署垫 `cp_east` 进入预告 |
| R9 | `artillery_shrunk`+`damage`（seq143-146） | 3 | d>3 | 我方零承伤；敌 `d840f7c7`(-4,4)、`1395423c`(-1,-3)、`a5beff64`(-3,-1) 各-25 |
| R10 | `artillery_warning`（seq166） | 3 | `supply_east`(3,0,d3) 预告将险 | 果断改从 `supply_east` 二次部署（仍然安全） |
| R11 | `artillery_shrunk`+`damage`（seq180-185） | 2 | min 半径 | 我方 `d497c5b2`(1,2,d3)-25、`cfde134e`(2,1,d3)-25；敌3单位-75 |
| R12 | 无收缩（min=2） | 2 | — | 我方已全部撤入 d≤2；零承伤 |

关键几何：`supply_east`(3,0,d3) 在 R11 半径2 前一直是我方最新部署垫；`cp_east`(4,0,d4) 从 R9 起失效。我方在 R11 前 1 轮主动把 `d497c5b2`、`cfde134e` 撤入 d≤2，换回整局仅 50 炮伤；敌方把双 scout 和 heavy 留在 d>2，累计吃 175。

---

## 历史对局对比

| 对局 | 地图/模式/结果 | 与本次共同点 | 本次差异/改进或退步 |
|---|---|---|---|
| `tg_0116`（2026-08-20 win） | artillery-zone / annihilation / `turn_limit_score` 1198:650 | 同为 OMP@qwen3.8v27b；R1–R3 抢 supply 建立收入；把补给转部署；armyValue 决胜 | 0116 走“heavy 对轰 + support 治疗链”，终局 8 单位 254；本局**无治疗、纯换血**，终局 6 单位 258，且把击杀做成 6:2（更凶）。共同短板：都有单位在 d=3 吃炮火，本局只吃 50、干得更好。 |
| `tg_0114`（2026-08-20 win） | artillery-zone / annihilation / `last_player_standing` | 炮火收缩管理；抢点+暴兵 | 本局同靠收入→军力，但**新增“部署垫内迁”（cp_east→supply_east）**与 R11 主动撤入半径2 保住 armyValue；推进更贴着裁决分权重（armyValue=2）打。 |
| `tg_0112`（2026-08-20 win） | artillery-zone / annihilation | 炮火收缩前撤离 | 本局把“预警先撤离”执行得更彻底：R11 半径2 前全部撤出危险区；没有 0116 那种留在 d=3 吃两轮炮火的失误（本局只吃一轮、且是被迫贴边）。 |

对手 `player_b` 的败因（从回放归纳）：收入(40/轮)充足但部署量低（仅 4 单位 240，囤 217），始终没有把补给兑现成存活军力；R7 损失核心 heavy 后只能用 ranger 远程消耗，最终 armyValue 41 vs 258 的差距不可逆转。其占下的 5 个外圈据点因 `controlPoint=0` 权重而无裁决价值。

---

## 炮火、军力与裁决分账本

`adjudicationWeights`：`enemyHqDamage=0 / ownHqHp=0 / controlPoint=0 / armyValue=2 / supplies=0 / effectiveActions=10`

| 项目 | 数量/数值 | 权重 | 依据 |
|---|---:|---:|---|
| HQ伤害 / HQ最终HP | 不适用（无HQ） | 0 | `mode=annihilation`，`headquarters={}` |
| 最终据点数 | 我方 4（`cp_east`+`supply_east`+`supply_ne`+`supply_se`）vs 敌方 5 | 0 | `control_point_captured`；仅服务收入/部署 |
| 存活军力价值 | 我方 **258** vs 敌方 **41** | 2 | `game_over`（6 存活单位 vs 1 残车） |
| 剩余补给 | 我方 **113** vs 敌方 **217** | 0 | `income`/`deploy`（敌囤而不花） |
| `actionScore`（actionMerit×10） | 我方 **480**（merit48）vs 敌方 **380**（merit38） | 10（内含） | 5部署+3占点×2+攻击/击杀 merit；终局两回合全用于击杀/压车 |
| 炮火承伤/击杀 | 我方 50 承伤/0 炮杀；敌方 175 承伤/0 炮杀 | — | `artillery_damage`（非独立裁决项，但削敌助我击杀） |
| **总分** | **996 : 462** | — | `game_over.payload.scores` |

我方军力价值构成：`2308ef74`(45) + `e181c11e`(78) + `15574e58`(72) + `cfde134e`(47) + `d497c5b2`(6) + `b085ad35`(9) ≈ 257（官方 258）。敌方仅 `e78b7eae`(41)。

---

## 实际做法 vs 正确做法

- **正确**：R1–R2 抢齐东侧 3 supply → 收入 36/轮；R3 起每轮集火“可击杀→高价值”；R7 双路击毙敌核心 heavy；R10 部署垫内迁 `cp_east→supply_east`；R11 主动撤入半径2 保住 armyValue；R12 清双 scout＋双路压敌残车，armyValue/actionScore 双领先。
- **可改进（执行层）**：
  1. 每次 `attack` 前先复核中心距 `max(|dq|,|dr|,|dq+dr|)`，避免越界 `invalid_attack`（R11 infB 一次）。
  2. 调用 API 用完整 unitId，勿截断导致 `target_not_found` 重试。
  3. scout `d497c5b2` 前期顶太前白吃 55 伤；侦察单位应与前线保留≤1格缓冲。
  4. 面对敌射程3 ranger，我方 melee heavy 应与其保持>2格或先清 ranger（本局 `dc86a82e` 被 ranger 磨至27后被新 heavy 收走）。
  5. 未部署 extra unit 以对冲敌 40/轮收入——若敌方把囤积补给转成单位，分差会更紧；本局恰好对手不会兑现军力。

---

## 总结

> **核心口诀：预警先撤离保军力，据点向内迁保部署；把收入直接换成存活军力，用 actionScore 收割。**

**一句话总结：** R1–R2 抢齐东侧3个 supply 建立 36/轮收入，R3 起用“先砍弱兵再砍高价值车、R7集火击毙敌方核心heavy、R10部署垫由cp_east内迁supply_east、R11全员撤入半径2”四连招，把补给全部兑现成 6 存活单位与 6:2 击杀，终局 armyValue 258:41、actionScore 480:380，**996:462 裁决取胜**；代价仅 50 炮伤，远小于敌方 175。

---

## 附录：关键坐标

| 实体 | 所属 | 坐标 | 说明 |
|---|---|---|---|
| `supply_east` | `player_a` | (3,0) | R1 占，R10 起主要部署来源 |
| `supply_northeast` | `player_a` | (3,-3) | R2 占 |
| `supply_southeast` | `player_a` | (0,3) | R2 占 |
| `cp_east` | `player_a` | (4,0) | 初始垫，R9 起入危险区（d4） |
| `supply_west` / `cp_southwest` 等 5 据点 | `player_b` | 西/南侧 | 敌占，权重0无裁决价值 |
| `supply_northwest` | `player_b` | (0,-3) | R4 敌占，皮蛋 scout `1395423c` R12 被我杀 |
| 敌方残车 `e78b7eae` | `player_b` | (-2,0) | 终局 67/150，※唯一存活 |

---

*文档生成时间: 2026-08-27*
*回放格式版本: 3.3.4*
*AI模型: OMP@qwen3.8v27b*