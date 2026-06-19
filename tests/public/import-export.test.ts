import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appJs = () => readFileSync('public/app.js', 'utf-8');

describe('spectator import/export', () => {
  it('exports replay metadata with events and final result', () => {
    const source = appJs();

    expect(source).toContain('function buildReplayExport');
    expect(source).toContain('REPLAY_EXPORT_FORMAT');
    expect(source).toContain("APP_VERSION = '2.1.1'");
    expect(source).toContain('REPLAY_SCHEMA_VERSION = APP_VERSION');
    expect(source).toContain('format: REPLAY_EXPORT_FORMAT');
    expect(source).toContain('schemaVersion');
    expect(source).toContain('finalResult');
  });

  it('imports both replay objects and raw event arrays with validation', () => {
    const source = appJs();

    expect(source).toContain('function normalizeImportedReplay');
    expect(source).toContain('Array.isArray(data) ? data : data.events');
    expect(source).toContain('compareSemver(schemaVersion, REPLAY_SCHEMA_VERSION) > 0');
    expect(source).toContain('导入失败');
  });

  it('keeps the score panel in exported standalone HTML', () => {
    const source = appJs();

    expect(source).toContain('<section id="score-panel"></section>');
    expect(source).toContain('window.EMBEDDED_REPLAY=');
  });
});
