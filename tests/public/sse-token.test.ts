import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(process.cwd(), 'public', 'play.js'), 'utf8');

describe('player SSE subscription', () => {
  it('passes the player token only through the contract query parameter', () => {
    const subscriptionSource = source.slice(source.indexOf('function subscribeSse'), source.indexOf('function lobbySummaryMarkup'));
    // EventSource 不能带请求头；服务端 SSE 要求玩家身份（迷雾局还按观者投影），
    // 因此令牌只能走契约里的 ?token=，不能臆造 tokenQuery 之类的新参数名。
    expect(subscriptionSource).not.toContain('tokenQuery');
    expect(subscriptionSource).toContain('const authQuery = myToken ?');
    expect(subscriptionSource).toContain('&token=${encodeURIComponent(myToken)}');
    expect(subscriptionSource).toContain('new EventSource(`/api/games/${gameId}/events?after=${lastSeq}${authQuery}`)');
  });
});
