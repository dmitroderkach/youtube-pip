/** Unit tests of telegram-format.mjs: `node --test scripts/dev-worker/`. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CALLBACK_DATA_MAX,
  EFFORT_LEVELS,
  effortKeyboard,
  modelKeyboard,
  modelText,
  FOLD_SECTION_LINES,
  inlineHtml,
  markdownBlocks,
  modeKeyboard,
  parseCallback,
  permissionHtml,
  permissionKeyboard,
  planKeyboard,
  planMessages,
  planSlug,
  planTitle,
  questionHtml,
  questionKeyboard,
  tableText,
  voiceKeyboard,
  voiceText,
} from './telegram-format.mjs';

test('inline Markdown becomes Telegram HTML, the rest is escaped', () => {
  assert.equal(
    inlineHtml('**Bold** and *it* with `a<b>` & [link](https://x.y/z)'),
    '<b>Bold</b> and <i>it</i> with <code>a&lt;b&gt;</code> &amp; <a href="https://x.y/z">link</a>'
  );
  assert.equal(inlineHtml('snake_case_name stays'), 'snake_case_name stays');
  assert.equal(inlineHtml('`**not bold**`'), '<code>**not bold**</code>');
});

test('blocks: headings, bullets, numbers, code, tables, quotes', () => {
  const html = markdownBlocks(
    [
      '# Title',
      '### Sub',
      '- one',
      '  - nested',
      '- [x] done',
      '2. step',
      '> note',
      '```',
      'if (a < b) {}',
      '```',
      '| A | Bee |',
      '|---|-----|',
      '| 1 | 2 |',
    ].join('\n')
  ).map((b) => b.html);
  assert.deepEqual(html, [
    '<b>Title</b>',
    '<b><i>Sub</i></b>',
    '• one',
    '   ◦ nested',
    '• ☑️ done',
    '<b>2.</b> step',
    '┃ <i>note</i>',
    '<pre>if (a &lt; b) {}</pre>',
    '<pre>A │ Bee\n──┼────\n1 │ 2</pre>',
  ]);
});

test('tables are aligned by the widest cell', () => {
  assert.equal(
    tableText(['| x | long |', '|--|--|', '| **wide cell** | y |']),
    ['x         │ long', '──────────┼─────', 'wide cell │ y'].join('\n')
  );
});

test('plan: long sections are folded, short ones are not, header first', () => {
  const long = Array.from({ length: FOLD_SECTION_LINES + 2 }, (_, i) => `- item ${i}`).join('\n');
  const [message, ...rest] = planMessages(
    `# Plan\n\n## Short\n\ntext\n\n## Long\n\n${long}`,
    'HEADER'
  );
  assert.equal(rest.length, 0);
  assert.ok(message.startsWith('HEADER\n\n<b>Plan</b>'));
  assert.match(message, /<b>Short<\/b>\ntext/);
  assert.match(message, /<b>Long<\/b>\n<blockquote expandable>• item 0/);
  assert.equal((message.match(/<blockquote/g) ?? []).length, 1);
});

test('plan: split into messages under the limit with tags never cut', () => {
  const sections = Array.from(
    { length: 30 },
    (_, i) => `## Section ${i}\n\n${'Some **bold** words & more. '.repeat(20)}`
  ).join('\n\n');
  const messages = planMessages(`# Big\n\n${sections}`, 'H', 1500);
  assert.ok(messages.length > 3);
  for (const message of messages) {
    assert.ok(message.length <= 1500, `${message.length}`);
    assert.equal((message.match(/<b>/g) ?? []).length, (message.match(/<\/b>/g) ?? []).length);
  }
  const huge = planMessages(`# Code\n\n\`\`\`\n${'x = 1 & 2\n'.repeat(400)}\`\`\``, 'H', 1000);
  for (const message of huge) {
    assert.ok(message.length <= 1000);
    assert.equal((message.match(/<pre>/g) ?? []).length, (message.match(/<\/pre>/g) ?? []).length);
    assert.doesNotMatch(message, /&(?!amp;|lt;|gt;)/);
  }
});

test('plan title and slug', () => {
  assert.equal(planTitle('Intro\n## **Add** `modes` to the bot\n'), 'Add modes to the bot');
  assert.equal(planTitle(''), 'План');
  assert.equal(
    planSlug('Add modes: /mode & plans!', new Date('2026-11-09T14:05:33Z')),
    '2026-11-09T14-05-add-modes-mode-plans'
  );
  assert.equal(planSlug('План', new Date('2026-11-09T14:05:33Z')), '2026-11-09T14-05');
});

test('question keyboard: options, multi-select marks, own answer; data within 64 bytes', () => {
  const question = {
    header: 'Lib',
    question: 'Which <one>?',
    multiSelect: true,
    options: [
      { label: 'A', description: 'first' },
      { label: 'B', description: 'second' },
    ],
  };
  const rows = questionKeyboard('abc123', 1, question, new Set([1])).inline_keyboard;
  assert.deepEqual(
    rows.map((row) => [row[0].text, row[0].callback_data]),
    [
      ['⬜ A', 'q:abc123:1.0'],
      ['☑️ B', 'q:abc123:1.1'],
      ['✅ Готово', 'q:abc123:1.done'],
      ['✏️ Свій варіант', 'q:abc123:1.own'],
    ]
  );
  assert.match(questionHtml(question, 1, 2), /Which &lt;one&gt;\?/);
  assert.match(questionHtml(question, 1, 2), /\(2\/2\)/);
  const single = questionKeyboard('id', 0, { ...question, multiSelect: false }).inline_keyboard;
  assert.equal(single.length, 3);
  assert.equal(single[0][0].text, 'A');
  for (const keyboard of [
    planKeyboard('zzzzzzzz'),
    permissionKeyboard('zzzzzzzz', true),
    modeKeyboard('auto'),
  ]) {
    for (const row of keyboard.inline_keyboard) {
      for (const button of row)
        assert.ok(Buffer.byteLength(button.callback_data) <= CALLBACK_DATA_MAX);
    }
  }
});

test('callback data parsing', () => {
  assert.deepEqual(parseCallback('q:abc:1.2'), { kind: 'q', id: 'abc', value: '1.2' });
  assert.deepEqual(parseCallback('mode:auto'), { kind: 'mode', id: 'auto', value: '' });
  assert.deepEqual(parseCallback(undefined), { kind: '', id: undefined, value: '' });
});

test('mode keyboard marks the current mode and the default', () => {
  const texts = modeKeyboard('plan').inline_keyboard.map((row) => row[0].text);
  assert.deepEqual(texts, ['🚀 bypass (дефолт)', '🤖 auto', '✋ manual', '✓ 📋 plan']);
});

test('permission prompt shows the command or the edit as a diff, escaped', () => {
  const bash = permissionHtml(
    'Bash',
    { command: 'rm -rf <dir>', description: 'Clean' },
    { title: 'Run it?' }
  );
  assert.match(bash, /<b>Run it\?<\/b>/);
  assert.match(bash, /<pre>rm -rf &lt;dir&gt;<\/pre>/);
  const editHtml = permissionHtml('Edit', { file_path: '/a.js', old_string: 'x', new_string: 'y' });
  assert.match(editHtml, /<pre>- x\n\+ y<\/pre>/);
  assert.equal(permissionKeyboard('i', false).inline_keyboard.length, 1);
});

test('model and effort keyboards', () => {
  const models = [
    { value: 'opus', displayName: 'Opus', description: 'Most capable' },
    { value: 'sonnet', displayName: 'Sonnet', description: '' },
  ];
  const rows = modelKeyboard(models, 'sonnet').inline_keyboard;
  assert.deepEqual(
    rows.map((row) => [row[0].text, row[0].callback_data]),
    [
      ['Opus', 'model:0'],
      ['✓ Sonnet', 'model:1'],
    ]
  );
  assert.match(modelText(models, 'sonnet'), /<b>Opus<\/b> <code>opus<\/code>\nMost capable/);
  const effort = effortKeyboard(['low', 'high'], 'high').inline_keyboard;
  assert.deepEqual(
    effort[0].map((b) => [b.text, b.callback_data]),
    [
      ['low', 'effort:low'],
      ['✓ high', 'effort:high'],
    ]
  );
  assert.equal(effort[1][0].text, 'за замовчуванням моделі');
  assert.equal(
    effortKeyboard(EFFORT_LEVELS, null).inline_keyboard[1][0].text,
    '✓ за замовчуванням моделі'
  );
});

test('voice keyboard: modes, voices three per row, samples; current ones marked', () => {
  const rows = voiceKeyboard(['Aoede', 'Kore', 'Leda', 'Zephyr'], 'on', 'Kore').inline_keyboard;
  assert.deepEqual(
    rows.map((row) => row.map((b) => [b.text, b.callback_data])),
    [
      [
        ['auto', 'voice:mode:auto'],
        ['✓ on', 'voice:mode:on'],
        ['off', 'voice:mode:off'],
      ],
      [
        ['Aoede', 'voice:name:Aoede'],
        ['✓ Kore', 'voice:name:Kore'],
        ['Leda', 'voice:name:Leda'],
      ],
      [['Zephyr', 'voice:name:Zephyr']],
      [['🔈 Зразки голосів', 'voice:samples']],
    ]
  );
  assert.match(voiceText('on', 'Kore'), /<b>on<\/b> · голос <b>Kore<\/b>/);
});
