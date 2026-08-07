# 战术游戏第2名复盘 — `player_c` 视角

**日期:** 2026-08-07
**游戏ID:** ec7f4c28-4951-4ffb-b1eb-29035478bebd
**回放版本/地图:** 3.2.9 / artillery-zone（炮火禁区）
**玩家:** Step3.7Flash-OMP（OMP@step3.7flash）
**席位与出生:** `player_c`，行动顺序第1， annihilation：初始单位在西北侧，无HQ
**参战人数/最终名次:** 3人 / 第2名
**结果:** ❌ 存活至第12整轮，但裁决分数落后
**结束原因:** `turn_limit_score`
**最终补给/HQ/总分:** 416 / 不适用（无HQ） / 378分

---


---

## 最终排名摘要

| 名次 | 席位 | 玩家 | 状态 | 总分 | 与我方分差 | 决定性优势 |
|------|------|------|------|------|------------|------------|
| 1 | `player_a` | MiniMaxM3-OMP | 存活 | 902 | +524 | 完整军力价值371，行动分160 |
| 2 | `player_c` | Step3.7Flash-OMP（我） | 存活 | 378 | — | 行动分300较高，但军力价值仅39 |
| 3 | `player_b` | GPT5.6luna-OMP | 存活 | 246 | -132 | 军力价值8，补给277 |

**裁决分结构（本局权重）：**
- `armyValue` 权重 2，`effectiveActions` 权重 10
- `controlPoint`、`supplies`、`enemyHqDamage`、`ownHqHp` 权重均为 0
- 我：39×2 + 300 = 378
- player_a：371×2 + 160 = 902
- player_b：8×2 + 230 = 246

---


---

## 核心教训

### 致命错误: 歼灭模式下过度换命，导致 army value 崩盘

**问题:** 整局我累计击杀 2 个单位（player_b 步兵 x1、player_b heavy x1），但自身也损失了 2 个单位（初始 infantry x2）。到第12整轮结束时，我方仅剩 heavy 26 HP + infantry 50 HP，army value 仅 39；而 player_a 保留了完整兵力，army value 高达 371。在 `armyValue` 权重为 2 的裁决体系下，仅此一项就产生 664 分的差距。

**具体战例：**
- 第6轮：我方步兵 `59734420` 在 `(3,-3)` 被 player_b heavy `cc31dced` 连续攻击，最终死亡（seq 110）。该单位此前已承担过一次炮火缩圈风险，没有及时撤离到更安全的内圈。
- 第11轮：我方 infantry `b476b04e` 在 `(2,-3)` 被 player_b heavy 和 infantry 夹击致死（seq 155）。此时我方已进入劣势，却仍在危险格维持进攻姿态。

**改进:** 
- 歼灭模式的胜负前提是“最后一个存活单位”，不是“击杀数”。应优先保留高 HP/高 cost 单位，尤其是 heavy。
- 当 `safeRadius` 缩到 4 以内时，外围单位必须优先向内收缩，而不是留在危险格继续换命。
- 补给权重为 0 时，囤积 416 补给没有意义；应更早将补给转化为 unit 或用于 heal，但本局我未使用 support 单位。

**预期收益:** 若保留 3 个单位至终局，army value 至少可达 150+，总分可提升至 500+，胜负仍未可知。

---


---

## 关键时间线

| 整轮/席位回合 | 补给 | 行动点 | 我的操作 | 对手响应 | 问题或收益 |
|---------------|------|--------|----------|----------|------------|
| 第1轮 / player_c | 0→12 | 1/4 | 部署 infantry 至 `(1,-4)`，移动 infantry 占领 `supply_northwest (0,-3)` | player_a 占领西南补给点；player_b 占领东部补给点 | ✅ 成功抢占2个内圈补给点，建立 forward pad |
| 第2轮 / player_c | 20→20 | 1/4 | 占领 `supply_west (-3,0)` 和 `supply_northeast (3,-3)`；部署 infantry 至 `(1,-4)` | player_a 部署 scout 至 `(-2,3)`，占领东南补给点 | ✅ 控制3个 supply，经济领先 |
| 第3轮 / player_c | 28→28 | 1/4 | 攻击 player_b infantry（30伤害→51HP）；移动 heavy 至 `(2,-5)` | player_b heavy 和 infantry 逼近 | ⚠️ 开始在前线消耗，但未击杀 |
| 第4轮 / player_c | 32→32 | 1/4 | 继续攻击 player_b infantry（24伤害→28HP）；移动单位 | player_b heavy 攻击我方 infantry | ⚠️ 我方 infantry 开始承压 |
| 第5轮 / player_c | 36→36 | 1/4 | 攻击 player_b infantry（23伤害→5HP）；移动 infantry 至 `(2,-3)` | player_b infantry 反击致我方 infantry 濒死 | ⚠️ 进入换命节奏 |
| 第6轮 / player_c | 40→40 | 1/4 | 补刀 player_b infantry（24伤害）但未击杀；移动 heavy 至 `(3,-3)` | player_b heavy 连续攻击，我方 infantry `59734420` 死亡 | ❌ 关键损失，army value 下降 |
| 第7轮 / player_c | 32→32 | 1/4 | 攻击 player_b heavy（26伤害→100HP）；移动 infantry 至 `(0,-3)` | player_a 部署新 infantry；player_b heavy 反击我方 heavy | ⚠️ 我方 heavy 开始掉血 |
| 第8轮 / player_c | 40→40 | 1/4 | 攻击 player_b heavy（24伤害→74HP）；移动 infantry 内缩 | player_b heavy 再次攻击我方 heavy | ⚠️ 我方 heavy 掉至 127 HP |
| 第9轮 / player_c | 32→32 | 1/4 | 攻击 player_b heavy（26伤害→48HP）； infantry 移动 | player_b heavy 继续压制 | ⚠️ 持续消耗战 |
| 第10轮 / player_c | 40→40 | 1/4 | 攻击 player_b heavy（26伤害→22HP）； infantry 补刀（18伤害） | player_b heavy 被我方击杀 | ✅ 成功击杀 player_b heavy，但己方 infantry 已 acted |
| 第11轮 / player_c | 40→40 | 1/4 | 攻击 player_b infantry（24伤害→47HP）；移动 heavy 至 `(2,-2)` | player_a heavy 攻击 player_b infantry | ⚠️ 未能在回合内结束 player_b |
| 第12轮 / player_c | 40→40 | 1/4 | evacuate infantry 至 `(0,-2)`，heavy 至 `(2,-2)`；攻击 player_b infantry（24伤害→47HP） | — | ⚠️ 终局仅做 defensive 动作，无击杀 |

**终局检查:**
- 存活资格：✅ 我方仍有 2 个单位存活
- 六项裁决分：armyValue 39（权重2）、actionScore 300（权重10已乘）、其他权重项均为 0
- 主要竞争者：player_a armyValue 371，是我方的 9.5 倍
- 分差：524 分，无法通过行动分弥补

---


---

## 本局机制与配置

| 项目 | 本局值 | 来源/影响 |
|------|--------|-----------|
| 最大整轮数 | 12 | `config.balance.maxTurns` |
| 每回合行动点 | 4 | `config.balance.actionsPerTurn` |
| 基础收入 | 8 | `config.balance.baseIncome` |
| 据点效果 | supply 提供 income | `controlPointTypes`：supply 型据点提供额外收入 |
| 裁决权重 | armyValue=2, effectiveActions=10, 其余为0 | `adjudicationWeights` |
| 炮火配置 | startRound=5, intervalRounds=2, damage=25, minimumSafeRadius=2 | `config.annihilation.artillery` |
| 关键安全半径变化 | round 5: 6→5, round 7: 5→4, round 9: 4→3, round 11: 3→2 |  artillery_shrunk 事件 |

---


---

## 数据统计

### 对各对手的交互

| 对手席位 | 军力损失（歼灭） | 击杀 | 被击杀 | 关键影响 |
|----------|------------------|------|--------|----------|
| `player_a` | 0 | 0 | 2（infantry x2） | 双方未直接交火，但 player_a 保留完整军力，裁决分碾压 |
| `player_b` | 2（infantry x1, heavy x1） | 2 | 0 | 成功清空 player_b 的 heavy，但耗时过长，未能扩大优势 |

### 补给与部署

| 项目 | 数量 | 实际花费/收入 |
|------|------|---------------|
| 各类单位部署 | 3（infantry x2, infantry x1） | 45×3 = 135 补给 |
| 基础与据点收入 | — | 累计 416 补给（终局持有） |
| 最终补给 | — | 416（权重0，未转化为分数） |

---


---

## 与历史对局的对比

| 项目 | 历史局 | 本局 |
|------|--------|------|
| 人数/地图/模式 | — | 3人/炮火禁区/歼灭 |
| 名次与结束原因 | — | 第2名/turn_limit_score |
| 关键据点控制 | — | 控制5个据点（3 supply + 2 forward_base） |
| 歼灭：炮火承伤/击杀 | — | 承伤 75×3=225（3个单位各受1次25伤害），击杀2 |
| 淘汰数/被淘汰轮次 | — | 0被淘汰，击杀2 |
| 裁决总分 | — | 378（第2名） |

**结论:** 历史教训中“保留 army value 优先于击杀”在本局再次得到验证。我重复了“积极换命”的错误，虽然行动分达到 300（本局最高），但军力价值仅 39，导致总分远低于 player_a。未来歼灭模式应把“单位存活率”置于“击杀数”之前。

---


---

## 总结

### 胜利关键因素（本局不具备）
1. 完整保留 army value
2. 在炮火缩圈前完成向内收缩
3. 避免在危险格维持单位

### 核心战术原则
> **“歼灭模式先保 unit，再谈击杀；army value 是裁决分的基本盘，行动分只是锦上添花。”**

### 一句话总结
**我因过度换命导致 army value 仅 39，虽然行动分高达 300，但仍不敌 player_a 的 371 army value，以 378 分获得第 2 名。**

---


---

## 附录：关键坐标

| 实体 | 所属席位 | 坐标 | 说明 |
|------|----------|------|------|
| 补给点 | `player_c` | `(0,-3)` | `supply_northwest`，首轮占领 |
| 补给点 | `player_c` | `(3,-3)` | `supply_northeast`，第2轮占领 |
| 补给点 | `player_c` | `(-3,0)` | `supply_west`，第2轮占领 |
| 集结点 | `player_c` | `(-4,0)` | `cp_west`，第2轮占领 |
| 集结点 | `player_c` | `(0,-4)` | `cp_northwest`，初始控制 |
| 击杀地点 | `player_b` → `player_c` | `(3,-3)` | 我方 infantry 被 player_b heavy 击杀 |
| 击杀地点 | `player_c` → `player_b` | `(3,-2)` | 我方击杀 player_b infantry |
| 击杀地点 | `player_c` → `player_b` | `(2,-3)` | 我方击杀 player_b heavy |
| 炮火最终安全半径 | — | radius=2 | 第11轮后 shrink 至最小，外圈单位持续承伤 |

*文档生成时间: 2026-08-07*
*回放格式版本: 3.2.9*
*AI模型: OMP@step3.7flash*
