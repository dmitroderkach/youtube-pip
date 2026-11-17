import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { afterEach, test } from 'node:test';
import { taskText } from './fast-lane-core.mjs';
import { createVoice } from './voice.mjs';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ACCOUNT = JSON.stringify({
  client_email: 'speech@example.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  token_uri: 'https://oauth2.example/token',
  project_id: 'speech-project',
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('pullSpeechBudgetIfDue: pulls at once in a new process, not again within the interval', async () => {
  const pulls = [];
  globalThis.fetch = async (url) => {
    if (String(url).startsWith('https://oauth2.example/'))
      return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }));
    pulls.push(String(url));
    return new Response(JSON.stringify({ receivedMessages: [] }));
  };
  const voice = createVoice({
    env: { GOOGLE_TTS_API_KEY: ACCOUNT },
    log: () => {},
    telegram: { say: async () => {} },
    settings: { get: () => ({}), set: () => {} },
    store: { getJson: async () => null, putJson: async () => {}, updateJson: async () => ({}) },
    aws: async () => '',
    upload: async () => {},
    bucket: 'state',
  });
  await voice.pullSpeechBudgetIfDue();
  const first = pulls.length;
  assert.ok(first >= 1, 'pulled once');
  assert.ok(pulls.every((url) => url.includes('/subscriptions/tts-budget-worker')));
  await voice.pullSpeechBudgetIfDue();
  assert.equal(pulls.length, first, 'not again within BUDGET_PULL_MS');
});

test('taskText: the whole task for the hand-over line, clipped only past a Telegram-sized limit', () => {
  const long = 'x'.repeat(5000);
  assert.equal(
    taskText('  fix the status line\nand the docs  '),
    'fix the status line\nand the docs'
  );
  assert.equal(taskText(long).length, 3000);
  assert.ok(taskText(long).endsWith('…'));
});
