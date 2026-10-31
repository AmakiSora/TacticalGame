# parallax — 视差算法

> 标准模式（standard）独立设计的搜索型内置算法：单位完整激活宏动作 + 整回合束搜索 + 对手反击情景检验 + 终局边界实裁模拟。
> 独立设计边界：只依据标准模式规则、引擎行为与公开状态推导，不读取、不导入、不调用仓库内其他算法或策略辅助实现；现有算法仅作为黑盒对手运行，不参与设计。

## 身份与文件

| 项目 | 值 |
|---|---|
| 注册名 | `parallax` |
| 展示名 | 视差算法 |
| 版本 | v1 |
| 模式 | `standard`（其他模式一律返回 null） |
| bot type / 竞技场参与者 | `algo_parallax` / `algo_parallax@v1` |
| 实现 | [algorithms/builtin/parallax.mjs](../../builtin/parallax.mjs)（611 行，零导入） |
| 接口类型 | 策略接口（`decide`，无状态单次决策，每个真实动作后重新规划） |
| 测试 | [tests/algorithms/parallax.test.ts](../../../tests/algorithms/parallax.test.ts)（67 例） |
| 评估工具 | [scripts/parallax-arena.mts](../../../scripts/parallax-arena.mts) |
| 实现日期 | 2026-10-29 |
| 作者 | Sonus-Max-Qoder(6Astra) |

## 设计原则

- **以单位完整激活为决策单元**：标准模式一次激活 = 一次移动 + 一次攻击/治疗/爆破（顺序任意），新部署单位当回合已视为移动过、不能移动，但仍可免费执行一次攻击/治疗/爆破。算法按“移动落点 × 后续动作”组合竞价，而不是逐动作贪心。
- **只读公开投影**：只使用 `sanitizeGameForResponse` 可见的地形、单位、总部、据点、资源、统计与配置；不读取 `rngState`、token、对手计划或任何隐藏字段，也不修改传入快照。
- **不使用传入策略工具**：`utils` 参数完全忽略；所有估值、路径、伤害与结算逻辑在文件内独立实现。现有算法只作为黑盒对手出现在评估中。
- **参数全部取自本局配置**：兵种数值、射程、治疗量、部署折扣、行动点、伤害/治疗方差、据点类型、裁决权重、`maxTurns: null` 与 `comebackSupply` 均实时读取，不按地图名、对手名或单位 id 分支。
- **确定性**：不使用随机数；同一公开状态给出同一动作，重命名实体/地图/座位不改变语义。

## 算法原理

### 1. 可见状态镜像（`createSearchState` / `copy`）

把公开快照折叠成可廉价复制的搜索状态：几何（格子索引、地形覆盖后的有效地形、六邻接、存活总部阻挡）、当前行动方、回合数、已用行动点、存活单位/总部/据点（附带格子索引 `p`）、补给、裁决统计、仍活跃的席位与终局标记。

地图以 `cells` 为底，`map.terrainCells` 按出现顺序覆盖且“后写优先”；覆盖不会补出地图空洞。所有派生缓存挂在几何对象上，地形或总部变化时换新几何对象，避免跨分支污染。

### 2. 地形距离场与精确可达集

- `field`：以目标为中心、射程内平地（排除总部）为多源，向六邻接做最小代价松弛。普通单位只能走平地（代价 1）；重装可在 `breaking` 模式下把 blocker 视作代价 5 的可破障。水域与存活总部不可穿越，结果按几何缓存。
- `reachablePositions`：以单位当前位置做精确 BFS，逐格检查“平地、无其他存活单位、无存活总部”，严格限制 `moveRange`，起点不计入结果。它与引擎的“单位挡路、不可跳跃、不可穿过总部”口径一致，而不是用六角距离近似。

### 3. 离散伤害分布（`damageProfile`）

按引擎公式枚举全部 `2·variance+1` 个偏移：`max(minimumDamage, attack - defense + offset - variance)`，返回均值、按目标剩余血量截断后的实际伤害、击杀概率与最小/最大值。

- 己方计划默认用均值评估；
- 假想对手回应使用**高伤害分支**，以偏保守的方式检验计划；
- 不读取、不预测引擎随机状态。

### 4. 宏动作枚举（`orders`）

对每个本单位生成“整次激活”的候选，而不是单步动作：

| 宏动作 | 说明 |
|---|---|
| 移动 | 按落点边际价值排序（据点/总部/接敌/维修/支援） |
| 移动 + 攻击 / 攻击 + 移动 | 先到位再打，或先打再撤 |
| 移动 + 治疗 / 治疗 + 移动 | 含自我治疗；治疗范围独立于攻击射程 |
| 移动 + 爆破 / 爆破 + 移动 | 仅重装；爆破后按新地形重新计算可达集 |
| 斩杀后进入腾空格 | 仅当击杀概率 ≥ 0.99，模拟击杀后用真实空格计算落点 |
| 部署 + 攻击 / 部署 + 治疗 | 仅在还有行动点、来源可部署、落点合法且付得起折扣价时生成 |

候选按估计值排序后做签名去重，并按首个动作的施动者设置配额，避免整份计划被同一单位占满。

### 5. 整回合束搜索（`turnPlans`）

在镜像状态上按宏动作逐层扩展，束宽 6（“平衡”根）或 1（“攻城”根），深度上限为 `min(18, 剩余行动点 + 已有未完成激活的单位数 + 2)`。扩展要求局面值严格上升（`> 1e-8`），按首动作与完整局面签名去重，并限制同一首动作的节点数。

宽度为 1 的分支不是弱化版，而是另一种**对手模型**：它假设对手会不惜代价压总部，用于检验己方计划在被斩首压力下的稳健性。

### 6. 局面估值与风险

估值完全由公开配置与裁决口径驱动：

- **己方价值（`sideValue`）**：补给 × 资源价格、单位价值（造价 × 血量比例 + 战斗属性 + 占领能力）、总部伤害与击杀分、己方总部血量、据点当前价值与流量统计、维修收益、据点争夺到达时间、总部进攻压力、对敌单位的火力接入、支援治疗覆盖。
- **风险（`exposure`）**：逐一评估每个己方单位/总部在当前与下一步能承受的敌方伤害，按每个敌方席位至多 `actionsPerTurn` 次射击上限聚合；总部风险使用四次方非线性放大，并额外计算 2.5 回合内的围城压力（按友军拦截能力折减）。单位死亡风险按伤害/血量比例三次方计价。
- **对手价值**：多人局按总部距离给每个对手一个权重，避免把远端对手与接壤对手等同。
- **到达折扣（`arrivalValue`）**：有限回合用 `decay^turns` 且仅在剩余回合内计价；无限回合改用 `1/(1+0.5·turns)`，远目标仍保留非零梯度，但不会出现无穷值或“永远等不到”的硬截断。
- **两种姿态**：`balanced` 正常计风险；`siege` 把己方暴露系数降到 0.15，并给总部伤害额外权重，用来模拟“宁可换家也要压总部”的对手。

### 7. 终局边界（`finalBoundary` / `evaluate`）

若本局有限、已到最后一回合，且其他活跃席位都已行动，则当前席位就是最后一个决策者：

1. 复制状态，执行 `finishSearchTurn`（含结束回合占点、持有统计累计与裁决）；
2. 用真实的 `adjudication` 公式计算与最强对手的分差；
3. 胜出返回 `1e7 + margin`，未胜出返回 `margin`。

因此不会出现“先按未来反击剪枝、再发现占点已经赢了”的矛盾，也不会把不存在的下一轮反击算进最后一手。裁决中的军力项严格复刻引擎的 `Math.round(cost * (hp / maxHp))` 舍入顺序。

### 8. 对手回应与计划选型（`decide`）

1. 生成“平衡”根（宽 6）与“攻城”根（宽 1）的候选计划；
2. 对每个计划，分别用 `balanced` 与 `siege` 两种回应风格模拟其余席位的行动（每次回应也用宽 1 束搜索与高伤害分支）；
3. 若回到己方，再模拟一次己方回应，得分 = `0.6 × 回应后值 + 0.4 × 再回应后值`；
4. 对两种风格取**最差**结果，再加 `0.04 × 计划自身估值` 作为微小先验；
5. 若某计划已直接终局获胜，立即执行其首个动作；
6. 若最终选择是“停手”，但当前仍有合法且不消耗额外行动点的原地攻击/治疗，则改打其中价值最高的一发（无反击、无友伤，原地输出严格优于空过）；但若计划本身已走到终局，则如实返回 `null`，不画蛇添足。

每个真实动作返回后，runner 会重新调用 `decide`，所以搜索只承诺“当前这一步”，不缓存旧计划。

## 实现细节

### 核心参数

| 参数 | 值 | 位置 |
|---|---|---|
| 根束宽 | 平衡 6 / 攻城 1 | `decide` |
| 搜索深度上限 | `min(18, 剩余 AP + 未完成激活数 + 2)` | `turnPlans` |
| 每层候选上限 | 宽 1 时 5，其余 12 | `orders` |
| 扩展阈值 | 严格大于 `1e-8` | `turnPlans` |
| 对手回应束宽 | 1（两种风格） | `decide` |
| 回应伤害分支 | `high` | `decide` |
| 计划综合分 | 最差回应值 + `0.04 × 计划值` | `decide` |
| 攻城姿态暴露系数 | 0.15（平衡为 1） | `evaluate` |
| 无限回合到达折扣 | `1/(1+0.5·turns)` | `arrivalValue` |

### 代码地图

| 函数 | 行 | 作用 |
|---|---:|---|
| `createSearchState` | 15 | 公开快照 → 搜索状态 |
| `field` | 39 | 带破障代价的反向距离场（按几何缓存） |
| `reachablePositions` | 69 | 精确可达集（单位/总部阻挡） |
| `damageProfile` | 88 | 离散伤害均值/截断/击杀概率 |
| `arrivalValue` | 112 | 有限/无限回合的到达折扣 |
| `sideValue` | 147 | 己方局面价值 |
| `exposure` | 204 | 即时与下一步风险、总部围城压力 |
| `finalBoundary` | 247 | 末轮最后席位判定 |
| `evaluate` | 252 | 终局/末轮/常规估值 |
| `applySearchAction` | 278 | 移动/攻击/治疗/爆破/部署镜像 |
| `adjudication` | 322 | 与引擎一致的裁决分 |
| `finishSearchTurn` | 334 | 占点、收入、维修、持有统计、轮转、裁决 |
| `orders` | 421 | 宏动作候选生成 |
| `turnPlans` | 536 | 整回合束搜索 |
| `decide` | 576 | 回应检验与动作输出 |

### 必须守住的约束（均有回归覆盖）

- **占点只在结束回合发生**：移动/部署的镜像不改变据点归属；新占点当回合不能作为部署源。
- **部署单位当回合不可移动**：镜像设为 `hasMoved: true, hasActed: false, actionSpent: true`，允许免费攻击/治疗；引擎对爆破只看 `hasActed`，但部署后续只生成攻击/治疗候选。
- **一次激活只记一次行动点**：同一单位的移动与后续动作共享激活；行动点耗尽后，已激活单位仍可完成免费后续动作。
- **伤害下限与方差**：所有分支都必须经过 `minimumDamage` 下限，不能出现 0 伤害的“免费射击”。
- **重装破障**：只有重装能把 blocker 视作可拆；破除后必须重建可达集。
- **军力舍入顺序**：`Math.round(cost * (hp / maxHp))`，不能先乘后除或对总和取整。
- **无限回合不返回 Infinity**：`life()` 只作为经济规划的有界常量；远目标由 `arrivalValue` 保留非零梯度。
- **末轮先结算再比较**：最后一个席位的候选必须在剪枝前完成占点与裁决模拟。
- **终局计划允许停手**：若计划已终局且无首动作，返回 `null`，不得被兜底攻击覆盖（多人末轮可能因此从平局变负）。
- **不修改输入、不读秘密字段**：冻结快照、token getter 陷阱与 `Math.random` 陷阱均有回归。

## 性能表现

评估口径：引擎 **3.8.18**、日期 **2026-10-29**、真实引擎进程内 harness `scripts/parallax-arena.mts`；同图同种子成对换座，每个席位独立 worker；正常胜负、强制截断与错误分开统计。所有参评算法均为 v1。

冻结源码 SHA-256：`parallax.mjs` = `d9e3576b219afc90175a9d37d705aef7bede45f7ee79dceb463ca41e6f18ffbc`；评估脚本 = `6e4db874d73982ae0b6018785d4d7b16f3fe61d56bb8965d44e1420bb6bada56`。

| 地图 / 人数 | 对手 | 局数 | 胜:负:平 | 截断 |
|---|---|---:|---:|---:|
| default / 2 | greedy、random、mcts、threat、field、verdict（各 2） | 12 | 12:0:0 | 0 |
| breach / 2 | 同上 | 12 | 10:2:0 | 0 |
| dual-lanes / 2 | 同上 | 12 | 11:1:0 | 0 |
| danger-close / 2 | 同上 | 12 | 12:0:0 | 0 |
| multiplayer-ring / 2 | verdict、threat（各 2） | 4 | 2:2:0 | 0 |
| whirlpool / 2 | verdict、threat（各 2） | 4 | 2:0:0 | 2 |
| random challenge / 2 | verdict、threat（各 4） | 8 | 8:0:0 | 0 |
| multiplayer-ring / 3 | 2 个独立 verdict | 2 | 0:2:0 | 0 |
| multiplayer-ring / 6 | 5 个独立 verdict | 2 | 0:2:0 | 0 |
| random / 8 | 7 个独立 verdict | 2 | 1:1:0 | 0 |
| **合计** | | **70** | **58:10:0** | **2** |

- 零非法动作、零异常、零未完成局。两个截断局均为 whirlpool 对 threat：完成 60 轮后强制裁决落后，单独计数，不折算为胜负。
- 四张常规双人图合计 **45:3（93.75%）**：对 verdict 6:2、对 threat 7:1，对 greedy/random/mcts/field 各 8:0。
- 随机挑战为两张不同参数与轮廓的配置（clipped-hex / notched-hex），每张对两个对手换座；8 局不等于 8 张独立留出地图。
- 多人自由混战 **1:5**，明显弱于双人表现；这与“全面碾压”的目标仍有距离，详见限制。

### 决策时间

| 场景 | 决策数 | p50 | p95 | max |
|---|---:|---:|---:|---:|
| default | 966 | 299 ms | 560 ms | 760 ms |
| breach | 789 | 475 ms | 970 ms | 1431 ms |
| dual-lanes | 946 | 413 ms | 851 ms | 1276 ms |
| danger-close | 387 | 19 ms | 98 ms | 392 ms |
| multiplayer-ring + whirlpool | 1016 | 372 ms | 891 ms | 1208 ms |
| random challenge | 526 | 237 ms | 548 ms | 838 ms |
| multiplayer-ring 3 人 | 156 | 671 ms | 1114 ms | 1558 ms |
| multiplayer-ring 6 人 | 153 | 1008 ms | 2573 ms | 3744 ms |
| random 8 人 | 39 | 296 ms | 1001 ms | 1025 ms |

计时包含并行任务竞争，且部分黑盒对手按墙钟预算运行，因此不同负载下会有波动；这些数字用于判断量级，不作为严格单线程基准。6 人局已接近秒级，若需要低延迟对局应缩减束宽或深度。

## 已知限制

- **多人混战偏弱**：对每个对手独立建模，没有联盟、夹击、王车易位或“共同压制领先者”的显式推理；`enemyWeight` 只是按总部距离的启发式。环形图 3 人与 6 人各 2 局全负，8 人随机混战 1 胜 1 负。
- **固定宽度与浅层对抗**：只模拟一轮对手回应（加一次己方再回应），束宽有限；更长的多轮协同、资源节奏与跨回合包围不在搜索范围内。
- **伤害分支是抽样而非分布**：己方用均值、对手用高值，能避免明显冒进，但不能覆盖所有方差组合；对“低伤害导致斩杀失败”的连锁没有精确概率传播。
- **对手模型是假设**：`balanced` 与 `siege` 两种风格覆盖常见行为，但未知算法可能利用这一假设；不针对任何具体对手调参。
- **无限回合没有全局解**：远目标只保留折扣梯度，不保证在任意大地图上规划出最优路线；极端长廊/孤岛仍可能来回摇摆。
- **重装破障代价是近似**：距离场把 blocker 视作代价 5，实际爆破还受行动点、相邻位置与目标选择影响，可能在复杂障碍群中低估或高估开路收益。
- **决策成本高**：单局典型 p50 约 19 ms–0.5 秒（2 人图），6 人图 p50 约 1 秒、p95 达 2.6 秒；不适合有严格单步时限的场合。
- **只支持标准模式**：`simultaneous`、`annihilation`、`royale` 一律返回 `null`，不参与其他模式榜单。

## 优化方向

- **多人风险模型**：显式建模“谁在领先”“谁会与谁接火”，把被夹击概率与领先者压制纳入估值，而不是只按距离加权。
- **精确斩杀链**：用伤害分布卷积评估多单位集火，减少均值近似导致的“差一点没杀死”。
- **自适应预算**：按剩余行动点、单位数与局面复杂度动态调整束宽/深度，在 6/8 人局控制延迟。
- **更强终局求解**：在最后 1–2 回合对“占点 + 裁决”做小规模精确搜索，而不是依赖单步实裁模拟。
- **障碍群规划**：把重装爆破与后续部队通行联合建模，避免逐次独立爆破的短视。

以上方向均需重新标定并保留回归，不能以单批小样本宣称提升。

## 兼容性

- **模式隔离**：仅注册 `standard`；其他模式的大厅、runner 与评估链路会直接拒绝。
- **地图无关**：不读地图文件名或 id；`cells`、`terrainCells`、据点类型、总部位置、支持人数全部来自配置。新地图只要满足现有标准模式契约即可运行。
- **配置无关**：`maxTurns: null`、不同的 `actionsPerTurn`、伤害/治疗方差、部署折扣、维修量、回流补给与裁决权重都能直接生效。
- **无外部依赖**：ESM 单文件，零 import，无文件/网络/环境变量访问；可在 Node 24 下直接加载。
- **接口**：实现 `decide(view, utils, context)`，返回 `{type, payload}` 或 `null`；同步纯计算。不实现 `playTurn`，不使用同时回合队列。

## 使用方式

### 通过前端添加

大厅选择标准模式地图 → 添加机器人 → 「算法脚本」标签 → 选择「视差算法」。评估控制台中仅在标准模式目录出现。

### 通过命令行运行

```bash
node algorithms/runner.mjs --algorithm parallax --url http://localhost:3100 \
  --game <gameId> --token <playerToken> --side player_a
```

### 通过 API 添加

```bash
curl -X POST http://localhost:3100/api/games/<gameId>/bots/algorithm \
  -H "X-Host-Token: <hostToken>" \
  -H "Content-Type: application/json" \
  -d '{"botType":"algo_parallax"}'
```

### 本地黑盒评估

```bash
# 四张常规双人图，每图每对手 2 局
for map in default breach dual-lanes danger-close; do
  npx tsx scripts/parallax-arena.mts \
    --opponents verdict,greedy,random,mcts,threat,field \
    --maps "$map" --games 2 --seed-base 920731 \
    --out "temp/parallax-arena/release-$map.json"
done

# 环形图 + 无限回合漩涡图（60 轮上限，截断单列）
npx tsx scripts/parallax-arena.mts --opponents verdict,threat \
  --maps multiplayer-ring,whirlpool --games 2 --seed-base 720149 --max-rounds 60 \
  --out temp/parallax-arena/release-extended.json

# 随机挑战图（改变尺寸、轮廓、障碍、兵种与经济参数）
npx tsx scripts/parallax-arena.mts --opponents verdict,threat \
  --maps random --games 4 --seed-base 510947 --random-preset challenge \
  --out temp/parallax-arena/release-challenge.json

# 3 / 6 / 8 人自由混战
npx tsx scripts/parallax-arena.mts --opponents verdict --maps multiplayer-ring \
  --players 3 --games 2 --seed-base 731017 --out temp/parallax-arena/release-ffa3.json
npx tsx scripts/parallax-arena.mts --opponents verdict --maps multiplayer-ring \
  --players 6 --games 2 --seed-base 731019 --out temp/parallax-arena/release-ffa6.json
npx tsx scripts/parallax-arena.mts --opponents verdict --maps random \
  --players 8 --games 2 --seed-base 731023 --out temp/parallax-arena/release-ffa8.json
```

报告只写入 `temp/`，不修改 `arena/matches.jsonl` 或正式排行榜；非法动作、异常或未完成局都会以非零状态退出。

## 回归覆盖

`tests/algorithms/parallax.test.ts` 共 **67 例**，主要包括：

- 与真实引擎逐格一致的可达集（四张标准图、空洞、地形覆盖、单位/总部阻挡、不可跳越）；
- 离散伤害全偏移、下限、截断与击杀概率，以及 `low/mean/high` 分支；
- 一次激活的行动点计费、部署折扣与免费攻击、治疗后行动点耗尽；
- 击杀后进入腾空格、重装爆破后通行、占点仅在结束回合；
- 收入、维修、持有统计、回流补给、有限回合裁决与平局；
- 总部淘汰后的单位移除、据点中立化与回合顺序；
- 无限回合 30 格远目标推进、末轮占点立即获胜、军力舍入顺序、多人末轮停手保平局；
- 冻结输入、秘密字段 getter 陷阱、`Math.random` 陷阱、重命名不变性与错误模式/席位返回 `null`；
- 三张真实地图的短局差分，以及每个动作都被真实引擎接受。
