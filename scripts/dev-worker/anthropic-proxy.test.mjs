import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer, request as httpRequest } from 'node:http';
import {
  newPlaceholder,
  presentedToken,
  startAnthropicProxy,
  upstreamHeaders,
} from './anthropic-proxy.mjs';

const REAL = 'sk-ant-oat01-real-token-for-the-test';
let api;
let seen = [];
let proxy;

before(async () => {
  // Stand-in of the Anthropic API: records what it got, answers with a streamed body
  api = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'x-ratelimit-test': '1' });
      res.write('event: one\n\n');
      setTimeout(() => res.end('event: two\n\n'), 10);
    });
  });
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
  proxy = await startAnthropicProxy({
    token: REAL,
    upstream: { host: '127.0.0.1', port: api.address().port, request: httpRequest },
  });
});

after(async () => {
  await proxy.close();
  await new Promise((resolve) => api.close(resolve));
});

async function call({
  method = 'POST',
  path = '/v1/messages?beta=true',
  headers = {},
  body = '',
} = {}) {
  const res = await fetch(`${proxy.url}${path}`, {
    method,
    headers,
    ...(method === 'POST' ? { body } : {}),
  });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

test('the placeholder: forwarded with the real token, body and stream passed through', async () => {
  seen = [];
  const res = await call({
    headers: {
      authorization: `Bearer ${proxy.placeholder}`,
      'anthropic-beta': 'oauth-2025-04-20',
      'content-type': 'application/json',
    },
    body: '{"model":"x"}',
  });
  assert.equal(res.status, 200);
  assert.equal(res.text, 'event: one\n\nevent: two\n\n');
  assert.equal(res.headers.get('x-ratelimit-test'), '1');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, '/v1/messages?beta=true');
  assert.equal(seen[0].headers.authorization, `Bearer ${REAL}`);
  assert.equal(seen[0].headers['anthropic-beta'], 'oauth-2025-04-20');
  assert.equal(seen[0].body, '{"model":"x"}');
});

test('any other token: refused, nothing forwarded', async () => {
  seen = [];
  for (const headers of [
    { authorization: 'Bearer sk-ant-oat01-someone-else' },
    { authorization: `Bearer ${REAL}` },
    { 'x-api-key': 'sk-ant-api03-other' },
  ]) {
    const res = await call({ headers });
    assert.equal(res.status, 401);
  }
  assert.equal(seen.length, 0);
});

test('no token (connectivity check): forwarded without one', async () => {
  seen = [];
  const res = await call({ method: 'HEAD', path: '/api/hello' });
  assert.equal(res.status, 200);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].headers.authorization, undefined);
});

test('upstreamHeaders: hop-by-hop and credentials dropped, host set', () => {
  const headers = upstreamHeaders(
    {
      host: '127.0.0.1:1234',
      connection: 'keep-alive',
      authorization: 'Bearer placeholder',
      'x-api-key': 'k',
      'anthropic-version': '2023-06-01',
    },
    REAL
  );
  assert.deepEqual(headers, {
    'anthropic-version': '2023-06-01',
    host: 'api.anthropic.com',
    authorization: `Bearer ${REAL}`,
  });
  assert.equal(upstreamHeaders({ authorization: 'Bearer x' }, null).authorization, undefined);
});

test('presentedToken and newPlaceholder', () => {
  assert.equal(presentedToken({ authorization: 'Bearer abc' }), 'abc');
  assert.equal(presentedToken({ 'x-api-key': 'k' }), 'k');
  assert.equal(presentedToken({}), null);
  const a = newPlaceholder();
  assert.match(a, /^sk-ant-oat01-proxy-[0-9a-f]{48}$/);
  assert.notEqual(a, newPlaceholder());
});
