import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scrub, secretValues } from './scrub-secrets.mjs';

const ENV = {
  CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-abcdefghijklmnopqrstuvwxyz',
  TELEGRAM_BOT_TOKEN: '123456789:AAHsecretpartofthebottoken_xyz',
  TELEGRAM_CHAT_ID: '987654321',
  GITHUB_TOKEN: 'ghs_0123456789abcdefghij',
  SHORT_TOKEN: 'abc',
  PATH: '/usr/bin:/bin:/usr/local/bin:/opt/something/long',
};

test('secretValues: tokens and the bot token secret part, not the chat id, short values or PATH', () => {
  const values = secretValues(ENV);
  assert.ok(values.includes(ENV.CLAUDE_CODE_OAUTH_TOKEN));
  assert.ok(values.includes(ENV.TELEGRAM_BOT_TOKEN));
  assert.ok(values.includes('AAHsecretpartofthebottoken_xyz'));
  assert.ok(values.includes(ENV.GITHUB_TOKEN));
  assert.ok(!values.includes(ENV.TELEGRAM_CHAT_ID));
  assert.ok(!values.includes('abc'));
  assert.ok(!values.includes(ENV.PATH));
  // Longest first
  assert.deepEqual(
    values,
    [...values].sort((a, b) => b.length - a.length)
  );
});

test('scrub: plain, JSON-escaped and partial (bot token secret part) occurrences', () => {
  const values = secretValues(ENV);
  const text = [
    `CLAUDE_CODE_OAUTH_TOKEN=${ENV.CLAUDE_CODE_OAUTH_TOKEN}`,
    JSON.stringify({ content: `token ${ENV.TELEGRAM_BOT_TOKEN}\n` }),
    'secret only: AAHsecretpartofthebottoken_xyz',
    'chat 987654321 stays',
  ].join('\n');
  const [clean, count] = scrub(text, values);
  assert.equal(count, 3);
  for (const value of values) assert.ok(!clean.includes(value), value);
  assert.ok(clean.includes('chat 987654321 stays'));
  assert.equal(clean.split('[redacted]').length - 1, 3);
});

test('scrub: a value with characters JSON escapes is found in a JSON line', () => {
  const values = ['secret"with\\quote-and-more'];
  const line = JSON.stringify({ text: `x ${values[0]} y` });
  const [clean, count] = scrub(line, values);
  assert.equal(count, 1);
  assert.equal(JSON.parse(clean).text, 'x [redacted] y');
});

test('scrub: nothing to replace', () => {
  assert.deepEqual(scrub('all clean', secretValues(ENV)), ['all clean', 0]);
});
