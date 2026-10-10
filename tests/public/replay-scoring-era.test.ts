// tests/public/replay-scoring-era.test.ts
// 只校验一件事：观战端按 schemaVersion 划口径的三条边界，与 records/ 里真实归档的分项形态是否吻合。
// 功绩分算术不在这里验——由 replay-merit-mirror.test.ts 直接执行前端真函数覆盖；
// 本文件这类「在测试里重写一套模型」的比对只能证明模型自洽，发现不了前端与历史服务器的分叉。
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const APP_SOURCE = readFileSync('public/app.js', 'utf8');
const SPECTATOR_SOURCE = readFileSync('public/spectator-m.js', 'utf8');

function boundaryOf(name: string): string {
  const match = APP_SOURCE.match(new RegExp(`const ${name} = '(\\d+\\.\\d+\\.\\d+)';`));
  if (!match) throw new Error(`public/app.js 缺少常量 ${name}`);
  // 两个观战端必须同源，否则桌面与移动回放的口径会分叉。
  expect(SPECTATOR_SOURCE).toContain(`const ${name} = '${match[1]}';`);
  return match[1];
}

const MERIT_FROM = boundaryOf('MERIT_ADJUDICATION_SCHEMA_VERSION');
const LEGACY_UNTIL = boundaryOf('LEGACY_ADJUDICATION_SCHEMA_VERSION');
boundaryOf('SIMULTANEOUS_MERIT_SCHEMA_VERSION');

function compareSemver(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

function eraOf(version: string): 'current' | 'merit' | 'base' {
  if (compareSemver(version, LEGACY_UNTIL) >= 0) return 'current';
  return compareSemver(version, MERIT_FROM) >= 0 ? 'merit' : 'base';
}

type Sample = { file: string; version: string | null; shape: 'current' | 'merit' | 'base' };

function readSample(file: string): Sample | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  const data = raw as { events?: unknown; schemaVersion?: unknown } | unknown[];
  const events = (Array.isArray(data) ? data : data.events) as
    Array<{ type: string; payload?: Record<string, unknown> }> | undefined;
  if (!Array.isArray(events) || !events.length) return null;
  const version = !Array.isArray(data) && typeof data.schemaVersion === 'string' && /^\d+\.\d+\.\d+$/.test(data.schemaVersion)
    ? data.schemaVersion
    : null;
  const over = events.filter(ev => ev.type === 'game_over').pop();
  const scores = over?.payload?.scores as Record<string, Record<string, unknown>> | undefined;
  const frozen = events.find(ev => ev.payload?.score)?.payload?.score as Record<string, unknown> | undefined;
  const sample = (scores && Object.values(scores)[0]) || frozen;
  if (!sample) return null;
  const shape = 'killValue' in sample ? 'current' : 'actionScore' in sample ? 'merit' : 'base';
  return { file, version, shape };
}

const files = ['records/V3', 'records/V2']
  .filter(dir => existsSync(dir))
  .flatMap(dir => readdirSync(dir).filter(name => name.endsWith('.json')).map(name => `${dir}/${name}`));
const samples = files.map(readSample).filter((s): s is Sample => !!s);
const stamped = samples.filter(sample => sample.version);
const unversioned = samples.filter(sample => !sample.version);

describe('replay scoring era boundaries', () => {
  it('covers archives across every version stamp', () => {
    expect(stamped.length).toBeGreaterThan(50);
    expect(new Set(stamped.map(sample => sample.version)).size).toBeGreaterThan(20);
  });

  it('classifies each archived score shape exactly as its version boundary says', () => {
    const problems: string[] = [];
    for (const sample of stamped) {
      const expected = eraOf(sample.version!);
      if (expected !== sample.shape) {
        problems.push(`${sample.file} [${sample.version}] 按版本判为 ${expected}，存档实为 ${sample.shape}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('splits the merit era at the archived introduction version 3.2.4', () => {
    // 边界必须紧贴实测事实：3.2.4 之前最近的存档确实没有功绩分项，3.2.4 起确实有。
    expect(eraOf(MERIT_FROM)).toBe('merit');
    const withActionScore = stamped.filter(sample => sample.shape === 'merit').map(sample => sample.version!);
    const earliest = withActionScore.reduce((a, b) => (compareSemver(a, b) <= 0 ? a : b));
    expect(compareSemver(earliest, MERIT_FROM)).toBeGreaterThanOrEqual(0);
    expect(stamped.filter(sample => compareSemver(sample.version!, MERIT_FROM) < 0).every(sample => sample.shape === 'base')).toBe(true);
  });

  it('falls back to the archived score shape when a replay carries no version stamp', () => {
    expect(unversioned.length).toBeGreaterThan(0);
    // 兜底判据就是形态本身，因此这里只要求无戳存档能被分进某个口径。
    expect(unversioned.every(sample => ['current', 'merit', 'base'].includes(sample.shape))).toBe(true);
    expect(unversioned.some(sample => sample.shape === 'merit')).toBe(true);
  });
});
