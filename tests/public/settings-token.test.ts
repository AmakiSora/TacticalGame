import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('settings token input', () => {
  it('lets spectator settings save a control token', () => {
    const html = read('public/spectator.html');
    const source = read('public/app.js');
    const css = read('public/style.css');

    expect(html).toContain('id="settings-control-token"');
    expect(html).toContain('id="btn-save-control-token"');
    expect(html).toContain('type="password"');
    expect(source).toContain("localStorage.setItem('autoControlToken'");
    expect(source).toContain("localStorage.getItem('autoControlToken')");
    expect(source).toContain('settings-control-token');
    expect(source).toContain('btn-save-control-token');
    expect(css).toContain('.setting-field');
  });

  it('lets play settings manage control token and full session restore', () => {
    const html = read('public/play.html');
    const source = read('public/play.js');
    const css = read('public/play.css');

    expect(html).toContain('id="btn-settings"');
    expect(html).toContain('id="settings-popover"');
    expect(html).toContain('id="settings-control-token"');
    expect(html).toContain('id="btn-save-control-token"');
    expect(html).toContain('id="settings-game-id"');
    expect(html).toContain('id="settings-player-token"');
    expect(html).toContain('id="settings-host-token"');
    expect(html).toContain('id="btn-save-session"');
    expect(html).toContain('id="btn-enter-session"');
    expect(html).toContain('id="btn-clear-session"');

    expect(source).toContain("localStorage.setItem('autoControlToken'");
    expect(source).toContain("localStorage.getItem('autoControlToken')");
    expect(source).toContain("localStorage.getItem('tacticalGame.session')");
    expect(source).toContain("localStorage.removeItem('tacticalGame.session')");
    expect(source).toContain('function saveControlToken');
    expect(source).toContain('function saveSessionFromSettings');
    expect(source).toContain('function clearSessionFromSettings');
    expect(source).toContain('function enterGameFromSettings');
    expect(source).toContain('function fillSettingsFromSession');

    expect(css).toContain('#settings-wrap');
    expect(css).toContain('#settings-popover');
    expect(css).toContain('.setting-field');
  });
});
