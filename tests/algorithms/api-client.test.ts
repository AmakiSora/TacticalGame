// tests/algorithms/api-client.test.ts
// 算法 AI 的 REST 客户端：非 JSON 响应不再抛裸 SyntaxError，429 重试路径保持可用。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameApiClient } from '../../algorithms/lib/api-client.mjs';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(text: string, status = 200): Response {
  return new Response(text, { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GameApiClient response handling', () => {
  it('returns parsed JSON on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: 1, units: [] })));
    const client = new GameApiClient('http://test', 'g1', 'token');
    const state = await client.getState();
    expect(state).toEqual({ ok: 1, units: [] });
  });

  it('throws a status-preserving error when a 2xx response is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse('<html>gateway hiccup</html>')));
    const client = new GameApiClient('http://test', 'g1', 'token');
    await expect(client.getState()).rejects.toThrow(/returned non-JSON response/);
  });

  it('keeps the HTTP status when an error response is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse('<html>502 Bad Gateway</html>', 502)));
    const client = new GameApiClient('http://test', 'g1', 'token');
    await expect(client.getState()).rejects.toMatchObject({ status: 502 });
  });

  it('still retries 429 responses before giving up', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'too many requests' }, 429));
    vi.stubGlobal('fetch', fetchMock);
    const client = new GameApiClient('http://test', 'g1', 'token', { rateLimitRetryMs: 1, maxRetries: 2 });
    await expect(client.getState()).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('recovers when a 429 is followed by a success', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'too many requests' }, 429))
      .mockResolvedValueOnce(jsonResponse({ phase: 'active' }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new GameApiClient('http://test', 'g1', 'token', { rateLimitRetryMs: 1 });
    await expect(client.getState()).resolves.toEqual({ phase: 'active' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
