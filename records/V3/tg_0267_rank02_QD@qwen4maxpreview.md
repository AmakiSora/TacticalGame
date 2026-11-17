# tg_0267 雪花三人局复盘（royale·snowflake）

## 0. 局面概要

- **gameId**: `b4e60a93-3ac0-436a-8a7a-dd8c1f040f73` / 地图 `snowflake` / 模式 `royale` / 3 人
- **我的席位**: `player_b`（Qwen4MaxPreview-QD），**名次 rank 2**，第 14 轮 `artillery_destroyed` 淘汰（炮火清场，`eliminatedBy: null`）
- **终局**: `last_player_standing`，winner `player_a`（Dsv4.1Flash1017-DSH），第 16 轮结束；`player_c`（Hy4-WB）rank 3，第 16 轮同样 `artillery_destroyed`
- **artillery 配置**: `startRound 6` / `intervalRounds 1` / `damage 25` / `minimumSafeRadius 1`；第 5 轮预警（safeRadius 9），第 6–13 轮逐轮收缩 9→1，第 13 轮起花心六格为最终安全区（中心格是屏障）
- **balance**: 起始补给 500、基础收入 20、据点收入 20、每轮 8 AP、`damageVarianceRange 2`、`healVarianceRange 10`、`maxTurns null`（无回合上限）
- **裁决权重**: `armyValue 5`、`killValue 1.5`，HQ/据点/补给权重均为 0
- **turnOrder**: `[player_b, player_a, player_c]`（同阶段平局按此顺序）

## 1. 结果一句话

A 靠 **arc heavy + arc support 双目标治疗** 在花心六格站稳，最后唯一存活获胜；我和 C 都不是被打光的——**双方都被炮火清场淘汰**（我 r14、C r16），A 的 424 killValue 里有一半是收掉 C 的残血单位。我前期集火拼掉 A 两个 heavy 拿到 200 killValue，但第 12 轮被 A 一个 arc 扇形同时扫掉两个 ranger，输出核心蒸发后外圈单位被炮火逐个吃掉。

## 2. 发育窗口（round 1–5）

**经济与爆兵**：起始 500，每轮收入 40（基础 20 + 据点 20），r2–r13 共入账 480。我 7 次部署花 576：

| 轮 | 部署 | 造价 | 落点 |
|---|---|---|---|
| r1 | heavy / ranger / support | 100 / 80 / 68 | (9,0) / (8,-1) / (7,1) |
| r2 | ranger | 80 | (8,-1) |
| r3 | heavy | 100 | (9,0) |
| r4 | ranger | 80 | (8,-1) |
| r5 | support | 68 | **(9,-1) d9 警告环** |

A 部署 6 次（r1 起连爆 heavy，r2 补 support，r5 补 ranger），C 部署 7 次（heavy 为主 + ranger/infantry/support）。三家都保住出生据点，无据点得失（`control_point_neutralized` 只在淘汰时发生：cp_6 随我 r14 淘汰中立、cp_2 随 C r16 淘汰中立）。

**爆破开路**：雪花六臂被屏障封死，我用 heavy 依次拆 (6,-1) r1、(6,1) r2、(2,-1) r3，打通东臂→花心的西侧走廊（r=-1 线）。A 拆 (-1,-5) r1、(-1,-1) r3 打通北臂西侧；C 拆 (-6,6) r1、(-2,2) r3 打通南臂。三家几乎同步在 r3–r4 把走廊挖通，r4 起 ranger 前出走廊口对峙。

**发育期失误**：r5 把第二个 support 部署在 (9,-1)——d9 已在炮火警告环内，r6 缩圈即吃 25（76→51），r12 被炮火打死，等于 68 补给白送。部署前没核对 `warningCells`。

## 3. 缩圈期（round 6–12）

**圈线**：r6 safeRadius 8 → r7 7 → r8 6 → r9 5 → r10 4 → r11 3 → r12 2。每轮圈外单位全额扣 25、无视防御。

**接触战与击杀**（攻击瞄准格子，ranger `attackLock` 锁定后目标未逃出射程必命中）：

- r6：ranger1 锁定 A 先锋 heavy（0,-1）命中 26；C 的 ranger + heavy 合击打死 A 的 scout（C 拿 42 killValue）。
- r7：我 heavyA + 双 ranger 集火 A 第二 heavy（1,-1），三轮累计 81+82 伤害。
- **r8：ranger2 最后一击打死 A 第二 heavy（+100 killValue）**；同一轮 A 的 heavy arc 扫 (1,0) 打死我的 scout（35 伤害）。
- **r9：ranger2 最后一击打死 A 先锋 heavy（+100 killValue）**——我的 200 killValue 全部来自这两个 heavy。但 A 的 support 从 r9 起 **arc 双目标治疗**，r9–r12 共 7 次治疗回 175 HP，剩下的 heavy 始终差一口气打不死。
- r10：A heavy arc 31 + C ranger 锁定 27 合击打死我的 heavyA（C 拿 100 killValue）。我 heavyA 残血 49 时没撤出 arc 射程，移动又排在攻击之后，结算时 `unit_gone`。
- r11：ranger3 在 (5,-1) d5 被炮火打死——**第一个炮火减员**。
- **r12（转折点）**：A heavy（1,-1）一个 arc 瞄准 (1,0)，**同时扫死我的 ranger2（39→30 实际）和 ranger1（35→31 实际）**——两个输出核心站在同一扇形里被一锅端。同轮 heavyD、support2 被炮火打死。

**危险区损失**：r6–r12 我累计吃炮火 524 HP（r6 25 / r7 50 / r8 75 / r9 100 / r10 125 / r11 118 / r12 91，含残血截断），外圈 heavy 全在圈外挨打。A 同期只吃 25–50/轮（单位早早收进内圈），C 吃 175/轮峰值（r12 七个单位在圈外）。

**AP 浪费清单**（8 次 failed + 1 次 missed）：

| 轮 | 动作 | 原因 |
|---|---|---|
| r3 | ranger2 / heavyC 移动 ×2 | `destination_occupied`——队列里到达排在离开之前 |
| r5 | ranger2 / ranger3 移动 ×2 | `destination_occupied`——同上 |
| r6 | heavyA 移动 + 攻击 | 移动 `destination_occupied`（与 A 抢 (1,-1)），攻击 `previous_action_failed` |
| r9 | heavyA arc | `missed`——A 先锋已移走 |
| r10 | heavyA 移动 | `unit_gone`——单位第 1 步已被打死 |
| r12 | ranger1 移动 | `unit_gone`——同上 |

r3/r5 的 4 次 `destination_occupied` 纯粹是队列顺序错误（同格离开必须先于到达），r10/r12 的 `unit_gone` 是残血单位没先撤。合计浪费 9 个 AP，占全程 AP 的约 9%。

## 4. 终局（round 13–16，safeRadius 1）

r13 缩到最小半径 1，花心六格 `(1,0)/(1,-1)/(0,-1)/(-1,0)/(-1,1)/(0,1)` 是唯一安全区（中心 (0,0) 是屏障）。此时站位：A 占 (1,-1)/(−1,0) 两个 heavy + (0,-1) ranger，C 占 (−1,1) heavy + (0,1) scout，我只剩 (1,0) 一个 ranger——**r12 之后我实际上已经退出花心争夺**。

- r13：我的 heavyC、support1 被炮火打死；**A 的 support 也在 (−1,-1) d2 被炮火打死**（21 HP，d2 已入危险区）——A 的治疗核心没了，但 heavy 已经够赢。A 同一轮打死 C 的 scout + ranger。C 三个外圈 heavy 被炮火清掉。
- **r14：heavyB 在 (4,2) d6 被炮火打死，我全军覆没，`artillery_destroyed` 淘汰**，cp_6 中立。C 的 heavy da347dbb 同轮炮火死。
- r15：C 再损失 heavy（炮火）+ infantry（炮火）+ heavy（A 攻击）。
- r16：C 的 support 被炮火打死，C `artillery_destroyed` 淘汰。A 唯一存活，`last_player_standing` 获胜。

**终局 A 存活军力** armyValue 123（3 heavy + 1 ranger 残血），C 和我都是 0。两家败者都不是被 A 打光的，是炮火清场——A 只要缩圈前占住花心、把残血单位收进安全格，炮火就替它收尾。

## 5. 裁决账本与击杀分

| 玩家 | armyValue×5 | killValue×1.5 | 其余 | total |
|---|---|---|---|---|
| player_a | 123×5=615 | 424×1.5=636 | 0 | **1251** |
| player_b（我） | 0 | 200×1.5=300 | 0 | **300** |
| player_c | 0 | 142×1.5=213 | 0 | **213** |

- **我的 killValue 200**：r8 打死 A heavy add0662d（100）+ r9 打死 A heavy 1626c439（100），均由 ranger2 锁定最后一击入账。
- **A 的 killValue 424**：我 scout 42 + 我 ranger1 80 + 我 ranger2 80 + C scout 42 + C ranger 80 + C heavy 100。
- **C 的 killValue 142**：A scout 42 + 我 heavyA 100。
- **我的输出账**：15 次命中 / 1 次落空，共 352 伤害**全部打在 A 身上**；承受攻击伤害 346（A 328 + C 18）+ 炮火 640 = 986。炮火占我总承伤的 65%。
- **治疗账**：A support 7 次 arc 治疗回 175 HP（r9–r12，双目标），C support 3 次回 79 HP。我的 352 伤害里有相当一部分被 A 的治疗抵消——集火 heavy 而没切奶妈是战略错误。
- **军力曲线**：r1–r5 爆兵到 10 单位峰值；r8 起 scout/heavyA 战死，r11–r14 炮火连收 6 单位，r12 arc 双杀 ranger 后军力雪崩，r14 归零。
- **炮火减员明细**（我 6 单位 / 640 HP）：ranger3 r11、heavyD r12、support2 r12、heavyC r13、support1 r13、heavyB r14。

## 6. 经验教训（可执行）

1. **六角几何必须算，不能猜**。`dist = max(|dq|,|dr|,|dq+dr|)`，相邻只有 6 个方向 `[±1,0],[0,±1],[1,-1],[-1,1]`（`[-1,-1]` 不是方向）。本局 r11/r12 两次把 4 格当 3 格导致 ranger 攻击被拒（`out_of_range`），heavyB 两次往 `(-1,-1)` 方向移动被拒（`invalid_move`）。**行动前用 BFS 脚本验算射程与路径**，别凭 ASCII 地图目测。
2. **队列顺序 = 结算时间线，离开必须先于到达**。r3/r5 共 4 次 `destination_occupied` 全是同格"到达排在离开前"。提交前按步骤检查：任何单位腾出的格子，后续步骤才能进；残血单位的撤退移动排在攻击之前，避免 `unit_gone`（r10/r12 两次）。
3. **先切奶妈，再磨 heavy**。A 的 arc support 每轮双目标回 25±，7 轮 175 HP 把我的集火全部抵消。support 只有 76 HP / def 5，ranger 射程 3 完全够得着——**两个 ranger 一轮就能打残、两轮必杀**。我把 352 伤害全砸在会被治回来的 heavy 上，等于给 A 刷治疗量。下次遇到 arc support 优先锁定它。
4. **炮火纪律高于一切**。本局我和 C 都是 `artillery_destroyed`，炮火占我承伤 65%。三条硬规则：① 部署前核对 `warningCells`/`dangerCells`，绝不把单位放进警告环（support2 白送 68）；② 每次缩圈前把外圈单位收进安全半径，heavy 移速 2 要提前两规划；③ 圈外单位每轮全额 25 无视防御，残血单位在圈外等于死刑。
5. **输出位不要堆在同一 arc 扇形里**。r12 A 一个 arc 同时扫死 (1,0) 和 (2,-1) 的两个 ranger——花心六格彼此相邻，heavy arc 一次覆盖 3 格。ranger 之间至少隔 2 格、分散在扇形两侧，让一个 arc 最多换一个。
6. **残血先撤，别贪输出**。heavyA 49 HP 留在 arc 射程里想多打一轮，结果 r10 被 A+C 合击打死；ranger1 残血 31 的撤退移动排在攻击后面，结算时已经 `unit_gone`。同时结算下**生存移动的优先级高于补刀**，先把单位移出 lethal 范围再谈输出。