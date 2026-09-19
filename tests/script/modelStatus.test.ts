import { describe, expect, it } from 'vitest';
import { isExpiredModel, parseModelStatus, versionOfModelFile } from '../../script/modelStatus.mjs';

const EXPIRED_FILE = 'hex_ppo_v2.3.2_20260829_random_selfplay_800000.zip';

const validEntry = {
  version: 'v2.3.2',
  file: EXPIRED_FILE,
  expiredAt: '2026-09-19',
  reason: '全图沉底，无突出图',
};

const doc = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ note: '登记表', expired: [{ ...validEntry, ...extra }] });

describe('versionOfModelFile', () => {
  it('从交付文件名里取出版本段', () => {
    expect(versionOfModelFile(EXPIRED_FILE)).toBe('v2.3.2');
    expect(versionOfModelFile('hex_ppo_v3.2.0_20260918_random_selfplay_10000000.zip')).toBe('v3.2.0');
  });

  it('不符合交付命名规范的文件返回 null（不发散匹配）', () => {
    expect(versionOfModelFile('hex_ppo_v3.0.1_20260904_distilled.zip')).toBe('v3.0.1');
    expect(versionOfModelFile('random.zip')).toBeNull();
    expect(versionOfModelFile('')).toBeNull();
    expect(versionOfModelFile(undefined as unknown as string)).toBeNull();
  });
});

describe('parseModelStatus', () => {
  it('解析出规范化的过期条目并保留说明', () => {
    const { entries, note } = parseModelStatus(doc({ evidence: '各图名次 21/22' }));
    expect(note).toBe('登记表');
    expect(entries).toEqual([{
      version: 'v2.3.2',
      file: EXPIRED_FILE,
      expiredAt: '2026-09-19',
      reason: '全图沉底，无突出图',
      evidence: '各图名次 21/22',
    }]);
  });

  it('evidence 留空规范化成 null（不是空串）', () => {
    const { entries } = parseModelStatus(doc({ evidence: '   ' }));
    expect(entries[0].evidence).toBeNull();
  });

  it('非法结构直接抛错，不静默降级（否则过期模型会悄悄回到评估池）', () => {
    expect(() => parseModelStatus('{ not json')).toThrow(/不是合法 JSON/);
    expect(() => parseModelStatus(JSON.stringify({ expired: null }))).toThrow(/缺少顶层 expired 数组/);
    expect(() => parseModelStatus(doc({ version: '2.3.2' }))).toThrow(/version 需形如/);
    expect(() => parseModelStatus(doc({ file: 'hex_ppo_v3.0.0_20260903_random_selfplay_3000000.zip' })))
      .toThrow(/file 的版本段与 version 不一致/);
    expect(() => parseModelStatus(doc({ expiredAt: '2026/09/19' }))).toThrow(/expiredAt 需形如/);
    expect(() => parseModelStatus(doc({ reason: '  ' }))).toThrow(/reason 不能为空/);
  });

  it('同一版本重复登记要报错', () => {
    const dup = JSON.stringify({ expired: [validEntry, { ...validEntry, reason: '再来一次' }] });
    expect(() => parseModelStatus(dup)).toThrow(/重复登记/);
  });
});

describe('isExpiredModel', () => {
  const entries = [{
    version: 'v2.3.2', file: EXPIRED_FILE, expiredAt: '2026-09-19', reason: 'x', evidence: null,
  }];

  it('既接受完整文件名也接受纯版本号', () => {
    expect(isExpiredModel(EXPIRED_FILE, entries)).toBe(true);
    expect(isExpiredModel('v2.3.2', entries)).toBe(true);
    expect(isExpiredModel('hex_ppo_v2.2.0_20260827_default_modelmix_best.zip', entries)).toBe(false);
    expect(isExpiredModel('random.zip', entries)).toBe(false);
  });
});
