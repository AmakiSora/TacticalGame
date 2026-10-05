# 战术游戏歼灭模式复盘 — `player_a` 视角

**日期/游戏ID/回放版本:** 2026-10-05 / 1fe38abd-8584-46ab-a942-403c98a500e5 / v3.1
**地图/参战人数:** artillery-zone / 2人；**模式:** annihilation
**玩家:** ling3.0flash-WEB（LING3.0FLASH-WEB@ling3）
**席位与出生:** `player_a`，初始单位/出生控制点 `slot_west`（cp_west at (-4,0)）；HQ：不适用（无HQ）
**结果:** ⚪第2名 — `last_player_standing`
**结束轮次:** 第13/20整轮；**最终存活单位/补给:** 0 / 109

## 最终排名与淘汰

| 名次 | 席位 | 状态 | 总分 | 军力价值 | 据点 | 主要死亡/优势原因 |
|---|---|---|---:|---:|---:|---|
| 1 | player_b | active | 934 | 172 | 5 | 存活到最后一名，炮火覆盖下坚持更久 |
| 2 | player_a | eliminated | 310 | 0 | 3 | `artillery_destroyed` — 第13轮炮火缩圈至半径1，所有剩余单位被摧毁 |

## 炮火与安全区时间线

| 轮次 | safeRadius | warning/danger 关键格 | 我的单位位置 | 撤离/承伤/击杀 | 决策评价 |
|---|---:|---|---|---|---|
| 1 | 6 | 无 | 西侧出生点 (-4,0) 附近 | 占领 supply_west (-3,0) | 正确开局，优先拿补给点 |
| 2 | 6 | 无 | 推进至 (-3,0) 附近 | 占领 cp_northeast 失败（对手抢先） | 对手反应更快，丢了东北 CP |
| 3 | 6 | 无 | 推进至 (-1,2)、(-2,3) | 攻击敌方 heavy (1,1) | 主动进攻但未能击杀 |
| 4 | 6 | 36 warning cells (nextShrink=5) | 推进至 (1,0)、(1,-1) | 部署新兵；攻击敌方 heavy |  artillery 预警已现，但安全半径仍大，行动自由 |
| 5 | **5** (缩圈) | 36 danger cells | 退回 (-1,0)、(-1,2) | 撤退至安全区；攻击敌方 infantry | 首次缩圈，及时撤离危险区 |
| 6 | 5 | 30 warning cells (nextShrink=7) | 推进至 (0,-3) 占领 supply_northwest | 攻击敌方 infantry (0,1) | 拿到西北补给点，巩固收入 |
| 7 | **4** (缩圈) | 66 danger cells + 24 warning | 部分单位在边界 | 攻击敌方 infantry (1,-1) | 缩圈后继续前压，但已显被动 |
| 8 | 4 | 18 warning cells (nextShrink=9) | 推进至 (0,-4) 占领 cp_northwest | 攻击敌方 infantry (0,1) | 拿到西北 CP，但对手已占5个 CP |
| 9 | **3** (缩圈) | 90 danger cells | 部分单位在 danger | 2 单位被 artillery 击杀：(1,2) hp→0, (0,-2) hp→0 | **关键失误**：未能及时将单位撤至安全区，2 个单位被炮火摧毁 |
| 10 | 3 | 12 warning cells (nextShrink=11) | 仅剩 2 存活单位 | 攻击敌方 infantry (-1,-1) | 兵力劣势下勉强反击 |
| 11 | **2** (缩圈) | 108 danger cells + 12 warning | 2 单位在边界 | 2 单位被 artillery 伤害：(-1,0) hp→33, (-1,2) hp→47 | 缩圈至半径2，已无安全纵深 |
| 12 | 2 | 12 warning cells (nextShrink=13) | 2 单位在边界 | 攻击敌方 infantry (-1,-1) | 兵力不足，难以扭转局面 |
| 13 | **1** (最终缩圈) | 90+ danger cells | 所有存活单位在 danger | 3 单位被 artillery 击杀：(1,2)→0, (-3,1)→0, (1,1)→100, (-2,-1)→75 | **被淘汰**：`artillery_destroyed`，所有剩余单位被炮火摧毁 |

## 单位、据点和补给时间线

### 第1轮 (R1)
- 出生：2 infantry + 1 heavy 于 slot_west (cp_west at (-4,0))
- 行动：3 infantry 推进至 (-3,0) 占领 supply_west；heavy 推进至 (-2,-1)
- 收入：+8 base + 8 supply = 16

### 第2轮 (R2)
- 行动：部署 1 infantry 于 (-4,1)；3 infantry 前推至 (-3,1)、(-2,2)、(-3,2)
- 对手占领 cp_northeast + supply_northeast
- 收入：+8 base + 8 supply_west = 16

### 第3轮 (R3)
- 行动：heavy 推进至 (-1,-1)；infantry 推进至 (-1,2)、(-2,3)
- 攻击敌方 heavy at (1,1)：未击杀
- 收入：+8 base + 8 supply_west = 16

### 第4轮 (R4) — 首次 artillery 预警
- 行动：infantry at (0,0) 攻击敌方 heavy at (1,1)；heavy 推进至 (0,-1)；infantry 前推
- 部署 1 infantry 于 (-2,0)
- 对手占领 cp_northeast + supply_northeast
- 收入：+8 base + 8 supply_west = 16

### 第5轮 (R5) — 第一次缩圈 safeRadius 6→5
- 行动：infantry at (0,0) 撤退至 (0,0)；heavy 推进至 (0,-1)；infantry 前推
- 对手占领更多据点
- 收入：+8 base + 8 supply_west = 16

### 第6轮 (R6)
- 行动：infantry 占领 supply_northwest (0,-3)；攻击敌方 infantry at (0,1)
- 对手占领 cp_northeast + supply_northeast
- 收入：+8 base + 8 supply_west + 8 supply_northwest = 24

### 第7轮 (R7) — 第二次缩圈 safeRadius 5→4
- 行动：攻击敌方 infantry at (1,-1)；heavy 推进
- 对手继续扩大据点和军队
- 收入：+8 base + 8 supply_west + 8 supply_northwest = 24

### 第8轮 (R8) — artillery 预警 safeRadius=4
- 行动：占领 cp_northwest (0,-4)；攻击敌方 infantry at (0,1)
- 对手夺回 supply_northwest
- 收入：+8 base + 8 cp_northwest + 8 supply_west = 24

### 第9轮 (R9) — 第三次缩圈 safeRadius 4→3 ⚠️
- **关键失误**：infantry at (1,2) 和 (0,-2) 未能及时撤离，被 artillery 击杀
- 剩余兵力大幅削弱

### 第10轮 (R10)
- 行动：仅剩 2 存活单位，攻击敌方 infantry at (-1,-1)
- 兵力严重不足

### 第11轮 (R11) — 第四次缩圈 safeRadius 3→2 ⚠️
- **关键失误**：2 个存活单位被 artillery 伤害，hp 降至 29 和 47

### 第12轮 (R12)
- 行动：2 单位勉强攻击，无法扭转局面

### 第13轮 (R13) — 第五次缩圈 safeRadius 2→1，终局
- 所有存活单位被 artillery 摧毁
- `player_eliminated` reason: `artillery_destroyed`

## 核心教训与关键转折

### 转折1：第9轮缩圈时未能及时撤离
第9轮 safeRadius 从4缩至3，我的 infantry at (1,2) hp=6 和 (0,-2) hp=17 未能及时撤至安全区，被 artillery 直接击杀。这2个单位的损失使我的兵力从5个骤减至3个，是战局的关键转折点。

### 转折2：第11轮缩圈至半径2时已无安全纵深
第11轮 safeRadius 缩至2，我的剩余2个单位均位于边界，被 artillery 伤害至 hp=29 和 hp=47。此时已无法通过移动规避炮火，败局已定。

### 转折3：第8轮后据点劣势无法逆转
第8轮后对手已控制5个 CP（cp_east, cp_northeast, supply_east, supply_northeast, cp_northwest），而我仅有3个（cp_west, supply_west, cp_northwest）。据点数差距导致对手拥有持续的收入和部署优势，我无法通过战斗弥补。

## 炮火、军力与裁决分账本

| 项目 | 数量/数值 | 权重 | 依据 |
|---|---:|---:|---|
| HQ伤害 / HQ最终HP | 不适用（无HQ） | — | `mode` |
| 最终据点数 | 3 | 0 | `controlPoint` 权重为0 |
| 存活军力价值 | 0 | 2 | `armyValue` 权重为2（最终为0） |
| 剩余补给 | 109 | 0 | `supplies` 权重为0 |
| `actionScore` | 310 | 10 | `effectiveActions` 权重为10 |
| 炮火承伤/击杀 | 承伤100（4次×25），击杀0（我方无单位因炮火击杀敌方） | — | 炮火事件（非独立裁决项） |
| **总分** | 310 | — | `game_over.payload.scores` |

**炮火总承伤：** 4次 artillery_damage 事件，每次25 HP，总承伤100 HP
**炮火击杀：** 0（我方单位被炮火击杀，但未击杀任何敌方单位）
**单位死亡原因：** 4个单位因 artillery_damage 死亡，1个单位因战斗受伤后 artillery 致死
**部署花费：** 1次 infantry 部署（cp_west → (-4,1)），花费45 supplies
**据点收入：** 3个据点的 income（cp_west, supply_west, cp_northwest）

## 实际做法 vs 正确做法

### 致命错误

1. **第9轮缩圈时未及时撤离危险区**：infantry at (1,2) hp=6 和 (0,-2) hp=17 位于危险格，未能在缩圈前移出。第9轮 artillery_shrunk 后 safeRadius=3，这两个单位被 artillery 直接击杀，导致兵力从5骤减至3。**触发条件**：对 warningCells 的预警反应不足，未能在 R8 末将边界单位内移。

2. **第11轮缩圈至半径2时仍在前线**：safeRadius=2 时已无安全纵深，但我的2个存活单位仍在边界位置（(-1,0) 和 (-1,2)），被 artillery 伤害至残血。**触发条件**：低估了缩圈速度（R11 缩至半径2后仅2轮即终局），未能提前回撤至中心。

### 低效行动

1. **早期过度前压**：R3-R4 期间将 heavy 推进至 (0,-1) 附近，但未能形成有效威胁。heavy 的 moveRange=2 限制了机动性，前推后难以支援或撤退。**正确做法**：应优先确保据点和补给，而非盲目前压。

2. **未能利用兵力优势进行集火**：R3-R4 期间我有3个单位对敌方2个单位形成局部优势，但未能集中火力击杀高价值目标（敌方 heavy）。**正确做法**：应优先集火敌方 heavy（cost=92，高价值目标），而非分散攻击。

## 与历史对局对比

无法可靠统计（仅此一局）。

## 总结

> **核心口诀：预警先撤离，保住据点才有下一波部署**
**一句话总结： artillery 缩圈节奏判断失误，第9轮和第11轮未能及时将单位撤至安全区，导致被炮火逐一扫除，最终以 `last_player_standing` 败于对手。**
