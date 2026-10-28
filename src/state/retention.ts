// src/state/retention.ts
// 对局保留期（TTL）的纯函数：解析环境变量 + 按阶段判定是否过期。
// 抽出来是为了能在单测里直接覆盖 2h / 3d 与 env 覆盖——原来这段逻辑藏在 server.ts 的
// `if (!process.env.VITEST)` 分支里，测试根本跑不到。
import type { GamePhase, GameState } from '../types.js';

/** 默认保留期（小时）：大厅 2h、终局 3d；进行中（active）永不自动回收。 */
export const DEFAULT_TTL_HOURS = { lobby: 2, gameOver: 3 * 24 } as const;

export interface RetentionTtls {
  lobbyTtlMs: number;
  gameOverTtlMs: number;
}

/** 解析一个「小时」环境变量：缺省/空串用 fallback；非法或负数同样回落（配错不该把全部对局回收）。 */
export function parseTtlHours(
  value: string | undefined,
  fallbackHours: number,
  warn: (message: string) => void = () => {},
): number {
  if (value === undefined || value.trim() === '') return fallbackHours;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    // 空串视为「没配」不告警；配了但非法/负数才告警（说明配置写错了）。
    warn(`TTL 配置非法（${JSON.stringify(value)}），回落为默认 ${fallbackHours} 小时`);
    return fallbackHours;
  }
  return parsed;
}

/** 从环境变量读出保留期（ms）。默认 2h / 3d，可用 TACTICAL_GAME_LOBBY_TTL_HOURS / TACTICAL_GAME_OVER_TTL_HOURS 覆盖。 */
export function retentionTtlsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  warn: (message: string) => void = () => {},
): RetentionTtls {
  return {
    lobbyTtlMs: parseTtlHours(env.TACTICAL_GAME_LOBBY_TTL_HOURS, DEFAULT_TTL_HOURS.lobby, warn) * 3_600_000,
    gameOverTtlMs: parseTtlHours(env.TACTICAL_GAME_OVER_TTL_HOURS, DEFAULT_TTL_HOURS.gameOver, warn) * 3_600_000,
  };
}

/** 某个阶段对应的保留期（ms）；0 表示永不按 TTL 回收。 */
export function ttlMsForPhase(phase: GamePhase, ttls: RetentionTtls): number {
  if (phase === 'lobby') return ttls.lobbyTtlMs;
  if (phase === 'game_over') return ttls.gameOverTtlMs;
  return 0;
}

/** 是否已过保留期：active 恒 false；lobby / game_over 按最后活动时间（缺省用创建时间）判定。 */
export function isRetentionExpired(
  game: Pick<GameState, 'phase' | 'lastActivityAt' | 'createdAt'>,
  now: number,
  ttls: RetentionTtls,
): boolean {
  const ttl = ttlMsForPhase(game.phase, ttls);
  if (!ttl || ttl <= 0) return false;
  const last = game.lastActivityAt ?? game.createdAt ?? 0;
  return now - last >= ttl;
}
