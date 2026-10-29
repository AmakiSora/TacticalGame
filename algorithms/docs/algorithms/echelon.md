# echelon — 雁阵算法

> 单算法档案，遵循 `ALGORITHMS_NOTES.md` 固定模板。设计完全从引擎规则第一性原理推导，
> 实现期间未阅读仓库内其他强度算法（shrinkroll / vortex / horizon 等）的源码；规则输入
> 只来自 `skill/royale.md`、`src/engine/*` 与对局 config / 公开事件流。

## 身份与文件

| 项 | 内容 |
|---|---|
| 文件 | `algorithms/builtin/echelon.mjs` |
| 算法名 | `echelon` |
| 注册键 | `echelon`（`ALGORITHMS['echelon']`） |
| 参与者 id | `algo_echelon@v1`（大厅 bot type `algo_echelon`） |
| 显示名称 | 雁阵算法（Echelon） |
| 定位 | 效用 AI + 敌军落点扩散预报 + 精确击杀概率 + 炮火圈生存调度 + 爆破距离场开路 |
| 实现日期 | 2026-10-29（3.8.16） |
| 实测强度 | 大逃杀模式（royale）：headless 对拍 vs `random-royale` snowflake 30:0 / narrow-road 19:1（95%）、3 人局 1v2 6:0；镜像自博弈稳定、0 非法动作 |
| 语言 | JavaScript (ESM) |
| 接口类型 | 策略接口（`decide`） |
| 作者 | GLM5.3Flash-Zcode |

## 算法原理

Echelon 是大逃杀模式（同时回合 × 歼灭缩圈）的**逐拍效用决策 AI**：每次 `decide()` 从
`plan.myQueue` 读回本回合已排队列（前缀即已定剧本），镜像引擎重放投影后，在"下一拍"
上枚举全部候选动作（移动/攻击/治疗/部署/爆破），取边际效用最高者返回，`null` 即提交。
不做跨回合搜索，决策质量来自五个信息结构：

1. **敌军落点扩散预报**：同时回合的攻击是瞄格制（命中"结算时站在此格"的敌人），而
   敌我计划互为秘密。对每个敌军单位建立各行动点的落点分布：停留大质量 + 一跳扩散
   （BFS 地形可达、按距离衰减 0.72）+ 双跳扩散（步数 ≥2 时小质量）；朝目标方向格加权
   1.3，危险格降权 0.35。三个行为修正全部来自可观察事实：危险中的单位停留质量骤降
   （0.2，向外圈疏散）；射程内有我军的单位停留质量上调（0.62，接火倾向原地开火）；
   **上轮移动过的"躲避者"停留质量骤降至 0.15 且目标方向反转为逃离我方最近威胁**
   （躲避方向可被覆盖预测——这是破解镜像躲避舞步的关键，见"已知限制"）。
2. **精确战斗算术**：伤害 = `max(minimumDamage, attack − defense + U[−v..v])`，击杀概率
   按均匀分布解析计算（`P(base+u ≥ hp)`）；`attackLock`（计划时点击格上有敌即锁定、未逃出
   射程必中）按"目标满机动逃出射程的可达比例"建模命中；己方前缀攻击的期望伤害按命中
   质量累计进目标有效血量（锁定按必中计），集火击杀在贪心序列里自然成型。单次命中价值
   = 能打死按单位价值计、打不死按**击杀进度**计（单位价值 ÷ 还需命中次数 × 2.0）——
   残血目标价值飙升，集火自然涌现。斩杀敌方最后一单位（army wipe 即获胜）加 1e6 支配性
   加分；早拍击杀另有 0.97/拍的折扣加成（死人的后续队列作废）。
3. **炮火圈生存调度**：从 `config.annihilation.artillery` 推导任意未来轮次的安全半径
   （与引擎 `artilleryStateForRound` 同构）。"本轮边界就会挨炮"的格子 = 当前危险格 ∪
   （下轮即缩圈时的）预警格，站在上面的单位获得 `damage × 0.9 × (0.8 + 单位价值/80)`
   的压倒性疏散效用（链式双移靠逐拍自然完成）；下轮危险圈格位轻罚 25%。部署/治疗按
   引擎口径只在当前危险圈外（起点、落点、施法覆盖格，治疗漏一格即 fizzle），新生儿
   落点再避开下轮圈（×0.55）。
4. **爆破距离场开路**：royale 图普遍用墙体把出生凹地/走廊/最终安全区隔开（如 snowflake
   的花心与全部凹地都靠重装爆破进入）。以圈心为源做 Dijkstra（plain↔plain 代价 1，共享
   blocker 邻居的 plain 格对之间连"爆破传送"边，代价 2 + BLAST_COST=5，水不可爆破天然
   断路），得到全图**爆破距离场**：有墙时场值梯度自动把全军牵引到墙门，重装对"拆掉后
   能显著缩短我到场值"的墙给 `min(进度 × 1.2, 30)` 的爆破效用，爆破后场值改写、路线自动
   改道——对任何地图形状成立，不含地图名特例。
5. **编成与驻屯**：兵种角色（治疗者/锁定手/占领者/前排）全部由 `config.units` 字段推导；
   编成缺口（每 4 战斗单位 1 治疗者上限 3、每 3 人 1 锁定手、每 3 人 1 前排、机动占领者
   2 名）把在途部署计入、避免单兵种过量；兵力上限 = `actionsPerTurn + 1`（缩圈期每单位
   平均每轮 ~1 拍走位 + 战斗治疗预留）；出生据点 2 环内拥挤 > 5 时停止补员（先流出走廊
   再爆兵，零兵力时豁免——开局零单位的 royale 图必须立刻爆兵活命）。驻屯目标半径按
   "全军挪完需要几轮"前瞻安全圈（horizon = ⌈armySize/4⌉ + 1），缩圈开始前就启动行军。

### 拒绝记忆（本地重问轮换）

被引擎拒绝的动作不改变状态、队列不增长，确定性重算会永远给出同一动作。模块内记忆
（键 = 座位）记录「轮次 + 队列长度 + 上次发射指纹」：同一状态下再次被问即视为上次发射
被拒，指纹入本轮拒绝集、轮换次优候选；轮次或队列长度变化即清空。只记录自己发过的动作，
不读任何隐藏信息。

## 实现细节

### 核心参数（`TUNE` 表，与代码一一对应）

| 参数 | 值 | 说明 |
|---|---:|---|
| `FORECAST_STAY` | 0.45 | 敌军停留概率（不移动/原地开火/待命） |
| `FORECAST_STAY_ENGAGED` | 0.62 | 敌人射程内有我军时的停留概率上调 |
| `FORECAST_STAY_DODGER` | 0.15 | 上轮移动过的躲避者停留质量 |
| `FORECAST_DECAY` | 0.72 | 一跳扩散按 BFS 距离的衰减 |
| `FORECAST_DOUBLE` / `_DOUBLE_DECAY` | 0.12 / 0.7 | 双跳扩散总质量 / 距离衰减 |
| `FORECAST_ALIGN` | 1.3 | 朝目标方向格的加权倍率 |
| `FORECAST_DANGER_SHRINK` / `_FLEE_STAY` | 0.35 / 0.2 | 敌人视角危险格降权 / 危险中停留骤降 |
| `LOCK_ESCAPE_MOVES` | 0.55 | 锁定建模：目标不动的概率之外的逃逸面权重 |
| `LOCK_ESCAPE_SLACK` | 1 | 锁定逃逸的富余格数：目标多跑 1 格即视为基本逃出 |
| `W_CHIP` | 1.4 | 期望伤害权重（压过站桩） |
| `W_CHIP_FINISH` | 2.0 | 击杀进度价值倍率（残血目标单次命中更值钱） |
| `W_RISK` | 1.0 | 反击风险权重（位置效用内计一次，攻击候选不重复扣） |
| `HIT_STAY` / `HIT_MOVED` / `HIT_LOCKED` | 0.5 / 0.16 / 0.75 | 反击命中模型（停留/移走/被锁定） |
| `STEP_DISCOUNT` | 0.97 | 后拍动作每拍折扣（早拍击杀让后续队列作废） |
| `W_EVAC` / `EVAC_PARTIAL` / `NEXT_DANGER_FRACTION` | 0.9 / 0.45 / 0.25 | 疏散效用 / 撤不干净折算 / 下轮圈预防罚 |
| `STAGE_MARGIN` / `W_ADVANCE` | 1 / 1.6 | 驻屯内圈余量 / 推进与接敌拉力（不封顶） |
| `BLAST_COST` / `W_ROUTE` / `W_BLAST_PROGRESS` / `BLAST_EV_CAP` | 5 / 0.35 / 1.2 / 30 | 爆破传送代价 / 路线牵引 / 爆破进度 / 爆破效用上限 |
| `W_COHESION` / `W_HEAL_STATION` | 0.08 / 1.1 | 编队凝聚 / 治疗者驻疗位（贴伤兵治疗范围） |
| `W_CROWD` | 1.0 | 与友军或自队声明格重叠的拥挤惩罚（声明格冲突时再 ×2） |
| `W_EXPOSED` / `BONUS_KITE` / `ENGAGE_REACH` | 1.2 / 0.6 / 2 | 接敌暴露罚 / 安全风筝奖 / 接敌判定余量 |
| `W_CP_INCOME` / `CP_PAD_BASE` / `CP_GUARD` | 2.2 / 14 / 10 | 占领价值（收入折算+基础）/ 守巢 |
| `DEPLOY_BASE` / `DEPLOY_WARTIME` / `DEPLOY_NEXT_DANGER` | 20 / 0.8 / 0.55 | 部署基础效用 / 接敌折减 / 下轮圈落点折减 |
| `UNBLOCK_BONUS` | 10 | 让位奖励：站在己方可部署据点旁堵死补员落点时，挪一格的额外效用 |
| `POCKET_CROWD_LIMIT` | 5 | 出生据点 2 环拥挤上限（超则停补员；零兵力豁免） |
| `HEALER_RATIO` / `HEALER_CAP` / `SNIPER_RATIO` / `FRONT_RATIO` / `RUNNER_TARGET` | 4 / 3 / 3 / 3 / 2 | 编成缺口目标 |
| `COMMIT_THRESHOLD` | 1.0 | 效用低于此值直接提交（`null`） |
| `VALUE_SUPPORT` / `VALUE_LOCK` / `VALUE_CAPTURER` | 1.35 / 1.15 / 1.08 | 兵种估值倍率 |

### 四个必须守住的约束（调试期踩过的坑，回归覆盖）

1. **攻击候选不得再扣反击风险**。位置效用已含停留风险，攻击与"移动躲开"的比较 =
   纯伤害价值 vs（位置收益 + 风险差）；攻击候选重复扣风险会导致接火时永远放风筝不还手。
2. **爆破门槛判定用 `unit.type`（运行时单位字段），不是 `spec.type`**（地图 config 的兵种表
   没有 `type` 字段）——判错会让爆破候选永不出现，全军被墙封死在出生凹地里炮火屠戮。
3. **零兵力必须放行部署**。开局零单位的 royale 图（narrow-road）第 1 轮不部署即
   `army_destroyed` 淘汰；任何"没有单位就返回 null"的早退都是错的。
4. **地形解析必须与引擎同序**（`gameIndex` 的构建顺序：`game.cells` 先铺、
   `map.terrainCells` 按序覆盖、后者优先）。用 `find` 取首条会让"同格多次定义"的地图
   （墙被先声明的 plain 覆盖）全军翻墙——这类地图在未来新图上完全可能出现。

### 前缀感知（幽灵重复入队回归覆盖）

引擎计划期只做结构性校验，占用/冲突留到结算——同一拍格位会被重复入队、结算时集体
`destination_conflict/destination_occupied` 白烧行动点。候选生成必须按结算口径过滤：

- 我军**最终投影位**（前缀移动终点 + 未动者原位）+ 前缀部署落点 = 禁入格；
- 前缀部署已承诺的补给从可花补给中扣除；
- 前缀攻击的期望伤害按命中质量累计进目标有效血量（集火建模）、每攻击者的攻击次数
  对照 `attacksPerUnit`；
- 前缀治疗的期望恢复量从友军缺口中扣除（重复治疗 `already_healthy` fizzle）；
- 敌军计划时刻站位按"大概率仍被占"重罚 −30（移入即到达冲突 + 该单位后续动作连锁作废）。

### 合法性镜像（与 `src/engine/planning.ts` 逐条对拍）

形状覆盖（single 距离 1..range 且非自身格 / line 正方向射线 1..min(length,range) 同射线
任意点击覆盖整条 / arc 相邻定向 3 格）、治疗范围（`healRange ?? attackRange`）、部署
（owned CP 起点、相邻、投影地形 plain、起点/落点危险圈拒绝、补给按已排部署扣减）、
攻击次数上限、AP 预算（每拍 1 点、队列长度 ≤ `actionsPerTurn`）、治疗危险区 fizzle
（施法者或任一覆盖格在当前危险圈）。测试 `tests/algorithms/echelon.test.ts` 对以上逐条
断言，并在真实 snowflake 对局上回归「枚举出的每个动作都被引擎入队校验接受」。

## 校准过程（开发期要点）

1. **地图结构先行**：snowflake 的连通分量分析显示出生凹地（6×14 格）、中环网络（66 格）、
   花心（6 格）两两被墙隔断，重装爆破是唯一通路——"向内行军"必须有爆破开路才有意义。
2. **幽灵重复入队**：初版每轮 8 AP 实际只有 1 拍有效（重复部署结算全灭），修复后部署率
   正常、对 random 从互败转为全胜。
3. **兵力上限与凹地饱和门**：无上限时全军挤死在出生凹地（可达格全被友军占位，移动候选
   为零），缩圈后成片挨炮；`AP+1` 上限 + 拥挤门让兵员流量进出平衡。
4. **战斗经济学**：攻击候选双扣反击风险 → 永远放风筝（12 局 7 次攻击）；改为"位置效用
   计一次风险、攻击候选纯伤害价值"后攻击正常化（126 次/12 局）。
5. **躲避舞步僵局**：镜像自博弈出现每轮 10 攻 0 中的永续对峙；停留质量按"接火 0.62 /
   躲避者 0.15"分档 + 躲避方向反转为逃离威胁后，僵局面大幅减少（详见已知限制）。

## 校准数据

**当前快照（2026-10-29，3.8.16 真实引擎，`scripts/horizon-arena.mts` headless 对拍——
计划模式专用 harness：REST 同口径快照、被拒动作记住指纹重选（上限 20）、`null` 即提交、
逐局交换座位）**：

| 对局 | 战绩 | 说明 |
|---|---|---|
| snowflake 2P vs `random-royale` ×30 | **30:0** | 全部 `last_player_standing`，echelon 席位 0 非法 |
| narrow-road 2P vs `random-royale` ×20 | **19:1** | 唯一败局为比分接近的消耗战（0 非法） |
| snowflake 3P（1 echelon vs 2 random）×6 | **6:0** | 多席位正常收场 |
| snowflake 镜像自博弈 ×12 | 3:5 / 4 平 | 平局均为规则允许的规避对峙（round_guard 兜底） |
| narrow-road 镜像自博弈 ×12 | 6:6 | 地形强制接触，全部正常终局 |

决策耗时（snowflake 自博弈 12 局汇总）：单轮 p50 15.8ms / p95 30.5ms / max 39.9ms，单局
平均 2.1s（vs random 对拍单轮 p50 2.4ms、单局 0.3s）。全部对局 echelon 席位 **0 非法动作**。

复现命令：

```bash
npx tsx scripts/horizon-arena.mts --a echelon --b random-royale --map snowflake --games 30 --quiet
npx tsx scripts/horizon-arena.mts --a echelon --b random-royale --map narrow-road --games 20 --quiet
npx tsx scripts/horizon-arena.mts --a echelon --b random-royale --map snowflake --players 3 --games 6 --quiet
npx tsx scripts/horizon-arena.mts --a echelon --b echelon --map snowflake --games 12 --quiet
npx tsx scripts/horizon-arena.mts --a echelon --b echelon --map narrow-road --games 12 --quiet
```

竞技场整链路（`round_robin.py` + evaluate 控制台）大逃杀模式自此有两个算法条目
（`random-royale` + `echelon`）可组批。

**未见过的合成图验证（新图开箱即用）**：临时构造一张全新 royale 地图（半径 5 开阔盘 +
花心十字墙、attacksPerUnit 2、炮火 startRound 4 / interval 2 / damage 15 / minSafe 0、
全新兵种数值，验证后删除）：自博弈与对 random 对拍均正常收场、echelon 席位 0 非法动作
——验证期间该图暴露并修复了地形解析优先级 bug（见约束 4），其余零改动，"未来新增
royale 地图无需改动本算法"的口径成立。

## 已知限制

- **镜像规避对峙**：双方都只规避不接战时（等速追逃、开阔地形、无锁定兵种在场），
  瞄格制攻击无法强制命中，对局可能拖到轮次守卫/房主裁决（`round_guard` 兜底平局）。
  这是等速追逃博弈的固有性质，非实现缺陷；对非镜像对手该形态依赖对手同样选择规避。
- **无跨回合搜索**：单拍贪心 + 当回合剧本，不做"下一回合我方剧本 vs 对方预报"的联合
  推演；对会做深度对推的对手处于信息劣势。
- **预报参数固定**：扩散模型权重（0.45/0.62/0.15 等）为手工标定，未按对手统计量
  在线拟合；`movedLastRoundOf` 只回看一轮。
- **未对标 RL 模型**：RL 模型目前只覆盖标准模式，大逃杀无 RL 参评数据。
- **多人局未深标**：3/6 人局验证了合法性与可终局性，强度数据只有 3P 1v2 一组。

## 复现与测试

- 单元 + 整轮回归：`npx vitest run tests/algorithms/echelon.test.ts`（20 例：门卫、部署、
  前缀感知、锁定、击杀进度、治疗危险区镜像、疏散、爆破、确定性、真实 snowflake 整轮）。
- 整局自博弈合法性：`npx vitest run tests/algorithms/echelon-selfplay.test.ts`（两图、
  0 非法动作、终局性按图断言）。
- 全量：`npm run build && npm test`（3.8.16 交付口径 142 文件 / 1482 例全绿）。
