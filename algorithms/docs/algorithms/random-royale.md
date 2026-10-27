# random-royale — 大逃杀随机算法

> 单算法档案，遵循 `ALGORITHMS_NOTES.md` 固定模板。

## 身份与文件

| 项 | 内容 |
|---|---|
| 文件 | `algorithms/builtin/random-royale.mjs` |
| 算法名 | `random-royale` |
| 注册键 | `algo_random-royale` |
| 竞技场参与者 id | `algo_random-royale@v1` |
| 显示名称 | 大逃杀随机算法（Random Royale） |
| 定位 | 大逃杀模式的最弱基准算法，用于对照测试与模式冒烟 |
| 版本 | v1（3.8.10） |
| 实现日期 | 2026-10-28（3.8.10） |
| 语言 | JavaScript (ESM) |
| 接口类型 | 策略接口（`decide`） |
| 支持模式 | 仅大逃杀（royale） |

## 算法原理

大逃杀 = **同时回合 × 歼灭**：动作入队而非立即执行，全员提交后按行动点分步结算
（详见 `skill/royale.md`）。本条目每轮从所有合法**计划动作**中均匀随机选一个入队，
返回 `null` 即提交计划（end-turn），没有启发式或评估函数。

枚举层与同时随机算法 [`random-sim`](random-sim.md) 共用
`algorithms/lib/random-plan.mjs`——两者只差注册身份与模式声明，策略完全相同。

## 决策逻辑

每次 `decide` 调用：

### 0. 前置短路

- 无 `ctx.owner` 或无 `game.plan` → `null`；
- `plan.committed` 已含己方 → `null`（等结算）；
- `plan.myQueue.length >= balance.actionsPerTurn` → `null`（预算用尽）。

### 1. 攻击（按形状瞄准格子）

按 `config.units.<type>.attackShape` 镜像引擎的瞄准合法性：`single` 射程内、`line`
落在六向射线上、`arc` 仅相邻格；起点使用该单位在队列中的**投影站位**，因此支持
"先移动后攻击"。同一单位已排攻击数达到 `balance.attacksPerUnit`（默认 1）后不再枚举。

### 2. 治疗（瞄准格子）

支援兵按 `healShape` 瞄准受伤友军所在格；支援兵或覆盖格落在炮火危险区则跳过。

### 3. 移动

从投影站位做**只按地形**的 BFS（水/障碍挡路，单位/总部不挡路），排除己方队列已认领
的目的格与投影后仍被占据的格子。同一单位可以连续排多条移动。

### 4. 部署

己方可部署据点 × `config.units` 全兵种 × 相邻空地；补给预算扣减队列中已计划部署的
花费；起点或落点在炮火危险区内的部署不入队。

### 5. 随机选择

```javascript
if (allActions.length === 0) return null;  // 无合法计划动作，直接提交
return allActions[Math.floor(Math.random() * allActions.length)];
```

## 实现细节

- 所有枚举都镜像 `src/engine/planning.ts`：形状瞄准、攻击次数上限、队列前缀投影、
  地形寻路、部署预算扣减、炮火危险区——不依赖服务器拒绝来发现非法动作。
- 单步决策远低于 0.1 秒；无 rollout、无搜索。

## 验证

- `tests/algorithms/random.test.ts`：计划载荷形态（瞄格子）、已提交/队列已满/无座位
  短路；真实 `snowflake` 双人跑满 6 轮，双方入队动作零拒绝、轮次推进、炮火圈按预期
  收缩（种子 `20261028`）。
- `tests/algorithms/random-sim.test.ts` 覆盖同一枚举库的全部约束（形状瞄准、投影站位、
  目的格去重、部署预算、炮火过滤）。
- 大厅 bot 接口：大逃杀图可添加 `algo_random-royale`；标准/歼灭/同时回合图按注册模式
  被拒。

## 性能表现

暂无对局与标定（引擎 3.8.10，snowflake / narrow-road，0 局），不作为选型依据。作为
大逃杀模式的性能下界基准，任何有意义的大逃杀算法都应远胜于它。

## 兼容性

- **支持模式**：仅大逃杀（royale）
- **地图兼容性**：`snowflake`（2/3/6 人）、`narrow-road`（2 人）；无总部、炮火缩圈与
  出生于据点全部从 `config` / `game.artillery` / `controlPoints` 读取，实现不按 `mapId` 分支
- **运行环境**：Node.js ≥ 24，纯 JavaScript，无外部依赖

## 使用方式

前端：大逃杀图大厅「添加 AI → 算法脚本」选择「大逃杀随机算法」。

```bash
node algorithms/runner.mjs --algorithm random-royale \
  --url http://localhost:3100 --game <gameId> --token <playerToken> --side player_a
```

## 一句话总结

大逃杀随机算法 = 同时回合计划队列的均匀随机入队（与 random-sim 共用枚举库），独立注册
为 `algo_random-royale@v1`，是大逃杀模式当前唯一的内置基线。
