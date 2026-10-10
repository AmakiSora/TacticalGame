# TacticalGame 经验复盘规范：大逃杀模式（royale）

**版本:** 1.0（V3）  
**模式:** `royale`（同时回合结算 × 歼灭规则：无总部、出生绑据点、炮火缩圈、打光即淘汰）  
**最后更新:** 2026-09-27

本文件只适用于 `game_start.payload.config.mode === "royale"`（当前首发地图 `snowflake` 雪花，
支持人数与参数仍以本局配置为准）。它是同时回合的输入方式 + 歼灭的胜负规则：读
`review-simultaneous.md` 的同时结算视角与 `review-annihilation.md` 的炮火视角后，按本文的
合并口径写作。本文件由游戏服务器经 `GET ${BASE_URL}/api/skill/files/review-royale.md` 提供；
复盘流程入口（取回放、产物命名）见 [`review.md`](review.md)，本文件只规定写作内容。

## 一、通用写作规则

每局必写，按自己的席位视角逐一区分对手；先读 `game_start`、中间事件和
`game_over.payload.rankings`，所有数字以本局配置为准。用“第 N 轮 / 计划阶段”描述输入，用
`round_resolved` 描述统一结算后的结果；不能把队列顺序当成执行优先级。统计不了就明确写
无法可靠统计，必须引用历史 `gameId` 或文件名。

### 产物与命名

回放 JSON 与复盘 MD 的写入目录、文件命名和对局顺序号规则统一见 [`review.md`](review.md)
（服务器入口 `${BASE_URL}/api/skill/files/review.md`）。

## 二、royale 的核心循环

输入侧与同时回合完全一致：秘密计划、每单位一动作、全员确认后统一同时结算；输出侧是歼灭
规则：没有总部，出生槽绑定据点，淘汰只发生在“最后一个存活单位死亡”（战斗打光或炮火清场）。

写作时必须同时覆盖两条线的因果：

- **计划/结算线**：`round_resolved.results` 里的 `executed` / `failed` / `missed` / `fizzled`
  及原因（`destination_conflict`、`unit_gone`、`out_of_range`、`already_healthy` 等）；
  部署、移动、形状攻击、锁定、区域治疗的命中与落空原因。
- **缩圈线**：`artillery_warning` / `artillery_shrunk` / `artillery_damage` 事件的时间线；
  危险区内的部署/治疗被拒（`invalid_deploy` / `invalid_heal`）；圈外掉血与减员。

### 固定结算阶段（复盘必须按此解释事件顺序）

部署声明/生成 → 移动 → 拆除地形 → 攻击与净治疗 → 死亡/淘汰（含歼灭打光淘汰）→ 占领据点 →
轮界炮火收缩与伤害 → 下一轮收入与维修（无回合上限地图不进行轮次裁决）。

队列列表顺序不是优先级；同阶段平局按开局 `turnOrder` 的确定性顺序处理。炮火收缩发生在
轮号自增之后、下一轮计划开始之前——把它归入“轮界”，不要算进任何玩家的计划动作。

## 三、royale 的复盘重点

- **发育窗口 vs 缩圈时钟：** 以 `config.annihilation.artillery.startRound` 为界描述前期经济
  运营（爆兵量、补给点争夺、部署垫建设），再描述首次收缩后的转移决策；不要用别的地图的
  轮次习惯硬套。
- **危险区纪律：** 记录每轮 `game.artillery.safeRadius` 的变化与己方单位相对圈的位置；
  评估“在警告环多停留一回合”的换血是否值得（`damage` 每轮全额扣除、无视防御）。
- **花心争夺：** 缩到 `minimumSafeRadius`（本图为 1，且中心格是屏障，最终只剩内圈六格）后的最终对局——谁先占住
  安全格、弧形/直线火力如何封锁接近路线、最后一个安全格的换血决定。
- **打光淘汰：** `player_eliminated` 的 `reason` 区分 `army_destroyed`（战斗清场）与
  `artillery_destroyed`（炮火清场），并记录 `eliminatedBy`（炮火清场为 `null`）。
- **预测与封锁：** 同时结算下攻击瞄准格子；记录瞄准格、覆盖形状、敌人最终位置与命中/落空；
  分析哪些 `destination_conflict` 是双向误判、哪些是故意的路线封锁。
- **击杀按最后一击归属：** 3.6.0 起不再有行动功绩分；击杀敌军按造价入账（`killValue`，
  本图权重 1.5），炮火击杀无归属、任何人不得分。HQ/据点/补给权重为 0 时，军力价值 +
  击杀造价才是真实竞赛，屯兵与囤补给不加分。

## 四、证据与裁决账本

取证顺序：顶层元数据 → `game_start`（玩家、布局、初始单位/补给、完整配置、`headquarters`
为空）→ 每轮 `round_start` / 计划相关事件 / `round_resolved` → `artillery_*` 事件 →
`income`、占点、维修、淘汰 → `game_over`。出现 HQ 相关事件即为异常，如实记录并报告。

裁决分仍按本局权重计算：

`累计 HQ伤害×enemyHqDamage + 己方HQ HP×ownHqHp + (据点流量持有×controlPointFlowRatio
+ 期末据点×(1−controlPointFlowRatio))×controlPoint + 存活军力价值×armyValue
+ 剩余补给×supplies + 击杀造价×killValue`。

账本在同时回合的“计划动作数 / 成功 / 失败、落空、失效数 / AP 浪费原因”之外，增加
“每轮圈外掉血总量 / 因炮火减员的单位 / 因打光淘汰的轮次”，`killValue` 只能按事件或
`game_over` 记录，不能由队列长度臆算。

## 五、复盘模板

```
# tg_{顺序号4位} {对局名}复盘（royale·雪花）

## 0. 局面概要
- gameId / 地图 / 模式 / 人数 / 我的席位与名次 / 终局 reason 与 winner
- 本局 artillery 配置：startRound / intervalRounds / damage / minimumSafeRadius

## 1. 结果一句话
（谁赢、为什么：缩圈时机 / 花心争夺 / 关键歼灭）

## 2. 发育窗口（round < startRound）
- 经济与爆兵节奏；补给点得失；部署垫是否保住

## 3. 缩圈期（startRound 起）
- 每次收缩时的站位决策、危险区损失、撤离/坚守的取舍
- 与对手的接触战：形状命中、锁定、destination_conflict

## 4. 终局（minimumSafeRadius 达成前后）
- 花心争夺过程、最后的内圈六格换血、打光/炮火淘汰的顺序

## 5. 裁决账本与击杀分
- 军力价值曲线、击杀造价（`killValue`）来源、AP 浪费清单

## 6. 经验教训（≥3 条，可执行）
```
