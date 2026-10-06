// algorithms/lib/interfaces.mjs
//
// 算法接口适配器：统一处理策略接口和完整控制接口

// 与 src/types.ts 的 isSimultaneousMode 同口径：simultaneous 与 royale 共享
// 计划/提交机制（本文件是纯 JS，不能直接 import TS 源码）。
function isSimultaneousMode(mode) {
  return mode === 'simultaneous' || mode === 'royale';
}

/** 动作指纹：同型同参视为同一动作（payload 由算法构造，键序稳定）。 */
function actionKey(action) {
  return JSON.stringify({ type: action.type, payload: action.payload ?? {} });
}

/**
 * 运行算法并执行一个完整回合
 *
 * 逐人轮流（standard）模式：循环 decide 逐动作执行，null 后 endTurn 结束回合。
 * 同时回合（simultaneous/royale）模式：循环 decide 逐个把动作**入队**（服务器
 * 返回 queued 而非执行结果），null 后 endTurn 即提交计划；攻/治动作按 payload
 * 形态分发——带 q/r 走瞄准格子变体（attackCell/healCell），带 targetId 走原接口。
 *
 * 动作被服务器拒绝（非 429）时两种模式分道：轮流模式沿用既有行为，立即跳出
 * 循环结束回合；同时模式下被拒动作只是未入队、局面未变，endTurn 却等于提交
 * 并锁定计划——直接 break 会把剩余行动点和已排队列一次作废。因此记住被拒
 * 动作、刷新状态后继续让 decide 重选（重问/被拒有上限兜底），直到算法交出
 * null 或行动点用尽才提交。
 *
 * @param {object} algorithm - 算法模块（必须实现 decide 或 playTurn）
 * @param {object} gameState - 当前游戏状态
 * @param {GameApiClient} apiClient - API 客户端
 * @param {object} utils - 游戏工具函数集合
 * @param {object} [ctx] - 调用上下文；ctx.owner 为算法座位（同时模式没有
 *   currentPlayerId，算法只能从这里拿到自己的座位）
 * @returns {Promise<void>}
 */
export async function runAlgorithm(algorithm, gameState, apiClient, utils, ctx = {}) {
  // 完整控制接口：算法自己管理整个回合
  if (typeof algorithm.playTurn === 'function') {
    await algorithm.playTurn(gameState, apiClient, utils);
    return;
  }

  // 策略接口：循环调用 decide 直到返回 null
  if (typeof algorithm.decide === 'function') {
    let state = gameState;
    let actionCount = 0;
    const MAX_ACTIONS = 100; // 防止无限循环
    // 同时模式被拒动作的重问/被拒上限：超过说明算法的合法性镜像偏差过大，
    // 带着已排计划提交，别在重选里打转。
    const MAX_REJECTIONS = 20;
    const simultaneous = isSimultaneousMode(state.config?.mode);
    const rejected = new Set();
    let rejectedCount = 0;

    while (actionCount < MAX_ACTIONS && rejectedCount < MAX_REJECTIONS) {
      const action = await algorithm.decide(state, utils, ctx);

      // null 表示应该结束回合（同时模式 = 提交计划）
      if (!action) {
        break;
      }

      // 同时模式：decide 又给出刚被拒绝的动作，不重复请求服务器，计入重问
      // 后让它重新选（random 类算法会换一个，确定性算法重问到上限）。
      if (simultaneous && rejected.has(actionKey(action))) {
        rejectedCount++;
        continue;
      }

      // 验证动作格式
      if (!action.type || typeof action.type !== 'string') {
        throw new Error(`Invalid action from decide(): missing or invalid 'type' field`);
      }

      // 解构 payload 并调用对应的 API 方法
      const payload = action.payload || {};

      try {
        switch (action.type) {
          case 'attack':
            if (typeof payload.q === 'number') {
              await apiClient.attackCell(payload.attackerId, payload.q, payload.r);
            } else {
              await apiClient.attack(payload.attackerId, payload.targetId);
            }
            break;
          case 'move':
            await apiClient.move(payload.unitId, payload.q, payload.r);
            break;
          case 'deploy':
            await apiClient.deploy(payload.unitType, payload.fromId, payload.q, payload.r);
            break;
          case 'heal':
            if (typeof payload.q === 'number') {
              await apiClient.healCell(payload.supportId, payload.q, payload.r);
            } else {
              await apiClient.heal(payload.supportId, payload.targetId);
            }
            break;
          case 'demolish':
            await apiClient.demolish(payload.unitId, payload.q, payload.r);
            break;
          default:
            throw new Error(`Unsupported action type: ${action.type}`);
        }
      } catch (error) {
        // 动作失败（除了 429）：记录错误
        if (!error.message.includes('rate_limit')) {
          console.error(`Action ${action.type} failed: ${error.message}`);
          if (simultaneous) {
            // 被拒动作没有入队、局面未变：记住它并刷新状态继续决策，别
            // break 后落进 endTurn——那会把剩余行动点和已排队列一起提交作废。
            rejected.add(actionKey(action));
            rejectedCount++;
            state = await apiClient.getState();
            continue;
          }
          // 轮流模式：动作失败后跳出循环，让算法在下次 decide 时看到失败后的状态
          break;
        }
        throw error; // 429 会在 api-client 中重试
      }

      // 刷新状态
      state = await apiClient.getState();
      actionCount++;
    }

    if (actionCount >= MAX_ACTIONS) {
      console.warn(`Algorithm reached max action limit (${MAX_ACTIONS})`);
    }
    if (rejectedCount >= MAX_REJECTIONS) {
      console.warn(`Algorithm had ${rejectedCount} rejected actions; committing current plan`);
    }

    // 结束回合（同时模式 = 提交计划并锁定）
    await apiClient.endTurn();
    return;
  }

  // 未实现任何接口
  throw new Error(
    'Algorithm must implement either decide(gameState, utils) or playTurn(gameState, apiClient, utils)'
  );
}

/**
 * 验证算法模块格式
 * @param {object} algorithm - 算法模块
 * @throws {Error} 如果格式不合法
 */
export function validateAlgorithm(algorithm) {
  if (!algorithm || typeof algorithm !== 'object') {
    throw new Error('Algorithm must be an object');
  }

  if (!algorithm.name || typeof algorithm.name !== 'string') {
    throw new Error('Algorithm must have a name (string)');
  }

  const hasDecide = typeof algorithm.decide === 'function';
  const hasPlayTurn = typeof algorithm.playTurn === 'function';

  if (!hasDecide && !hasPlayTurn) {
    throw new Error('Algorithm must implement either decide() or playTurn()');
  }

  if (hasDecide && hasPlayTurn) {
    console.warn(
      `Algorithm "${algorithm.name}" implements both decide() and playTurn(). ` +
      `Only playTurn() will be used.`
    );
  }
}
