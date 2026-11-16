/**
 * Tests of the settings of both lanes (settings.mjs), the shared /model, /effort, /mode (settings-commands.mjs) in
 * the fast lane and in the worker, and the fast lane's other commands (fast-lane-commands.mjs), on an in-memory
 * bucket: `node --test scripts/dev-worker/*.test.mjs`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prefixCallbacks } from './fast-lane-core.mjs';
import { createFastLaneCommands } from './fast-lane-commands.mjs';
import { createSettingsCommands } from './settings-commands.mjs';
import {
  controlText,
  describeControl,
  resolveSettings,
  settingsUpdate,
  splitControl,
  validControl,
} from './settings.mjs';

/** An in-memory state bucket with the s3-objects.mjs interface the commands use. */
function memoryStore(initial = {}) {
  const objects = new Map(Object.entries(initial));
  return {
    objects,
    json: (key) => (objects.has(key) ? JSON.parse(objects.get(key)) : undefined),
    get: async (key) => objects.get(key) ?? null,
    getJson: async (key) => (objects.has(key) ? JSON.parse(objects.get(key)) : null),
    list: async (prefix) => [...objects.keys()].filter((key) => key.startsWith(prefix)),
    delete: async (key) => objects.delete(key),
    async updateJson(key, patch) {
      const current = objects.has(key) ? JSON.parse(objects.get(key)) : {};
      const merged = typeof patch === 'function' ? patch(current) : { ...current, ...patch };
      for (const [name, value] of Object.entries(merged))
        if (value === undefined) delete merged[name];
      objects.set(key, JSON.stringify(merged));
      return merged;
    },
  };
}

/** A Telegram stub that records what was said and the buttons. */
function recordingTelegram() {
  const sent = [];
  return {
    sent,
    say: async (text) => sent.push({ text }),
    sayHtml: async (html, markup) => sent.push({ html, markup }),
    editHtml: async (id, html, markup) => sent.push({ edit: id, html, markup }),
    editButtons: async (id) => sent.push({ editButtons: id }),
    sendFile: async (path) => sent.push({ file: path }),
  };
}

const callbackOf = (markup, text) =>
  markup.inline_keyboard.flat().find((button) => button.text.includes(text))?.callback_data;
const RUNNING = JSON.stringify({ worker: 'running', turnActive: true });
const STOPPED = JSON.stringify({ worker: 'stopped', turnActive: false });

function fastLane({ objects = {}, places = [] } = {}) {
  const store = memoryStore(objects);
  const telegram = recordingTelegram();
  const toWorker = [];
  const applied = [];
  const voiceCalls = [];
  const commands = createFastLaneCommands({
    telegram,
    store,
    voice: {
      voiceCommand: async (argument) => voiceCalls.push(['command', argument]),
      onVoiceButton: async (...args) => voiceCalls.push(['button', ...args]),
    },
    toWorker: async (message, reason) => toWorker.push({ ...message, reason }),
    applyFastLane: async (value) => applied.push(value),
    searchPlaces: async () => places,
    download: async (key) => `/tmp/${key}`,
  });
  return { commands, store, telegram, toWorker, applied, voiceCalls };
}

/** The worker's side of the shared module, with its live session as a log of what it applied. */
function workerHost({ objects = {}, refuse = false } = {}) {
  const store = memoryStore(objects);
  const telegram = recordingTelegram();
  const live = [];
  const commands = createSettingsCommands({
    host: 'w',
    telegram,
    store,
    readMeta: async () => ({ model: 'opus', mode: 'auto' }),
    applyLive: async (lane, patch) => {
      live.push({ lane, ...patch });
      return !refuse;
    },
    notifyOther: async () => 'Лямбда застосує з наступної відповіді',
  });
  return { commands, store, telegram, live };
}

// ---------------------------------------------------------------------------------------------- settings.mjs

test('resolveSettings: settings.json first, then the old meta.json, then the defaults', () => {
  assert.deepEqual(resolveSettings(null, null), {
    fastLane: { model: 'sonnet', effort: 'low' },
    worker: { model: 'opus', effort: null, mode: 'bypass' },
    shared: {
      timeZone: 'Europe/Warsaw',
      voiceMode: undefined,
      voiceName: undefined,
      voiceModel: undefined,
    },
  });
  const meta = {
    model: 'fable',
    effort: 'high',
    mode: 'plan',
    timeZone: 'Europe/Kyiv',
    voiceMode: 'on',
  };
  const fromMeta = resolveSettings({}, meta);
  assert.deepEqual(fromMeta.worker, { model: 'fable', effort: 'high', mode: 'plan' });
  assert.equal(fromMeta.shared.timeZone, 'Europe/Kyiv');
  assert.equal(fromMeta.shared.voiceMode, 'on');
  const file = {
    fastLane: { model: 'haiku', effort: null },
    worker: { model: 'opus', effort: null, mode: 'manual' },
    shared: { timeZone: 'Mars/Base' },
  };
  const fromFile = resolveSettings(file, meta);
  assert.deepEqual(fromFile.fastLane, { model: 'haiku', effort: null });
  assert.deepEqual(fromFile.worker, { model: 'opus', effort: null, mode: 'manual' });
  assert.equal(fromFile.shared.timeZone, 'Europe/Warsaw');
  assert.deepEqual(settingsUpdate('w', { mode: 'auto' })(file).worker, {
    model: 'opus',
    effort: null,
    mode: 'auto',
  });
});

test('validControl: only known keys with valid values; controlText is the same command', () => {
  assert.deepEqual(
    validControl({
      model: 'opus',
      effort: 'default',
      mode: 'auto',
      timeZone: 'Europe/Kyiv',
      voiceMode: 'on',
      voiceName: 'Kore',
      voiceModel: 'flash',
      evil: 'rm -rf /',
    }),
    {
      model: 'opus',
      effort: null,
      mode: 'auto',
      timeZone: 'Europe/Kyiv',
      voiceMode: 'on',
      voiceName: 'Kore',
      voiceModel: 'flash',
    }
  );
  assert.equal(validControl({ model: 'opus; rm', mode: 'god', timeZone: 'x' }), null);
  assert.equal(validControl(null), null);
  assert.equal(controlText({ model: 'haiku' }), '/model haiku');
  assert.equal(controlText({ effort: null }), '/effort default');
  assert.equal(controlText({ timeZone: 'Europe/Kyiv' }), '/timezone Europe/Kyiv');
  assert.equal(controlText({ voiceModel: 'pro' }), '/voice');
  assert.equal(
    describeControl({ model: 'opus', effort: null }),
    'модель opus, effort за замовчуванням моделі'
  );
});

test('splitControl: what the worker applies to its live session and what to its shared settings', () => {
  assert.deepEqual(
    splitControl({ model: 'haiku', effort: null, timeZone: 'Europe/Kyiv', voiceName: 'Kore' }),
    {
      session: { model: 'haiku', effort: null },
      shared: { timeZone: 'Europe/Kyiv', voiceName: 'Kore' },
    }
  );
  assert.deepEqual(splitControl({ mode: 'plan' }), { session: { mode: 'plan' }, shared: {} });
  assert.equal(splitControl({ model: '../../etc' }), null);
});

// ---------------------------------------------------------------------------------------------- both lanes

test('fast lane /model and /effort: its own buttons with a lane switch, never the SDK', async () => {
  const { commands, telegram } = fastLane();
  assert.equal(await commands.handleCommand('/model'), true);
  const model = telegram.sent.at(-1);
  assert.match(model.html, /Лямбда/);
  assert.match(model.html, /<b>sonnet<\/b>/);
  assert.equal(callbackOf(model.markup, 'Haiku'), 'model:0:f');
  assert.equal(callbackOf(model.markup, '✓'), 'model:1:f');
  assert.equal(callbackOf(model.markup, 'Показати для'), 'model:show:w');
  assert.equal(await commands.handleCommand('/effort'), true);
  const effort = telegram.sent.at(-1);
  assert.match(effort.html, /Effort \(Лямбда.*<b>low<\/b>/);
  assert.equal(callbackOf(effort.markup, '✓ low'), 'effort:low:f');
  assert.equal(callbackOf(effort.markup, 'Показати для'), 'effort:show:w');
  // Every callback fits Telegram's limit with the fast lane prefix
  for (const button of [...model.markup.inline_keyboard, ...effort.markup.inline_keyboard].flat())
    assert.doesNotThrow(() => prefixCallbacks({ inline_keyboard: [[button]] }));
});

test('fast lane: its own lane goes to settings.json fastLane and its live session', async () => {
  const { commands, store, telegram, applied, toWorker } = fastLane();
  await commands.handleCallback(7, { kind: 'model', id: '0', value: 'f' });
  assert.deepEqual(store.json('state/settings.json').fastLane, { model: 'haiku' });
  assert.deepEqual(applied.at(-1), { model: 'haiku', effort: 'low' });
  assert.equal(telegram.sent.at(-1).edit, 7);
  assert.match(telegram.sent.at(-1).html, /<b>haiku<\/b>/);
  await commands.handleCommand('/effort default');
  assert.deepEqual(store.json('state/settings.json').fastLane, { model: 'haiku', effort: null });
  assert.deepEqual(applied.at(-1), { model: 'haiku', effort: null });
  assert.match(telegram.sent.at(-1).text, /Лямбда.*effort за замовчуванням моделі/);
  await commands.handleCommand('/effort huge');
  assert.match(telegram.sent.at(-1).text, /low \| medium/);
  assert.equal(toWorker.length, 0);
});

test('fast lane: the worker lane goes to settings.json worker; a running worker also gets a control message', async () => {
  const sleeping = fastLane({ objects: { 'state/progress.json': STOPPED } });
  await sleeping.commands.handleCallback(3, { kind: 'model', id: '2', value: 'w' });
  await sleeping.commands.handleCallback(3, { kind: 'effort', id: 'high', value: 'w' });
  await sleeping.commands.handleCallback(4, { kind: 'mode', id: 'auto', value: '' });
  assert.deepEqual(sleeping.store.json('state/settings.json').worker, {
    model: 'opus',
    effort: 'high',
    mode: 'auto',
  });
  assert.equal(sleeping.toWorker.length, 0);
  assert.match(sleeping.telegram.sent.at(-1).html, /застосує при наступному старті/);
  assert.equal(sleeping.store.objects.has('state/meta.json'), false);

  const running = fastLane({ objects: { 'state/progress.json': RUNNING } });
  await running.commands.handleCallback(3, { kind: 'model', id: '0', value: 'w' });
  await running.commands.handleCommand('/mode plan');
  assert.deepEqual(running.toWorker, [
    { text: '/model haiku', control: { model: 'haiku' }, reason: 'налаштування' },
    { text: '/mode plan', control: { mode: 'plan' }, reason: 'налаштування' },
  ]);
  assert.match(running.telegram.sent.at(-1).text, /Робочий воркер: режим plan \(передано/);
});

test('/mode in the fast lane: it only reads; the buttons are the worker modes', async () => {
  const { commands, telegram } = fastLane({
    objects: { 'state/settings.json': JSON.stringify({ worker: { mode: 'manual' } }) },
  });
  await commands.handleCommand('/mode');
  assert.match(telegram.sent.at(-1).html, /Лямбда: завжди лише читає/);
  assert.match(telegram.sent.at(-1).html, /Режим: ✋ <b>manual<\/b>/);
  assert.equal(callbackOf(telegram.sent.at(-1).markup, 'auto'), 'mode:auto');
  await commands.handleCommand('/mode god');
  assert.match(telegram.sent.at(-1).text, /bypass \| auto/);
});

test('worker /model, /effort, /mode: the same module; its lane applied live, the fast lane only written', async () => {
  const { commands, store, telegram, live } = workerHost();
  await commands.handleCommand('model', '');
  const view = telegram.sent.at(-1);
  assert.match(view.html, /Робочий воркер/);
  assert.equal(callbackOf(view.markup, '✓'), 'model:2:w');
  assert.equal(callbackOf(view.markup, 'Показати для'), 'model:show:f');

  await commands.handleCommand('effort', 'max');
  assert.deepEqual(live, [{ lane: 'w', effort: 'max' }]);
  assert.deepEqual(store.json('state/settings.json').worker, { effort: 'max' });
  // An old button without a lane is the host's own
  await commands.handleCallback(1, { kind: 'model', id: '3', value: '' });
  assert.deepEqual(live.at(-1), { lane: 'w', model: 'fable' });
  await commands.handleCallback(1, { kind: 'mode', id: 'plan', value: '' });
  assert.deepEqual(live.at(-1), { lane: 'w', mode: 'plan' });

  await commands.handleCallback(2, { kind: 'model', id: '0', value: 'f' });
  assert.equal(live.length, 3);
  assert.deepEqual(store.json('state/settings.json').fastLane, { model: 'haiku' });
  assert.match(telegram.sent.at(-1).html, /Лямбда застосує з наступної відповіді/);
  assert.equal(await commands.handleCommand('voice', ''), false);
});

test('worker: a change the session refuses is not written', async () => {
  const { commands, store } = workerHost({ refuse: true });
  await commands.handleCommand('model', 'nonexistent-model');
  assert.equal(store.objects.has('state/settings.json'), false);
});

// ---------------------------------------------------------------------------------------------- other commands

test('/timezone and /voice: shared settings; a running worker gets a control message', async () => {
  const sleeping = fastLane({ objects: { 'state/progress.json': STOPPED } });
  await sleeping.commands.handleCommand('/timezone Europe/Kyiv');
  assert.deepEqual(sleeping.store.json('state/settings.json').shared, { timeZone: 'Europe/Kyiv' });
  assert.equal(sleeping.toWorker.length, 0);
  await sleeping.commands.handleCommand('/voice');
  assert.deepEqual(sleeping.voiceCalls, [['command', '']]);

  const running = fastLane({ objects: { 'state/progress.json': RUNNING } });
  await running.commands.setShared({ voiceMode: 'on' });
  assert.deepEqual(running.store.json('state/settings.json').shared, { voiceMode: 'on' });
  assert.deepEqual(running.toWorker, [
    { text: '/voice on', control: { voiceMode: 'on' }, reason: 'налаштування' },
  ]);

  const places = [
    { id: 1, name: 'Paris', country: 'France', timezone: 'Europe/Paris', population: 2_000_000 },
    {
      id: 2,
      name: 'Paris',
      admin1: 'Texas',
      country: 'USA',
      timezone: 'America/Chicago',
      population: 1_500_000,
    },
  ];
  const ask = fastLane({ objects: { 'state/progress.json': STOPPED }, places });
  await ask.commands.handleCommand('/timezone Paris');
  assert.equal(callbackOf(ask.telegram.sent.at(-1).markup, 'Texas'), 'tz:z:America/Chicago');
  await ask.commands.handleCallback(9, { kind: 'tz', id: 'z', value: 'America/Chicago' });
  assert.equal(ask.store.json('state/settings.json').shared.timeZone, 'America/Chicago');
});

test('/scheduled lists with cancel buttons; a button deletes the task and refreshes the list', async () => {
  const task = {
    id: '20261116T180417-26071',
    dueAt: '2026-11-16T19:05:00Z',
    timeZone: 'Europe/Warsaw',
    text: 'Check the flag',
  };
  const { commands, store, telegram } = fastLane({
    objects: { [`state/scheduled/${task.id}.json`]: JSON.stringify(task) },
  });
  await commands.handleCommand('/scheduled');
  assert.match(telegram.sent.at(-1).html, /Check the flag/);
  assert.equal(callbackOf(telegram.sent.at(-1).markup, 'Скасувати 1'), `sch:${task.id}`);
  await commands.handleCallback(5, { kind: 'sch', id: task.id, value: '' });
  assert.equal(store.objects.size, 0);
  assert.match(telegram.sent.at(-1).html, /Запланованих задач немає/);
});

test('/stop only to a busy worker; /compact asks before starting a sleeping one', async () => {
  const busy = fastLane({ objects: { 'state/progress.json': RUNNING } });
  await busy.commands.handleCommand('/stop');
  assert.deepEqual(busy.toWorker, [
    { text: '/stop', interrupt: true, reason: 'зупинити поточну задачу' },
  ]);
  await busy.commands.handleCommand('/compact keep the PR list');
  assert.equal(busy.toWorker.at(-1).text, '/compact keep the PR list');

  const idle = fastLane({ objects: { 'state/progress.json': STOPPED } });
  await idle.commands.handleCommand('/stop');
  assert.match(idle.telegram.sent.at(-1).text, /нічого не виконує/);
  await idle.commands.handleCommand('/compact');
  assert.equal(idle.toWorker.length, 0);
  assert.equal(callbackOf(idle.telegram.sent.at(-1).markup, 'Підняти'), 'compact:yes');
  await idle.commands.handleCallback(6, { kind: 'compact', id: 'yes', value: '' });
  assert.deepEqual(idle.toWorker, [{ text: '/compact', reason: 'стиснути контекст' }]);
  await idle.commands.handleCommand('/whatever');
  assert.match(idle.telegram.sent.at(-1).text, /не знаю/);
});

test("/background, /context, /agents from the worker's records in S3", async () => {
  const running = fastLane({
    objects: {
      'state/progress.json': JSON.stringify({
        worker: 'running',
        turnActive: true,
        backgroundTasks: [
          { type: 'bash', description: 'Wait for CI', since: '2026-11-16T18:00:00Z' },
        ],
        agents: [{ description: 'Implement the fix', since: '2026-11-16T18:05:00Z' }],
      }),
      'state/status.json': JSON.stringify({
        worker: { ctx: 41.6, updatedAt: '2026-11-16T18:10:00Z' },
        fastLane: { ctx: 7, updatedAt: '2026-11-16T18:11:00Z' },
        shared: { windows: { five_hour: { utilization: 0.12, resetsAt: 1794859200 } } },
      }),
    },
  });
  await running.commands.handleCommand('/background');
  assert.match(running.telegram.sent.at(-1).text, /1\. bash: Wait for CI \(з 18:00 UTC\)/);
  await running.commands.handleCommand('/agents');
  assert.match(running.telegram.sent.at(-1).text, /1\. Implement the fix/);
  await running.commands.handleCommand('/context');
  const context = running.telegram.sent.at(-1).text;
  assert.match(context, /5 год 12%/);
  assert.match(context, /тиждень \?/);
  assert.match(context, /Робочий воркер: ctx 42% \(на 18:10 UTC\)/);
  assert.match(context, /Лямбда: ctx 7%/);

  const sleeping = fastLane({
    objects: {
      'state/progress.json': STOPPED,
      'state/background/t1.json': JSON.stringify({
        taskId: 't1',
        description: 'npm test',
        startedAt: '2026-11-16T17:00:00Z',
      }),
    },
  });
  await sleeping.commands.handleCommand('/background');
  assert.match(sleeping.telegram.sent.at(-1).text, /спить; незавершені.*\n1\. npm test/);
  await sleeping.commands.handleCommand('/agents');
  assert.match(sleeping.telegram.sent.at(-1).text, /спить/);
});

test('/plans: newest first with buttons; a button sends the plan file', async () => {
  const { commands, telegram } = fastLane({
    objects: {
      'plans/2026-11-15T15-00-a.md': '# Older plan\n',
      'plans/2026-11-16T09-00-b.md': '# Newer plan\n\n_Decision (x): approved_\n',
    },
  });
  await commands.handleCommand('/plans');
  assert.match(
    telegram.sent.at(-1).html,
    /1\.<\/b> Newer plan[\s\S]*approved[\s\S]*2\.<\/b> Older plan/
  );
  await commands.handleCallback(1, { kind: 'plans', id: '0', value: '' });
  assert.deepEqual(telegram.sent.at(-1), { file: '/tmp/plans/2026-11-16T09-00-b.md' });
});
