// algorithms/builtin/random-royale.mjs
//
// 大逃杀随机算法：royale 模式（同时回合 × 歼灭）的随机基线。
// 每轮从所有合法计划动作中随机选一个入队；返回 null 即提交计划（end-turn）。
//
// 大逃杀是同时回合语义：动作入队而非立即执行，攻/治瞄准格子，座位由
// ctx.owner 提供。枚举层与同时随机算法 random-sim 共用
// algorithms/lib/random-plan.mjs（形状瞄准、队列前缀投影、地形寻路、
// attacksPerUnit、炮火危险区过滤），不另写一套镜像。
//
// 注册为独立条目 random-royale（展示名「大逃杀随机算法」、参与者 id
// `algo_random-royale@v1`），与 simultaneous 的 random-sim 分开记战绩。

import { decidePlanAction } from '../lib/random-plan.mjs';

/**
 * 大逃杀随机算法主模块
 */
export default {
  name: 'random-royale',
  description: '大逃杀：从所有合法计划动作中随机选择入队，随后提交',

  /**
   * 决策函数：随机选择一个合法计划动作入队；null 表示提交计划。
   */
  async decide(game, utils, ctx) {
    return decidePlanAction(game, utils, ctx);
  },
};
