import { pathToFileURL } from 'node:url';

const DEFAULT_URL = process.env.TACTICAL_GAME_URL || '';
const PLAYER_IDS = ['player_a', 'player_b', 'player_c', 'player_d', 'player_e', 'player_f', 'player_g', 'player_h'];

// Exit code contract (also documented in skill/SKILL.md):
//   0 my_turn     -> sequential: it is this player's turn; simultaneous (config.mode
//                    === 'simultaneous'): the planning window is open and this player
//                    has not committed yet — resume planning/committing
//   2 game_over   -> the game finished; report the result
//   3 eliminated  -> this player is no longer active; report elimination
//   4 timeout     -> nothing happened before --timeout-s; ask the user whether to keep waiting
//   1 usage error -> bad arguments
export const EXIT = {
  MY_TURN: 0,
  GAME_OVER: 2,
  ELIMINATED: 3,
  TIMEOUT: 4,
};

function printHelp() {
  console.log(`Usage:
  node skill/wait-turn.mjs --url <serverUrl> --game <gameId> --player <a-h|player_a-player_h> --token <playerToken>

Blocks while polling GET /api/games/:id until the seat's turn returns, the game
ends, or the seat is eliminated. Run it in the FOREGROUND (blocking) after
/end-turn and wait for its exit code; never send it to the background.

Options:
  --url <url>          API base URL; required unless TACTICAL_GAME_URL is set
  --game <id>          Game id to poll
  --player <seat>      Own seat, a-h or player_a-player_h
  --token <token>      Player token (sent as X-Player-Token only; never printed)
  --interval-s <n>     Poll interval in seconds, default 3
  --timeout-s <n>      Give up after this many seconds, default 1800

Exit codes:
  0 my_turn            Own turn again; resume the turn loop
  2 game_over          Game finished; report the winner
  3 eliminated         Own seat is no longer active
  4 timeout            No state change before the deadline
`);
}

function parseArgs(argv) {
  const args = {
    url: DEFAULT_URL,
    game: '',
    player: '',
    token: '',
    intervalS: 3,
    timeoutS: 1800,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[++i];
    };
    if (arg === '--url') args.url = next();
    else if (arg === '--game') args.game = next();
    else if (arg === '--player') args.player = next();
    else if (arg === '--token') args.token = next();
    else if (arg === '--interval-s') args.intervalS = Number(next());
    else if (arg === '--timeout-s') args.timeoutS = Number(next());
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  args.player = playerId(args.player);
  if (!args.url) throw new Error('--url is required (or set TACTICAL_GAME_URL)');
  if (!args.game) throw new Error('--game is required');
  if (!args.token) throw new Error('--token is required');
  if (!Number.isFinite(args.intervalS) || args.intervalS < 1) throw new Error('--interval-s must be >= 1');
  if (!Number.isFinite(args.timeoutS) || args.timeoutS < 1) throw new Error('--timeout-s must be >= 1');
  args.url = args.url.replace(/\/+$/, '');
  return args;
}

function playerId(side) {
  if (PLAYER_IDS.includes(side)) return side;
  if (/^[a-h]$/.test(side)) return `player_${side}`;
  throw new Error('--player must be a-h or player_a-player_h');
}

let sleepTimer = null;

function sleep(ms) {
  return new Promise(resolve => {
    sleepTimer = setTimeout(resolve, ms);
  });
}

async function fetchState(baseUrl, gameId, token) {
  const res = await fetch(`${baseUrl}/api/games/${gameId}`, {
    headers: { 'X-Player-Token': token },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(`GET /api/games/${gameId} failed (${res.status})${data?.code ? ` ${data.code}` : ''}`);
    err.status = res.status;
    err.code = data?.code;
    throw err;
  }
  return data;
}

/** Classify one state snapshot. Returns null while we should keep waiting. */
export function classifyState(game, owner) {
  if (game.winner || game.phase === 'game_over') {
    return { result: 'game_over', winner: game.winner ?? null, exit: EXIT.GAME_OVER };
  }
  const self = game.players?.[owner];
  if (game.phase === 'active' && self?.status && self.status !== 'active') {
    return { result: 'eliminated', status: self.status, exit: EXIT.ELIMINATED };
  }
  if (game.config?.mode === 'simultaneous') {
    // 同时回合模式：计划阶段且自己尚未确认提交 = "轮到你了"。
    if (game.phase === 'active' && !(game.plan?.committed ?? []).includes(owner)) {
      const round = game.turn?.roundNumber ?? game.turn?.turnNumber ?? null;
      return { result: 'my_turn', round, exit: EXIT.MY_TURN };
    }
    return null;
  }
  const current = game.turn?.currentPlayerId ?? game.turn?.currentOwner;
  if (game.phase === 'active' && current === owner) {
    const round = game.turn?.roundNumber ?? game.turn?.turnNumber ?? null;
    return { result: 'my_turn', round, exit: EXIT.MY_TURN };
  }
  return null;
}

function finish(outcome) {
  console.log(JSON.stringify(outcome));
  if (sleepTimer) clearTimeout(sleepTimer);
  // Exit on the next macrotask so stdout flushes and no handle is mid-close.
  setTimeout(() => process.exit(outcome.exit), 100).unref();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const deadline = Date.now() + args.timeoutS * 1000;
  let backoffMs = 2000;

  console.log(`Waiting for ${args.player} in game ${args.game} (timeout ${args.timeoutS}s)`);
  while (Date.now() < deadline) {
    try {
      const game = await fetchState(args.url, args.game, args.token);
      backoffMs = 2000;
      const outcome = classifyState(game, args.player);
      if (outcome) finish(outcome);
      await sleep(args.intervalS * 1000);
    } catch (err) {
      if (err.status === 403 && err.code === 'player_eliminated') {
        finish({ result: 'eliminated', status: 'player_eliminated', exit: EXIT.ELIMINATED });
      }
      // Transient failure (network, 502/503, 429 rate_limit, ...): back off and keep polling.
      const waitMs = Math.min(backoffMs, Math.max(1000, deadline - Date.now()));
      console.error(`poll error: ${err.message}; retrying in ${Math.round(waitMs / 1000)}s`);
      await sleep(waitMs);
      backoffMs = Math.min(backoffMs * 2, 30000);
    }
  }

  finish({ result: 'timeout', timeoutS: args.timeoutS, exit: EXIT.TIMEOUT });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}
