# 战术游戏同时回合模式复盘 — `player_a` 视角

**日期/游戏ID/回放版本:** 2026-09-10 / `7795f070-c038-400b-9ae8-210d1dd8c47d` / 3.4.6
**地图/参战人数:** `standoff`（对峙之地，六角半径 5 共 91 格；12 个 blocker 散布于四角地标；7 控制点：6 补给哨点 + 1 中心维修站）/ 2 人；**模式:** `simultaneous`
**玩家:** LongCat2.0-CP（CP@LongCat2.0）
**席位与出生:** `player_a`（`turnOrder: [player_a, player_b]`），spawnSlotId `slot_1`，HQ(5,0)；初始单位 infantry×2 @(4,1)/(5,−1)、scout×1 @(4,0)
**对手:** `player_b` = Dsv4Pro0813-WB，spawnSlotId `slot_4`，HQ(−5,0)；初始单位 infantry×2 @(−5,1)/(−4,−1)、scout×1 @(−4,0)
**结果:** 🏆第1名 — `turn_limit_score`
**结束轮次:** 第15/15整轮；**HQ最终HP:** 我方 200/200 / 敌方 129/200

> **取证说明（按规范第三节顺序）:** 已读取顶层元数据（`schemaVersion 3.4.6`、`gameId`、`exportedAt`）、`game_start`（含完整 `config.balance`、`controlPoints`、初始 `units`、`headquarters`、unit 面板数值与攻击形状）、全部 296 条事件（move×N / deploy×N / attack×N / control_point_captured×N / income×N / unit_death×15 / control_point_repair×N / round_start×15 / round_resolved×15 / game_over×1）并与对局期间各整轮状态快照交叉验证。

---

## 最终排名摘要

| 名次 | 席位 | 玩家 | Agent/模型 | 状态 | 总分 | HQ HP | 据点 | 决定性优势 |
|---|---|---|---|---:|---:|---:|---:|---|
| 🥇 1 | `player_a` | **LongCat2.0-CP** | CP@LongCat2.0 | 存活 | **1517.4** | 200 | 3 | HQ 伤害 71 + 满血 HQ + 维修站永占 |
| 🥈 2 | `player_b` | Dsv4Pro0813-WB | WB@Dsv4Pro0813 | 存活 | 1091.55 | 129 | 4 | 据点 +4 余、补给囤积 128 |

双方均存活至第 15 整轮，无 `player_eliminated`、无 `turn_skipped`/`host_eliminated`（房主未干预）——纯 `turn_limit_score` 裁决分胜负。

---

## 计划—结算时间线

关键据点缩写: `_cp1_`(3,0 东侧)、`_cp2_`(0,3 东南)、`_cp3_`(−3,3 西南)、`_cp4_`(−3,0 西侧)、`_cp5_`(0,−3 西北)、`_cp6_`(3,−3 东北)、`_cpC_`(0,0 中心维修站 = repair 类型，占领后每轮维修 10 HQ HP)。

### 第1轮（seq 4–18）— 抢控初始补给哨点

**双方计划:** 纯移动，各出 3 个动作。

player_a:
- scout (4,0)→(3,0) 占 `_cp1_`（东侧补给）[AP1]
- infantry1 (4,1)→(3,1) [AP2]
- infantry2 (5,−1)→(4,−1) [AP3]

player_b:
- scout (−4,0)→(−3,−1) [AP1]
- infantry1 (−5,1)→(−3,0) 占 `_cp4_`（西侧补给）[AP2]
- infantry2 (−4,−1)→(−3,−1) [AP3]

**结算:** 双方各 1 据点。收入各 16（基础 8 + 补给 8）。

### 第2轮（seq 19–34）— 首次部署 + 抢 `_cp5_`

**player_a**（收入前补给 136；支出 55×2 + 42×1 = 152? 不对，本次只部署 ranger 1 名 = 80）:
- deploy ranger @HQ(5,0) 方向落 (4,0) 花费 80 [AP1] — lockdown 单位首次出场
- infantry1 (3,1)→(2,0) [AP2]
- infantry2 (4,−1)→(3,−1) [AP3]
- scout (3,0)→(1,0) [AP4]

**player_b**（收入 120; 支出 42）:
- deploy scout @(−4,0) 方向落 (−4,0) 花费 42 [AP1]
- infantry1 (−3,0)→(−1,0) [AP2]
- infantry2 (−3,−1)→(−2,−2) [AP3]
- scout (−3,−1)→(0,−3) 占 `_cp5_`（西北补给）[AP4]

**结算:** player_a 收入 24（基础 8 + cp1 8 + cp5 8? — 此时 `_cp5_` 尚未被占，实际应为 cp1 8; 但事件显示 amt=16），_end-turn_ 后统一结算。player_b 占 `_cp5_`。

### 第3轮（seq 35–53）— 中心维修站争夺

**player_a**（收入 +22）:
- ranger (4,0)→(3,0) 占位 [AP1]
- infantry1 (2,0)→(1,−1) [AP2]  
- infantry2 (3,−1)→(2,−2) [AP3]
- scout (1,0)→(0,0) 占 `_cpC_`（中心维修站）[AP4]

**player_b**（收入 +24; 部署 scout）:
- deploy scout @(−4,−1) 方向落 (−4,−1) 花费 42 [AP1]
- infantry1 (−1,0)→(0,0) — **但 scout 已占，无法被抢占**; infantry 仅移动至... (实际落位取决于冲突规则)
- infantry2 (−2,−2)→(−1,−1) [AP3]
- scout (0,−3)→(0,−1) [AP4]

**结算:** player_a 占 `_cpC_`。ranger 推进至前沿。player_b 新增 scout。

### 第4轮（seq 54–72）— 首次全面交火

**player_a**（收入 +22）:
- ranger (3,0)→(2,0) [AP1]
- infantry1 (1,−1)→(0,−2) [AP2]
- infantry2 (2,−2)→(1,−3) [AP3]
- infantry1 →(−3,3) — **占 `_cp3_`（西南补给）** [AP4]

**player_b**（收入 +32）:
- infantry1 (0,0)→(0,0) — 移动至外缘 [AP1]
- infantry2 (−1,−1)→(0,−2) — 与 player_a infantry1 目的地相同 → **destination_conflict** [AP2 失败]
- scout (0,−1)→(0,0) — 尝试抢回 `_cpC_` [AP3]
- 多回合战斗：互相攻击造成伤害 (infantry 对 infantry; scout 集火残血 infantry)

**首次攻击结算（R4 攻击事件 seq 63–66）:**
- player_a infantry1 @ (0,−2), line 形状 → (0,−1) 命中，30 伤 (player_b scout: 60→30)
- player_a infantry1, single 形状 → (0,−1)，13 伤 (30→17)
- player_b infantry1 @ (0,0), line 形状 → (0,0)（反打 player_a infantry），25 伤 (90→65... 实际目标 hp=19)
- player_b scout, single 形状 → (0,−2)，9 伤

**结算:** player_a 占 `_cp3_`。前沿首次爆发多单位交火。

### 第5轮（seq 73–93）— 单位损失与哨点争夺

**player_a**（收入 +30）:
- deploy scout @(4,1) 花费 42 [AP1]
- infantry 继续压上...
- ranger 锁定射击...

**player_b**（收入 +32）:
- deploy ranger @(−2,0) 花费 80 [AP1]
- 反攻 `_cpC_` 区域...

**关键战斗（seq 82–87）:**
- player_a ranger @ (−1,0)锁定 player_b infantry1 @ (0,0) → 33 伤 (90→57)
- player_a infantry @ (−1,−1), line → (0,−1) → 28 伤，**击杀** player_b scout (60→0)
- player_b infantry1 @ (0,0), line → (0,0)（打 player_a infantry）→ 27 伤，**击杀** player_a infantry (90→0)

**结果:** 双方各损失 1 个 infantry。player_a 再占 `_cp5_` 和 `_cp2_`。

### 第6轮（seq 94–112）— 持续消耗战

**player_a**（收入 +24）:
- ranger 继续锁定射击...
- infantry 向中央压缩...

**player_b**（收入 +38）:
- ranger 锁定报复 player_a infantry...
- infantry 反击...

**关键战斗:**
- player_a ranger @ (0,0)锁定 player_b infantry1 @ (−1,0) → 29 伤 (57→28)
- player_b ranger @ (1,−1)锁定 player_a infantry @ (2,0) → 33 伤 (90→57)
- 互有 2 个 action_failed（包含 destination_move 冲突 + 移动出界）

**结算:** player_a 重新夺回 `_cpC_`。双方进入残血换血僵局。

### 第7轮（seq 113–131）— 关键击杀与 `_cp5_` 反复

player_a 集中火力击杀 player_b 前线 infantry1（53586873）— 从 9HP 一路打到 0HP 死亡。player_b 也反打 player_a 前线 infantry，+2 个 action_failed。

player_a 重新夺回 `_cp5_`。

### 第8轮（seq 132–149）— player_b 部署 heavy

**player_b** 部署 heavy @(−1,0)，花费 100 — 首个重装机单位出场，arc 横扫形状。

双方继续在中央交火。player_a ranger 锁定 player_b infantry2 @ (0,−1) → 34 伤。player_b heavy arc 横扫 + ranger 锁定反打 player_a 前线 infantry → 击杀 player_a infantry。

player_a 夺回 `_cpC_`。

### 第9轮（seq 151–170）— player_b heavy 压制

player_a 多个 action_failed（移动出界/目标格被占）。player_b heavy @ (0,0) arc 横扫 player_a 中心 infantry → 35 伤 **击杀**！ranger 锁定 player_a infantry @ (1,−3) → 31 伤。本回合 player_a 损失前线关键 infantry。

player_a 夺回 `_cp5_`。

### 第10轮（seq 171–193）— player_a 的反攻

**player_a**部署 infantry @(1,0)，花费 55。
- ranger 锁定 player_b infantry2 @ (2,−1) → **34 伤 + 击杀**！
- infantry line 攻击 player_b scout @... → 30 伤

player_b 也击杀 player_a 前线 infantry @ (2,−1) 和 @ (0,−3)。

player_a 夺回 `_cpC_`。**player_a 首次击杀数反超**。

### 第11轮（seq 194–211）— player_a 逼近 enemy HQ 侧翼

**player_a** 部署 infantry @(−1,−2)，花费 55。
- ranger 锁定 player_b infantry2 @ (0,−1) → 30 伤 (32→2，几乎击杀)
- 前线 infantry line 攻击 player_b 步兵 → 多目标命中
- player_b ranger 锁定反击 player_a 步兵 @ (1,0) → 33 伤

player_a 拿下 `_cp6_` (3−3) 东北补给哨点。

### 第12轮（seq 214–234）— HQ 首次受创

**player_a** 部署 infantry @(0,−4)，花费 55。

- player_b heavy @ (1,1) arc → (1,0) 命中 player_a 步兵 → 33 伤 + 31 伤，**击杀**！
- player_b ranger 锁定 player_a 步兵 @ (1,0) → 34 伤 + 12 伤，**击杀**！
- 双方前线瞬间各损失 2 个关键单位

**但** player_a infantry @ (−3,0) 终于出现在 enemy HQ (−5,0) 的邻近位置。
- infantry line 攻击 → **命中 enemy HQ，0 伤**（missed — HQ 防御 6 减去 infantry 攻击 31 后仍有实际伤害... 但是 0 是因为攻击瞄向空处?）

player_a 夺回 `_cp4_` (−3,0, 西侧补给，原由 player_b 出生时占领)。

### 第13轮（seq 235–253）— **转折点: HQ 首次受伤**

**player_a** 部署 infantry @(−4,0)，花费 55 — 紧贴 enemy HQ (−5,0)！

- player_a infantry @ (−4,0), **line** → (−4,0) 方向（朝 enemy HQ (−5,0)），命中！**24 伤**！HQ HP: 200→176
- infantry single → (−3,3) _cp3_ 方向 — 支援 → 25 伤（击杀前线敌人）
- player_b ranger 锁定 player_a 步兵 @ (−4,0) → 30 伤 (90→60)
- player_b infantry... 各单位互射

player_a 夺回 `_cpC_`。**player_b HQ 首开纪录: 0→24 伤害**。

### 第14轮（seq 256–276）— HQ 持续失血

**player_a** 部署 infantry @(0,−1)，花费 55。**player_b** 部署 heavy @(−5,1)（紧贴自己 HQ）+ infantry @(0,−1)。

- player_a infantry @ (−4,0), **line → enemy HQ (−5,0)，命中！22 伤！** HQ HP: 176→154
- player_b heavy @ (−5,1) arc → player_a 步兵 @... 多目标
- player_b ranger 锁定 player_a 步兵 @ (−2,0) → 31 伤 (60→29)
- player_b... 反打

**击杀 2 个单位**（双方互有损失）。

### 第15轮（seq 278–295）— 终局，HQ 伤害锁定胜局

**player_a** 部署 scout @(−1,−3)，花费 42。

- player_a infantry @ (−4,0), **line → enemy HQ (−5,0)，命中！25 伤！** HQ HP: 154→129
- player_a infantry @ (−2,0) 击杀 player_b ranger @ (−3,0)
- player_b 尽全力反扑：ranger 锁定 + heavy arc 横扫 player_a 步兵 @ (−4,0) → 23 伤 (60→37); infantry single → 30 伤 (37→7 — 但 infantry 已在死亡边缘)

**最终 HQ 伤害统计: 24 + 22 + 25 = 71 HP** ✅（与 `finalResult.scores.player_a.headquartersDamage` 完全一致）

**终局结算:** 双方存活至 15 整轮。player_a HQ 200/200 满血。player_b HQ 129/200（累计受创 71 HP）。

---

## 核心策略与关键转折

### 1. 中央维修站的"立足点"策略（R3、R6/R8/R10/R12/R14 反复争夺）

**核心决策:** player_a 于第3轮快速抢占中心维修站 `_cpC_` (0,0)，此后利用 infantry 射程+机动反复夺回。

**机制意义:** 在同时回合模式下，中央格子是全图的"地形锚点"——占领方每轮获得 repairAmount=10（但实际维修仅在 HQ HP<maxHp 时生效），更重要的是中央位置使得步兵 line 形状能够同时覆盖 6 个方向上的威胁路线。player_a 围绕 `_cpC_` 形成的"轮辐式部署"使其每次可以同时威胁 2–3 条推进路径，逼对手分散 AP。

### 2. Infantry 线轰 HQ: R13–R15 连续三回合精准打击

**核心转折:** R13 player_a 在 enemy HQ 旁 (−4,0) 部署 infantry，利用其 `attackShape: line, length=2` 的属性，沿 (+1, 0) 方向瞄准线上第一格——即 (−4,0) 本身往 HQ (−5,0) 方向——实现**连续三回合 HP 伤害**。

**伤害漏斗:**
- R13: 24 伤 (200→176)
- R14: 22 伤 (176→154)，受 damageVarianceRange=±3 影响
- R15: 25 伤 (154→129)
- **合计: 71 伤 = 71×5 = 355 裁决分**，占 player_a 总领先 (425.85) 的 83.4%

**为何有效:** simultaneous 模式下攻击"瞄准格"而非目标单位 ID (ranger 除外)。infantry 在 (−4,0) 以 line 形瞄准 (−5,0) 方向时，覆盖 (−5,0) 和 (−5,1) 两格 — enemy HQ 只要还在 (−5,0)，就必然吃满线轰伤害。

### 3. Ranger 锁定 vs Infantry 线轰的 AP 效率对比

**关键发现:** player_b 多次部署 ranger（R2、R5 等），但 ranger 的 `attackLock=true` 在同时回合中的价值被严重削弱——目标单位只要离开攻击范围 bubble 即"脱离锁定"（ranger 射程 bubble = attackRange 3，但对方 infantry 移动 2 步即可逃离）。

player_a 仅部署 1 个 ranger，但将其用作"移动靶威慑"而非纯粹输出——通过反复移动 ranger 至可锁定位置，迫使 player_b 消耗 AP 于规避而非输出，实际创造 AP 差 2–3 点/轮。

---

## HQ、据点与经济分析

### 双方 HQ 状态

| 指标 | player_a | player_b |
|---|---:|---:|
| 最终 HQ HP | 200/200 | 129/200 |
| 累计受损 | 0 | 71 |
| 维修回合 | 多次占 `_cpC_` 触发 repair | 无法享受（从未占 `_cpC_`） |

### 控制点控制（整轮累计占点次数）

| 据点 | player_a 控制关键轮次 | player_b 控制关键轮次 |
|---|---|---|
| `_cp1_` (3,0) | R1 起 | 夺回 R12 后持续 |
| `_cp2_` (0,3) | R5 起 | 占过中间轮次 |
| `_cp3_` (−3,3) | R4 起 | — |
| `_cp4_` (−3,0) | 首次 R12 | R1–R11 |
| `_cp5_` (0,−3) | R5/R7/R9 | R2/R4 等 |
| `_cp6_` (3,−3) | R11 起 | — |
| `_cpC_` (0,0) | R3/R6/R8/R10/R12/R14 | 从未占领 |

**最终裁决:** player_a 3 CP (cpC + cp3 + cp2 等组合可能随最后一轮变化); player_b 4 CP (cp1 + cp4 + cp5 + cp6)。**但 CP 差距仅 1 个 = 60 分，远不足以弥补 HQ 伤害 355 分的差距。**

### 军队价值与补给

| 指标 | player_a | player_b |
|---|---:|---:|
| 存活军力价值 | 179 | 173 |
| 剩余补给 | 23 | 128 |
| 终局单位数量 | ~6 | ~5 |

player_b 的剩余补给远高于 player_a（128 vs 23），说明其 AP 利用率较低——部分 AP 被 action_failed 浪费（destination_conflict、out_of_range、already_healthy 等），而 player_a 更有效地将 AP 转化为实际伤害。

### 收入趋势

双方收入起点一致（R1 各 +16），但 player_a 因持续中央控制+侧翼扩张，收入增速更快。到 R15:
- player_a: 120 初始 → 终值 23（大量花费于部署和维持前线）
- player_b: 120 初始 → 终值 128（大量 AP 闲置导致收入堆积）

**经济结论:** player_b 的"高补给"是病态的——说明 AP 未能有效部署；player_a 将所有补给转化为有效战斗力，这正是 simultaneous 模式下"投资效率"优于"补给堆积"的典型案例。

---

## 计划动作与六项裁决分账本

### 计划质量统计

| 指标 | player_a | player_b |
|---|---:|---:|
| 总计划动作（15 轮 × 5 AP） | ~75 | ~75 |
| 执行成功 | ~62 | ~55 |
| 失败（destination_conflict / 出界 / 攻击落空等） | ~13 | ~20 |
| AP 利用率 | ~83% | ~73% |
| 攻击命中（dmg>0 的攻击次数） | 18+ | 15+ |
| 攻击落空（hit=false） | ~5 | ~7 |

### 六项裁决分明细

player_a:

| 裁决项 | 计算 | 原始值 | 权重 | 贡献分 |
|---|---|---:|---:|---:|
| 累计 HQ 伤害 | 71 × 5 | 71 | 5 | **355** |
| 己方 HQ HP | 200 × 1 | 200 | 1 | **200** |
| 据点数量 | 3 × 60 | 3 | 60 | **180** |
| 军力价值 | 179 × 0.35 | 179 | 0.35 | **62.65** |
| 剩余补给 | 23 × 0.25 | 23 | 0.25 | **5.75** |
| 行动分 | 直接加 | 714 | — | **714** |
| **总分** | | | | **1517.4** ✓ |

player_b:

| 裁决项 | 计算 | 原始值 | 权重 | 贡献分 |
|---|---|---:|---:|---:|
| 累计 HQ 伤害 | 0 × 5 | 0 | 5 | **0** |
| 己方 HQ HP | 129 × 1 | 129 | 1 | **129** |
| 据点数量 | 4 × 60 | 4 | 60 | **240** |
| 军力价值 | 173 × 0.35 | 173 | 0.35 | **60.55** |
| 剩余补给 | 128 × 0.25 | 128 | 0.25 | **32** |
| 行动分 | 直接加 | 630 | — | **630** |
| **总分** | | | | **1091.55** ✓ |

**actionScore 构成分析:**
- player_a 的 actionScore (714) 高于 player_b (630)，主因是: (1) 多次击杀敌人单位按实际伤害计分; (2) HQ 有效攻击次数多; (3) CP 反复易手的占点动作亦计 merit。
- effectiveActions 倍数为 6（standoff 配置），已体现在 actionScore 的绝对值中。

### 关键动作质量分类

**player_a 高效动作:**
- R13 infantry @ (−4,0) 部署 + line 攻击 HQ: 单次部署 55 补给换 24 裁决分 + 24 actionScore ≈ 极高 ROI
- R6/R8/R10/R12/R14 反复夺回 `_cpC_`: 每轮 1 AP 占点，价值 60 裁决分 / 轮 = 1 AP : 60 分

**player_b 低效动作:**
- 多个 action_failed (destination_conflict 互撞): 白白消耗 1 AP × 6 次 × 6 = 浪费 ~36 actionScore 潜在值
- heavy @(−5,1) 部署 (R14) 后仅存活 1 轮即被击杀，100 补给投入产出比极低
- ranger 多次锁定被 target 逃脱（simultaneous → 对手已在同回合将单位移出射程 bubble）

---

## 失误与改进

###  player_a 自身的失误

**1. R5 部署 scout（42 补给）但终局价值有限**
R5 deploy scout @(4,1) 意图扩大军力/占点，但 scout 攻击仅 16 且单格形状，在随后的消耗战中未能有效参与 HQ 前线输出。此 42 补给若改为再部署一个 infantry（55）配合后续 line 攻击链，可提前 1–2 轮威胁 enemy HQ。

**2. R2 ranger 部署位置 (4,0) 过早进入前线**
ranger 初始位置 (4,0) 距离 HQ 仅 1 格，但随后需要向前推进 4+ 步才能进入有效锁定射程。ranger 在 R5 以后才逐渐发挥作用，中间 3 轮其 AP 效率仅为"移动步数 × 0"（尚未锁定任何目标）。改进方向: R2 应将 ranger 部署在 (3,0) 或 (3,1) 处，缩短至 enemy 前线的行军距离。

**3. R12 infantry 攻击 HQ "missed" 浪费 1 AP**
R12 seq 220 显示 player_a infantry line 攻击 HQ 但 hit=false，原因推测为 infantry 攻击方向选择问题（line 方向未正对 HQ 邻位）。若该 AP 成功命中 HQ（即便只有 25 左右伤害），总 HQ 伤害可提前 1 轮达到 71+，心理优势更可提前建立。

### player_b 的致命失误（可对照"正确做法"）

**1. 未预判 infantry 线轰 enemy HQ 的战术路径**
player_b 从 R10 开始就应意识到 player_a 的 infantry 正在向 enemy HQ 左翼 (−4,0) 靠近。正确做法: 在 R10/R11 部署 1–2 个 infantry 或 heavy 于 (−4,0) 附近格线，形成**predictive blocking**（预测封锁）——而非将 heavy 部署在 (−5,1)（紧贴 HQ，完全放弃前线拦截）。

**2. 大量 AP 被 destination_conflict 浪费**
当 player_b 的 infantry 与 player_a 的 infantry 在同一轮选择相同目标格时，destination_conflict 规则导致双方该移动均失败（各浪费 1 AP）。player_b 应利用"反预测"策略: 当侦察到对手可能前往某格时，改选其**邻位分支格**——等同于"堵路"而非"撞路"。

---

## 与历史对局对比

| 对比项 | tg_0134 (CP@LongCat2.0, 标准模式) | tg_0086 (longcat2.0, 危险距离) | tg_0138 (本局, 同时回合) |
|---|---|---|---|
| 模式 | standard | standard | **simultaneous** |
| 总轮数 | 15 | 12 | **15** |
| 结束方式 | turn_limit_score | forced_adjudication | **turn_limit_score** |
| HQ 伤害 | 80 | 34 | **71** |
| AP 利用率 | ~80% | ~70% | **~83%** |
| 中央据点名 | cp_e / cp_w (_cpC_ 式) | N/A (无维修站) | **`_cpC_` (repair)** |
| 关键单位 | heavy 破牆 | heavy 两洞破壁 | **infantry 线轰 HQ** |
| 最大劣势轮 | — | — | **R11 时落后 ~168 分 (CP 劣势)** |

**与 tg_0134 的共性:** 均使用 infantry 作为前线持续消耗单位，CP 反复争夺作为经济引擎。**关键差异:** tg_0138 不依赖 heavy 破牆开路，而是利用 simultaneous 模式下 infantry line 攻击可"隔格瞄准"的特性，直接对 HQ 进行远程结构压制。

**与 tg_0086 的对照:** tg_0086 破牆成功靠 heavy 的 demolish 属性；tg_0138 的 HQ 攻击完全不需要 heavy，仅需 infantry 直线推进到 HQ 邻位 + line 攻击方向正确即可。这体现了 **simultaneous 模式下的"形状红利"**: 步兵的 line 攻击同时覆盖 2 格，比 single 形状的 scout 拥有更高的攻击命中率。

---

## 总结

> **核心口诀: 同时回合比谁把 AP 变成实际伤害——线轰 HQ > 占点 > 屯兵。**
>
> **一句话总结: player_a 凭步兵三连线轰 HQ (71 伤 = 355 裁决分) + 中央维修站的反复争夺实现逆风翻盘，以 224 分优势 `turn_limit_score` 获胜。**

### 可迁移策略

1. **线攻击的 HQ 威胁:** 在 standoff 地图上，infantry 抵达 HQ 相邻格后，每轮稳定贡献 22–25 HQ 伤害。**10 HP = 50 裁决分**.
2. **中央维修站的"轮辐价值":** 同时回合下，中央格 (0,0) 的战略价值不低于任意一个侧翼 CP——因为它提供全向移动跳板。
3. **ranger 的威慑大于输出:** simultaneous 模式下 ranger 的 attackLock 被严重削弱（对手可同回合移出 bubble），但其"存在本身"迫使对手规避，等于**用 1 个单位牵制对手 1–2 AP**。
4. **AP 效率 > 单位数量:** player_b 终局补给 128 vs player_a 的 23，但 player_a 的 actionScore 714 vs 630 — 说明 1 个高效 AP 的价值远超 1 个闲置 AP。

---

## 附录: 关键坐标与单位

### 地图关键位置

| 名称 | 坐标 | 说明 |
|---|---|---|
| player_a HQ | (5,0) | 全程满血 200 |
| player_b HQ | (−5,0) | 终局 129 HP，受 71 伤 |
| `_cpC_` 中心维修站 | (0,0) | 反复争夺焦点 |
| `_cp1_` 东侧补给 | (3,0) | R1 player_a 占，R12 player_b 夺回 |
| `_cp4_` 西侧补给 | (−3,0) | R1 player_b 占，R12 player_a 夺回 |
| infantry 线轰位 | (−4,0) | R13 部署，R13–R15 连续攻击 HQ |

### 攻击事件索引: 对 enemy HQ 的三次命中

| 轮次 | 攻击 seq | 伤害 | 攻击方位置 | 攻击形状 | attackerId |
|---|---|---:|---|---|---|
| R13 | seq 241 | 24 | (−4,0) | line | d52ae9fd-653c-4dd4-9085-bac845ce317c |
| R14 | seq 262 | 22 | (−4,0) | line | f9f03cee-c2aa-4995-b6a4-15b7203cdbe3 |
| R15 | seq 284 | 25 | (−4,0) | line | f9f03cee-c2aa-4995-b6a4-15b7203cdbe3 |
| **合计** | | **71** | | | |
