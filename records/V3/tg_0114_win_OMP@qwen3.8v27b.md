# 战术游戏胜利复盘 — `player_a` 视角

**日期:** 2026-08-20
**游戏ID:** `a314172b-d809-4801-a504-966ffd5bdd5a`
**回放版本:** 3.2.12
**地图:** `artillery-zone`（炮火禁区，半径6全平地六边形，12个据点）
**模式:** `annihilation`（歼灭，无HQ）
**玩家:** Qwen3.8v27b-OMP（OMP@qwen3.8v27b）
**席位与出生:** `player_a`，行动顺序第2（`turnOrder: [player_b, player_a]`），`slot_west`，初始 2×infantry @(-5,0)、(-5,1) + heavy @(-4,-1)，初始控制点 `cp_west` @(-4,0)；无HQ
**参战人数:** 2
**对手:** LongCat2.0-CP（`player_b`，`slot_east`，先手）
**结果:** 第1名 — `last_player_standing`
**结束轮次:** 第12/12整轮（第12轮我方 `player_a` 回合中结束，关键 seq 210-223）
**最终状态:** 存活
**我方HQ:** 不适用（无HQ）
**裁决总分:** 938（armyValue 254×2=508 + actionScore 430；supplies 121、controlPoints 4 权重0，不构成裁决分）

> 数据来源：回放 `records/V3/tg_0114_20260820.json`（schema 3.2.12，223条事件）。以下所有坐标、伤害、补给、收入与 seq 均以事件 payload 为准；回放未提供的数据明确标注。

---

**R1-R3抢占5个据点形成稳定收入差，328补给全部转成7个新单位，R6开始连续击杀，用ranger与近战夹击配合炮火磨损清掉敌方6个单位，938:380 `last_player_standing`——抢点保收入、经济转人数、末轮4AP全用来完成击杀。**

---

## 游戏进程时间线

| 整轮/席位回合 | 补给 | 行动点 | 关键操作与坐标 | 局势变化 | 战术意图 |
|---|---:|---:|---|---|---|
| 第1轮 / `player_a` | 45→57→19 | 4/4 | 从 `cp_west` 部署 scout `0d92c03e` 至(-3,0)，随即占 `supply_west`；`88c1a8d7` (-5,1)→(-3,1)、`0f9d7a77` (-4,-1)→(-2,-1)、`d600ea3b` (-5,0)→(-3,-1) | 双方各占1个supply（我 `supply_west`，敌 `supply_east`） | 抢西侧补给点，初始单位前压 |
| 第2轮 / `player_a` | 19→39 | 4/4 | `0d92c03e` (-3,0)→(0,-3) 占 `supply_northwest`；`0f9d7a77` (-2,-1)→(0,-2)、`d600ea3b` (-3,-1)→(0,-1)、`88c1a8d7` (-3,1)→(0,1) | 我控2个CP（CP收入12），敌占 `cp_northeast` 后控3个CP | 向中心/北推进，扩大点差 |
| 第3轮 / `player_a` | 39→67→22 | 4/4 | 从 `supply_west` 部署 infantry `0ed9767c` 至(-2,0)；`0d92c03e` (0,-3)→(0,-4) 占 `cp_northwest`；`88c1a8d7` (0,1)→(0,3) 占 `supply_southeast`；`0f9d7a77` (0,-2)→(1,-2) | 我控5个CP（CP收入32），敌控4个CP（CP收入24） | 三连占，建立稳定收入差 |
| 第4轮 / `player_a` | 22→62→17 | 4/4 | 从 `supply_northwest` 部署 infantry `c8ec54d1` 至(0,-2)；`d600ea3b` 攻击 `cf48f4b0` 29（65→36）；`0f9d7a77` (1,-2)→(2,-3)；`0d92c03e` (0,-4)→(0,-3) | 首次炮火预警（R5缩6→5）；敌首scout重伤 | 部署人数并集火敌scout |
| 第5轮 / `player_a` | 17→57→19 | 4/4 | 从 `supply_northwest` 部署 scout `b99e85d1` 至(-1,-3)；`d600ea3b` 攻击 `cf48f4b0` 28（36→8）；`0f9d7a77` 攻击 `d1abc476` 29（100→71）；`88c1a8d7` (0,3)→(0,0) | 安全半径6→5；敌scout濒死 | 双压准备击杀 |
| 第6轮 / `player_a` | 19→59 | 4/4 | `d600ea3b` 攻击 `cf48f4b0` 8→击杀；`0f9d7a77` 攻击 `d1abc476` 27（71→44）；`0ed9767c` (-2,0)→(0,1)；`b99e85d1` (-1,-3)→(1,-3) | 首个击杀；敌scout线-1 | 收掉敌首scout，转压infantry |
| 第7轮 / `player_a` | 59→99→27 | 4/4 | 从 `supply_northwest` 部署 ranger `e09c4a48` 至(-1,-3)；`0f9d7a77` 攻击 `6d1fe700` 26（150→124）；`c8ec54d1` (0,-2)→(1,-2)；`d600ea3b` (0,-1)→(1,-1) | 安全半径5→4；敌 `44717733` 首吃炮火25（65→40） | 投72造远程点，继续压敌heavy |
| 第8轮 / `player_a` | 27→67→22 | 4/4 | 从 `supply_southeast` 部署 infantry `f16954c7` 至(0,2)；`d600ea3b` 攻击 `d1abc476` 21（44→23）；`88c1a8d7` (0,0)→(1,0)；`e09c4a48` 攻击 `6d1fe700` 33（124→91） | 我heavy `0f9d7a77` 被敌heavy 10伤害击杀（150HP耗尽）；敌inf `d1abc476` 降至23 | 补人数，ranger首射打heavy |
| 第9轮 / `player_a` | 22→62→17 | 4/4 | 从 `supply_northwest` 部署 infantry `1be40b2c` 至(0,-2)；`e09c4a48` (-1,-3)→(-1,-2)；`c8ec54d1` 攻击 `d1abc476` 22（23→1）；`d600ea3b` 攻击 `d1abc476` 1→击杀 | 安全半径4→3；敌 `8d9dfabf`、`3143a88f`、`44717733` 各吃25炮火，我ranger吃25（72→47） | 三人合击收敌inf，部署补位 |
| 第10轮 / `player_a` | 17→57 | 4/4 | `e09c4a48` (-1,-2)→(-1,-1)；`0d92c03e` (0,-3)→(-1,-2)；`d600ea3b` 攻击 `44717733` 15→击杀；`88c1a8d7` (1,0)→(2,-1) | 敌第二scout死（此前50炮火+15战斗）；我 `b99e85d1` 被敌heavy 36+29击杀 | 收炮火残血，ranger撤安全，`88c1a8d7` 靠近heavy |
| 第11轮 / `player_a` | 57→89 | 4/4 | `e09c4a48` 攻击 `8d9dfabf` 25→击杀（此前75炮火）；`88c1a8d7` 攻击 `6d1fe700` 14（66→52）；`d600ea3b` 攻击 `6d1fe700` 20（52→32）；`0d92c03e` (-1,-2)→(-2,-1) | 安全半径3→2；敌 `8d9dfabf`/`6d1fe700` 与我 `0d92c03e` 各吃25炮火；敌夺回 `supply_northwest` | 远程收割，双压heavy，准备末轮击杀 |
| 第12轮 / `player_a` | 89→121 | 4/4 | `d600ea3b` 攻击 `6d1fe700` 14（32→18）；`88c1a8d7` 攻击 `6d1fe700` 17（18→1）；`e09c4a48` 攻击 `3143a88f` 40→击杀；`1be40b2c` (0,-2)→(1,-2) 后攻击 `6d1fe700` 1→击杀 | 敌方 `army_destroyed`；敌5个CP被中立；我控4个CP | 4AP全用于击杀，结束游戏 |

---

## 核心胜利策略

### 1. R1-R3抢点建立收入差

**关键决策:** 前3轮用 `0d92c03e` 和 `88c1a8d7` 连续占点，第3轮结束时我方持有5个CP，敌方4个CP。

```text
第1轮 / player_a: 0d92c03e 从 cp_west 部署至(-3,0)，占 supply_west（seq16）；敌占 supply_east（seq8）
第2轮 / player_a: 0d92c03e (-3,0)→(0,-3) 占 supply_northwest（seq32）；敌占 cp_northeast（seq24）
第3轮 / player_a: 0d92c03e (0,-3)→(0,-4) 占 cp_northwest（seq49）；88c1a8d7 (0,1)→(0,3) 占 supply_southeast（seq50）；敌占 supply_northeast（seq41）
```

**为什么有效:**
- 据点收入：我方R4起稳定40/轮（base 8 + CP 32），敌方R4起32/轮（base 8 + CP 24），连续7轮形成+8/轮差。
- 到R11敌方夺回 `supply_northwest` 后收入回到32，R12因持有5个CP收入40；整局我方总收入404，敌方340，净差+64。
- 点差同时提供部署垫：`supply_west`、`supply_northwest`、`supply_southeast` 在R3-R9持续用于部署。

### 2. 经济全部转人数：328补给部署7个单位

**关键决策:** 不囤补给，把可用经济持续转成可攻击、可占点、可收割的单位。

```text
R1 scout 38（cp_west） → R3 infantry 45（supply_west） → R4 infantry 45（supply_northwest） → R5 scout 38（supply_northwest） → R7 ranger 72（supply_northwest） → R8 infantry 45（supply_southeast） → R9 infantry 45（supply_northwest）
```

**为什么有效:**
- 我方总单位数达到10（初始3 + 部署7），敌方总单位数6（初始3 + 部署3）。
- 人数优势支撑连续击杀：R6、R9、R10、R11、R12均有击杀，敌方从R6开始持续掉血。
- 最终存活7个单位，armyValue 254；在 `armyValue` 权重为2、`supplies` 权重为0的配置下，把补给转成存活单位比囤补给更优。

### 3. ranger作为唯一远程输出点

**关键决策:** R7投入72部署ranger，之后让其尽量保持安全距离，只打高价值目标。

```text
第7轮 / player_a: e09c4a48 部署至(-1,-3)
第8轮 / player_a: e09c4a48 攻击 6d1fe700 33（150→91）
第11轮 / player_a: e09c4a48 攻击 8d9dfabf 25→击杀（该单位此前吃75炮火）
第12轮 / player_a: e09c4a48 攻击 3143a88f 40→击杀（该单位此前吃25炮火）
```

**为什么有效:**
- ranger总输出98（33+25+40），其中两个击杀都是先吃炮火再被远程收割。
- ranger只吃1次炮火（R9，25，72→47），最终存活到终局，保证末轮仍有40伤害输出。
- 在敌方heavy 150HP目标上，ranger与近战infantry形成持续压血：R8 33、R11 14+20、R12 14+17，把heavy压到末轮可被补刀。

### 4. 利用炮火预警控制安全区，让敌方多承伤

**关键决策:** 在偶数轮 `artillery_warning` 后，优先让己方关键单位进入安全半径；敌方多个单位连续停在危险区。

**为什么有效:**
- 本局炮火共10次，每次25伤害：敌方累计吃175（7次），我方吃75（3次）。
- 敌方 `8d9dfabf` 吃3次炮火（75），`44717733` 吃2次（50），`3143a88f` 吃1次（25），`6d1fe700` 吃1次（25）。
- 3个敌方单位死亡与炮火削弱直接相关：`44717733`（50炮火+15战斗）、`8d9dfabf`（75炮火+25战斗）、`3143a88f`（25炮火+40战斗）。
- 首次预警（R4，R5缩6→5）时双方外圈d=6无单位，因此R5边界无炮火击杀；真正分水岭在R7之后。

### 5. 末轮4AP全部用于击杀闭环

**关键决策:** R12面对敌方32HP heavy和40HP scout，用 `d600ea3b`、`88c1a8d7`、`e09c4a48`、`1be40b2c` 四个AP完成双杀。

```text
第12轮 / player_a:
d600ea3b → 6d1fe700 14（32→18）
88c1a8d7 → 6d1fe700 17（18→1）
e09c4a48 → 3143a88f 40→击杀
1be40b2c (0,-2)→(1,-2) + 攻击 6d1fe700 1→击杀
```

**为什么有效:**
- 先处理40HP scout，再补刀heavy，保证敌方无法在同一回合后保留两个存活单位。
- `1be40b2c` 作为R9部署的满血infantry，保留到末轮执行1伤害补刀，避免heavy残血拖入裁决。
- 本局 `actionScore` 430 = actionMerit 43 × effectiveActions 10；部署7、占点4×2、19次攻击合计28，末轮击杀也保留了动作价值。

---

## 关键转折详解

### 第3轮 / `player_a` 回合 — 三连占建立收入差

```text
操作: 0ed9767c 部署(-2,0)；0d92c03e (0,-3)→(0,-4)；88c1a8d7 (0,1)→(0,3)
结果: 我方从2 CP增至5 CP，CP收入从12升至32；敌方4 CP，CP收入24
事件依据: deploy seq45，capture seq49，capture seq50；income R4 40 vs 32
意义: 从R4开始形成稳定+8/轮收入差，是后续7次部署（328补给）的经济基础
```

### 第6轮 / `player_a` 回合 — 首个击杀

```text
操作: d600ea3b 攻击 cf48f4b0 8→击杀
结果: 敌方首个scout死亡，HP 36→0
事件依据: attack seq97，unit_death seq98
意义: 敌方scout线-1，我方heavy与infantry开始把压力集中到 d1abc476
```

### 第8轮 / `player_b` 回合 — 我方heavy阵亡

```text
操作: 6d1fe700 攻击 0f9d7a77 10→击杀
结果: 我方初始heavy死亡，150HP耗尽
事件依据: attack seq124，unit_death seq125
意义: 我方失去唯一能与敌方heavy换血的重装单位，R9-R11只能靠infantry+ranger继续压血
```

### 第11轮 / `player_a` 回合 — 远程收割敌方infantry

```text
操作: e09c4a48 攻击 8d9dfabf 25→击杀
结果: 敌方 `8d9dfabf` 死亡，该单位此前R9/R10/R11累计吃75炮火
事件依据: attack seq193，unit_death seq194
意义: 敌方初始3单位再少1，heavy进入末轮可被多人补刀状态
```

### 第12轮 / `player_a` 回合 — 歼灭清场

```text
操作: d600ea3b 14、88c1a8d7 17、e09c4a48 40、1be40b2c移动后1伤害
结果: 3143a88f 与 6d1fe700 同轮死亡，敌方 army_destroyed
事件依据: attack seq210-215，player_eliminated/game_over seq222-223
意义: 触发 last_player_standing，游戏直接结束；敌5个CP被中立，我方终局控4个CP
```

---

## 失误与改进

### 失误1: 初始heavy被动承伤5轮，150HP换82伤害

**问题:** `0f9d7a77` 从R4到R8被敌方 `cf48f4b0`、`d1abc476`、`8d9dfabf`、`6d1fe700` 连续攻击：R4 5+17，R5 17+16，R6 25+16，R7 25+19+16，R8 10，总计150HP正好耗尽。其反打伤害只有29+27+26=82。

**改进:** heavy的 `moveRange=2`，一旦进入敌三方位中圈就很难脱战。R5 HP已降到70时应优先退到d≤2的安全区，或避免与敌方三单位同时贴脸；若后续能部署support（`healPower=22`）并贴防，可显著降低heavy阵亡概率。

**预期收益:** heavy若存活，armyValue至少多92（满血）或按比例存活价值；更重要的是R9-R11我方可继续用heavy压敌方heavy，减少 `b99e85d1` 被两下打死（36+29）的压力。

### 失误2: `0d92c03e` 在R11/R12连续停在d=3，吃两次炮火

**问题:** R10预警（seq159）已说明R11安全半径缩到2。`0d92c03e` 在R10从(0,-3)移动到(-1,-2)（d=3），R11又从(-1,-2)移动到(-2,-1)（仍d=3）。结果R11边界吃25（65→40），R12边界再吃25（40→15）。该scout在R5-R9期间长期无战斗任务，两次移动并没有形成攻击或占点收益。

**改进:** 预警轮必须把所有 `d >= 下轮danger半径` 的单位移到安全区。R10应把 `0d92c03e` 放到d≤2（如(0,-2)、(-1,-1)附近），而不是在d=3范围内横移。

**预期收益:** 若两次都避免炮火，`0d92c03e` 终局可保留65HP而非15HP；armyValue从约9提升到38，总军力差约29，裁决分差约58。虽然不影响胜负，但会明显降低终局状态风险。

### 失误3: R12对32HP heavy的两段伤害保底不足，靠第4AP补刀

**问题:** R12开始时 `6d1fe700` 32HP。`d600ea3b` 与 `88c1a8d7` 均为30攻击对13防御，单下保底为30-13-3=14；两下保底28 < 32，不能保证击杀。实际打出14+17=31，heavy仍剩1HP，最终靠 `1be40b2c` 移动后1伤害补刀。

**改进:** 击杀判断必须用“保底 = 攻击 - 防御 - 3”计算。若多段伤害保底不足，应调整顺序：让高攻击单位最后打，或明确保留一个满AP补刀单位。本局 `1be40b2c` 恰好可用于补刀，所以没有实际损失，但计算仍然偏乐观。

**预期收益:** 避免末轮出现“heavy残血1HP且AP用尽”的风险场景；同时保证歼灭节奏更稳，不依赖1伤害补刀成功。

---

## 本局机制与配置

| 项目 | 本局值 | 来源/影响 |
|---|---|---|
| 最大整轮数 | 12 | `config.balance.maxTurns` |
| 每回合行动点 | 4 | `config.balance.actionsPerTurn` |
| 初始/基础收入 | 45 / 8 | `startingSupplies` / `baseIncome` |
| 据点效果 | supply：收入8；forward_base：收入4；repair：收入0；部署折扣全0；维修全0 | `controlPointTypes` |
| 裁决权重 | enemyHqDamage 0，ownHqHp 0，controlPoint 0，armyValue 2，supplies 0，effectiveActions 10 | `adjudicationWeights`；本局只有存活军力和行动分影响总分 |
| 炮火配置 | startRound 5，间隔2轮，伤害25，最小安全半径2 | `config.annihilation.artillery` |
| 炮火状态 | 初始safeRadius 6；R5/R7/R9/R11缩至5/4/3/2；预警在R4/R6/R8/R10 | `artillery_shrunk` / `artillery_warning` 事件 |
| 伤害方差 | ±3，最低伤害1 | `damageVarianceRange` / `minimumDamage` |
| 单位配置 | infantry 100HP/30攻/8防/移动3/射程1/45，可占点；scout 65/16/4/移动5/射程1/38，可占点；heavy 150/38/13/移动2/射程1/92；ranger 72/44/3/移动3/射程3/72；support 82/10/5/移动3/射程1/60/heal22 | `config.units`；本局我方未部署support |

---

## 数据统计

### 对各对手的交互

| 对手席位 | 军力损失（歼灭） | 击杀 | 被击杀 | 夺取/失守据点 | 关键影响 |
|---|---:|---:|---:|---|---|
| `player_b` | 545/545（全部单位） | 6（3 scout + 2 infantry + 1 heavy） | 3（1 heavy + 1 scout + 1 infantry） | 未夺取敌方初始据点；我方占 `supply_northwest` 后被敌R11夺回 | 敌方6个单位全部被我方攻击击杀，其中3个此前受炮火削弱；敌方 `6d1fe700` 是我方3个死亡的主要来源 |

### 补给与部署

| 项目 | 数量 | 实际花费/收入 |
|---|---:|---:|
| infantry部署 | 4 | 180 |
| scout部署 | 2 | 76 |
| ranger部署 | 1 | 72 |
| heavy/support部署 | 0 / 0 | 0（heavy为初始单位） |
| 部署折扣 | 0次 | 节省0（本局据点部署折扣全0） |
| 基础与据点收入 | — | +404 |
| 初始补给 | — | 45 |
| 最终补给 | — | 121（45 + 404 - 328） |

### 伤害与击杀

| 类别 | 我方 | 敌方 |
|---|---:|---:|
| 总单位数 | 10 | 6 |
| 存活单位 | 7 | 0 |
| 战斗伤害输出 | 370 | 376 |
| 炮火承伤 | 75（3次） | 175（7次） |
| 击杀来源 | 6个敌方单位均被我方攻击击杀 | 3个我方单位均受我方击杀，且主要承伤来自敌方heavy |
| 终局armyValue | 254 | 0 |
| 终局actionScore | 430 | 380 |
| 总分 | 938 | 380 |

---

## 与历史对局的对比

| 项目 | `tg_0112`（2026-08-20） | `tg_0106`（2026-08-17） | 本局 `tg_0114`（2026-08-20） |
|---|---|---|---|
| 人数/地图/模式 | 2人 / `artillery-zone` / `annihilation` | 2人 / `artillery-zone` / `annihilation` | 2人 / `artillery-zone` / `annihilation` |
| 我方席位/出生 | `player_b`，east，第2 | `player_b`，east，第2 | `player_a`，west，第2 |
| 对手 | GPT5.6terra | Step3.7Flash | LongCat2.0-CP |
| 名次与结束 | 第1名，`last_player_standing`，R11歼灭 | 第1名，`last_player_standing`，R12歼灭 | 第1名，`last_player_standing`，R12歼灭 |
| 炮火承伤 / 对方承伤 | 我100 / 敌170（11次炮击） | 我150 / 敌153（13次炮击） | 我75 / 敌175（10次炮击） |
| 关键构成 | 3 ranger + heavy锚点 | 3 ranger + heavy锚点 | 1 ranger + 4 infantry + 2 scout + 初始heavy |
| 裁决总分 | 1104:240 | 1194:260 | 938:380 |

**结论:**
- `tg_0112` 的“先抢据点保收入”经验在本局被复现：R1-R3占5个CP，R4起40 vs 32收入差，支撑了7次部署。
- `tg_0112` 的“最后一击必须保底”经验未被完全落实：R12两段14保底总和28 < 32，heavy残血1HP靠第4AP补刀。需要把“保底 = 攻击 - 防御 - 3”写成硬检查。
- 本局炮火承伤控制是三次胜利中最好的一次（75 vs 175），但仍有 `0d92c03e` 连续两次停在危险区的失误，说明预警轮撤离仍需更机械化。

---

## 总结

### 胜利关键因素
1. **据点收入差:** R1-R3占5个CP，R4起稳定40 vs 32，整局收入404 vs 340。
2. **经济转人数:** 328补给全部部署7个单位，总单位10对6，终局7单位存活，armyValue 254。
3. **炮火与远程配合:** 敌方吃175炮火，我方ranger输出98并收割两个炮火削弱目标。
4. **末轮执行:** R12四个AP全部用于击杀，完成 `3143a88f` 与 `6d1fe700` 双杀。

### 核心战术原则
> **“先占supply保收入，预警轮把单位收进安全半径；人数优势打消耗，最后一击按 attack - defense - 3 保底。”**

### 一句话总结
**R1-R3抢点建立40对32收入差，328补给全部转成10个单位规模，用ranger与近战夹击收割炮火削弱的敌方单位，末轮4AP双杀完成938:380 `last_player_standing`——本局证明 artillery-zone 歼灭模式下，点差、人数差和末轮保底击杀是稳定胜局的核心。**

---

## 附录：关键坐标

| 实体 | 所属席位 | 坐标 | 说明 |
|---|---|---|---|
| `cp_west` | `player_a` | (-4,0) | 我方初始forward_base，R1 scout部署源 |
| `supply_west` | `player_a` | (-3,0) | R1占点（+8/轮），R3 infantry部署源；d=3 |
| `supply_northwest` | `player_a` → `player_b` | (0,-3) | R2我占，R4/R5/R9部署源；R11被敌 `8d9dfabf` 夺回；d=3 |
| `cp_northwest` | `player_a` | (0,-4) | R3由 `0d92c03e` 占点（+4/轮）；d=4 |
| `supply_southeast` | `player_a` | (0,4) | R3由 `88c1a8d7` 占点（+8/轮），R8 infantry部署源；d=4 |
| `cp_east` | `player_b` | (4,0) | 敌方初始forward_base，敌方多次部署源；d=4 |
| `supply_east` | `player_b` | (3,0) | R1敌占（+8/轮）；d=3 |
| `cp_northeast` | `player_b` | (4,-4) | R2由敌 `8d9dfabf` 占点（+4/轮）；d=4 |
| `supply_northeast` | `player_b` | (3,-3) | R3由敌 `d1abc476` 占点（+8/轮）；d=3 |
| 危险区边界 | — | `d = safeRadius + 1` | R5/R7/R9/R11后危险区分别为d=6/5/4/3；最小安全半径2 |
| `6d1fe700` 关键位置 | `player_b` | (4,1)→(4,-1)→(4,-2)→(3,-2)→(2,-1)→(3,-2)→(3,-3)→(2,-3)→(2,-2)→(2,-2) | 敌方核心heavy路径；R8击杀我方heavy，R12被四人合击补刀 |

---

*文档生成时间: 2026-08-20*
*回放格式版本: 3.2.12*
*AI模型: OMP@qwen3.8v27b*
