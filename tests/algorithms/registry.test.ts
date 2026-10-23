// tests/algorithms/registry.test.ts
// 注册表模式声明的完整性：每个注册算法都必须声明支持的对局模式（modes），
// 全链路（大厅 bot 接口 / runner / 评估 decide 通道 / 跑批发现）按它隔离模式。
import { describe, expect, it } from 'vitest';
// @ts-expect-error 注册表为 ESM .mjs，类型声明见 registry.d.mts
import {
  ALGORITHMS,
  ALGORITHM_META,
  algorithmModes,
  algorithmSupportsMode,
  getAlgorithmMeta,
  listAlgorithmInfo,
} from '../../algorithms/registry.mjs';

const KNOWN_MODES = ['standard', 'simultaneous', 'annihilation', 'royale'];

describe('algorithm registry modes', () => {
  it('declares a non-empty modes list for every registered algorithm', () => {
    for (const name of Object.keys(ALGORITHMS)) {
      const modes = ALGORITHM_META[name]?.modes;
      expect(modes, `algorithm "${name}" must declare modes`).toBeTruthy();
      expect(modes.length).toBeGreaterThan(0);
      for (const mode of modes) {
        expect(KNOWN_MODES).toContain(mode);
      }
    }
  });

  it('exposes modes through listAlgorithmInfo and getAlgorithmMeta', () => {
    const info = listAlgorithmInfo().find(i => i.name === 'random-sim');
    expect(info?.modes).toEqual(['simultaneous']);
    expect(getAlgorithmMeta('random-sim')?.modes).toEqual(['simultaneous']);
    const destProb = listAlgorithmInfo().find(i => i.name === 'dest-prob');
    expect(destProb?.modes).toEqual(['simultaneous']);
    expect(destProb?.displayName).toBe('落点概率算法');
    expect(destProb?.version).toBe('v2');
    expect(getAlgorithmMeta('dest-prob')?.modes).toEqual(['simultaneous']);
    expect(getAlgorithmMeta('dest-prob')?.version).toBe('v2');
    const matrixEq = listAlgorithmInfo().find(i => i.name === 'matrix-eq');
    expect(matrixEq?.modes).toEqual(['simultaneous']);
    expect(matrixEq?.displayName).toBe('矩阵均衡算法');
    expect(getAlgorithmMeta('matrix-eq')?.modes).toEqual(['simultaneous']);
    expect(getAlgorithmMeta('greedy')?.modes).toEqual(['standard']);
  });

  it('defaults unregistered/undeclared algorithms to standard mode', () => {
    expect(algorithmModes('no-such-algorithm')).toEqual(['standard']);
  });

  it('answers supports-mode queries per registry declaration', () => {
    expect(algorithmSupportsMode('random-sim', 'simultaneous')).toBe(true);
    expect(algorithmSupportsMode('random-sim', 'standard')).toBe(false);
    expect(algorithmSupportsMode('dest-prob', 'simultaneous')).toBe(true);
    expect(algorithmSupportsMode('dest-prob', 'standard')).toBe(false);
    expect(algorithmSupportsMode('matrix-eq', 'simultaneous')).toBe(true);
    expect(algorithmSupportsMode('matrix-eq', 'standard')).toBe(false);
    expect(algorithmSupportsMode('greedy', 'standard')).toBe(true);
    expect(algorithmSupportsMode('greedy', 'simultaneous')).toBe(false);
  });
});
