import type { FastifyInstance, FastifyReply } from 'fastify';
import type { PlayerId } from '../types.js';
import { getAutoControlController } from '../control/singleton.js';
import { authorizeControlRequest } from './controlAuth.js';

function writeSse(reply: FastifyReply, data: unknown): void {
  reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
}

export async function controlRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/api/control') && !authorizeControlRequest(req, reply)) {
      return reply;
    }
    return undefined;
  });

  app.get('/api/control/status', async () => getAutoControlController().getStatus());

  app.get('/api/control/config', async () => getAutoControlController().getConfig());

  app.put<{ Body: Record<string, unknown> }>('/api/control/config', async (req) => (
    getAutoControlController().updateConfig(req.body)
  ));

  app.post('/api/control/start', async (req, reply) => {
    try {
      return await getAutoControlController().start();
    } catch (err) {
      return reply.code(409).send({ error: (err as Error).message, code: 'control_start_failed' });
    }
  });

  app.post('/api/control/pause', async () => {
    await getAutoControlController().pause();
    return getAutoControlController().getStatus();
  });

  app.post('/api/control/resume', async () => {
    await getAutoControlController().resume();
    return getAutoControlController().getStatus();
  });

  app.post('/api/control/stop', async () => {
    await getAutoControlController().stop();
    return getAutoControlController().getStatus();
  });

  app.post<{ Body: { side?: PlayerId; prompt?: string } }>('/api/control/manual', async (req, reply) => {
    const { side, prompt } = req.body ?? {};
    if (side !== 'player_a' && side !== 'player_b') {
      return reply.code(400).send({ error: 'side must be player_a or player_b', code: 'invalid_control_request' });
    }
    if (!prompt || typeof prompt !== 'string') {
      return reply.code(400).send({ error: 'prompt is required', code: 'invalid_control_request' });
    }
    return getAutoControlController().manual(side, prompt);
  });

  app.get<{ Querystring: { after?: string } }>('/api/control/logs', async (req) => {
    const after = req.query.after ? Number(req.query.after) : 0;
    return { logs: getAutoControlController().getLogs(after) };
  });

  app.get<{ Querystring: { after?: string; close?: string } }>('/api/control/logs/stream', async (req, reply) => {
    const after = req.query.after ? Number(req.query.after) : 0;
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });

    writeSse(reply, { status: getAutoControlController().getStatus(), logs: getAutoControlController().getLogs(after) });
    if (req.query.close === 'true') {
      reply.raw.end();
      return;
    }

    const timer = setInterval(() => {
      writeSse(reply, { status: getAutoControlController().getStatus(), logs: getAutoControlController().getLogs(after) });
    }, 1000);
    req.raw.on('close', () => clearInterval(timer));
  });
}
