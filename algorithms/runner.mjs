#!/usr/bin/env node
// algorithms/runner.mjs
//
// 通用算法运行器：加载算法并在游戏中执行
// 用法：node algorithms/runner.mjs --algorithm greedy --url http://localhost:3100 \
//       --game <gameId> --token <token> --side player_a

import { pathToFileURL } from 'node:url';
import { loadAlgorithm, listAlgorithms } from './registry.mjs';
import { GameApiClient } from './lib/api-client.mjs';
import { runAlgorithm, validateAlgorithm } from './lib/interfaces.mjs';
import * as utils from './lib/game-utils.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * 解析命令行参数
 */
function parseArgs(argv) {
  const args = {
    algorithm: '',
    url: '',
    game: '',
    token: '',
    side: 'player_a',
    pollSeconds: 0.5,
    maxTurns: 120,
    once: false,
    quiet: false,
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    const val = () => argv[++i];

    if (arg === '--algorithm') args.algorithm = val();
    else if (arg === '--url') args.url = val();
    else if (arg === '--game') args.game = val();
    else if (arg === '--token') args.token = val();
    else if (arg === '--side') args.side = val();
    else if (arg === '--poll-seconds') args.pollSeconds = parseFloat(val());
    else if (arg === '--max-turns') args.maxTurns = parseInt(val(), 10);
    else if (arg === '--once') args.once = true;
    else if (arg === '--quiet') args.quiet = true;
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
    i++;
  }

  // 验证必需参数
  if (!args.algorithm) throw new Error('--algorithm is required');
  if (!args.url) throw new Error('--url is required');
  if (!args.game) throw new Error('--game is required');
  if (!args.token) throw new Error('--token is required');

  args.url = args.url.replace(/\/+$/, '');

  return args;
}

function printHelp() {
  console.log(`算法 AI 运行器

用法：
  node algorithms/runner.mjs --algorithm <name> --url <serverUrl> \\
    --game <gameId> --token <playerToken> --side <playerId>

必需参数：
  --algorithm <name>     算法名称（${listAlgorithms().join(', ')}）
  --url <url>            服务器地址（如 http://localhost:3100）
  --game <id>            游戏 ID
  --token <token>        玩家 token
  --side <id>            玩家席位 ID（player_a, player_b, ...）

可选参数：
  --poll-seconds <n>     轮询间隔秒数（默认 0.5）
  --max-turns <n>        最多处理多少个己方回合（默认 120）
  --once                 只处理一个回合后退出
  --quiet                减少日志输出
  --help, -h             显示此帮助信息

示例：
  node algorithms/runner.mjs --algorithm greedy \\
    --url http://localhost:3100 \\
    --game g_abc123 \\
    --token pt_xyz789 \\
    --side player_a
`);
}

/**
 * 等待轮到己方回合
 */
async function waitForTurn(apiClient, side, pollSeconds, quiet) {
  while (true) {
    const state = await apiClient.getState();

    // 游戏结束
    if (state.phase === 'game_over' || state.winner) {
      return { done: true, state, reason: 'game_over' };
    }

    // 玩家被淘汰
    const player = state.players?.[side];
    if (player && player.status !== 'active') {
      return { done: true, state, reason: 'eliminated' };
    }

    // 轮到己方
    const current = state.turn?.currentPlayerId || state.turn?.currentOwner;
    if (current === side) {
      return { done: false, state };
    }

    // 继续等待
    await sleep(pollSeconds * 1000);
  }
}

/**
 * 主函数
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const log = args.quiet ? () => {} : (...a) => console.log(...a);

  // 加载算法
  log(`Loading algorithm: ${args.algorithm}`);
  const algorithm = await loadAlgorithm(args.algorithm);
  validateAlgorithm(algorithm);
  log(`Algorithm loaded: ${algorithm.name}`);
  if (algorithm.description) {
    log(`  ${algorithm.description}`);
  }

  // 创建 API 客户端
  const apiClient = new GameApiClient(args.url, args.game, args.token);

  // 验证游戏模式
  log(`Connecting to game ${args.game}...`);
  const initialState = await apiClient.getState();

  if (initialState.config?.mode && initialState.config.mode !== 'standard') {
    throw new Error(
      `This runner only supports standard mode. ` +
      `Game mode is "${initialState.config.mode}". ` +
      `Use scripts/auto-standard-game.mjs for full mode support.`
    );
  }

  if (initialState.phase !== 'active' && initialState.phase !== 'lobby') {
    throw new Error(`Game is not active (phase: ${initialState.phase})`);
  }

  log(`Connected. Playing as ${args.side}.`);

  let turnsPlayed = 0;

  // 主循环
  while (turnsPlayed < args.maxTurns) {
    // 等待己方回合
    const waitResult = await waitForTurn(apiClient, args.side, args.pollSeconds, args.quiet);

    if (waitResult.done) {
      if (waitResult.reason === 'game_over') {
        log(`Game over. Winner: ${waitResult.state.winner || '(draw)'}`);
      } else if (waitResult.reason === 'eliminated') {
        log(`Player ${args.side} has been eliminated.`);
      }
      break;
    }

    const gameState = waitResult.state;
    const turnNo = gameState.turn?.turnNumber || gameState.turn?.roundNumber || '?';

    try {
      log(`\n[Turn ${turnNo}] Running algorithm...`);

      // 执行算法
      await runAlgorithm(algorithm, gameState, apiClient, utils);

      turnsPlayed++;
      log(`[Turn ${turnNo}] Completed (${turnsPlayed}/${args.maxTurns})`);

      // --once 模式：执行一回合后退出
      if (args.once) {
        log('--once mode: exiting after one turn');
        break;
      }

    } catch (error) {
      console.error(`[Turn ${turnNo}] Algorithm error: ${error.message}`);

      // 尝试强制结束回合
      try {
        await apiClient.endTurn();
        log('[Turn ${turnNo}] Forced end-turn after error');
      } catch (endTurnError) {
        console.error(`Failed to end turn: ${endTurnError.message}`);
        throw error; // 无法恢复，退出
      }

      turnsPlayed++;
    }
  }

  if (turnsPlayed >= args.maxTurns) {
    log(`\nReached max turns limit (${args.maxTurns}). Exiting.`);
  }

  log('Runner finished.');
}

// 入口
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => {
    console.error(`Fatal error: ${err.message}`);
    if (!err.message.includes('Unknown algorithm')) {
      console.error(err.stack);
    }
    process.exit(1);
  });
}
