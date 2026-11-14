/**
 * Claude token proxy (docs/DEV_WORKER.md, "Claude Code as a separate user"; docs/ONCALL.md, "Agent isolation"): the
 * long-lived Claude subscription token (`claude setup-token`, a year) stays in this process; Claude Code gets
 * ANTHROPIC_BASE_URL pointing here and a per-start placeholder token instead. Every request is forwarded to the
 * Anthropic API with the placeholder replaced by the real token, and only when it carries this start's placeholder:
 * other local users cannot use the token, and the placeholder is worth nothing outside this process's lifetime.
 * Requests without any token (Claude Code's connectivity check) go through without one.
 * A prompt injection that makes Claude send its environment somewhere gets no token; it can only spend the
 * subscription through the proxy while it runs.
 *
 * Module: startAnthropicProxy({ token }) -> { url, placeholder, close() }.
 * CLI (the on-call runner): node anthropic-proxy.mjs <env file>: CLAUDE_CODE_OAUTH_TOKEN from the environment; writes
 * ANTHROPIC_BASE_URL=… and CLAUDE_CODE_OAUTH_TOKEN=<placeholder> to the env file once listening, then serves until
 * killed.
 */
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';

const UPSTREAM_HOST = 'api.anthropic.com';
/** Hop-by-hop headers (RFC 9110) and the ones set here */
const DROP_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
  'authorization',
  'x-api-key',
]);

/** The placeholder token: shaped like an OAuth token, so Claude Code takes it as one (Bearer + the OAuth beta). */
export function newPlaceholder() {
  return `sk-ant-oat01-proxy-${randomBytes(24).toString('hex')}`;
}

/** The bearer token of a request (Authorization: Bearer … or x-api-key), or null. */
export function presentedToken(headers) {
  const auth = headers.authorization;
  if (typeof auth === 'string' && /^Bearer /i.test(auth)) return auth.slice(7).trim();
  return typeof headers['x-api-key'] === 'string' ? headers['x-api-key'] : null;
}

/** The headers to send upstream: hop-by-hop and credentials dropped, the real token (if any) as Bearer. */
export function upstreamHeaders(headers, token, host = UPSTREAM_HOST) {
  const result = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!DROP_HEADERS.has(name.toLowerCase())) result[name] = value;
  }
  result.host = host;
  if (token) result.authorization = `Bearer ${token}`;
  return result;
}

export function startAnthropicProxy({
  token,
  placeholder = newPlaceholder(),
  host = '127.0.0.1',
  port = 0,
  log = () => {},
  // Tests: a local stand-in of the API (http.request)
  upstream = { host: UPSTREAM_HOST, port: 443, request: httpsRequest },
}) {
  if (!token) throw new Error('anthropic-proxy: no token');
  const server = createServer((req, res) => {
    // No token at all (Claude Code's connectivity check, HEAD /api/hello): forwarded without one. The placeholder: the
    // real token. Any other token: refused.
    const presented = presentedToken(req.headers);
    if (presented !== null && presented !== placeholder) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          type: 'error',
          error: { type: 'authentication_error', message: 'proxy: wrong token' },
        })
      );
      return;
    }
    const forwarded = upstream.request(
      {
        host: upstream.host,
        port: upstream.port,
        method: req.method,
        path: req.url,
        headers: upstreamHeaders(req.headers, presented === null ? null : token, upstream.host),
      },
      (upstreamRes) => {
        const headers = { ...upstreamRes.headers };
        delete headers.connection;
        delete headers['keep-alive'];
        res.writeHead(upstreamRes.statusCode ?? 502, headers);
        upstreamRes.pipe(res);
      }
    );
    forwarded.on('error', (error) => {
      log(`anthropic proxy: ${req.method} ${req.url}: ${error.message}`);
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          type: 'error',
          error: { type: 'api_error', message: 'proxy: upstream failed' },
        })
      );
    });
    // A client that went away (an interrupted answer) ends the upstream request too
    res.on('close', () => {
      if (!res.writableFinished) forwarded.destroy();
    });
    req.pipe(forwarded);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const { port: actual } = server.address();
      resolve({
        url: `http://${host}:${actual}`,
        placeholder,
        server,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

if (process.argv[1]?.endsWith('anthropic-proxy.mjs')) {
  const envFile = process.argv[2];
  if (!envFile) throw new Error('usage: anthropic-proxy.mjs <env file>');
  const proxy = await startAnthropicProxy({
    token: process.env.CLAUDE_CODE_OAUTH_TOKEN,
    log: (line) => console.error(line),
  });
  writeFileSync(
    envFile,
    `ANTHROPIC_BASE_URL=${proxy.url}\nCLAUDE_CODE_OAUTH_TOKEN=${proxy.placeholder}\n`,
    { mode: 0o600 }
  );
  console.error(`anthropic-proxy: listening on ${proxy.url}`);
}
