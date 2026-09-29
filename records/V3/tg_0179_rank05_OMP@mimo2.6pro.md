# tg_0179 六人雪花大逃杀复盘（royale·雪花）

## 0. 局面概要

- gameId `e5536499-1a81-4c14-b397-71217086b215` / 地图 `snowflake` / 模式 `royale` / 6 人
- 我的席位 `player_a`（mimo2.6pro-OMP），终局 **rank 5**，reason `artillery_destroyed`（炮火清场，eliminatedBy 为 null）
- winner：`player_c`（GLM5.3Flash-ZC），reason `last_player_standing`
- 其余席位：`player_b` seed2.1pro0915-TC（rank 2，army_destroyed，eliminatedBy player_c）、`player_d` Dsv4.1Flash0910-WB（rank 3，army_destroyed，eliminatedBy player_b）、`player_e` Step5-OMP（rank 4，artillery_destroyed）、`player_f` Hy3-WB（rank 6，artillery_destroyed）
- 本局 artillery 配置：`startRound 6` / `intervalRounds 1` / `damage 25` / `minimumSafeRadius 1`；`damageVarianceRange 2`（本局实测 ±2）、`actionsPerTurn 8`、`effectiveActions 10`；裁决权重 `armyValue 5`、`actionScore 10`，HQ/据点/补给权重全 0
- 开局配置：每人 500 补给 + 2 heavy + 1 scout，出生在各自的 forward_base 据点（cp_2 @ (-8,8) 属我）；turnOrder `[player_d, player_e, player_f, player_c, player_a, player_b]`
- 对局时长约 143 分钟，849 条事件，共 17 轮

## 1. 结果一句话

缩圈把六家从角落赶向花心，`player_c` 以最内层站位 + 2 heavy 1 ranger 的残部扛到最后（armyValue 167），其余五家全部被炮火或战斗清场；我是全场最早被角落卡死、最晚才破墙的一家，rank 5。

## 2. 发育窗口（round 1–5，startRound=6 前）

- 起手 3 单位（scout@-7,7、heavy@-9,8、heavy@-8,9），补给 500。第 1–3 轮每轮 40 收入（base 20 + cp_2 forward_base 20），到第 6 轮收入不变、无补给点/维修点可争。
- 爆兵节奏：第 1 轮 deploy infantry@-8,7 + ranger@-9,9，第 2 轮 heavy@-8,9，第 3 轮 heavy@-8,7 + heavy@-9,8，第 4 轮 heavy@-7,7——6 次 deploy 全部成功，全部从 cp_2 出。一度 9 单位，军力价值 777（第 4 轮结束，全场第 2，仅次于 player_f 的 842）。
- **关键失误**：出生角 (-9..-6 × 6..9) 是被 blocker 墙切断的死胡同，东侧 -5,7/-5,8/-5,9/-7,5/-7,6 全是 blocker。我把 9 个单位全部堆进这个口袋，只沿 -8,8 → -7,8 → -6,8 的窄缝向东挪了 2–3 格，没有侦察六条走廊开口，也没有提前破墙。
- 部署受地形规则卡死：deploy 目标必须是 CP 相邻的空 plain 格，而 cp_2 周围 -8,8/-8,9/-9,8/-9,7 等格被自己的单位或地形堵住，第 4 轮后能部署的格子越来越少；第 6 轮起 CP 进入炮击区后 deploy 直接被 `invalid_deploy` 拒绝，补员完全断流。

## 3. 缩圈期（round 6–12）

- 第 5 轮出现 `artillery_warning`（safeRadius 9，警告环覆盖我整个角落）；第 6 轮首次收缩 safeRadius 8。我每轮在圈外吃满额 25 伤害（无视防御），第 6–13 轮累计承受 **1068 点炮击伤害**（全场第二高，仅次于 player_f 的 1280）。
- 撤离决策：第 5–8 轮只能在口袋里平摊伤害（同轮把单位分散到不同危险格），第 9 轮才开始 **`/demolish` 破墙**——5 个重装兵拆掉 -5,7/-5,8/-5,9/-7,5/-7,6 五个 blocker，第 10 轮 6 个单位沿新开走廊向东转移（-4,7/-4,6/-5,9/-7,5/-7,4/-7,7）。但此时 safeRadius 已缩到 4，血量撑不到圈内，第 11–12 轮被连续收圈追死。
- 与对手的接触战：**全程零交战**——回放中 `attack` 事件共 34 条（player_c 15、player_b 12、player_d 6、player_e 1），我的 `attack`/`heal` 事件为 0；`action_failed` 10 条全是别人的 `destination_conflict`（争夺 5,-1 / 6,-2 / 1,0 / 1,-1 等内圈通道格），我一条都没触发，因为根本没接触到敌人。
- `destination_conflict` 分析：player_d 与 player_e 在第 5、6、9、12、13 轮反复双向误判同一通道格（5,-1、6,-2、1,0、1,-1），双方行动同场作废；player_b 与 player_d、player_c 与 player_d 也各有一次。这些是抢内圈路线的真冲突，不是我的问题。

## 4. 终局（round 13 起）

- safeRadius 逐轮 9→8→7→6→5→4→3→2→1，第 13 轮到达 `minimumSafeRadius 1`，中心格是屏障，最终战场是内圈六格。
- 淘汰顺序：第 13 轮 `player_f`（artillery_destroyed，10 单位全灭，cp_4 失守）与 **我（player_a，artillery_destroyed，9 单位全灭，cp_2 失守）同时出局**；第 14 轮 `player_d`（army_destroyed，eliminatedBy player_b）；第 17 轮 `player_e`（artillery_destroyed，最后一个 heavy 在 (2,-3) 硬吃 5 轮炮击后阵亡）与 `player_b`（army_destroyed，eliminatedBy player_c）先后出局，`player_c` 以 2 heavy 1 ranger 的残部（armyValue 167）last_player_standing 获胜。
- 花心争夺：真正的内圈换血发生在 player_c/player_b/player_d 之间——attack 伤害总计 player_b 335、player_c 295、player_d 173、player_e 15，我 0。`player_c` 的赢法是缩圈前就把重火力挪进内层通道，用 arc/heavy 封锁接近路线，再靠炮火替它清掉残血对手。

## 5. 裁决账本与行动分

- 军力价值曲线（round 结束时，按 cost×hp/maxHp 累计）：

  | 轮 | player_a | player_b | player_c | player_d | player_e | player_f |
  |---:|---:|---:|---:|---:|---:|---:|
  | 4 | 777 | 757 | 735 | 820 | 713 | 842 |
  | 6 | 679 | 857 | 817 | 758 | 680 | 843 |
  | 8 | 384 | 632 | 634 | 488 | 374 | 527 |
  | 10 | 137 | 265 | 426 | 191 | 214 | 195 |
  | 12 | 11 | 158 | 268 | 37 | 111 | 11 |

  我从全场第 2 滑到垫底，拐点在第 6–8 轮（缩圈后困在角落掉血最快）。
- 行动分（actionScore = actionMerit × effectiveActions 10）：我的 actionMerit = 11（deploy 6×1 + demolish 5×1 + 攻击/治疗/占领 0），actionScore **110**，是全场最低（player_b 570、player_c 450、player_d 300、player_e 150、player_f 70）。**移动 42 次（全场最多）全部零功勋**，而攻击每 10 伤害计 1 点——不动手只赶路是纯亏。
- AP 浪费清单：12 轮共提交 48 个动作（move 42 + deploy 6 + demolish 5，其中 deploy/demolish 有 1 个 deploy 因占位重复入队失败，最终 round_resolved 全部 executed），但 42 次移动全部为纯位移，0 攻击 0 治疗；第 4 轮后 deploy 受地形/炮击区限制连续失败（`invalid_terrain`、`out_of_deploy_range`、`invalid_deploy`），补给从 500 涨到 405+ 但花不出去。
- 圈外掉血总量 1068（round 6: 125 / 7: 175 / 8: 218 / 9: 190 / 10: 170 / 11: 120 / 12: 55 / 13: 15）；因炮火减员 9 个单位（ranger 1、infantry 1、scout 1、heavy 6），战斗减员 0；淘汰轮 round 13。

## 6. 经验教训（可执行）

1. **雪花开局必侦察走廊**：6 人雪花每家出生角都是被 blocker 切断的口袋，第 1–2 轮就该用 scout 沿六条辐射走廊探出口、把主力铺向地图中心，而不是把 9 个单位堆进出生角。缩圈时钟（startRound 6）是硬约束，前 5 轮必须完成向中心的机动准备。
2. **重装兵 `/demolish` 是开路关键技能，要提前一回合用**：本局第 9 轮才破墙，晚了至少 2 轮。正确节奏是第 3–4 轮（还在发育窗口）就拆掉出生角东侧的 blocker 开出撤离走廊，第 5 轮警告环出现时全军已在去中心的路上。
3. **缩圈期必须换血，不能只赶路**：我 42 次移动 0 攻击，actionScore 110 全场垫底；而 player_c 用 15 次攻击打出 295 伤害、actionScore 450。规则是每 10 伤害计 1 功勋、权重 10——在安全区边缘用 ranger 锁定/heavy arc 打一轮再走，比多跑两格划算得多。
4. **部署要卡地形与炮击区**：deploy 只能落在 CP 相邻空 plain 格，且 origin/target 都不能在危险区。发育期应把 CP 周围的 plain 格留给 deploy（别用自己的单位堵住），缩圈后 CP 入危险区就再也补不了兵，补员窗口只有前 5 轮。
5. **内圈六格争夺看站位不看数量**：最终活下来的是最早把重火力挪进内层通道的 player_c（2 heavy 1 ranger 残部），而不是爆兵最多的一家。缩到 minimumSafeRadius 后，谁先占住安全格 + 用形状火力封锁接近路线，谁就赢——残血单位留着吃炮击只是给对手省事。
