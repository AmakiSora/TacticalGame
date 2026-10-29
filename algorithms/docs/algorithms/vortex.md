# vortex — 旋涡算法

> 单算法档案，遵循 `ALGORITHMS_NOTES.md` 固定模板。

## 身份与文件

| 项 | 内容 |
|---|---|
| 文件 | `algorithms/builtin/vortex.mjs` |
| 算法名 | `vortex` |
| 注册键 | `vortex`（`ALGORITHMS['vortex']`） |
| 参与者 id | `algo_vortex@v1`（大厅 bot type `algo_vortex`） |
| 显示名称 | 旋涡算法（Vortex） |
| 定位 | 效用 AI（Utility AI）+ 炮火收缩圈预判：不搜索、不模拟，单步评估全部候选动作 |
| 实现日期 | 2026-10-29 |
| 实测强度 | 歼灭模式（annihilation）：headless strict 对拍 20:0 vs random-annihilation（两图），40 局全史 40:0；竞技场榜单（2026-10-29）rating **1155**、192 局 48 胜 144 负（25.0%）——3.8.13 发布时口径为 rating 1882 ±59（40W/0L，当时榜上只有随机基线），两套数字不可混用 |
| 语言 | JavaScript (ESM) |
| 接口类型 | 策略接口（`decide`） |
| 作者 | GLM5.3Flash-DSH |

## 算法原理

Vortex 是歼灭模式专用的**效用驱动 AI**：把本回合所有候选动作（攻击/治疗/移动/部署/爆破）换算到同一效用尺度，每步选全局效用最高的动作，返回 `null` 即结束回合。它不做搜索或模拟，决策质量来自评估函数的四个信息结构：

1. **炮火收缩圈预判（round+1 安全集）**：按引擎公式（`shrinkCount = ⌊(r−startRound)/intervalRounds⌋+1`，`safeRadius = max(minimumSafeRadius, radius − shrinkCount)`）直接复算 `round+1` 的危险格判定 `dangerNext(pos) = hexDistance(pos, 原点) > nextSafe`。引擎在轮界先 `roundNumber++` 再结算满额炮伤（`engine.advanceTurn`），所以本回合结束时的站位必须按 `round+1` 半径校验——这是与其他算法"只看当前圈"的本质差异。
2. **敌方威胁图**：对每个存活敌军预计算 `immediate`（原地射程环）与 `future`（BFS 可达格再展开的射程环，×0.7 折扣）两组格子集合；同格预期承伤取所有敌军中的最大值（每轮每敌军最多攻击一次）。
3. **裁定口径反推的三条铁律**（armyValue ×2、killValue ×0.5、补给/占领/HQ 伤害权重为 0）：
   - 保存血量比拿击杀更值钱（2 : 0.5），除非零代价或决定性击杀；
   - 补给不计分 → 囤补给是纯浪费，应尽快折算成 armyValue（激进补员）；
   - `hp ≤ 炮伤` 且无法撤出危险圈的单位是"注定单位"：豁免疏散惩罚、任何正收益动作加"白打不亏"奖励（`SACRIFICE_BONUS`），不再浪费动作治疗或保护。
4. **统一效用尺度**：1 点期望伤害/血量 ≈ 6 效用（同 threat 校准区间），其余收益（疏散、抢点、推进、贴身、撤退路线）按此校准，保证跨动作类型可比。

### 与 random-annihilation 的差异

random-annihilation 只做一层合法性过滤（`deployDecision` 跳过危险区部署/治疗），vortex 则把收缩圈变成主动的收益项：疏散有正收益、进圈有重罚、注定单位转为免费输出、部署落点按 round+1 安全集预筛。同一炮火规则下，前者被动挨打，后者把规则本身变成输出窗口。

## 实现细节

### 核心参数

| 参数 | 值 | 说明 |
|---|---:|---|
| `DAMAGE_SCALE` | 6 | 1 点期望伤害/血量的效用 |
| `HEAL_SCALE` | 8 | 1 点恢复量的效用 |
| `THREAT_SCALE` | 0.8 | 1 点预期承伤的效用损失 |
| `FUTURE_THREAT_RATIO` | 0.7 | 需移动才够得着的敌人威胁折扣 |
| `LETHAL_PENALTY` | 0.8 | 遭致命反击按单位价值扣减的比例 |
| `COUNTER_RETREAT_DISCOUNT` | 0.6 | 攻击后还有一次免费移动可撤离，反击风险打折 |
| `MOVE_ATTACK_WEIGHT` | 0.6 | 走位落点后续攻击期望的折扣权重 |
| `EVACUATE_BASE` | 60 | 疏散出下轮危险圈的基础收益 |
| `SUICIDE_PENALTY` | 2.2 | 走进下轮危险圈的惩罚倍率 |
| `SACRIFICE_BONUS` | 60 | 注定单位的"白打不亏"奖励 |
| `CP_CAPTURE` | supply 70 / forward_base 130 / repair 50 | 抢点收益（按据点 kind） |
| `PROGRESS_SCALE` | 4 | 每接近目标一格的推进收益 |
| `SUPPORT_TETHER` / `SUPPORT_TETHER_BONUS` | 6 / 12 | 支援兵离开/保持治疗范围的每格惩罚/贴身奖励 |
| `ESCAPE_SCALE` / `CROWD_PENALTY` | 1.5 / 2 | 落点每个空邻格收益 / 每个己方邻居惩罚 |
| `DEMOLISH_UTILITY` | 90 | 爆破效用（仅重装、墙确实挡路） |
| `DEPLOY_UTILITY` | 250 | 部署基准效用：最优动作不超过它时才补员 |
| `DEPLOY_THREAT_LIMIT` | 20 | 新兵落点的预期承伤上限 |
| `HQ_KILL_UTILITY` | 20000 | 总部击杀 = 直接终局，压倒一切 |
| `HQ_DAMAGE_BONUS` | 1.5 | 对敌方总部伤害项的压制系数 |
| `KILL_BONUS` | 30 | 稳杀收益 = 30 × worth(目标)（worth = 40 + 1.4×cost） |
| `PROBABLE_KILL_RATIO` | 0.6 | 平均伤害够杀（方差可能不够）时的折扣 |
| `MIN_ACTION_UTILITY` | 0.001 | 结束回合的效用门槛，**必须严格小于 `PROGRESS_SCALE`** |

### 两个必须守住的约束（与 threat 同源，回归过，别再改回去）

1. **`MIN_ACTION_UTILITY` 必须严格小于 `PROGRESS_SCALE`**。`decide()` 返回 `null` 的语义是"结束整个回合"（`algorithms/lib/interfaces.mjs` 的 decide 循环），门槛若取到"推进一格"的量级会把"只能再接近目标一步"的整回合掐掉。
2. **所有动作生成必须按行动点预算门控**（`!hasMoved/!hasActed && (actionSpent || budget > 0)`）。引擎规则是每单位每回合最多消耗 1 点，已激活单位再动免费；漏一门控就会出现 `action_limit_reached`，轮次制 runner 遇错即中止整回合（`interfaces.mjs`）。

### 合法性镜像（全部与引擎逐条对拍过）

轮次制任何一次拒绝都会中止整回合，因此每类动作都镜像了引擎校验顺序：

- **attack**：`!hasActed && (actionSpent || budget>0)`，距离 ≤ `attackRange`；
- **heal**：support 同上门控 + **双方都不在当前炮火区**（`combat.healTarget` 同口径）+ 距离 ≤ `healRange`（`config.units.support.healRange ?? attackRange`）+ 目标未满血 + 跳过"下轮圈内且 hp ≤ 炮伤"的目标；
- **move**：`!hasMoved && (actionSpent || budget>0)`，落点为无占用平地；
- **deploy**：`actionsRemaining > 0` + 原点/落点均不在**当前**炮火区（引擎硬校验，且引擎把该检查排在行动点校验**之前**）+ 落点为无占用平地 + 补给足够（`effectiveDeployCost` 含据点折扣）+ vortex 附加"落点在 round+1 安全圈内"；
- **demolish**：heavy、`!hasActed`、相邻 blocker 且无占用、拆除后确实更接近运动目标。

## 性能表现

实测工具：`scripts/algorithm-arena.mjs`（headless 自博弈，直接驱动 `src/engine/`，不经 HTTP；`--strict` 审计每个动作是否被引擎接受）。

### vs random-annihilation（歼灭模式基线，各 20 局 strict）

| 地图 | 战绩 | 均分 | 动作/局 | 非法动作 |
|---|---:|---:|---|---:|
| artillery-zone | **20:0（100%）** | 1161 vs 7 | deploy 8.1 / move 32.7 / attack 15.0 / heal 1.2；带AP交回合 0/200 | **0** |
| trench-run | **20:0（40 局全史累计 40:0）** | 953 vs 6 | deploy 8.4 / move 37.1 / demolish 0.7 / attack 11.6 / heal 0.5；带AP交回合 18/231 | **0** |

- 两图各 20 局全部 `last_player_standing` 终局、先手后手各 10:10 全胜；对手均分 6–7 意味着每局都被歼灭前几乎没有产出。
- **strict 合法性**：vortex 席位 0 非法动作（两图合计 n=4816 次决策全部被引擎接受）；修复 harness 快照缺 `game.artillery` 字段后（见下），random-annihilation 也回到 0 非法动作。

### Harness 修复记录（scripts/algorithm-arena.mjs）

排查 vortex strict 审计初报的 119 次非法动作时确认：headless `snapshot()` 未透出 `game.artillery`（线上 `sanitizeGameForResponse` 经 `...rest` 是透传的），导致 `utils.inArtilleryDanger` 在竞技场中恒为 false——算法侧所有镜像正确，仍会"合法地"把动作发进危险区再被引擎拒绝。已按线上口径补齐 `artillery`（与 `map.radius`）字段；修复后 strict 两图均 0 非法动作，胜率不降反升（17:3 → 20:0）。

### 与其他算法/榜单

- **当前榜单（2026-10-29，`public/data/arena-leaderboard.json`）**：vortex rating **1155**，192 局 **48 胜 144 负（25.0%）**；同榜 `sovereign` 2142、`crucible` 1914、`shrinkroll` 1694、`random-annihilation` 595。
- **3.8.13 发布时口径**：rating 1882 ±59、可见窗口 40W/0L（全史 440W/0L）。当时歼灭榜只有 `random-annihilation` 一个注册对手；3.8.15 / 3.8.17 加入 `crucible` / `sovereign` 后榜单重算，这套数字仅作历史记录，不能与当前值对照。

## 决策时间

strict 对拍 n=4816 次真实决策的分布：

| 分位 | artillery-zone | trench-run |
|---|---:|---:|
| p50 | 0.12 ms | 0.08 ms |
| p95 | 2.03 ms | 1.32 ms |
| p99 | 3.50 ms | 2.42 ms |
| max | 8.4 ms | 4.0 ms |

单步典型耗时 0.1 ms 量级：无搜索、无模拟，威胁图与收缩圈一次构建后全部查表。对局整体节奏由 REST 轮询间隔主导，算法本身不构成瓶颈。

## 已知限制

1. **无前瞻**：单步贪心效用，不推演"我走这里→敌人打谁→我再怎么应"的回应链；多步战术（诱敌、卡位接力）超出能力。
2. **仅歼灭模式**：`decide` 在非 annihilation 配置下 `game.artillery` 为 null、收缩圈逻辑自动旁路，但抢点/补员权重是按歼灭裁定口径标定的，标准模式未标定、未评估——不要在 standard 上使用。
3. **注定单位判定是近似**：`hp ≤ 炮伤 && dangerNext` 假定该单位下轮行动前必吃满额炮伤，忽略了"对手先手击杀它"等更快死法（此类场景下奖励白给动作仍然不亏）与"被治疗救活"（双安全口径下治疗者自身也要安全，实际救不回圈内目标）。
4. **收缩圈公式镜像依赖配置**：`dangerNext` 复算依赖 `config.annihilation.artillery` 的 `startRound/intervalRounds/minimumSafeRadius`，royale 模式（同回合制同时结算 + 缩圈）未适配。
5. **权重为手工量纲**：沿用 threat 实测校准区间，未做网格/进化调参；`DEPLOY_UTILITY=250` 与战斗动作的比较是经验值。
6. **多席位未标定**：对拍样本均为 2 席位歼灭局；3-4 席位的歼灭图未评估。

## 优化方向

### 短期改进

1. **对手部署感知**：把敌方补给余额与据点收入纳入补员节奏判断（对手快补员时提前抢 forward_base）。
2. **注定单位集火协议**：己方注定单位间按"最后一击归属"排序，避免浪费一次免费攻击在已必死目标上（killValue 只计手动最后一击）。
3. **参数搜索**：`SUICIDE_PENALTY`/`EVACUATE_BASE` 等是人工扫描值，应做网格/进化调参。
4. **royale 适配**：`dangerNext` 复算已与引擎同公式，royale 的同时回合计划接口适配后可扩展。

### 长期扩展

1. **浅层前瞻**：vortex 评估作叶子节点 + 1-2 层对手回应搜索（评估函数即天然的状态估值器）。
2. **学习权重**：用 arena 对局记录回归校准效用权重。

## 兼容性

- **支持模式**：仅歼灭模式（annihilation）
- **不支持模式**：标准（standard）、同时回合（simultaneous）、大逃杀（royale）——注册表 `modes: ['annihilation']`，其他模式下不会出现在可选清单
- **地图兼容性**：artillery-zone、trench-run 均已 strict 审计 0 非法动作、全部正常终局
- **席位兼容性**：2 席位已充分对拍；3-4 席位只保证动作合法，不保证强度
- **运行环境**：Node.js ≥ 24，纯 JavaScript，无外部依赖

## 使用方式

### 通过前端添加

1. 创建对局，选择歼灭模式地图（artillery-zone / trench-run）
2. 点击"添加 AI"按钮 → 切换到"算法脚本"标签
3. 选择算法类型"旋涡算法（Vortex）"，AI 名称默认预填算法中文名，可自定义
4. 点击"确定"

### 通过命令行运行

```bash
npm run dev  # 启动服务器

# 另一个终端
node algorithms/runner.mjs \
  --algorithm vortex \
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
  -d '{"botType":"algo_vortex"}'
```

### 严格审计（headless）

```bash
npx tsx scripts/algorithm-arena.mjs --a vortex --b random-annihilation --games 20 --map artillery-zone --strict
npx tsx scripts/algorithm-arena.mjs --a vortex --b random-annihilation --games 20 --map trench-run --strict
```

## 代码结构

```javascript
// 评估核心
buildContext()     // 整回合共用：收缩圈 dangerNext（round+1 安全集）、威胁图、抢点表、行动预算
isDoomed()         // 注定单位：hp ≤ 炮伤且下轮仍在圈内 → 免费输出豁免
attackGain()       // 攻击毛收益：最坏情况伤害线的稳杀/可能杀分级 + HQ 压制
incoming()         // 查表：某格预期承伤（immediate 最大值 / future ×0.7 折扣）

// 动作生成
attackOptions()    // 攻击：期望伤害 + 斩杀奖励 − 反击风险（注定单位加白给奖励）
healOptions()      // 治疗：双安全口径 + 跳过注定目标
moveOptions()      // 移动：位置效用差 + 落点后续免费跟攻的期望
positionUtility()  // 位置效用：疏散/进圈罚 + 承伤 + 抢点 + 推进 + 支援贴身 + 撤退路线/拥挤
demolishOptions()  // 爆破：仅重装、墙确实挡路
deployOption()     // 补员：兵种优先级（重伤先 support，否则 ranger 优先）+ round+1 安全集预筛

// 导出接口
export default {
  name: 'vortex',
  description: '旋涡：炮火收缩圈预判疏散、稳杀集火、走位风筝、激进补员',
  async decide(game, utils) { ... }
}
```

完整源码见 `algorithms/builtin/vortex.mjs`（391 行）。

测试：

- `tests/algorithms/arena-eval` 相关 API 套件（`npx vitest run tests/api/arena-eval.test.ts`，33 场景）覆盖注册表/榜单/控制台对 vortex 的识别与参与目录合并；
- strict headless 对拍即"合法性镜像"的回归（见上文两图各 20 局 0 非法动作）。

## 一句话总结

Vortex 把歼灭模式的炮火收缩圈当成收益项而不是风险项：按 round+1 安全校验站位，疏散有奖、进圈重罚、注定单位转为免费输出，配合稳杀集火与激进补员。
strict 对拍 40:0 vs random-annihilation（两图各 20 局、0 非法动作）；竞技场榜单（2026-10-29）rating 1155（192 局 48W/144L）。
