import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appJs = () => readFileSync('public/app.js', 'utf-8');
const versionJs = () => readFileSync('public/version.js', 'utf-8');
const expectedAppVersion = '3.4.7';

describe('spectator import/export', () => {
  it('exports replay metadata with events and final result', () => {
    const source = appJs();

    expect(source).toContain('function buildReplayExport');
    expect(source).toContain('REPLAY_EXPORT_FORMAT');
    expect(source).toContain("APP_VERSION = window.APP_VERSION");
    expect(source).toContain('REPLAY_SCHEMA_VERSION = APP_VERSION');
    expect(source).toContain('format: REPLAY_EXPORT_FORMAT');
    expect(source).toContain('schemaVersion');
    expect(source).toContain('finalResult');
    expect(source).not.toMatch(/APP_VERSION = '\d+\.\d+\.\d+'/);
  });

  it('imports both replay objects and raw event arrays with validation', () => {
    const source = appJs();

    expect(source).toContain('function normalizeImportedReplay');
    expect(source).toContain('Array.isArray(data) ? data : data.events');
    expect(source).toContain('compareSemver(schemaVersion, REPLAY_SCHEMA_VERSION) > 0');
    expect(source).toContain('seq 重复或乱序');
    expect(source).toContain('回放包含不兼容的旧版 game_start 数据');
    expect(source).toContain('导入失败');
  });

  it('preserves imported replay metadata when exporting again', () => {
    const source = appJs();
    expect(source).toContain('importedReplayMeta');
    expect(source).toContain('gameId: importedReplayMeta?.gameId');
    expect(source).toContain('mapId: importedReplayMeta?.mapId');
    expect(source).toContain('finalResult: importedReplayMeta?.finalResult');
  });

  it('only exposes JSON replay export from the spectator page', () => {
    const html = readFileSync('public/spectator.html', 'utf-8');
    const source = appJs();

    expect(html).not.toContain('id="btn-export-html"');
    expect(source).not.toContain('function exportHtml');
    expect(source).not.toContain('btnExportHtml');
    expect(source).not.toContain('window.EMBEDDED_REPLAY=');
    expect(source).not.toContain('window.APP_VERSION=${JSON.stringify(APP_VERSION)}');
    expect(source).toContain('function exportJson');
    expect(source).not.toMatch(/version-badge">v\d+\.\d+\.\d+/);
  });

  it('defines the browser application version in one static file', () => {
    const source = versionJs();

    expect(source).toMatch(/window\.APP_VERSION = '\d+\.\d+\.\d+';/);
  });

  it('keeps every current application version source synchronized', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf-8'));
    const packageLock = JSON.parse(readFileSync('package-lock.json', 'utf-8'));
    const readme = readFileSync('README.md', 'utf-8');
    const skill = readFileSync('skill/SKILL.md', 'utf-8');

    expect(packageJson.version).toBe(expectedAppVersion);
    expect(packageLock.version).toBe(expectedAppVersion);
    expect(packageLock.packages[''].version).toBe(expectedAppVersion);
    expect(versionJs()).toContain(`window.APP_VERSION = '${expectedAppVersion}';`);
    expect(readme).toContain(`当前版本：\`${expectedAppVersion}\``);
    expect(skill).toContain(`app version \`${expectedAppVersion}\``);
  });
});
