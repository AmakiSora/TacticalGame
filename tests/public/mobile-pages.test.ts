import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf-8');
}

describe('mobile website pages', () => {
  it('adds viewport meta and narrow-screen redirects on desktop pages', () => {
    const play = read('public/play.html');
    const spectator = read('public/spectator.html');

    expect(play).toContain('name="viewport"');
    expect(play).toContain('width=device-width');
    expect(play).toContain('/play-m.html');
    expect(play).toContain("matchMedia('(max-width: 820px)')");

    expect(spectator).toContain('name="viewport"');
    expect(spectator).toContain('/spectator-m.html');
    expect(spectator).toContain("matchMedia('(max-width: 820px)')");
  });

  it('ships independent mobile shells with board-first chrome', () => {
    const play = read('public/play-m.html');
    const spectator = read('public/spectator-m.html');

    expect(play).toContain('name="viewport"');
    expect(play).toContain('class="player-m-shell"');
    expect(play).toContain('id="bottom-bar"');
    expect(play).toContain('id="board-viewport"');
    expect(play).toContain('id="board-world"');
    expect(play).toContain('id="drawer"');
    expect(play).toContain('id="btn-cancel"');
    expect(play).toContain('id="btn-end-turn-bar"');
    expect(play).toContain('href="/play-m.css"');
    expect(play).toContain('/play-m.js');

    expect(spectator).toContain('name="viewport"');
    expect(spectator).toContain('class="spectator-m-shell"');
    expect(spectator).toContain('id="bottom-bar"');
    expect(spectator).toContain('id="board-viewport"');
    expect(spectator).toContain('id="replay-bar"');
    expect(spectator).toContain('id="drawer"');
    expect(spectator).toContain('href="/spectator-m.css"');
    expect(spectator).toContain('/spectator-m.js');
  });

  it('implements pointer pan/pinch and board transform on mobile scripts', () => {
    for (const file of ['public/play-m.js', 'public/spectator-m.js']) {
      const source = read(file);
      expect(source).toContain('pointerdown');
      expect(source).toContain('setBoardTransform');
      expect(source).toContain('fitBoardToViewport');
      expect(source).toContain('boardScale');
      expect(source).toContain('TAP_MOVE_THRESHOLD');
      expect(source).toContain('openDrawer');
    }
    expect(read('public/play-m.js')).toContain('handleBoardTap');
    expect(read('public/play-m.js')).toContain('btn-end-turn-bar');
    expect(read('public/spectator-m.js')).toContain('renderDrawerGameList');
  });

  it('keeps desktop shells intact for existing optimization tests', () => {
    const play = read('public/play.html');
    const spectator = read('public/spectator.html');
    expect(play).toContain('class="player-shell"');
    expect(spectator).toContain('class="spectator-shell"');
    expect(play).not.toContain('player-m-shell');
    expect(spectator).not.toContain('spectator-m-shell');
  });
});
