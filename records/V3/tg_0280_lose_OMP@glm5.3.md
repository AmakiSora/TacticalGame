# tg_0279 镜湖复盘（royale·mirror-lake）

## 0. 局面概要

- **gameId:** `1a7aa36d-1be0-4f66-bfa0-b08872e03862`
- **地图 / 模式 / 人数:** mirror-lake / royale / 2 人
- **我的席位与名次:** player_b（GLM5.3-OMP），rank 2，被淘汰
- **终局 reason 与 winner:** `last_player_standing`，winner = player_a（GLM5.4Preview-PI）；我于第 12 轮 `army_destroyed` 被淘汰（eliminatedBy player_a）
- **本局 artillery 配置:** startRound 6 / intervalRounds 1 / damage 25 / minimumSafeRadius 1
- **裁决权重:** armyValue 5 / killValue 1.5 / 其余 0；maxTurns 30

### 最终账本

| | total | armyValue | killValue | CP | controlHold | supplies |
|---|---|---|---|---|---|---|
| player_a（胜） | 1564.5 | 162 | 503 | 3 | 2.36 | 558 |
| player_b（我） | 0 | 0 | 0 | 2 | 2.36 | 529 |

## 1. 结果一句话

对手靠"全程零死亡 + 集火点名"赢下这局：我在 R5–R11 被 arc/line/锁定连击持续点名（战斗承受 553 伤害、我方 6 次单位死亡、我全程 0 击杀），R8 湖心维修点易主后再无续航，R12 最后一个 40HP heavy 反击后被歼灭，army_destroyed 淘汰。

## 2. 发育窗口（R1–R5，round < startRound 6）

### 经济与爆兵

- 双方起始 260、收入每轮 52（base 20 + forward_base 20 + supply 12，全程 12 轮无变化）。
- **R1 爆兵对比**：
  - 我：heavy(100) + infantry(55) + ranger(80) = 235，剩 25；R2 再补 support(68)。
- 军力价值曲线（round_resolved 后结算）：

| 轮 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 我 | 477 | 545 | 545 | 545 | 447 | 385 | 329 | 299 | 196 | 99 | 46 | 0 |
| 敌 | 419 | 419 | 516 | 497 | 480 | 465 | 450 | 408 | 346 | 272 | 175 | 134 |

  R2–R4 我以 545 vs 419 领先约 126；从 R5 起被逐轮反超并拉开，至 R9 差距已不可逆。

### 据点争夺

- R1 镜像开局：我 scout 抢 cp_southwest，对手 scout 抢 cp_northeast，各 +12 收入。
- **R4 我占 cp_isle**（湖心维修点，repair 3/轮），这是我此局唯一的高光——用重 A 驻岛、步兵入位换防，R4–R7 吃到维修。
- **R8 湖心易主**：对手步兵 19255c93 抢进 (0,0)，cp_isle → player_a。此后维修归对手，我彻底失去续航来源。

## 3. 缩圈期（R6–R10，startRound 起）

### 炮火时间线

| 轮 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|
| safeRadius | 5 | 4 | 3 | 2 | 1（下限） | 1 | 1 |

- 炮火总伤害：我吃 195，对手吃 305。对手单位更多滞留圈外（他们的 heavy 48a097c8 在 (2,-2)/(2,0) 一带长期贴圈流血），但对手用更大的血池硬扛住了；我方流血集中在 R9–R10 的撤退途中。
- 炮火清场死亡：对手 3 个（bca0d756 R8、a9343644 R10、218e2908 R11），我 1 个（a320f349 R10，scout 在 (-4,4) 被收走）。

### 接触战与我的失败清单（回放 round_resolved 原因统计）

| 轮 | 我的失败动作 | 原因 | 后果 |
|---|---|---|---|
| R5 | deploy heavy @(-5,1) | `destination_occupied` | 少一个重型，此后再无成建制增援 |
| R6 | move support (-3,0)→(-2,0) | `destination_occupied` | 队列后续 heal 连锁失败，整轮只执行 1 步 |
| R7 | move support →(-2,0) | `destination_occupied` | 同一格连堵两轮 |
| R8 | move heavyA (0,1)→(-2,2) | `unit_gone`（重 A 已被 arc+锁定集火杀死） | 岛内 30HP 重 A 暴毙 |
| R9 | move heavyB →(1,-1) | `destination_conflict`（对手 ranger 同步抢占） | 重 B 的 arc 攻击 `previous_action_failed`，一整轮输出落空 |
| R10 | heal aim (-1,1) | `fizzled: artillery_zone` | 唯一治疗落空 |
| R11 | heal aim (-2,0) | `failed: unit_gone`（support 已被敌 arc 一发带走） | 治疗体系崩塌 |

- **对手集火点名模式**（回放 attack hits 逐轮核对）：R5 起 arc 重型 + line 步兵 + attackLock ranger 三件套对我前排持续叠伤。我的重 A（140HP）被 R5–R8 连续四轮点名（31/32/32+24/30，湖心维修每轮仅回 3），R8 死亡；重 B 在 R9–R11 三轮内被打空（121→76→28→死）。
- **我方输出对照**：全程 9 次命中、共 256 伤害、0 击杀——ranger 两次锁定磨敌重型 27+23 未收掉（R4/R5），infantry line 与 heavy arc 的伤害都发生在 R11–R12 部队将崩时，为时已晚。
- 交换率复盘：553 承伤/256 输出 ≈ 2.2:1。对面用更少的总动作数（对手多次 attack missed/failed）换掉了更多有效伤害——核心差距是**集火目标选择**（他们每轮点名同一残血单位直至击杀吃 killValue），而我分散磨血、一个都没收掉。

## 4. 终局（R10 起 minimumSafeRadius 达成）

- R10 起安全区锁死半径 1，只剩中心 7 格。此时我 99 军力价值 vs 对手 272，且唯一空格 (1,-1) 与对手 ranger 竞争（R9 的 destination_conflict 已预演）。
- 对手在终局区保持 5 单位（2 heavy + scout + ranger + infantry），我方 4 单位且无支援。
- **R11 是死局确认**：对手 heavy 48a097c8 arc 一发带走我 support（15HP 残血，`unit_gone` 导致我的 heal 落空），infantry line + ranger 锁定同轮点掉重 B 与步兵，我单轮承受 3 次单位死亡。
- R12 我最后一个 40HP heavy 从 (-2,0) 移 (-1,0) 打出弧形（命中敌步兵 32 + 敌重 31，仍未击杀），随即被 ranger(27) + infantry line(13) 收尾，`player_eliminated: army_destroyed, eliminatedBy: player_a`。
- 湖心维修点的归属在终局无实质意义：R8 易主后双方的repair收益都终止于 R9（圈外/占位问题），终局拼的是纯火力与血池。

## 5. 裁决账本与击杀分

- **killValue 差距即胜负**：对手 503 = 6 次战斗击杀造价之和（ranger 80 + heavy 100 + support 68 + infantry 55 + heavy 100 + heavy 100 = 503，逐次核对自回放 killed 标记；我另有 1 个 scout 死于炮火、无归属），我 0。歼灭权重 1.5 下，击杀差 503×1.5 ≈ 755 分，超过我全程任何时点的军力价值峰值 545。
- **armyValue 5 倍权重下军队价值曲线才是主线**（见第 2 节表）：R4 我的峰值 545 若能保持，仅此一项即 2725 分。输在曲线斜率：每轮净损 ~50–80，对手每轮净损 ~15–30。
- **AP 浪费清单**：我 12 轮共 96 AP 预算，失败/落空/失效合计 9 次（上表），另有 R3–R4 部分步用于纯走位。对手同样有 7 次非执行，但他们的失败集中在早期 deploy 与终局 missed，关键集火步从未浪费。
- **屯补给无意义**（supplies 权重 0）：我终局剩 529、对手 558，双双归零分。R5 之后 deploy 均非法（炮火区），钱花不出去是双输，但对手在窗口期已把钱变成了 6 个单位，我只有 4 个。

## 6. 经验教训（可执行）

1. **集火点名优先于分散磨血**：对手每轮所有火力指向同一个残血单位直到击杀（killValue 全额入账 + 削 armyValue），我全程 0 击杀直接葬送 1.5 权重的得分主线。可执行规则：每轮规划时先算"谁这轮能被集火致死"，多个半血目标不如一个能收掉的。
2. **部署垫纪律**：cp_west 只有 6 个邻格，R5 的 `destination_occupied` 和 R6/R7 支援堵路连续报废了 3 个 AP——部署垫周边两格要视为"预留区"，计划序列里先把占位单位移走再 deploy/过路。
3. **队列顺序是时间线，抢格要预判对手镜像**：R9 重 B 与对手 ranger 同步争 (1,-1) `destination_conflict`，直接把整轮 arc 输出变成 0。同时回合下向争夺格的移动应该放在更早的 step，或选择对手到达不了的次优格，绝不能把依赖它的攻击排在后面空放。
4. **支援单位的终局定位**：heal 在炮火区全非法（R10 `artillery_zone` fizzled）、支援本体 15HP 时会被一发 arc 点名（R11）。支援的正确用法是缩圈前（R6–R8）就贴住主力换伤把血池垫厚，而不是留在后排等一个注定非法的治疗窗。
5. **岛可以换，血池不能换**：R4 占 cp_isle 拿到维修是正分操作，但 R8 岛易主后我仍让重 A 驻岛等维修（30HP 暴毙），错误地用不可再生的主力去守一个 3HP/轮的收益。据点权重为 0 的地图上，据点只服务收入/维修，不值得用残血主力殉葬。
