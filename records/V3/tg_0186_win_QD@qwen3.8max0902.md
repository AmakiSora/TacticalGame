# 战术游戏标准模式复盘 — `player_b` 视角

**日期/游戏ID/回放版本:** 2026-09-30 / `cc22027c-b617-428b-98b9-04b58eb5c262` / 3.5.9
**地图/参战人数:** `danger-close`（危险距离，hex·pointy·radius 5，91 格，16 个 blocker，`artillery=null`）/ 2人
**玩家:** Qwen3.8Max0902-QD（QD@qwen3.8max0902）
**席位与出生:** `player_b`，`spawnSlotId=slot_a`，行动顺序第 **2**（`turnOrder=["player_a","player_b"]`，`firstPlayer=player_a`，即本局后手），HQ `(-2,0)`
**结果:** 🏆 第1名 — `last_player_standing`（`seq98`；`player_a` 因 `headquarters_destroyed` 被淘汰，`seq95`→`seq97`，`eliminatedBy=player_b`）
**结束轮次:** 第 **10/30** 整轮（`game_over.roundNumber=10`；`round_end` 仅 9 个 = R1–R9 完整，终局发生在第 10 轮 `player_b` 回合内）；**HQ最终HP:** 我 109/120，敌 0/120

> 取证说明：本文全部数字出自回放 `records/V3/tg_0186_20260930.json`（`eventCount=98`），并标注事件类型与 `seq`。路程/邻接类数字由回放自带的 `map.cells`(91) 与 `map.terrainCells`(16 blocker) 计算得出。回放未提供的项已明确标注。

## 最终排名摘要

| 名次 | 席位 | 玩家 | 状态 | 总分 | 与我方分差 | 决定性优势 |
|---|---|---|---|---:|---:|---|
| 1 | `player_b` | Qwen3.8Max0902-QD（QD@qwen3.8max0902） | active | **2687** | — | 对敌 HQ 造成 **120** 点满额伤害（×20 权重 = 2400 分，占总分 89%）；己方 HQ 仅承 11 点；零单位损失 |
| 2 | `player_a` | GLM5.3-WEB | eliminated | 414 | −2273 | 全程 **0 次爆破**、HQ 伤害仅 11、78 补给买的 ranger 从未攻击过任何目标 |

`rankings` 明细（`seq98`，权威来源）：

| 席位 | headquartersDamage | ownHqHp | controlPoints | armyValue | supplies | actionScore | total |
|---|---:|---:|---:|---:|---:|---:|---:|
| `player_b` | 120 | 109 | 1 | 124 | 94 | 24 | **2687** |
| `player_a` | 11 | 0 | 1 | 154 | 60 | 10 | 414 |

## 本局配置（`game_start` `seq3`）

- **单位属性（`config.units`）:** infantry 100hp/30atk/8def/mv3/rg1/$45/可占点；scout 65/16/4/mv3/rg1/$38/可占点；heavy 150/40/13/**mv2**/rg1/$50/不可占点；ranger 72/44/3/mv2/**rg3**/$78/不可占点；support 82/10/5/mv3/rg1/$60/healPower 22
- **HQ 规格（`headquartersSpec`）:** hp 120 / defense 4
- **经济（`config.balance`）:** `startingSupplies=20`、`baseIncome=6`、`controlPointIncome=0`、`damageVarianceRange=3`、`minimumDamage=1`、`healVarianceRange=6`
- **节奏:** `actionsPerTurn=1`、`maxTurns=30`
- **裁定权重（回放 `game_over.scores` 同源）:** `enemyHqDamage=20`、`ownHqHp=1`、`controlPoint=30`、`armyValue=1`、`supplies=0`；**`effectiveActions` 未在回放的 weights 中出现** → 由 actionScore 反推为 2（见账本）
- **据点:** `cp_1`「据点 1」`supply` `(-3,0)`、`cp_2`「据点 2」`supply` `(3,0)`；`controlPointTypes.supply.income=8`、`deployDiscount=0`、`repairAmount=0`（`forward_base`/`repair` 全为 0，本图无此类点）
- **初始单位:** 每方 2 个 scout。我方 `84ea5d50@(-5,5)`、`85911f50@(-5,4)`；敌方 `00d8ba47@(5,-5)`、`7cd79625@(5,-4)`
- **出生位互换（重要）:** `players.player_a.spawnSlotId=slot_b`、`players.player_b.spawnSlotId=slot_a`，因此运行时 HQ 归属与地图文件的 `headquarters` 字段相反 —— 我（`player_b`）拿的是 `(-2,0)`。**不能照搬地图文件里的方位做赛前规划**，必须读 `game_start.headquarters`。
- `config.balance.deployFromHq`：**回放未提供该键**；但 `seq37` 的 `deploy` 以 `fromId=fd245687…`（我 HQ id）成功，实证 HQ 是合法部署起点。

## 游戏进程时间线

补给列格式为「行动前→行动后」；行动点列为该席位回合结算后的 `actionsUsed/actionsPerTurn`。

| 整轮/席位回合 | 补给（我 / 敌） | 行动点 | 关键操作与坐标 | 结果/局势变化 | 战术意图 |
|---|---|---|---|---|---|
| R1 `player_a` | — / 20→20 | 1/1 | `seq4` move `7cd79625` (5,-4)→(3,-1) | 敌 scout 逼近自家 cp_2 邻格 | 抢 supply 点 |
| R1 `player_b` | 20→**26** / — | 1/1 | `seq6` income +6（**R1 只有我有 income 事件，先手首回合不发收入**）；`seq8` move `85911f50` (-5,4)→(-4,1) | 距 cp_1 仅 1 步 | 两回合占 cp_1 的第一步 |
| R2 `player_a` | — / 20→26 | 1/1 | `seq11` income +6；`seq13` move `7cd79625` (3,-1)→(3,0)；`seq14` `control_point_captured` cp_2→player_a | 敌得 cp_2（+8/轮） | 同上 |
| R2 `player_b` | 26→**32** / — | 1/1 | `seq16` income +6；`seq18` move `85911f50` (-4,1)→(-3,0)；`seq19` `control_point_captured` cp_1→player_b | 我得 cp_1（+8/轮），双方经济对称 | 占点后所有权持久，scout 无需驻守 |
| R3 `player_a` | — / 26→40 | 1/1 | `seq22` income +14（base6+cp8）；`seq24` move `00d8ba47` (5,-5)→(2,-5) | 敌第二 scout 走上侧翼 | 向我 HQ 侧翼迂回 |
| R3 `player_b` | 32→**46** / — | 1/1 | `seq26` income +14；`seq28` move `84ea5d50` (-5,5)→(-2,5) | heavy(50) 尚差 4 补给，无法部署 | **本局唯一低效行动点**（见失误 1） |
| R4 `player_a` | — / 40→54 | 1/1 | `seq31` income +14；`seq33` move `00d8ba47` (2,-5)→(-1,-2) | 敌 scout 到我 HQ 2 格、我 heavy 预定部署格旁；**54 补给已够 heavy(50) 却没买** | 选择磨血而非爆破（关键失误） |
| R4 `player_b` | 46→**60→10** / — | 1/1 | `seq35` income +14；`seq37` **deploy heavy `8a84eb31` from HQ `fd245687` → (-2,-1) cost 50**；`seq38` **demolish `(-1,-1)` blocker→plain** | 两条事件 `actionsUsed` **均为 1/1** → 部署与爆破共用同一个行动点；环内通道打开 | **本局制胜手**：一个 AP 完成落地+破墙 |
| R5 `player_a` | — / 54→68 | 1/1 | `seq41` income +14；`seq43` attack `00d8ba47`→unit `8a84eb31` dmg 5 → targetHp 145 | 我 heavy 掉 5 血（scout 16−13=3±3） | 无意义消耗 |
| R5 `player_b` | 10→**24** / — | 1/1 | `seq45` income +14；`seq47` move `8a84eb31` (-2,-1)→(0,-1) | 一次移动走 2 步穿入墙内「环」 | 走环内捷径，不外圈绕行 |
| R6 `player_a` | — / 68→82 | 1/1 | `seq50` income +14；`seq52` move `00d8ba47` (-1,-2)→(-1,-1)；`seq53` attack→**headquarters `fd245687`** dmg 11 → targetHp 109 | 移动+攻击同回合（1 AP）；我 HQ 首次也是**唯一一次**承伤 | 磨我 HQ |
| R6 `player_b` | 24→**38** / — | 1/1 | `seq55` income +14；`seq57` move `8a84eb31` (0,-1)→(0,0)；`seq58` **demolish `(1,0)` blocker→plain** | 移动+爆破同回合（1 AP）；拿到敌 HQ 邻格 | **选 (1,0) 而非 (2,-1)**，见核心策略 3 |
| R7 `player_a` | — / 82→**96** | **0/1** | `seq61` income +14；`seq62` turn_end(b→a)、`seq63` `reset_actions actionsUsed=0`、`seq65` turn_end(a→b)，其间**无任何行动事件** | **自主空过一整个回合**（`turn_skipped=0`、`host_eliminated=0`，非房主干预）；96 补给仍未买 heavy | 唯一能与我竞速的窗口被浪费 |
| R7 `player_b` | 38→**52** / — | 1/1 | `seq64` income +14；`seq66` move `8a84eb31` (0,0)→(1,0)；`seq67` **attack→headquarters `6139afda` dmg 35 → targetHp 85** | 移动+攻击同回合；**首伤落地，压力不可逆** | 攻城开始 |
| R8 `player_a` | — / 96→110→**32** | 1/1 | `seq70` income +14；`seq72` **deploy ranger `7123d60e` from HQ `6139afda` → (2,1) cost 78** | 78 补给换成一个射程 3 的单位 | 意图射我 heavy（距离 2 ≤ 射程 3） |
| R8 `player_b` | 52→**66** / — | 1/1 | `seq74` income +14；`seq76` attack→HQ dmg 37 → targetHp 48 | 敌 HQ 48/120 | 持续攻城 |
| R9 `player_a` | — / 32→46 | 1/1 | `seq79` income +14；`seq81` move `7123d60e` (2,1)→(4,0) | ranger 远离我 heavy，未开火 | 位移无产出 |
| R9 `player_b` | 66→**80** / — | 1/1 | `seq83` income +14；`seq85` attack→HQ dmg 34 → targetHp 14 | 敌 HQ 14/120，下一击必杀 | 收官 |
| R10 `player_a` | — / 46→60 | 1/1 | `seq88` income +14；`seq90` move `7123d60e` (4,0)→(3,-1) | ranger 第二次纯位移，**全程 0 次攻击** | 78 补给 + 3 个行动点全部空转 |
| R10 `player_b` | 60→**94** / — | 1/1 | `seq92` income +14；`seq94` **attack→HQ dmg 36 / actualDamage 14 → targetHp 0**；`seq95` `headquarters_destroyed`；`seq96` `control_point_neutralized` cp_2；`seq97` `player_eliminated player_a`（removed `00d8ba47`,`7cd79625`,`7123d60e`）；`seq98` `game_over` | 敌 HQ 归零 → 淘汰 → 终局 | 获胜 |

行动点核算（由回放事件计数）：**我方 10 个席位回合全部消耗了行动点，无空过**；敌方 10 个回合中 9 个有行动、**R7 空过 1 次**。`heal=0`、`control_point_repair=0`、`turn_skipped=0`、`host_eliminated=0`。

## 核心策略与关键转折

### 策略

1. **把 `actionsPerTurn=1` 读成「每回合只能激活一个单位」，而不是「每回合只能做一件事」。** 回放证据：`seq37`(deploy)+`seq38`(demolish) 同属 R4 且 `actionsUsed` 均为 1；`seq57`(move)+`seq58`(demolish) 同属 R6；`seq66`(move)+`seq67`(attack) 同属 R7。推论：**堆兵数量不会提高输出**（每回合仍只有一个单位能开火），DPS 上限就是单个单位的攻击力；因此全部经济与行动点必须压在**一条**攻城线上，本局我只买了 1 个单位（heavy，`seq37`）。
2. **走墙内「环」而不走外圈。** 由回放 `map.cells`/`terrainCells` 计算：从我的部署格 `(-2,-1)` 走外圈到敌 HQ `(2,0)` 的邻格需 walk **10–11** 步（`(2,1)`=10、`(3,-1)`=10、`(3,0)`=11），heavy `mv2` → **5 个移动回合**；炸开 `(-1,-1)` 后走环内 `(-2,-1)→(-1,-1)→(0,-1)→(0,0)→(1,0)` 仅 4 步 → **3 个移动回合**。回放自身的 move 事件逐段实证了这条路：`seq47` (-2,-1)→(0,-1)、`seq57` (0,-1)→(0,0)、`seq66` (0,0)→(1,0)。**净省 2 个回合**，在 maxTurns=30、10 回合就分胜负的图上是决定性的。
3. **爆破格要挑「炸开后连通谁」。** 回放地形数据显示：`(1,0)` 的邻格是 `(2,0)[敌HQ]`、`(0,0)[平]`、`(1,-1)[平]`、`(0,1)[平]`、`(1,1)[墙]`、`(2,-1)[墙]` —— 除敌 HQ 外**全是环内格或墙，不通敌方外侧**；而 `(2,-1)` 的邻格含 `(3,-1)[平]`、`(3,-2)[平]`，炸开等于**替敌方开出环内入口**。所以我在 `seq58` 炸 `(1,0)`。结果：敌方全程 `demolish` 事件数为 **0**，我的 HQ 只挨了 1 次 11 点（`seq53`）。
4. **先用 2 个 scout 回合换 cp_1 经济，再谈攻城。** `seq8`+`seq18` 两个移动就让 `85911f50` 站上 `(-3,0)` 触发 `seq19` 占领；从 `seq26`(R3) 起我的 income 变成 `base=6, control=8, amount=14`。不占点则每轮只有 6：R4 时是 `20+6×4=44 < 50`，heavy 要推迟到 R5，首伤顺延到 R8。**占点用掉的 2 个行动点，换回了 heavy 提前 1 轮 + 8×8=64 补给 + 30 裁定分。**
5. **后手不跟对手拼对称竞速，而是拼「对手必须自己破墙才能进来」。** 我是 `turnOrder` 索引 1（后手），同轮次内敌方先动，纯对轰会在同轮 tiebreak 上吃亏。但本图的防守方天然占便宜：所有紧邻 HQ 的格子 `(1,0)/(1,1)/(2,-1)`（敌侧）与 `(-1,0)/(-2,1)/(-1,-1)`（我侧）**都是 blocker**，进攻方必须自带 heavy 爆破才能贴脸。我选择先把破墙成本付掉、把攻城时钟压到最短，把「必须想办法进来」的压力留给对手。

### 转折

1. **R4 `seq37`+`seq38`：一个行动点完成 heavy 落地 + 炸开 `(-1,-1)`。** 这是把首伤从 R8 拉到 R7 的直接原因，也是与历史局 `tg_0177` 拉开 2 轮差距的第一处。
2. **R4 `seq33` 与 R7 的空过：敌方两次放弃 heavy。** R4 时敌方已有 54 补给（≥ heavy 的 50），却把行动点用在 scout 位移上；R7 更是整轮无任何行动事件（`seq62`/`seq63`/`seq65` 之间为空，且 `turn_skipped=0`）。至此竞速已结束——敌方最早的 heavy 首伤不可能早于 R8，而我 R7 已开火。
3. **R6 `seq58` 选择炸 `(1,0)`：** 让 R7 能直接站上敌 HQ 邻格开火（`seq66`+`seq67`），同时没有给敌方任何环内通路。
4. **R8 `seq72`：敌方把 78 补给投入 ranger `7123d60e`@(2,1)，而它此后只有 `seq81`(2,1)→(4,0) 与 `seq90`(4,0)→(3,-1) 两次位移，直到被 `seq97` 清除，`attack` 事件数为 0。** 相当于 78 补给（占其全局可用资源 138 = 起始 20 + 累计收入 118 的 **57%**）与 3 个行动点完全空转，同时其 `armyValue` 154 中有 78 是这件从未开火的资产。
5. **R10 `seq94`：`damage=36` 但 `actualDamage=14`（溢出被截断），HQ 归零 → `seq95` `headquarters_destroyed` → `seq97` `player_eliminated` → `seq98` `game_over`。** 四击实际伤害 35+37+34+14 = **120**，与 `scores.player_b.headquartersDamage=120` 完全一致。

## HQ、据点与行动点分析

### 对 `player_a`（GLM5.3-WEB，HQ `(2,0)` 120hp/def4）

- **我造成的 HQ 伤害：120（满额）** —— `seq67` 35（R7）、`seq76` 37（R8）、`seq85` 34（R9）、`seq94` 36→截断 14（R10）。heavy 40atk − HQ 4def = 36±3，符合 `damageVarianceRange=3`。
- **击杀：R10 打穿 HQ → `player_eliminated`（`reason=headquarters_destroyed`, `eliminatedBy=player_b`）**，其 3 个单位（`00d8ba47`/`7cd79625`/`7123d60e`）被移除，cp_2 中立化。
- **我方承伤：仅 11** —— `seq53`（R6）敌 scout 打我 HQ 一次（16−4=12±3，掷出 11）。另有 `seq43`（R5）敌 scout 打我 heavy 5 点。**敌方全局 `attack` 事件共 2 次（1 次对单位 `seq43`、1 次对 HQ `seq53`）；我方 4 次，全部打在敌 HQ 上。**
- **据点交互：** 各占 1 个（我 cp_1 `seq19`，敌 cp_2 `seq14`），终局 cp_2 因淘汰中立化（`seq96`）→ 双方 `controlPoints` 均记 1。
- **进攻窗口分析：** 我的 heavy 从 R7 起每回合稳定 33–39，而敌方**无任何回血手段**（`heal=0`、`control_point_repair=0`、`repair` 型据点收益为 0），因此 R7 之后局势不可逆：敌 HQ 85→48→14→0，敌方无法用任何合法动作改变这条曲线。

### 我 HQ 的守家路线（为什么只挨 11 点）

紧邻我 HQ `(-2,0)` 的格子是 `(-3,0)`(=cp_1，我方 scout `85911f50` 终局仍在此)、`(-2,-1)`、`(-3,1)` 三个平格，以及 `(-1,0)`、`(-2,1)`、`(-1,-1)` 三个 blocker。敌方要近战我 HQ，必须先爆破这三个 blocker 之一——**而敌方本局 `demolish` 事件数为 0**。我自己在 `seq38` 炸开了 `(-1,-1)`，敌方 scout 由此进入并在 `seq52` 站上 `(-1,-1)` 打了我 11 点；这是我为打通进攻通道付出的、可量化的防守代价（**11 点 HQ 血 = 11 分裁定损失**，换来的是 R7 首伤与 R10 终局的 2400 分 HQ 伤害）。

### 行动点分配

| 轮次 | 我方行动点用途 | 是否双动作 |
|---|---|---|
| R1/R2 | scout 移动占 cp_1（`seq8`/`seq18`） | 否（占点在回合结束结算） |
| R3 | scout 位移（`seq28`） | 否 —— **唯一低效点** |
| R4 | deploy heavy + demolish(-1,-1)（`seq37`+`seq38`） | **是** |
| R5 | heavy 移动 2 步入环（`seq47`） | 否 |
| R6 | heavy 移动 + demolish(1,0)（`seq57`+`seq58`） | **是** |
| R7 | heavy 移动 + 攻击 HQ（`seq66`+`seq67`） | **是** |
| R8/R9/R10 | heavy 攻击 HQ（`seq76`/`seq85`/`seq94`） | 否（无需移动） |

10 个行动点里 3 个是双动作（R4/R6/R7），9 个直接服务于「占点经济 + 攻城」，**没有出现「移动后没有攻击/占点」的空转**——唯一例外是 R3（见失误 1）。

## 补给与六项裁决分账本

权重取自本局 `game_over.scores` 同源的 `adjudicationWeights`：`enemyHqDamage=20`、`ownHqHp=1`、`controlPoint=30`、`armyValue=1`、`supplies=0`。**回放的 weights 未含 `effectiveActions`**，按 `actionScore ÷ 由事件数出的 merit` 反推为 **2**（我方 24÷12、敌方 10÷5，两方一致）。

| 项目 | 数量/数值 | 本局权重 | 得分 | 事件或配置依据 |
|---|---:|---:|---:|---|
| 对对手 HQ 造成的伤害 | 120 | 20 | 2400 | `attack` `seq67`/`seq76`/`seq85`/`seq94`（35+37+34+14） |
| 己方 HQ 最终 HP | 109/120 | 1 | 109 | `game_over.scores.player_b.ownHqHp`；承伤见 `seq53`(11) |
| 最终控制据点数 | 1（cp_1） | 30 | 30 | `control_point_captured` `seq19`；cp_2 于 `seq96` 中立化 |
| 存活军力价值 | 124 | 1 | 124 | `game_over.scores`；核验 = heavy round(50×145/150)=48 + scout 38 + scout 38 |
| 剩余补给 | 94 | 0 | 0 | `income` 累计 +124、deploy −50（见下方收支） |
| `actionScore` | 24 | —（不再乘权重） | 24 | merit 12 × effectiveActions 2 |
| **总分** | — | — | **2687** | `game_over.payload.scores.player_b`（2400+109+30+124+0+24 校验一致） |

对手 `player_a` 同式核验：11×20=220 + 0×1=0 + 1×30=30 + 154×1=154 + 60×0=0 + 10 = **414** ✓（`armyValue` 154 = scout 38 + scout 38 + ranger 78，淘汰时冻结；`actionScore` 10 = merit 5 × 2）。

`actionMerit` 分解（merit 公式来自 skill 规范，输入数值全部出自回放事件）：

- 我方 12 = deploy `seq37` +1、demolish `seq38` +1、demolish `seq58` +1、capture `seq19` +2、attack ⌈35/20⌉=2 `seq67` + ⌈37/20⌉=2 `seq76` + ⌈34/20⌉=2 `seq85` + ⌈14/20⌉=1 `seq94` = 7
- 敌方 5 = capture `seq14` +2、deploy `seq72` +1、attack ⌈5/20⌉=1 `seq43`、attack ⌈11/20⌉=1 `seq53`
- **注：回放未提供最终 `stats.actionMerit` / `stats.actionPointsUsed` 字段**（`game_start` 里的 stats 全为 0），以上为由事件重算的结果。

### 收支账本（由 `income`/`deploy` 事件逐轮重建，末值与 `game_over.scores` 完全吻合）

| 轮次 | 我方收入 | 我方余额 | 敌方收入 | 敌方余额 |
|---|---:|---:|---:|---:|
| 起始 | — | 20 | — | 20 |
| R1 | +6（`seq6`，**先手首回合无 income 事件**） | 26 | 0 | 20 |
| R2 | +6（`seq16`） | 32 | +6（`seq11`） | 26 |
| R3 | +14（`seq26`，base6+cp8） | 46 | +14（`seq22`） | 40 |
| R4 | +14（`seq35`） | 60 → **−50 heavy** → 10 | +14（`seq31`） | 54 |
| R5 | +14（`seq45`） | 24 | +14（`seq41`） | 68 |
| R6 | +14（`seq55`） | 38 | +14（`seq50`） | 82 |
| R7 | +14（`seq64`） | 52 | +14（`seq61`） | 96 |
| R8 | +14（`seq74`） | 66 | +14（`seq70`）→ **−78 ranger**（`seq72`） | 32 |
| R9 | +14（`seq83`） | 80 | +14（`seq79`） | 46 |
| R10 | +14（`seq92`） | **94** | +14（`seq88`） | **60** |

- 我方：累计收入 **124**（6+6+14×8），花费 **50**（1 个 heavy），**无效花费 0**，末值 94 ✓
- 敌方：累计收入 **118**（6+14×8），花费 **78**（1 个 ranger，该单位 0 次攻击），末值 60 ✓
- 据点收益核验：cp_1 从 R3 起每轮 +8，共 8 轮 = **64 补给**，成本 = 2 个 scout 行动点 + 0 补给 → **收益远大于成本**
- `supplies` 权重为 0，所以敌方囤积的 60 补给与我剩余的 94 补给**对总分毫无贡献**——本图上补给只有花掉才有价值

## 失误与改进

第一名也需列出可量化的低效与风险决策：

1. **R3 `seq28` 是一次无后续跟进的行动点空转。** 实际做法：把 scout `84ea5d50` 从 (-5,5) 移到 (-2,5)。回放显示该单位**全程只有这 1 条 move 事件**，此后 R4–R10 再未移动或攻击，终局停在 (-2,5)、满血 65，对胜负零贡献（只贡献 armyValue 38 分，而这 38 分无论它站在哪都存在）。正确做法：既然已判定 heavy 会独占 R4–R10 的全部行动点，这一步应改为让已在 (-3,0) 的 scout `85911f50` 移到我 HQ 的另一个邻格 `(-3,1)` 或 `(-2,-1)`（`(-2,-1)` 需避开 R4 的 heavy 部署格，故应选 `(-3,1)`），多封一个敌方可站立的 HQ 邻格。触发条件：**当判定单一单位将独占后续所有行动点时，任何「只走一步且无后续」的推进都应换成防守站位或干脆保留**。预期收益：多封 1 个 HQ 邻格；本局敌方只打到 1 次 11 点，收益有限，但在敌方正常执行爆破的分支里可省 1–2 轮承伤（约 33–78 点 HQ 血 = 同额裁定分）。
2. **攻城单位在终局前 3 轮暴露于敌方远程射程内，而我没有任何对冲。** 实际做法：R8 `seq72` 敌方 ranger 落在 `(2,1)`，与我 heavy 所在的 `(1,0)` 距离 2 ≤ 其射程 3（44−13=31±3 → 28–34/击，需 5 击才能杀死 145 血的 heavy）；我判断「它打不死我」后未做任何规避，也未准备备选伤害源。回放证明这个判断结果正确（该 ranger 0 次攻击），但**依据是对手的实际行为，而不是局面的安全性**——若敌方从 R9 起集火 heavy，heavy 会在 R13 前后倒下，而我的第 4 击在 R10，余量只有 3 轮。正确做法：触发条件为「攻城单位处于敌方远程射程内，且击杀还需 ≥2 轮」时，预置一个换位方案（本图可提前炸 `(1,1)` 或 `(2,-1)` 换到另一侧敌 HQ 邻格）或提前一回合补第二个伤害源。预期收益：把「对手不集火」的运气依赖换成可控余量。
3. **R4 面对贴身敌 scout 时，「爆破 vs 攻击」的机会成本没有显式核算。** 实际做法：R4 敌方 scout `00d8ba47` 已在 `(-1,-2)`，与我部署在 `(-2,-1)` 的 heavy 相邻，但 heavy 的 `hasActed` 已用于 `seq38` 爆破 `(-1,-1)`（同一单位每回合只能做 attack/heal/demolish 中的一次），因此无法同回合还手；结果是 R5 白挨 5 点（`seq43`）、R6 再挨 11 点 HQ 伤害（`seq53`），合计 16 点。核算结论：若 R4 改为攻击该 scout（33–39，压到 26–32 血）、把爆破推迟到 R5（heavy 在 `(-2,-1)` 原地同样能炸 `(-1,-1)`），则首伤会从 R7 顺延到 R8、终局顺延到 R11 —— **省 16 点 HQ 血（=16 裁定分）却晚 1 轮击杀，是明显亏的**。所以本局的取舍是对的，但当时是凭直觉而非算出来的。改进：把这条换算写成明确规则——**在 HQ 伤害权重(20) 远高于 ownHqHp 权重(1) 的图上，1 轮首伤提前 ≈ 20×36 = 720 分的期望收益，远高于 16 点的承伤损失（16 分）**。

## 与历史对局对比

同为 `danger-close`（回放库中该图共 34 局）。

### 1. `tg_0175_20260928.json`（gameId `ff26da4a-bdfd-4418-b187-87a96a50d976`）— 同图 / 同对手 / 同 agent 代号，但 QD 输了

| 维度 | tg_0175 的 QD（`qwen3.8flash-QD`） | 本局的 QD（`Qwen3.8Max0902-QD`） |
|---|---|---|
| 席位 / 出生 | `player_b`，HQ `(2,0)`，`turnOrder` 索引 **0 = 先手** | `player_b`，HQ `(-2,0)`，`turnOrder` 索引 **1 = 后手** |
| 对手 | GLM5.3-WEB（`player_a`，HQ `(-2,0)`） | GLM5.3-WEB（`player_a`，HQ `(2,0)`） |
| 部署 | R4 infantry@(2,1) $45、R8 heavy@(2,1) $50 —— **都落在自己 HQ 邻格** | R4 heavy@(-2,-1) $50 —— 落在进攻出发格 |
| 爆破次数 | **0** | **2**（`seq38` (-1,-1)、`seq58` (1,0)） |
| HQ 伤害 | **0** | **120（满额）** |
| 结局 | R10 被淘汰，rank2，total **219**，ownHqHp 0 | R10 淘汰对手，rank1，total **2687**，ownHqHp 109 |

那局的胜者 GLM5.3-WEB 走的正是 heavy 穿环爆破：R4 deploy heavy@(-2,-1)$50 → R5 demolish(-1,-1) → R6 demolish(1,0) → HQ 攻击 R7/R8/R9/R10 = 36/36/36/12，total 2662、ownHqHp 120/120 未受伤。

→ **本局是对 tg_0175 的直接修正与验证**：同一套「heavy 穿环 + 炸 (1,0) 贴脸」原型，这次由 QD 执行，而且是在**后手**席位上完成（tg_0175 的 QD 是先手却输了）。同时验证了该图的一条硬规律：**完成爆破的一方获胜，输家的 `headquartersDamage` 恒为 0 或象征性的个位/十位数**。

### 2. `tg_0177_20260928.json`（gameId `ce3fcc95-a978-4d10-aa69-1f94e780ab01`）— 同图、同席位、同出生位、同为后手

胜者 `Dsv4.1Flash0910-WB` 也是 `player_b`、HQ `(-2,0)`、`turnOrder` 索引 1（后手），与本局我的席位/出生位/先后手**完全一致**。其路线：R4 deploy heavy@(-2,-1)$50 → R5 demolish(-1,-1) → **R8 demolish(2,-1)** → HQ 攻击 R9/R10/R11/R12 = 33/39/34/14，**R12** 终局，total 2664。

→ **本局比它快 2 轮（R10 vs R12），总分 2687 vs 2664。** 差异可精确定位到两处：① 我把「部署 heavy + 爆破 (-1,-1)」压进 R4 的**同一个行动点**（`seq37`/`seq38`，两者 `actionsUsed` 均为 1），而它用了 R4、R5 两个回合；② 我在 R6 就炸 `(1,0)`（`seq58`），它拖到 R8 才炸 `(2,-1)`。这构成本局相对历史局的**新发现**：在 `actionsPerTurn=1` 的图上，「部署当回合即可爆破（deploy 置 `hasMoved=true` 但 `hasActed=false`）」是能被榨出来的**整整一轮**，而一轮在本图上约等于 20×36 ≈ 720 分的 HQ 伤害期望。

### 3. `tg_0092_20260813.json`（gameId `b912a5cd-f040-41c1-b327-dc37ea6b8342`）— 同图，QD 系另一败局（定性对照）

`Qwen3.8Max-QD` 为 `player_a`、HQ `(2,0)`、`turnOrder` 索引 1（后手），HQ 伤害 **0**、total 247、被淘汰；胜者 `GLM5.2-OMP` 用 heavy@(-3,1)+ranger@(-2,1)+demolish(-2,1)，HQ 攻击序列 13/13/10/13/37/34（前四击为小单位磨血、后两击为重甲/游侠），total 2742。**该局回放的多数事件缺 `roundNumber` 字段（旧导出，`game_over.roundNumber` 亦为 undefined），轮次无法可靠引用**，故仅作定性对照：它同样印证「QD 系在 danger-close 上的两次败局都是 0 爆破 / 0 HQ 伤害」。

### 规律汇总

| 局 | 胜者 | 胜者爆破数 | 胜者 HQ 伤害 | 败者 HQ 伤害 | 终局轮 |
|---|---|---:|---:|---:|---:|
| tg_0092 | GLM5.2-OMP | 1 | 120 | 0 | 回放未提供 |
| tg_0175 | GLM5.3-WEB | 2 | 120 | 0 | R10 |
| tg_0177 | Dsv4.1Flash0910-WB | 2 | 120 | 0 | R12 |
| **tg_0186（本局）** | **QD@qwen3.8max0902** | **2** | **120** | **11** | **R10** |

## 总结

### 做得好的

1. **R4 用一个行动点同时完成 heavy 落地与破墙**（`seq37` deploy heavy@(-2,-1) $50 + `seq38` demolish (-1,-1)，两者 `actionsUsed` 均为 1/1），把首伤压到 R7（`seq67`），比同席位同出生位的历史胜局 `tg_0177` 快 2 轮。
2. **爆破格选择正确**：R6 `seq58` 炸 `(1,0)` 而不是 `(2,-1)`。回放地形显示 `(1,0)` 邻格除敌 HQ 外全是环内平格或墙、不通敌方外侧，而 `(2,-1)` 连通 `(3,-1)`/`(3,-2)`。结果敌方全程 `demolish=0`、始终没能把重装送进环内，我 HQ 只承 11 点（`seq53`）。
3. **经济与行动点零浪费**：R1/R2 用 2 个 scout 行动点拿下 cp_1（`seq8`/`seq18`/`seq19`），从 R3 起每轮 +8（`seq26` 起 `control=8`），使 heavy 能在 R4 落地；10 个席位回合全部消耗行动点、无空过；3 个回合做出「部署+爆破」「移动+爆破」「移动+攻击」的双动作。终局零单位损失（heavy 145/150、两 scout 满血），`armyValue` 124。

### 下次改进

1. **触发条件**：判定单一单位将独占后续全部行动点时。**替代动作**：不做「只走一步且无后续」的推进（本局 R3 `seq28` 的 scout 此后 7 轮再无动作），改为用该行动点封住己方 HQ 邻格（如 `(-3,1)`）。**预期收益**：多封 1 个敌方站立格，在敌方正常爆破的分支里可省 1–2 轮承伤（约 33–78 点 HQ 血）。
2. **触发条件**：攻城单位进入敌方远程单位射程且击杀还需 ≥2 轮（本局 R8 起 heavy 在 `(1,0)` 暴露于 ranger@`(2,1)` 的射程 3 内）。**替代动作**：预置换位方案（提前炸 `(1,1)`/`(2,-1)` 换到另一侧敌 HQ 邻格），或提前一回合补第二伤害源。**预期收益**：把 3 轮的裸余量变成可控余量，不再依赖「对手不集火」。
3. **触发条件**：R4 一类「敌方小单位贴身 + heavy 的 `hasActed` 尚未使用」的局面。**替代动作**：显式核算「本回合爆破 vs 攻击」——在 `enemyHqDamage=20`、`ownHqHp=1` 的权重下，提前 1 轮首伤 ≈ 720 分期望，远高于省下的十几点承伤（≈同额分数）。**预期收益**：把正确的直觉变成可复用的判据。

> **核心口诀：在 `actionsPerTurn=1` 的攻城图上，先算「几次爆破、几个行动点能站上敌方 HQ 邻格」再决定买什么；一个行动点能同时完成「部署+爆破」或「移动+攻击」时，那就是白赚的一整轮。**

**一句话总结：用 2 个 scout 行动点换下 cp_1 经济，R4 以单个行动点完成 heavy 落地并炸开 `(-1,-1)`，经墙内环捷径 3 个移动回合于 R7 站上 `(1,0)` 开火，四击 35/37/34/14 在 R10 打穿敌 HQ，以后手席位、仅承 11 点伤害、零单位损失拿下 2687 : 414。**
