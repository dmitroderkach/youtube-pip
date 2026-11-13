#!/usr/bin/env node
/**
 * Prints an installation token of the dev worker's own GitHub App (docs/DEV_WORKER.md, "GitHub"), for git (credential
 * helper) and gh (the /usr/local/bin/gh wrapper). The App is not a bypass actor of the repository rulesets: it can push
 * branches, open PRs and run workflows, but not update main, create version tags or touch settings (merges and
 * releases go through the gate: dev-ops merge / release).
 *
 * Env: GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID, GITHUB_APP_PRIVATE_KEY (the task's secret youtube-pip-dev-worker),
 *      GITHUB_REPO (owner/name). Tokens live an hour: cached in GITHUB_APP_TOKEN_CACHE until 10 minutes before expiry.
 */
import { createSign } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

const CACHE = process.env.GITHUB_APP_TOKEN_CACHE ?? '/tmp/github-app-token.json';
const REUSE_MS = 10 * 60 * 1000;
/** What the worker needs; the App may have no more than its own permissions anyway. */
const PERMISSIONS = {
  contents: 'write',
  pull_requests: 'write',
  workflows: 'write',
  actions: 'write',
  checks: 'read',
  statuses: 'read',
};

function cached() {
  if (!existsSync(CACHE)) return null;
  try {
    const entry = JSON.parse(readFileSync(CACHE, 'utf8'));
    return Date.parse(entry.expires_at) - Date.now() > REUSE_MS ? entry.token : null;
  } catch {
    return null;
  }
}

function appJwt() {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iat: now - 60,
    exp: now + 540,
    iss: process.env.GITHUB_APP_ID,
  })}`;
  const key = process.env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, '\n');
  return `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(key, 'base64url')}`;
}

async function fresh() {
  const repo = process.env.GITHUB_REPO?.split('/')[1];
  const res = await fetch(
    `https://api.github.com/app/installations/${process.env.GITHUB_APP_INSTALLATION_ID}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${appJwt()}`,
        'User-Agent': 'youtube-pip-dev-worker',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ ...(repo ? { repositories: [repo] } : {}), permissions: PERMISSIONS }),
    }
  );
  const json = await res.json().catch(() => ({}));
  if (res.status !== 201 || !json.token) {
    throw new Error(`GitHub App token: ${res.status} ${json.message ?? ''}`.trim());
  }
  writeFileSync(
    `${CACHE}.tmp`,
    JSON.stringify({ token: json.token, expires_at: json.expires_at }),
    {
      mode: 0o600,
    }
  );
  renameSync(`${CACHE}.tmp`, CACHE);
  return json.token;
}

for (const name of ['GITHUB_APP_ID', 'GITHUB_APP_INSTALLATION_ID', 'GITHUB_APP_PRIVATE_KEY']) {
  if (!process.env[name]) {
    console.error(`github-app-token: ${name} is not set`);
    process.exit(1);
  }
}
try {
  process.stdout.write(`${cached() ?? (await fresh())}\n`);
} catch (error) {
  console.error(String(error.message ?? error));
  process.exit(1);
}
