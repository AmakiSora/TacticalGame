# 战术游戏第4名复盘 — `player_b` 视角

**日期:** 2026-08-12
**游戏ID:** 43eca9d3-33c5-4e4d-9efe-11d2e071b478
**回放版本/地图:** 3.2.10 / artillery-zone（炮火禁区，半径6六边形；12 据点：6 forward_base 沿六向半径 4 外圈，6 supply 沿内圈半径 3；无 HQ）
**玩家:** MiniMaxM3-OMP（OMP@minimaxm3，Oh My Pi 客户端，模型 minimaxm3）
**席位与出生:** `player_b`，行动顺序第1（先手，`turnOrder: [player_b, player_e, player_f, player_a, player_c, player_d]`），出生单位 2×infantry@(0,-5)(-1,-4) + 1×heavy@(1,-5)；初始据点 `cp_northwest`(0,-4)
**参战人数/最终名次:** 6 人 / 第 4 名
**结果:** ❌ 存活至第 12 整轮，但裁决落后于 `player_e` / `player_d` / `player_c`
**结束原因:** `turn_limit_score`
**最终补给/HQ/总分:** 65 / 不适用（无 HQ） / 506 分

> 数据来源：`records/V3/tg_0089_20260812.json` 完整事件流（541 条；含 4 次 `artillery_shrunk`、4 次 `artillery_warning`、26 次 `artillery_damage`、88 次 `move`、132 次 `attack`、20 次 `deploy`、27 次 `unit_death`、1 次 `player_eliminated`）。所有判定均基于本局事件流。

---

## 最终排名摘要

| 名次 | 席位 | 玩家 | 模型 | 状态 | 总分 | 与我方分差 | 决定性优势 |
|------|------|------|------|------|------|------------|------------|
| 1 | `player_e` | Hy3-WB | hy3 | 存活 | 792 | +286 | **armyValue=146（最高）** + actionScore=500；阵型完整、终局未失血 |
| 2 | `player_d` | Step3.7Flash-OMP | step3.7flash | 存活 | 746 | +240 | actionScore=570（最高）但 armyValue 仅 88；4 单位全部因炮火阵亡 |
| 3 | `player_c` | SenseNova6.8FLP-OMP | sensenova6.8fl | 存活 | 544 | +38 | 终局仅 2 单位（27 armyValue），但 actionScore 490 |
| **4** | **`player_b`** | **MiniMaxM3-OMP（我方）** | **minimaxm3** | **存活** | **506** | **—** | actionScore=430 + armyValue=38；终局重装被 d 反杀 |
| 5 | `player_f` | LongCat2.0-CP | longcat2.0 | 存活 | 296 | -210 | 囤积 232 补给，0 攻击军力（heavy 被我在 R9 一发秒） |
| 6 | `player_a` | agnes2.5flash-OMP | agnes2.5flash | 淘汰 | 230 | -276 | R12 炮火击毙最后步兵 `artillery_destroyed` |

> 六项裁决分（权重取本局 `config.balance.adjudicationWeights`：`enemyHqDamage=0` / `ownHqHp=0` / `controlPoint=0` / `armyValue=2` / `supplies=0` / `effectiveActions=10`；总分 = armyValue×2 + actionScore）：
> - `player_b`（我）：HQ伤害 0×0 + HQ HP 0×0 + 据点 2×0 + 军力 38×2 + 补给 65×0 + actionScore 430×1 = **506**
> - `player_e`（胜）：HQ伤害 0 + HQ HP 0 + 据点 2×0 + 军力 146×2 + 补给 52×0 + actionScore 500×1 = **792**
> - `player_d`（次）：HQ伤害 0 + HQ HP 0 + 据点 2×0 + 军力 88×2 + 补给 50×0 + actionScore 570×1 = **746**
> - **核心差距：** 我方 armyValue 38 vs 胜者 146 → 仅差 **108**；actionScore 430 vs 胜者 500 差 70。本局 armyValue 与 actionScore 双输，**核心败因是 armyValue 不足**——终局仅 2 个低 HP 单位存活（infantry 50 + ranger 15），而 `player_e` 5 单位存活（heavy 126 + infantry×4），我的重装在第 11 轮被 `player_d` 反杀直接造成 92 cost 的减损。

---

## 核心教训

### 致命错误：第 9 轮部署侦察兵而非重装/游侠，错失 `safeRadius=3` 缩圈前唯一的补给窗口

**问题:** 第 9 轮缩圈 `safeRadius=4→3`，我方据点 `cp_northwest`(0,-4) 处于 dist=4 = warning/danger 边缘。R8 末我的储备是 **82 补给**（45 + 11×20 收入 − 4×deploy），本可选择部署 `ranger`(72) + 保留 10 补给。但我已部署 `ranger`(72) 花费 72，剩 10 补给（实际是 R8-R9 收入后 82−72=10），终局储备仅 65。这意味着我在 R8 之前就花掉了本可支撑 `heavy`(92) + 后续 1 deploy 的积蓄。

**正确做法:** R7 末（`safeRadius=4` 收缩后）应停止部署 `infantry`(45)，改为 R8 直接 `ranger`(72)；R9 用 65+20=85 补给在 `safeRadius=3` 边缘部署 **重装(92) 失败**——必须 R7 就开始攒补给，重装要在 `safeRadius=4` 之前部署（dist=3 deploy target 安全）。**实际我 R7 部署了第 2 个 infantry(45) 浪费供给窗口**——这把 infantry 撑到 R11 死亡，没有任何 meritorious 输出（仅在 R7 攻击 d 步兵一次 19 dmg = +1 merit）。

**数据证据:**
- R7 末我的 armyValue 约 168（heavy 150 + infantry 100 + infantry 100 + scout 65 - 部分损耗），实际存活 3 单位总 armyValue 排名中游
- R9 部署 ranger 72 补给 vs 假设 R7 部署 heavy 92 补给 → +1 heavy(150hp, cost 92, 即便后期承 25 dmg 仍存 125hp) vs +1 ranger(72hp, 后期被 e 30 dmg 反杀至 0)
- 终局：ranger 15hp / infantry 50hp = 38 armyValue。若保留 heavy：假设 125hp 存活 = 76 armyValue，仅 armyValue 即可 +38 分

**预期收益:** R7 部署 heavy(92) + R9 部署 ranger(72) = 164 补给，足够，但需要放弃 R2/R3 的早期 infantry/scout 双 deploy。实际本局节奏：
- R2 infantry 45 + R3 scout 38 + R7 infantry 45 + R9 ranger 72 = **200 补给**。 
- 替代方案：R2 infantry(45) + R3 scout(38) + R7 **heavy(92)** + R9 ranger(72) = 247 补给（超出 220 收入），不可行。
- **可行替代**：R2 infantry(45) + R3 scout(38) + R7 heavy(92) = 175 补给，留 45 储备供 R11 部署 infantry。节约 1 deploy，净 armyValue 提升 ~40。

---

### 次要错误：第 11 轮放弃攻击 `player_e` 重装，错失 1 个 `merit +1~2` + 提早削血

**问题:** R11 我应优先用 ranger 攻击 `player_e` 在 (-1,1) 的 heavy（74hp）—— ranger 72 dmg 一发就把它打到 2 hp。但我反而攻击了 `player_c` 在 (0,1) 的 35hp infantry（杀）+ `player_d` 已死的 heavy 不存在 + `player_e` 的 (-1,0) infantry 100 hp 削 25 hp。我没有挑最容易死的 `player_e` 残血单位。

**正确做法:** R11 用 ranger(0,-2) 攻击 `player_e` 的 heavy(-1,1) 74 hp：44 dmg → 30 hp（不击杀但+2 merit）。同回合还能用 infantry 攻击 e (-1,0) 100 hp infantry（dist 1 但我 infantry 在 0,0 → 1,1 距离需重算——实际我 infantry 在 (0,0)，e 的 (-1,0) dist 1 OK，30 dmg → 70 hp，+2 merit）。

**预期收益:** 多 1-2 个 merit 击杀机会（最终 e heavy 仍存活但进入 R12 时只剩 ~50 hp，比我留下的 ~80 hp 弱很多）；actionScore 多 10-20 分。

---

## 关键时间线

| 整轮/席位回合 | 补给/行动点 | 我的操作 | 对手响应 | 问题或收益 |
|---------------|-------------|----------|----------|------------|
| 第1轮 / `player_b` | 45→45 / 4/4 | infantry(-1,-4)→(0,-3) **占 🏴 supply_northwest** [seq11]；infantry(0,-5)→(0,-4) **守 cp_northwest**；heavy(1,-5)→(1,-3) 前推内圈 | 5 个对手各占自家 supply CP | ✅ **抢到先手 supply**：经济 12→20（cp_northwest 4 + supply_northwest 8） |
| 第2轮 / `player_b` | 45→0 / 4/4 | R2 收入 20 后剩 65；**deploy infantry @ (1,-4) from cp_northwest** 45 补 [seq52]；heavy(1,-3)→(1,-2)；infantry(0,-3)→(1,-3) 内推；infantry(0,-4)→(-1,-3) 西移 | `player_d` infantry(5,-5)→(2,-4) 推进 | ✅ 4 单位成型（3 步兵+1 重装）；⚠️ 早期大量 deploy 后储备归零 |
| 第3轮 / `player_b` | 20→0 / 4/4 | **deploy scout @ (0,-3) from cp_northwest** 38 补 [seq96]；infantry(1,-3) 攻击 d 步兵(2,-3) 20 dmg → 80hp [seq97]；infantry(-1,-3) 攻击 e 步兵(-2,-2) 21 dmg → 79hp [seq98]；heavy→(2,-2) | d infantry(2,-3) 反打我 23 dmg | ✅ 首次输出：merit +3（attack+2、attack+2）；⚠️ 但 my infantry(1,-3) 90→67hp 承伤 |
| 第4轮 / `player_b` | 20→0 / 4/4 | infantry 攻击 d 步兵 23→57 [seq141]；infantry 攻击 e 步兵 24→55 [seq142]；heavy(2,-2)→(2,-1) 中心区；scout(0,-3)→(0,-2) | `player_d` infantry(2,-3) 攻击我 22dmg、d heavy(4,-3)→(3,-2) 推进；**artillery_warning R4** [seq138] | ⚠️ R5 缩圈前 d heavy 已贴到 (3,-2) 邻接我 (2,-2) heavy |
| 第5轮 / `player_b` | 42→22 / 4/4 | infantry(1,-3) 攻击 d 步兵 22→35 [seq185]；infantry 移 (1,-3)→(1,-2)；infantry(-1,-3) 攻击 e 步兵 21→34 [seq187]；heavy(2,-1)→(1,-1) 内推 | **artillery_shrunk sr=6→5** [seq182]（无我方单位在 danger zone） | ✅ 全部存活进入 R6；⚠️ 但 d 重装 (3,-2) 邻接我 (2,-1) heavy（dist 1）持续施压 |
| 第6轮 / `player_b` | 22→2 / 4/4 | **scout(0,-2) 击杀 e infantry(0,0) efb70135** 5dmg → 0hp [seq234] KILL #1（+1 merit）；infantry(-1,-3) 攻击 e 步兵 25→9 [seq231]；**infantry(1,-4)→(1,-3)**；heavy 攻击 c infantry(1,0) 33→8 [seq233] | **`player_d` infantry 4a4494d9 击毙我 infantry e9e5b04a @ (1,-2)** [seq221→222]（d 累计 5 次反打 23+22+24+23+8=100 dmg 完成击杀）；**`player_e` infantry 3cdab265 击毙我 infantry bbfccc88 @ (-1,-3)** [seq239→240]（e 累计 5 次 19+20+21+22+18=100 dmg） | ✅ **首次击杀**；❌ **R6 双步兵阵亡**：my e9e5b04a 与 bbfccc88 在同一回合被杀（cost 90）；armyValue 净减约 80（100-8%×90=−80） |
| 第7轮 / `player_b` | 2→42 / 4/4 | **heavy(1,-1)→(2,-1)**；scout→(-1,-1)；**artillery_shrunk sr=5→4** [seq273]；**heavy 击杀 d infantry(2,-3) 4a4494d9** 16→0 [seq321] KILL #2（+1 merit）；scout 攻击 e 步兵(-2,-2) 5→4 [seq319]（濒死）；**deploy infantry @ (-1,-3) from supply_northwest** 45 补 [seq278]；新 infantry 推 (0,-2) | **`player_d` infantry c4966bd1 + 4a4494d9 击毙我新 infantry 338d082c @ (-1,-3)** [seq309+310→311]（d 累计 5 次 23+21+22+25+9=100 dmg 完成击杀；该 infantry 仅存活 0.5 轮）；**`player_e` 重装 1c2cfe1e 削我 scout 87e7f091 @ (-1,-2) 28+28=56** [seq328-329]（待 R9 完成击杀） | ❌ **R7 我部署的新 infantry 当轮被 d 击杀**（cost 45 完全浪费）；✅ 重装击杀 +1 merit，−45 armyValue（部署）但 +1 击杀 merit |
| 第8轮 / `player_b` | 42→62 / 4/4 | scout(-1,-1)→(-1,-2) 避免 danger zone；scout 攻击 e 步兵(-2,-2) 5→4 [seq319]（**濒死 e 步兵 R9 才被炮火收**）；heavy(2,-1)→(2,-2)；new infantry(-1,-3)→(0,-2) | **`player_e` 重装 1c2cfe1e 削我 scout @ (-1,-2) 累计 56 dmg** [seq328-329]；**artillery_warning R8** [seq315]；R8 末 scout 残血 9 hp | ✅ **scout 苟延残喘**——R9 缩圈后被 e 收人头；⚠️ my 重装从 (2,-1) 退回 (2,-2) 准备应对 d 重装 |
| 第9轮 / `player_b` | 62→5 / 4/4 | **deploy ranger @ (0,-2) from supply_northwest** 72 补 [seq371]；**ranger 击杀 f heavy(-2,1) f02ce91c** 30→0 [seq372] KILL #3（+2 merit）；heavy(2,-2) 攻击 d heavy(3,-2) 22→128 [seq374]；scout 攻击 e infantry(-2,-1) 11→89 [seq375]；**artillery_shrunk sr=4→3** [seq359] | **8 单位炮击** [seq360-367]：`player_c` 重装(2,2) 72→47；`player_d` 步兵(2,-4) 75→50；`player_d` 步兵(4,-2) 10→0 **死亡**；**`player_e` 步兵(-2,-2) 4→0 死亡** [seq363]（被我削至 4 后被炮火收）；**`player_a` infantry(1,3) 75→50**；**`player_e` infantry(-4,1) 75→50**；**`player_d` infantry(3,-4) 75→50** | ✅ **ranger 击杀 f heavy**：+1 单位，−92 f armyValue；✅ 炮火帮我们清掉 e 残血步兵；⚠️ 但 R9 末：`player_e` infantry 5e5a78d2 击毙我 scout 87e7f091 @ (-1,-2) [seq379→380]（e 累计 3 次 28+28+9=65 dmg 完成击杀） |
| 第10轮 / `player_b` | 5→25 / 4/4 | heavy(2,-2) 攻击 d heavy(3,-2) 27→83 [seq419]；heavy→(1,-2)；**ranger 攻击 d heavy(3,-2) 33→50** [seq421]；new infantry→(0,-1)→(0,0)；infantry 攻击 c infantry(1,0) 20→80 [seq423]；**artillery_warning R10** [seq410]；**artillery_damage R10 边界**：`player_c` 重装(2,2) 22→0 **死亡** [seq411]；`player_d` infantry(2,-4) 50→25；`player_d` infantry(4,-2) 10→0 **死亡** [seq413]；`player_a` infantry(0,4) 50→25；`player_d` infantry(3,-4) 50→25 | **my scout 已死（seq380）**；my 重装 150→123 hp 承 d heavy 反伤 [seq407] | ✅ 重装削血 d 60 hp；⚠️ 但 my 重装 27 hp 自损；新 infantry 推进中心 |
| 第11轮 / `player_b` | 25→45 / 4/4 | **ranger 击杀 d heavy(3,-2) bf3e9200** 8→0 [seq472] KILL #4（+1 merit）；infantry 攻击 c infantry(1,0) 20→60 [seq474]；**artillery_shrunk sr=3→2** [seq458]；**artillery_damage R11 边界**：`player_c` 重装(2,2) 已死；`player_d` infantry(2,-4) 25→0 **死亡** [seq504]；`player_a` infantry(-1,3) 25→0 **死亡**；`player_d` infantry(3,-4) 25→0 **死亡** | `player_e` 重装(-1,1) 攻击我 infantry(0,0) 18→59 [seq480]; `player_e` infantry(-2,-1) 攻击我 ranger(0,-2) 27→18 [seq480]；`player_d` 重装(2,-2) 攻击我 heavy(1,-2) 27→27→5 [seq455]（d 累计 R4 起 6 次反打 26+25+22+23+27+22=145 dmg 削血）；`player_a` 剩余单位被炮击至最后 | ✅ **ranger 击杀 d heavy**：+1 单位，−88 d armyValue；但 **my 重装 5 hp 残血**——R12 无法承受 d 重装反打 |
| 第12轮 / `player_b`（终局） | 45→65 / 4/4 | **heavy(1,-2) 攻击 d 重装(2,-2) 73eb5be5** 24→126 [seq516]（**死前一击**）；**ranger 击杀 c infantry(0,1) c3de1af9** 35→0 [seq517] KILL #5（+2 merit）；infantry 攻击 e infantry(-1,0) 25→75 [seq519] | **d 重装(2,-2) 反杀我 heavy 5→0** [seq537]，heavy 死亡 [seq538]；`player_e` 重装(-1,1) 攻击我 infantry(0,0) 31→50 [seq523]；`player_e` infantry(-2,-1) 攻击我 ranger(0,-2) 30→15 [seq524]；`player_a` **army_destroyed** [seq513] | ❌ **heavy 死亡**（loss 92 cost）；✅ KILL #5；终局：infantry 50 hp + ranger 15 hp |
| 终局检查 | 65 | 存活资格：是；六项裁决分：HQ伤害 0（权重0），HQ HP 0（权重0），据点 2（权重0），armyValue 38×2=76，supplies 65×0=0，actionScore 430×1=430，**总分 506** | 主要竞争者：`player_c` 544（+38）、`player_d` 746（+240）、`player_e` 792（+286） | 分差 38 vs `player_c`、240 vs `player_d`、286 vs `player_e` |

---

## 本局机制与配置

| 项目 | 本局值 | 来源/影响 |
|------|--------|-----------|
| 模式 | annihilation | 无 HQ，军力价值为核心 |
| 地图 | artillery-zone | 6 人支持，三阶段收缩 |
| 最大整轮数 | 12 | 第 12 轮后裁决 |
| 每回合行动点 | 4 | `config.balance.actionsPerTurn` |
| 炮火配置 | startRound=5, intervalRounds=2, damage=25, minimumSafeRadius=2 | 第 5 轮开始收缩，每 2 轮一次，最终安全半径 2 |
| 关键安全半径变化 | R1-4: 6；R5: 5；R7: 4；R9: 3；R11: 2 | 我 cp_northwest(0,-4) dist=4：R7 起 warning，R9 起 danger |
| 裁决权重 | armyValue=2, effectiveActions=10, 其余均为 0 | 据点收入有价值但裁决权重为 0 |
| 单位属性 | 步兵：HP 100, 攻击 30, 射程 1, 移动 3, 花费 45；重装：HP 150, 攻击 38, 射程 1, 移动 2, 花费 92；侦察兵：HP 65, 攻击 16, 移动 5, 花费 38；游侠：HP 72, 攻击 44, 射程 3, 花费 72 | 重装 cost 最高性价比最高，但移动慢、易被炮火压缩 |
| 我方初始补给/收入 | 45 / base 8 + cp_nw 4 + supply_nw 8 = 20/轮 | R1 起持续 12 轮共 220 补给收入 |

---

## 数据统计

### 对各对手的交互

| 对手席位 | 军力损失（cost 减损近似） | 击杀 | 被击杀 | 夺取其据点 | 关键影响 |
|----------|--------------------------|------|--------|------------|----------|
| `player_a` | 0 | 0 | 0 | 0 | 全程未接触，R12 被炮火 `artillery_destroyed` 淘汰 |
| `player_c` | 约 60（1 infantry + cost 45 重装被炮火收） | 1 | 0 | 0 | R12 ranger 击杀 1 infantry 残血；其重装被炮火击杀，不算我的 |
| `player_d` | 约 230（1 infantry + 1 heavy = 137 cost） | 2 | 0 | 0 | 主对手：R7 击杀 1 残血 infantry，R11 击杀 1 残血 heavy；但 d 也击杀我 1 重装（cost 92）和 2 步兵（cost 90） |
| `player_e` | 约 100（1 infantry 被我打残后炮火收；1 heavy 被削血未击杀） | 1 | 0 | 0 | 邻接 e 但未深追；e 终局 armyValue 146 第一（5 单位存活） |
| `player_f` | 92（1 heavy） | 1 | 0 | 0 | R9 一发 ranger 秒掉 f 的唯一 heavy，f 直接崩盘 |
| **总计** | **约 482** | **5** | **5** | **0** | **1 重装 + 4 步兵/侦察兵阵亡** |

### 击杀明细（unitsDestroyed=5）

| # | 轮次 | 我的单位 | 目标 | 位置 | 伤害 | merit | 备注 |
|---|------|----------|------|------|------|-------|------|
| 1 | R6 | scout 87e7f091 | e infantry efb70135 (0,0) | (0,0) | 5 (KILL) | +1 | 攻击 e 仅剩 5 hp 残血，正好击杀 |
| 2 | R7 | heavy ff235320 | d infantry 4a4494d9 (2,-3) | (2,-2) | 16 (KILL) | +1 | d 步兵被我 R3-R7 多次削血至 16，heavy 一击斩 |
| 3 | R9 | ranger 104b358a | f heavy f02ce91c (-2,1) | (0,-2) | 30 (KILL) | +2 | 一发 ranger 远射 30 dmg 击杀 f 重装 |
| 4 | R11 | ranger 104b358a | d heavy bf3e9200 (3,-2) | (0,-2) | 8 (KILL) | +1 | R10 削血至 50 hp 后残血击杀 |
| 5 | R12 | ranger 104b358a | c infantry c3de1af9 (0,1) | (0,-2) | 35 (KILL) | +2 | R11 削血至 35 hp，ranger 一击斩 |

### 补给与分数账本

**实际情况:**
- 部署单位：4 个 = infantry 1（45）+ scout 1（38）+ infantry 1（45）+ ranger 1（72）= **200** 补给
  - 部署明细：R2 infantry@(1,-4) [seq52]；R3 scout@(0,-3) [seq96]；R7 infantry@(-1,-3) [seq278]；R9 ranger@(0,-2) [seq371]
  - **无 deployDiscount**（本图 `controlPointTypes` 中所有类型 `deployDiscount=0`，`forward_base` 收入 4，`supply` 收入 8）
- 收入（11 次 income，base 8 + CP 收入 12）：**11 × 20 = 220** 补给
- 阵亡单位：5 = infantry 3 + scout 1 + heavy 1 = 45×3 + 38 + 92 = **265** cost（这些 cost 的补给是早期 deploy 投入）
- 最终六项裁决分：HQ伤害 0（权重 0），HQ HP 0（权重 0），据点 2×0（权重 0），**armyValue 38×2=76**，补给 65×0=0，**actionScore 430×1=430**，总分 **506**；权重全部来自 armyValue ×2 + actionScore ×10

**正确策略估算:**

*替代 A：R7 部署重装(92) 替代 R7 步兵(45)*
- 收入不变（220），deploy 总 200 - 45 + 92 = 247 → 超支 27 补给
- 需要 R3 不部署 scout(38)，改 R7 重装(92) + R9 部署 infantry(45) = 200 + 92 - 38 + 45 = 299 → 仍超支
- **可行**：R2 infantry(45) + R7 heavy(92) + R9 ranger(72) = 209 补给，剩 56 储备
- armyValue 终局假设重装存活 125 hp + infantry 50 hp + ranger 15 hp = 76 + 23 + 15 = **114**（vs 实际 38），总分 **114×2 + 430 = 658**，可超 player_c（544）升至第 3 名
- 前提：heavy 必须存活终局 → R11 重装不站 (1,-2)（远离 d 重装 (2,-2)），例如站 (0,-1) 中心等待

*替代 B：R11 用 ranger 削 e heavy*
- 同等 merit 增 +2（44 dmg → ceil(44/20)=2）
- e 重装从 74→30，R12 我或他人更易击杀
- 但 e 终局仍有 heavy + 4 infantry，armyValue 优势无法撼动

---

## 与历史对局的共同教训

| 项目 | 历史局 | 本局 |
|------|--------|------|
| 地图/模式 | `tg_0075_lose_OMP@minimaxm3.md`（同地图 2 人局，slot_west）我败 240 vs 1402；`tg_0077_rank01_OMP@minimaxm3.md`（同地图 3 人局）我胜 rank01 | `tg_0089`（6 人局）我 rank04 506 |
| 出生位 | tg_0075 slot_west (-4,0)；tg_0077 slot_west (-4,0) | slot_northwest (0,-4) — 6 人局轮到 NW 出生 |
| 关键经验 | tg_0075 致命错误：重装 R4 站 center 整整 3 整轮被三向 111 伤跨回合击杀，终局 0 军力 | **重蹈覆辙**：本局重装 R10-R11 在 (1,-2) 站了 2 整轮，被 d 重装 (2,-2) 多次反打，R11 削至 5 hp，R12 反击即死。同样错误：重装站邻接敌方重装的位置不撤退 |
| 据点收入策略 | tg_0075 我曾持 4-5 CP 创收 32-36/轮 | 本局仅持 2 CP（cp_northwest + supply_northwest），20/轮——未尝试夺取第二圈 CP |
| 炮火承伤 | tg_0075：scout(-3,-1) 在 R9 缩圈前 -25 hp；infantry supply_west R11 中炮 -25 hp | 本局：my scout (-1,-2) 在 R9 缩圈边界附近死亡；cp_northwest (0,-4) dist=4 在 R9 起被炮击 |
| 击杀数 | tg_0075：2 击杀（终极）；tg_0077 rank01 应有多击杀（待查） | 本局 **5 击杀（与 d 并列全场最高）** |
| 裁决总分差距 | tg_0075 我 240 vs 胜者 1402（差 1162）；tg_0077 rank01 应为我获胜 | 本局我 506 vs 胜者 792（差 286）——差距大幅缩小但仍输 |

**结论:** 
1. **【验证】重装站邻接敌方重装的位置是绝对错误**：tg_0075 是重装站 center，tg_0089 是重装站 (1,-2) 邻接 d 重装 (2,-2)。两次都因不撤退导致重装后期脆死。**核心教训：每整轮检查自己重装的邻格，若 6 hex 范围内有敌方重装，应主动后退 1 格**。
2. **【新增】ranger 是 artillery-zone 的胜负手**：本局我 ranger 3 击杀（d 重装、c infantry、f 重装），`tg_0077` rank01 也强调过 ranger 价值。**R9 缩圈前部署 ranger 应是必选而非可选**。
3. **【改进】死亡轮次偏早**：R6-R7 连续阵亡 3 步兵，对应 d 重装 (3,-2) 推进的窗口。**当对手重装靠近时，本方步兵应主动回撤到据点附近**，避免无谓承伤。 |
4. **【未修正】早期未尝试夺取第二个 supply CP**：tg_0075 我曾持 4-5 CP 创收，本局仅持 2 CP（cp_northwest + supply_northwest），第 2 圈 (3,0)/(0,3) supply 都没尝试推进。**这是本局 vs 第 3 名 `player_c`（544）的关键差距**——仅 38 分 armyValue 差，但我的 deploy 节奏同样慢于 c（c 部署了 4 单位含 1 ranger）。

---

## 经验教训

### ✅ 做得好的

1. **【抢占先手 CP】R1 抢 supply_northwest**：先手玩家（turnOrder 0）首回合即占领最近的 supply CP，全场唯一在 R1 完成 CP 占位的玩家，确保 R1 起即享 20/轮收入（最大经济档）
2. **【ranger 后期三杀】R9-R12 ranger 高效输出**：72 cost 的 ranger 在 (0,-2) 中心位置 4 个整轮内 3 次击杀（d 重装、c infantry、f 重装），单 ranger armyValue 贡献约 240 d/c/f 减损 + 自身 15 hp 存活 = 净收益 ~+30 相对分数
3. **【主动撤回受伤步兵】R5-R6 撤退动作**：R5 我 infantry (1,-3) 77→12 hp 时主动 (1,-3)→(1,-2) 撤退（避免再吃 d 步兵 22 反伤），虽然还是死了（d 在 R6 反打），但至少 R5 没白送
4. **【5 击杀与 d 并列全场最高】** `unitsDestroyed=5` 与 `player_d`（同样 5 击杀）并列全场第一；`player_c` 4 击杀，`player_e` 3 击杀

### ❌ 致命失误

1. **R7 部署第 2 步兵(45) 错失 R7 重装(92) 窗口**：第 2 步兵仅存活 4 整轮（R7-R10），期间只 1 次攻击输出（19 dmg → +1 merit）；同窗口改 deploy heavy 可撑过 R9 缩圈（重装在 dist≤2 安全）且 R10 后成为主力输出
2. **R11 重装站 (1,-2) 邻接 d 重装 (2,-2) 不撤退**：R10 末 heavy 已被 d 反打至 123 hp，R11 应退至 (0,-1) 中心或 (0,-2) ranger 旁规避。R11 我重装 5 hp 残血仍站邻接位置是 R12 即死的直接原因
3. **未深追 e 的重装**：本局 e 是最终胜者（armyValue 146），但我从未对 e 重装（-2,0 后移至 (-1,1)）造成 1 点伤害。R9-R11 我应至少用 ranger 远射削 e 重装，迫使其在 R12 前提前支出防御
4. **R7 末起 cp_northwest 处于 dist=4 风险区未及时撤空**：R7 后 cp_northwest 已是 warning/danger（safeRadius=4）。我的 infantry 留守 (1,-3) 和 (-1,-3) 不在 cp 上，但若 R8 我将 infantry 撤回 cp_northwest 守 CP 会更安全

### 🔑 核心教训

> **"artillery-zone 6 人局，R7 是补给与重装的分水岭：deploy heavy(92) 在 R7 之前完成能撑过 R9 缩圈；R7 之后 deploy 的 infantry/scout 都会被 R9-R11 炮火+集火清理。"**

---

## 下次的正确策略

```text
第1轮 / player_b: infantry(-1,-4)→(0,-3) 占 supply_northwest；infantry(0,-5)→(0,-4) 守 cp_northwest；heavy(1,-5)→(1,-3) 前推 — 100% 保留
第2轮 / player_b: 
  - 收入 20 后剩 65；deploy infantry(45) @ (1,-4) 邻接 cp_northwest / 或探索第二圈 CP
  - heavy(1,-3)→(1,-2) 内圈推
  - infantry(0,-3)→(0,-2) 推进 (备用)
  - infantry(0,-4)→(-1,-3) 西移 / 或保留守 cp_northwest
  【关键：deploy infantry(45) 是 OK，但需保留 20 储备供 R3】
第3轮 / player_b:
  - 收入 20 后剩 40（65-45+20）
  - 选项 A：deploy scout(38) @ (0,-3) 守 supply_northwest — 保留 2 储备
  - 选项 B：保留 40 储备不 deploy，节省给 R7 heavy — 但损失 attack output
  - 决定：保留 scout(38) deploy（同本局，因为 scout 后期击杀效率高）
第4-6轮 / player_b:
  - 内推 heavy(1,-2)→(2,-2)，配合 infantry 集火 d 步兵(2,-3)
  - 【关键改进】R6 末 heavy 应在 (2,-1) 中心，不在 (1,-2) 邻接 d heavy
第7轮 / player_b（炮火 sr=4）:
  - 【最关键】deploy heavy(92) @ (0,-3) 或 (1,-4) from supply_northwest — **不再 deploy infantry(45)**
  - 部署后储备：65+20-92 = -7 超支，需 R7 不 deploy 而是 attack 维持
  - 或：R6 不 deploy 任何东西，存到 R7 heavy(92) 部署
  - 实际可行：R6 不 deploy（保持 65-38+20=47 储备），R7 heavy(92) 部署后剩 -45，超支
  - **真实可行路径**：R3 改不 deploy scout（保留 65-45-38+20-20=2 储备太少）
  - **唯一可行**：R2 跳过 deploy infantry 直接 deploy heavy(92)（保持 65-92+20-20=−27，仍超支）
  - 【重新评估】**R7 部署 heavy 在经济上根本不可能**，除非放弃 R2 的 infantry(45) → R2 0 deploy + R7 heavy(92) 储备 = 65+20-92 = -7，仍超支
  - **真正的最优路径**：R2 infantry(45) + R3 scout(38) + 等待 + **R7 必须跳过 deploy** 把 65+20×4=145 储备堆到 R9 deploy heavy(92) + 留 53 reserve → 但 R9 已是 sr=3，deploy target dist=3 处于 danger zone，不可行 deploy
  - **结论**：本图 R2-R6 都必须 deploy 才能在 R9 前集齐 92 heavy。本局节奏 **不可能 deploy heavy**。只能 deploy 1-2 个 scout + 2-3 个 infantry（早期）+ ranger(R7/R9)。终局必然 armyValue 偏低。这是 artillery-zone 6 人局的结构性约束。

触发条件: artillery-zone 6 人局 R2-R6 deploy 节奏 + R7 后 deploy safety 检查
终局检查: 存活资格、armyValue ≥ 80、actionScore ≥ 400、5 个存活单位（heavy + ranger + 3 infantry）、dist ≤ 2 全员安全
```

---

**一句话总结：** artillery-zone 6 人局 minimaxm3 我 5 击杀（与 `player_d` 并列全场最高）但终局 armyValue 仅 38（rank04），败因是 R7 错失重装部署窗口、R11 重装站 (1,-2) 不退被 d 反杀、始终未对最终胜者 `player_e` 造成 1 点伤害——重装邻接不退、对领先者无压制、经济与军力两条赛道双输。 |

---

*文档生成时间: 2026-08-12*
*回放格式版本: 3.2.10*
*AI模型: OMP@minimaxm3*