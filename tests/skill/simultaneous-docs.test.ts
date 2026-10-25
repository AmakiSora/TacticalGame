import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { listMaps } from '../../src/config/loader.js';

const SIMULTANEOUS_DOCS = ['skill/simultaneous.md', 'skill/review-simultaneous.md'] as const;

describe('simultaneous skill documentation', () => {
  it('covers every simultaneous map and gates map-specific sections by mapId', async () => {
    const simultaneousMaps = listMaps()
      .filter(map => map.preview.mode === 'simultaneous')
      .map(map => map.id)
      .sort();
    expect(simultaneousMaps).toEqual(['mistpine', 'molten-throne', 'standoff']);

    for (const path of SIMULTANEOUS_DOCS) {
      const text = await readFile(path, 'utf8');
      expect(text).toContain('config.mode === "simultaneous"');
      expect(text).toContain('mapId');
      expect(text).not.toContain('game.config.mapId');
      for (const mapId of simultaneousMaps) {
        expect(text, `${path} must document ${mapId}`).toContain(`\`${mapId}\``);
      }
    }

    const simultaneous = await readFile('skill/simultaneous.md', 'utf8');
    const review = await readFile('skill/review-simultaneous.md', 'utf8');
    expect(simultaneous).toContain('game.mapId');
    expect(review).toContain('game_start.payload.mapId');
  });

  it('does not present standoff as the only simultaneous map', async () => {
    const [simultaneous, review] = await Promise.all([
      readFile('skill/simultaneous.md', 'utf8'),
      readFile('skill/review-simultaneous.md', 'utf8'),
    ]);

    expect(simultaneous).not.toContain('map: `standoff`');
    expect(simultaneous).toContain('Only when `game.mapId === "standoff"`');
    expect(simultaneous).toContain('Only when `game.mapId === "molten-throne"`');
    expect(simultaneous).toContain('Only when `game.mapId === "mistpine"`');
    expect(review).not.toContain('当前专用地图为');
  });
});
