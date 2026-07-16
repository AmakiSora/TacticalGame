import { describe, expect, it } from 'vitest';
import { buildServer, readRuntimeConfig } from '../../src/server.js';

describe('production server configuration', () => {
  it('uses safe defaults for container deployment', () => {
    const originalPort = process.env.PORT;
    const originalHost = process.env.HOST;
    delete process.env.PORT;
    delete process.env.HOST;

    expect(readRuntimeConfig()).toMatchObject({ host: '0.0.0.0', port: 3100, trustProxy: false });

    if (originalPort === undefined) delete process.env.PORT;
    else process.env.PORT = originalPort;
    if (originalHost === undefined) delete process.env.HOST;
    else process.env.HOST = originalHost;
  });

  it('rejects invalid port values', () => {
    const originalPort = process.env.PORT;
    const originalTrustProxy = process.env.TRUST_PROXY;
    process.env.PORT = 'not-a-port';
    expect(() => readRuntimeConfig()).toThrow('PORT must be an integer');
    process.env.PORT = '3100';
    process.env.TRUST_PROXY = 'invalid';
    expect(() => readRuntimeConfig()).toThrow('TRUST_PROXY must be "true" or "false"');
    if (originalPort === undefined) delete process.env.PORT;
    else process.env.PORT = originalPort;
    if (originalTrustProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = originalTrustProxy;
  });

  it('serves liveness and readiness endpoints', async () => {
    const app = await buildServer();
    const health = await app.inject({ method: 'GET', url: '/healthz' });
    const ready = await app.inject({ method: 'GET', url: '/readyz' });

    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: 'ok' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: 'ready' });
    await app.close();
  });
});
