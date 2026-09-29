# tg_0180 雪花大逃杀复盘（royale·雪花）

## 0. 局面概要

- gameId：`c8547716-30dd-40e8-b26e-145eecb684a4`；地图：`snowflake`（雪花，半径 9）；模式：`royale`；人数：2
- 回放文件：`records/V3/tg_0180_20260929.json`（房主导出，本复盘唯一数据源）
- 我的席位：`player_a`（mimo2.6flash-OMP，turnOrder 1，spawnSlot `slot_east`，出生据点 cp_6）；对手 `player_b`（mimo2.6pro-OMP，turnOrder 0，`slot_west`，cp_3）
- 我的名次：rank 1（win）；终局：第 11 轮 `winner=player_a`，`reason=last_player_standing`
- 本局 artillery 配置：`startRound 6 / intervalRounds 1 / damage 25 / minimumSafeRadius 1`；`maxTurns: null`（无轮次裁决）
- 关键对局参数：`actionsPerTurn 8`、`startingSupplies 500`、`baseIncome 20` + forward_base 20（每轮 40）、`damageVarianceRange ±2`、裁决权重 `armyValue 5 / effectiveActions 10`（HQ、据点、补给权重均为 0）

## 1. 结果一句话

**player_a 赢**——双方全程零交战，胜负由炮火缩圈的站位纪律决定：第 9–11 轮双方主力几乎同时被圈外炮火成建制清掉，但 A 的最后一支 heavy 比 B 的双 heavy 晚一步死在圈内，B 的 7 个单位在第 11 轮被炮火一次清空（`player_eliminated: reason=artillery_destroyed, eliminatedBy=null`），A 以"最后一个存活单位"胜出。终局比分 A 125（军力 11 + 行动分 70 + 据点 1×5）vs B 60（行动分 60 + 据点 1×5）。

## 2. 发育窗口（round 1–5，`startRound 6` 前）

- **爆兵节奏**：A 在 round 1 部署 3 单位（infantry×2 + scout）、round 3 再补 3（ranger×2 + support），到 round 3 达到 6 单位成型；B 在 round 1 部署 3（ranger×2 + infantry）、round 3 补 1（support），停在 4 单位。
- **爆兵量对比**：A 总部署 6 单位（infantry 2 / scout 1 / ranger 2 / support 1，合计 422 补给），B 总部署 4 单位（ranger 2 / infantry 1 / support 1，合计 283 补给）。双方收入完全对等（各 9 次 income、各 360 补给），A 多花的补给全部转化为军力。
- **部署垫**：双方各自的 forward_base（A 的 cp_6 / B 的 cp_3）全程未失守；据点是本图唯一收入与部署来源，两边都保住了。
- **零接触**：全程 `attack` / `heal` 事件为 0——两军始终隔着地图对角线（最近时相距 15+ 格），发育窗口实际变成了"各自爆兵 + 各自向内转进"的竞速，没有发生补给点争夺以外的对抗。
- **转进路线**：双方 89 次 move 中 A 44 / B 45，都在把外圈兵力往中心方向挪，为缩圈做准备。

## 3. 缩圈期（round 6 起）

- **收缩时间线**（`artillery_shrunk`）：r6 半径 8 → r7 7 → r8 6 → r9 5 → r10 4 → r11 3；r5 出现 `artillery_warning`（54 格警告环）。每格每次 25 伤害无视防御。
- **圈外掉血账本**（`artillery_damage` 汇总，A/B 对比）：

| 轮次 | A 掉血 | B 掉血 |
|---|---|---|
| 6 | 100 | 100 |
| 7 | 200 | 150 |
| 8 | 218 | 168 |
| 9 | 154 | 133 |
| 10 | 85 | 71 |
| 11 | 40 | 30 |
| **合计** | **797** | **662** |

  A 在危险区多吃了 135 点炮火（约 5.4 单位次），代价极高：这是本局 A 唯一的战术失误来源——r7 起为赶转进，把 8 个单位中的 7 个留在危险区硬扛了 1–2 轮，直接导致 r8–r10 连续掉兵。
- **减员时间线**（`unit_death`，cause 全部为 `artillery`，无一死于战斗）：

| 轮次 | A 阵亡 | B 阵亡 | 备注 |
|---|---|---|---|
| 8 | ranger 1 | ranger 1 | 首次减员 |
| 9 | infantry/scout/ranger/support 各 1（4） | infantry、ranger（2） | A 从 6 → 1，B 从 3 → 1 |
| 10 | scout、infantry（2） | scout、support（2） | 双方都归零后又各自剩残兵 |
| 11 | heavy 1 | heavy 2（含最后一名） | B 全灭触发淘汰 |

- **站位决策取舍**：r6–r8 我方一边向内挪一边贪输出位（大量 move 目标仍在 warning 环内），r9 才意识到必须全速撤离，为时已晚——r9 单轮 4 个单位阵亡。B 同样没跑干净，但它的兵力本来就少（4 单位），圈外绝对掉血也少，反而在 r9 和我同时只剩 1 个单位。
- **接触战**：无。`destination_conflict`、形状命中、锁定均未发生——本局没有真正的"瞄准格子"博弈，预测与封锁一节无法从回放取证（零攻击事件），如实记录为"未发生"。
- **拆除地形**：A 在 round 7 用 heavy 拆掉 cp_6 侧翼 blocker（7,-2 → plain，`actionsUsed 5`），为主力穿墙内切打开了通道；B 分别在 round 8、round 10 各拆 1 格（各花 1 AP）。这是本局唯一被双方使用的 demolish。

## 4. 终局（`minimumSafeRadius 1` 达成前后）

- 本局在半径 3（r11）就分出胜负，**未打到花心内圈六格的最终换血阶段**——最后的对局是"谁先被炮火清空"。
- r11 轮界：A 最后一支 heavy（e159ecfe，8,1）中弹阵亡 → A 归零；同轮 B 的两支 heavy（-7,0 与 -5,-1）中弹阵亡 → B 归零。
- 淘汰顺序判定：回放事件顺序为 `unit_death(A heavy)` … → `control_point_neutralized(cp_3)`（seq 259）→ `player_eliminated(player_b)`（seq 260，`reason=artillery_destroyed`、`eliminatedBy=null`、`removedUnitIds` 含 B 全部 7 个历史单位）→ `game_over`（seq 261）。即轮界同时清场时，B 先被判定为全灭，A 虽然最后一支 heavy 也死了，仍作为唯一未被淘汰的玩家判胜。
- **淘汰原因**：`artillery_destroyed`（炮火清场），非 `army_destroyed`——本局没有任何单位死于战斗。

## 5. 裁决账本与行动分

- **军力价值曲线**（按部署/阵亡重建的单位数，cost 见配置）：A：3 → 6（r3）→ 5（r8）→ 1（r9）→ 0（r10 末）→ 终局 11（最后一 heavy 按 `round(cost×hp/maxHp)` 计 11）；B：3 → 4（r3）→ 3（r8）→ 1（r9）→ 0 → 终局 0。
- **行动分**：A `actionScore 70` / B 60（`game_over.payload.scores` 记录，`effectiveActions 10`）。A 的 70 主要来自 6 次部署（每次 +1 功勋）+ 1 次拆除（+1）+ 收入/占位外的轮转——B 部署 4 次、拆除 2 次，基数更低。全程无攻击/治疗功勋（本图战斗功勋按每 10 HP 实际伤害 1 点，零交战即为零）。
- **计划动作账本**（`round_resolved.results`）：双方各 `plan_committed 10` 次；A 执行 51 个动作（R1–R10：5/6/8/5/5/5/6/6/3/2），B 执行 51（3/6/7/6/6/6/5/6/4/2）；**全部 `executed`，失败 0、落空 0、`destination_conflict` 0**——因为全程不交战，AP 没有浪费在无效攻击上。
- **AP 未用满的轮次**：A 在 r1(5)、r4(5)、r5(5)、r6(5)、r9(3)、r10(2) 均未用满 8 AP；r9–r10 只剩残兵、无可部署据点相邻空格（A 的 cp_6 邻格被自己单位占满），AP 闲置属结构性浪费，不是判断失误。
- **圈外掉血总量**：A 797 / B 662；**因炮火减员**：A 9 个（r8–r11）、B 7 个（r8–r11）；**因打光淘汰的轮次**：B 在 r11。
- **总分**：A 125 = 11×5（军力）+ 70（行动分）+ 1×5（据点）；B 60 = 0 + 60 + 1×5。补给权重 0，双方各囤 480/577 未加分。

## 6. 经验教训（可执行）

1. **危险区纪律优先于转进速度**：本局 A 圈外多掉 135 血（797 vs 662），直接代价是 r9 单轮 4 个单位阵亡。正确做法是 r5 收到 `artillery_warning` 时就把全部单位挪进安全半径，宁可晚一轮到位也不在 danger 里多站一回合——25 无视防御的全额伤害，两轮就是半条命。
2. **缩圈局"兵多"不等于"赢面大"**：A 爆兵 6 vs B 4，军力优势在炮火面前全部蒸发（A 阵亡 9 > B 7）。真正决定胜负的是**最后一支单位的存活顺序**。应把军力换成"抗炮火的纵深"：让低血单位先撤、高血 heavy 断后，而不是让全体挤在同一条危险通道里排队挨炸。
3. **零交战局里，行动分就是第二生命**：权重 `armyValue 5 + effectiveActions 10`、HQ/据点/补给全 0，囤补给毫无意义（B 囤了 577 分毫不加）。有 AP 就部署/拆障换功勋——A 的 6 部署 + 1 拆除比 B 多拿 10 分行动分，正是终局 125 vs 60 的主要差值来源之一。
4. **通道 blocker 是可规划的资源**：双方都用了 heavy demolish（A r7、B r8/r10）。本图六条放射通道被屏障切割，提前 1 轮拆掉己方侧翼 blocker 能让主力内切提前到位，比绕行省 1–2 轮——这在"每回合圈缩一格"的时钟下就是活命时间。
5. **同时回合的队列顺序不是优先级**：本局 10 轮 `round_resolved` 全部按固定阶段（部署→移动→拆除→攻击→死亡→占点→轮界炮火）结算，先提交不代表先执行；规划时应按阶段假设"所有人的移动同时完成"，不要赌对手挪开某格。
