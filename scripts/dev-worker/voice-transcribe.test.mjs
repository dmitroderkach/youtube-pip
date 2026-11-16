import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
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

/** Gemini answers in order (status, text); records the models asked. */
function stubGemini(answers) {
  const models = [];
  globalThis.fetch = async (url) => {
    if (String(url).startsWith('https://oauth2.example/'))
      return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }));
    models.push(/models\/([^:]+):generateContent/.exec(String(url))[1]);
    const { status, text } = answers.shift();
    const body =
      status === 200
        ? { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }
        : { error: { message: 'Resource exhausted. Please try again later.' } };
    return new Response(JSON.stringify(body), { status });
  };
  return models;
}

function voiceFor(env, awsCalls = []) {
  const dir = mkdtempSync(join(tmpdir(), 'voice-test-'));
  const path = join(dir, 'voice.oga');
  writeFileSync(path, Buffer.alloc(3000));
  const voice = createVoice({
    env: { GOOGLE_TTS_API_KEY: ACCOUNT, ...env },
    log: () => {},
    telegram: {},
    settings: { get: () => ({}), set: () => {} },
    store: { getJson: async () => null, putJson: async () => {} },
    aws: async (...args) => {
      awsCalls.push(args);
      throw new Error('no AWS in this test');
    },
    upload: async () => {
      awsCalls.push(['upload']);
      throw new Error('no AWS in this test');
    },
    bucket: 'state',
  });
  return { voice, path };
}

test('transcribe: an overloaded Gemini 3.5 Flash is retried once, then Gemini 2.5 Flash answers', async () => {
  const models = stubGemini([
    { status: 429 },
    { status: 429 },
    { status: 200, text: 'привіт, це тест' },
  ]);
  const { voice, path } = voiceFor({});
  assert.equal(await voice.transcribe(path, 'audio/ogg', { seconds: 2 }), 'привіт, це тест');
  assert.deepEqual(models, ['gemini-3.5-flash', 'gemini-3.5-flash', 'gemini-2.5-flash']);
});

test('transcribe: no AWS fallback in the fast lane: every Gemini attempt failed, it throws at once', async () => {
  const models = stubGemini([{ status: 429 }, { status: 503 }, { status: 429 }]);
  const awsCalls = [];
  const { voice, path } = voiceFor({ TRANSCRIBE_AWS_FALLBACK: 'off' }, awsCalls);
  await assert.rejects(voice.transcribe(path, 'audio/ogg', { seconds: 2 }), /Gemini 429/);
  assert.equal(models.length, 3);
  assert.deepEqual(awsCalls, []);
});

test('transcribe: a non-overload error is not retried with Gemini (the worker falls back to AWS)', async () => {
  const models = stubGemini([{ status: 400 }]);
  const awsCalls = [];
  const { voice, path } = voiceFor({}, awsCalls);
  await assert.rejects(voice.transcribe(path, 'audio/ogg', { seconds: 2 }));
  assert.deepEqual(models, ['gemini-3.5-flash']);
  assert.ok(awsCalls.length > 0);
});
