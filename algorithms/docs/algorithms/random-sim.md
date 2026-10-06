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
| 实现日期 | 2026-10-06（v3.5.12） |
| 语言 | JavaScript (ESM) |
| 接口类型 | 策略接口（`decide`） |
| 支持模式 | 仅同时回合（simultaneous） |

## 算法原理

与标准模式的 random 同宗：每轮从所有合法**计划动作**中随机选一个入队，返回 null 即提交计划（end-turn）。没有任何启发式或评估函数。

同时回合模式的动作语义与标准模式根本不同（详见 `skill/simultaneous.md`），算法按此适配：

1. **动作入队而非立即执行**：服务器返回 `{ ok, queued, queue }`，结算在全员提交后统一发生。
2. **攻/治瞄准格子而非目标 id**：`{ attackerId, q, r }` / `{ supportId, q, r }`，命中结算时落在覆盖形状上的单位——预测射击。
3. **一单位一轮一动作**：同一单位再排队会被 `invalid_*` 拒绝。
4. **队列长度即行动点**：上限 `config.balance.actionsPerTurn`，读 `game.plan.myQueue` 计数（`turn.actionsUsed` 在本模式不按座位维护）。
5. **座位从 `ctx.owner` 拿**：同时模式 `turn.currentPlayerId` 恒为 null。

## 决策逻辑

每次 decide 调用：

### 0. 前置短路

- 无 `ctx.owner` 或无 `game.plan` → null；
- `plan.committed` 已含己方 → null（等结算）；
- `plan.myQueue.length >= actionsPerTurn` → null（预算用尽）。

### 1. 枚举攻击（按形状瞄准）

按 `config.units.<type>.attackShape` 镜像引擎 `coveredCellsFor` 的瞄准合法性：

| 形状 | 可瞄准条件（目标当前格） |
|---|---|
| single / 缺省（含 ranger 锁定射） | 0 < 距离 ≤ attackRange |
| line | 目标落在 6 向射线上且 1 ≤ 距离 ≤ length |
| arc | 目标相邻（距离 1，点击其格即被覆盖） |

目标集为 `utils.enemyTargets`（敌方单位 + 总部）。

### 2. 枚举治疗

支援兵（support）按 `healShape`（缺省 single）瞄准**受伤**友方所在格：single 允许本格（自治），射程取 `healRange ?? attackRange`；arc 仅相邻格。入队校验要求覆盖格至少有一个存活友方，瞄准受伤友方的格子必然满足。镜像炮火校验：施放者站在缩圈炮火危险区、或任一覆盖格（arc 为瞄准方向扇形三格）落在危险区的治疗不入队（引擎拒绝 `invalid_heal`）；simultaneous 无炮火机制（`game.artillery` 恒为 null），该过滤恒通过。

### 3. 枚举移动

`utils.reachableCells`（计划期棋盘，敌我单位皆为障碍）排除己方队列已认领的目的格。

### 4. 枚举部署

`utils.deployOrigins`（总部 + 己方可部署据点，`canDeploy: false` 的类型已排除）× `config.units` 全兵种 × 相邻空平地；补给预算扣减队列中已计划部署的花费（`effectiveDeployCost` 含据点折扣）。出生点或落点在炮火危险区内的部署不入队（引擎拒绝 `invalid_deploy`，同治疗一节仅歼灭轴模式生效）。

### 5. 随机选择

```javascript
if (allActions.length === 0) return null;  // 无合法计划动作，直接提交
return allActions[Math.floor(Math.random() * allActions.length)];
```

## 实现细节

- **不依赖服务器拒绝来发现非法动作**：所有枚举都镜像 `src/engine/planning.ts` 的入队校验（形状瞄准、一单位一动作、目的格认领、部署预算扣减、炮火危险区）。被拒动作虽不再让 `runAlgorithm` 提前提交整轮计划（它会把被拒动作记住、让 decide 重选，有重问上限），但每次被拒仍空耗一次重问配额与一次请求往返，合法镜像才能保证一轮行动计划排满排快。
- **回归测试保证枚举口径与引擎一致**：`tests/algorithms/random-sim.test.ts` 在真实 standoff 对局上把算法返回的每个动作喂给引擎 `queueXxxAction`，全部接受才算通过。
- 总复杂度 O(n·m + n·c)，与标准 random 相同，单步决策远低于 0.1 秒。

## 性能表现

未标定。作为同时回合模式的性能下界基准，任何有意义的同时模式算法都应远胜于它。

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
