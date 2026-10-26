# tg_0239 狭路相逢复盘（royale·narrow-road）

## 0. 局面概要

- **gameId**: `83abdee2-0b32-4048-b0f1-3261c55f3a7a`
- **地图**: 狭路相逢（`narrow-road`），半径 6，2 人狭路对穿
- **模式**: `royale`（同时回合 × 歼灭缩圈组合）
- **人数**: 2
- **我的席位**: `player_b`，玩家名 `GLM5.2-TE`
- **对手**: `player_a`，玩家名 `Dsv4.1Flash1017-DSH`（房主）
- **turnOrder**: `["player_b","player_a"]`（我先手）
- **终局**: 第 15 回合，我被 `army_destroyed` 淘汰（最后一个 scout 在 R15 死于敌方 heavy 攻击），敌方以 `last_player_standing` 获胜，rank 1
- **本局 artillery 配置**: `startRound=10 / intervalRounds=1 / damage=5 / minimumSafeRadius=1`，初始 `safeRadius=6`；中心格 (0,0) 不可通行，最终安全带是 distance≤1 的内圈 6 格中只有 (1,0)/(-1,0) 是 plain，其余 4 个是 blocker
- **本局平衡**: `startingSupplies=20 / baseIncome=5 / actionsPerTurn=5 / damageVarianceRange=0 / maxTurns=null`，单位造价 infantry 5 / scout 4 / support 7 / ranger 9 / heavy 10
- **最终裁决**: 我 total 33（killValue 33），敌方 total 56（armyValue 10 + killValue 46）；HQ/CP/supplies 权重均为 0，**军力价值 + 击杀造价**是真实竞赛

## 1. 结果一句话

我在 R12 把唯一的 ranger 留在 (3,0) 自以为 `distance = safeRadius` 不算 danger，结果 R13 炮火收缩到 `safeRadius=2` 时直接把 ranger 炸死（这一步是真正的胜负手）；之后只剩 1 个 scout 周旋 2 个回合，被敌方 heavy 在 R15 攻击 (-1,0) 预判击杀，我以 33:56 落败。

## 2. 发育窗口（R1-R9，round < startRound）

### 经济与爆兵节奏

- 双方都把 20 起始补给在 R1 一口气花光：我 `heavy(10)+infantry(5)+infantry(5)` 三单位 20 sup，敌方 `heavy(10)+ranger(9)` 两单位 19 sup（留 1 sup）
- 整个发育期（R1-R9）我共部署 8 单位累计 64 sup，敌方共部署 7 单位累计 64 sup — 双方经济完全平手，但敌方每单位平均造价更高（9.1 vs 8.0），单位更"重"
- 双方各累计收入 14 轮 × 5 = 70 sup + 起始 20 = 90 sup 总盘，部署各花 64 sup，留 26 sup（与 `game_over` 记录一致）
- 我倾向 scout/infantry 数量堆叠（共 5 个轻单位），敌方倾向 ranger+heavy 重击组合（共 3 个重单位）

### 据点得失

- **R4 cp_1 被我夺取**: 用 scout `bdd6d456` 从 (0,0) 直推 (-5,0) — 利用了 royale 中"路径只看地形、单位不阻挡"的规则穿过敌方 heavy+ranger 防线。本局最精彩的一步突袭。
- **R5 cp_1 失而复得给敌方**: 敌方 R4 末已在 (-5,1) 部署新 ranger，R5 同回合锁定并击杀我的 scout；cp_1 立刻易主。
- cp_2 在我手里从开局直到 R15 我被淘汰时一并 `control_point_neutralized`，从未被夺。
- cp_1 在敌方手里从 R5 后未再易手 — 我前线一直压不过中线。

### 部署垫状态

我的部署垫 cp_2 保得很稳，但 cp_1 没拿下来导致前线一直压不过中线；敌方 cp_1 同样稳，且 cp_1 距离敌方出生槽 (-6,0)/(6,0) 都只有 1 格，敌方在我 R4 占领期间还能从 cp_1 派新 ranger 反扑，cp_1 的战略价值明显大于 cp_2（更靠中央、更易反推）。

### 接触战

- **R6**: 我用新 ranger (-6,0) 击杀敌方 (-5,0) 步兵（5 sup 入账），但本 ranger 同回合被敌方 (-5,1) ranger 反杀 — 同归于尽，净亏 4 sup
- **R7**: 我的 heavy (1,0) HP 1 被敌方 (-2,0) ranger 锁定击杀；同回合我的 scout 在 (-1,0) 击杀敌方 (-2,0) ranger — 又一个同归于尽
- **R8**: 我的 (-3,0) infantry 被敌方 (-4,0) heavy 击杀 — 我先动了攻击但 (-4,0) 距离 1 在 heavy 射程内，counter 来得太快
- **R9**: 我的 (-1,0) scout 击杀敌方刚移过去的 (-2,0) ranger，本 scout 同时被敌方击杀 — 第三个 mutual kill

四个 mutual kill 让我以小搏小但敌方重单位一直存活，**数量优势无法转化为火力优势**。

## 3. 缩圈期（R10 起）

### R10 — 首次收缩（safeRadius 6→5）+ 我的第一个致命错误

- R9 末 `artillery_warning` 已给出 warning 环（含 (-6,0)、(6,0)、(4,2) 等边缘点）
- R10 safeRadius=5，所有 pad (distance=5) 仍在安全区（按"distance > safeRadius"判定）
- **错误 #1**: 我把新 ranger 部署到 **(4,1)** — 这是 warning 格（next shrink 后变 danger）。Ranger HP 仅 3，damage 5，下回合必死。**9 sup 直接送。**
- 同回合敌方把 support 部署到 (-4,-1) — 也是 warning 格，但敌方 support HP 8，被炸 5 dmg 后还剩 3 HP 存活。同样的位置选择，敌方选了能扛的 HP 8 单位，我选了 HP 3 的 ranger — 兵种选错。

### R11 — safeRadius 5→4

- 炮火炸死我的新 ranger (4,1)（HP 3→0，无 killValue 归属）
- 敌方 (-5,0) 步兵 (HP 9→4)、(-4,-1) support (HP 8→3) 各受 5 dmg 但存活
- 我同时通过 attackLock 击杀了敌方 (0,0) heavy（最后一击 10 sup 入 killValue）
- 这一回合双方各损失 1 unit；敌方 heavy 死亡使其在中央只剩 (-3,0) heavy

### R12 — safeRadius 4→3 + 我的第二个致命错误

- 炮火炸死 3 个敌方单位：(-5,0) infantry (HP 4→0)、(-4,0) ranger (HP 3→0)、(-4,-1) support (HP 3→0) — 敌方累计 5+9+7=21 sup 价值损失（炮火击杀无人入 killValue）
- **错误 #2**: 同回合敌方 heavy 从 (-3,0) 偷偷移到 (0,0)；我 13 点伤害的合击（ranger 7 + 2 infantry × 3 = 13）锁定 (0,0) 的"plan-time 重型"——但敌方 step 1 已 move 走，attackLock 跟到 (0,0) 是空格 → **3 个攻击全部 miss**（status: missed, reason: out_of_range 或 unit_gone）
- 我的 (-1,0) infantry 也被敌方攻击击杀（5 dmg vs 4 HP）

R12 表面看是敌方损失 21 sup、我损失 5 sup 的"赢回合"，但我的 13 点未命中让敌方 heavy 偷到 (0,0) 永久安全格，**战略上彻底输掉**。

### R13 — safeRadius 3→2 + 第三个致命错误

- **错误 #3**: 我的 ranger (3,0) 被炮火炸死（HP 3→0）。我在 R12 末状态时认为 (3,0) 的 `distance=3 = safeRadius=3` 是安全的（凭直觉按 `>` 解读规则），实际服务器按 `>=` 判定，且轮界炮火收缩后新 safeRadius=2，(3,0) 的 distance 3 > 2 必在 danger 内
- 我误判后没有把 ranger 撤到 (1,0)/(0,0)，9 sup 的主力输出直接被炮火清掉
- 同时 scout 攻击 (-2,0) 也 miss（敌方已不在该格）
- R13 后我军力从 11 sup（2 infantry + scout）骤降到 5 sup（scout only），从此进入绝境

### R14 — safeRadius 2→1（minimumSafeRadius 达成）

- 我剩 1 个 scout (HP 5) 在 (1,0)，敌方剩 1 个 heavy (HP 15) 在 (0,0)
- (0,0) 是 distance=0 的唯一永久安全格；其余 distance 1 的 6 格中 (1,0)/(-1,0) 是 plain，其他 4 个是 blocker
- 我执行"躲-攻-回"循环：scout (1,0)→(2,0) 躲避敌方对 (1,0) 的攻击锁定，scout 在 (2,0) 攻击 (0,0)（3 dmg），scout (2,0)→(1,0) 返回安全格
- 敌方 R14 出 1 exec 1 miss 1 attack — 说明敌方也在试探，没成功命中我

## 4. 终局（R15 花心争夺）

### 过程

- 我 scout (1,0) HP 5；敌方 heavy (0,0) HP 15
- 我的计划: scout (1,0)→(-1,0)（distance 2，超出 heavy range 1，理论安全），然后从 (-1,0) 攻击 (0,0)（3 dmg）
- 敌方计划：heavy 攻击 cell **(-1,0)** — 预判了我的移动方向。这一击精准命中我的 scout，5 dmg vs 5 HP 直接击杀
- `unit_death` 事件：`R15 player_b:scout at (-1,0) cause: attack`
- 因最后一个单位死亡，触发 `player_eliminated`（`reason: army_destroyed`, `eliminatedBy: player_a`），cp_2 同时被 `control_point_neutralized`

### 致命预判

敌方 heavy 在 plan time 时位于 (0,0)，距离 (-1,0) 是 1 格，**正好在 heavy 的 range 1 内**——意味着敌方可以直接选 cell (-1,0) 作为攻击目标。即便 (-1,0) 在 plan time 是空格，攻击也会在 resolution 时打中我先到那里的 scout。

我没意识到 heavy 能从 (0,0) 直接覆盖 (-1,0)；我以为躲到 (-1,0) 后 distance 2 超出 heavy range 就安全，结果敌方根本不需要移动就能打到。

### 打光/炮火淘汰的顺序

- R15 我以 `army_destroyed` 被淘汰（敌方最后一击），不是炮火清场
- 若我没在 R15 死，按缩圈规则双方可能同时进入永久安全带（(0,0) 唯一格），重型会先撞死我 scout

## 5. 裁决账本与击杀分

### 军力价值曲线（按部署造价累计 - 死亡造价）

| 时间节点 | 我军力 | 敌军力 | 备注 |
|---|---|---|---|
| R1 后 | 20 (heavy+2inf) | 19 (heavy+ranger) | 起手几乎平手 |
| R5 后 | 20 (-4 scout 死) | 28 (+infantry 5, +ranger 9 替补) | cp_1 拉锯战我亏 |
| R9 后 | 16 (-scout 4, -heavy 10, -inf 5; +scout 4, +ranger 9) | 12 (-ranger 9 ×2; +ranger 9) | 互爆后我略优 |
| R11 后 | 7 (-scout 4, -inf 5; +inf 0, +ranger 9 死炮火) | 10 (-heavy 10 死我手, +heavy 0 替补) | 敌方剩单 heavy |
| R12 后 | 11 (-inf 5; +inf 5 替补=平) | 10 (heavy 偷 (0,0)) | 表面我优，战略已输 |
| R13 后 | 5 (-ranger 9 死炮火) | 10 | 绝境 |
| R15 后 | 0 (scout 死) | 10 (heavy 满血) | 终局 |

### 击杀造价（killValue）来源

**我的 33 killValue** = R6 步兵(5) + R7 ranger(9) + R9 ranger(9) + R11 heavy(10)

**敌方 46 killValue** = R5 scout(4) + R6 ranger(9) + R7 heavy(10) + R8 infantry(5) + R9 scout(4) + R10 infantry(5) + R12 infantry(5) + R15 scout(4)

**炮火击杀（无归属）**: R11 我的 ranger (9) + R12 敌方 3 单位 (5+9+7=21) + R13 我的 ranger (9) = 39 sup 总价值被炮火清掉

注：炮火炸死敌方 21 sup > 炸死我 18 sup，但敌方重单位基数大，损失占比更低；我两个 ranger 都是被炮火炸死（占总损失 18/46 = 39%），是经济上的重大浪费。

### AP 浪费清单（按回合统计 fail/miss/fizzle）

| 回合 | 我 (exec/fail/miss/fizz) | 敌方 | 关键浪费原因 |
|---|---|---|---|
| R1 | 3/0/0/0 | 2/0/0/0 | 无 |
| R2 | 3/0/0/0 | 4/0/1/0 | 敌方 1 miss |
| R3 | 5/0/0/0 | 4/1/0/0 | 敌方 1 fail |
| R4 | 2/1/0/0 | 2/3/0/0 | 双方 destination_conflict 多 |
| R5 | 3/2/0/0 | 2/2/1/0 | 我 2 fail 含 scout 突袭失败 |
| R6 | 5/0/0/0 | 3/2/0/0 | 我最佳回合 |
| R7 | 4/1/0/0 | 3/1/1/0 | 互爆 |
| R8 | 3/2/0/0 | 5/0/0/0 | 我 2 fail 含步兵 move 失败 |
| R9 | 5/0/0/0 | 2/2/1/0 | 我全 exec |
| R10 | 4/1/0/0 | 5/0/0/0 | 我 1 fail = ranger 部署到 warning |
| R11 | 3/1/1/0 | 2/2/1/0 | 互爆 + 炮火杀我 ranger |
| R12 | 1/1/2/0 | 3/0/0/0 | **3 个攻击全 miss = 致命回合** |
| R13 | 1/0/1/0 | 1/2/0/0 | 我 ranger 死炮火 |
| R14 | 1/1/1/0 | 1/0/1/0 | 残局试探 |
| R15 | 1/0/0/0 | 1/0/0/0 | 我 scout 死，敌方 1 命中 |
| **合计** | **39/9/5/0** | **37/13/5/0** | 我 14 个无效动作，敌方 18 个 |

注：R12 的"3 attack 全 miss"是我本局最大的单回合 AP 浪费（3 AP 全废），直接导致敌方 heavy 偷家成功。

## 6. 经验教训（≥3 条，可执行）

1. **炮火规则必须用 `>` 还是 `≥` 当场校验，不能凭直觉**：R13 死 ranger 的根因是我以为 `(3,0)` 的 `distance=3 = R12 末 safeRadius=3` 是安全的（按 `>` 解读），但服务器实际按 `>=` 判定。**写复盘或对局中每次判断单位是否安全，必须 GET 状态查 `artillery.dangerCells` 数组，用 `unitCell in dangerCells` 校验，而不是凭算术。**

2. **warning 格上禁止部署任何 `HP ≤ damage` 的单位**：R10 我把 3-HP ranger 部署到 (4,1) warning 格，下回合炮火收缩直接送 9 sup；同位置敌方部署 HP 8 的 support 就存活了。**部署前必查：① 目标格在 `warningCells` 列表里？② 单位 HP - damage > 0？两个都满足才部署；否则宁愿等一轮或部署到 distance 更小的格（哪怕离前线远）。**

3. **attackLock 跟随 ≠ 必中：out_of_range 会 miss**：R12 我用 ranger + 2 infantry 锁定 (0,0) 的敌方 heavy，但敌方同回合 step 1 移到 (-2,0)，attackLock 跟过去但 `distance=5 > range=3` 全 miss。**锁定目标前先评估：敌方在 step 1 能移到的最远格子，是否仍在我的射程内？若不在，要么换更近的锁定位（付出 move AP），要么先堵敌方移动路径（用 infantry 站在 (-2,0)/(-1,0) 让 destination_occupied）。**

4. **多攻击分散 step 不如齐投同一 step**：R12 我把 3 个攻击分散在 step 2/3/4（ranger attack + 2 infantry attack），敌方在 step 1 move 走后我后续 3 步全 miss。**锁定同一目标时把所有攻击都放同一 step，让 attackLock 一次跟踪到位；分散 step 等于给对方多个挪窝窗口。**（注意：同一 step 1 个玩家只能 queue 1 个 action，所以"齐投"需要不同单位的 attack 各自占不同 step —— 但 step 顺序仍要紧贴：把所有 attack 放最前 step，让 attackLock 在敌方尚未 move 时就锁定 plan-time 位置。）

5. **同时结算的"先动先走"对攻击方不利，必要时把 attack 放最前 step**：R12 敌方 step 1 move 出 (0,0)，我 step 2 才 attack — 敌方的先动让 attackLock 跟踪却 out_of_range。**当敌方有移动空间时，把己方 attack 放 step 1（与敌方移动同时结算），让 attackLock 在敌方还在原位时锁定；这样即便敌方移动也只是 attackLock 跟过去，减少 out_of_range 概率（虽仍可能发生，但至少没有 step 间的"先动优势"）。**

6. **缩圈终局残军力对位是关键，应早做规划**：本局若 R10 不浪费 9 sup 部署新 ranger、改囤到 R13 共有 17 sup 部署一个 10-sup heavy，残局就是 heavy vs heavy（5 atk vs 15 HP = 3 回合杀），加上炮火每轮 5 dmg，2 回合内能赢。**不要在发育期末用便宜单位填线，要为终局保留至少 1 个高 HP 突击单位；炮火最低 safeRadius=1 后，重单位 vs 轻单位是不对称的——heavy 在 (0,0) 永远安全，scout 在 (1,0) 永远在 heavy 射程内。**

7. **残局 1v1 花心格争夺：先占 (1,0)/(-1,0) 比先攻击更有用**：本图 minimumSafeRadius=1 时，(0,0) 是 distance=0 的唯一永久安全格，但其相邻 plain 是 (1,0) 和 (-1,0)，谁先占这两个 cell 之一就形成"卡口"——敌方必须先打掉我才能进入 (0,0)。R14 我已经占了 (1,0)，R15 应该直接保留位置 + 攻击 (0,0)，**而非移动到 (-1,0) 浪费 1 AP 给敌方预测空间且把自己置于敌方射程内**。

8. **mutual kill 是数量优势方的陷阱**：R6/R7/R9 三次 mutual kill 看似我以小搏小不亏，但敌方重单位（heavy 15 HP）一直存活，我轻单位越打越少。**当军力数量领先但单兵弱时，应优先集火击杀敌方高 HP 单位（用 ranger 远程齐投 + infantry 堵路），而不是换掉对方便宜的轻单位。**

9. **同回合行动顺序不影响结算结果，但影响 attackLock 跟踪**：在 royale 中，"队列列表顺序不是优先级；同阶段平局按开局 turnOrder 的确定性顺序处理" — 我的 turnOrder 在前（player_b），但 attackLock 是按"敌方在 plan time 时位置"锁，不是按 turnOrder 锁。**复盘时不要把 queue 顺序当成"我先打了对方再反应"，所有同 step 的动作都是真正同时结算的；唯一先后顺序发生在"轮界"的炮火收缩 + 收入结算，那也是服务器自动的。**
