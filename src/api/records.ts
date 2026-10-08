// src/api/records.ts
// 把仓库根的 records/ 目录（房主从前端观战页导出的回放 JSON）通过只读 HTTP 接口
// 暴露给观战页：浏览历史对局时不再需要手动从磁盘挑文件导入，直接选一条即可回放。
//
// 回放 JSON 是自包含的事件日志（地图/配置全在首个 game_start 事件里），
// 前端拿到文件后复用现有的 normalizeImportedReplay → loadImportedReplay 管线，
// 因此本接口只负责“列出元数据”与“按名取原文”两件事。
import type { FastifyInstance, FastifyReply } from 'fastify';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// dev: <repo>/src/api -> <repo>/records；prod: /app/dist/api -> /app/records
const APP_ROOT = join(__dirname, '..', '..');
const RECORDS_DIR = join(APP_ROOT, 'records');
// 只暴露当前两版：V1 命名与结构均过旧，前端回放管线不保证可读。
const VERSIONS = ['V2', 'V3'] as const;

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
  content: Buffer;
}

type RecordMeta = Omit<RecordEntry, 'content'>;

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

function summarize(id: string, version: string, fileName: string, content: Buffer, data: any): RecordMeta { // eslint-disable-line @typescript-eslint/no-explicit-any
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

// 启动时一次性读入内存：归档目录只在开发/发布时更新，重启即生效，无需文件监听。
// 单条坏文件（未导出完成/手工编辑）只跳过并告警，不影响其余接口启动。
function loadRecords(log: (msg: string) => void): Map<string, RecordEntry> {
  const entries = new Map<string, RecordEntry>();
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
      if (!statSync(join(dir, fileName)).isFile()) continue;
      const id = `${version}/${fileName}`;
      try {
        const content = readFileSync(join(dir, fileName));
        const data = JSON.parse(content.toString('utf8'));
        entries.set(id, { ...summarize(id, version, fileName, content, data), content });
      } catch {
        log(`skip malformed record: ${id}`);
      }
    }
  }
  return entries;
}

function metadata(entry: RecordEntry): RecordMeta {
  const { content: _content, ...meta } = entry;
  return meta;
}

// 最新在前：主序为文件名里的对局顺序号（跨版本连续，序号即完整时间线），
// 无序号兑底排最后，再按日期、gameId 区分同序条目。
function sortEntries(a: RecordMeta, b: RecordMeta): number {
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

  function sendFile(reply: FastifyReply, entry: RecordEntry, ifNoneMatch?: string) {
    reply.header('Cache-Control', 'no-cache').header('ETag', `"${entry.sha256}"`);
    if (ifNoneMatch === `"${entry.sha256}"`) return reply.code(304).send();
    return reply.type('application/json; charset=utf-8').send(entry.content);
  }

  app.get('/api/records', async (_req, reply) => {
    if (!entries) return reply.code(503).send({ error: 'records unavailable', code: 'records_unavailable' });
    const list = [...entries.values()].map(metadata).sort(sortEntries);
    return { records: list, total: list.length };
  });

  // 通配路由承接 "V2/tg_0001_....json" 这类带斜杠的 id；
  // 命中失败即 404，靠白名单查找天然拒绝路径穿越（与 /api/skill/files/:name 同法）。
  app.get<{ Params: { '*': string } }>('/api/records/*', async (req, reply) => {
    if (!entries) return reply.code(503).send({ error: 'records unavailable', code: 'records_unavailable' });
    const id = req.params['*'];
    const entry = entries.get(id);
    if (!entry) return reply.code(404).send({ error: 'unknown record', code: 'record_not_found' });
    return sendFile(reply, entry, req.headers['if-none-match']);
  });
}
