// 独立启动开发服务器与原版 CLI runner，所有通信都经过真实 localhost HTTP。
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const directory = process.argv[2] ?? 'temp/tempo-weave/http';
mkdirSync(directory, { recursive: true });
// 端口可用环境变量覆盖：3100 若被既有服务器占用（就绪探测无法区分自己与他人），
// 换端口即可获得干净的验证环境。
const port = process.env.TW_HTTP_PORT ?? '3100';
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
  env: { ...process.env, HOST: '127.0.0.1', PORT: port, NODE_ENV: 'test', TACTICAL_GAME_RATE_LIMIT: '100000' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', x => { serverLog += x; }); server.stderr.on('data', x => { serverLog += x; });
const pause = ms => new Promise(r => setTimeout(r, ms));
const children = [];
const results = [];
async function request(path, body, token, host = false) {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { [host ? 'X-Host-Token' : 'X-Player-Token']: token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status}: ${JSON.stringify(data)}`);
  return data;
}
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`开发服务器启动失败：${serverLog}`);
    try { await request('/api/maps'); ready = true; break; } catch { await pause(100); }
  }
  if (!ready) throw new Error(`开发服务器未就绪：${serverLog}`);
  for (const [map, seats] of [['standoff', 2], ['molten-throne', 2], ['standoff', 3]]) {
    const created = await request('/api/games', { mapId: map, maxPlayers: seats, participate: true, playerName: '经纬 HTTP 0' });
    const players = [created.player];
    for (let i = 1; i < seats; i++) players.push((await request(`/api/games/${created.gameId}/join`, { name: `经纬 HTTP ${i}` })).player);
    await request(`/api/games/${created.gameId}/start`, {}, created.hostToken, true);
    const running = players.map(player => {
      // token 仅传给本地原版 runner，不写入实测报告或日志清单。
      const child = spawn(process.execPath, ['algorithms/runner.mjs', '--algorithm', 'tempo-weave', '--url', base,
        '--game', created.gameId, '--token', player.token, '--side', player.id, '--poll-seconds', '0.01'], { stdio: ['ignore', 'pipe', 'pipe'] });
      children.push(child);
      let log = ''; child.stdout.on('data', x => { log += x; }); child.stderr.on('data', x => { log += x; });
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('runner 超时')); }, 180000);
        child.on('error', reject);
        child.on('close', code => { clearTimeout(timer); resolve({ owner: player.id, code, log }); });
      });
    });
    const finished = await Promise.all(running), snapshot = await request(`/api/games/${created.gameId}`, undefined, players[0].token);
    // 只计真实失败：终局后服务器归档对局，runner 尾随轮询会收到 404 game_not_found，
    // 属于收尾噪声（active 对局永不删除，404 只可能出现在 game_over 之后），不计入动作拒绝。
    const rejected = finished.reduce((n, r) => n + r.log.split('\n').filter(line =>
      /Action \w+ failed:|Fatal error:/.test(line) || (/Algorithm error:/.test(line) && !line.includes('game_not_found'))
    ).length, 0);
    const result = { map, seats, date: new Date().toISOString(), phase: snapshot.phase, rounds: snapshot.turn.roundNumber, winner: snapshot.winner,
      rejected, runnerExitCodes: finished.map(r => r.code), launcher: `node --import tsx src/server.ts; unmodified algorithms/runner.mjs; real HTTP port ${port}` };
    results.push(result);
    for (const r of finished) writeFileSync(`${directory}/${map}-${seats}-${r.owner}.log`, r.log);
    writeFileSync(`${directory}/results.json`, JSON.stringify(results, null, 2));
    console.log(JSON.stringify(result));
    if (snapshot.phase !== 'game_over' || rejected || finished.some(r => r.code !== 0)) throw new Error('HTTP 完整对局验证未通过');
  }
} finally {
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  server.kill('SIGTERM');
  writeFileSync(`${directory}/server.log`, serverLog);
}
