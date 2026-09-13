// algorithms/lib/api-client.mjs
//
// REST API 客户端封装，提供类型安全的游戏操作接口

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * 游戏 REST API 客户端
 * 封装所有与游戏服务器的 HTTP 交互
 */
export class GameApiClient {
  /**
   * @param {string} baseUrl - API 基地址，如 http://localhost:3100
   * @param {string} gameId - 游戏 ID
   * @param {string} playerToken - 玩家 token
   * @param {object} options - 可选配置
   * @param {number} options.rateLimitRetryMs - 遇到 429 时的重试间隔（毫秒）
   * @param {number} options.maxRetries - 最大重试次数
   */
  constructor(baseUrl, gameId, playerToken, options = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.gameId = gameId;
    this.playerToken = playerToken;
    this.rateLimitRetryMs = options.rateLimitRetryMs || 1500;
    this.maxRetries = options.maxRetries || 3;
  }

  /**
   * 通用 HTTP 请求方法，自动处理 429 限流重试
   * @private
   */
  async _request(method, path, body) {
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const headers = {
        'X-Player-Token': this.playerToken,
      };
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
      }

      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      const text = await res.text();
      const data = text ? JSON.parse(text) : {};

      if (res.ok) {
        return data;
      }

      // 429 限流：重试
      if (res.status === 429 && attempt < this.maxRetries) {
        const wait = this.rateLimitRetryMs * (attempt + 1);
        await sleep(wait);
        continue;
      }

      // 其他错误：抛出异常
      const error = new Error(
        `${method} ${path} -> ${res.status}${data?.code ? ` ${data.code}` : ''}${data?.error ? `: ${data.error}` : ''}`
      );
      error.status = res.status;
      error.code = data?.code;
      error.data = data;
      throw error;
    }
  }

  /**
   * 获取完整游戏状态
   * @returns {Promise<object>} 游戏状态对象
   */
  async getState() {
    return this._request('GET', `/api/games/${this.gameId}`);
  }

  /**
   * 攻击敌方单位或总部
   * @param {string} attackerId - 攻击者单位 ID
   * @param {string} targetId - 目标单位或总部 ID
   * @returns {Promise<object>}
   */
  async attack(attackerId, targetId) {
    return this._request('POST', `/api/games/${this.gameId}/attack`, {
      attackerId,
      targetId,
    });
  }

  /**
   * 移动单位
   * @param {string} unitId - 单位 ID
   * @param {number} q - 目标六边形坐标 q
   * @param {number} r - 目标六边形坐标 r
   * @returns {Promise<object>}
   */
  async move(unitId, q, r) {
    return this._request('POST', `/api/games/${this.gameId}/move`, {
      unitId,
      q,
      r,
    });
  }

  /**
   * 部署新单位
   * @param {string} unitType - 单位类型 (infantry, scout, heavy, ranger, support)
   * @param {string} fromId - 部署源 ID（总部或据点）
   * @param {number} q - 部署位置坐标 q
   * @param {number} r - 部署位置坐标 r
   * @returns {Promise<object>}
   */
  async deploy(unitType, fromId, q, r) {
    return this._request('POST', `/api/games/${this.gameId}/deploy`, {
      unitType,
      fromId,
      q,
      r,
    });
  }

  /**
   * 治疗友方单位
   * @param {string} supportId - 支援单位 ID
   * @param {string} targetId - 目标友方单位 ID
   * @returns {Promise<object>}
   */
  async heal(supportId, targetId) {
    return this._request('POST', `/api/games/${this.gameId}/heal`, {
      supportId,
      targetId,
    });
  }

  /**
   * 爆破阻挡地形
   * @param {string} unitId - 重装单位 ID
   * @param {number} q - 目标地形坐标 q
   * @param {number} r - 目标地形坐标 r
   * @returns {Promise<object>}
   */
  async demolish(unitId, q, r) {
    return this._request('POST', `/api/games/${this.gameId}/demolish`, {
      unitId,
      q,
      r,
    });
  }

  /**
   * 结束当前回合
   * @returns {Promise<object>}
   */
  async endTurn() {
    return this._request('POST', `/api/games/${this.gameId}/end-turn`, {});
  }
}
