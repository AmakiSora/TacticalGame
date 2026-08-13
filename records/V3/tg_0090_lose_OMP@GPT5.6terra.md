# 战术游戏第2名复盘 — `player_a` 视角

**日期:** 2026-08-13  
**游戏ID:** `3fbc19c0-baf4-4e5b-a262-0f9677f338b7`  
**回放版本/地图:** 3.2.10 / `artillery-zone`（炮火禁区）  
**模式:** annihilation；无 HQ  
**玩家:** GPT5.6terra-OMP（OMP@GPT5.6terra）  
**席位与出生:** `player_a`，行动顺序第 2（`turnOrder: [player_b, player_a]`）；初始 2×infantry@(-5,0)、(-5,1) + heavy@(-4,-1)，初始控制点 `cp_west`@(-4,0)  
**参战人数/最终名次:** 2 人 / 第 2 名  
**结果:** ❌ 存活至第 12 整轮，但轮数裁决落后 `player_b`  
**结束原因:** `turn_limit_score`  
**最终补给/HQ/总分:** 180 / 不适用（无 HQ） / 682 分  

> 数据来源：`records/V3/tg_0090_20260813.json`，206 条事件。全局计数：23 次 `income`、7 次 `deploy`、45 次 `attack`、6 次 `heal`、8 次 `control_point_captured`、4 次 `artillery_shrunk`、4 次 `artillery_warning`、3 次 `artillery_damage`、7 次 `unit_death`。以下数字和坐标均以回放事件为准。

---

## 最终排名摘要

| 名次 | 席位 | 玩家 | 状态 | 总分 | 与我方分差 | 决定性优势 |
|---|---|---|---|---:|---:|---|
| 1 | `player_b` | Dsv4Flash0731-OMP | 存活 | 946 | +264 | armyValue=178、actionScore=590；终局保留 3 步兵 + 游侠 |
| **2** | **`player_a`** | **GPT5.6terra-OMP** | **存活** | **682** | — | 仅存 infantry@(-2,-1) 46HP、support@(-2,0) 82HP |

本局裁决权重为 `enemyHqDamage=0`、`ownHqHp=0`、`controlPoint=0`、`armyValue=2`、`supplies=0`、`effectiveActions=10`。因此：

- 我方：无 HQ（不适用）；控制点 3×0；armyValue 81×2=162；补给 180×0；actionScore=520；**总分 682**。
- `player_b`：无 HQ（不适用）；控制点 7×0；armyValue 178×2=356；补给 319×0；actionScore=590；**总分 946**。
- 核心差距：军力价值落后 97，折合 **194 分**；行动分再落后 70。补给多 139 不参与裁决，无法弥补差距。

---

## 核心教训

### 致命错误：第 1—3 轮只拿两座 supply，没有阻止 `player_b` 建立 7 点、52/轮收入

**问题：** 我方 R1 以步兵 `(-5,0)→(-3,0)` 占 `supply_west`（seq 16、19），R2 占 `supply_southwest`@(-3,3)（seq 34、37），收入由 12 提升至 28/轮（seq 14、32、49）。这保证了局部经济，但让先手 `player_b` 在 R2-R3 连续取得 `cp_northeast`、`supply_northeast`、`supply_southeast`、`cp_southeast`、`supply_northwest`（seq 28-30、46-47），扩大为 7 点、52/轮收入（seq 58）。

**后果：** 对手 R4 就能从 `supply_northwest` 部署第二台 heavy@(-1,-2)，花费 92（seq 78）；我方同期选择 support@(-3,-1)，花费 60（seq 53）。后续即使先击杀对手两台 heavy，也无法阻止其用 52/轮持续补 infantry 与 ranger；终局仍保留 178 armyValue。

**正确做法：** R2 不能只让南路步兵从 `(-4,3)`往 `(-3,3)`拿同侧 supply。应由该步兵以移动 3 尽早进入中心，威胁/抢占 `supply_southeast`@(0,3)，或由主力向 `supply_northwest`@(0,-3)推进。目标不是控制点裁决分，而是把对手控制收入从 52 降至 44、36 或更低，并削弱其第二台 heavy 的部署窗口。

---

### 致命错误：中心重装在两台敌方重装与步兵火力范围内反复换血，R8 被击杀

**问题：** 我方 heavy 在 R3 移至 `(-1,0)`后持续攻击首台敌重装，R3-R6 共造成 25、24、28、26、12 点伤害（seq 52、67、83、100、102），R6 成功击杀它（seq 103）。这是有效集火，但没有在第二台 enemy heavy@(-1,-1) 成型后撤出邻接位。

**对手火力：** 首台 heavy、第二台 heavy 与步兵先后对我方 heavy 造成 26、27、18、27、24、16 等伤害（seq 60、77、92、94、95、109、110）。支援虽在 R5-R6 两次治疗至 120、79 HP（seq 85、101），但治疗无法抵消连续多单位集火。R8 我方 heavy 已降至 2HP；R9 前被击杀，直接丢失 92 cost 的高价值单位。

**正确做法：** 首台 heavy 被压到残血后，应由步兵完成补刀，我方 heavy 退到支援身侧且避免与新敌 heavy 邻接；重装不是必须每回合都用来承受反击。触发规则：己方 heavy 被至少两名敌方近战单位同时覆盖，且本回合无法击杀其中一名时，优先撤出邻格并由支援治疗，而不是继续换血。

---

### 次要错误：R8 才部署游侠，且在安全半径继续收缩时把其暴露在多名敌军的射击范围

**问题：** R8 从 `cp_west` 部署 ranger@(-3,0)，花费 72（seq 137）。R9 它远射第二台 heavy，将 87HP 压至 40HP，之后继续由我方步兵击杀，说明游侠火力选择是正确的。但该游侠没有提前得到安全、可撤的站位，R11 被集火到 3HP；支援治疗后仅回到 25HP，R12 仍被击杀。游侠本可贡献的 72 cost 军力价值最终归零。

**正确做法：** R8 部署后应以射程 3 保持在安全半径 2 内、与 support 相邻，优先攻击敌方游侠或低血 infantry，而非把自身留在敌方多单位的近战/远射交叠区。R9-R10 还应把游侠定位为保军力单位：没有击杀或至少两点 merit 的确定远射时，先离开可被三名敌军覆盖的位置。

---

## 关键时间线

| 整轮/席位回合 | 补给/行动点 | 我的操作 | `player_b` 响应 | 问题或收益 |
|---|---:|---|---|---|
| R1 / `player_a` | 45→0 / 3/4 | 步兵 `(-5,0)→(-3,0)`，回合末占 `supply_west`；从 `cp_west` 部署 infantry@(-4,1)，45 补（seq 16-19） | 先手部署 infantry，并占 `supply_east` | ✅ 收入从 12 提升到 20；但对手先手扩大更快 |
| R2 / `player_a` | 20 / 3/4 | 南路步兵 `(-4,3)→(-3,3)`，占 `supply_southwest`（seq 34、37）；主力向中心推进 | 对手占东北、东南两个 supply 与东北 forward_base（seq 28-30） | ⚠️ 我方 3 点、28/轮；对手已 5 点、40/轮 |
| R3 / `player_a` | 28→? / 3/4 | heavy `(-2,-1)→(-1,0)`并攻击敌 heavy，150→125；部署 support@(-3,-1)，60 补（seq 51-53） | 对手拿 `cp_southeast`、`supply_northwest`，随后达到 7 点、52/轮 | ⚠️ support 有续航价值，但无法解决对手经济失控 |
| R4 / `player_a` | 28 / 3/4 | heavy+步兵继续集火首台 heavy，敌方降至 83HP；支援前推 | 首次炮火预警：R5 将从半径6缩至5（seq 57） | ✅ 对敌重装建立击杀线；⚠️ 未从预警与收入优势重新评估对手第二重装风险 |
| R5-R6 / `player_a` | 28 / 3/4 | heavy、步兵、支援连续攻击/治疗；R6 步兵补刀首台 heavy 12→0（seq 100-103） | `player_b` 在 R4 已部署第二台 heavy@(-1,-2)，并持续集火我方 heavy | ✅ 击杀 92 cost；❌ 我方 heavy 换血后仅 79HP，中心兵力被锁死 |
| R7 / `player_a` | 28 / 3/4 | 支援治疗 heavy 至 61HP；步兵攻击敌步兵，继续在中心缠斗 | 炮火半径缩至4（seq 106）；第二台 heavy 与步兵继续压血 | ❌ 未借缩圈撤出敌方集火区，heavy 只剩 39HP |
| R8 / `player_a` | 140→68 / 4/4 | 治疗 heavy、攻击敌 heavy与步兵；从 `cp_west` 部署 ranger@(-3,0)，72 补 | 对手持续拥有 7 控制点与部署空间 | ✅ 游侠入场，一度使我方总分反超；⚠️ heavy 已降至 2HP，游侠站在即将缩圈的外层 |
| R9 / `player_a` | 96 / 4/4 | 游侠将敌 heavy 87→40；步兵继续输出；R9 半径缩至3 | 对手部署 ranger@ (0,2)，并以优势兵力压制中心 | ✅ 军力交换一度领先；❌ 没有先保住己方 2HP heavy、低血游侠 |
| R10 / `player_a` | 124 / 3/4 | 游侠将敌 heavy 40→11，步兵补刀击杀；支援治疗 infantry | 炮火警告 R11 缩到半径2；对手已部署 ranger 并保留多个满血 infantry | ✅ 清除第二台 heavy；⚠️ 对方从此以 4 infantry+ranger 对我方 infantry+support+ranger |
| R11 / `player_a` | 152 / 3/4 | 游侠击杀敌方 29HP infantry，支援将游侠 3→25HP | `player_b`以 ranger/步兵持续压我方残血单位 | ✅ 有效收割并获得 merit；❌ R12 前仍有 25HP ranger，无法承受一次攻击 |
| R12 / `player_a` | 180 / 0/4 | 开始时仍有 infantry@(-2,-1) 46HP、infantry@(-1,1) 76HP、support@(-2,0) 82HP、ranger@(-2,1) 25HP；无法形成有效反击，结束回合 | `player_b`击杀后两者，维持 4 个存活单位，裁决 946 分 | ❌ armyValue 81 vs 178，终局锁定失败 |

炮火配置与实战：`startRound=5`、`intervalRounds=2`、伤害 25、`minimumSafeRadius=2`。收缩实际发生在 R5→5（seq 73）、R7→4（seq 106）、R9→3、R11→2；首次预警为 R4。回放存在 3 条 `artillery_damage`：R11 我方 infantry@(-2,-1) 承受25，71HP（seq 176）；R12 同单位再承受25，46HP（seq 192）；另有 `player_b` infantry 承受25（seq 175）。关键事实是：R9 后外侧出生/部署带不可继续作为安全驻留区，R11 最终只剩半径2核心区。

---

## 补给与分数账本

**实际情况：**

- 我方部署 3 个单位：infantry@(-4,1) 45、support@(-3,-1) 60、ranger@(-3,0) 72，合计 **177 补给**；全部无折扣。
- 据点收入轨迹可由事件验证：R1 为 12（base 8 + `cp_west` 4）；占 `supply_west` 后为 20；再占 `supply_southwest` 后为 28。对手则在 R3 达到 52/轮。
- 无效或低收益开销：无“部署即死亡”单位；但 72 补给游侠终局阵亡，60 补给支援虽存活却无法弥补被集火的高价值单位。
- 最终六项裁决分：HQ伤害/ HQ HP **不适用（无 HQ）**；控制点 3，权重0；armyValue 81，权重2，计162；补给180，权重0；actionScore520；总分 **682**。

**正确策略估算：**

- [推演] 若 R2 南路步兵改向 `supply_southeast` 或中心北侧，成功至少延迟对手一个 supply 的占领，则其收入每轮至少少 8；R4 的 92 补给 heavy 部署可能延后。该结论取决于对手是否会改线防守，不能作为既成事实。
- [推演] 若中心 heavy 在第二台敌 heavy 出现后撤回支援射程内，它至少可避免部分邻接反击；只要带着 50HP 存活，armyValue 增量约 `round(92×50/150)=31`，裁决约 +62 分。这仍不足以独立覆盖终局 264 分差，但会显著提高游侠和步兵的生存空间。

---

## 经验教训

### ✅ 做得好的

1. **前两轮稳定拿双 supply：** `supply_west` 与 `supply_southwest` 在 seq 19、37 被占，收入快速升至 28/轮；这是两人西侧出生的合格开局。
2. **首台敌重装集火正确：** R3-R6 用 heavy+步兵连续削血，最终 R6 击杀 enemy heavy（seq 103），先减去对手 92 cost。
3. **支援治疗确实制造了输出窗口：** 对己 heavy 的治疗把它恢复到 120、79、61HP；R8-R10 配合游侠和步兵又击杀了第二台敌 heavy。重装目标选择正确，问题是撤退时机错误。
4. **R8 游侠入场后主动利用射程：** 将第二台敌 heavy 从 87 压至 40、11，促成后续击杀；证明游侠是炮火核心区的关键远程输出。

### ❌ 致命失误

1. **放任对手 7 点经济：** 我方从未攻击其 `supply_northwest`、`supply_southeast` 路线或已占据点。即使控制点权重为0，52/轮收入直接转化为第二台 heavy、后续 ranger 与终局完整步兵群。
2. **重装不撤退：** R6 击杀首台 heavy 后，敌方第二台 heavy 已在 `(-1,-1)`，我方 heavy 仍在 `(-1,0)`持续邻接换血。support 的治疗被对手多单位伤害吞没，最后损失 92 cost。
3. **低血游侠没有保军力优先级：** R11 仅余3HP仍在高危接触线，虽被治疗到25HP，却无法安全越过最终回合；最终 72 cost 归零。
4. **终局分数判断过晚：** R10 后对手已部署 ranger，且仍有大量补给与 7 点收入。应把所有行动优先级切换为“保留可裁决 armyValue + 击杀低血目标”，不能再以无法改变局面的控制点或边缘接触换血。

### 🔑 核心教训

> **“炮火禁区双人局：先压对手第二座 supply 的收入；中心重装一旦被两名近战覆盖就撤，游侠只在能射而不被围时换血。”**

---

## 与历史对局的共同教训

1. `records/V3/tg_0075_lose_OMP@minimaxm3.md` 同为 `artillery-zone` 双人局、slot_west。该局复盘指出重装长期停在中心被多方向火力磨死；本局重演相同结构：我方 heavy 在 `(-1,0)`邻接第二台 enemy heavy 与敌步兵，R8-R9 阵亡。历史教训未被执行成明确撤退阈值。
2. `records/V3/tg_0089_rank04_OMP@minimaxm3.md` 提出“游侠是 artillery-zone 胜负手”，本局得到验证：游侠促成第二台 enemy heavy 击杀。但本局新发现是：双人局中对手的 7 点收入比一次重装击杀更具持续性；游侠必须用于切断收入建立的兵力优势，且必须保全到裁决。

---

## 下次的正确策略

```text
R1 / player_a:
  infantry(-5,0)→(-3,0)，回合结束拿 supply_west；
  保留重装向中心推进；从 cp_west 部署 infantry@(-4,1) 可接受。

R2 / player_a:
  不能把两名步兵都继续留在西南外圈。
  若 player_b 已取得 supply_southeast@(0,3)，南路步兵改向中心，目标是和其守点单位交换；
  若 supply_northwest@(0,-3)仍中立，则北路主力优先争夺，至少阻断其成为第二重装部署源。

中盘触发条件:
  - enemy controlPoints >= 5 且我方只有3：优先攻击其可夺 supply 或其抢点 infantry；控制点权重为0也必须断收入。
  - 我方 heavy 被两名 enemy melee 单位威胁、且本回合无法击杀其一：撤到 support 邻边，先 heal；禁止留在相邻格换血。
  - R8 后部署 ranger：目标必须位于当前 safeRadius 内，且下回合可移入 dist<=2；低于30HP时优先退/治，不用来换一次无击杀攻击。
  - actionScore 落后>=40且 armyValue 未领先：优先击杀低血单位和安全治疗，避免无 merit 的移动。

终局检查:
  存活资格；无HQ；控制点权重0；armyValue×2 + actionScore。
  目标至少保住 support+ranger+2 infantry，armyValue>=140、actionScore>=550；若对手有4个以上存活单位，必须在R10前完成至少一个低血击杀，不能让游侠换命。
```

---

**一句话总结：** **我方前期双 supply 开局合格、两杀敌重装的集火也正确，但放任 `player_b` 建成 7 点经济，同时让重装和游侠在缩圈核心区被逐个换掉，最终把短暂的军力优势变成 264 分的裁决落败。**

---

*文档生成时间: 2026-08-13*  
*回放格式版本: 3.2.10*  
*AI模型: OMP@GPT5.6terra*
