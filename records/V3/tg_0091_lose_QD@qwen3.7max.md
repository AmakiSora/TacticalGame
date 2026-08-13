# 战术游戏第2名复盘 — `player_b` 视角

**日期:** 2026-08-13
**游戏ID:** `35507e25-57ab-4ced-8d85-fbf8684b79c4`
**回放版本/地图:** 3.2.10 / `artillery-zone`（炮火禁区）
**模式:** annihilation；无 HQ
**玩家:** Qwen3.7Max-QD（QD@qwen3.7max）
**席位与出生:** `player_b`，行动顺序第 1（`turnOrder: [player_b, player_a]`）；slot_east，初始 2×infantry@(5,0)、(5,-1) + heavy@(4,1)，初始控制点 `cp_east`@(4,0)
**参战人数/最终名次:** 2 人 / 第 2 名
**结果:** ❌ 存活至第 12 整轮，但轮数裁决落后 `player_a`
**结束原因:** `turn_limit_score`
**最终补给/HQ/总分:** 286 / 不适用（无 HQ） / 482 分

> 数据来源：API 实时事件流，227 条事件。全局计数：23 次 `income`、7 次 `deploy`、39 次 `attack`、11 次 `control_point_captured`、4 次 `artillery_shrunk`、4 次 `artillery_warning`、14 次 `artillery_damage`、11 次 `unit_death`。以下数字和坐标均以事件为准。

---

## 最终排名摘要

| 名次 | 席位 | 玩家 | 状态 | 总分 | 与我方分差 | 决定性优势 |
|---|---|---|---|---:|---:|---|
| 1 | `player_a` | MiniMaxM3-OMP | 存活 | 598 | +116 | 部署 5 次、持续施压、actionScore 450 |
| **2** | **`player_b`** | **Qwen3.7Max-QD** | **存活** | **482** | — | 击杀 5 单位但部署仅 1 次 |

本局裁决权重为 `enemyHqDamage=0`、`ownHqHp=0`、`controlPoint=0`、`armyValue=2`、`supplies=0`、`effectiveActions=10`。因此：

- 我方：无 HQ（不适用）；控制点 3×0；armyValue 66×2=132；补给 286×0；actionScore=350；**总分 482**。
- `player_a`：无 HQ（不适用）；控制点 5×0；armyValue 74×2=148；补给 81×0；actionScore=450；**总分 598**。
- 核心差距：armyValue 落后 8 折合 **16 分**；actionScore 落后 100 折合 **1000 分差中的 100 分**。补给 286 不参与裁决（权重 0），完全浪费。

---

## 核心教训

### 致命错误：actionScore 系统性落后——部署仅 1 次（83 补给），对手部署 5 次（348 补给）

**问题：** 全 12 轮中，我方仅在 R3 从 `cp_east`@(4,0) 部署 1 个 infantry@(5,0)（花费 45 补给，seq 39）和 R1 部署 1 个 scout@(4,1)（花费 38 补给，seq 6），合计 83 补给。`player_a` 则部署了 ranger@(-4,1)×2（seq 28、100）、scout@(-3,-1)×2（seq 83、120）、support@(0,-2)（seq 185），共 5 次 348 补给。

**后果：** 每次部署贡献 actionScore 的 deploy merit（约 +1 merit × 10 = 10 actionScore），5 次部署带来约 40 actionScore 差距。同时多出的单位提供了更多攻击机会（`player_a` 21 次攻击 vs 我方 18 次），进一步拉大 actionScore。我方最终剩余 286 补给，因 `supplies` 权重为 0，不参与裁决——这些补给等于完全浪费。

**正确做法：** R5-R7 收入稳定在 28/轮时，应每 2 轮从 `cp_east`@(4,0) 部署 1 个 scout（38 补给），利用 cp_east 作为前线部署点。12 轮中至少应部署 4-5 个单位（scout/infantry），将补给转化为场上军力和 actionScore。触发规则：**当补给 > 100 且拥有安全控制点时，优先部署低成本单位（scout 38），而非囤积补给。**

---

## 关键时间线

| 整轮/席位回合 | 补给/行动点 | 我的操作 | 对手响应 | 问题或收益 |
|---|---|---|---|---|
| 第1轮 / `player_b` | 45→7 / 4/4 | infantry1 (5,0)→(3,0) 占 `supply_east`；heavy (4,1)→(4,-1)；部署 scout@(4,1) 38补；infantry2 (5,-1)→(4,-2) | — | ✅ 抢占经济点，但 scout 部署位置偏后 |
| 第1轮 / `player_a` | 12 / 3/4 | 3 单位向中心推进，infantry 占 `supply_west`@(-3,0) | — | 对手同步抢占西侧经济 |
| 第2轮 / `player_b` | 20→20 / 4/4 | infantry1 (3,0)→(2,0)；scout (4,1)→(3,-3)；infantry2 (4,-2)→(1,-1)；heavy (4,-1)→(2,-1)；scout 占 `supply_northeast` | — | ✅ 快速扩张至 3 CPs |
| 第2轮 / `player_a` | 20 / 3/4 | 部署 ranger@(-4,1) 72补；infantry 占 `supply_southwest`@(-3,3) | — | 对手也扩至 3 CPs，且部署高价值 ranger |
| 第3轮 / `player_b` | 28→28 / 4/4 | infantry2 (1,-1)→(0,-3)；heavy (2,-1)→(0,-1)；infantry1 (2,0)→(0,0)；部署 infantry@(5,0) 45补；infantry2 占 `supply_northwest` | — | ✅ 达到 4 CPs 峰值 |
| 第3轮 / `player_a` | 28 / 3/4 | ranger (-4,1)→(-1,0) 攻击 infantry1 39伤(100→61HP)；heavy (−2,−2)→(0,−2) 攻击 infantry2 32伤(100→68HP) | — | ❌ 两个步兵被夹击，R4 失去大量输出 |
| 第4轮 / `player_b` | 36→36 / 4/4 | infantry1+heavy 集火 ranger (47→9HP)；infantry2 攻击 heavy 20伤；infantry1 撤至(-1,1)；新 infantry 推进 | — | 集火有效但未击杀 |
| 第4轮 / `player_a` | 28 / 3/4 | heavy 攻击 infantry2 32伤(68→36HP)；ranger 攻击 heavy 28伤(150→122HP)；占 `cp_southwest` | — | 对手夺回 cp_southwest |
| 第5轮 / `player_b` | 36→36 / 4/4 | infantry1 (-2,1) 击杀 ranger@(-2,0) 9伤(seq 72-73)；infantry2+heavy+scout 围攻 heavy 51伤(150→79HP) | — | ✅ **关键击杀** ranger，heavy 大量掉血 |
| 第5轮 / `player_a` | 32 / 2/4 | heavy 反击 infantry2 28伤(36→8HP)；部署 scout@(-3,-1) 38补 | — | 对手 heavy 仍有 79HP |
| 第6轮 / `player_b` | 36→36 / 4/4 | heavy+scout 攻击 heavy (79→53HP)；infantry1 撤离炮火区 (-2,1)→(0,0) | — | 继续施压但未击杀 |
| 第6轮 / `player_a` | 32 / 4/4 | heavy 击杀我方 infantry2@(−1,−1) 27伤(8→0HP)(seq 98-99)；部署 ranger@(-4,1) 72补；scout 占 `supply_northwest`@(0,−3)(seq 101) | — | ❌ **失去步兵和 supply_northwest**，经济开始落后 |
| 第7轮 / `player_b` | 28→28 / 4/4 | 新 infantry (3,0)→(1,0)；heavy (0,-1)→(-1,-1) 攻击 heavy 23伤(53→30HP)；scout (1,-2)→(0,-2) 攻击 5伤(30→25HP)；infantry1 (0,0)→(0,-1) | — | 继续围攻 heavy |
| 第7轮 / `player_a` | 40 / 4/4 | heavy 反击 heavy 22伤(128→100HP)；ranger 攻击 infantry1 33伤(61→28HP)；部署 scout@(-3,-1) 38补 | — | 对手收入达到 40/轮 |
| 第8轮 / `player_b` | 28→28 / 4/4 | infantry1 (-1,0) 攻击 ranger 26伤(46→20HP)；heavy (−1,−1)→(0,0) 攻击 ranger 34伤(20→12HP)；scout (0,-2)→(-1,-1)；infantry (1,0)→(0,-1) | — | 围攻 ranger 但未击杀 |
| 第8轮 / `player_a` | 40 / 4/4 | ranger 击杀我方 infantry1@(−1,0)(seq 135-136)；heavy 攻击 scout 37伤(65→28HP)；部署 scout@(-4,1) 38补；scout 攻击 scout 15伤(28→13HP) | — | ❌ **失去第2个步兵**，scout 残血 |
| 第9轮 / `player_b` | 28→28 / 3/4 | scout (-1,-1)→(-1,0)；heavy (0,0)→(0,1)；infantry (0,-1)→(-1,-1) 攻击 heavy 18伤(25→7HP) | — | heavy 只剩 7HP！ |
| 第9轮 / `player_a` | 40 / 4/4 | heavy 反击 infantry 30伤(70→40HP)；heavy 撤至(-2,-3)；ranger 击杀我方 scout@(−1,0)(seq 159-160)；部署 scout@(0,-2) 38补 | — | ❌ **scout 被击杀**（在炮火危险区） |
| 第10轮 / `player_b` | 28→28 / 2/4 | infantry (-1,-1)→(-2,-2) 击杀 scout@(-3,-1)(seq 174-175)；heavy (0,1)→(0,0) 击杀 ranger@(-1,1)(seq 177-178) | — | ✅ **双杀！** 炮火也击杀了敌方 heavy@(-2,-3) |
| 第10轮 / `player_a` | 40 / 3/4 | scout (0,-2)→(0,-1) 攻击 heavy 2伤；scout 攻击 infantry 5伤(57→52HP)；部署 support@(0,-2) 60补 | — | 对手部署 support 保持军力 |
| 第11轮 / `player_b` | 28→28 / 2/4 | infantry (-2,-2)→(-1,-1) 撤离炮火；heavy 攻击 scout2 33伤(32→残) | — | 仅 1 次有效攻击 |
| 第11轮 / `player_a` | 40 / 3/4 | scout2 攻击 heavy 3伤(98→95HP)；scout1 攻击 infantry 10伤(32→22HP)；support (-1,-2) | — | 对手保持压力 |
| 第12轮 / `player_b` | 28→28 / 3/4 | infantry (-1,-1)→(-1,0) **距离计算错误**；heavy 击杀 scout2@(0,-1) 34伤(seq 215-216)；heavy (0,0)→(0,-2)；**攻击 support 失败**（已攻击过） | — | ❌ **步兵移动后距 scout1 为 2 无法攻击，浪费 1 AP** |
| 第12轮 / `player_a` | 40 / 2/4 | support (-1,-2)→(0,-1) 攻击 heavy 1伤(95→94HP)；scout1 (-2,-1)→(-1,-1) 攻击 infantry 5伤(22→17HP) | — | 游戏结束，裁决 player_a 胜 |

---

## 补给与分数账本

**实际情况:**
- 部署单位：scout×1（R1，38补给）+ infantry×1（R3，45补给）= 83补给
- 总收入：45(初始) + 20(R2) + 28(R3) + 36(R4) + 36(R5) + 36(R6) + 28(R7) + 28(R8) + 28(R9) + 28(R10) + 28(R11) + 28(R12) = **361补给**
- 总支出：83补给（2次部署）
- 最终剩余：286补给（权重0，不构成裁决分）
- `player_a` 总支出：348补给（ranger×2=144 + scout×3=114 + support×1=60 + 另外可能的部署）

**六项裁决分明细：**

| 项目 | 权重 | 我方值 | 我方得分 | `player_a`值 | `player_a`得分 | 差距 |
|---|---:|---:|---:|---:|---:|---:|
| enemyHqDamage | 0 | 不适用（无HQ） | 0 | 不适用（无HQ） | 0 | 0 |
| ownHqHp | 0 | 不适用（无HQ） | 0 | 不适用（无HQ） | 0 | 0 |
| controlPoint | 0 | 3 | 0 | 5 | 0 | 0 |
| armyValue | 2 | 66 | 132 | 74 | 148 | -16 |
| supplies | 0 | 286 | 0 | 81 | 0 | 0 |
| actionScore | 10 | 350 | 350 | 450 | 450 | **-100** |
| **总分** | — | — | **482** | — | **598** | **-116** |

**正确策略估算：**
- R5-R7 期间每 2 轮从 `cp_east` 部署 1 scout（38补给），12 轮内部署 4-5 个单位
- 额外部署带来的 deploy merit + 攻击机会可将 actionScore 提升约 40-80 分
- 预期缩小差距至 36-76 分，但 `player_a` 的经济优势（40/轮 vs 28/轮）使完全逆转困难
- 假设前提：额外部署的单位能存活至终局并参与至少 1 次攻击

---

## 炮火机制与撤离决策

### 炮火配置

| 项目 | 本局值 | 来源 |
|---|---|---|
| startRound | 5 | `config.annihilation.artillery.startRound` |
| intervalRounds | 2 | `config.annihilation.artillery.intervalRounds` |
| damage | 25 | `config.annihilation.artillery.damage` |
| minimumSafeRadius | 2 | `config.annihilation.artillery.minimumSafeRadius` |

### 收缩时间线

| 整轮 | safeRadius | 我方受影响 | 对手受影响 | 关键决策 |
|---|---:|---|---|---|
| R4 | 6（预警） | 无 | 无 | 炮火预警首次出现 |
| R5 | 6→5 | 无（均在安全区） | 无 | 继续内圈作战 |
| R6 | 5（预警） | 无 | heavy@(-2,-3) 在预警区 | 未利用对手预警 |
| R7 | 5→4 | 无 | 无 | 收缩前安全 |
| R8 | 4（预警） | 无 | 多单位在预警区 | 对手未撤离 |
| R9 | 4→3 | **scout@(-1,0) 在危险区被击杀** | 3单位受伤(25×3=75) | ❌ scout未提前撤离 |
| R10 | 3（预警） | 无 | heavy@(-2,-3) **被炮火击杀**；2scout受伤 | ✅ 炮火帮我消灭 heavy |
| R11 | 3→2 | infantry2@(-2,-2) 受伤(25HP, 57→32) | scout3@(-4,1) **被炮火击杀**；3单位受伤 | 炮火对双方均造成严重损失 |
| R12 | 2（最终） | 无 | infantry3@(-4,4) **被炮火击杀**；3单位受伤 | 炮火继续消耗对手 |

**炮火统计：**
- 我方炮火承伤：1次（25HP），1次死亡（scout R9）
- 对手炮火承伤：10次（共150HP伤害），3次死亡（heavy R10、scout3 R11、infantry3 R12）
- 炮火净收益：我方因炮火获得 3 次间接击杀（对手 3 单位死亡），损失 1 单位

---

## 经验教训

### ✅ 做得好的
1. **开局抢占 4 个控制点（R1-R3）：** infantry1 占 `supply_east`(R1)、scout 占 `supply_northeast`(R2)、infantry2 占 `supply_northwest`(R3)，建立 36/轮收入峰值（seq 51、69）。先手优势得到充分利用。
2. **R5 集火击杀 ranger：** infantry1@(-2,1) 完成对 ranger@(-2,0) 的补刀（9伤，seq 72-73），消除了对手远程威胁（44atk、range3）。
3. **R10 双杀扭转局势：** infantry@(-2,-2) 击杀 scout@(-3,-1)（seq 174-175）+ heavy@(0,0) 击杀 ranger@(-1,1)（seq 177-178），同一回合消灭 2 个敌方单位。加上炮火击杀 heavy@(-2,-3)，单轮削减敌军 3 单位。
4. **Heavy 单位全程高输出：** heavy(b39fa264) 存活全 12 轮，终局 94HP/150HP，共参与 14 次攻击，造成约 236 点总伤害，承担约 106 点承伤。单位价值 92 cost 得到充分回报。

### ❌ 致命失误
1. **R12 距离计算错误（决定性）：** infantry@(-1,-1) 移动至 (-1,0)，发现距 scout1@(-2,-1) 的距离为 `max(|1|,|1|,|2|)=2`（非直觉的1），超出 attackRange=1。浪费 1 AP，导致无法攻击。正确做法：移动前用公式 `max(|dq|,|dr|,|dq+dr|)` 验证距离，应选择 (-2,0) 或 (-2,-1)。
2. **R9 scout 留在炮火危险区被击杀：** scout(2bce76c9) 在 R8 结束后位于 (-1,0)，safeRadius 收缩至 3 后处于危险区。R9 被 `player_a` ranger 击杀（seq 159-160）。正确做法：R8 应将 scout 移至安全区 (0,0) 或 (1,0)。
3. **补给利用率极低（83/361=23%）：** 全 12 轮仅部署 2 个单位（83补给），最终剩余 286 补给因 `supplies` 权重为 0 完全浪费。`player_a` 部署 5 个单位（348补给），每个新单位贡献 deploy merit + 攻击机会。

### 🔑 核心教训
> **"歼灭战中补给不用等于没有——每轮检查 '能否部署' 比 '能否攻击' 更重要；移动前必须用 `max(|dq|,|dr|,|ds|)` 验证六角距离。"**

---

## 数据统计

### 对 `player_a` 的交互

| 项目 | 数值 | 详情 |
|---|---|---|
| 战斗击杀 | 5 | ranger(R5)、infantry2→被heavy杀(R6后)、scout×2(R10)、scout2(R12) |
| 间接炮火击杀 | 3 | heavy@(-2,-3)(R10)、scout@(-4,1)(R11)、infantry@(-4,4)(R12) |
| 被我方击杀总计 | 8 | 含战斗+炮火 |
| 我方被击杀 | 4 | infantry1(R6 combat)、infantry2(R8 combat)、scout(R9 combat)、infantry2→实际存活 |
| 夺取其据点 | 0 | 我方未夺取 `player_a` 初始据点 |
| 被我方夺取的据点 | 3→1 | `supply_northwest` 在 R6 被 `player_a` scout 夺走 |

### 我方单位伤害输出

| 单位 | 攻击次数 | 总伤害 | 击杀数 | 存活轮数 | 最终状态 |
|---|---:|---:|---:|---:|---|
| heavy(b39fa264) | 14 | ~236 | 3 | 12/12 | 存活 94HP |
| infantry1(1d6c9443) | 4 | ~75 | 1 | 1-8 | R8被击杀 |
| infantry2(75d3056f) | 4 | ~43 | 0 | 1-6 | R6被击杀 |
| infantry(0bf13402) | 4 | ~66 | 1 | 3-12 | 存活 17HP |
| scout(2bce76c9) | 3 | ~5 | 0 | 1-9 | R9被击杀 |
| **合计** | **29** | **~425** | **5** | — | — |

> 注：实际伤害值包含 variance（±3），上表为近似值。总伤害含 overkill 部分（实际有效伤害约 354）。

---

## 与历史对局的对比

| 项目 | tg_0090 (GPT5.6terra lose) | 本局 tg_0091 |
|---|---|---|
| 人数/地图/模式/出生 | 2人/artillery-zone/annihilation/player_a(西部) | 2人/artillery-zone/annihilation/player_b(东部) |
| 名次与结束原因 | 第2名/turn_limit_score(682 vs 946) | 第2名/turn_limit_score(482 vs 598) |
| 关键据点控制 | 3 vs 7（大幅落后） | 3 vs 5（中度落后） |
| 炮火承伤/击杀 | 无法可靠统计 | 承伤25HP×1、击杀1；对手承伤150HP、击杀3 |
| 部署次数 | 3次 | 2次（vs 对手5次） |
| 裁决总分 | 682 vs 946（差264） | 482 vs 598（差116） |
| 决定性差距 | armyValue(97×2=194) | actionScore(100×10中的100) |

**结论:** tg_0090 的教训是"控制点收入差距导致军力价值差距"。本局虽然控制点差距较小（3 vs 5），但 actionScore 差距成为新的致命因素。**部署不足是两局的共同问题**——tg_0090 部署3次，本局仅2次，均低于对手的部署频率。在 `supplies` 权重为0的裁决下，囤积补给毫无意义，必须将补给转化为场上单位。

---

## 下次的正确策略

```text
第1轮 / player_b: infantry→supply_east、heavy向内推进、部署scout→抢占supply_northeast路线（与本次相同）
第2轮 / player_b: scout占supply_northeast、heavy+infantry向中心集结（与本次相同）
第3轮 / player_b: 占supply_northwest、部署infantry（与本次相同）
第4-5轮 / player_b: 集火敌方关键单位（与本次相同）
第6轮 / player_b: ★关键改进★ 保护infantry2不被heavy击杀——应撤至(0,0)而非留在(-1,-1)；同时从cp_east部署scout(38补给)
第7-8轮 / player_b: 继续围攻+每2轮部署1 scout；scout在炮火收缩前撤至safeRadius内
第9轮 / player_b: ★关键改进★ scout必须提前撤离炮火危险区，避免被R9收缩+敌方攻击双重打击
第10-12轮: 保持3-4个存活单位参与战斗，每轮至少2次有效攻击
终局检查: 存活资格确认；六项裁决分中armyValue和actionScore为唯一有效项；
  主要竞争者player_a的actionScore预估；分差>50时必须激进部署+攻击
```

**行动前检查清单（新增）：**
1. 移动前用 `max(|dq|,|dr|,|dq+dr|)` 计算六角距离，不凭直觉
2. 每轮开始检查：补给 > 100？有安全CP？→ 部署 scout
3. 炮火收缩前1轮：检查所有单位是否在 safeRadius+1 以内
4. 最后2轮：计算 actionScore 差距，落后时优先部署+攻击

---

**一句话总结：歼灭战中 286 补给烂在手里是最大的浪费——部署不足和六角距离计算错误共同导致了 116 分的裁决败局，补给必须转化为场上的单位才是战斗力。**

---

## 附录：关键坐标

| 实体 | 所属席位 | 坐标 | 说明 |
|---|---|---|---|
| `cp_east` | `player_b` | (4,0) | 我方初始控制点/部署源，全程安全 |
| `supply_east` | `player_b` | (3,0) | R1 占领，收入来源 |
| `supply_northeast` | `player_b` | (3,-3) | R2 占领，R9后进入炮火危险区 |
| `cp_west` | `player_a` | (-4,0) | 对手初始控制点/主要部署源 |
| `supply_northwest` | 争议 | (0,-3) | R3 我方占领→R6 被对手夺走 |
| `supply_west` | `player_a` | (-3,0) | R1 占领 |
| `supply_southwest` | `player_a` | (-3,3) | R2 占领，R9后炮火危险区 |
| 炮火安全边界 | — | safeRadius=2 (R11+) | 安全区仅含中心19格：{(q,r) : max(\|q\|,\|r\|,\|q+r\|) ≤ 2} |

---

*文档生成时间: 2026-08-13*
*回放格式版本: 3.2.10*
*AI模型: QD@qwen3.7max*
