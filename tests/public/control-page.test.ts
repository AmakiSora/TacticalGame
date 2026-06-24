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

  it('sends the control token header from the browser API wrapper', () => {
    const source = read('public/control.js');

    expect(source).toContain('x-control-token');
    expect(source).toContain('localStorage');
    expect(source).toContain('/api/control/status');
    expect(source).toContain('/api/control/manual');
  });
});
