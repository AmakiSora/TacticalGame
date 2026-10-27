// algorithms/builtin/random-sim.mjs
//
// 同时随机算法：同时回合（simultaneous）模式的随机基线。
// 每轮从所有合法计划动作中随机选一个入队；返回 null 即提交计划（end-turn）。
// 仅支持 simultaneous 模式——注册表 ALGORITHM_META 声明 modes: ['simultaneous']，
// 各入口（大厅 bot 接口 / runner / 评估 decide 通道）按此拒绝跨模式混用。
//
// 枚举层（形状瞄准、队列投影、地形寻路、炮火危险区过滤）在
// algorithms/lib/random-plan.mjs，与 random 的大逃杀路径共用同一实现；
// 本文件只保留算法入口与展示元数据。

import { decidePlanAction } from '../lib/random-plan.mjs';

/**
 * 同时随机算法主模块
 */
export default {
  name: 'random-sim',
  description: '同时回合：从所有合法计划动作中随机选择入队，随后提交',

  /**
   * 决策函数：随机选择一个合法计划动作入队；null 表示提交计划。
   * ctx.owner 由运行器/评估通道提供（同时模式没有 currentPlayerId）。
   */
  async decide(game, utils, ctx) {
    return decidePlanAction(game, utils, ctx);
  },
};
