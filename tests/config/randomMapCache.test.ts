import { describe, expect, it } from 'vitest';
import { generateRandomMapConfig } from '../../src/config/randomMap.js';
import { clearRandomMapCache, getCachedRandomMap, setCachedRandomMap } from '../../src/config/randomMapCache.js';

describe('random map cache', () => {
  it('returns a deep copy so one game cannot poison later creations', () => {
    clearRandomMapCache();
    const options = { seed: 'cache-test' };
    const config = generateRandomMapConfig(options, 4);
    const values = { radius: 7 };
    setCachedRandomMap(options, 4, config, values);

    const first = getCachedRandomMap(options, 4);
    expect(first).not.toBeNull();
    expect(first!.config.terrainCells).toEqual(config.terrainCells);
    first!.config.terrainCells[0]!.terrain = 'water';
    first!.values.radius = 999;

    const second = getCachedRandomMap(options, 4);
    expect(second!.config.terrainCells[0]!.terrain).toBe(config.terrainCells[0]!.terrain);
    expect(second!.values.radius).toBe(7);
  });

  it('keys by parameters and player count', () => {
    clearRandomMapCache();
    const config = generateRandomMapConfig({ seed: 'key-test' }, 2);
    setCachedRandomMap({ seed: 'key-test' }, 2, config, {});
    expect(getCachedRandomMap({ seed: 'key-test' }, 3)).toBeNull();
    expect(getCachedRandomMap({ seed: 'other' }, 2)).toBeNull();
    expect(getCachedRandomMap({ seed: 'key-test' }, 2)).not.toBeNull();
  });
});
