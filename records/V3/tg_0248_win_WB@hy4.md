# 战术游戏标准模式复盘 — `player_a` 视角

**日期/游戏ID/回放版本:** 2026-11-05 / `ecb19038-278f-46ac-9fd4-d5c92035bd9b` / `hex-v2-replay` schemaVersion `3.9.4`（回放 `tg_0248_20261105.json`，233 事件，房主导出归档，本文只读）
**地图/参战人数:** `breach`（破障行动，半径 8、217 格：178 平地 / 27 `blocker` / 12 `water`）/ 2 人；**模式:** `standard`
**玩家:** Hy4-WB（WB@hy4，本局 `player_a`）对阵 seed2.1pro0915-TE（回放 `playerNames` 未标注 agent，以席位 `player_b` 记录）
**席位与出生:** `player_a` / `slot_a`，`turnOrder=["player_b","player_a"]`、`firstPlayer=player_b`，**每轮我方后手**；初始单位 scout `d6634e32`@(-6,0)、heavy `514f29c0`@(-7,1)、heavy `a21cdcc7`@(-6,-1)；**HQ(-8,0) 100/100**
**结果:** 🏆 第 1 名 — `last_player_standing`（seq231 `headquarters_destroyed` / seq232 `player_eliminated` / seq233 `game_over`）
**结束轮次:** 第 12/15 整轮（回放有 11 个 `round_end`，R1–R11 走完整轮；`game_over.payload.roundNumber=12`，R12 在我方回合内结束，`maxTurns=15` 未触发）；**HQ 最终 HP:** 我方 **62/100**，对手 **0/100**

> **取证声明:** 以下所有数字、坐标、权重、收入与结论均出自 `tg_0248_20261105.json`（顶层元数据、seq3 `game_start` 配置、seq1–233 全部事件、seq233 `game_over.payload`），未调用 `/api/games/:id/events` 重新拼装，也未凭对局记忆补数。回放 JSON 由房主归档，本文不生成、不改写。**回放未提供中途裁决分快照**，故中盘分差只能定性描述、无法可靠统计，所有分数均取 seq233。
> **房主管理备注:** 事件类型统计中**无** `turn_skipped`、无 `host_eliminated`、无 `player_left`；开局、按序行动与结束均正常，全部得失归因于战术决策。事件类型分布：`move` 75、`attack` 40、`turn_end` 23、`income` 23、`reset_actions` 23、`deploy` 14、`round_end` 11、`control_point_captured` 9、`unit_death` 6、`control_point_repair` 2、`demolish` 1、`headquarters_destroyed` 1、`player_eliminated` 1、`game_over` 1、`game_start` 1、`player_joined` 2。

## 最终排名摘要

| 名次 | 席位 | 玩家 | 状态 | 总分 | 与我方分差 | 决定性优势 |
|---|---|---|---|---:|---:|---|
| **1** | `player_a` | Hy4-WB | active | **1965.66** | — | 6/6 据点（期末 6、流量 3.82）、HQ 伤害 100、军力 411、击杀造价 234、己方 HQ 62 存活 |
| 2 | `player_b` | seed2.1pro0915-TE | **eliminated** | 987.32 | **−978.34** | 击杀造价 248（全场最高）、军力 285；但期末 0 据点、HQ 归零直接淘汰 |

**分差拆解（按 seq233 各项）：** HQ 伤害 500:190（+310）、己方 HQ 124:0（+124）、据点 402.66:103.32（+299.34）、军力 822:570（+252）、击杀 117:124（−7）、补给 0:0（权重 0）＝ **+978.34**。对手在「击杀造价」上反而领先 14（折算 −7 分），说明本局不是靠歼灭赢的，而是**据点流量 + HQ 斩首 + 存活军力**三项叠加。

## 游戏进程时间线

补给列格式：`行动前 → income → 行动后`（部署花费已扣除）；行动点列格式：我方 / 对手，均取该席位回合事件里 `actionsUsed` 的最大值（`actionsPerTurn=5`）。R1 先手 `player_b` 无 `income` 事件（seq9 是 `player_a` 的首次收入），故 B 记为 50→50。

| 整轮/席位回合 | 补给 | 行动点 | 关键操作与坐标 | 结果/局势变化 | 战术意图 |
|---|---|---|---|---|---|
| **R1** B 先手 / A 后手 | A 50→+10→15（seq9 income、seq12 deploy −45）；B 50→50 | A 4/5 · B 3/5 | B scout (6,0)→(4,3) 占 `cp_se`（seq7）；A scout (−6,0)→(−4,−3) 占 `cp_nw`（seq15）、deploy infantry (−7,0) 45、两 heavy 压到 (−3,−1)/(−4,1) | 据点 1:1，双方各拿 20/回合的 supply CP | 后手镜像：不抢中轴，先锁收入最高的据点类型 |
| **R2** B / A | A 15→+30→45；B 50→+30→2（seq23 ranger −78） | A 4/5 · B 4/5 | B scout→(3,0) 占 `cp_e`（seq24）、deploy ranger (3,4)；A scout→(−3,0) 占 `cp_w`（seq32）、4 次移动把 heavy 推到 (−2,−1)/(−2,2) | 据点 2:2；对手先出 44-atk/range3 的 ranger | 补齐三类据点；重装修路但本轮无攻击、无占点产出 |
| **R3** B / A | A 45→+38→5（seq45 ranger −78）；B 2→+38→40 | A 5/5 · B 3/5 | A **seq47 `demolish` (0,−2) `blocker`→`plain`**、deploy ranger (−2,0)、scout→(−4,3) 占 `cp_sw`（seq50）、infantry→(−1,−3)、heavy→(−1,2)；B scout→(4,−3) 占 `cp_ne`（seq40）、heavy→(0,8)、ranger→(1,6) | 据点 3:3；**中央 q=0 列 r=−7..7 全为 blocker，开局唯一天然缺口是 (0,−8)/(0,8)**，本次单格爆破打通 (0,−2) 走廊 | 用 1 次拆除换掉绕南北边缘的漫长路径；对手改走南路绕行 |
| **R4** B / A | A 5→+46→51；B 40→+46→16（seq55 ranger −70，`cp_ne` 折扣 8） | A 5/5 · B 3/5 | A heavy (−1,−2)→(2,−2) + `attack` 敌 ranger 37（seq62）；ranger (−2,0)→(−1,−2) **本轮无对应 attack 事件**；infantry/scout/heavy 调整；B 南路 heavy→(−2,7)、ranger→(0,8)、deploy ranger (3,−2) | 敌 ranger 35hp；我方 1 次激活空转（详见「失误与改进」①） | 破墙后抢第一次接触，优先削脆皮远程 |
| **R5** B / A | A 51→+46→13（seq84 heavy −84，`cp_sw` 折扣 8）；B 16→+46→62 | A 5/5 · B 4/5 | A ranger (1,−3) 打敌 heavy 29（seq80）+ heavy (4,−2) 打 38（seq82）→ **seq83 敌方 ranger 阵亡**；deploy heavy (−3,3)；B 两发把我 heavy 打到 89hp（seq72/73） | killValue 78；对手把残血 ranger 撤到 (4,−1) | 双单位集火保证击杀 72hp/def3 的 ranger（40−3±3 与 44−3±3 叠加 ≥72） |
| **R6** B / A | A 13→+46→59；B 62→+46→8（seq91 ranger −70、seq92 scout −30） | A 5/5 · B 5/5 | A ranger 43（seq102）+ heavy 38（seq103）→ **seq104 敌方第 2 个 ranger 阵亡**；26hp heavy (2,−2)→(7,−2)、scout→(2,0)；B 补 ranger (3,−2)/scout (3,−3)，把我南路 heavy 打到 120hp（seq98） | killValue 156；但我 26hp heavy 孤悬敌后，成为下一轮诱饵 | 继续拔远程；用残血单位换取对手兵力东移 |
| **R7** B / A | A 59→+46→105；B 8→+46→54 | A 5/5 · B 5/5 | B 把北路 3 单位全东撤追击（scout→(8,−3)、scout→(7,−3)、heavy→(6,−2)），seq120 击杀我 heavy (7,−2)，seq112 `control_point_repair cp_e` +10；**A scout→(3,0) 翻 `cp_e`（seq134）**、ranger/infantry 压到 (3,−3)/(2,−3) | **据点 4:2**，我方首次翻敌方点；损失 heavy 92 造价 | 放弃北路硬推，改吃「对手调兵留出的中路真空」 |
| **R8** B / A | A 105→+54→36（seq153 ranger −78、seq155 infantry −45，均 from `cp_e`）；B 54→+38→22（seq139 ranger −70） | A 5/5 · B 5/5 | B seq145 击杀我 ranger (3,−3)、把我另一 heavy 打到 5hp；A **从刚翻的 `cp_e` 连出 2 个单位** (4,0)/(3,1)、scout→(4,3) 翻 `cp_se`（seq160）、seq154 打残敌 ranger 38、seq157/159 打敌南路 heavy 27+30 | **据点 5:1**；我方损失 ranger 78 造价 | 把敌方据点变成**前线部署原点**，增援不再从 HQ 长途行军 |
| **R9** B / A | A 36→+74→18（seq176 heavy −92 from `cp_e`）；B 22→+18→40 | A 5/5 · B 5/5 | B seq168 击杀我 ranger (4,0)；A heavy (3,−1) 收掉 34hp 敌 ranger（seq177→**seq178 第 3 个敌方 ranger 阵亡**）、**infantry→(4,−3) 翻 `cp_ne`（seq185）**、infantry (3,1)→(3,0) 守 `cp_e`、两 heavy 退守 (−4,3)/(−3,0) | **据点 6:0 全占**；收入 74→82 vs 18→10；killValue 234 | 经济锁死，转入「每个 CP 有驻军」的稳守 |
| **R10** B / A | A 18→+82→8（seq199 heavy −92 from `cp_se`）；B 40→+10→5（seq192 infantry −45 from HQ） | A **2/5** · B 5/5 | A deploy heavy (5,2)、seq197 `control_point_repair cp_w` +10（把 5hp heavy 修到 15）、残血 heavy (−3,0)→(−4,−1)；B 南路 heavy→(−7,6)、ranger→(−6,7)、deploy infantry (7,0) 守自家 HQ | 6 CP 全部保留；我方 3 AP 闲置 | 领先后的保守保分；对手把剩余兵力压向我 HQ 与自家门口 |
| **R11** B / A | A 8→+82→12（seq215 ranger −78 from `cp_se`）；B 5→+10→15 | A 3/5 · B 4/5 | **A heavy (5,2)→(7,1) + `attack` 敌 HQ 40（seq214）；deploy ranger (5,3) + `attack` 41（seq216）**；残血 heavy→(−4,−3) 守 `cp_nw`；B 南路 heavy→(−8,4)、ranger→(−8,7) | **敌 HQ 100→19**，形成「下一轮必杀」 | 放弃拖到 15 轮裁决，直接斩首；ranger 3 格射程无 LOS，可隔石墙点 HQ |
| **R12** B / A | A 12→+82→94；B 15→+10→25 | A **1/5** · B 4/5 | B heavy (−8,4)→(−8,1) `attack` 我 HQ 38（seq223）、再打我 heavy 25+17（seq225/226）；**A heavy (7,1) `attack` 敌 HQ，damage 42 / `actualDamage` 19（seq230）** → seq231 HQ 摧毁 → seq232 `player_eliminated`(`eliminatedBy=player_a`) → seq233 `game_over` | `last_player_standing`；我方 HQ 62/100 存活，6 CP 保持到终局 | 一击终结，避免己方 HQ 被南路两单位继续消耗 |

**HQ 伤害取证细节：** 我方 3 次 `attack`（seq214/216/230）的 `damage` 字段合计 **123**，但最后一击 `actualDamage=19`（HQ 仅剩 19hp），故 seq233 记 `headquartersDamage=100`；对手唯一一次 HQ 攻击是 seq223 的 38，对应我方 `ownHqHp=62` 与对手 `headquartersDamage=38`。

## 核心策略与关键转折

**五个策略**

1. **后手镜像占点、按 income 排序**：`controlPointTypes` 里 supply=20、repair=8、forward_base=8（且 `deployDiscount=8`）。R1 先拿 `cp_nw`(20)，R2 `cp_w`(8)，R3 `cp_sw`(8)；对手完全对称地拿 `cp_se`/`cp_e`/`cp_ne`。三轮内双方收入同为 46/回合，谁都没亏在起跑线。
2. **单点爆破换通道**：`q=0` 整列 r=−7..7 共 15 格全是 `blocker`，唯一天然缺口 (0,−8)/(0,8) 在地图最外缘。R3 seq47 用 1 次 `demolish` 打通 (0,−2)（`blocker`→`plain`），此后从 (−6,0) 到 (3,0) 的通路从绕外缘变成穿中轴；这也是全场**唯一一次** `demolish`。注意通道对双方开放，所以真正的收益不在「打开」，而在「谁先把兵力摆到出口」。
3. **两单位集火拔除 72hp 远程**：ranger `hp=72 / defense=3`，heavy 40−3±3＝34..40、ranger 44−3±3＝38..44，两发下限合计 72 恰好保证击杀。R5（seq80+82→seq83）、R6（seq102+103→seq104）各执行一次，R9 seq177 补掉 34hp 残血 ranger（seq178）。三个 ranger 共 234 造价全部记入我方 `killValue`。
4. **占领敌方 CP 当部署原点**：`fromId` 可以是己方 HQ 或**任意己方 CP**。R8 起我从 `cp_e`、`cp_se` 连出 ranger(4,0)、infantry(3,1)、heavy(3,−1)、heavy(5,2)、ranger(5,3) 共 5 个单位，落点距敌方 HQ 仅 3–6 格，省掉整段穿越中央的行军。
5. **终局不拖裁决、直接斩首**：R11 判定 `enemyHqDamage=5`（每点 HQ 伤害 5 分，满 100 点＝500 分）且 HQ 归零直接 `player_eliminated`，于是在能站上 HQ 相邻格的第一时间连开三枪，而不是把 6 CP 稳稳拖到第 15 轮。

**五个转折**

- **T1（R3, seq47）** 中央通道打开，双方都获得快速跨境能力；北路从此成为主战场。
- **T2（R5–R6, seq83/seq104）** 连续两次双单位集火拔掉对手两个 ranger，我方 `killValue` 拉到 156；但代价是对手把北路单位全部东撤去追我 26hp 的诱饵 heavy（R6→R7）。
- **T3（R7–R9, seq134/160/185）** 对手追击造成的中路真空被连续兑现：`cp_e`→`cp_se`→`cp_ne` 三连翻，据点 3:3 变成 **6:0**，收入 46/46 变成 82/10（seq196/211/228 vs seq188/203/220）。这是全局最不可逆的一次转折。
- **T4（R8–R9, seq145/168/120）** 对手的反扑打掉我 3 个单位（1 heavy + 2 ranger，共 248 造价），`killValue` 反被对手以 248:234 超出；但我用「翻点 + 前线部署」把损失立刻换成据点与军力，没有被拖回均势。回放未提供中途裁决分快照，此处的分差变化无法可靠统计。
- **T5（R11, seq214/216）** 两发 HQ 把 100 打到 19。对手在 R12 只剩一轮反应，且必须同时处理我 (7,1) 的 heavy 与 (5,3) 的 ranger——它选择了继续打我 HQ（seq223，38 伤害），无法阻止 seq230 的补刀。

## HQ、据点与行动点分析

**对 `player_b` 的交战账**

| 项目 | 我方（`player_a`） | 对手（`player_b`） | 事件依据 |
|---|---:|---:|---|
| 对敌 HQ 攻击次数 / 有效伤害 | 3 次 / **100** | 1 次 / **38** | seq214/216/230；seq223 |
| 己方 HQ 最终 HP | 62/100 | **0/100** | seq233 scores、seq231 |
| 击杀敌方单位 | 3 个 ranger＝**234** 造价 | 1 heavy + 2 ranger＝**248** 造价 | seq83/104/178；seq120/145/168 |
| 夺取据点 | 6 个（其中翻敌方点 3 个） | 3 个（全在 R1–R3） | seq15/32/50/134/160/185；seq7/24/40 |
| 期末控制 / 流量持有 | 6 / 3.82 | 0 / 1.64 | seq233 |
| 部署次数 / 花费 | 8 次 / 592 | 6 次 / 363 | 14 个 `deploy` 事件 |

**HQ 进攻窗口与守家路线：** 回放 `map.cells` 显示敌方 HQ(8,0) 只有 3 个可站相邻格 `(8,−1)/(7,0)/(7,1)`（另 3 个邻居不在 `cells` 内），我方 HQ(−8,0) 同样只有 `(−7,0)/(−7,−1)/(−8,1)`。R11 我占住 `(7,1)`，并用 `attackRange=3` 的 ranger 从 `(5,3)` 隔墙开火（本模式攻击只判六角距离、不判视线），两个攻击点互不依赖、对手无法用单发同时清除。对手南路绕行 `(-5,6)→(-4,5)→(-7,6)→(-8,4)→(-8,1)`（seq148 R8、seq190 R10、seq205 R11、seq222 R12 的 `move`），seq223 R12 才第一次打到 HQ，比我的斩首慢了整整一轮。若我在 R11 就被淘汰，seq223 的 38 伤害只是第一发——`ownHqHp` 权重 2，保住 62 HP 相当于保住 124 分。

**据点收益是否覆盖成本（必答 Q2）：** 占领动作本身由初始 scout 的 `move` 顺带完成（`canCapture=true`，站在点上即生效、无需额外 AP 或花费），因此「占领成本」近似 0。收益侧：我方 `income` 共 636，其中 base 10×12＝120、据点 control 合计 **516**；据点还带来 `cp_sw` 一次 `deployDiscount=8`（seq84）与 `cp_w` 一次 `control_point_repair +10`（seq197，把 5hp heavy 修到 15hp）。对手因为 R7 起连丢三点，`income` 只有 338（control 218），R10–R12 更是只剩 base 10（seq188/203/220）。**结论：收入、折扣、维修三项都远超占领成本，真正的成本是「守住驻军」——R8–R9 我为护点损失了 2 个 ranger。**

**行动点（必答 Q3）：** `actionsPerTurn=5`，同一单位首次激活扣 1 AP、之后合法的后续动作免费（seq213 移动 + seq214 攻击同记 `actionsUsed=1` 即为证据）。按各席位回合 `actionsUsed` 峰值统计，我方 12 轮共激活 **49/60**，对手 **50/60**。空转与冗余：
- R4 ranger `(−2,0)→(−1,−2)` 后回放中无对应 `attack` 事件，1 次激活无产出（该回合 5/5 AP 只换来 1 次攻击 seq62）。
- R2 我方 4 次移动里有 3 次是重装 reposition，本轮 `attack`/`control_point_captured` 只各 1 次。
- R10–R12 只用了 2/3/1 AP：R12 的 1 AP 是终结一击，合理；但 **R10 有 3 AP 与即将到账的 82 补给未用**，当时已 6:0，本可提前一轮完成斩首部署（见「失误与改进」③）。

**先手与目标优先级（必答 Q4）：** 对手每轮先动，R1 先占 `cp_se`、R2 先出 ranger、R5–R9 每轮都能先集火我突前单位（seq72/73、93–98、115–124、140–149、165–172 全是对手 `attack`）。这直接导致我放弃「北路硬推」——R6 那辆 89hp heavy 深入 (7,−2) 后 R7 即被 3 发击杀（seq115/117/119）。此后优先级改为：① 用对手调兵空档翻点 → ② 把翻来的 CP 当部署原点 → ③ 不再追求歼灭，改为在对手下一轮之前把 HQ 打空。R11 留 19hp 而非冒进补刀，正是因为知道 R12 对手先手也来不及同时清掉我两个攻击点。

**胜负点与不可逆压力（必答 Q1）：** 表面胜负点是敌方 HQ(8,0)，但真正让它无解的是 **R9 的 6:0 据点**（seq185）：从 seq196 起我方每轮 `income=82`、对手 `=10`，我方 R8–R11 连出 5 个前线单位，对手只出得起 1 个 infantry（seq192）。不可逆压力分两段形成——R9 形成经济与增援的不可逆，R11 seq214/216 形成 HQ 血线的不可逆（19hp，任何一发 heavy 或 ranger 都能收掉）。第 3 轮那次 `demolish` 只是让这两段提前到来的催化剂。

**若打到轮数上限（必答 Q5）：** 本局 12/15 轮结束，未触发 `turn_limit_score`。若未斩首，裁决分领先项为据点 402.66、HQ 伤害 500、军力 822；可量化的补分动作有两个：① 每多持 6 CP 一整轮，`controlHold` 增加 6/15＝0.4，折算 `0.4×0.7×90＝+25.2` 分/轮；② `supplies` 权重为 **0**，期末 94 补给一分不值，转成单位可再得 `2×cost`（例：92 的 heavy＝+184）。反过来，我方 HQ 62 若被继续打空，会同时丢掉 124 分并被淘汰——这正是 R11 选择斩首而非拖判定的原因。

## 补给与裁决分账本

**权重来源：** seq3 `config.balance.adjudicationWeights` = `enemyHqDamage 5 / ownHqHp 2 / controlPoint 90 / armyValue 2 / supplies 0 / killValue 0.5`；config **未列出** `controlPointFlowRatio`，按 play skill 默认 0.7 代入，并用 seq233 总分反算验证完全吻合（见下表），故可确认本局采用 0.7。

| 项目 | 我方数量/数值 | 本局权重 | 得分 | 事件或配置依据 |
|---|---:|---:|---:|---|
| 对各对手 HQ 造成的伤害 | 100（3 次 attack，原始 123、`actualDamage` 截断至 100） | `enemyHqDamage` 5 | **500** | seq214/216/230 `attack` |
| 己方 HQ 最终 HP | 62 / 100 | `ownHqHp` 2 | **124** | seq223、seq233 |
| 据点流量持有（均值） | `controlHold` 3.82 | `controlPoint×flowRatio` = 90×0.7＝63 | **240.66** | 9 次 `control_point_captured` + 11 次 `round_end` |
| 期末控制据点数 | 6 | `controlPoint×(1−flowRatio)` = 90×0.3＝27 | **162** | seq15/32/50/134/160/185 |
| 存活军力价值 | 411 | `armyValue` 2 | **822** | seq233 / 存活单位 `cost×hp/maxHp` |
| 剩余补给 | 94 | `supplies` **0** | **0** | 12 次 `income` 与 8 次 `deploy` |
| 击杀造价（`killValue`） | 234（3×78 ranger） | `killValue` 0.5 | **117** | seq83/104/178 `unit_death` |
| **总分** | — | — | **1965.66** | seq233（计算值 1965.66 ✓） |

对手同法核算：`38×5 + 0×2 + (1.64×0.7 + 0×0.3)×90 + 285×2 + 25×0 + 248×0.5 = 190 + 0 + 103.32 + 570 + 0 + 124 = 987.32`，与 seq233 的 987.32 一致。**注意 HQ 归零触发 `player_eliminated`/`last_player_standing`，胜负不由总分高低决定**（历史对照局里就有总分落后仍获胜的案例）。

**收支账本（全部来自 `income` 与 `deploy` 事件，闭合到 seq233）：**

| 项目 | 我方 `player_a` | 对手 `player_b` |
|---|---:|---:|
| 起始补给 | 50 | 50 |
| 基础收入（base 10 × 12 轮） | +120 | +120 |
| 据点收入（control 合计） | **+516** | +218 |
| 收入合计 | **+636** | **+338** |
| 部署次数 / 总花费 | 8 次 / **−592** | 6 次 / −363 |
| 其中 `forward_base` 折扣（`deployDiscount=8`） | **1 次，省 8** | **4 次，省 32** |
| 期末补给（50 + 收入 − 花费） | **94** ✓ | **25** ✓ |
| 维修站回血 | 1 次 +10（`cp_w`，seq197） | 1 次 +10（`cp_e`，seq112） |

我方 8 次部署：infantry 45（seq12, from HQ）、ranger 78（seq45, `cp_w`）、heavy 84（seq84, `cp_sw` 折扣 8）、ranger 78（seq153, `cp_e`）、infantry 45（seq155, `cp_e`）、heavy 92（seq176, `cp_e`）、heavy 92（seq199, `cp_se`）、ranger 78（seq215, `cp_se`）。对手 6 次：ranger 78（seq23, `cp_se`）、ranger 70（seq55, `cp_ne`）、ranger 70（seq91）、scout 30（seq92）、ranger 70（seq139）、infantry 45（seq192, HQ）。**无效花费：回放不记录失败或被拒绝的请求，无法可靠统计**；但可确认所有 `deploy` 事件都生成了单位，且 `supplies` 权重 0 意味着期末 94 补给对裁决分零贡献。

## 失误与改进

第一名仍需记录可量化的低效与风险，本局 4 条：

1. ❌ **R4 六角距离误判，1 次激活空转。** ranger 从 (−2,0) 移到 (−1,−2) 后想打敌 heavy (2,−1)：`dq=3, dr=1, ds=−4`，距离 `max(3,1,4)=4 > attackRange 3`。回放 R4 我方 5/5 AP 却只有 1 次 `attack`（seq62），该 ranger 本轮零产出；被拒绝的请求不写进回放，故失败细节只能定性描述。**正确做法：** 动手前按 `max(|dq|,|dr|,|ds|)` 算距离（注意 `s=−q−r` 的 `ds` 往往是最大项），确认 `≤ attackRange` 再移动；否则让 ranger 留在 (−2,0) 待命，把 AP 给能打到的 heavy。**触发条件：** 单位移动后才检查射程。
2. ❌ **R8–R9 连送 2 个 72hp/def3 ranger（seq145、seq168），重复了上一局已总结过的错误。** 156 造价记给对手 `killValue`（+78 分）、我方 `armyValue` 少 156（−312 分），净 swing 约 390 分；对手 R8/R9 的 `attack`（seq140/142/144、165/167）显示 ranger 是被「先移动进入射程再开火」集火秒掉的。`tg_0246_win_WB@hy4.md` 已明确写过「脆皮远程的暴露判定必须用敌方 `moveRange + attackRange` 而非当前距离」，本局未落实。**正确做法：** 部署 ranger 前先算对手 ranger(2+3=5 格) 与 heavy(3+1=4 格) 的威胁圈；脆皮单位不要停在敌方可一回合进入的 5 格内，或部署当回合就用 `deploy+attack=1 AP` 把威胁打掉再撤。**触发条件：** 敌方存活至少一个 range-3 单位，且我方 ranger 落点在其 5 格威胁圈内。
3. ⚠️ **R10 只用 2/5 AP，比分斩首晚了一轮。** R10 结束时我已 6 CP、94 补给即将到账（seq211 +82），却只部署 heavy (5,2) 与挪动残血单位，没把 (5,2) 的 heavy 前推到 (7,1)，也没提前部署 (5,3) 的 ranger——这两步分别在 R11 seq213/seq215 才做。**可量化代价：** 若 R10 完成这两步，R11 即可打出第三发终结（等价于把 seq230 提前一轮），对手 R12 的 seq223 就不会发生，我方 `ownHqHp` 可从 62 保到 100，多 38×2＝**76 分**，且少承受一次被反斩首的窗口。**正确做法：** 当「己方已有单位处于敌方 HQ 3 格内 + 补给足以再出一个 range-3 单位」时，当轮就把斩首组件凑齐，不要留到下一轮。**触发条件：** 领先且 HQ 攻击窗口已打开。
4. ⚠️ **折扣利用率 1/8，对手 4/6。** `forward_base` 的 `deployDiscount=8`，我方 8 次部署只有 seq84 一次从 `cp_sw` 出货（省 8），对手 6 次里有 4 次从 `cp_ne` 出货（seq55/91/92/139，共省 32）。虽然前线 CP（`cp_e`/`cp_se`）的落点价值高于 8 补给，但 R9–R10 那些不需要立刻贴脸的增援本可从 `cp_sw` 出。**可量化：** 若把 2 次非紧急部署改到 `cp_sw`，可多发 16 补给，接近一个 scout 的一半。**正确做法：** 按「是否需要前线落点」分流部署原点——需要即时参战用 `cp_e`/`cp_se`，纯补军力用有折扣的 `cp_sw`。

## 与历史对局对比

对照局均取自 `records/V3/` 本地回放（下表「总分」在旧版本含 `actionScore`、`supplies` 权重与本局不同，**仅作定性对照，不逐项比分数**）。本局同作者同模型的上一份复盘是 `tg_0246_win_WB@hy4.md`。

| 回放 / 复盘 | 模式·地图·人数·出生 | HQ 伤害（胜者） | 期末据点 | 结束轮次 / 原因 | 总分 | 与本局关系 |
|---|---|---:|---|---|---:|---|
| **本局 `tg_0248_20261105.json`** | standard·`breach`·2 人·`player_a` 后手 | **100** | **6 : 0** | R12 / `last_player_standing` | **1965.66 : 987.32** | — |
| `tg_0246_20261105.json` / `tg_0246_win_WB@hy4.md` | annihilation·`trench-run`·2 人·`player_b` 先手（同为 WB@hy4） | 无 HQ 机制 | 3 : 3 | R16 / `last_player_standing`（`army_destroyed`） | 393.5 : 170.5 | **验证 + 重复**：验证了「`supplies` 权重 0 时把收入换成军力」（本局 592/636＝93.1% 转化率，不像该局冻结 116 补给）；但重复了它已点名的「脆皮 ranger 暴露」错误 |
| `tg_0071_20260804.json` | standard·`breach`·2 人·`player_b` 先手 | 100（胜者 `player_a`） | **1 : 5**（胜者据点落后） | `last_player_standing`（未记 roundNumber） | 1560 : 1708（**胜者总分更低**） | 印证 HQ 归零优先于裁决分；本局则是「据点 + 斩首」双保险 |
| `tg_0087_20260811.json` | standard·`breach`·2 人·`player_b` 先手 | 100（胜者 `player_a`） | 4 : 2 | `last_player_standing` | 2230 : 1084 | 同地图「占点优势 + 斩首」的早期范例，本局把据点差推到 6:0 |
| `tg_0194_20261004.json` | standard·`breach`·2 人·`player_a` 先手 | 100（胜者 `player_b`，自己 HQ 仅 22） | 3 : 3 | **R9** / `last_player_standing` | 1626 : 1760（胜者总分更低） | 说明据点平分时「谁先斩首谁赢」；本局对手 R12 才摸到 HQ，慢一轮 |
| `tg_0093_20260814.json` | standard·`breach`·2 人·`player_a` 先手（Hy3-WB） | 0 : 0 | 4 : 2（胜者据点落后） | 15 个 `round_end` / `turn_limit_score`（`game_over` 未记 roundNumber） | 1533 : 1940 | **反例：据点领先但囤 607 补给、军力仅 153，打满轮数反而输给军力 712 的一方** |

**新发现（这批 `breach` 对照中本局独有）：** ① 唯一把 6 个据点全部翻到同一方名下的对局（其余对照最多 5:1 或 4:2）；② 唯一系统性地把「刚翻过来的敌方 CP」当部署原点连续出兵（R8 起 5 次），使增援落点距敌 HQ 只有 3–6 格；③ 唯一用 `attackRange=3` 的 ranger 从 `(5,3)` 隔石墙参与 HQ 斩首（seq216，41 伤害，无需视线、也无需站到 HQ 相邻格）。历史局多靠重装贴脸破 HQ，本局证明「贴脸 heavy + 隔墙 ranger」的双点组合能让对手无法用一次集火解除斩首威胁。

**经验定位：** 对 `tg_0246` 是「**验证了补给转军力、重复了脆皮远程站位错误**」；对 `tg_0093` 是「**修正了据点领先就囤钱等裁决的旧打法**」；对 `tg_0071`/`tg_0194` 是「**重复并强化了 HQ 归零优先于总分的原则**」。

## 总结

### 做得好的
1. **R3 一次 `demolish` (0,−2) 打通中轴**（seq47），并且没有在破墙后立刻把主力塞进对手先手能打的走廊里，而是 R3–R6 先集火拔掉对方两个 ranger（seq83/104），把通道价值兑现成击杀而非送人头。
2. **R7–R9 抓住对手东撤追击的空档三连翻点**（seq134/160/185），把 3:3 变成 6:0；收入从 46/46 拉到 82/10（seq196/211/228 vs seq188/203/220），此后 8 次部署里有 5 次直接从 `cp_e`/`cp_se` 出兵。
3. **终局止损果断**：R11 用 heavy+ranger 两发把 HQ 打到 19（seq214/216），R12 一发 `actualDamage=19` 直接结束（seq230），没给对手南路 heavy/ranger 第二轮打我 HQ 的机会（对手 seq223 只来得及打出 38）。

### 下次改进
1. **任何移动前先算 `max(|dq|,|dr|,|ds|)` 再决定是否激活**（R4 空转 1 AP）；触发条件是「打算移动后才攻击」。
2. **脆皮远程落点必须按敌方 `moveRange + attackRange` 判定**（R8/R9 损失 156 造价、约 390 分 swing）；触发条件是敌方仍有 range-3 单位。
3. **斩首组件要在同一轮凑齐**（R10 闲置 3 AP 导致晚一轮、多挨 38 HQ 伤害＝少 76 分）；触发条件是己方已有单位进入敌 HQ 3 格内且补给足够再出一个远程。
4. **按「是否急需前线落点」分流部署原点**，把 `forward_base` 的 8 折扣用在非紧急增援上（本局 1/8，对手 4/6）。

> **核心口诀：破墙只是买通道，翻点才是买收入；把翻来的据点当兵站，趁对手来不及回防时用「贴脸重装 + 隔墙游骑兵」一次打空 HQ。**

**一句话总结：后手开局先镜像占满据点、一次爆破开中轴，靠对手调兵空档把 6 个据点全翻过来锁死经济，再从敌方据点直接出兵，用三发 HQ 攻击在第 12 轮斩首取胜。**
