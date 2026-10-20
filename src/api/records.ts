// src/api/records.ts
// 把仓库根的 records/ 目录（房主从前端观战页导出的回放 JSON）通过只读 HTTP 接口
// 暴露给观战页：浏览历史对局时不再需要手动从磁盘挑文件导入，直接选一条即可回放。
//
// 回放 JSON 是自包含的事件日志（地图/配置全在首个 game_start 事件里），
// 前端拿到文件后复用现有的 normalizeImportedReplay → loadImportedReplay 管线，
// 因此本接口只负责“列出元数据”与“按名取原文”两件事。
//
// 3.6.5 起元数据索引落到 runtime/records-index.json：启动只读索引，详情按需读文件；
// 索引按 (mtimeMs, size) 校验，文件变化时只重建对应条目。
import type { FastifyInstance, FastifyReply } from 'fastify';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// dev: <repo>/src/api -> <repo>/records；prod: /app/dist/api -> /app/records
const APP_ROOT = join(__dirname, '..', '..');
const RECORDS_DIR = join(APP_ROOT, 'records');
// 只暴露当前两版：V1 命名与结构均过旧，前端回放管线不保证可读。
const VERSIONS = ['V2', 'V3'] as const;
const INDEX_VERSION = 1;

interface RecordEntry {
  id: string; // "V3/tg_0036_20260721.json"，Map 键与 URL 参数
  version: string;
  fileName: string;
  seq: string | null; // 文件名里的对局顺序号（tg_0209_… → "0209"）
  gameId: string | null;
  mapId: string | null;
  mode: string | null;
  players: string[];
  winner: string | null;
  winnerName: string | null; // winner 解析为玩家显示名（player_b → "KimiK3-PI"）
  reason: string | null;
  eventCount: number;
  date: string | null; // 文件名里的 YYYYMMDD
  exportedAt: string | null;
  bytes: number;
  sha256: string;
}

/** 索引里额外保存文件指纹，避免把 mtime/size 暴露给前端。 */
interface IndexedRecord extends RecordEntry {
  mtimeMs: number;
  size: number;
}

interface RecordsIndexFile {
  version: number;
  savedAt: string;
  records: IndexedRecord[];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

// playerNames 可能是 {player_a: '名称'} 或 ['名称']；胜者解析需要键名，统一成映射。
function nameMapOf(raw: unknown): Record<string, string> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'string' && value) out[key] = value;
    }
    return out;
  }
  if (Array.isArray(raw)) {
    const keys = ['player_a', 'player_b', 'player_c', 'player_d'];
    const out: Record<string, string> = {};
    raw.forEach((name, index) => {
      if (typeof name === 'string' && name && keys[index]) out[keys[index]] = name;
    });
    return out;
  }
  return {};
}

// 胜负结果：V3 有 finalResult；V2 老回放没有，回退取最后一个 game_over 事件。
function resultOf(data: any, events: any[]): { winner: string | null; reason: string | null } { // eslint-disable-line @typescript-eslint/no-explicit-any
  const finalResult = data?.finalResult ?? {};
  const over = [...events].reverse().find(ev => ev?.type === 'game_over')?.payload ?? {};
  return {
    winner: stringOrNull(finalResult.winner) ?? stringOrNull(over.winner),
    reason: stringOrNull(finalResult.reason) ?? stringOrNull(over.reason),
  };
}

function dateFromFileName(fileName: string): string | null {
  const m = /_(\d{8})\.json$/i.exec(fileName);
  return m ? m[1] : null;
}

function seqFromFileName(fileName: string): string | null {
  const m = /^tg_(\d+)_/i.exec(fileName);
  return m ? m[1] : null;
}

function summarize(id: string, version: string, fileName: string, content: Buffer, data: any): RecordEntry { // eslint-disable-line @typescript-eslint/no-explicit-any
  const events: any[] = Array.isArray(data?.events) ? data.events : []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const start = events.find(ev => ev?.type === 'game_start')?.payload ?? {};
  const cfg = start.config ?? {};
  const map = start.map ?? {};
  const names = nameMapOf(start.playerNames ?? data?.playerNames);
  const { winner, reason } = resultOf(data, events);
  return {
    id,
    version,
    fileName,
    seq: seqFromFileName(fileName),
    gameId: stringOrNull(data?.gameId ?? start.gameId),
    mapId: stringOrNull(data?.mapId ?? start.mapId ?? map.id),
    // 与前端 app.js 的推断链一致：多数 standard 回放的 game_start 不带 mode 字段。
    mode: stringOrNull(start.mode ?? cfg.mode ?? map.mode) ?? 'standard',
    players: Object.values(names),
    winner,
    winnerName: winner ? names[winner] ?? null : null,
    reason,
    eventCount: Number.isInteger(data?.eventCount) ? data.eventCount : events.length,
    date: dateFromFileName(fileName),
    exportedAt: stringOrNull(data?.exportedAt),
    bytes: content.length,
    sha256: createHash('sha256').update(content).digest('hex'),
  };
}

function indexFilePath(): string | null {
  if (process.env.TACTICAL_GAME_RECORDS_INDEX_FILE) return process.env.TACTICAL_GAME_RECORDS_INDEX_FILE;
  if (process.env.VITEST) return null;
  return join(APP_ROOT, 'runtime', 'records-index.json');
}

function readIndexFile(log: (msg: string) => void): Map<string, IndexedRecord> {
  const out = new Map<string, IndexedRecord>();
  const file = indexFilePath();
  if (!file || !existsSync(file)) return out;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<RecordsIndexFile>;
    if (parsed.version !== INDEX_VERSION || !Array.isArray(parsed.records)) return out;
    for (const entry of parsed.records) {
      if (entry && typeof entry.id === 'string' && typeof entry.sha256 === 'string'
        && typeof entry.mtimeMs === 'number' && typeof entry.size === 'number') {
        out.set(entry.id, entry);
      }
    }
  } catch (err) {
    log(`ignore unreadable records index: ${(err as Error).message}`);
  }
  return out;
}

function writeIndexFile(records: IndexedRecord[], log: (msg: string) => void): void {
  const file = indexFilePath();
  if (!file) return;
  try {
    mkdirSync(dirname(file), { recursive: true });
    const payload: RecordsIndexFile = { version: INDEX_VERSION, savedAt: new Date().toISOString(), records };
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(payload)}\n`);
    renameSync(tmp, file);
  } catch (err) {
    log(`failed to write records index: ${(err as Error).message}`);
  }
}

function metaOf(entry: IndexedRecord): RecordEntry {
  const { mtimeMs: _mtimeMs, size: _size, ...meta } = entry;
  return meta;
}

// 扫描 V2/V3：命中索引且 (mtime, size) 未变的条目不再读文件/解析；变化的条目重建。
// 单条坏文件（未导出完成/手工编辑）只跳过并告警，不影响其余接口启动。
function loadRecords(log: (msg: string) => void): Map<string, RecordEntry> {
  const cached = readIndexFile(log);
  const entries = new Map<string, RecordEntry>();
  const nextIndex: IndexedRecord[] = [];
  for (const version of VERSIONS) {
    const dir = join(RECORDS_DIR, version);
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue; // 该版本目录不存在，忽略
    }
    for (const fileName of names.sort()) {
      if (!fileName.endsWith('.json')) continue;
      const full = join(dir, fileName);
      let stat;
      try {
        stat = statSync(full);
        if (!stat.isFile()) continue;
      } catch {
        continue;
      }
      const id = `${version}/${fileName}`;
      const previous = cached.get(id);
      if (previous && previous.mtimeMs === stat.mtimeMs && previous.size === stat.size) {
        entries.set(id, metaOf(previous));
        nextIndex.push(previous);
        continue;
      }
      try {
        const content = readFileSync(full);
        const data = JSON.parse(content.toString('utf8'));
        const meta = summarize(id, version, fileName, content, data);
        entries.set(id, meta);
        nextIndex.push({ ...meta, mtimeMs: stat.mtimeMs, size: stat.size });
      } catch {
        log(`skip malformed record: ${id}`);
      }
    }
  }
  writeIndexFile(nextIndex, log);
  return entries;
}

// 最新在前：主序为文件名里的对局顺序号（跨版本连续，序号即完整时间线），
// 无序号兑底排最后，再按日期、gameId 区分同序条目。
function sortEntries(a: RecordEntry, b: RecordEntry): number {
  const seqA = a.seq ? Number(a.seq) : -1;
  const seqB = b.seq ? Number(b.seq) : -1;
  if (seqA !== seqB) return seqB - seqA;
  const dateDiff = (b.date ?? '').localeCompare(a.date ?? '');
  if (dateDiff !== 0) return dateDiff;
  return (b.gameId ?? b.fileName).localeCompare(a.gameId ?? a.fileName);
}

export async function recordsRoutes(app: FastifyInstance): Promise<void> {
  let entries: Map<string, RecordEntry> | null = null;
  try {
    entries = loadRecords(msg => app.log.warn(msg));
    if (entries.size === 0) {
      app.log.warn('records directory has no V2/V3 replays; /api/records* will respond 503');
      entries = null;
    }
  } catch (err) {
    // records 目录缺失时保持服务可用，仅本组接口返回 503。
    app.log.warn(err, 'records directory unavailable; /api/records* will respond 503');
  }

  function sendFile(reply: FastifyReply, content: Buffer, sha256: string, ifNoneMatch?: string) {
    reply.header('Cache-Control', 'no-cache').header('ETag', `"${sha256}"`);
    if (ifNoneMatch === `"${sha256}"`) return reply.code(304).send();
    return reply.type('application/json; charset=utf-8').send(content);
  }

  app.get('/api/records', async (_req, reply) => {
    if (!entries) return reply.code(503).send({ error: '回放库暂不可用', code: 'records_unavailable' });
    const list = [...entries.values()].sort(sortEntries);
    return { records: list, total: list.length };
  });

  // 通配路由承接 "V2/tg_0001_....json" 这类带斜杠的 id；
  // 命中失败即 404，靠白名单查找天然拒绝路径穿越（与 /api/skill/files/:name 同法）。
  app.get<{ Params: { '*': string } }>('/api/records/*', async (req, reply) => {
    if (!entries) return reply.code(503).send({ error: '回放库暂不可用', code: 'records_unavailable' });
    const id = req.params['*'];
    const entry = entries.get(id);
    if (!entry) return reply.code(404).send({ error: '找不到该回放', code: 'record_not_found' });
    let content: Buffer;
    try {
      content = readFileSync(join(RECORDS_DIR, id));
    } catch {
      return reply.code(404).send({ error: '找不到该回放', code: 'record_not_found' });
    }
    // 文件可能在索引生成后被替换：详情请求以磁盘内容为准，ETag 用实际内容 hash。
    const sha256 = createHash('sha256').update(content).digest('hex');
    if (sha256 !== entry.sha256 || content.length !== entry.bytes) {
      entry.sha256 = sha256;
      entry.bytes = content.length;
    }
    return sendFile(reply, content, sha256, req.headers['if-none-match']);
  });
}
