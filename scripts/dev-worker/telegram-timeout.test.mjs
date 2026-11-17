import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createTelegram } from './telegram.mjs';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('telegram: a stalled call is cut by its timeout and retried; each failed attempt is logged', async () => {
  let calls = 0;
  globalThis.fetch = (url, { signal }) => {
    calls++;
    if (calls === 1)
      // The first attempt hangs (a stalled connection) until its signal aborts it
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason))
      );
    return Promise.resolve(new Response(JSON.stringify({ ok: true, result: { file_path: 'x' } })));
  };
  const logged = [];
  const tg = createTelegram({
    token: 't',
    chatId: '1',
    log: (line) => logged.push(line),
    readFile: () => Buffer.alloc(0),
    inboxDir: '/tmp',
    timeouts: { call: 50, upload: 100 },
    retryDelayMs: 1,
  });
  const started = Date.now();
  const result = await tg.call('getFile', { file_id: 'f' });
  assert.equal(result.file_path, 'x');
  assert.equal(calls, 2);
  assert.ok(Date.now() - started < 2000, 'not stuck on the stalled attempt');
  assert.match(logged[0], /telegram getFile attempt 1 failed after \d+ ms/);
});
