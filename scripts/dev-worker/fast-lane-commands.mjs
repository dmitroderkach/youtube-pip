/**
 * The chat commands in the fast lane (plan "Fast lane for the dev chat", "Commands: who handles what"): a message
 * starting with "/" never reaches Claude Code there (its built-in commands would answer). dev-bot keeps /up, /down,
 * /start; everything else is answered here, without waking the working worker:
 *
 * - per lane, with a lane switch (settings-commands.mjs, the same module the worker uses): /model, /effort, /mode;
 * - shared settings (state/settings.json `shared`): /voice (voice.mjs, its writes come back through setShared),
 *   /timezone; a running worker gets the change as a control message;
 * - from S3: /scheduled (cancel buttons), /plans (the plan file), /status (the pinned status of both lanes),
 *   /background (the worker's task records), /context (the plan windows and both lanes' context from
 *   state/status.json), /agents (the worker's running subagents from its progress record);
 * - the worker's: /stop (interrupts its running turn), /compact (asks to start the worker and compact).
 *
 * Built around injected clients so it is tested without AWS, Telegram or Claude.
 */
import { SCHEDULED_PREFIX, validTaskId } from './scheduled-tasks.mjs';
import { isTimeZone, timeZoneChoices } from './session-state.mjs';
import { createSettingsCommands } from './settings-commands.mjs';
import {
  SETTINGS_KEY,
  controlText,
  resolveSettings,
  settingsUpdate,
  validControl,
} from './settings.mjs';
import { STATUS_KEY } from './status.mjs';
import {
  escapeHtml,
  planTitle,
  scheduledHtml,
  scheduledKeyboard,
  timeZoneZoneKeyboard,
} from './telegram-format.mjs';

export const META_KEY = 'state/meta.json';
export const PROGRESS_KEY = 'state/progress.json';
export const PLANS_PREFIX = 'plans/';
export const BACKGROUND_PREFIX = 'state/background/';
const PLANS_LIST_MAX = 10;

/** { name, argument } of a command message ("/model opus" → model, "opus"), or null when it is not one. */
export function parseCommand(text) {
  const value = String(text ?? '').trim();
  const match = /^\/([a-z_]+)(@\w+)?(?:\s+([\s\S]*))?$/i.exec(value);
  if (!match) return value.startsWith('/') ? { name: '', argument: '' } : null;
  return { name: match[1].toLowerCase(), argument: (match[3] ?? '').trim() };
}

const COMMAND_LIST =
  '/model, /effort, /mode, /voice, /timezone, /scheduled, /plans, /status, /context, /background, /agents, /stop, /compact, /up, /down';

/**
 * The command handlers. Clients:
 *   telegram: { say, sayHtml, editHtml, editButtons, sendFile }
 *   store: { get, getJson, list, delete, updateJson } (s3-objects.mjs)
 *   voice: { voiceCommand(argument), onVoiceButton(messageId, id, value) } (its setting writes call setShared)
 *   toWorker(message, reason): a message to the worker's queue through dev-bot (starts it if it sleeps)
 *   applyFastLane({ model, effort }): the fast lane's live session takes a new setting
 *   searchPlaces(query): geocoding (timezone-search.mjs); download(key, name): a local copy of an S3 object
 *   refreshStatus(): the pinned status sent again and pinned (/status)
 */
export function createFastLaneCommands({
  telegram,
  store,
  voice,
  toWorker,
  applyFastLane = async () => {},
  searchPlaces,
  download,
  refreshStatus = async () => {},
  log = () => {},
}) {
  const progress = () => store.getJson(PROGRESS_KEY).catch(() => null);
  const meta = () => store.getJson(META_KEY).catch(() => null);
  const workerRunning = async () => (await progress())?.worker === 'running';
  const settings = async () =>
    resolveSettings(await store.getJson(SETTINGS_KEY).catch(() => null), await meta());

  /** A setting of the running worker as a control message (its text is the same command, as a fallback). */
  async function sendControl(patch) {
    const control = validControl(patch);
    if (control) await toWorker({ text: controlText(control), control }, 'налаштування');
  }

  const settingsCommands = createSettingsCommands({
    host: 'f',
    telegram,
    store,
    readMeta: meta,
    log,
    applyLive: async (lane, patch) => {
      const current = (await store.getJson(SETTINGS_KEY).catch(() => null)) ?? {};
      await applyFastLane(resolveSettings(settingsUpdate('f', patch)(current), null).fastLane);
      return true;
    },
    notifyOther: async (lane, patch) => {
      if (await workerRunning()) {
        await sendControl(patch);
        return 'передано робочому воркеру: застосує одразу';
      }
      return 'робочий воркер застосує при наступному старті';
    },
  });

  /** A shared setting (time zone, voice): settings.json, and the running worker gets it at once. */
  async function setShared(patch) {
    await store.updateJson(SETTINGS_KEY, settingsUpdate('s', patch));
    if (await workerRunning()) await sendControl(patch);
  }

  // ------------------------------------------------------------------------------------------ /timezone

  const localTime = (timeZone) =>
    new Date().toLocaleString('uk-UA', { timeZone, hour: '2-digit', minute: '2-digit' });

  async function setTimeZone(timeZone, place) {
    await setShared({ timeZone });
    await telegram.say(
      `🕐 Таймзона: ${timeZone}${place ? ` (${place})` : ''}, зараз ${localTime(timeZone)}.\n` +
        'Щоденний онкол лишається за розкладом у terraform (18:00 Europe/Warsaw).'
    );
  }

  async function timeZoneCommand(argument) {
    if (!argument) {
      const { timeZone } = (await settings()).shared;
      return telegram.say(
        `🕐 Робоча таймзона: ${timeZone}, зараз ${localTime(timeZone)}.\n/timezone <місто> або /timezone Europe/Kyiv — змінити`
      );
    }
    if (isTimeZone(argument)) return setTimeZone(argument, null);
    let results;
    try {
      results = await searchPlaces(argument);
    } catch (error) {
      log('geocoding failed', error);
      return telegram.say(
        '⚠️ Не вдалося знайти місто (геокодер недоступний). Можна вказати таймзону напряму: /timezone Europe/Kyiv'
      );
    }
    const { choices, auto, guessed } = timeZoneChoices(results, argument);
    if (!choices.length)
      return telegram.say(
        `🔎 Не знайшов «${argument}». Напиши інакше (наприклад англійською) або /timezone Europe/Kyiv`
      );
    if (auto && !guessed)
      return setTimeZone(auto, choices.length === 1 ? choices[0].label : argument);
    if (auto) {
      await setTimeZone(auto, choices[0].label);
      return telegram.sayHtml('🔁 Не те місто?', timeZoneZoneKeyboard(choices.slice(1)));
    }
    return telegram.sayHtml(
      `🔎 Знайшов кілька «${escapeHtml(argument)}». Яке місто?`,
      timeZoneZoneKeyboard(choices)
    );
  }

  // ------------------------------------------------------------------------------------------ /scheduled

  async function scheduledTasks() {
    const tasks = [];
    for (const key of (await store.list(SCHEDULED_PREFIX)).filter((k) => k.endsWith('.json'))) {
      try {
        tasks.push(JSON.parse((await store.get(key)) ?? '{}'));
      } catch (error) {
        log(`scheduled task ${key} unreadable`, error);
      }
    }
    return tasks
      .filter((task) => task.id && task.dueAt)
      .sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)));
  }

  async function reportScheduled(messageId) {
    const tasks = await scheduledTasks();
    const html = scheduledHtml(tasks, (await settings()).shared.timeZone);
    const keyboard = scheduledKeyboard(tasks);
    if (messageId) return telegram.editHtml(messageId, html, keyboard);
    return telegram.sayHtml(html, keyboard);
  }

  // ------------------------------------------------------------------------------------------ /plans

  async function plansListed() {
    const keys = (await store.list(PLANS_PREFIX)).filter((key) => key.endsWith('.md'));
    return keys
      .map((key) => key.slice(PLANS_PREFIX.length))
      .sort((a, b) => (a.slice(0, -3) < b.slice(0, -3) ? 1 : -1))
      .slice(0, PLANS_LIST_MAX);
  }

  async function reportPlans() {
    const names = await plansListed();
    if (!names.length)
      return telegram.say(
        '📋 Збережених планів немає (вони зʼявляються в режимі plan: /mode plan)'
      );
    const texts = await Promise.all(
      names.map(async (name) => (await store.get(`${PLANS_PREFIX}${name}`)) ?? '')
    );
    const lines = names.map((name, i) => {
      const title = planTitle(texts[i]) || name;
      const decision = texts[i].match(/_Decision \([^)]*\): (.*)_\s*$/)?.[1] ?? 'not decided';
      return `<b>${i + 1}.</b> ${escapeHtml(title)}\n<i>${escapeHtml(name.slice(0, 16).replace('T', ' '))} · ${escapeHtml(decision)}</i>`;
    });
    return telegram.sayHtml(`📋 <b>Плани</b> (s3: ${PLANS_PREFIX})\n\n${lines.join('\n')}`, {
      inline_keyboard: [
        names.map((_, i) => ({ text: String(i + 1), callback_data: `plans:${i}` })),
      ],
    });
  }

  async function sendPlan(index) {
    const name = (await plansListed())[index];
    if (!name) return telegram.say('ℹ️ Цього плану вже немає в списку: /plans');
    return telegram.sendFile(await download(`${PLANS_PREFIX}${name}`, name));
  }

  // ------------------------------------------------------------------------------------------ the worker's records

  const sinceText = (iso) => (iso ? `з ${String(iso).slice(11, 16)} UTC` : '');

  /** `/background`: the running worker's tasks (progress record), or the ones a stopped run left (its records). */
  async function reportBackground() {
    const record = await progress();
    if (record?.worker === 'running') {
      const tasks = record.backgroundTasks ?? [];
      if (!tasks.length) return telegram.say('🧵 Фонових задач у робочого воркера немає');
      return telegram.say(
        [
          `🧵 Фонові задачі робочого воркера (${tasks.length}):`,
          ...tasks.map(
            (task, i) => `${i + 1}. ${task.type}: ${task.description} (${sinceText(task.since)})`
          ),
        ].join('\n')
      );
    }
    const keys = (await store.list(BACKGROUND_PREFIX)).filter((key) => key.endsWith('.json'));
    if (!keys.length) return telegram.say('🧵 Робочий воркер спить, фонових задач немає');
    const records = [];
    for (const key of keys.slice(0, 20)) {
      try {
        records.push(JSON.parse((await store.get(key)) ?? '{}'));
      } catch {
        // an unreadable record is skipped
      }
    }
    return telegram.say(
      [
        `🧵 Робочий воркер спить; незавершені фонові задачі попереднього запуску (${records.length}), запропонує відновити при старті:`,
        ...records.map(
          (task, i) =>
            `${i + 1}. ${task.description || task.command || task.prompt || task.taskId} (${sinceText(task.startedAt)})`
        ),
      ].join('\n')
    );
  }

  /** `/context`: Claude's plan windows and each lane's context, as both lanes last saw them (state/status.json). */
  async function reportContext() {
    const status = (await store.getJson(STATUS_KEY).catch(() => null)) ?? {};
    const windows = status.shared?.windows ?? {};
    const { timeZone } = (await settings()).shared;
    const time = (unix, withDay) =>
      unix
        ? new Date(unix * 1000).toLocaleString('uk-UA', {
            timeZone,
            ...(withDay ? { weekday: 'short' } : {}),
            hour: '2-digit',
            minute: '2-digit',
          })
        : '?';
    const window = (name, label, withDay) =>
      windows[name]
        ? `${label} ${Math.round(windows[name].utilization * 100)}% ↻${time(windows[name].resetsAt, withDay)}`
        : `${label} ?`;
    const ctx = (lane) =>
      typeof status[lane]?.ctx === 'number'
        ? `ctx ${Math.round(status[lane].ctx)}% (на ${String(status[lane].updatedAt ?? '').slice(11, 16)} UTC)`
        : 'ctx ?';
    return telegram.say(
      [
        `📊 ${window('five_hour', '5 год', false)} · ${window('seven_day', 'тиждень', true)}`,
        `🛠 Робочий воркер: ${ctx('worker')}`,
        `⚡ Лямбда: ${ctx('fastLane')}`,
      ].join('\n')
    );
  }

  /** `/agents`: the running worker's subagents (its progress record); viewing their messages is the worker's. */
  async function reportAgents() {
    const record = await progress();
    if (record?.worker !== 'running')
      return telegram.say('🤖 Робочий воркер спить: субагентів немає');
    const agents = record.agents ?? [];
    if (!agents.length) return telegram.say('🤖 У робочого воркера зараз немає субагентів');
    return telegram.say(
      [
        `🤖 Субагенти робочого воркера (${agents.length}):`,
        ...agents.map((agent, i) => `${i + 1}. ${agent.description} (${sinceText(agent.since)})`),
        'Їхні повідомлення показує сам воркер: /agents, коли він вільний.',
      ].join('\n')
    );
  }

  async function stopCommand() {
    const record = await progress();
    if (record?.worker !== 'running' || !record.turnActive)
      return telegram.say('ℹ️ Робочий воркер зараз нічого не виконує');
    await toWorker(
      { text: '/stop', interrupt: true, reason: 'the owner sent /stop' },
      'зупинити поточну задачу'
    );
    return telegram.say('⏹ Передав робочому воркеру: зупинити поточну задачу');
  }

  /** `/compact`: needs the worker's session; a sleeping worker is started only after the owner's button. */
  async function compactCommand(argument) {
    const text = `/compact${argument ? ` ${argument}` : ''}`;
    if (await workerRunning()) {
      await toWorker({ text }, 'стиснути контекст');
      return telegram.say('🗜 Передав робочому воркеру: стиснути контекст');
    }
    return telegram.sayHtml('🗜 Робочий воркер спить. Підняти воркер і стиснути контекст?', {
      inline_keyboard: [
        [
          { text: '✅ Підняти і стиснути', callback_data: 'compact:yes' },
          { text: '✖️ Ні', callback_data: 'compact:no' },
        ],
      ],
    });
  }

  /** Handle a command message; true when it was one (it never goes to Claude Code). */
  async function handleCommand(text) {
    const command = parseCommand(text);
    if (!command) return false;
    const { name, argument } = command;
    if (await settingsCommands.handleCommand(name, argument)) return true;
    const handlers = {
      voice: () => voice.voiceCommand(argument),
      timezone: () => timeZoneCommand(argument),
      scheduled: () => reportScheduled(),
      plans: () => reportPlans(),
      // The pinned status of both lanes, sent again at the bottom and pinned (as the worker's /status)
      status: () => refreshStatus(),
      background: () => reportBackground(),
      context: () => reportContext(),
      agents: () => reportAgents(),
      stop: () => stopCommand(),
      compact: () => compactCommand(argument),
    };
    if (handlers[name]) await handlers[name]();
    else await telegram.say(`ℹ️ Такої команди не знаю. Є: ${COMMAND_LIST}`);
    return true;
  }

  /** A button of these commands (callback data without the f| prefix, parsed); true when it was one. */
  async function handleCallback(messageId, parsed) {
    if (await settingsCommands.handleCallback(messageId, parsed)) return true;
    const { kind, id, value } = parsed;
    if (kind === 'voice') {
      await voice.onVoiceButton(messageId, id, value);
      return true;
    }
    if (kind === 'tz') {
      await telegram.editButtons(messageId);
      if (id === 'z' && isTimeZone(value)) await setTimeZone(value, null);
      else await telegram.say('ℹ️ Це питання вже неактуальне');
      return true;
    }
    if (kind === 'sch') {
      const task = validTaskId(id);
      if (task) {
        log(`scheduled task ${task} cancelled by the owner's button`);
        await store
          .delete(`${SCHEDULED_PREFIX}${task}.json`)
          .catch((error) => log('cancel failed', error));
      }
      await reportScheduled(messageId);
      return true;
    }
    if (kind === 'plans') {
      await sendPlan(Number(id));
      return true;
    }
    if (kind === 'compact') {
      await telegram.editButtons(messageId);
      if (id === 'yes') {
        await toWorker({ text: '/compact' }, 'стиснути контекст');
        await telegram.say('🗜 Піднімаю робочий воркер: він стисне контекст');
      }
      return true;
    }
    return false;
  }

  return { handleCommand, handleCallback, setShared, reportScheduled };
}
