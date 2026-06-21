#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const DEFAULT_URL = 'http://localhost:3100';

function cliName(key) {
  return key.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`);
}

export function parseArgs(argv) {
  const args = {
    url: DEFAULT_URL,
    map: 'default',
    game: '',
    aToken: '',
    bToken: '',
    aName: 'Pi A',
    bName: 'Pi B',
    aModel: '',
    bModel: '',
    aProvider: '',
    bProvider: '',
    aPi: '',
    bPi: '',
    sessionDir: '',
    aSessionId: '',
    bSessionId: '',
    maxRounds: 20,
    maxCallsPerTurn: 3,
    delayMs: 1000,
    timeoutMs: 300000,
    logDir: 'records/pi-runs',
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[++i];
    };

    if (arg === '--url') args.url = next();
    else if (arg === '--map') args.map = next();
    else if (arg === '--game') args.game = next();
    else if (arg === '--a-token') args.aToken = next();
    else if (arg === '--b-token') args.bToken = next();
    else if (arg === '--a-name') args.aName = next();
    else if (arg === '--b-name') args.bName = next();
    else if (arg === '--a-model') args.aModel = next();
    else if (arg === '--b-model') args.bModel = next();
    else if (arg === '--a-provider') args.aProvider = next();
    else if (arg === '--b-provider') args.bProvider = next();
    else if (arg === '--a-pi') args.aPi = next();
    else if (arg === '--b-pi') args.bPi = next();
    else if (arg === '--session-dir') args.sessionDir = next();
    else if (arg === '--a-session-id') args.aSessionId = next();
    else if (arg === '--b-session-id') args.bSessionId = next();
    else if (arg === '--max-rounds') args.maxRounds = Number(next());
    else if (arg === '--max-calls-per-turn') args.maxCallsPerTurn = Number(next());
    else if (arg === '--delay-ms') args.delayMs = Number(next());
    else if (arg === '--timeout-ms') args.timeoutMs = Number(next());
    else if (arg === '--log-dir') args.logDir = next();
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  args.url = args.url.replace(/\/+$/, '');
  for (const key of ['maxRounds', 'maxCallsPerTurn']) {
    if (!Number.isFinite(args[key]) || args[key] < 1) throw new Error(`--${cliName(key)} must be a positive number`);
  }
  for (const key of ['delayMs', 'timeoutMs']) {
    if (!Number.isFinite(args[key]) || args[key] < 0) throw new Error(`--${cliName(key)} must be a non-negative number`);
  }
  if (args.game && (!args.aToken || !args.bToken)) throw new Error('--game resume requires --a-token and --b-token');
  return args;
}

export function defaultSessionId(gameId, player) {
  return `hexv2-${gameId}-${player}`;
}

function splitCommandLine(line) {
  return line.match(/(?:[^\s"]+|"[^"]*")+/g)?.map(part => part.replace(/^"|"$/g, '')) || [];
}

export function playerOption(args, player, suffix) {
  const prefix = player === 'player_a' ? 'a' : 'b';
  return args[`${prefix}${suffix}`];
}

export function sessionIdFor(args, player, gameId) {
  return playerOption(args, player, 'SessionId') || defaultSessionId(gameId, player);
}

export function buildPiCommand(args, player, gameId, message) {
  const custom = playerOption(args, player, 'Pi');
  const parts = custom ? splitCommandLine(custom) : ['pi'];
  const command = parts[0];
  const commandArgs = parts.slice(1);
  const provider = playerOption(args, player, 'Provider');
  const model = playerOption(args, player, 'Model');

  if (!custom && provider) commandArgs.push('--provider', provider);
  if (!custom && model) commandArgs.push('--model', model);
  if (args.sessionDir) commandArgs.push('--session-dir', args.sessionDir);
  commandArgs.push('--session-id', sessionIdFor(args, player, gameId), '-p', message);
  return { command, args: commandArgs };
}

export function buildFirstPrompt({ baseUrl, gameId, player, token }) {
  return `你正在通过 REST API 玩 Hex V2 战棋。以后这个 Pi 会话会持续复用；收到“到你了”表示轮到你完整行动一回合，收到“继续”表示上次中断或没有交出回合，需要继续完成当前回合。

连接信息：
- API base URL: ${baseUrl}
- gameId: ${gameId}
- 你是: ${player}
- X-Player-Token: ${token}

每次行动前先读取状态：
- GET ${baseUrl}/api/games/${gameId}

可用操作：
- POST /api/games/:id/deploy body {"unitType":"infantry|scout|heavy|ranger|support","fromId":"...","q":0,"r":0}
- POST /api/games/:id/move body {"unitId":"...","q":0,"r":0}
- POST /api/games/:id/attack body {"attackerId":"...","targetId":"..."}
- POST /api/games/:id/heal body {"supportId":"...","targetId":"..."}
- POST /api/games/:id/end-turn body {}

规则摘要：
- 使用尖顶六边形轴坐标 q/r。
- 每回合最多 5 个行动点，首次操作一个单位会激活它，已激活单位可继续完成剩余动作。
- 只能从己方总部或己方据点向相邻空白 plain 格部署。
- 只有 infantry/scout 可占点；击毁敌方总部立即胜利。
- 不要使用 V1 的 build/produce/sell/x/y/墙/矿工概念。

你的任务：如果当前确实轮到你，完成一个合法完整回合，最后必须调用 /api/games/:id/end-turn，除非你已经在本回合击毁总部并使游戏结束。`;
}

export function messageForCall({ firstCall, continuation, firstPrompt }) {
  if (firstCall) return firstPrompt;
  return continuation ? '继续' : '到你了';
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function request(baseUrl, method, path, body, token) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['X-Player-Token'] = token;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(`${method} ${path} failed (${res.status}) ${JSON.stringify(data)}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export async function setupGame(args) {
  if (args.game) {
    return {
      gameId: args.game,
      tokens: { player_a: args.aToken, player_b: args.bToken },
    };
  }

  const created = await request(args.url, 'POST', '/api/games', { mapId: args.map, name: args.aName }, '');
  const joined = await request(args.url, 'POST', `/api/games/${created.gameId}/join`, { name: args.bName }, '');
  return {
    gameId: created.gameId,
    tokens: { player_a: created.playerAToken, player_b: joined.playerBToken },
  };
}

export function runCommand(command, commandArgs, timeoutMs) {
  return new Promise(resolve => {
    let settled = false;
    const settle = result => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const child = spawn(command, commandArgs, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = timeoutMs > 0 ? setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs) : null;
    child.stdout.on('data', data => { stdout += data.toString(); });
    child.stderr.on('data', data => { stderr += data.toString(); });
    child.on('error', err => {
      if (timer) clearTimeout(timer);
      settle({ code: 1, stdout, stderr: `${stderr}${err.message}`, timedOut });
    });
    child.on('exit', code => {
      if (timer) clearTimeout(timer);
      settle({ code, stdout, stderr, timedOut });
    });
  });
}

export async function writeInvocationLog(args, gameId, entry) {
  const dir = `${args.logDir}/${gameId}`;
  await mkdir(dir, { recursive: true });
  const file = `${dir}/${String(entry.index).padStart(4, '0')}-${entry.player}-turn-${entry.turnNumber}.json`;
  await writeFile(file, JSON.stringify(entry, null, 2), 'utf8');
  return file;
}

export async function invokePlayer(args, gameId, tokens, player, game, state, continuation) {
  const firstPrompt = buildFirstPrompt({
    baseUrl: args.url,
    gameId,
    player,
    token: tokens[player],
  });
  const firstCall = !state.initialized[player];
  const message = messageForCall({ firstCall, continuation, firstPrompt });
  const pi = buildPiCommand(args, player, gameId, message);
  const before = {
    turnNumber: game.turn.turnNumber,
    currentOwner: game.turn.currentOwner,
    phase: game.phase,
  };

  const result = await runCommand(pi.command, pi.args, args.timeoutMs);
  state.initialized[player] = true;
  state.invocations += 1;
  const afterGame = await request(args.url, 'GET', `/api/games/${gameId}`, undefined, tokens[player]);
  await writeInvocationLog(args, gameId, {
    index: state.invocations,
    player,
    turnNumber: before.turnNumber,
    command: pi.command,
    args: pi.args.slice(0, -1),
    message,
    before,
    after: {
      turnNumber: afterGame.turn.turnNumber,
      currentOwner: afterGame.turn.currentOwner,
      phase: afterGame.phase,
      winner: afterGame.winner,
    },
    result,
    createdAt: new Date().toISOString(),
  });
  return { result, afterGame };
}

export async function runMatch(args) {
  const setup = await setupGame(args);
  const state = {
    initialized: { player_a: false, player_b: false },
    invocations: 0,
  };
  const turnsPlayed = { player_a: 0, player_b: 0 };
  const incompleteCalls = { player_a: 0, player_b: 0 };

  while (turnsPlayed.player_a < args.maxRounds || turnsPlayed.player_b < args.maxRounds) {
    const game = await request(args.url, 'GET', `/api/games/${setup.gameId}`, undefined, setup.tokens.player_a);
    if (game.winner || game.phase === 'game_over') {
      return { reason: 'game_over', gameId: setup.gameId, winner: game.winner, turnsPlayed };
    }
    if (game.phase !== 'waiting_command') {
      await sleep(args.delayMs);
      continue;
    }

    const player = game.turn.currentOwner;
    if (turnsPlayed[player] >= args.maxRounds) return { reason: 'max_rounds', gameId: setup.gameId, turnsPlayed };

    const continuation = incompleteCalls[player] > 0;
    const { result, afterGame } = await invokePlayer(args, setup.gameId, setup.tokens, player, game, state, continuation);
    const stillSameTurn = afterGame.turn.currentOwner === player && !afterGame.winner && afterGame.phase !== 'game_over';
    if (result.code !== 0 || stillSameTurn) {
      incompleteCalls[player] += 1;
      if (incompleteCalls[player] >= args.maxCallsPerTurn) {
        throw new Error(`${player} did not end turn after ${args.maxCallsPerTurn} Pi calls`);
      }
      await sleep(args.delayMs);
      continue;
    }

    incompleteCalls[player] = 0;
    turnsPlayed[player] += 1;
    await sleep(args.delayMs);
  }

  return { reason: 'max_rounds', gameId: setup.gameId, turnsPlayed };
}

export async function runMain(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return { reason: 'help' };
  }
  return runMatch(args);
}

export function printHelp() {
  console.log(`Usage:
  node script/pi-match-runner.mjs --a-model <model> --b-model <model>
  node script/pi-match-runner.mjs --game <id> --a-token <token> --b-token <token>

Options:
  --url <url>                 API base URL, default ${DEFAULT_URL}
  --map <mapId>               Map for new games, default default
  --game <id>                 Resume an existing game
  --a-token <token>           Player A token for resume
  --b-token <token>           Player B token for resume
  --a-model <model>           Pi model for player A
  --b-model <model>           Pi model for player B
  --a-provider <provider>     Pi provider for player A
  --b-provider <provider>     Pi provider for player B
  --a-pi <command>            Full Pi command override for player A
  --b-pi <command>            Full Pi command override for player B
  --session-dir <dir>         Pi session directory
  --max-rounds <n>            Completed turns per player before stopping, default 20
  --max-calls-per-turn <n>    Retry calls per owned turn, default 3
`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMain().then(result => {
    if (result?.reason) console.log(`Runner stopped: ${result.reason}`);
  }).catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}
