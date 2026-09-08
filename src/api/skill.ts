// src/api/skill.ts
// 把仓库根的 skill/ 目录通过只读 HTTP 接口暴露给游戏 agent：
// agent 不再需要在客户端安装 skill 拷贝，开局直接从本接口拉取最新版，
// 从而消除"忘记同步导致加载旧 skill"的版本漂移。
import type { FastifyInstance, FastifyReply } from 'fastify';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// dev: <repo>/src/api -> <repo>/skill；prod: /app/dist/api -> /app/skill
const APP_ROOT = join(__dirname, '..', '..');
const SKILL_DIR = join(APP_ROOT, 'skill');

interface SkillFile {
  name: string;
  content: Buffer;
  sha256: string;
}

const CONTENT_TYPES: Record<string, string> = {
  '.md': 'text/markdown; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.sh': 'text/x-sh; charset=utf-8',
};

function contentTypeFor(name: string): string {
  const dot = name.lastIndexOf('.');
  return (dot >= 0 && CONTENT_TYPES[name.slice(dot)]) || 'text/plain; charset=utf-8';
}

// 启动时一次性读入内存：部署流程会重建并重启容器，重启即生效，无需文件监听。
function loadSkillFiles(): Map<string, SkillFile> {
  const files = new Map<string, SkillFile>();
  for (const name of readdirSync(SKILL_DIR).sort()) {
    if (!statSync(join(SKILL_DIR, name)).isFile()) continue;
    const content = readFileSync(join(SKILL_DIR, name));
    files.set(name, { name, content, sha256: createHash('sha256').update(content).digest('hex') });
  }
  if (!files.has('SKILL.md')) throw new Error(`SKILL.md missing in ${SKILL_DIR}`);
  return files;
}

function readAppVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function skillRoutes(app: FastifyInstance): Promise<void> {
  let files: Map<string, SkillFile> | null = null;
  try {
    files = loadSkillFiles();
  } catch (err) {
    // skill 目录缺失时保持服务可用，仅本组接口返回 503。
    app.log.warn(err, 'skill directory unavailable; /api/skill* will respond 503');
  }
  const appVersion = readAppVersion();

  function sendFile(reply: FastifyReply, file: SkillFile, ifNoneMatch?: string) {
    reply.header('Cache-Control', 'no-cache').header('ETag', `"${file.sha256}"`);
    if (ifNoneMatch === `"${file.sha256}"`) return reply.code(304).send();
    return reply.type(contentTypeFor(file.name)).send(file.content);
  }

  // 最短引导路径：裸 agent 只需 prompt 里这一个 URL。
  app.get('/api/skill', async (req, reply) => {
    const file = files?.get('SKILL.md');
    if (!file) return reply.code(503).send({ error: 'skill unavailable', code: 'skill_unavailable' });
    return sendFile(reply, file, req.headers['if-none-match']);
  });

  app.get('/api/skill/manifest', async (_req, reply) => {
    if (!files) return reply.code(503).send({ error: 'skill unavailable', code: 'skill_unavailable' });
    return {
      appVersion,
      files: [...files.values()].map(f => ({ name: f.name, bytes: f.content.length, sha256: f.sha256 })),
    };
  });

  app.get<{ Params: { name: string } }>('/api/skill/files/:name', async (req, reply) => {
    const { name } = req.params;
    // 白名单校验：只接受启动时扫到的文件名，天然拒绝路径穿越。
    const file = files?.get(name);
    if (!file) {
      if (!files) return reply.code(503).send({ error: 'skill unavailable', code: 'skill_unavailable' });
      return reply.code(404).send({ error: 'unknown skill file', code: 'skill_file_not_found' });
    }
    return sendFile(reply, file, req.headers['if-none-match']);
  });
}
