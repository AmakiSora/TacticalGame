#!/usr/bin/env node
//
// 算法 AI 冒烟测试：创建对局、挂算法 bot、开局并验证回合推进。
// 需要本地服务器已在运行（默认 http://localhost:3100）。
//
// 用法：node scripts/test-algorithm-bots.mjs [botTypeA botTypeB] [baseUrl]
//   默认 mcts vs random；可选任意两个 algo_* 类型，如：
//   node scripts/test-algorithm-bots.mjs algo_mcts algo_greedy

const args = process.argv.slice(2).filter(a => !a.startsWith('http'));
const baseUrl = process.argv.slice(2).find(a => a.startsWith('http')) || 'http://localhost:3100';
const BOT_TYPES = args.length >= 1 ? args : ['algo_mcts', 'algo_random'];

async function req(path, opts = {}) {
  const url = `${baseUrl}${path}`;
  const resp = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`${resp.status} ${resp.statusText}: ${text}`);
  }
  return resp.json();
}

console.log(`1. Creating game (bots: ${BOT_TYPES.join(' vs ')})...`);
const createResp = await req('/api/games', {
  method: 'POST',
  body: JSON.stringify({
    mapId: 'default',
    maxPlayers: BOT_TYPES.length,
    participate: false,  // Host doesn't play
    playerName: 'Test Host',
  }),
});
const gameId = createResp.gameId;
const hostToken = createResp.hostToken;
console.log(`   Game created: ${gameId}, players: ${createResp.lobby.playerCount}`);

for (const [i, botType] of BOT_TYPES.entries()) {
  console.log(`${2 + i}. Adding ${botType} bot...`);
  await req(`/api/games/${gameId}/bots/algorithm`, {
    method: 'POST',
    headers: { 'x-host-token': hostToken },
    body: JSON.stringify({ botType }),
  });
  console.log(`   ${botType} bot added`);
}

const startStep = 2 + BOT_TYPES.length;
console.log(`${startStep}. Starting game...`);
await req(`/api/games/${gameId}/start`, {
  method: 'POST',
  headers: { 'x-host-token': hostToken },
  body: JSON.stringify({}),
});
console.log('   Game started');

console.log(`${startStep + 1}. Waiting 8 seconds for bots to spawn and start playing...`);
await new Promise(r => setTimeout(r, 8000));

console.log(`${startStep + 2}. Fetching game list to verify bots are active...`);
const list = await req('/api/games');
const game = list.games.find(g => g.gameId === gameId);
if (!game) {
  console.log('❌ Game not found in public list');
  process.exit(1);
}

console.log(`   Phase: ${game.phase}`);
console.log(`   Round: ${game.roundNumber || 0}`);
console.log(`   Winner: ${game.winner || 'none'}`);

console.log(`${startStep + 3}. Waiting another 12 seconds for more gameplay...`);
await new Promise(r => setTimeout(r, 12000));

const listFinal = await req('/api/games');
const gameFinal = listFinal.games.find(g => g.gameId === gameId);
console.log(`${startStep + 4}. Final state:`);
console.log(`   Phase: ${gameFinal.phase}`);
console.log(`   Round: ${gameFinal.roundNumber || 0}`);
console.log(`   Winner: ${gameFinal.winner || 'none'}`);

if (gameFinal.phase === 'ended' && gameFinal.winner) {
  console.log(`\n✅ SUCCESS: Game completed! Winner: ${gameFinal.winner}`);
} else if ((gameFinal.roundNumber || 0) > 1) {
  console.log(`\n✅ SUCCESS: Bots are playing! ${gameFinal.roundNumber} rounds completed.`);
} else {
  console.log('\n❌ FAILURE: Bots did not play any turns');
  process.exit(1);
}
