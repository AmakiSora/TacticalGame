# 算法 AI 开发笔记

> 本文档记录所有算法 AI 的设计、实现和性能变化。
>
> **维护口径（2026-10-24，对应 3.8.3）**：前半部分是当前规范；标为“历史标定”的表格只用于追溯，不代表当前强度。性能表必须带引擎版本、地图池、harness、局数与日期，否则不得作为选型依据。

算法 AI 是基于规则、搜索和启发式的 JavaScript 决策模块，无需训练模型即可运行。与强化学习模型相比，算法 AI 的优势在于开发迅速、可解释性强、无需 GPU，但性能上限受限于人工设计的策略质量。

## 阅读须知：当前口径

| 项目 | 当前值 |
|---|---|
| 代码版本 | 3.8.3 |
| 标准图池 | `default` / `breach` / `danger-close` / `dual-lanes` / `multiplayer-ring` / `whirlpool` |
| 同时回合图 | `standoff` / `molten-throne` |
| 大逃杀图 | `snowflake` / `narrow-road`（暂无内置算法） |
| 歼灭图 | `artillery-zone`（暂无内置算法） |
| 同时回合规则 | 3.8.0 起按行动点**分步结算**，不是“一单位一轮一动作” |
| 裁决分 | 3.6.0 起为击杀价值 + 据点流量制 |
| 已退役地图 | `forge` → `molten-throne`（3.5.11，同时回合）、`desert`（3.5.8 下线）、`four-corners`（3.5.7 下线） |

写作规则：

- 只有标为“当前快照”的表可用于选型；标为“历史标定”的表只用于回归追踪。
- 不同模式、不同 harness（真实引擎 / 镜像裁判）、不同地图池的数字不可直接比较。
- 单图胜率不可外推；至少 3 张图 × 30 局、逐局交替先手，6 局不构成结论。
- 同时回合的镜像模拟器必须注明适配的引擎版本；3.8.0 前后的结果不能混在一张表里。
- 算法升版必须在单算法档案写 `vN → vN+1` 的改动清单与同口径提升幅度；没有数据就写“暂无同口径对照”，不能只写“优化”。

## 目录结构

```
algorithms/
├── builtin/              # 内置算法实现
│   ├── greedy.mjs        # 贪心算法（标准模式）
│   ├── random.mjs        # 随机算法（标准模式）
│   ├── mcts.mjs          # 蒙特卡洛树搜索（标准模式）
│   ├── threat.mjs        # 威胁感知算法（标准模式）
│   ├── field.mjs         # 势场算法（标准模式）
│   ├── verdict.mjs       # 裁决线算法（标准模式）
│   ├── random-sim.mjs    # 同时随机算法（同时回合模式）
│   ├── dest-prob.mjs     # 落点概率算法（同时回合模式）
│   ├── kriegspiel.mjs    # 兵棋推演算法（同时回合模式）
│   ├── matrix-eq.mjs     # 矩阵均衡算法（同时回合模式）
│   ├── prism.mjs         # 棱镜算法（同时回合模式）
│   └── README.md         # 算法开发指南
├── lib/                  # 共享工具库
│   ├── api-client.mjs    # REST API 客户端
│   ├── game-utils.mjs    # 游戏工具函数
│   └── interfaces.mjs    # 算法接口适配器
├── docs/                 # 算法文档
│   ├── ALGORITHMS_NOTES.md   # 本文件
│   ├── RELEASE_NOTES.md      # 版本发布记录
│   └── algorithms/           # 单算法详细档案
│       ├── greedy.md
│       ├── random.md
│       ├── mcts.md
│       ├── threat.md
│       ├── field.md
│       ├── verdict.md
│       ├── random-sim.md
│       ├── dest-prob.md
│       ├── kriegspiel.md
│       ├── matrix-eq.md
│       └── prism.md
├── registry.mjs          # 算法注册表与 ALGORITHM_META
├── registry.d.mts        # 注册表 TypeScript 类型声明
└── runner.mjs            # 通用运行器
```

## 算法接口

所有算法必须实现 `decide` 或 `playTurn` 之一。算法按对局模式注册（`ALGORITHM_META.modes`，缺省视为 `['standard']`），不同模式不能混用——大厅 bot 接口、runner、评估链路都会按注册表校验，模式不匹配一律拒绝。

### 策略接口（推荐）

适合简单算法，每次返回一个动作：

```javascript
export default {
  name: 'algorithm_name',
  description: '算法描述',

  async decide(gameState, utils, ctx) {
    // gameState: 完整游戏状态
    // utils: 工具函数集合（见下文）
    // ctx.owner: 算法座位（同时回合/大逃杀没有 turn.currentPlayerId，座位只能从这里拿）
    // 返回 { type: 'attack', payload: {...} } 或 null（结束回合；同时模式 = 提交计划）
  }
}
```

### 完整控制接口

适合需要全局规划的复杂算法：

```javascript
export default {
  name: 'algorithm_name',
  description: '算法描述',

  async playTurn(gameState, apiClient, utils) {
    // apiClient: REST API 调用封装
    // 自己负责整个回合的所有动作
  }
}
```

> **限制**：`runAlgorithm` 只向 `playTurn` 传三个参数，没有 `ctx`；同时回合/大逃杀没有 `turn.currentPlayerId`，因此 `playTurn` 目前只适合标准模式。需要在计划模式运行的算法必须实现 `decide`。

### 动作类型

| `type` | `payload` | 适用模式 | 说明 |
|---|---|---|---|
| `attack` | `{ attackerId, targetId }` | 标准 | 按目标 id |
| `attack` | `{ attackerId, q, r }` | 同时回合 / 大逃杀 | 瞄准格子，形状由 `attackShape` 决定 |
| `heal` | `{ supportId, targetId }` | 标准 | 按目标 id |
| `heal` | `{ supportId, q, r }` | 同时回合 / 大逃杀 | 瞄准格子，覆盖格上的受伤友军各自结算 |
| `move` | `{ unitId, q, r }` | 全部 | 移动 |
| `deploy` | `{ unitType, fromId, q, r }` | 全部 | 从总部/据点部署 |
| `demolish` | `{ unitId, q, r }` | 全部 | 拆除障碍 |
| `wait` | `{}` | 同时回合 / 大逃杀 | 3.8.0 新增，消耗 1 行动点，用于对齐行动点 |

> `decide` 返回 `null` 的语义是**结束整个回合**；同时回合/大逃杀模式下等于提交计划并锁定。
>
> 当前实现（3.8.x 适配）已在 `algorithms/lib/api-client.mjs` 增加 `wait()`，并在 `interfaces.mjs` 的 `decide` 分发中补上 `case 'wait'`；`decide` 返回 `{ type: 'wait', payload: {} }` 会调用 `POST /api/games/:id/plan/wait`。

### 同时回合计划语义（3.8.0 起）

- 队列顺序就是行动点顺序：所有玩家的第 1 条动作同时结算完成后，再结算第 2 条，依此类推。
- 同一单位可以在多个行动点连续行动（移动→攻击→再移动）；每个行动点每人仍只能执行一条动作。
- 队列长度即行动点用量，上限为 `config.balance.actionsPerTurn`；`plan.myQueue` 是己方队列。
- 每单位每轮攻击次数受 `config.balance.attacksPerUnit` 限制（默认 1）；超出返回 `attack_limit_reached`。
- `wait` 消耗 1 行动点，用于把关键动作对齐到更晚的行动点。
- 移动/部署目的格是否被占用延迟到结算时判定；同一步允许“先移出、再移入”，移动失败会触发后续动作的级联作废。
- `end-turn` 表示提交并锁定；`POST /plan/revoke`、`POST /plan/clear`、`POST /plan/reorder` 分别撤回、清空、原子重排。
- 结算结果 `round_resolved.steps` 与动作事件都带 `step` 字段（与 `actionsUsed` 一致）。

### 注册、版本与模式

注册表 `algorithms/registry.mjs` 是展示名、描述、版本与支持模式的唯一来源：

```javascript
export const ALGORITHM_META = {
  'algorithm_name': {
    displayName: '算法中文名',
    description: '一句话描述',
    version: 'v1',
    modes: ['standard'], // standard / simultaneous / royale / annihilation
  },
};
```

- `modes` 缺省为 `['standard']`；大厅 bot 接口、runner、`rl/training/local-worker.ts`、`rl/evaluation/round_robin.py` 与 `/api/arena/participants` 都按它校验/过滤。
- `version` 是算法的“当前版本”标注。算法行为被改进后应升版（如 `v1` → `v2`）；竞技场参与者 id 是 `algo_<name>@<version>`，历史对局仍归属旧版本 id。
- 升版时必须按下面的“版本升级的文档要求”更新单算法档案，不能只改代码和 `version`。
- 线上 bot type 是 `algo_<name>`，永远指向当前实现；`src/api/bots.ts` 的 `ALGORITHM_BOTS` 由注册表自动生成，前端下拉从 `/api/algorithms` 动态拉取。**不要再手工维护第二份算法清单。**
- 若旧版本实现不再保留，需要像模型退役一样显式处理旧版本 id，否则历史对局会因“未知参与者”被榜单过滤。

### 版本升级的文档要求（强制）

算法从 `vN` 升到 `vN+1` 时，必须在对应档案 `algorithms/docs/algorithms/<name>.md`（即该算法的“算法.md”）中增加 `## vN → vN+1：<主题>` 一节，至少包含：

1. **改动清单**：按模块写清规则镜像、搜索/评估、动作生成、参数、接口适配的变化；不能只写“优化了性能”。
2. **同口径对照**：同引擎版本、同地图池、同种子与局数的 `vN` vs `vN+1` 表；至少列胜率，建议同时给平均裁定分、击杀、回合数、决策耗时。
3. **提升幅度**：用绝对值和百分点/比值表示，例如 `对 dest-prob：63.3% → 86.7%（+23.4pp）`。跨 harness 或跨规则版本不可直接相减时，必须写明“不可相减”，并给出同一 harness 下的替代指标。
4. **代价与边界**：决策耗时、内存、非法动作、已知短板的变化；没有提升或负提升也要如实写。
5. **样本边界**：引擎版本、地图池、局数、是否镜像裁判；6 局或退役地图不构成版本提升结论。

没有同口径前代数据时，写“暂无同口径对照”并说明原因与补测计划；**不得省略本节，也不得用不同 harness 的数字冒充提升幅度**。

当前示例：`algorithms/docs/algorithms/kriegspiel.md`、`matrix-eq.md` 与 `random-sim.md` 的“v1 → v2：3.8.0 分步引擎适配”三节均已按（改动清单 / 同口径对照 / 提升幅度 / 代价与边界 / 样本边界）五个子节组织。其中 `kriegspiel.md` 的同口径对照含 v1 基线在 3.8.1 引擎上的重跑（4 对手 ×2 图 ×30 局，同种子）与 v1↔v2 直接对打，并如实记录了**负提升**（molten-throne 对 matrix-eq 6:24 → 2:28）与**未达显著**（对打 35:25，p=0.245）。

### 3.8 同时回合适配状态

| 算法 | 计划语义 | 当前状态 |
|---|---|---|
| `random-sim` | 同单位多动作、队列投影、`attacksPerUnit` | **v2 已适配（3.8.1）**，作为同时回合基线 |
| `dest-prob` | v2 按队列前缀投影 + 地形寻路 + `attacksPerUnit` 生成计划 | **v2 已适配（3.8.1）**：同 harness 对 v1 50/60（83.3%）、对 random-sim 60/60；对 kriegspiel v2 21/60、对 matrix-eq v2 23/60（各 30 局/图抽样）；v1 的旧规则 100:0 只代表旧规则 |
| `kriegspiel` | v2 镜像 `src/engine/simultaneousResolve.ts` 的分步结算 | **v2 已适配并完成 3.8 真实引擎标定**（分步语义、`wait`、`demolish`、`attacksPerUnit`）：与引擎逐点对拍 40 局面零偏差；两图各 30 局 ×3 对手共 180 局零非法；旧 3.7 数据只代表旧规则 |
| `matrix-eq` | v2 镜像 `src/engine/simultaneousResolve.ts` 的分步结算 | **v2 已适配**并按 3.8 镜像裁判标定；真实服务器口径待验证 |
| `prism` | 整轮联合队列束搜索；四情境分别镜像分步结算；缓存整轮计划 | **v1（3.8.3）**：真实引擎双人两图整局零非法、standoff 三人四轮零非法；竞技场 4 对手 ×2 图 ×24 局共 192 局 **181:11**（standoff 96:0、molten-throne 85:11，评分 1977）；换座冒烟 14:0（7 组 ×2 局，小样本不作强度结论） |

> `dest-prob` v2 已完成 3.8.1 分步引擎适配：同 harness、同种子对 v1 为 **50/60（83.3%）**（standoff 30/30、molten-throne 20/30），对 random-sim 两图各 30 局全胜；对 kriegspiel v2 抽样 21/60（35.0%）、对 matrix-eq v2 23/60（38.3%）——后两者是 30 局/图抽样，且 kriegspiel 用真实引擎 harness、matrix-eq 的数字口径需按档案标注。**不要把 v1 的旧 100:0 写入当前强度结论**：旧规则与 3.8 分步引擎不可比较。`kriegspiel` v2 的 `destination_occupied` 短板（17.1–23.1 次/局）仍是它自己的已知问题，不应归因给 dest-prob；dest-prob v2 的结算失败约 1.3–3.4/局。

## 工具函数（utils）

`algorithms/lib/game-utils.mjs` 提供以下函数：

| 函数 | 功能 |
|---|---|
| `hexDistance(a, b)` | 六边形距离计算 |
| `neighbors(pos)` | 相邻六格 |
| `isPlayable(game, pos)` | 格子是否在地图可玩区域内 |
| `terrainAt(game, pos)` | 地形类型（plain / water / blocker） |
| `occupantAt(game, pos)` | 格子上的单位或总部 |
| `isEmptyPlain(game, pos)` | 是否为空的平地 |
| `reachableCells(game, unit)` | 单位可移动范围（BFS，单位/总部挡路；标准模式口径） |
| `livingUnits(game, owner)` | 存活单位列表 |
| `activeSeats(game)` | 活跃玩家席位 |
| `enemySeats(game, owner)` | 敌方席位 |
| `scoreTarget(target)` | 目标优先级评分（标准模式攻击排序） |
| `enemyTargets(game, owner)` | 敌方目标（单位 + 总部） |
| `bestAttackTarget(game, owner, unit)` | 射程内最佳攻击目标 |
| `nearestEnemyHeadquarters(game, owner, from)` | 最近存活敌方总部 |
| `controlPriority(game, cp)` | 据点优先级 |
| `cpKindEffect(game, point)` | 据点类型效果（收入/折扣/维修/部署开关） |
| `movementGoal(game, owner, unit)` | 移动目标位置（标准模式） |
| `deployOrigins(game, owner)` | 部署源（遵守 `deployFromHq` 与 `canDeploy`） |
| `effectiveDeployCost(game, type, origin)` | 考虑据点折扣后的部署费用 |
| `actionsRemaining(game)` | 剩余行动点（标准模式；同时回合用队列长度/`actionsPerTurn`） |
| `deployDecision(game, owner)` | 共用部署决策（threat/mcts/field/verdict 已接入） |

> 同时回合的计划期寻路只按地形，不把单位/总部当障碍；不要直接用 `reachableCells` 的“单位挡路”口径推导计划队列。计划模式请按 `src/engine/planning.ts` 的前缀投影语义实现。

## 算法清单

| 算法 | 模式 | 版本 | 类型 | 复杂度 | 强度 / 状态 | 用途 |
|---|---|---|---|---|---|---|
| **random** | standard | v1 | 随机 | O(n) | arena 756 / 1.3%（2026-10-21 UTC） | 基准对照、测试 |
| **greedy** | standard | v1 | 启发式 | O(n²) | arena 1761 / 77.5%；历史 vs random 100% | 快速决策、基准线 |
| **mcts** | standard | v1 | 搜索 | O(b^d · k) | arena 1631 / 64.1%；历史 vs greedy 25% | 战术推演、对比实验 |
| **threat** | standard | v1 | 效用/影响图 | O(单位×格子) | arena 1778 / 79.1%；历史 vs greedy 70.6%（3.5.x 7 图） | 走位稳健的对战、教学 |
| **field** | standard | v1 | 势场/梯度下降 | O(单位×格子) | arena 1753 / 76.8%；历史 vs greedy 64.3%；danger-close 强项、multiplayer-ring 短板 | 涌现式走位、慢节奏消耗战 |
| **verdict** | standard | v1 | 反向规划/期限排程 | O(单位×格子 + 排程回合) | arena 1933 / 90.1%（该快照 standard 第一）；历史 vs greedy 95.7% | 裁决分统一计价、预算内斩首、守成与回防 |
| **random-sim** | simultaneous | v2 | 随机 | O(n) | v2 已适配分步引擎；同时回合基线（无同口径强度标定） | 基线对照、模式隔离冒烟 |
| **dest-prob** | simultaneous | v2 | 对手建模/预测评估 | O(敌军×可达格×覆盖格 + 己方单位×瞄准格) | 3.8.1 真实引擎同 harness（30 局/图，2026-10-23）：对 v1 **50/60（83.3%）**、对 random-sim **60/60**；对 kriegspiel v2 21/60、对 matrix-eq v2 23/60（抽样） | 预测射击、冲突规避、分步队列投影样例 |
| **kriegspiel** | simultaneous | v2 | 分步结算 rollout + 有序计划联合搜索 | O(行动点×候选×种子计划×rollouts×分步结算) | 3.8.1 真实引擎标定（standoff / molten-throne 各 30 局 ×3 对手，2026-10-23）：60:0 vs random-sim、52:8（86.7%，p<0.0001）vs dest-prob v1、29:31 vs matrix-eq v2（standoff 27:3 / molten-throne **2:28**，斩首短板；合计 p=0.90 不可用，必须按图拆）；与引擎逐点对拍 40 局面零偏差；180 局零非法；`decide` 45–169ms（v1 的 15–40 倍）。**同 harness 同种子的 v1 基线**：vs dest-prob 43.3%、vs matrix-eq 31.7%，即适配带来 +43.4pp / +16.6pp；但 v1↔v2 直接对打 35:25（p=0.245）**未达显著**，且 v2 结算期失败 17.1–23.1/局远高于 v1 的 1.3/局（`destination_occupied` 未修） | 同时回合搜索型内置、分步结算语义参考镜像 |
| **matrix-eq** | simultaneous | v2 | 矩阵博弈/CFR 均衡 | O(我方计划×敌方场景×单轮结算 + 迭代) | 3.8 镜像裁判：23:7 vs v1、12:18 vs kriegspiel **v1**、13:17 vs dest-prob、30:0 vs random-sim；真实引擎待验证（3.8.1 真实引擎口径下被 kriegspiel v2 在 standoff 打到 3:27、在 molten-throne 反打 28:2） | 博弈论混合策略样例 |
| **prism** | simultaneous | v1 | 多情境束搜索 + 同步结算镜像 | O(束宽×候选×情境×行动点×单步结算) | 3.8.3 竞技场 4 对手 ×2 图 ×24 局共 **192 局 181:11**（standoff 96:0、molten-throne 85:11；同时榜评分 1977）；真实引擎换座冒烟 14:0（horizon 8:0、matrix-eq 4:0、kriegspiel 2:0；**7 组 ×2 局，仅接口/强度冒烟**）；双人两图整局、三人四轮零非法 | 通用整轮联合规划、风险约束选型 |

> 表中 standard 行的 arena 数字来自 `public/data/arena-leaderboard.json`（2026-10-21 UTC 生成，standard，36,000 局，300 对，每人 2,880 局）；simultaneous 行的 3.8.3 评分 1977 来自同时回合分区（480 局，2026-10-24 生成）。评分是 Bradley-Terry 混合池，胜率包含不同对手，不能与单图对拍数字直接比较；模式之间也不可混比。
>
> 历史数字采集于 3.5.x 地图池与 3.6.0 之前的裁决分口径；`forge`、`desert` 已不在当前池，详见“历史标定”。

### 模式覆盖

| 模式 | 内置算法数 | 算法 |
|---|---:|---|
| standard | 6 | random / greedy / mcts / threat / field / verdict |
| simultaneous | 5 | random-sim / dest-prob / kriegspiel / matrix-eq / prism |
| annihilation | 0 | — |
| royale | 0 | — |

> 歼灭与大逃杀目前没有内置算法；这是当前最大的模式空白，优先于继续打磨 2 人标准图。

## 当前强度快照（standard，2026-10-21 UTC）

| 参与者 | 类型 | 评分 | 胜率 | 局数 |
|---|---|---:|---:|---:|
| `algo_verdict@v1` | 算法 | **1933** | **90.1%** | 2,880 |
| `algo_threat@v1` | 算法 | 1778 | 79.1% | 2,880 |
| `algo_greedy@v1` | 算法 | 1761 | 77.5% | 2,880 |
| `algo_field@v1` | 算法 | 1753 | 76.8% | 2,880 |
| `hex_ppo_v3.1.1_20260911_8.8M.zip` | 模型 | 1660 | 67.3% | 2,880 |
| `algo_mcts@v1` | 算法 | 1631 | 64.1% | 2,880 |
| `algo_random@v1` | 算法 | 756 | 1.3% | 2,880 |

> 口径：Arena 标准模式混合池（`default` / `breach` / `danger-close` / `dual-lanes` / `random`），不含 `multiplayer-ring` 与 `whirlpool`；胜率是对混合对手的总体胜率，不是对固定基线的单挑。该快照生成于 3.8.0 之前（`generatedAt` 为 2026-10-21T22:02Z），standard 规则不受同时回合分步结算影响。该快照只能说明“在这个池子里”的强弱，不能外推到全图池、同时回合、大逃杀或歼灭。

## 历史标定（3.5.x 标准模式）

> **以下表格是历史数据，不是当前强度。** 采集时 `forge` / `desert` 仍在标准图池，裁决分仍是 3.6.0 之前的公式；3.8.0 之后同时回合规则也已改变。保留这些数字只为回归追踪和解释算法演化，不要与当前快照相加或比较。

### threat vs greedy（3.5.1，各图 40 局）

| 地图 | threat | 初版 threat | 备注 |
|---|---:|---:|---|
| default | **38:2** | 16:24 | 主图 |
| dual-lanes | **38:2** | 30:10 | |
| breach | **35:5** | **0:40** | 初版因拆墙判据一局未赢 |
| forge | **31:8** | 16:24 | 1 平；forge 已于 3.5.11 改造为 molten-throne |
| desert | **28:12** | 24:16 | desert 已于 3.5.8 下线 |
| multiplayer-ring | 20:20 | 22:18 | 每回合 7 行动点 |
| danger-close | 7:33 | 7:33 | 每回合 1 行动点，已知短板 |
| **合计** | **197:82（70.6%）** | 115:165（41.1%） | 279 局分胜负 + 1 平 |
| random 地图 | 17:15（53%），32 局 | — | 旧随机域；回合数与裁定权重随机生成 |

### field vs greedy（3.5.3，各图 30 局）

field 的口径与 threat 一致（`scripts/algorithm-arena.mjs`，headless 自博弈），局数取 30。

| 地图 | field | threat 同图对照 | 备注 |
|---|---:|---:|---|
| default | 18:12（60%） | 95% | 主图 |
| dual-lanes | 25:5（83%） | 95% | |
| breach | 17:13（57%） | 88% | 隔墙图，靠波前距离场绕行 |
| desert | 26:4（87%） | 70% | 地图已下线 |
| forge | 18:12（60%） | 80% | 半径 6 短图；另一套种子 14:16（47%），短图波动大；forge 已改造 |
| multiplayer-ring | 2:28（7%） | 50% | 每回合 7 行动点，field 已知短板 |
| danger-close | 29:1（97%） | 18% | 每回合 1 行动点，field 最强项 |
| **合计** | **135:75（64.3%）** | 197:82（70.6%） | 7 图 |
| random 地图 | 12:18（40%），30 局 | 53%（32 局） | 旧随机域，权重随机化摊薄优势 |

> field 与 threat 的强度不可直接比大小：threat 的短板正是 field 的强项（danger-close 18% vs 97%），反之亦然（multiplayer-ring 50% vs 7%）。同图 default 直接对拍 30 局 threat 18:12 领先；danger-close 上存在三方相克（field 打 greedy 97%、threat 打 field 60%、threat 打 greedy 仅 18%）。**单图胜率不可外推。**

### verdict vs greedy（3.5.4，各图 30 局，两套种子基）

| 地图 | 种子基 1000 | 种子基 3000 | threat | field |
|---|---:|---:|---:|---:|
| default | 29:1（97%） | 30:0（100%） | 95% | 60% |
| breach | 30:0（100%） | 30:0（100%） | 88% | 57% |
| desert | 30:0（100%） | 30:0（100%） | 70% | 87% |
| dual-lanes | 28:2（93%） | 30:0（100%） | 95% | 83% |
| forge | 30:0（100%） | 30:0（100%） | 80% | 60% |
| danger-close | 24:6（80%） | 21:9（70%） | 18% | 97% |
| multiplayer-ring | 30:0（100%） | 30:0（100%） | 50% | 7% |
| **合计** | **201:9（95.7%）** | **201:9（95.7%）** | 197:82（70.6%） | 135:75（64.3%） |
| random 地图 | 18:12（60%），30 局 | — | 53%（32 局） | 40%（30 局） |

> verdict 是唯一在两套种子基上给出完全相同合计的内置算法（逐图仅 ±1~3 局波动）。该表采集于 3.5.4，地图池与裁决分口径均已变化，不能当作 3.8.1 的当前胜率。

### verdict vs 其他算法（3.5.4，各 7 图 ×30 局）

| 对手 | 战绩 | 逐图（verdict 胜，顺序 default / breach / desert / dual-lanes / forge / danger-close / multiplayer-ring） |
|---|---:|---|
| threat | **161:49（76.7%）** | 24 / 30 / 27 / 18 / **10** / 30 / 22 |
| field | **186:24（88.6%）** | 28 / 30 / 28 / 16 / 30 / 30 / 24 |
| random | 24:0（100%），24 局 | default |

> verdict 在 threat/field 各自的最大短板上都是碾压：`danger-close` 30:0 打 threat、30:0 打 field；`multiplayer-ring` 22:8 打 threat、24:6 打 field。反过来，verdict 的旧短板是 `forge`（对 threat 仅 10:20）——该图已在 3.5.11 改造为同时回合的 `molten-throne`，这条相克结论不能直接套到当前图池。

### 其他历史对局

| 对局 | 胜率 | 备注 |
|---|---|---|
| verdict vs random | 100% (24:0)，24 局 | default |
| verdict vs greedy（4 人局） | four-corners 2/20 席位局（10%），greedy 每席位 30% | four-corners 已下线；未标定 |
| threat vs 初版 threat | **78% (31:9)**，40 局 | default；修复的直接效果 |
| threat vs mcts | 70% (14:6)，20 局 | default；mcts 模拟未播种，批次间会飘（另一批 18:2）；要定序需 40 局以上 |
| threat vs random | 100% (24:0)，24 局 | default |
| field vs random | 100% (24:0)，24 局 | default |
| field vs threat | 40% (12:18)，30 局 | default |
| mcts vs greedy | 25% (5:15)，20 局 | 两个算法都已修正行动点门控；旧记录 26.7%（30 局 8:22）是双方都带 bug 时测的；mcts 未播种随机 |
| greedy vs random | 100% (24:0)，24 局 | 修正后重测；旧记录 96.9%（31:1），32 局 |

> 行动点预算门控原本是四个内置算法共有的陷阱：动作失败会让 runner 直接 break 掉整个回合、作废剩余行动点。greedy / mcts / random 已同步修正（攻击/治疗/爆破/移动），headless 自博弈下零非法动作。MCTS 含随机模拟，胜负方差较大。

## 算法 vs RL 模型

当前可比较的数据是上面的 Arena 标准模式快照：`algo_verdict@v1` 评分 1933、胜率 90.1%，高于最强模型 `hex_ppo_v3.1.1` 的 1660 / 67.3%。因此不能再概括为“算法 AI 与训练良好的 RL 模型仍有显著差距”；更准确的说法是：**在当前 Arena 标准图池与模型池里，规则算法第一梯队不弱于最强模型**，但这不能外推到同时回合、大逃杀、歼灭或训练分布外的地图。

历史上只有一组 48 局配对换座的旧数据：

| 对局 | 胜率 | 先手/后手 | 备注 |
|---|---|---|---|
| greedy vs v2.7.0 | 18.8% (9:39) | 6:18 / 3:21 | 历史；random 地图，48 局；数据源 `rl/test-output/stats/algo_vs_rl_random.jsonl` 已不在仓库 |

> 旧数据只用于解释 3.5.x 时代的差距；模型池、随机地图域与竞技场口径都已变化，不能作为当前结论。MCTS 的 RL 同口径数据现在可从 Arena 的 2,880 局记录中读取，不再标注“尚未进行”。

## 规则与地图变更对算法的影响

| 版本 | 日期 | 变更 | 对算法的影响 |
|---|---|---|---|
| 3.5.7 | 2026-09-27 | `four-corners` 下线 | 4 人局旧标定（verdict 2/20）不再可复现 |
| 3.5.8 | 2026-09-28 | `desert` 下线 | 所有含 desert 的 7 图合计变成历史口径 |
| 3.5.11 | 2026-10-06 | `forge` → `molten-throne`，并转为 simultaneous | 旧 forge 标准图对拍（含 verdict vs threat 10:20）失效 |
| 3.6.0 | 2026-10-10 | 裁决分重构为击杀价值 + 据点流量制 | 3.5.x 标准算法胜率全部变成旧计分口径 |
| 3.7.4 | 2026-10-22 | Arena 按玩法模式分榜 | 同时回合暂无跑批；评估控制台仍只支持 standard |
| 3.8.0 | 2026-10-22 | 同时回合改为按行动点分步结算 | 所有同时算法的镜像/模拟器需要重写 |
| 3.8.1 | 2026-10-23 | random-sim v2、dest-prob v2、kriegspiel v2、matrix-eq v2 适配分步结算 | `kriegspiel` v2 已完成真实引擎对拍与两图 ×3 对手标定；`dest-prob` v2 已完成同 harness v1→v2 50/60 与 random 60/60 标定；matrix-eq 真实引擎口径待补 |

## 历史里程碑

| 时间 | 版本 | 事件 |
|---|---|---|
| 2026-09-13 | 3.5.0 | 算法 AI 系统上线：greedy、random |
| 2026-09-13 | 3.5.1 | 新增 MCTS（目标导向采样、据点占领、入口部署决策）；实测 vs greedy 30 局 8:22 |
| 2026-09-14 | 3.5.1 | 新增 threat 威胁感知效用算法：初版实测 vs greedy 仅 41.1%（7 图 ×40 局），breach 图 0 胜 |
| 2026-09-14 | 3.5.1 | threat 标定与修复：行动点预算门控、结束回合门槛、威胁惩罚按 `actionsPerTurn` 截断、据点收入按 kind 取实际值、部署参与同尺度比较、拆墙判据放宽 → vs greedy 70.6%；greedy 同步修正行动点门控；新增自博弈合法性回归测试 |
| 2026-09-16 | 3.5.3 | 新增 field 势场算法（人工势场：斥力井 + 引力井 + 波前距离场）。初版 vs greedy 0/30：三处结构性 bug；修复后 64.3%（7 图 ×30 局），并在 threat 的短板 danger-close 上拿到 97% |
| 2026-09-16 | 3.5.3 | field 标定：尺度自适应档案（小图 1 环/据点井 4 格，大图 2 环/5 格）、同一敌军在斥力井中去重计费、纯波前导航 |
| 2026-09-18 | 3.5.4 | 新增 verdict 裁决线算法（反向规划：三条裁决线 + 攻城排程 + 全动作按引擎裁决分统一计价）。初版 vs greedy 64.3%（7 图 ×30 局），最大短板是对 threat 的 forge 相克 |
| 2026-09-18 | 3.5.4 | verdict 标定与修复：十处结构性约束；`STEP_SURVIVAL` 扫描 0.72/0.62/0.55/0.45/0.35 → 89.0/92.4/95.7/回落/回落；最终 vs greedy 95.7%（201:9），两套种子基一致 |
| 2026-10-10 | 3.6.0 | 裁决分重构为击杀价值 + 据点流量制；verdict 同步新口径；3.5.x 标准强度数据转入历史口径 |
| 2026-10-22 | 3.7.2 | 新增 dest-prob 落点概率算法（同时回合）：敌军落点概率分布 + 预测射击 + 目的格冲突规避 + 据点流量计价。旧规则 headless 对 random-sim 两图各 100 局 100:0、零非法；场均击杀 3.10（standoff）/ 0.96（molten-throne） |
| 2026-10-22 | 3.7.3 | 新增 kriegspiel 兵棋推演算法 v1（同时回合）：旧 `resolveRound` 单轮结算 rollout + 联合计划搜索；旧规则对 random-sim 60/60、对 dest-prob 34/60（56.7%），240 局零非法 |
| 2026-10-22 | 3.7.5 | 新增 matrix-eq 矩阵均衡算法 v1（同时回合）：计划组合矩阵博弈 + CFR 均衡混合 + 事件史实证校正；旧规则对 random-sim 30:0、对 dest-prob 14:16、对 kriegspiel 8:22 |
| 2026-10-22 | 3.8.0 | 同时回合改为按行动点分步结算；新增 wait、`attacksPerUnit`、失败连锁、计划重排；同时算法镜像进入适配期 |
| 2026-10-23 | 3.8.1 | kriegspiel v2（3.8 分步引擎适配）：镜像 `src/engine/simultaneousResolve.ts` 的分步结算（级联失败/到达依赖链/逐步死亡/`attacksPerUnit`/终局轮跳过占点），计划合法性改为队列前缀投影 + 地形寻路，候选生成与爬山改为逐行动点并支持 `wait` / `demolish`，敌方计划改为有序采样。真实引擎对拍 40 局面零偏差；两图各 30 局 ×3 对手共 180 局零非法：对 random-sim 60:0、对 dest-prob 52:8（86.7%）、对 matrix-eq v2 29:31（standoff 27:3、molten-throne 2:28 斩首短板） |
| 2026-10-23 | 3.8.1 | kriegspiel v1 同口径基线补测：把 `git show 89f3b69^` 的 v1 实现放进同一真实引擎 harness、同一批种子（`1000 + i×7919`）跑 4 对手 ×2 图 ×30 局。结果——v1 对 dest-prob v1 43.3%（standoff 仅 20.0%）、对 matrix-eq 31.7%，v2 分别是 86.7% 与 48.3%，**适配价值 +43.4pp / +16.6pp**；但 molten-throne 对 matrix-eq 是 v1 6:24 → v2 2:28 的**负提升**，且 v1↔v2 直接对打 35:25（p=0.245）未达显著。同时按 `action_failed` 事件计数发现 v2 结算期失败 17.1–23.1/局（v1 1.3/局、dest-prob 0.6–3.0/局），主因 `destination_occupied`：候选生成不排除敌军当前占位，已记入 `kriegspiel.md`「已知限制 #2」，未修 |
| 2026-10-23 | 3.8.1 | random-sim v2 适配分步结算：同单位多动作、队列投影、`attacksPerUnit`；同时回合基线恢复可用；无同口径 v1/v2 强度数据 |
| 2026-10-23 | 3.8.1 | matrix-eq v2（3.8 分步引擎适配）：重写分步结算镜像、计划校验、组合动作生成与事件史按步序重建；镜像裁判对 v1 23:7、对 kriegspiel 12:18、对 dest-prob v1 13:17、对 random-sim 30:0；真实服务器口径待验证 |
| 2026-10-23 | 3.8.1 | dest-prob v2（3.8 分步引擎适配）：队列前缀投影、同单位跨行动点多动作、地形寻路、`attacksPerUnit`、投影部署/治疗/爆破；真实引擎同 harness 30 局/图对 v1 50/60（83.3%）、对 random-sim 60/60；对 kriegspiel v2 21/60、matrix-eq v2 23/60（抽样） |
| 2026-10-24 | 3.8.3 | 新增 prism 棱镜算法 v1（同时回合）：逐行动点联合搜索完整队列，四种对手行为假设分别镜像分步结算，按本局裁决权重 + 最差情境惩罚选择计划；无算法依赖、无地图 ID 分支、不使用对手隐藏队列。真实引擎双人两图整局、三人四轮零非法；竞技场 4 对手 ×2 图 ×24 局共 192 局 **181:11**（standoff 96:0、molten-throne 85:11，评分 1977）；换座冒烟 14:0（7 组 ×2 局，小样本不作强度结论） |

## 未来方向

1. **同时回合 3.8 适配与重标定**：dest-prob v2 已完成分步语义适配（v1→v2 直接对拍 50/60）；下一步为 matrix-eq v2 补真实引擎标定，确认镜像裁判结论（kriegspiel v2 已完成：真实引擎对拍零偏差 + 两图 ×3 对手各 30 局）。
2. **大逃杀 / 歼灭算法空白**：当前 0 个内置算法。先做随机/效用基线，再处理无总部、炮火缩圈、出生据点绑定与淘汰规则。
3. **多席位标定**：现有标准权重主要在 2 人对局上调出；用 `multiplayer-ring`（多席位）、`snowflake` / `standoff`（3/6 人）补 3–6 人标定。`four-corners` 已下线，不能再用。
4. **Minimax + Alpha-Beta 剪枝**：经典对抗搜索，可作为 mcts 之外的确定性搜索基线。
5. **混合架构**：MCTS + 学习评估函数，或规则算法 + RL 局面评估。
6. **多线程并行**：利用 Worker 加速搜索；先做可复现的基准，再决定是否值得。
7. **Arena 多模式跑批**：`round_robin.py` / leaderboard 已支持多算法轮转与自动排行；3.8.2 起同时回合已接入评估跑批（接入时 4 个同时算法，3.8.3 起 5 个 × standoff / molten-throne，RL 模型不参评），剩余缺口是大逃杀/歼灭跑批。
8. **部署决策继续收敛**：`deployDecision()` 已统一 threat / mcts / field / verdict；还剩 `greedy` 与 `scripts/auto-standard-game.mjs` 两份变体未合并。
9. **tempo / 兑现率量纲**：verdict 已用行动点预算与“打击分 − 原地承伤 × 姿态系数”补上 danger-close / multiplayer-ring 两个老短板；下一步是把“每一步兑现率”做成可计算量纲，而不是再配一个系数。旧 `forge` 例子已不适用，改用当前短图与多行动点图验证。
10. **基准数据自动化**：让 `scripts/algorithm-arena.mjs` / `scripts/matrix_eq_benchmark.mjs` 输出带 `engineVersion / mapPool / harness / games / seed / date` 的 JSON，再由脚本生成本文表格，避免手工抄写再次漂移。
11. **同时回合的多轮视野**：kriegspiel v2 在 molten-throne 被 matrix-eq v2 打到 2:28，且**场均裁定分反而领先**（2496.6 vs 1764.3）——单轮 rollout 无法给「N 轮后总部被斩首」定价，每轮的局部最优都是「再挨一下换一格据点」。给总部血量加凸性惩罚（`KRIEG_HQ_URGENCY` 扫 1800 / 4000）实测**胜负序列完全不变**，在 24 格据点 ×75 分的尺度面前压不过抢点收益。需要的是多轮 rollout 或「剩余存活轮数」的期限量纲（参 verdict 的攻城排程），与第 9 条同源。
12. **kriegspiel 的目的格占用定价（实测缺陷，修法明确）**：v2 的 `stepCandidates` 只排除己方投影占位，敌军当前站着的格子照样生成 move/deploy 候选，`moveStaticScore` 又只按 `combinedClaimRisk`（敌军**到达**概率）打折，不表达「敌军**已经在这里**」。3.8.0 把占用判定推迟到结算，于是 standoff 上每局有 17.1–23.1 个动作以 `destination_occupied` 等理由失败（v1 只有 1.3/局），折算成该图 5 行动点/回合即 **23–31% 的行动点以失败告终**，少数还级联作废同单位后续动作。修法是把「occupant 在本步之前离开的概率」计进成功率（可与落点模型复用），预计同时改善耗时（失败候选白占 rollout 预算）。**修完必须重跑 180 局标定并升 v3**，因为全部现有数字都会变。
13. **同时回合标定 harness 入库**：`temp/kriegspiel-arena.mts`（真实引擎 headless、`--a-path` 可加载历史版本、按 `action_failed` 计结算期失败）与 `temp/krieg-fidelity.mts`（引擎对拍）目前都在 gitignored 的 `temp/` 下，导致本文与 `kriegspiel.md` 的数字**别人无法复现**，v1 基线还要从 git 历史重建。应提升到 `scripts/` 并接进第 10 条的自动化输出。
14. **prism 大样本与多轮视野**：当前 v1 已有双人两图整局合法性、14 局换座冒烟与 4 对手 ×2 图 ×24 局竞技场跑批（192 局 181:11），但仍是双人、两图、固定算法池；下一步按 3 图 ×30 局补强度标定，并加入跨轮价值（总部剩余轮数、据点流量延续、单位存活折现）来解决“单轮最优但多轮被斩首”的期限问题；同时评估束宽/情境数与耗时的边际收益。

## 贡献指南

新算法提交清单：

- [ ] 实现文件 `algorithms/builtin/<name>.mjs`
- [ ] 在 `registry.mjs` 的 `ALGORITHMS` 注册，并在 `ALGORITHM_META` 填写 `displayName` / `description` / `version` / `modes`
- [ ] 模式隔离：确认 `modes` 与实际玩法一致；不要再手工改 `src/api/bots.ts` 或前端下拉，二者由注册表/`/api/algorithms` 自动生成
- [ ] 编写算法文档 `algorithms/docs/algorithms/<name>.md`（性能表不得留“待填”进入仓库；必须带引擎版本/地图池/harness/局数/日期）
- [ ] 更新本文档的算法清单与模式覆盖表
- [ ] 合法性回归：headless 跑完整对局，断言返回的动作零被引擎拒绝（参 `tests/algorithms/threat-selfplay.test.ts`）；同时回合算法还要覆盖 3.8 分步语义（同单位多动作、`wait`、失败连锁、`attacksPerUnit`）
- [ ] 强度口径：至少 3 张图 × 30 局、逐局交替先手；**6 局的胜负不构成结论**；不得用已退役地图或旧计分口径冒充当前数据
- [ ] 算法行为变更时升 `version`（竞技场历史对局归旧版本 id，新对局归新 id）
- [ ] 升版时在 `algorithms/docs/algorithms/<name>.md` 写 `vN → vN+1` 的改动清单、同口径对照表、提升幅度（绝对值 + 百分点/比值）与代价；无同口径数据时写“暂无同口径对照”及补测计划
- [ ] 同步更新本文档算法清单的版本/强度列与“历史里程碑”
- [ ] 提交前通过 `npm run build`、`npm test` 与冒烟脚本验证（服务器运行时执行 `node scripts/test-algorithm-bots.mjs algo_<name> algo_random`）

详细开发指南见 `algorithms/builtin/README.md`。

## 数据源与复现

| 用途 | 入口 | 说明 |
|---|---|---|
| 标准模式自博弈 | `scripts/algorithm-arena.mjs` | 直接驱动 `src/engine/`，逐局交替先手、非法动作审计、`--strict` 可进 CI；用 `npx tsx` 运行 |
| 同时回合镜像标定 | `scripts/matrix_eq_benchmark.mjs` | 镜像 3.8 分步结算的裁判；矩阵均衡等算法的专用基准 |
| 同时回合真实引擎对战 | `rl/evaluation/evaluate_cross.py`（`algo:<name>@<version>` + `--swap-sides`） | 经 `rl/training/local-worker.ts` 的 decide 通道驱动真实引擎；prism 冒烟与算法互打均用此入口 |
| Arena 榜单 | `arena/matches.jsonl`、`public/data/arena-leaderboard.json` | 2026-10-21 UTC 标准模式快照；按模式分榜；3.8.2 起同时回合已有独立跑批分区，3.8.3 起参与算法 5 个 |
| 合法性回归 | `tests/algorithms/*-selfplay.test.ts` | 整局零非法动作、正常完赛 |
| 单算法档案 | `algorithms/docs/algorithms/*.md` | 设计细节与逐图数据；本文只保留总览与当前快照 |
| 版本历史 | 根 `RELEASE_NOTES.md`（权威） / `algorithms/docs/RELEASE_NOTES.md`（算法专题记录，已补录 3.5.0–3.8.1） | 算法侧细节看专题记录；与根文档冲突时以根文档为准 |

> `temp/threat-bench.mts` 是本机临时标定脚本（gitignored），不能作为长期复现入口；`rl/test-output/stats/algo_vs_rl_random.jsonl` 已不在仓库，旧 48 局数据仅作历史引用。
