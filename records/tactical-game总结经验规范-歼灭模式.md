# TacticalGame 经验复盘规范：歼灭模式

**版本:** 3.0（V3）  
**模式:** `annihilation`（无总部、炮火收缩、军队歼灭制）  
**最后更新:** 2026-08-25

本文件只适用于 `game_start.payload.config.mode === "annihilation"`。歼灭模式的第一原则是：**没有 HQ，不能写拆家、守 HQ 或 HQ 伤害。**

## 一、通用写作规则

每局必写，按自己的 `player_id` 视角写，逐一区分所有对手；所有数字以本局 `game_start`、事件和
`game_over.payload.rankings` 为准。使用“第 N 轮 / `player_x` 回合”定位顺序模式事件；引用事件类型和
`seq`，统计不了就明确说明。必须引用历史 `gameId` 或文件名，不能凭印象补数。

### V3 文件命名

复盘放在 `records/V3/`：回放为 `tg_{4位ID}_{YYYYMMDD}.json`；双人局用
`tg_{4位ID}_{win|lose|draw}_{AGENT}@{模型短名}.md`，多人局用
`tg_{4位ID}_rank{01-08}_{AGENT}@{模型短名}.md`。`AGENT` 全大写

## 二、歼灭模式判定与复盘重点

- 运行时不创建 HQ。玩家最后一个存活单位死亡时触发 `player_eliminated`，原因为 `army_destroyed`；记录被移除单位、据点中立和补给冻结。
- 只剩一名玩家时为 `last_player_standing`；若炮火等原因使所有剩余军队同轮死亡，按 `mutual_annihilation` 记录；达到最大整轮数仍按存活玩家的裁决分排名。
- **部署是据点行为：** 只能从己方控制的出生/前沿据点向相邻空白平地部署。记录来源据点、目标坐标、来源/目标当时是否在危险区，以及失去据点后部署和收入的影响。
- **炮火是硬约束：** 读取 `config.annihilation.artillery` 的 `startRound`、`intervalRounds`、`damage`、`minimumSafeRadius`；不要把某张地图的轮次习惯写成通用规则。
- 复盘重心从 HQ 攻防改为：单位存活率、集火交换、炮火撤离时机、据点收入/部署通道和最后军力价值。

### 每局必须回答的六个问题

1. 首次 `artillery_warning` 时外圈有多少单位，哪些应撤而未撤？
2. 每次 `artillery_shrunk` 前 `dangerCells`/`warningCells` 如何改变路线和占点优先级？
3. `artillery_damage` 的总承伤、击杀和死亡原因是什么，是否能通过提前移动避免？
4. 哪些据点既提供收入又提供部署来源；据点中立后损失了多少资源/增援选择？
5. 集火是否按“可击杀单位→高价值单位→占点单位”排序，交换比是否值得？
6. 轮数上限时六项裁决分中 HQ 项如何写“不适用（无HQ）”，其余分差来自哪里？

## 三、取证顺序与炮火账本

1. 顶层元数据；2. 首个 `game_start`（模式、出生据点/初始单位、地图、单位属性、补给、据点、最大轮数、权重和炮火配置）；
3. `income`、`deploy`、`move`、`attack`、`heal`、`control_point_captured`、`control_point_repair`、
`control_point_neutralized`、`player_eliminated`、`turn_skipped`、`round_end`；
4. 歼灭专属 `artillery_warning`、`artillery_shrunk`、`artillery_damage`；5. `game_over`。

时间线必须列 `safeRadius`、`dangerCells`、`warningCells`、`nextShrinkRound`（事件提供时），并将每次承伤/击杀对应到单位和坐标。

## 四、歼灭模式裁决与账本

按本局 `adjudicationWeights` 列出：

`HQ伤害（不适用，无HQ） + HQ HP（不适用，无HQ） + 据点数×controlPoint + 存活军力价值×armyValue + 剩余补给×supplies + actionScore`。

零权重项目也要写“权重0，不构成裁决分”，但仍分析其收入、部署和战略价值。另列炮火总承伤/击杀、各类单位死亡原因、部署花费和据点收入。

| 项目 | 数量/数值 | 权重 | 依据 |
|---|---:|---:|---|
| HQ伤害 / HQ最终HP | 不适用（无HQ） |  | `mode` |
| 最终据点数 |  |  | `control_point_captured` |
| 存活军力价值 |  |  | `game_over`/状态 |
| 剩余补给 |  |  | `income`、部署 |
| `actionScore` |  |  | 行动事件 |
| 炮火承伤/击杀 |  | — | 炮火事件（非独立裁决项） |
| **总分** |  | — | `game_over.payload.scores` |

## 五、复盘模板

```markdown
# 战术游戏歼灭模式复盘 — `{player_id}` 视角

**日期/游戏ID/回放版本:** YYYY-MM-DD / {gameId} / {schemaVersion}
**地图/参战人数:** {mapId} / {N}人；**模式:** annihilation
**玩家:** {玩家名}（{agent}@{模型名}）
**席位与出生:** `{player_id}`，初始单位/出生控制点 {坐标或ID}；HQ：不适用（无HQ）
**结果:** {🏆第1名/第N名/⚪平局} — `{last_player_standing|army_destroyed|mutual_annihilation|turn_limit_*}`
**结束轮次:** 第{N}/{maxTurns}整轮；**最终存活单位/补给:** {N} / {N}

## 最终排名与淘汰
| 名次 | 席位 | 状态 | 总分 | 军力价值 | 据点 | 主要死亡/优势原因 |
|---|---|---|---:|---:|---:|---|

## 炮火与安全区时间线
| 轮次 | safeRadius | warning/danger 关键格 | 我的单位位置 | 撤离/承伤/击杀 | 决策评价 |
|---|---:|---|---|---|---|

## 单位、据点和补给时间线
记录部署来源据点→目标坐标、移动/攻击/治疗、补给前后、行动点和对手席位响应。

## 核心教训与关键转折
至少3个转折；必须包含一次炮火预警后的撤离选择、一次集火交换、一次据点中立或部署通道变化。

## 炮火、军力与裁决分账本
按第四节逐项列权重；HQ两项写“不适用（无HQ）”，不要填0冒充可分析数据。

## 实际做法 vs 正确做法
非第一名至少列2个致命错误和触发条件；第一名也至少列2条风险或低效行动。

## 与历史对局对比
比较首次预警外圈单位数、各次收缩前未撤离数、炮火承伤/击杀、最终死亡原因、据点收入和排名。

## 总结
> **核心口诀：{例如“预警先撤离，保住据点才有下一波部署”}**
**一句话总结：{加粗的一句话}**
```

## 六、歼灭模式质量检查

- [ ] 文件命名和作者 agent/模型名正确，元数据、排名、结束原因与 `game_over` 一致。
- [ ] 全文没有把 HQ 当作单位、目标或得分项；HQ 两项均写“不适用（无HQ）”。
- [ ] 部署记录来源据点和目标格；没有据点时无法部署这一限制有被分析。
- [ ] 列出炮火配置、预警/收缩/伤害事件、安全半径、危险/预警格和每次撤离结果。
- [ ] 区分 `army_destroyed`、`last_player_standing`、`mutual_annihilation`、轮数裁决及房主管理淘汰。
- [ ] `turn_skipped` 或 `host_eliminated` 单独标注为房主管理干预，不归因于炮火或战术。
- [ ] 有炮火承伤/击杀、单位死亡原因、据点中立影响、收入支出和六项（含零权重）账本。
- [ ] 有历史对局、正确做法、触发条件和一句话总结；无法统计的项目没有编造数字。
