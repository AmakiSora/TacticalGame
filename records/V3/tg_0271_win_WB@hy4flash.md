# tg_0271 镜湖对局复盘（royale·mirror-lake）

## 0. 局面概要
- **gameId**：`43de98cd-8a38-472a-a92d-eba8dc76dd1a`；**地图**：`mirror-lake`（半径 6 中心对称湖岛）；**模式**：`royale`（同时回合结算 × 歼灭缩圈）；**人数**：2
- **我的席位**：`player_a`（Hy4Flash-WB，`slot_west`，turnOrder 0）；**对手**：`player_b`（GLM5.2-WB，`slot_east`，turnOrder 1）
- **名次与结果**：我 rank 1 → **win**（唯一第一）；终局 `reason = last_player_standing`，`winner = player_a`，结束于**第 16 轮**（`maxTurns 30`，未打满）
- **淘汰**：`player_b` 于 r16 `army_destroyed`，`eliminatedBy = player_a`（战斗清场，非炮火）
- **本局 artillery 配置**：`startRound 6` / `intervalRounds 1` / `damage 25` / `minimumSafeRadius 1`；r5 预警，r6–r10 每轮收缩（safeRadius 6→5→4→3→2→1），r10 起停在 1（中心 7 格）
- **关键权重**（`adjudicationWeights`）：`armyValue 5` + `killValue 1.5`；`enemyHqDamage/ownHqHp/controlPoint/supplies` 全 0。无 HQ（运行时 `headquarters: {}`）
- **回放版本**：`hex-v2-replay` / schema `3.9.10` / 369 事件 / 导出于 2026-11-16

> 说明：本文所有数字均出自回放 `tg_0271_20261116.json`，记忆中的过程仅用于定性描述。对局中曾以为 r8/r13 己方阵亡来自炮火，回放证实均为 `cause: attack`，以回放为准。

## 1. 结果一句话
前期用侦察兵抢下 `cp_southwest` 并把 260 补给几乎全部转成军队建立军力优势；中期靠 arc 三格扇面与 ranger 锁定**集中击杀敌方 ranger/support/high-value 单位**（8 次攻击击杀合计 killValue 605）；缩圈后把满血重甲压进中心 7 格、让敌方外圈单位被 25 点/轮的炮火持续放血（敌承炮火 440 / 我 240），最终在 r16 打光敌军最后一个重甲，以 `last_player_standing` 获胜。

## 2. 发育窗口（round 1–5，早于 startRound 6）
- **开局建军**：起始双方各 2 heavy + 1 scout、260 补给、8 AP。我 r1 用 scout 移动到 `cp_southwest` 完成占领（r1 `control_point_captured`，prevOwner null），并部署 2 heavy + 1 infantry（花费 255）；敌 r1 对称占 `cp_northeast`，部署 infantry + ranger + support（花费 203）。
- **经济节奏**：双方收入全程持平（各累计 **780**），我部署花费 **490**、敌 **570**——敌方买得更多（多 1 个 ranger + 支援），但把补给砸在了我后续优先点杀的脆皮远程上。
- **据点**：r3 敌侦察兵占湖心 `cp_isle`（维修 3、无收入），把"终局诱饵"提前捏在手里；我在 r9 夺回（见 §4）。`cp_west`/`cp_east` 出生基地全程归属各自，未被端掉，部署通道始终畅通。
- **炮火预警**：r5 首次 `artillery_warning`（safeRadius 6，36 格列入预警）。此时双方主力尚未贴脸，预警主要作用是提示外圈补给点（q=±4 一带）即将贬值。
- **首次接火**：r5 我以重甲 arc + ranger 锁定把敌 `(0,1)` ranger 打到 7HP 并于结算击杀（敌 ranger `unit_death` seq97 cause attack）；但我的 ranger 同轮被反击打掉（seq104）。这一"用 80 造价 ranger 换 80 造价 ranger"的开局交换，打断了敌方远程锁定链。

## 3. 缩圈期（round 6 起）
- **固定结算视角**：每轮按"部署→移动→攻击与净治疗→死亡/淘汰→占领→轮界炮火→收入维修"解释；`round_resolved.results` 中我 7 次 `missed` 全是预测格落空（非随机），敌方 28 次攻击 **0 落空**（预测/锁定极准）。
- **收缩与站位**：
  - r6 safeRadius 5：我击杀敌 `(0,0)` heavy（100），但己方 ed8dd2 重甲同轮阵亡（seq133 attack）——1 换 1 重甲，双方军力接近（满血造价估算 552 vs 535）。
  - r7 safeRadius 4：我 3576 infantry 滞留 `(-5,1)` 危险区吃 25 点炮火（seq140，HP→65），属"多留一回合换推进位"的主动承受。
  - r8 safeRadius 3：击杀敌 `(0,0)` ranger（80）；我方 7750 重甲在 `(0,-1)` 被攻击打掉（seq179，非炮火）。炮火此轮双方各 2–3 单位承伤。
  - r9 safeRadius 2：击杀敌 support `(1,-1)`（68），拔掉敌方治疗核心；同轮从敌手夺回 `cp_isle`（seq219），我 3576 重甲 line 补刀 support 得手。
  - r10 safeRadius 1（下限，中心 7 格）：击杀敌 scout `(1,0)`（42）；敌 1 个 scout 被炮火清场（seq230，无归属）。
- **形状与预测**：r4 我用 3 单位分步骤 arc 集火敌 ranger(0,1)+scout 的战术成型；`arc` 点击相邻格覆盖三格的设计，让重甲在中心混战中一击扫多个目标，是我能持续拿到击杀 credit 的核心。
- **destination_conflict**：r15 我与敌残血 heavy 同时抢 `(0,0)`，双方 move 均 `destination_conflict`（seq343/344），并各自触发后续 attack 的 `previous_action_failed`（seq345/346）——这是本局唯一一次双向误判型冲突，双方都浪费了 AP。

## 4. 终局（radius=1，r10–r16）
- **中心 7 格争夺**：r10 起只有 dist≤1 的 7 格安全。我把 230af6、7886、eb5158 等依次压入 `(0,1)/(-1,0)/(0,0)/(-1,1)`，用 arc 火力封锁敌接近路线；敌方多个 infantry/scout 滞留 dist 3–4 外圈，被 25/轮炮火磨成残血（r10–r12 敌 4 个单位死于 `cause: artillery`，无归属）。
- **军力反超**：满血造价估算敌在 r7 一度领先（632 vs 552），r8 后我靠多次击杀反超（r10 我 452 vs 敌 400），r12 敌只剩约 100 军力。
- **最后换血与打光**：
  - r11 我的 eb5158 infantry（seq274）与 7425 scout（seq277）先后被攻击击杀；敌方同时有 2 个 infantry 死于炮火。
  - r13 我的 d760 重甲死于炮火（seq307，`artillery`，无归属），7886 重甲被攻击打掉（seq321）。
  - r14–r15 敌我围绕 `(0,0)/(0,-1)` 反复拉扯，我 3 次预测攻击打空（r14 两次、r15 一次），敌残血 heavy 靠来回移动躲过致命一击。
  - r16 我终于锁定并击杀敌最后一个 heavy（seq363，cause attack，step 3，100 造价），敌 `army_destroyed` → `last_player_standing`，我胜。
- **注意**：终局我的多次落空是"attack 瞄准格、敌人移动后离开目标格"的典型同时回合博弈——只有配置 `attackLock` 的 ranger 才能追着锁定，而我的 ranger 已在 r5 阵亡，导致最后阶段只能拼预测命中率。

## 5. 裁决账本与击杀分
- **击杀造价（killValue）**：我 **605** = 8 次攻击击杀的 cost 之和（ranger80 + heavy100 + ranger80 + support68 + scout42 + infantry55 + ranger80 + heavy100）；敌 **477** = 我方 6 个阵亡单位的造价（ranger80 + heavy100 + heavy100 + infantry55 + scout42 + heavy100）。炮火击杀 5 个（敌 4、我 1）**无归属、不计分**。数字与 `game_over.payload.scores` 完全一致。
- **攻击账本**：我 26 命中 / 7 落空（命中率 78.8%）；敌 28 命中 / 0 落空。
- **炮火账本**：我承伤 **240**、1 个单位死于炮火；敌承伤 **440**、4 个单位死于炮火——敌方在外圈滞留的代价明显更高。
- **军力价值曲线**（满血造价估算，未按 HP 折损；仅供趋势参考）：我 242→497(r1)→577(r3)→497(r5)→552(r6)→452(r8)→452(r10)→355(r11)→155(r13)；敌 242→445→580(r3)→555→535→632(r7 峰值)→400(r10)→100(r12)→0(r16)。终局实际 `armyValue`：我 **48** / 敌 **0**。
- **AP/动作**：我各轮成功动作数 r1–r16 = 6/5/6/8/6/5/4/6/4/3/2/4/1/2/1/3。我方失败动作 5 次：r9 move `destination_occupied`、r13 move `destination_occupied`、r15 move `destination_conflict` + 关联 attack `previous_action_failed` ×2；均消耗 AP。敌方失败 11 次（含多次 `destination_occupied` 与 `previous_action_failed`），AP 浪费多于我。
- **据点/收入/部署**：据点流量与期末权重为 0（不构成裁决分），但 `cp_southwest`/`cp_northeast` 的 +12 收入与 `cp_west`/`cp_east` 的 +20 是爆兵来源；双方收入各 780，我部署 490、敌 570。
- **裁决分核对**（权重 armyValue 5 / killValue 1.5，其余 0）：
  - 我：48×5 + 605×1.5 + 据点流量项(0) = 240 + 907.5 + ... = game_over 总分 **1147.5**（据点快照 3、controlHold 2.47 因权重 0 不计入）
  - 敌：0×5 + 477×1.5 = 715.5 = game_over 总分 **715.5**
  - 分差 **432**，几乎全部来自击造价 + 终局存活军力。HQ 两项：**不适用（无 HQ）**，不填 0 冒充数据。

## 6. 经验教训（≥3 条，可执行）
1. **抢对角补给点优先于正面堆兵**：镜像图上 scout 移速 4 且能占点，r1 直接送 `cp_southwest` 拿 +12 收入与备用部署垫，成本仅 1 AP；下次遇到对称图，开局第一个动作就应派 scout 占对角补给点，而不是先动重甲。
2. **权重只有军力 + 击杀时，补给必须变单位**：`supplies` 权重 0，囤 260 补给=0 分。我把 255 转成军队、全程部署 490，建立早期军力优势；敌方虽花得更多（570），但买的是易被集火的 ranger/support，白送 killValue——**买什么比买多少更重要**。
3. **arc 扇面要摆在能吃多格的位置再开火**：重甲 arc 点击相邻格覆盖三格，中心混战里一台重甲能同时打 2–3 个敌人。每次开火前先算 `arc(from, aim)` 的覆盖格是否压住多个敌目标，避免单格空挥（我 7 次落空多是没算准敌人移动后的格）。
4. **攻击瞄准格而非单位，残血移动目标要靠 attackLock 或卡位**：终局敌 heavy 2HP 在 `(0,-1)/(0,0)` 之间来回移动，我因 ranger 早亡只能拼预测，r14/r15 连续打空。若保留一台 ranger 或用单位站住敌必经格逼其固定，可更早收掉，省 2–3 轮。
5. **缩圈外圈单位要提前一轮撤离或兑现价值**：`damage 25` 无视防御，敌人在 dist 3–4 滞留被炮火清掉 4 个单位（440 承伤），我也有 3576/d760 各吃满 25。预警出现后应立刻评估"多留一回合换的输出"是否抵得上 25 血，通常不值。
6. **双向 destination_conflict 会连锁作废攻击**：r15 双方抢同一格导致 move 失败、后续 attack 因 `previous_action_failed` 全部作废。排队时若预判目标格可能被对手同轮争抢，应改走空格或提前一步落位。

## 7. 与历史对局对比
- 对照 `tg_0180_win_OMP@mimo2.6flash.md`（`c8547716-...`，royale·snowflake·2 人，旧版本有效行动分口径）：那局为**零交战**局，双方各 51 动作、`executed` 全部成功、失败/落空/`destination_conflict` 全 0，胜负来自爆兵 + 行动分；本局则是**高烈度交战**局——我 33 次攻击（26 中 7 空）、双方合计 19 个 `unit_death`、killValue 605 vs 477，胜负几乎全由击杀造价决定。两局同属 royale 但地图与计分口径不同（snowflake 旧版含 `effectiveActions`，mirror-lake 本版仅 armyValue+killValue），不可直接横向比军力数字，仅作"royale 胜负可由爆兵或歼灭两种路径达成"的模式对照。
- 结论：**在有击杀权重的地图上，主动集火换子 >> 龟缩屯兵**。本局 432 分的分差几乎等于击杀差分（(605−477)×1.5=192）加上终局存活军力差（48×5=240），验证了这一路线。

## 总结
> **核心口诀：补给变军力、arc 扫多格、锁定点脆皮；缩圈前撤外圈，残血移动别硬猜格。**
> **一句话总结：靠 r1 抢补给点 + 全程把补给转成军队建立底子，用重甲扇面与 ranger 锁定持续点杀敌方远程与高价值单位，再借缩圈炮火放血敌方外圈，第 16 轮全歼敌军最后一个重甲，以 last_player_standing 拿下胜利。**
