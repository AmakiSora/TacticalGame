# tg_0258 镜湖复盘（royale·mirror-lake）

> **复盘规范**：服务器 `GET /api/skill/files/review.md` → 模式路由 `review-royale.md`，并合并 `review-simultaneous.md`（秘密计划／按行动点同时结算）与 `review-annihilation.md`（炮火／歼灭）视角；四份均为服务器权威版。
> **回放**：`records/V3/tg_0258_20261111.json`（房主从观战页导出归档，本复盘只读；未调用事件接口拼装、未写回放 JSON）。本 MD 为唯一交付物。
> **取证口径**：全文数字均出自该回放（291 条事件，`schemaVersion=3.9.9`），对局中的临时读盘只用于定性定位。军力曲线按回放事件重建到各轮 `round_end` 快照，轮界炮火尚未计入该快照。

## 0. 局面概要

- **gameId**：`d36b4232-d986-4ecf-af6e-f6da057af21e`；**导出时间**：2026-11-11T06:14:05.924Z
- **地图 / 模式 / 人数**：`mirror-lake`（镜湖，pointy-top 半径 6、中心 7 格湖心岛）/ `royale`（同时回合 × 歼灭缩圈）/ 2 人
- **我的席位与玩家名**：`player_b` / Hy3-WB（WB@hy3），出生槽 `slot_east`（`cp_east` 在 `(5,0)`）；对手：`player_a` / Qwen4MaxPreview-QD，`slot_west`（`cp_west` 在 `(-5,0)`）
- **开局**：双方各 2 heavy + 1 scout、260 补给；`headquarters = {}`（无 HQ）；`turnOrder = [player_b, player_a]`、`firstPlayer = null`——仅用于同一步平局裁决，不存在先手
- **结果**：第 2 名 / `eliminated`。`player_eliminated`（`seq=290`，R12）`reason = artillery_destroyed`、`eliminatedBy = null`；`game_over`（`seq=291`）`winner = player_a`、`reason = last_player_standing`
- **结束轮次**：第 12 / 30 整轮（未打到裁决上限）
- **artillery 配置**：`startRound 6`、`intervalRounds 1`、`damage 25`、`minimumSafeRadius 1`；初始 `safeRadius 6`，R10 起停在 1
- **裁决权重**：`armyValue 5`、`killValue 1.5`；`controlPoint`、`supplies`、两项 HQ 均为 0（前两项仍有经济／部署价值，但不直接得分）
- **单位参数（本局）**：heavy 140/40/9/移2/射1/`arc`；scout 70/16/4/移4/射1；infantry 90/31/7/移3/射2/`line`2；ranger 68/34/3/移3/射3/`single`+`attackLock`；support 76/10/5/移3/治疗20/`healShape: arc`

## 1. 结果一句话

我前期经济与军力一度领先（R3 军力 510:481），但**第 2、6、7 三轮连续出现抢中心格撞车与 `previous_action_failed` 级联，合计白烧 9 个 AP（全场共 11 个失败 AP）**，又直到 R10 才占下 `cp_isle`（对手同图复盘 `tg_0257` 在 R2 就占，并从那里补了 5 次兵）；半径 1 生效时我 6 个存活单位里有 5 个在危险格，累计吃 386 炮火伤害、3 个单位被白清，最终 support 在 R12 被最后一发炮火打掉，以 **570 : 1620.5** 被炮火清场淘汰。

## 2. 发育窗口（round < startRound=6）

- **R1（8/8 AP，全部 executed）**：scout 从 `(6,-2)` 走 4 格到 `(4,-4)`，占下 `cp_northeast`（`seq=19`，+12/轮）；从 `cp_east` 部署 2 ranger + 1 infantry（80+80+55=215）；两辆 heavy 推到 `(3,0)` 与 `(2,0)`。对手对称部署 ranger+heavy、占 `cp_southwest`（`seq=20`）。结算军力我 457、敌 422。
- **R2（8 AP，5 executed / 3 failed）**：这是全局最贵的一次计划失误——我把 heavy 第一步就踩向 `(0,0)`，与对手 scout 同一步撞格（`seq=28`，双方都 `destination_conflict`）；因为该 heavy 移动硬失败，后续「ranger 跟进 `(2,0)`」变成 `destination_occupied`（`seq=30`），再后续「在 `(5,-1)` 部署 infantry」也因 ranger 未腾格而 `destination_occupied`（`seq=36`）。**3/8 AP 空耗**，对手同样损失 1 AP。我仍占住 NE 补给，军力 499:477。
- **R3–R5**：R3 heavy 扇形 + ranger 锁定把敌方 heavy `1488681c` 压到 50 血；R4 两发 ranger `LOCK` + 一发 heavy `arc` 收掉它（`seq=79`，`killValue +100`），但同轮另一辆 heavy 的 arc 因目标已死而 `missed`（`seq=81`）。R5 我继续压敌方 ranger 与 heavy，同时第一次用 support 给 54 血 heavy 回 25（`seq=104` → 47）。R5 结算军力 490:545，经济仍双方各 52/轮。
- **部署结构**：10 轮收入各 520，双方总资源都是 780。我 7 次部署只花 **460**（2 ranger + 2 infantry + 1 scout + 1 support + 1 ranger），终局剩 320；对手 7 次部署花 **558**（3 heavy、1 ranger、2 infantry、1 support），终局剩 222。**同是 7 次部署，对手把钱变成了 300 点重装军力，我变成了 80 点游侠与 55 点步兵**——这是 R7 之后正面换子崩盘的结构性原因。

## 3. 缩圈期（round 6 起）

### 炮火与安全区时间线

事件 `roundNumber` 标记轮界所属轮号；收缩与伤害发生在轮界，不计入任何玩家的计划动作。

| 轮界 | safeRadius / next | danger / warning | 我方站位的炮火结果 | 敌方炮火结果 | 评价 |
|---|---:|---|---|---|---|
| `artillery_warning` `seq=88` r5 | 6 / 6 | 外环 36 格预警 | 我方最远 d5，0 承伤 | 0 | 首次预警全员已撤回，做到了 |
| `artillery_shrunk` `seq=112` r6 | 5 / 7 | danger=d6（36 格） | 我方 0 | 敌方 infantry `ddc09ab5`@`(-6,0)` −25（`seq=113`） | 对手在外环留人，我先赚 25 |
| `artillery_shrunk` `seq=140` r7 | 4 / 8 | danger 扩至 d5（66 格） | 我方 0 | 敌方 infantry `4014f384`@`(-5,1)` −25（`seq=141`） | 对手继续留在收缩线外 |
| `artillery_shrunk` `seq=166` r8 | 3 / 9 | danger 扩至 d4（90 格） | **3 单位各 −25**：`18d9fa31`@`(2,2)`、`eaa00ef1`@`(4,-1)`、`b523ce59`@`(3,1)`（`seq=167/169/171`） | 敌方 2 次 −25（`seq=168/170`） | 我第一次被咬；3 个单位全在 d4 预警环且没有撤离计划 |
| `artillery_shrunk` `seq=198` r9 | 2 / 10 | danger 扩至 d3（108 格） | **4 单位各 −25**：`24febcc1`@`(3,-3)`、`eaa00ef1`@`(4,-1)`、`5ae06338`@`(3,0)`、`b523ce59`@`(3,1)`（`seq=199/201/202/204`） | 敌方 3 单位 −25，其中 2 名 infantry 剩 15 血 | 我累计承伤反超；`b523ce59` 连吃两轮预警，18 血伏笔 |
| `artillery_shrunk` `seq=226` r10 | 1 / null | danger=除中心 7 格外全部（120 格） | **5 单位 −25**：`/1eed9cab`@`(2,-2)`、`18d9fa31`@`(2,0)`、`24febcc1`@`(3,-3)`、`eaa00ef1`@`(4,-1)`、`5ae06338`@`(3,0)`（`seq=227–233` 中我方 5 条）；另 scout `24febcc1` 已 20 血 | 敌方 2 名 15 血 infantry 被炮火补死（`seq=230/234`），另一 heavy −25 | 半径 1 封死：我 5 个单位在圈外，对手恰好把 2 个残血单位清掉省了 AP |
| r11–r12（半径 1 保持） | 1 / null | warning=[] | r11 4 次共 −85，2 单位被白清（`seq=258–262`）；r12 support 剩 1 血被打死（`seq=285/286`） | 敌方 heavy `db40801f` r11 −25（`seq=263`）；其 support 一次 heal 因 `artillery_zone` `fizzled`（`seq=282`） | 炮火完成清场；我最后一个单位死于炮火，`artillery_destroyed` |

**炮火账（回放统计）**：我方承伤 **386**（R8 75 + R9 100 + R10 125 + R11 85 + R12 1），敌方 **255**；炮火直接击杀我方 **3**（scout `24febcc1`、infantry `eaa00ef1`、support `5ae06338`），敌方 **2**（两名 15 血 infantry）。炮火击杀 `eliminatedBy=null`，任何人不得分——我最后正是被这种“无归属清场”淘汰。

### 计划—结算线：撞车、锁定与交换

- **R2 撞车链**：见上；`destination_conflict` + 两次 `destination_occupied`，3 AP 空耗。R6 同型事故更贵——我的 ranger 想移到 `(0,0)`（`seq=122`，敌方 heavy 占位）、support 想移到 `(1,0)`（`seq=125`，ranger 未腾格），随后该 support 的 heal（`seq=128`）和该 ranger 的 `LOCK`（`seq=130`）都因 `previous_action_failed` 作废，**一次 4 AP 蒸发**；同轮 heavy `922dd04e` 被敌方 `arc` 打掉（`seq=126`，敌方 +100 killValue）。
- **R7 补刀失误**：我在计划末尾给已在 R7 第 1 步被杀的 ranger `25ebf5f9` 排了「移动→攻击」（结算 `unit_gone`，`seq=160/162`），又白烧 2 AP；正确的做法是把这两步给别的存活单位，或至少不排依赖该单位的后续动作。
- **锁定射击的亮点**：我的 ranger `attackLock` 命中率高——R3 `LOCK` 27、R4 `LOCK` 23+24、R5 `LOCK` 32+24、R8 `LOCK` 5（收掉敌方 ranger `309c77b3`，`seq=177`）、R9 `LOCK` 25、R10 `LOCK` 14（收掉敌方 heavy `836749be`，`seq=249`）。全场 28 次攻击计划、26 次命中、631 总伤害；**击杀造价 380 全部来自 4 次最后一击**（3 heavy + 1 ranger）。
- **交换比致命**：敌方 23 次攻击计划、22 次命中、574 伤害，拿到 **537 击杀造价**（我 2 heavy + 3 ranger + 1 infantry + 1 scout）。R9/R10 我连续两轮把敌方 heavy 压到 1 血／14 血才收掉（`seq=214/249`），但同轮自己的 heavy `ebc49f57`（`seq=215`）和 R11 的三个单位（`seq=276/277/280`）被对手反收；**对手同一辆 heavy 在 R11 用两发 `arc` 分别瞄准 `(0,0)` 与 `(1,-1)`，打掉我 infantry + scout**（`seq=276/277`），是全场最贵的一轮。

## 4. 终局（minimumSafeRadius 达成前后）

- **R10 半径 1 的中心 7 格**：`(0,0)`、`(0,-1)`、`(0,1)`、`(1,0)`、`(1,-1)`、`(-1,0)`、`(-1,1)`。敌方 heavy 占 `(0,-1)`、`(-1,0)`，support 占 `(-1,1)`，scout 占 `(0,1)`；我仅有 ranger 在 `(1,0)`，infantry 经 R10 计划进 `(0,0)`。
- **迟来的湖心**：我的 infantry `18d9fa31` 在 R10 轮界终于站上 `(0,0)` 并占下 `cp_isle`（`seq=254`，+3 维修/轮），但此时**已是半径 1、且我只剩 320 补给却没有从它部署任何单位**；R11 的 `control_point_repair` 只给 2 个单位各回 3 血（`seq=265/266`），杯水车薪。
- **清场顺序**：R11 `seq=259` scout 死于炮火、`seq=261` infantry 死于炮火、`seq=278` infantry `18d9fa31` 被敌方 `arc` 击杀、`seq=279` scout `1eed9cab` 被同一 `arc` 击杀、`seq=281` ranger `b523ce59` 被敌方 scout 点杀；R12 `seq=286` 最后一个 support 被炮火打掉 → `seq=287–289` 我的三个 CP 中立 → `seq=290` `player_eliminated(artillery_destroyed)` → `seq=291` `game_over`。敌方 4 单位存活（2 heavy、1 scout、1 support）。
- **没有房主干预**：全程无 `host/force-resolve`、无 `turn_skipped`、`plan_committed` 22 次（11 轮 × 2 人）均正常。

## 5. 逐轮计划—结算摘要与裁决账本

### 逐轮计划—结算摘要（`round_resolved.results.player_b`）

| 轮 | AP | 计划要点 | 结算 | 计划质量 |
|---|---:|---|---|---|
| 1 | 8 | scout 抢 NE 补给；2 ranger + 1 infantry 部署；双重甲压 `(3,0)/(2,0)` | 8/8 executed | 优：经济与站位同步建立 |
| 2 | 8 | 重甲抢 `(0,0)`、游侠跟进、补步兵 | 5 executed / 3 failed（`destination_conflict` + 2×`destination_occupied`） | **劣**：同一步抢格引发 3AP 级联失败 |
| 3 | 8 | 3 路火力压 heavy；1 次预测射击落空 | 7 executed / 1 missed | 中：锁定命中，但 `single` 预测格空放 |
| 4 | 8 | 4 路集火收 heavy；补 support | 7 executed / 1 missed（目标已死） | 中：拿到 100 killValue，但多排一发 |
| 5 | 8 | 2 次 LOCK、1 次治疗、重甲后撤、侦察外撤 | 8/8 executed | 优：第一次治疗止血 |
| 6 | 8 | heavy `arc` 双目标、LOCK、移动、治疗 | 4 executed / 4 failed（2×`destination_occupied` + 2×`previous_action_failed`） | **劣**：又是抢格，40% AP 蒸发 |
| 7 | 8 | heal、2 LOCK、3 次移动、1 次追加移动+攻击 | 6 executed / 2 `unit_gone` | 劣：给将死单位排后续动作 |
| 8 | 8 | 2 LOCK + `arc` + `line`、heal、3 次移动 | 7 executed / 1 `destination_occupied` | 中：收到敌方 ranger 人头，但被反杀 1 ranger |
| 9 | 4 | `arc`×2 + `line` + LOCK，把敌方 heavy 压到 1 血 | 4/4 executed | 优：收掉敌方 heavy，但自己也丢 1 辆 |
| 10 | 5 | scout 移 `(1,-1)`（失败）、infantry 进 `(0,0)`、2 次攻击、support 前移 | 4 executed / 1 `destination_conflict`（与敌方 heavy 同时抢 `(1,-1)`） | 中：拿到 killValue 与 `cp_isle`，但未从新据点补兵 |
| 11 | 3 | scout 移 `(1,-1)`、infantry `line`、ranger `LOCK` | 3/3 executed | 中：把敌方 support 打到 20 血，却无力补刀，自己被清 3 个 |

### 最终账本

| 项目 | 我方 `player_b` | 敌方 `player_a` | 权重 / 依据 |
|---|---:|---:|---|
| HQ 伤害 / 最终 HP | 不适用（无 HQ） | 不适用（无 HQ） | `headquarters = {}`，事件流无 HQ 事件 |
| 据点流量持有 / 期末据点 | 2.18 / 3（冻结时） | 2.00 / 2 | `game_over`，`controlPoint` 权重 0 |
| 存活军力价值 | 0 | 163 | `game_over.payload.scores`，`armyValue` 5 |
| 剩余补给 | 320 | 222 | `game_over`，`supplies` 权重 0 |
| 击杀造价 | 380 | 537 | `killValue` 1.5，按最后一击 |
| **总分** | **570** | **1620.5** | 校验：我 380×1.5=570；敌 163×5+537×1.5=815+805.5=1620.5 |

**军力价值曲线**（按回放逐事件重建至各 `round_end`）：

| 轮 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 我 | 457 | 499 | 510 | 515 | 490 | 494 | 412 | 308 | 200 | 101 | 1 |
| 敌 | 422 | 477 | 481 | 545 | 545 | 449 | 497 | 385 | 292 | 231 | 163 |

R1–R5 我基本领先；R6 自己的 heavy 被杀、R7 ranger 被杀后曲线掉头；R9–R10 双方互相打到残血，我跌得更快；R11 只剩 1 点军力。

**击杀归属（`killValue` 来源）**

- 我方 380：敌方 heavy `1488681c`（R4 `seq=79`，100）、ranger `309c77b3`（R8 `seq=177`，80）、heavy `d8044bed`（R9 `seq=214`，100）、heavy `836749be`（R10 `seq=249`，100）。
- 敌方 537：我方 heavy `922dd04e`（R6 `seq=126`）、ranger `25ebf5f9`（R7 `seq=148`）、ranger `87d6ea20`（R8 `seq=178`）、heavy `ebc49f57`（R9 `seq=215`）＝360；再加 R11 的 infantry `18d9fa31`（`seq=276`）、scout `1eed9cab`（`seq=277`）、ranger `b523ce59`（`seq=280`）＝177。
- 炮火击杀我方 3 个、敌方 2 个，**均不入账**；因此虽然我方击杀造价 380 也不低，仍然输在军力归零与对手 163 点残余军力上。

**AP 与动作账**

| 项目 | 我方 `player_b` | 敌方 `player_a` |
|---|---:|---:|
| 计划动作总数 | 76 | 70 |
| executed | 63 | 61 |
| failed | 11（2 `destination_conflict`、5 `destination_occupied`、2 `previous_action_failed`、2 `unit_gone`） | 7（2 `destination_conflict`、2 `destination_occupied`、2 `previous_action_failed`、1 `unit_gone`） |
| missed | 2（`single` 预测格无单位） | 1（`target_escaped`） |
| fizzled | 0 | 1（`artillery_zone`） |
| attack 计划 / 命中 | 28 / 26 | 23 / 22 |
| 部署次数 / 花费 | 7 / 460 | 7 / 558 |
| 有效 heal / 治疗量 | 3 / 74 | 1 / 27 |
| `control_point_repair` | 2 次 / 6HP | 0 |
| 炮火承伤 / 炮火击杀 | 386 / 3 | 255 / 2 |

## 6. 经验教训（≥3 条，可执行）

1. **同一行动点不要排两个单位抢同一格；前一步硬失败会连锁作废后续动作。** R2 我让 heavy 先踩 `(0,0)`、ranger 再进 `(2,0)`、步兵再补 `(5,-1)`，结果第 1 步与对手 scout 撞格，后两步依次 `destination_occupied`／部署位被占，3AP 蒸发；R6 同型事故造成 4AP 作废。**正确做法**：在公开棋盘上把“对手下一步最可能到的格”（此图是 `(0,0)`、`(1,-1)` 等中心格）视为同格冲突高风险，用 `wait` 把依赖动作错开一步，或改走侧翼格；触发条件是目标格距双方都 ≤1 步且是可攻占 CP。
2. **不要给可能在本步死亡的单位排后续动作。** R7 我给 ranger `25ebf5f9` 在末尾排了「移动→攻击」，但它在第 1 步就被敌方 `arc` 收掉，两步都 `unit_gone`（`seq=160/162`）。**正确做法**：低血（≤ 敌方一发 `arc` 31）单位只排当前最值的一步（通常是 `LOCK` 把伤害打出去），把后续 AP 给别的单位；这与 `tg_0257` 里“死亡单位仍完成已排攻击”的机制一致——排在前面的攻击有效，排在后面的会被级联作废。
3. **湖心维修点必须在缩圈前拿下，并且要真的从它出兵。** 我 R10 才占 `cp_isle`（`seq=254`），此后 0 次从它部署，320 补给全部烂在手里（权重 0，等于没有）；`tg_0257` 同图 R2 就占，并从 `(0,0)` 连续部署 5 次、共 480 补给。**触发条件**：`mirror-lake` 的 `cp_isle` 在 R6 炮火开始前完全安全，且持有 `canCapture` 的 scout/infantry 可在 R2 到达。**正确做法**：R1 抢 NE 补给的同时把 scout 继续推到 `(0,0)`，R3 起从维修点补 heavy/ranger，而不是从已进入 danger 的 `cp_east` 补。
4. **半径 2→1 的那一轮是最后撤离窗口，预警环多留一回合就是送血。** 我在 R8–R10 连续把 3/4/5 个单位留在下一轮就会变危险格的环上，累计炮火承伤 386（对手 255），3 个单位被白清；最后 support 在 R12 以 1 血被炮火打死，直接 `artillery_destroyed`。**规则**：`damage 25` 无视防御，单位 HP ≤ 25 时留在 warning 等于送死；应在预警出现的当轮就把它移进下一轮 `safeRadius` 内，即使牺牲一发攻击。
5. **补给权重为 0 时，留守补给就是空分；同是 7 次部署要买对兵种。** 我花 460 买 2 ranger + 2 infantry + 1 scout + 1 support + 1 ranger，对手花 558 买 3 heavy + ranger + 2 infantry + support；在最终半径 1 的贴脸战里，heavy 的 140HP/9防与 `arc` 三格覆盖远优于 68HP/3防的 ranger。**正确做法**：`armyValue=5` 且 `killValue=1.5` 的图上，把钱优先换成 heavy（每 100 补给换 500 军力），ranger 只留 1–2 个做 `LOCK` 补刀；并且必须在 `cp_east` 进 danger（R7）之前把 260 起始补给花完。
6. **锁定射击要提前安排“最后一击”单位。** 我 R5 把敌方 heavy 打到 116、R9 打到 1 血、R10 打到 14 血，最终靠 ranger `LOCK` 收掉后两颗人头；但敌方在 R11 用一次 heavy `arc` 同时收掉我 infantry 与 scout（各 55/42，`seq=276/277`）。**触发条件**：目标预计 HP ≤ 30 时，同轮排 `ranger LOCK` + 相邻 heavy `arc` 或 infantry `line`；本局我 R4 对 `1488681c` 的三路集火（23+24+3）就是正确范例。

## 与历史对局对比

- **`tg_0257_20261111.json`（同图 mirror-lake、同 WB@hy3，第 12 轮胜，2532.5:570）**：那局同为 2 人镜湖、同炮火配置，但我在 R2 就占下 `cp_isle`，从它部署 5 次共 480 补给，总部署 713、终局 7 单位存活；本局 R10 才占岛、0 次从岛部署、只花 460、终局 0 单位。炮火账也完全反转：那局我承伤 115 / 敌 648、7 个敌方单位被白清；本局我承伤 386 / 敌 255、3 个我方单位被白清。**结论**：镜湖胜负手不是正面交换，而是“R2 占岛 + 从岛持续补兵 + R10 前全员进中心 7 格”。
- **`tg_0256_20261110.json`（trench-run 歼灭，WB@hy3，第 13 轮胜，596:0）**：同为无 HQ、军力/击杀权重局，那局 7 单位存活、只有 1 个步兵死于炮火、`killValue=292`；本局击杀造价更高（380）却全军覆没，说明**击杀分不能替代军力存续**——炮火清场不给任何人送分，谁的单位先被打光谁就出局。
- **`tg_0242_20261026.json`（mistpine 同时回合，WB@hy3 落败）**：那局暴露的“计划链依赖未确认动作”问题，在本局 R2/R6/R7 原样重演（共 11 个失败 AP 中 7 个来自撞格与级联作废）。跨模式共性是：同时回合没有补救窗口，提交前必须逐条自检“这一步若失败，后面哪几步会一起废”。

## 总结

> **核心口诀：R2 抢湖心，R6 前把钱变重装；中心格别同一步挤，预警环多留一回合炮火就替对手收人头。**

**一句话总结：我靠 R1 抢补给和 R4/R8/R9/R10 的四次最后一击拿到 380 击杀造价，却因 R2/R6/R7 的撞车级联白烧 11AP、迟至 R10 才占湖心且全程没从它补兵、并把 5 个单位留在半径 1 的圈外，最终 386 炮火伤害把军队打光，以 570:1620.5 被 `artillery_destroyed` 淘汰。**
