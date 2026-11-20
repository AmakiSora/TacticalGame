// tests/config/fog-map.test.ts
// 迷雾地图 schema 校验（契约 §5）与两张首批地图的开局冒烟。
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getMapConfig, loadMaps, resetConfig, type MapConfig,
} from '../../src/config/loader.js';
import {
  generateRandomMapConfig, randomMapIdForMode, sanitizeRandomOptions,
} from '../../src/config/randomMap.js';
import { createLobby, addLobbyPlayer } from '../../src/state/store.js';
import { startGame } from '../../src/engine/engine.js';
import { EventBus } from '../../src/events/bus.js';
import { FOG_VISION_DEFAULTS, hexLineBetween, isFogRevealed, unitsForViewer } from '../../src/engine/fog.js';
import type { GameState, PlayerId } from '../../src/types.js';

function unitSpecs() {
  return {
    infantry: { hp: 100, attack: 30, defense: 8, moveRange: 3, attackRange: 1, cost: 45, canCapture: true },
    scout: { hp: 65, attack: 16, defense: 4, moveRange: 5, attackRange: 1, cost: 38, canCapture: true },
    heavy: { hp: 150, attack: 38, defense: 13, moveRange: 2, attackRange: 1, cost: 92, canCapture: false },
    ranger: { hp: 72, attack: 44, defense: 3, moveRange: 2, attackRange: 3, cost: 78, canCapture: false },
    support: { hp: 82, attack: 10, defense: 5, moveRange: 3, attackRange: 1, cost: 60, canCapture: false, healPower: 22 },
  };
}

function fogMap(overrides: Record<string, unknown> = {}): Record<string, any> {
  return {
    name: 'Fog Test',
    description: 'Fog test map',
    mode: 'fog',
    grid: 'hex',
    orientation: 'pointy',
    radius: 4,
    terrainCells: [],
    controlPoints: [],
    spawnSlots: [
      { id: 's1', headquarters: { q: -4, r: 0 }, startingUnits: [{ type: 'scout', q: -3, r: 0 }] },
      { id: 's2', headquarters: { q: 4, r: 0 }, startingUnits: [{ type: 'scout', q: 3, r: 0 }] },
    ],
    layouts: { 2: ['s1', 's2'] },
    units: unitSpecs(),
    headquartersSpec: { hp: 180, defense: 6 },
    fog: { vision: { ...FOG_VISION_DEFAULTS }, revealFromRound: null },
    modelEval: false,
    balance: {
      startingSupplies: 120,
      baseIncome: 8,
      damageVarianceRange: 3,
      minimumDamage: 1,
      healVarianceRange: 6,
      actionsPerTurn: 6,
      attacksPerUnit: 1,
      maxTurns: 20,
      adjudicationWeights: {
        enemyHqDamage: 4, ownHqHp: 2, controlPoint: 120, armyValue: 2, supplies: 1,
      },
      controlPointTypes: {
        supply: { income: 12, deployDiscount: 0, repairAmount: 0 },
        forward_base: { income: 8, deployDiscount: 8, repairAmount: 0 },
        repair: { income: 8, deployDiscount: 0, repairAmount: 10 },
      },
    },
    ...overrides,
  };
}

function loadOne(map: Record<string, unknown>): MapConfig {
  const dir = mkdtempSync(join(tmpdir(), 'tactical-fog-map-'));
  writeFileSync(join(dir, 'default.json'), JSON.stringify(map));
  try {
    loadMaps(dir);
    return getMapConfig('default');
  } finally {
    resetConfig();
  }
}

function expectLoadError(map: Record<string, unknown>, message: string): void {
  const dir = mkdtempSync(join(tmpdir(), 'tactical-fog-map-'));
  writeFileSync(join(dir, 'default.json'), JSON.stringify(map));
  try {
    expect(() => loadMaps(dir)).toThrow(message);
  } finally {
    resetConfig();
  }
}

describe('fog map schema', () => {
  it('loads a fog map and fills vision defaults', () => {
    const config = loadOne(fogMap());
    expect(config.mode).toBe('fog');
    expect(config.fog).toEqual({ vision: { ...FOG_VISION_DEFAULTS }, revealFromRound: null });
    expect(config.supportedPlayerCounts).toEqual([2]);
    expect(config.headquarters).toEqual({ player_a: { q: -4, r: 0 }, player_b: { q: 4, r: 0 } });
  });

  it('merges partial vision overrides with defaults and accepts an explicit reveal round', () => {
    const config = loadOne(fogMap({ fog: { vision: { scout: 0, heavy: 8 }, revealFromRound: 18 } }));
    expect(config.fog!.vision).toEqual({ ...FOG_VISION_DEFAULTS, scout: 0, heavy: 8 });
    expect(config.fog!.revealFromRound).toBe(18);
  });

  it('rejects a fog block on a non-fog map', () => {
    expectLoadError(fogMap({ mode: 'simultaneous' }), 'fog is only valid in fog mode');
  });

  it('requires a fog block in fog mode', () => {
    expectLoadError(fogMap({ fog: undefined }), 'Map "default".fog is required in fog mode');
  });

  it.each([
    [{ scout: 4, medic: 2 }, 'fog.vision.medic is not a unit type'],
    [{ scout: 9 }, 'fog.vision.scout must be an integer from 0 to 8'],
    [{ scout: -1 }, 'fog.vision.scout must be an integer from 0 to 8'],
    [{ scout: 1.5 }, 'fog.vision.scout must be an integer from 0 to 8'],
    [{ scout: '4' }, 'fog.vision.scout must be an integer from 0 to 8'],
  ])('rejects invalid vision %j', (vision, message) => {
    expectLoadError(fogMap({ fog: { vision, revealFromRound: null } }), message);
  });

  it.each([
    [0, 'fog.revealFromRound must be null or an integer >= 1'],
    [1.5, 'fog.revealFromRound must be null or an integer >= 1'],
    ['18', 'fog.revealFromRound must be null or an integer >= 1'],
    [21, 'fog.revealFromRound must not exceed maxTurns (20)'],
  ])('rejects invalid revealFromRound %j', (revealFromRound, message) => {
    expectLoadError(fogMap({ fog: { vision: { ...FOG_VISION_DEFAULTS }, revealFromRound } }), message);
  });

  it('rejects komi and annihilation configuration on fog maps', () => {
    expectLoadError(fogMap({
      balance: { ...fogMap().balance, komi: { supplies: 20 } },
    }), 'balance.komi is only valid in sequential modes');
    expectLoadError(fogMap({
      annihilation: {
        artillery: { startRound: 5, intervalRounds: 3, damage: 10, radius: 2 },
      },
    }), 'annihilation is only valid in annihilation/royale modes');
  });
});

describe('fog random map rejection', () => {
  it('rejects random.mode="fog" in every entry point with an actionable message', () => {
    const expected = 'random.mode="fog" 暂不支持';
    expect(() => sanitizeRandomOptions({ mode: 'fog' })).toThrow(expected);
    expect(() => generateRandomMapConfig({ mode: 'fog' }, 2)).toThrow(expected);
    expect(() => randomMapIdForMode('fog')).toThrow(expected);
  });
});

describe('first-party fog maps', () => {
  it('loads fog-harbor and fog-crossing with the contract settings', () => {
    loadMaps();
    try {
      const harbor = getMapConfig('fog-harbor');
      expect(harbor.mode).toBe('fog');
      expect(harbor.radius).toBe(8);
      expect(harbor.balance.maxTurns).toBe(20);
      expect(harbor.balance.actionsPerTurn).toBe(6);
      expect(harbor.fog).toEqual({ vision: { ...FOG_VISION_DEFAULTS }, revealFromRound: null });
      expect(harbor.supportedPlayerCounts).toEqual([2]);
      expect(harbor.modelEval).toBe(false);

      const crossing = getMapConfig('fog-crossing');
      expect(crossing.mode).toBe('fog');
      expect(crossing.radius).toBe(9);
      expect(crossing.balance.maxTurns).toBe(24);
      expect(crossing.balance.actionsPerTurn).toBe(6);
      expect(crossing.fog).toEqual({ vision: { ...FOG_VISION_DEFAULTS }, revealFromRound: 22 });
      expect(crossing.supportedPlayerCounts).toEqual([3]);
      expect(crossing.modelEval).toBe(false);
    } finally {
      resetConfig();
    }
  });

  it('keeps blockers cutting sight and water transparent in the shipped maps', () => {
    loadMaps();
    try {
      const terrainAt = (map: MapConfig, q: number, r: number) =>
        map.terrainCells.find(cell => cell.q === q && cell.r === r)?.terrain ?? 'plain';
      const losClear = (map: MapConfig, from: { q: number; r: number }, to: { q: number; r: number }) =>
        hexLineBetween(from, to).every(cell => {
          if (!map.playableCells.some(c => c.q === cell.q && c.r === cell.r)) return false;
          return terrainAt(map, cell.q, cell.r) !== 'blocker';
        });

      const harbor = getMapConfig('fog-harbor');
      // 中央仓库墙真实切割南北视线；西南水面不挡视线。
      expect(losClear(harbor, { q: 0, r: -3 }, { q: 0, r: 3 })).toBe(false);
      expect(losClear(harbor, { q: -4, r: 3 }, { q: -4, r: 7 })).toBe(true);
      // 固定对象都落在平地。
      for (const slot of harbor.spawnSlots) {
        const objects = [slot.headquarters, ...slot.startingUnits];
        for (const object of objects) expect(terrainAt(harbor, object.q, object.r)).toBe('plain');
      }
      for (const point of harbor.controlPoints) expect(terrainAt(harbor, point.q, point.r)).toBe('plain');

      const crossing = getMapConfig('fog-crossing');
      // 石梁挡视线；水环不挡，桥位保持平地。
      expect(losClear(crossing, { q: 2, r: -1 }, { q: 2, r: -4 })).toBe(false);
      expect(losClear(crossing, { q: 7, r: 1 }, { q: 5, r: 1 })).toBe(true);
      expect(losClear(crossing, { q: 7, r: 0 }, { q: 5, r: 0 })).toBe(true);
      for (const slot of crossing.spawnSlots) {
        const objects = [slot.headquarters, ...slot.startingUnits];
        for (const object of objects) expect(terrainAt(crossing, object.q, object.r)).toBe('plain');
      }
      for (const point of crossing.controlPoints) expect(terrainAt(crossing, point.q, point.r)).toBe('plain');
    } finally {
      resetConfig();
    }
  });

  it('starts both maps and hides every enemy at deployment', () => {
    loadMaps();
    try {
      for (const [mapId, count] of [['fog-harbor', 2], ['fog-crossing', 3]] as const) {
        const game: GameState = createLobby(`fog-map-start-${mapId}`, mapId, {
          maxPlayers: count, participate: true, playerName: 'A',
        });
        for (let i = 1; i < count; i++) addLobbyPlayer(game, `P${i}`);
        const started = startGame(game, new EventBus(), () => 0.42);
        expect(started.ok).toBe(true);
        expect(game.config.mode).toBe('fog');
        expect(game.fog).toBeTruthy();
        expect(isFogRevealed(game)).toBe(false);
        const owners = game.turn.turnOrder as PlayerId[];
        // 出生点相隔很远：开局每个玩家都看不到任何敌军。
        for (const viewer of owners) {
          const enemiesVisible = unitsForViewer(game, viewer)
            .filter(unit => unit.owner !== viewer && unit.alive);
          expect(enemiesVisible).toHaveLength(0);
          expect(game.fog!.lastSeen[viewer]).toEqual({});
        }
      }
    } finally {
      resetConfig();
    }
  });
});
