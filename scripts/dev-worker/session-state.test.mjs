/** Unit tests of session-state.mjs: `node --test scripts/dev-worker/*.test.mjs`. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  withoutRepeated,
  budgetLevel,
  budgetStates,
  latestBudgetState,
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

test('Gemini speech budget: Google budget notifications only', () => {
  const pubsub = (data, attributes = { budgetId: 'b', billingAccountId: 'a' }, publishTime) => ({
    ackId: 'x',
    message: {
      data: Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)).toString('base64'),
      attributes,
      publishTime,
    },
  });
  const note = (usd, publishTime, period = '2026-11-01T07:00:00Z') =>
    pubsub(
      {
        budgetDisplayName: 'tts-voice-monthly',
        costAmount: usd,
        costIntervalStart: period,
        budgetAmount: 10,
        currencyCode: 'USD',
      },
      undefined,
      publishTime
    );
  const states = budgetStates([
    note(0.93, '2026-11-11T10:00:00Z'),
    note(1.2, '2026-11-11T12:00:00Z'),
    pubsub('test', {}),
    pubsub({ budgetDisplayName: 'other', costAmount: 5, costIntervalStart: 'x', budgetAmount: 1 }),
    pubsub('{not json'),
  ]);
  assert.equal(states.length, 2);
  assert.deepEqual(states[0], {
    period: '2026-11-01T07:00:00Z',
    usd: 0.93,
    budget: 10,
    currency: 'USD',
    updatedAt: '2026-11-11T10:00:00Z',
  });
  // The newest of the period wins, whatever the order; flags of the same period are kept
  const latest = latestBudgetState({ ...states[1], warned: '2026-11-01T07:00:00Z' }, [states[0]]);
  assert.equal(latest.usd, 1.2);
  assert.equal(latest.warned, '2026-11-01T07:00:00Z');
  assert.equal(latestBudgetState(null, states.slice().reverse()).usd, 1.2);
  // A new period replaces the old one (and its flags)
  const [december] = budgetStates([note(0.1, '2026-12-01T09:00:00Z', '2026-12-01T08:00:00Z')]);
  assert.deepEqual(latestBudgetState(latest, [december]), december);
  assert.equal(latestBudgetState(december, [states[1]]), december);

  const now = Date.parse('2026-11-11T12:00:00Z');
  assert.equal(budgetLevel(null, now), 'none');
  assert.equal(budgetLevel(latest, now), 'ok');
  assert.equal(budgetLevel({ ...latest, usd: 8 }, now), 'warn');
  assert.equal(budgetLevel({ ...latest, usd: 10 }, now), 'exhausted');
  // A figure of the previous month says nothing about this one
  assert.equal(budgetLevel({ ...latest, usd: 10 }, Date.parse('2026-12-02T00:00:00Z')), 'none');
});

test("after a subagent finished in the owner's view, its message is not repeated", () => {
  const seen =
    'Read 5 files in scripts/claude-update. aws-invoke.mjs invokes a Lambda. report.mjs sends the report to Telegram.';
  // The pasted message goes, Claude's own words stay
  assert.equal(
    withoutRepeated(
      'The subagent finished.\n\nRead 5 files in scripts/claude-update. aws-invoke.mjs invokes a Lambda. report.mjs sends the report to Telegram.\n\nNext: a PR.',
      seen
    ),
    'The subagent finished.\n\nNext: a PR.'
  );
  // A list made of its sentences goes too; nothing left → ''
  assert.equal(
    withoutRepeated(
      '- aws-invoke.mjs invokes a Lambda\n\n- report.mjs sends the report to Telegram',
      seen
    ),
    ''
  );
  // Nothing seen: the answer as is
  assert.equal(withoutRepeated('All good', ''), 'All good');
});
