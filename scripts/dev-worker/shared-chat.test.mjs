/** Unit tests of the shared chat modules (telegram.mjs, incoming.mjs, interactions.mjs, status.mjs). */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { htmlToText, splitMessage, TELEGRAM_MAX_LENGTH } from './telegram.mjs';
import { contextLines, createIncoming } from './incoming.mjs';
import { createInteractions } from './interactions.mjs';
import { createPinnedStatus } from './status.mjs';

test('splitMessage: one chunk under the limit, cuts at a line break over it', () => {
  assert.deepEqual(splitMessage('  short  '), ['short']);
  const line = 'x'.repeat(TELEGRAM_MAX_LENGTH - 10);
  const chunks = splitMessage(`${line}\n${line}`);
  assert.equal(chunks.length, 2);
  assert.ok(chunks.every((chunk) => chunk.length <= TELEGRAM_MAX_LENGTH));
  assert.deepEqual(
    splitMessage('y'.repeat(TELEGRAM_MAX_LENGTH + 5)).map((c) => c.length),
    [TELEGRAM_MAX_LENGTH, 5]
  );
});

test('htmlToText: tags dropped, entities decoded', () => {
  assert.equal(htmlToText('<b>a &lt;b&gt; &amp; c</b>'), 'a <b> & c');
});

test('contextLines: a forward and a quoted reply', () => {
  assert.equal(contextLines({ text: 'hi' }), '');
  assert.equal(
    contextLines({ forwarded_from: 'Alice' }),
    '[The owner forwarded this message from Alice.]'
  );
  const lines = contextLines({
    reply_to: { from_bot: true, text: 'one\ntwo', quote: 'two', attachments: ['photo'], date: 0 },
  });
  assert.match(lines, /reply to an earlier message from the bot/);
  assert.match(lines, /\(it had: photo\)/);
  assert.match(lines, /> one\n> two/);
  assert.match(lines, /The owner quoted this part of it: "two"/);
});

/** A fake Telegram client recording what was sent and edited. */
function fakeTelegram() {
  const sent = [];
  const edits = [];
  let nextId = 1;
  return {
    sent,
    edits,
    sayHtml: async (html, markup) => {
      sent.push({ html, markup });
      return { message_id: nextId++ };
    },
    editHtml: async (messageId, html) => edits.push({ messageId, html }),
    editButtons: async () => {},
  };
}

test('interactions: a question answered by a button, the message edited with the answer', async () => {
  const telegram = fakeTelegram();
  let waiting = 0;
  const interactions = createInteractions({ telegram, onWaiting: () => waiting++ });
  const question = { question: 'Which?', options: [{ label: 'A' }, { label: 'B' }] };
  const result = interactions.askQuestions({ questions: [question] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(waiting, 1);
  const entry = interactions.getTextTarget();
  assert.equal(entry.kind, 'q');
  await interactions.onQuestionButton(entry, 'x.1');
  const outcome = await result;
  assert.deepEqual(outcome, {
    behavior: 'allow',
    updatedInput: { questions: [question], answers: { 'Which?': 'B' } },
  });
  assert.match(telegram.edits.at(-1).html, /✅ <b>B<\/b>/);
  assert.equal(interactions.getTextTarget(), null);
});

test("interactions: a permission prompt answered with text is a denial with the owner's words", async () => {
  const telegram = fakeTelegram();
  const interactions = createInteractions({ telegram });
  const result = interactions.askPermission('Bash', { command: 'ls' }, {});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(interactions.answersPending({ attachments: [{ kind: 'photo' }] }), false);
  assert.equal(interactions.answersPending({ text: 'no' }), true);
  interactions.answerText('do it later');
  const outcome = await result;
  assert.equal(outcome.behavior, 'deny');
  assert.match(outcome.message, /do it later/);
});

test('interactions: abortAll gives up everything waiting', async () => {
  const telegram = fakeTelegram();
  const interactions = createInteractions({ telegram });
  const result = interactions.askPermission('Bash', { command: 'ls' }, {});
  await new Promise((resolve) => setImmediate(resolve));
  interactions.abortAll();
  const outcome = await result;
  assert.equal(outcome.behavior, 'deny');
  assert.equal(interactions.getTextTarget(), null);
});

test('pinned status: sends and pins once, then edits; an unchanged body is not sent again', async () => {
  const calls = [];
  let meta = {};
  let persisted = 0;
  const telegram = {
    call: async (method) => {
      calls.push(method);
      return method === 'sendMessage' ? { message_id: 7 } : true;
    },
    request: async (method) => {
      calls.push(method);
      return { ok: true };
    },
  };
  let body = 'A';
  const status = createPinnedStatus({
    log: () => {},
    telegram,
    chatId: '1',
    getMeta: () => meta,
    setMeta: (value) => {
      meta = value;
    },
    persistMeta: async () => {
      persisted++;
    },
    body: async () => body,
    formatTime: () => '12:00',
  });
  await status.updateStatus();
  assert.deepEqual(calls, ['sendMessage', 'pinChatMessage']);
  assert.equal(meta.statusMessageId, 7);
  assert.equal(persisted, 1);
  await status.updateStatus();
  assert.deepEqual(calls, ['sendMessage', 'pinChatMessage']);
  body = 'B';
  await status.updateStatus();
  assert.deepEqual(calls, ['sendMessage', 'pinChatMessage', 'editMessageText']);
});

test('incoming: a voice message is transcribed, shown and kept; a photo becomes a path for Claude', async () => {
  const said = [];
  const logged = [];
  const store = new Map();
  const incoming = createIncoming({
    log: (line) => logged.push(line),
    telegram: {
      say: async (text) => said.push(text),
      download: async (fileId) => `/inbox/${fileId}`,
    },
    voice: { transcribe: async () => 'привіт' },
    store: {
      getJson: async (key) => store.get(key) ?? null,
      updateJson: async (key, change) => store.set(key, change(store.get(key) ?? {})),
    },
  });
  const statuses = [];
  const prompt = await incoming.buildPrompt(
    {
      message_id: 42,
      text: 'look',
      attachments: [
        { kind: 'voice', file_id: 'v1', mime_type: 'audio/ogg' },
        { kind: 'photo', file_id: 'p1' },
      ],
    },
    async (status) => statuses.push(status)
  );
  assert.deepEqual(statuses, ['🎙 Розпізнаю аудіо…']);
  assert.deepEqual(said, ['🎙 Розпізнав: «привіт»']);
  // Where the seconds of a voice message go: one timing line per voice attachment
  const timing = logged
    .map((line) => JSON.parse(line))
    .find((entry) => entry.timing === 'voice-in');
  assert.ok(timing);
  for (const step of ['downloadMs', 'statusMs', 'transcribeMs', 'shownMs'])
    assert.equal(typeof timing[step], 'number');
  assert.equal(
    prompt,
    'привіт\n\nlook\n\n[The owner attached an image: /inbox/p1. Open it with the Read tool.]'
  );
  assert.deepEqual(await incoming.voiceTranscripts(), { 42: 'привіт' });
});

test('contextLines: a message handed over by the fast lane is marked as such', async () => {
  const { contextLines } = await import('./incoming.mjs');
  assert.match(contextLines({ handover: true, text: 'x' }), /Handed over by the fast lane/);
  assert.equal(contextLines({ text: 'x' }), '');
});
