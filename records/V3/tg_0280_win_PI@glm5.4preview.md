# tg_0279 镜湖复盘（royale·mirror-lake）

> 席位：player_a（GLM5.4Preview-PI），胜利方。数据全部取自回放 `tg_0279_20261124.json`（281 事件，schemaVersion 3.9.11）。

## 0. 局面概要

- **gameId:** `1a7aa36d-1be0-4f66-bfa0-b08872e03862`
- **地图 / 模式 / 人数:** mirror-lake（镜湖）/ royale / 2 人
- **我的席位与名次:** player_a（GLM5.4Preview-PI，出生槽 `slot_east`），`rankings` 中唯一 `rank: 1` → **win**
- **对手:** player_b（GLM5.3-OMP，出生槽 `slot_west`），rank 2
- **终局:** `game_over.reason = last_player_standing`，winner = player_a；对手于第 12 轮 `player_eliminated: army_destroyed`，`eliminatedBy = player_a`（战斗清场，非炮火清场）
- **本局 artillery 配置:** startRound 6 / intervalRounds 1 / damage 25 / minimumSafeRadius 1
- **其它本局参数:** 起始补给 260、baseIncome 20、actionsPerTurn 8、maxTurns 30、damageVarianceRange 2；裁决权重 armyValue 5 / killValue 1.5，HQ·据点·补给权重均为 0
- **开局单位:** 每方 2 heavy + 1 scout；`headquarters` 为 `{}`，全程无任何 HQ 事件（正常）

### 最终账本（`game_over.payload.scores`）

| | total | armyValue | killValue | CP | controlHold | supplies |
|---|---|---|---|---|---|---|
| player_a（我，胜） | 1564.5 | 162 | 503 | 3 | 2.36 | 558 |
| player_b | 0 | 0 | 0 | 2 | 2.36 | 529 |

## 1. 结果一句话

我在第 6 轮用 heavy 弧形抢下首杀后，连续 7 轮"每轮点名同一个残血目标直到击杀"，对手 7 个单位全部死于战斗（6 个最后一击归我，killValue 503）；对手全程只打出 6 次命中、0 击杀，第 12 轮最后一个 40HP heavy 被 ranger 锁定 + 步兵直线收尾，全军覆没。

## 2. 发育窗口（R1–R5，round < startRound 6）

### 经济

- 双方收入完全对称：每轮 52（base 20 + forward_base 20 + supply 12），R2–R12 共 11 次入账，全程无变化。
- R1 双方 scout 镜像抢点：我 a9343644 占 `cp_northeast`，对方 a320f349 占 `cp_southwest`（均在 R1 结算时 `control_point_captured`）。

### 爆兵对比

| 轮 | 我（player_a） | 对手（player_b） |
|---|---|---|
| R1 | scout 42 + ranger 80 + infantry 55 = 177 | heavy 100 + infantry 55 + ranger 80 = 235 |
| R2 | （deploy 失败 1 次） | support 68 |
| R3 | infantry 55 + scout 42 = 97 | — |
| 合计 | 5 次部署，274 补给，8 个单位 | 4 次部署，303 补给，7 个单位 |

我选择了"轻前排 + 远程"：ranger 攻击范围 3 且带 `attackLock`，在镜湖的东西栈道上可以隔一格打人，而对方把首笔钱花在第三个 heavy 上，前排更肉但手短（range 1）。

### 军力价值曲线（按 `round_end` 时刻存活单位 `round(cost·hp/maxHp)` 重算；末值 162 与 `game_over.scores.player_a.armyValue` 一致）

| 轮 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 我 | 419 | 419 | 516 | 497 | 480 | 465 | 450 | 408 | 348 | 281 | 192 | 162 |
| 对手 | 477 | 545 | 545 | 545 | 447 | 389 | 337 | 307 | 204 | 107 | 46 | 0 |

R2–R4 对手领先约 128–129 点军力，R5 首次交火即反超，此后每轮差距扩大 40–100。

### 部署垫

- `cp_east` 全程在我手里，但 **R7 起安全半径 ≤ 3 时 cp_east (5,0) 已在炮火区内**，从此无法再部署——双方都一样，所以终局前双方都剩 500+ 补给花不出去（supplies 权重为 0，不计分）。
- 发育期我在 cp_east 邻格上连续 3 次 `destination_occupied`（见第 5 节），这 3 个 AP 本可以多部署一个 infantry。

## 3. 缩圈期（R6–R9，startRound 起）

### 炮火时间线

| 事件 | 轮 | safeRadius |
|---|---|---|
| `artillery_warning` | R5 | 6（外环预警） |
| `artillery_shrunk` | R6 / R7 / R8 / R9 / R10 | 5 → 4 → 3 → 2 → 1（达到 minimumSafeRadius，`nextShrinkRound = null`） |

- 炮火总伤害：**我 305（13 次）**，对手 195（8 次）。我吃的炮火明显更多——不是因为没看圈，而是因为我的单位更多、且 3 个便宜单位（2 scout + 1 infantry）被我当作"能换就换"的弃子留在外面拖延。
- 因炮火减员：我 3 个（scout bca0d756 R8 @4,-1、scout a9343644 R10 @3,-3、infantry 218e2908 R11 @4,0），对手 1 个（scout a320f349 R10 @-4,4，它在西南补给点上一直没动）。
- 这 3 次炮火死亡都不计 killValue，对 armyValue 的损失合计约 139 点（42+42+55），换来的是主力 heavy 双双完整进入内圈，并且对手的重型被迫在圈外多挨了 3 次 25 点（R9–R12 heavy 4954aa96 每轮 -25）。

### 接触战逐轮

**R4：第一次交火，双方都没打到人**
- 我的 heavy 从 (2,0) 弧形瞄 (1,0)、infantry 直线瞄 (1,0)，都 `missed`——对手在 s1 把 heavy 从 (0,0) 移到 (0,1)、s2 把 infantry 从 (-1,0) 移到 (0,0)、s3 把 ranger 从 (-2,0) 移到 (0,-1)，我瞄的是对手"计划时"的位置。
- 对手 ranger 从 (0,-1)（s3 到位）锁定我 heavy (2,0)，s4 命中 27（heavy 140→113）。**锁定 vs 瞄格**的差异在这里第一次体现：瞄格攻击要预判对手下一步，锁定只要目标还在射程内就必中。
- 对手 infantry 在 R4 结算时占 `cp_isle`（湖心维修点），R4–R8 维修归对手（合计 +24 HP）。

**R5：弧形三连中，战局逆转**
- 我 heavy 移到 (1,0)，弧形瞄 (0,0)：覆盖 (0,0)、(1,-1)、(0,1) 三格——正好是对手 heavy (0,1)、infantry (0,0)、ranger (0,-1→1,-1) 三个单位结算后的位置，一次攻击动作打出 35 + 34 + 31 三段伤害。
- infantry 从 (3,0) 到 (2,0) 再直线瞄 (0,0)，补 23 点在对方 infantry 上。
- 对手 ranger 锁定我 heavy 再中 23（113→90）。本回合我打 123，对方打 23。

**R6：首杀**
- 对手 infantry 从 (0,0) 撤到 (-1,0)，我的步兵直线 / ranger 单发 / scout 单发全部瞄在 (1,-1) 或 (0,0) 落空（3 个 `missed`）。
- 但 heavy 弧形瞄 (0,0) 覆盖到 (1,-1)：对方 ranger 33HP 被 39 点收掉（R6 s1 `unit_death ... cause=attack`），同时 (0,1) 的 heavy 再吃 32。
- 教训：这一轮我把 4 个 AP 花在同一个人身上，只有 1 个命中；如果对手 ranger 那一步是"移动"而不是"站着"，弧形也只会打到空格。**弧形能同时覆盖 3 格，是镜湖内圈唯一稳定的"预判"手段**，而单发瞄格在对手会动的情况下基本是赌。

**R7：压制 heavy**
- heavy 弧形 (0,1) 32 点、ranger 锁定 (0,1) 24 点、infantry 直线瞄 (-1,1) 22 点。对方 heavy fd4d255d 从 83 被压到 27。
- 对手这一轮只提交了 1 个动作（support 移动失败 `destination_occupied`）——它的主队列在 R6–R7 几乎瘫痪。

**R8：第二杀 + 湖心易主**
- heavy 弧形 (0,1) 32 点收掉 fd4d255d（R8 s1 `unit_death`），这是我第一个"连续 4 轮点名同一个 heavy 直到死"的完整闭环。
- infantry 从 (1,-1) 进 (0,0)，`control_point_captured cp_isle → player_a`；R9–R12 维修归我（合计 +39 HP，主要给我前排 heavy）。
- ranger 锁定 (-1,0) 的对方 infantry，`missed: target_escaped`——对手 infantry 从 (-1,0) 跑到 (-2,2)，超出了 ranger (2,0) 的射程 3。**锁定只保证"在射程内必中"，不保证"跑不掉"**，对机动 3 的 infantry 要先把它逼到射程内再锁。

**R9：最差的一轮（2 执行 / 6 失败）**
- 开局两发命中：infantry 直线瞄 (-1,1) 一条线穿过 (-1,1) 和 (-2,2)，同时打中 heavy 21 点、infantry 26 点；ranger 锁定 (-1,1) heavy 24 点。
- 之后 6 个动作连续失败：
  - s3 ranger (2,0)→(1,-1) 与对方 heavy da2706e1 →(1,-1) **同一步争同一格**，双方都 `destination_conflict`，对方后续的弧形攻击也因此 `previous_action_failed`（这一下是互相抵消，不亏）。
  - s4 heavy (1,0)→(0,1) `destination_occupied`：对手 infantry 在 s2 已经进 (0,1)，我的弧形攻击随后 `previous_action_failed`。
  - s6 scout (0,-1)→(-1,0)、s7 heavy (2,-2)→(0,-1)、s8 infantry (4,0)→(2,0) 全部 `destination_occupied`——都是"假设自己人前一步已经让开"的链式移动，链条第一环断了，后面全废。
- 对手这一轮打出 51 点（infantry 直线两发），是它全程伤害最高的一轮。

## 4. 终局（R10 起 minimumSafeRadius = 1）

R10 起安全区锁死在中心 7 格：`(0,0) (1,0) (1,-1) (0,-1) (-1,0) (-1,1) (0,1)`，圈外每轮 -25。

### 站位（R10 计划时）

```
        (0,1) 对手inf 16HP     (1,-1) 对手ranger(尸体)/空
(-1,1) 对手heavy 28   (0,0) 我inf 69   (1,0) 我heavy 96
(-1,0) 对手support 15   (0,-1) 我scout 46
(-2,0) 对手heavy 65(圈外)   (2,-2) 我heavy 115(圈外)   (2,0) 我ranger 43(圈外)
```

- 我 R10 把 heavy (2,-2)→(0,-1)（s6 成功）、scout (0,-1)→(0,1)（s5 成功）；ranger (2,0)→(1,-1) 在 s4 `destination_occupied`——对手 infantry 在 s1 已经先跑进 (1,-1)，中心区最后一个空格就此易手。对手 heavy (-2,0) 想进 (-1,0) 却被自己的 support 占着，R10–R12 连吃 3 次炮火（-75）。

### R10–R12 收割

| 轮 | 我的关键动作 | 结果 |
|---|---|---|
| R10 | heavy 弧形 (0,1) `missed`（对手 inf 同步跑到 (1,-1)）；ranger 锁 (-1,1) 23；infantry 直线 (-1,1) 20；scout 单发 (-1,1) 5；heavy 弧形 (-1,0) 36 | 对手 heavy 28 残血，support 76→15 |
| R11 | heavy 弧形 (-1,0) 36 → **support 死**；infantry 直线 (-1,1) 22 → heavy 剩 6；heavy 弧形 (1,-1) 32 → **infantry 死**；ranger 锁 (-1,1) 27 → **heavy 死** | 对手只剩 1 个 40HP heavy；它 R10 的 heal `fizzled: artillery_zone`、R11 的 heal `failed: unit_gone` |
| R12 | ranger 锁 (-2,0) 27 → heavy 13；infantry 直线 (-1,0) 21 → **heavy 死** | `player_eliminated: army_destroyed` |

- R12 ranger 锁定的是 (-2,0)——对手 heavy 计划时的位置；它同一步移到 (-1,0) 后仍在 ranger (1,-1) 的射程 3 内，所以锁定必中。**锁定"格"而不是"单位"，但只要目标没跑出射程就一定挨打**，这正是对机动 2 的 heavy 用锁定最稳的原因。
- 对手 R12 的最后一击：heavy 弧形 (0,0) 命中我 infantry 32、heavy 31，但都没打死——它从头到尾没有一次"集火到死"。

## 5. 裁决账本与击杀分

### 击杀造价（killValue 503，逐条来自 `attack` 事件 `targetHp = 0`）

| 轮 | 最后一击 | 目标 | 造价 | 此前点名它的轮次 |
|---|---|---|---|---|
| R6 s1 | heavy 弧形 | ranger | 80 | R5（35） |
| R8 s1 | heavy 弧形 | heavy fd4d255d | 100 | R5 / R6 / R7 / R8（31+32+32+24+32，维修 +9） |
| R11 s1 | heavy 弧形 | support | 68 | R10（36） |
| R11 s3 | heavy 弧形 | infantry | 55 | R5 / R9（34+26） |
| R11 s4 | ranger 锁定 | heavy da2706e1 | 100 | R7 / R9 / R10 / R11（22+21+24+23+20+5+22） |
| R12 s2 | infantry 直线 | heavy 4954aa96 | 100 | R12（27+21）+ 炮火 -75 |

503 × 1.5 = 754.5 分，占我 total 的 48%；armyValue 162 × 5 = 810。

### 伤害账（`attack` 事件）

| | 攻击动作 | 命中动作 | 落空 | 失败 | 总伤害 | 击杀 |
|---|---|---|---|---|---|---|
| 我 | 29 | 19 | 10 | 0（另有 2 次 `previous_action_failed` 未计入攻击动作） | 624 | 6 |
| 对手 | 6 | 6 | 0 | 0 | 256 | 0 |

- 按形状：弧形 9 动作 / 7 中 / 339 伤害；直线 9 / 6 / 155；锁定 6 / 5 / 125；单发无锁 5 / 1 / 5。
- **弧形是我 54% 的伤害来源和 4/6 的击杀**，且它是唯一能"一发覆盖三格"的形状——在对手会动的同时回合里，这是命中率最高的预判手段。
- 对手命中率 100% 但只有 6 次出手：它 R6–R8 每轮只提交 1–4 个动作，R7 只有 1 个动作且失败。

### 动作 / AP 账（`round_resolved.results`）

| | 计划动作 | executed | failed | missed | fizzled |
|---|---|---|---|---|---|
| 我 | 77 / 96 AP | 54 | 13 | 10 | 0 |
| 对手 | 47 / 96 AP | 39 | 7 | 0 | 1 |

我的 AP 浪费清单（23 个非执行动作）：

| 原因 | 次数 | 轮次 | 本可避免？ |
|---|---|---|---|
| `destination_occupied`（deploy） | 2 | R2、R4 | 是——cp_east 邻格被自己刚部署的单位占着 |
| `destination_occupied`（move） | 8 | R4、R5、R7、R9×4、R10 | 是——全是"假设前一步自己人已让开"的链式移动 |
| `destination_conflict` | 1 | R9 | 否——与对手争 (1,-1)，对手也失败了 |
| `previous_action_failed` | 2 | R5、R9 | 是——依赖前面失败移动的攻击 |
| `missed`（瞄格落空） | 10 | R4×2、R6×3、R8×3、R10、R11 | 部分——R6/R8 对会动目标的单发/直线瞄格是赌 |

- 最贵的一轮是 R9：8 AP 只执行 2 个。**链式移动"单位 A 让位 → 单位 B 进位 → B 攻击"在同一步内是允许的（出发先于到达），但 A 的让位本身如果失败，后面整条链都作废**；对关键链条应把"让位"放在更早的 step，或者不要依赖让位。

### 炮火账

| | 炮火 tick | 总伤害 | 减员 |
|---|---|---|---|
| 我 | 13 | 305 | 3（2 scout + 1 infantry，合计 139 军力价值） |
| 对手 | 8 | 195 | 1（scout） |

- 我的 scout bca0d756 在 R6–R8 连续 3 轮各吃 25（(6,-2) → (5,-2) → (4,-1)）直到死亡——它每轮只走 1 步、始终贴在圈边，**撤离速度刚好等于缩圈速度时，就是在慢性自杀**；scout 机动 4，本可以一轮跳 2–3 环。
- infantry 218e2908 在 (4,0) 从 R8 待到 R11 连吃 4 次（-90）。我 R7、R9 两次给它排了撤离（→(3,0)、→(2,0)），都因为目标格被自己人占着 `destination_occupied`——**撤离路线排在 step 8、目标格又是别人正要离开/正要进入的格子，等于没排**。它值 55，我用它换了对手 heavy 3 轮 75 点炮火伤——从结果看不亏，但这是"没排成"而不是"算过"。

## 6. 经验教训（可执行）

1. **弧形瞄准"对手结算后最可能站的 2–3 格"，而不是它现在站的格。** 镜湖内圈只有 7 格，对手能去的格子本来就少；R5 的 35+34+31 三连中和 R6/R8/R11 的三次击杀全是弧形覆盖到"邻格"打出来的。规划时先列出对手每个单位下一步的可达格，找一个 heavy 邻格能同时盖住其中 2 个以上的格子，再决定是否值得让 heavy 先走一步。
2. **锁定用来"收尾"，不用来"开团"。** ranger 锁定 6 次 5 中，唯一的 miss 是 R8 对机动 3 的 infantry（它跑出射程 3）。对 heavy（机动 2）锁定在射程 ≤ 3 时几乎必中（R7/R9/R10/R11/R12 五次全中）；对 scout/infantry 要先算它下一步能否跑出射程，跑得出就改用弧形封路或干脆不打。
3. **链式移动要按"最坏情况"排 step，并且不要让攻击排在链条末尾。** R9 的 6 连败、R5 的 `previous_action_failed`、R4/R7 的 deploy 落空，根因都是"假设前一步会成功"。规则：被依赖的让位移动放在 step 1–2，依赖它的攻击放在让位**确认成功后的下一轮**，或者选择一个不依赖让位的目标格；每轮提交前对每个 move 问一句"如果这一步失败，后面有几个动作陪葬"。
4. **缩圈期的撤离要按"环数差"算，不按"是否在圈里"算。** 我 3 个单位死于炮火（139 军力价值），都是"每轮走 1 步、贴着圈边走"；对手 heavy 也因为 support 堵路在圈外连吃 3 轮。可执行规则：当单位所在环数 − 当前 safeRadius ≥ 1 且下一轮要缩圈时，这一轮必须把全部机动用于向心移动，并把它的移动排在 step 1；绝不要把一个 70HP 的 scout 留在 warning 环上"再看一轮"。
5. **发育期的 deploy 格要和"作战序列"分开。** R2/R4 两次 deploy 落在 (4,0) 都是因为我同轮还安排了别的单位从/往 (4,0) 走。cp_east 有 6 个邻格，但 (4,1) (5,1) 是 blocker、(4,-1) (6,-1) (6,0) (4,0) 才是平原；把 (4,0) 固定为"部署专用格"、其它单位一律不碰，就能把 2 个废 AP 变成 1 个 infantry。
6. **中心区的入口格要先占，而且要用便宜、不依赖让位的单位去占。** R10 我用 46HP 的 scout 从 (0,-1) 一格跳进 (0,1) 占住了一个安全格，同时对手 infantry 抢到了 (1,-1)、它的 heavy 被自家 support 堵在圈外 3 轮；而我的 ranger 想进 (1,-1) 时已经晚了一步（s4，对手 s1 已到）。**向争夺格的移动要放在 step 1，并且出发格要是"现在就空、没人要走"的格子**。规则：缩到半径 2 时就规划"中心 7 格我至少要占 4 格、其中 1 格留给 heavy 从圈外进来"，入口格 (-1,0)/(0,-1)/(1,-1) 不要站支援。
7. **击杀比伤害值钱 1.5 倍——每轮规划先算"这轮谁能被打死"。** 我 29 个攻击动作 624 伤害换 6 杀（503 killValue + 对手 armyValue 归零）；对手 6 个动作 256 伤害 0 杀。同样是打 heavy，我 R5–R8 四轮全盯 fd4d255d（死了），对手 R4–R5 两轮打我 heavy 50 点就换目标（我 heavy 活到最后 102HP）。
