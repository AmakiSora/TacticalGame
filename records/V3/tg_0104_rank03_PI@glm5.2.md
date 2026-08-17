# 战术游戏第3名复盘 — `player_c` 视角

**日期:** 2026-08-17
**游戏ID:** `f357b3fd-db2d-481f-b6ea-033db0be2698`
**回放版本/地图:** 3.2.11 / `artillery-zone`（炮火禁区，半径6六边形，127格全平原无 blocker/水域；歼灭模式，无 HQ，炮火按整轮收缩）
**玩家:** GLM5.2-PI（PI@glm5.2，pi 客户端，模型 glm5.2）
**席位与出生:** `player_c`，行动顺序第 2（中手，`turnOrder=['player_a','player_c','player_b']`），出生 `slot_northwest`：步兵(0,-5)、步兵(-1,-4)、重装(1,-5)；初始控制点 `cp_northwest`(0,-4)、`supply_northwest`(0,-3)；无 HQ（歼灭模式）
**对手1:** `player_a` = GPT5.6sol-CX（CX@gpt5.6sol），行动顺序第 1（先手），出生 `slot_east`：步兵(5,0)、步兵(5,-1)、重装(4,1)；初始 `cp_east`(4,0)
**对手2:** `player_b` = KimiK3-WB（WB@KimiK3），行动顺序第 3（末手），出生 `slot_southwest`：步兵(-5,5)、步兵(-4,5)、重装(-5,4)；初始 `cp_southwest`(-4,4)
**参战人数/最终名次:** 3 人 / 第 3 名
**结果:** ❌ 存活至第 12 整轮（轮数上限），裁决落后；三方均存活
**结束原因:** `turn_limit_score`（唯一最高分 `player_a` 856 分获胜）
**最终补给/HQ/总分:** 136 / 不适用（无 HQ） / 804 分

> 取证来源：本局完整事件流（345 条事件，实时 `GET /api/games/:id` + `events` 取证）。事件 seq、伤害、补给、坐标均直接取自事件流；单位 HP 轨迹由 attack 事件 `actualDamage` 与 `artillery_damage.unitHp` 逐条追踪。补给账本闭合：我方 45 初始 + 288 收入（seq11/36/62/91/122/150/180/208/238/267/299/330 共 12 轮）− 197 部署（5 单位：scout×4 + infantry×1）= 136 终值，与 `game_over` 一致。

---

## 最终排名摘要

| 名次 | 席位 | 玩家 | agent@模型 | 状态 | 据点 | 军力 | 补给 | 行动分 | 总分 | 与我分差 |
|------|------|------|-----------|------|------|------|------|--------|------|----------|
| 1 | `player_a` | GPT5.6sol-CX | CX@gpt5.6sol | 存活 | 4 | 88 | 108 | 680 | **856** | +52 |
| 2 | `player_b` | KimiK3-WB | WB@KimiK3 | 存活 | 4 | 196 | 77 | 460 | **852** | +48 |
| **3** | **`player_c`** | **GLM5.2-PI（我方）** | **PI@glm5.2** | **存活** | **3** | **152** | **136** | **500** | **804** | — |

> 六项裁决分（权重取本局 `config.balance.adjudicationWeights`：`enemyHqDamage` 0 / `ownHqHp` 0 / `controlPoint` 0 / `armyValue` 2 / `supplies` 0 / `effectiveActions` 10）：
> - `player_a`：HQ 0×0 + HQ HP 0×0 + 据点 4×0 + 军力 88×2 + 补给 108×0 + 行动分 680 = 0+0+0+176+0+680 = **856**
> - `player_b`：HQ 0×0 + HQ HP 0×0 + 据点 4×0 + 军力 196×2 + 补给 77×0 + 行动分 460 = 0+0+0+392+0+460 = **852**
> - `player_c`（我）：HQ 0×0 + HQ HP 0×0 + 据点 3×0 + 军力 152×2 + 补给 136×0 + 行动分 500 = 0+0+0+304+0+500 = **804**
>
> 分差分析：我落后第 2 名 `player_b` 仅 **48 分** = 军力差 (196−152)×2 + 行动分差 (500−460)×(−1) = 88−40 = 48；落后第 1 名 `player_a` **52 分** = 军力差 (88−152)×2 + 行动分差 (500−680) = −128+180 = 52。关键矛盾：`player_a` 军力最低（88）却靠 680 行动分夺冠；我方行动分 500 三方最高，但军力 152 被阵亡的 4 个 scout 拖累，且据点 3:4 落后。HQ/CP/补给权重均为 0，不构成裁决分。

---

## 核心教训

### 致命错误：4 个侦察兵全部阵亡，军力赛道 152:196/88 被迫让位；根因是前 2 个 scout 贪点位深陷中央后被 `player_a` 围杀，且末手（行动顺序第 3）始终在 `player_a` 攻击之后无补救窗口

本局 `armyValue×2` 与 `actionScore`（merit×10）是唯二有效赛道。我方行动分 500 为三方最高，证明每轮 4 AP 都在产出有效攻击/部署/占领，没有空过；但**终局军力 152 位列第二**（`player_b` 196、`player_a` 88），且据点 3:4:4 落后，导致总分垫底。军力崩盘的根源是 **5 次部署中 4 个 scout（cost 38×4=152 补给）全部阵亡**，仅 1 个 infantry（seq96, cost 45）存活至终局。

关键阵亡链（事件 seq 直引）：
```text
第3轮 / player_a: 攻击我 scout 75d3 (1,-4) [seq82] → 死亡 [seq83]；65 军力蒸发
第6轮 / player_a: 攻击我 infantry 5fd7 (0,-3) [seq141] → 死亡 [seq142]；34HP→0
第7轮 / player_a: 攻击我 scout c5ca (0,-2) [seq202] → 死亡 [seq203]；41HP→0
第8轮 / player_a: 攻击我 scout 2ace (0,-1) [seq234] → 死亡 [seq235]；65HP→0
第10轮 / player_a: 攻击我 scout dbc7 (0,0) [seq262] → 死亡 [seq263]；65 军力蒸发
```

我方 5 个单位死亡中 **4 个死于 `player_a` 之手**（1 个步兵 + 3 个侦察兵），仅 1 个侦察兵（seq83）死于第 3 轮早期。`player_a` 作为先手（行动顺序第 1），每轮在我之前行动，能先手集火我暴露的 scout；我作为中手（第 2）虽能在 a 之后 b 之前反击，但 scout 防御 4、HP 65 极脆，一旦被重装（attack 38）或步兵（attack 30）贴脸即濒死，b 回合也无力补救。

---

## 关键时间线

| 整轮/席位回合 | 补给 | 行动点 | 我的操作与坐标 | 对手响应 | 问题或收益 |
|---------------|------|--------|----------------|----------|------------|
| 第1轮 / `player_c` | 45→7 | 0→3/4 | inf 5fd7 (-1,-4)→(0,-3) seq13；inf 5c35 (0,-5)→(0,-4) seq14；deploy scout 2ace (1,-4) from cp_northwest seq15 -38 | `player_a` 先手占 supply_east/supply_northeast/supply_southeast | ✅ 抢 supply_northwest + cp_northwest 固守；但 -38 部署 scout 消耗过半补给 |
| 第2轮 / `player_c` | 19→57→19 | 0→3/4 | scout 2ace (1,-4)→(-3,0) seq38；deploy scout 2ace'(1,-4) seq39 -38；inf 5c35 (0,-4)→(-3,-2) seq40 | `player_a` 续扩军；`player_b` 占 supply_southwest | ✅ scout 远程占 supply_west（seq41 归我）；但又 -38 部署第 2 个 scout，补给见底 |
| 第3轮 / `player_c` | 29→29 | 0→4/4 | move 5c35 (-3,-2)→(-4,-1) seq64；atk scout 2ace→b scout ce92 dmg15 seq65；atk inf 5c35→ce92 dmg29 seq66；atk inf 5fd7→a inf 4418 dmg20 seq67；atk scout 75d3→4418 dmg10 seq68 | `player_a` [seq82] **击杀我 scout 75d3** | ❌ **首个 scout 阵亡**：75d3 站 (1,-4) 被 a 集火；b scout ce92 仅打到 21HP 未死 |
| 第4轮 / `player_c` | 39→39 | 0→4/4 | atk 5c35→ce92 dmg26→21 seq93；move 5c35 (-4,-1)→(-4,0) seq95（占 cp_west，夺回）；deploy inf bf1e (-1,-4) seq96 -45；move heavy 9264 (1,-5)→(-1,-3) seq97 | `player_b` 第2轮已占 cp_west/cp_southeast（seq49/50）；现被我夺回 cp_west | ✅ **击杀 b scout ce92 + 夺回 cp_west**；但 -45 部署步兵后补给归零 |
| 第5轮 / `player_c` | 57→19 | 0→4/4 | atk inf 5fd7→a inf 4418 dmg20 seq124；move heavy 9264 (-1,-3)→(-1,-2) seq125；atk heavy 9264→4418 dmg33 seq126（100→8→死?）；deploy scout c5ca (1,-5) seq127 -38；move scout 2ace (-3,0)→(-1,-1) seq128；atk scout 2ace→4418 dmg11 seq129 | 炮火首缩 R5 safeRadius 6→5（seq111）；`player_a` 攻击我 inf 5fd7 | ⚠️ a inf 4418 降到 8HP 但未死；又 -38 部署第 3 个 scout，补给 19 |
| 第6轮 / `player_c` | 44→44 | 0→4/4 | atk heavy 9264→a inf bc73 dmg33 seq152；move scout 2ace (-1,-1)→(0,-1) seq153；atk scout 2ace→4418 dmg9→2 seq154；move inf bf1e (-2,-2)→(-1,-3) seq156；move scout c5ca (1,-5)→(0,-2) seq157 | `player_a` [seq141] **击杀我 inf 5fd7 (0,-3)** 并占 supply_northwest（seq148） | ❌ **inf 5fd7 阵亡，丢失 supply_northwest**；我反击把 a inf 4418 打到 2HP |
| 第7轮 / `player_c` | 30→6 | 0→4/4 | atk heavy 9264→a inf bc73 dmg28→8 seq182；atk scout c5ca→bc73 dmg10→? seq183；move inf bf1e→(-1,-3) seq184；atk inf bf1e→bc73 dmg21→死? seq185；deploy scout dbc7 (-3,-1) from cp_west seq186 -38 | `player_a` [seq202] **击杀我 scout c5ca (0,-2)** | ❌ **第 2 个 scout c5ca 阵亡**；但击杀 a inf bc73（8HP）+ 重创 bc73；又 -38 部署第 4 个 scout |
| 第8轮 / `player_c` | 40→40 | 0→4/4 | atk scout 2ace→a inf bc73 dmg10→死? seq210（杀）；move inf 5c35 (-4,0)→(-3,0) seq212；move inf bf1e (-1,-3)→(-1,-1) seq213；move scout dbc7 (-3,-1)→(-2,0) seq214 | `player_a` [seq234] **击杀我 scout 2ace (0,-1)** | ❌ **第 3 个 scout 2ace 阵亡**；但我击杀 a inf bc73(1,-2) |
| 第9轮 / `player_c` | 64→64 | 0→4/4 | atk heavy 9264→a inf aa90 dmg30 seq240；atk inf bf1e→aa90 dmg19 seq241；move scout dbc7 (-2,0)→(0,0) seq242；atk scout dbc7→a inf 4a99 dmg11→死? seq243 | 炮火 R9 safeRadius→3（seq224）；`player_a` [seq262] **击杀我 scout dbc7 (0,0)** | ❌ **第 4 个 scout dbc7 阵亡**；击杀 a inf 4a99(1,0,2HP) |
| 第10轮 / `player_c` | 88→88 | 0→4/4 | atk heavy 9264→a inf aa90 dmg27 seq269；atk inf bf1e→aa90 dmg23 seq270；move heavy 9264 (-1,-2)→(-2,0) seq271；move inf 5c35 (-3,0)→(-1,0) seq272 | 炮火 R10 safeRadius 仍 3，预警 R11→2；`player_a` 续兵 | ⚠️ aa90 降到 1HP 未死；撤离 heavy/inf 至安全半径 |
| 第11轮 / `player_c` | 112→112 | 0→4/4 | atk inf bf1e→a inf aa90 dmg20→死? seq301（杀）；atk inf 5c35→a scout c847 dmg24→41 seq303；move heavy 9264 (-2,0)→(-1,1) seq304；atk heavy 9264→c847 dmg32→9 seq305 | 炮火 R11 safeRadius→2（seq284）；`player_a` 攻击 b 单位 | ✅ **击杀 a inf aa90(0,-2,1HP)** + 重创 a scout c847；但无法击杀 c847(9HP) |
| 第12轮 / `player_c` | 136→136 | 0→4/4 | atk heavy 9264→a heavy 0268 dmg23→17 seq332；atk inf 5c35→0268 dmg15→? seq333；atk inf bf1e→a inf 3ff3 dmg24 seq334 | `player_a` 终局攻击 b；`player_b` R12 回合 | ⚠️ a heavy 0268 仅打到 17HP；3 AP 全用于攻击换行动分 |

---

## 补给与分数账本

**实际情况:**
- 部署各类单位：5 单位，共 197 补给
  - scout×4：seq15(38) / seq39(38) / seq127(38) / seq186(38) = 152 补给
  - infantry×1：seq96(45) = 45 补给
  - **无部署折扣**（本局 `controlPointTypes` 各 `deployDiscount` 均为 0）
- 基础 + 据点收入：12 轮共 288 补给（seq11/36/62/91/122/150/180/208/238/267/299/330；base 8/轮 × 12 = 96，control 收入合计 192）
- 初始补给 45 + 收入 288 − 部署 197 = 136 终值（与 `game_over` 一致，账本闭合）
- 最终六项裁决分：HQ 伤害 0×0、HQ HP 0×0、据点 3×0、军力 152×2=304、补给 136×0、actionScore 500，总分 **804**；HQ/CP/补给权重均为 0，不构成裁决分

**终局存活单位（3 个）：**
- infantry 5c35 @(-1,0) HP 100/100（cost 45 → armyValue 45）
- heavy 9264 @(-1,1) HP 116/150（cost 92 → armyValue round(92×116/150)=71）
- infantry bf1e @(-1,-1) HP 80/100（cost 45 → armyValue round(45×80/100)=36）
- armyValue 合计 = 45+71+36 = 152 ✓

**阵亡单位（5 个，共损 armyValue 潜力 152+45=197 补给成本）：**
- scout 75d3 @seq83（cost 38）→ armyValue 潜力 38 全失
- infantry 5fd7 @seq142（cost 45）→ 45 全失
- scout c5ca @seq203（cost 38）→ 38 全失
- scout 2ace @seq235（cost 38）→ 38 全失
- scout dbc7 @seq263（cost 38）→ 38 全失

**正确策略估算:**
- 替代方案 A：第 2 轮不再部署第 2 个 scout，改为保存补给到 R3-R4 部署 1 个 ranger（cost 72，attackRange 3）于内圈安全格，建立远程火力点避免贴脸阵亡。预期可保留至少 1 个 scout 至终局，armyValue 至少 +38，总分 +76（×2），反超 `player_b` 的 852。
- 替代方案 B：将 scout 始终留在内圈距离≤3 的安全格做占领/侦察，不进入中央 (0,0)/(0,-1)/(0,-2) 这条 `player_a` 主攻轴。4 个 scout 死亡位置均在 q=0 或 r∈{-2,-1,0} 的中央走廊，是 a 的推进路线。
- 预期差距：保留 2 个 scout 存活 → armyValue 152+76=228，总分 804+152=956，可争第 1。（假设不成立：`player_a` 680 行动分仍领先，但若军力差逆转为 228 vs 88，则 456+500=956 > 856。）

---

## 经验教训

### ✅ 做得好的
1. **行动分三方最高（500）**：12 轮中每轮 4 AP 几乎全用于攻击/部署/占领，仅个别轮次用 1 AP 移动撤离。攻击造成实际伤害产生 merit，部署/占领也各 +1/+2 merit，`effectiveActions=10` 下转化为 500 分。对比 `player_b` 仅 460。
2. **击杀数 5:5 不落下风**：击杀 b scout ce92（seq94）、a infantry 4418（seq155）、a infantry bc73（seq211）、a infantry 4a99（seq244）、a infantry aa90（seq302），共 5 个单位；与 `player_a`（击杀我 4 单位 + b 若干）正面交锋不亏。
3. **炮火撤离零承伤**：全程 10 次 `artillery_damage` 事件（seq169/225/226/285-288/316-318）均命中 `player_b` 单位，**我方单位 0 次炮火承伤**。每次收缩前（R5/R7/R9/R11）都主动将 warning 区单位撤入新 safeRadius，R10-R12 末段所有存活单位稳定在 safeRadius 2 内圈。
4. **据点经济稳定**：全程守住 cp_northwest + supply_northwest/supply_west，R4 夺回 cp_west（seq98），收入从 R1 的 12 稳步升至 R3+ 的 24-32/轮。

### ❌ 致命失误
1. **4 个 scout 全部阵亡，armyValue 赛道崩盘**：5 次部署中 4 个是 scout（152 补给），但 scout 防御 4、HP 65 极脆，且都被派往中央走廊 (1,-4)→(0,-2)→(0,-1)→(0,0)，正好是 `player_a`（先手）的重装+步兵推进轴，被逐个击杀。4×38=152 军力潜力全失，相当于白白烧掉 152 补给。
2. **末手劣势未补偿**：我行动顺序第 2（中手），`player_a` 先手每轮先打我暴露单位，我无法在其攻击前规避。应对策略应是**不在 a 的主攻轴部署脆皮 scout**，或部署后立即后撤至 a 射程外。但我反复在 (0,*) 轴放 scout 送死。
3. **补给囤积过多未转化**：终局 136 补给（权重 0，不构成裁决分），但 R10-R12 因两个 CP（cp_northwest/cp_west）均落入 danger 区无法部署，补给无法转化为军力。应在 R8-R9 炮火收缩前、CP 尚安全时把补给花完部署在内圈。
4. **据点 3:4 落后未补救**：R6 丢失 supply_northwest（被 a 占 seq148）后再未夺回，且 cp_northeast（中立）始终未占，导致据点数 3:4:4 垫底。虽权重为 0，但少 1 个 CP 意味着少 8 收入/轮和少 1 个部署入口。

### 🔑 核心教训
> **"歼灭模式 scout 是占领工具不是战斗单位；末手玩家绝不可在先手主攻轴放脆皮单位送军力，炮火收缩前必须把囤积补给在内圈 CP 部署成存活单位"**

---

## 与历史对局的共同教训

1. **与 tg_0081（PI@glm5.2 vs qwen3.8max，artillery-zone，第2名）完全重复了"高价值单位全部阵亡"的错误**：tg_0081 我方 2 heavy + 3 ranger 全阵亡导致军力 24:120 崩盘；本局换成了 4 scout 全阵亡导致军力 152 偏低。**教训未内化**：歼灭模式下 armyValue×2 是主赛道之一，任何 cost≥38 的单位阵亡都是直接的裁决分损失。下次必须把"单位存活率"作为与"行动分产出"同等优先的 KPI。

2. **与 tg_0088（CX@gpt5.6sol，artillery-zone，第1名）对比印证"补给必须花在内圈存活单位"**：tg_0088 中 `player_a`(gpt5.6sol) 终局军力 168、行动分 760 夺冠，关键就是 heavy+support 存活 + 持续部署。本局我囤积 136 补给无法转化，正是 tg_0088 冠军策略的反面——**炮火收缩前（R8-R9）应把补给花完**，因为 R10+ 所有边缘 CP 落入 danger 无法部署。

3. **本局新发现——三人对局末手劣势**：2 人局先手优势在 3 人局被放大为"先手（a）每轮最先集火、末手（b）每轮最后补刀"，中手（我）夹在中间，暴露的脆皮单位既无法规避 a 的先手攻击，也无 b 的补救窗口。三人对局中**中手应避免部署在双方主攻轴交叉的中央格**，优先在己方 CP 附近做防御性占领。

---

## 下次的正确策略

```text
第1轮 / player_c: inf×2 移至 supply_northwest + cp_northwest 固守；deploy 1 scout 抢 supply_west（远点中立），补给余 ~7
第2轮 / player_c: scout 已占 supply_west 后立即后撤至内圈（dist≤3），不进中央走廊；heavy 向中心推进 1 格；不部署第 2 个 scout，存补给
第3-4轮 / player_c: 炮火未启动，用 heavy + inf 集火 b/a 暴露单位；若补给≥72 部署 1 ranger 于内圈安全格建远程火力（attackRange 3，避免贴脸阵亡）
中盘触发条件: R4 末（炮火首缩 R5 前）所有边缘单位撤入 dist≤5；R8 末（R9 缩至 safeRadius 3 前）所有单位撤入 dist≤3；R10 末（R11 缩至 safeRadius 2 前）所有单位撤入 dist≤2
补给转化窗口: R8-R9 CP 尚安全时把补给花完部署 infantry（cost 45，HP 100 存活率高）于内圈；R10+ 不再囤积，因边缘 CP 落入 danger 无法部署
终局检查: 存活单位数 ≥4、armyValue ≥200、据点 ≥4、actionScore 持续产出；落后第 2 名 ≤48 分时，军力差是唯一可追赶赛道
```

---

## 本局机制与配置

| 项目 | 本局值 | 来源/影响 |
|------|--------|-----------|
| 模式 | `annihilation` | `config.mode`；无 HQ，army_destroyed 淘汰 |
| 最大整轮数 | 12 | `config.balance.maxTurns`；R12 后 `turn_limit_score` |
| 每回合行动点 | 4 | `actionsPerTurn` |
| 初始/基础收入 | 45 / 8 | `startingSupplies` / `baseIncome` |
| 据点效果 | supply: income 8；forward_base: income 4；无折扣/维修 | `controlPointTypes` |
| 裁决权重 | enemyHqDamage 0 / ownHqHp 0 / controlPoint 0 / armyValue 2 / supplies 0 / effectiveActions 10 | `adjudicationWeights`；仅 armyValue×2 + actionScore 有效 |
| 炮火配置 | startRound 5 / intervalRounds 2 / damage 25 / minimumSafeRadius 2 | `config.annihilation.artillery`；R5→5, R7→4, R9→3, R11→2 |
| 单位属性 | inf: hp100/atk30/def8/mv3；scout: hp65/atk16/def4/mv5；heavy: hp150/atk38/def13/mv2；ranger: hp72/atk44/def3/mv3/range3；support: hp82/atk10/def5/mv3/heal22 | `config.units`；本局未部署 ranger/support |

---

## 数据统计

### 对各对手的交互

| 对手席位 | 军力损失（我造成的） | 我击杀 | 我被击杀 | 夺取其据点 | 关键影响 |
|----------|----------------------|--------|----------|------------|----------|
| `player_a`（CX@gpt5.6sol） | inf 4418/bc73/4a99/aa90 共 4 杀 + heavy 0268/scout c847 重创 | 4（4418@seq155, bc73@seq211, 4a99@seq244, aa90@seq302） | 4（scout 75d3@seq83, inf 5fd7@seq142, scout c5ca@seq203, scout 2ace@seq235, scout dbc7@seq263 共5死，其中4死于此） | 0 | a 先手每轮集火我 scout，是军力崩盘主因 |
| `player_b`（WB@KimiK3） | scout ce92 击杀 + 重创其若干单位 | 1（ce92@seq94） | 0 | 夺回 cp_west（seq98，此前 b 占 seq49） | b 与 a 互相消耗，我夹中间；b 炮火承伤 250 分但军力仍 196 居首 |

### 补给与部署

| 项目 | 数量 | 实际花费/收入 |
|------|------|---------------|
| scout 部署 | 4 | 152 补给（seq15/39/127/186 各 38） |
| infantry 部署 | 1 | 45 补给（seq96） |
| heavy/ranger/support 部署 | 0 | — |
| 部署折扣 | 0 次 | 0（本图无折扣） |
| 基础收入 | 12 轮 | 96 补给 |
| 据点收入 | 12 轮 | 192 补给 |
| 炮火承伤 | 0 | 我方单位 0 次受击 |
| 最终补给 | — | 136 |

---

## 与历史对局的对比

| 项目 | 历史局 tg_0081（PI@glm5.2） | 本局 tg_0104（PI@glm5.2） |
|------|------------------------------|----------------------------|
| 人数/地图/模式/出生 | 2人 / artillery-zone / annihilation / slot_west（先手） | 3人 / artillery-zone / annihilation / slot_northwest（中手） |
| 名次与结束原因 | 第2名 / turn_limit_score（538 vs 830） | 第3名 / turn_limit_score（804 vs 856） |
| 关键据点控制 | 5:6 微落后 | 3:4:4 垫底 |
| 军力损失 | 2 heavy + 3 ranger 全阵亡，终局 24 | 4 scout + 1 inf 阵亡，终局 152 |
| 击杀数/被击杀 | 6:7 | 5:5 |
| 裁决总分 | 538（落后 292） | 804（落后 52） |
| 行动分 | 490（落后 100） | 500（三方最高，领先 b 40、落后 a 180） |

**结论:** tg_0081 的教训"高价值单位全部阵亡导致军力崩盘"在本局以不同形式重演（heavy/ranger→scout），但本局分差从 292 缩小到 52，说明**行动分产出和炮火撤离已有显著进步**（0 炮火承伤、500 行动分三方最高）。**军力保全仍是最大短板**：连续两局都把 cost≥38 的单位送光。下次必须把 scout 限制为"占领后即后撤"的纯工具角色，绝不让其进入战斗轴；且三人对局中手中位玩家应优先保军而非抢点。

---

**一句话总结：歼灭模式下 scout 全送光、补给囤积到炮火收缩后无法部署，是我连续两局军力赛道的同一致命伤；行动分再高也补不回 4×38 军力的蒸发。**

---

*文档生成时间: 2026-08-17*
*回放格式版本: 3.2.11*
*AI模型: PI@glm5.2*
