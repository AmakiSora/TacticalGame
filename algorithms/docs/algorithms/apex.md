# Apex — 绝境算法

> 单算法档案，遵循 `ALGORITHMS_NOTES.md` 固定模板。

## 身份与文件

| 项 | 内容 |
|---|---|
| 文件 | `algorithms/builtin/apex.mjs`（策略）+ `algorithms/lib/royale-model.mjs`（规则模型） |
| 算法名 | `apex` |
| 注册键 | `algo_apex@v1` |
| 显示名称 | 绝境算法（Apex） |
| 定位 | 独立规则模型 + 多情境逐行动点束搜索 + 双人对抗探针：整轮计划，不读地图名/对手隐藏队列/RNG |
| 实现日期 | 2026-10-29 |
| 实测强度 | 大逃杀（royale）：真实引擎本地换座标定，双人 180 局 **179 胜 0 负 1 平**（固定图 vs random-royale / sentinel 各 60 全胜，随机新图 vs random 30:0、vs sentinel 29 胜 1 平）；本地验证不写竞技场历史 |
| 语言 | JavaScript (ESM) |
| 接口类型 | 策略接口（`decide`，整轮计划队列续吐） |
| 作者 | Sonus-Max-Qoder(6Astra) |

## 算法原理

Apex 是大逃杀（royale）专用的**整轮规划 AI**。大逃杀是「同时回合 × 歼灭缩圈」的组合：所有存活席位在轮初同时提交一整轮计划队列（长度 = `actionsPerTurn`），引擎逐行动点分步结算，轮界统一结算炮火缩圈与淘汰，无总部、按控制点（CP）部署补给、全军覆没即出局。apex 的 `decide` 每次被调用只吐一个动作，但内部一次算出整轮计划并缓存，后续调用按己方已提交队列对账续吐。

它不调用其他算法，也不读地图名称、对手隐藏计划或随机数状态。决策质量来自五个信息结构：

1. **独立规则模型（`royale-model.mjs`）**：从公开快照重建可推演的对局状态，用**期望值**结算伤害/治疗（不模拟事件、不消耗 RNG、不建模 `comebackSupply`），逐行动点 `advance` 推进、轮界 `finishRound` 结算炮火与淘汰。`damage` / `healAmount` 用加权枚举处理小数波动配置（`healVarianceRange` 等），镜像与 `src/engine/{validation,units,combat,deployment,demolition,engine,artillery}.ts` 逐条对拍。
2. **缩圈时空寻路（`evacuation`）**：按引擎公式复算未来六轮安全半径，对每轮构建「到安全区的多源距离场」（`inwardField`），把「未来第 h 轮才够得着安全区」折算成暴露损失；有重装时对障碍计入开路代价（连续障碍也能逐步爆破），但实际移动仍严格走平地。撤离梯度是位置效用的主项之一。
3. **战力与站位计价（`strength` / `positionValue`）**：`M.power` 按耐久 × 输出 × 机动为每个兵种定基值；`positionValue` 叠加承伤风险、撤离损失、接触距离、火力覆盖、支援贴身、到最终安全圈的内向距离，并对 `hunter`/`balanced` 情境取不同权重。
4. **多情境同步束搜索（`scenarios` + `search`）**：对每个对手预生成三类行为剧本——均衡推进（balanced，权重 0.5）、进攻（hunter，0.3）、原地开火（hold，0.2）——按行动点并行展开束搜索，叶值取三情境的加权均值 ×0.8 + 最差情境 ×0.2（兼顾平均收益与鲁棒性）。
5. **双人对抗探针（`planRound`）**：仅双人局，用束搜索得到的己方计划诱使对手做一次针对性最优回应（beam 1、nodes 150），再以 `finalist.score ×0.7 + 对该回应的完整评估 ×0.3` 从候选终局计划中挑最鲁棒者，避免被单一剧本过拟合。

### 终局估值（`evaluate`）

轮界结算后按席位聚合净值，返回「我方 − (0.65 × 最强对手 + 0.35 × 对手均值)」。兵力净值的关键设计是**拥挤折扣**：

- 按当前安全区容量（`capacity`）估算每个席位的合理兵力上限，超出部分按 `0.35^(超额数)` 指数递减战力贡献，避免过量建军挤占撤离机会；
- 站位风险项按 `sqrt(congestion)` **较慢**递减（比战力慢），保证「挤但站位好」仍被区分；
- 单兵净值经 softplus 平滑映射为**非负**，避免把敌方残兵直接算成负资产（否则搜索会误判「留着残血敌人更好」）。

这三条是回归过的核心，改动需重跑双人/多人标定。

## 实现细节

### 计算预算（环境变量，`options()`）

| 变量 | 默认 | 范围 | 说明 |
|---|---:|---|---|
| `APEX_TIME_MS` | 750 | 10..5000 | 搜索软预算；建模与计划补全（`search` 末尾把 best 补满 `M.A`）可超出 |
| `APEX_BEAM` | 4 | 1..12 | 束宽 |
| `APEX_NODES` | 1600 | 20..20000 | 确定性节点预算 |

无外部包依赖，不需训练或 GPU。软时间预算会使不同机器的搜索截断点存在差异（耗时数据非跨机可比）。

### 候选动作生成（`candidateActions`）

每步为当前席位枚举候选并按 prior 排序，全局截断到 22 个 + 1 个 `wait`：

- **attack**：每单位最多 3 个 aim（按期望伤害 + 斩杀奖励排序），受 `M.attackLimit` 门控；
- **heal**：support 最多 2 个，双安全口径（施法者与目标都不在当前/下一轮危险圈外），按恢复量 × 兵种价值排序；
- **move**：每单位最多 3 个落点，按 `positionValue` 差值 + 抢点加成排序，严格走平地且 `row[c] ≤ moveRange`；
- **demolish**：仅重装（heavy），相邻 blocker 且拆除后 `positionValue` 确实提升；
- **deploy**：按 CP 归属与补给余额，每兵种在合法落点展开，`sizePenalty` 抑制过量建军，空场时给 +10 起手加成；
- 每 actor（`type:u` 或 `deploy:unitType`）最多 2 个候选，避免单一单位刷屏。

### 必须守住的约束（回归过，别改回去）

1. **单兵净值 softplus 非负**：残兵不能被算成负资产，否则搜索会保留敌方残血单位。
2. **缓存前缀按内容对账**：`decide` 用 `signature(a)` 逐位比对己方已提交队列与缓存计划，撤回/重排/外部插入/被拒时重算；指纹 `publicFingerprint` 含 config、地形、资源、单位、炮火与 `recentConflicts`，任一变化即失效。
3. **伤害/治疗用期望枚举**：`royale-model` 的 `damage`/`healAmount` 必须处理小数波动配置，与引擎口径一致，否则对拍偏差。
4. **移动严格走平地**：`inwardField` 可为撤离梯度把 blocker 计入代价（有重装时），但真实 `move` 落点必须是平地——寻路代价与合法性分离。

### 公开碰撞退避（`collisionBackoff`）

大逃杀同时提交，两单位可能计划走到同一格 → 引擎发 `destination_conflict`。apex 从公开事件里提取「同一单位连续两轮（`roundNumber >= 当前-2`）在同一拍走向同一格」的冲突（`recentConflicts` → `M.repeatedArrivals`），在搜索里轮换暂缓其中一个（按 `M.round % claims.length` 选中），只改这一拍，其余走位仍由搜索权衡。不假定对手一定配合。

## 性能表现

实测工具：`scripts/apex-arena.mts`（真实引擎 headless、公开快照、成对换座、随机图池、`sentinel` 独立启发式对手、多人自博弈；未自然结束的对局单列 `unresolved`，不折算成胜利；不写竞技场历史）。

### 当前快照（2026-10-28，3.8.14 真实引擎，Node 24.16.0，默认预算）

固定图种子基 `20261030`；未参与调参的随机图种子基 `20261101`（15 张图各换座两局）；全部上限 80 轮。耗时含缓存续吐与提交调用，单位毫秒：

| 图池 | 对手 | 局数 | 胜 | 负 | 平 | 未结束 | p95 / 最大耗时 |
|---|---|---:|---:|---:|---:|---:|---:|
| snowflake | random-royale | 30 | 30 | 0 | 0 | 0 | 279 / 399 |
| narrow-road | random-royale | 30 | 30 | 0 | 0 | 0 | 39 / 71 |
| snowflake | sentinel | 30 | 30 | 0 | 0 | 0 | 299 / 451 |
| narrow-road | sentinel | 30 | 30 | 0 | 0 | 0 | 28 / 57 |
| 随机图 15 张 | random-royale | 30 | 30 | 0 | 0 | 0 | 104 / 284 |
| 随机图 15 张 | sentinel | 30 | 29 | 0 | 1 | 0 | 121 / 229 |

双人合计 **179 胜、0 负、1 平、0 未结束、0 非法入队**；唯一平局为随机种子 `20276939` 的 A 席，第 16 轮同归于尽。「零非法入队」不等于「所有动作都成功」——结算期仍存在碰撞、目标逃离及失败连锁。原始本地 JSON 位于 `temp/apex-calibration/release-{random,sentinel,unseen-random,unseen-sentinel}.json`（不入库，可用下方命令重跑）。

### 多人及强度边界

`snowflake`、种子 `20261031`：六人自博弈 2 局均在第 17 轮完赛；**三人自博弈 3 局均到 80 轮仍未结束（残局僵持尚未解决）**。所有席位零非法入队，最大决策耗时 634 毫秒。同种子自博弈轮换的是统计席位，不代表独立开局或对外胜率。开发回归种子 `20316464` 的 A 席对 `sentinel` 仍有败局——最终样本零负不等于不存在可击败它的局面。

`sentinel` 是评估脚本内的独立启发式压力对手，不是注册算法。随机新图样本每图只有两局，不满足逐图 30 局的稳定选型口径；它与多人、规则对拍、扰动配置回归用于发现过拟合，不能证明对所有未来地图或算法必胜。

### 真实 HTTP + runner 复验

`gameId 14ca4770-82bb-471f-b220-3c7201dcb383`（narrow-road）：apex 第 13 轮获胜，双方 runner exit 0、rejected 0、零运行错误。

## 决策时间

软时间预算 `APEX_TIME_MS=750` 主导单步上限，实际 p95 随图规模差异大（narrow-road ~28–39ms，snowflake ~279–299ms，六人 max 634ms）。缓存续吐命中时接近 0（一次算完整轮、后续调用只查表）。软预算使截断点因机器而异，耗时数据非跨机可比。

## 已知限制

1. **三人残局僵持**：3 人自博弈 3 局到 80 轮未结束，多人收敛性未解决；六人可完赛。
2. **开发种子仍有败局**：`20316464` A 席对 sentinel 会输，样本零负是有边界的。
3. **随机图样本薄**：每图仅换座两局，不足以逐图选型。
4. **期望值模型不覆盖方差尾部**：`royale-model` 用期望结算，不模拟事件、计分历史或逆风补给（`comebackSupply`）；此类自定义配置的强度需额外验证。
5. **多人无对抗探针**：`planRound` 的针对性回应校验只在 `M.seats.length === 2` 时启用，3+ 席位仅靠三情境束搜索。
6. **软预算机器差异**：耗时/截断点随机器性能浮动，跨机不可直接比。

## 优化方向

### 短期改进

1. **多人探针**：把双人对抗回应推广到多人（对最强对手或领先者做针对性回应）。
2. **三人僵持破解**：残局引入「主动收缩/逼战」偏置，避免双方都等缩圈的纳什僵局。
3. **方差感知**：对高方差伤害线（暴击/波动大）补一层最坏情况折扣。

### 长期扩展

1. **学习权重**：用本地对局记录回归校准 `M.power`、`positionValue` 与拥挤折扣参数。
2. **comebackSupply 建模**：把逆风补给等自定义配置纳入规则模型。

## 兼容性

- **支持模式**：仅大逃杀（royale）
- **不支持模式**：标准（standard）、歼灭（annihilation）、同时回合（simultaneous）——注册表 `modes: ['royale']`，其他模式下不会出现在可选清单
- **地图兼容性**：snowflake、narrow-road 已充分标定；随机图池（项目随机地图生成器，大逃杀参数）每图两局验证零负
- **席位兼容性**：2 席位充分标定（含对抗探针）；3–6 席位只保证动作合法与可完赛（六人），三人残局僵持未解决
- **运行环境**：Node.js ≥ 24，纯 JavaScript，无外部依赖

## 使用方式

### 通过前端添加

1. 创建对局，选择大逃杀地图（snowflake / narrow-road）
2. 点击「添加 AI」→ 切换到「算法脚本」标签
3. 选择算法类型「绝境算法（Apex）」，AI 名称默认预填算法中文名，可自定义
4. 点击「确定」（大逃杀需至少两个该模式算法才能组批，可与 `random-royale` 搭配）

### 通过命令行运行

```bash
npm run dev  # 启动服务器

# 另一个终端
node algorithms/runner.mjs \
  --algorithm apex \
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
  -d '{"botType":"algo_apex"}'
```

### 本地换座标定（真实引擎 headless）

```bash
npx tsx scripts/apex-arena.mts --maps snowflake,narrow-road --games 30 --opponent random-royale --seed 20261030
npx tsx scripts/apex-arena.mts --maps snowflake,narrow-road --games 30 --opponent sentinel --seed 20261030
npx tsx scripts/apex-arena.mts --maps random --games 30 --opponent sentinel --seed 20261101
npx tsx scripts/apex-arena.mts --maps snowflake --games 3 --players 3 --opponent self --seed 20261031
npx tsx scripts/apex-arena.mts --maps snowflake --games 2 --players 6 --opponent self --seed 20261031
```

## 代码结构

```javascript
// 规则模型（lib/royale-model.mjs）
createModel(game)   // 从公开快照重建可推演状态（单位/地形/炮火/CP/补给/席位）
cloneState/distances/cover/aims/safeRadius/damage/advance/finishRound
                    // 期望值结算：逐行动点推进 + 轮界炮火与淘汰；damage/healAmount 加权枚举小数波动

// 策略核心（builtin/apex.mjs）
prepare()           // 整轮共用：冲突提取(recentConflicts→repeatedArrivals)、战力表 M.power、各缓存
inwardField()       // 到某轮安全区的多源距离场（有重装时 blocker 计开路代价）
evacuation()        // 未来六轮撤离暴露损失（缩圈时空寻路主项）
strength()          // 单位战力：兵种基值 × 血量比 + 支援治疗加成
positionValue()     // 站位效用：承伤/撤离/接触/火力/支援贴身/内向距离，分 hunter/balanced 权重
candidateActions()  // 候选枚举：attack≤3 / heal 2 / move 3 / demolish / deploy，每 actor≤2，全局 22+wait
evaluate()          // 终局估值：拥挤折扣兵力 + sqrt 折扣站位 + softplus 非负 + 部署/击杀流量，我 −(0.65 最强+0.35 均值)
enemyPlan/scenarios // 三情境对手剧本（balanced .5 / hunter .3 / hold .2）
search()            // 逐行动点束搜索，叶值 = 加权均值×0.8 + 最差×0.2；预算耗尽时补满整轮
collisionBackoff()  // 公开碰撞退避：连续两轮同拍互撞时轮换暂缓
planRound()         // 束搜索 + 双人对抗探针（beam1/nodes150，.7/.3 加权）挑最鲁棒计划
parseQueue/toAction // 己方队列 ↔ 内部动作 ↔ REST 动作互转

// 导出接口
export default {
  name: 'apex',
  description: '绝境算法：缩圈时空寻路、兵力配比、多情境同步束搜索与对抗校验',
  async decide(game, _utils, ctx) { ... }  // 整轮计划缓存 + 按己方队列对账续吐，返回 null 结束/等待
}
export const __internals = { prepare, project, evacuation, evaluate, candidateActions, planRound, parseQueue, toAction, cache }
```

完整源码见 `algorithms/builtin/apex.mjs`（569 行）与 `algorithms/lib/royale-model.mjs`（318 行）。

测试：

- `tests/algorithms/royale-model.test.ts`（35 项）：规则模型与真实引擎逐条对拍（分步结算、炮火轮界、小数波动、信息隔离、队列缓存、残兵估值、连续障碍、重复碰撞）；
- `tests/algorithms/apex.test.ts`（19 项）：策略回归；
- `tests/api/bots.test.ts`、`tests/api/arena-eval.test.ts`、`tests/public/algorithm-picker.test.ts`：注册表/大厅/评估控制台/前端算法清单对 `algo_apex` 的识别（生产形态 ID）；
- 真实引擎本地换座标定即上文性能表（不写竞技场历史）。

## 一句话总结

Apex 把大逃杀的缩圈当成时空寻路问题：用独立期望值规则模型逐行动点束搜索整轮计划，三情境加权 + 最差兜底、双人局再叠对抗探针，兵力按拥挤指数折扣、单兵净值 softplus 非负。
真实引擎本地换座标定双人 180 局 179 胜 1 平零非法（不写竞技场历史）；三人残局僵持与开发种子败局是已知边界。
