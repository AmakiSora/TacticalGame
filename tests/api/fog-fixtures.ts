// tests/api/fog-fixtures.ts
// 迷雾 API 测试共用的地图/建房夹具。
//
// 目的：T2（服务端保密投影）必须先于 T3（正式 fog 地图）可测。这里把一张现有
// 双人图（standoff）在临时目录里重写成 fog 模式并加载，走真实的 loader 校验与
// POST /api/games 建房路径；正式 fog-harbor / fog-crossing 落地后，引擎/地图
// 用例会覆盖它们，API 用例继续用这张固定夹具保证稳定。
import { copyFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { getMapConfig, loadMaps } from '../../src/config/loader.js';
import { FOG_VISION_DEFAULTS } from '../../src/engine/fog.js';

export const FOG_TEST_MAP = 'fog-api-test';

const MAPS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'maps');

let tempMapsDir: string | null = null;

/** 在临时目录复制现有地图并追加一张 fog 测试图，然后加载为全局地图表。 */
export function installFogMap(): void {
  loadMaps();
  const dir = mkdtempSync(join(tmpdir(), 'tactical-fog-maps-'));
  for (const file of readdirSync(MAPS_DIR)) {
    if (file.endsWith('.json')) copyFileSync(join(MAPS_DIR, file), join(dir, file));
  }
  const base = getMapConfig('standoff');
  const fogMap = {
    ...base,
    mode: 'fog',
    name: '迷雾 API 测试图',
    description: '仅测试：standoff 几何 + 全程迷雾',
    fog: { vision: { ...FOG_VISION_DEFAULTS }, revealFromRound: null },
    modelEval: false,
  };
  writeFileSync(join(dir, `${FOG_TEST_MAP}.json`), JSON.stringify(fogMap, null, 2));
  loadMaps(dir);
  tempMapsDir = dir;
}

/** buildServer() 每次启动都会重新 loadMaps()（真实 maps/），建房前需再次切回夹具目录。 */
export function activateFogMap(): void {
  if (tempMapsDir) loadMaps(tempMapsDir);
}

export function restoreMaps(): void {
  if (tempMapsDir) {
    try {
      rmSync(tempMapsDir, { recursive: true, force: true });
    } catch {
      // Windows 下偶发占用：临时目录可留给系统清理，不影响测试结论。
    }
    tempMapsDir = null;
  }
  loadMaps();
}

export interface FogSeat { id: string; token: string }

export interface FogGame {
  gameId: string;
  hostToken: string;
  spectatorToken: string;
  seats: FogSeat[];
}

export async function createFogGame(app: FastifyInstance, playerCount = 2): Promise<FogGame> {
  activateFogMap();
  const createRes = await app.inject({
    method: 'POST',
    url: '/api/games',
    payload: { mapId: FOG_TEST_MAP, maxPlayers: playerCount, playerName: 'A' },
  });
  if (createRes.statusCode !== 200) throw new Error(`create fog game failed: ${createRes.body}`);
  const created = createRes.json() as {
    gameId: string; hostToken: string; player: FogSeat; spectatorToken: string;
  };
  const seats: FogSeat[] = [created.player];
  for (let i = 1; i < playerCount; i++) {
    const joinRes = await app.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/join`,
      payload: { name: `P${i}` },
    });
    if (joinRes.statusCode !== 200) throw new Error(`join fog game failed: ${joinRes.body}`);
    seats.push((joinRes.json() as { player: FogSeat }).player);
  }
  const startRes = await app.inject({
    method: 'POST',
    url: `/api/games/${created.gameId}/start`,
    headers: { 'x-host-token': created.hostToken },
  });
  if (startRes.statusCode !== 200) throw new Error(`start fog game failed: ${startRes.body}`);
  return {
    gameId: created.gameId,
    hostToken: created.hostToken,
    spectatorToken: created.spectatorToken,
    seats,
  };
}

export interface FogStateView {
  units: { id: string; owner: string; type: string; q: number; r: number; hp: number }[];
  fog: { enabled: boolean; revealed: boolean; visibleCells: string[]; lastSeen: unknown[] };
  events: { seq: number; type: string; payload: Record<string, unknown> }[];
  adjudication: Record<string, unknown> & {
    scores: Record<string, Record<string, unknown>>;
    rankings: { playerId: string; rank: number; hidden?: boolean; score?: Record<string, unknown> }[];
  };
  plan: { queues: Record<string, unknown[]>; committed: string[]; myQueue: unknown[] };
}

export async function fetchFogState(
  app: FastifyInstance,
  gameId: string,
  auth: { player?: string; spectator?: string } = {},
): Promise<{ res: LightMyRequestResponse; body: FogStateView }> {
  const headers: Record<string, string> = {};
  if (auth.player) headers['x-player-token'] = auth.player;
  if (auth.spectator) headers['x-spectator-token'] = auth.spectator;
  const res = await app.inject({ method: 'GET', url: `/api/games/${gameId}`, headers });
  return { res, body: res.json() as FogStateView };
}

export function sseDataLines(body: string): { seq: number; type: string; payload: Record<string, unknown> }[] {
  const events: { seq: number; type: string; payload: Record<string, unknown> }[] = [];
  for (const line of body.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    events.push(JSON.parse(line.slice('data: '.length)));
  }
  return events;
}
