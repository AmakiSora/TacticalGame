import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('control page', () => {
  it('contains the automation controls and scripts', () => {
    const html = read('public/control.html');

    expect(html).toContain('<script src="/control.js"></script>');
    expect(html).toContain('id="btn-start"');
    expect(html).toContain('id="btn-pause"');
    expect(html).toContain('id="btn-resume"');
    expect(html).toContain('id="map-id"');
    expect(html).toContain('id="manual-side"');
    expect(html).toContain('id="log-output"');
  });

  it('contains the two-tab operations dashboard structure', () => {
    const html = read('public/control.html');

    expect(html).toContain('id="tab-monitor"');
    expect(html).toContain('id="tab-config"');
    expect(html).toContain('id="panel-monitor"');
    expect(html).toContain('id="panel-config"');
    expect(html).toContain('id="log-search"');
    expect(html).toContain('id="config-dirty"');
    expect(html).toContain('id="status-message"');
    expect(html).toContain('运行监控');
    expect(html).toContain('配置管理');
  });

  it('sends the control token header from the browser API wrapper', () => {
    const source = read('public/control.js');

    expect(source).toContain('x-control-token');
    expect(source).toContain('localStorage');
    expect(source).toContain('/api/control/status');
    expect(source).toContain('/api/control/manual');
  });

  it('saves the latest config before starting the controller', () => {
    const source = read('public/control.js');

    expect(source).toContain('async function saveConfig');
    expect(source).toContain("await saveConfig({ silent: true })");
    expect(source).toContain("await api('/api/control/start', { method: 'POST' })");
  });

  it('filters logs by both level and search text', () => {
    const source = read('public/control.js');

    expect(source).toContain("document.getElementById('log-search')");
    expect(source).toContain('entry.level === level');
    expect(source).toContain('logSearch');
    expect(source).toContain('message.toLowerCase().includes(query)');
  });

  it('lets operators choose whether logs follow the latest entry', () => {
    const html = read('public/control.html');
    const source = read('public/control.js');

    expect(html).toContain('id="auto-scroll-logs"');
    expect(html).toContain('type="checkbox" checked');
    expect(source).toContain("document.getElementById('auto-scroll-logs')");
    expect(source).toContain('if (autoScrollLogs.checked)');
    expect(source).toContain('logOutput.scrollTop = logOutput.scrollHeight');
  });

  it('updates control button availability from runtime status', () => {
    const source = read('public/control.js');

    expect(source).toContain('function updateControls');
    expect(source).toContain("status === 'running'");
    expect(source).toContain("status === 'paused'");
    expect(source).toContain("status === 'bootstrapping'");
    expect(source).toContain("status === 'stopping'");
  });
});
