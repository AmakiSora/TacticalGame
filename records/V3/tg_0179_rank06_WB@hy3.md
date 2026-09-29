# tg_0179 雪花 royale 复盘（royale·snowflake）

> 复盘规范：`review.md` → `review-royale.md`（服务器 `GET /api/skill/files/*` 拉取，权威版）。
> 回放：`records/V3/tg_0179_20260929.json`（房主从观战页导出归档，agent 只读不写）。
> 本 MD 为唯一交付物，所有硬数字出自回放；对局中实时读取的游戏状态（与回放同源）用于定性/曲线描述，逐轮精确 armyValue 回放未逐格快照，已注明。

## 0. 局面概要

- **gameId**：`e5536499-1a81-4c14-b397-71217086b215`
- **地图 / 模式 / 人数**：`snowflake` / `royale`（同时回合结算 × 歼灭缩圈）/ 6 人
- **我的席位**：`player_f` / **Hy3-WB** / 出生槽 `slot_northwest` / `turnOrder` 2
- **名次**：**rank 6（最后一名，全场第一个被淘汰）**
- **终局**：winner = `player_c`（GLM5.3Flash-ZC），reason = `last_player_standing`
- **artillery 配置**（来自 `game_start.config.annihilation.artillery`）：
  `startRound: 6, intervalRounds: 1, damage: 25, minimumSafeRadius: 1`；初始 `safeRadius: 9`
- **起始补给**：6 人各 500（`resources`）

## 1. 结果一句话

我方（Hy3-WB）在第 13 轮被炮火全歼、成为**全场第一个淘汰者（rank 6）**；整局夺冠的是 player_c GLM5.3Flash-ZC（`last_player_standing`）。
雪花图我的**西北口袋完全隔离、全程零接触战**，10 个单位无一例外死于炮火——发育期（R1–R5）堆出的军力价值峰值一度全场第一，却没能转化为更长的存活，最终在缩圈中先于人一步归零。

## 2. 发育窗口（round < startRound=6）

- **经济与爆兵节奏**（每轮均为我亲自读状态后逐个调 API，未用代打脚本推理）：
  - R1：部署 3 个 heavy @ `(1,-8)(0,-9)(-1,-7)`，叠加起始 2 heavy + 1 scout；移动 scout `(0,-7)→(-1,-6)`、heavy `d1d12b (-1,-8)→(-2,-7)`、heavy `dbf7ce (1,-9)→(2,-9)`。
  - R2：部署 2 heavy @ `(0,-7)(-1,-8)`；移动 heavy `6617d3 (1,-8)→(2,-8)`、heavy `8a1962 (-1,-7)→(-2,-6)`。
  - R3：把 2 个 d9 重兵救援进 d8 —— `d1d12b (-2,-7)→(-1,-7)`、`e024ca (0,-9)→(0,-8)`（CP 格为 plain 可站立，已用引擎 `validation.ts` 核实）。
  - R4：补最后 1 heavy @ `(0,-9)`。
  - R5：补 1 infantry @ `(1,-8)`（最后一发部署，之后补给不足）。
  - 共 **部署 7 次**（6 heavy + 1 infantry），消耗约 655 补给，终局剩余 **285** 未花。
- **部署垫 / 站位**：R3 完成后把 5 个单位（scout + 4 heavy）pack 进最安全的 **d7/d8** 格；外圈留 4 个 d9/d10/d11 重兵（梳齿地形，d7 只能经 d8 到达且 d8 已满，无法再向低距收拢）。
- **关键约束**：R6 起 `dangerCells = d>8`，而我所有空白部署位都在 d9/d10（已危险），规则**禁止危险格部署** → R6 之后永远失去安全补兵能力，每回合只能空提交。

## 3. 缩圈期（startRound=6 起）

- **炮火时钟**（来自 `artillery_shrunk` 事件，`safeRadius →` 下一收缩轮，`dangerCells` 数）：
  `9→8`(R7, 54) `→7`(R8, 102) `→6`(R9, 144) `→5`(R10, 180) `→4`(R11, 210) `→3`(R12, 234) `→2`(R13, 252) `→1`(final=minimumSafeRadius, 264)。
  每轮边界对 `d>safeRadius` 格内单位扣 **25 HP（全额、无视防御）**。
- **我方危险区损失时间线（全部 `cause=artillery`，0 战斗）**：
  - R10：scout `5ceb9d @(-1,-6)`、infantry `96a98a @(1,-8)`
  - R11：heavy `dbf7ce @(2,-9)`、heavy `fe775b @(-1,-8)`、heavy `bbd6d5 @(0,-9)`
  - R12：heavy `d1d12b @(-1,-7)`、heavy `6617d3 @(2,-8)`、heavy `e024ca @(0,-8)`、heavy `8a1962 @(-2,-6)`
  - R13：heavy `d29386 @(0,-7)`（最后一个单位阵亡 → 触发 `player_eliminated reason=artillery_destroyed`）
  - **共 10 死，100% 炮火，0 次接触战**。
- **接触战（对手视角）**：本局 57 例单位死亡中 50 例炮火、仅 **7 例战斗死亡**（来自 34 次攻击事件）。攻击发生在东/东南/西/东北相邻口袋坐标（如 `(1,0)(2,-1)(0,1)(6,-2)`），即 player_d/e/b/c 之间 —— 这些相邻口袋**存在连通边界**，据此 d 被 b、b 被 c `army_destroyed` 淘汰。**我的西北口袋与西南（a）口袋纯靠炮火消耗，全程零攻击/拆除/治疗**。

## 4. 终局（minimumSafeRadius 达成前后）

- `safeRadius` 收到 1 时，仅中心相邻内圈格安全（中心为屏障不可达）。我方在 **R13 最后 1 个 heavy 阵亡 → `artillery_destroyed`（`eliminatedBy=null`）**，为**全场第一个淘汰（rank 6）**。
- 你 player_a（mimo2.6pro-OMP）随后也在 R13 被 `artillery_destroyed`（rank 5）。
- 后续淘汰顺序（回放 `player_eliminated`）：`player_d` `army_destroyed by player_b` → `player_e` `artillery_destroyed` → `player_b` `army_destroyed by player_c` → `player_c` 最后存活夺冠（rank 1）。
- **花心争夺**：我的隔离口袋无内圈可争，未参与最后安全格换血；花心博弈只在可接触口袋间发生。

## 5. 裁决账本与行动分

- **我方终局裁定**（`finalResult.scores.player_f`）：`armyValue: 0`（已淘汰）、`supplies: 285`、`actionScore: 70`、`controlPoints: 1`、`total: 70` → **rank 6**。
- **行动分来源**：`actionScore 70 = 7 次部署 × 10`（每次部署 +1 功绩，权重 10）；7 次移动记 0 功绩，符合"纯移动不加分"。无攻击/治疗功勋进账（隔离口袋无目标）。
- **军力价值曲线**（发育期峰值来自对局中实时读取的游戏状态，与回放同源；回放未逐格快照逐轮 armyValue，曲线方向由 R10–R13 共 10 例 artillery 死亡佐证）：R5 达峰值约 **842（全场第一）**，R6 843 见顶，随后随炮火逐轮单调下降至 R13 归零。
- **AP 浪费清单**：R6+ 每轮空提交（无安全部署位、无有益移动），无 actionMerit 进账；R5 那发 infantry（55）占了一个 d9 格且 R10 早死，性价比低于把该格留给更耐打的重兵或干脆留补给。

## 6. 经验教训（可执行）

1. **发育期把单位压进最低距格是 snowflake royale 唯一有效防御**：d7/d8 已 pack 的 5 单位比外圈多活 2–3 轮。开局应更激进、更早把可移动单位向中心（低 d）收拢，而非等 R3 才救 2 个 d9 重兵——那 2 个若 R1 就压进 d8 可多撑一轮。
2. **危险格禁部署使 R6+ 完全失去补兵能力**：发育窗口只有 R1–R5 共 5 轮，必须把补给尽量转成"低距重兵"，不要留 285 补给没花；低距格应优先给高 HP 重兵（heavy 140），避免用 infantry/scout 占宝贵低距位。
3. **雪花图口袋并非全隔离**：我坐的西北口袋与西南纯炮火，但东/东南/西/东北相邻口袋有接触战（7 例战斗死亡、d/b 被 `army_destroyed`）。出生在可接触口袋时，缩圈期的"炮火换血 + 攻击封锁"双线才是胜负手；隔离口袋只能赌"比别人多活一轮"，容错极低。
4. **判定规则 = `last_player_standing`**（`maxTurns=null`，分数仅作 tiebreak）：隔离口袋策略下胜负完全取决于"谁的单位总 HP 池在缩圈中撑最久"。应 stack 高 HP 重兵、尽量把每个低距格都填满重兵，并让补给在窗口内打满（每次部署白赚 10 行动分）。
5. **行动分只来自有功绩动作**：本局我 70 分全来自 7 次部署，移动 0 分。隔离口袋无攻击可打时，发育期的每一次部署都是确定收益，更应在 5 轮窗口内打满、不浪费。
