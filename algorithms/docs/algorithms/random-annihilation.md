# random-annihilation — 歼灭随机算法

> 单算法档案，遵循 `ALGORITHMS_NOTES.md` 固定模板。

## 身份与文件

| 项 | 内容 |
|---|---|
| 文件 | `algorithms/builtin/random-annihilation.mjs` |
| 算法名 | `random-annihilation` |
| 注册键 | `algo_random-annihilation` |
| 竞技场参与者 id | `algo_random-annihilation@v1` |
| 显示名称 | 歼灭随机算法（Random Annihilation） |
| 定位 | 歼灭模式的最弱基准算法，用于对照测试与模式冒烟 |
| 版本 | v1（3.8.10） |
| 实现日期 | 2026-10-28（3.8.10） |
| 语言 | JavaScript (ESM) |
| 接口类型 | 策略接口（`decide`） |
| 支持模式 | 仅歼灭（annihilation） |

## 算法原理

与标准模式的 [`random`](random.md) 同一策略：每步从所有合法动作中均匀随机选一个
立即执行，返回 `null` 结束回合。区别只在合法性镜像——歼灭模式有炮火缩圈，引擎会
拒绝危险区内的部署与治疗；本条目按同一口径把这些动作从候选里剔除，避免把必被拒绝
的动作发给服务器（runner 在轮流模式收到拒绝会提前结束整个回合，见
`algorithms/lib/interfaces.mjs`）。

## 决策逻辑

每次 `decide` 收集四类候选：

1. **攻击**：未行动单位 × 射程内敌方单位/总部，载荷按目标 id（`targetId`）；
2. **治疗**：支援兵 × 受伤友军，射程取 `config.units.<type>.healRange ?? attackRange`。
   **支援兵或目标任一在 `game.artillery.dangerCells` 内则跳过**（引擎 `invalid_heal`）；
3. **移动**：地形 BFS 可达格，**不**过滤危险区——引擎允许走进炮火区，伤害只在轮界
   结算，随机基线不做避险优化；
4. **部署**：可部署源（己方据点；歼灭无总部）× 兵种 × 相邻空平地。**起点或落点在
   危险区内则跳过**（引擎 `invalid_deploy`）。

以上候选均匀随机取一个；没有候选则结束回合。

## 实现细节

- 枚举器在 `algorithms/lib/random-turn.mjs`，与 `random` 共用；炮火过滤统一走
  `utils.inArtilleryDanger(game, pos)`，无炮火时恒 false，因此共用不会改变标准模式行为。
- 复杂度与 random 相同：O(己方单位×敌方目标 + 单位×可达格)，单步决策远低于 0.1 秒。
- 不做任何强度层面的优化：走进危险区、在危险区结束回合都是允许的随机选择——基线本意。

## 验证

- `tests/algorithms/random.test.ts`：炮火区部署起点/落点、治疗支援兵/目标的过滤，
  以及「走进危险区仍合法」的对照用例。
- 真实 `artillery-zone` 双人整局（种子 `20261028`）：算法席位的每个动作都被引擎接受
  （零非法），对局正常完赛。
- 大厅 bot 接口：歼灭图可添加 `algo_random-annihilation`；标准/大逃杀图按注册模式被拒。

## 性能表现

暂无对局与标定（引擎 3.8.10，artillery-zone，0 局），不作为选型依据。作为歼灭模式的
性能下界基准，任何有意义的歼灭算法都应远胜于它。

## 兼容性

- **支持模式**：仅歼灭（annihilation）
- **地图兼容性**：`artillery-zone`；炮火参数全部读 `game.artillery` 与
  `config.annihilation`，实现不按 `mapId` 分支
- **运行环境**：Node.js ≥ 24，纯 JavaScript，无外部依赖

## 使用方式

前端：歼灭图大厅「添加 AI → 算法脚本」选择「歼灭随机算法」。

```bash
node algorithms/runner.mjs --algorithm random-annihilation \
  --url http://localhost:3100 --game <gameId> --token <playerToken> --side player_a
```

## 一句话总结

歼灭随机算法 = 标准 random 的轮流枚举 + 炮火区部署/治疗过滤，独立注册为
`algo_random-annihilation@v1`，是歼灭模式当前唯一的内置基线。
