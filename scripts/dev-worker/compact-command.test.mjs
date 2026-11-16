/**
 * Tests of `/compact` with the lane switch (compact-command.mjs) and the fast lane's own compaction (fast-lane.mjs
 * compactOwn), with a stubbed session and Telegram: `node --test scripts/dev-worker/*.test.mjs`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compactKeyboard, compactResultText, createCompactCommand } from './compact-command.mjs';
import {
  compactOwn,
  consumeForTest,
  pendingInputForTest,
  useSessionForTest,
  useTelegramForTest,
} from './fast-lane.mjs';
import { parseCallback } from './telegram-format.mjs';

function recordingTelegram() {
  const sent = [];
  return {
    sent,
    say: async (text) => sent.push({ text }),
    sayHtml: async (html, markup) => sent.push({ html, markup }),
    editButtons: async (id) => sent.push({ editButtons: id }),
    call: async (method, body) => sent.push({ method, body }),
  };
}

test('the lane switch: two buttons, the instructions behind a token, one press each', async () => {
  const telegram = recordingTelegram();
  const runs = [];
  const compact = createCompactCommand({
    telegram,
    compactLane: async (lane, instructions) => runs.push([lane, instructions]),
  });
  assert.deepEqual(compactKeyboard().inline_keyboard[0], [
    { text: '⚡ Лямбда', callback_data: 'cmp:f' },
    { text: '🛠 Робочий воркер', callback_data: 'cmp:w' },
  ]);

  await compact.handleCommand('  keep <the> plan  ');
  const question = telegram.sent.at(-1);
  // The instructions are shown escaped, and the buttons carry a token, not the text
  assert.match(question.html, /keep &lt;the&gt; plan/);
  const [fast, worker] = question.markup.inline_keyboard[0].map((button) => button.callback_data);
  assert.match(fast, /^cmp:f:[0-9a-f]{12}$/);
  assert.equal(worker, `cmp:w:${fast.split(':')[2]}`);

  assert.equal(await compact.handleCallback(5, parseCallback(worker)), true);
  assert.deepEqual(runs, [['w', 'keep <the> plan']]);
  assert.deepEqual(telegram.sent.at(-1), { editButtons: 5 });
  // The other button of the same question: its instructions are used up
  await compact.handleCallback(5, parseCallback(fast));
  assert.match(telegram.sent.at(-1).text, /неактуальне/);
  assert.equal(runs.length, 1);

  await compact.handleCommand('');
  await compact.handleCallback(6, parseCallback('cmp:f'));
  assert.deepEqual(runs.at(-1), ['f', '']);
  await compact.handleCallback(7, parseCallback('cmp:x'));
  assert.match(telegram.sent.at(-1).text, /неактуальне/);
  assert.equal(await compact.handleCallback(8, parseCallback('model:0:f')), false);
});

test('compactResultText: before → after, or the failure', () => {
  const before = { percentage: 61.2, totalTokens: 120_400 };
  const after = { percentage: 9, totalTokens: 18_000 };
  assert.equal(
    compactResultText({ subtype: 'success' }, before, after),
    '🗜 Контекст стиснуто: 61% (120k) → 9% (18k)'
  );
  assert.equal(
    compactResultText({ subtype: 'success' }, null, after, 'Лямбда: '),
    '🗜 Лямбда: Контекст стиснуто: ? → 9% (18k)'
  );
  assert.equal(
    compactResultText({ subtype: 'error_during_execution', errors: ['boom'] }, before, after),
    '⚠️ /compact не вдався: boom'
  );
});

test("the fast lane compacts its own live session: '/compact' sent by the handler, one line back", async () => {
  const telegram = recordingTelegram();
  useTelegramForTest(telegram);

  // No live session in the sandbox: nothing to compact
  useSessionForTest(null, { alive: false });
  assert.equal(await compactOwn('keep it'), 'no session');
  assert.match(telegram.sent.at(-1).text, /живої сесії зараз немає/);

  const usage = [
    { percentage: 40, totalTokens: 80_000 },
    { percentage: 5, totalTokens: 10_000 },
  ];
  const session = { getContextUsage: async () => usage.shift() };

  // A turn is running: not now
  useSessionForTest(session, { turn: true });
  assert.equal(await compactOwn(''), 'busy');
  assert.match(telegram.sent.at(-1).text, /зараз відповідає/);

  useSessionForTest(session);
  const queued = pendingInputForTest().length;
  assert.equal(await compactOwn('  keep the PR list '), 'started');
  const input = pendingInputForTest();
  assert.equal(input.length, queued + 1);
  assert.equal(input.at(-1).message.content, '/compact keep the PR list');

  // Its result is reported in one line instead of a model answer, and the lane is free again
  const state = await consumeForTest([{ type: 'result', subtype: 'success', result: '' }]);
  assert.equal(telegram.sent.at(-1).text, '🗜 Лямбда: Контекст стиснуто: 40% (80k) → 5% (10k)');
  assert.deepEqual(state, { turnActive: false, compacting: null });
});
