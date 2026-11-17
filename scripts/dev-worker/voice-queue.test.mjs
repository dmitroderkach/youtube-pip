import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPendingWork, createVoiceQueue, voiceFailureText } from './voice-queue.mjs';

const later = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));

test('voice queue: returns at once, synthesizes in parallel, sends in the order of the answers, as replies', async () => {
  const pending = createPendingWork();
  const sent = [];
  const queue = createVoiceQueue({
    // The first answer's voice is slow to make, the second one's fast
    synthesize: (speech) => later(speech === 'first' ? 60 : 5, `audio:${speech}`),
    send: async (audio, { replyTo }) => sent.push([audio, replyTo]),
    pending,
  });
  const started = Date.now();
  const one = queue.enqueue('first', 101);
  const two = queue.enqueue('second', 102);
  assert.ok(Date.now() - started < 20, 'enqueue does not wait for the voice');
  assert.equal(pending.busy(), true, 'the invocation stays up while voices are on their way');
  await Promise.all([one, two]);
  assert.deepEqual(sent, [
    ['audio:first', 101],
    ['audio:second', 102],
  ]);
  assert.equal(pending.busy(), false);
  assert.ok(Date.now() - started < 120, 'the two syntheses ran in parallel');
});

test('voice queue: a failed voice is logged and does not hold back the next one', async () => {
  const pending = createPendingWork();
  const sent = [];
  const logged = [];
  const queue = createVoiceQueue({
    synthesize: async (speech) => {
      if (speech === 'bad') throw new Error('tts down');
      return speech;
    },
    send: async (audio) => sent.push(audio),
    pending,
    onError: (error) => logged.push(voiceFailureText(error)),
  });
  await Promise.all([queue.enqueue('bad', 1), queue.enqueue('good', 2)]);
  assert.deepEqual(sent, ['good']);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /tts down/);
});

test('voice queue: nothing to say, nothing enqueued', async () => {
  const pending = createPendingWork();
  let synthesized = 0;
  const queue = createVoiceQueue({
    synthesize: async () => synthesized++,
    send: async () => {},
    pending,
  });
  await queue.enqueue('   ', 1);
  assert.equal(synthesized, 0);
  assert.equal(pending.busy(), false);
});
