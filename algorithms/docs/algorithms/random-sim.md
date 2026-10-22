# random-sim — 同时随机算法

> 单算法档案，遵循 `ALGORITHMS_NOTES.md` 固定模板。

## 身份与文件

| 项 | 内容 |
|---|---|
| 文件 | `algorithms/builtin/random-sim.mjs` |
| 算法名 | `random-sim` |
| 注册键 | `algo_random-sim` |
| 显示名称 | 同时随机算法（Random-Sim） |
| 定位 | 同时回合模式的最弱基准算法，用于对照测试和模式隔离冒烟 |
| 版本 | v2（3.8.0 分步引擎适配；v1 为 2026-10-06 v3.5.12 的单动作镜像） |
| 实现日期 | 2026-10-06（v1，v3.5.12）/ 2026-10-23（v2，3.8.1） |
| 语言 | JavaScript (ESM) |
| 接口类型 | 策略接口（`decide`） |
| 支持模式 | 仅同时回合（simultaneous） |

## 算法原理

与标准模式的 random 同宗：每轮从所有合法**计划动作**中随机选一个入队，返回 null 即提交计划（end-turn）。没有任何启发式或评估函数。

同时回合模式的动作语义与标准模式根本不同（详见 `skill/simultaneous.md`），算法按此适配：

1. **动作入队而非立即执行**：服务器返回 `{ ok, queued, queue }`，结算在全员提交后统一发生。
2. **攻/治瞄准格子而非目标 id**：`{ attackerId, q, r }` / `{ supportId, q, r }`，命中结算时落在覆盖形状上的单位——预测射击。
3. **队列位置即行动点**：同一单位可以跨行动点多次行动（例如先移动后攻击）；攻击次数另受地图 `balance.attacksPerUnit` 限制（默认 1，`attack_limit_reached`）。
4. **队列长度即行动点**：上限 `config.balance.actionsPerTurn`，读 `game.plan.myQueue` 计数（`turn.actionsUsed` 在本模式不按座位维护）。
5. **座位从 `ctx.owner` 拿**：同时模式 `turn.currentPlayerId` 恒为 null。

## v1 → v2：3.8.0 分步引擎适配

v1 按旧的 `planning.ts` 口径生成计划：每单位每轮至多一个动作、移动用把单位/总部当障碍的 `reachableCells`、己方目的格互斥。3.8.0 改为按行动点分步结算后，这套镜像会让随机基线在多数轮次只用掉 3–4 个行动点，且无法利用“先移动后攻击”的组合。v2 是一次**枚举层适配**，不改变“均匀随机”的策略本质。

### 改动清单

- **规则镜像**：按 `simultaneousResolve.ts` 的分步语义做队列前缀投影；攻击/治疗/移动起点使用投影站位。
- **动作生成**：移除“一单位一动作”过滤，同一单位可连续排移动/攻击/治疗；移动改为只按地形 BFS（单位/总部不挡路）。
- **目标筛选**：部署/移动按投影后空位判断，保留己方目的格去重；攻击次数按 `balance.attacksPerUnit`（默认 1）过滤。
- **搜索/评估**：无——仍从全部候选动作均匀随机抽取，无启发式、无 rollout。
- **接口适配**：无新增接口；继续经 `decide` 返回单个动作，`null` 提交计划。

### 同口径对照

**暂无同口径 v1 vs v2 对局数据**：random-sim 是均匀随机基线，v1 实现未保留在仓库，且两者对打只能得到噪声；不作为强度提升依据。补测计划：若需要，可用固定种子在 standoff / molten-throne 各 30 局跑 v1/v2 互打，仅用于确认 v2 的行动点使用率与非法率，不用于排名。

### 提升幅度

不声明强度提升。可确认的适配收益是**行动点利用率**：v2 会把队列排到 `actionsPerTurn`（受攻击上限约束），不再因“一单位一动作”提前提交；随机策略本身仍是性能下界。

### 代价与边界

- 单步决策仍远低于 0.1 秒；新增投影/地形 BFS 为 O(单位×可达格)，与旧版同量级。
- 仍可能选择低质量动作（随机基线本意）；已通过投影空位/目的格去重降低自冲突。
- 攻击次数上限、到达冲突、级联失败等结算风险仍存在，随机基线不保证计划成功。

### 样本边界

适配验证基于 **3.8.0/3.8.1 引擎、真实 standoff 对局、18 个单元测试 + 整轮回归**；没有跨地图 30 局强度标定，不能据此推断对其它算法的胜率。

## 决策逻辑

每次 decide 调用：

### 0. 前置短路

- 无 `ctx.owner` 或无 `game.plan` → null；
- `plan.committed` 已含己方 → null（等结算）；
- `plan.myQueue.length >= actionsPerTurn` → null（预算用尽）。

### 1. 枚举攻击（按形状瞄准）

按 `config.units.<type>.attackShape` 镜像引擎 `coveredCellsFor` 的瞄准合法性；攻击起点使用该单位在队列中的**投影站位**（前面的 move 已生效的假设下），因此支持先移动后攻击。同一单位已排攻击数达到 `balance.attacksPerUnit`（默认 1）时不再枚举攻击。

| 形状 | 可瞄准条件（目标当前格） |
|---|---|
| single / 缺省（含 ranger 锁定射） | 0 < 距离 ≤ attackRange |
| line | 目标落在 6 向射线上且 1 ≤ 距离 ≤ min(length, attackRange) |
| arc | 目标相邻（距离 1，点击其格即被覆盖） |

目标集为 `utils.enemyTargets`（敌方单位 + 总部）。

### 2. 枚举治疗

支援兵（support）按 `healShape`（缺省 single）瞄准**受伤**友方所在格：single 允许本格（自治），射程取 `healRange ?? attackRange`；arc 仅相邻格。治疗起点和受伤友方的目标格都按队列投影站位计算。镜像炮火校验：施放者站在缩圈炮火危险区、或任一覆盖格（arc 为瞄准方向扇形三格）落在危险区的治疗不入队；simultaneous 无炮火机制（`game.artillery` 恒为 null），该过滤恒通过。

### 3. 枚举移动

从该单位的投影站位做**只按地形**的 BFS（水/障碍挡路，单位/总部不挡路，与引擎 `planning.ts` 一致）；排除己方队列已认领的目的格，以及投影后仍被己方/敌方单位或总部占据的格子。同一单位可以连续排多条移动。

### 4. 枚举部署

`utils.deployOrigins`（总部 + 己方可部署据点，`canDeploy: false` 的类型已排除）× `config.units` 全兵种 × 相邻平地；目标格按投影后是否为空判断（前面的己方移动可能腾空），并排除己方队列已认领的目的格。补给预算扣减队列中已计划部署的花费（`effectiveDeployCost` 含据点折扣）。出生点或落点在炮火危险区内的部署不入队（引擎拒绝 `invalid_deploy`，同治疗一节仅歼灭轴模式生效）。

### 5. 随机选择

```javascript
if (allActions.length === 0) return null;  // 无合法计划动作，直接提交
return allActions[Math.floor(Math.random() * allActions.length)];
```

## 实现细节

- **不依赖服务器拒绝来发现非法动作**：所有枚举都镜像 `src/engine/planning.ts` 的入队校验（形状瞄准、攻击次数上限、队列投影站位、地形寻路、部署预算扣减、炮火危险区）。被拒动作虽不再让 `runAlgorithm` 提前提交整轮计划（它会把被拒动作记住、让 decide 重选，有重问上限），但每次被拒仍空耗一次重问配额与一次请求往返，合法镜像才能保证一轮行动计划排满排快。
- **回归测试保证枚举口径与引擎一致**：`tests/algorithms/random-sim.test.ts` 在真实 standoff 对局上把算法返回的每个动作喂给引擎 `queueXxxAction`，全部接受才算通过。
- 总复杂度 O(n·m + n·c)，与标准 random 相同，单步决策远低于 0.1 秒。

## 性能表现

暂无同口径性能表（引擎 3.8.1；地图池 standoff / molten-throne；真实引擎 harness；0 局；2026-10-23），不作为选型依据。作为同时回合模式的性能下界基准，任何有意义的同时模式算法都应远胜于它；单步决策仍远低于 0.1 秒。

## 验证

- `tests/algorithms/random-sim.test.ts`：18 个单元测试，覆盖形状瞄准、治疗瞄格、AP 预算、同单位多动作、`attacksPerUnit`、投影站位、目的格去重、部署预算、炮火过滤与真实 standoff 整轮合法性。
- 真实 standoff 自博弈回归：算法返回的每个动作都喂给引擎 `queueXxxAction`，全部接受；双方提交后正常结算进入下一轮。

## 使用场景

1. **同时回合模式的性能下界**：新的同时模式算法的第一个测试对手。
2. **模式隔离冒烟**：验证「不同模式不能混用算法」的全链路校验（大厅接口、runner、评估 decide 通道、跑批发现）是否生效。
3. **同时回合规则压测**：随机计划动作覆盖各种结算路径（预测射击落空、目的格冲突、互杀等）。

## 兼容性

- **支持模式**：仅同时回合模式（simultaneous）
- **不支持模式**：标准（standard）、歼灭（annihilation）、大逃杀（royale，共享计划机制且入队校验已含炮火危险区镜像，未声明仅因未标定）
- **地图兼容性**：所有 simultaneous 模式地图（standoff、molten-throne）
- **运行环境**：Node.js ≥ 24，纯 JavaScript，无外部依赖

## 使用方式

### 通过前端添加

1. 创建对局，选择同时回合模式地图（对峙之地 / 熔池王座）
2. 点击"添加 AI"按钮，切换到"算法脚本"标签
3. 下拉菜单选择"同时随机算法"（下拉只列出当前对局模式可用的算法）
4. 点击"确定"

### 通过命令行运行

```bash
npm run dev  # 启动服务器

node algorithms/runner.mjs \
  --algorithm random-sim \
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
  -d '{"botType":"algo_random-sim"}'
```

## 一句话总结

random-sim 是同时回合模式的随机基线：每轮从所有合法计划动作（形状瞄准的攻击/治疗、移动、部署）中随机入队直到行动点用尽，随后提交——作为同时模式的性能下界基准与模式隔离的冒烟算法，不具备实战价值。
