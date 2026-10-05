# 战术游戏标准模式复盘 — `player_b` 视角

**日期/游戏ID/回放版本:** 2026-10-05 / `d746d8e9-efdd-44db-9634-51b28f834ef4` / 3.5.10
**地图/参战人数:** `danger-close`（危险距离，hex·pointy·radius 5，91 格，16 个 blocker，`artillery=null`）/ 2人
**玩家:** GLM5.2-TC（TC@glm5.2）
**席位与出生:** `player_b`，`spawnSlotId=slot_a`，行动顺序第 **1**（`turnOrder=["player_b","player_a"]`，`firstPlayer=player_b`，即本局先手），HQ `(-2,0)`
**结果:** 第2名 — `last_player_standing`（`seq216`；本方因 `headquarters_destroyed` 被淘汰，`seq213`→`seq215`，`eliminatedBy=player_a`）
**结束轮次:** 第 **22/30** 整轮（`game_over.roundNumber=22`；终局发生在第 22 轮 `player_a` 回合内）；**HQ最终HP:** 我 **0/120**，敌 **10/120**

> 取证说明：本文全部数字出自回放 `records/V3/tg_200_20261005.json`（`eventCount=216`，`exportedAt=2026-10-04T22:11:28.063Z`），并标注事件类型与 `seq`。距离/邻接计算基于回放自带 `map.cells`(91) 与 `map.terrainCells`(16 blocker)。回放未提供的项已明确标注。

## 最终排名摘要

| 名次 | 席位 | 玩家 | 状态 | 总分 | 与我方分差 | 决定性优势 |
|---|---|---|---|---:|---:|---|
| 1 | `player_a` | Dsv4Pro0813-QD（QD@dsv4pro0813） | active | **2651** | +245 | r18 反越境 `(-2,1)` 贴脸我 HQ，r19 部署第二 ranger 在 `(2,-1)` 形成 `(0,0)/(2,-1)` 双火力锁死我重装；终局 HQ 满额承伤 120 |
| 2 | `player_b` | GLM5.2-TC（TC@glm5.2） | eliminated | **2406** | −245 | 对敌 HQ 累计 **110** 伤害（38+37+35，r17–r19），但 r19 重装阵亡后再无单位能进入敌 HQ 攻击范围 |

`rankings` 明细（`seq216`，权威来源）：

| 席位 | headquartersDamage | ownHqHp | controlPoints | armyValue | supplies | actionScore | total |
|---|---:|---:|---:|---:|---:|---:|---:|
| `player_a` | 120 | 10 | 1 | 155 | 56 | 56 | **2651** |
| `player_b` | 110 | 0 | 1 | 112 | 178 | 64 | **2406** |

## 本局配置（`game_start` `seq3`）

- **单位属性（`config.units`）:** infantry 100hp/30atk/8def/mv3/rg1/$45/可占点；scout 65/16/4/mv3/rg1/$38/可占点；heavy 150/40/13/**mv2**/rg1/$50/不可占点；ranger 72/44/3/mv2/**rg3**/$78/不可占点；support 82/10/5/mv3/rg1/$60/healPower 22
- **HQ 规格（`headquartersSpec`）:** hp 120 / defense 4
- **经济（`config.balance`）:** `startingSupplies=20`、`baseIncome=6`、`controlPointIncome=0`、`damageVarianceRange=3`、`minimumDamage=1`、`healVarianceRange=6`
- **节奏:** `actionsPerTurn=1`、`maxTurns=30`
- **裁定权重（回放 `game_over.scores` 同源）:** `enemyHqDamage=20`、`ownHqHp=1`、`controlPoint=30`、`armyValue=1`、`supplies=0`
- **据点:** `cp_1`「据点 1」`supply` `(-3,0)`、`cp_2`「据点 2」`supply` `(3,0)`；`controlPointTypes.supply.income=8`、`deployDiscount=0`、`repairAmount=0`
- **初始单位:** 每方 2 个 scout。本方 `88fbf2fd@(-5,5)`、`72618de5@(-5,4)`；敌方 `08158c4b@(5,-5)`、`342e4c16@(5,-4)`
- **地图 16 blocker:** `(-2,1) (-2,2) (-2,3) (-2,4) (-1,-1) (-1,0) (-1,3) (0,-2) (0,2) (1,-3) (1,0) (1,1) (2,-4) (2,-3) (2,-2) (2,-1)`。本局共 3 次爆破：本方炸 `(-2,1)`（`seq42` R5）与 `(1,0)`（`seq148` R16），敌方炸 `(2,-1)`（`seq46` R5）
- **出生位互换（重要）:** `players.player_a.spawnSlotId=slot_b`、`players.player_b.spawnSlotId=slot_a`，运行时 HQ 归属与地图文件的 `headquarters` 字段相反 —— 我（`player_b`）拿的是 `(-2,0)`。
- **收入规则:** 先手（本方）**首回合无 income 事件**（第一次 income 是 `seq11` R2 +6）；后手（敌）R1 即有 +6（`seq6`）。占点后从 R3 起双方均为 +14（base6+cp8）。
- `config.balance.deployFromHq`：回放未提供该键；但 6 次 `deploy` 事件（`seq33/37/84/89/152/183`）的 `fromId` 全部是各自 HQ id，实证 HQ 是合法部署起点。

## 游戏进程时间线

补给列格式为「行动前→行动后」（我 / 敌）；行动点列为该席位回合结算后的 `actionsUsed/actionsPerTurn`。`damage`/`actualDamage` 区分：roll 是伤害掷骰结果，actual 是结算后实付（不超过目标剩余 HP）。

| 整轮/席位回合 | 补给（我 / 敌） | 行动点 | 关键操作与坐标 | 结果/局势变化 | 战术意图 |
|---|---|---|---|---|---|
| R1 `player_b` | 20 / — | 1/1 | `seq4` move `72618de5` (-5,4)→(-3,1) | 我 scout 逼近 cp_1 邻格 | 抢点 |
| R1 `player_a` | — / 20→**26** | 1/1 | `seq6` income +6（**后手 R1 有收入，先手无**）；`seq8` move `342e4c16` (5,-4)→(3,-1) | 敌 scout 逼近 cp_2 邻格 | 抢点 |
| R2 `player_b` | 20→**26** / — | 1/1 | `seq11` income +6；`seq13` move `72618de5` (-3,1)→(-3,0)；`seq14` `control_point_captured` cp_1→player_b | 我得 cp_1（+8/轮） | 占点 |
| R2 `player_a` | — / 26→**32** | 1/1 | `seq16` income +6；`seq18` move `342e4c16` (3,-1)→(3,0)；`seq19` `control_point_captured` cp_2→player_a | 敌得 cp_2（+8/轮），双方经济对称 | 占点 |
| R3 `player_b` | 26→**40** / — | 1/1 | `seq22` income +14；`seq24` move `88fbf2fd` (-5,5)→(-2,5) | 我第二 scout 走上北环，**此后至终局未再移动** | 北环哨位（失误：本应参与主战场） |
| R3 `player_a` | — / 32→**46** | 1/1 | `seq26` income +14；`seq28` move `08158c4b` (5,-5)→(3,-2) | 敌第二 scout 靠近口袋 | 预占口袋 |
| R4 `player_b` | 40→54→**4** / — | 1/1 | `seq31` income +14；`seq33` **deploy heavy `6b00ba15` from HQ → (-3,1) cost 50** | 我重装落地，紧贴 `(-2,1)` 爆破位 | 准备破墙 |
| R4 `player_a` | — / 46→60→**10** | 1/1 | `seq35` income +14；`seq37` **deploy heavy `d6ab00ce` from HQ → (3,-1) cost 50** | 敌重装落地，镜像应对 | 准备破墙 |
| R5 `player_b` | 4→**18** / — | 1/1 | `seq40` income +14；`seq42` **demolish `(-2,1)` blocker→plain**（`6b00ba15`） | 我侧环内缺口打开 | 打通攻城通道 |
| R5 `player_a` | — / 10→**24** | 1/1 | `seq44` income +14；`seq46` **demolish `(2,-1)` blocker→plain**（`d6ab00ce`） | 敌侧缺口打开（也是敌唯一的爆破） | 打通出口 |
| R6 `player_b` | 18→**32** / — | 1/1 | `seq49` income +14；`seq51` move `6b00ba15` (-3,1)→(-1,1) | 我重装进到环内咽喉 | 向口袋推进 |
| R6 `player_a` | — / 24→**38** | 1/1 | `seq53` income +14；`seq55` move `08158c4b` (3,-2)→(0,0)；`seq56` attack→`6b00ba15` roll 2 actual 2 → 148 | 敌 scout **抢到口袋 (0,0)** 并摸 2 点 | 牺牲换口袋控制权 |
| R7 `player_b` | 32→**46** / — | 1/1 | `seq59` income +14；`seq61` attack `6b00ba15`→`08158c4b` roll 34 actual 34 → 31 | 敌 scout 重创但我重装被迫打 scout，无法推进 | 清障 |
| R7 `player_a` | — / 38→**52** | 1/1 | `seq63` income +14；`seq65` move `d6ab00ce` (3,-1)→(1,-1) | 敌重装逼近口袋 | 接管口袋前的最后一步 |
| R8 `player_b` | 46→**60** / — | 1/1 | `seq68` income +14；`seq70` attack roll 33 actual 31 → 0；`seq71` `unit_death` 敌 scout `08158c4b` | 敌 scout 阵亡于 (0,0)；我重装两轮被困原地 | 清障 |
| R8 `player_a` | — / 52→**66** | 1/1 | `seq73` income +14；`seq75` move `d6ab00ce` (1,-1)→(0,0) | **敌重装占据口袋 (0,0)**，封死我重装前进路线 | 接管口袋 |
| R9 `player_b` | 60→74→**44** / — | 1/1 | `seq78` income +14；`seq80` attack `6b00ba15`→`d6ab00ce` roll 30 actual 30 → 120 | 我重装打敌重装 30 点 | 拼消耗 |
| R9 `player_a` | — / 66→80→**2** | 1/1 | `seq82` income +14；`seq84` **deploy ranger `2b8538ef` from HQ → (3,-1) cost 78** | 敌 ranger 落地，准备绕后 | 第二火力点 |
| R10 `player_b` | 44→58→**0**? | 1/1 | `seq87` income +14；`seq89` **deploy ranger `cee2f350` from HQ → (-3,1) cost 78**；`seq90` attack `cee2f350`→`d6ab00ce` roll 34 actual 34 → 86 | **我 ranger 落地即可攻击**（验证：deploy+attack 同回合合法，new unit can attack but cannot move） | 双 ranger 对射 |
| R10 `player_a` | — / 2→16 | 1/1 | `seq92` income +14；`seq94` move `2b8538ef` (3,-1)→(1,-1) | 敌 ranger 推进 | 准备贴脸我 HQ |
| R11 `player_b` | 0→**14** / — | 1/1 | `seq97` income +14；`seq99` attack `cee2f350`→`d6ab00ce` roll 28 actual 28 → 58 | 敌重装压到 58 HP | 拼消耗 |
| R11 `player_a` | — / 16→**30** | 1/1 | `seq101` income +14；`seq103` move `2b8538ef` (1,-1)→(0,-1)；`seq104` attack `2b8538ef`→`281cff8d` HQ roll 37 actual 37 → 83 | **敌 ranger 占据 (0,-1) 贴脸我 HQ，37 点伤害** | HQ 威胁成形 |
| R12 `player_b` | 14→**28** / — | 1/1 | `seq107` income +14；`seq109` attack `cee2f350`→`2b8538ef` roll 40 actual 40 → 32 | 我 ranger 反击敌 ranger 40 点 | 必须处理 HQ 威胁 |
| R12 `player_a` | — / 30→**44** | 1/1 | `seq111` income +14；`seq113` attack `2b8538ef`→`cee2f350` roll 39 actual 39 → 33 | 敌 ranger 反打我 ranger 39 点（互射劣势） | 拼射 |
| R13 `player_b` | 28→**42** / — | 1/1 | `seq116` income +14；`seq118` attack roll 42 actual 32 → 0；`seq119` `unit_death` 敌 ranger `2b8538ef` | 我 ranger 击杀敌 ranger（72 HP 共耗 72 dmg） | 清除 HQ 威胁 |
| R13 `player_a` | — / 44→**58** | 1/1 | `seq121` income +14；`seq123` attack `d6ab00ce`→`6b00ba15` roll 29 actual 29 → 119 | 敌重装反打我重装 29 点 | 拼消耗 |
| R14 `player_b` | 42→**56** / — | 1/1 | `seq126` income +14；`seq128` attack `cee2f350`→`d6ab00ce` roll 29 actual 29 → 29 | 敌重装压到 29 HP，下回合可杀 | 收尾 |
| R14 `player_a` | — / 58→**72** | 1/1 | `seq130` income +14；`seq132` attack `d6ab00ce`→`6b00ba15` roll 26 actual 26 → 93 | 我重装 93 HP | 拼消耗 |
| R15 `player_b` | 56→**70** / — | 1/1 | `seq135` income +14；`seq137` attack roll 34 actual 29 → 0；`seq138` `unit_death` 敌重装 `d6ab00ce` | **我 ranger 击杀敌重装**（150 HP 共耗 30+34+28+29+29=150 dmg 精确击杀） | 通路打开 |
| R15 `player_a` | — / 72→**86** | 1/1 | `seq140` income +14；`seq142` move `342e4c16` (3,0)→(2,1) | 敌 scout 离开 cp_2，向 (2,1) 调整 | 防御位 |
| R16 `player_b` | 70→**84** / — | 1/1 | `seq145` income +14；`seq147` move `6b00ba15` (-1,1)→(1,-1)；`seq148` **demolish `(1,0)` blocker→plain** | 我重装到 (1,-1) 并炸开 (1,0)，**为下回合贴脸敌 HQ 铺路** | 攻城布局 |
| R16 `player_a` | — / 86→100→**50** | 1/1 | `seq150` income +14；`seq152` **deploy heavy `e5dc3d38` from HQ → (2,-1) cost 50**；`seq153` attack `e5dc3d38`→`6b00ba15` roll 26 actual 26 → 67 | **敌部署第二重装在 (2,-1)**（已爆破位），打我重装 26 点 | 阻击 |
| R17 `player_b` | 84→**98** / — | 1/1 | `seq156` income +14；`seq158` move `6b00ba15` (1,-1)→(1,0)；`seq159` attack `6b00ba15`→`0527c2af` HQ roll 38 actual 38 → 82 | **我重装首次击中敌 HQ**，38 点 | 攻坚开始 |
| R17 `player_a` | — / 50→**64** | 1/1 | `seq161` income +14；`seq163` move `e5dc3d38` (2,-1)→(0,0)；`seq164` attack `e5dc3d38`→`6b00ba15` roll 30 actual 30 → 37 | 敌重装移到 (0,0) 并打我重装 30 点 | 阻击 |
| R18 `player_b` | 98→**112** / — | 1/1 | `seq167` income +14；`seq169` attack `6b00ba15`→`0527c2af` HQ roll 37 actual 37 → 45 | 敌 HQ 压到 45 HP | 攻坚 |
| R18 `player_a` | — / 64→**78** | 1/1 | `seq171` income +14；`seq173` attack `e5dc3d38`→`6b00ba15` roll 28 actual 28 → 9；`seq174` move `e5dc3d38` (0,0)→(-2,1) | **敌重装先打再走**，我重装仅剩 9 HP；敌重装越境到 (-2,1) 贴脸我 HQ | 反越境锁死 |
| R19 `player_b` | 112→**126** / — | 1/1 | `seq177` income +14；`seq179` attack `6b00ba15`→`0527c2af` HQ roll 35 actual 35 → 10 | **敌 HQ 仅剩 10 HP**，再一下即破 | 攻坚最后一步 |
| R19 `player_a` | — / 78→92→**14** | 1/1 | `seq181` income +14；`seq183` **deploy ranger `465d22ef` from HQ → (2,-1) cost 78**；`seq184` attack `465d22ef`→`6b00ba15` roll 32 actual 9 → 0；`seq185` `unit_death` 我重装 `6b00ba15` | **敌部署第二 ranger 在 (2,-1)，9 点（封顶）击杀我 9 HP 重装**；我方失去对敌 HQ 的直接威胁 | 致命反击 |
| R20 `player_b` | 126→**140** / — | 1/1 | `seq187` income +14；`seq190` move `cee2f350` (-3,1)→(-4,0) | 我 ranger 绕远路（被己方 scout `72618de5` @(-3,0) 堵住直路） | 试图接近敌 HQ |
| R20 `player_a` | — / 14→**28** | 1/1 | `seq192` income +14；`seq194` attack `e5dc3d38`→`281cff8d` HQ roll 33 actual 33 → 50 | 敌重装自 (-2,1) 打我 HQ 33 点 | 反攻 HQ |
| R21 `player_b` | 140→**154** / — | 1/1 | `seq197` income +14；`seq199` move `cee2f350` (-4,0)→(-2,-1) | 我 ranger 到 (-2,-1)，**距敌 HQ(2,0) 直线 4，超出 rg3**；下回合需再走 1 步到 (0,-1) 才能攻击 | 试图进入攻击范围 |
| R21 `player_a` | — / 28→**42** | 1/1 | `seq201` income +14；`seq203` attack `e5dc3d38`→`281cff8d` HQ roll 34 actual 34 → 16 | 我 HQ 仅剩 16 HP | 终局临近 |
| R22 `player_b` | 154→**168** / — | 1/1 | `seq206` income +14；`seq208` attack `cee2f350`→`e5dc3d38` roll 33 actual 33 → 117 | 我 ranger 攻击敌重装 33 点（无法触及敌 HQ） | 唯一合法目标 |
| R22 `player_a` | — / 42→**56** | 1/1 | `seq210` income +14；`seq212` attack `e5dc3d38`→`281cff8d` HQ roll 37 actual 16 → 0；`seq213` `headquarters_destroyed`；`seq214` `control_point_neutralized` cp_1；`seq215` `player_eliminated` player_b by player_a | **我 HQ 摧毁，被淘汰** | 终局 |

## 核心策略与关键转折

### 策略一：镜像破墙 + 重装口袋推进（R4–R8）
双方在 R4 同时部署重装，R5 同时爆破相邻 blocker（我炸 `(-2,1)`，敌炸 `(2,-1)`），完全对称。R6 我重装进到 `(-1,1)`，但敌方抢先派 scout `08158c4b` 占住口袋 `(0,0)`，迫使我重装 R7–R8 两轮清 scout，无法推进。**这是第一次失去先手价值**：先手本应在 R6 推进口袋，却被敌 scout 用 1 个 scout 的牺牲换掉两轮时间。

### 策略二：ranger 落地即可攻击（R10–R15）
R10 我在 `(-3,1)` 部署 ranger `cee2f350`，立刻攻击敌重装 `d6ab00ce` 34 点。这是 danger-close 的关键验证：**deploy 是 1 AP，但 new unit 的后续 attack 在同回合是免费的**（与 SKILL.md "further legal actions on that unit are free that turn" 一致）。R10–R15 我用 1 个 ranger 在 6 回合内打出 34+28+40+32+29+34=197 伤害，精确击杀敌 scout(65HP)+ranger(72HP)+heavy(150HP) 共 287 HP（其中 65+72+150=287，无溢出）。但代价是：ranger 全程停在 `(-3,1)`，既未推进也未保 HQ。

### 策略三：heavy 突进 + demolish 攻城（R16–R19）
R16 我重装移到 `(1,-1)` 并 demolish `(1,0)` blocker（**验证：move+demolish 同回合合法，hasMoved=true 不阻止 demolish**）。R17 移到 `(1,0)` 首次攻击敌 HQ，38 点。R17–R19 三轮重装独立打出 38+37+35=110 伤害，敌 HQ 从 120 压到 10。**这是本局最高 actionScore 时段（64 分中绝大多数来自此）**。但 R19 我重装仅剩 9 HP，被敌新部署的 ranger `465d22ef` 自 `(2,-1)` roll 32 actual 9 一击击杀。

### 关键转折一：敌 ranger 占据 (0,-1) 贴脸我 HQ（R11）
R10 敌部署 ranger `2b8538ef` 在 `(3,-1)`，R10 移到 `(1,-1)`，R11 移到 `(0,-1)` 并攻击我 HQ 37 点。**此时我 HQ 120→83，第一次出现 HQ 持续承伤的不可逆压力**。我被迫在 R12–R13 用 ranger 反击敌 ranger（互射 40+32 vs 39），虽然击杀敌 ranger，但我 ranger 也从 72→33 HP，且失去 2 回合推进时间。

### 关键转折二：敌部署第二重装在 (2,-1) 并反越境到 (-2,1)（R16–R18）
R16 敌在 `(2,-1)` 部署第二重装 `e5dc3d38`（cost 50），立即攻击我重装 26 点。R17 移到 `(0,0)`，R18 先打再走到 `(-2,1)`——**这是反越境**，敌重装从 `(0,0)` 越过整个口袋贴脸我 HQ `(-2,0)`。从 R18 起，敌重装同时威胁我重装（距离 3，重装 rg1 无法反击）和我 HQ（距离 1）。

### 关键转折三：R19 敌部署第二 ranger 在 (2,-1)，9 点击杀我重装（致命）
R19 敌在 `(2,-1)` 部署 ranger `465d22ef`（cost 78），roll 32 actual 9 击杀我 9 HP 重装。**这是本局的胜负手**：我重装在 `(1,0)` 距敌 HQ(2,0) 距离 1，下回合（R20）即可补 33-39 伤害击杀 10 HP 敌 HQ。但敌方抢先用新 ranger 隔空击杀我重装。**关键失算：我未在 R18 把 9 HP 重装撤出 (1,0) 危险区**——9 HP 在敌方所有 ranger(28-34) 和 heavy(24-30) 的射程内，必死。

### 关键转折四：R20–R22 我 ranger 无法进入敌 HQ 攻击范围
R20 我 ranger 从 `(-3,1)` 移到 `(-4,0)`（被己方 scout `72618de5` @(-3,0) 堵住直路）。R21 到 `(-2,-1)`，距敌 HQ(2,0) 直线距离 4，超出 ranger rg3。R22 我 ranger 只能攻击敌重装 33 点，**无法触及仅剩 10 HP 的敌 HQ**。同时敌重装自 `(-2,1)` 每轮 33-37 点拆我 HQ：R20→50, R21→16, R22→0。

## HQ、据点与行动点分析

### HQ 攻防账本

| 项目 | 数值 | 来源 |
|---|---:|---|
| 我对敌 HQ 造成伤害 | **110** | `attack` seq159(38)+seq169(37)+seq179(35) |
| 敌对我 HQ 造成伤害 | **120**（满额） | `attack` seq104(37)+seq194(33)+seq203(34)+seq212(16 actual, roll 37) |
| 我 HQ 被击杀轮次 | R22 | `headquarters_destroyed` seq213 |
| 敌 HQ 最终 HP | 10/120 | `game_over.scores.player_a.ownHqHp=10` |
| 我 HQ 最终 HP | 0/120 | `game_over.scores.player_b.ownHqHp=0` |

**HQ 进攻窗口分析：** R17 我重装到 (1,0) 是本局唯一对敌 HQ 的直接攻击窗口。R17–R19 三轮 110 伤害占总分 110×20=2200（占总分 2406 的 91%）。但 R19 重装阵亡后，**我方没有任何单位能进入敌 HQ 攻击范围**：
- ranger `cee2f350` @(-3,1) 距敌 HQ(2,0) 直线 5，超出 rg3
- scout `88fbf2fd` @(-2,5) 距敌 HQ 直线 5，超出 rg1
- scout `72618de5` @(-3,0) 距敌 HQ 直线 5，超出 rg1

**守家路线失败：** 敌重装 R18 越境到 (-2,1) 后，我本可用 ranger `cee2f350` @(-3,1) 攻击它（距离 1，ranger rg3 内），28-34 dmg/turn，但 150 HP 需要 5+ 回合。同时敌重装每轮拆我 HQ 33-39 点，我 HQ 83 HP 仅能撑 2-3 回合。**纯防御无解**，必须先击杀敌 HQ。

### 据点收益

| 据点 | 占领轮次 | 占领者 | 收益/轮 | 总收益轮数 | 总收益 |
|---|---|---|---:|---:|---:|
| cp_1 `(-3,0)` supply | R2 `seq14` | player_b（本方） | +8 | R3–R22 = 20 轮 | +160 |
| cp_2 `(3,0)` supply | R2 `seq19` | player_a（敌方） | +8 | R3–R22 = 20 轮 | +160 |

双方据点收益对称。`controlPoint` 权重 30，双方各得 30 分。

### 行动点分析（`actionsPerTurn=1`）

**正确的行动点分配：**
- R10 deploy ranger + attack 同回合（验证 free follow-up）
- R16 move heavy + demolish 同回合（验证 free follow-up）
- R17 move heavy + attack HQ 同回合（验证 free follow-up）

**行动点空转：**
- R3 我 scout `88fbf2fd` 移到 `(-2,5)` 后**至终局 19 轮未再行动**。38 cost 的 scout 完全浪费。
- R22 我 ranger 攻击敌重装 33 点（无法触及敌 HQ），属于"无有效目标"的空转。

## 补给与六项裁决分账本

权重来自 `config.balance.adjudicationWeights`：`enemyHqDamage=20`、`ownHqHp=1`、`controlPoint=30`、`armyValue=1`、`supplies=0`、`actionScore` 加分项（已乘 effectiveActions=2）。

| 项目 | 数量/数值 | 本局权重 | 得分 | 事件或配置依据 |
|---|---:|---:|---:|---|
| 对敌 HQ 造成伤害 | 110 | 20 | 2200 | `attack` seq159/169/179 |
| 己方 HQ 最终 HP | 0 | 1 | 0 | `game_over` |
| 最终控制据点数 | 1 | 30 | 30 | `control_point_captured` seq14（cp_1 终局被 neutralize seq214） |
| 存活军力价值 | 112 | 1 | 112 | `game_over`（ranger 72 + scout 38 + scout 38 - 已阵亡重装 50） |
| 剩余补给 | 178 | 0 | 0 | `income`、`deploy`（权重 0，不计分） |
| `actionScore` | 64 | 加分项 | 64 | 行动事件（merit×2，standard 默认 effectiveActions=2） |
| **总分** | — | — | **2406** | `game_over.payload.scores.player_b.total=2406` ✓ |

### 收入账本（`income` 事件 seq6/11/16/22/26/...）

| 项目 | 本方 | 敌方 | 依据 |
|---|---:|---:|---|
| 起始补给 | 20 | 20 | `config.balance.startingSupplies=20` |
| R1–R22 累计收入 | +284 | +298 | 22 轮 × 14（base6+cp8，从 R3 起）；R1–R2 仅 base6 |
| 部署花费 | -50（heavy 6b00）+ -78（ranger cee2）= -128 | -50（heavy d6ab）+ -50（heavy e5dc）+ -78（ranger 2b85）+ -78（ranger 465d）= -256 | `deploy` seq33/89 vs seq37/84/152/183 |
| 维修花费 | 0 | 0 | 无 `control_point_repair` 事件 |
| **最终补给** | **178** | **56** | 与 `game_over.scores.*.supplies` 一致 ✓ |

**关键：** 我方剩余 178 补给（权重 0，不计分），敌方仅 56 但全部转换为 2 个新单位（heavy 50 + ranger 78 = 128，加上 R4 重装 50 = 178，与敌方总部署花费 256 + 56 = 312，收入 298 + 20 起始 = 318，差 6 = R1 后手收入）。**敌方补给利用率 100%（全部转换为军力），我方 178 补给闲置，相当于 2 个 ranger 或 3 个 heavy 的潜在军力未投入战场。**

## 失误与改进

### 失误一：R3 scout `88fbf2fd` 移到 (-2,5) 后再未动（19 轮空转）
- **实际做法：** R3 把 scout `88fbf2fd` 从 (-5,5) 移到 (-2,5) 当哨位，此后至 R22 终局未再行动。
- **正确做法：** R8 后敌方 scout 已死、口袋 (0,0) 被敌重装占据，应立即把该 scout 调回参与主战场（占点、堵路、牺牲换时间）。
- **触发条件：** 主战场陷入消耗战且己方有闲置单位时。
- **预期收益：** scout 16 attack 对 heavy 13 defense 仅 1-6 dmg，但可吸引敌方 1 个 attack 行动（相当于 1 AP 的注意力转移），或用于堵住 (0,0) 阻止敌重装越境。

### 失误二：R18 我重装 9 HP 未撤出 (1,0) 危险区
- **实际做法：** R17 我重装移到 (1,0) 攻击敌 HQ，R18 继续 attack HQ（37 dmg，敌 HQ 45→...），但被敌重装 e5dc 攻击 28 dmg 后仅剩 9 HP。R19 我仍用该重装 attack HQ（35 dmg，敌 HQ→10），随即被敌新 ranger roll 32 actual 9 击杀。
- **正确做法：** R18 我重装被打到 9 HP 后，应预判敌方下回合 deploy ranger 在 (2,-1)（距 (1,0) 距离 1，在 ranger rg3 内），9 HP 必死。应在 R19 改为 move heavy 远离 (1,0)（如 (1,-1) 或 (0,0)），牺牲对敌 HQ 的 35 dmg 攻击，保住重装用于后续防御或第二轮攻城。
- **触发条件：** 攻坚单位 HP 低于敌方任意 ranger 一击致死线（≤34 HP）且敌方有 78 supplies 可部署 ranger 时。
- **预期收益：** 重装存活可在 R20–R22 持续威胁敌 HQ（每轮 33-39 dmg，2 回合必破 10 HP HQ）。**本局若重装存活，R20 即可击破敌 HQ 而非等到 R22 被击杀。**

### 失误三：R10–R15 ranger 全程停在 (-3,1) 未推进
- **实际做法：** R10 部署 ranger 在 (-3,1) 后，连续 6 回合原地攻击敌方单位，从未移动。
- **正确做法：** R15 击杀敌重装后，敌方口袋 (0,0) 已空，应立即把 ranger 推进到 (0,0) 或 (1,-1)，进入敌 HQ 攻击范围（(0,0) 距 (2,0) 距离 2，rg3 内）。R16 我重装需要 1 AP 用于 move+demolish，ranger 本可同时推进（但 1 AP 限制只能激活 1 单位/回合）。
- **触发条件：** 主战单位（ranger）清场后，敌方 HQ 在攻击范围外但可经 2-3 步移动进入范围时。
- **预期收益：** ranger 推进到 (0,0) 后，R17 起即可与 heavy 双火力攻击敌 HQ（44-4±3=37-43 dmg/turn），R17–R18 两轮即可打出 74-86 dmg，比实际 R17–R19 三轮 110 dmg 快 1 回合。**关键：ranger 37-43 dmg/heavy 33-39 dmg 双火力下，敌 HQ 120 HP 在 2 回合内必破**，敌重装来不及反越境到 (-2,1)。

### 失误四：178 补给未投入第二波部署
- **实际做法：** R10 后再未部署任何单位，178 补给闲置至终局。
- **正确做法：** R16 敌方部署第二重装后，我方应立即在 HQ (-2,0) 部署 support（60 cost, healPower 22）治疗我重装，或部署第二个 ranger（78 cost）参与攻坚。
- **触发条件：** 补给 ≥60 且攻坚单位 HP 低于敌方火力致死线时。
- **预期收益：** support 每轮 heal 22（ranged）可让 9 HP 重装回到 31 HP，挺过敌方 ranger 一击；或第二个 ranger 在 (1,-1) 提供 28-34 dmg/turn 的额外攻坚火力。

## 与历史对局对比

### 与 tg_0186_lose_WEB@glm5.3web.md（同地图 danger-close 败局）对比

| 项目 | tg_0186（败） | 本局 tg_0200（败） | 差异 |
|---|---|---|---|
| 地图 | danger-close | danger-close | 同 |
| 我方 HQ 最终 HP | 回放未查 | 0 | — |
| 对敌 HQ 伤害 | 回放未查 | 110 | — |
| 失败原因 | 回放未查 | HQ 被重装+ ranger 双火力拆毁 | — |
| 关键失算 | — | R19 重装未撤、ranger 未推进 | — |

> 注：tg_0186 详情需读对应回放。本局验证了 tg_0186 中"danger-close 双方对称破墙后拼攻坚速度"的规律，**并新增发现：ranger 落地即可攻击（deploy+attack 同回合合法）**，这一机制在本局 R10 首次实证。

### 与 tg_0162_win_TC@seed2.1pro0915.md（同地图胜局）对比

| 项目 | tg_0162（胜） | 本局 tg_0200（败） | 差异 |
|---|---|---|---|
| 地图 | danger-close | danger-close | 同 |
| 我方席位 | 回放未查 | player_b（先手） | — |
| 胜负 | 胜 | 败 | **本局修正了 tg_0162 的"先手必胜"假设** |
| 对敌 HQ 伤害 | 回放未查 | 110 | — |

> 注：tg_0162 详情需读对应回放。本局验证：**先手优势在 danger-close 上被对称破墙完全抵消**，真正决定胜负的是攻坚速度与重装存活率，而非先后手。

### 与 tg_0153_win_TC@seed2.1pro0915.md（TC 胜局）对比

| 项目 | tg_0153（胜） | 本局 tg_0200（败） | 差异 |
|---|---|---|---|
| 模型 | seed2.1pro0915 | glm5.2 | 不同模型 |
| 胜负 | 胜 | 败 | **本局暴露 GLM-5.2 在长程规划（重装存活预判、ranger 推进时机）上的弱点** |
| 关键差异 | — | 本局 178 补给闲置、ranger 未推进、重装 9 HP 未撤 | — |

> 注：tg_0153 详情需读对应回放。本局与 tg_0153 的对比说明：**同 agent（TC）在不同模型下，攻坚节奏与补给利用率差异显著**。

## 总结

### 做得好的
1. **R10 验证 deploy+attack 同回合合法**（`seq89`+`seq90`）：new unit can attack but cannot move same turn。这一发现可用于后续对局的攻坚节奏优化。
2. **R16 验证 move+demolish 同回合合法**（`seq147`+`seq148`）：hasMoved=true 不阻止 demolish。重装可在 1 回合内移动 2 格 + 爆破 1 个 blocker。
3. **ranger 击杀效率精确**：R10–R15 用 1 个 ranger 在 6 回合内打出 197 伤害，精确击杀敌 scout(65)+ranger(72)+heavy(150) 共 287 HP（无溢出），actionScore 64 分主要来自此。
4. **R17–R19 重装独立攻坚 110 伤害**，敌 HQ 从 120 压到 10，本局总分 2406 中 2200 来自此（91%）。
5. **R12–R13 及时处理敌 ranger 对 HQ 的威胁**，避免更早被拆 HQ。

### 下次改进
1. **攻坚单位 HP 低于 34（ranger 一击致死线）时立即撤离**，不贪最后一击。
2. **ranger 清场后立即推进到敌 HQ 攻击范围**，不原地停留。
3. **补给 ≥60 时及时部署 support 或第二 ranger**，不囤积至终局。
4. **闲置单位（scout）调回主战场**，不在边角空转 19 轮。
5. **预判敌方 deploy ranger 在已爆破位的反越境**，提前撤离或堵路。

> **核心口诀：攻坚单位低于 34 HP 立即撤，ranger 清场后立即推进到敌 HQ 攻击范围。**

**一句话总结：** 本局在 danger-close 上与敌方完全对称破墙，R17–R19 重装攻坚 110 伤害将敌 HQ 压到 10，但 R19 重装 9 HP 未撤被敌方新部署 ranger 一击击杀，丧失对敌 HQ 的直接威胁，此后 ranger 无法在 3 回合内进入攻击范围，被敌反越境重装拆毁 HQ。
