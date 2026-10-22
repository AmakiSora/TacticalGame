# kriegspiel — 兵棋推演算法

> 单算法档案，遵循 `ALGORITHMS_NOTES.md` 固定模板。

## 身份与文件

| 项 | 内容 |
|---|---|
| 文件 | `algorithms/builtin/kriegspiel.mjs` |
| 算法名 | `kriegspiel` |
| 注册键 | `algo_kriegspiel` |
| 显示名称 | 兵棋推演算法（Kriegspiel / Rollout Planner） |
| 定位 | 同时回合模式的搜索算法：真实结算 rollout + 整份计划联合搜索 + 风险规避 |
| 实现日期 | 2026-10-22（v3.7.3 开发分支） |
| 语言 | JavaScript (ESM) |
| 接口类型 | 策略接口（`decide`） |
| 支持模式 | 仅同时回合（simultaneous） |

## 算法原理

同时回合里，一名玩家一次性秘密排下**整份计划**（最多 `actionsPerTurn` 个动作），所有玩家的计划在结算时**同时**生效。dest-prob 用解析公式给每个动作单独估期望收益、再逐个边际贪心挑选，结构上**从不真正模拟结算**（见 `dest-prob.md`「已知限制 #2：不做联合计划搜索」），因此看不到「动作之间的相互作用」：两单位同轮集火斩杀、先治疗后承伤、占点与预瞄封锁协同、故意让一格目的格冲突失败去换别处的 tempo——这些只有把整份计划放在一起结算才能评估。

兵棋推演算法直接把**整份计划**塞进一个 JS 版的单轮结算器里跑一遍，用**模拟出来的棋盘**给计划打分，并在计划空间里做**联合搜索**：

1. **静态候选生成**：枚举攻击（复用 dest-prob 已逐字镜像 `planning.ts` 的 `computeAim`/`enumerateAims`，覆盖 `single`/`line`/`arc` 与 `attackLock`）、治疗、移动（`utils.reachableCells`）、部署（部署源 × 兵种 × 相邻空格），各按静态启发式打分排序；
2. **多样化种子计划**：一份贪心计划 + K−1 份按 softmax 采样的计划（去重），铺开计划空间的初始探索点；
3. **蒙特卡洛 rollout 打分**：每份计划跑 `rollouts` 次单轮结算。每次 rollout 先从**对手组合**（`objective`/`aggressive`/`random` 三种性格）采样敌方计划，再用 JS 结算器 `simulateRound` 真实结算，最后用裁定权重 `evalBoard` 给结算后棋盘估值；
4. **风险规避选择**：计划分取 `均值 − λ·标准差`，而不是单点最优——对刻意反预测或随机对手都更稳（补 `dest-prob.md`「已知限制 #1：对手模型可被反预测」）；
5. **爬山精修**：在最优计划上逐槽位尝试用同单位的其他候选替换、或在预算未满时追加一个兼容动作，rollout 打分保留改进，全程受墙钟上限约束。

### 与现有算法的区别

| 算法 | 核心 | 与兵棋推演算法的差别 |
|---|---|---|
| `random-sim` | 从合法计划动作中均匀随机 | 兵棋推演对整份计划做真实结算 rollout 打分，而非随机 |
| `dest-prob` | 解析公式给**单个动作**估期望收益，边际贪心逐个挑 | dest-prob 从不模拟结算、不做组合搜索；兵棋推演把**整份计划**放进结算器跑，能发现动作间的协同/冲突 |
| `mcts` | 标准模式的整局树搜索 | mcts 面向顺序回合、搜索整局；兵棋推演只结算**单轮**（同时结算的最小闭环），用棋盘估值收口，并在计划空间做联合搜索而非树展开 |

一句话：**dest-prob 问「这个动作单独值多少分」，兵棋推演问「这一整份计划真打一遍，棋盘会变成什么样、值多少分、波动有多大」。**

## 决策逻辑

每次 `decide` 调用：

### 0. 前置短路

- 无 `ctx.owner` 或无 `game.plan` → null；
- `plan.committed` 已含己方 → null（等结算）；
- `plan.myQueue.length >= actionsPerTurn` → null（预算用尽）。

### 1. 每轮搜索一次、缓存整份计划

以 `${game.id}:${owner}:${roundNumber}` 为键缓存本轮搜索结果。首次调用时 `buildContext` 构建上下文（己方/敌方单位、据点、总部、可达格、补给、`turnOrder`、平衡参数、确定性种子），再 `searchBestPlan` 搜出整份计划；后续 `decide` 调用只从缓存里**按游标逐个吐出**尚未入队的动作（用 `actionSignature` 跳过 `myQueue` 里已有的），因此昂贵的搜索每轮只跑一次，而非每次 `decide` 都跑。

### 2. 构建对手模型（`buildEnemyModel`）

对每个敌军枚举「原地 + BFS 可达格」，按占点引力、火力机会、我方威胁、支援锚点、原地惯性打分，softmax 成落点概率分布；汇总出 `presence`（每格每敌出现概率）、`claimRisk`（每格被认领风险）、`attackEntries`（每格可能吃到的敌方火力）。该模型**每轮只算一次**，同时服务于静态候选打分与 rollout 时的敌方计划采样。

### 3. 静态候选生成（`generateCandidates`）

- **攻击**：对每个未排动作的己方单位按 `attackShape` 枚举合法瞄准（`enumerateAims`，按覆盖格签名去重），静态分 = 覆盖格上敌军出现概率 × 期望伤害 + 击杀奖励 + 总部伤害放大 − 攻击者原地承伤；
- **治疗**：支援兵按 `healShape` 枚举，覆盖格内受伤友军按缺口计价，预计承伤 ≥ HP 时附加保命奖励；
- **移动**：`utils.reachableCells` 排除己方已认领目的格，落点静态分 = 占点价值 + 推进分 + 下一轮火力 − 期望承伤 − 拥挤惩罚，成功率按 `1 − 认领风险` 打折；
- **部署**：`utils.deployOrigins` × 兵种 × 相邻空平地，基础分 × 兵种系数 + 落点即据点的占领价值，按冲突风险打折，扣减队列已计划部署花费。

### 4. 种子计划与采样（`generateSeedPlans`）

一份 `greedyPlan`（按静态分降序、满足算法自身的「一单位一动作 / 目的格互不冲突 / 预算 / 部署花费」保守约束逐个纳入）+ K−1 份 `sampledPlan`（对 top 候选做 softmax 采样，温度 `sampleTemp`），按排序签名去重，得到多样化的初始计划集合。引擎已改为按行动点分步结算，本算法的镜像模拟器尚未适配（后续任务）。

### 5. rollout 打分（`scorePlan`）

每份计划跑 `rollouts` 次：每次以 `(baseSeed + i·黄金比)` 重新播种 `mulberry32`，`sampleAllEnemyPlans` 按性格采样敌方计划，`simulateRound` 真实结算单轮，`evalBoard` 估值。返回 `{mean, std, risk}`，其中 `risk = mean − λ·std`；若任一采样命中终局（`|value| ≥ TERMINAL/2`，即己方总部被摧毁或敌方全灭），则直接按 `mean` 主导，避免标准差把必胜/必败信号淹没。

### 6. 单轮结算器（`simulateRound`）

逐字镜像 `src/engine/simultaneous.ts` 的 `resolveRound` 单轮语义（不含炮火/收入/维修，用棋盘估值收口）：

- **阶段一+二**：所有席位的 deploy/move 共享**目的格声明池**，同一格被 ≥2 个动作声明则**全部失败**；部署扣补给（含 `deployDiscount`）、创建单位；移动落位；
- **阶段三**：按 `turnOrder` 收集攻击（`computeAim` 推导形状；`attackLock` 兵种锁定**计划时刻**点击格上的敌方单位，移动后仍在射程内才命中，否则脱靶）与治疗；先施放全部治疗（按最终站位、覆盖格内受伤友军各自掷量、上限截断），再按 `turnOrder` 施加伤害（`rollDamage`/`rollHeal` 用 rollout 的 rng），累计总部伤害与击杀价值；
- **阶段四**：每个存活席位，一格一 `canCapture` 单位即占领据点。

### 7. 联合搜索（`searchBestPlan`）

种子计划逐一 rollout 打分取最优；再做 `refinePasses` 轮爬山：逐槽位用同单位的其他候选替换（`isPlanLegal` 校验后 rollout 打分，保留改进），预算未满时尝试追加一个兼容动作。全程受 `timeBudgetMs` 墙钟上限约束，到点即返回当前最优。

## 实现细节

- **合法性镜像**：动作枚举复用 dest-prob 的 `computeAim`/`enumerateAims`（已逐字镜像 `planning.ts` 的 `coveredCellsFor`）；结算器镜像 `simultaneous.ts` 的 `resolveRound`。`tests/algorithms/kriegspiel-selfplay.test.ts` 在真实 standoff / molten-throne 对局上把每个 `decide` 输出喂给引擎入队校验，全部接受、零非法。
- **计划自洽校验**：`isPlanLegal` 在搜索内部就挡住「一单位多动作 / 目的格自撞 / 超预算 / 部署超补给」，非法组合根本不进入 rollout。
- **确定性**：不使用 `Math.random`；rollout 随机源由 `(rngState, roundNumber, owner)` 播种（`stateSeed`），同棋盘可复现，便于回放与标定。
- **性能**：敌军落点模型与可达格每轮只算一次，搜索结果按轮缓存，昂贵的 rollout 每轮只跑一批。默认参数下两张地图单轮搜索约 20ms、单次 `decide` 约 2–3ms（缓存命中时近零），墙钟上限 `KRIEG_TIME_MS`（默认 2000ms）兜底保护线上 runner 与跑批。
- **可调参数**（环境变量）：`KRIEG_ROLLOUTS`（默认 32）、`KRIEG_CANDIDATES`（14）、`KRIEG_REFINE`（2）、`KRIEG_TIME_MS`（2000）、`KRIEG_LAMBDA`（0.5）、`KRIEG_TEMP`（40）。

## 性能表现

标定方法：`temp/kriegspiel-arena.mts` headless 混合对战，直接驱动 `src/engine/`（不走 HTTP），逐局交替先手，固定 `seed = seedBase + i × 7919`；每局双方完整跑完计划/提交/结算循环，统计胜率、非法动作、击杀、总部伤害、据点、军力、补给、决策耗时与行动构成。每个对局组合各 30 局。

### 胜率总览（各 30 局，逐局交替先手）

| 对手 | 地图 | kriegspiel 胜 | 对手胜 | 胜率 | 非法动作 | 平均轮数 | 平均胜分差 |
|---|---|---:|---:|---:|---:|---:|---:|
| random-sim | standoff | **30** | 0 | **100%** | 0 | 15.0 | 684.7 |
| random-sim | molten-throne | **30** | 0 | **100%** | 0 | 19.6 | 3065.9 |
| dest-prob | standoff | **19** | 11 | **63.3%** | 0 | 14.9 | 366.1 |
| dest-prob | molten-throne | 15 | 15 | **50.0%** | 0 | 20.0 | 213.2 |

- **对 random-sim 合计 60/60（100%）**，对 dest-prob 合计 **34/60（56.7%）**；全部 240 局**零非法动作**。
- molten-throne 上双方 HQ 伤害均为 0：该图 `deployFromHq: false`、总部分居半径 6 的两角，20 回合内谁都打不到对方总部，胜负完全由据点（权重 75）与军力/击杀决定，因此与 dest-prob 打成 15:15。

### 场均统计（kriegspiel 视角，同批对局）

| 指标（场均） | vs random standoff | vs random molten | vs dest-prob standoff | vs dest-prob molten |
|---|---:|---:|---:|---:|
| 裁定总分 | **1008.5** | **3646.4** | **690.5** | 2036.0 |
| 对手裁定总分 | 324.0 | 580.4 | 671.8 | 1963.2 |
| 总部伤害 | 34.8 | 19.9 | 27.0 | 0.0 |
| 击杀价值（killValue） | 131.6 | 39.5 | 148.7 | 214.9 |
| 终局据点数 | **6.57** | **23.90** | 2.77 | **12.53** |
| 终局军力 | 839.9 | 846.0 | 480.2 | 431.1 |
| 剩余补给 | 7.4 | 198.3 | 21.5 | 68.2 |
| 决策耗时 | 2.4ms/次 | 3.2ms/次 | 2.3ms/次 | 3.0ms/次 |

行动构成（30 局合计，kriegspiel）：

| 对局 | 移动 / 部署 / 攻击 / 治疗 |
|---|---|
| vs random standoff | 646 / 393 / 1089 / 7 |
| vs random molten | 670 / 429 / 1251 / 6 |
| vs dest-prob standoff | 589 / 282 / 1127 / 134 |
| vs dest-prob molten | 1075 / 373 / 928 / 24 |

> 对 dest-prob 时治疗动作明显增多（standoff 134 次 vs 对 random 的 7 次）：rollout 能算出「先治疗再承伤」的净血量收益，这是边际贪心结构上看不到的组合。
>
> random-sim 是均匀随机基线，100:0 只说明「真实结算搜索明显优于随机」，不代表对真人或 RL 模型的强度。对 dest-prob 的 56.7% 才是有意义的强度对照——两张图各 30 局、逐局交替先手、零非法。

## 使用场景

1. **同时回合模式的第三个内置算法**：大厅「添加 AI → 算法脚本」中与 random-sim、dest-prob 并列，给同时回合对局提供「会搜索整份计划」的最强内置对手。
2. **联合计划搜索的教学样例**：展示同时回合与「逐动作边际评估」的根本差异——把整份计划真实结算一遍，才能发现集火/治疗/封锁/换 tempo 的组合拳。
3. **dest-prob 的强度对照与升级路径**：dest-prob 是解析式对手模型的第一档，兵棋推演是「真实结算 + 搜索」的第二档；两者共享 `computeAim`/`enumerateAims` 与落点模型，便于对比归因。

## 兼容性

- **支持模式**：仅同时回合（simultaneous）。
- **不支持模式**：标准（standard）、歼灭（annihilation）、大逃杀（royale）。royale 虽共享计划/提交机制，但带炮火缩圈且无总部，结算器未建模炮火/收入/维修，目标计价未在该轴标定，故不声明。
- **地图兼容性**：所有 simultaneous 模式地图（standoff、molten-throne），已覆盖 2 人 standoff 与 2 人 molten-throne 的 headless 对局（各 30 局 × 2 对手）。
- **运行环境**：Node.js ≥ 24，纯 JavaScript，无外部依赖。

## 使用方式

### 通过前端添加

1. 创建对局，选择同时回合模式地图（对峙之地 / 熔池王座）
2. 点击"添加 AI"按钮，切换到"算法脚本"标签
3. 下拉菜单选择"兵棋推演算法"（下拉只列出当前对局模式可用的算法）
4. 点击"确定"

### 通过命令行运行

```bash
npm run dev  # 启动服务器

node algorithms/runner.mjs \
  --algorithm kriegspiel \
  --url http://localhost:3100 \
  --game <gameId> \
  --token <playerToken> \
  --side player_a
```

### 通过 API 添加

```bash
curl -X POST http://localhost:3100/api/games/<gameId>/bots/algorithm \
  -H "X-Host-Token: <hostToken>" \
  -H "Content-Type: application/json" \
  -d '{"botType":"algo_kriegspiel"}'
```

## 已知限制

1. **只结算单轮**：rollout 模拟的是「这一轮同时结算后的棋盘」，用裁定权重估值收口，不做多轮/整局展开；跨轮的战略铺垫（如故意养兵、长线包围）依赖估值函数的即时口径，可能短视。
2. **结算器是近似镜像**：`simulateRound` 不含炮火/收入/维修/comeback 补给，与引擎单轮语义对齐但非全量；royale 轴的炮火缩圈未建模，故不声明该模式。
3. **对手组合是启发式**：rollout 的敌方计划来自 objective/aggressive/random 三种性格的采样，对完全不在组合内的怪异打法仍可能误判；风险项（λ·std）只能缓解、不能消除。
4. **搜索受墙钟约束**：`refinePasses` 与候选数有限，行动点很多时爬山可能停在局部最优；提高 `KRIEG_ROLLOUTS`/`KRIEG_CANDIDATES`/`KRIEG_REFINE` 能改善但线性增加耗时。
5. **样本以 2 人局为主**：标定全部为 2 人 standoff / molten-throne；3/6 人 standoff 未做完整胜率标定，多席位敌人叠加时对手组合采样与声明池冲突的独立性假设会变弱。

## 一句话总结

兵棋推演算法（kriegspiel）是同时回合模式的搜索算法：把整份计划塞进一个镜像引擎单轮结算的 JS 结算器里真实跑一遍，对 objective/aggressive/random 三种对手组合做蒙特卡洛 rollout，用「均值 − λ·标准差」的风险调整分挑选并爬山精修计划——用真实结算代替解析估价，用联合搜索代替边际贪心。
