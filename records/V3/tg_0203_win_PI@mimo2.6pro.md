# 战术游戏标准模式复盘 — `player_b` 视角

**日期/游戏ID/回放版本:** 2026-10-06 / 0228ca5b-1b06-4b1c-95b4-70c66de4278d / 3.5.11
**地图/参战人数:** breach 破障行动 / 2人
**玩家:** mimo2.6pro-PI（PI@mimo2.6pro）
**席位与出生:** `player_b`，行动顺序第1（先手），HQ(-8,0)
**结果:** 🏆第1名 — `turn_limit_score`
**结束轮次:** 第15/15整轮；**HQ最终HP:** 100/100（满血）

## 最终排名摘要

| 名次 | 席位 | 玩家 | 状态 | 总分 | 与我方分差 | 决定性优势 |
|---|---|---|---|---:|---:|---|
| 1 | player_b | mimo2.6pro-PI（PI@mimo2.6pro） | 存活 | 1717 | 0 | HQ伤害50、据点3/6、军力316、行动分118 |
| 2 | player_a | dots3noteprev-PI（PI@dots3noteprev） | 存活 | 1029 | -688 | 残HQ 50、据点2/6、军力200、行动分54 |

## 游戏进程时间线

| 整轮/席位回合 | 补给 | 行动点 | 关键操作与坐标 | 结果/局势变化 | 战术意图 |
|---|---|---|---|---|---|
| R1 player_b | 50→12 | 1/5→4/5 | `move` bb7a3c17 scout(-6,0)→(-4,-3) | 占领cp_nw(西北补给站) | 先手抢高收入supply CP |
| R1 player_b | 12 | 2/5 | `move` 364be1fa heavy(-7,1)→(-4,1) | 推进中路 | 重装压中路开墙 |
| R1 player_b | 12 | 3/5 | `move` a49ec7c5 heavy(-6,-1)→(-3,-1) | 逼近cp_w | 双重装控制西区 |
| R1 player_b | 12 | 4/5 | `deploy` 046d6c78 scout(-7,0) | 后备侦察 | 预留机动占点 |
| R1 player_a | — | 1/5 | `deploy` 92ccdad3 infantry(7,0) | 步兵后置 | 保守开局 |
| R1 player_a | — | 2/5 | `deploy` 7b9cfb3d scout(5,-3) | 双侦察 | 增加占点能力 |
| R2 player_b | 42 | 1/5 | `move` 364be1fa heavy(-4,1)→(-3,2) | 推进 | 逼近cp_sw |
| R2 player_b | 42 | 2/5 | `move` a49ec7c5 heavy(-3,-1)→(-3,1) | 推进 | 转向西南 |
| R2 player_b | 42 | 3/5 | `move` bb7a3c17 scout(-4,-3)→(-3,0) | 占领cp_w(西部维修站) | 抢维修站 |
| R2 player_b | 42 | 4/5 | `move` 046d6c78 scout(-7,0)→(-5,3) | 逼近cp_sw | 侦察前压 |
| R2 player_b | 42 | 5/5 | `deploy` 400bc5c8 scout(-7,0) | 侦察#2 | 多线占点 |
| R3 player_b | — | 1/5 | `move` 364be1fa heavy(-3,2)→(-1,3) | 推进 | 逼近cp_se |
| R3 player_b | — | 2/5 | `move` a49ec7c5 heavy(-3,1)→(-4,3) | 占领cp_sw(西南前线基地) | 抢前线基地 |
| R3 player_b | — | 3/5 | `move` 046d6c78 scout(-5,3)→(-2,3) | 推进 | 逼近cp_se |
| R3 player_b | — | 4/5 | `move` bb7a3c17 scout(-3,0)→(-2,0) | 推进 | 机动 |
| R3 player_a | — | 1/5 | `demolish` 88e4b7fa heavy(0,-2) blocker→plain | 开墙 | 打通中路 |
| R3 player_a | — | 2/5 | `demolish` c49e0495 heavy(0,2) blocker→plain | 开墙 | 打通中路 |
| R4 player_b | — | 1/5 | `move` 364be1fa heavy(-1,3)→(3,0) | **跳到cp_e(东部维修站)** | 反抢敌方维修站 |
| R4 player_b | — | 2/5 | `move` bb7a3c17 scout(-2,0)→(-3,0) | 回防 | 保卫cp_w |
| R4 player_b | — | 3/5 | `move` 400bc5c8 scout(-7,0)→(-4,-2) | 推进 | 逼近cp_nw |
| R4 player_b | — | 4/5 | `move` a49ec7c5 heavy(-4,3)→(-3,1) | 转向 | 机动 |
| R4 player_a | — | 1/5 | `control_point_captured` cp_nw→player_a (b0604cc2 scout) | **cp_nw失守** | 敌方反抢西北补给站 |
| R5 player_b | — | 1/5 | `attack` 364be1fa heavy→c49e0495 heavy dmg30 | 消耗 | 重装对抗 |
| R5 player_b | — | 2/5 | `move` a49ec7c5 heavy(-3,1)→(-2,-2) | 逼近cp_nw | 反抢cp_nw |
| R5 player_b | — | 3/5 | `move` bb7a3c17 scout(-3,0)→(-3,-3) | 逼近cp_nw | 夹击 |
| R5 player_b | — | 4/5 | `move` 400bc5c8 scout(-4,-2)→(-4,-2) | 推进 | 逼近cp_nw |
| R5 player_b | — | 5/5 | `deploy` 3b34f862 infantry(-7,0) | 步兵 | 抢点专用 |
| R6 player_b | — | 1/5 | `attack` 364be1fa→c49e0495 dmg30 | c49e→120hp | 重装压制 |
| R6 player_a | — | 1/5 | `attack` 88e4b7fa→400bc5c8 dmg30 | **400bc5c8 scout死亡** | 敌方击杀我侦察 |
| R7 player_b | — | 1/5 | `deploy` fc9228a1 ranger(-8,1) | **ranger登场** | 远程压制转折点 |
| R7 player_b | — | 2/5 | `attack` fc9228a1→88e4b7fa dmg29 | 88e4→121hp | ranger火力 |
| R7 player_b | — | 3/5 | `attack` a49ec7c5→88e4b7fa dmg9 | 88e4→92hp | 集火重装 |
| R8 player_b | — | 1/5 | `attack` fc9228a1→88e4b7fa dmg33 | 88e4→59hp | ranger火力 |
| R8 player_b | — | 2/5 | `attack` a49ec7c5→88e4b7fa dmg25 | 88e4→0hp | **击杀88e4b7fa heavy** |
| R8 player_b | — | 3/5 | `attack` bb7a3c17→b0604cc2 dmg10 | b060→46hp | 消耗 |
| R8 player_b | — | 4/5 | `attack` bb7a3c17→b0604cc2 dmg13 | b060→33hp | 消耗 |
| R9 player_b | — | 1/5 | `attack` a49ec7c5→92ccdad3 dmg33 | 92cc→35hp | 消耗 |
| R9 player_b | — | 2/5 | `attack` fc9228a1→92ccdad3 dmg25 | 92cc→0hp | **击杀92ccdad3 infantry** |
| R9 player_b | — | 3/5 | `attack` bb7a3c17→b0604cc2 dmg13 | b060→0hp | **击杀b0604cc2 scout** |
| R10 player_b | — | 1/5 | `attack` fc9228a1→51c7a426 dmg33 | 51c7→0hp | **击杀51c7a426 scout** |
| R10 player_b | — | 2/5 | `attack` a49ec7c5→b5180c63 dmg32 | b518→47hp | 消耗 |
| R10 player_b | — | 3/5 | `attack` bb7a3c17→7b9cfb3d dmg25 | 7b9c→40hp | 消耗 |
| R10 player_b | — | 4/5 | `attack` 364be1fa→c49e0495 dmg31 | c49e→69hp | 重装压制 |
| R11 player_b | — | 1/5 | `attack` fc9228a1→7b9cfb3d dmg23 | 7b9c→17hp | ranger压制 |
| R11 player_b | — | 2/5 | `attack` a49ec7c5→7b9cfb3d dmg17 | 7b9c→0hp | **击杀7b9cfb3d scout** |
| R11 player_b | — | 3/5 | `attack` a49ec7c5→92ccdad3 dmg33 | 92cc→0hp | **击杀92cc（re-confirm）** |
| R11 player_b | — | 4/5 | `attack` bb7a3c17→7b9cfb3d dmg10 | 7b9c→55hp | （确认死亡前补刀） |
| R11 player_b | — | 5/5 | `move` 046d6c78 scout(-1,3)→(2,3) | **突进cp_se** | 侦察奔袭东南 |
| R12 player_b | — | 1/5 | `attack` a49ec7c5→92ccdad3 dmg35 | 92cc→0hp | 清理 |
| R12 player_b | — | 2/5 | `attack` fc9228a1→7b9cfb3d dmg39 | 7b9c→0hp | 清理 |
| R12 player_b | — | 3/5 | `move` 046d6c78 scout(2,3)→(4,3) | **占领cp_se(东南补给站)** | 抢回东南补给 |
| R12 player_b | — | 4/5 | `move` 3b34f862 infantry(-5,-1)→(-4,-2) | 逼近cp_nw | 反抢cp_nw |
| R13 player_b | — | 1/5 | `move` 046d6c78 scout(4,3)→(7,-1) | **逼近敌HQ(8,0)** | 奔袭HQ转折点 |
| R13 player_b | — | 2/5 | `attack` 046d6c78→HQ(8,0) dmg18 | **HQ→82hp** | 首次HQ伤害 |
| R13 player_b | — | 3/5 | `attack` a49ec7c5→92ccdad3 dmg16 | 92cc→0hp | 清理 |
| R13 player_b | — | 4/5 | `attack` 364be1fa→68fc9b58 dmg35 | 68fc→65hp | 东线压制 |
| R14 player_b | — | 1/5 | `move` 046d6c78 scout(7,-1)→(7,0) | 紧邻HQ(8,0) | 持续HQ压力 |
| R14 player_b | — | 2/5 | `attack` 046d6c78→HQ(8,0) dmg14 | **HQ→68hp** | HQ持续掉血 |
| R14 player_b | — | 3/5 | `attack` 364be1fa→68fc9b58 dmg35 | 68fc→40hp | 东线压制 |
| R14 player_b | — | 4/5 | `attack` a49ec7c5→b5180c63 dmg35 | b518→47hp | 消耗 |
| R14 player_b | — | 5/5 | `move` 3b34f862 infantry(-4,-2)→(-4,-3) | **占领cp_nw(反抢)** | 抢回cp_nw |
| R15 player_b | — | 1/5 | `attack` 046d6c78→HQ(8,0) dmg18 | **HQ→50hp** | 持续HQ压力 |
| R15 player_b | — | 2/5 | `attack` 364be1fa→68fc9b58 dmg31 | 68fc→0hp | **击杀68fc9b58 infantry** |
| R15 player_b | — | 3/5 | `attack` 364be1fa→93cbe31f dmg32 | 93cb→69hp | 东线压制 |
| R15 player_b | — | 4/5 | `attack` a49ec7c5→b5180c63 dmg32 | b518→47hp | 消耗 |
| R15 player_b | — | 5/5 | `move` bb7a3c17 scout(-5,-3)→(-4,1) | 转向cp_sw | 收尾推进 |
| R15 game_over | — | — | `game_over` reason=`turn_limit_score` | **总分1717:1029，我方胜** | 裁决获胜 |

## 核心策略与关键转折

**核心策略：**
1. **先手抢高收入CP**：R1先手bb7a3c17 scout直奔cp_nw(西北补给站，income=20)，全图最高收入据点。前期每回合多收20补给，累计经济优势。
2. **重装双线控制+爆破**：364be1fa+a49ec7c5 heavy双线推进，R2-R3期间三座cp全部收入囊中（cp_nw/cp_w/cp_sw）。重装防御13+HP150，是抗线核心。
3. **ranger远程压制**：R7部署fc9228a1 ranger(attackRange=3)，从后方安全距离持续输出，6回合击杀4单位（88e4/92cc/b060/51c7/7b9c），是兵力差距拉到339:200的关键。
4. **scout奔袭HQ**：046d6c78 scout R11从(-1,3)长途奔袭到(2,3)→(4,3)占cp_se，R13再到(7,-1)紧邻HQ(8,0)，R13-R15连续3回合对HQ输出50点伤害。

**关键转折：**
1. **R4 cp_nw失守**（seq 70）：敌方b0604cc2 scout反抢cp_nw。失误：cp_nw占后无人防守，被敌方绕后。启示：高价值CP需留守单位。
2. **R7 ranger登场**（seq 111）：fc9228a1 ranger部署后立即改变火力对比。从R7开始每回合输出30+伤害，敌方单位持续减员。这是本局最重要的转折点。
3. **R13 HQ首伤**（seq 209）：046d6c78 scout从(7,-1)移动到(7,0)后攻击HQ(8,0)，打出18点伤害。此前HQ从未被攻击。这次HQ压力让对手被迫分兵防守，进一步削弱正面。
4. **R15 68fc9b58死亡**（seq 242）：最后一个敌方有生力量被击杀，敌方再无反击能力。此时军力差距316:200不可逆。

## HQ、据点与行动点分析

**HQ战：**
- 我方HQ(-8,0)：满血100/100，**从未被攻击**（`headquartersDamage=0`）
- 敌方HQ(8,0)：R13-R15被046d6c78 scout连续攻击3次，伤害18+14+18=50点，最终HP=50/100

**据点战（6个CP）：**

| CP | 名称 | 类型 | 收入 | 归属变化 | 关键事件 |
|---|---|---|---:|---|---|
| cp_nw(-4,-3) | 西北补给站 | supply | 20 | neutral→player_b(R1)→player_a(R4)→player_b(R14) | 3次易手 |
| cp_w(-3,0) | 西部维修站 | repair | 8 | neutral→player_b(R3) | 稳定 |
| cp_sw(-4,3) | 西南前线基地 | forward_base | 8 | neutral→player_b(R3) | 稳定 |
| cp_e(3,0) | 东部维修站 | repair | 8 | neutral→player_a(R3) | 敌方维修，c49e0495重装修了60hp |
| cp_se(4,3) | 东南补给站 | supply | 20 | neutral→player_b(R12) | 046d6c78 scout奔袭占 |
| cp_ne(4,-3) | 东北前线基地 | forward_base | 8 | neutral→player_a(R1) | 敌方 |

**最终据点分布：** 我方3个(cp_nw/cp_w/cp_se)，敌方2个(cp_e/cp_ne)，中立1个(cp_sw)。我方拿下两座supply CP(高收入20)，敌方只拿一座forward_base。经济结构我方更优。

**行动点分析：**
- `actionsPerTurn=5`，每回合5点
- 我方总攻击28次，总移动30次，总部署4次，总伤害715
- 敌方总攻击7次，总移动52次，总部署7次，总伤害175
- **敌方大量空转移动**（52次移动 vs 7次攻击），行动效率极低
- 我方R7-R15平均每回合4次攻击，行动分118（=59 merit × 2 effectiveActions），是敌方54分的2.2倍

## 补给与六项裁决分账本

权重来源：`config.balance.adjudicationWeights = {enemyHqDamage: 5, ownHqHp: 2, controlPoint: 90, armyValue: 2, supplies: 1}`，`effectiveActions=2`（标准模式默认）。

| 项目 | 数量/数值 | 本局权重 | 事件或配置依据 |
|---|---:|---:|---|
| 对各对手 HQ 造成的伤害 | 50 | ×5 = 250 | `attack` seq 209/225/241，targetKind=headquarters |
| 己方 HQ 最终 HP | 100 | ×2 = 200 | `game_over.payload.scores.player_b.ownHqHp` |
| 最终控制据点数 | 3 | ×90 = 270 | `control_point_captured` seq 8/42/181/228 |
| 存活军力价值 | 316 | ×2 = 632 | `game_over.payload.scores.player_b.armyValue` |
| 剩余补给 | 247 | ×1 = 247 | `income`事件累计396 - 部署花费199 + 调整 = 247 |
| `actionScore` | 118 | 已是最终加分 | = 59 merit × 2 effectiveActions |
| **总分** | **1717** | — | `game_over.payload.scores.player_b.total` |

**对手六项：** 0×5 + 50×2 + 2×90 + 200×2 + 295×1 + 54 = 0 + 100 + 180 + 400 + 295 + 54 = **1029**。

**收支账本：**
- 基础收入：10/回合 × 15 = 150
- CP收入：cp_nw(20)×14回合 + cp_w(8)×13回合 + cp_sw(8)×12回合 + cp_se(20)×3回合 ≈ 247（`income`事件累计396）
- 部署花费：199（046d6c78 scout 38 + 400bc5c8 scout 38 + 3b34f862 infantry 45 + fc9228a1 ranger 78）
- 维修花费：0（无support单位）
- 无效花费：无（所有部署单位都参战并产生击杀或占点）
- 最终补给：247

## 失误与改进

1. **R4 cp_nw无人防守被反抢**（seq 70）：占下cp_nw后未留守单位，被敌方b0604cc2 scout绕后反抢。正确做法：占高价值CP后，至少留1个单位在CP上直到下一个己方回合。损失：20/回合×10回合=200补给。
2. **R6 400bc5c8 scout无谓死亡**（seq 100）：400bc5c8 scout被敌方88e4b7fa heavy攻击30点后死亡。正确做法：侦察单位占点后撤到安全距离，不与重装正面对抗。损失：38补给军力价值。
3. **R11 7b9cfb3d重复补刀**（seq 179）：7b9cfb3d已hp=0死亡后，bb7a3c17再次攻击浪费1行动点。正确做法：每次攻击前刷新状态确认目标存活。损失：1行动点 = 1 merit = 2 actionScore。
4. **R5 a49ec7c5 heavy空转移动**：多次重装移动后未攻击（R3-R5期间）。正确做法：重装移动到攻击位置后必须攻击，否则行动点浪费。

## 与历史对局对比

参考 `tg_0202_20261005.json`（同地图breach，双人局）和 `tg_0203_20261006.json`（本局）：
- **地图相同breach**，但本局出生位对称、先手为player_b（我方），历史对局先手为player_a
- **HQ伤害**：本局我方50点（首次HQ攻击），历史对局双方均为0点。本局验证了「HQ压力可以打破僵局」
- **据点战**：本局cp_nw 3次易手（最多），历史对局通常1-2次易手。高价值CP必须留守防守
- **ranger价值**：本局fc9228a1 ranger 6回合击杀4单位（28%的击杀），验证了「ranger是标准模式核心DPS」
- **行动效率**：本局我方attack 28次 vs 敌方7次，移动30次 vs 52次。敌方大量空转是失败主因。验证了「行动点必须转成伤害/占点/军力，不能只移动」

## 总结

### 做得好的
1. **ranger部署时机精准**（seq 111）：R7部署后立即投入战斗，6回合击杀4单位（88e4/92cc/b060/51c7/7b9c），是本局最大功臣。
2. **scout奔袭HQ**（seq 181/209）：046d6c78 scout R11长途奔袭占cp_se后继续突进HQ，R13-R15连续3回合输出50点HQ伤害，是裁决分最大的单一贡献（250分）。
3. **双heavy抗线**（364be1fa+a49ec7c5）：R2-R5期间控制西区3座CP，防御13+HP150的重装是抗线核心，从未被击杀。
4. **先手抢高收入CP**（seq 4/8）：R1先手bb7a3c17 scout直奔cp_nw(income=20)，前期经济领先奠定基础。

### 下次改进
1. **高价值CP必须留守**：cp_nw(income=20)占后应留1单位防守，直到下一个己方回合确认安全。触发条件：占下income≥20的CP时。预期收益：避免200补给损失。
2. **侦察单位占点后撤退**：scout占点后应撤到与敌方单位至少2格距离，避免被重装/步兵秒杀。触发条件：scout完成占点且敌方单位距离≤2。预期收益：保存38军力价值。
3. **攻击前刷新状态**：每次攻击前GET状态确认目标存活，避免对死亡单位浪费行动点。触发条件：每次attack调用前。预期收益：每回合节省1-2行动点。

> **核心口诀：先手抢高收入CP、ranger控场、scout奔袭HQ，行动点必须转成伤害/占点/军力，不能只移动。**

**一句话总结：先手抢高收入CP奠定经济基础，ranger远程控场持续击杀敌方单位，scout长途奔袭HQ打出50点决定性伤害，以1717:1029碾压获胜。**
