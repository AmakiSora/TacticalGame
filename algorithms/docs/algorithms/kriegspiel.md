# kriegspiel — 兵棋推演算法

> 单算法档案，遵循 `ALGORITHMS_NOTES.md` 固定模板。

## 身份与文件

| 项 | 内容 |
|---|---|
| 文件 | `algorithms/builtin/kriegspiel.mjs` |
| 算法名 | `kriegspiel` |
| 注册键 | `algo_kriegspiel` |
| 显示名称 | 兵棋推演算法（Kriegspiel / Rollout Planner） |
| 定位 | 同时回合模式的搜索算法：分步结算 rollout + 整份计划联合搜索 + 风险规避 |
| 实现日期 | 2026-10-22（v1，基于 release/3.7.2 分支）/ 2026-10-23（v2，适配 3.8.0 分步引擎） |
| 语言 | JavaScript (ESM)，零依赖，Node ≥ 24 |
| 接口类型 | 策略接口（`decide`） |
| 支持模式 | 仅同时回合（simultaneous） |
| 参考实现状态 | v2：与真实引擎逐点对拍 40 个局面零偏差；standoff / molten-throne 各 30 局 ×3 对手零非法动作 |

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

v1 的镜像对象是旧的 `src/engine/simultaneous.ts:resolveRound`（整轮一次目的格声明池 → 部署/移动 → 攻击/治疗），3.8.0 把它换成了 `src/engine/simultaneousResolve.ts:resolveRoundSteps`。v2 是一次**镜像层与搜索层的同步重写**：

| 维度 | v1（整轮单发结算） | v2（按行动点分步结算） |
|---|---|---|
| 结算器 | `simulateRound`：一轮三阶段 | `simulateRoundSteps`：逐步推进，每步十个子阶段（见下） |
| 单位行动次数 | 一单位一轮一动作（`ctx.used` 认领） | 同一单位可跨行动点连动；攻击次数受 `balance.attacksPerUnit`（默认 1）约束 |
| 计划合法性 | 一单位一动作 + 目的格互不冲突 + 预算 | **队列前缀投影**：站位投影 + 自有爆破改写地形 + 只按地形寻路；占用/覆盖类判定推迟到结算（与引擎延迟判定口径一致） |
| 移动范围 | `utils.reachableCells`（把单位/总部当墙） | `planReachable`：只按水/障碍地形 BFS，镜像 `planning.ts` 的计划期寻路 |
| 失败语义 | 目的格撞车即全部失败 | 级联失败（硬失败作废该单位本轮后续动作）、到达判定（同一步先移出后移入、链式腾格、依赖传播）、逐步死亡 |
| 候选生成 | 整轮一次性枚举 | `stepCandidates(ctx, prefix, cache)`：每个行动点在投影后局面重新枚举，按前缀签名缓存 |
| 搜索邻域 | 换槽位 / 追加 | 换步 / 删步 / **插入 `wait`** / **交换相邻两步** / 追加；粗筛 `screenRollouts` + 满额 `rollouts` 复核 |
| 新增动作 | — | `wait`（对齐行动点，静态分恒负，只由搜索主动插入）、`demolish`（按可达格增量计价） |
| 敌方采样 | 每席位一份无序动作集合 | 每席位一份**有序**计划：逐步采样、按性格定攻击倾向、尊重攻击上限、避免自撞目的格 |

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
- **移动**：`planReachable` 排除前缀已占格与己方本轮新部署落点，落点静态分 = 占点价值 + 推进分 + 下一轮火力 − 期望承伤 − 拥挤惩罚，成功率按 `1 − 认领风险` 打折；
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

标定方法：`temp/kriegspiel-arena.mts` headless 混合对战，直接驱动 `src/engine/`（不走 HTTP），逐局交替先手，固定 `seed = seedBase + i × 7919`；每局双方完整跑完计划/提交/结算循环，统计胜率、非法动作、击杀、总部伤害、据点、军力、补给、决策耗时与行动构成。每个「地图 × 对手」组合各 30 局。

### v2 胜率总览（各 30 局，逐局交替先手，合计 180 局零非法动作）

| 对手 | 地图 | kriegspiel v2 胜 | 对手胜 | 胜率 | 非法动作 | 平均轮数 | 平均胜分差 |
|---|---|---:|---:|---:|---:|---:|---:|
| random-sim | standoff | **30** | 0 | **100%** | 0 | 14.3 | 1079.5 |
| random-sim | molten-throne | **30** | 0 | **100%** | 0 | 14.8 | 3442.3 |
| dest-prob | standoff | **26** | 4 | **86.7%** | 0 | 15.0 | 330.5 |
| dest-prob | molten-throne | **26** | 4 | **86.7%** | 0 | 19.9 | 641.9 |
| matrix-eq v2 | standoff | **27** | 3 | **90.0%** | 0 | 13.9 | 727.9 |
| matrix-eq v2 | molten-throne | 2 | **28** | **6.7%** | 0 | 13.0 | 767.9 |

合计：对 random-sim **60:0**、对 dest-prob **52:8（86.7%）**、对 matrix-eq v2 **29:31（48.3%）**。

### 场均统计（kriegspiel v2 视角）

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

### v1 → v2 强度变化（同口径各 30 局）

| 对手 | 地图 | v1 胜率 | v2 胜率 | 变化 |
|---|---|---:|---:|---|
| random-sim | standoff | 100%（30:0） | **100%（30:0）** | 持平（基线） |
| random-sim | molten-throne | 100%（30:0） | **100%（30:0）** | 持平（基线） |
| dest-prob | standoff | 63.3%（19:11） | **86.7%（26:4）** | **+23.4pp** |
| dest-prob | molten-throne | 50.0%（15:15） | **86.7%（26:4）** | **+36.7pp** |
| matrix-eq v2 | standoff | —（v1 时期 matrix-eq 尚未适配分步引擎） | **90.0%（27:3）** | 新增对照 |
| matrix-eq v2 | molten-throne | — | **6.7%（2:28）** | 新增对照，**已知短板** |

两个可解释的行为变化：

- **molten-throne 上总部伤害从 v1 的 0 变成 96.6**（对 random-sim）。v1 时期该图 20 回合内谁都打不到对方总部，胜负完全由据点决定；3.8.0 允许同一单位跨行动点连续移动后，一轮可以推进数格，斩首路线真的打得通了。
- **对 dest-prob 两图同时大幅提升**（63.3% → 86.7%、50.0% → 86.7%）。dest-prob 的镜像仍是旧口径（见 `dest-prob.md`），它排出的计划在分步引擎下会吃到级联失败与到达冲突，而 kriegspiel v2 的 rollout 与引擎逐点对拍一致。

> **matrix-eq 对照的口径差异**：`matrix-eq.md`「基准结果 III」记录的 `v2 vs kriegspiel 12:18` 是 **matrix-eq 自己的镜像裁判口径、对 kriegspiel v1** 的结果；本表是 `temp/kriegspiel-arena.mts` 口径、对 kriegspiel v2。两套 harness 的种子、局内驱动方式与统计项都不同，**不可直接相减**。可以确定的是：v2 在 standoff 上把 matrix-eq 打到 3:27，在 molten-throne 上被反打到 28:2。

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

根因是**单轮 rollout 的视野**：`evalBoard` 里的总部承伤是线性的，掉到 0 才是 `TERMINAL`。于是每一轮的局部最优都是「让总部再挨一下，去换一格据点」——一轮挨 10 点血只扣 20 分，一格据点值 75 分——N 轮后被斩首，而 1 轮的视野永远看不到 N 轮后的死。这与 v1 的「已知限制 #1：只结算单轮」是同一条，只是 3.8.0 让 molten-throne 上的斩首路线真正可达，才把它暴露出来（v1 时期该图双方总部伤害均为 0）。

试过但**没有采纳**的修法：给总部血量比例加凸性惩罚（低于 60% 血量按二次项扣分，`KRIEG_HQ_URGENCY` 扫 1800 / 4000）。molten-throne 8 局对照下**胜负序列完全不变**，场均裁定分只动 0.6%——说明在 24 格据点 ×75 分的尺度面前，单轮的总部凸性项根本压不过抢点收益。要真正修好需要**多轮视野**（把 rollout 延展到 2–3 轮，或给总部引入"剩余存活轮数"的期限量纲，参 `verdict` 的攻城排程思路），属于独立的标定课题。

## 使用场景


1. **同时回合模式的搜索型内置算法**：大厅「添加 AI → 算法脚本」中与 random-sim、dest-prob、matrix-eq 并列，给同时回合对局提供「会按行动点推演整份计划」的最强内置对手。
2. **分步结算语义的参考镜像**：`simulateRoundSteps` 是 `resolveRoundSteps` 的一份纯 JS 独立实现，读它可以快速核对级联失败、到达依赖链、`attackLock` 跟随、逐步死亡这些容易踩空的细节。
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

1. **只结算单轮**：rollout 模拟的是「这一轮分步结算后的棋盘」，用裁定权重估值收口，不做多轮/整局展开；跨轮的战略铺垫（如故意养兵、长线包围）依赖估值函数的即时口径，可能短视。**这不是理论隐患而是实测短板**：molten-throne 上被 matrix-eq 打到 2:28，根因就是单轮视野无法给「N 轮后被斩首」定价，详见「已知短板」一节。
2. **结算器是近似镜像**：`simulateRoundSteps` 不含炮火收缩/收入/维修/comeback 补给，与引擎分步语义对齐但非全量。对拍只在方差归零、2 人局、两张内置地图上做过，且是一次性标定脚本（`temp/krieg-fidelity.mts`，未入 CI）——引擎分步语义再变时需要手动重跑对拍。
3. **对手组合是启发式**：rollout 的敌方计划来自 objective/aggressive/random 三种性格的采样，且敌方采样**只产出移动/攻击/部署**，不含 `wait`、爆破与治疗；对会 `wait` 对齐火力或先爆破开路的对手，rollout 会低估其威胁。风险项（λ·std）只能缓解、不能消除。
4. **`wait` 与爆破极少被选中**：`wait` 静态分恒负，只有爬山精修发现「插一步能让后续动作命中」时才会保留（180 局合计 5 次）；爆破需要清出的格子带来 ≥3 格可达增量才划算，只在有障碍的 molten-throne 上触发（180 局合计 10 次）。两者的价值主要在语义正确，而非实战频次。
5. **部署经济学未按图标定**：`DEPLOY_BASE` 是全局常数，molten-throne 上 kriegspiel 30 局部署 357 个单位而 matrix-eq 只部署 79 个、终局补给 16.7 vs 181.5——低起始补给（30）的图上「把补给全砸进部署」明显吃亏，但单轮 rollout 看不到部署单位下一轮被收割。
6. **搜索受墙钟约束**：`refinePasses` 与候选数有限，行动点很多时爬山可能停在局部最优；提高 `KRIEG_ROLLOUTS`/`KRIEG_CANDIDATES`/`KRIEG_REFINE` 能改善但线性增加耗时。
7. **样本以 2 人局为主**：标定全部为 2 人 standoff / molten-throne；3/6 人 standoff 未做完整胜率标定，多席位敌人叠加时对手组合采样与到达冲突的独立性假设会变弱。

## 一句话总结

兵棋推演算法（kriegspiel）v2 是同时回合模式的搜索算法：把整份**有序**计划塞进一个逐字镜像 3.8.0 `resolveRoundSteps` 的 JS 分步结算器里真实跑一遍，对 objective/aggressive/random 三种对手组合做蒙特卡洛 rollout，用「均值 − λ·标准差」的风险调整分挑选、再以「换步/删步/插 `wait`/换序/追加」的邻域爬山精修——用真实分步结算代替解析估价，用有序联合搜索代替边际贪心。
