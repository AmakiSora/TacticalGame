import { describe, expect, it } from 'vitest';
import { buildServer, readRuntimeConfig } from '../../src/server.js';

describe('production server configuration', () => {
  it('uses safe defaults for container deployment', () => {
    const originalPort = process.env.PORT;
    const originalHost = process.env.HOST;
    delete process.env.PORT;
    delete process.env.HOST;

    expect(readRuntimeConfig()).toMatchObject({ host: '0.0.0.0', port: 3100, trustProxy: false });

    process.env.PORT = '3123';
    expect(readRuntimeConfig()).toMatchObject({ port: 3123 });

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

  it('exposes Prometheus metrics and honors METRICS_TOKEN', async () => {
    const previous = process.env.METRICS_TOKEN;
    const app = await buildServer();
    try {
      const open = await app.inject({ method: 'GET', url: '/healthz' });
      expect(open.statusCode).toBe(200);
      const metrics = await app.inject({ method: 'GET', url: '/metrics' });
      expect(metrics.statusCode).toBe(200);
      expect(metrics.headers['content-type']).toContain('text/plain');
      expect(metrics.body).toContain('tactical_http_requests_total');

      process.env.METRICS_TOKEN = 'metrics-secret';
      const rejected = await app.inject({ method: 'GET', url: '/metrics' });
      expect(rejected.statusCode).toBe(401);
      const accepted = await app.inject({
        method: 'GET',
        url: '/metrics',
        headers: { 'x-metrics-token': 'metrics-secret' },
      });
      expect(accepted.statusCode).toBe(200);
    } finally {
      if (previous === undefined) delete process.env.METRICS_TOKEN;
      else process.env.METRICS_TOKEN = previous;
      await app.close();
    }
  });
});
