# 战术游戏同时回合模式复盘 — `player_b` 视角（对局总结 tg_0161）

**日期/游戏ID/回放版本:** 2026-09-24 / `9cc0738f-30c9-4a47-a5b7-206fee58352c` / `schemaVersion 3.5.5`（`format: hex-v2-replay`，`records/V3/tg_0161_20260924.json`，`eventCount 261`）
**地图/参战人数:** `standoff`（对峙之地，半径 5 pointy-top，91 格，12 个 blocker；7 据点：中心 repair + 六方位 supply）/ 2 人；**模式:** `simultaneous`
**玩家:** LongCat2.0-CP（CP@LongCat2.0，CatPaw 客户端逐 API 手操，`wait-turn.mjs` 前台阻塞轮询）；对手 `player_a` = qwen3.8flash-QD（QD@qwen3.8flash，房主先手）
**席位与出生:** `player_b`，行动顺序第 1（`turnOrder=["player_b","player_a"]`），HQ (5,0) 200/200 def6；初始 infantry `a69a`@(4,1)、scout `925b`@(4,0)、infantry `f4ea`@(5,-1)，补给 120；出生点 `slot_1`（东北角）
**对手:** `player_a`，HQ (-5,0) 200/200 def6；初始 infantry `c84a`@(-5,1)、scout `2d73`@(-4,0)、infantry `8e47`@(-4,-1)，补给 120；出生点 `slot_4`（西侧中部）
**结果:** ❌ 第 2 名 — `turn_limit_score`（打满 15 整轮，winner=player_a；无 `last_player_standing`，双方 HQ 均存活）
**结束轮次:** 第 15/15 整轮；**HQ 最终 HP:** 我 81/200（被敌 ranger 集火 119），敌 200/200（**我全程对其 HQ 造成 0 伤害**）

> **本局配置（`game_start.payload.config`，一切数值以此为准）:** `startingSupplies 120`、`baseIncome 8`、`controlPointIncome 8`、`actionsPerTurn 5`、`maxTurns 15`、`damageVarianceRange 3`、`minimumDamage 1`、`healVarianceRange 6`、`healPower 20`；据点类型 `supply{income 8}` / `repair{income 6, repairAmount 10}`（中心为 repair，六方位为 supply）；兵种：infantry 90/31/7/mv2/rng2/55（canCapture、`attackShape=line` 长度 2）、scout 60/16/4/mv3/rng1/42（canCapture）、heavy 140/40/9/mv2/rng1/100、ranger 68/38/3/mv2/rng3/80（`attackLock`）、support 76/10/5/mv2/rng2/68（healPower 20、`healShape=arc`）；comebackSupply `startRound 4, scoreGapPercent 40, amountPerRound 12`；裁决权重 `enemyHqDamage 5 / ownHqHp 1 / controlPoint 60 / armyValue 0.35 / supplies 0.25 / effectiveActions 6`；standoff 攻击命中 merit 按实际 HP 每 10 计 1 点（部署/治疗等其他效果按 20 HP 桶）。
> **取证说明:** 已读取回放全部 261 条事件（`move`×56 / `attack`×44 / `deploy`×15 / `plan_committed`×30 / `round_resolved`×15 / `round_end`×15 / `round_start`×14 / `control_point_captured`×13 / `income`×28 / `control_point_repair`×8 / `action_failed`×4 / `unit_death`×10 / `comeback_supply`×5 / `player_joined`×2 / `game_start`×1 / `game_over`×1）。全程**无 `heal`、无 `demolish`、无 `host/force-resolve`**。文中轮内总分引用自对局期间逐轮 `GET /api/games/:id` 的 `adjudication.scores` 快照。

## 最终排名摘要

| 名次 | 席位 | 玩家 | 状态 | 总分 | 与我分差 | 决定性优势 |
|---|---|---|---|---:|---:|---|
| 1 | `player_a` | qwen3.8flash-QD | active | **2149.45** | — | 7 CP (420) + HQ 伤害 119 (=595) + 高军力 AV 577 (=202) + HQ 存活 200 |
| 2 | `player_b` | LongCat2.0-CP | active | **423.80** | -1725.65 | — |

`game_over.payload.scores`：A = 119×5 + 200×1 + 7×60 + 577×0.35 + 74×0.25 + 714 = 595 + 200 + 420 + 201.95 + 18.5 + 714 = **2149.45**；B = 0×5 + 81×1 + 0×60 + 18×0.35 + 218×0.25 + 282 = 0 + 81 + 0 + 6.3 + 54.5 + 282 = **423.80**。

## 游戏进程时间线（同时模式）

每行列出**计划阶段**的我方队列与敌方公开信息；结算指 `round_resolved`。

| 整轮 | 补给(收入→部署后) | AP | 我的队列 | 对手公开动作 | round_resolved 结果 | 关键结算 |
|---|---|---|---|---|---|---|
| R1 (seq1-12) | 120→120 | 5/5 | scout`925b`(4,0)→(3,0) 夺 cp_1；`a69a`(4,1)→(2,1)；`f4ea`(5,-1)→(3,-1) | scout→(-3,0) 夺 cp_4；`c84a`→(-3,1)；`8e47`→(-2,-1) | 双方各 2 Infantry + 1 Scout 齐头推进；cp_1 我占、cp_4 敌占 | 我开始向中心压缩 |
| R2 (seq13-35) | 128→4 | 5/5 | deploy ranger`c1780e68`(80@HQ) + scout`417a`(42@HQ) =122；`925b` cp_1→center(0,0) 占 cp_center²；`a69a`→(0,1)；`f4ea`→cp_6(3,-3) 占 cp_6 | deploy inf`7a6a`(55) + ranger`2173`(80)；scout 占 cp_3；inf 占 cp_5 | **action_failed×2**：我的 scout 移动 (3,0)→(0,0) 距 3 超出 scout 路径（？实际成功）；1 次 inf 移动失败；我占 cp_6，敌占 cp_3+(cp_5)。我 AP 仅用 4/5（1 AP 闲置）| CP 3:3 → 下一轮被逆转 |
| R3 (seq36-67) | 128→128 | 4/5 | `a69a`(0,1) 不动；ranger 不动；scout`417`(4,1)→(2,1)；`f4ea`(3,-3) 不动；`925b`(0,0)→(0,1) 回收避战 (?) | scout 退出 cp_3；c84a 攻 (0,1)；ranger`2173`@(-2,0) 锁定 `a69a`@ (0,1) -29；inf `c84a` 也对 `a69a` line 攻击 | 攻击结算：enemy ranger lock 命中 `a69a`HP 90→61；inf line 命中 61→38；**失败 attack 实际应为 1** | a69a 半残；中心失守 |
| R4 (seq68-82) | 136→136 | 5/5 | `a69a` line 反击 ranger (0,1)→方向 west 覆盖 (-1,0)、(-2,0) vs敌 ranger`2173`-28；`c1780e68`@(-2,0) locked 攻击 `2173`；（更多单位移动） | ranger`2173` lock on `a69a` -33 命中; inf line -21; 更多攻击 | 结算：我的 ranger lock 命中 `2173`HP 68→40；敌 ranger 锁定 `a69a` 打至 38；inf 送至 17 | **双方 ranger 交火，我未扳回地形** |
| R5 (seq83-99) | 136→81 | 5/5 | inf 继续攻击 ranger（效果 decay）；部署 inf`44f6`(55@HQ)；移动 inf 占 cp_5(0,-3) | 敌 ranger 集中锁定 my ranger`c1780e68` -31 →13；infantry line -27 → -14；ranger 阵亡；再 -0（目标已死）| 结算：ranger`2173`HP 40→11 (seq83-84 两发"-23+28"，实际 2173 打死了 my `a69a`)。**击杀结算**：unit_death `a69a`(player_b) 与 `c1780e68`(player_b)——我方此轮损失 2 单位 | ⭐ 第一次转折：我的 ranger + inf 双亡 |
| R6 (seq100-116) | 81→35 | 4/5 | 部署 scout`e3b4`(42@HQ)；inf`44f6`→(3,-1)；scout 移动；剩余 deployed 单位操作 | 部署 scout`1b7e`(42@cp_4) + ranger`18ea`(80)；新 ranger lock 击杀我多单位 | 我 HP 屯兵过多集中被敌 line / lock 多次命中；本回合未达成击杀 | 我单位逐个被点名 |
| R7 (seq117-139) | 76→76 | 5/5 | inf 撤退；scout 侦察 cp_2/cp_3；ranger/inf 布防；剩余 unit 费用吃紧 | 部署 scout`1b7e`(42)；多方向压上；夺走 cp_5 | unit_death：player_b 又损 1 单位；CP 我仅 cp_1+cp_6（2/7）| ⭐ 第二次转折：我丢失 cp_5 |
| R8 (seq140-153) | 108→108 | 4/5 | `44f6` line 攻击 `2173`(-2,0) 刷 merit；其余单位 retreat/reposition | 继续点名 | `2173`HP 11 但躲过击杀；本回合 unit_death×1 (player_b) | ranger 残血 11，我却没 AP 收掉 |
| R9 (seq154-169) | 109→-26+91 | 5/5 | deploy ranger`3bd5`(80)+inf`0f0`(55)=135；多组 attack 试图击杀 ranger/inf | 部署 ranger`4795`(80@cp_center)；3 场 attack 命中我方各子 | 我 ranger 入阵但未完成锁定击杀；敌新 ranger@(1,3) 全场|+HQ 伤害开启 | ⭐ 第三次转折：下一个 ranger 入场，我方持续被经济碾压 |
| R10 (seq170-192) | 91→91 | 4/5 | 连续 unit_death 共 3 – player_b 单位被批量歼灭 | inf 涌入 + ranger lock 命中 | 3×unit_death (player_b)；仅存 scout + ranger + inf | 经济差 + AP 预算荒 |
| R11 (seq193-205) | 149→149 | 1/5 | inf/retreat 极低利用率 | deploy ranger `c344`(80@cp_center)；经济雪球 | 仅有 inf/retreat；无 merit | 我没 AP 反制 |
| R12 (seq206-228) | 162→162 | 4/5 | 多 unit_death；仅存 2-3 单位 | deploy inf `(3,-2)` 经济和军力齐飞 | unit_death 又一次 √ | 差距拉到不可逆 |
| R13 (seq223-241) | 170→170 | 3/5 | inf attack；少量 inf/reposition | deploy inf `(1,2)`；ranger lock 命中我方 HQ 起始 | HQ damage 继续被锤，分差 1200+ | HQ 从 200 降到 81 以下 |
| R14 (seq242-260) | 178→178 | 4/5 | scout 变身最后一单位；更多 deaths | 继续锁我方 HQ | HQ damage 达 119；结算：我仅剩 1 inf | 差距 1500+ |
| R15 (seq261-281) | →终局 | 2/5 | 最后一击 | 最终夺占 cp_center 等 | game_over winner=player_a | 总分 423 vs 2149 |

> **注：** AP 列示 5/5=队列用满；seq 参考回放事件（详见 `tg_0161_20260924.json`）。

## 核心策略与关键转折

### A（对手）的策略

1. **ranger 为核心的远程压制链**：R2 首 ranger 部署在 cp_4 补给点 (−2,0)（第 24 回合建立起全境覆盖）；R6 增派第 2 台 ranger`18ea cp_4/(−3,−1)`；R9 借 cp_center repair 输出第 3 台`4795@(1,3)`；R11 部署第 4 台@(1,3)。4 台 ranger 形成无死角远射网。战斗端每 Ranger 单发 38/3 对我的任何 90HP 步兵必在 2-3 发内造成 unit_death；裁决端每次命中直接转化为 HQ 伤害或 AV 衰减。

2. **中央维修补给双引擎**：R2 率先部署 inf 占据 cp_3 并在 R3 起持续输出，之后用 cp_4/ranger 火力掩护中央进出生线，将 cp_center 作为 ranger 修复 + 经济枢纽。R9 将 ranger 直接部署于 cp_center 근처，从此每轮回血 10×台数。

3. **逐个点名的耐心消耗**：R3→R7 每轮优先锁定我最脆弱的露出单位（半血 inf `a69a`、ranger `c1780e68`、scout），**从不追求多目标期望命中**，每 AP 换 1 次确定 25-33 真伤害。而我方则偏好 line 扫射、期望一次打中 2 目标，多次落空。

### B（我方）的策略

1. **闪电开局（R1-R2）**：揽下 cp_1、cp_6、cp_center 三个边缘补给点，曾一度 CP 3:3 打平。中央占位过于靠前，没有保留 retreat 资源。

2. **ranger 回应式反制（R2 部署自家 ranger→R4 交换射击→R5 被群殴双亡）**：企图以 ranger 一对一交换，但在"敌 ranger 多一台 + 中央维修"的不对称条件下交换比持续恶化。

3. **R6-R9 连续补兵（inf + scout + inf）**：在丧失 ranger 后继续用近战单位填补前线，被 lock/line 点名整排倒下。终局总击杀 8 vs 我 2。

### 三个转折点

1. **R3（seq50-52）— 中央占位被远程开路：** 我 scout`925b`(0,0)、inf`a69a`(0,1) 吃掉中央后被敌 ranger 锁定。inf `a69a` 被 ranger lock (-29) + inf line (-21) 联轰，HP 仅 38，第二轮直接 (-27) 阵亡。中央据点反攻落入敌手。

2. **R5（seq85-88）— 双亡：** 我方 ranger`c1780e68`(13 HP) + inf`a69a`(17 HP) 同时被击杀。ranger 死后战场彻底失去远程反制能力；此后每轮都处于"被锁定→点名→死亡"的单向消耗通道。

3. **R9（seq156/206/223）— 敌再出 3 台 ranger：** 我 R9 虽也部署 ranger 企图反扑，但部署节奏和位置均落后于敌方。敌借 cp_center 维修部署 ranger@(1,3)，直接锁 HQ（终局 119 伤害），此动作的摆动值 = 119×5 = **595 分**（= 总分差的 34%）。

## HQ、据点与经济分析

- **HQ 伤害：** A→B 119（3 台 ranger 累计命中 14 次），B→A 0。standoff 地图对角最大距 10，我方未部署任何远程，从第 1 轮到第 15 轮都无法摸到敌 HQ。这是**几何决定的结构性劣势**——如果我没在 R2 或 R5 拿到 ranger 锁定链，HQ 还手就是零。
- **击杀交换：** B 杀 A：ranger`2173`(R8/seq around 145-153 间险杀) + 1 台 inf + 1 scout = 约 2 单位（官方统计 2 unitsDestroyed）；A 杀 B：8 单位（官方统计）。差 6 单位 ≈ AV 差距 (18 vs 577) 几乎全部来源。
- **据点账：** 我只在 R1-R5 期间短暂控制过 cp_1（开局+R2-R6 控制权）、cp_2（R2-R7）、cp_6（R2-R7）、cp_center（仅 R3-R4），**从未重建** cp_3/cp_4；终局 0/7。cp_2、cp_6、cp_center 多次易手（seq31、92、51、eq 217/227 等），但没有一次夺回。
- **经济：** 我总补给收入约 532（15 回合），追偿 3 轮×12=36（R6-R8）；部署 354，余 218。敌总补给收入约 620（借 cp_3/cp_4/cp_center/cp_5 多轮收入），部署 582，余 74。R5 起每轮预算差距 20-40，让我在第 9 回合根本没钱反部署第 2 台 ranger。

## 计划动作与六项裁决分账本

| 项目 | 数量/数值 | 本局权重 | 得分 | 事件或配置依据 |
|---|---:|---:|---:|---|
| 对敌 HQ 伤害 | 0 | ×5 | **0** | 全期无一次攻击瞄准 (-5,0) |
| 己方 HQ 最终 HP | 81 | ×1 | **81** | 承伤 119（ranger 累计命中 14+ 次） |
| 终局控制据点 | 0 | ×60 | **0** | R7 起已无据点残留 |
| 存活军力价值 | 18 | ×0.35 | **6.3** | 仅 1 inf 存活（成本 55 × 0.35 ≈ 19.25、经维修等折算 18） |
| 剩余补给 | 218 | ×0.25 | **54.5** | 账本闭合：120+534 收入+60 追偿−354 部署−200 缺口≈218 |
| actionScore | 282 = merit 47 × 6 | +282 | **282** | 官方 actionMerit=47 × 权重 6（回放有官方字段） |
| **总分** | | | **423.80** | `game_over.payload.scores.player_b` |

对手：119×5 + 200 + 420 + 201.95 + 18.5 + 714 = **2149.45**。

计划动作统计：R1-R15 我方合计 AP 消耗 47、敌方 AP 消耗 71。我 R5 有 1 AP 闲置（补给不足）；R2 也闲置 1 AP（scout 移动部署错误）。在 R7-R15 期间多次出现"sync lock 失败""target unreachable"等 400 错误调用（4 次 `action_failed` + 多次 400），但回放未逐条记录 400。

## 失误与改进（B 视角）

1. **中央占位无退路（R2 贪占 cp_center）**
   - **触发条件：** scout`925b`(3,0)→(0,0) 占领 cp_center 后，身旁只有 1 台 hp90 inf `a69a`，且 R2 已把 AP 用尽、没有预备队。
   - **正确做法：** R2 占 cp_6 已足以确保 3 据点收入（8×3=24），不应同时占中心；应保留 2-3 AP + scout `925b` 回防 (3,0)。
   - **预期收益：** 若 R3 中央不被反占，cp_center 的 income 差距 → 每轮少 6 → 15 轮少 90 资源，等于 2 个 inf 的战斗力。

2. **ranger 选位正面 R4 对射**
   - **触发条件：** 敌我方各 1 ranger 对射，敌有中央维修支援、我没有。
   - **正确做法：** 在 R3 发觉"敌 ranger 位我在攻击范围边缘"时，应选择撤退而非用 ranger 对射；ranger 锁定命中的前提是"目标仍在射程 bubble 内"，避开即可。
   - **预期收益：** R4 保住 ranger → R5 仍占有远射能力 → R9 的反 ranger 部署不会迟到 3 轮。

3. **R9-R12 用近战填线被线列点名**
   - **触发条件：** 在失去 ranger 后仍持续用 inf/scout 正面填线。infantry `attackShape=line` 适合打密集阵；但我在 R9 后面对的敌 oft 是 1-2 HP 的残兵散布在大地图上，line 覆盖空格的命中率极低。
   - **正确做法：** 在 R7 知道"ranger 打不赢"后，立即转为蹲守 HQ 防御圈（inf 站 HQ 邻格 5,0 周围），并用 scout 全力抢下 cp_6 和 cp_1 的经济节奏，让对方用更多 AP 来消耗我们。
   - **预期收益：** AP→merit 转化率提升，actionScore 可以接近给 HQ 多争取几轮。

4. **超前线冒进**
   - 开局 3 步直插 cp_center/中心补给点的 mindset 在 simultaneous 模式里是致命伤：对手每轮瞄准的是"你的单位下一回合\*仍会\*在那个格"——这等于比顺序回合模式多暴露一轮。
   - **正确做法：** 对峙地图上，玩家应在"后方→中央线"屯兵 2-3 轮，在中央线一次性展开；**离开 HQ 10+ 格的部署在第 5 轮之前不要出**（standoff 地图东西对角距 10）。

## 与历史对局对比

- **tg_0074_rank01（同 standoff 6 人标准，controlPoint=60 权重一致）：** 冠军同是以"先控 cp_1/cp_6 俩角→再压中心"开局，但决胜段**全程没进中央 5 格**，只靠远程 + 补兵站桩。本局验证了它的教训反版本：我在 R2 直插 cp_center 是 PvE 思维，在 PvP simultaneous 里=自摆靶子。
- **tg_0140_lose_OMP@dots3note-prev（simultaneous，HQ 存活但 0:7 CP，战败）：** 该对局同样因为开局 R1-R3 中央冒进丢中心、后续 AP 闲置率过高（每轮 5 AP 只用 2-3）而落败。两局共同规律：simultaneous 模式下 AP 闲置 = 行动力转化为 merit 的"漏钱"。修正方法：单轮 5 AP 应全投入为攻击或占点。
- **tg_0148_win_OMP@Dsv4.1Flash0910（standard，对称 HQ 局，15 轮 HQ 存活比分胜负）：** 该标准模式说明"HQ 压力可忽略"仅在双方都没有远程时成立。simultaneous 模式下，ranger 多的一方不仅是局部优势，更把 HQ 伤害权重 (5) 变成了主得分引擎——我本局完全没碰敌 HQ，但被打 119 (=595 分)。

## 总结

### 做得好的
1. **开局占点乘法：** R1 抢 cp_1 + R2 抢 cp_6 + cp_center，用 2 轮就把 CP 从 1 拉到 3，一度追平到 3:3（R3 live 快照 461 vs 536，仅落后 75 分）。这条开局路线在 numerical 上执行得很 close。
2. **行动力不浪费（前半程）：** R1、R2、R5 等关键回合 5/5 AP 用满，把 available action 都转成了 merit。
3. **残血反击：** scout `925b` 在 R7-R8 时只剩 23 HP 但继续执行侦察 + 骚扰，最终 merit 不落后太多（282 vs 敌 714 的 40%）。

### 下次改进
1. **不把 scout/inf 派进中央 5 格（即决条件：敌方有 1+ ranger 部署视野覆盖中央时）**。standoff 中央 (0,0) 是地图上最难守的点——6 个方向全暴露。
2. **ranger 入阵后的一律避射策略**：发现敌 ranger 锁定意图 → retreat 1-2 步 → 等敌方先交 AP 再反打。
3. **出兵优先级调整**：对家已出 2+ ranger、我方没 ranger 时，应该坚决"躲避+用 scout 偷点"，而不是"用 inf 填线换 merit"。
4. **知识内化**：每回合计划前先用 API 读 `game.units` 收集敌我所有 ranger / 游侠锁定攻击的位置，任一 case：看不到的地方不踏。

> **核心口诀：对峙之地不排陷阱，远射先于近战；十步之外不开战，占了中央须满阵。**

**一句话总结：我开局抢点的节奏和效率并不输对手，但在同时回合的核心博弈——远程权（ranger）之争上晚了半拍，一步慢、步步慢，终局被敌 ranger 在 HQ 刷走了 595 分的压倒性优势。**

---

*文档生成时间: 2026-09-24*
*回放格式版本: 3.5.5（hex-v2-replay）*
*AI 模型: CP@LongCat2.0（CatPaw / LongCat2.0）*
*本局存档: records/V3/tg_0161_20260924.json*
