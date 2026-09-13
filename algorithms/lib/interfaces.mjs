// algorithms/lib/interfaces.mjs
//
// 算法接口适配器：统一处理策略接口和完整控制接口

/**
 * 运行算法并执行一个完整回合
 *
 * @param {object} algorithm - 算法模块（必须实现 decide 或 playTurn）
 * @param {object} gameState - 当前游戏状态
 * @param {GameApiClient} apiClient - API 客户端
 * @param {object} utils - 游戏工具函数集合
 * @returns {Promise<void>}
 */
export async function runAlgorithm(algorithm, gameState, apiClient, utils) {
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

    while (actionCount < MAX_ACTIONS) {
      const action = await algorithm.decide(state, utils);

      // null 表示应该结束回合
      if (!action) {
        break;
      }

      // 验证动作格式
      if (!action.type || typeof action.type !== 'string') {
        throw new Error(`Invalid action from decide(): missing or invalid 'type' field`);
      }

      // 执行动作
      const method = apiClient[action.type];
      if (typeof method !== 'function') {
        throw new Error(`Unknown action type: ${action.type}`);
      }

      // 解构 payload 并调用对应的 API 方法
      const payload = action.payload || {};

      try {
        switch (action.type) {
          case 'attack':
            await apiClient.attack(payload.attackerId, payload.targetId);
            break;
          case 'move':
            await apiClient.move(payload.unitId, payload.q, payload.r);
            break;
          case 'deploy':
            await apiClient.deploy(payload.unitType, payload.fromId, payload.q, payload.r);
            break;
          case 'heal':
            await apiClient.heal(payload.supportId, payload.targetId);
            break;
          case 'demolish':
            await apiClient.demolish(payload.unitId, payload.q, payload.r);
            break;
          default:
            throw new Error(`Unsupported action type: ${action.type}`);
        }
      } catch (error) {
        // 动作失败（除了 429）：记录错误但继续
        if (!error.message.includes('rate_limit')) {
          console.error(`Action ${action.type} failed: ${error.message}`);
          // 动作失败后跳出循环，让算法在下次 decide 时看到失败后的状态
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

    // 结束回合
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
