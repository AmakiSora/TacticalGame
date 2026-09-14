// algorithms/builtin/mcts.mjs
//
// 蒙特卡洛树搜索（MCTS）算法
// 通过模拟推演评估动作价值，选择最优动作
// 注意：utils.enemyTargets 等目标结构为 { kind: 'unit' | 'headquarters', entity }

/**
 * MCTS 节点
 */
class MCTSNode {
  constructor(state, parent = null, action = null) {
    this.state = state;
    this.parent = parent;
    this.action = action;
    this.children = [];
    this.visits = 0;
    this.value = 0;
    this.untriedActions = null;
  }

  /** UCB1 选择公式 */
  ucb1(explorationConstant = 1.414) {
    if (this.visits === 0) return Infinity;
    return this.value / this.visits + explorationConstant * Math.sqrt(Math.log(this.parent.visits) / this.visits);
  }

  /** 选择最佳子节点（UCB1） */
  selectChild() {
    return this.children.reduce((best, child) =>
      child.ucb1() > best.ucb1() ? child : best
    );
  }

  /** 是否完全展开 */
  isFullyExpanded() {
    return this.untriedActions !== null && this.untriedActions.length === 0;
  }

  /** 是否叶子节点 */
  isLeaf() {
    return this.children.length === 0;
  }
}

/**
 * MCTS 算法主类
 */
class MCTS {
  constructor(game, owner, utils, config = {}) {
    this.game = game;
    this.owner = owner;
    this.utils = utils;
    this.iterationLimit = config.iterationLimit || 100;
    this.explorationConstant = config.explorationConstant || 1.414;
    this.maxDepth = config.maxDepth || 8;
  }

  /** 运行 MCTS 搜索 */
  search() {
    const root = new MCTSNode(this.cloneState(this.game));
    root.untriedActions = this.collectActions(root.state, this.owner);

    for (let i = 0; i < this.iterationLimit; i++) {
      let node = root;

      // 1. Selection: 选择到叶子节点
      while (!node.isLeaf() && node.isFullyExpanded()) {
        node = node.selectChild();
      }

      // 2. Expansion: 扩展一个新节点（applyAction 内部克隆，不污染 node.state）
      if (!node.isFullyExpanded() && node.untriedActions.length > 0) {
        const action = node.untriedActions.pop();
        const newState = this.applyAction(node.state, action);
        const child = new MCTSNode(newState, node, action);
        child.untriedActions = this.collectActions(newState, this.owner);
        node.children.push(child);
        node = child;
      }

      // 3. Simulation: 模拟到终局
      const reward = this.simulate(node.state, 0);

      // 4. Backpropagation: 回传结果
      while (node !== null) {
        node.visits++;
        node.value += reward;
        node = node.parent;
      }
    }

    // 返回访问次数最多的动作
    if (root.children.length === 0) return null;
    const bestChild = root.children.reduce((best, child) =>
      child.visits > best.visits ? child : best
    );
    return bestChild.action;
  }

  /** 收集所有可行动作 */
  collectActions(state, owner) {
    const actions = [];
    const myUnits = this.utils.livingUnits(state, owner);
    const targets = this.utils.enemyTargets(state, owner);
    // 行动点预算：未激活的单位没有预算就不能产出需耗点的动作（否则引擎回 action_limit_reached）
    const budget = this.utils.actionsRemaining(state);
    const affordable = u => u.actionSpent || budget > 0;

    // 攻击动作
    for (const unit of myUnits) {
      if (unit.hasActed || !affordable(unit)) continue;
      for (const target of targets) {
        const dist = this.utils.hexDistance(unit, target.entity);
        if (dist <= unit.attackRange) {
          actions.push({
            type: 'attack',
            payload: { attackerId: unit.id, targetId: target.entity.id },
            priority: target.kind === 'headquarters' ? 3 : (target.entity.hp < 40 ? 2 : 1),
          });
        }
      }
    }

    // 治疗动作（治疗距离与引擎一致：优先取 config 的 healRange）
    for (const unit of myUnits) {
      if (unit.hasActed || unit.type !== 'support' || !affordable(unit)) continue;
      const healRange = state.config?.units?.[unit.type]?.healRange ?? unit.attackRange;
      for (const ally of myUnits) {
        if (ally.hp >= ally.maxHp) continue;
        const dist = this.utils.hexDistance(unit, ally);
        if (dist <= healRange) {
          actions.push({
            type: 'heal',
            payload: { supportId: unit.id, targetId: ally.id },
            priority: 1.5,
          });
        }
      }
    }

    // 移动动作（目标导向采样：可占领据点优先，其余位置偏向 movementGoal）
    const moveUnits = myUnits.filter(u => !u.hasMoved && !u.hasActed && affordable(u)).slice(0, 3);
    for (const unit of moveUnits) {
      const reachable = this.utils.reachableCells(state, unit);
      if (reachable.length === 0) continue;
      const used = new Set();

      if (unit.canCapture) {
        const capture = reachable.find(p =>
          (state.controlPoints || []).some(cp => cp.q === p.q && cp.r === p.r && cp.owner !== owner)
        );
        if (capture) {
          used.add(`${capture.q},${capture.r}`);
          actions.push({
            type: 'move',
            payload: { unitId: unit.id, q: capture.q, r: capture.r },
            priority: 1.2,
          });
        }
      }

      const goal = this.utils.movementGoal(state, owner, unit);
      const toward = reachable
        .filter(p => !used.has(`${p.q},${p.r}`))
        .sort((a, b) => this.utils.hexDistance(a, goal) - this.utils.hexDistance(b, goal))
        .slice(0, 2);
      for (const p of toward) {
        actions.push({
          type: 'move',
          payload: { unitId: unit.id, q: p.q, r: p.r },
          priority: 0.5,
        });
      }
    }

    // 按优先级排序并限制数量
    actions.sort((a, b) => b.priority - a.priority);
    return actions.slice(0, 20);
  }

  /** 应用动作到状态（简化模拟） */
  applyAction(state, action) {
    const newState = this.cloneState(state);

    if (action.type === 'attack') {
      const attacker = newState.units.find(u => u.id === action.payload.attackerId);
      let target = newState.units.find(u => u.id === action.payload.targetId);
      const isHeadquarters = !target;
      if (!target) {
        target = Object.values(newState.headquarters)
          .find(hq => hq.id === action.payload.targetId);
      }

      if (attacker && target) {
        attacker.hasActed = true;
        const damage = Math.max(1, attacker.attack - (target.defense || 0));
        target.hp -= damage;
        if (target.hp <= 0) {
          target.alive = false;
          if (!isHeadquarters) {
            newState.units = newState.units.filter(u => u.id !== target.id);
          }
        }
      }
    } else if (action.type === 'heal') {
      const supporter = newState.units.find(u => u.id === action.payload.supportId);
      const target = newState.units.find(u => u.id === action.payload.targetId);

      if (supporter && target) {
        supporter.hasActed = true;
        // 引擎实际治疗量为 healPower + 随机浮动，模拟取基准值
        const amount = supporter.healPower ?? 20;
        target.hp = Math.min(target.maxHp, target.hp + amount);
      }
    } else if (action.type === 'move') {
      const unit = newState.units.find(u => u.id === action.payload.unitId);
      if (unit) {
        unit.q = action.payload.q;
        unit.r = action.payload.r;
        unit.hasMoved = true;
        // 引擎在单位停留时自动占领据点，模拟同步以保持评估信号有效
        if (unit.canCapture) {
          const cp = (newState.controlPoints || [])
            .find(cp => cp.q === unit.q && cp.r === unit.r && cp.owner !== this.owner);
          if (cp) cp.owner = this.owner;
        }
      }
    }

    return newState;
  }

  /** 模拟到终局（轻量级评估） */
  simulate(state, depth) {
    if (depth >= this.maxDepth) {
      return this.evaluate(state);
    }

    const actions = this.collectActions(state, this.owner).slice(0, 3);
    if (actions.length === 0) {
      return this.evaluate(state);
    }

    const randomAction = actions[Math.floor(Math.random() * actions.length)];
    const newState = this.applyAction(state, randomAction);
    return this.simulate(newState, depth + 1);
  }

  /** 评估状态分数 */
  evaluate(state) {
    let score = 0;

    // 我方单位价值（扁平成本：击杀敌人 = 移除其全部价值，天然鼓励集火补刀；
    // 实测按血量折价会把收益转移到刮痧，胜率反而下降，故不采用）
    const myUnits = this.utils.livingUnits(state, this.owner);
    score += myUnits.reduce((sum, u) => sum + (u.cost || 50), 0);

    // 我方总部：存活按血量计分，阵亡判大负分
    const myHQ = state.headquarters?.[this.owner];
    if (myHQ) {
      score += myHQ.alive === false ? -10000 : myHQ.hp * 2;
    }

    // 我方据点：收入与部署点的长期价值
    const ownedCps = (state.controlPoints || []).filter(cp => cp.owner === this.owner).length;
    score += ownedCps * 60;

    // 敌方存活单位是负资产（击杀即收益），规模随对局人数自适应
    for (const seat of this.utils.enemySeats(state, this.owner)) {
      for (const u of this.utils.livingUnits(state, seat)) {
        score -= u.cost || 50;
      }
    }

    // 敌方总部：按已造成伤害计分，阵亡判大正分
    for (const hq of Object.values(state.headquarters || {})) {
      if (!hq || hq.owner === this.owner) continue;
      score += hq.alive === false ? 10000 : (hq.maxHp - hq.hp) * 3;
    }

    return score;
  }

  /** 克隆状态（headquarters / controlPoints 必须逐个拷贝，模拟中的扣血与占领不能泄漏到真实状态） */
  cloneState(state) {
    const headquarters = {};
    for (const [id, hq] of Object.entries(state.headquarters || {})) {
      headquarters[id] = { ...hq };
    }
    return {
      ...state,
      units: state.units.map(u => ({ ...u })),
      headquarters,
      controlPoints: (state.controlPoints || []).map(cp => ({ ...cp })),
    };
  }
}

/**
 * 部署决策：MCTS 的动作空间不含 deploy，由 decide 入口先行判断。
 * 具体候选走 game-utils 的公共实现（与 threat 共用，避免两份拷贝各自漂移）。
 */
/**
 * 回退移动：MCTS 动作采样未覆盖到（如可动单位超出前 3 个名额）时，
 * 用贪心方式移动一个单位，避免还有可动单位却提前结束回合
 */
function fallbackMove(game, owner, utils) {
  const myUnits = utils.livingUnits(game, owner);
  const occupied = new Set(myUnits.map(u => `${u.q},${u.r}`));

  const budget = utils.actionsRemaining(game);
  for (const unit of myUnits.filter(u => !u.hasMoved && !u.hasActed && (u.actionSpent || budget > 0))) {
    const reachable = utils.reachableCells(game, unit)
      .filter(p => !occupied.has(`${p.q},${p.r}`));
    if (reachable.length === 0) continue;

    const goal = utils.movementGoal(game, owner, unit);
    const currentDist = utils.hexDistance(unit, goal);
    const best = reachable
      .map(p => ({ p, dist: utils.hexDistance(p, goal) }))
      .sort((a, b) => a.dist - b.dist)[0];

    if (best && best.dist < currentDist) {
      return {
        type: 'move',
        payload: { unitId: unit.id, q: best.p.q, r: best.p.r },
      };
    }
  }

  return null;
}

/**
 * 算法导出接口
 */
export default {
  name: 'mcts',
  description: '蒙特卡洛树搜索：通过模拟推演选择最优动作',

  async decide(game, utils) {
    const owner = game.turn?.currentPlayerId || game.turn?.currentOwner;
    if (!owner) return null;

    // 部署先行：MCTS 动作空间不含 deploy
    const deploy = utils.deployDecision(game, owner);
    if (deploy) return deploy;

    // 如果没有可操作单位，结束回合
    const myUnits = utils.livingUnits(game, owner);
    const hasActions = myUnits.some(u => !u.hasActed || !u.hasMoved);
    if (!hasActions) return null;

    // 运行 MCTS 搜索
    const mcts = new MCTS(game, owner, utils, {
      iterationLimit: 100,  // 每个决策100次模拟
      explorationConstant: 1.414,
      maxDepth: 8,
    });

    const action = mcts.search();
    return action || fallbackMove(game, owner, utils);
  },
};
