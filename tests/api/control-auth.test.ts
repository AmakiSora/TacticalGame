// tests/api/control-auth.test.ts
// #1：控制接口的「本机免令牌」判定必须只看不可伪造的 socket 对端地址、且请求不带转发头。
// trustProxy 打开后 req.ip 来自客户端可伪造的 X-Forwarded-For，绝不能参与判定。
//
// 验收三条（ToT-GAME 确认的修订口径）：① 本机直连无转发头 → 200；
// ② 本机直连 + X-Forwarded-For: 127.0.0.1 → 401；③ 非 loopback socket → 401（带 XFF 也不放行）。
// TRUST_PROXY=true 且无 AUTO_CONTROL_TOKEN 只打启动警告，规则不变（不额外一律 401）。
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';
import { startTestServer } from '../helpers.js';
import {
  authorizeControlRequest, controlSocketAddressOf, controlTokenWarnings,
  isLocalSocketAddress, isLocalSocketRequest,
} from '../../src/api/controlAuth.js';

const CONTROL_URL = '/api/arena/eval/status';

function fakeRequest(overrides: {
  ip?: string;
  socketAddress?: string | null;
  headers?: Record<string, string>;
  query?: unknown;
}) {
  return {
    ip: overrides.ip ?? '127.0.0.1',
    socket: { remoteAddress: overrides.socketAddress === undefined ? '127.0.0.1' : overrides.socketAddress },
    headers: overrides.headers ?? {},
    query: overrides.query ?? {},
  } as unknown as Parameters<typeof authorizeControlRequest>[0];
}

function fakeReply() {
  const state = { code: 200, body: null as unknown };
  const reply = {
    code(value: number) { state.code = value; return reply; },
    send(body: unknown) { state.body = body; return reply; },
  };
  return { reply: reply as unknown as Parameters<typeof authorizeControlRequest>[1], state };
}

const servers: FastifyInstance[] = [];

async function listen(app: FastifyInstance): Promise<string> {
  servers.push(app);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function get(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers });
  return res.status;
}

const originalEnv = {
  TRUST_PROXY: process.env.TRUST_PROXY,
  AUTO_CONTROL_TOKEN: process.env.AUTO_CONTROL_TOKEN,
  METRICS_TOKEN: process.env.METRICS_TOKEN,
  TACTICAL_GAME_RATE_LIMIT: process.env.TACTICAL_GAME_RATE_LIMIT,
};

afterEach(async () => {
  while (servers.length > 0) {
    const app = servers.pop()!;
    await app.close().catch(() => {});
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('control auth: loopback detection ignores client-controlled headers', () => {
  it('accepts only real loopback socket addresses', () => {
    for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '::FFFF:127.0.0.1', '::ffff:7f00:1', '127.0.0.2']) {
      expect(isLocalSocketAddress(address), address).toBe(true);
    }
    for (const address of ['203.0.113.9', '10.0.0.5', '::ffff:203.0.113.9', '::ffff:cb00:7109', '', null, undefined]) {
      expect(isLocalSocketAddress(address), String(address)).toBe(false);
    }
  });

  it('treats a missing socket address as remote (fail-closed)', () => {
    expect(controlSocketAddressOf({ socket: {}, raw: { socket: {} } } as never)).toBeNull();
    expect(isLocalSocketRequest({ socket: {}, ip: '127.0.0.1' } as never)).toBe(false);
    const { reply, state } = fakeReply();
    expect(authorizeControlRequest(fakeRequest({ socketAddress: null }), reply)).toBe(false);
    expect(state.code).toBe(401);
  });

  it('reads the socket peer address, falling back to req.raw.socket', () => {
    expect(controlSocketAddressOf({ socket: { remoteAddress: '203.0.113.9' } } as never)).toBe('203.0.113.9');
    const rawOnly = { socket: {}, raw: { socket: { remoteAddress: '::ffff:127.0.0.1' } } };
    expect(controlSocketAddressOf(rawOnly as never)).toBe('::ffff:127.0.0.1');
  });

  it('rejects a request whose req.ip looks local but whose socket is remote', () => {
    // 这正是 trustProxy + X-Forwarded-For 伪造的形态：req.ip 是请求头，socket 是真相。
    expect(isLocalSocketRequest(fakeRequest({ ip: '127.0.0.1', socketAddress: '203.0.113.9' }))).toBe(false);
    const { reply, state } = fakeReply();
    expect(authorizeControlRequest(fakeRequest({ ip: '127.0.0.1', socketAddress: '203.0.113.9' }), reply)).toBe(false);
    expect(state.code).toBe(401);
    // 验收 ③：非 loopback socket，即使转发头自称 127.0.0.1 也不放行。
    const withSpoof = fakeReply();
    expect(authorizeControlRequest(
      fakeRequest({
        socketAddress: '203.0.113.9',
        headers: { 'x-forwarded-for': '127.0.0.1', forwarded: 'for=127.0.0.1', 'x-real-ip': '127.0.0.1' },
      }),
      withSpoof.reply,
    )).toBe(false);
    expect(withSpoof.state.code).toBe(401);
  });

  it('rejects a loopback socket that carries any forwarding header', () => {
    // 同机反代（例如没开 trustProxy 的 Caddy/nginx）转来的公网请求，socket 也是 127.0.0.1。
    for (const header of ['x-forwarded-for', 'forwarded', 'x-real-ip']) {
      expect(isLocalSocketRequest(fakeRequest({ socketAddress: '::ffff:127.0.0.1', headers: { [header]: '203.0.113.9' } })), header).toBe(false);
      const { reply, state } = fakeReply();
      expect(authorizeControlRequest(
        fakeRequest({ socketAddress: '127.0.0.1', headers: { [header]: '203.0.113.9' } }), reply,
      ), header).toBe(false);
      expect(state.code).toBe(401);
    }
    // 空白的转发头不算「带转发头」。
    expect(isLocalSocketRequest(fakeRequest({ headers: { 'x-forwarded-for': '  ' } }))).toBe(true);
  });

  it('allows a plain loopback request with no forwarding header', () => {
    const { reply } = fakeReply();
    expect(authorizeControlRequest(fakeRequest({ socketAddress: '::ffff:127.0.0.1' }), reply)).toBe(true);
  });
});

describe('control token checks', () => {
  it('treats a blank AUTO_CONTROL_TOKEN as unset', () => {
    for (const blank of ['', '   ']) {
      process.env.AUTO_CONTROL_TOKEN = blank;
      const { reply, state } = fakeReply();
      // 空白配置 = 未设置 → 退回本机判定（这里 socket 是本机，所以放行）。
      expect(authorizeControlRequest(fakeRequest({}), reply)).toBe(true);
      expect(state.code).toBe(200);
    }
  });

  it('compares the configured token with a constant-time comparison', () => {
    process.env.AUTO_CONTROL_TOKEN = 'a-very-long-control-token';
    const wrong = fakeReply();
    expect(authorizeControlRequest(fakeRequest({ headers: { 'x-control-token': 'a-very-long-control-tokeX' } }), wrong.reply)).toBe(false);
    expect(wrong.state.code).toBe(401);
    const right = fakeReply();
    expect(authorizeControlRequest(fakeRequest({ headers: { 'x-control-token': 'a-very-long-control-token' } }), right.reply)).toBe(true);
  });

  it('warns about deployment combinations that open the control API', () => {
    delete process.env.AUTO_CONTROL_TOKEN;
    delete process.env.METRICS_TOKEN;
    process.env.TRUST_PROXY = 'true';
    const warnings = controlTokenWarnings();
    expect(warnings.some(text => text.includes('TRUST_PROXY=true') && text.includes('AUTO_CONTROL_TOKEN'))).toBe(true);
    expect(warnings.some(text => text.includes('METRICS_TOKEN'))).toBe(true);

    process.env.AUTO_CONTROL_TOKEN = 'short';
    expect(controlTokenWarnings().some(text => text.includes('长度小于 16'))).toBe(true);

    process.env.AUTO_CONTROL_TOKEN = 'long-enough-control-token';
    process.env.METRICS_TOKEN = 'metrics';
    expect(controlTokenWarnings()).toEqual([]);
  });
});

describe('control auth over a real socket (do not switch back to inject)', () => {
  it('default deployment: loopback console works, a spoofed X-Forwarded-For is rejected', async () => {
    // 真 socket：直连（无转发头）放行；带 XFF 的请求一律 401，不再看 req.ip。
    const base = await listen(await startTestServer());
    expect(await get(`${base}${CONTROL_URL}`)).toBe(200);
    expect(await get(`${base}${CONTROL_URL}`, { 'X-Forwarded-For': '127.0.0.1' })).toBe(401);
    expect(await get(`${base}${CONTROL_URL}`, { Forwarded: 'for=127.0.0.1' })).toBe(401);
    expect(await get(`${base}${CONTROL_URL}`, { 'X-Real-IP': '127.0.0.1' })).toBe(401);
  });

  it('trustProxy without AUTO_CONTROL_TOKEN rejects forwarded requests only', async () => {
    // 真 socket：反代形态（带 XFF）一律 401；同机控制台（无转发头）仍可用。
    const base = await listen(await startTestServer({ trustProxy: true }));
    expect(await get(`${base}${CONTROL_URL}`, { 'X-Forwarded-For': '127.0.0.1' })).toBe(401);
    expect(await get(`${base}${CONTROL_URL}`)).toBe(200);
  });

  it('trustProxy with AUTO_CONTROL_TOKEN requires the token even through the proxy', async () => {
    const base = await listen(await startTestServer({ trustProxy: true, autoControlToken: 'secret-control' }));
    expect(await get(`${base}${CONTROL_URL}`, { 'X-Forwarded-For': '127.0.0.1' })).toBe(401);
    expect(await get(`${base}${CONTROL_URL}`, { 'X-Control-Token': 'wrong' })).toBe(401);
    // 带正确凭证时，经反代（带 XFF）也能用。
    expect(await get(`${base}${CONTROL_URL}`, { 'X-Forwarded-For': '203.0.113.9', 'X-Control-Token': 'secret-control' })).toBe(200);
  });

  it('keeps using req.ip for the rate-limit bucket, so spoofed headers do not share a bucket', async () => {
    // 真 socket：限流 key 仍按 req.ip（trustProxy 下即 XFF）分桶 —— 这是预期的：
    // 控制鉴权不再看 req.ip，但限流按「最外层客户端」分桶才不会被同一反代挤爆。
    process.env.TACTICAL_GAME_RATE_LIMIT = '1';
    const base = await listen(await startTestServer({ trustProxy: true }));
    const create = (forwardedFor: string) => fetch(`${base}/api/games`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': forwardedFor },
      body: JSON.stringify({ playerName: 'A', maxPlayers: 2 }),
    }).then(res => res.status);
    expect(await create('198.51.100.7')).toBe(200);
    // 同一 XFF 第二次超限。
    expect(await create('198.51.100.7')).toBe(429);
    // 换一个 XFF 是另一个桶，不受影响。
    expect(await create('198.51.100.8')).toBe(200);
  });
});
