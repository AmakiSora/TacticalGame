# 算法开发指南

本目录包含用于 TacticalGame 的算法 AI 实现。算法通过 REST API 与游戏服务器交互，可以手动运行或由服务器自动管理。

## 快速开始

### 运行现有算法

```bash
# 启动游戏服务器
npm run dev

# 在浏览器中创建标准模式游戏，获取 gameId 和 playerToken

# 运行贪心算法
node algorithms/runner.mjs \
  --algorithm greedy \
  --url http://localhost:3100 \
  --game <gameId> \
  --token <playerToken> \
  --side player_a
```

### 可用算法

- **greedy** - 贪心算法：攻击 > 治疗 > 爆破 > 部署 > 移动
- **random** - 随机算法：从所有合法动作中随机选择
- **mcts** - 蒙特卡洛树搜索：模拟推演选择最优动作
- **threat** - 威胁感知算法：威胁图统一效用评估，集火斩杀、避险走位
- **field** - 势场算法：斥力井（敌方火力）+ 引力井（据点/总部）+ 波前距离场，风筝走位、分头抢点
- **verdict** - 裁决线算法：按引擎裁决权重选"用哪条线赢"（斩首/磨平/裁定），再从终局倒推攻城排程与期限

## 编写自定义算法

### 两种接口

算法可以使用两种接口之一（或同时实现两者，但只有 `playTurn` 会被使用）：

#### 1. 策略接口（推荐）

适合新手和简单算法。每次调用返回一个动作，框架负责执行并刷新状态。

```javascript
// algorithms/builtin/my-algorithm.mjs
export default {
  name: 'my-algorithm',
  description: '我的自定义算法',

  /**
   * 决策函数：返回下一个动作或 null（结束回合）
   * @param {object} game - 完整的游戏状态
   * @param {object} utils - 游戏工具函数（见下文）
   * @returns {object|null} 动作对象或 null
   */
  async decide(game, utils) {
    const owner = game.turn.currentPlayerId;

    // 示例：攻击射程内的第一个敌人
    const myUnits = utils.livingUnits(game, owner);
    for (const unit of myUnits) {
      if (unit.hasActed) continue;
      const target = utils.bestAttackTarget(game, owner, unit);
      if (target) {
        return {
          type: 'attack',
          payload: {
            attackerId: unit.id,
            targetId: target.entity.id,
          },
        };
      }
    }

    // 没有可用动作，结束回合
    return null;
  }
};
```

**动作格式**：

```javascript
// 攻击
{ type: 'attack', payload: { attackerId: 'u_123', targetId: 'u_456' } }

// 移动
{ type: 'move', payload: { unitId: 'u_123', q: 5, r: -3 } }

// 部署
{ type: 'deploy', payload: { unitType: 'infantry', fromId: 'hq_a', q: 1, r: 0 } }

// 治疗
{ type: 'heal', payload: { supportId: 'u_123', targetId: 'u_456' } }

// 爆破
{ type: 'demolish', payload: { unitId: 'u_123', q: 2, r: 1 } }
```

#### 2. 完整控制接口

适合需要精细控制回合流程的复杂算法（如 MCTS、minimax）。

```javascript
export default {
  name: 'advanced',
  description: '高级算法：完整回合控制',

  /**
   * 回合控制函数：自己负责整个回合的执行
   * @param {object} game - 当前游戏状态
   * @param {GameApiClient} apiClient - API 客户端
   * @param {object} utils - 游戏工具函数
   */
  async playTurn(game, apiClient, utils) {
    const owner = game.turn.currentPlayerId;

    // 自定义逻辑...
    let state = game;

    // 示例：执行多个动作
    const myUnits = utils.livingUnits(state, owner);
    for (const unit of myUnits) {
      const target = utils.bestAttackTarget(state, owner, unit);
      if (target) {
        await apiClient.attack(unit.id, target.entity.id);
        state = await apiClient.getState(); // 手动刷新状态
      }
    }

    // 必须自己调用 endTurn
    await apiClient.endTurn();
  }
};
```

### 可用的工具函数

`utils` 对象包含以下函数（来自 `algorithms/lib/game-utils.mjs`）：

#### 几何和寻路
- `hexDistance(a, b)` - 六边形距离
- `neighbors(pos)` - 获取相邻格子
- `isPlayable(game, pos)` - 格子是否在可玩区域
- `terrainAt(game, pos)` - 获取地形类型
- `occupantAt(game, pos)` - 获取格子上的单位或总部
- `isEmptyPlain(game, pos)` - 是否为空平地
- `reachableCells(game, unit)` - BFS 寻路，返回单位可到达的格子

#### 单位和玩家
- `livingUnits(game, owner)` - 获取存活单位
- `activeSeats(game)` - 获取活跃玩家席位
- `enemySeats(game, owner)` - 获取敌方席位

#### 目标评估
- `scoreTarget(target)` - 评分目标优先级
- `enemyTargets(game, owner)` - 获取所有敌方目标（单位+总部）
- `bestAttackTarget(game, owner, unit)` - 找到最佳攻击目标
- `nearestEnemyHeadquarters(game, owner, from)` - 最近的敌方总部

#### 据点
- `controlPriority(game, cp)` - 据点优先级
- `cpKindEffect(game, point)` - 据点类型效果
- `movementGoal(game, owner, unit)` - 计算单位移动目标

#### 部署
- `deployOrigins(game, owner)` - 可部署位置（总部+据点）
- `effectiveDeployCost(game, type, origin)` - 实际部署费用（含折扣）

#### 其他
- `actionsRemaining(game)` - 剩余行动点
- `deployDecision(game, owner)` - 部署候选动作（触发条件+稀缺兵种+就近部署源），threat/mcts 共用

### API 客户端方法

当使用完整控制接口时，可用的 `apiClient` 方法：

```javascript
await apiClient.getState()
await apiClient.attack(attackerId, targetId)
await apiClient.move(unitId, q, r)
await apiClient.deploy(unitType, fromId, q, r)
await apiClient.heal(supportId, targetId)
await apiClient.demolish(unitId, q, r)
await apiClient.endTurn()
```

所有方法自动处理 429 限流重试。

### 游戏状态结构

`game` 对象包含完整的游戏状态，关键字段：

```javascript
{
  phase: 'active' | 'lobby' | 'game_over',
  winner: null | 'player_a' | ...,
  config: {
    mode: 'standard',
    units: { infantry: {...}, ... },
    balance: { actionsPerTurn: 5, ... }
  },
  turn: {
    currentPlayerId: 'player_a',
    turnNumber: 5,
    actionsUsed: 2
  },
  units: [
    {
      id: 'u_123',
      owner: 'player_a',
      type: 'infantry',
      q: 1, r: 0,
      hp: 80, maxHp: 100,
      alive: true,
      hasMoved: false,
      hasActed: false,
      actionSpent: false,
      moveRange: 3,
      attackRange: 1,
      canCapture: true
    }
  ],
  headquarters: {
    player_a: { id: 'hq_a', owner: 'player_a', q: -5, r: 0, hp: 180, alive: true }
  },
  controlPoints: [
    { id: 'cp_1', name: '中央', q: 0, r: 0, owner: null, kind: 'supply' }
  ],
  resources: {
    player_a: { supplies: 120 }
  },
  cells: [ { q: 0, r: 0, terrain: 'plain' }, ... ],
  map: { ... }
}
```

## 注册算法

编写完算法后，在 `algorithms/registry.mjs` 中注册：

```javascript
export const ALGORITHMS = {
  greedy: './builtin/greedy.mjs',
  random: './builtin/random.mjs',
  'my-algorithm': './builtin/my-algorithm.mjs', // 添加这一行
};
```

然后就可以运行：

```bash
node algorithms/runner.mjs --algorithm my-algorithm ...
```

## 最佳实践

1. **使用策略接口**：除非需要精细控制，否则使用 `decide()` 接口更简单
2. **复用工具函数**：`utils` 提供了大量经过测试的工具函数
3. **错误处理**：框架会自动捕获错误并尝试 end-turn
4. **性能**：决策应在 1 秒内完成，避免阻塞游戏
5. **测试**：先用 `--once` 模式测试单回合，再运行完整对局

## 参考资料

- `scripts/auto-standard-game.mjs` - 完整的决策逻辑参考
- `skill/standard.md` - 标准模式规则和决策优先级
- `README.md` - 游戏规则和 API 文档

## 示例：完整控制接口的 MCTS 算法框架

```javascript
export default {
  name: 'mcts',
  description: 'Monte Carlo Tree Search',

  async playTurn(game, apiClient, utils) {
    const owner = game.turn.currentPlayerId;

    // 1. 构建搜索树（模拟游戏状态）
    const root = buildTree(game, owner, utils);

    // 2. MCTS 主循环
    for (let i = 0; i < 1000; i++) {
      const node = select(root);
      const result = simulate(node);
      backpropagate(node, result);
    }

    // 3. 选择最佳动作序列
    const actions = bestPath(root);

    // 4. 执行动作序列
    for (const action of actions) {
      try {
        if (action.type === 'attack') {
          await apiClient.attack(action.payload.attackerId, action.payload.targetId);
        } else if (action.type === 'move') {
          await apiClient.move(action.payload.unitId, action.payload.q, action.payload.r);
        }
        // ... 其他动作类型
      } catch (error) {
        console.error(`Action failed: ${error.message}`);
        break;
      }
    }

    // 5. 结束回合
    await apiClient.endTurn();
  }
};

function buildTree(game, owner, utils) { /* ... */ }
function select(node) { /* ... */ }
function simulate(node) { /* ... */ }
function backpropagate(node, result) { /* ... */ }
function bestPath(root) { /* ... */ }
```
