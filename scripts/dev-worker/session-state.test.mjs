/** Unit tests of session-state.mjs: `node --test scripts/dev-worker/*.test.mjs`. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appendChatLog,
  chatLogEntry,
  CHAT_LOG_TEXT_MAX,
  progressRecord,
  classifierDenial,
  voiceReplyWanted,
  withoutRepeated,
  budgetLevel,
  budgetStates,
  latestBudgetState,
  apiErrorKind,
  backgroundRecord,
  isTimeZone,
  restoreNote,
  timeZoneChoices,
  waitingOn,
  workerStateLine,
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

test('voiceReplyWanted: the mode at sending time decides', () => {
  // on: every answer, also one no message of the owner started (a background task ended)
  for (const trigger of ['voice', 'text', null])
    assert.equal(voiceReplyWanted('on', trigger), true);
  // auto: only the answer to the owner's voice message
  assert.equal(voiceReplyWanted('auto', 'voice'), true);
  assert.equal(voiceReplyWanted('auto', 'text'), false);
  assert.equal(voiceReplyWanted('auto', null), false);
  // off (or an unknown mode): never
  for (const trigger of ['voice', 'text', null]) {
    assert.equal(voiceReplyWanted('off', trigger), false);
    assert.equal(voiceReplyWanted('bogus', trigger), false);
  }
});

test('classifierDenial: the auto mode classifier refusal and its reason, nothing else', () => {
  const refusal =
    'Permission for this action was denied by the Claude Code auto mode classifier. Reason: [Unsanctioned ' +
    'Communication]. If you have other tasks that do not depend on this action, continue working on those.';
  assert.deepEqual(classifierDenial(refusal), { reason: 'Unsanctioned Communication' });
  assert.deepEqual(classifierDenial([{ type: 'text', text: refusal }]), {
    reason: 'Unsanctioned Communication',
  });
  assert.deepEqual(
    classifierDenial(
      'Permission for this action was denied by the Claude Code auto mode classifier.'
    ),
    { reason: null }
  );
  assert.equal(classifierDenial('Exit code 1\nPermission denied'), undefined);
  assert.equal(classifierDenial('The owner declined this action.'), undefined);
  assert.equal(classifierDenial(undefined), undefined);
});

test('progressRecord: request, step and tasks while a turn runs, clipped', () => {
  const NOW = new Date('2026-11-16T10:00:00Z');
  const SINCE = Date.parse('2026-11-16T09:59:00Z');
  const record = progressRecord({
    purpose: 'x'.repeat(5000),
    step: 'Bash: npm test',
    steps: 7,
    backgroundTasks: [{ type: 'bash', description: 'Wait for CI', since: SINCE }],
    lastAnswerAt: '2026-11-16T09:58:00.000Z',
    turnActive: true,
    now: NOW,
  });
  assert.equal(record.updatedAt, NOW.toISOString());
  assert.equal(record.worker, 'running');
  assert.equal(record.turnActive, true);
  assert.equal(record.awaitingAnswer, false);
  assert.equal(record.purpose.length, 1000);
  assert.equal(record.step, 'Bash: npm test');
  assert.equal(record.steps, 7);
  assert.deepEqual(record.backgroundTasks, [
    { type: 'bash', description: 'Wait for CI', since: new Date(SINCE).toISOString() },
  ]);
  assert.ok(JSON.stringify(record).length < 4096);
});

test('progressRecord: between turns only the background tasks and the last answer', () => {
  const record = progressRecord({
    purpose: 'old request',
    step: 'old step',
    steps: 3,
    backgroundTasks: [],
    lastAnswerAt: '2026-11-16T09:58:00.000Z',
    turnActive: false,
  });
  assert.equal(record.purpose, null);
  assert.equal(record.step, null);
  assert.equal(record.steps, 0);
  assert.deepEqual(record.backgroundTasks, []);
  assert.equal(record.lastAnswerAt, '2026-11-16T09:58:00.000Z');
});

test('progressRecord: the worker state and waiting for the owner (only within a turn)', () => {
  const base = { backgroundTasks: [], lastAnswerAt: null };
  assert.equal(progressRecord({ ...base, worker: 'stopped' }).worker, 'stopped');
  assert.equal(progressRecord({ ...base, worker: 'starting' }).worker, 'starting');
  assert.equal(progressRecord({ ...base, worker: 'bogus' }).worker, 'running');
  assert.equal(
    progressRecord({ ...base, turnActive: true, awaitingAnswer: true }).awaitingAnswer,
    true
  );
  assert.equal(
    progressRecord({ ...base, turnActive: false, awaitingAnswer: true }).awaitingAnswer,
    false
  );
});

test('chatLogEntry and appendChatLog: clipped texts, newest lines kept, broken lines dropped', () => {
  const NOW = new Date('2026-11-16T10:00:00Z');
  const entry = chatLogEntry('owner', 'y'.repeat(CHAT_LOG_TEXT_MAX + 50), {
    kind: 'voice',
    now: NOW,
  });
  assert.deepEqual(Object.keys(entry), ['at', 'role', 'kind', 'text']);
  assert.equal(entry.text.length, CHAT_LOG_TEXT_MAX);
  assert.equal(chatLogEntry('worker', 'hi', { now: NOW }).kind, undefined);

  const MAX = 3;
  let content = 'not json\n';
  for (let i = 0; i < 5; i++) content = appendChatLog(content, { n: i }, MAX);
  const lines = content
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(lines, [{ n: 2 }, { n: 3 }, { n: 4 }]);
  assert.ok(content.endsWith('\n'));
});

test('progressRecord: background task ids and the PRs / runs the worker waits on', () => {
  const record = progressRecord({
    turnActive: false,
    backgroundTasks: [
      {
        id: 'b7x2k',
        type: 'bash',
        description: 'Wait for the checks of https://github.com/dmitroderkach/youtube-pip/pull/263',
        command: 'gh pr checks 263 --watch',
        since: 0,
      },
      { id: 'bad id!', type: 'bash', description: 'gh run watch 43913671345', since: 0 },
      {
        type: 'agent',
        description: 'Review',
        command:
          'see https://github.com/dmitroderkach/youtube-pip/actions/runs/123 and gh pr view #262',
        since: 0,
      },
    ],
  });
  assert.deepEqual(
    record.backgroundTasks.map((task) => task.id),
    ['b7x2k', undefined, undefined]
  );
  assert.ok(!('command' in record.backgroundTasks[0]), 'commands stay out of the record');
  assert.deepEqual(record.waitingOn, [
    { kind: 'pr', id: '263', url: 'https://github.com/dmitroderkach/youtube-pip/pull/263' },
    {
      kind: 'run',
      id: '43913671345',
      url: 'https://github.com/dmitroderkach/youtube-pip/actions/runs/43913671345',
    },
    {
      kind: 'run',
      id: '123',
      url: 'https://github.com/dmitroderkach/youtube-pip/actions/runs/123',
    },
    { kind: 'pr', id: '262', url: 'https://github.com/dmitroderkach/youtube-pip/pull/262' },
  ]);
  assert.deepEqual(progressRecord({ turnActive: false }).waitingOn, []);
});

test('waitingOn: deduplicated and capped', () => {
  const tasks = Array.from({ length: 30 }, (_, i) => ({ description: `gh pr checks ${i % 15}` }));
  const found = waitingOn(tasks);
  assert.equal(found.length, 10);
  assert.equal(new Set(found.map((item) => item.id)).size, 10);
});

test('workerStateLine names the PRs / runs the worker waits on', () => {
  const now = Date.parse('2026-11-16T18:00:30Z');
  const line = workerStateLine(
    {
      updatedAt: '2026-11-16T18:00:00Z',
      worker: 'running',
      turnActive: false,
      backgroundTasks: [{ type: 'bash' }],
      waitingOn: [{ kind: 'pr', id: '263', url: 'https://github.com/o/r/pull/263' }],
    },
    now
  );
  assert.match(line, /waiting on PR https:\/\/github\.com\/o\/r\/pull\/263/);
  assert.doesNotMatch(
    workerStateLine({ worker: 'stopped', waitingOn: [{ kind: 'pr', url: 'u' }] }, now),
    /waiting on/
  );
});
