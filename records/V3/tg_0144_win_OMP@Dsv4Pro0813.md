# 战术游戏歼灭模式复盘 — `player_a` 视角

**日期/游戏ID/回放版本:** 2026-09-11 / a39907d5-ee48-4d5d-940f-2fa052059452 / 3.4.7
**地图/参战人数:** artillery-zone / 2 人；**模式:** annihilation
**玩家:** Dsv4Pro0813-OMP（OMP@Dsv4Pro0813）
**席位与出生:** `player_a`，出生点 `slot_west`，初始单位 2×infantry + 1×heavy，出生据点 `cp_west`；HQ：不适用（无HQ）
**结果:** 🏆第1名 — `turn_limit_score`（12 整轮上限裁决，无全歼）
**结束轮次:** 第 12/12 整轮；**最终存活单位/补给:** 4 / 95

## 最终排名与淘汰
| 名次 | 席位 | 状态 | 总分 | 军力价值 | 据点 | 主要死亡/优势原因 |
|---|---|---|---:|---:|---:|---|
| 1 | player_a（我） | active | 1042 | 156 | 4 | 集火拆掉敌方 2 门 ranger + heavy 后取得火力优势，用 9 次击杀换 3 次阵亡 |
| 2 | player_b | active | 628 | 44 | 8 | 远程火力（3 门 ranger）被逐个点杀，军力价值从 254 一路被压到 44 |

> 双人均未被 `player_eliminated`，本局没有 `army_destroyed` / `last_player_standing` / `mutual_annihilation`，纯轮数上限按裁决分排名。

## 炮火与安全区时间线
炮火配置：`startRound=5`，`intervalRounds=2`，`damage=25`，`minimumSafeRadius=2`（radius 6 棋盘，中心 (0,0)）。

| 轮次 | safeRadius | warning/danger 关键格 | 我的单位位置 | 撤离/承伤/击杀 | 决策评价 |
|---|---:|---|---|---|---|
| R4 | 6 | warning=dist6 外环（seq57） | 全部 dist≤4，无人在外环 | 0 单位在预警环 | 开局就贴内圈，首次预警零暴露，正确 |
| R5 | 5 | danger=dist6（seq75） | 无人在 dist6 | 收缩无承伤 | 正确 |
| R6 | 5 | warning=dist5 环（seq97） | 无人在 dist5 | 无需撤离 | 正确 |
| R7 | 4 | danger=dist5-6（seq118） | 无人在 dist5-6 | 收缩无承伤 | 正确 |
| R8 | 4 | warning=dist4 环（seq137） | scout(0,-4) 在 dist4 | **未撤离** | 失误：scout 已完成占点，早该内移 |
| R9 | 3 | danger=dist4+（seq158） | scout(0,-4) 在 dist4 | 我方 scout -25；敌 B1(0,4) -25、B4(-4,4) -25 | scout 已在预警环仍未撤 |
| R10 | 3 | warning=dist3 环（seq181） | 无人在 dist3 | 我方 scout -25；敌 B4 -25 | scout 继续承伤 |
| R11 | 2（最小） | danger=dist3+（seq202） | — | **我方 scout -15 阵亡**；敌 B4 -25、B8(-2,3) -25 | scout 本可避免的阵亡落地 |

**炮火总账：** 我方承伤 65（全落在 scout 身上，25+25+15，最终击杀 1）；敌方承伤 125（B1 25、B4 75、B8 25），但无一致死——三名被炮火打残的敌单位后来都被我补刀击杀。

## 单位、据点和补给时间线

**部署（我方 5 次 / 346 补给）：**
- R1：scout ← cp_west → (-4,1)，38
- R4：ranger ← supply_northwest → (-1,-2)，72
- R5：ranger ← supply_northwest → (0,-2)，72（**当轮即被敌方双 ranger 集火击杀**）
- R7：ranger ← supply_northwest → (0,-2)，72（补位）
- R10：heavy ← supply_west → (-2,0)，92

**部署（敌方 8 次 / 441 补给）：** ranger×3（72×3）+ infantry×5（45×5），全部来自 `supply_east` / `supply_southeast` / `supply_southwest`，印证「补给点也是部署来源」。

**据点争夺：** 双方前 3 轮对称占满各自半场 3 supply + 2 forward_base（各 6 据点）。R7 敌 B4 步兵偷我 `supply_southwest`（seq134），R8 又拿 `cp_southwest`（seq155）。我方收入从 44（6 据点）→ 36（5 据点）→ 32（4 据点）；敌方反升至 56（8 据点）。**但 `controlPoint` 权重为 0，据点中立的代价主要体现在收入与部署通道，而非裁决分。**

**集火交换（关键击杀链）：**
- R4-R5：四打一集火敌方 heavy（150 HP 坦克，seq60-66 打至 53，R5 击杀，seq79）。
- R5：我方 ranger #2 被敌方 2 ranger + B2 集火秒杀（seq88/90）——本局最大单点交换失误。
- R6-R7：我方连杀敌方 ranger #1（seq103）与 ranger #2（seq107 前后），夺回远程火力优势。
- R9-R12：逐个清缴敌 infantry（B2→B3→B5→B1→B7→B4）。

## 核心教训与关键转折

1. **R5 集火秒杀敌方 heavy（转折一）：** 敌方 heavy 卡中心 (0,0)，我方以 A1+重装+ranger+A2 四路集火，两轮打满 150 伤害击杀，解除中心威胁、打乱敌方 ranger 掩护阵型。交换比：我方 0 损换 92 成本坦克。

2. **我方 ranger #2 被反集火秒杀（转折二/失误）：** R5 我补位 ranger 落在 (0,-2)，恰好同时处于敌 B2 步兵近身和两门 ranger 射程内，当轮被 42+30 打满 72 击杀。**教训：补位 ranger 必须落在敌远程射程之外，或先用重装顶住正面再露头。**

3. **连杀敌方双 ranger 夺回火力权（转折三）：** R6-R7 我方以重装近身 + 自 ranger 远端，先后点掉敌两门 ranger。歼灭模式无 HQ，`armyValue` 是核心，ranger（成本 72）是敌最高价值单位，拆掉它们让敌后续只剩 infantry 肉搏。

4. **西南据点被偷 + 部署通道封闭（转折四）：** R7-R8 敌 B4 步兵绕西南连偷我 2 据点，虽 `controlPoint` 权重 0 不计分，但压低了收入，并使 R9 后我方 4 个部署据点（dist 3-4）全部落入危险区——**R11 起部署彻底非法，空有 95 补给无法转化为军力价值**（补给权重 0，等于约 190 分被浪费）。

5. **scout 预警未撤离（失误）：** scout 完成占点后停在 dist4 (0,-4)，R8 进入预警环仍未撤，R9-R11 连吃 3 发炮火阵亡。本可避免的唯一炮火阵亡。

## 炮火、军力与裁决分账本

权重：`enemyHqDamage=0`、`ownHqHp=0`、`controlPoint=0`、`armyValue=2`、`supplies=0`、`effectiveActions=10`。

| 项目 | 数量/数值 | 权重 | 依据 |
|---|---:|---:|---|
| HQ伤害 / HQ最终HP | 不适用（无HQ） | — | `mode=annihilation` |
| 最终据点数 | 我 4 / 敌 8 | 0（不计分） | `control_point_captured`/`neutralized` |
| 存活军力价值 | 我 156 / 敌 44 | 2 | `game_over.payload.scores` |
| 剩余补给 | 我 95 / 敌 124 | 0（不计分） | `income`、部署 |
| actionScore（=merit×effectiveActions） | 我 730 / 敌 540 | 10 | 行动事件（我 merit 73，敌 54） |
| 炮火承伤/击杀 | 我 65/死1 / 敌 125/死0 | — | 炮火事件（非独立裁决项） |
| **总分** | **我 1042 / 敌 628** | — | `game_over.payload.scores` |

**分差构成（我领先 414）：** `armyValue` 差 (156-44)×2 = **224** + `actionScore` 差 (730-540) = **190**。据点数（4 vs 8）与补给（95 vs 124）权重均为 0，不计入分差。

**部署花费 / 据点收入：** 我方部署 346 补给、累计收入 20+36+44×4+36+32×4 ≈ 396；敌方部署 441 补给。我方 9 击杀（单位全成本约 623 的敌军被打到 44 军力价值），我方 4 阵亡（3 被击杀 + 1 炮火）。

## 实际做法 vs 正确做法

**风险/低效（我方）：**
1. **ranger 补位位置暴露被秒杀**（触发条件：落在敌 ranger 射程内且与敌步兵相邻）。正确：补位 ranger 落在敌远程射程外、或等重装顶住正面再进。
2. **scout 预警未撤离**（触发条件：占点任务完成后仍停在 dist4 外圈）。正确：R4 首次预警后即内移或并入主阵。
3. **补给在部署通道封闭后滞留**（触发条件：R11 半径 2，dist3 的 supply 据点也非法）。正确：R9 半径收缩到 3 前，趁 supply（dist3）仍可用时把手头补给尽量转成单位。

## 与历史对局对比

本局首次 `artillery_warning`（R4）时外圈 dist6 单位数为 **0**（开局贴内圈占点，零暴露），收缩各阶段前我除 scout 外也无单位滞留在预警环；炮火承伤 65 且唯一阵亡（scout）属可避免失误。与歼灭模式常见输因（早期贪外圈、预警不撤、ranger 被秒）相比，本局主要失分点集中在「ranger 补位被反集火」与「补给滞留」，而非大面积炮火伤亡。具体历史数值未加载回放，此处仅作模式层面定性对比，不引用他局数字。

## 总结

> **核心口诀：先贴内圈抢补给点，集火先拆远程后拆肉，预警即内撤，半径收缩前把补给兑成军力。**

**一句话总结：赢在 R6-R7 连拆敌方双 ranger 夺回远程火力权，用 9 击杀换 3 阵亡拉开军力价值差距。**
