# 战术游戏标准模式复盘 — `player_b` 视角

**日期/游戏ID/回放版本:** 2026-09-30 / `9a99a338-0f88-4e8f-86a2-cb8e55ad5632` / 3.5.7（hex-v2-replay）
**地图/参战人数:** forge（熔炉重铸，半径 6）/ 2 人
**玩家:** mimo2.6pro-OMP（OMP@mimo2.6pro）
**席位与出生:** `player_b`，行动顺序第 2（后手），HQ(5,-5) 100/100
**对手:** `player_a` mimo2.5pro-OMP（OMP@mimo2.5pro），HQ(-5,5)，先手
**结果:** 🏆第1名 — `turn_limit_score`
**结束轮次:** 第 10/10 整轮；**HQ最终HP:** 100/100（双方均未受任何 HQ 伤害）

## 最终排名摘要

| 名次 | 席位 | 玩家 | 状态 | 总分 | 与我方分差 | 决定性优势 |
|---|---|---|---|---:|---:|---|
| 1 | `player_b` | mimo2.6pro-OMP | active | 1350 | — | armyValue 401 vs 242（+159，权重 2 = +318 分）+ actionScore 54 vs 40 |
| 2 | `player_a` | mimo2.5pro-OMP | active | 1203 | -147 | 据点 3 vs 2（+75 分）、收入 318 vs 264 |

## 游戏进程时间线

配置：`actionsPerTurn 4`，`maxTurns 10`，`startingSupplies 80`，`baseIncome 10`，据点收入 `supply 12 / forward_base 8（部署-8）/ repair 8（+10HP）`，`damageVarianceRange 3`，裁决权重 `enemyHqDamage 7 / ownHqHp 2 / controlPoint 75 / armyValue 2 / supplies 1 / effectiveActions 2`。

| 整轮/席位回合 | 补给 | 行动点 | 关键操作与坐标 | 结果/局势变化 | 战术意图 |
|---|---:|---|---|---|---|
| r1 `player_a` 回合 | 80 | 4/4 | inf→(-4,2)、scout→(-2,0)、heavy→(-4,4)、ranger→(-5,4)；占 cp_supply_a [seq4-8] | A 拿下西麓矿场，收入 +12 | 先手常规抢点，四单位前压 |
| r1 `player_b` 回合 | 80 | 4/4 | inf 5,-4→4,-2 占 cp_supply_b [seq12,16]、scout 4,-5→0,-2 [seq13]、heavy 5,-6→4,-4 [seq14]、ranger 6,-5→5,-3 [seq15] | 双方 1:1 各占一个 supply；我 scout 走最远路径侦察 | 后手镜像抢点，不丢经济对等 |
| r2 `player_a` | 22 入账 | 4/4 | scout→(-2,-2)、inf→(-2,-1)、heavy→(-3,3)、ranger→(-4,3)；占 cp_fb_a [seq21-25] | A 拿下前哨，收入 30/轮 | 中路推进 + 前哨折扣 |
| r2 `player_b` | 22 | 4/4 | scout 0,-2→3,0 [seq29]、heavy 4,-4→3,-2 [seq30]、inf 4,-2→2,0 [seq31] | 全线东撤重组，未占新点 | 侦察到 A 三单位压向中路后先收缩，避免 scout 被吃 |
| r3 `player_a` | 30 | 4/4 | heavy 拆 (-2,1)、(-1,0) 两次 [seq38,55]；inf→(-2,-3)、scout→(0,-2)、ranger→(-2,3)；占 cp_repair_a [seq41] | A 3 据点，收入 38/轮，重装开墙打通中路 | 破中央熔炉墙，建立进攻通道 |
| r3 `player_b` | 22 | 4/4 | ranger 5,-3→3,-3 攻 A scout 39 伤 → 19HP [seq45-46]、heavy 3,-2→1,-1 [seq47]、inf 2,0→2,2 占 cp_fb_b [seq48-49] | 首次交火；A scout 重残；我 2 据点 | 用 ranger 射程优势点残对方 capturer，同时补回前哨 |
| r4 `player_a` | 38 | 4/4 | ranger 0,2 攻我 inf 31 伤 [seq57]、heavy 拆 (0,1) [seq71→r5]、scout 撤回 (-3,-3) | 我 inf 掉到 59HP | A 用 ranger 骚扰我的 capturer |
| r4 `player_b` | 30 | 4/4 | ranger 3,-3→3,-1 攻 A ranger 39 伤 → 29HP [seq62-63] | A ranger 重残，被迫转入防守 | 对射止损，逼对方 DPS 回撤 |
| r5 `player_a` | 38 | 4/4 | ranger 攻我 inf 35 伤 → 24HP [seq69]、heavy 拆 (0,1) [seq71]、deploy inf (-2,-1) from cp_fb_a 花 34 [seq73] | 我 inf 残血 24；A 首次爆兵 | A 持续压我 capturer + 前哨折扣爆兵 |
| r5 `player_b` | 30 | 4/4 | ranger 攻 A heavy 28 伤 [seq78]、inf 2,2→3,3 撤离 [seq79]、scout→3,-2 [seq80]、heavy→2,-2 [seq81] | 我全线重组，inf 残血撤出火线 | 保军力价值（armyValue 按 hp 比例计分），残血不送 |
| r6 `player_a` | 38 | 4/4 | deploy inf (-1,-3) 花 34 [seq88]、heavy→2,1、inf→1,-2 | A 5 步兵压上 | 用便宜步兵海换我血量 |
| r6 `player_b` | 30 | 4/4 | heavy 攻 inf 30 伤 [seq94]、ranger 攻 inf 30 伤 → 30HP [seq95]、scout→4,-3 [seq96]、inf→2,4 [seq97] | A 残血步兵 30HP | 两打一集火最前排步兵 |
| r7 `player_a` | 38 | 4/4 | inf 攻我 heavy 16 伤 [seq103]、heavy→2,3、步兵继续前压 | 我 heavy 124HP | A 用步兵换血 |
| r7 `player_b` | 30 | 4/4 | ranger 攻 inf 34 伤 → 56HP [seq111]、scout→4,-4 [seq112]、inf→1,5 [seq113] | 继续压血线 | ranger 稳定输出 |
| r8 `player_a` | 38 | 4/4 | heavy 攻我 inf 24 伤 → **阵亡** [seq120-121]、步兵+scout 重新布防 | 我首失单位（inf 67d12415） | A 击杀残血 capturer，扳回 armyValue |
| r8 `player_b` | 30 | 4/4 | ranger 攻 inf 30 伤 → 26HP [seq128]、**deploy ranger (3,2) from cp_fb_b 花 64** [seq129] | +1 ranger，armyValue 回升 | 前哨折扣补 DPS（72−8=64） |
| r9 `player_a` | 38 | 4/4 | deploy inf (-1,-2) 花 34 [seq135]、deploy inf (-3,2) 花 42 [seq136]、heavy→2,3 | A 把现金转军力 | 终局前 A 开始爆兵 |
| r9 `player_b` | 30 | 4/4 | ranger 攻 inf 33 伤 → 57HP [seq141]、新 ranger 3,2→5,1 攻 heavy 31 伤 [seq142-143]、heavy→1,-1 [seq144]、scout→4,-5 [seq145] | A heavy 81HP | 双 ranger 集火前排，重装侧翼压上 |
| r10 `player_a` | 38 | 4/4 | scout→(-1,-1)、inf→(-1,-3)、heavy→1,4、inf→0,3 [seq150-153] | A 收缩布防 | A 收尾保分 |
| r10 `player_b` | 30 | 4/4 | **deploy ranger (3,2) 花 64 [seq157]、deploy ranger (5,-2) from cp_supply_b 花 72 [seq158]**、ranger 攻 inf 26 伤 → **阵亡** [seq159-161] | armyValue 飙到 401；击杀 A 步兵；actionScore 54 | 终局现金全转军力 + 战功，锁定胜局 |
| 第 10 轮结束 | 144 | — | `game_over` `turn_limit_score` | **1350 : 1203 胜** | — |

## 核心策略与关键转折

**策略 1：后手镜像抢点，经济不落后。** r1 我后手立刻补占 cp_supply_b（seq16），把收入差锁在 0；前 3 轮 A 多占两个点是靠中路推进而非我弃点，代价是它的单位全压过半场。

**策略 2：ranger 射程优势持续压血。** 全局我 attack 10 次共 320 伤害，A 仅 3 次 106 伤害。r3（seq46）点残 A scout 至 19HP 使其整局残废（后靠 cp_repair_a 每轮 +10 慢慢爬回 58HP，但它再没打出有效输出）；r4（seq63）点残 A ranger 至 29HP，同样废掉其 DPS。两次 39 伤都命中 `40-3=37±3` 的高段。

**策略 3：残血单位撤出火线保 armyValue。** armyValue = Σ round(cost×hp/maxHp)，残血等同扣分。我 inf 24HP 时（seq79）果断撤到 3,3，之后 1,5，多拖了两轮才被 A heavy 追杀（seq120）。每拖一轮都保住 11-12 点 armyValue。

**转折 1（r1-r3）：中路争夺与三据点落后。** A 先手 + heavy 拆墙（seq38,55,71）打通中央通道，连拿 cp_fb_a、cp_repair_a，形成 3:2 据点、38:30 收入。这是本局真正的胜负通道——不是任何一家 HQ，而是中央熔炉墙十字的破拆进度。r3 起 A 已建立不可逆的据点压力（多 8 收入/轮 + 75 分/据点）。

**转折 2（r3-r4）：两次 ranger 点残对手 DPS。** A 的 scout 和 ranger 先后被打到 19/29HP，等于本局中盘它只有 heavy 和步兵在有效作战，我方双 ranger 从 r4 起掌握远程主动权。

**转折 3（r8-r10）：终局现金转化军力。** r8 我察觉 `armyValue` 权重 2 远高于 `supplies` 权重 1，开始部署 ranger（64）；r10 再补两个（64+72），加上击杀 A 步兵（seq160），armyValue 从 257 冲到 401，同时 `actionScore` 因 3 次 deploy + 1 次击杀跳到 54。这是从落后 105 分（r9 裁决 1152:1257）到反超 147 分的直接原因。

## HQ、据点与行动点分析

- **对 `player_a` 的 HQ(-5,5)：0 伤害。** 我方亦 0 伤害。全战局在中场拉锯，双方都未进入对方 HQ 射程；`enemyHqDamage 7` 的权重本局双方都没吃到，胜负完全由 `controlPoint`、`armyValue`、`actionScore` 三项决定。
- **据点交互：** 我方占 2（cp_supply_b r1 [seq16]、cp_fb_b r3 [seq49]），A 占 3（cp_supply_a r1 [seq8]、cp_fb_a r2 [seq25]、cp_repair_a r3 [seq41]）。A 的 cp_repair_a（每轮 +10HP）修复了 scout 4 次共 39HP [seq67,85,101,117]，是它残血 scout 能活下来的唯一原因——维修点的防守价值被 A 充分利用。
- **行动顺序代价：** 后手意味着每轮我先挨 A 的输出再还手。r8 我 inf 在 A 回合被杀 [seq120]，我在自己回合才用攻击补偿 [seq128]。顺序劣势只能用部署和击杀扳回，不能靠移动。
- **AP 使用：** 每轮 4 AP 基本全勤（move 57 + deploy 7 + attack 14 + demolish 3 事件）。我方本轮 actionMerit 27 = deploy 3×1 + capture 2×2 + attack merit 18；A merit 20 = deploy 4×1 + demolish 3×1 + capture 3×2 + attack merit 4。A 的 3 次拆墙（seq38,55,71）虽然拿到 merit，但消耗了 3 AP 在不可计分的地形上，若换成攻击会多出伤害分。

## 补给与六项裁决分账本

权重：`enemyHqDamage 7 / ownHqHp 2 / controlPoint 75 / armyValue 2 / supplies 1 / effectiveActions 2`（来自本局 `config.balance.adjudicationWeights`）。

| 项目 | 我方 player_b | 对手 player_a | 本局权重 | 事件或配置依据 |
|---|---:|---:|---:|---|
| 对各对手 HQ 造成的伤害 | 0 | 0 | 7 | 全局无 HQ 攻击事件 |
| 己方 HQ 最终 HP | 100 | 100 | 2 | `game_over.payload.scores.ownHqHp` |
| 最终控制据点数 | 2 | 3 | 75 | `control_point_captured` [seq16,49] vs [seq8,25,41] |
| 存活军力价值 | 401 | 242 | 2 | `game_over`；我方 3 新 ranger + 1 heavy 124HP + 1 scout 58HP + 1 ranger 68HP ×2 |
| 剩余补给 | 144 | 254 | 1 | 收入 264 + 起始 80 - 部署 200 = 144；对手 318+80-144=254 |
| `actionScore` | 54 | 40 | 已含权重（effectiveActions 2） | merit 27×2 / 20×2 |
| **总分** | **1350** | **1203** | — | `game_over.payload.scores.total` |

**收支账本（我方 player_b）：**
- 起始补给 80；收入 264（base 10×10 轮 + cp_supply_b 12×9 + cp_fb_b 8×8 = 100+120+64，r1 入账仅 10）。回放未提供逐笔扣减字段，按 income 事件金额累加。
- 部署花费 200：ranger 64（r8 [seq129]）+ ranger 64（r10 [seq157]）+ ranger 72（r10 [seq158]）。前两次走 cp_fb_b 享 -8 折扣（72−8=64）。
- 无拆墙、无治疗；击杀 2（A inf 606332d5 r10 [seq161]、67d12415 为我方损失）。
- 战功 merit 27：deploy 3 + capture 2×2=4 + attack ceil(320/20)=18（逐次 39+39+28+30+30+34+30+33+31+26）。

**收支账本（对手 player_a）：**
- 起始 80；收入 318（base 100 + cp_supply_a 12×9 + cp_fb_a 8×8 + cp_repair_a 8×7 = 100+108+64+56）。
- 部署花费 144：inf 34×3 + inf 42（前哨折扣 34=42−8 三次，供给点 42 一次）。
- 拆墙 3 次（seq38,55,71），治疗 0；击杀 1（我 inf [seq120]）。
- merit 20：deploy 4 + demolish 3 + capture 6 + attack ceil(106/20)=6。

## 失误与改进

1. **r2 三动作纯移动（seq29-31）没有产出任何 merit。** 移动不计 actionScore，那一轮我的 actionScore 只有 0 增长（对比 r3 靠攻击+占点 +6 merit）。更优：r2 scout 继续压到能威胁 A scout 的位置，或让 inf 直接走 3 步占 cp_fb_b（r3 才占 [seq49]，晚一轮少拿 8 收入 + 提前给 A 反应时间）。改进：每轮 AP 至少 1 次攻击/占点/部署，纯移动不超过 2 AP。
2. **r5-r7 连续三轮只输出不击杀，A 靠 cp_repair_a 每轮 +10HP 抵消我的压血。** 我 ranger 三次压 A 步兵到 56/30/26HP [seq95,111,128]，但 A 每轮用维修点回血 + 步兵便宜，压血收益被稀释。更优：r5 起先集火 A 的 repair capturer（inf 5089ef56）或直接换路推 A HQ 拉高 `enemyHqDamage`（权重 7 是本局最高单项，双方都空转）。改进：当对手持有 repair 点时，压血优先选"能杀"的单位，不杀则换目标或走 HQ 压制。
3. **r1 scout 0,-2 走了 5 步纯侦察 [seq13]，却没挡住 A r2 占 cp_fb_a [seq25]。** 花 1 AP 走到空地没换来任何据点或击杀。更优：直接压到 (-1,-1) 一带，威胁 A scout 抢点路线。改进：侦察移动必须落位在"下轮能攻击或能占点"的格子。
4. **r8 失去 inf 后才开始补 ranger [seq129]，晚了一轮。** r7 inf 还有 24HP 时就该意识到它必死（A heavy 2 步可及），提前 r7 部署 ranger 能多打一轮输出。改进：残血单位进入敌方 move+attackRange+1 的死亡判定圈时，同一轮就部署替补。

## 与历史对局对比

引用 `records/V3/tg_0180_lose_OMP@mimo2.6pro.md`（`c8547716` snowflake royale，我 rank 2 败）：那局我因"重装破墙悟晚两拍 + 前两轮 AP 空转在移动/部署探测"被缩圈炮火淘汰；本局同样存在 AP 空转（r2 三动作纯移动、r1 scout 空走），但本局走的是 `turn_limit_score` 裁决而非淘汰战，空转被后续 10 次攻击 + 3 次部署覆盖，最终靠 armyValue 反超。
与 `tg_0180` 的验证点：**AP 预算是恒定短板**——两局都是"移动花太多、产出动作太少"。本局新发现：`turn_limit` 判定下，终局前把现金全转成部署单位（哪怕部署后不能动）比留现金得分高得多（armyValue 权重 2 vs supplies 权重 1），这是 royale（`supplies 0`、`armyValue 5`）之外又一个"现金必须在最后一轮前花光"的验证；同理 `actionScore` 的 deploy merit 让双部署一石二鸟。
另对比 `tg_0178`/`tg_0184`（同作者 ZC@glm5.3flash 胜局）：那些局 HQ 压力是主旋律，而本局 forge 地图中央熔炉墙阻断直通，双方都没打到 HQ——**不是所有 standard 局都要打 HQ**，本局 `enemyHqDamage 7` 权重落空，但据点（75）和 armyValue（2）成为主导项，验证了"权重决定策略优先级"而非固定套路。

## 总结

### 做得好的
1. **ranger 压血路线精确**：r3 [seq46]、r4 [seq63] 两次 39 伤点残 A scout/ranger，中盘双方 DPS 差拉到 320:106 伤害。
2. **残血撤退保 armyValue**：inf 24HP 时撤出火线（seq79）多保 2 轮，为 r10 反超留住基础分。
3. **终局现金转化**：r8+r10 三次部署 200 补给全转 ranger，armyValue 257→401，actionScore 46→54，直接决定 `turn_limit_score` 胜负 [seq129,157,158]。
4. **后手经济守住**：r1 镜像抢 cp_supply_b，收入差锁定在"据点数量"而非"开局劣势"。

### 下次改进
1. **触发条件：己方 capturer HP < 30% 且敌方 heavy 距离 ≤ moveRange+1** → 替代动作：本轮立即部署替补单位（哪怕用掉全部 AP），不要等到下一轮补。预期收益：少丢 42 点 armyValue、少让对手拿 attack merit。
2. **触发条件：对手持有 repair 点且我在压血** → 替代动作：集火能击杀的目标（HP ≤ attack−defense−3）或转 HQ 压制，不做无效压血。预期收益：把 6 次压血攻击中的 3 次转为击杀或 HQ 伤害（每次击杀 +2 merit + 35-90 armyValue）。
3. **触发条件：每轮 AP 计划纯移动 > 2 次** → 替代动作：至少安排 1 次攻击/占点/部署。预期收益：每轮 +1-2 merit，10 轮多 10-20 merit = 20-40 actionScore。

> **核心口诀：先看权重定主攻，现金在裁决前必花光，残血即撤不送分。**

**一句话总结：后手 forge 局靠 ranger 连续点残对手 DPS 建立中盘火力优势，终局前把全部现金换成部署单位将军力价值从 257 拉到 401，以 1350:1203 在 `turn_limit_score` 裁决中反超获胜。**
