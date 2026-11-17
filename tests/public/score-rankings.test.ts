import { readFileSync } from 'node:fs';
import { createContext, Script } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const FILES = ['app.js', 'spectator-m.js'] as const;
const read = (file: string) => readFileSync(new URL(`../../public/${file}`, import.meta.url), 'utf8');

function fn(source: string, name: string) {
  const match = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(source);
  if (!match) throw new Error(`Missing ${name}`);
  return source.slice(match.index, source.indexOf('\n}', match.index) + 2);
}

function loadScorePanel(file: string) {
  const source = read(file);
  const scorePanelEl = { innerHTML: '' };
  const scoreRank = vi.fn(() => 99);
  const context = createContext({
    scorePanelEl,
    bindScoreToggles: vi.fn(),
    liveAdjudicationScores: () => ({
      player_a: { total: 20 },
      player_b: { total: 30 },
    }),
    renderScoreRow: (owner: string, _score: unknown, rank: number) => `${owner}:#${rank}`,
    scoreRank,
  });
  const run = (code: string) => new Script(code).runInContext(context);
  run(`
    let state = {
      result: {
        rankings: [null, { playerId: 'player_b', rank: 1 }],
      },
    };
    ${fn(source, 'liveAdjudicationRankings')}
    ${fn(source, 'renderScorePanel')}
  `);
  return { run, scorePanelEl, scoreRank };
}

for (const file of FILES) {
  describe(`${file} score rankings`, () => {
    it('ignores null ranking rows instead of crashing the score panel', () => {
      const h = loadScorePanel(file);

      expect(() => h.run('renderScorePanel()')).not.toThrow();
      expect(h.scorePanelEl.innerHTML).toContain('player_b:#1');
      expect(h.scorePanelEl.innerHTML).toContain('player_a:#99');
    });
  });
}
