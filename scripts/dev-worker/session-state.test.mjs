/** Unit tests of session-state.mjs: `node --test scripts/dev-worker/*.test.mjs`. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  apiErrorKind,
  backgroundRecord,
  isTimeZone,
  restoreNote,
  timeZoneChoices,
} from './session-state.mjs';

test('background record: command or prompt from the tool call, the purpose clipped', () => {
  const now = new Date('2026-11-09T15:00:00Z');
  const shell = backgroundRecord(
    { task_id: 't1', task_type: 'local_bash', description: 'Watch CI' },
    {
      call: { name: 'Bash', input: { command: 'gh run watch 1', description: 'Watch CI' } },
      purpose: 'x'.repeat(1200),
      sessionId: 's1',
      now,
    }
  );
  assert.equal(shell.command, 'gh run watch 1');
  assert.equal(shell.tool, 'Bash');
  assert.equal(shell.purpose.length, 1000);
  assert.equal(shell.startedAt, '2026-11-09T15:00:00.000Z');
  const agent = backgroundRecord(
    {
      task_id: 'a1',
      task_type: 'local_agent',
      description: 'Review',
      subagent_type: 'general-purpose',
    },
    { start: { prompt: 'Review the worker' }, now }
  );
  assert.equal(agent.prompt, 'Review the worker');
  assert.equal(agent.command, null);
  assert.equal(agent.subagentType, 'general-purpose');
});

test('restore note: shells run again, subagents resumed by id with the prompt as fallback', () => {
  const note = restoreNote([
    {
      taskId: 't1',
      taskType: 'local_bash',
      tool: 'Bash',
      description: 'Watch CI',
      command: 'gh run watch 1',
      purpose: 'fix it',
    },
    {
      taskId: 'a1',
      taskType: 'local_agent',
      description: 'Review',
      prompt: 'Review the worker',
      subagentType: 'general-purpose',
    },
  ]);
  assert.match(
    note,
    /1\. Bash task "Watch CI"\. It was started for the owner's message: «fix it»\. .*`gh run watch 1`/
  );
  assert.match(
    note,
    /2\. Subagent \(general-purpose\) "Review", task id a1\. Resume it with SendMessage to "a1"/
  );
  assert.match(note, /«Review the worker»/);
});

test('API errors in plain words: overloaded, auth, context, 429, 5xx, network; others unknown', () => {
  assert.deepEqual(apiErrorKind('API Error: 529 {"type":"overloaded_error"}').retry, true);
  assert.match(apiErrorKind('API Error: 529 Overloaded').text, /перевантажений/);
  assert.equal(apiErrorKind('API Error: 401 authentication_error: invalid token').retry, false);
  assert.match(apiErrorKind('Prompt is too long').text, /compact/);
  assert.match(apiErrorKind('API Error: 429 rate_limit_error').text, /Забагато/);
  assert.match(apiErrorKind('API Error: 500 {"type":"api_error"}').text, /5xx/);
  assert.match(apiErrorKind('Request timed out').text, /таймаут/);
  assert.equal(apiErrorKind('Some tool failed: file not found'), null);
  assert.equal(apiErrorKind(''), null);
});

test('time zones: IANA names; geocoding answers to choices with exact names only', () => {
  assert.equal(isTimeZone('Europe/Kyiv'), true);
  assert.equal(isTimeZone('America/Argentina/Buenos_Aires'), true);
  assert.equal(isTimeZone('Europe/Atlantis'), false);
  assert.equal(isTimeZone('Самбір'), false);
  const sambir = [
    {
      name: 'Самбір',
      admin1: 'Львівська Область',
      country: 'Україна',
      timezone: 'Europe/Kyiv',
      population: 34152,
    },
  ];
  assert.deepEqual(timeZoneChoices(sambir, ' самбір ').auto, 'Europe/Kyiv');
  const paris = timeZoneChoices(
    [
      { name: 'Париж', admin1: 'Іль-де-Франс', country: 'Франція', timezone: 'Europe/Paris' },
      { name: 'Париж', admin1: 'Техас', country: 'США', timezone: 'America/Chicago' },
      { name: 'Парижлє', country: 'Словенія', timezone: 'Europe/Ljubljana' },
    ],
    'Париж'
  );
  assert.equal(paris.auto, null);
  const warsaw = timeZoneChoices(
    [
      {
        name: 'Warsaw',
        admin1: 'Індіана',
        country: 'США',
        timezone: 'America/Indiana/Indianapolis',
        population: 13559,
      },
      {
        name: 'Варшава',
        names: ['Warsaw'],
        country: 'Польща',
        timezone: 'Europe/Warsaw',
        population: 1702139,
      },
    ],
    'Warsaw'
  );
  assert.deepEqual(
    [warsaw.auto, warsaw.guessed, warsaw.choices[0].label],
    ['Europe/Warsaw', true, 'Варшава, Польща']
  );
  assert.deepEqual(
    paris.choices.map((c) => [c.label, c.timeZone]),
    [
      ['Париж, Іль-де-Франс, Франція', 'Europe/Paris'],
      ['Париж, Техас, США', 'America/Chicago'],
    ]
  );
  assert.equal(
    timeZoneChoices(
      [{ name: 'Київ', names: ['Kyiv'], country: 'Україна', timezone: 'Europe/Kyiv' }],
      'kyiv'
    ).auto,
    'Europe/Kyiv'
  );
  assert.equal(
    timeZoneChoices([{ name: 'Краків', names: ['Krakow'], timezone: 'Europe/Warsaw' }], 'Kraków')
      .auto,
    'Europe/Warsaw'
  );
  assert.deepEqual(timeZoneChoices([], 'x'), { choices: [], auto: null, guessed: false });
});
