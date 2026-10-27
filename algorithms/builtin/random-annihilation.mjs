// algorithms/builtin/random-annihilation.mjs
//
// 歼灭随机算法：歼灭模式（逐人轮流 + 炮火缩圈）的随机基线。
//
// 与标准模式的 random 共用轮流枚举（algorithms/lib/random-turn.mjs），差别是
// 按引擎口径过滤炮火危险区：危险区内的部署（起点/落点）与治疗（支援兵/目标）
// 不进候选——引擎会拒绝这些动作，而 runner 在轮流模式收到拒绝会提前结束整个
// 回合（见 algorithms/lib/interfaces.mjs）。走进危险区仍然合法（伤害只在轮界
// 结算），随机基线不做避险优化。
//
// 注册为独立条目 random-annihilation（展示名「歼灭随机算法」、参与者 id
// `algo_random-annihilation@v1`），与 standard 的 random 分开记战绩。

import { decideImmediateAction } from '../lib/random-turn.mjs';

/**
 * 歼灭随机算法主模块
 */
export default {
  name: 'random-annihilation',
  description: '歼灭：从所有合法动作中随机选择，跳过炮火危险区内的部署与治疗',

  /**
   * 决策函数：随机选择一个合法动作；null 表示结束回合。
   */
  async decide(game, utils) {
    return decideImmediateAction(game, utils);
  },
};
