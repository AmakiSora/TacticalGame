# crucible — 熔炉算法

> 歼灭模式（annihilation）搜索型内置算法。整回合束搜索 + 对抗集火回推 + 缩圈时间线逃逸推演。
> 独立设计：策略完全由歼灭规则本身推导，不参考、不调用、不借鉴仓库内任何其他算法的实现。

## 身份与文件

| 项目 | 值 |
|---|---|
| 注册名 | `crucible` |
| 展示名 | 熔炉算法 |
| 版本 | v1 |
| 模式 | `annihilation`（全链路模式隔离，其他模式一律返回 null） |
| bot type / 竞技场参与者 | `algo_crucible` / `algo_crucible@v1` |
| 实现 | [algorithms/builtin/crucible.mjs](../../builtin/crucible.mjs)（自包含，零外部依赖） |
| 接口类型 | 策略接口（`decide`，回合级计划缓存逐动作续吐） |
| 测试 | [tests/algorithms/crucible.test.ts](../../../tests/algorithms/crucible.test.ts) |
| 作者 | Qwen3.8Max-Qoder |

## 算法原理

四个第一性观察（全部来自规则，不来自其他算法）：

1. **战斗单向、无 retaliation**（`src/engine/combat.ts`）：击杀不仅移除对方输出，还按被杀单位造价计入 `killValue`，并蒸发对方 `armyValue`。因此"本回合能否凑出斩杀"是行动排序的核心指标；只削血不斩杀的收益远低于斩杀。
2. **炮火击杀无归属**（`src/engine/engine.ts` `updateArtilleryForRound`）：己方单位被圈烧死是纯亏（军队价值蒸发、无人得分），敌方被烧死也只是价值蒸发。每个单位都要沿本局缩圈时间线做"向心逃逸"推演，把不可避免的圈伤折进局面分；同时尽量把敌军压在圈缘。
3. **AP 按单位激活计费**（`src/engine/validation.ts` `consumeAction`）：一个激活 = 移动 + 攻击/治疗（顺序任意），部署当回合还能免费补刀。整回合是一个组合优化问题——让路、集火次序、补员落点都相互耦合，贪心逐动作会短视。
4. **对手下一回合必然集火**：用"移动范围 BFS + 射程环"的可达投影枚举每个敌单位的潜在射击位，按贪心斩杀分配估计己方期望损失，作为对抗性局面评估主项。这迫使算法保持射程纪律（游侠风筝、残血后撤），而不是站桩换血。

### 整回合束搜索（`planTurn`）

- 在轻量镜像棋盘（`makeSim`/`cloneSim`）上模拟整回合：移动即时改占据、击杀腾出格子、部署立即占位并可免费攻击——与引擎的即时执行语义一致。
- 每层激活候选 = 各单位的（移动目的地 × 最优攻击/治疗/爆破）+ 部署候选；目的地按廉价启发（即时动作价值 + 占领价值 + 向心趋势 + 距离纪律）剪枝到每单位 4 个，部署保留前 6 个，节点候选上限 18。
- 束宽 7、深度上限 8（覆盖 4 AP + 免费后续动作），每个节点用完整局面评估打分，保留前 7。
- 空激活（原地不动且无动作）在候选生成阶段剔除，不浪费 AP。

### 局面评估（`evaluate`）

按本局 `adjudicationWeights` 实时计价，不写死任何权重：

- **军力差**：Σ `cost × hp/maxHp × armyValue权重`（敌我差）+ 已入账 `killValue × killValue权重`。
- **对抗回推**：敌方下回合贪心集火期望损失（全扣）− 我方下回合威慑（×0.45 折算）。
- **圈伤推演**（`ringLoss`）：对每个单位沿 `radiusAt(round+h)`（h=1..5）模拟向心逃逸（每轮最多 moveRange 步、避开障碍与占据），吃到的圈伤按军队价值折分；己方全扣、敌方 ×0.85。
- **据点经济**：收入 × 剩余安全回合 × 0.8（被圈吞掉后的收入不算）；`controlPoint` 权重非零的图（随机图常见）另加持有分（流量 0.7 + 期末存量 0.3 近似）。
- **补给期权**：有安全部署坪且还有回合时，补给按转化潜力小额计价；终局（≤6 轮）主动把补给变现为军力。
- **终局 override**：敌方全灭 +1e6；己方全灭 −1e6（**先判己方**——双方空场时部署是唯一活路，不能让"敌方全灭"分支抢先给满分，这是零初始单位随机图的回归点）。

### 消耗战终局的试验结论（`minimumSafeRadius === 0` 的图，如 trench-run）

曾针对全图消耗战（圈收到 0、每轮全员吃圈伤）试验"提前部署支援兵 + 治疗对冲加成 + 终局补给变现"，**同口径标定全部回退**：支援兵启发式干扰了束搜索自身的 AP/补给权衡（vs shrinkroll 固定图 75:5 → 65:15 / 67:13，随机图 20:2 → 17:5）。最终版本只保留通用支援条件（≥2 个残血单位且支援兵 <2 时部署候选 +25），治疗价值由局面评估中的圈伤推演自然体现——规则级建模已经覆盖消耗战，额外启发式反而过拟合。

## 实现细节

### 核心参数

| 常量 | 值 | 含义 |
|---|---|---|
| `BEAM_WIDTH` | 7 | 束宽 |
| `MAX_DEPTH` | 8 | 激活深度上限 |
| `DEST_KEEP` | 4 | 每单位保留目的地数 |
| `DEPLOY_KEEP` | 6 | 部署候选上限 |
| `RING_HORIZON` | 5 | 圈伤推演轮数 |

### 合法性镜像（与引擎逐条对齐）

- 移动：BFS 当前棋盘（水/障碍/双方单位均阻挡），`hasMoved` 一次性。
- 攻击：`max(minimumDamage, attack - defense)` 期望伤害（方差 ±damageVarianceRange 只影响斩杀边际，镜像按均值），`hasActed` 一次性，无 HQ 目标。
- 治疗：仅 support、`healRange` 取 config、支援兵与目标都不得在危险区。
- 部署：仅己方据点（`canDeploy !== false`）、起点/落点都不得在危险区、相邻空平原、按据点折扣计费；新单位 `hasMoved=true`、当回合可免费攻击/治疗。
- 爆破：仅 heavy、相邻 blocker、无占据。
- AP：`actionSpent` 单位后续动作免费；`actionsUsed >= actionsPerTurn` 只挡新激活。
- 炮火：`radiusAt(round)` 完全按 `artilleryStateForRound` 公式（startRound/intervalRounds/minimumSafeRadius），不读地图名、不写死回合表。

### 计划缓存与偏差重规划（`decide`）

- 回合首次调用做整回合规划，动作入队；后续调用逐个对**真实状态**校验续吐。
- 队首动作不合法（目标已死/被占等）即丢弃试下一个；队列空则重新规划。
- 部署补刀的攻击者 id 由服务器分配，镜像 id 不可用：payload 带 `deployQ/deployR`，续吐时按落点解析真实单位 id（回归测试覆盖）。
- 缓存按 `(gameId, seat)` 隔离，多人/多局同进程不串。

### 必须守住的约束（回归过，别改回去）

1. `evaluate` 先判己方全灭再判敌方全灭（零初始单位随机图首回合必须部署）。
2. 空激活剔除（原地不动无动作不耗 AP）。
3. 部署补刀按落点解析真实 id，不得发送 `sim_new_*`。
4. 一切权重/射程/费用/缩圈参数取自本局 config 与单位实例，不写死。

## 性能表现

（最终标定数据见下表，真实引擎进程内 harness `scripts/crucible-arena.mts`，成对换座，不写竞技场历史。）

**当前快照（2026-10-29，3.8.15 真实引擎，`scripts/crucible-arena.mts`，Node 24.18.0，成对换座）**：固定图种子基 `20261029`（每图 40 局 = 20 组换座），随机图种子基 `90210`（10 张图各换座两局）；随机图调用项目随机地图生成器（`mode: 'annihilation'`，默认参数随机），含零初始单位、非零占领/总部权重、不同缩圈表等变体：

| 图池 | 对手 | 局数 | 胜 | 负 | 平 | 非法动作 |
|---|---|---:|---:|---:|---:|---:|
| artillery-zone + trench-run（各 40） | vortex | 80 | 80 | 0 | 0 | 0 |
| artillery-zone + trench-run（各 40） | shrinkroll | 80 | 75 | 5 | 0 | 0 |
| 随机新图 10 张 | vortex | 22 | 21 | 1 | 0 | 0 |
| 随机新图 10 张 | shrinkroll | 22 | 20 | 2 | 0 | 0 |
| artillery-zone + trench-run（各 60） | random-annihilation | 120 | 120 | 0 | 0 | 0 |
| 随机新图 10 张 | random-annihilation | 22 | 22 | 0 | 0 | 0 |

合计 **346 局 338 胜 8 负、零非法动作**。对 shrinkroll 的 5 负全部在 trench-run（artillery-zone 40:0），均为第 16–18 轮全图消耗战残局被击杀收尾；随机新图对 vortex / shrinkroll 各有 1 / 2 个换座败局。平均耗时 0.2–1.4s/局（含对手决策，进程内无网络往返）。随机新图每图仅两局，不满足逐图 30 局稳定选型口径；样本零负不等于不存在可击败它的局面，对未来新增算法/地图不作必胜承诺。

## 决策时间

整回合规划一次（束搜索 + 逐节点完整评估），后续动作仅校验续吐。双人局平均约 0.3–1.1s/局（含对手耗时），单次规划数十毫秒量级；无网络往返开销（进程内评估）或每动作一次 REST（线上 runner）。

## 已知限制

- 期望伤害按均值计价，±方差在斩杀边际（伤害≈血量）时可能误判；未做概率分布卷积。
- 对抗回推假设对手贪心集火，对刻意诱饵/非贪心对手估计偏保守。
- 圈伤逃逸推演是贪心向心近似，复杂地形（连续障碍）下可能低估 escape 成本；爆破开路只在 heavy 相邻 blocker 且向心时纳入候选。
- 束宽/深度固定，极端多单位局面（6-8 人混战）下搜索覆盖受限。
- 对"未来新增算法"没有必胜保证：强度来自规则级建模的泛化（不读地图名、不针对对手策略），新对手若利用上述近似盲区仍可能取胜。

## 优化方向

- 斩杀边际的概率化伤害（方差卷积）与多对手击杀概率合成。
- 对抗回推升级为对手策略采样（多情境混合评估）。
- 圈伤推演改用真实 BFS 逃逸路径（含爆破开路）。
- 自适应束宽（按单位数/AP 预算动态分配节点预算）。

## 兼容性

- 仅 `annihilation` 模式；`standard`/`simultaneous`/`royale` 一律返回 null。
- 注册表 `ALGORITHMS` + `ALGORITHM_META` 单源接入大厅 bot 清单、runner、评估控制台与竞技场榜单。
- 无外部依赖、无环境变量、无文件 IO；可在进程内评估通道与 REST runner 两种链路运行。

## 使用方式

### 通过前端添加

大厅选择地图（歼灭模式）→ 添加机器人 → 选择「熔炉算法」。

### 通过命令行运行

```bash
node algorithms/runner.mjs --algorithm crucible --url http://localhost:3100 \
  --game <gameId> --token <playerToken> --side player_a
```

### 本地换座标定（真实引擎 headless）

```bash
npx tsx scripts/crucible-arena.mts --opp shrinkroll --games 40 --maps artillery-zone,trench-run
npx tsx scripts/crucible-arena.mts --opp vortex --games 0 --random 10 --seed 90210
```