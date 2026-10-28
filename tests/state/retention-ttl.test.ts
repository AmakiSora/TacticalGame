// tests/state/retention-ttl.test.ts
// 对局保留期（TTL）纯函数的单测：原来这段逻辑藏在 server.ts 的 `if (!process.env.VITEST)` 分支里，
// 单测跑不到 retention 分支；这里直接覆盖 2h / 3d、env 覆盖、非法值回落与过期边界。
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TTL_HOURS,
  isRetentionExpired,
  parseTtlHours,
  retentionTtlsFromEnv,
  ttlMsForPhase,
} from '../../src/state/retention.js';

const HOUR_MS = 3_600_000;
/** 默认大厅 2h。 */
const LOBBY_DEFAULT_MS = 2 * HOUR_MS; // 7_200_000
/** 默认终局 3d。 */
const GAME_OVER_DEFAULT_MS = 3 * 24 * HOUR_MS; // 259_200_000

// 本文件不写 process.env，任何残留都算 bug：跑完后确认没有被改动过。
const envKeys = ['TACTICAL_GAME_LOBBY_TTL_HOURS', 'TACTICAL_GAME_OVER_TTL_HOURS'];
const envBefore = new Map(envKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of envKeys) {
    expect(process.env[key]).toBe(envBefore.get(key));
  }
});

describe('parseTtlHours', () => {
  it('未设置（undefined）时返回 fallback 且不告警', () => {
    const warn = vi.fn();
    expect(parseTtlHours(undefined, 2, warn)).toBe(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it('空串 / 全空白视为未设置：返回 fallback 且不告警', () => {
    const warn = vi.fn();
    expect(parseTtlHours('', 72, warn)).toBe(72);
    expect(parseTtlHours('   ', 72, warn)).toBe(72);
    expect(warn).not.toHaveBeenCalled();
  });

  it('合法数字按值返回（含 0 与小数），不告警', () => {
    const warn = vi.fn();
    expect(parseTtlHours('3', 2, warn)).toBe(3);
    expect(parseTtlHours('0', 2, warn)).toBe(0);
    expect(parseTtlHours('1.5', 2, warn)).toBe(1.5);
    expect(parseTtlHours(' 4 ', 2, warn)).toBe(4);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['非数字', 'abc'],
    ['NaN 字面量', 'NaN'],
    ['负数', '-3'],
    ['Infinity', 'Infinity'],
  ])('非法值（%s）回落 fallback 并只告警一次', (_label, value) => {
    const warn = vi.fn();
    expect(parseTtlHours(value, 2, warn)).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
    // 告警要能定位到配错的原值。
    expect(String(warn.mock.calls[0]![0])).toContain(JSON.stringify(value));
  });
});

describe('retentionTtlsFromEnv', () => {
  it('默认值具体为：大厅 2h = 7_200_000ms、终局 3d = 259_200_000ms', () => {
    const warn = vi.fn();
    const ttls = retentionTtlsFromEnv({}, warn);
    expect(ttls.lobbyTtlMs).toBe(LOBBY_DEFAULT_MS);
    expect(ttls.gameOverTtlMs).toBe(GAME_OVER_DEFAULT_MS);
    expect(warn).not.toHaveBeenCalled();
    // 常量与派生值一致（防止有人改常量忘了换算）。
    expect(DEFAULT_TTL_HOURS.lobby * HOUR_MS).toBe(LOBBY_DEFAULT_MS);
    expect(DEFAULT_TTL_HOURS.gameOver * HOUR_MS).toBe(GAME_OVER_DEFAULT_MS);
  });

  it('环境变量覆盖：按小时换算成毫秒', () => {
    const warn = vi.fn();
    const ttls = retentionTtlsFromEnv(
      { TACTICAL_GAME_LOBBY_TTL_HOURS: '1', TACTICAL_GAME_OVER_TTL_HOURS: '24' },
      warn,
    );
    expect(ttls.lobbyTtlMs).toBe(1 * HOUR_MS);
    expect(ttls.gameOverTtlMs).toBe(24 * HOUR_MS);
    expect(warn).not.toHaveBeenCalled();
  });

  it('只覆盖其中一个时，另一个仍取默认值', () => {
    const warn = vi.fn();
    const ttls = retentionTtlsFromEnv({ TACTICAL_GAME_LOBBY_TTL_HOURS: '0.5' }, warn);
    expect(ttls.lobbyTtlMs).toBe(0.5 * HOUR_MS);
    expect(ttls.gameOverTtlMs).toBe(GAME_OVER_DEFAULT_MS);
    expect(warn).not.toHaveBeenCalled();
  });

  it('两个都非法：各自回落默认，并各告警一次', () => {
    const warn = vi.fn();
    const ttls = retentionTtlsFromEnv(
      { TACTICAL_GAME_LOBBY_TTL_HOURS: 'oops', TACTICAL_GAME_OVER_TTL_HOURS: '-1' },
      warn,
    );
    expect(ttls.lobbyTtlMs).toBe(LOBBY_DEFAULT_MS);
    expect(ttls.gameOverTtlMs).toBe(GAME_OVER_DEFAULT_MS);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('空串环境变量等同未设置：默认值且不告警', () => {
    const warn = vi.fn();
    const ttls = retentionTtlsFromEnv(
      { TACTICAL_GAME_LOBBY_TTL_HOURS: '', TACTICAL_GAME_OVER_TTL_HOURS: '  ' },
      warn,
    );
    expect(ttls.lobbyTtlMs).toBe(LOBBY_DEFAULT_MS);
    expect(ttls.gameOverTtlMs).toBe(GAME_OVER_DEFAULT_MS);
    expect(warn).not.toHaveBeenCalled();
  });

  it('使用显式传入的 env 对象，不改写它也不读 process.env', () => {
    const env = { TACTICAL_GAME_LOBBY_TTL_HOURS: '2' };
    const snapshot = { ...env };
    retentionTtlsFromEnv(env);
    expect(env).toEqual(snapshot);
  });
});

describe('ttlMsForPhase', () => {
  const ttls = { lobbyTtlMs: 123, gameOverTtlMs: 456 };

  it('lobby 取大厅 TTL', () => {
    expect(ttlMsForPhase('lobby', ttls)).toBe(123);
  });

  it('game_over 取终局 TTL', () => {
    expect(ttlMsForPhase('game_over', ttls)).toBe(456);
  });

  it('active 返回 0（永不按 TTL 回收）', () => {
    expect(ttlMsForPhase('active', ttls)).toBe(0);
  });
});

describe('isRetentionExpired', () => {
  const ttls = { lobbyTtlMs: LOBBY_DEFAULT_MS, gameOverTtlMs: GAME_OVER_DEFAULT_MS };
  const now = 10 * GAME_OVER_DEFAULT_MS;

  it('active 恒不过期（即使 TTL 极小、时间极老）', () => {
    expect(
      isRetentionExpired({ phase: 'active', lastActivityAt: 0, createdAt: 0 }, now, {
        lobbyTtlMs: 1,
        gameOverTtlMs: 1,
      }),
    ).toBe(false);
  });

  it('lobby：不足 2h 不过期，正好 2h 即过期（>= 边界）', () => {
    const last = now - LOBBY_DEFAULT_MS;
    expect(isRetentionExpired({ phase: 'lobby', lastActivityAt: last + 1, createdAt: 0 }, now, ttls)).toBe(false);
    expect(isRetentionExpired({ phase: 'lobby', lastActivityAt: last, createdAt: 0 }, now, ttls)).toBe(true);
    expect(isRetentionExpired({ phase: 'lobby', lastActivityAt: last - 1, createdAt: 0 }, now, ttls)).toBe(true);
  });

  it('lobby：lastActivityAt 缺失时回落到 createdAt', () => {
    expect(
      isRetentionExpired({ phase: 'lobby', createdAt: now - LOBBY_DEFAULT_MS - 1 }, now, ttls),
    ).toBe(true);
    expect(
      isRetentionExpired({ phase: 'lobby', createdAt: now - LOBBY_DEFAULT_MS + 1 }, now, ttls),
    ).toBe(false);
  });

  it('lastActivityAt 优先于 createdAt', () => {
    const game = {
      phase: 'lobby' as const,
      lastActivityAt: now - 1,
      createdAt: now - LOBBY_DEFAULT_MS * 2,
    };
    expect(isRetentionExpired(game, now, ttls)).toBe(false);
  });

  it('game_over 用终局 TTL（3d），不是大厅 TTL', () => {
    const last = now - 1 * 24 * HOUR_MS; // 1 天：远超大厅 2h，但没到 3 天
    expect(isRetentionExpired({ phase: 'game_over', lastActivityAt: last, createdAt: 0 }, now, ttls)).toBe(false);
    // 边界：正好 3 天即过期。
    expect(
      isRetentionExpired({ phase: 'game_over', lastActivityAt: now - GAME_OVER_DEFAULT_MS + 1, createdAt: 0 }, now, ttls),
    ).toBe(false);
    expect(
      isRetentionExpired({ phase: 'game_over', lastActivityAt: now - GAME_OVER_DEFAULT_MS, createdAt: 0 }, now, ttls),
    ).toBe(true);
  });

  it('TTL 为 0 视为不回收（守卫 `!ttl` 分支）', () => {
    const zero = { lobbyTtlMs: 0, gameOverTtlMs: 0 };
    expect(
      isRetentionExpired({ phase: 'lobby', lastActivityAt: 0, createdAt: 0 }, now, zero),
    ).toBe(false);
    expect(
      isRetentionExpired({ phase: 'game_over', lastActivityAt: 0, createdAt: 0 }, now, zero),
    ).toBe(false);
  });

  it('时间戳全缺失时按 0 处理（极老 → 过期），不会因 undefined 变成 NaN 而漏收', () => {
    expect(isRetentionExpired({ phase: 'lobby' }, now, ttls)).toBe(true);
  });
});
