import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GameEvent, PlayerId } from '../types.js';
import { globalEventBus } from '../events/bus.js';
import { globalStore, createInitialGame } from '../state/store.js';
import { joinGame } from '../engine/engine.js';

export type ControlStatus = 'idle' | 'bootstrapping' | 'running' | 'paused' | 'stopping' | 'stopped' | 'game_over' | 'error';
export type LogLevel = 'info' | 'warn' | 'error';
export type CommandMode = 'fields' | 'advanced';

export interface PlayerCommandConfig {
  provider: string;
  model: string;
  name: string;
  session: string;
  skill: string;
  prompt: string;
  startPrompt: string;
  commandMode: CommandMode;
  advancedCommand: string;
}

export interface AutoControlConfig {
  gameId: string | null;
  bootstrap: boolean;
  mapId: string;
  intervalSeconds: number;
  timeoutSeconds: number;
  players: Record<PlayerId, PlayerCommandConfig>;
}

export interface CommandInvocation {
  command: string;
  args: string[];
}

export interface RunnerResult {
  code: number | null;
  output: string;
}

export type CommandRunner = (invocation: CommandInvocation) => Promise<RunnerResult>;

export interface ControlLogEntry {
  seq: number;
  timestamp: number;
  level: LogLevel;
  message: string;
}

export interface ControllerOptions {
  runtimeDir?: string;
  runner?: CommandRunner;
  eventBus?: { subscribe(gameId: string, handler: (event: GameEvent) => void): () => void };
}

const PROJECT_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const DEFAULT_RUNTIME_DIR = join(PROJECT_ROOT, 'runtime', 'auto-control');
const DEFAULT_SKILL = '.pi/skills/skill';

export function parseCommandLine(line: string): CommandInvocation {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaping = false;

  const chars = [...line.trim()];
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }
    if (ch === '\\') {
      const next = chars[i + 1];
      if (!quote && next && /\s/.test(next)) {
        escaping = true;
      } else if (quote === '"' && (next === '"' || next === '\\')) {
        escaping = true;
      } else {
        current += ch;
      }
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (escaping) current += '\\';
  if (quote) throw new Error('unterminated quote');
  if (current) tokens.push(current);
  if (tokens.length === 0) throw new Error('empty command');
  return { command: tokens[0], args: tokens.slice(1) };
}

function defaultPlayer(side: PlayerId): PlayerCommandConfig {
  return {
    provider: side === 'player_a' ? 'new-api' : 'deepseek',
    model: side === 'player_a' ? 'step-3.7-flash' : 'deepseekv4flash',
    name: side === 'player_a' ? 'tactical-game-player-a' : 'tactical-game-player-b',
    session: side === 'player_a' ? '.pi/session/player-a.jsonl' : '.pi/session/player-b.jsonl',
    skill: DEFAULT_SKILL,
    prompt: '到你了',
    startPrompt: side === 'player_a'
      ? '你是 player_a，gameId:{gameId}，token:{token}。你叫{name}，现在开始认真思考并进行你的回合。'
      : '你是 player_b，gameId:{gameId}，token:{token}。你叫{name}，等待并在轮到你时认真思考行动。',
    commandMode: 'fields',
    advancedCommand: '',
  };
}

function defaultConfig(): AutoControlConfig {
  return {
    gameId: null,
    bootstrap: true,
    mapId: 'default',
    intervalSeconds: 2,
    timeoutSeconds: 10,
    players: {
      player_a: defaultPlayer('player_a'),
      player_b: defaultPlayer('player_b'),
    },
  };
}

function mergePlayer(base: PlayerCommandConfig, patch?: Partial<PlayerCommandConfig>): PlayerCommandConfig {
  return { ...base, ...(patch ?? {}) };
}

function mergeConfig(base: AutoControlConfig, patch: Partial<AutoControlConfig>): AutoControlConfig {
  return {
    ...base,
    ...patch,
    players: {
      player_a: mergePlayer(base.players.player_a, patch.players?.player_a),
      player_b: mergePlayer(base.players.player_b, patch.players?.player_b),
    },
  };
}

function defaultRunner(invocation: CommandInvocation): Promise<RunnerResult> {
  return new Promise(resolve => {
    const resolved = resolveCommandInvocation(invocation);
    const child = spawn(resolved.command, resolved.args, {
      cwd: PROJECT_ROOT,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', data => { output += data.toString(); });
    child.stderr.on('data', data => { output += data.toString(); });
    child.on('error', err => resolve({ code: 1, output: err.message }));
    child.on('close', code => resolve({ code, output }));
  });
}

export function resolveCommandInvocation(invocation: CommandInvocation, piCliPath?: string): CommandInvocation {
  if (invocation.command !== 'pi') return invocation;
  const cliPath = piCliPath ?? (
    process.env.APPDATA
      ? join(process.env.APPDATA, 'npm', 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js')
      : ''
  );
  if (!cliPath || !existsSync(cliPath)) return invocation;
  return { command: process.execPath, args: [cliPath, ...invocation.args] };
}

export class AutoControlController {
  private runtimeDir: string;
  private configFile: string;
  private stateFile: string;
  private logFile: string;
  private runner: CommandRunner;
  private eventBus: { subscribe(gameId: string, handler: (event: GameEvent) => void): () => void };
  private unsubscribe: (() => void) | null = null;
  private config: AutoControlConfig;
  private status: ControlStatus = 'idle';
  private runningChild: string | null = null;
  private lastSeq = 0;
  private lastLogSeq = 0;
  private logs: ControlLogEntry[] = [];
  private stopped = false;

  constructor(options: ControllerOptions = {}) {
    this.runtimeDir = options.runtimeDir ?? process.env.AUTO_CONTROL_RUNTIME_DIR ?? DEFAULT_RUNTIME_DIR;
    this.configFile = join(this.runtimeDir, 'config.json');
    this.stateFile = join(this.runtimeDir, 'state.json');
    this.logFile = join(this.runtimeDir, 'logs.jsonl');
    this.runner = options.runner ?? defaultRunner;
    this.eventBus = options.eventBus ?? globalEventBus;
    mkdirSync(this.runtimeDir, { recursive: true });
    this.config = this.readConfig();
    this.readState();
    this.readLogs();
  }

  getConfig(): AutoControlConfig {
    return JSON.parse(JSON.stringify(this.config));
  }

  async updateConfig(patch: Partial<AutoControlConfig>): Promise<AutoControlConfig> {
    this.config = mergeConfig(this.config, patch);
    this.writeConfig();
    this.log('info', 'config saved');
    return this.getConfig();
  }

  getStatus() {
    return {
      status: this.status,
      gameId: this.config.gameId,
      paused: this.status === 'paused',
      runningChild: this.runningChild,
      lastSeq: this.lastSeq,
      logs: this.logs.slice(-100),
      config: this.getConfig(),
    };
  }

  async start(): Promise<{ gameId: string | null }> {
    if (this.status === 'running' || this.status === 'paused' || this.status === 'bootstrapping') {
      throw new Error('already running');
    }
    this.stopped = false;
    this.status = this.config.bootstrap ? 'bootstrapping' : 'running';
    this.persistState();
    this.log('info', 'control start');

    if (this.config.bootstrap) {
      const game = createInitialGame(randomUUID(), this.config.mapId);
      game.playerNames.player_a = this.config.players.player_a.name;
      globalStore.save(game);
      const joined = joinGame(game, globalEventBus, this.config.players.player_b.name);
      if (!joined.ok) throw this.fail(joined.message);
      this.config.gameId = game.id;
      this.writeConfig();
      this.log('info', `bootstrap gameId=${game.id}`);
      const aPrompt = this.renderPrompt(this.config.players.player_a.startPrompt, 'player_a');
      const bPrompt = this.renderPrompt(this.config.players.player_b.startPrompt, 'player_b');
      const startedA = await this.runForSide('player_a', aPrompt);
      if (startedA.code !== 0) throw this.fail('player_a start prompt failed');
      const startedB = await this.runForSide('player_b', bPrompt);
      if (startedB.code !== 0) throw this.fail('player_b start prompt failed');
    }

    this.status = 'running';
    this.subscribeToGame();
    this.persistState();
    return { gameId: this.config.gameId };
  }

  async pause(): Promise<void> {
    if (this.status === 'running') {
      this.status = 'paused';
      this.persistState();
      this.log('info', 'control paused');
    }
  }

  async resume(): Promise<void> {
    if (this.status === 'paused') {
      this.status = 'running';
      this.persistState();
      this.log('info', 'control resumed');
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.status = 'stopped';
    this.persistState();
    this.log('info', 'control stopped');
  }

  async manual(side: PlayerId, prompt: string): Promise<RunnerResult> {
    const result = await this.runForSide(side, this.renderPrompt(prompt, side));
    this.log(result.code === 0 ? 'info' : 'error', `manual ${side} exit=${result.code}`);
    return result;
  }

  async handleGameEvent(event: GameEvent): Promise<void> {
    this.lastSeq = Math.max(this.lastSeq, event.seq);
    if (event.type === 'game_over') {
      this.status = 'game_over';
      this.unsubscribe?.();
      this.unsubscribe = null;
      this.persistState();
      this.log('info', 'game over');
      return;
    }
    if (this.status !== 'running' || this.stopped || event.type !== 'turn_end') {
      this.persistState();
      return;
    }
    const previousOwner = event.payload.previousOwner;
    if (previousOwner === 'player_b') await this.runForSide('player_a', this.renderPrompt(this.config.players.player_a.prompt, 'player_a'));
    if (previousOwner === 'player_a') await this.runForSide('player_b', this.renderPrompt(this.config.players.player_b.prompt, 'player_b'));
    this.persistState();
  }

  getLogs(after = 0): ControlLogEntry[] {
    if (existsSync(this.logFile)) {
      return readFileSync(this.logFile, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .map(line => JSON.parse(line) as ControlLogEntry)
        .filter(entry => entry.seq > after);
    }
    return this.logs.filter(entry => entry.seq > after);
  }

  log(level: LogLevel, message: string): ControlLogEntry {
    const entry = { seq: ++this.lastLogSeq, timestamp: Date.now(), level, message };
    this.logs.push(entry);
    if (this.logs.length > 500) this.logs.shift();
    appendFileSync(this.logFile, `${JSON.stringify(entry)}\n`);
    return entry;
  }

  private async runForSide(side: PlayerId, prompt: string): Promise<RunnerResult> {
    const invocation = this.buildInvocation(side, prompt);
    this.runningChild = `${side}: ${invocation.command} ${invocation.args.join(' ')}`;
    this.persistState();
    this.log('info', `run ${this.runningChild}`);
    const result = await this.runner(invocation);
    if (result.output.trim()) this.log(result.code === 0 ? 'info' : 'error', result.output.trim());
    this.runningChild = null;
    this.persistState();
    return result;
  }

  private subscribeToGame(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (!this.config.gameId) return;
    this.unsubscribe = this.eventBus.subscribe(this.config.gameId, event => {
      void this.handleGameEvent(event).catch(err => {
        this.status = 'error';
        this.log('error', err.message);
        this.persistState();
      });
    });
  }

  private buildInvocation(side: PlayerId, prompt: string): CommandInvocation {
    const player = this.config.players[side];
    if (player.commandMode === 'advanced' && player.advancedCommand.trim()) {
      return parseCommandLine(player.advancedCommand.replaceAll('{prompt}', prompt).replaceAll('{gameId}', this.config.gameId ?? ''));
    }
    return {
      command: 'pi',
      args: [
        '--provider', player.provider,
        '--model', player.model,
        '--name', player.name,
        '--session', player.session,
        '--skill', player.skill,
        '-p', prompt,
      ],
    };
  }

  private renderPrompt(prompt: string, side: PlayerId): string {
    const token = this.config.gameId ? (globalStore.get(this.config.gameId)?.tokens[side] ?? '') : '';
    return prompt
      .replaceAll('{gameId}', this.config.gameId ?? '')
      .replaceAll('{token}', token)
      .replaceAll('{side}', side)
      .replaceAll('{owner}', side)
      .replaceAll('{name}', this.config.players[side].name);
  }

  private fail(message: string): Error {
    this.status = 'error';
    this.persistState();
    this.log('error', message);
    return new Error(message);
  }

  private readConfig(): AutoControlConfig {
    if (!existsSync(this.configFile)) return defaultConfig();
    return mergeConfig(defaultConfig(), JSON.parse(readFileSync(this.configFile, 'utf8')) as Partial<AutoControlConfig>);
  }

  private writeConfig(): void {
    writeFileSync(this.configFile, `${JSON.stringify(this.config, null, 2)}\n`);
  }

  private readState(): void {
    if (!existsSync(this.stateFile)) return;
    const state = JSON.parse(readFileSync(this.stateFile, 'utf8')) as { status?: ControlStatus; lastSeq?: number; lastLogSeq?: number };
    this.status = state.status ?? 'idle';
    this.lastSeq = state.lastSeq ?? 0;
    this.lastLogSeq = state.lastLogSeq ?? 0;
  }

  private persistState(): void {
    writeFileSync(this.stateFile, `${JSON.stringify({
      status: this.status,
      lastSeq: this.lastSeq,
      lastLogSeq: this.lastLogSeq,
      runningChild: this.runningChild,
    }, null, 2)}\n`);
  }

  private readLogs(): void {
    if (!existsSync(this.logFile)) return;
    this.logs = readFileSync(this.logFile, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line) as ControlLogEntry)
      .slice(-500);
    const last = this.logs.at(-1);
    if (last) this.lastLogSeq = Math.max(this.lastLogSeq, last.seq);
  }
}
