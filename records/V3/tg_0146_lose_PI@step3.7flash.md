# 战术游戏标准模式复盘 — `player_a` 视角

**日期/游戏ID/回放版本:** 2026-09-12 / 05f0a62b-7cb0-4d80-b33a-c8c12f50619d / server-replay
**地图/参战人数:** default / 2人
**玩家:** Step3.7Flash-PI（PI@PI）
**席位与出生:** `player_a`，行动顺序第2，HQ(8,0)
**结果:** ❌ 第2名 — `turn_limit_score`
**结束轮次:** 第15/15整轮；**HQ最终HP:** 180/180

## 最终排名摘要

| 名次 | 席位 | 玩家 | 状态 | 总分 | 与我方分差 | 决定性优势 |
|---|---|---|---|---:|---:|---|
| 1 | player_b | GLM5.3Flash-ZC | active | 1830 | +536 | 3据点+军力压制+ranger持续输出 |
| 2 | player_a | Step3.7Flash-PI | active | 1294 | — | 仅剩9个单位且多残血 |

## 游戏进程时间线

| 整轮/席位回合 | 补给（行动前→后） | AP（已用/总） | 关键操作与坐标 | 结果/局势变化 | 战术意图 |
|---|---|---|---|---|---|
| R1 / player_b | 80→80 | 0/5 | move infantry 97683992 (-7,0)→(-4,0); move scout fc80c98f (-7,-1)→(-2,-4); move infantry cd40efb5 (-7,1)→(-4,1); capture cp_a by 97683992 | 对手速占西侧补给站，左侧经济成型 | 先手抢点 |
| R1 / player_a | 80→90 | 0/5 | move infantry ef46c3e0 (7,0)→(4,0); move infantry 916d9f05 (7,-1)→(4,-1); move scout 0a05825c (7,1)→(2,1); deploy infantry dd1db10d from HQ(8,0) to (8,-1); capture cp_b by ef46c3e0 | 东侧补给站到手，但中路只有 scout 孤身探出 | 右翼扩张 |
| R2 / player_b | 80→? | 0/5 | move scout fc80c98f (-2,-4)→(0,-4); move infantry cd40efb5 (-4,1)→(-1,0); deploy ranger 45ca8c63 from cp_a to (-3,0); capture cp_n by fc80c98f | 北侧中继站被占，对手获得 ranger 远程火力 | 两翼开花 |
| R2 / player_a | 90→67 | 0/5 | move scout 0a05825c (2,1)→(0,0); move infantry 916d9f05 (4,-1)→(1,-1); deploy infantry dbc03035 from cp_b to (4,1); move infantry dd1db10d (8,-1)→(6,0); capture cp_c by 0a05825c | 中央阵地到手，三线并进 | 控中 |
| R3 / player_b | ?→? | 0/5 | deploy heavy 92e32518 from cp_n to (-3,-1); attack×2; move scout fc80c98f (0,-4)→(0,-1); attack×2; **unit_death: 0a05825c** | 我的 scout 被 ranger+heavy 组合击杀，中央眼位丢失 | 反制中央 |
| R3 / player_a | 67→? | 0/5 | attack 916d9f05→fc80c98f (hp 65→13); move 916d9f05 (1,-1)→(0,-1); deploy infantry 743e7fbb from cp_c to (1,0); move infantry dbc03035 (4,1)→(2,2); move infantry dd1db10d (6,0)→(5,0) | 反杀对手 scout，但自己 scout 已死，中央仅剩 infantry | 反打 |
| R4 / player_b | ?→? | 0/5 | deploy support 88cb246b from cp_n to (-3,-1); move heavy 92e32518 (-3,-1)→(-2,-1); attack×2 | 对手获得治疗能力，heavy 推进至 (-2,-1) | 压制 |
| R4 / player_a | ?→? | 0/5 | **attack 916d9f05→fc80c98f (击杀)**; deploy infantry 8653bb09 from cp_c to (-1,1); move ef46c3e0 (3,0)→(3,1); move 743e7fbb (1,0)→(0,0); move dd1db10d (5,0)→(5,-1) | 击杀对手 scout，但 916d9f05 位置过于深入 (-1,-1) | 清野 |
| R5 / player_b | ?→? | 0/5 | attack×2 (ranger 45ca8c63 + 51ccc3c1); **unit_death: 916d9f05**; move scout fc80c98f (0,-1)→(0,-4) | 我的 infantry 916d9f05 被 ranger 狙杀，首波兵力损耗 | 远程消耗 |
| R5 / player_a | ?→? | 0/5 | attack 8653bb09→cd40efb5 (hp 100→78); move 8653bb09 (-1,1)→(-2,1); move dd1db10d (5,-1)→(4,-1); attack dd1db10d→92e32518 (hp 150→131) | 唯一一次有效击杀对手单位，但 heavy 仅掉 19HP | 反击 |
| R7 / player_a | ?→? | 0/5 | deploy infantry 5260dddc from cp_c to (-1,0); move 8653bb09 (-2,1)→(-2,2); move ef46c3e0 (3,1)→(2,1); move 743e7fbb (0,0)→(-1,0)?; **unit_death: 743e7fbb** | 刚部署的 infantry 被 ranger 击杀，中门失守 | 填补 |
| R9 / player_b | ?→? | 0/5 | attack×2; **unit_death: 5260dddc** | 我的又一个 infantry 被 ranger 击杀 | 持续压制 |
| R9 / player_a | ?→? | 0/5 | **attack 271a71b9→cd40efb5 (击杀)**; deploy infantry cd216c42 from HQ to (7,0); deploy infantry 9c512933 from cp_b to (3,0) | 唯一一次击杀对手 infantry，但己方已损失 4 个单位 | 止损 |
| R10 / player_b | ?→? | 0/5 | attack×4; **unit_death: ef46c3e0**; heal support→88cb246b | 我的前线 infantry ef46c3e0 被 4 连攻击击杀，中路崩溃 | 围剿 |
| R11 / player_a | ?→? | 0/5 | deploy infantry a0afaf86 from HQ to (7,1); deploy infantry 271a71b9 from cp_b to (1,0); attack 8653bb09→97683992 (hp 100→59); move dbc03035 (2,2)→(1,3) | 试图在右侧和中部反击，但兵力已散 | 反扑 |
| R12 / player_b | ?→? | 0/5 | move heavy 92e32518 (3,-1)→(1,-1); attack×3; **capture cp_c by 9e75b5c6** | 中央阵地易手，对手三据点齐全 | 锁胜 |
| R13 / player_a | ?→? | 0/5 | attack 271a71b9→9e75b5c6 (hp 100→81); move 271a71b9 (1,0)→(2,1); move 8653bb09 (-2,2)→(-4,1); move dbc03035 (1,3)→(-4,1)?; deploy scout 0eea7d85 from cp_b to (4,1) | 兵力极度分散，唯一有效攻击但无后续 | 散兵游勇 |
| R13 / player_b | ?→? | 0/5 | attack×4; **unit_death: dd1db10d** | 我的前线 infantry 被 heavy 击杀，右翼失守 | 推进 |
| R14 / player_a | ?→? | 0/5 | move dd1db10d→(3,0); move 8653bb09→(-6,0); attack 8653bb09→97683992 (hp 59→?); deploy infantry 8661a9d4 from cp_b to (5,-1) | 孤注一掷攻 HQ，但 infantry 仅剩 10HP | 决死 |
| R15 / player_a | ?→? | 0/5 | attack dbc03035→97683992 (hp 80→?); attack b8363807→92e32518 (hp 131→95); attack 8661a9d4→92e32518 (hp 95→?); move 271a71b9→(1,1); move 9c512933→(3,1) | 最后回合三拳两命中，但 heavy 未死，HQ 未伤 | 最后一搏 |

## 核心策略与关键转折

### 策略
1. **右翼优先扩张**：开局优先占领东侧 cp_b，试图在右侧建立经济优势。
2. **中央穿插**：R2 用 scout 抢下 cp_c，试图控制枢纽。
3. **散兵骚扰**：用 infantry 分散到中路、左路、右路多点施压。

### 关键转折
1. **R3 scout 被击杀**：0a05825c 在 (0,0) 被对手 ranger+heavy 击杀，中央眼位丢失。此后对手 ranger 无阻碍压制中线。
2. **R5 916d9f05 被狙杀**：在 (-1,-1) 被 ranger 击杀，左翼只剩残血 infantry，开始出现不可逆兵力缺口。
3. **R12 cp_c 易手**：对手 heavy+ranger+infantry 联合夺回中央阵地，三据点齐全，裁决分进入不可追区间。
4. **R13 dd1db10d 被击杀**：右翼最后的主力 infantry 被 heavy 击杀，armyValue 暴跌至 314，彻底失去翻盘可能。

## HQ、据点与行动点分析

### HQ 压力
- 我方 HQ(8,0) 全程未受攻击（180/180）。
- 对手 HQ(-8,0) 也全程未受攻击。整局双方 **HQ 伤害均为 0**。
- 胜负完全由经济、据点和军力价值决定。

### 据点得失
| 据点 | 坐标 | 我方占领轮次 | 失去轮次 | 对手占领轮次 | 说明 |
|---|---|---|---|---|---|
| cp_b | (4,0) | R1 | — | — | 全程掌握，经济基石 |
| cp_c | (0,0) | R2 | R12 | R12 | 中央枢纽失守是最大转折 |
| cp_s | (0,4) | R7 | — | — | 后期补充，但权重已不足 |
| cp_a | (-4,0) | — | — | R1 | 对手先手拿下，奠定左侧优势 |
| cp_n | (0,-4) | — | — | R2 | 对手再得一分，ranger 出生位 |

### 行动点使用
- 每回合 5 AP，但经常出现 **移动后无法攻击/占点** 的空转。
- 典型空转：R1 scout 探出后无后续；R4 916d9f05 攻击后深入 (-1,-1)，R5 立刻被击杀，AP 浪费。
- 对手每回合 AP 都转换为有效攻击、推进或治疗，actionScore 144 vs 我的 90。

## 补给与六项裁决分账本

**权重（来自本局 config）：**
- enemyHqDamage: 5
- ownHqHp: 2
- controlPoint: 90
- armyValue: 2
- supplies: 1
- effectiveActions: 2

| 项目 | 数量/数值 | 本局权重 | 事件或配置依据 |
|---|---:|---:|---|
| 对各对手 HQ 造成的伤害 | 0 | 5 | 无有效攻击到 HQ |
| 己方 HQ 最终 HP | 180 | 2 | game_over |
| 最终控制据点数 | 2 (cp_b, cp_s) | 90 | control_point_captured |
| 存活军力价值 | 314 | 2 | game_over 状态 |
| 剩余补给 | 36 | 1 | game_over 状态 |
| actionScore | 90 | — | 行动事件 |
| **总分** | **1294** | — | `game_over.payload.scores` |

**对手对照：**

| 项目 | player_b | 权重 | player_a | 分差 |
|---|---:|---:|---:|---:|
| 对各 HQ 造成的伤害 | 0 | 5 | 0 | 0 |
| 己方 HQ 最终 HP | 180 | 2 | 180 | 0 |
| 最终控制据点数 | 3 | 90 | 2 | +90 |
| 存活军力价值 | 522 | 2 | 314 | +416 |
| 剩余补给 | 12 | 1 | 36 | -24 |
| actionScore | 144 | — | 90 | +54 |
| **总分** | **1830** | — | **1294** | **+536** |

**供给简账：**
- 初始补给：80
- 基础收入：10/回合 × 15回合 = 150
- CP 收入：约 12/点/回合（具体数量在 income 事件中未逐项列出，按 controlPointIncome=12 估算）
- 部署花费：约 578（12 infantry × 45 + 1 scout × 38）
- 最终剩余：36

## 失误与改进

### 实际做法 vs 正确做法

1. **军力结构单一，无远程/治疗/重甲**
   - **触发条件：** R1-R15 全程只出 infantry 和 1  scout，未建造 ranger、heavy、support。
   - **实际做法：** 纯 infantry 海推进。
   - **正确做法：** 至少建造 1 个 ranger（counter 对手 ranger）和 1 个 support（维持战线）。
   - **预期收益：** 可在 R5 后与对手 ranger 对射，减少步兵损耗。

2. **单位分散，缺乏集火**
   - **触发条件：** R2-R4 将 infantry 分散到 (2,2)、(5,0)、(1,-1) 三个方向。
   - **实际做法：** 多点占点，兵力分散。
   - **正确做法：** 集中 4-5 个单位在 (2,0) 附近，形成局部兵力优势。
   - **预期收益：** 可在 R4-R5 反推对手 heavy，夺回 cp_n 或 cp_a。

3. **中央 scout 死后未及时补防**
   - **触发条件：** R3 0a05825c 在 (0,0) 被击杀。
   - **实际做法：** 后续回合仅用 infantry 填补，未形成防线。
   - **正确做法：** R4 立即部署 ranger 或 heavy 到 (-1,1) 或 (0,1)，建立火力网。
   - **预期收益：** 阻止对手 ranger 在 (-2,-1) 和 (-3,0) 自由输出。

4. **最后回合未全力攻 HQ**
   - **触发条件：** R15 结束时对手 HQ 仍有 180HP。
   - **实际做法：** 三拳分别打在 infantry 97683992、heavy 92e32518 和 infantry 9e75b5c6 身上。
   - **正确做法：** 集中火力攻击对手 HQ 或 HQ 旁单位，争取 HQ 伤害分。
   - **预期收益：** 若造成 20+ HQ 伤害，可多得 100 分（×5）。

## 与历史对局对比

引用 **V2 `tg_0001_lose_PI@mimo2.5pro.md`**（2026-06-14，default 地图，2 人标准模式）：

| 对比项 | tg_0001 (V2) | 本局 (V3) |
|---|---|---|
| 结局 | R16 HQ 被摧毁 | R15 turn_limit_score |
| 核心失误 | scout 孤军深入 (0,0) 被围杀 | scout 占中央后 R3 被击杀，步兵连续被 ranger 狙杀 |
| 军力结构 | 混合兵种（infantry/scout/ranger/heavy/support） | 纯 infantry + 1 scout |
| CP 控制 | 最多 2 个 | 最多 3 个（但丢失 cp_c） |
| 教训 | "单位聚集胜过分散占领" | 再次验证：分散占点导致逐个被击破 |

**本局新发现：**
- 在 default 地图上，**ranger 的远程压制能力** 比 V2 对局中更致命。V2 中 AI 的进攻节奏较慢，本局对手 GLM5.3Flash-ZC 用 ranger 在 R3-R13 持续狙杀我方 6 个单位，这是本局 armyValue 差距 208 分的直接原因。
- **cp_c 的得失是胜负手**：R2 占领 cp_c 后，我未建立防线，R12 对手仅用 1 个 infantry 就夺回。这说明"占点"必须伴随"守点兵力"。

## 总结

### 做得好的
1. **R1 快速占领 cp_b**，建立了右翼经济基础。
2. **R2  scout 抢占 cp_c**，一度控制中央枢纽。
3. **R5 成功击杀对手 cd40efb5**，证明 infantry 在局部数量优势下可以反杀。

### 下次改进
1. **军力结构必须包含远程单位**：R2 后应部署 ranger 到 (-1,1) 或 (0,1)，与对手 ranger 对射，保护中线步兵。
2. **兵力集中而非分散**：R2 之后应将 4-5 个单位集中在 (2,0)-(0,0) 区域，形成局部优势，而非分散到 (-1,1)、(5,-1)、(4,1)。
3. **守住 cp_c**：R3 scout 死后，R4 应立即用 heavy 或 infantry+scout 组合巩固中央，防止对手轻取。
4. **最后回合攻 HQ**：R15 应将主要火力投向对手 HQ，争取 HQ 伤害分，而非清杂兵。

> **核心口诀：占点必须配防，远程必须早出，兵力永远集中。**

**一句话总结：本局败因是军力结构单一（无 ranger/heavy/support）且兵力过度分散，导致对手以 ranger 远程消耗逐个击破我方 infantry，最终在裁决分中 armyValue 与 actionScore 双差落败。**
