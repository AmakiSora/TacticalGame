# 战术游戏标准模式复盘 — `player_a` 视角

**日期/游戏ID/回放版本:** 2026-09-28 / ce3fcc95-a978-4d10-aa69-1f94e780ab01 / 3.5.7
**地图/参战人数:** danger-close / 2人
**玩家:** mimo2.6pro-omp（OMP@Mimo2.6Pro）
**席位与出生:** `player_a`，行动顺序第1（先手），HQ(2,0) 120HP/防御4
**结果:** ❌第2名（淘汰） — `headquarters_destroyed` → `last_player_standing`
**结束轮次:** 第12/30整轮；**HQ最终HP:** 0/120

## 最终排名摘要

| 名次 | 席位 | 玩家 | 状态 | 总分 | 与我方分差 | 决定性优势 |
|---|---|---|---|---:|---:|---|
| 1 | `player_b` | Dsv4.1Flash0910-WB | active | 2664 | +2439 | 摧毁我 HQ(120伤害) + 保全HQ(120HP) |
| 2 | `player_a`（我） | mimo2.6pro-omp | eliminated | 225 | — | 持有1据点、军力171均领先，但HQ失守致败 |

## 游戏进程时间线

| 整轮/席位回合 | 补给 | 行动点 | 关键操作与坐标 | 结果/局势变化 | 战术意图 |
|---|---|---|---|---|---|
| R1 `player_a` | 20→20 | 1/1 | `move` b1b8befb(5,-4)→(3,-1) | 占据cp_2前沿 | 抢点先行 |
| R1 `player_b` | 20→26(+6) | 1/1 | `move` b5314cf8(-5,4)→(-3,2) | 对称应对 | 抢cp_1前沿 |
| R2 `player_a` | 26→32(+6) | 1/1 | `move` b1b8befb(3,-1)→(3,0) + `control_point_captured` cp_2 | 收入+8/轮 | 经济 |
| R2 `player_b` | 26→32(+6) | 1/1 | `move` b5314cf8(-3,2)→(-3,0) + `control_point_captured` cp_1 | 收入+8/轮 | 经济 |
| R3 双方 | →46/+14 | 1/1 | 双双空转（`reset_actions`） | 无 | 攒补给 |
| R4 `player_b` | 46→52(+6)→?? | 1/1 | `deploy` heavy@(-2,-1) cost50 from HQ | 首个攻城单位 | 抢先出重装破墙 |
| R5 `player_a` | 60→66(+14)→15 | 1/1 | `deploy` heavy@(3,-1) cost50 from cp_2 | 对位重装 | 镜像应对 |
| R5 `player_b` | 66→72 | 1/1 | `demolish` blocker@(-1,-1) | 清障路径A | 为heavy开道 |
| R6 `player_b` | — | 1/1 | `move` heavy(-2,-1)→(0,-1) | 推进至中线 | 步步逼近我HQ |
| R7 `player_a` | 90→96(+14)→51 | 1/1 | `deploy` infantry@(4,-1) cost45 from cp_2 | 备用肉盾 | 想堵咽喉/替补输出 |
| R7 `player_b` | — | 1/1 | `move` heavy(0,-1)→(1,-1) | 距HQ(2,0)仅2格 | 进入攻击半径 |
| R8 `player_a` | 104→110 | 1/1 | `move` heavy(3,-1)→(4,-2) | **关键失误：向后拉** | 误判要"绕开卡位"，放弃咽喉 |
| R8 `player_b` | — | 1/1 | `demolish` blocker@(2,-1) + `move` heavy(1,-1)→(2,-1) | **咽喉(2,-1)失守**，heavy直接骑脸 | 拆墙→占咽喉→贴HQ，一套连招 |
| R9 `player_a` | — | 1/1 | `move` heavy(4,-2)→(3,-1) + `attack` heavy→heavy dmg25 | 反应迟钝 | 终于意识到威胁 |
| R9 `player_b` | — | 1/1 | `attack` heavy(2,-1)→my HQ dmg33（HQ 120→87） | **HQ首次受损** | 攻城正式开始 |
| R10-R12 双方 | — | 1/1 | 我：`attack` heavy→heavy dmg29/30/24<br>对手：`attack` heavy→my HQ dmg39/34/35 | HQ 87→48→14→**0** | 我在打他的肉盾，他在拆我的家 |
| R12 收尾 | — | — | `headquarters_destroyed` + `control_point_neutralized` cp_2 + `player_eliminated` | 全军覆没，cp_2回中立 | — |

## 核心策略与关键转折

### 策略（3项）
1. **镜像抢点开局**：双方各出一支侦察兵抢占己方半区 cp，第2轮同步占领，经济立刻对等（各+8/轮，R3起每轮总收入14）。
2. **对称重装破墙**：R4/R5双方各自部署 heavy（cost 50），准备利用 heavy 的 `demolish` 能力打穿中间的 blocker 墙，逼近敌方 HQ——danger-close 的地图描述本身就写明"唯一的突破口是重装兵的爆破"。
3. **胜负权重前置**：`enemyHqDamage:20`、`ownHqHp:1`——打不动对方 HQ 时分数必然落后，因此双方都选择把主力压向破墙攻城，而非据点/军力争夺。

### 转折（3项）
1. **R5 对手抢先一步部署 heavy**（seq 35 先于 seq 40）：后手的节奏劣势使其比我还快一拍抵达破墙位置，我方只能被迫跟随节奏。
2. **R8 决定性转折**：对手一口气完成 `demolish blocker@(2,-1)` + `move heavy→(2,-1)`（seq 70、71），直接贴住我 HQ 旁的咽喉格。**同一个回合我却在 `move heavy(3,-1)→(4,-2)`（seq 66）向后拉**，把咽喉拱手让出。此后对手每回合稳定输出 33-39 点伤害，我方再无翻盘窗口。
3. **R9-R12 目标选择错误**：我持续 `attack` 对手 heavy（打的是 hp 150 的肉盾），而对手持续 `attack` 我 HQ（打的是 120HP、防御仅 4 的总部）。1:1 对换的战损下，他先拆完我的家，我这边他的 heavy 还剩 42HP——完全是"打错目标"导致的败局。

## HQ、据点与行动点分析

- **HQ 伤害**：我对敌方 HQ 造成 **0** 点伤害（`finalResult.scores.player_a.headquartersDamage:0`）；敌方对我 HQ 造成 **120** 点（`player_b.headquartersDamage:120`），4次攻击合计 33+39+34+35=141，其中最后一次因目标仅剩14HP被截断（`actualDamage:14`）。
- **击杀/被击杀**：双方均无单位阵亡记录；我的4个单位（2 scout + heavy + infantry）全部在 `player_eliminated` 事件（seq 111）中被移除。
- **据点**：双方各拿1个（R2 `control_point_captured` seq 14/19），cp_2 在我 HQ 摧毁后被中立化（seq 110）。
- **行动点**：`actionsPerTurn:1`，全对局24个 `turn_end` 事件对应24次行动点消耗，**无一空转**（每次都有 deploy/move/attack/demolish 产出）。
- **HQ 进攻窗口 vs 守家路线的取舍**：`enemyHqDamage:20` 的极端权重确实驱动进攻，但**这个权重只在"能打到敌方 HQ"时才有意义**。R8 起我方 HQ 被贴身，此时每回合的行动点若用于"打对方肉盾"而非"堵住咽喉保 HQ"，等于是在跟权重对赌速度——结果证明确实赌输了。**正确做法应是先止损（保HQ）再谈输出**：R8 时若将 heavy 留在(3,-1)占住咽喉、或提前部署 infantry 到 (2,0)/(1,-1) 挡位，虽会推迟进攻节奏，但至少不会被4回合带走。

## 补给与六项裁决分账本

**收入账**（`income` 事件累计）：`baseIncome:6` + `controlPointTypes.supply.income:8`（cp_2 归属期）
- player_a 总收入 **146**（R2起+14/轮）
- player_b 总收入 **152**（R1起+6基础、R2起+14/轮；比对手多一次基础收入因先手顺序）

**支出**：player_a 部署 heavy 50 + infantry 45 = **95**；player_b 部署 heavy 50 = **50**
**最终剩余**：player_a **71**、player_b **122**（与 `finalResult` 一致）

| 项目 | 数量/数值 | 本局权重 | 事件或配置依据 |
|---|---:|---:|---|
| 对各对手 HQ 造成的伤害 | 0 | 20 | 无 `attack` 命中敌HQ；`finalResult.scores` |
| 己方 HQ 最终 HP | 0 | 1 | `headquarters_destroyed`(seq 109) |
| 最终控制据点数 | 1 | 30 | `control_point_captured` cp_2(seq 14) |
| 存活军力价值 | 171 | 1 | 3×scout(38) + heavy(50) + infantry(45) ×hp比例=171；`game_over` |
| 剩余补给 | 71 | 0 | `income`/`deploy` 累计 |
| `actionScore` | 24 | — | merit 12 × effectiveActions 2（见下）|
| **总分** | **225** | — | `game_over.payload.scores.player_a.total` |

**`actionScore` 明细**（merit 核算）：deploy×2(+2)、demolish×0(+0)、capture×1(+2)、attack×4(合计108伤害→ceil(108/20)=6)、heal×0(0) = **12 merit**；`weights.effectiveActions:2` → **24**。与 `scores.actionScore:24` 完全吻合。

**对手账本**：HQ伤害 120×20=2400、HQ HP 120×1=120、CP 1×30=30、armyValue 90×1=90、supplies 122×0=0、actionScore 24 → **2664**，同 `finalResult` 一致。

## 失误与改进

1. **R8 重大失误（目标选择）**：我用 heavy 攻击对手的 heavy（肉盾），对手用 heavy 攻击我 HQ（要害）。在 `enemyHqDamage:20` 的权重下，**攻击目标必须优先指向 HQ 或能威胁 HQ 的单位，而非高HP肉盾**。
   - *实际做法*：R9-R12 持续 `attack` 对手 heavy，累计108点伤害全部浪费在150HP的肉盾上。
   - *正确做法*：应利用 heavy 自身高防御（13）扛住对手火力的同时，**调遣 infantry/scout 绕后占咽喉格(2,-1)/(2,0) 阻挡对手贴脸**，让对手的 heavy 无法每回合攻击 HQ；或者干脆提前把输出火力对准敌方 HQ（哪怕伤害更低，每一点都×20）。
   - *触发条件*：当对手单位已进入我 HQ 相邻格、且 `enemyHqDamage` 权重远高于其他项时。
   - *预期收益*：即便不能反杀，只要延缓对手4回合以上，按当前军力值优势（171 vs 126）拖到轮数上限或寻找反攻窗口都更优。

2. **R8 战位失误（放弃咽喉）**：`move heavy(3,-1)→(4,-2)`（seq 66）是纯后退，把(3,-1)这一咽喉格让给对手，导致对手下一步直接推进到(2,-1)。
   - *正确做法*：保持 heavy 停在(3,-1)，利用其移动范围2和近战威慑卡住咽喉；即便不能攻击也该优先占位。
   - *预期收益*：对手需多花1-2回合绕路或硬冲，为我方争取部署堵口的时间。

## 与历史对局对比

引用 `tg_0042_20260723.json`（`MiMo2.5pro-OMP` vs `doubaoseed2.1pro-OMP`，同为 danger-close 地图，同样 `last_player_standing`，同样 player_a 落败）：

- **相同点**：两次对局中 player_a 都在第2轮拿下 cp_2（`control_point_captured` seq 18 / 本局 seq 14），经济同步启动；两次都是 player_b 一方的 heavy 最终摧毁 player_a 的 HQ。
- **不同点**：tg_0042 中 player_a 的 heavy 用 `demolish` 清除了(2,-1)/(1,0)/(1,1) 三处 blocker 并试图反推（seq 46/101/121），但**没有及时回防守住自己的 HQ**，最终仍在(2,0)被摧毁（seq 137）；本局我甚至连破墙动作都没有完成，直接被对手抢先占住咽喉。
- **本局新发现**：danger-close 的胜负手不在"谁先破墙"，而在**咽喉格(2,-1)/(3,-1)的控制权**。tg_0042 中双方都完成了破墙，但 player_a 依然因为防守空虚被推平；本局我因为一个 R8 后撤动作直接让出咽喉，败得更快（12轮 vs tg_0042 的约18轮）。**两局共同验证：这张图上"重装破墙"只是手段，真正决定胜负的是谁能把单位钉在咽喉格上卡住对方 HQ 的进攻路径。**

另外参考 `tg_0173_20260927.json`（`mimo2.6pro-PI` vs `Dsv4.1Flash0910-WB`，breach 图，同对手 `turn_limit_score` 落败）：对手在多张图上都倾向高强度进攻压制，本局的快速攻城节奏与之一致；面对该对手时应更注重防守反击而非对攻。

## 总结

### 做得好的
1. 抢点节奏正确：R2 即完成 cp_2 占领（seq 14），整局经济没有落后（总收入146 vs 152，差距仅来自先手顺序）。
2. 部署选择合理：heavy + infantry 的组合符合地图"重装破墙"的主旋律，成本控制在95，剩余补给71未被浪费。
3. 行动点零空转：24次 `turn_end` 全部对应有效动作，没有把时间浪费在无意义的移动上。

### 下次改进
1. **触发条件**：对手单位进入我 HQ 相邻2格范围内 → **替代动作**：立即调度 infantry/scout 占据咽喉格（2,-1)/(2,0)，不惜暂缓进攻节奏。
2. **触发条件**：`enemyHqDamage` 权重 ≥ 10 且对手已有单位贴脸 → **替代动作**：攻击目标必须锁定 HQ 或能直接威胁 HQ 的单位，不要浪费输出在高HP肉盾上。
3. **触发条件**：本方 heavy 处于咽喉格且敌方 heavy 逼近 → **替代动作**：宁可原地不动卡位，也不后撤让出咽喉。

> **核心口诀：先卡咽喉保HQ，再谈输出换伤害——防守不是保守，是让进攻权重生效的前提。**
> **一句话总结：** **danger-close 图上，咽喉格(2,-1)/(3,-1)的控制权就是生死线——R8 一个后撤让出咽喉，导致对手重装直接贴脸拆HQ，4回合内被攻城带走，痛失好局。**
