// 多席位混合对抗冒烟：每个座位轮流放入新策略，其他位置轮换四个既有策略。
import { mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { playMatch } from './tempo-weave-arena.mts';

const output = process.argv[2] ?? 'temp/tempo-weave/multiseat.jsonl';
const base = Number(process.argv[3] ?? '802410');
const repeats = Number(process.argv[4] ?? '1');
mkdirSync(dirname(output), { recursive: true });
const opponents = ['random-sim', 'dest-prob', 'kriegspiel', 'matrix-eq'];
for (const count of [3, 6]) for (let repeat = 0; repeat < repeats; repeat++) for (let seat = 0; seat < count; seat++) {
  const names = Array.from({ length: count }, (_, i) => i === seat ? 'tempo-weave' : opponents[(i + seat) % opponents.length]!);
  const result = await playMatch({ map: 'standoff', names, seed: base + count * 101 + seat * 7919 + repeat * 104729 });
  appendFileSync(output, JSON.stringify(result) + '\n');
  const own = Object.values(result.metrics).find((m: any) => m.name === 'tempo-weave');
  console.log(JSON.stringify({ count, repeat, seat, winner: result.winnerName, rounds: result.rounds, own }));
  if (result.phase !== 'game_over' || own.rejected.length) throw new Error('多席位完整对局未通过');
}
