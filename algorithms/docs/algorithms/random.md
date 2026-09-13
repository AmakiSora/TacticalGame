# random — 随机算法

> 单算法档案，遵循 `ALGORITHMS_NOTES.md` 固定模板。

## 身份与文件

| 项 | 内容 |
|---|---|
| 文件 | `algorithms/builtin/random.mjs` |
| 算法名 | `random` |
| 注册键 | `algo_random` |
| 显示名称 | 随机算法（Random） |
| 定位 | 最弱基准算法，用于对照测试和性能下界 |
| 实现日期 | 2026-09-13（v3.5.0） |
| 语言 | JavaScript (ESM) |
| 接口类型 | 策略接口（`decide`） |

## 算法原理

随机算法（Random Algorithm）是最简单的决策策略：从所有合法动作中随机选择一个执行。没有任何启发式、评估函数或搜索，完全依赖随机数生成器。

虽然随机算法在对战中表现极弱，但在算法研究和系统测试中具有重要价值：

1. **性能下界**：任何有意义的算法都应该远胜随机
2. **测试工具**：快速验证游戏规则和 API 接口
3. **基准对照**：衡量其他算法的相对强度
4. **探索多样性**：生成各种罕见的游戏状态用于测试

## 决策逻辑

每个回合开始时，收集所有合法动作并随机选择：

### 1. 收集攻击动作

遍历所有己方单位，找出可攻击的敌方目标：

```javascript
for (const unit of myUnits) {
  if (unit.hasActed) continue;
  for (const target of enemyTargets) {
    if (hexDistance(unit, target) <= unit.attackRange) {
      actions.push({ type: 'attack', unit, target });
    }
  }
}
```

### 2. 收集治疗动作

遍历所有己方支援兵，找出可治疗的受伤友军：

```javascript
for (const supporter of mySupporters) {
  if (supporter.hasActed) continue;
  for (const ally of myUnits) {
    if (ally.hp < ally.maxHp && hexDistance(supporter, ally) <= 1) {
      actions.push({ type: 'heal', supporter, target: ally });
    }
  }
}
```

### 3. 收集爆破动作

遍历所有己方重装单位，找出可爆破的相邻障碍物：

```javascript
for (const heavy of myHeavies) {
  if (heavy.hasActed) continue;
  for (const neighbor of neighbors(heavy)) {
    if (terrain[neighbor] === 'blocker') {
      actions.push({ type: 'demolish', unit: heavy, target: neighbor });
    }
  }
}
```

### 4. 收集部署动作

遍历所有部署点，找出可部署的位置和兵种：

```javascript
for (const deployPoint of myDeployPoints) {
  for (const neighbor of neighbors(deployPoint)) {
    if (isEmptyPlain(neighbor)) {
      for (const unitType of ['infantry', 'scout', 'heavy', 'ranger', 'support']) {
        if (supplies >= unitCost[unitType]) {
          actions.push({ type: 'deploy', unitType, from: deployPoint, to: neighbor });
        }
      }
    }
  }
}
```

### 5. 收集移动动作

遍历所有己方单位，找出可移动到的位置：

```javascript
for (const unit of myUnits) {
  if (unit.hasMoved) continue;
  for (const cell of reachableCells(game, unit)) {
    actions.push({ type: 'move', unit, to: cell });
  }
}
```

### 6. 随机选择

```javascript
if (actions.length === 0) {
  return null;  // 无合法动作，结束回合
}
const randomIndex = Math.floor(Math.random() * actions.length);
return actions[randomIndex];
```

## 实现细节

### 核心函数

| 函数 | 功能 | 复杂度 |
|---|---|---|
| `collectAllActions()` | 收集所有合法动作 | O(n·m + n·c) |
| `Math.random()` | 随机数生成 | O(1) |

- n = 己方单位数（通常 5-15）
- m = 敌方单位数（通常 5-15）
- c = 每个单位的可达格数（平均 10-30）

总复杂度：O(n·m + n·c) ≈ **O(n²)**

虽然收集动作的复杂度与 greedy 相同，但 random 不需要评分和排序，实际运行速度略快。

### 动作数量统计

典型游戏回合的合法动作数：

| 阶段 | 攻击 | 治疗 | 爆破 | 部署 | 移动 | 总计 |
|---|---:|---:|---:|---:|---:|---:|
| 早期（回合 1-5） | 2-5 | 0-2 | 0-1 | 5-15 | 15-40 | **20-60** |
| 中期（回合 6-15） | 5-15 | 1-5 | 0-2 | 3-10 | 30-80 | **40-110** |
| 后期（回合 16+） | 8-20 | 2-8 | 0-1 | 1-5 | 40-100 | **50-130** |

中后期合法动作数可达 100+ 个，随机算法会以相同概率选择任何一个，导致战略混乱。

### 随机数生成

使用 JavaScript 内置 `Math.random()`：

- 伪随机数生成器（PRNG）
- 周期足够长，适合游戏应用
- 不支持种子设定（无法复现对局）
- 不适合密码学用途

如需可复现的随机对局，可替换为带种子的 PRNG（如 `seedrandom` 库）。

## 性能表现

### vs 其他算法（default 地图）

| 对手 | 胜率 | 先手/后手 | 备注 |
|---|---:|---|---|
| greedy | **3.1%** (1:31) | 0:16 / 1:15 | 32 局，3.5.0 实测 |
| mcts | **0%** (0:12) | 0:6 / 0:6 | 12 局，3.5.1 实测 |

**分析**：
- 对 greedy 仅赢 1 局（3.1%），几乎全败
- 对 mcts 12 局全败：终局评分约 3200 vs 500，多数为回合上限评分碾压、部分被歼灭

### vs RL 模型（random 地图，48 局配对换座）

| 对手 | 胜率 | 先手/后手 | Wilson 下界 |
|---|---:|---|---:|
| v2.7.0 | **4.2%** (2:46) | 1:23 / 1:23 | 1.1% |
| v3.0.2 (champion) | **2.1%** (1:47) | 1:23 / 0:24 | 0.3% |

**分析**：
- 对 v2.7.0 胜率 4.2%，48 局仅赢 2 局
- 对 v3.0.2 胜率 2.1%，48 局仅赢 1 局
- Wilson 下界接近 0%，统计意义上接近必败

**胜局分析**：
- 仅有的几次胜利可能源于：
  - RL 模型的罕见失误
  - 随机算法恰好做出关键正确决策
  - 地图布局对随机策略有利
- 不具备可重复性，纯属偶然

### 典型失误模式

random 算法常见的致命错误：

1. **资源浪费**：有敌人可攻击时选择移动或部署
2. **送人头**：把单位移动到敌方射程内
3. **过度部署**：耗光资源部署新单位，老单位无法发挥
4. **错失击杀**：能秒杀敌方单位时选择治疗友军
5. **不占据点**：忽略据点的战略价值
6. **自杀冲锋**：低血单位冲向敌方总部送死

## 决策时间

| 场景 | 耗时 |
|---|---:|
| 早期（单位 < 5） | 0.02-0.04 秒 |
| 中期（单位 5-10） | 0.04-0.07 秒 |
| 后期（单位 > 10） | 0.07-0.12 秒 |

平均每个决策耗时 **< 0.1 秒**，与 greedy 相当，远快于 MCTS。

## 使用场景

random 算法虽然极弱，但在以下场景中非常有用：

### 1. 性能基准

任何新算法的第一个测试对手：

```bash
# 测试新算法 my_algo
node algorithms/runner.mjs --algorithm my_algo --side a &
node algorithms/runner.mjs --algorithm random --side b &
```

如果新算法对 random 胜率 < 80%，说明基础逻辑有严重问题。

### 2. 接口测试

快速生成各种游戏状态，测试 API 和规则引擎：

- 随机攻击：测试伤害计算
- 随机治疗：测试血量上限
- 随机移动：测试路径规划
- 随机部署：测试资源扣除

### 3. 边界探索

random 会尝试各种罕见操作，发现边界 bug：

- 空血治疗
- 重复部署
- 无效移动
- 越界攻击

### 4. 压力测试

多个 random AI 同时对战，测试服务器并发性能：

```bash
for i in {a..h}; do
  node algorithms/runner.mjs --algorithm random --side player_$i &
done
```

## 改进方向

random 算法本身不应该"改进"——它的价值就在于简单和弱小。但可以衍生出以下变体：

### 加权随机

给不同动作类型赋予权重：

```javascript
const weights = {
  attack: 5,    // 攻击概率 × 5
  heal: 3,      // 治疗概率 × 3
  deploy: 2,    // 部署概率 × 2
  move: 1,      // 移动概率 × 1
  demolish: 1   // 爆破概率 × 1
};
```

这样可以避免过度移动和部署，略微提升性能。

### 过滤随机

排除明显愚蠢的动作：

- 不把低血单位移动到敌方射程内
- 不在能击杀敌人时选择其他动作
- 不在资源不足时过度部署

这样可以把胜率从 3% 提升到 10-15%，但仍远不及 greedy。

### 记忆随机

记录过去 N 回合的动作，避免重复：

```javascript
const recentActions = new Set();
const validActions = allActions.filter(a => !recentActions.has(hash(a)));
```

这样可以避免"原地踏步"，但实战效果有限。

## 兼容性

- **支持模式**：仅标准模式（standard）
- **不支持模式**：歼灭模式（annihilation）、同时回合模式（simultaneous）
- **地图兼容性**：所有标准模式地图（default、random、dual-lanes、desert 等）
- **运行环境**：Node.js ≥ 24，纯 JavaScript，无外部依赖

## 使用方式

### 通过前端添加

1. 创建对局，选择标准模式地图
2. 点击"添加 AI"按钮
3. 切换到"算法脚本"标签
4. 下拉菜单选择"随机算法（Random）"
5. 点击"确定"

### 通过命令行运行

```bash
npm run dev  # 启动服务器

# 另一个终端
node algorithms/runner.mjs \
  --algorithm random \
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
  -d '{"botType":"algo_random"}'
```

## 代码结构

```javascript
// 收集所有合法动作
function collectAllActions(game, owner, utils) {
  const actions = [];
  
  // 攻击动作
  for (const unit of myUnits) { ... }
  
  // 治疗动作
  for (const supporter of supporters) { ... }
  
  // 爆破动作
  for (const heavy of heavies) { ... }
  
  // 部署动作
  for (const deployPoint of deployPoints) { ... }
  
  // 移动动作
  for (const unit of myUnits) { ... }
  
  return actions;
}

// 导出接口
export default {
  name: 'random',
  description: '从所有合法动作中随机选择',
  
  async decide(game, utils) {
    const actions = collectAllActions(game, owner, utils);
    if (actions.length === 0) return null;
    
    const index = Math.floor(Math.random() * actions.length);
    return actions[index];
  }
}
```

完整源码见 `algorithms/builtin/random.mjs`（约 140 行）。

## 一句话总结

random 算法从所有合法动作中随机选择（耗时 < 0.1 秒），对任何有意义的算法胜率都 < 5%（对 greedy 3.1%、对 mcts 0%、对 v2.7.0 4.2%），仅作为性能下界基准、接口测试工具和边界探索手段，不具备任何实战价值但在算法研究中不可或缺。
