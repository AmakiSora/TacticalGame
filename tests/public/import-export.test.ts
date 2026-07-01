import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appJs = () => readFileSync('public/app.js', 'utf-8');
const versionJs = () => readFileSync('public/version.js', 'utf-8');

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
    expect(source).toContain('导入失败');
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
});
