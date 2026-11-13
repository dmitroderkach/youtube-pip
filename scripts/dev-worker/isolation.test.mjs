/** Unit tests of isolation.mjs (no second user needed): `node --test scripts/dev-worker/*.test.mjs`. */
import assert from 'node:assert/strict';
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { claudeEnv, isPlainFile, readPlainFile } from './isolation.mjs';

test("Claude's environment: the worker's secrets and anything credential-like are dropped", () => {
  const base = {
    PATH: '/usr/bin',
    AWS_REGION: 'eu-central-1',
    AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/credentials/x',
    TELEGRAM_BOT_TOKEN: 'bot',
    TELEGRAM_CHAT_ID: '1',
    GOOGLE_TTS_API_KEY: '{}',
    GITHUB_APP_ID: '2',
    GITHUB_APP_INSTALLATION_ID: '3',
    GITHUB_APP_PRIVATE_KEY: 'pem',
    GH_TOKEN: 'gh',
    SOME_NEW_SECRET: 'x',
    ANOTHER_API_KEY: 'y',
    CLAUDE_CODE_OAUTH_TOKEN: 'claude',
    GITHUB_BROKER_SOCKET: '/srv/dev-worker/github.sock',
  };
  const forClaude = claudeEnv(base, { claude: true });
  assert.deepEqual(Object.keys(forClaude).sort(), [
    'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
    'AWS_REGION',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'GITHUB_BROKER_SOCKET',
    'PATH',
  ]);
  // Commands other than Claude Code itself do not get Claude's OAuth token either
  assert.equal(claudeEnv(base).CLAUDE_CODE_OAUTH_TOKEN, undefined);
});

test('plain files only: a symlink is refused, even to a readable file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'isolation-'));
  const file = join(dir, 'plan.md');
  const link = join(dir, 'link.md');
  writeFileSync(file, 'plan');
  symlinkSync(file, link);
  assert.equal(isPlainFile(file), true);
  assert.equal(isPlainFile(link), false);
  assert.equal(isPlainFile(dir), false);
  assert.equal(isPlainFile(join(dir, 'missing')), false);
  assert.equal(readPlainFile(file, 'utf8'), 'plan');
  assert.throws(() => readPlainFile(link, 'utf8'));
  assert.throws(() => readPlainFile(dir, 'utf8'));
});
