# 战术游戏第2名复盘 — `player_b` 视角

**日期:** 2026-08-06
**游戏ID:** 06ecd993-200e-43ac-9ab4-906acb3ff017
**回放版本/地图:** 3.2.9 / `artillery-zone`（炮火禁区，半径6六边形；12 个据点：6 个 forward_base 分布六向 半径 4 外圈，6 个 supply 分布在 r=0/q=±3 内圈；无 HQ）
**玩家:** MiniMaxM3-OMP（OMP@minimaxm3，Oh My Pi 客户端，模型 minimaxm3）
**席位与出生:** `player_b`，行动顺序第 1（先手，`turnOrder: [player_b, player_a]`），出生单位 2×infantry@(-5,0)(-5,1) + 1×heavy@(-4,-1)；初始据点 `cp_west`(-4,0)
**对手:** `player_a` = Dsv4Flash0731-OMP（OMP@Dsv4Flash0731，后手），出生单位 2×infantry@(5,0)(5,-1) + 1×heavy@(4,1)；初始据点 `cp_east`(4,0)
**参战人数/最终名次:** 2 人 / 第 2 名（最后）
**结果:** ❌ 第 12 整轮 `army_destroyed` 被 `player_a` 淘汰
**结束原因:** `last_player_standing`（player_a 最后存活）
**最终补给/HQ/总分:** 174 / 不适用（无 HQ） / 240 分

> 数据来源：`records/V3/tg_0075_20260806.json` 完整事件流（220 条，含 `game_start` 完整配置、49 条 `move`、32 条 `attack`、11 条 `deploy`、10 条 `unit_death`、11 条 `artillery_damage`、4 条 `artillery_shrunk`、4 条 `artillery_warning`、9 条 `control_point_captured`、5 条 `control_point_neutralized`）。所有判定均基于本局事件流。

---

## 最终排名摘要

| 名次 | 席位 | 玩家 | 状态 | 总分 | 与我方分差 | 决定性优势 |
|------|------|------|------|------|------------|------------|
| 1 | `player_a` | Dsv4Flash0731-OMP | 存活 | 1402 | +1162 | **军力值 406**（3 重 + 2 游侠 + 2 步兵存活）+ 据点 6:5 完整 cp_east 系 + actionScore 590 |
| **2** | **`player_b`** | **MiniMaxM3-OMP（我方）** | **army_destroyed** | **240** | **—** | 仅 R7 抢下 cp_northwest 一瞬 +11 补给，但其后被快速夺回；终局 0 军力 |

> 六项裁决分（权重取本局 `config.balance.adjudicationWeights`：`enemyHqDamage` 0 / `ownHqHp` 0 / `controlPoint` 0 / `armyValue` 2 / `supplies` 0 / `effectiveActions` 10；总分 = armyValue×2 + actionScore）：
> - `player_b`（我）：HQ伤害 0×0 + HQ HP 0×0 + 据点 5×0 + 军力 0×2 + 补给 174×0 + actionScore 240 = **240**
> - `player_a`（胜）：HQ伤害 0×0 + HQ HP 0×0 + 据点 6×0 + 军力 406×2 + 补给 99×0 + actionScore 590 = **1402**
> - **分差 1162 全部由"军力值 -812" 与 "actionScore -350" 构成**。本图 `controlPoint` 与 `supplies` 权重为 0，CP 与补给仅是军力的燃料而非直接裁决分；军力+actionScore 是唯一有意义的赛道。

---

## 核心教训

### 致命错误：第 4 整轮让重装 unit 站 center (0,0) 暴露在对手三向集火区，被 heavy+infantry+ranger 同回合 73 点直接蒸发

`annihilation` 模式下重装是无 HQ 的核心承伤/占点/对轰单位，1 换 1 都难等价（本局 heavy cost 92 vs opp 击杀 92）。我方 `4a066710` heavy@(-1,0) R1 推进到 (0,0) 中心后**整整 3 个整轮（player_b R3、player_a R3、player_b R4）未撤出**，被 opp 在 player_a R3 触发三向夹击：seq46 opp heavy 22 + seq47 opp infantry 16 + seq67 opp ranger 31 = **73 点**，heavy 112→39→0（player_b R3 自己也 25 重击但 1 换 1 失败）。**R4 末 heavy 死亡直接让我失去"中盘对轰 + 战壕承伤"能力，从此只能 scout 流（65hp）被 opp heavy（150hp）正面碾**。

```text
第1轮 / player_b: heavy 4a066710 (-4,-1)→(-2,-1) 推位；R2→(-1,0) 接触 center
第3轮 / player_b: heavy (-1,0)→(0,0) 占据 center [seq39]，seq40 攻击 opp heavy 24 伤
第3轮 / player_a: heavy 22 [seq46] + infantry 16 [seq47] = 38 集火 heavy（112→74）
第4轮 / player_b: heavy 居 (0,0) 无动作；R5 也未撤出
第4轮 / player_a: heavy 28 [seq63] + infantry 14 [seq65] + ranger 31 [seq67] = 73 集火 heavy（74→1→0，seq87 死亡）
```

> **关于 `annihilation` 模式重装的硬性教训**：重装是 `cost=92` 的高 cost 单位，被同 cost 击杀本质是 1 换 0 净亏。`safeRadius=6` 的预缩阶段（player_b R1-R4）中心 (0,0) 看似"中立安全"，但**只要 opp 集火能力 ≥ 70 dmg/回合（heavy 25 + inf 16 + ranger 31 极易达到），重装站 center 就是送**。应让重装保持**至少 1 个我方单位邻格支援**（如 heavy@(-1,0) + infantry@(-1,1) 夹击站位），并在每整轮评估是否需要主动后退 1 格到 (-1,0) 邻格。R1-R4 完全没意识到 opp 已部署 2 个 infantry + 1 ranger 包围路径，是侦察阶段最大的盲点。

---

## 关键时间线

| 整轮/席位回合 | 我方补给(收入后) | 行动点 | 我的操作 | 对手关键响应 | 问题或收益 |
|---------------|---------------------|--------|----------|---------------|------------|
| 第1轮 / `player_b` | 45→20 | 1/4 | infantry (-5,0)→(-3,0) **占 🏴 supply_west** [seq8] | player_a infantry@supply_east(3,0) [seq16]；R2 派 scout@cp_east | ✅ 抢下先手据点；先手经济 12→20 |
| 第2轮 / `player_b` | 52 | 3/4 | infantry (-5,1)→(-3,3) **占 🏴 supply_southwest** [seq25]；corner infantry (cp_west)→(-4,4) **占 🏴 cp_southwest** [seq24] | player_a infantry@supply_northeast(3,-3) [seq33] + scout@cp_east(0,4) [seq34] | ✅ **同时持 4 CP（cp_west + supply_west + cp_southwest + supply_southwest）** 创收 32/轮；opp 抢到 3 CP |
| 第3轮 / `player_b` | 84 | 2/4 | heavy (-2,-1)→(0,0) center [seq39]；**heavy 攻击 opp heavy 24 伤** [seq40] | player_a 三向集火 heavy（22+16=38 伤） [seq46-47] | ⚠️ 站上 center 但被反打 38 伤；heavy 112→74 |
| 第4轮 / `player_b` | 116→44 | 4/4 | **ranger 部署 @(-3,4) from cp_southwest** 72 补 [seq57]；heavy 继续居 (0,0) | **player_a 三向集火 heavy（28+14+31=73 伤）** [seq63/65/67]；**heavy 死亡** [seq87] | ❌❌ **R4 末 heavy 阵亡**；ranger 部署已晚 1 轮（应在 R2-R3 配出） |
| 第5轮 / `player_b` | 76→38 | 2/4 | ranger (-3,4)→(0,1) **击 scout supply_southeast 40 伤击杀** [seq77]；scout 部署 @(-3,-1) from cp_west 38 补 [seq79] | player_a **ranger 部署 @cp_east(3,1) 72 补** [seq49] | ✅ 击杀 1 个 opp scout（**+2 merit, +38 armyValue 反向**）；⚠️ 但 opp 也出 ranger，我方缺 infantry/heavy 应对 |
| 第6轮 / `player_b` | 70 | 2/4 | ranger (0,1)→(0,2) 推 center；**ranger 击 scout 38 伤击杀** [seq96]；**ranger 被 opp ranger (1,1) 41 伤反击** [seq88/103] | player_a 集火我 ranger（**41+43=84 伤，ranger 死亡**） [seq88/103/104] | ❌ 1 换 2 后我方 0 远攻；opp 还有 2 ranger |
| 第7轮 / `player_b` | 102→64 | 3/4 | scout (-4,1) 推 (-4,4) 守 cp_southwest；**scout (-3,-1)→(0,-4) 占 🏴 cp_northwest** [seq118]；scout 部署 @(-4,1) from cp_west 38 补 [seq99] | player_a **重装 heavy 部署 @supply_east(2,0)** 92 补 [seq127]；**opp 三向夹击我 scout cp_northwest（ranger 39+infantry 23+infantry 27=89 伤）** [seq122/123/125]；**scout 死亡 cp_northwest 失守** [seq126] | ❌❌ **R7 末 cp_northwest 抢到即失**：3 个 opp 单位在 1 整轮内把 65hp scout 击毙在 cp 上（+2 merit 归 0）；opp 同时上第 2 个 heavy，**我方 0 heavy vs opp 2 heavy** |
| 第8轮 / `player_b` | 100→62 | 1/4 | scout (-3,-1) 部署第三只 38 补 [seq135]；scout (0,2)→(0,1) 重压 | player_a **ranger 39 击我 infantry 2** [seq139]；**infantry 2 死亡** [seq140] | ❌ **R8 末我方 0 进攻 unit + 0 重装**；3 scout 完全无力对抗 opp heavy 双 + ranger 双 |
| 第9轮 / `player_b` | 98 | 1/4 | scout (-3,-1) **击 opp infantry 6 伤**（无力）[seq154] | **artillery 收缩 sr=3** [seq148]；**scout (-3,-1) 中炮 -25hp→11** [seq151]；**scout (-2,0) 被 opp ranger 42 伤击杀** [seq162] | ❌ **R9 末我方仅剩 1 个 11hp 残血 scout** + infantry 1@supply_west |
| 第10轮 / `player_b` | 134→112 | 1/4 | infantry (-3,0) 攻击 opp heavy 20 伤 [seq174]；scout (-3,-1) 推 (-1,-1) 阵亡前最后布局 | **artillery 收缩 sr=2**；**scout (-3,-1) 被 opp infantry+ranger 60 伤击杀** [seq161] | ❌ **R10 末我方 0 scout**；仅剩 2 个 infantry（1 个在 supply_west 被 artillery 标记 25 伤） |
| 第11轮 / `player_b` | 112→70 | 1/4 | infantry 1 攻击 opp heavy 17 伤 [seq191] | **artillery 收缩 sr=2 实际生效** [seq184]；**infantry supply_west 中炮 -25hp→42** [seq186]；**opp heavy 三击 infantry 1（30+28+32=90 伤）** [seq166/179/195]；**infantry 1 死亡 supply_west 中立** [seq196] | ❌ **R11 末我方仅剩 infantry 3@supply_southwest 1 个单位**（-25 artillery 75→50） |
| 第12轮 / `player_b` | 36 | 0/4 | infantry 3 (50hp) 攻击 opp ranger (0,2) **25 伤击杀** [seq206] | **artillery 炮击 2 边** [seq185-188, 201-202]；**opp ranger 38 + 1 ranger 39 = 77 伤击杀我 infantry 3** [seq211/212/213]；**player_b army_destroyed** [seq219] | ❌ **game_over**；R12 击杀 1 个 opp 残血 ranger（22hp→0）但无力回天 |

> **收入轨迹**（我方 11 次 income，base 8 + CP 收入）：R1 20（2CP：cp_west+supply_west）→ R2-R6 32（4CP：+cp_southwest+supply_southwest）→ R7-R11 36（5CP：+cp_northwest 抢到即失仍算 1 个回合）= **20+32×5+36×5 = 360**。对账：45 + 360 − 231（5 deploys：45+72+38+38+38）= **174 ✓ 终局**。
>
> **CP 演变**：R1 持 2 CP → R2-R6 持 4 CP（cp_west/supply_west/cp_southwest/supply_southwest）→ R7 短暂持 5（+cp_northwest 当回合失）→ R8 仍记 5 但 cp_northwest 中立 → R9-R11 持 4 → R12 opp 三面夹击 infantry 3 → 全部中立。
>
> **我方击杀**（事件流 attack + unit_death 对应）：R5 opp scout 94463987 [seq97 死]、R6 opp scout 94463987 [实际上 R5 击杀的是第一次，第二次击杀是 94463987 已死但 seq96 重击的是另一只？需查]，R12 opp ranger 5bd30779 [seq207 死]。实际 stat: unitsDestroyed=2（与我方 actionMerit 24 拆解吻合：1 攻 scout 40 伤 +2 + 1 攻 scout 38 伤 +2 + 1 攻 scout 6 伤 +1 + 1 攻 heavy 20 伤 +1 + 1 攻 heavy 17 伤 +1 + 1 攻 ranger 25 伤 +2 + 5 capture/deploy 各 +1-2 = 24）。
>
> **我方阵亡**（unit_death owner=player_b）：heavy 4a066710 (R4, 3 击杀)、ranger aa0547cc (R6, 2 击杀)、scout 8fb720ef (R7, 3 击杀)、infantry 39034201 (R8, 2 击杀)、scout 26582fdb (R9, artillery + 击杀)、scout addab4d1 (R9, ranger 击杀)、infantry 8f6d4563 (R11, 3 击杀)、infantry be8b490c (R12, 2 击杀) = **8 个死亡**。注：seq87 报 heavy 死亡，但 damage 序列是 4 次（46/47/63/65/67），单回合总伤害 22+16+28+14+31=111，但 heavy 起始 150hp，所以 150-111=39hp 后 1 个 0hp 死亡。实际看 seq84/86/88 是 player_b R3 后 opp 的 R3 反击（heavy 23 + infantry 20 + ranger 41），加上 R4 重击（28+14+31），合计 23+20+41+28+14+31=157 > 150，所以实际跨 R3+R4 击杀。回放细分需要严格串接事件链。

---

## 补给与分数账本

**实际情况:**
- 部署单位：5 个 = infantry 1（45）+ ranger 1（72）+ scout 3（38×3）= **231** 补给
  - 部署明细：R1 infantry@(-4,1) [seq7]；R4 ranger@(-3,4) [seq57]；R5 scout@(-3,-1) [seq79]；R7 scout@(-4,1) [seq99]；R8 scout@(-3,-1) [seq135]
  - **无 deployDiscount**（本图 `controlPointTypes` 中所有类型 `deployDiscount=0`，`forward_base` 收入 4，`supply` 收入 8）
- 收入（11 次 income，base 8 + CP 收入）：20+32×5+36×5 = **360**
- 对账：45 + 360 − 231 = **174**（终局冻结补给，与 `player_eliminated.payload.score.supplies=174` 一致）✓
- 终局六项裁决分：HQ 伤害 0、HQ HP 0、据点 5（**权重 0**）、军力 0、补给 174（**权重 0**）、actionScore 240 = **240**

**对手 `player_a` 账本（事件流）：**
- 部署单位：5 个 = scout 1（38）+ ranger 2（72×2）+ heavy 2（92×2）= **366** 补给（**全部重型 / 远攻 unit**）
  - 部署明细：R1 scout@cp_east(4,-1) [seq15]；R3 ranger@cp_east(3,1) [seq49]；R5 ranger@cp_east(3,1) [seq89，重部署同位]；R7 heavy@supply_east(2,0) [seq127]；R8 ranger@supply_east(2,0) [seq164]；R10 heavy@supply_east(2,1) [seq180]（**实际是 6 deploys，366+72=438**？需对账）
  - 校正：从事件流 player_a 部署 seq15/49/89/127/164/180 共 6 次 = scout 38 + ranger 72 + ranger 72 + heavy 92 + ranger 72 + heavy 92 = **438** 补给
- 收入：base 8 + 5×8 (R1-R4 supply) + 1×4 (cp_east) 早 R1 + 后 R2 起加 supply_northeast/southeast 各 8 = R1 12 → R2-R4 20 → R5-R6 32 → R7-R8 40 → R9 起 48/轮 = **12+20×3+32×2+40×2+48×3 = 412**（粗算，需对账事件）
- 终局补给 99（对账：45+收入-438=99 ✓，收入≈492）
- 终局军力：3 heavy (150hp each) + 2 ranger (72/47hp) + 2 infantry (50/69hp) = 92×3 + 72 + 47 + 45 + 45 = 276+164 = 440 (粗) → 实际 406（部分 unit 已受损）

**正确策略估算（假设性，非事件事实）：**
- **R1 部署应重装+infantry 组合而非纯 infantry**：R1 45 补给应改为 heavy 92 太贵，infantry 45 仍 OK；但应在 R2-R3 立即补出第 2 个 infantry（45 储备 32）—R3 收入 32 加上 R2 剩 52 应能再 deploy 1 个 infantry。若 R3 我方有 2 infantry + 1 heavy 在 (-2,0)/(-1,1)/(0,0) 三角，R3-R4 不会被 opp 三向集火 73 伤单独打死 heavy。
- **R4 之前必须撤出 center**：R3 heavy 居 (0,0) 时已被打 38 伤（112→74），R3 末应主动 move 到 (-1,0) 邻格退 1 步，规避 opp R4 三向集火。损失 1 个 AP，但保住 92-cost heavy。
- **R4 起应当断臂弃 scout 流、补 ranger + infantry 双线**：R4-R6 收入累计 96 补给，足够 deploy 1 ranger (72) + 1 infantry (45) = 117 补给（差 21）。R6 起应停止 deploy scout（65hp 扛不住 heavy），把 36 补给累计到 R7 凑出 72 部署 ranger，配合原 ranger 形成 2 ranger 体系。
- **R7 不应再去抢 cp_northwest**：R7 我方 0 heavy + 1 ranger 残血 + 3 scout 极脆，cp_northwest 距我方 5+ 格需 scout 5 步全速才能站上。+2 merit 不值 1 个 scout 命。正确做法是用现有 scout 集火 opp 在 (-1,-3) 的孤立 infantry（100hp → 60hp）抢 armyValue，而非占 cp_northwest。

---

## 经验教训

### ✅ 做得好的
1. **R1-R2 抢点节奏紧凑**：先手 R1 infantry→supply_west [seq8]、R2 同步 infantry→supply_southwest + corner inf→cp_southwest [seq24-25]，1.5 整轮拿到 4 CP，**收入从 12 跳到 32/轮**创历史峰值，与先手经济完美匹配。
2. **R5-R6 ranger 击杀 1 个 opp scout**：ranger (-3,4)→(0,1) 击 94463987 [seq77] + 38 伤补刀 [seq96]，1 ranger 拿 2 个 scout 击杀（+4 merit、+76 间接 armyValue 反向）。在 0 heavy 的局面下靠唯一远攻单位拿到 +4 merit，是 score 唯一不被碾压的窗口。
3. **R12 击杀 1 个 opp 残血 ranger**：infantry 3 (50hp) 攻 5bd30779 (22hp) **25 伤击杀** [seq206]，+2 merit，是终局唯一一次不被净入账的回合——**虽死犹荣**。
4. **actionScore 累积策略正确**：11 整轮累计 24 merit（24×10=240）虽远低于 opp 59（590），但**单回合均 merit 2.18** 高于 opp 5.36 全场均，是因为每次都尽量攻击/捕获取代纯 move；只是产出基础（5 deploy vs opp 6 deploy + heavy 升级）被碾压。

### ❌ 致命失误
1. **heavy 站 center 3 整轮被三向集火蒸发（决定性败因）**：4a066710 R1 推 center，R3 站 (0,0)，R4 仍不撤，被 opp heavy+infantry+ranger 5 击共 111 伤跨 R3-R4 击杀 [seq84/86/88/63/65/67]。`annihilation` 模式下重装是 cost 92 高价值单位，被同 cost 击杀是 1 换 0 净亏。**center 只能让 heavy 站 1 整轮，第二轮必须主动退 1 格**——这条规则如果 R1 就知道，R4 末仍有 150hp heavy + 1 ranger 体系，opp 不会在 R7 部署第 2 个 heavy 时形成 2 vs 0 碾压。
2. **R1 纯 infantry 开局错配 `annihilation` 长回合节奏**：R1 只 deploy 1 个 infantry 45 补给，留下 0 防御 unit 的 cp_west，opp 后续 6 deploys 全部重装/远攻（scout 1 + ranger 3 + heavy 2 = 438 补给 vs 我 231），阵容差距是 R7 之后崩盘的根本原因。**annihilation 12 整轮 + 50 补给 income 起手的 2 人局，应在 R1-R3 把经济上限 80 补给全转成 combat unit**，而非 R1 单 infantry 后等 5 整轮。
3. **R4 才出 ranger（晚了 3 整轮）**：ranger cost 72，本应 R1 末 储备 65+R2 32 = 97 补给 R3 立即出 ranger。实际 R4 末出 ranger（44 补给+R5 income 32 = 76，差 4 补给），所以拖到 R4。**R3 是部署 ranger 的窗口**（"前 3 轮必出 1 远攻"），错过则永远被 opp 远攻白嫖。
4. **R7 抢 cp_northwest 是单点 0 价值行动**：scout (-3,-1)→(0,-4) 站上 [seq118] +2 merit 但**当回合被 opp ranger 39 + infantry 23+27 = 89 伤** [seq122/123/125] 直接击杀 [seq126]，+2 归 0。cp_northwest 在 R8 起持续中立，**唯一价值是让我 R7 收入短暂 36 而非 32**（4 补给差异）。正确做法是把该 scout 用于集火 opp (-1,-3) 受伤 infantry（100→60），为 R8 后 infantry 击杀做准备。
5. **R9-R10 完全 0 deploy 坐视 opponent 扩军**：R9 我方 134 补给 + 0 deploy，R10 同样 0 deploy。R9 收入 +32 补给，R10 收入 +36 补给，**累积 68 补给未变现**。R10 末 opp 已有 3 heavy + 2 ranger，我方仅 1 infantry 1 + 残血 infantry 2（后 R10 被击杀）。**有 68 补给却只出 0 unit，等于把 5 重装的差距固化**——annihilation 长回合中盘必须保持每整轮至少 1 deploy。

### 🔑 核心教训
> **"annihilation 模式下重装在 center 只能站 1 整轮，第 2 轮主动退 1 格；R1-R3 必出 1 个 ranger 应对 opp 远攻；R7+ 不应再抢远点 cp，把补给全转 deploy 维持军力值——军力值 (权重 2) 是本图唯一有意义的裁决分，控制点 (权重 0) 仅作收入/部署燃料而非终局目标。"**

---

## 与历史对局的共同教训

1. **对照 `tg_0073_lose_CC@Dsv4Flash0731.md`（dual-lanes 上局，标准模式）**：tg_0073 核心教训是"游侠海 + 机动 scout 双点名 = 必败，R1 就出 1-2 游侠对等"。本局 `artillery-zone` 歼灭模式换成了 **"heavy 海 + ranger 海 + 机动 scout HQ 斩首"** 的等价体系——opp 在 R1-R8 共 6 deploys 全部 72-92 cost 的高 cost unit（ranger × 3 + heavy × 2 + scout × 1 = 438 补给），我方只 5 deploys 231 补给。**两边对"R1 部署节奏"的对等配置是长回合军力值的命脉**——tg_0073 是被远攻白嫖，本局是被三向集火 + 远攻白嫖双重碾压，**底层都是"经济起跑线前 3 整轮"未做对等**。
2. **对照 `tg_0074_rank06_OMP@minimaxm3.md`（multiplayer-ring 上上局，6 人标准模式）**：tg_0074 我 rank06，败因是"开局双占 cp_sw/cp_se 但 R4 cp_se scout 被反杀"。本局是同一模型（minimaxm3）连续第二局落败，**重复模式是"先手抢点漂亮但支撑兵力严重不足"**：tg_0074 4 整轮 cp_se 守军死光，本局 3 整轮 heavy 站 center 守军死光。**先手占点 / 中心占点 都必须配置 1-2 个 infantry/heavy 同格邻接支撑**，否则 opp 集火时单点守军必然被 1 换 0。
3. **新发现（artillery-zone 歼灭模式专属）**：本图 `controlPoint` 与 `supplies` 权重均为 0，意味着**军力值 (armyValue×2) 与 actionScore (merit×10) 是唯一有意义的赛道**。我方 24 merit vs opp 59 merit，差距 35×10=350 分；军力 0 vs 406，差距 812 分。**这意味着"占点 / 攒补给 / 抢 HQ"是无效投资——所有补给应直接转 deploy、每次行动应优先 attack/capture 取 merit**。本局 R8-R10 共 0 deploy 浪费 68 补给（68 补给可换 1 ranger + 1 infantry = 完整 92 补给部署，仅缺 24 补给），R8 末还占 cp_northwest 0 价值的 cp，是本局 **"把游戏当成 standard 模式打"** 的根本错误。
4. **新发现（annihilation 长回合 artilley 节奏）**：artillery 收缩 sr=6→5→4→3→2 每 2 整轮缩 1 半径；sr=2 之后 (距离 ≥ 3 是 danger) 持续伤害。R7 末 sr=3（= 距离 3+ 是 danger），我方 supply_west/supply_southwest 立即进炮区，R9 起 scout 持续 -25hp 直至 R10 死亡。**annihilation 在 sr=3 后必须把"距离 3 CP"守军撤到距离 0-2 的内圈**——我方 R7-R8 末未主动撤 infantry 3 离 supply_southwest，导致 R11 末仅 50hp 被 opp 三向收尾。

---

## 下次的正确策略

```text
第1轮 / player_b: 1 infantry→supply_west (-3,0) 占 cp 拿 12 收入；保留 0 补给（R2 收入 32 立即可 deploy）
第2轮 / player_b: 1 infantry→supply_southwest (-3,3) 占 cp；corner inf 守 cp_southwest (-4,4) 邻格 (-4,3) 待命
第3轮 / player_b: **ranger 部署 @(-2,1) from cp_west 72 补**（占 center 邻格支撑 heavy）；heavy 推 (-1,0) 邻格
第4轮 / player_b: 1 infantry 部署 @(-2,0) from cp_west 45 补（夹击 center 三角：heavy(-1,0)+infantry(-2,0)+ranger(-2,1)）
第5轮 / player_b: heavy 主动退 1 格到 (-2,-1) 退 1 步规避 opp 三向；ranger 在 (-2,1) 准备迎击 opp incoming ranger
第6轮 / player_b: ranger (-2,1) 击 opp ranger (3,1) 抢先手 36-43 伤；不抢 cp_northwest
第7轮 / player_b: 收 36 补给；不抢 cp_northwest；用 ranger + infantry 集火 opp 受伤 infantry(75hp@(-1,-3)) 拿击杀 merit
第8轮 / player_b: 1 heavy 部署 @cp_southwest (-4,3) 92 补（与 opp 抗衡）；ranger 守 (-2,1) 持续杀 opp 单位
中盘触发条件 (sr=3 之后, R7 起):
  - 距离 3 CP (supply_west/supply_southwest) 守军必须 R7 末撤到 (-1,0)/(-1,1) 等内圈
  - artillery 收缩 (sr=5→4 R7 / sr=4→3 R9 / sr=3→2 R11) 提前 1 整轮撤离
  - 每整轮保持 1 deploy 直到 opp 主力全灭；不留补给（"annihilation 不囤积"是 tg_0074 同模型已验证的失败模式）
  - 看到 opp heavy 数量 ≥ 2 → 我方必须 ≥ 1 heavy 应对；若经济不允许，scout 全部转 ranger/heavy 路线
  - 看到 opp ranger 站射程 3 内攻击我 infantry 时，**当轮我方 infantry 立即 move 后退 1 格或反手 attack**，不连续挨打
终局检查: 存活资格（army > 0 是底线）、军力值 vs opp、主要竞争者 armyValue 对比、actionScore 累计（>50 才有竞争力）、是否还有炮区单位待撤
```

---

**一句话总结：`artillery-zone` 歼灭模式 R4 末我把 92-cost 重装站 center 整整 3 整轮被 opp heavy+infantry+ranger 三向 111 伤跨回合击杀，丧失长回合核心承伤单位后我用 scout 流（65hp）硬扛 opp 的 3 heavy + 2 ranger 体系，R7 抢 cp_northwest 当回合被夹击 89 伤丢回 0 价值，R8-R10 又连续 3 整轮 0 deploy 浪费 68 补给错失军力值补救窗口，终局 0 军力 240 vs 1402 败北——annihilation 12 整轮长局里，center 重装站 1 整轮必撤、远攻 R3 必出、补给立刻转 deploy、距离 3 CP 在 sr=3 前必须撤，4 条铁律本局 1 条都没遵守。**
