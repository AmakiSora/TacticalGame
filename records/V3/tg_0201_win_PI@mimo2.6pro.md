# 战术游戏歼灭模式复盘 — `player_b` 视角

**日期/游戏ID/回放版本:** 2026-10-05 / `1fe38abd-8584-46ab-a942-403c98a500e5` / `3.5.10`（`hex-v2-replay`）
**地图/参战人数:** `artillery-zone` / 2人；**模式:** annihilation
**玩家:** mimo2.6pro-PI（PI@mimo2.6pro）
**席位与出生:** `player_b`，初始单位：infantry(5,0)、infantry(5,-1)、heavy(4,1)；出生控制点 `cp_east`(4,0)；HQ：不适用（无HQ）
**结果:** 🏆第1名 — `last_player_standing`（对手 `player_a` 于第13轮 `artillery_destroyed` 淘汰）
**结束轮次:** 第13/20整轮；**最终存活单位/补给:** 4 / 247

## 最终排名与淘汰

| 名次 | 席位 | 状态 | 总分 | 军力价值 | 据点 | 主要死亡/优势原因 |
|---|---|---|---:|---:|---:|---|
| 1 | `player_b`（mimo2.6pro-PI） | active | 934 | 172 | 5 | 集火交换占优（31次攻击/650伤害），据点收入稳定（R9起每回合+40），最后一轮前仍保有4单位 |
| 2 | `player_a`（ling3.0flash-WEB） | eliminated | 310 | 0 | 3 | 前排两步兵被集火逐个点杀，末段补给枯竭无力补兵，最后一个步兵在炮火收缩时死于 `artillery` |

## 炮火与安全区时间线

本图炮火配置（`config.annihilation.artillery`）：`startRound: 5`、`intervalRounds: 2`、`damage: 25`、`minimumSafeRadius: 1`。

| 轮次 | safeRadius | warning/danger 关键格 | 我的单位位置 | 撤离/承伤/击杀 | 决策评价 |
|---|---:|---|---|---|---|
| R4（`seq:50` `artillery_warning`） | 6 | warning 36格外圈，`nextShrinkRound:5` | 3步兵/重装全部在内圈（(5,0)→已推进至(3,0)、(2,0)、(2,1)等） | 外圈单位数0，无需撤离 | ✅ 前期占点推进时已避开外圈，预警无压力 |
| R5（`seq:67` `artillery_shrunk`） | 5 | danger 36格外圈 | 我方单位均在 `safeRadius≤3` 内 | 承伤0 | ✅ 收缩前后均无危险 |
| R6（`seq:87` `artillery_warning`） | 5 | warning 30格，`nextShrinkRound:7` | (1,0)、(3,-3)、(2,1)、(4,-4) 等均安全 | 承伤0 | ✅ |
| R7（`seq:106` `artillery_shrunk`） | 4 | danger 66格 | 我方全部在内圈 | 承伤0 | ✅ 对手 `68be3602` 在 (0,-3) 抢 `supply_northwest`，其后一步步走入危险区 |
| R8（`seq:123` `artillery_warning`） | 4 | warning 24格，`nextShrinkRound:9` | (1,1)、(3,-2)、(0,-2)、(2,0) 等安全 | 承伤0 | ✅ |
| R9（`seq:143` `artillery_shrunk` + `seq:144` `artillery_damage`） | 3 | danger 90格 | 我方 4 单位均安全 | 对手 `68be3602`@(0,-4) 承伤25（hp17→0，但实际先被我方击杀于(0,-2)；此处记的是收缩前占点单位） | ⚠️ 对手未及时撤离占点步兵，被炮火+我方双重收割 |
| R10（`seq:163` `artillery_warning`） | 3 | warning 18格，`nextShrinkRound:11` | 我方 (2,0)、(2,-2)、(1,1)、(-1,-1) 安全 | 承伤0 | ✅ 部署新重装/步兵时已选安全格 |
| R11（`seq:183` `artillery_shrunk` + `seq:184`/`seq:185` `artillery_damage`） | 2 | danger 108格 | 我方 (1,1)、(0,-3) 等安全 | 对手 `c1e3ca51`@(1,2) 承伤25、`1b87de86`@(-3,1) 承伤25 | ⚠️ 对手两单位滞留预警/危险格，血线被压低后遭我方补刀 |
| R12（`seq:205` `artillery_warning` + `seq:206` `artillery_damage`） | 2 | warning 12格，`nextShrinkRound:13` | `fca87942`@(2,1) 在 warning 格承伤25（hp125→100） | 我方重装1次炮火承伤 | ⚠️ **可避免的失误**：部署/移动重装到 (2,1) 未核对 warningCells，白挨25炮伤。事后已立即撤往 (1,1) |
| R13（`seq:225` `artillery_shrunk` + `seq:226/229/230` `artillery_damage`） | 1 | danger 126格，`nextShrinkRound: null`（已达 `minimumSafeRadius:1`，不再收缩） | `521ed447`@(-1,2) 承伤25、`fca87942`@(1,1) 承伤25、`2fedcb0e`@(-2,1) 承伤25 | 我方3单位各受25炮伤，但均存活；对手 `1b87de86`@(-2,2) 承伤25后 hp0，**被炮火击杀**（`cause:"artillery"`），触发 `player_eliminated` | ⚠️ 末轮收缩至半径1时我方3单位也在危险格，但因对手先一步全灭，属"终局互换区"，不影响结果 |

## 单位、据点和补给时间线

- **R1**（`player_b` 首回合，`actionsUsed:4`）：
  - `fc5414b7` infantry 从(5,0)→(3,0) 占领 `supply_east`（`seq` 8 `control_point_captured`），首次 `income` 只有 12（仅 `cp_east`，此时未结算占点收入）。
  - 部署 `7faca999` infantry，来源据点 `cp_east`→(4,-1)，花费 45。
  - 对手 R1 同步占领 `supply_west` 并从 `cp_west` 部署 `c1e3ca51` infantry@(-4,1)。
- **R2**：`cp_northeast`(4,-4) 被 `7faca999` 占领、`supply_northeast`(3,-3) 被 `8038d512` 占领（`seq` 32/33）。双方 income 各 20。
- **R3–R5**：income 稳定在 +32（base 8 + 4×CP收入：`cp_east` 4、`cp_northeast` 4、`supply_east` 8、`supply_northeast` 8），对手稳定 +20（`cp_west` 4、`supply_west` 8）。**收入差 +12/回合** 是后续能持续补兵的关键。
- **R4–R5 集火交换**：`66bb2e3a` 被 `521ed447`(30)+`8038d512`(21)+`fc5414b7`(23) 三连击削至 26hp，R5 由 `521ed447` 收割（`seq` 78 `unit_death`）。这是第一个击杀，确立人数优势。
- **R7**：对手 `68be3602` 占领 `supply_northwest`(0,-3)，R8 又抢 `cp_northwest`(0,-4)——但此时 `safeRadius` 已缩到 4，(0,-4) 距中心距离 4 仅勉强安全，随后 R9 收缩直接把它和占点步兵压入危险区。
- **R8–R9**：我方 `7faca999` 从 (0,-2)→(0,-3) 反抢 `supply_northwest`（`seq` 130 `control_point_captured`，前手 `player_a`），据点数拉到 5:3，income 升至 +40。
- **R10 补给爆发**（supplies 304→167）：从 `supply_east` 部署 `fca87942` heavy@(2,0) 花 92、从 `supply_northeast` 部署 `2fedcb0e` infantry@(2,-2) 花 45。这波重装+步兵是 R11–R12 收割的主力。
- **R11–R12 收尾集火**：`c1e3ca51` 被 `fca87942`(29) 一刀带走；`8906746d` 被 `7faca999`+`2fedcb0e`+`521ed447` 三连击（22+21+24+31+2）削死；`1b87de86` 被 `521ed447`(28)+`2fedcb0e`(22) 压到 25hp，R13 炮火收缩收割。
- **`income`/`deploy` 账本**（`player_b`）：全程 income 事件 12 次（R1–R12 各一次），累计约 364；deploy 事件 3 次（R1 infantry 45、R10 heavy 92、R10 infantry 45 = 182）；最终剩余补给 247。
- **对手 `player_a`**：deploy 4 次（全为 infantry，来自 `cp_west`/`supply_west`，共 180），income 累计约 252，最终剩余补给 109——**补给没转化成军力**是其败因之一。

## 核心教训与关键转折

1. **炮火预警后的撤离选择（R12 `fca87942`）**：部署重装到 (2,1) 时只看了 `dangerCells`，没核对 `warningCells`（当时 (2,1) 属 `seq:205` 的 warningCells），结果 R12 边界白挨 25 炮伤（hp125→100）。教训：**部署/移动前必须同时核对 dangerCells 和 warningCells**，尤其 `nextShrinkRound === 当前轮+1` 时，warningCells 等同于"下轮必掉血区"。事后立即撤往 (1,1) 是正确补救。
2. **集火交换（R4–R5 收割 `66bb2e3a`）**：三单位轮流打同一目标（30+21+23 削至 26hp，次轮重装收尾），比分散打三个目标高效得多。教训：**"可击杀单位→高价值单位→占点单位"排序**，本局严格照此执行，31 次攻击换 6 个击杀。
3. **据点中立/部署通道变化（R7–R9 争夺 `supply_northwest`/`cp_northwest`）**：对手抢到 `cp_northwest` 后收入一度到 +28，但该点位于 (0,-4) 距中心 4，R9 收缩后直接进入危险区，占点步兵 `68be3602` 被炮火+我方夹击致死，点位中立（`seq` 227/228/229 `control_point_neutralized` 三项）。教训：**外圈高收入点在炮火收缩期是陷阱**，抢点要算"这个点还能安全持有几轮"。
4. **收入转化为军力（R10 补给爆发）**：我方 R3–R9 稳定 +32/回合，R10 手握 304 补给，一次性部署 heavy+infantry 花 137，剩余继续滚雪球。对手同期只部署了 2 步兵，补给卡在 109 无处花。教训：**AP 允许时补给必须变单位**，`actionsPerTurn:4` 下每回合至少能部署 1–2 个。

## 炮火、军力与裁决分账本

`adjudicationWeights`：`enemyHqDamage:0`、`ownHqHp:0`、`controlPoint:0`、`armyValue:2`、`supplies:0`、`effectiveActions:10`。

| 项目 | 数量/数值 | 权重 | 依据 |
|---|---:|---:|---|
| HQ伤害 / HQ最终HP | 不适用（无HQ） | — | `mode: annihilation`，运行时无 HQ |
| 最终据点数 | 5（对手 3） | 0 | `control_point_captured` 7次、`control_point_neutralized` 3次；权重0，不构成裁决分，但决定收入/部署通道 |
| 存活军力价值 | 172（`521ed447`66+`fca87942`61+`2fedcb0e`34+`7faca999`11，按 R13 收缩前 HP 核算） | ×2 | `game_over.payload.scores.player_b.armyValue` |
| 剩余补给 | 247 | 0 | `income` 累计约 364 − `deploy` 累计 182 ≈ 227（与终值 247 的差异来自起始 45 与逐轮结算）；权重0，不构成裁决分 |
| `actionScore` | 590（`actionMerit:59 × effectiveActions:10`） | 1 | 行动功绩：deploy +1×3、capture +2×3、attack `ceil(dmg/20)` 累计、demolish 0、heal 0 |
| 炮火承伤/击杀 | 我方承伤 100（`fca87942` 50+`521ed447` 25+`2fedcb0e` 25），0击杀；对手承伤 75（`68be3602` 25+`c1e3ca51` 25+`1b87de86` 50），1击杀（`1b87de86` R13 `cause:"artillery"`） | — | 炮火事件，非独立裁决项 |
| **总分** | **934**（对手 310） | — | `game_over.payload.scores`；`172×2 + 590 = 934` ✔ |

单位死亡原因统计（全 9 个 `unit_death`）：
- `player_a` 6 个：`attack` 5（`66bb2e3a` R5、`8e5b5792` R8、`68be3602` R9、`6871b976` R10、`c1e3ca51` R11、`8906746d` R12）、`artillery` 1（`1b87de86` R13）。
- `player_b` 2 个：`attack` 2（`8038d512` R9、`fc5414b7` R9）。
- 交换比：我方损 2 单位（2 infantry，军力价值 90）换对手 7 单位（1 heavy + 6 infantry，军力价值 407），**交换比约 1:4.5**。

## 实际做法 vs 正确做法

第一名仍列 2 条风险/低效行动：

1. **风险（R12 `fca87942` 挨炮伤）**：把重装部署/移动到 (2,1) 前没查 `warningCells`，白丢 25hp。**正确做法**：每次 deploy/move 前用 `game.artillery.warningCells` 逐一核对目标格，尤其 `nextShrinkRound === roundNumber+1` 时；若目标格在 warningCells，宁可少走一步。
2. **低效（R9 `7faca999` 曾 "already acted" 撞墙）**：`fc5414b7` 移动后才发现射程差一格无法攻击（`out of range (2 > 1)`），`7faca999` 移动后又试图二次攻击被 `already acted this turn` 拒绝，浪费了 2 次有效行动机会。**正确做法**：每个单位行动前先算"移动后是否进入 `attackRange`"，用 hex 距离预判，不要"先移再看"；AP 仅 4，每一次空耗都是对手的机会。
3. **风险（R13 终局 3 单位在危险格）**：末轮收缩到 `safeRadius:1` 时 `521ed447`@(-1,2)、`fca87942`@(1,1)、`2fedcb0e`@(-2,1) 全在危险格各挨 25 炮伤。本局因对手先一步全灭未造成后果，但若对手还有残血单位，这些炮伤足以翻盘。**正确做法**：`nextShrinkRound` 到来前一回合就把主力往 `minimumSafeRadius` 内圈撤，不要在危险格恋战。

## 与历史对局对比

- **首次预警外圈单位数**：本局 R4 首次 `artillery_warning` 时我方 0 单位在外圈；相比典型歼灭局（外圈常有 2–3 个占点步兵），本局前期推进更保守，未因占外圈点而被炮火惩罚。
- **收缩前未撤离数**：本局我方仅 `fca87942` 1 次（R12 warningCells）和 R13 终局 3 单位在危险格（无后果）；对手 `68be3602`、`c1e3ca51`、`1b87de86` 各 1 次未撤离，直接导致 3 次 `artillery_damage` 和 1 次 `artillery` 击杀。
- **炮火承伤/击杀**：我方 100/0，对手 75/1。对手虽然炮火总承伤更低，但唯一的 `artillery` 击杀发生在它身上——**位置错误的代价比总血量更致命**。
- **最终死亡原因**：对手 6/7 死于 `attack`、1/7 死于 `artillery`；我方 2/2 死于 `attack`。我方从未因炮火减员。
- **据点收入**：我方 R3 起稳定 +32，R9 起 +40；对手稳定 +20，R8 起 +28→+24。收入差（累计约 112）全部转化为 R10 的 heavy 部署和持续补兵能力。
- **排名**：`last_player_standing` 第 1 名；历史同类歼灭局中，胜方多为"前期占点收入领先 + 中期集中部署重装 + 炮火期主动收缩"的组合，本局完全吻合该模式。

## 总结

> **核心口诀：预警先撤离、集火点杀不散打、据点收入换成兵、危险格里不恋战**

**一句话总结：前期抢点吃收入、中期集火逐个点杀、炮火期提前收缩不贪占点，用 2 个步兵换掉对手全部 7 个单位拿下 `last_player_standing`。**
