// algorithms/builtin/random.mjs
//
// 随机算法：标准模式（逐人轮流）的随机基线，从所有合法动作中均匀随机选择一个
// 立即执行，`null` 即结束回合。
//
// 歼灭模式见 algorithms/builtin/random-annihilation.mjs（同一轮流枚举器 + 炮火区
// 过滤），大逃杀见 algorithms/builtin/random-royale.mjs（同时回合计划队列）。
// 三者是独立注册的算法条目：注册名、展示名、版本与竞技场参与者 id 各自独立，
// 战绩不会混名。

import { decideImmediateAction } from '../lib/random-turn.mjs';

/**
 * 随机算法主模块
 */
export default {
  name: 'random',
  description: '随机算法：从所有合法动作中随机选择',

  /**
   * 决策函数：随机选择一个合法动作；null 表示结束回合。
   */
  async decide(game, utils) {
    return decideImmediateAction(game, utils);
  },
};
