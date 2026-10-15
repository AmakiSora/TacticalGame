# tg_0220 狭路相逢复盘（royale·narrow-road）

## 0. 局面概要

- **gameId**：`0b087f8c-436f-464e-8a8a-bea3d9165726`
- **回放**：`records/V3/tg_0220_20261012.json`
- **地图 / 模式**：`narrow-road`（狭路相逢） / `royale`（同时回合结算 × 歼灭缩圈）
- **人数**：2 人；我的席位 `player_a`，玩家名 **sp-DSH**；对手 `player_b`（Step5-DSH）
- **名次**：**第 2 名（lose）**，`rankings` 中 player_b rank 1 / player_a rank 2
- **终局**：`winner=player_b`，`reason=last_player_standing`，第 **15** 轮
  - 淘汰事件（seq 211）：`player_eliminated`，`reason=army_destroyed`（**战斗清场**，非炮火清场），`eliminatedBy=player_b`
  - 同轮 `control_point_neutralized`：`cp_2`（我方右据点）被中立化
- **本局 artillery 配置**：`startRound=10`、`intervalRounds=1`、`damage=5`、`minimumSafeRadius=1`
- **无回合上限**（`maxTurns: null`），全程无 HQ（`headquarters` 为空），据点权重 `controlPoint=0`、补给权重 `supplies=0`，实际计分只有 `armyValue×1 + killValue×1`

## 1. 结果一句话

Step5-DSH 靠**第 9 轮在狭路咽喉部署的 ranger**（射程 3）封锁住了我 heavy 的推进路线，随后每一轮收缩都稳稳把部队收进内圈；我在第 10–14 轮丢了 **6 个单位（价值 27）全被炮火吃掉**，第 15 轮最后一个 infantry 被他的 heavy 贴脸敲掉，army_destroyed 出局——输在**缩圈期的危险区纪律**，不是输在中期的正面换血。

## 2. 发育窗口（round < startRound = 1–9）

- **经济结构**：`baseIncome=5`、`controlPointTypes` 三种 kind 的 `income` 全为 0 → 据点只值**部署权**，不值钱。起始 20 补给，前 9 轮双方各净入 5/轮。
- **起手（round 1）**：本图 **零初始单位**，第 1 轮必须部署否则 round 1 结算即 `army_destroyed`。我 3 投：heavy(10) + infantry(5) + scout(4) = 19；对手同为 3 投 heavy + infantry×2 = 20。两边都踩线通过，`R1` 六条 deploy 全部 `executed`。
- **爆兵节奏**（9 次 deploy，各 9 投，完全对称）：
  - 我：heavy×1、scout×2、infantry×6
  - 对手：heavy×1、ranger×1、support×1、scout×2、infantry×4
- **部署垫**：`cp_2`（右，q=5,0）自始至终归我，未被争夺；`cp_1`（左，q=−5,0）归对手。`controlPoints=1` 对双方相同，此项无差别。
- **关键分歧在第 9 轮**：对手把 9 补给投成 **ranger**（hp 3、atk 7、射程 3），落在 q=−4,0 —— 正好钉在我 heavy 推进路线 q=−2…0 的射程边缘上。我同期把补给全换成 infantry 后排，此时我已经没有资源做同样的火力配置。这是本局的**分水岭**。

## 3. 缩圈期（startRound = 10 起）

- **警告**：seq 98 `artillery_warning` @round 9，`safeRadius=6`，`nextShrinkRound=10`，`warningCells` 已含 q=6,0 / q=5,1 / q=5,−1 / q=6,−1 等**我方后场格**。
- **收缩时间线**：`artillery_shrunk` 依次为 round 10→safe 5、11→4、12→3、13→2、14→1（`nextShrinkRound=null`，达到 `minimumSafeRadius`）。
- **每轮圈外掉血**（`artillery_damage` 汇总）：

| 轮次 | 我方 (player_a) 掉血 | 对方 (player_b) 掉血 |
|---|---:|---:|
| R10 | 10 | 10 |
| R11 | 15 | 14 |
| R12 | 12 | 14 |
| R13 | 5 | 10 |
| R14 | 4 | — |
| **合计** | **46**（6 个单位被炮火打死） | **48**（7 个单位） |

- **损失清单（我）**：scout@6,−1（R10 死）、scout@5,1（R10 死）、infantry@5,−1（R12 死）、infantry@5,0（R12 死）、infantry@4,1（R12 死）、infantry@2,0（R14 死）。
  单轮最多一次赔 3 个 infantry（15 造价）——因为我 R11 计划里三条 `move` 有多条被服务器判 `target is not reachable`，**撤离动作根本没排上**，结果原地挨打直到第 12 轮缩圈才整片清掉。
- **纪律评价**：`damage=5` 每轮全额扣除、**无视防御**。9hp infantry 在圈外 = **2 轮必死**；5hp scout = **1 轮必死**。我在 R9 拿到警告后仍在 R10 只排了 2 条 move（AP 5 条没用满），等于主动把 3 个后排单位留在圈里。
- **换血是否值得？** 不值得。R8 我 heavy 打死他 infantry（5 造价）换掉我 heavy 剩余 12hp；R9 他 ranger(7)+infantry(3) 打掉我的 heavy(10 造价)。用**全图最贵的 heavy** 去换**最便宜的 infantry**，且我 heavy 致死的那一击还被他同行 infantry 补刀——killValue 我 5、他 20。

## 4. 终局（safeRadius 达到 minimumSafeRadius=1 前后）

- **R13**：双方各 1 条 move。他在 (−1,0)→(0,0)，我 (3,0)→(2,0)。同轮炮火把我 (2,0) 的最后一个 infantry 打死（seq 192–193），`artillery_shrunk` 到 safe=1、`nextShrinkRound=null`。此时战场只剩内圈六格（中心 (0,0) 不可占）。
- **R14**：**我排了 0 条动作**（`round_resolved` 里 `player_a: []`）——我一个兵都没有可动的了。他 heavy 从 (0,0) 打 (1,0)，命中我最后的主力 infantry，5 伤害把它打到 4hp。
- **R15**：他 heavy 再打 (1,0) 补最后一击（actualDamage 4），我 infantry 在同一轮向 (0,0) 还手打出 3（他 heavy 剩 12hp）。**同时结算下我打不动他，我死了**。seq 209 `unit_death cause=attack`、seq 210 `cp_2` 中立化、seq 211 `player_eliminated army_destroyed`。
- **花心争夺**：他先占中心并守住 (1,0) 这条唯一接近路线，重型单位贴脸输出；我因为只剩一个 9hp infantry 且位置在 (1,0)（他的射程内），完全没有反制空间。

## 5. 裁决账本与击杀分

**最终分（`game_over.payload.scores`）**

| 项 | 我 player_a | 对手 player_b |
|---|---:|---:|
| headquartersDamage ×4 | 0 | 0 |
| ownHqHp ×2 | 0 | 0 |
| controlPoints / controlHold（权重 0） | 1 / 1 | 1 / 1 |
| armyValue ×1 | 0 | **8** |
| supplies ×0 | 42 | 36 |
| killValue ×1 | 5 | **20** |
| **total** | **5** | **28** |

> 关键观察：我结束时**囤了 42 补给**（对手 36），但 `supplies` 权重为 **0**。这 42 补给等于纯粹的沉没成本——前期供不上单价 7–10 的关键兵种（R9 只能买 5 块的 infantry），后期一分不值。这正是本图「**军力价值 + 击杀造价**才是真实竞赛」的直接体现。

**击杀造价来源**（按 `unit_death` 的最后一击归属）

- 我击杀：player_b 的 1 个 infantry（cost 5）→ `killValue=5` ✅ 与终局分吻合
- 对手击杀：我的 heavy(10) + infantry×2(10) = **20** ✅ 与终局分吻合
- 炮火击杀 13 个单位，**双方均不计入 killValue**（seq 117/119/121/135/139/157/159/161/163/176/178/180/193）

**军力价值曲线（存活单位造价和，粗估）**

| 轮末 | 我 | 对手 |
|---|---:|---:|
| R9（我 heavy 死后） | 23 | 29 |
| R12（炮火重创后） | 5 | 20 |
| R14 | **5** | **20** |
| R15 | **0** | **20** |

我 R12 从 23 掉到 5，是全盘的转折点。

**计划/执行账本**

- `plan_committed` 30 次 = 15 轮 × 双方，正常双提交，无超时。
- `round_resolved.results` 里 **A 方 0 条 `failed` / `missed` / `fizzled`**——计划阶段全数 `executed`；**唯一的 `missed` 出自 B 方 R12**（seq 171，ranger 瞄 (0,0) 落空）。
- **真正的浪费不在结算，在计划之前**：我的 `invalid_move: target is not reachable`（被友军/敌方占位或障碍阻断）与 `cell_occupied: target already claimed by your own planned action` 等多次 API 拒绝，使 AP 未能有效转化为动作。R14 直接排了 **0 条动作**。
- 整局 A 方实际入账动作数：deploy 9 + move 15 + attack 3 = **27 条**，而 15 轮 × 5 AP = **75 点**的预算被严重浪费。

## 6. 经验教训

1. **narrow-road 的重注必须在第 9 轮前下，不能等缩圈。** `supplies` 权重为 0、据点只管部署权，所以正确解是**把每一轮 5 补给都换成当下最能提高 armyValue/killValue 的兵种**，而不是存着。第 9 轮他 9 补给投 ranger 封锁咽喉，我却在同一窗口往后排铺 infantry——那 5 点差价决定了谁能打到我的 heavy。
2. **`artillery_warning` 出现的那一轮就是「最后一次能安全撤到圈外」的那一轮。** R9 拿到 `warningCells`（含 6,0 / 5,1 / 5,−1 / 6,−1），我 R10 却只排了 2 条 move；hp≤5 的 scout **一轮**就死、9hp infantry **两轮**就死。正确做法是 R10 计划里把全部 5 个 AP 排满移动，先保命再谈输出。
3. **同时回合下必须把行动目标和最终格算清再提交。** 我至少 5 次 `invalid_move`（友军占位、目标已被自己的计划占用、障碍阻断），直接导致 R14 交白卷、毫无还手能力。窄路图部署格极紧张，**每次 move 都要先对着当前棋盘核对目标格是否空且连通**，而不是先排后看。
4. **不要用最贵的兵去换最便宜的兵。** R9 我用 heavy 换 infantry（10 换 5）；若那次换的是他的 ranger（9）或 support（7），账本就是平的甚至正收益。同理，HP 低于对方单次最高伤害的单位（我的 3hp scout）绝不该进射程。
5. **终局要抢中心格，不是抢「安全」。** safe=1 后全图只剩内圈六格，他先占 (0,0) 并把最后一只兵停在 (1,0)（他的射程内、我的射程外）。我在 R12–R14 应该预留一个 AP 做**中心圈的站位竞争**，而不是把最后的兵停在推进路线上被动挨打。
6. **囤补给 = 0 分（本图 supplies 权重 0）。** 我带着 42 补给被淘汰，这是本局最直白的沉没成本；同样的钱在第 9 轮能换一个 ranger 或 support，直接改变第 10–15 轮的胜负。

---

*本复盘全部数字取自 `records/V3/tg_0220_20261012.json`（gameId `0b087f8c-436f-464e-8a8a-bea3d9165726`）。席位视角：player_a / sp-DSH。*
