// tests/algorithms/interfaces.test.ts
// 运行器适配器（algorithms/lib/interfaces.mjs）动作失败处理单元测试：
// 同时回合模式下动作被服务器拒绝（非 429）不得 break 后 endTurn 把计划提前
// 提交锁定——应记住被拒动作、刷新状态继续让 decide 重选（重问/被拒共 20 次
// 上限兜底，超限带已排计划提交）；轮流模式保持既有「失败即跳出循环结束回合」
// 行为；429（rate_limit）仍原样抛出交由客户端重试。
import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error 适配器为 ESM .mjs，无类型声明
import { runAlgorithm } from '../../algorithms/lib/interfaces.mjs';

const SIM_STATE = { config: { mode: 'simultaneous' } };
const STD_STATE = { config: { mode: 'standard' } };
const REFRESHED_STATE = { config: { mode: 'simultaneous' }, refreshed: true };

/** 构造仅覆盖 decide 通道所需方法的伪 API 客户端。 */
function makeClient(moveImpl: () => Promise<unknown> = async () => ({})) {
  return {
    getState: vi.fn(async () => REFRESHED_STATE),
    move: vi.fn(moveImpl),
    endTurn: vi.fn(async () => ({})),
  };
}

describe('runAlgorithm 动作失败处理', () => {
  it('同时模式：动作被拒不提交计划，decide 重选后继续入队，最后才提交一次', async () => {
    const decide = vi.fn()
      .mockResolvedValueOnce({ type: 'move', payload: { unitId: 'u1', q: 1, r: 2 } })
      .mockResolvedValueOnce({ type: 'move', payload: { unitId: 'u2', q: 3, r: 4 } })
      .mockResolvedValue(null);
    const client = makeClient();
    client.move
      .mockRejectedValueOnce(new Error('POST /api/games/g/move -> 400 invalid_target: 目的格被占'))
      .mockResolvedValueOnce({ queued: true });

    await runAlgorithm({ name: 'test', decide }, SIM_STATE, client, {}, { owner: 'player_a' });

    expect(decide).toHaveBeenCalledTimes(3);
    // 被拒后 decide 拿到刷新过的状态重选
    expect(decide.mock.calls[1][0]).toBe(REFRESHED_STATE);
    expect(client.move).toHaveBeenCalledTimes(2);
    expect(client.endTurn).toHaveBeenCalledTimes(1);
    // 提交发生在重选动作入队之后
    expect(client.move.mock.invocationCallOrder[1]).toBeLessThan(client.endTurn.mock.invocationCallOrder[0]);
  });

  it('同时模式：decide 反复给出同一被拒动作时按上限重问，不重复请求服务器', async () => {
    const decide = vi.fn().mockResolvedValue({ type: 'move', payload: { unitId: 'u1', q: 1, r: 2 } });
    const client = makeClient(async () => {
      throw new Error('POST /api/games/g/move -> 400 invalid_target: 目的格被占');
    });

    await runAlgorithm({ name: 'test', decide }, SIM_STATE, client, {}, { owner: 'player_a' });

    // 重问上限 20：1 次真实尝试 + 19 次重问；被拒动作不会反复打到服务器
    expect(decide).toHaveBeenCalledTimes(20);
    expect(client.move).toHaveBeenCalledTimes(1);
    expect(client.endTurn).toHaveBeenCalledTimes(1);
  });

  it('同时模式：连续多个不同动作都被拒时同样有上限，带已排计划提交', async () => {
    const decide = vi.fn(async () => ({
      type: 'move',
      payload: { unitId: `u${decide.mock.calls.length}`, q: 1, r: decide.mock.calls.length },
    }));
    const client = makeClient(async () => {
      throw new Error('POST /api/games/g/move -> 400 invalid_move: 不可达');
    });

    await runAlgorithm({ name: 'test', decide }, SIM_STATE, client, {}, { owner: 'player_a' });

    expect(decide).toHaveBeenCalledTimes(20);
    expect(client.move).toHaveBeenCalledTimes(20);
    expect(client.endTurn).toHaveBeenCalledTimes(1);
  });

  it('轮流模式：动作失败即跳出循环结束回合（既有行为不变）', async () => {
    const decide = vi.fn()
      .mockResolvedValueOnce({ type: 'move', payload: { unitId: 'u1', q: 1, r: 2 } })
      .mockResolvedValue({ type: 'move', payload: { unitId: 'u2', q: 3, r: 4 } });
    const client = makeClient(async () => {
      throw new Error('POST /api/games/g/move -> 400 invalid_target: 目的格被占');
    });

    await runAlgorithm({ name: 'test', decide }, STD_STATE, client, {}, {});

    expect(client.move).toHaveBeenCalledTimes(1);
    expect(decide).toHaveBeenCalledTimes(1);
    expect(client.endTurn).toHaveBeenCalledTimes(1);
  });

  it('429（rate_limit）错误不当作普通失败处理，原样抛出且不提交', async () => {
    const decide = vi.fn().mockResolvedValue({ type: 'move', payload: { unitId: 'u1', q: 1, r: 2 } });
    const client = makeClient(async () => {
      throw new Error('POST /api/games/g/move -> 429 rate_limit: too many requests');
    });

    await expect(
      runAlgorithm({ name: 'test', decide }, SIM_STATE, client, {}, { owner: 'player_a' }),
    ).rejects.toThrow('rate_limit');
    expect(client.endTurn).not.toHaveBeenCalled();
  });
});
