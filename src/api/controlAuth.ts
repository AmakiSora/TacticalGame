// src/api/controlAuth.ts
import type { FastifyReply, FastifyRequest } from 'fastify';
import { safeEqual } from './auth.js';

/** 请求里出现任何一个转发头，就说明它大概率是反代转来的，不能当「本机控制台」。 */
const FORWARDING_HEADERS = ['x-forwarded-for', 'forwarded', 'x-real-ip'] as const;

function hasForwardingHeader(headers: FastifyRequest['headers'] | undefined): boolean {
  if (!headers) return false;
  for (const name of FORWARDING_HEADERS) {
    const value = headers[name];
    const text = Array.isArray(value) ? value.join(',') : value;
    if (typeof text === 'string' && text.trim() !== '') return true;
  }
  return false;
}

/**
 * 回环地址判定。IPv6 映射形式先剥 `::ffff:` 前缀，点分（127.0.0.1）与十六进制（7f00:1）
 * 两种写法都归一成点分再判；整段 127.0.0.0/8 都是 RFC 1122 回环。
 */
export function isLocalSocketAddress(address: string | null | undefined): boolean {
  if (typeof address !== 'string') return false;
  const normalized = address.trim().toLowerCase();
  if (!normalized) return false;
  let bare = normalized.startsWith('::ffff:') ? normalized.slice('::ffff:'.length) : normalized;
  // Node 正常情况下给点分形式；手工构造/某些平台会给 7f00:1 这种两段十六进制。
  const hextets = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(bare);
  if (hextets) {
    const hi = Number.parseInt(hextets[1]!, 16);
    const lo = Number.parseInt(hextets[2]!, 16);
    bare = `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  if (bare === '::1') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bare);
}

/**
 * 连接对端的真实地址。**不要用 req.ip**：req.ip 在 trustProxy 下来自可被客户端伪造成任意值的
 * X-Forwarded-For，拿它判断「请求来自本机」等于把控制接口直接开放给公网。
 */
export function controlSocketAddressOf(req: FastifyRequest): string | null {
  const direct = req.socket?.remoteAddress;
  if (typeof direct === 'string' && direct) return direct;
  const raw = (req as unknown as { raw?: { socket?: { remoteAddress?: string } } }).raw;
  const fallback = raw?.socket?.remoteAddress;
  return typeof fallback === 'string' && fallback ? fallback : null;
}

/**
 * 「本机免令牌」的完整判据：**socket 对端是回环** 且 **不带任何转发头**。
 * 这一条与 TRUST_PROXY 取值无关——同机反代但忘了开 trustProxy 时，socket 同样是 127.0.0.1，
 * 只看 socket 会把反代转来的公网请求当成本机。
 * socket 地址缺失（unix socket / 已断连）一律按非本机处理（fail-closed）。
 */
export function isLocalSocketRequest(req: FastifyRequest): boolean {
  const address = controlSocketAddressOf(req);
  if (!address) return false;
  if (!isLocalSocketAddress(address)) return false;
  return !hasForwardingHeader(req.headers);
}

/** 空白配置等同于未设置：避免 `AUTO_CONTROL_TOKEN=" "` 把控制接口锁死或放开。 */
function configuredControlToken(): string | null {
  const raw = process.env.AUTO_CONTROL_TOKEN;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/** 启动自检用：返回控制凭证本身的部署告警（不拦启动，只提醒）。 */
export function controlTokenWarnings(): string[] {
  const warnings: string[] = [];
  const trustProxy = process.env.TRUST_PROXY === 'true';
  const token = configuredControlToken();
  if (trustProxy && !token) {
    warnings.push('TRUST_PROXY=true 且未设置 AUTO_CONTROL_TOKEN：控制接口只接受不带转发头的本机请求，反代转来的请求一律 401。');
  }
  if (token && token.length < 16) {
    warnings.push('AUTO_CONTROL_TOKEN 长度小于 16，建议换成更长的随机串（控制接口可拉起训练子进程）。');
  }
  if (trustProxy && !process.env.METRICS_TOKEN) {
    warnings.push('TRUST_PROXY=true 且未设置 METRICS_TOKEN：/metrics 仍按 req.ip 判断来源（本轮未改），请确认反代已限制该路径。');
  }
  return warnings;
}

export function authorizeControlRequest(req: FastifyRequest, reply: FastifyReply): boolean {
  const configured = configuredControlToken();
  const queryToken = (req.query as { token?: string } | undefined)?.token;
  const headerToken = req.headers['x-control-token'];
  const supplied = typeof headerToken === 'string' ? headerToken : queryToken;

  if (configured) {
    // 定长常量时间比较：避免按字符前缀泄露凭证。
    if (typeof supplied === 'string' && safeEqual(supplied, configured)) return true;
    reply.code(401).send({ error: '管理凭证无效', code: 'invalid_control_token' });
    return false;
  }

  if (isLocalSocketRequest(req)) return true;
  reply.code(401).send({ error: '远程管理需要服务端配置 AUTO_CONTROL_TOKEN', code: 'control_token_required' });
  return false;
}
