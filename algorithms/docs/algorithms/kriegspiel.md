# kriegspiel — 兵棋推演算法

> 单算法档案。写作口径遵循 `ALGORITHMS_NOTES.md` 的「阅读须知：当前口径」（性能表必须带引擎版本 / 地图池 / harness / 局数 / 日期，并标注「当前快照」或「历史标定」）与「版本升级的文档要求（强制）」。

## 身份与文件

| 项 | 内容 |
|---|---|
| 文件 | `algorithms/builtin/kriegspiel.mjs` |
| 算法名 | `kriegspiel` |
| 注册键 | `algo_kriegspiel`（竞技场参与者 id：`algo_kriegspiel@v2`） |
| 显示名称 | 兵棋推演算法（Kriegspiel / Rollout Planner） |
| 当前版本 | **v2**（2026-10-23）；v1 为 3.7.3 旧规则实现，已被覆盖、不再保留在仓库 |
| 定位 | 同时回合模式的搜索算法：分步结算 rollout + 整份计划联合搜索 + 风险规避 |
| 实现日期 | 2026-10-22（v1，基于 release/3.7.2 分支）/ 2026-10-23（v2，适配 3.8.0 分步引擎） |
| 语言 | JavaScript (ESM)，零依赖，Node ≥ 24 |
| 接口类型 | 策略接口（`decide`） |
| 支持模式 | 仅同时回合（simultaneous） |
| 镜像的引擎版本 | **3.8.0 / 3.8.1** 的 `src/engine/simultaneousResolve.ts:resolveRoundSteps` + `src/engine/planning.ts` 前缀投影；v1 镜像的是已删除的 `src/engine/simultaneous.ts:resolveRound` |
| 参考实现状态 | v2：与真实引擎逐点对拍 40 个局面零偏差；standoff / molten-throne 各 30 局 ×3 对手共 180 局零非法动作 |
| 作者 | Qwen3.8Max0902-QD |


## 算法原理

同时回合里，一名玩家一次性秘密排下**整份计划**（最多 `actionsPerTurn` 个动作），所有玩家的计划在结算时同时生效。自 3.8.0 起，"同时"的含义是**按行动点分步**：队列的数组顺序就是行动点顺序，所有玩家的第 k 条动作先同时结算完，再结算第 k+1 条；同一单位可以在多个行动点上连续行动。

dest-prob 用解析公式给每个动作单独估期望收益、再逐个边际贪心挑选，结构上**从不真正模拟结算**（见 `dest-prob.md`「已知限制 #2：不做联合计划搜索」），因此看不到「动作之间的相互作用」，更看不到**步序**带来的作用：第 2 个行动点开火时敌人是否已经走进扇形、先爆破能不能让第 3 步的友军通过、把火力 `wait` 到敌人到位之后。

兵棋推演算法直接把**整份有序计划**塞进一个 JS 版的分步结算器里跑一遍，用**模拟出来的棋盘**给计划打分，并在计划空间里做**联合搜索**：

1. **计划期投影**：把已排队的前缀投影成虚拟站位与虚拟地形（自有爆破改写为平地），每个行动点的候选都在投影后的局面上重新枚举；
2. **分步静态候选生成**：逐行动点枚举攻击（复用 dest-prob 已逐字镜像 `planning.ts` 的 `computeAim`/`enumerateAims`，覆盖 `single`/`line`/`arc` 与 `attackLock`）、治疗、移动（地形寻路）、爆破、部署与 `wait`，各按静态启发式打分排序；
3. **多样化种子计划**：一份贪心计划 + K−1 份按 softmax 采样的计划（**顺序敏感**去重），铺开计划空间的初始探索点；
4. **蒙特卡洛 rollout 打分**：每份计划跑 `rollouts` 次分步结算。每次 rollout 先从**对手组合**（`objective`/`aggressive`/`random` 三种性格）采样敌方的有序计划，再用 JS 结算器 `simulateRoundSteps` 真实结算，最后用裁定权重 `evalBoard` 给结算后棋盘估值；
5. **风险规避选择**：计划分取 `均值 − λ·标准差`，而不是单点最优——对刻意反预测或随机对手都更稳（补 `dest-prob.md`「已知限制 #1：对手模型可被反预测」）；
6. **有序爬山精修**：在最优计划上尝试「替换某一步 / 删掉一步 / 插入 `wait` 对齐行动点 / 交换相邻两步 / 追加一步」，粗筛用少量 rollout、胜出者再按满额 rollout 复核，全程受墙钟上限约束。

于是它能找到 dest-prob 结构上找不到的东西：跨行动点的移动→攻击组合拳、两单位同一步集火斩杀、用 `wait` 把火力对齐到敌人走进扇形之后、先爆破再让友军通过、故意让一格到达冲突失败去换别处的 tempo。

### 与现有算法的区别

| 算法 | 核心 | 与兵棋推演算法的差别 |
|---|---|---|
| `random-sim` | 从合法计划动作中均匀随机 | 兵棋推演对整份计划做真实分步结算 rollout 打分，而非随机 |
| `dest-prob` | 解析公式给**单个动作**估期望收益，边际贪心逐个挑 | dest-prob 从不模拟结算、不做组合搜索、也不排步序；兵棋推演把**整份有序计划**放进结算器跑，能发现动作间的协同/冲突与时序价值 |
| `matrix-eq` | 计划组合矩阵博弈 + CFR 均衡混合 | matrix-eq 求解的是「混合策略」，输出带随机性以反读盘；兵棋推演求的是「风险调整后的最优纯策略」，靠 rollout 期望而非博弈均衡，输出可复现 |
| `mcts` | 标准模式的整局树搜索 | mcts 面向顺序回合、搜索整局；兵棋推演只结算**单轮**（同时结算的最小闭环），用棋盘估值收口，并在计划空间做联合搜索而非树展开 |

一句话：**dest-prob 问「这个动作单独值多少分」，matrix-eq 问「对手会怎么混合、我的均衡混合是什么」，兵棋推演问「这一整份有序计划真打一遍，棋盘会变成什么样、值多少分、波动有多大」。**

## v1 → v2：3.8.0 分步引擎适配

v1 的镜像对象是旧的 `src/engine/simultaneous.ts:resolveRound`（整轮一次目的格声明池 → 部署/移动 → 攻击/治疗），并把计划生成限制在「一单位一轮一动作」。3.8.0 把它换成了 `src/engine/simultaneousResolve.ts:resolveRoundSteps`。v2 是一次**镜像层与搜索层的同步重写**，不只是改接口。

### 改动清单

- **规则镜像**：`simulateRound`（一轮三阶段）→ `simulateRoundSteps`（按行动点逐步推进，每步十个子阶段：级联预检 → 步初占用快照 → 到达求解 → 部署 → 移动 → 爆破 → 待命 → 攻击/治疗 → 死亡淘汰 → 终局检查）。新增级联失败、同一步「先移出后移入」与依赖传播、`attackLock` 按计划时刻锁定而按结算站位重算形状、逐步死亡、终局轮跳过占点。
- **计划校验**：从「一单位一动作 + 目的格互斥 + 单位挡路 BFS」改为**队列前缀投影**（`projectPlan`：站位投影 + 自有爆破改写地形 + 只按地形 BFS），占用/覆盖类判定按引擎口径**延迟到结算**。移动范围不再用 `utils.reachableCells`（它把单位/总部当墙，会系统性低估射程）。
- **动作生成**：从整轮一次性枚举改为 `stepCandidates(ctx, prefix, cache)`——每个行动点在投影后的局面上重新枚举，因此天然产出「移动→攻击→再移动」这类跨行动点组合；新增 `wait`（对齐行动点）与 `demolish`（按全军可达格增量计价）。
- **搜索/评估**：邻域从「换槽位 / 追加」扩展为「换步 / 删步 / 插入 `wait` / 交换相邻两步 / 追加」；改动第 k 步会改变其后所有步的投影，因此每个邻域候选都重过 `isPlanLegal`；新增两段式打分（`screenRollouts` 粗筛 + 满额 `rollouts` 复核）。`evalBoard` 与裁定权重口径**未变**。
- **对手模型**：敌方计划从「每席位一份无序动作集合」改为「每席位一份**有序**计划」——逐步采样、按性格定攻击倾向、尊重 `attacksPerUnit`、避免自撞目的格。落点分布的可达格改用 `planReachable`。
- **接口适配**：`decide` 契约不变（仍返回单个动作、`null` 提交）；新增动作类型需要 runner 侧支持，`algorithms/lib/api-client.mjs` 加 `wait()`、`algorithms/lib/interfaces.mjs` 加 `case 'wait'`。吐出缓存计划时改用「签名 → 计数」多重集与 `plan.myQueue` 对账，否则连续两个 `wait` 会被去重吞掉。
- **参数**：新增 `KRIEG_SCREEN`（默认 8）；其余 `KRIEG_ROLLOUTS`/`KRIEG_CANDIDATES`/`KRIEG_REFINE`/`KRIEG_TIME_MS`/`KRIEG_LAMBDA`/`KRIEG_TEMP` 默认值不变。

逐维度对照：

| 维度 | v1（整轮单发结算） | v2（按行动点分步结算） |
|---|---|---|
| 结算器 | `simulateRound`：一轮三阶段 | `simulateRoundSteps`：逐步推进，每步十个子阶段 |
| 单位行动次数 | 一单位一轮一动作（`ctx.used` 认领） | 同一单位可跨行动点连动；攻击次数受 `balance.attacksPerUnit`（默认 1）约束 |
| 计划合法性 | 一单位一动作 + 目的格互不冲突 + 预算 | 队列前缀投影 + 地形寻路；占用/覆盖判定推迟到结算 |
| 移动范围 | `utils.reachableCells`（把单位/总部当墙） | `planReachable`：只按水/障碍地形 BFS |
| 失败语义 | 目的格撞车即全部失败 | 级联失败、到达判定（同一步先移出后移入、链式腾格、依赖传播）、逐步死亡 |
| 候选生成 | 整轮一次性枚举 | 逐行动点在投影局面重算，按前缀签名缓存 |
| 搜索邻域 | 换槽位 / 追加 | 换步 / 删步 / 插入 `wait` / 交换相邻两步 / 追加；粗筛 + 满额复核 |
| 新增动作 | — | `wait`、`demolish` |
| 敌方采样 | 每席位无序动作集合 | 每席位有序计划，尊重攻击上限 |

### 同口径对照（真实引擎 harness，2026-10-23）

**这是唯一可以相减的 v1 vs v2 对照。** 口径：引擎 3.8.1；harness `temp/kriegspiel-arena.mts`（直接驱动真实 `src/engine/`，非镜像裁判）；地图 `standoff` / `molten-throne` 各 2 人局；每格 30 局、逐局交替先手；种子 `1000 + i × 7919`，v1 与 v2 **跑完全相同的种子序列**；日期 2026-10-23。v1 取自 `git show 89f3b69^:algorithms/builtin/kriegspiel.mjs`（即 3.7.3 官方收录版，未做任何改动），连同它依赖的当时版本 `dest-prob.mjs` 一起加载——属于「3.7 的大脑跑 3.8 的引擎」。

| 对手 | 地图 | v1 胜率 | v2 胜率 | 变化 |
|---|---|---:|---:|---|
| random-sim v2 | standoff | 100%（30:0） | **100%（30:0）** | 持平（基线，双方 p<0.0001） |
| random-sim v2 | molten-throne | 100%（30:0） | **100%（30:0）** | 持平（基线） |
| dest-prob v1 | standoff | 20.0%（6:24，p=0.0014） | **86.7%（26:4，p=0.0001）** | **+66.7pp** |
| dest-prob v1 | molten-throne | 66.7%（20:10，p=0.099） | **86.7%（26:4，p=0.0001）** | **+20.0pp** |
| matrix-eq v2 | standoff | 43.3%（13:17，p=0.58） | **90.0%（27:3，p<0.0001）** | **+46.7pp** |
| matrix-eq v2 | molten-throne | 20.0%（6:24，p=0.0014） | 6.7%（2:28，p<0.0001） | **−13.3pp（负提升）** |

两图合计（60 局，同一对手）：

| 对手 | v1 | v2 | 变化 |
|---|---:|---:|---|
| dest-prob v1 | 43.3%（26:34，p=0.37） | **86.7%（52:8，p<0.0001）** | **+43.4pp** |
| matrix-eq v2 | 31.7%（19:41，p=0.0062） | 48.3%（29:31，p=0.90） | +16.6pp |

v1 与 v2 直接对打（同 harness、同种子序列）：

| 地图 | v2 胜 | v1 胜 | v2 胜率 | 双侧 p |
|---|---:|---:|---:|---:|
| standoff | **20** | 10 | **66.7%** | 0.099 |
| molten-throne | 15 | 15 | 50.0% | 1.000 |
| **合计** | **35** | 25 | **58.3%** | 0.245 |

> **`p` 是双侧精确二项检验（H₀: 胜率 = 50%）。** 只有 `p < 0.05` 的行才构成结论。**v1 → v2 直接对打三行全部未达显著**：standoff 20:10（p=0.099）方向明确但 n=30 不足以定序，molten-throne 15:15 是完全平手。要给出「v2 强于 v1」的对打结论需要 60 局以上。
>
> 这个结果和上面「对第三方对手 +43.4pp / +46.7pp」并不矛盾。**以下是解读，未做对照实验**：v1 与 v2 共用同一套裁定权重估值与同样的 rollout 思路，互为镜像打法，对打时差异容易被抵消；v2 的收益更可能体现在**执行保真度**上——当对手的计划与分步语义发生交互时（dest-prob 的旧口径计划、matrix-eq 的斩首排程），v1 用旧规则打分选出的计划在真实结算里兑现不了，v2 能兑现。要把这条从解读升级为结论，需要按「计划兑现率」维度分别统计两版，目前没有这个量纲（同 `ALGORITHMS_NOTES.md` 未来方向第 9 条）。

### 提升幅度

- **对 dest-prob（同 harness，可相减）**：standoff **20.0% → 86.7%（+66.7pp）**、molten-throne **66.7% → 86.7%（+20.0pp）**、两图合计 **43.3% → 86.7%（+43.4pp，26:34 → 52:8）**。这是 v2 最大的一项收益，也是唯一在两张图上同向且都达到/接近显著的提升。
- **对 matrix-eq v2（同 harness，可相减）**：standoff **43.3% → 90.0%（+46.7pp）**，但 molten-throne **20.0% → 6.7%（−13.3pp）**；合计 31.7% → 48.3%（+16.6pp）。**合计数字掩盖了两图的相反方向，必须按图读。**
- **对 random-sim**：两版都是 30:0，随机基线无法分辨适配价值，只作冒烟锚点。
- **v1 → v2 直接对打：未达显著**。standoff 20:10（66.7%，p=0.099）、molten-throne 15:15（50.0%，p=1.000）、合计 35:25（58.3%，p=0.245）。**不能宣称「v2 打得赢 v1」**；能宣称的是下面这条可精确计量的适配收益，以及对第三方对手的大幅提升。
- **行动点利用率**（可精确计量的适配收益，standoff，`actionsPerTurn = 5`）：**必须按「每回合」归一，不能按「每局」**——各组合的平均回合数不同（13.9–15.0，被斩首的局提前结束），按局比会把回合差当成利用率差。归一后：v1 用掉 **4.75–4.80 / 5**（71.3–72.0 动作 ÷ 15.0 回合），v2 用掉 **4.91–4.97 / 5**（如 74.6 ÷ 15.0、71.0 ÷ 14.3、68.3 ÷ 13.9）。差距约 0.15–0.20 行动点/回合（3–4%），来自 v1 的「一单位一动作」在兵力少时排不满队列。molten-throne（4 行动点）上两版都接近排满（≈4.00/回合），没有这项差距。
- **不可相减的对照**：`matrix-eq.md`「基准结果 II / III」记录的 `matrix-eq v2 vs kriegspiel v1 = 12:18` 是 **matrix-eq 自带镜像裁判**口径；本节的 `v1 vs matrix-eq v2 = 19:41` 是**真实引擎 harness**口径。两套 harness 的种子、局内驱动方式与统计项都不同，**这两个数字不可相减、也不可互为验证**，只能各自在自己的口径内使用。
- **旧 3.7.3 规则下的 v1 数字（dest-prob 63.3% / 50.0%）不参与任何相减**，见「历史标定」一节。

### 代价与边界

- **决策耗时上升一个数量级**：v1 单次 `decide` 平均 **2.8–4.5ms**，v2 **43.5–168.7ms**（standoff ≈45ms、molten-throne 113–169ms），约 **15–40 倍**。原因是每轮要跑「逐行动点候选生成 × 种子计划 × 满额 rollout × 分步结算」，而 v1 的搜索空间被「一单位一动作」压得很小。仍远低于 `KRIEG_TIME_MS`（2000ms）墙钟上限，但已经不适合低延迟场景。
- **非法动作：两版都是 0**（v1 在同 harness 的 8 组 ×30 局里也是 0）。所以 v1 在 3.8 引擎上的劣势**不是「动作被引擎拒绝」**，而是「入队合法、但按分步语义执行时达不到它自己镜像里预期的效果」——它的 rollout 用旧规则给计划打分，分高的计划在真实分步结算里未必兑现。这条区分很重要：只看「零非法」会误判 v1 仍然健康。
- **「零非法」同样掩盖了 v2 自己的一个实测缺陷：结算期失败率高出 v1 一个数量级。** 复跑同一批对局并按 `action_failed` 事件计数（standoff，30 局，同种子）：

  | 侧 | 非法动作 | 结算期失败 | 主要失败原因 |
  |---|---:|---:|---|
  | kriegspiel **v1** vs dest-prob | 0 | **39（1.3/局）** | `unit_gone=33`、`destination_occupied=4` |
  | kriegspiel **v1** vs v2 | 0 | **40（1.3/局）** | `unit_gone=19`、`destination_occupied=16` |
  | kriegspiel **v2** vs dest-prob | 0 | **513（17.1/局）** | `destination_occupied=360`、`unit_gone=71`、`destination_conflict=45`、`previous_action_failed=30` |
  | kriegspiel **v2** vs v1 | 0 | **692（23.1/局）** | `destination_occupied=588`、`unit_gone=55`、`previous_action_failed=44` |
  | dest-prob（对手侧，参照） | 0 | 17–91（0.6–3.0/局） | — |

  根因已定位到代码：`stepCandidates` 只用 `cellsTakenByPrefix` 排除**己方**投影站位、己方总部与本轮已排部署落点（`kriegspiel.mjs:780` 的 `taken.has(...)`），**敌军当前占着的格子不在排除集里**；`moveStaticScore` 对这类格子只按 `combinedClaimRisk` 打折，而 `combinedClaimRisk = 1 − (1−moveRisk)(1−deployRisk)` 度量的是「敌军**移动/部署进来**的概率」，完全不表达「敌军**已经站在这里**」。3.8.0 把占用判定推迟到结算，于是这类移动入队合法，只有当占位者恰好在同一步离开时才成功。折算到 standoff 的 5 个行动点/回合：**每回合有 1.14–1.54 个行动点以失败告终（占 23–31%），其中 `destination_occupied` 单项占 0.80–1.31 个**，少数还级联作废同单位本轮的后续动作（`previous_action_failed`）。
  
  注意这**不是镜像不准**：保真度对拍证明 `simulateRoundSteps` 与引擎逐点一致，rollout 里这些失败是被正确模拟出来的。问题在**静态定价**——以及（推断，未做对照实验）rollout 采样出的敌军按 objective/aggressive/random 性格移动得比真实对手更频繁，使「它这一步会让开」在模拟里系统性偏乐观。修法是把「目标格当前被敌军/敌方总部占用」计入成功率（乘以该 occupant 在此步之前离开的概率），而不是只算到达风险。
- **harness 确定性已验证**：给 `temp/kriegspiel-arena.mts` 加上 `action_failed` 事件订阅后复跑 v1 vs v2（standoff，同种子），所有汇总项逐位复现（20:10、裁定分 778.8 / 578.6、总动作 2239 / 2160、`decide` 调用 2689 / 2610），说明统计口径的改动不影响对局本身。
- **新增已知短板**：molten-throne 上被 matrix-eq 斩首，v2（2:28）**比 v1（6:24）更差**，见「已知短板」一节。这是负提升，不是「v1 也有、v2 只是暴露出来」。
- **部署经济学仍未标定**：`DEPLOY_BASE` 是全局常数，低起始补给的 molten-throne 上 v2 把补给砸进部署（357 次 vs matrix-eq 的 79 次、终局补给 16.7 vs 181.5）。
- **`wait` / `demolish` 语义正确但极少被选中**：180 局合计 `wait` 5 次、`demolish` 10 次（全部在有障碍的 molten-throne）。它们的价值在于让搜索空间完整，不在于实战频次。

### 样本边界

- **引擎**：3.8.1；**harness**：`temp/kriegspiel-arena.mts`（真实引擎 headless，非镜像裁判、非 HTTP）；**地图池**：`standoff` + `molten-throne`；**局数**：每个「地图 × 对手」组合 30 局——v2 共 180 局（3 对手 ×2 图），v1 共 240 局（4 对手 ×2 图，其中 `kriegspiel` 一栏即 v1↔v2 直接对打的 60 局）；**座位**：逐局交替先手；**种子**：`1000 + i × 7919`，v1/v2 同序列；**日期**：2026-10-23。
- **只有 2 张图，无法满足 `ALGORITHMS_NOTES.md`「至少 3 张图 × 30 局」的通则**——同时回合模式当前就只有 `standoff` 与 `molten-throne` 两张内置图。因此**单图结论不可外推**：本档案已经出现两张图方向相反的实例（对 matrix-eq：standoff +46.7pp、molten-throne −13.3pp）。
- **全部为 2 人局**；3/6 人 `standoff` 未做胜率标定。
- **v1 基线是一次性重建的**：v1 实现不在仓库里，从 git 历史取出加载；harness 与对拍脚本都在 gitignored 的 `temp/` 下，**不是长期复现入口**。引擎分步语义再变时，本节的 v1 对照需要重新搭建才能重跑。
- **对手版本口径**：本节的 dest-prob 数字全部来自 **dest-prob v1**；v2 已于 2026-10-23 适配 3.8 分步引擎，同 harness 抽样对 kriegspiel v2 为 **21/60（35.0%）**（standoff 13/30、molten-throne 8/30），因此不能再把旧 52:8 当作当前差距。random-sim 与 matrix-eq 已是 v2。
- **未做**：真实服务器（HTTP + runner）口径的整局回归只有 `tests/algorithms/kriegspiel-selfplay.test.ts` 的零非法断言，没有胜率标定；Arena 同时回合跑批仍为 0 局。

## 决策逻辑

每次 `decide` 调用：

### 0. 前置短路

- 无 `ctx.owner` 或无 `game.plan` → null；
- `plan.committed` 已含己方 → null（等结算）；
- `plan.myQueue.length >= actionsPerTurn` → null（预算用尽）；
- 既无存活单位又无部署源 → null。

### 1. 每轮搜索一次、缓存整份计划

以 `${game.id}:${owner}:${roundNumber}` 为键缓存本轮搜索结果。首次调用时 `buildContext` 构建上下文（己方/敌方单位、据点、总部、地形表、计划期占用表、补给、`turnOrder`、攻击上限、确定性种子），再 `searchBestPlan` 搜出整份**有序**计划；后续 `decide` 只从缓存里按游标逐个吐出尚未入队的动作。

吐出时用「签名 → 计数」的多重集与 `plan.myQueue` 对账（而不是签名集合），因此计划里连续两个 `wait` 也能被逐个吐出、不会被去重吞掉。昂贵的搜索每轮只跑一次。

### 2. 计划期投影与合法性镜像（`projectPlan` / `isActionLegal` / `isPlanLegal`）

`projectPlan(ctx, plan)` 给出前缀执行完之后的虚拟局面：`positions`（单位 id → 虚拟站位）、`terrain`（自有爆破目标 → `plain`）。所有静态打分与合法性判定都建立在这个投影上：

- **移动**：目的格不是本格、在图内、且落在 `planReachable`（只按地形 BFS）范围内——**不再校验目的格是否被占**，因为 3.8.0 把它推迟到结算时判定；
- **攻击/治疗**：以投影站位为原点用 `computeAim` 推导形状，瞄准为空即非法；攻击还要过 `attacksPerUnit` 上限（按前缀已排攻击数）；
- **部署**：部署源存在、相邻、投影地形为平地、补给扣除前缀已计划花费后仍够；
- **爆破**：重装单位、相邻、投影地形为 `blocker`；
- **待命**：只校验行动点预算。

`isPlanLegal` 逐前缀校验整份计划，非法组合根本不进入 rollout。

### 3. 构建对手模型（`buildEnemyModel`）

对每个敌军枚举「原地 + 地形可达格」，按占点引力、火力机会、我方威胁、支援锚点、原地惯性打分，softmax 成落点概率分布；汇总出 `presence`（每格每敌出现概率）、`claimRisk`（每格被认领风险）、`attackEntries`（每格可能吃到的敌方火力）。可达格改用 `planReachable`——引擎已不再把单位/总部当墙，继续用 `utils.reachableCells` 会系统性低估敌军射程。该模型每轮只算一次，同时服务于静态候选打分与 rollout 时的敌方计划采样。

### 4. 分步候选生成（`stepCandidates`）

在给定前缀的投影局面上，为**下一个行动点**枚举全部候选并排序（末位恒为 `wait`，静态分 `WAIT_SCORE = -5`，因此 `wait` 只可能由爬山搜索为了对齐步序而主动插入，不会被贪心/采样选中）：

- **攻击**：按 `attackShape` 枚举合法瞄准（按覆盖格签名去重），静态分 = 覆盖格上敌军出现概率 × 期望伤害 + 击杀奖励 + 总部伤害放大 − 攻击者原地承伤；
- **治疗**：支援兵按 `healShape` 枚举，覆盖格内受伤友军按缺口计价，预计承伤 ≥ HP 时附加保命奖励；炮火区内的治疗直接跳过；
- **移动**：`planReachable` 排除**己方**前缀已占格与己方本轮新部署落点，落点静态分 = 占点价值 + 推进分 + 下一轮火力 − 期望承伤 − 拥挤惩罚，成功率按 `1 − 认领风险` 打折。注意「认领风险」度量的是敌军**移动/部署进来**的概率，**不含敌军当前已经站在该格**——这是实测到的缺陷，见「已知限制 #2」；
- **爆破**：重装单位相邻 `blocker`，静态分 = 清空该格后**全军可达格增量** × `DEMOLISH_REACH` − 行动点成本；若该格在计划期已被占用则重罚（爆破失败会级联作废该单位本轮后续动作）；
- **部署**：部署源 × 兵种 × 相邻平地，基础分 × 兵种系数 + 落点即据点的占领价值，按冲突风险打折，扣减前缀已计划部署花费。

候选按 `planSignature(prefix)` 缓存，`generateSeedPlans` 与 `refinePlan` 共享同一份缓存。

### 5. 种子计划与采样（`generateSeedPlans`）

一份 `greedyPlan`（每步取当前最高正分候选）+ K−1 份 `sampledPlan`（对 top 候选做 softmax 采样，温度 `sampleTemp`）。两者都走 `buildPlanStepwise`：**每步都在最新前缀投影下重新生成候选**，因此天然产出"移动→再攻击"这类跨行动点组合。去重签名**顺序敏感**——行动点顺序不同就是不同计划。

### 6. rollout 打分（`scorePlan`）

每份计划跑 `rollouts` 次：每次以 `(baseSeed + i·黄金比)` 重新播种 `mulberry32`，`sampleAllEnemyPlans` 按性格采样各席位的**有序**敌方计划，`simulateRoundSteps` 真实结算单轮，`evalBoard` 估值。返回 `{mean, std, risk}`，其中 `risk = mean − λ·std`；若任一采样命中终局（`|value| ≥ TERMINAL/2`，即己方总部被摧毁或敌方全灭），则直接按 `mean` 主导，避免标准差把必胜/必败信号淹没。

### 7. JS 分步单轮结算器（`simulateRoundSteps`）

逐字镜像 `src/engine/simultaneousResolve.ts` 的 `resolveRoundSteps`（单轮）。队列数组顺序即行动点顺序，第 k 步在所有活跃席位之间同时结算完才进入第 k+1 步。每一步内部子阶段严格对齐引擎：

1. **级联预检**：上一步硬失败的单位，本步动作全部作废（`previous_action_failed`），行动点照扣；
2. **步初占用快照**：本步开始时的每格占用，供到达判定使用；
3. **到达判定**：目的格冲突（同一步 ≥2 个动作声明同一格）全部失败；地形/占用阻挡失败；**同一步先移出再移入**允许（A 离开 X、B 进入 X 同时成功，交换位置与链式腾格均可），依赖的移出失败则依赖的移入迭代传播为失败；
4. **部署**：扣补给（含 `deployDiscount`）、在到达判定的落点创建单位；
5. **移动**：按到达判定落位；失败即记入级联集合；
6. **爆破**：重装、相邻、`blocker`、无人占用；清出的平地**从下一步起生效**（本步其余判定仍看旧地形）；
7. **待命**：只消耗行动点；
8. **攻击/治疗**：按 `turnOrder` 收集；攻击以**结算时的实际站位**重新 `computeAim`，`attackLock` 兵种锁定**计划时刻**点击格上的敌方单位；超 `attacksPerUnit` 的攻击作废并级联；先施放全部治疗（覆盖格内受伤友军各自掷量、上限截断），再按 `turnOrder` 施加伤害，累计总部伤害与击杀价值；
9. **死亡与淘汰**：伤害全部结算完才统一判死，总部被摧毁 / 歼灭类模式全军覆没即淘汰席位；
10. **终局检查**：活跃席位 ≤1 立即结束，且**跳过**轮末占点（引擎在终局轮提前返回）。

不含炮火收缩 / 收入 / 维修 / 翻盘补给——单轮 rollout 只需结算后的棋盘，用 `evalBoard` 收口。

### 8. 联合搜索（`searchBestPlan`）

种子计划逐一 rollout 打分取最优；再做爬山精修，邻域为「用同单位的其他候选替换第 k 步 / 删掉第 k 步 / 在第 k 步插入 `wait` / 交换第 k 与 k+1 步 / 追加一步」。改动第 k 步会改变其后所有步的投影，因此每个候选都过一遍 `isPlanLegal`；邻域先用 `screenRollouts` 粗筛，只有胜出者按满额 `rollouts` 复核，避免被小样本噪音牵着走。全程受 `timeBudgetMs` 墙钟上限约束，到点即返回当前最优。

## 实现细节

- **合法性镜像**：动作枚举复用 dest-prob 的 `computeAim`/`enumerateAims`（已逐字镜像 `planning.ts` 的 `coveredCellsFor`）；计划期校验镜像 `planning.ts` 的前缀投影口径；结算器镜像 `simultaneousResolve.ts` 的 `resolveRoundSteps`。`tests/algorithms/kriegspiel-selfplay.test.ts` 在真实 standoff / molten-throne 对局上把每个 `decide` 输出喂给引擎入队校验，全部接受、零非法。
- **结算保真度对拍**：`temp/krieg-fidelity.mts` 把伤害/治疗方差归零使结算完全确定，随机推进 3 轮制造多样局面后用 kriegspiel 自己的候选生成合法计划，再让**真实引擎**（`queue*Action` → `resolveRoundSteps` → `captureControlPoints`）与 **JS 分步结算器**跑同一份计划，逐点比对存活单位 `(owner,type,q,r,hp)`、总部 HP/存活、据点归属、补给与席位状态。standoff 与 molten-throne 各 20 个局面，**零偏差**。
- **确定性**：不使用 `Math.random`；rollout 随机源由 `(rngState, roundNumber, owner)` 播种（`stateSeed`），同棋盘可复现，便于回放与标定。
- **性能**：敌军落点模型与地形/占用表每轮只算一次，分步候选按前缀签名缓存，搜索结果按轮缓存。standoff 上单次 `decide` 约 45ms（含每轮一次的整份搜索），墙钟上限 `KRIEG_TIME_MS`（默认 2000ms）兜底保护线上 runner 与跑批。
- **可调参数**（环境变量）：`KRIEG_ROLLOUTS`（默认 32）、`KRIEG_SCREEN`（8，爬山粗筛）、`KRIEG_CANDIDATES`（14）、`KRIEG_REFINE`（2）、`KRIEG_TIME_MS`（2000）、`KRIEG_LAMBDA`（0.5）、`KRIEG_TEMP`（40）。
- **`wait` 的落地**：算法只会输出计划动作，`wait` 需要 runner 侧支持——`algorithms/lib/api-client.mjs` 增加 `wait()`（`POST /api/games/:id/plan/wait`），`algorithms/lib/interfaces.mjs` 增加 `case 'wait'` 分支。

## 性能表现

### 标定口径（本节全部表格适用）

| 项 | 值 |
|---|---|
| 引擎版本 | **3.8.1**（分步结算，`src/engine/simultaneousResolve.ts`） |
| 地图池 | `standoff`（2 人）/ `molten-throne`（2 人）——同时回合模式的**全部**内置地图，只有 2 张，无法满足「至少 3 张图」的通则 |
| harness | `temp/kriegspiel-arena.mts`，headless 混合对战，**直接驱动真实 `src/engine/`**（不走 HTTP、不是镜像裁判） |
| 局数与座位 | 每个「地图 × 对手」组合 30 局，逐局交替先手（奇数局换座） |
| 种子 | `seed = 1000 + i × 7919`，v1 与 v2 的对照跑用**完全相同**的种子序列 |
| 日期 | 2026-10-23 |
| 统计项 | 胜率、非法动作、裁定分、总部伤害、击杀价值、终局据点/军力/补给、回合数、`decide` 耗时、行动构成 |

> harness 与保真度对拍脚本都在 gitignored 的 `temp/` 下，**不是长期复现入口**（同 `ALGORITHMS_NOTES.md`「数据源与复现」对 `temp/threat-bench.mts` 的口径）。要复现需按上面参数重建；把 harness 提升到 `scripts/` 是待办。

### v2 当前快照（可用于选型）

每个「地图 × 对手」组合各 30 局，逐局交替先手，合计 180 局零非法动作。引擎 3.8.1，harness `temp/kriegspiel-arena.mts`（真实引擎），2026-10-23。

| 对手 | 地图 | kriegspiel v2 胜 | 对手胜 | 胜率 | 双侧 p | 非法动作 | 平均轮数 | 平均胜分差 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| random-sim v2 | standoff | **30** | 0 | **100%** | <0.0001 | 0 | 14.3 | 1079.5 |
| random-sim v2 | molten-throne | **30** | 0 | **100%** | <0.0001 | 0 | 14.8 | 3442.3 |
| dest-prob v1 | standoff | **26** | 4 | **86.7%** | 0.0001 | 0 | 15.0 | 330.5 |
| dest-prob v1 | molten-throne | **26** | 4 | **86.7%** | 0.0001 | 0 | 19.9 | 641.9 |
| matrix-eq v2 | standoff | **27** | 3 | **90.0%** | <0.0001 | 0 | 13.9 | 727.9 |
| matrix-eq v2 | molten-throne | 2 | **28** | **6.7%** | <0.0001 | 0 | 13.0 | 767.9 |

合计：对 random-sim **60:0**、对 dest-prob **52:8（86.7%，p<0.0001）**、对 matrix-eq v2 **29:31（48.3%，p=0.90）**。

> **对 matrix-eq 的合计 48.3% 没有意义，必须按图拆开看**：standoff 90.0% 与 molten-throne 6.7% 都在 p<0.0001 上显著，方向相反，合并成一个「五五开」会把两个强结论互相抵消。
>
> **对 dest-prob 的 86.7% 是 v1 口径**：dest-prob 已于 2026-10-23 升 v2，同 harness 抽样对 kriegspiel v2 为 21/60（35.0%，standoff 13/30、molten-throne 8/30），因此 52:8 不能作为当前差距。也不要把它归因成「dest-prob 的计划在分步引擎下大量失败」——v1 同批 standoff 对局里 dest-prob 的结算期失败只有 **0.6/局**，而 kriegspiel v2 自己是 **17.1/局**（见「代价与边界」）。可观测的差异在总部与节奏上：dest-prob v1 对 kriegspiel v1 打出 **55.8** 点总部伤害、对 v2 只有 **5.0**；v1 只回敬 10.7、v2 回敬 30.3。standoff 的 `enemyHqDamage` 权重是 5，仅这一项就相差约 250 裁定分，与 dest-prob 对 v1 拿到 857.2 分、对 v2 只有 533.7 分一致。

### v2 场均统计（同一批 180 局，kriegspiel v2 视角）

| 指标（场均） | vs random standoff | vs random molten | vs dest-prob standoff | vs dest-prob molten | vs matrix-eq standoff | vs matrix-eq molten |
|---|---:|---:|---:|---:|---:|---:|
| 裁定总分 | **1312.7** | **3924.2** | **803.6** | **2337.1** | **1149.1** | 2496.6 |
| 对手裁定总分 | 233.2 | 481.9 | 533.7 | 1720.6 | 499.2 | 1764.3 |
| 总部伤害 | **80.2** | **96.6** | 30.3 | 7.4 | **93.9** | 2.8 |
| 击杀价值（killValue） | 95.0 | 7.7 | 172.0 | 132.0 | 129.4 | 32.4 |
| 终局据点数 | **6.90** | **23.47** | 3.57 | **14.60** | **4.73** | 1.43 |
| 终局军力 | 924.7 | 765.2 | 541.1 | 514.4 | 576.0 | 55.1 |
| 剩余补给 | 22.6 | 66.0 | 12.8 | 40.7 | 24.8 | 16.7 |
| 决策耗时 | 45.3ms/次 | 113.2ms/次 | 45.4ms/次 | 168.7ms/次 | 43.5ms/次 | 141.7ms/次 |

行动构成（30 局合计，kriegspiel v2）：

| 对局 | 移动 / 部署 / 攻击 / 治疗 / 爆破 / 待命 |
|---|---|
| vs random standoff | 760 / 427 / 903 / 36 / 0 / 4 |
| vs random molten | 826 / 376 / 564 / 2 / 6 / 0 |
| vs dest-prob standoff | 1082 / 383 / 660 / 86 / 0 / 0 |
| vs dest-prob molten | 1334 / 427 / 586 / 26 / 3 / 1 |
| vs matrix-eq standoff | 920 / 369 / 617 / 143 / 0 / 0 |
| vs matrix-eq molten | 959 / 357 / 214 / 16 / 1 / 0 |

### 已知短板：molten-throne 上被 matrix-eq 斩首（2:28）

数据形态很特殊——**kriegspiel 场均裁定分 2496.6 高于 matrix-eq 的 1764.3，却只赢 2 局**：

| | kriegspiel v2 | matrix-eq v2 |
|---|---:|---:|
| 平均轮数（上限 20） | 13.0 | 13.0 |
| 对敌方总部伤害 | 2.8 | **93.3**（总部 HP 100） |
| 终局军力 | 55.1 | 281.0 |
| 部署次数（30 局合计） | 357 | 79 |
| 终局补给 | 16.7 | 181.5 |

诊断：matrix-eq 全力斩首，几乎每局都在第 13 轮左右打爆 kriegspiel 的总部（HP 100、防御 3），对局提前结束；而 kriegspiel 把补给全部投进部署（357 次 vs 79 次）、按裁定权重抢据点（molten-throne 一格据点 **75 分**，而总部满血只值 `100 × ownHqHp 2 = 200 分`），分数一路领先却在终局判定上被一票否决。

根因是**单轮 rollout 的视野**：`evalBoard` 里的总部承伤是线性的，掉到 0 才是 `TERMINAL`。于是每一轮的局部最优都是「让总部再挨一下，去换一格据点」——一轮挨 10 点血只扣 20 分，一格据点值 75 分——N 轮后被斩首，而 1 轮的视野永远看不到 N 轮后的死。这与 v1 的「已知限制 #1：只结算单轮」是同一条，只是 3.8.0 让 molten-throne 上的斩首路线真正可达，才把它暴露出来。

**而且 v2 在这一项上比 v1 更差，不是更好**：同 harness 同种子下 v1 对 matrix-eq 是 6:24、v2 是 2:28（见「同口径对照」）。v2 的分步机动让它更彻底地投入抢点（vs matrix-eq 时 30 局只攻击 214 次、移动 959 次，v1 是攻击 499 次、移动 905 次），终局军力 55.1 也远低于 v1 的 145.6——同样的斩首压力下，v2 把更多资源换成了分数而不是生存。

试过但**没有采纳**的修法：给总部血量比例加凸性惩罚（低于 60% 血量按二次项扣分，`KRIEG_HQ_URGENCY` 扫 1800 / 4000）。molten-throne 8 局对照下**胜负序列完全不变**，场均裁定分只动 0.6%——说明在 24 格据点 ×75 分的尺度面前，单轮的总部凸性项根本压不过抢点收益。要真正修好需要**多轮视野**（把 rollout 延展到 2–3 轮，或给总部引入"剩余存活轮数"的期限量纲，参 `verdict` 的攻城排程思路），属于独立的标定课题。

### 历史标定（3.7.3 旧规则，v1）— 不可与上面的当前快照相减

> **以下数字采集于 3.7.3 引擎（旧 `resolveRound` 整轮单发结算）与 v1 实现，harness 也不同。按 `ALGORITHMS_NOTES.md`「阅读须知」第 4 条，3.8.0 前后的结果不能混在一张表里，也不能相减。** 保留它只为追溯 v1 当时的验收结论；v1 → v2 的合法对照见「同口径对照」一节。

| 对手 | 地图 | v1 胜率（3.7.3 旧规则） |
|---|---|---:|
| random-sim v1 | standoff | 100%（30:0） |
| random-sim v1 | molten-throne | 100%（30:0） |
| dest-prob v1 | standoff | 63.3%（19:11） |
| dest-prob v1 | molten-throne | 50.0%（15:15） |

v1 时期 molten-throne 上**双方总部伤害均为 0**：该图 `deployFromHq: false`、总部分居半径 6 的两角，旧规则下 20 回合内谁都打不到对方总部，胜负完全由据点（权重 75）与军力/击杀决定。

## 使用场景

1. **同时回合模式的搜索型内置算法**：大厅「添加 AI → 算法脚本」中与 random-sim、dest-prob、matrix-eq 并列。**选型必须按图看，不能笼统说「最强」**：`standoff` 上它是当前快照里最强的内置算法（对 matrix-eq v2 90.0%、对 dest-prob v1 86.7%，均 p<0.0001；对 dest-prob v2 抽样 13/30）；`molten-throne` 上它被 matrix-eq v2 的斩首打法压制到 6.7%，该图应优先选 matrix-eq。
2. **分步结算语义的参考镜像**：`simulateRoundSteps` 是 `resolveRoundSteps` 的一份纯 JS 独立实现，且与真实引擎逐点对拍过 40 个局面零偏差，读它可以快速核对级联失败、到达依赖链、`attackLock` 跟随、逐步死亡这些容易踩空的细节。
3. **联合计划搜索的教学样例**：展示同时回合与「逐动作边际评估」的根本差异——把整份有序计划真实结算一遍，才能发现集火/治疗/封锁/换 tempo/`wait` 对齐的组合拳。

## 兼容性

- **支持模式**：仅同时回合（simultaneous）。
- **不支持模式**：标准（standard）、歼灭（annihilation）、大逃杀（royale）。royale 虽共享计划/提交与分步结算机制，但带炮火缩圈且无总部，结算器只把炮火当作禁入/禁疗区、未建模缩圈推进，收入/维修/翻盘补给也未建模，目标计价未在该轴标定，故不声明。
- **地图兼容性**：所有 simultaneous 模式地图（standoff、molten-throne），已覆盖 2 人 standoff 与 2 人 molten-throne 的 headless 对局（各 30 局 × 3 对手）。
- **规则配置**：读取 `balance.actionsPerTurn`、`balance.attacksPerUnit`（默认 1）、`balance.damageVarianceRange`、`balance.healVarianceRange`、部署折扣与单位形状配置，不硬编码地图常量。
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

1. **只结算单轮**：rollout 模拟的是「这一轮分步结算后的棋盘」，用裁定权重估值收口，不做多轮/整局展开；跨轮的战略铺垫（如故意养兵、长线包围）依赖估值函数的即时口径，可能短视。**这不是理论隐患而是实测短板**：molten-throne 上被 matrix-eq 打到 2:28（v1 是 6:24，v2 更差），根因就是单轮视野无法给「N 轮后被斩首」定价，详见「已知短板」一节。
2. **移动/部署目的格不排除敌军当前占位（实测缺陷，未修）**：`stepCandidates` 的排除集 `cellsTakenByPrefix` 只含己方投影站位、己方总部与本轮已排部署落点；敌军占着的格子照样生成候选，且 `moveStaticScore` 只按 `combinedClaimRisk`（敌军**到达**概率）打折，不表达「敌军**已经站在这里**」。3.8.0 把占用判定推迟到结算，于是这类动作入队合法、多数在结算时以 `destination_occupied` 失败。standoff 30 局实测 **513–692 次失败（17.1–23.1/局）**，而 v1 只有 39–40 次（1.3/局）、dest-prob 只有 17–91 次（0.6–3.0/局）；折算成 standoff 的 5 行动点/回合，即 **23–31% 的行动点以失败告终**，少数还级联作废同单位后续动作。修法明确（把 occupant 在本步前离开的概率计进成功率），但会改变全部标定数字，需要重跑，故本次只记录不修。详见「代价与边界」。
3. **结算器是近似镜像**：`simulateRoundSteps` 不含炮火收缩/收入/维修/comeback 补给，与引擎分步语义对齐但非全量。对拍只在方差归零、2 人局、两张内置地图上做过，且是一次性标定脚本（`temp/krieg-fidelity.mts`，未入 CI）——引擎分步语义再变时需要手动重跑对拍。
4. **对手组合是启发式**：rollout 的敌方计划来自 objective/aggressive/random 三种性格的采样，且敌方采样**只产出移动/攻击/部署**，不含 `wait`、爆破与治疗；对会 `wait` 对齐火力或先爆破开路的对手，rollout 会低估其威胁。风险项（λ·std）只能缓解、不能消除。采样出的敌军移动频率也与真实对手不同，这会直接影响第 2 条里「占位者会不会让开」的判断。
5. **`wait` 与爆破极少被选中**：`wait` 静态分恒负，只有爬山精修发现「插一步能让后续动作命中」时才会保留（180 局合计 5 次）；爆破需要清出的格子带来 ≥3 格可达增量才划算，只在有障碍的 molten-throne 上触发（180 局合计 10 次）。两者的价值主要在语义正确，而非实战频次。
6. **部署经济学未按图标定**：`DEPLOY_BASE` 是全局常数，molten-throne 上 kriegspiel 30 局部署 357 个单位而 matrix-eq 只部署 79 个、终局补给 16.7 vs 181.5——低起始补给（30）的图上「把补给全砸进部署」明显吃亏，但单轮 rollout 看不到部署单位下一轮被收割。
7. **搜索受墙钟约束**：`refinePasses` 与候选数有限，行动点很多时爬山可能停在局部最优；提高 `KRIEG_ROLLOUTS`/`KRIEG_CANDIDATES`/`KRIEG_REFINE` 能改善但线性增加耗时。v2 单次 `decide` 已比 v1 慢 15–40 倍（43.5–168.7ms vs 2.8–4.5ms），继续加预算要先解决延迟。
8. **样本以 2 人局、2 张图为主**：标定全部为 2 人 standoff / molten-throne——同时回合模式只有这两张内置图，**无法满足「至少 3 张图 × 30 局」的通则**，单图结论不可外推（对 matrix-eq 已经出现两图方向相反的实例）。3/6 人 standoff 未做完整胜率标定，多席位敌人叠加时对手组合采样与到达冲突的独立性假设会变弱。

## 一句话总结

兵棋推演算法（kriegspiel）v2 是同时回合模式的搜索算法：把整份**有序**计划塞进一个逐字镜像 3.8.0 `resolveRoundSteps` 的 JS 分步结算器里真实跑一遍，对 objective/aggressive/random 三种对手组合做蒙特卡洛 rollout，用「均值 − λ·标准差」的风险调整分挑选、再以「换步/删步/插 `wait`/换序/追加」的邻域爬山精修——用真实分步结算代替解析估价，用有序联合搜索代替边际贪心。
