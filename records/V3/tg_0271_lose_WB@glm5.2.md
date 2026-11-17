# tg_0271 镜湖复盘（royale·mirror-lake）

## 0. 局面概要

- **gameId:** `43de98cd-8a38-472a-a92d-eba8dc76dd1a`
- **地图 / 模式 / 人数:** mirror-lake / royale / 2 人
- **我的席位与名次:** player_b（GLM5.2-WB），rank 2，被淘汰
- **终局 reason 与 winner:** `last_player_standing`，winner = player_a（Hy4Flash-WB）；我于第 16 轮 `army_destroyed` 被淘汰
- **本局 artillery 配置:** startRound 6 / intervalRounds 1 / damage 25 / minimumSafeRadius 1
- **裁决权重:** armyValue 5 / killValue 1.5 / 其余 0；maxTurns 30

### 最终账本

| | total | armyValue | killValue | CP | controlHold | supplies |
|---|---|---|---|---|---|---|
| player_a（胜） | 1147.5 | 48 | 605 | 3 | 2.47 | 550 |
| player_b（我） | 715.5 | 0 | 477 | 2 | 2.4 | 470 |

## 1. 结果一句话

对手用 4-heavy 集团在缩圈后的中心 7 格碾压了我的均衡阵容（ranger+support 脆皮单位在拥挤区无处可藏）；我在 R9 support 被击杀后失去续航，R12 ranger 被对手 heavy 连杀后崩盘，最终 R16 最后一个 2HP heavy 被歼灭、army_destroyed 淘汰。

## 2. 发育窗口（R1–R5，round < startRound 6）

### 经济与爆兵

- 双方起始补给 260、基础收入 20、forward_base 收入 20。R1 双方各用 ~200 补给 deploy 3 单位：
  - 我：infantry(55) + ranger(80) + support(68) = 203，剩 57
  - 对手：heavy(100) ×2 + infantry(55) = 255，剩 5
- **阵容分野**：我走均衡（2 heavy 初始 + ranger 远程 + support 治疗 + infantry 占点），对手走 4-heavy 重军事化（初始 2 heavy + deploy 2 heavy）。这决定了后半程的结局。
- R3 双方各再 deploy 一个（我 infantry+ranger，对手 ranger），R5 我补 deploy 一个 infantry。收入全程对等（每轮 52：base 20 + forward_base 20 + supply 12）。

### 据点争夺

- R1：我 scout 抢 cp_northeast（东侧 supply），对手 scout 镜像抢 cp_southwest（西侧 supply）。对称。
- R3：我 scout 从 (4,-4) 长途奔袭至 (0,0) 占领 cp_isle（湖心维修点）。这是我的高光——中心维修点 + 中心位置，后续给对手制造了很大压力。
- R5：双方 ranger 在中心区互换——我 ranger d672a324（attackLock 锁定）打死对手 ranger b90b705f（38 dmg kill），对手同时打死我 ranger（32 dmg kill）。双方各损 80 cost ranger，killValue 互换 80。

### 关键失误

- R3 我计划 heavy (1,0)→(-1,0) 接敌 attack (-2,0)，但对手同 step 先 move 到 (-1,0)，我的 move `destination_occupied` 失败，heavy 留 (1,0) 无法 attack（out of range），`previous_action_failed`。**这是首次"同时回合抢占同一格"的教训：高价值接敌 move 容易和对手撞车。**

## 3. 缩圈期（R6–R10，startRound 起）

### 炮火时间线

| 轮次 | safeRadius | 事件 |
|---|---|---|
| R5（预警） | 6 | artillery_warning，下一轮首缩 |
| R6 | 5 | 首次收缩 |
| R7 | 4 | 对手 1 单位吃 25 |
| R8 | 3 | 双方各多单位吃 25（我 3 次，对手 2 次） |
| R9 | 2 | 我 4 次吃 25，对手 2 次——**掉血最惨的一轮** |
| R10 | 1（下限） | 我 6 次吃 25/20，对手 2 次 |

### 接触战与减员

- **R6（safeRadius 5）**：我三火力集杀对手 ed8dd247 heavy（77HP → 23-27+29-33+23-27 = 死，killValue +100），但对手 ed8dd247 同轮反击杀我 heavy b7976a8a（32 dmg kill）。互换 heavy（100 vs 100），但我的 heavy 只剩 19HP 时才被打死，对手 heavy 77HP 被我集火——**这次互换我赚了过程分但亏了位置**（我的 heavy 在 (0,0) 中心被歼，对手 heavy 在 (0,-1)）。
- **R8（safeRadius 3）**：我 ranger 94fa6166 从 (2,0) 移到 (0,0) 后 attack 锁杀对手 7750e9bf heavy（25+26+30 = kill，killValue +100），但对手 7750e9bf 同轮反击杀我 ranger（35 dmg kill）。又是 ranger(80) 换 heavy(100)——killValue 赚 20，但失去 ranger 远程 DPS。
- **R9（safeRadius 2）——崩盘起点**：对手 3576f83f infantry 打死我 support 4bc671bc（28 dmg kill，killValue +68 给对手）。**support 是我唯一治疗单位，它一死就没了续航**。同轮我 heavy 打对手 7886bbff heavy（32 dmg）。
- **R10（safeRadius 1，中心 7 格决战）**：炮火 + 拥挤双重绞杀。我 scout e3513659 被炮火清场（无人得分），scout d73182a7 被对手 230af6a4 heavy 打死（38 dmg kill）。对手 230af6a4 heavy 这轮连续 attack 我 scout + 其他——**heavy arc 在拥挤中心区的面杀伤开始碾压**。

### 危险区纪律评估

- R8 我才开始撤边缘单位，太晚。cp_east (5,0) 距中心 5，R7 safeRadius 4 时已变 danger，R7 就该撤，我却把 infantry (5,-1) 留到 R8。
- R9-R10 大量单位（infantry (2,2)/(4,-1)/(3,0)/(3,-3)、scout (3,-3)/(2,-2)）被困在 dist≥3 区域，周围全是水域/障碍/己方单位，**撤退路线被地形锁死**，每轮吃 25 全额掉血。这是 mirror-lake 地形在缩圈后的致命陷阱。

## 4. 终局（R10–R16，minimumSafeRadius 1 达成后）

### 中心 7 格争夺

R10 safeRadius 1 后只有 dist≤1 的 7 个格子安全（中心 (0,0) cp_isle + 周围 6 格）。双方残部挤在这 7 格里血战。

- **R11——回光返照**：我 heavy a9253896 + ranger 4ab7620d + infantry 8d563800 三火力集杀对手 (0,0) 步兵 eb515887（9HP，heavy 33+... kill，killValue +55），ranger 锁杀对手 (-2,2) scout 74254950（30 dmg kill，killValue +42）。单轮双杀，killValue +97。但对手 (-1,1) infantry 同轮打死我 ranger 4ab7620d（29 dmg）——ranger 只剩 14HP 勉强活。
- **R12——致命打击**：对手 230af6a4 heavy 连续 attack，打死我 infantry 8d563800（34 dmg kill）+ ranger 4ab7620d（37 dmg kill）。我 ranger 死后再无远程 DPS。同轮我 heavy 杀对手 7886bbff heavy（33 dmg kill，killValue +100）。但 **ranger 阵亡 = 我失去了唯一的远程输出**。
- **R13——最后的击杀**：我 heavy a9253896 从 (0,-1) 移到 (0,0) 躲避对手 attack（对手瞄准 (0,-1) 落空），从 (0,0) attack 杀对手 7886bbff heavy（30 dmg kill，killValue +100）。同轮对手 (-2,0) heavy d760d02f 被炮火清场（15HP，无人得分——我没能抢到击杀）。**这轮我利用了"同时回合攻击瞄准格子、单位移走则落空"的规则，是全局最聪明的一手**。
- **R14–R15——2HP 残局**：只剩 heavy a9253896（2HP）。我用同样的"空格躲避"技巧反复周旋：移到对手无法预锁的空格，对手 attack 我的旧位置落空。R15 我的 move 和对手 move 撞 (0,0) `destination_conflict`，attack 都 `previous_action_failed`——双方都没打中。
- **R16——终局**：对手 230af6a4 heavy 终于打到我的 heavy（29 dmg kill，killValue +100 给对手）。我最后一个单位死亡，`army_destroyed` 淘汰。

### 打光淘汰顺序

我 12 个单位全部阵亡，淘汰 reason = `army_destroyed`，eliminatedBy = player_a。对手剩 2 单位（heavy 230af6a4 hp 53、infantry 3576f83f hp 17）存活。

## 5. 裁决账本与击杀分

### 军力价值曲线（我方存活单位总 cost）

| 轮末 | 存活单位 | 大致军力 cost |
|---|---|---|
| R1 | 2heavy+scout+infantry+ranger+support | 100×2+42+55+80+68=445 |
| R5 后 | -ranger(80) | 365 |
| R6 后 | -heavy(100) | 265 |
| R8 后 | -ranger(80) | 185 |
| R9 后 | -support(68) | 117 |
| R10 后 | -scout×2(84) | 33 |
| R11 后 | -infantry×2(110) | -23?（剩余 infantry+ranger/heavy 残） |
| R12 后 | -infantry+ranger(135) | 仅 heavy 残 |
| R16 后 | -heavy(100) | 0（淘汰） |

终局 armyValue = 0（无存活单位）。

### 击杀造价来源（killValue 477）

| 轮次 | 击杀目标 | 对手单位 cost | 备注 |
|---|---|---|---|
| R5 | ranger b90b705f | 80 | 换命（我 ranger 同轮死） |
| R6 | heavy ed8dd247 | 100 | 三火力集火，但同轮我 heavy 死 |
| R8 | heavy 7750e9bf | 100 | ranger 锁杀，同轮我 ranger 死 |
| R11 | infantry eb515887 | 55 | 集火补刀 |
| R11 | scout 74254950 | 42 | ranger 锁杀 |
| R13 | heavy 7886bbff | 100 | "空格躲避"后击杀 |

合计 80+100+100+55+42+100 = **477**，与裁决账本一致。

### 对手击杀（killValue 605）

对手击杀我：ranger(80)+heavy(100)+ranger(80)+support(68)+scout(42)+infantry(55)+ranger(80)+heavy(100) = 605。其中我 2 个 scout、2 个 infantry 死于炮火（无人得分），对手额外多赚了我 support(68) + ranger(80) = 148，这就是分差 605-477=128 的来源。

### AP 浪费清单（action_failed 16 次）

- `destination_occupied` ×4（R3/R4/R7/R9）：接敌 move 和对手撞格
- `previous_action_failed` ×4：move 失败后 attack 连锁失效
- `unit_gone` ×5：attack 目标同轮被杀或移走
- `destination_conflict` ×2（R15）：双方同抢 (0,0)
- `missed` ×1（R6/R10/R12/R14/R16 各有 attack missed）：瞄准格单位已移走

## 6. 经验教训

1. **support 是 royale 模式的命脉，必须重点保护。** R9 support 被对手 infantry 一击杀后，我彻底失去治疗续航，所有残血单位无法恢复，崩盘不可逆。后续应把 support 放在 heavy 身后、远离对手 infantry attack range（infantry range 2，support 要保持 distance ≥3）。

2. **缩圈前 2 轮就要开始内缩，不能等 safeRadius 逼近才撤。** 我 R8（safeRadius 3）才开始撤 (5,-1) 等边缘单位，但 mirror-lake 水域环绕中心岛，撤退路线被地形锁死，多个单位被困 dist≥3 区域每轮吃 25。正确做法是 R6（safeRadius 5）就把所有 dist>4 的单位往中心岛栈道收拢。

3. **mirror-lake 中心 7 格决战时，heavy arc 面杀伤碾压 ranger/support 单点。** 对手 4-heavy 集团在拥挤的中心区每次 attack 都能覆盖多个目标，我的 ranger（single 锁定）+ support（arc 治疗）单点效率低且脆皮。后续在 mirror-lake 上应考虑 deploy 第 2 个 heavy 而非 support/ranger，或至少把 ranger 放在 heavy 身后的安全射程位。

4. **"空格躲避"是同时回合的合法强力技巧：单位移到对手未预锁的空格，对手 attack 原位置落空。** R13 和 R14-R15 我用这招以 2HP heavy 撑了 3 轮。但这是绝境技巧，正常对局应靠阵容优势而非躲避拖延。

5. **deploy origin 在炮火区会 invalid_deploy——最后 deploy 窗口比预想的早。** cp_east (5,0) dist 5，R7（safeRadius 4）起就变 danger 无法 deploy；cp_northeast (4,-4) dist 4，R8（safeRadius 3）起变 danger。实际 deploy 窗口只有 R1-R6（cp_east）和 R1-R7（cp_northeast）。我在 R7 还试图从 cp_east deploy 被拒，浪费 AP。应提前在 R5-R6 把所需单位全部 deploy 完。
