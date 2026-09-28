# 战术游戏标准模式复盘 — `player_a` 视角

**日期/游戏ID/回放版本:** 2026-09-27 / `4abd6e31-4670-4905-be30-f3126098437c` / `3.5.6`（schema 3.5.6，回放 `tg_0173_20260927.json`，导出于 2026-09-27T13:27:01Z）
**地图/参战人数:** `breach`（破障行动）/ 2 人
**玩家:** mimo2.6pro-PI（PI@mimo2.6pro）——我方；Dsv4.1Flash0910-WB（WB@Dsv4.1Flash0910）——对手
**席位与出生:** `player_a`，行动顺序第 1，HQ(-8,0) 100/100；对手 `player_b` 第 2，HQ(8,0) 100/100
**结果:** 💀第2名（败）— `turn_limit_score`（第 15 整轮裁决，非淘汰）
**结束轮次:** 第 15/15 整轮（`round_end` seq 211）；**HQ最终HP:** 100/100（双方均未受 HQ 伤害）

初始兵力（对称）：双方各 1 scout + 2 heavy，初始补给 50（`game_start` seq 3）。行动点 `actionsPerTurn: 5`，`maxTurns: 15`。地图中央为 blocker 十字墙（重装可 `demolish` 开路），六个据点两两原点对称：`cp_nw`(supply, -4,-3) / `cp_se`(supply, 4,3)、`cp_w`(repair, -3,0) / `cp_e`(repair, 3,0)、`cp_sw`(forward_base, -4,3) / `cp_ne`(forward_base, 4,-3)。据点效果（`config.balance.controlPointTypes`）：supply 收入 20、repair 收入 8 + 维修 10、forward_base 收入 8 + 部署折扣 8。

## 最终排名摘要

| 名次 | 席位 | 玩家 | 状态 | 总分 | 与我方分差 | 决定性优势 |
|---|---|---|---|---:|---:|---|
| 1 | player_b | Dsv4.1Flash0910-WB | active | 2612 | +1279 | 4 据点（360 分权重）+ 军力价值 982 vs 495 + actionScore 86 vs 32 |
| 2 | player_a | mimo2.6pro-PI | active | 1333 | — | 仅 cp_nw 一据点，无 HQ 伤害 |

## 游戏进程时间线

（补给 = 该席位该回合 `income` 事件前的余额；行动点 = `actionsUsed/5`；事件后括注 `seq`）

| 整轮/席位回合 | 补给 | 行动点 | 关键操作与坐标 | 结果/局势变化 | 战术意图 |
|---|---:|---|---|---|---|
| R1 `player_a` | 50 | 3/5 | scout(-6,0)→(-5,1)；heavy(-7,1)→(-5,2)；heavy(-6,-1)→(-5,-1)（seq 4/6/5） | 3 次纯移动（0 merit），scout 未踏上 `cp_nw` | 向中央墙两侧展开，未计 cp 距离 |
| R1 `player_b` | 50 | 4/5 | deploy 步兵 HQ(8,0)→(7,0)（45，seq 13）；scout(6,0)→(4,3) 占 `cp_se`（seq 14）；2 heavy 推进 | **cp_se 归 B**，首占点 +2 merit | 步兵留家攒钱，scout 直奔最近 supply 点 |
| R2 `player_a` | 50 | 3/5 | deploy 步兵 HQ→(-7,0)（45，seq 19）；heavy→(-4,3) 踏 `cp_sw` 空占位；scout→(-4,-3)（seq 23） | **cp_nw 归 A**；B 步兵(7,0)未移动——scout 占点是安全的 | 北路抢 supply 对冲 |
| R2 `player_b` | 30 | 4/5 | scout 占 `cp_e`(3,0)（seq 31）；从 cp_e 部署步兵(2,1)（45，seq 44） | **cp_e 归 B**，收入 20→28 | 中路据点连片，前压部署 |
| R3 `player_a` | 30 | 2/5 | deploy 步兵 HQ→(-8,1)（45，seq 36）；heavy→(-5,-2) | 扩军但无占点 | 为北线补占位人力 |
| R3 `player_b` | 38 | 3/5 | scout 占 `cp_ne`(4,-3)（seq 46） | **cp_ne 归 B（3 点）**，收入 38→46 | 三据点领先成型 |
| R4 `player_a` | 30 | 2/5 | heavy 试图向中路推进被墙阻挡 | 空转 | 找攻击通道 |
| R4 `player_b` | 46 | 2/5 | 从 cp_e 部署 ranger(2,1)（78，seq 59） | B 出第一把长手 DPS | 用经济优势换军力 |
| R5 `player_a` | 30 | 3/5 | deploy scout HQ→(-7,0)（38，seq 66）；units 重新集结 | 仍无占点/无攻击 | 攒兵 |
| R5 `player_b` | 46 | 2/5 | 从 cp_ne 部署步兵(3,-3)（37，折扣 8，seq 71） | forward_base 折扣兑现 | 持续滚军力 |
| R6 `player_a` | 30 | 3/5 | deploy scout HQ→(-8,1)（38，seq 78） | 补充机动兵力 | 想偷 cp_sw |
| R6 `player_b` | 46 | 2/5 | 从 cp_e 部署 support(2,1)（60，seq 85） | B 补回复 | 持久战配置 |
| R7–R8 `player_a` | 30/30 | 3/5 | deploy 步兵 cp_nw→(-5,-2)（45，seq 101）；单位向墙口挤 | 通道拥塞，多次移动被拒 | 强行找突破口 |
| R7–R8 `player_b` | 46/46 | 3/5 | 从 cp_ne 连续部署步兵(4,-2)/(3,-2)（37×2，seq 96/106） | 兵力雪球 | 前线基地持续产兵 |
| R9 `player_a` | 30 | 2/5 | deploy 步兵 HQ→(-7,0)（45，seq 112） | 守家 | 无新计划 |
| R9 `player_b` | 46 | 3/5 | **heavy `demolish` (0,3)** 墙开缺口（seq 117）；deploy 步兵(5,-3)（37，seq 119） | 南翼通道打开 | 为 cp_sw 进攻铺路 |
| R10 `player_a` | 30 | 2/5 | deploy scout cp_nw→(-5,-2)（38，seq 125） | 无占点 | 打算绕南 |
| R10 `player_b` | 46 | 2/5 | deploy ranger(4,-4)（70，折扣 8，seq 131） | 双 ranger | 长手火力网 |
| R11 `player_a` | 30 | 2/5 | **全局第一击**：heavy 攻 B 步兵(2,3) 34 伤（seq 137），步兵残 66 | 首次有效攻击 | 想收掉入侵者 |
| R11 `player_b` | 46 | 3/5 | deploy 步兵(5,-4)（37，seq 144）；**残血步兵(66hp) 占 `cp_sw`(-4,3)**（seq 145） | **cp_sw 归 B（4 点）** | 弃守残兵抢第 4 点 |
| R12 `player_a` | 30 | 2/5 | scout 攻 B 步兵 5 伤（seq 151）；deploy 步兵 HQ→(-7,-1)（45，seq 152） | 攻击零星 | 尝试围杀入侵者 |
| R12 `player_b` | 54 | 3/5 | 从 cp_sw 部署步兵(-4,2)（37，seq 157）；B 步兵反打我 scout 23 伤（seq 158） | cp_sw 变前压基地 | 南线压制 |
| R13 `player_a` | 30 | 2/5 | deploy 步兵 cp_nw→(-5,-3)（45，seq 164）；scout 攻 B 步兵 9 伤（seq 166） | 无进展 | 围攻入侵步兵 |
| R13 `player_b` | 54 | 3/5 | B 步兵再打 scout 25 伤（seq 170）；deploy 步兵(4,2)+scout(3,1)（45+38，seq 171/172） | 我 scout 残 17 | 优势滚雪球 |
| R14 `player_a` | 30 | 1/5 | 仅 1 次纯移动（seq 177，无 deploy/attack），另有 4 个失败 API 尝试（非法移动/部署范围） | 严重空转 | 找不到合法攻击路径 |
| R14 `player_b` | 54 | 5/5 | 攻击杀我 scout(-3,2)（seq 181/182）；ranger 打我 scout 42 伤（seq 184）；**heavy `demolish` (0,-2)** 北墙缺口（seq 185）；ranger 打 heavy 28 伤（seq 188） | 我 2 单位致残/阵亡 | 双向开墙全线进攻 |
| R15 `player_a` | 30 | 5/5 | deploy 步兵 cp_nw→(-5,-2)（45，seq 193）+ 4 次纯移动（seq 194–197） | 军力价值计入裁决但无 merit | 最后换分 |
| R15 `player_b` | 54 | 5/5 | deploy ranger cp_sw→(-5,3)（70，seq 201）立即打 scout 38 伤；deploy 步兵(-5,4)（37，seq 203）；ranger 移动攻击 heavy 28 伤（seq 204/205）；ranger 打 heavy 34 伤（seq 206）；步兵杀我 scout(-5,0)（seq 208/209） | 一轮 5 次激活全部有效 | 满额 merit 收官 |

（R15 我方：deploy 步兵 + 4 次纯移动（seq 193–197），无 merit 动作。）

## 核心策略与关键转折

**我方策略（3 条）**
1. **镜像抢点**：R2 用 scout 抢 `cp_nw`，与对手 `cp_se` 对冲——方向正确，但只抢到 1 点就停止扩张。
2. **重装卡墙口 + 绕南偷点**：R6–R13 试图用 scout 渗透 `cp_sw`（R12 起 scout 深入 (-3,2)/(-3,3)），并让双 heavy 顶住中墙。
3. **后期换分**：R13–R15 在无望占点后转为部署+攻击攒 actionScore，尽量缩小裁决差距。

**对手策略（3 条）**
1. **步兵守家攒经济、scout 链式占点**：R1–R3 用 scout 连占 `cp_se`→`cp_e`→`cp_ne`，3 轮形成 46/回合 vs 我 30/回合的收入剪刀差。
2. **forward_base 当兵营**：R5 起从 `cp_ne`/`cp_sw` 共 9 次折扣部署（seq 71/96/106/119/131/144/157/201/203，每个省 8 补给），持续滚军力。
3. **重装开墙双向突破**：R9 `demolish` (0,3) 开南墙、R14 `demolish` (0,-2) 开北墙（seq 117/185），把中央墙从"屏障"变成"通道"。

**关键转折（3 个）**
1. **R1 scout 路线选择（决定性）**：我 scout 起始 (-6,0) 到 `cp_nw`(-4,-3) 的 hex 距离只有 3（≤ moveRange 5，可一步直达），但我把 R1 移动给了 (-5,1)（朝墙方向，离 cp 反而 4 格），占点推迟到 R2（seq 23）；对手 scout 起始 (6,0) 到 `cp_se`(4,3) 距离同为 3，R1 就一步踏上并在回合末完成占领（seq 10/14）。同一距离，对手 R1 拿到占点 +2 merit，我 R2 才拿到。
2. **R9–R11 南翼失守**：对手 demolish (0,3) 开墙后残血步兵（66hp）于 R11 强占 `cp_sw`（seq 145）——第 4 点落入对手后收入差扩到 54 vs 30，且 cp_sw 当场变成对手的前压部署点（R12 seq 157、R15 seq 201/203 全从这里出兵）。我方 R6 派 scout 偷 cp_sw 的计划因 scout 战斗力太弱（16 攻）而流产。
3. **R14 双向开墙与我方空转**：对手一轮 5 激活（杀 scout、打残 2 单位、开北墙，seq 181–188），我方 R14 只有 1 次纯移动（seq 177）、4 次 API 重试被拒（invalid_move/out_of_deploy_range），单轮行动效率 1:5，最后两轮彻底失去翻盘窗口。

**对手互相行动对我方的影响（双人局即直接对抗）**：对手 R14 的 (0,-2) 开墙让其 ranger（seq 204/205）R15 直接从中路打到我 heavy；而我方因单位挤在墙西侧无法前压，等于替对手把重装"卡"在了没有攻击目标的位置。

## HQ、据点与行动点分析

- **对 `player_b` 的 HQ(8,0) 伤害：0**。全期最近的我方单位是 R4 heavy(-5,-2)，到 (8,0) 距离 13，中央墙+对手兵力完全阻断；ranger（射程 3）从未部署成功（R8/R14 出价 78/78 均因补给不足失败——回放可证我 R8 余额 30 < 78）。**我方 HQ(-8,0) 也 100/100 未受攻击**，双方均未形成 HQ 压力。
- **据点**：我方唯一战果 `cp_nw`（R2 seq 23）；对手 4 点（`cp_se` R1 seq 14、`cp_e` R2 seq 31、`cp_ne` R3 seq 46、`cp_sw` R11 seq 145）。`cp_w` 全程中立（位于墙西侧 (-3,0)，双方都没把它当优先目标——我方 heavy 曾站上去但重装不能占点）。
- **HQ 进攻窗口**：不存在——15 轮内双方都没摸到对方 HQ。**守家路线**：对手留初始 scout/步兵在家门口，我方 R2/R3/R12 部署的步兵均留守 HQ 邻格，双方 HQ 无忧。
- **据点收益 vs 成本**：对手 4 点带来额外收入合计 (20+8+8+8)=44/回合（R12 起 54/回合），15 轮累计远超部署成本；我方 cp_nw 20/回合，投资回报良好但规模太小。对手 forward_base 折扣共 9 次（seq 71/96/106/119/131/144/157/201/203），累计省下 72 补给。
- **行动点分析**：`actionsPerTurn: 5`。回放统计（按事件 type 计）：我方 **move 36 / deploy 10 / attack 3 / 占点 1 / demolish 0**；对手 **move 23 / deploy 15 / attack 9 / 占点 4 / demolish 2**。我方 36 次移动折算 0 merit，是 actionScore 32 vs 86 差距的直接来源。对手几乎每个席位回合都有 attack/deploy/占点/拆墙之一，没有空转回合。

## 补给与六项裁决分账本

权重（`config.balance.adjudicationWeights`，本局配置）：enemyHqDamage **5**、ownHqHp **2**、controlPoint **90**、armyValue **2**、supplies **1**；`effectiveActions: 2`（standard 默认，actionScore = actionMerit × 2）。

| 项目 | 我方 player_a | 对手 player_b | 本局权重 | 事件或配置依据 |
|---|---:|---:|---:|---|
| 对各对手 HQ 造成的伤害 | 0 | 0 | ×5 | 全程无 `attack` 指向 HQ |
| 己方 HQ 最终 HP | 100 | 100 | ×2 | `game_over` seq 212 |
| 最终控制据点数 | 1 | 4 | ×90 | `control_point_captured` seq 14/23/31/46/145 |
| 存活军力价值 | 495 | 982 | ×2 | `game_over` scores |
| 剩余补给 | 21 | 2 | ×1 | `income` 事件 + 部署支出 |
| `actionScore` | 32 | 86 | ×1（已含 ×2） | merit：我 = deploy 10 + 占点 2 + attack ceil(34/20)+ceil(5/20)+ceil(9/20)=2+1+1 → 共 16，×effectiveActions 2 = 32；对手 = deploy 15 + 占点 4×2=8 + 拆墙 2 + attack 9 次 ceil(23/20)+ceil(25/20)+ceil(17/20)+ceil(42/20)+ceil(28/20)×3+ceil(38/20)+ceil(34/20)+ceil(27/20)=2+2+1+3+2+2+2+2+2=18 → 共 43，×2 = 86 |
| **总分** | **1333** | **2612** | — | `game_over.payload.scores` seq 212 |

**收支账本（回放 `income` 事件逐轮求和）**：
- 我方收入：R2–R15 各 30（base 10 + cp_nw 20），合计 400 + 起始 50 = 450；部署支出 10 个单位：步兵 45×6 + scout 38×4 = 429（seq 19/36/66/78/101/112/125/152/164/193）；终局余 450 − 429 = **21**（与 `game_over` 的 21 一致）。
- 对手收入：R1 10、R2 30、R3 38、R4–R11 各 46、R12–R15 各 54，合计 662 + 起始 50 = 712；部署支出 15 个单位合计 **710**（9 次 forward_base 折扣各省 8 = 72 已反映在成本中）；终局余 **2**（与 `game_over` 的 2 一致）。
- 对比：对手把补给近乎全数转化为军力（终局余 2），我方留 21 补给（×1 权重不抵 1 个单位的 armyValue 2×cost），且多出的 21 分远小于对手多出的 487 军力价值（487×2=974 分）。
- 无效花费：我方 R3 deploy 步兵(-8,1) 后该步兵基本闲置（后来仅作占位）；R14/R15 的 deploy 步兵无法在当轮形成战力。

## 失误与改进

1. **R1 scout 走 (-5,1) 而非直奔 cp_nw** — 实际做法：3 AP 纯移动且未踏上奇点；正确做法：R1 让 scout 走 (-4,-3) 直占（起始 (-6,0) 到 cp_nw 距离 3 ≤ moveRange 5，对手同距离 R1 直接占点可证）。触发条件：开局时按 hex 距离预计算 scout 的 5 移动力能否直达最近 CP。预期收益：早 1 轮拿 20 收入 + 早 1 轮占点 +2 merit。
2. **从未安排 heavy 拆墙** — 实际做法：双 heavy 全程堵在墙西侧（我方 `demolish` 事件 0 次）；正确做法：R3–R4 让 heavy 在 (0,-1)/(0,2) 等邻格 `demolish` 开墙（对手 R9/R14 拆了 2 次，seq 117/185）。触发条件：中央墙 blocker 阻断攻击线且 heavy 无合法攻击目标时。预期收益：打开中路后双 heavy（40 攻）+ scout 可压制 cp_e/cp_ne，至少抢回 1 个 CP（裁决 90/点）并产生 attack merit。
3. **ranger 采购计划落空** — 实际做法：R8/R14 想出 ranger（78）时补给只有 30/66，出不起（回放无对应 `deploy` 事件）；正确做法：R3–R5 少出 2 个 scout（38×2=76）改为攒 1 把 ranger（78），长手 DPS 对墙口争夺战价值远高。触发条件：补给 30–80 区间、前线僵持时。预期收益：ranger 射程 3 可白嫖墙口敌军，actionScore attack merit 每击 ceil(28~34/20)=2。
4. **R14 空转 4 个 API 失败** — 实际做法：连续重试非法移动；正确做法：失败 1–2 次后立即改走合法小动作（如重装 `demolish`、单位前压 1 格）。触发条件：`invalid_move` 连续出现。预期收益：减少 0-merit 回合，单轮多 1–2 次有效激活。
5. **cp_sw 争夺策略错误** — 实际做法：用 16 攻的 scout 渗透(-3,2)想占 cp_sw，被 100hp 步兵反杀（R12–R14）；正确做法：cp_sw 争夺要带 heavy/步兵走 demolish 开的南墙缺口（对手正是这么干的）。触发条件：目标 CP 有敌步兵驻守时。预期收益：保住 scout（38 军力）并可能抢下第 2 个 CP（90 分权重）。

## 与历史对局对比

- **最直接对照：`tg_0147_20260913.json` / `tg_0147_win_WB@Dsv4.1Flash0910.md`、`tg_0147_lose_WB@hy4.md`**——同一地图 `breach`、同一模式 `standard`、同一对手 Dsv4.1Flash0910-WB（0173 我输给了他，0147 他是 winner）、同为 `turn_limit_score` 收官。对照发现：
  - 0147 是**高强度对抗**：双方 53 次 attack、13 次 unit_death（27 名单位阵亡）、2 次 demolish，胜者 Dsv4.1Flash0910 的 actionScore 高达 **158**（vs 对手 134），军力价值 437 vs 328，最终 1504:1270。
  - 本局 0173 则是**低强度对抗**：全局仅 12 次 attack、2 次 unit_death，我的 actionScore 只有 32、军力价值 495。说明我在 0147 型“清兵–夺点”节奏下完全没能打开局面，对手反而以经济（4 CP）而非击杀取分。
  - 本局新发现：map `breach` 的 heavy `demolish` 是高级杠杆（对手 2 次拆墙直接产生进攻通道 + 2 merit），且 forward_base 的 8 折扣在长盘中 9 次累计省下 72 补给，约等于一个步兵 + 一个 scout。
- 与 `tg_0035`（`tg_0035_win_PI@DeepseekV4FlashPreview.md` / `tg_0035_lose_PI@DeepseekV4ProPreview.md`，同为 2 人 win/lose 命名）相比：0035 局的胜负手是 HQ 伤害项（enemyHqDamage×5），而本局双方 HQ 均 100/100，胜负完全由 controlPoint×90 + armyValue×2 + actionScore 决定——**验证了新经验：breach 图 15 轮上限下“HQ 压力”不是主矛盾，CP 链和行动 merit 才是**。
- 本局新发现：map `breach` 的 heavy `demolish` 是高级杠杆（对手 2 次拆墙直接产生进攻通道 + 2 merit），且 forward_base 的 8 折扣在长盘中 9 次累计省下 72 补给，约等于一个步兵 + 一个 scout。

## 总结

### 做得好的
1. R2 scout 抢 `cp_nw`（seq 23）并全期守住，拿到唯一一个 CP 的 20/回合收入——是终局没有崩到 1000 分以下的关键（180 分权重+收入）。
2. R11 起敢于用 heavy 攻击入侵步兵（seq 137，34 伤），这是全期 3 次攻击（seq 137/151/166）中价值最高的一次，压制了对手 cp_sw 步兵的进一步扩张。
3. 后期（R13–R15）在劣势下持续 deploy+attack 换 actionScore（merit 16），没有摆烂空转到底。

### 下次改进
1. **开局路线**：按 hex 距离预判 scout 首回合能否直达 CP；能直达就不绕路——触发条件：开局扫图算距离；替代动作：R1 scout 直占 cp_nw；预期收益：早 1 轮收入+占点。
2. **重装拆墙**：墙阻断攻击线且 heavy 无目标时，优先 `demolish`——触发条件：heavy 连续 2 回合 0 攻击；替代动作：开墙后压中路；预期收益：+1 CP 争夺能力 +2 merit/次。
3. **军力结构**：僵持局优先 ranger（射程 3）而非 scout 堆叠——触发条件：补给 30–80 且前线对峙；替代动作：攒 78 出 ranger；预期收益：每回合多 1–2 次有效攻击。
4. **API 容错**：连续非法移动 2 次即换合法小动作，避免 R14 式 4 连败空转。

> **核心口诀：先算距离抢据点，重装开墙打通道，行动点只花在能出 merit 的动作上。**
**一句话总结：breach 局 15 轮裁决，对手用"据点链→折扣产兵→重装开墙"三板斧拿下 4 CP 和 2 倍军力，我方 36 次纯移动换来 0 merit，1333:2612 败于行动效率与经济规模。**
