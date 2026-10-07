# 战术游戏歼灭模式复盘 — `player_b` 视角

**日期/游戏ID/回放版本:** 2026-10-07 / b484545e-27ff-4df7-be02-2fd785f072df / schemaVersion 3.5.12（hex-v2-replay）
**地图/参战人数:** artillery-zone / 3人；**模式:** annihilation
**玩家:** mimo2.6pro-PI（PI@mimo2.6pro）
**席位与出生:** `player_b`（slot_east），初始单位 infantry 235dfbbd@5,0、infantry 54fa70e9@5,-1、heavy 6b10d99d@4,1，出生控制点 cp_east(4,0,forward_base)；HQ：不适用（无HQ）
**结果:** ⚪第3名 — `army_destroyed`（被 player_a 击杀，seq 260）
**结束轮次:** 第11/20整轮被淘汰；**最终存活单位/补给:** 0 / 129
**最终胜者:** player_c（sp-WB），`last_player_standing`，第13轮结束

## 最终排名与淘汰

| 名次 | 席位 | 状态 | 总分 | 军力价值 | 据点 | 主要死亡/优势原因 |
|---|---|---|---:|---:|---:|---|
| 1 | player_c sp-WB | active | 1090 | 300 | 6 | 早期占 6 点位积累收入（每回合44补给），囤 8 军不卷入前期绞肉，炮火期收割残局 |
| 2 | player_a mimo2.6flash-PI | eliminated(R13) | 630 | 0 | 4 | 前期集火我（对我的伤害340）夺占 supply_east，中期与 player_c 对耗394点后被歼灭 |
| 3 | player_b mimo2.6pro-PI（我） | eliminated(R11) | 190 | 0 | 1 | 集火节奏慢、贪占外圈补给点不撤、重装停在危险区连续吃炮 |

## 炮火与安全区时间线

炮火配置：`startRound=5, intervalRounds=2, damage=25, minimumSafeRadius=1`（game_start payload，seq 2）。

| 轮次 | safeRadius | warning/danger 关键格 | 我的单位位置 | 撤离/承伤/击杀 | 决策评价 |
|---|---:|---|---|---|---|
| R4 | 6 | warning 36格（seq 71，首次预警，含 4,1） | heavy 4,0 / inf 2,0、3,-1 / scout 4,1 | 无 | ⚠️ 首次预警后 4 个单位中只有 heavy 在内圈边缘，scout 4,1 未撤离（后被证明致命） |
| R5 | 5 | shrunk→danger 36格（seq 96），4,1 已危险 | heavy 3,0 / inf 3,-1 / scout 3,1 | 本边界无 | 临时把 scout 从 4,1 撤到 3,1，但没形成持久撤离计划 |
| R6 | 5 | warning 30格（seq 120），含 3,1、4,0 | heavy 4,0 / inf 3,-1 / scout 3,0→4,1 | 无 | ❌ R6 把 scout 又调回 4,1（危险+预警格），完全无视预警 |
| R7 | 4 | shrunk→danger 66格（seq 146） | heavy 4,0 / scout 4,1 | scout 85f88c14 承伤25→40hp（seq 147） | ❌ 首次实质炮火承伤；scout 4,1 应在 R6 结束前撤到安全区 |
| R8 | 4 | warning 24格（seq 170） | heavy 4,0 / scout 3,1 | 无 | scout 撤了，但 heavy 4,0 已是危险区边缘，未内移 |
| R9 | 3 | shrunk→danger 90格（seq 194） | heavy 4,0 / scout 4,1 | heavy 承伤25→93（seq 195）；scout 承伤12→0 阵亡（seq 196，`artillery`击杀） | ❌❌ 关键失误：scout 重回 4,1 被炮火直接击杀；heavy 连续第二回合站危险区吃25 |
| R10 | 3 | warning 18格（seq 218） | heavy 4,0 | heavy 承伤25→68（seq 219） | ❌ heavy 4,0 已连续3回合吃炮（R9/R10/R11共75伤害），撤离窗口已错过 |
| R11 | 2 | shrunk→danger 108格（seq 241） | heavy 3,0 | heavy 承伤25→43（seq 242）；击杀 player_a ranger 9c3f05b0（seq 251）后被 player_a 集火阵亡（seq 258） | 本回合我先手击杀残血ranger（好），但 heavy 仅剩43hp，被 player_a 双单位围攻击杀，`army_destroyed` |
| R12–13 | 2→1 | 两次 shrunk（seq 270/289），最后 safeRadius=1 | — | — | player_c 在炮火中承伤236点但军力厚实，最终收割 player_a（R13）获胜 |

**炮火账本：** 我共承伤 112 点炮火（4次：seq 147/195/196/219/242，其中 seq 196 直接击杀 scout 85f88c14）。player_a 承伤32，player_c 承伤236——player_c 用厚实军力硬吃炮火换取控制权，我却用脆皮 scout 反复试探危险区。

## 单位、据点和补给时间线

- **R1**（seq 5-7）：3 单位全部北上（5,0→4,-1；5,-1→3,-1；heavy 4,1→4,0）。✅ 合理，靠近内圈补给点。
- **R2**（seq 28-31）：infantry 占 supply_east（3,0）；deploy scout from cp_east→4,1（seq 30，成本38）。✅ 占点+扩军正确，但 scout 落点 4,1 后来成为炮火死地。
- **R3**（seq 51-53）：攻击 9f28f1d2（player_a 新部署 infantry）造成21伤害；但试图 move 235dfbbd→2,2 未果（回放显示实际 move 2,0→...，seq 52 move 2,0）；heavy 4,0→3,0。⚠️ 集火目标正确（威胁最近的敌步兵），但我只有1次攻击，player_a 同轮对我反打2次（seq 57/59）。
- **R4**（seq 74-76）：再攻 9f28f1d2（25伤害）；inf 2,0→3,-1（撤退）；heavy 3,0→4,1。⚠️ heavy 4,1 又踏入预警区，且没有形成合力。
- **R5**（seq 99-101）：攻击 player_a 5a3252c0（19伤害）；scout 4,1→3,1；heavy 4,1→3,0。⚠️ 本轮 player_a 对我 infantry 235dfbbd 打出3连击（seq 105/107/109，77伤害），我只还手1次——交换比严重落后。
- **R6**（seq 123-126）：攻击 5a3252c0（25伤害）；heavy 3,0→4,0（走回危险区！）；scout 3,0→4,1（走回危险区！）；deploy scout from cp_east→4,1（seq 126，38补给）。❌❌ 本回合是转折点：把两个单位都调回即将收缩的危险圈，且新 scout 落在 4,1（R7 炮击点）。
- **R7**（seq 150-151）：攻击 9f28f1d2（31伤害）；scout 4,1→3,1。heavy 4,0 已是危险区，未动。⚠️ player_a 同时夺走 supply_east（seq 160，control_point_captured：supply_east owner player_b→player_a），我失去+8收入和部署通道。
- **R8**（seq 173/175）：击杀 9f28f1d2（23伤害，hp→0，seq 174 unit_death）；scout 3,1→4,1。❌ scout 第三次进入危险/预警区（4,1）。
- **R9**（seq 200）：攻击 5a3252c0（27伤害）。本轮边界：heavy 4,0 承伤25→93（seq 195），scout 4,1 承伤12→阵亡（seq 196）。❌ scout 被炮火直接击杀。
- **R10**：无攻击（heavy 单位孤掌难鸣）；heavy 4,0 再承伤25→68（seq 219）。❌ 纯挨打回合。
- **R11**（seq 250-251）：heavy 4,0→3,0；攻击 9c3f05b0（23伤害，击杀，seq 252 unit_death）。✅ 完成一次击杀交换；但本轮边界 heavy 承伤25→43（seq 242），随后被 player_a 重装+ranger 集火（seq 256/257，43伤害→0），seq 258 unit_death，seq 260 `player_eliminated`（army_destroyed，eliminatedBy player_a），cp_east 中立化（seq 259）。

**补给账本：** 收入曲线 R2-R7 每回合 20（base8+cp_east4+supply_east8），R8 起失去 supply_east 后降到 12。总部署开销：2×scout=76（seq 30/126）。剩余补给129（未花完）——按权重 `supplies=0` 这不扣分，但那是 2-3 个步兵/侦察兵的军力价值，白白浪费。

## 核心教训与关键转折

1. **R6 的灾难性反向移动（seq 123-126）：** R5 边界已经吃过预警（seq 71），R6 又是下一轮收缩的前夜（seq 120 预警 30 格），我却把 heavy 从 3,0 调回 4,0、scout 从 3,0 调回 4,1——两个单位都走向即将变危险的外圈。正确做法：R6 全军内移至 ring≤2，为 R7 收缩（safeRadius 5→4）预留缓冲。这一回合直接导致后续 scout 阵亡（seq 196）和 heavy 连续吃炮。
2. **集火交换比崩盘（R3-R5）：** 我对 player_a 的总伤害 194 点，player_a 对我 340 点（damage matrix）。player_a 用 3 单位（heavy+ranger+infantry）协同集火我的单个步兵（seq 105/107/109 三连击杀 235dfbbd），我却分散攻击两个目标各打半血。正确做法：R3-R4 集中 all-in 击杀 9f28f1d2（一次打死），避免它持续输出。
3. **据点战略价值未保护（R7，seq 160）：** supply_east 被 player_a 夺走，我从每回合20收入跌到12，且失去 deploy 通道（cp_east 是唯一部署来源，R2/R6 各部署一次后供给中断）。正确做法：在 R6 之前用 infantry 驻守 supply_east（3,0），而不是把它当作进攻跳板。
4. **炮火撤离窗口判断：** 首次预警（seq 71，R4）时我的 4 单位在外圈：heavy 4,0(ring4)、inf 2,0(ring2)、inf 3,-1(ring3)、scout 4,1(ring5)。只有 scout 4,1 必须立刻撤，但我拖了 3 个回合，最终被炮击杀（seq 196）。经验：warningCells 出现且 `nextShrinkRound` 在 2 轮内时，外圈单位必须无条件内撤，不能"用完这回合再撤"。

## 炮火、军力与裁决分账本

按本局 `adjudicationWeights`（game_start seq 2）：

`HQ伤害（不适用，无HQ） + HQ HP（不适用，无HQ） + 据点数×0 + 存活军力价值×2 + 剩余补给×0 + actionScore×10（effectiveActions）`

| 项目 | 数量/数值 | 权重 | 依据 |
|---|---:|---|---|
| HQ伤害 / HQ最终HP | 不适用（无HQ） | — | `mode=annihilation`，运行时无总部 |
| 最终据点数 | 1（cp_east，淘汰时中立化） | 0（不构成裁决分） | seq 259 control_point_neutralized |
| 存活军力价值 | 0（5单位全灭） | ×2 | seq 260 player_eliminated |
| 剩余补给 | 129 | 0（不构成裁决分） | income事件累计 |
| `actionScore` | 190（actionMerit 19 × effectiveActions 10） | 已含乘数 | game_over.payload.scores |
| 炮火承伤/击杀 | 承伤112点，1次击杀（seq 196） | — | 炮火事件（非独立裁决项） |
| **总分** | **190** | — | game_over.payload.scores（第3名） |

**对比：** player_c 总分1090 = 军力价值300×2 + actionScore 490（merit 49）；player_a 630 = 0 + 630（merit 63，攻击次数31次全场最高）。我 actionMerit 仅19（攻击8次全场最低），军力价值归零——分数差距完全来自「攻击频率低 + 军力被清零」。

## 实际做法 vs 正确做法

| 错误 | 触发条件 | 实际做法 | 正确做法 |
|---|---|---|---|
| 致命1：无视炮火预警反复进出危险区 | seq 120（R6预警，含4,1/4,0） | R6把 heavy 调回4,0、scout 调回4,1（seq 124/125），R8又把 scout 调回4,1（seq 175） | 预警出现后外圈单位只进不退，向 ring≤(safeRadius-1) 集结；宁可损失一回合输出也要保住单位 |
| 致命2：集火分散，交换比落后 | player_a 3单位集火我的单步兵（seq 105-109） | 我同时攻击 9f28f1d2（R3-R4两次）和 5a3252c0（R5-R6两次），无人被快速击杀 | 全力一击先杀一个（9f28f1d2 hp100 在 R4 后 hp54，R5 一次攻击+重装攻击即可收割），再转移目标 |
| 低效3：撤退未携带反击 | R5/R6 player_a 逼近 | infantry 235dfbbd 单独后撤（seq 75）不还击，白白挨打 | 后撤时保留至少1单位在敌人射程边缘反打，避免零输出挨打 |
| 低效4：supply_east 无人防守 | R6 heavy 离开3,0（seq 124） | 仅靠 infantry 235dfbbd 在3,0附近，R7被夺点（seq 160） | 部署或移动1个步兵常驻 supply_east(3,0)，保住+8收入和部署通道 |

## 与历史对局对比

参考 `records/V3/tg_0199_20261005.json`（双人局，我胜）和 `tg_0203_20261006.json`（我用同一模型取胜）：历史胜局中我通常在炮火预警后立即内撤、优先集火残血单位。本局（tg_0206）：
- **首次预警外圈单位数**：4个（历史胜局通常≤2个）。
- **各次收缩前未撤离数**：R7收缩前2个（heavy+scout）仍在危险区，R9收缩前2个，历史胜局为0-1个。
- **炮火承伤/击杀**：本局112点承伤+1次击杀（自己被杀），历史胜局炮火伤害多为0-25点。
- **最终死亡原因**：`army_destroyed`（被 player_a 集火），非炮火直接击杀（虽然 scout 死于炮火）。
- **据点收入**：本局最高20/回合，player_c 44/回合——收入差距是本局失败的深层原因（早期占点不力）。
- **排名**：第3/3，历史最好成绩第1（tg_0203_win_PI@mimo2.6pro.md）。

## 总结

> **核心口诀：预警先撤离，集火先杀敌，占点要守点**

**一句话总结：本局输在「无视炮火预警反复进出危险圈」和「集火分散」，被 player_a 集火歼灭、被炮火反复消耗，而 player_c 用早期占点积累的收入优势稳扎稳打赢得最后胜利。**
