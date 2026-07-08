import type { FastifyReply, FastifyRequest } from 'fastify';

function isLocalRequest(req: FastifyRequest): boolean {
  const ip = req.ip;
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

export function authorizeControlRequest(req: FastifyRequest, reply: FastifyReply): boolean {
  const configured = process.env.AUTO_CONTROL_TOKEN;
  const queryToken = (req.query as { token?: string } | undefined)?.token;
  const headerToken = req.headers['x-control-token'];
  const supplied = typeof headerToken === 'string' ? headerToken : queryToken;

  if (configured) {
    if (supplied === configured) return true;
    reply.code(401).send({ error: 'invalid control token', code: 'invalid_control_token' });
    return false;
  }

  if (isLocalRequest(req)) return true;
  reply.code(401).send({ error: 'AUTO_CONTROL_TOKEN is required for remote control access', code: 'control_token_required' });
  return false;
}
