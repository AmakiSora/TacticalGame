// src/engine/random.ts
// 对局内可注入的确定性随机源：mulberry32 的 32 位状态整数直接存在 GameState
// 上（rngState），随每次掷骰步进。状态可 JSON 序列化，持久化重启后掷骰序列
// 无缝延续；同种子 + 同动作序列可逐值重放整局。
import type { GameState } from '../types.js';

// 未走 startGame 播种的旧构造路径（createInitialGame / joinGame 测试构造器）
// 使用的固定种子：让测试默认确定性，生产对局总是经 initializeLobbyGame 播种。
const DEFAULT_RNG_STATE = 0x9e3779b9;

/** 从注入的 random 取一次值作为整局掷骰序列的种子。 */
export function seedGameRandom(game: GameState, random: () => number): void {
  game.rngState = Math.floor(random() * 0x100000000) >>> 0;
}

/** 取下一个 [0, 1) 随机数并步进对局 RNG 状态。 */
export function nextGameRandom(game: GameState): number {
  if (typeof game.rngState !== 'number') game.rngState = DEFAULT_RNG_STATE;
  game.rngState = (game.rngState + 0x6d2b79f5) >>> 0;
  let t = game.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
