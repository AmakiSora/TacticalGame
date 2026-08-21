# 战术游戏第4名复盘 — `player_d` 视角

**日期:** 2026-08-21
**游戏ID:** 27a90547-7a20-416e-9a28-3d9b51cb4918
**回放版本/地图:** 3.2.12 / artillery-zone（歼灭模式）
**玩家:** GLM5.2-WB（WB@glm5.2）
**席位与出生:** `player_d`，行动顺序第1，初始单位：2×infantry[(5,0)/(5,-1)] + heavy[(4,1)]，首个控制点 `cp_east`(4,0) forward_base，无 HQ（歼灭模式）
**参战人数/最终名次:** 6人 / 第4名
**结果:** 存活至第12轮但裁决落后
**结束原因:** `turn_limit_score`（`player_f` 以 666 分裁决获胜）
**最终补给/HQ/总分:** 160 / 不适用（无HQ） / 484分

---

## 最终排名摘要

| 名次 | 席位 | 玩家 | 状态 | 总分 | 与我方分差 | 决定性优势 |
|------|------|------|------|------|------------|------------|
| 1 | `player_f` | Hy3-WB | 存活 | 666 | +182 | actionScore 460 + armyValue 103（最高） |
| 2 | `player_b` | Qwen3.8v27b-OMP | 存活 | 542 | +58 | actionScore 470（全场最高） |
| 3 | `player_c` | Dsv4Flash0731-CP | 存活 | 538 | +54 | actionScore 420 |
| **4** | **`player_d`** | **GLM5.2-WB（我）** | **存活** | **484** | **—** | — |
| 5 | `player_a` | Dots3NotePrev-OMP | 存活 | 344 | -140 | armyValue 32 偏低 |
| 6 | `player_e` | GPT5.6terra-OMP | 淘汰 | 280 | -204 | 第11轮被 `player_f` 以 `army_destroyed` 淘汰 |

> 裁决权重（本局 `adjudicationWeights`）：enemyHqDamage=0, ownHqHp=0, controlPoint=0, armyValue=2, supplies=0, effectiveActions=10。六项中只有 **armyValue×2 + actionScore** 构成裁决分；HQ/据点/补给权重均为0。所有人 controlPoints 项都是 2（仅占1个 supply+1个 forward_base，权重0不加分）。

---

## 核心教训

### 致命错误: 重装孤军深入中心绞肉机，r2-r5 被双方向重装夹击阵亡，损失 92 价值单位 + 前期 actionScore 严重落后

第2轮我把唯一的 heavy(92价值，全场最贵单位)从(4,1)推进到正中心(0,1)，试图抢占炮火收缩后的中央安全区。但中心被 `player_b` heavy(0,2) 与 `player_e` heavy(-1,0) 双向夹击——两者 moveRange 2+atkR1=reach3，覆盖中心所有可达格子。重装 r3 起持续承伤(134→86→21)，r5 末在(0,1)阵亡(unit_death seq，killer未记录但坐标吻合)。

**直接后果：**
- 损失 92 armyValue，对应 -184 裁决分潜力（权重2）
- 前期( r3-r6)我被迫转入保命撤退，4 轮里仅打出 2 次攻击(r3/r4 各打 player_b 重装)，actionScore 落后到 r6 仅 190（当时 player_b 已 300）
- 第3轮 adjudication 快照我 430 分垫底第6

**正确做法：** r2 不应让 heavy 单骑入中心。annihilation 6人局中心是所有方向火力的交集，无 HQ 模式下单位就是分值本身，92 价值的 heavy 不该在没有 support 跟随、没有步兵屏护的情况下进绞肉机。应让 heavy 沿东侧(2,1)→(2,2) 缓推，先在 r2-r4 用 infantry 抢完所有可达 supply CP、攒够 60 补给后再 deploy support，组成「heavy+support+2 infantry」集群再向中心蠕动。

---

## 关键时间线

> 行动点本局 `actionsPerTurn`=4；补给格式"前→后"。坐标均以我方视角。

| 整轮/席位回合 | 补给/行动点 | 我的操作 | 对手响应 | 问题或收益 |
|---|---|---|---|---|
| 第1轮 / `player_d` | 45→0 / 1-4/4 | move infA(5,0)→(3,0)占 supply_east(seq8,capture seq12)；move infB(5,-1)→(3,-2)(seq9)；move heavy(4,1)→(2,1)(seq10)；deploy infantry@(3,1) cost45(seq11) | `player_c`/`player_b` 各占1个 supply | ✅ 经济开局正确，supply_east 全局保住(+8/轮×11) |
| 第2轮 / `player_d` | 20→20 / 1-3/4 | move infB→(2,0)(seq58)；move heavy(2,1)→(0,1)中心(seq59)；move deployed inf(3,1)→(1,0)(seq60) | `player_b`/`player_e` heavy 向中心推进 | ❌ **致命决策**：heavy 进(0,1)入双 heavy 夹击区 |
| 第3轮 / `player_d` | 40→40 / 1-3/4 | move infB(2,0)→(5,-1)保命(seq99)；move deployed(1,0)→(1,-1)(seq100)；attack heavy→player_b heavy(0,2) dmg26→124(seq101) | `player_b`/`player_e` heavy 双向打我 heavy | ❌ heavy 已被困，只能原地反击；adjudication 430 垫底 |
| 第4轮 / `player_d` | 60→60 / 1-4/4 | move infA(3,0)→(4,0)保命(seq146)；move deployed(1,-1)→(2,0)(seq147)；move infB(5,-1)→(4,-2)(seq148)；attack heavy→player_b heavy dmg27→97(seq149) | `player_c` 5单位集群压我东侧 | heavy 86hp，infA/infB 各 76hp，全队承伤严重 |
| 第5轮 / `player_d` | 80→20 / 1-4/4 | deploy support@(4,1) cost60(seq190)；attack heavy→player_b heavy dmg23→74(seq191)；move infB→(5,-3)(seq192)；move deployed→(3,0)(seq193) | heavy 21hp 濒死；炮火 r5 首次收缩 6→5 | ✅ support 落地(未来治疗基础)；❌ heavy 21hp 已无法挽救 |
| 第6轮 / `player_d` | 40→40 / 1-3/4 | move support(4,1)→(3,1)内移(seq235)；move infB(5,-3)→(4,-1)(seq236)；move deployed(3,0)→(3,-1)(seq237) | heavy 阵亡(0,1)；炮火 r6 warning | ❌ heavy 损失确认；r6 仅撤退无 merit，actionScore 仍 190 垫底 |
| 第7轮 / `player_d` | 60→60 / 1-4/4 | heal support→infA amt24→100(seq279)；attack deployed→player_c inf(2,-2) dmg22→45(seq280)；move infB→(2,-1)(seq281)；attack infB→player_b heavy(1,0) dmg19→27(seq282) | 各方互相打架，**几乎未反击我** | ✅ 转折：发现敌人 AI 不优先报复，可激进打 merit；本轮+6 merit |
| 第8轮 / `player_d` | 80→80 / 1-4/4 | move support(3,1)→(3,0)(seq329)；heal support→deployed amt22→100(seq330)；move deployed(3,-1)→(2,0)(seq331)；attack deployed→player_b inf(1,1) dmg20→80(seq332)；attack infB→player_c inf(2,-2) dmg19→26(seq333) | 继续互不报复 | ✅ move-then-heal 验证可行；actionScore 追到 230 |
| 第9轮 / `player_d` | 100→100 / 1-3/4 | attack infB→player_c inf(1,-2) dmg23→3(seq387)；attack deployed→player_b inf(1,1) dmg25→55(seq388)；move infA(4,0)→(3,1)离 danger(seq389) | 炮火 r9 收缩 4→3；infA 在(4,0)吃25炮火 100→75 | ⚠️ infA(3,1) 实为 dist4 仍在 danger，后续持续吃炮火 |
| 第10轮 / `player_d` | 120→120 / 1-4/4 | attack deployed→player_b inf(1,0) dmg22→78(seq432)；attack infB→player_c inf(3,-2) dmg24→18(seq433)；attack infA→player_b inf(2,1) dmg22→33(seq434)；move support(3,0)→(3,-1)(seq435) | infA 在(3,1)吃25炮火 75→50 | ✅ 全 AP 打攻击，merit 持续追分 |
| 第11轮 / `player_d` | 140→140 / 1-4/4 | attack deployed→player_b inf(2,1) dmg19→**0 击杀**(seq490)；attack infB→player_c inf(3,-2) dmg22→3(seq492)；attack infA→player_b inf(2,2) dmg20→5(seq493)；attack support→player_c inf(3,-2) dmg5→**0 击杀**(seq494) | infA 在(3,1)吃25炮火 50→25；support 在(3,-1)吃25→9 | ✅ **单轮2击杀+8 merit**；但 infA/support 已濒死 |
| 第12轮 / `player_d` | 160→160 / 1-2/4 | attack infB→player_c inf(2,-2) dmg21→34(seq544)；attack deployed→player_b inf(1,0) dmg20→25(seq545) | infA 在(3,1)吃25炮火阵亡(cause=artillery)；support 9hp | 末轮2攻击+4 merit；裁决第4 |

---

## 补给与分数账本

**实际情况:**
- 部署：2 次 — r1 infantry@45(seq11)、r5 support@60(seq190)，共花 105 补给，无折扣（forward_base deployDiscount=0）
- 收入：11 次 income，每次 base8+cp_east4+supply_east8 = 20，共 220 补给（r1-r11 整轮开始时结算）
- 起始 supplies 45；总获得 45+220=265；花费 105；最终 160（与 `game_over` scores.supplies=160 吻合）
- attack 18 次、heal 2 次、move 14 次、deploy 2 次；actionPointsUsed 累计 40（与 stats 吻合）
- 最终六项裁决分（取自 `game_over.payload.rankings`）：
  - headquartersDamage=0（权重0，不适用无HQ）
  - ownHqHp=0（权重0，不适用无HQ）
  - controlPoints=2（权重0，不构成裁决分）
  - armyValue=57（权重2 → 114）
  - supplies=160（权重0，不构成裁决分）
  - actionScore=370（已乘 effectiveActions=10）
  - **总分 = 114 + 370 = 484**
- 炮火承伤：6 次 artillery_damage 命中我方单位 — infA(dd6f7a31) 在(4,0)/(3,1) 共吃4次25=100伤致死(cause=artillery)；support(0f9c86cb) 在(3,-1) 吃2次25→9hp

**正确策略估算（假设不犯 r2 重装冒进错误）:**
- r2 heavy 沿(2,1)→(2,2)缓推，r3-r4 与 player_b heavy 在(1,2)/(2,2) 线对峙而非被双向夹击；heavy 可保 100+ hp 到中盘，armyValue 多保留约 60 分（92-cost×hp/150 估算）
- r2-r4 每轮可多打 1-2 次安全攻击（heavy atk38 不暴露），actionScore 估计多 60-80
- 预期总分约 484+120 ≈ 600+，可与 player_c/player_b 争第2-3名
- 假设前提：敌人 AI 不优先报复的行为模式持续成立（本局 r7-r12 验证了这点）；若对手换更激进模型则需重新评估

---

## 经验教训

### ✅ 做得好的
1. **r7 后识破"敌人不优先报复"并转为激进打 merit**：r7-r12 连续 8 轮每轮 2-4 次攻击/治疗，从 r6 的 190 actionScore 追到最终 370，单 r11 一轮+8 merit+2击杀。事件依据：r8 seq329-333 连做 move+heal+move+attack+attack 五动作零承伤，r7-r12 我方 18 次攻击中对方直接报复我的次数极少（unit_death 里我方只有 heavy r6 死 + infA r12 炮火死，均非被反击致死）。
2. **r1 经济开局 + supply_east 全局保住**：supply_east(3,0) 从 r1 占领到终局未被夺，贡献 11×8=88 补给收入。cp_east 也保住（部署点）。两个 CP 一直为我提供 20/轮收入基础。
3. **r5 部署 support 的决策正确**：support 后续 r7/r8 治疗 2 次共 +46hp（+4 merit），且 r11 用 support 完成第2个击杀（atk10 打 5hp 残血）。60 补给花的值。
4. **r9-r12 持续向中心内移躲避炮火**：artillery 收缩时间线判断正确，infB/deployed inf 始终保持在 dist≤2 安全区，未吃炮火。

### ❌ 致命失误
1. **r2 重装孤军深入(0,1)中心绞肉机**（详见"核心教训"）—— 直接损失 92 armyValue + 前期 4 轮被动，是垫底到 r6 的根因。
2. **多次算错 hex 距离的 s 项**：hex 距离 = max(|dq|,|dr|,|dq+dr|)，第三项 dq+dr 是 s 坐标差，我 r3/r8/r9/r10/r12 至少 5 次因漏算 s 项导致 move `target_not_reachable` 或 attack `out of range`，浪费 AP（如 r8 seq 中 deployed inf 本想打(2,-2)却因(3,-1)到(2,-2)实为距离2而失败，临时改打(1,0)）。每浪费 1 AP ≈ 损失 10 actionScore 潜力。
3. **r9 infA 移到(3,1)误判为安全**：(3,1) 的 s=-4，max(3,1,4)=4，仍是 dist4 danger 区（r9 safeRadius=3）。导致 infA 连吃 4 次 25 炮火致死。应移到(2,0)/(3,0)等 dist≤3 格。
4. **r6 全撤退无 merit**：r6 仅 3 次 move 0 攻击，整轮 actionScore 停滞。即便保命也应用满 4 AP 打至少 1 次安全攻击/治疗赚 merit。

### 🔑 核心教训
> **"歼灭模式重装是行走的 92 分，绝不裸奔进多方火力交集的中心；先组 support+步兵集群再向内蠕动，全程每 AP 都换 merit。"**

---

## 与历史对局的共同教训

1. **重装冒进中心被集火** —— 与 V3 历史多局（如 tg_0034_rank02_WB@hy3 等 WB 系复盘）反复出现的"重型单位过早暴露"教训一致，本局再次重犯。需在 skill 决策树里加硬约束：annihilation 模式 heavy 移动目标必须满足"不在 ≥2 个敌方 heavy 的 reach 范围内"。
2. **本局新发现：artillery 每轮只缩 1（6→5→4→3→2）而非 -2**。skill 文档与之前记忆都按"6→4→2 三级跳"理解，实际是 4 次收缩每次 -1。这意味着 warning 区比想象的大、撤离窗口更早（r4 就要开始向 dist≤5 收），且最终 safeRadius=2 时 dist3 也会变 danger（r11 infA 在 dist3 的(3,1) 就是误判）。
3. **敌人 AI 不优先报复是可利用的稳定模式**：r7-r12 我连续打多个不同对手，对方下回合几乎不反击我（都在互打）。这印证了 annihilation 6 人局"谁先暴露谁挨打、低调打 merit 最安全"的判断。但需注意：本局对手多为 OMP/CP 系模型，若换更激进的模型（如 WB@hy3 自己）该假设可能失效。

---

## 下次的正确策略

```text
第1轮 / player_d: move infA(5,0)→(3,0)占 supply_east；move infB(5,-1)→(3,-2)；move heavy(4,1)→(2,1)【不进中心】；deploy infantry@(3,1) from cp_east cost45
第2轮 / player_d: heavy 沿(2,1)→(2,2)缓推，绝不进(0,1)/(1,1)；infB/deployed 向 supply_northeast(3,-3) 方向探，能抢则抢；攒补给准备 r3-r4 deploy support
中盘触发条件:
  - artillery warning 出现(r4)→立即把所有 dist=safeRadius+1 的单位内移1格
  - heavy HP<60 且无 support 在邻接 → 撤退向己方 CP 方向
  - adjudication actionScore 落后第一名>80 → 转激进：每 AP 必打攻击/治疗/部署，禁止纯 move 闲置
  - 发现某敌方 heavy HP<40 → 集火补刀（kill 的 merit 与 armyValue 双收益最高）
终局检查:
  - 存活资格（最后单位别裸奔进 danger）
  - armyValue×2 + actionScore 两项实算；controlPoints/supplies/HQ 权重0别浪费时间刷
  - 主要竞争者分差：本局第4与第3差54分≈3次攻击的 merit，激进打满 AP 完全可追
  - safeRadius=2 阶段(dist≤2才安全)：所有单位必须挤进(0,0)/(1,0)/(0,1)/(1,-1)/(2,0)/(0,-2)/(1,1) 等中心7格，否则吃25/轮炮火
```

---

**一句话总结：重装裸奔进中心绞肉机是本局垫底的根因，后期识破"敌人不报复"激进打 merit 把第6追到第4，但 armyValue+actionScore 双落后已无力回天——歼灭模式 heavy 就是行走的 92 分，必须集群行动、绝不裸奔、每 AP 换 merit。**
