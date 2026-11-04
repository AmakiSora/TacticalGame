// tests/skill/wait-turn.exit-code.test.ts
// wait-turn.mjs 的进程级退出码回归测试：finish() 的 exit 定时器必须保持 ref'd，
// 否则事件循环排空后进程直接以 0 退出，timeout 的退出码 4 会丢失（agent 会把
// 超时误判成 my_turn）。用真实脚本 + stub 服务器验证 shell 拿到的退出码。
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '../../skill/wait-turn.mjs');

function gameBody(overrides: Record<string, unknown> = {}) {
  return {
    id: 'g1',
    phase: 'active',
    winner: null,
    lastEventSeq: 1,
    config: { mode: 'standard' },
    players: { player_a: { status: 'active' }, player_b: { status: 'active' } },
    turn: { currentPlayerId: 'player_b', roundNumber: 1 },
    ...overrides,
  };
}

const servers: Server[] = [];

function startStub(body: Record<string, unknown>): Promise<string> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    res.setHeader('content-type', 'application/json');
    if (url.pathname === '/api/games/g1') {
      res.end(JSON.stringify(body));
    } else if (url.pathname === '/api/games/g1/wait') {
      setTimeout(() => res.end(JSON.stringify({ changed: false })), 50);
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  servers.push(server);
  return new Promise((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolvePromise(`http://127.0.0.1:${port}`);
    });
  });
}

function runWaitTurn(baseUrl: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [SCRIPT, '--url', baseUrl, '--game', 'g1', '--player', 'a', '--token', 't', '--interval-s', '1', '--timeout-s', '1'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += String(d)));
    child.stderr.on('data', (d) => (stderr += String(d)));
    child.on('error', reject);
    child.on('exit', (code) => resolvePromise({ code, stdout, stderr }));
  });
}

afterAll(() => {
  for (const server of servers) {
    server.closeAllConnections();
    server.close();
  }
});

describe('wait-turn.mjs process exit codes', () => {
  it('exits 4 (not 0) when --timeout-s expires', async () => {
    const baseUrl = await startStub(gameBody());
    const { code, stdout, stderr } = await runWaitTurn(baseUrl);
    expect(`${stdout}
${stderr}`).toContain('"result":"timeout"');
    expect(code).toBe(4);
  }, 15000);

  it('exits 2 on game_over', async () => {
    const baseUrl = await startStub(gameBody({ winner: 'player_a' }));
    const { code, stdout, stderr } = await runWaitTurn(baseUrl);
    expect(`${stdout}
${stderr}`).toContain('"result":"game_over"');
    expect(code).toBe(2);
  }, 15000);

  it('exits 0 on my_turn', async () => {
    const baseUrl = await startStub(gameBody({ turn: { currentPlayerId: 'player_a', roundNumber: 1 } }));
    const { code, stdout, stderr } = await runWaitTurn(baseUrl);
    expect(`${stdout}
${stderr}`).toContain('"result":"my_turn"');
    expect(code).toBe(0);
  }, 15000);
});
