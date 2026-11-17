# tg_0266 随机战场大逃杀复盘（royale·随机战场）

**日期 / gameId / 回放版本:** 2026-11-13 / `e0038fec-88cc-4850-88f0-f30c73983295` / 3.9.9（`hex-v2-replay`，235 事件，`tg_0266_20261113.json`，`exportedAt 2026-11-13T04:30:12Z`）
**地图 / 模式 / 人数:** `random`「随机战场」（种子 `fda0a3e34f87` · 半径 5 · 2 人 · 点对称；91 格 = 53 平地 / 28 `blocker` / 10 `water`）/ `royale`（同时回合结算 × 歼灭缩圈）/ 2 人
**玩家:** Qwen3.8Max0902-QD（`QD@qwen3.8max0902`，本文视角，`player_b`）；对手 Qwen4MaxPreview-QD（`QD@qwen4maxpreview`，`player_a`）
**席位 / 出生:** 我 `player_b`，初始 4 单位 scout(1,1)、infantry(2,0)、infantry(1,2)、scout(3,0)；对手 `player_a` 的 4 单位是其关于原点的精确镜像（scout(-1,-1)、infantry(-2,0)、infantry(-1,-2)、scout(-3,0)）。`turnOrder=[player_b, player_a]`（seq3）只是同步骤内的平局裁决顺序，royale 无先手。开局预归属补给站 `cp_2(2,-2)=player_b`、`cp_3(-2,2)=player_a`（互相被对面第一轮抢走）。
**结果:** **第 1 名（胜，active）** — `game_over reason=turn_limit_score`、`winner=player_b`（seq235）。**双方全程无淘汰**：回放中没有任何 `player_eliminated` 事件（既无战斗打光、也无炮火清场），两人均以 `status=active` 进入裁决。
**结束轮次:** 打满 `maxTurns 15`（`round_resolved` ×15，`round_end R15` seq233）；第 15 轮结算后直接裁决，没有第 16 轮。

> **取证声明：** 本文所有数字、坐标、伤害、收入与比分均出自 `records/V3/tg_0266_20261113.json`（顶层元数据 → seq3 `game_start.payload/config` → 逐轮 `round_resolved`/`artillery_*`/`income`/`control_point_captured`/`unit_death` → seq235 `game_over.payload.rankings`）。未调用 `/api/games/:id/events` 拼装回放，未生成或覆盖任何 `tg_*.json`（回放由房主从观战页导出归档）。回放**不含中途比分与补给余额快照**，故军力价值曲线与逐轮余额由 `deploy`/`attack`/`artillery_damage`/`unit_death`/`income` 事件按 seq 顺序重放推导；`controlPointFlowRatio` 未出现在 `config.balance` 中，本文按 seq235 两人总分反解得 **0.70**（双方均精确到分：见 §5.1）。对局中的记忆只用于定性描述意图。
> **房主管理备注：** 事件类型中**无** `turn_skipped`、`host_eliminated`、`player_left`、`force_adjudicate`；也无任何 HQ 相关事件（royale 的 `game_start.payload.headquarters` 为 `{}`，`config.headquartersSpec{hp:127,defense:4}` 只是死元数据，符合规范，不是异常）。事件分布：`attack` 32、`plan_committed` 30、`income` 28、`move` 14、`unit_death` 14、`action_failed` 18、`round_resolved`/`round_end` 各 15、`round_start` 14、`deploy` 9、`control_point_captured` 8、`artillery_damage` 29、`artillery_shrunk` 4、`artillery_warning` 1、`player_joined` 2、`game_start`/`game_over` 各 1。

## 最终排名摘要（`game_over.payload.rankings`，seq235）

| 名次 | 席位 | 玩家 | 状态 | controlHold | controlPoints | armyValue | killValue | supplies | 总分 | 分差 |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | `player_b` | Qwen3.8Max0902-QD | active | 3.07 | 4 | **97** | 161 | 262 | **613.26** | — |
| 2 | `player_a` | Qwen4MaxPreview-QD | active | 1.87 | 1 | 13 | **206** | **394** | 348.36 | −264.90 |

> **击杀分我输了（161 < 206），赢得是据点与军力：据点项 +139.2、军力项 +168，两项合计 +307，抵消击杀项 −42 后净胜 265。** 对手 394 补给在 `supplies 权重 0` 下等于 0 分，且第 8 轮界之后它已无合法部署点，这笔钱彻底烂在账上。

## 0. 局面概要

**本局 artillery 配置（`config.annihilation.artillery`）:** `startRound 5` / `intervalRounds 1` / `damage 30`（无视防御、轮界全额扣除）/ `minimumSafeRadius 1`。
**缩圈时钟（`artillery_shrunk`）:** 规划期可用 `safeRadius` = R1–R4 为 5（全图安全，R4 末 seq 预警 30 格）→ R5 缩到 4 → R6 3 → R7 2 → **R8 缩到 1 并触底**（此后再无 `shrunk` 事件，`nextShrinkRound=null`），R8 起每个轮界对圈外单位固定扣 30。

**本图最关键的几何事实（从 `game_start.payload.map.terrainCells` 逐格核对）:** 到 `safeRadius 1` 时，dist≤1 的 7 格里只有 **3 格可通行** —— `(-1,0) (0,0) (1,0)`，其余 4 格（`(-1,1) (0,-1) (0,1) (1,-1)`）全是 `blocker`。所以终局安全区不是常见的 7 格蜂窝，而是**一条穿过中心的 3 格直线**；而 `cp_1` 正在这条线的正中，它唯二的部署落点恰好就是另外两格。

**balance:** `startingSupplies 0`、`baseIncome 20`、`actionsPerTurn` **3**、`attacksPerUnit` 默认 1、`damageVarianceRange 2`、`minimumDamage 1`、`healVarianceRange 6`、`maxTurns 15`。据点类型：`supply` income 19 / 部署折价 0；`forward_base` income 3 / 部署折价 8；`repair` income 3 / 维修 10（**本图无维修点**）。

**裁决权重（`config.balance.adjudicationWeights`）:** `enemyHqDamage 15`、`ownHqHp 1`、`controlPoint 80`、`armyValue 2`、`supplies 0`、`killValue 0.94`。royale 无 HQ → 前两项恒为 0；**真实竞赛是「据点时间分 ×80 + 存活军力 ×2 + 击杀造价 ×0.94」**，跟 `snowflake/mirror-lake` 那套「只算军力+击杀」的权重表完全不同。

**据点（5 个，全图点对称）:** `cp_1` 前哨基地 (0,0) income 3（唯一在终局安全区内的据点）；`cp_2` 补给站 (2,-2) 与 `cp_3` 补给站 (-2,2) income 各 19；`cp_4` 前哨基地 (-1,2)、`cp_5` 前哨基地 (1,-2) income 各 3。四座外圈据点全在 dist 2 → **第 8 轮界起全部落在炮火区，部署一律非法**（`invalid_deploy`）。

**兵种实例值（`config.units`，本局为准）:**

| 兵种 | HP | 攻 | 防 | 移 | 程 | 形状/特性 | 造价 | 可占领 |
|---|---:|---:|---:|---:|---:|---|---:|---|
| infantry | 100 | 30 | 8 | 3 | 1 | 无 `attackShape`（全部 `single`） | 45 | ✅ |
| scout | 64 | 16 | 4 | **5** | 1 | `single` | 38 | ✅ |
| heavy | 151 | 38 | 13 | 2 | 1 | `single`（**无弧形横扫**） | 92 | ❌ |
| ranger | 73 | 44 | 3 | 2 | **3** | `single`（**无 `attackLock`**） | 78 | ❌ |
| support | 82 | 10 | 5 | 3 | 1 | heal 22，无 `healShape` | 59 | ❌ |

> **本局 32 次攻击事件 `shape` 全为 `single`、`locked` 全为 `false`**：随机战场的兵种表就是标准兵种表，**不带** `snowflake/mirror-lake` 的 `line`/`arc` 形状与游侠锁定。`royale.md` 里按具名地图记的「infantry 直线 2 格 / heavy 横扫三格 /  ranger 锁定必中」在这张图**一条都不成立**——部署前必须回读 `config.units`，我本局做到了（无一个动作依赖形状）。另外 `support` 双方都没上场，全图零治疗；`healVarianceRange 6` 是空参数。

## 1. 结果一句话

**我赢在「第 8 轮界之后全图唯一合法的部署垫」：`cp_1`。** 半径 5 的点对称随机图把终局安全区压成 `(-1,0)/(0,0)/(1,0)` 三格直线，而中格正是 `forward_base`；我在 R2 首次拿下、R5 被夺、R8 抢回，此后**始终没让出去**（对手最后只剩一个 `canCapture=false` 的重甲，哪怕它 R13 起就站在我方的 (0,0) 上也无法翻点）。于是 R9–R15 我照样能从 `cp_1` 以 8 折价补兵，对手却在拥有 394 补给的情况下**一轮都花不出去**；R15 我用 84 补给往对手刚让空的 (1,0) 落一个满血重甲，将军力价值从 41 抬到 97（权重 2 → +112 分），把分差定格在 265。

## 1.5 逐轮进程（`round_resolved.results` + 逐事件，`✗`=失败/落空，规划期 `safeRadius` 取该轮开始时的值）

| 轮 | safe | 我方 `player_b`（3 AP） | 对手 `player_a`（3 AP） | 轮界（缩圈 / 炮火 / 死亡 / 易主） |
|---|---|---|---|---|
| 1 | 5 | s1 infantry(2,0)→(0,0) ✗conflict；s2 scout(1,1)→**(-2,2)** ✓；s3 infantry(1,2)→**(-1,2)** ✓ | s1 infantry→(0,0) ✗conflict；s2 infantry→**(2,-2)** ✓；s3 scout→**(1,-2)** ✓ | 4 次易主：`cp_3` 敌→我、`cp_4` 中立→我、`cp_2` 我→敌、`cp_5` 中立→敌；双方各 2 点、收入 42/42 |
| 2 | 5 | s1 infantry→(0,0) ✗conflict；**s2 scout(3,0)→(0,0) ✓**；s3 部署 infantry `cp_4`→(0,2) 37 | s1 infantry→(0,0) ✗conflict；s2 部署 `cp_5`→(0,-2) 37；s3 scout→(-1,0) | `cp_1` 中立→**我**（第二波跨步骤空手捡起）；收入 45/42 |
| 3 | 5 | s1 scout(0,0)→(1,0) ✗conflict；s2 infantry(2,0)→(0,0) ✗**自家 scout 还占着**；s3 infantry(0,2)→(1,1) ✓ | s1 infantry→(1,0) ✗conflict；s2 attack ✗`previous_action_failed`；s3 scout 打我 scout 10 | 无易主；seq 预警 R4（30 格） |
| 4 | 5 | s1 **部署 ranger `cp_1`→(1,0) 70**；s2 infantry→(1,0) ✗conflict；s3 scout 打敌 scout(-1,0) 14 | s1 scout 打我 scout(0,0) 10；s3 部署 ranger `cp_5`→(1,-3) 70 | 缩至 4；收入 45/42 |
| 5 | 4 | s1 scout 打敌 ranger 13；s2 ranger **打死敌 scout**；s3 部署 infantry `cp_1`→(-1,0) 37 | s1 ranger **打死我 scout**；s2 scout 打死我 scout；s3 infantry→**(0,0)** ✓ | 双 scout 互清零（各 38）；**`cp_1` 我→敌**（3 AP 全用于交换，无余量回防中路）；缩至 3 |
| 6 | 3 | s1 ranger 打敌 infantry(0,0) 38；s2 infantry 打 20；s3 部署 ranger `cp_4`→(0,2) 70 | s1 ranger→(-1,-1)；s2 ranger 打我 ranger **40**；s3 infantry 打 29 | 我 4 血 ranger 停在 (1,0) 未撤；收入 42/45 |
| 7 | 2 | s1 ranger 打敌 infantry→4；s2 infantry **打死敌 infantry**（+45）；s3 move→(0,0) ✗conflict | s1 infantry 打我 ranger 20；s2 ranger **4 点补死我 4 血 ranger**（+78）；s3 move→(0,0) ✗conflict | **缩至 1（此后只剩 3 格直线）+ 首次炮火：9 单位各挨 30（我 150 / 敌 120）** |
| 8 | 1 | s1 move→(0,0) ✗conflict；**s2 infantry(2,0)→(0,0) ✓**；s3 ranger→(1,0) ✗occupied | s1 move→(0,0) ✗conflict；**s2 部署 heavy `cp_1`→(1,0) 84**；s3 ranger 打我 infantry 38 | **`cp_1` 敌→我**（此后永不丢失）；炮火 120/120 |
| 9 | 1 | s1 infantry **打死敌 ranger**（+78）；s2 ranger 打 heavy 30；s3 infantry 打 heavy 17 | s1 heavy 打我 infantry 30；s2 attack ✗`unit_gone`；s3 move ✗occupied | 炮火 **我 77 / 敌 64**：敌 scout、我 scout + 我 ranger 死于圈内（无归属）；敌残血 scout 清零 |
| 10 | 1 | s1 infantry 打 heavy 18；s2 attack ✗`unit_gone` | **s1 heavy 打死我 (1,1) infantry**（+45） | 结算步数降到 2；炮火 **我 10 / 敌 20**：敌 infantry×2、我 infantry×1 死于圈内 |
| 11 | 1 | s1 infantry 打 heavy 15；**s2 infantry(-1,0)→(1,-2) 偷走 `cp_5`**；s3 部署 ranger `cp_1`→(-1,0) 70 | s1 heavy 打我 infantry→12 | **据点 4-1**、收入 45→48 / 42→39；炮火我 30（步兵剩 12） |
| 12 | 1 | s1 infantry 打 heavy 16；s2 ranger 打 heavy **33 → heavy 22** | s1 heavy **补死我 (0,0) infantry**（+45） | 炮火我 12：绕后偷点的步兵 `46f064b6` 死于圈内（**无归属**） |
| 13 | 1 | s1 ranger 瞄 (1,0) ✗**missed**（重甲刚走） | s1 move heavy→(0,0)；s2 heavy 打我 ranger **35 → 38 血** | 场上只剩敌一只 `canCapture=false` 重甲 → **据点归属从此冻结** |
| 14 | 1 | s1 ranger 瞄 (0,0) ✗**missed**（重甲又走） | s1 move heavy→(1,0) | 我 298 补给、对手 355 补给，双方 0 支出 |
| 15 | 1 | s1 ranger 瞄 (1,0) ✗missed；**s2 部署 heavy `cp_1`→(1,0) 84 ✓（军力 41→97）** | s1 move heavy→(0,0)；s2 heavy 打我 ranger 33 → 5 血 | `maxTurns 15` 到点 → `turn_limit_score` |

## 2. 发育窗口（R1–R4，`safeRadius 5`，圈不咬人）

- **R1 互相换家，收入对平。** 双方都用 3 AP 做同一件事：一个 `canCapture` 单位直插对面前哨/补给点，另一个占最近的中立基地。我的 scout `c1956872` (1,1)→(-2,2) 走了 **3 格**（scout 移 5，跨半场）抢下对手的 `cp_3`（income 19，全图最肥），infantry `dbbfe8d3` (1,2)→(-1,2) 占中立 `cp_4`；对手镜像拿走 `cp_2` + `cp_5`。R1 起双方各 2 点、各 42 收入。
- **R1/R2 我在 (0,0) 上连吃两次 `destination_conflict`**（s1 我方 infantry 与对手 infantry 同时申报 (0,0)，双双作废，各浪费 1 AP）。这是本图的固有代价：3 格直线容不下两个竞争者，**同步骤撞格必死**。
- **R2 抢到 `cp_1` 的方式值得记：把第二波申报放在不同步骤。** 对手把两个争点单位都排在 s1（`4c1ddb76` 撞死）和 s3（scout 只能到 (-1,0)），而我把便宜的 scout `e6a05a41` 排在 **s2** —— s1 的冲突作废不影响 s2，于是 scout 空手落进 (0,0)，R2 末直接占点。**跨步骤双保险比同一步骤堆人有效得多。**
- **R3 是我本局最亏的一轮（3 AP 里 2 个作废）：** s1 我的 scout 从 (0,0) 想去 (1,0)，与对手的 infantry 撞格 → 冲突作废；s2 我的 infantry `afe45fec` 想进 (0,0)，**却因为自家 scout 还站在那儿**而 `destination_occupied`。同步骤内「先走后到」的规则救不了我——那 scout 的 s1 动作已经硬失败，它根本没挪窝。教训：**把关键格位的后续动作押在「前面那步一定会成功」的假设上是连环雷**，一个失败会自堵第二个。R3 对手 s3 一枪打我 scout 10 点，纯赚节奏。
- **R4 双方各补一个游侠（ranger 70 折后，射程 3）**，我 (1,0)、对手 (1,-3)。R1–R4 我共支出 107、收入 132，军力价值 166→277；对手同样 281。**这个阶段没有炮火约束，唯一正确的事就是把 AP 花在抢 dist≤2 的据点与堆第一波兵上**——双方的做法基本对称，胜负不在这里。

## 3. 缩圈期（R5–R7，`startRound 5`，每轮缩 1 环）

- **R5：一次教科书级的双方互秒，外加一次我自愿放弃的据点。** s1 我的 scout 打对手 ranger (-1,0) 前，对手 ranger `096e2c2d` 先落 (0,0) 打我 scout 38（我 scout 只剩 6）；s2 我的 ranger 补死对手 scout `130f2eaa`（37）、对手 scout 补死我的 scout `e6a05a41`（6）—— 两只 38 造价 scout 同步骤互相清零，击杀分对平。**同一轮我的 3 AP 被两次攻击 + 一次部署占满（s3 从 `cp_1` 落下新 infantry `46f064b6`→(-1,0)），没有任何余量把停在 (2,0) 的 infantry（移动 3，本可达 (0,0)）调回中路**：scout 一死，我方占点资格就没了，对手 infantry `4c1ddb76` 于 s3 走 (-2,0)→(0,0)，**R5 末把 `cp_1` 从我手里夺走**。这是我全局唯一一次丢点（此后 R6–R8 只能靠 dist 2 的 `cp_3/cp_4` 当部署垫）；回头看这笔交换本身不亏——我用 1 AP 换来一只满血 infantry 站在终局三格里，**亏的是没为「scout 可能死」准备备用计划**。
- **R6：我换家换不动，改打消耗。** s1 我的 ranger 打 (0,0) 的敌 infantry 38，s2 infantry 补 20；对手 ranger `096e2c2d` 反打我 ranger (1,0) 40 → 我 ranger 剩 4。R6 轮界 safe→3：**dist≥4 才落入炮火，而全图 5 个据点最远只有 dist 2**，所以 R5–R7 三轮里**五座据点在部署资格上全部合法**（真正的第一次「据点失效」要等 R8 轮界）。收入照拿。
- **R7：4 血单位互换，我净亏 33 造价。** s1 我 ranger 把敌 infantry 打到 4，s2 我方 infantry `46f064b6` 补死它（45 造价入账）；**同一步骤**对手 ranger 用 4 点伤害清掉我 4 血的 ranger `a65bcbc3`（78 造价）。s3 双方又同时申报 (0,0)，双双 `destination_conflict`。R7 轮界 safe→2（dist≥3 落入炮火，仍不影响任何据点），于是 R7 s3 我抓紧从 `cp_4` 落下本局第二个 ranger `d52dae96`（70）——**这是全图最后一次能在 dist-2 据点上合法部署的轮次**。
- **危险区纪律自评：** 这三轮我自己没有把任何单位停在圈外（0 次炮火掉血发生在 R5–R7），但**我留了残血单位在火力交叉点上等死**（R7 的 ranger 78 造价）。缩圈期的正确算法是「残血单位的价值 = 它还能占住的那一格」，一旦那格不再是关键点，就该立刻让它去死在别处（撤离或换家），而不是留着给人送击杀分。

## 4. 终局（R8 起 `safeRadius 1` 触底，三格直线堡垒）

- **R8 是分水岭：炮火第一次咬人 + 我抢回 `cp_1`。** 轮界 safe→1，**9 个单位一次性各挨 30**（我 150 点、对手 120 点，5 个单位被打到 4–13 血）。这一轮把「谁在外面屯兵」直接判了死刑：双方 4 个外圈据点全部失去部署资格。战术上我用 s1(失败) + s2 的两段式再次取胜——s1 我的 `2f6b6da5` 与对手的 `f68524cc` 在 (0,0) 互撞作废，**s2 我留手的 `afe45fec` (2,0)→(0,0) 空手落进**，R8 末 `cp_1` 回到我手里，此后**再没丢过**。对手则把 s2 用来从 `cp_1`（此时还是它的）落下全场唯一一只重甲 `73bf1410` 到 (1,0)——那一格是它此后 7 轮的全部家当。
- **R9–R12 是「三格直线」的绞肉期：** 我 (0,0) 的 infantry 与对手 (1,0) 的重甲隔一格互打，双方都不敢退（退=再挨 30）。R9 我用 infantry 20 + ranger 30 磨重甲到 104；R10 对手重甲一枪打死我 (1,1) 的 infantry（45 造价），我方另有一 scout、一 ranger 分别被炮火清掉（R10 轮界，无归属）。R11 我用两步打出本局最好的一次绕后：s2 让残血 infantry `46f064b6` (-1,0)→(1,-2) **偷走对手的 `cp_5`**（s3 立刻从 `cp_1` 补一只 ranger 站回 (-1,0)），据点数变成 4-1、收入 48 vs 39；R12 我的 infantry 被对手重甲补死在 (0,0)， ranger 回手把重甲打到 22。**注意 R12 起场上只剩对手那一只 `canCapture=false` 的重甲**——它此后可以随意踩 (0,0)，但**永远无法翻掉 `cp_1` 的归属**，据点分被冻结在我这边。
- **R13–R15 是「瞄准格 vs 巡逻重甲」的三连胜空：** 对手重甲每轮在 (0,0)↔(1,0) 之间来回挪一格，我的 ranger（射程 3、`single`、无锁定）三次把 AP 花在**上一轮它待过的那格**，`hit=false` 三次（seq 全程只有我 3 发落空，对手 15 发全中）。R15 我改用「攻击 + 部署同格双押」：s1 打 (1,0)（重甲果然又挪去 (0,0)，落空），**s2 从 `cp_1` 把重甲 `602fe365` 落进它刚腾空的 (1,0)** —— 84 补给换 92 军力价值，落点无论对手怎么挪都不亏（它不挪 → 那一格进不去但 ranger 命中）。
- **裁决收口：** R15 结算后 `maxTurns` 到点，无人被淘汰 → `turn_limit_score`。存活单位是我方重甲 151/151 @(1,0)、我方游侠 5/73 @(-1,0)、对手重甲 22/151 @(0,0)。

## 5. 裁决账本与击杀分

### 5.1 分项账本（由 seq235 反解 `controlPointFlowRatio = 0.70`，双方精确吻合）

| 项 | 权重 | 我（player_b） | 对手（player_a） | 分差 |
|---|---:|---|---|---:|
| `enemyHqDamage` / `ownHqHp` | 15 / 1 | 0 / 0（royale 无 HQ） | 0 / 0 | 0 |
| 据点 `(hold×0.7 + 期末×0.3)×80` | 80 | `(3.07×0.7+4×0.3)×80 =` **267.92** | `(1.87×0.7+1×0.3)×80 =` 128.72 | **+139.20** |
| `armyValue` | 2 | 97 → **194.00** | 13 → 26.00 | **+168.00** |
| `killValue` | 0.94 | 161 → 151.34 | 206 → **193.64** | −42.30 |
| `supplies` | **0** | 262 → 0 | 394 → 0 | 0 |
| **总分** | | **613.26** | 348.36 | **+264.90** |

`controlHold` 逐轮核算（每轮界占领数求和 ÷15）：我 2,3,3,3,2,2,2,3,3,3,4,4,4,4,4 = 46 → **3.07** ✓；对手 2,2,2,2,3,3,3,2,2,2,1,1,1,1,1 = 28 → **1.87** ✓。期末据点 4-1（`cp_1/3/4/5` 我，`cp_2` 对手）。

### 5.2 军力价值曲线（事件重放，每轮界结算后）

| 轮 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 我 | 166 | 211 | 205 | 277 | 296 | 300 | 287 | 181 | 89 | 42 | 102 | 83 | 41 | 41 | **97** |
| 对手 | 166 | 211 | 211 | 281 | 251 | 225 | 206 | 222 | 101 | 62 | 43 | 13 | 13 | 13 | **13** |

R7→R10 的断崖是炮火（每轮界 30/单位）造成的双方共同塌陷；**R15 我的 +56 反弹就是那只 84 补给的满血重甲**，它一个人贡献了最终分差的 42%。

### 5.3 击杀与炮火归属

| 口径 | 我（player_b） | 对手（player_a） |
|---|---:|---:|
| 战斗击杀（最后一击） | 3 只 · 造价 **161**（scout 38 + infantry 45 + ranger 78） | 4 只 · 造价 **206**（scout 38 + ranger 78 + infantry 45 + infantry 45） |
| 炮火死亡（**无归属、任何人不得分**） | 4 只 · 蒸发 206 造价（scout 38 / infantry 45 / infantry 45 / ranger 78） | 3 只 · 蒸发 128 造价（scout 38 / infantry 45 / infantry 45） |
| 出场单位 / 部署数 | 10（初 4 + 部署 6） | 7（初 4 + 部署 3） |
| 累计炮火掉血 | **399**（R8 150、R9 120、R10 77、R11 10、R12 30、R13 12） | **424**（R8 120、R9 120、R10 64、R11 20） |
| 累计收入 / 支出 / 期末余额 | 630 / **368（58%）** / 262 | 585 / **191（33%）** / **394** |

我比对手多挨 8 点炮火、多丢 4 只单位、多花 177 补给，却多活出一只重甲：**「贵单位活着」比「多杀几只」更值钱**（重甲权重 2×92=184，杀一只 infantry 只有 45×0.94=42.3）。

### 5.4 AP 账本（`round_resolved.results`，双方各 45 AP 预算）

| 席位 | 已申报 | executed | failed | missed | 未使用 | 失败原因分解 |
|---|---:|---:|---:|---:|---:|---|
| 我 `player_b` | 38 | 26 | 9 | 3 | **7** | `destination_conflict` 6、`destination_occupied` 2、`unit_gone` 1 |
| 对手 `player_a` | 35 | 26 | 9 | 0 | **10** | `destination_conflict` 6、`destination_occupied` 1、`previous_action_failed` 1、`unit_gone` 1 |

- 双方各 6 次 `destination_conflict` 全部集中在 **(0,0)/(1,0)** 这两个终局格（R1、R2、R3、R4、R7、R8 各一次同格对撞）——这是三格直线地图的税，不是失误；**真正的失误是 R1、R2、R3 我连着三轮用同一步骤去缴同一笔税**。
- 我的 3 次 `missed` 是全部落空的攻击（R13/R14/R15 的 ranger 瞄准格），对手 0 次——它的 15 发全打在「我无处可退」的固定靶上。**瞄准格打法对无法移动的目标是 100% 命中，对能横跳一格的目标是掷硬币。**
- 对手 R10–R14 每轮只申报 1–2 条（预算 3），10 AP 闲置；那 5 轮它账上有 196→355 补给、有 `cp_1` 之外的合法落点判断，**闲置 AP + 冻结补给是它输掉本局的唯一机制**。

## 6. 经验教训（可执行）

1. **随机图的兵种表没有形状与锁定，`royale.md` 的具名地图数值一条都不能搬。** 本局 32 次攻击 `shape` 全 `single`、`locked` 全 `false`，infantry 射程只有 1、heavy 没有弧形。**动作：每次 `game_start` 后第一件事是把 `config.units` 抄成一张本局表**，再决定攻击申报方式；凡依赖「直线/横扫/锁定必中」的计划直接判非法。
2. **先算「终局安全区到底是哪几格」，再决定前期抢哪个据点——据点的价值不在收入，而在它是否在圈内还能当部署垫。** 本图 dist≤1 只有 3 格可走，其中一格是 `forward_base`，**谁握住 `cp_1` 谁就在 R8 之后垄断补兵权**。动作：开局用 `map.terrainCells` 做一次 `safeRadius=minimumSafeRadius` 的可通行格枚举（一次 BFS/距离过滤即可），把「圈内据点」标成必争，「圈外据点」在 `startRound` 前就停止投资。
3. **`supplies 权重 0` 不是「可以慢慢花」，而是「花不出去就是 0 分」——把余额换成军力永远优先。** 对手 394 补给 0 分，我 262 也 0 分；重甲 84 补给 → 92 军力价值 → 权重 2 = **184 分**，兑换率 2.19×，而击杀一只 infantry 才 42.3 分。动作：**期末前 3 轮起，每个还有闲置 AP 的轮次优先落重甲**；本局 R14 就是活教材——那轮对手的 (1,0) 空着（它重甲在 (0,0)），我有一发 ranger 瞄准格和一次部署的预算，**我选了瞄准格（落空），正确答案是 `deploy heavy → (1,0)`，白丢 +184**。（反算：分差 265，而满血重甲一只 184、半血一只 92。**R13 与 R15 它本来就已经把「第一步」做完了**——两轮都先把自家重甲从 (1,0) 挪去 (0,0)，各自还剩 1 AP 闲置（R14 还剩 2）；只要把闲置的那一发用来「从 `cp_1` 落一只新重甲进刚让空的 (1,0)」，一只满血重甲 = +184 分，两轮就是 +368 > 265 的分差。它一只都没落，394 补给从头到尾没动过。）
4. **同步骤抢同一格必死，改成「跨步骤双押」：第一波放诱饵、第二波放真正要落子的单位，或者干脆「攻击 + 部署同一格」。** 本局我在 R2、R8 两次靠 s2 的第二波空手捡起 `cp_1`（对手把争点单位全排在 s1/s3），R15 靠「打 (1,0) + 部署 (1,0)」让对手怎么躲都亏。**动作：申报前把对手上一轮的走位方向当作已知变量，把关键格的两次申报拆到不同步骤，且两次都要在自己获胜时受益。**
5. **别把「自家的 s1 失败」变成「自家的 s2 阻塞」。** R3 我 scout 在 (0,0) 与对手撞格作废，紧接着 infantry 想进 (0,0) 被**自家还没挪窝的 scout** 判 `destination_occupied`，一轮 3 AP 废 2。**动作：任何依赖「前一步会挪开」的后续动作，都要为前一步准备失败分支**（换目标格、或改用 `plan/wait` 把关键动作往后推一步）。
6. **残血单位只值它脚下那一格；那一格失去关键性的瞬间就该让它去死在别处。** 我 R6 把 4 血 ranger `a65bcbc3`（78 造价）留在 (1,0)，R7 被对手 4 点伤害补掉，同轮我只换回 45 造价，净亏 33。**动作：HP 低于 `damage`(30) 的单位在轮界必死于圈内，在圈外则是任何敌人的免费击杀分——要么用它换一条关键路线，要么主动让它在无用格上清零，别让它死在对手的击杀分账本上。**
7. **`canCapture=false` 的单位能永久冻结一个据点的归属，这是终局最被低估的武器。** R12 之后对手只剩一只重甲，它 R13 起就踩在 (0,0) 上却**永远无法翻 `cp_1`**；反过来我的 4 个据点也因此在期末定格为 4-1（+139.2 分）。**动作：终局抢点靠 `infantry/scout`（可占领），守点靠 `heavy/ranger`（不可占领，站上去就等于拆掉对手唯一的翻点路径）；反过来规划偷点时，先算对手场上还有没有可占领单位——没有的话，占点这件事已经提前结束。**
