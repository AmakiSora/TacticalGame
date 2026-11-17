# 战术游戏标准模式复盘 — `player_b` 视角

**日期/游戏ID/回放版本:** 2026-11-12 / `06d13c93-cf22-4a21-bb2c-70ad15232d6c` / `hex-v2-replay` schemaVersion 3.9.9（`tg_0265_20261112.json`，304 事件，exportedAt 2026-11-12T04:27:24Z）
**地图/参战人数:** `breach`（破障行动，半径 8，pointy hex）/ 2 人；**模式:** `standard`
**玩家:** Qwen4MaxPreview-QD（`QD@qwen4maxpreview`，本文视角）；对手 Dsv4.1Flash1017-WB（`WB` 席位 agent，`player_a`，房主）
**席位与出生:** `player_b`，行动顺序第 2（后手），HQ(8,0) 100HP/防 0；对手 `player_a` 行动顺序第 1（先手），HQ(-8,0) 100HP/防 0。`turnOrder=["player_a","player_b"]`、`firstPlayer=player_a`（seq3）。
**结果:** 第 2 名（负，active）— `game_over reason=turn_limit_score`，`winner=player_a`（seq304）。双方 HQ 均未被摧毁，无 `player_eliminated`，打满轮数上限按分裁决。
**结束轮次:** 第 15/15 整轮（`round_end` seq303 后触发裁决）；**HQ最终HP:** 我方 100/100，对方 100/100。

## 最终排名摘要（game_over.payload.rankings，seq304）

| 名次 | 席位 | 玩家 | 状态 | 总分 | 与我方分差 | 决定性优势 |
|---|---|---|---|---:|---:|---|
| 1 | player_a | Dsv4.1Flash1017-WB | active | 1591.31 | +203.91 | 军力价值 456×2=912（我 742）、击杀造价 435×0.5=217.5（我 188）；维修站锚定残血游侠续命 |
| 2 | player_b | Qwen4MaxPreview-QD | active | 1387.4 | 0 | 击杀 6 个敌单位（killValue 376），但损失 7 个、军力价值落后 170 |

> 双方 `headquartersDamage=0`、`ownHqHp=100`、期末各 3 据点——**HQ 与据点完全对称，胜负纯粹由「存活军力价值 + 击杀造价」决定**（详见账本）。

## 本局配置要点（game_start，seq3）

- `actionsPerTurn: 5`（每席位回合 5 次激活，同一单位激活后后续合法动作不重复扣 AP），`maxTurns: 15`，起始补给 50，基础收入 10，`komi.supplies: 10`（后手 R1 以贴目代收入）。
- 裁决权重（`adjudicationWeights`）：`enemyHqDamage 5 / ownHqHp 2 / controlPoint 90（controlPointFlowRatio 0.7）/ armyValue 2 / supplies 0 / killValue 0.5`。**supplies 权重 0：囤补给不加分；HQ 伤害权重仅 5：换家不是本图主轴。**
- 据点效果（`controlPointTypes`）：supply +20 收入；forward_base +8 收入 +8 部署折扣；repair +8 收入 +每轮治疗相邻单位 10HP。
- 兵种实例值（`config.units`，全图唯一数值来源）：infantry 45/100hp/30攻/8防/3移/1程/可占点；scout 38/65/16/4/5移/1程/可占点；heavy 92/150/40/13/3移/1程/**唯一可拆除**；ranger 78/72/44/3/2移/**3程**；support 60/82/10/5/3移/1程/治疗22。`damageVarianceRange ±3`、`minimumDamage 1`、`healVarianceRange 6`。伤害 = max(1, 攻−防 + uniformInt(−3,+3))。
- 地形（map.description）：「中央十字石墙阻断直通路线，重装可爆破开路；补给站、维修站、前线基地三对据点原点反射对称，双方各得三种类型」。q=0 中央墙；本局拆除口：北 `(0,-2)`（A，seq24）、南 `(0,2)/(0,3)`（B，seq33/35）、`(1,-1)`（B，seq117）。
- 初始单位：A scout `5cc3`(-6,0)、heavy `0243`(-7,1)、heavy `d9f7`(-6,-1)；B scout `12e5`(6,0)、heavy `1af9`(7,-1)、heavy `74c7`(6,1)。
- 据点（原点反射对称）：cp_nw(-4,-3) supply、cp_se(4,3) supply；cp_w(-3,0) repair、cp_e(3,0) repair；cp_sw(-4,3) forward_base、cp_ne(4,-3) forward_base。

## 游戏进程时间线

补给为「回合开始收入后→行动后」；AP 上限 5/席位回合。单位短 id 见上文配置。事件 seq 均出自回放。

| 整轮/席位回合 | 补给（我B） | 关键操作与坐标（seq） | 结果/局势变化 | 战术意图 |
|---|---|---|---|---|
| R1 / a 先 | A 50→5 | A 三步前压 + deploy inf `4a46`(-7,0)（seq7）+ 占 cp_w 维修站（seq8） | A 抢下维修锚点 | 占点/经济 |
| R1 / b 后 | 50→60(+10 komi)→15 | B 占 cp_se 补给站（seq16）+ deploy inf `98a6`(7,0)（seq13） | 我抢补给站（+20/轮） | 经济 |
| R2 / a | A 5→23(+18) | A 占 cp_nw + cp_sw（seq26/27）+ heavy `d9f7` 拆北口 (0,-2)（seq24） | A 三据点成型、北路开 | 破墙/经济 |
| R2 / b | 15→45(+30)→0 | B 占 cp_e（seq38）+ heavy `74c7`/`1af9` 拆南口 (0,2)/(0,3)（seq33/35）+ deploy inf `50df`(3,3)（seq36） | 我南路开、据点 2 个 | 破墙/爆兵 |
| R3 / b | 0→38(+38) | B inf `98a6` 占 cp_ne 前进基地（seq53） | **据点 3-3 定格至终局**；此后双方收入均 46/轮 | 经济对称 |
| R4 / a,b | 38→84(+46)→6 | 首次交火：A ranger `ab15` 击我 heavy `74c7`（seq59）；我 heavy `1af9` 反打 `ab15` 至 36hp（seq69）；双方各 deploy ranger（A `ab15` seq58 / B `4540` seq72） | 中路接触 | 试探 |
| R5 / a,b | 6→52(+46)→7 | **A 集火杀我 inf `50df`**（seq83/84/85）；我 heavy `1af9` 把 `ab15` 打到 8hp（seq97）；A deploy ranger `b606`（seq81），B deploy inf `280e`（seq95）；A 起用 cp_w 修 `ab15`（seq79） | 我损 1 兵，但 `ab15` 残血 | 换血 |
| R6 / a,b | 7→53(+46) | A 把我 inf `98a6` 打到 18hp（seq107/109）；我 ranger `4540` 打 A scout `5cc3` 至 27hp（seq119）；B 拆 (1,-1)（seq117） | 互相消耗 | 推进 |
| R7 / a,b | 53→99(+46)→21 | A heavy `d9f7` 杀我 inf `98a6`（seq126）+ 集火我 heavy `1af9` 至 28hp（seq130-133）；**我 ranger `4540` 杀 A scout `5cc3`**（seq137）；A deploy ranger `fb7a`（seq129，折扣8），B deploy ranger `106e`（seq139） | 我杀 1 但 heavy `1af9` 残血 | 交换 |
| R8 / a,b | 21→67(+46) | A ranger `fb7a` 杀我 heavy `1af9`（seq150）；**我北路三连击杀 A inf `4a46`**（ranger `4540` seq159 + ranger `106e` seq161 + heavy `74c7` seq162）；A deploy inf `b1fe`（seq152，折扣8） | 北路打开、我杀 1 | 北路突击 |
| R9 / a,b | 67→113(+46)→21 | **我 heavy `74c7` + ranger `4540` 杀 A heavy `d9f7`**（seq181/183）——北路突破顶点；我 ranger `106e` 打 A ranger `2693` 至 30hp（seq186）；B deploy heavy `f6d1`(4,2)（seq187），A deploy ranger `2693`（seq173） | **我方比分峰值**（杀敌重型） | 扩大战果 |
| R10 / a,b | 21→67(+46)→22 | A 集火我 heavy `74c7` 至 40hp（seq195/197/199）、inf `280e` 至 6hp（seq200/201）；**我 ranger `4540` 打 A ranger `2693` 仅至 2hp（seq206，dmg38<40）漏杀**；B deploy inf `fe47`（seq209） | 漏杀埋下崩盘伏笔 | 进攻 |
| R11 / a,b | 22→68(+46)→38 | **崩盘轮：A 连杀我 scout `12e5`（seq216/217）、inf `280e`（seq219）、ranger `4540`（seq221/222）**；我 ranger `106e` 仅换掉 A ranger `2693`（seq227，A 上轮 cp_w 修过 seq213）；A deploy heavy `bfc8`（seq215），B deploy scout `0784`（seq232，折扣8） | 我净损 3 兵、比分 irreversible 转负 | 止损失败 |
| R12 / a,b | 38→84(+46)→6 | A 把我 inf `fe47` 打到 35hp（seq237/238）、ranger `106e` 打到 28hp（seq239）；我 heavy `f6d1` 打 A heavy `0243` 至 42hp（seq246）；B deploy ranger `f0e3`（seq247），A deploy inf `8adc`（seq240） | 我持续掉血 | 反击 |
| R13 / a,b | 6→52(+46)→15 | 我 heavy `f6d1` + ranger `f0e3` 把 A inf `b1fe` 打到 35hp（seq263/265）；B deploy inf `4623`（seq266，折扣8），A deploy inf `6a03`（seq256）；A cp_w 修 `ab15`（seq254） | 蓄势 | 准备收割 |
| R14 / a,b | 15→61(+46)→24 | A 五连集火我 heavy `f6d1` 至 18hp（seq272-276）；**我 heavy `f6d1` 杀 A ranger `ab15`（seq281）+ ranger `f0e3` 杀 A inf `b1fe`（seq283）双杀**；B deploy inf `ee3b`（seq285，折扣8）+ 两游侠撤至 (3,2)/(4,-1)（seq286/287） | 比分 −400→−140 | 收割+保兵 |
| R15 / a,b | 24→70(+46)→3 | A deploy heavy `93bb`(-4,0)（seq292，+184 军力分）+ heavy `0243` 杀我 heavy `f6d1`（seq293）；B deploy inf `29a2`(5,-3) + scout `cbea`(4,-4)（seq300/301，+166 军力分）；cp_e 修我 ranger `106e` 至 38hp（seq298） | 终局补分，定格 −204 | 裁决最大化 |

> **R14 实时停顿说明（定性）：** `round_end` 时间戳 R13=1794434726473 → R14=1794452282110，整轮间隔约 **4.88 小时**（R14→R15 仅 3.1 分钟，全局实时跨度约 6.07 小时）。回放中 R14 `player_a` 回合以**正常 `reset_actions`（seq277）+ `turn_end`（seq279）**收口，**全程无 `turn_skipped` / `host_eliminated` 事件**——即对手回合长时间停顿后自行正常结束，按回放口径不计为房主管理干预。

## 核心策略与关键转折

### 三个策略
1. **南路破墙 + 北路突击（我）：** R2 用双 heavy 拆南口 (0,2)/(0,3)（seq33/35），R6 拆 (1,-1)（seq117），主力 heavy `74c7`/ranger `4540`/`106e` 走北路，R8 杀 `4a46`、R9 杀 heavy `d9f7`（seq162/183）。意图：打通中央墙后直插敌侧。
2. **爆兵军力流（我）：** 全局 deploy 13 个单位共 677 补给（A 10 个共 660），试图以 armyValue×2 + killValue×0.5 取胜；但多为廉价 infantry/scout，且前线单位被逐个集火。
3. **维修站锚定游侠死亡球（A）：** A 以 cp_w 维修站为锚，ranger `ab15` 长期贴站每轮 +10HP（repair 事件 seq79/105/124/148/170/192/254/270 共 8 次修 `ab15`，另修 `2693` seq193/213），残血续命后反打；配合每轮先手集火我冒进单位，R11 后补 heavy `bfc8`/`93bb` 拉满军力价值。

### 三个转折
1. **R9 北路突破（我方峰值）：** 杀 A heavy `d9f7`（seq183），一度比分领先。但未能转化为 HQ 压力（敌 HQ 始终 100HP）。
2. **R10 漏杀 → R11 崩盘（不可逆）：** ranger `4540` 对 A ranger `2693` 仅打 38HP（seq206，目标 40HP→2HP）未致死；A 借 cp_w 修回（seq213）后于 R11 反杀我 ranger `4540`（seq222）。同轮我连损 scout `12e5`/inf `280e`/ranger `4540` 三单位（seq218/220/223），只换 1 个，armyValue 天平自此倒向 A。
3. **R14 双杀追分 → R15 被重型反压：** 我 R14 杀 `ab15`+`b1fe`（seq281/283）把分差从 −400 追到 −140；A R15 立刻 deploy heavy `93bb`（seq292，+184 军力分）并杀我 heavy `f6d1`（seq293），分差回到 −370；我终局双 deploy（seq300/301，+166）定格 −204。

## HQ、据点与行动点分析（五个核心问题）

**对对手 player_a 的交互汇总：** 我对 A HQ 伤害 0（无任何 `attack targetKind=hq`）；我击杀 A 单位 6 个（scout `5cc3`、inf `4a46`、heavy `d9f7`、ranger `2693`、ranger `ab15`、inf `b1fe`）；我被 A 击杀 7 个（inf `50df`/`98a6`/`280e`、heavy `1af9`/`f6d1`、scout `12e5`、ranger `4540`）；据点 3-3 对称，无互相夺取（R3 后无 `control_point_captured`）。

1. **真正胜负点 / 不可逆压力轮：** 不是 HQ（双方 100HP、0 伤害），而是**西侧维修站 cp_w 周围的军力消耗战**。R11 我净损 3 兵形成不可逆压力；A 的维修锚点把「残血」变成「可持续战力」，我的冒进单位则变成一次性消耗。
2. **据点收益是否覆盖成本：** 双方各 3 据点、46/轮收入完全对称（supply20+repair8+forward8+base10）。**差异在维修站利用率**：A 用 cp_w 治疗 10 次（`control_point_repair` seq79/105/124/148/170/192/193/213/254/270），我用 cp_e 仅 2 次（seq93 修 `74c7`、seq298 修 `106e`）。A 的 8 收入维修站通过续命残血游侠产生了远超 8 收入的军力价值；我的维修站几乎闲置。forward_base 折扣双方都用（A 2 次：seq129/152；B 5 次：seq232/266/285/300/301）。
3. **行动点是否给对单位 / 空转：** AP=5。低效点：(a) R10 ranger `4540` 的攻击未能确保击杀（seq206），等于把 AP 投在一个「打残但没打死」的目标上，反被续命反杀；(b) heavy `f6d1` R9 部署后逐步西推进入死亡球射程，R12–R14 被集火至 18HP、R15 被杀（seq293），92 造价军力白白送掉；(c) 终局 R14 剩 1 AP、R15 剩 3 AP 无可达目标空转——主力偏东，够不着西侧敌军。
4. **先手 / 行动顺序的影响：** `turnOrder=[a,b]`，A 每轮先动，能先集火秒我冒进单位、我再回应时已减员；对称换家因此必败（A 先手守家+维修更稳）。这要求我把优先级从「进攻推进」改为「保军力 + 维修续命 + 确保击杀」。
5. **裁决分领先来源 / 可量化补分：** A 领先全部来自 armyValue（912 vs 742，+170）与 killValue（217.5 vs 188，+29.5），controlPoint 仅 +4.4。可量化补分动作：终局每多 deploy 一个满血 infantry = +90 分（我 R15 已做 +166）；每确保击杀一个 ranger = 195 分摆动（armyValue×2 + killValue×0.5）。最大杠杆是**少送军力 + 确保最后一击**，而非占点或换家。

## 补给与裁决分账本

权重取自本局 `config.balance.adjudicationWeights`（seq3）。据点分 = (controlHold×0.7 + 期末据点×0.3)×90。

### 我方 player_b（game_over.payload.scores，seq304）

| 项目 | 数量/数值 | 本局权重 | 贡献分 | 事件或配置依据 |
|---|---:|---:|---:|---|
| 对敌 HQ 伤害 | 0 | ×5 | 0 | 无 `attack targetKind=hq` |
| 己方 HQ 最终 HP | 100 | ×2 | 200 | game_over `ownHqHp=100` |
| 据点流量持有 controlHold | 2.8 | ×90×0.7=63 | 176.4 | `round_end` controlHoldCounted + `control_point_captured` |
| 期末控制据点数 | 3 | ×90×0.3=27 | 81 | `control_point_captured`（R3 后 3-3） |
| 存活军力价值 armyValue | 371 | ×2 | 742 | game_over `armyValue=371` |
| 剩余补给 | 3 | ×0 | 0 | income/deploy 账 |
| 击杀造价 killValue | 376 | ×0.5 | 188 | 6 次 `unit_death` 最后一击 |
| **总分** | | — | **1387.4** | game_over `scores.player_b.total` |

### 对手 player_a（同权重）

| 项目 | 数值 | 贡献分 | 依据 |
|---|---:|---:|---|
| HQ 伤害 / 己方 HQ | 0 / 100 | 0 / 200 | game_over |
| 据点 controlHold 2.87 / 期末 3 | | 180.81 + 81 = 261.81 | round_end + captured |
| armyValue 456 | ×2 | 912 | game_over |
| 补给 6 | ×0 | 0 | income/deploy |
| killValue 435 | ×0.5 | 217.5 | 7 次 unit_death |
| **总分** | | **1591.31** | game_over `scores.player_a.total` |

### killValue 明细（最后一击归属）

- **我 376：** R7 scout `5cc3` 38（seq137 ranger `4540`）+ R8 inf `4a46` 45（seq162 heavy `74c7`）+ R9 heavy `d9f7` 92（seq183 ranger `4540`）+ R11 ranger `2693` 78（seq227 ranger `106e`）+ R14 ranger `ab15` 78（seq281 heavy `f6d1`）+ R14 inf `b1fe` 45（seq283 ranger `f0e3`）= 376。
- **A 435：** R5 inf `50df` 45（seq85）+ R7 inf `98a6` 45（seq126）+ R8 heavy `1af9` 92（seq150）+ R11 scout `12e5` 38（seq217）+ R11 inf `280e` 45（seq219）+ R11 ranger `4540` 78（seq222）+ R15 heavy `f6d1` 92（seq293）= 435。

### 收支账（income/deploy，逐轮核对至最终补给）

- **我 B：** 起始 50 + R1 komi 10（seq10）+ R2 30（seq29）+ R3 38（seq47）+ R4–R15 各 46×12=552 = **680**；deploy 13 次共 **677**（seq13/36/72/95/139/187/209/232/247/266/285/300/301）；最终补给 **3**（680−677）。
- **A：** 起始 50 + R1 0（先手无收入）+ R2 18（seq19）+ R3 46（seq41）+ R4–R15 各 46×12=552 = **666**；deploy 10 次共 **660**（seq7/58/81/129/152/173/215/240/256/292）；最终补给 **6**（666−660）。
- **无效花费/低效：** 我 heavy `f6d1`（92，seq187）与 ranger `4540`（78，seq72）合计 170 补给被集火击杀且未换回等价军力；A 用 cp_w 维修（10 次）把残血单位反复救回，等效节省了大量重deploy。双方 supplies 权重 0，终局我剩 3、A 剩 6 均不加分。

## 失误与改进（非第一名：实际 vs 正确 / 触发条件 / 预期收益）

1. **R10 漏杀游侠 `2693`（最致命）**
   - 实际：ranger `4540` 攻击 40HP 的 `2693`，dmg38 留 2HP（seq206）；A 次轮 cp_w 修回（seq213）并 R11 反杀我 `4540`（seq222）。
   - 正确：只在「保证击杀」时出手，或补第二击确保致死；否则改打能秒杀的目标/先保兵。
   - 触发条件：目标 HP > 我方最小伤害（ranger 对 def3 最小 38，目标 40HP 即可能漏杀）。
   - 预期收益：R10 杀掉 `2693` = +195 摆动（78×2 军力 + 78×0.5 击杀），并避免 R11 我 `4540` 被杀（−195 摆动），合计约 390 分摆动——足以覆盖最终 204 分差。
2. **把 heavy `f6d1` 喂进维修站死亡球**
   - 实际：R9 部署 (4,2)（seq187）后西进，R12–R14 被 3 游侠+重型集火至 18HP（seq272-276），R15 被杀（seq293）。
   - 正确：heavy 用于拆墙/守家/安全距离输出，不进入 ≥2 个敌 ranger 的 3 程集火圈；残血即撤退回 cp_e 维修圈。
   - 触发条件：敌方多游侠集结且我单位孤立深入。
   - 预期收益：保住 92 军力（×2=184）+ 拒给 A 92 击杀（×0.5=46）= 230 分摆动。
3. **cp_e 维修站几乎闲置**
   - 实际：全局仅 2 次维修（seq93/298）；A cp_w 维修 10 次。
   - 正确：把残血单位（如 R10 后 40HP 的 heavy `74c7`、28HP 的 ranger `106e`）常态贴 cp_e 每轮 +10HP 续命，而非让其被补刀。
   - 触发条件：单位 HP 低于敌集火斩杀线且相邻维修站。
   - 预期收益：每续命一轮即保住对应 armyValue（ranger 满血 156 分），长期累积远超维修站 8 收入。
4. **终局主力偏东、AP 空转**
   - 实际：R14 剩 1 AP、R15 剩 3 AP 无可达目标；最后只能 deploy 补分。
   - 正确：中盘把军力维持在「能威胁敌据点/单位」的射程内，终局才有击杀/占点可转化。
   - 触发条件：进入 maxTurns 倒数 2–3 轮。
   - 预期收益：多 1 次击杀即 +100~195 分，优于闲置 AP。

## 与历史对局对比

- **`tg_0260_win_QD@qwen4maxpreview.md`（danger-close，standard，同模型，我胜）：** 该图 `enemyHqDamage` 权重高达 **20**、`actionsPerTurn 1`、双方 HQ 仅隔 4 格，我 R10 摧毁敌 HQ 以 `last_player_standing` 取胜（HQ 伤害 120×20=2400 定音）。**本局 breach 权重相反：enemyHqDamage 仅 5、controlPoint 90、armyValue 2**，双方 HQ 全程 100HP、0 伤害——换家根本不是胜负手。教训：**必须按本图权重决定攻守**；我把 HQ 重图里「 aggressive 推进换家」的习惯带到 breach，结果军力被消耗殆尽。这是重复验证了「读权重再定策略」，但本局是反面修正案例。
- **`tg_0258_win_QD@qwen4maxpreview.md`（mirror-lake，royale，同模型，我胜）：** 该图 `armyValue×5 + killValue×1.5`、supplies 0，我靠全歼敌军取胜。与本局共同点：**supplies 权重 0、击杀与军力是核心杠杆**。本局 R10 漏杀直接违背了 tg_0258 验证过的「确保最后一击」经验——同一模型在军力/击杀主导图上，漏杀与送军力是最大失分源。

## 总结

### 做得好的
1. **北路破墙突击有效：** R2 拆南口、R8–R9 连杀 A inf `4a46` 与 heavy `d9f7`（seq162/183），一度取得比分领先，证明破墙+集中火力能撕开对称防线。
2. **R14 残局收割 + 保兵：** 用残血 heavy `f6d1` 换掉 A ranger `ab15`（seq281）、ranger `f0e3` 收 inf `b1fe`（seq283），并把两游侠撤到安全格（seq286/287），把 −400 追到 −140。
3. **终局裁决最大化：** R15 在无可达击杀时果断双 deploy（seq300/301，+166 军力分），把最终分差压到 −204，没有浪费补给（supplies 权重 0）。

### 下次改进
1. **触发：目标 HP > 我最小伤害 → 替代动作：** 不出手或补第二击确保击杀（R10 `2693` 漏杀是崩盘起点）。
2. **触发：敌 ≥2 游侠集结 + 我单位孤立 → 替代动作：** heavy/残血单位撤回 cp_e 维修圈续命，不喂死亡球（heavy `f6d1` 白送 230 分摆动）。
3. **触发：进入倒数 3 轮 → 替代动作：** 军力前移到可威胁射程内，把 AP 转成击杀/军力而非空转。

> **核心口诀：先保军力再换击杀——维修站锚定残血、确保最后一击、按本图权重决定攻守。**

**一句话总结：breach 是军力+据点经济局而非换家局；我 R10 漏杀游侠引发 R11 崩盘、又把重装喂进对方维修站死亡球，终局虽双杀+爆兵补分仍因军力价值落后 204 分告负。**