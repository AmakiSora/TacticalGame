import { describe, expect, it } from 'vitest';
import {
  buildPiInvocation,
  parseOptions,
  runPi,
  stateFilePath,
} from '../../script/autoRunPiCore.mjs';

describe('autoRunPi options', () => {
  it('requires both player session files', () => {
    const result = parseOptions(['game-1', '--a-session', 'a.json']);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('--a-session');
      expect(result.message).toContain('--b-session');
    }
  });

  it('finds the game id without treating flag values as positional arguments', () => {
    const result = parseOptions([
      '--a-session', 'a.json',
      '--b-session', 'b.json',
      'game-1',
    ]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.options.gameId).toBe('game-1');
    }
  });

  it('rejects missing values for options that require values', () => {
    const result = parseOptions(['game-1', '--a-session', '--b-session', 'b.json']);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('--a-session');
    }
  });

  it('keeps prompts and paths as argument values instead of shell text', () => {
    const invocation = buildPiInvocation({
      provider: 'new-api',
      model: 'step-3.7-flash',
      session: 'sessions/a "quoted".json',
      skill: '.pi/skills/skill',
      prompt: '到你了 && echo bad',
    });

    expect(invocation.command).toBe('pi');
    expect(invocation.args).toEqual([
      '--provider', 'new-api',
      '--model', 'step-3.7-flash',
      '--session', 'sessions/a "quoted".json',
      '--skill', '.pi/skills/skill',
      '-p', '到你了 && echo bad',
    ]);
  });

  it('stores checkpoint files under the script directory with a safe file name', () => {
    expect(stateFilePath('../game:id', 'C:/repo/script')).toBe('C:/repo/script/.autoRun-.._game_id.json');
  });
});

describe('autoRunPi pi execution', () => {
  it('returns false when pi exits unsuccessfully instead of throwing', () => {
    const result = runPi('player_a', buildPiInvocation({
      provider: 'new-api',
      model: 'm',
      session: 'a.json',
      skill: 'skill',
      prompt: 'go',
    }), {
      cwd: 'C:/repo',
      spawnSync: () => ({ status: 2, error: undefined }),
      log: () => {},
      error: () => {},
    });

    expect(result).toBe(false);
  });
});
