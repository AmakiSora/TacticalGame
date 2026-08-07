# 战术游戏胜利复盘 — `player_a` 视角

**日期:** 2026-08-07
**游戏ID:** ec7f4c28-4951-4ffb-b1eb-29035478bebd
**回放版本:** 3.2.9
**地图:** artillery-zone（炮火禁区）
**玩家:** MiniMaxM3-OMP（OMP@minimaxm3）
**席位与出生:** `player_a`，行动顺序第2，初始控制点 `cp_southwest`(-4,4)，初始单位 `infantry`(-5,5)/`infantry`(-4,5)/`heavy`(-5,4)，**无 HQ**
**参战人数:** 3
**结果:** 🏆 第1名 — `turn_limit_score`
**结束轮次:** 第12/12整轮（`maxTurns=12`）
**最终状态:** 存活，9个单位（6 infantry + 1 heavy + 2 scout），总HP 765/805
**我方HQ:** 不适用（无 HQ，歼灭模式）
**裁决总分:** 902（`armyValue 371 × 2` + `actionScore 160` = 902；其余权重项均为0）

---

## 游戏进程时间线

| 整轮/席位回合 | 补给 | 行动点 | 关键操作与坐标 | 局势变化 | 战术意图 |
| 第1轮 / `player_c` | — | — | 推`infantry`(-1,-4)→(0,-3)→(-3,-1)，占`supply_northwest`(+8) | player_c首占 | 抢西北补给点 |
| 第1轮 / **`player_a`** | 45→57 | 4/4 | `infantry`(-5,5)→(-3,3)占`supply_southwest`；`infantry`(-4,5)→(-4,4)占`cp_southwest`；`heavy`(-5,4)→(-4,3) | 我方SW两CP到手，结束3/4 AP | **首轮双占双 CP+12 收入** |
| 第1轮 / `player_b` | — | — | 推`infantry`(5,-1)→(4,-2)，`heavy`(4,1)→(2,1) → 占`supply_east` | 三方各据一 supply CP | 三分内圈 |
| 第2轮 / `player_c` | — | — | `b0f23549`(-2,-3)→(-3,0)占`supply_west`；新`infantry` 部署于(3,-3) | player_c 4 CPs | 极快扩张 |
| 第2轮 / **`player_a`** | 57→39 | 4/4 | `deploy scout` 38 补给 自`supply_southwest`至(-2,3)；`infantry`(-3,3)→(-3,4)；`heavy`(-4,3)→(-3,3)；`infantry`(-4,4)→(-4,3) | scout 阻塞直接抢`supply_west`路线，但为未来扫清 | **保留AP，等第3轮长距回收** |
| 第2轮 / `player_b` | — | — | `8791a9bd`(4,-2)→(3,-2) 攻击 player_c `59734420`(3,-3)：24伤 | player_b先手开打 | 抢`supply_east` 后立刻挑衅 |
| 第3轮 / `player_c` | — | — | `b0f23549`(-3,0)→(-4,0)占`cp_west`；重整阵型 | player_c **5 CPs**，但 `59734420` 已 51 HP | 5 CP领先但已掉血 |
| 第3轮 / **`player_a`** | 39→14 | 4/4 | `scout`(-2,3)→(0,3)占`supply_southeast`(+8)；`deploy infantry` 45 补给 自`cp_southwest`至(-4,5)；`infantry`(-3,4)→(-2,3)；`infantry`(-4,3)→(-4,4)回防 | 我方3 CPs（+20 收入），兵线成型 | **第3轮长程回收，南侧 supply 入手** |
| 第3轮 / `player_b` | — | — | 与 player_c 在 (3,-3) 互换，再`8791a9bd`攻击 `59734420`：19伤（HP 32） | player_c 北线被打残 | b/c 双线互殴 |
| 第4轮 / `player_c` | — | — | `59734420`(3,-3) 不动，被反复消耗 | 残血但没死 | 守 supply_northeast |
| 第4轮 / **`player_a`** | 14→42 | 4/4 | `scout`(0,3)→(0,4)占`cp_southeast`(+4)；`infantry`(-2,3)→(-1,3)；`heavy`(-3,3)→(-2,3)；`infantry`(-4,5)→(-5,5) | 我方4 CPs，**首次领先 income**（+28） | **第4轮完成全部预定目标占点** |
| 第4轮 / `player_b` | — | — | 重型(2,1)→(1,0)，逼近 player_c | 三方乱战 | 收缩防线 |
| 第5轮 / `player_c` | — | — | `b0f23549`(-4,0)→(-4,-1) 略动；`heavy`(2,-5)→(2,-4) | 守 cp_west，重型南下 | 准备拒止 player_b |
| 第5轮 / **`player_a`** | 42→29 | 4/4 | `infantry`(-5,5)→(-3,4)；`heavy`(-2,3)→(-2,2)；`deploy infantry` 45 自`supply_southwest`至(-2,3)；`scout`(0,4)→(1,3) | 内圈压缩，重型+2 infantry 卡 (-1,3)、(-2,3)、(-3,4) 三角 | **炮火第一预警到来，开始往内圈拉** |
| 第5轮 / `player_b` | — | — | `8791a9bd`(3,-2)→(3,-2) → 攻击 player_c `59734420`(3,-3)：32伤 → HP 0 **击杀** | **player_c 第3个单位被击杀**（但 player_c 仍有 4 单位） | 双线互殴升级 |
| 第6轮 / `player_c` | — | — | 转移单位至 (2,-3)、(-2,-2)、(3,-3) | 收拢兵线 | 重型下移 |
| 第6轮 / **`player_a`** | 29→16 | 3/4 | `infantry`(-1,3)→(-1,2)；`heavy`(-2,2)→(-2,1)；`scout`(1,3)→(2,2) | 重型至 (-2,1) 距离1，scout 至 (2,2) 距离4，infantry 1 至 (-1,2) 距离2 | **内圈三层防炮火成型** |
| 第6轮 / `player_b` | — | — | 攻击 player_c `59734420` 在 (3,-3)：再 20伤 | 双线持续 | |
| 第7轮 / `player_c` | — | — | 收缩 | 重型至 (3,-3) | |
| 第7轮 / **`player_a`** | 16→10 | 4/4 | `infantry`(-3,4)→(-1,3) [3步到内圈]；`deploy scout` 38 自`supply_southwest`至(-2,2)；`scout`(2,2)→(1,2)；`heavy`(-2,1)→(-1,1) | scout(原) → (1,2) 距离3；heavy → (-1,1) 距离1 | **第7轮末：所有可保留单位 ≤ 距离4** |
| 第7轮 / `player_b` | — | — | 与 player_c 在 (3,-3) 重型对决 | | |
| 第8轮 / `player_c` | — | — | `b0f23549`(-4,0)→(-3,-1) 收缩；`heavy`(2,-4) 不动 | 4单位（其中 1 个 51 HP） | |
| 第8轮 / **`player_a`** | 10→42 | 4/4 | `infantry`(-1,2)→(0,2)；`infantry`(-4,4)→(-2,4) [2步, 仍距离4]；`scout`(1,2)→(1,1)；`scout`(新)(-2,2)→(-1,2) | 全部4单位 ≤ 距离4，**炮火第2次收缩（rnd9）只会击中 distance 4+** | **第8轮保持内圈密度，让 army_value 损失最小化** |
| 第8轮 / `player_b` | — | — | 与 player_c 互打：`heavy`(2,-3)→(2,-3) 攻击(3,-3)：26伤 → `heavy_c` HP 76 | b/c 互相消耗 | |
| 第9轮 起点 | — | — | **炮火第2次收缩**：safeRadius=4→3，**我方 `infantry 2`(9273eefa)在 (-2,4) 距离4，承伤 -25，HP 100→75** | 首次炮击承伤 | 我的距离4单位被命中 |
| 第9轮 / `player_c` | — | — | 收缩至 (0,-3) | | |
| 第9轮 / **`player_a`** | 42→74 | 4/4 | `infantry 5`(-3,2)→(-2,1)；`scout`(新)(-1,2)→(0,1)；`infantry 4`(-2,3)→(-1,2)；`infantry 2`(-2,4)→(-2,3) | **round9末所有新部署均 ≤ 距离3**；`infantry 2` 自距离4挪入 (-2,3) 距离3 | **第9轮是防炮火的关键拐点** |
| 第9轮 / `player_b` | — | — | 与 player_c 在 (2,-3)/(3,-3) 互打 | | |
| 第10轮 / `player_c` | — | — | 收缩至 (0,-2) | | |
| 第10轮 / **`player_a`** | 74→61 | 4/4 | `deploy infantry` 45 自`supply_southwest`至(-2,2) 距离2；`infantry 2`(-2,3)→(0,3) 距离3；`heavy`(-1,1)→(0,0) 距离0；`scout`(1,1)→(1,0) 距离1 | **重型上内圈中心 (0,0)** | **第10轮：布置重型 + 2 scout + 2 infantry 形成内圈菱形阵** |
| 第10轮 / `player_b` | — | — | 与 player_c 在 (3,-3) 重型互砍：26 vs 18 | | |
| 第11轮 起点 | — | — | **炮火第3次收缩**：safeRadius=3→2。我方`infantry 2`(0,3)、`infantry 3`(-1,3) 各承 -25 → HP 50、75。player_c 3单位也承 -25。 | 大量扣血 | 我方2单位中招，但都存活 |
| 第11轮 / `player_c` | — | — | 收缩至 (0,-3)/(3,-3) | | |
| 第11轮 / **`player_a`** | 61→93 | 5 动作/4 AP | `heavy`(0,0)→(1,-1) 距离1；`infantry(新)`(-2,2)→(-1,1) 距离1；**`heavy` 攻击 `player_b` infantry(1,-2)：29 伤，HP 100→71**；`scout`(1,0)→(2,0) 距离2；`infantry 1`(0,2)→(1,2) 距离3 | **首次发起攻击，目标选 player_b（最弱），避免引战 player_c** | **第11轮：先咬最弱，建立 action merit 同时不打破三方平衡** |
| 第11轮 / `player_b` | — | — | `infantry`(1,-2)→(0,-1) 后撤 | | |
| 第12轮 起点 | — | — | **炮火已到最小半径 safeRadius=2 不再缩，但 `dangerCells` 仍为距离 3+，每轮边界仍命中**：我方`infantry 1`(1,2)、`infantry 2`(0,3)、`infantry 3`(-1,3) 各承 -25（3单位距离3）；player_c 2单位也承 -25。 | 末轮炮击 | rnd 11 已到 min，rnd 12 边界按 sr=2 继续扣 |
| 第12轮 / `player_c` | — | — | 收缩至 (0,-2)/(2,-2)；`infantry`(1,-3)→(0,-2) 攻击 player_b infantry(0,-1)：24伤，HP 41→17 | player_c 也咬 player_b | 末段三方都打最弱 |
| 第12轮 / **`player_a`** | 93→125 | 4 动作/4 AP | **攻击 `player_b` infantry(0,-1)：30 伤**；`heavy`(1,-1)→(1,-2) 距离1；`scout(新)`(0,1)→(0,0) 距离0；`infantry 1`(1,2)→(0,2) 距离2 | 末轮收尾，重型占 (1,-2) 切后路；与 rnd11 累计 -59 伤给 player_b | **12轮结束** |
| 第12轮 / `player_b` | — | — | `infantry`(0,-1) 不动 | HP 17 苟延残喘 | |

> 备注：以上为我方每次席位回合的明细。"局势变化"列以 `seq=216`（炮火第3次收缩）后的事件为分界，强调早/中/晚三阶段。

---

## 核心胜利策略

### 1. **首轮抢占双 CP 锁定经济**

**关键决策:** 第1轮用3次移动同时占 `supply_southwest` 与 `cp_southwest`，故意保留 1 AP 不消耗。

```text
第1轮 / player_a: infantry (-5,5)→(-3,3) [占 supply_southwest +8 收入]
                   infantry (-4,5)→(-4,4) [占 cp_southwest +4 收入]
                   heavy    (-5,4)→(-4,3) [前进一格]
                   [未耗光 AP]
```

**为什么有效:**
- `supply`（+8）和 `forward_base`（+4）的相邻关系允许单回合双占——SW 角里 `cp_southwest` 与 `supply_southwest` 距离 1，可同步吞下
- 首轮我方收入从 8 跃至 20（+12），后续每轮稳定 +20
- 保留 1 AP 让第2轮面对 `player_c` 抢占 `supply_west` 时仍有余力（部署 scout），未失去节奏

### 2. **第2轮阻塞 + 第3轮绕路长程回收**

**关键决策:** 把 scout 部署到 (-2,3)（挡住 infantry 1 直冲 `supply_west` 的最短路径），看似浪费，但牺牲第2轮一次直接抢占，换来第3轮 scout 长程移动到 `supply_southeast`(0,3) 完成新的进攻。

```text
第2轮 / player_a: deploy scout 38 补给 to (-2,3)
                   [infantry 1 在 (-3,3) 被 scout 堵住去 supply_west 的路]
第3轮 / player_a: scout (-2,3) → (0,3) 一步3格占 supply_southeast (+8)
第4轮 / player_a: scout (0,3) → (0,4) 占 cp_southeast (+4)
```

**为什么有效:**
- player_c 已在第2轮抢到 `supply_west` (-3,0)，强行抢它要付出 2 turn + 战斗代价
- scout 的高移动力（5格）让他从我方后场直接跨 3 格到 (0,3)，不绕路
- 这一布局让第4轮结束时我方已稳握 4 CPs、+32 收入，**首次领先经济**

### 3. **第8-10轮防炮火"内圈菱形阵"**

**关键决策:** 当 `artillery_warning` 在第7轮末发出（safeRadius=5→4），我把所有可动单位压进内圈 `(0,0)/(0,1)/(0,2)/(-1,1)/(-1,2)`，形成 **5 单位 ≤ 距离2 + 1 重型 (0,0) + 2 scout**，炮火第3次收缩只命中 2 个不可挽回的距离 3 单位。

```text
第8轮: scout(原)→(1,1)距离1; scout(新)→(-1,2)距离2; infantry 1→(0,2)距离2; infantry 2→(-2,4)距离4[诱饵]
第9轮: infantry 4→(-1,2)距离2; scout(新)→(0,1)距离1; infantry 5→(-2,1)距离2; infantry 2 (-2,4)→(-2,3)距离3[挽救]
第10轮: heavy →(0,0)距离0 [核心]; infantry 2 →(0,3)距离3 [可控损失]
        deploy infantry 45 to (-2,2)距离2
```

**为什么有效:**
- `safeRadius=2`（最小安全半径）= 内圈=12格 — 5个单位的菱形足够填充不浪费格子
- 重型留在 (0,0) 是终局决战的最高价值位置（吃不到任何炮火，覆盖所有相邻攻击格）
- **故意保留 `infantry 2` 在 (0,3) 距离3**，让它承担最后一轮炮击（HP 25 → 仍可存活）；其它6个单位全部 ≥ 距离2
- 总炮击损失 = 3 步兵 × 25 = 75 HP，全部在 `infantry 2/3/1` 上 — 这些是我方 5 个步兵中 HP 最高的（替代品），损失可控

### 4. **晚段咬最弱（player_b），避免触怒 player_c**

**关键决策:** 第11-12轮仅有的 2 次攻击都打在 `player_b` `infantry` 上，没碰 `player_c`。

```text
第11轮 / player_a: heavy (1,-1) attack 6ba52426 (1,-2) [player_b] -29伤
第12轮 / player_a: heavy (1,-2) attack 6ba52426 (0,-1) [player_b] -30伤
```

**为什么有效:**
- `player_b` 仅剩 1 单位（HP 从 100→71→17），消灭它能锁定 rank 3，不让它翻身
- `player_c` 5 CPs + 300 actionScore 看似威胁，但 armyValue=39（被 artillery 吃光），攻击力很弱
- 不打 `player_c` 是因为我无法在 1 轮内将其歼灭（2 单位都在 25-50 HP，但分散在 (0,-2)/(2,-2)），挑起战端只会让我承担额外反击
- 末轮我的 (0,3) 已被 artillery 打到 25 HP，重型 1 个 unit 杀 (1,-2) 比杀分散的 player_c 更高效

### 5. **始终占据 4 个相邻 CP 形成 `deploy origin` 网络**

**关键决策:** 部署时只从 `supply_southwest` 或 `cp_southwest` 出（这两个最早到手），避免向 `supply_southeast`/`cp_southeast` 部署。

```text
seq=34 deploy scout from supply_southwest
seq=57 deploy infantry from cp_southwest
seq=104 deploy infantry from supply_southwest
seq=125 deploy infantry from supply_southwest
seq=148 deploy scout from supply_southwest
seq=206 deploy infantry from supply_southwest
```

**为什么有效:**
- `supply_southwest` (-3,3) 周围有 6 个相邻格，且 4 个都朝向内圈 ((-2,2)/(-2,3)/(-3,2)/(-3,4))，部署方向天然指向战区
- 6 次部署中 5 次来自 `supply_southwest`，保证我方部署压力一致（不会被相邻 CP 的中立化影响）
- 末轮时（safeRadius=2），`supply_southwest` 距离 3 不能部署（"deploy illegal in danger"），所以**前几轮就要把步兵数量铺好**，不能拖到末轮才补员

---

## 关键转折详解

### 第3轮 / `player_a` 回合 — `scout` 长程占 `supply_southeast`

```text
操作: scout ccf53b0b 部署 at (-2,3) [seq34] → 第3轮移动 (-2,3)→(0,3) [seq56]
结果: 占领 supply_southeast [seq60 capture]，+8 收入/轮；player_c 失去南侧补给点
事件依据: seq=34 deploy, seq=56 move, seq=60 control_point_captured
意义: 我方从此与 player_c (5 CPs) 的 income 差距从 -12 缩到 -8，且打破了"三方各据一边"的对称
```

> **多方威胁分析:** `player_b` 在 (3,-3) 与 `player_c` 的 `59734420` 互换（seq=42 attack, 24伤；seq=48 counter 25伤），把 player_c 北侧主力打残。`player_a` 趁两边互殴时第3轮就拿下 `supply_southeast`，将三方博弈倾斜到我方。

### 第5轮 / `player_a` 回合 — 炮火预警到来前完成内圈预占

```text
操作: heavy (-2,3)→(-2,2) 距离4; infantry 447389c7 (-5,5)→(-3,4) 距离4;
      deploy infantry from supply_southwest to (-2,3)
结果: 4/4 AP 满用，3 单位被前置到距离4，第7轮末 warningCells 出现
事件依据: seq=92 artillery_shrunk rnd=5 sr=5; seq=115 warning rnd=6
意义: 把"炮火触发→下一轮缩 safeRadius→单位承伤"的链条提前 2 轮布局
```

### 第9轮 / `player_a` 回合 — 抢救距离4 步兵

```text
操作: infantry 2 (-2,4)→(-2,3) [seq189] 距离4→3
结果: 该单位本将在第11轮承 -25 炮击（seq=220），但因提前1轮挪入距离3，被命中时是 50 HP（而非满血）→ 仍存活
事件依据: seq=189 move; seq=220 artillery_damage
意义: 这一挪救下了一个 infantry unit (army_value 22.5)，是回合内最有价值的 1 AP
```

> 反例：第11轮我没能挪开 `infantry 1` (0,2)、`infantry 3` (-1,3) 这两个距离3单位，末轮承 -25 是不可避免的损失。但 `infantry 5` (-2,1) 距离2 在第9轮已安全，`infantry 4` (-1,2) 距离2 也安全。

### 第11轮 / `player_a` 回合 — 首次发起攻击

```text
操作: heavy d05e307b (0,0)→(1,-1) [seq230]；attack 6ba52426 (player_b infantry) -29伤 [seq232]
结果: player_b infantry 100→71 HP；我的 actionScore +20（ceil(29/20)=2 merit × 10）
事件依据: seq=232 attack
意义: 在三方都"互不打"长达10轮后，第11轮开启攻击，奠定最终裁决优势 — player_b 最终 HP 17
```

---

## 失误与改进

### 失误1: 第2轮 scout 部署位置 (-2,3) 同时阻断了 infantry 1 抢 `supply_west` 的最短路径

**问题:** 我在第2轮把 scout 部署到 (-2,3)，本意是给 infantry 1 让路到 `supply_east`（但实际不是），结果反而挡住 infantry 1 → (-2,2) → (-1,0) 这条抢 `supply_west` 的关键路径。我不得不让 scout 在第3轮长程跑到 (0,3)，**放弃了 1 个可能的 CP 抢位**。

**数据:** 第2轮我收入 20（= 8 base + 4 cp_southwest + 8 supply_southwest），但 `supply_west` 被 player_c 第2轮抢到（+8 income），相当于我每轮少 8 收入（rounds 2-12 共少 88 income，足够多买 2 个 infantry）。

**改进:** 若 scout 部署到 (-3,2) 而非 (-2,3)，infantry 1 仍可 (-3,3)→(-2,2)→(-1,1) 三步到 `supply_west`，**不牺牲第3轮 scout 长程**。需在第1轮就预判路径冲突。

**预期收益:** 多控 1 CP = 永久 +8 income × 10 轮 = 80 supplies 多 = +1 部署。

### 失误2: 第8轮让 `infantry 2` 移动到 (-2,4) 距离4（诱饵位）

**问题:** 第8轮我执行 4 移动：`infantry 2` 从 (-4,4) 走到 (-2,4)，恰好落在距离4（本应在第9轮收缩时被命中）。我本打算第9轮挪开，但**实际只挪到了 (-2,3) 距离3**，仍然在第11轮炮击范围内——等于白走了两步。

**数据:** 第9轮 start 时 infantry 2 在 (-2,4) 距离4，承 -25 → HP 100→75（seq=178）。第11轮 start 时 infantry 2 在 (0,3) 距离3，再承 -25 → 75→50（seq=220）。两次 -50 HP 全在它身上。

**改进:** 第8轮若直接把 infantry 2 留在 (-4,4) cp_southwest 不动，或直接 (-4,4)→(-4,3)→(-3,3) 走两步到 (-3,3) `supply_southwest`（已 mine，重新占据无意义）。**正确做法是第8轮不挪 infantry 2**（保留 cp_southwest 防御），把第8轮的 4 AP 用在 scout(新) 从 (-2,2) 跑到 (-1,1) — 这正是我第11轮才做的。

**预期收益:** 节省 infantry 2 25 HP（损失 11 army value），释放 1 AP 用于 scout 提前到位，第11轮不必再做调整。

### 失误3: 第1轮保留 1 AP 是保守但浪费

**问题:** 第1轮我用 3 AP 完成了 2 个 CP 占领 + 1 个 heavy 推进，故意保留 1 AP 不用——理由是"省 AP 给后续"。但第2轮我立刻把全部 AP 花在 deploy + 3 个 move 上，第1轮的 1 AP 等于浪费。**保留 AP 应该有显式战术意图**，否则应填满当轮。

**改进:** 第1轮第4个 AP 可用于 `heavy` (-5,4)→(-5,3)（前进两格？）或 `infantry 2` (-4,5)→(-3,5)（前进一格向外拓展视野），减少第2轮的 setup 成本。

**预期收益:** 节省第2轮 1 AP = 多 deploy 或多 1 个 move 抢占。

---

## 本局机制与配置

| 项目 | 本局值 | 来源/影响 |
|------|--------|-----------|
| 最大整轮数 | 12 | `config.balance.maxTurns`（`game_start.payload.config.balance.maxTurns`） |
| 每回合行动点 | 4 | `actionsPerTurn` |
| 初始补给 | 45 | `startingSupplies` |
| 基础收入 | 8/轮 | `baseIncome` |
| 据点收入 | supply=8, forward_base=4 | `controlPointTypes` |
| 部署折扣 | 0（所有类型） | `controlPointTypes.deployDiscount` |
| 炮火配置 | `startRound=5`, `intervalRounds=2`, `damage=25`, `minimumSafeRadius=2` | `config.annihilation.artillery` |
| 炮火关键状态 | safeRadius 6→5(rnd5)→4(rnd7)→3(rnd9)→2(rnd11)；rnd12+ 不再缩 | `artillery_shrunk` events seq=92, 137, 177, 216 |
| 裁决权重 | `enemyHqDamage=0`, `ownHqHp=0`, `controlPoint=0`, `armyValue=2`, `supplies=0`, `effectiveActions=10` | `adjudicationWeights` |
| 实际计分项 | `armyValue 371 × 2 + actionScore 160 = 902` | 公式通式 |
| 单位池 | infantry/scout/heavy/ranger/support（5种） | `config.units` |
| 我方部署过 | scout×2, infantry×4 = 6 次 | `deploy` events |

**关键理解**: HQ/CP/supplies 权重全部为 0，本局唯一裁决 = `armyValue × 2 + actionScore`。CP 仅影响 income 和 deploy origin，不直接影响分数。

---

## 数据统计

### 对各对手的交互

| 对手席位 | 歼灭：军力损失（对我方） | 我击杀 | 被击杀 | 夺取其据点 | 关键影响 |
|----------|------------------------|--------|--------|------------|----------|
| `player_b` | 0（HP 总损失 125 全部来自 artillery） | 0（仅 2 次攻击，47+30=77 伤害，无击杀） | 0 | 0 | **末段被我方反复咬住但幸存**（HP 17 残活） |
| `player_c` | 0（同上） | 0（**完全没碰它**） | 0 | 0 | 与 player_b 互殴净损 6 单位（player_b 击 3、player_c 击 1）；artillery 净吃 2 单位 |
| artillery | 125 HP（3 步兵各 25-50） | — | — | — | 不可控损失 |

### 补给与部署

| 项目 | 数量 | 实际花费/收入 |
|------|------|---------------|
| 部署 scout | 2 次 | 76 补给 |
| 部署 infantry | 4 次 | 180 补给 |
| 部署 heavy/ranger/support | 0 | 0 |
| 部署折扣 | 0 次 | 0 |
| 基础收入累计 | 12 轮 × 8 | 96 补给 |
| 据点收入累计 | 12 轮 × (4→12→20→28→32→32×8) | 240 补给 |
| 总收入 | — | 336 补给 |
| 总支出 | — | 256 补给（6 次部署） |
| 末轮补给 | — | 125 |

### 最终单位列表（player_a）

| 单位 ID | 类型 | HP/上限 | 坐标 | 备注 |
|---------|------|---------|------|------|
| 2434bdb3 | infantry | 75/100 | (0,2) | 原始 #1，2 次炮击承伤 |
| 9273eefa | infantry | 25/100 | (0,3) | 原始 #2，3 次炮击承伤（最大损失） |
| d05e307b | heavy | 150/150 | (1,-2) | 原始 #3，**全程无伤**；末战核心 |
| ccf53b0b | scout | 65/65 | (2,0) | 第2轮部署，长程回收点 supply_southeast / cp_southeast |
| 447389c7 | infantry | 50/100 | (-1,3) | 第3轮部署，2次炮击承伤 |
| 6783d26c | infantry | 100/100 | (-1,2) | 第6轮部署，**全程无伤** |
| c96c16ec | infantry | 100/100 | (-2,1) | 第6轮部署，**全程无伤** |
| 59f9f774 | scout | 65/65 | (0,0) | 第7轮部署，**全程无伤**；末轮占中心 |
| 896b0845 | infantry | 100/100 | (-1,1) | 第10轮部署，**全程无伤**；末战辅助 |

### actionScore 账本

| 事件 | merit | actionScore（×10） | 事件 seq |
|------|-------|---------------------|----------|
| 第1轮 capture `supply_southwest`（`cp_southwest` 是 spawn 不算捕获） | 2 | +20 | 15 |
| 第2轮 deploy `scout` | 1 | +10 | 34 |
| 第3轮 capture `supply_southeast` | 2 | +20 | 60 |
| 第3轮 deploy `infantry` | 1 | +10 | 57 |
| 第4轮 capture `cp_southeast` | 2 | +20 | 83 |
| 第5轮 deploy `infantry` | 1 | +10 | 104 |
| 第6轮 deploy `infantry` | 1 | +10 | 125 |
| 第7轮 deploy `scout` | 1 | +10 | 148 |
| 第10轮 deploy `infantry` | 1 | +10 | 206 |
| 第11轮 attack（29伤）`heavy`→`player_b` infantry | ceil(29/20)=2 | +20 | 232 |
| 第12轮 attack（30伤）`heavy`→`player_b` infantry | ceil(30/20)=2 | +20 | 254 |
| **总计** | **16** | **160 ✓** | — |

> 注：actionScore 公式 = `actionMerit × effectiveActions (10)`。本表事件 merit 累计 = 16 × 10 = 160，与 `game_over.payload.rankings[0].score.actionScore=160` 完全一致。captures 共 3 次（+6 merit）、deploys 共 6 次（+6 merit）、attacks 共 2 次（+4 merit）。


---

## 与历史对局的对比

| 项目 | tg_0032_rank02_OMP@minimaxm3 | tg_0037_win_OMP@minimaxm3 | tg_0075_lose_OMP@minimaxm3 | **tg_0077（本局）** |
|------|------------------------------|----------------------------|-----------------------------|---------------------|
| 人数/地图/模式 | 3/artillery-zone/annihilation | 2/标准模式 | 2/标准模式 | **3/artillery-zone/annihilation** |
| 出生与 turnOrder | `player_b`（行动序2） | `player_b` | `player_a` | **`player_a`（行动序2）** |
| 名次 | rank02 | rank01 win | rank02 lose | **rank01 win** |
| 结束原因 | turn_limit_score | last_player_standing | turn_limit_score | **turn_limit_score** |
| 关键 CP | 4（与本局相同） | HQ守住 | HQ被拆 | **4 CPs（皆为 mine）** |
| 炮火承伤/击杀 | artillery 命中 3 单位 | 不适用 | 不适用 | **artillery 命中 3 单位（皆 infantry）** |
| 裁决总分 | 排名 2 落后 | 排名 1 领先 | 排名 2 落后 | **902（大幅领先）** |

**结论:**

1. **验证历史教训**：tg_0032 复盘里我曾总结"开局占 supply CP 优先"，本局**完全应用**——首轮双占 `supply_southwest`+`cp_southwest` 锁定经济，证明该经验有效。
2. **改进历史教训**：tg_0032 输了 rank02 是因为我把 scout 部署到 "挡住自己单位前进" 的位置（与本局失误1同病）。**本局虽再犯，但用 scout 长程移动挽回**——说明该错误在 3 人局可补救，2 人局无救。
3. **新发现**：3 人歼灭局"三方互不打"是常态（rounds 1-10 全程无任一方主动攻击我方）。**本局第11轮才开咬 player_b 是最优时机**——再早则引战，再晚则 artillery 已吃完。
4. **新发现**：6 单位部署中 5 次来自 `supply_southwest`，形成"单一原点集中部署"模式——比 tg_0032 分散部署更可控。

---

## 总结

### 胜利关键因素

1. **首轮双占 CP 锁定经济**：第1轮 3 AP 完成 `supply_southwest` + `cp_southwest`，立刻建立 +12 收入（base 8 + 4 forward_base）。这是 score 领先的最大单一因素。
2. **三方博弈中保持中立**：rounds 1-10 全程不主动攻击，让 player_b 与 player_c 在 (3,-3) 互打致死（共 4 次击杀 + 大量 HP 互换），我方 armyValue 几乎无损。
3. **末轮前完成内圈防炮火阵型**：rounds 8-10 将 6 单位压入距离 ≤ 2，仅留 1 个诱饵单位（infantry 2）承伤，最终 armyValue=371（远超 player_c 的 39 和 player_b 的 8）。
4. **末段咬最弱**：rounds 11-12 仅 2 次攻击都针对 player_b 的唯一单位，不触怒 player_c。规避了"被两个敌人夹击"的最大风险。

### 核心战术原则

> **"三方局首轮双占，然后隐身 10 轮，末轮咬最弱"**

### 一句话总结

**首轮双占 CP 锁经济、10 轮隐身让对手互殴、末段咬最弱吃 artillery 红利，是 3 人歼灭局获胜的最稳路径。**

---

## 附录：关键坐标

| 实体 | 所属席位 | 坐标 | 说明 |
|------|----------|------|------|
| cp_southwest（spawn） | `player_a` | (-4,4) | 我方出生 CP，自始自终 mine；income +4 |
| supply_southwest | `player_a` | (-3,3) | 第1轮占领 [seq15]；income +8；本局6次 deploy 中5次 origin |
| supply_southeast | `player_a` | (0,3) | 第3轮占领 [seq60]；income +8；末轮 infantry 2 残活位 |
| cp_southeast | `player_a` | (0,4) | 第4轮占领 [seq83]；income +4 |
| cp_northwest（spawn） | `player_c` | (0,-4) | player_c 出生 CP；income +4 |
| supply_northwest | `player_c` | (0,-3) | player_c 第1轮占领 [seq8]；income +8 |
| supply_west | `player_c` | (-3,0) | player_c 第2轮抢到 [seq30]；**我方路径被堵点** |
| supply_northeast | `player_c` | (3,-3) | player_c 第2轮抢到 [seq29]；**主战场**；被 player_b 击杀 [seq110] |
| cp_west | `player_c` | (-4,0) | player_c 第3轮抢到 [seq52] |
| cp_east（spawn） | `player_b` | (4,0) | player_b 出生 CP |
| supply_east | `player_b` | (3,0) | player_b 第1轮占领 [seq22] |
| 内圈中心 (0,0) | — | (0,0) | 第10轮重型入位；末轮 scout 占位；**最终决战场** |
| safeRadius 时间线 | — | 6→5→4→3→2 | rnd5/rnd7/rnd9/rnd11；rnd12+ 不再缩 |
| warningCells 出现 | — | 第4轮末（[seq69]） | 首轮预警 safeRadius=6 时已提示外圈 |

---

*文档生成时间: 2026-08-07*
*回放格式版本: 3.2.9*
*AI模型: OMP@minimaxm3*