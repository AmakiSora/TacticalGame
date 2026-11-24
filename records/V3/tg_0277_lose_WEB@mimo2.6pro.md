# tg_0276 镜湖终局围杀复盘（royale·镜湖 mirror-lake）

## 0. 局面概要

- gameId `17db3c98-c427-4227-8455-1291ac7df4ae` / 地图 `mirror-lake`（镜湖，半径 6、28 格水 + 12 格 blocker）/ 模式 `royale`（同时回合 × 歼灭缩圈）/ 2 人
- 我的席位 `player_a`（mimo2.6pro-WEB，AGENT `MIMO2.6PRO-WEB`@`mimo2.6pro`），终局 **rank 2 / eliminated**；对手 `player_b` Step5Preview-OMP（rank 1 / active，winner，reason `last_player_standing`）
- 终局 reason：`last_player_standing`（`game_over` seq 346），`player_eliminated`：`player_a`，`reason army_destroyed`，`eliminatedBy player_b`（seq 343，R14）；`removedUnitIds` 共 9 个单位
- 本局 artillery 配置：`startRound 6` / `intervalRounds 1` / `damage 25` / `minimumSafeRadius 1`；`actionsPerTurn 8`、`maxTurns 30`、`startingSupplies 260`、`baseIncome 20`；裁决权重 `armyValue 5` / `killValue 1.5`，HQ/据点/补给权重全 0（无 HQ，`headquarters: {}`）
- 开局：每家 2 heavy + 1 scout + 260 补给；我方 `cp_west(-5,0)` 出生据点、初始单位 heavy 9e95ec(-6,1)/cae8cd(-5,2) + scout 6ff1cf(-6,2)；对手 `cp_east(5,0)`、镜像部署。`turnOrder [player_a, player_b]`（仅同阶段平局用）。回放 `tg_0276_20261118.json`（`hex-v2-replay` schemaVersion 3.9.11，346 事件，`exportedAt 2026-11-18T11:10:36.963Z`），共 14 整轮，未到 30 轮上限
- 取证声明：全部数字/seq/坐标出自房主归档回放，未调 `/api/games/:id/events` 拼装、未写任何 `tg_*.json`；本局 `mode=royale`，按服务器 `review-royale.md` v1.2（并读 `review-simultaneous.md` / `review-annihilation.md` 合并口径）写作。无 `turn_skipped`/`host_force_resolve` 等管理干预

## 1. 结果一句话

对手把湖心维修点 `cp_isle` 变成前压部署基地（R7/R12 两次从湖心出重装贴脸），配合 R7 起的多重重装弧形火力压制我西岸主力，炮火缩圈又把我的南线援军烧成残血，R14 最后一个重装 9e95ec 在 (0,-1) 被对手 R12 落地的 9236a7 弧形一击带走（seq 339/340），我被打光淘汰（`army_destroyed`）。

## 2. 发育窗口（R1–R5，startRound=6 前）

- **爆兵与经济**：R1 我从 `cp_west` 部署步 73fb40(55)+游侠 08e771(80)+支援 6d547b(68)（三单位、203 补给），同时 2 heavy + 1 scout 三单位向中路推进；R2 再补 heavy 76cb0a(100)。对手 R1 部署重 209dc7(100)+游侠 889659(80)+步 1eb7a6(55)，R2 步 0da032(55)。双方 R2 起每轮收入 52（base 20 + 一个 supply 点 12），R1 我 scout 6ff1cf 占 `cp_southwest(-4,4)`、对手 scout e7867c 占 `cp_northeast(4,-4)`，镜像各 2 点。
- **湖心之失**：R2 对手 scout e7867c 一步跨湖心占下 `cp_isle(0,0)`（维修 3、无收入，`control_point_captured` seq 41）——这是全场唯一的维修点，还处在 R10 起缩到半径 1 后的正中心。我全程未反抢，等于让对手独占终局安全格 + 13 次维修（每次 +3HP）+ 两个部署出口（R7 468e7b、R12 9236a7 均从 `cp_isle` 出）。
- **首战（R3）**：我 9e95ec+cae8cd 双弧形瞄 (0,0) 互殴，集火打死对手探路 scout e7867c（R3 seq 57，+42 killValue）；但对手游侠 889659 锁定射击 + 步兵直线命中反伤我 45 点。R3 后期双方推进节奏一致：我 5 移 2 攻 1 落空，对手 5 移 2 攻。
- **R4–R5 中路对撞**：R4 双方 heavy 都想进 (0,0)（cae8cd vs a2756b），同一步 `destination_conflict` 双双作废（seq 72/73），各自后续攻击触发 `previous_action_failed` 作废——双向误判的典型对撞。R5 游侠换子：我 08e771(锁定 30)+cae8cd(弧形 36) 集火杀掉对手游侠 889659（seq 102，+80），但对手同轮 889659+1eb7a6 也杀掉我游侠 08e771（seq 103，−80）——等价互换。R5 炮火预警（`artillery_warning` seq 87，safeRadius 6、36 格警告环），此时我 5 单位全在 d≤3 内圈，无人需要撤离；对手 afad54 在 (5,-1) 尚未部署（R4 才出）。

## 3. 缩圈期（R6–R9，startRound=6 起）

- **R6（safeRadius 5）**：我 73fb40 再次与对手 a2756b 争 (0,0) 冲突作废（连续第 3 轮同一格冲突）；我 3 个弧形（9e95ec/76cb0a/cae8cd）集火 (1,-1) 杀掉对手步兵 1eb7a6（seq 134，+55）。对手 2 个直线反打我 76cb0a/6d547b。
- **R7（safeRadius 4）关键转折——湖心出兵**：对手从 `cp_isle` 部署 heavy 468e7b 到 (-1,0)，直接贴到我阵线脸上；其 a2756b 弧形 (0,0) 一击命中我 3 个单位（73fb40 35 + 76cb0a 29 + cae8cd 32 = 96 伤害）。我同轮在 `cp_southwest` 补 2 个 heavy（b64ad5(-4,3)、f8e112(-3,4)）——位置偏远，需要 3–4 轮才能进主战场。支援 6d547b 一次区域治疗回 70 点（21/28/21）。
- **R8（safeRadius 3）**：对手 4 个弧形（a2756b/468e7b/0da032/51b995）全开，一击扫我 73fb40/76cb0a/cae8cd/9e95ec，我 73fb40 死亡（seq 182，−55）；我 4 攻只杀伤 a2756b/468e7b。炮火首伤（`artillery_damage`）：对手 afad54 与我 b64ad5/f8e112 各 −25。
- **R9（safeRadius 2）**：互换重装——我杀对手 a2756b（seq 213，+100），对手杀我 76cb0a（seq 214，−100）。我 6ff1cf 从 (-3,0) 长途奔袭到 (1,0)，f8e112 移入 (0,0) 湖心，9e95ec 想进 (0,-1) 被己方/对方占位 `destination_occupied` 作废。R9–R10 炮火连伤：我 b64ad5 累计 −75（剩 40 血）、6ff1cf −25、对手 209dc7 −50、afad54 −50（剩 1 血）。

## 4. 终局（R10–R14，minimumSafeRadius=1 达成）

- **R10（safeRadius 1，终局圈形成）**：我 cae8cd 在 (1,-1) 被 0da032 直线击杀（seq 245，−100）——此后 `unit_gone` 连锁作废我 2 条后续动作。6ff1cf 移到 (1,0) 前压但被 51b995 反打 34。此时我只剩 5 单位（9e95ec/6ff1cf/6d547b/b64ad5/f8e112），对手 6 单位（含湖心 468e7b + 幸存 afad54 残血）。
- **R11 决定性互换**：对手 51b995 弧形 (0,0) 一击杀我 6ff1cf（36 伤害，seq 280，−42）+ 伤 f8e112 33；0da032 直线杀我支援 6d547b（seq 273，−68）——**治疗链断了**。我 9e95ec+f8e112 反杀对手湖心 468e7b（seq 272，+100），但同轮我 3 条动作因 `unit_gone` 作废。炮火杀对手 afad54（seq 259，`artillery` 死因，无归属不得分）。
- **R12**：我 f8e112 在 (0,0) 被 209dc7 弧形击杀（seq 303，−100）；我 9e95ec 与 b64ad5 双杀对手 0da032（seq 300，+55）。对手随即从 `cp_isle` 再部署 heavy 9236a7 到 (-1,1)（seq 312）——湖心第二波前压增援，直接进入 (0,-1) 攻击范围。
- **R13**：我 9e95ec 弧形 (0,0) 杀对手 51b995（seq 324，+100），但对手 9236a7 已移至 (-1,0)、209dc7 在 (1,0) 形成夹击；我 b64ad5 移入 (-1,1)。我 9e95ec 想进 (1,-1) 与 209dc7 撞车（R13 双 `destination_conflict`，seq 325/326）。
- **R14（game over）**：双方最后互击——我 9e95ec 弧形 (-1,0) 打 9236a7 29 伤害，对手 9236a7 弧形 (0,0) 打 9e95ec 32 致死（seq 339/340）。`player_a army_destroyed`（seq 343），`cp_west`/`cp_southwest` 中立（seq 341/342），`game_over` seq 346。对手存活 3 单位（armyValue 112 = 209dc7 重装 + 9236a7 重装残血 + 1 轻伤单位），胜于 `last_player_standing`。

## 5. 裁决账本与击杀分

权重：`enemyHqDamage 0 / ownHqHp 0 / controlPoint 0 / armyValue 5 / supplies 0 / killValue 1.5`（HQ 不适用，无 HQ；据点/补给权重 0，不构成裁决分）。

| 项目 | 我方 player_a | 对手 player_b | 权重 | 计入分 |
|---|---:|---:|---:|---:|
| HQ 伤害 / HQ HP | 不适用（无HQ） | 不适用（无HQ） | 0 | 0 |
| 据点（流量持有 / 期末） | 2.0 / 2 | 2.92 / 3 | 0 | 0 |
| 存活军力价值 | 0 | 112 | 5 | 0 / **560** |
| 剩余补给 | 433 | 378 | 0 | 0 |
| 击杀造价 killValue | 532（7 杀） | 745（9 杀） | 1.5 | **798** / **1117.5** |
| **总分（game_over）** | **798** | **1677.5** | — | — |

- killValue 核对（最后一击归属）：我杀 e7867c(scout 42)+889659(ranger 80)+1eb7a6(inf 55)+a2756b(heavy 100)+468e7b(heavy 100)+0da032(inf 55)+51b995(heavy 100)=**532** ✓；对手杀 08e771(ranger 80)+73fb40(inf 55)+76cb0a(heavy 100)+cae8cd(heavy 100)+6d547b(support 68)+6ff1cf(scout 42)+f8e112(heavy 100)+b64ad5(heavy 100)+9e95ec(heavy 100)=**745** ✓。炮火击杀（afad54，R11）无归属、双方不得分。
- 经济账：每轮收入 52×13 轮（R2–R14）=676 + 开局 260 = 936；我部署 6 次花 503（步 55+游侠 80+支援 68+重 100+重 100+重 100），剩余 433 ✓。对手部署 7 次花 558，剩余 378 ✓。
- 计划账本（`round_resolved` 汇总）：我 **85 条计划 / 69 executed / 16 非执行**（destination_conflict 4、destination_occupied 1、previous_action_failed 2、unit_gone 5、attack missed 4）；对手 80 / 59 / 21（conflict 4、occupied 6、previous 6、unit_gone 2、missed 3）。我攻击 24 命中 4 落空、治疗 4 成功 1 作废；对手攻击 26 命中 3 落空。
- 炮火账：我承伤 **5 次 175 点**（R8 b64ad5 −25、R9 6ff1cf −25 + b64ad5 −25、R10 b64ad5 −25、R11 b64ad5 −25、R12 b64ad5 −25）；对手承伤 **6 次 201 点**（afad54 4 次 −76 后被 R11 炮火击杀、209dc7 3 次 −75、51b995/209dc7 各 1 次）。双方都没被炮火清场（1 死亡均属对手 afad54）。

## 6. 经验教训（≥3 条，可执行）

1. **湖心维修点是终局钥匙，开局就该抢**：R2 里对手 scout 一步占 `cp_isle`，此后独享 13 次维修（+39HP）、2 次前压部署（468e7b/9236a7）和 R10 后的正中心安全格。我在 R1 就该派 scout 6ff1cf 走北栈道去占湖心，或至少 R3–R5 用 203 补给的爆兵窗口抢回。下次遇到 `mirror-lake`：**R1 部署清单里必须有一条 scout → cp_isle 的移动**，抢不到就至少站住对面栈道口阻止对方占。
2. **缩圈期不能补远兵**：R7 在 `cp_southwest` 补 2 个 heavy（−200 补给）时离主战场 3–4 格，R8 起连续被炮火 −25/轮烧成残血（b64ad5 累计 −100），还没接敌就被削弱。正确做法：缩圈期补兵只从**主战场相邻**的据点出（比如反抢湖心后从 `cp_isle` 出），或者把补给攒起来换集中一波；炮火 `damage 25` 是固定全额、无视防御，跟它换血永远亏。
3. **重复撞格要立刻换路**：R4/R5/R6 连续三轮我 73fb40 与对手 a2756b 都去争 (0,0)，每轮双 `destination_conflict` 作废 1 AP 并连锁 `previous_action_failed`——三轮浪费 3 个 AP 和 2 次攻击机会。看到对手也在推中路时，要么提前占格锁位，要么绕侧翼（东北/西南栈道）从夹角进，不要在同一个格子上赌先后。
4. **支援要活到最后**：R11 支援 6d547b 被 0da032 直线点杀后我方治疗链彻底断了，之后 3 轮残血单位只能硬扛。支援站位应在弧形火力覆盖的后排（比如 (-1,1) 湖心西侧），并把「敌方直线火力瞄向支援」当作撤退信号；失去支援 = 失去持续战能力。
5. **残血不要贪击、抢先打威胁最大的**：R13 我 9e95ec 想去 (1,-1) 撞车作废，失去先手被 9236a7+209dc7 夹击；若先在 (-1,0) 稳稳收掉 9236a7（残血），R14 或可拖到补刀。终局圈里 1 AP 都不能浪费。

> **核心口诀：湖心维修点是终局命门，缩圈期近点补兵、支援躲后排、撞格三次必换路。**
**一句话总结：对手靠湖心维修点两次前压增援 + 弧形火力压制赢下湖心决战，我在缩圈期补远兵被炮火烧残、支援被点杀，R14 最后一个重装被围杀而打光淘汰。**
