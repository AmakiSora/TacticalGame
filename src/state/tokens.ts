// src/state/tokens.ts
// 玩家/房主凭证的生成、哈希与校验。磁盘只保存 v1:<HMAC-SHA256(pepper, token)>；
// 原始 token 只在创建/加入响应出现一次。旧存档的明文 token 在 loadFromDisk 时迁移。
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HASH_PREFIX = 'v1:';
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

let cachedPepper: string | null = null;

function getPepper(): string {
  if (cachedPepper) return cachedPepper;
  const fromEnv = process.env.TACTICAL_GAME_TOKEN_PEPPER?.trim();
  if (fromEnv) {
    cachedPepper = fromEnv;
    return fromEnv;
  }
  // 单元测试不写 runtime；同一进程内保持稳定的测试 pepper 即可。
  if (process.env.VITEST) {
    cachedPepper = 'tactical-game-vitest-pepper';
    return cachedPepper;
  }
  const file = join(PROJECT_ROOT, 'runtime', 'token-pepper');
  try {
    if (existsSync(file)) {
      const stored = readFileSync(file, 'utf8').trim();
      if (stored) {
        cachedPepper = stored;
        return stored;
      }
    }
  } catch {
    // 读失败时退回新生成；下面会尝试写入。
  }
  const generated = randomBytes(32).toString('hex');
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${generated}\n`, { mode: 0o600 });
  } catch {
    // 目录不可写（例如只读部署）时仍可用进程内 pepper，但重启后旧 token 会失效。
  }
  cachedPepper = generated;
  return generated;
}

export function generateToken(): string {
  return randomBytes(16).toString('hex');
}

export function hashToken(token: string): string {
  return `${HASH_PREFIX}${createHmac('sha256', getPepper()).update(token).digest('hex')}`;
}

export function isHashedToken(value: string | undefined | null): boolean {
  return typeof value === 'string' && value.startsWith(HASH_PREFIX);
}

export function verifyToken(token: string | undefined | null, stored: string | undefined | null): boolean {
  if (!token || !stored) return false;
  const expected = isHashedToken(stored) ? stored : hashToken(stored);
  const actual = hashToken(token);
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 仅迁移用：把旧明文 token 转成哈希；已哈希则原样返回。 */
export function migrateToken(value: string | undefined | null): string | null {
  if (!value) return null;
  return isHashedToken(value) ? value : hashToken(value);
}
