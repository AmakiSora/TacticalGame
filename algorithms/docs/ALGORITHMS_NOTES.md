# 算法 AI 开发笔记

> 本文档记录所有算法 AI 的设计、实现和性能变化。
>
> **维护口径（2026-10-24，对应 3.8.5）**：前半部分是当前规范；标为“历史标定”的表格只用于追溯，不代表当前强度。性能表必须带引擎版本、地图池、harness、局数与日期，否则不得作为选型依据。

算法 AI 是基于规则、搜索和启发式的 JavaScript 决策模块，无需训练模型即可运行。与强化学习模型相比，算法 AI 的优势在于开发迅速、可解释性强、无需 GPU，但性能上限受限于人工设计的策略质量。

## 阅读须知：当前口径

| 项目 | 当前值 |
|---|---|
| 代码版本 | 3.8.15 |
| 标准图池 | `default` / `breach` / `danger-close` / `dual-lanes` / `multiplayer-ring` / `whirlpool` |
| 同时回合图 | `standoff` / `molten-throne` / `mistpine` |
| 大逃杀图 | `snowflake` / `narrow-road`（`random-royale` / `apex`） |
| 歼灭图 | `artillery-zone` / `trench-run`（内置基线：`random-annihilation`；强度算法：`shrinkroll` / `vortex` / `crucible`） |
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
│   ├── random-annihilation.mjs  # 歼灭随机算法（歼灭模式）
│   ├── shrinkroll.mjs           # 缩圈推演算法（歼灭模式）
│   ├── random-royale.mjs # 大逃杀随机算法（大逃杀模式）
│   ├── apex.mjs          # 绝境算法（大逃杀模式）
│   ├── crucible.mjs      # 熔炉算法（歼灭模式）
│   ├── vortex.mjs        # 旋涡算法（歼灭模式）
│   ├── mcts.mjs          # 蒙特卡洛树搜索（标准模式）
│   ├── threat.mjs        # 威胁感知算法（标准模式）
│   ├── field.mjs         # 势场算法（标准模式）
│   ├── verdict.mjs       # 裁决线算法（标准模式）
│   ├── random-sim.mjs    # 同时随机算法（同时回合模式）
│   ├── dest-prob.mjs     # 落点概率算法（同时回合模式）
│   ├── kriegspiel.mjs    # 兵棋推演算法（同时回合模式）
│   ├── matrix-eq.mjs     # 矩阵均衡算法（同时回合模式）
│   ├── prism.mjs         # 棱镜算法（同时回合模式）
│   ├── tempo.mjs         # 时序掌控算法（同时回合模式）
│   ├── tempo-weave.mjs   # 经纬算法（同时回合模式）
│   ├── horizon.mjs       # 视界算法（同时回合模式）
│   └── README.md         # 算法开发指南
├── lib/                  # 共享工具库
│   ├── api-client.mjs    # REST API 客户端
│   ├── game-utils.mjs    # 游戏工具函数
│   ├── interfaces.mjs    # 算法接口适配器
│   ├── random-turn.mjs   # 轮流模式随机枚举（random / random-annihilation）
│   ├── royale-model.mjs # 大逃杀分步结算与轮界模型
│   └── random-plan.mjs   # 计划模式随机枚举（random-sim / random-royale）
├── docs/                 # 算法文档
│   ├── ALGORITHMS_NOTES.md   # 本文件
│   ├── RELEASE_NOTES.md      # 版本发布记录
│   └── algorithms/           # 单算法详细档案
│       ├── greedy.md
│       ├── random.md
│       ├── random-annihilation.md
│       ├── shrinkroll.md
│       ├── random-royale.md
│       ├── apex.md
│       ├── mcts.md
│       ├── threat.md
│       ├── field.md
│       ├── verdict.md
│       ├── random-sim.md
│       ├── dest-prob.md
│       ├── kriegspiel.md
│       ├── matrix-eq.md
│       ├── prism.md
│       ├── tempo.md
│       ├── tempo-weave.md
│       ├── horizon.md
│       └── vortex.md
├── registry.mjs          # 算法注册表与 ALGORITHM_META
├── registry.d.mts        # 注册表 TypeScript 类型声明
└── runner.mjs            # 通用运行器
```

## apex：绝境算法

`apex` v1 仅参与 `royale`，大厅类型为 `algo_apex`，竞技场参与者为 `algo_apex@v1`。实现分为 `builtin/apex.mjs`（策略）与 `lib/royale-model.mjs`（规则模型），不调用其他算法，也不读取地图名称、对手隐藏计划或随机数状态。核心参数表、终局估值设计与逐类动作生成见 [单算法档案](algorithms/apex.md)。

- **逃生与建军**：从地图地形和炮火配置计算未来六轮安全区的距离场；有重装时对障碍计入开路代价，连续障碍也能逐步爆破，但实际移动仍严格走平地。火力、射程、机动与治疗共同计价，后备兵力按行动点和未来安全区容量指数递减、站位风险较慢递减，避免过量建军挤占撤离机会；单兵净值平滑映射为非负值，避免把敌方残兵直接算成负资产。
- **同时博弈**：均衡推进、进攻与原地开火三类对手情境；按行动点展开束搜索，兼顾平均收益与最差情境；双人局对候选计划增加针对性回应校验。公开事件显示相同单位连续两轮同拍互撞时，轮换暂缓冲突移动，减少连续同拍互撞；不假定对手一定配合。规则模型处理冲突、失败连锁、锁定/范围攻击、治疗、全灭和下一轮炮伤。
- **公开接口**：整轮计划缓存按局面与己方队列对账；撤回、重排、外部插入动作或被拒时重算。配置、地形、资源、单位变化会使缓存失效。
- **计算预算**：`APEX_TIME_MS` 默认 750 毫秒（搜索软预算，建模及计划补全可超出），`APEX_BEAM` 默认 4，`APEX_NODES` 默认 1600；限制分别为 5000 毫秒、12、20000。无外部包依赖，不需训练或 GPU。

真实引擎本地评估不写竞技场历史，未自然结束的对局单列 `unresolved`，不折算成胜利：

```bash
npx tsx scripts/apex-arena.mts --maps snowflake,narrow-road --games 30 --opponent random-royale --seed 20261030
npx tsx scripts/apex-arena.mts --maps snowflake,narrow-road --games 30 --opponent sentinel --seed 20261030
npx tsx scripts/apex-arena.mts --maps random --games 30 --opponent sentinel --seed 20261101
npx tsx scripts/apex-arena.mts --maps random --games 30 --opponent random-royale --seed 20261101
npx tsx scripts/apex-arena.mts --maps snowflake --games 3 --players 3 --opponent self --seed 20261031
npx tsx scripts/apex-arena.mts --maps snowflake --games 2 --players 6 --opponent self --seed 20261031
```

`--maps` 接受已注册的大逃杀地图 ID 或 `random`；后者调用项目随机地图生成器，全部参数采用默认随机范围、模式为大逃杀且无回合上限。每 `players` 局共用地图/开局种子并轮换席位，种子递增 7919；双人 30 局即 15 张种子图各换座两局。JSON 包含引擎版本、执行日期、Node 版本、预算环境变量、逐局结果与延迟；软时间预算会使不同机器的搜索截断点存在差异。

**当前快照（2026-10-28，3.8.14 真实引擎，`scripts/apex-arena.mts`，Node 24.16.0，默认预算）**：固定图种子基 `20261030`；未参与调参的随机图种子基 `20261101`，15 张图各换座两局；全部上限 80 轮。决策耗时包含缓存续吐及提交调用，单位毫秒：

| 图池 | 对手 | 局数 | 胜 | 负 | 平 | 未结束 | p95 / 最大耗时 |
|---|---|---:|---:|---:|---:|---:|---:|
| snowflake | random-royale | 30 | 30 | 0 | 0 | 0 | 279 / 399 |
| narrow-road | random-royale | 30 | 30 | 0 | 0 | 0 | 39 / 71 |
| snowflake | sentinel | 30 | 30 | 0 | 0 | 0 | 299 / 451 |
| narrow-road | sentinel | 30 | 30 | 0 | 0 | 0 | 28 / 57 |
| 随机图 15 张 | random-royale | 30 | 30 | 0 | 0 | 0 | 104 / 284 |
| 随机图 15 张 | sentinel | 30 | 29 | 0 | 1 | 0 | 121 / 229 |

双人合计 **179 胜、0 负、1 平、0 未结束、0 非法入队**；唯一平局为随机种子 `20276939` 的 A 席，第 16 轮同归于尽。结算期仍存在碰撞、目标逃离及失败连锁，不能把“零非法入队”理解成“所有动作都成功”。原始本地 JSON 位于 `temp/apex-calibration/release-{random,sentinel,unseen-random,unseen-sentinel}.json`，该目录不入库，可用上述命令重跑。

**多人及强度边界**：`snowflake`、种子 `20261031` 的六人自博弈 2 局均在第 17 轮完赛，三人自博弈 3 局均到 80 轮仍未结束；所有席位零非法入队，最大决策耗时 634 毫秒。同种子自博弈轮换的是统计席位，不代表独立开局或对外胜率；三人残局僵持尚未解决。开发回归种子 `20316464` 的 A 席对 `sentinel` 仍有败局，因此最终样本零负不等于不存在可击败它的局面。

`sentinel` 是评估脚本内独立启发式压力对手，不是注册算法。随机新图样本每图只有两局，不满足逐图 30 局的稳定选型口径；它与多人、规则对拍、扰动配置回归用于发现过拟合，不能证明对所有未来地图或算法必胜。期望伤害模型不能完全覆盖随机伤害的尾部风险；模型不模拟事件、计分历史或逆风补给（`comebackSupply`），此类自定义配置的强度需额外验证。完整已知限制与优化方向见 [档案](algorithms/apex.md)。

## vortex：旋涡算法

`vortex` v1 仅参与 `annihilation`，大厅类型为 `algo_vortex`，竞技场参与者为 `algo_vortex@v1`。单文件实现（`builtin/vortex.mjs`，策略接口 `decide`），不调用其他算法，也不读取地图名称、对手隐藏信息或随机数状态。

- **炮火收缩圈预判**：按引擎公式复算 round+1 的安全半径（`shrinkCount = ⌊(r−startRound)/intervalRounds⌋+1`，`safeRadius = max(minimumSafeRadius, radius − shrinkCount)`），把「本轮结束时站位是否在下轮危险圈内」作为位置效用主项——引擎在轮界先 `roundNumber++` 再结算满额炮伤，按 round+1 校验才与真实结算对齐。疏散出圈计正收益、走进下轮危险圈重罚；`hp ≤ 炮伤` 且无法撤离的「注定单位」豁免疏散惩罚并转为免费输出（白给动作加奖励，不再浪费动作治疗或保护）。
- **威胁图与稳杀集火**：对每个存活敌军预计算 immediate（原地射程环）与 future（BFS 可达格再展开的射程环，×0.7 折扣）两组格子集合，同格预期承伤取各敌军最大值。攻击效用 = 期望伤害 + 稳杀奖励（平均伤害够杀全额计、方差可能不够按 0.6 折扣）− 反击风险（攻击后还有一次免费移动可撤离时打折）。
- **裁定口径反推**：armyValue ×2、killValue ×0.5、补给/占领/HQ 伤害权重为 0 ⇒ 保存血量比拿击杀值钱（2 : 0.5）、囤补给是纯浪费（激进补员尽快折算成兵力）、对方总部击杀直接终局（压倒一切的效用项）。
- **统一效用尺度**：1 点期望伤害/血量 ≈ 6 效用，治疗/威胁/疏散/抢点/推进按此校准；每步从攻击/治疗/移动/部署/爆破候选中选全局效用最高者，返回 `null` 结束回合。核心参数表与逐类动作的合法性镜像见 [单算法档案](algorithms/vortex.md)。

评估（headless strict 对拍，直接驱动真实引擎、逐动作审计合法性）：

```bash
npx tsx scripts/algorithm-arena.mjs --a vortex --b random-annihilation --games 20 --map artillery-zone --strict
npx tsx scripts/algorithm-arena.mjs --a vortex --b random-annihilation --games 20 --map trench-run --strict
```

**当前快照（2026-10-29，3.8.13 真实引擎，`scripts/algorithm-arena.mjs --strict` headless 自博弈，vs `random-annihilation` 各 20 局、先手后手各半）**：

| 图 | 战绩 | 均分 | 动作/局 deploy / move / attack / heal | 非法动作 | p50 / p95 / max 耗时 |
|---|---|---|---|---:|---|
| artillery-zone | 20:0 | 1161 vs 7 | 8.1 / 32.7 / 15.0 / 1.2 | 0 | 0.12 / 2.03 / 8.4 ms |
| trench-run | 20:0 | 953 vs 6 | 8.4 / 37.1 / 11.6 / 0.5（另有爆破 0.7） | 0 | 0.08 / 1.32 / 4.0 ms |

两图 40 局全部 `last_player_standing` 终局，vortex 席位合计 4816 次决策全部被引擎接受；先手后手 10:10 全胜。竞技场榜单歼灭模式 rating 1882 ±59（可见窗口 40W/0L；全史 440W/0L 含清理前的镜像标定对局）。排查 strict 初报 119 次非法动作时确认 headless `snapshot()` 缺 `game.artillery` 字段（线上透传、headless 未透），已修复 harness——算法侧镜像无误。

**已知限制**：单步贪心无前瞻；权重按歼灭裁定口径标定、标准模式未评估；收缩圈公式镜像依赖 `config.annihilation.artillery` 配置、royale 未适配；对拍样本均为 2 席位。完整清单与优化方向见 [档案](algorithms/vortex.md)。

## crucible：熔炉算法

`crucible` v1 仅参与 `annihilation`，大厅类型为 `algo_crucible`，竞技场参与者为 `algo_crucible@v1`。单文件自包含实现（`builtin/crucible.mjs`，策略接口 `decide`），**独立设计**：策略全部由歼灭规则推导（单向战斗、击杀计价、炮火无归属、AP 按激活计费），不参考、不调用、不借鉴仓库内其他算法，不读地图名称、对手隐藏信息或随机数状态。核心参数、合法性镜像与逐类评估见 [单算法档案](algorithms/crucible.md)。

- **整回合束搜索**：轻量镜像棋盘上模拟整回合激活序列（束宽 7、深度 ≤8、每单位 4 目的地、部署 6 候选、节点候选 ≤18），移动即时改占据、击杀腾格、部署免费补刀，与引擎即时执行语义一致；空激活剔除不耗 AP。
- **对抗性评估**：敌方"移动 BFS + 射程环"可达投影 + 贪心斩杀分配估计下回合己方损失（全扣），我方威慑 ×0.45；军力/击杀按本局 `adjudicationWeights` 实时计价；每个单位沿缩圈时间线做向心逃逸推演（h≤5），不可避免圈伤折分（己方全扣、敌方 ×0.85）。
- **泛化设计**：一切参数取自本局 config 与单位实例；`controlPoint` 权重非零的随机图自动计入持有分；零初始单位图首回合强制部署（`evaluate` 先判己方全灭的回归点）；消耗战图的治疗价值由圈伤推演自然体现（专门的支援兵启发式试验后否决，见下）。
- **计划缓存**：回合级队列按 `(gameId, seat)` 隔离，逐动作对真实状态校验续吐，不合法即丢弃/重规划；部署补刀按落点解析服务器分配的真实单位 id。

评估（真实引擎进程内 harness `scripts/crucible-arena.mts`，成对换座、不写竞技场历史；固定图种子基 `20261029`，随机图种子基 `90210`，每图换座两局）：

```bash
npx tsx scripts/crucible-arena.mts --opp shrinkroll --games 40 --maps artillery-zone,trench-run
npx tsx scripts/crucible-arena.mts --opp vortex --games 40 --maps artillery-zone,trench-run
npx tsx scripts/crucible-arena.mts --opp shrinkroll --games 0 --random 10 --seed 90210
```

**当前快照（2026-10-29，3.8.15 真实引擎，`scripts/crucible-arena.mts`，Node 24.18.0）**：

| 图池 | 对手 | 局数 | 胜 | 负 | 平 | 非法动作 |
|---|---|---:|---:|---:|---:|---:|
| artillery-zone + trench-run（各 40） | vortex | 80 | 80 | 0 | 0 | 0 |
| artillery-zone + trench-run（各 40） | shrinkroll | 80 | 75 | 5 | 0 | 0 |
| 随机新图 10 张（种子基 90210） | vortex | 22 | 21 | 1 | 0 | 0 |
| 随机新图 10 张（种子基 90210） | shrinkroll | 22 | 20 | 2 | 0 | 0 |
| artillery-zone + trench-run（各 60） | random-annihilation | 120 | 120 | 0 | 0 | 0 |
| 随机新图 10 张（种子基 20261029） | random-annihilation | 22 | 22 | 0 | 0 | 0 |

合计 **346 局 338 胜 8 负、零非法动作**；对 shrinkroll 的 5 负全在 trench-run 第 16–18 轮消耗战残局（artillery-zone 40:0）。未写入竞技场历史。

**调参教训（已回退）**：针对 trench-run 全图消耗战试验过"提前部署支援兵"（先放宽到未来半径 ≤1，后收紧到仅 `minimumSafeRadius === 0`）并加治疗 ×1.5、终局补员 +20，同口径标定**全部变差**（vs shrinkroll 固定图 75:5 → 65:15 / 67:13、随机图 20:2 → 17:5），最终回退为通用支援条件。规则级建模（圈伤推演 + 治疗估值）已覆盖消耗战，额外启发式反而过拟合。

**已知限制**：期望伤害按均值（方差尾部未卷积）；对抗回推假设贪心集火；圈伤逃逸为贪心向心近似；固定束宽在 6-8 人混战覆盖受限；随机新图每图仅两局，不满足逐图 30 局稳定选型口径，不能证明对所有未来地图/算法必胜。完整清单与优化方向见 [档案](algorithms/crucible.md)。

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

- `modes` 缺省为 `['standard']`；大厅 bot 接口、runner、`rl/training/local-worker.ts` 与 `rl/evaluation/round_robin.py` 都按它校验/过滤。`/api/arena/participants` 返回包含 `modes` 的完整清单，由客户端按模式过滤，启动接口再次校验兼容性。
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
| `random-royale` | 复用 `lib/random-plan.mjs`：队列投影 + 地形寻路 + `attacksPerUnit` + 炮火区部署/治疗过滤 | **v1（3.8.10 新条目）**：`snowflake` 真实对局多轮零入队拒绝；不做强度声明（随机基线即下界） |
| `apex` | 独立大逃杀模型、多情境逐行动点搜索、轮界占点与炮火 | **v1（3.8.14）**：真实引擎分步与轮界对拍；对战数据及局限见 [绝境算法](#apex绝境算法) |
| `dest-prob` | v2 按队列前缀投影 + 地形寻路 + `attacksPerUnit` 生成计划 | **v2 已适配（3.8.1）**：同 harness 对 v1 50/60（83.3%）、对 random-sim 60/60；对 kriegspiel v2 21/60、对 matrix-eq v2 23/60（各 30 局/图抽样）；v1 的旧规则 100:0 只代表旧规则 |
| `kriegspiel` | v2 镜像 `src/engine/simultaneousResolve.ts` 的分步结算 | **v2 已适配并完成 3.8 真实引擎标定**（分步语义、`wait`、`demolish`、`attacksPerUnit`）：与引擎逐点对拍 40 局面零偏差；两图各 30 局 ×3 对手共 180 局零非法；旧 3.7 数据只代表旧规则 |
| `matrix-eq` | v2 镜像 `src/engine/simultaneousResolve.ts` 的分步结算 | **v2 已适配**并按 3.8 镜像裁判标定；真实服务器口径待验证 |
| `prism` | 整轮联合队列束搜索；四情境分别镜像分步结算；缓存整轮计划 | **v1（3.8.3）**：真实引擎双人两图整局零非法、standoff 三人四轮零非法；竞技场 3.8.3 首战 4 对手 ×2 图 ×24 局共 192 局 **181:11**（standoff 96:0、molten-throne 85:11，评分 1977），3.8.5 扩至 288 局 **229:59**、评分 1839；换座冒烟 14:0（7 组 ×2 局，小样本不作强度结论） |
| `tempo` | v1 按分步语义排程（队列位置 = 结算拍），前缀投影 + `attacksPerUnit`；含首发前的反折返修复 | **v1 已适配并完成真实引擎进程内标定**（`scripts/tempo_benchmark.mjs`，每对 60 局 = standoff 40 + molten-throne 20，零非法）：对 `random-sim` 100%、`dest-prob` 55.0%、`kriegspiel` 50.0%、`matrix-eq` 43.3%（molten-throne 上 85–90%，standoff 32–40%，详见档案）；3.8.5 竞技场 288 局 **134W/154L**、评分 1444 |
| `tempo-weave` | 任务竞价 + 变长行动排程；静止参照分步镜像；多席位回防紧迫度 | **v1（3.8.5）**：3.8.2 真实引擎双人两图 ×4 对手 ×30 局 **240/240**（对 random-sim / dest-prob / kriegspiel / matrix-eq 各 30:0）；多席位 standoff 3 人 15/15、6 人 24/6；3.8.5 集成复跑 79 项回归 + 抽样 8:0；竞技场 288 局 **288:0**、评分 **2355** 第一 |
| `horizon` | v1 原生按 3.8 分步结算设计：镜像 `simultaneousResolve.ts`（期望伤害）+ `planning.ts` 前缀投影 | **v1（3.8.2，2026-10-26 入库）**：与引擎逐点对拍零偏差；真实引擎 2 图 × 4 对手 × 30 局 236:4、零非法；HTTP + runner 23 局零被拒 |

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
| `inArtilleryDanger(game, pos)` | 是否在炮火危险区（歼灭/大逃杀；无炮火模式恒 false） |
| `deployDecision(game, owner)` | 共用部署决策（threat/mcts/field/verdict 已接入） |

> 同时回合的计划期寻路只按地形，不把单位/总部当障碍；不要直接用 `reachableCells` 的“单位挡路”口径推导计划队列。计划模式请按 `src/engine/planning.ts` 的前缀投影语义实现。

## 算法清单

| 算法 | 模式 | 版本 | 类型 | 复杂度 | 强度 / 状态 | 用途 |
|---|---|---|---|---|---|---|
| **random** | standard | v1 | 随机 | O(n) | arena 756 / 1.3%（2026-10-21 UTC） | 基准对照、测试 |
| **random-annihilation** | annihilation | v1 | 随机 | O(n) | 暂无对局与标定（3.8.10 新条目） | 歼灭模式基线、炮火合法性冒烟 |
| **shrinkroll** | annihilation | v1 | 束搜索 + 缩圈时间线投影 | O(束宽×候选×深度×结算投影) | 3.8.12 开发期真实引擎标定（`temp/arena/bench.ts`，两图各 240 局）：对 random-annihilation **480/480**；对评测贪婪基线 100%（artillery-zone，160/160）/ 98.75%（trench-run，158/160）；自我镜像 50.0% / 49.7%；3 人局第一名 90.0%（108/120）；随机歼灭图 97.9%（47/48）、6 人混战 32/32；单次 decide 4.91–10.85ms、零非法 | 歼灭模式强基线、多席位领先者压制 |
| **random-royale** | royale | v1 | 随机 | O(n) | 独立随机基线，对战见 [apex 评估](#apex绝境算法) | 大逃杀模式基线、计划队列冒烟 |
| **apex** | royale | v1 | 多情境束搜索 + 缩圈时空寻路 | O(行动点×束宽×候选×情境×单步结算) | 真实引擎本地换座，详见 [设计与评估](#apex绝境算法)；未写入竞技场榜单 | 大逃杀整轮规划、跨图参数适配 |
| **vortex** | annihilation | v1 | 效用 AI / 威胁图 + 炮火收缩圈预判 | O(单位×格子) | 真实引擎 headless strict 对拍 `random-annihilation` 40:0（两图各 20 局，2026-10-29，零非法），详见 [设计与评估](#vortex旋涡算法)；榜单歼灭模式 40W/0L / 1882 | 歼灭模式强度条目、炮火圈疏散与稳杀集火参考 |
| **crucible** | annihilation | v1 | 整回合束搜索 + 对抗集火回推 + 缩圈逃逸推演 | O(束宽×候选×深度×(单位×格子)) | 3.8.15 真实引擎本地换座标定，详见 [设计与评估](#crucible熔炉算法)；未写入竞技场榜单 | 歼灭模式整回合规划、跨图/跨权重泛化 |
| **greedy** | standard | v1 | 启发式 | O(n²) | arena 1761 / 77.5%；历史 vs random 100% | 快速决策、基准线 |
| **mcts** | standard | v1 | 搜索 | O(b^d · k) | arena 1631 / 64.1%；历史 vs greedy 25% | 战术推演、对比实验 |
| **threat** | standard | v1 | 效用/影响图 | O(单位×格子) | arena 1778 / 79.1%；历史 vs greedy 70.6%（3.5.x 7 图） | 走位稳健的对战、教学 |
| **field** | standard | v1 | 势场/梯度下降 | O(单位×格子) | arena 1753 / 76.8%；历史 vs greedy 64.3%；danger-close 强项、multiplayer-ring 短板 | 涌现式走位、慢节奏消耗战 |
| **verdict** | standard | v1 | 反向规划/期限排程 | O(单位×格子 + 排程回合) | arena 1933 / 90.1%（该快照 standard 第一）；历史 vs greedy 95.7% | 裁决分统一计价、预算内斩首、守成与回防 |
| **random-sim** | simultaneous | v2 | 随机 | O(n) | v2 已适配分步引擎；同时回合基线（3.8.5 竞技场 288 局 0W/288L、评分 678） | 基线对照、模式隔离冒烟 |
| **dest-prob** | simultaneous | v2 | 对手建模/预测评估 | O(敌军×可达格×覆盖格 + 己方单位×瞄准格) | 3.8.1 真实引擎同 harness（30 局/图，2026-10-23）：对 v1 **50/60（83.3%）**、对 random-sim **60/60**；对 kriegspiel v2 21/60、对 matrix-eq v2 23/60（抽样）；3.8.5 竞技场 288 局 114W/174L、评分 1379 | 预测射击、冲突规避、分步队列投影样例 |
| **kriegspiel** | simultaneous | v2 | 分步结算 rollout + 有序计划联合搜索 | O(行动点×候选×种子计划×rollouts×分步结算) | 3.8.1 真实引擎标定（standoff / molten-throne 各 30 局 ×3 对手，2026-10-23）：60:0 vs random-sim、52:8（86.7%，p<0.0001）vs dest-prob v1、29:31 vs matrix-eq v2（standoff 27:3 / molten-throne **2:28**，斩首短板；合计 p=0.90 不可用，必须按图拆）；与引擎逐点对拍 40 局面零偏差；180 局零非法；`decide` 45–169ms（v1 的 15–40 倍）。**同 harness 同种子的 v1 基线**：vs dest-prob 43.3%、vs matrix-eq 31.7%，即适配带来 +43.4pp / +16.6pp；但 v1↔v2 直接对打 35:25（p=0.245）**未达显著**，且 v2 结算期失败 17.1–23.1/局远高于 v1 的 1.3/局（`destination_occupied` 未修）；3.8.5 竞技场 288 局 114W/173L/1D、评分 1380 | 同时回合搜索型内置、分步结算语义参考镜像 |
| **matrix-eq** | simultaneous | v2 | 矩阵博弈/CFR 均衡 | O(我方计划×敌方场景×单轮结算 + 迭代) | 3.8 镜像裁判：23:7 vs v1、12:18 vs kriegspiel **v1**、13:17 vs dest-prob、30:0 vs random-sim；3.8.1 真实引擎口径下被 kriegspiel v2 在 standoff 打到 3:27、在 molten-throne 反打 28:2；3.8.5 竞技场 288 局 128W/159L/1D、评分 1426 | 博弈论混合策略样例 |
| **prism** | simultaneous | v1 | 多情境束搜索 + 同步结算镜像 | O(束宽×候选×情境×行动点×单步结算) | 3.8.3 首战 4 对手 ×2 图 ×24 局共 **192 局 181:11**（standoff 96:0、molten-throne 85:11；当时评分 1977）；3.8.5 扩到 6 对手 ×2 图 ×24 局共 **288 局 229:59**、评分 1839（同时榜第二）；真实引擎换座冒烟 14:0（horizon 8:0、matrix-eq 4:0、kriegspiel 2:0；**7 组 ×2 局，仅接口/强度冒烟**）；双人两图整局、三人四轮零非法 | 通用整轮联合规划、风险约束选型 |
| **tempo** | simultaneous | v1 | 逐拍排程/威胁时间线 | O(单位×候选×拍×威胁投影) | 3.8.4 真实引擎进程内标定（每对 60 局 = standoff 40 + molten-throne 20，2026-10-24，零非法）：对 random-sim **100%**、dest-prob **55.0%**、kriegspiel **50.0%**、matrix-eq **43.3%**（molten-throne 85–90%、standoff 32–40%）；3.8.5 竞技场 288 局 134W/154L、评分 1444 | 结算拍序决策、同时回合通用基线 |
| **tempo-weave** | simultaneous | v1 | 任务排程/期限约束 | O(单位×任务×束宽×行动点×镜像步) | 3.8.2 真实引擎（两图 ×4 对手 ×30 局，2026-10-24）：对 random-sim / dest-prob / kriegspiel / matrix-eq **全部 30:0（240/240）**；多席位 standoff 3 人 15/15、6 人 24/6；3.8.5 集成抽样复验 8:0；竞技场 288 局 **288:0**、评分 **2355** 第一 | 任务级行动点预算、多席位回防 |
| **horizon** | simultaneous | v1 | 分步结算镜像 + 终局投影胜率评估 + 同构对手场景 + 束搜索 + 对抗探针 | O(行动点×束宽×候选×场景×单轮结算) | 3.8.2 真实引擎（`scripts/horizon-arena.mts`，standoff / molten-throne 各 30 局 ×4 对手，种子基 20261026，2026-10-26）：random-sim 30:0 / 30:0、dest-prob 30:0 / 30:0、kriegspiel 30:0 / 30:0、matrix-eq 29:1 / 27:3，合计 **236:4（98.3%）**、零非法；molten-throne 据点流量低于 dest-prob / kriegspiel（7 vs 12），胜利来自斩首；多席位只做抽样（6 人局对 matrix-eq 两次复测 1:5 / 9:3 互相矛盾）；单轮规划（单进程）standoff p50 154ms、molten-throne p50 233ms、6 人 p50 529ms | 同时回合多轮视界规划、强基线 |

> 表中 standard 行的 arena 数字来自 `public/data/arena-leaderboard.json`（2026-10-21 UTC 生成，standard，36,000 局，300 对，每人 2,880 局）；simultaneous 行来自 2026-10-24 生成的 1,008 局分区（7 名参与者，tempo / tempo-weave 已入榜）；其中 prism 的 192 局 / 1977 是 3.8.3 首战快照，当前为 288 局 / 1,839。评分是 Bradley-Terry 混合池，胜率包含不同对手，不能与单图对拍数字直接比较；模式之间也不可混比。
>
> 历史数字采集于 3.5.x 地图池与 3.6.0 之前的裁决分口径；`forge`、`desert` 已不在当前池，详见“历史标定”。

### 模式覆盖

| 模式 | 内置算法数 | 算法 |
|---|---:|---|
| standard | 6 | random / greedy / mcts / threat / field / verdict |
| simultaneous | 8 | random-sim / dest-prob / kriegspiel / matrix-eq / prism / tempo / tempo-weave / horizon |
| annihilation | 4 | random-annihilation（逐人轮流 + 炮火区部署/治疗镜像）/ shrinkroll（束搜索 + 缩圈时间线投影 + 轮界裁决投影）/ vortex（效用 AI + 收缩圈疏散）/ crucible（整回合束搜索 + 对抗集火回推 + 缩圈逃逸推演） |
| royale | 2 | random-royale / apex（同时回合计划队列 + 炮火缩圈） |

> 三个随机基线是**独立条目**：注册名、展示名、版本与竞技场参与者 id 全部分开
> （`algo_random@v1` / `algo_random-annihilation@v1` / `algo_random-royale@v1`），
> 战绩不会混名；标准模式的实现与历史不受影响。
> 歼灭已有强度算法 `shrinkroll`（3.8.12）、`vortex`（3.8.13）与 `crucible`（3.8.15）；大逃杀已有独立搜索算法 `apex`（3.8.14）与随机基线。跨模式战绩不可用于证明算法强度。

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
| 2026-10-24 | 3.8.4 | 新增 tempo 时序掌控算法 v1（同时回合）：把队列位置当结算拍，先给每个敌军推行为剧本并逐拍投影位置，再叠敌方预测射击与可及火力区成「第 k 拍 × 格子」威胁时间线，按裁决分差与剩余轮数调节攻守，最后按价值把动作排进具体拍；首发前修复同一单位反复折返。真实引擎进程内标定（每对 60 局 = standoff 40 + molten-throne 20）：对 random-sim 100%、dest-prob 55.0%、kriegspiel 50.0%、matrix-eq 43.3%，零非法 |
| 2026-10-24 | 3.8.5 | 新增 tempo-weave 经纬算法 v1（同时回合）：任务竞价与变长行动排程 + 静止参照分步镜像 + 多席位回防紧迫度；零导入、无地图特化、不使用对手隐藏队列。3.8.2 真实引擎双人两图 ×4 对手 ×30 局全胜 **240/240**（random-sim / dest-prob / kriegspiel / matrix-eq 各 30:0），多席位 standoff 3 人 15/15、6 人 24/6；3.8.5 集成复跑回归与抽样对局全胜 |
| 2026-10-26 | 3.8.7 | 新增 horizon 视界算法 v1（同时回合）：分步结算镜像（与引擎逐点对拍零偏差）+ 终局投影胜率评估（据点到达时间模型、两轮攻城压力、下一轮威胁场、歼灭风险）+ 同构对手四场景（贪心 / 静态开火 / 扰动 / 斩首变体）+ 逐行动点束搜索 + 对抗探针。开发基线 3.8.2、迭代 10 轮，关键修复：攻城投影从"全部剩余回合累加"改为两轮行动点预算（初稿在 molten-throne 不敢出门）、据点争夺期权重修正（占点反而降低持有概率的 bug）、歼灭风险改用未封顶压力（贴脸攻击者不被处理）。3.8.2 真实引擎口径 2 图 ×4 对手 ×30 局 236:4、零非法；HTTP + runner 23 局零被拒；`evaluate_cross.py` 冒烟 16:0 |
| 2026-10-29 | 3.8.12 | 新增 shrinkroll 缩圈推演算法 v1（歼灭模式）：回合内束搜索（束宽 2→6→8，确定性节点预算）+ 裁决分叶值（我方 − 最强对手，多人局次席按 `ACE_FFA_RIVAL=0.5` 折算）+ 轮界炮火/裁决投影 + 两人局对手贪心 rollout。镜像与真引擎逐条对拍 17 例零偏差。开发期真实引擎（`temp/arena/bench.ts`，`--swap`）：对 random-annihilation 两图各 240 局 **480/480**；对评测贪婪基线 **100%（160/160）/ 98.75%（158/160）**；自我镜像 50.0% / 49.7%；3 人局第一名 **90.0%（108/120）**、6 人混战 32/32；单次 decide 4.91–10.85ms，全程零非法 |
| 2026-10-29 | 3.8.13 | 新增 vortex 旋涡算法 v1（歼灭）：按引擎公式复算 round+1 炮火安全圈做疏散主项，威胁图稳杀集火，按歼灭裁定口径反推权重；真实引擎 headless strict 对拍 `random-annihilation` 40:0（artillery-zone / trench-run 各 20 局，零非法、先手后手 10:10），p95 ≤ 2.03 ms。详见 [设计与评估](#vortex旋涡算法) |
| 2026-10-29 | 3.8.14 | 新增 apex 绝境算法 v1（大逃杀）：缩圈时空寻路、兵力配比、多情境同步束搜索与对抗校验；大厅与评估控制台接入双算法池。真实引擎换座与随机新图数据见 [设计与评估](#apex绝境算法)，本地验证不写竞技场历史。 |

## 未来方向

1. **同时回合 3.8 适配与重标定**：dest-prob v2 已完成分步语义适配（v1→v2 直接对拍 50/60）；下一步为 matrix-eq v2 补真实引擎标定，确认镜像裁判结论（kriegspiel v2 已完成：真实引擎对拍零偏差 + 两图 ×3 对手各 30 局）。
2. **炮火模式算法池**：歼灭已有 `shrinkroll`（3.8.12）与 `vortex`（3.8.13）两个强度算法，大逃杀已有 `apex`（3.8.14）搜索算法与 `random-royale` 基线；下一步是扩大独立对手、多人和新地图的验证。
3. **多席位标定**：现有标准权重主要在 2 人对局上调出；用 `multiplayer-ring`（多席位）、`snowflake` / `standoff`（3/6 人）补 3–6 人标定。`four-corners` 已下线，不能再用。
4. **Minimax + Alpha-Beta 剪枝**：经典对抗搜索，可作为 mcts 之外的确定性搜索基线。
5. **混合架构**：MCTS + 学习评估函数，或规则算法 + RL 局面评估。
6. **多线程并行**：利用 Worker 加速搜索；先做可复现的基准，再决定是否值得。
7. **Arena 多模式跑批**：`round_robin.py` / leaderboard 已支持多算法轮转与自动排行；3.8.2 起同时回合接入评估跑批（3.8.5 起 7 个 × standoff / molten-throne，RL 模型不参评），3.8.10 起歼灭 / 大逃杀也已接入（`local-worker` 支持四种模式，控制台可启动）。歼灭已有 `random-annihilation` / `shrinkroll` / `vortex` 三个，大逃杀已有 `random-royale` / `apex` 两个，均可组批。
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
| 经纬标定与复跑 | `scripts/tempo-weave-arena.mts`（双人矩阵）、`scripts/tempo-weave-multiseat.mts`（多席位轮换）、`scripts/tempo-weave-http.mjs`（HTTP runner） | 真实引擎、公开快照口径；3.8.2 标定 240+45 局的原始记录随交付包归档，仓库内可直接复跑 |
| 视界标定与复现 | `scripts/horizon-arena.mts`（headless 逐局换种子 + 成对换座）、`scripts/horizon-http-match.mjs`（REST 建房 + 每座位一个 runner） | 真实引擎、算法拿 REST 同口径快照；horizon 档案数字由前者产出，`--a-file` 可加载开发版本；本机多 bot 需 `TACTICAL_GAME_RATE_LIMIT` 调高限流 |
| 缩圈推演算法标定与复现 | `temp/arena/bench.ts`（进程内真实引擎、`--swap` 换座） | shrinkroll 档案数字由它产出；该 harness 与评测贪婪基线 `temp/arena/opponents/greedy-annihilation.mjs` 目前在 gitignored 的 `temp/` 下，入库前只能按档案参数复跑 |
| 大逃杀换座评估 | `scripts/apex-arena.mts` | 真实引擎、公开快照，支持随机基线 / 独立启发式 / 多人自博弈，输出未结束局与动作失败统计，不写竞技场历史 |
| Arena 榜单 | `arena/matches.jsonl`、`public/data/arena-leaderboard.json` | 标准模式 36,000 局（2026-10-21 UTC）、同时回合 1,008 局（2026-10-24）；按模式分榜；3.8.5 起同时回合参与算法 7 个 |
| 合法性回归 | `tests/algorithms/*-selfplay.test.ts` | 整局零非法动作、正常完赛 |
| 单算法档案 | `algorithms/docs/algorithms/*.md` | 设计细节与逐图数据；本文只保留总览与当前快照 |
| 版本历史 | 根 `RELEASE_NOTES.md`（权威） / `algorithms/docs/RELEASE_NOTES.md`（算法专题记录，已补录 3.5.0–3.8.5） | 算法侧细节看专题记录；与根文档冲突时以根文档为准 |

> `temp/threat-bench.mts` 是本机临时标定脚本（gitignored），不能作为长期复现入口；`rl/test-output/stats/algo_vs_rl_random.jsonl` 已不在仓库，旧 48 局数据仅作历史引用。
