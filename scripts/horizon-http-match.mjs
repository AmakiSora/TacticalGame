#!/usr/bin/env node
// scripts/horizon-http-match.mjs
//
// 真实 HTTP 口径的合法性验证：经 REST 建房/加入/开局，再为每个座位拉起
// algorithms/runner.mjs（与线上算法 bot 同一条执行链），对局结束后统计：
// - runner 日志里的被拒动作（interfaces.mjs 打印的 "Action <type> failed"）；
// - runner 层错误（Algorithm error，含 429 限流后被迫提交）——服务器按 IP+路由限流
//   （默认 120 次/分钟，所有本机 bot 共用一个桶），本机多 bot 验证需用
//   TACTICAL_GAME_RATE_LIMIT 调高，否则统计会被限流污染；
// - 结算期失败（action_failed 事件，按座位与 reason 计数）；
// - 终局原因、胜者、回合数。
//
// 用法（先 npm run dev，默认端口 3100）：
//   node scripts/horizon-http-match.mjs --map standoff --players 2 --algos horizon,dest-prob
//   node scripts/horizon-http-match.mjs --map standoff --players 3 --algos horizon,kriegspiel,matrix-eq --max-turns 4
//   （--log-dir DIR 可把每个 runner 的完整输出落盘）
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = { url: 'http://localhost:3100', map: 'standoff', players: 2, algos: ['horizon', 'horizon'], maxTurns: 120 };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const val = () => argv[++i];
    if (key === '--url') args.url = val();
    else if (key === '--map') args.map = val();
    else if (key === '--players') args.players = Number(val());
    else if (key === '--algos') args.algos = val().split(',');
    else if (key === '--max-turns') args.maxTurns = Number(val());
    else if (key === '--log-dir') args.logDir = val();
    else throw new Error(`未知参数: ${key}`);
  }
  return args;
}

async function call(url, method, path, body, headers = {}) {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}

function runRunner(args, algorithm, gameId, player) {
  return new Promise(resolvePromise => {
    const child = spawn(process.execPath, [
      join(root, 'algorithms/runner.mjs'),
      '--algorithm', algorithm, '--url', args.url, '--game', gameId,
      '--token', player.token, '--side', player.id, '--max-turns', String(args.maxTurns),
    ], { cwd: root });
    let out = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { out += chunk; });
    child.on('close', code => {
      if (args.logDir) writeFileSync(join(args.logDir, `${gameId}-${player.id}-${algorithm}.log`), out);
      resolvePromise({ algorithm, side: player.id, code, out });
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const algos = Array.from({ length: args.players }, (_, i) => args.algos[i] ?? args.algos.at(-1));
  const created = await call(args.url, 'POST', '/api/games', {
    mapId: args.map, maxPlayers: args.players, participate: true, playerName: algos[0],
  });
  const players = [created.player];
  for (let i = 1; i < args.players; i++) {
    players.push((await call(args.url, 'POST', `/api/games/${created.gameId}/join`, { name: algos[i] })).player);
  }
  await call(args.url, 'POST', `/api/games/${created.gameId}/start`, {}, { 'X-Host-Token': created.hostToken });
  const started = Date.now();
  const results = await Promise.all(players.map((player, i) => runRunner(args, algos[i], created.gameId, player)));
  const state = await call(args.url, 'GET', `/api/games/${created.gameId}`, undefined, { 'X-Player-Token': players[0].token });
  const failed = {};
  for (const event of state.events ?? []) {
    if (event.type !== 'action_failed') continue;
    const { owner, reason } = event.payload;
    failed[owner] ??= {};
    failed[owner][reason] = (failed[owner][reason] ?? 0) + 1;
  }
  const summary = {
    gameId: created.gameId, map: args.map, players: args.players,
    phase: state.phase, winner: state.winner ?? null, reason: state.result?.reason ?? null,
    rounds: state.turn?.roundNumber, seconds: Math.round((Date.now() - started) / 100) / 10,
    seats: results.map(r => ({
      side: r.side, algorithm: r.algorithm, exit: r.code,
      rejected: (r.out.match(/Action \w+ failed/g) ?? []).length,
      rejectedSamples: (r.out.match(/Action \w+ failed[^\n]*/g) ?? []).slice(0, 3),
      turns: (r.out.match(/\] Completed/g) ?? []).length,
      runnerErrors: (r.out.match(/Algorithm error/g) ?? []).length,
      rateLimited: (r.out.match(/429/g) ?? []).length,
      settleFailures: failed[r.side] ?? {},
    })),
  };
  console.log(JSON.stringify(summary));
}

main().catch(error => { console.error(error); process.exit(1); });
