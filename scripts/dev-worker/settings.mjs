/**
 * The chat's settings, shared by both lanes (plan "Fast lane for the dev chat": "Separate settings per lane",
 * "Commands: who handles what"): `state/settings.json`, written with conditional writes (ETag) by whichever lane the
 * owner changed it in, so neither overwrites the other.
 *
 *   { fastLane: { model, effort },          the fast lane's own (it reads them at each invocation)
 *     worker:   { model, effort, mode },    the worker's (read at its start; a running worker gets a control message)
 *     shared:   { timeZone, voiceMode, voiceName, voiceModel } }   both lanes
 *
 * Before this file existed the worker kept its settings in `state/meta.json`: a value missing here falls back to it
 * (resolveSettings), and the worker writes its values here on its first save, so the fallback is used once.
 *
 * Control messages: a setting the fast lane changes while the worker runs reaches it as `{ control: { … } }` in its
 * queue (validControl), which the worker applies to the live session without a model turn. `stopTask` (a background
 * task id) is no setting: the fast lane's /background button stops that task of the running worker.
 */
import { isTimeZone, validBackgroundTaskId } from './session-state.mjs';
import { DEFAULT_MODE, EFFORT_LEVELS, MODES, VOICE_MODELS } from './telegram-format.mjs';

export const SETTINGS_KEY = 'state/settings.json';
export const DEFAULT_TIME_ZONE = 'Europe/Warsaw';
export const FAST_LANE_DEFAULTS = { model: 'sonnet', effort: 'low' };
/** The worker's model when nothing is set (the task's CLAUDE_MODEL default). */
export const WORKER_DEFAULT_MODEL = 'opus';
export const VOICE_MODES = ['auto', 'on', 'off'];

/** Lanes in callback data and in settings.json. */
export const LANE_SECTIONS = { f: 'fastLane', w: 'worker', s: 'shared' };

/** Models offered by the buttons (aliases Claude Code resolves to the latest of each family), both lanes. */
export const MODEL_CHOICES = [
  { value: 'haiku', displayName: 'Haiku', description: 'найшвидша, для коротких відповідей' },
  { value: 'sonnet', displayName: 'Sonnet', description: 'швидка й розумна (дефолт Лямбди)' },
  { value: 'opus', displayName: 'Opus', description: 'найсильніша (дефолт воркера)' },
  { value: 'fable', displayName: 'Fable', description: 'найновіша модель' },
];

/** A model name typed by the owner: an alias or a full id, nothing else. */
export function validModel(name) {
  const value = String(name ?? '').trim();
  return /^[a-z0-9][a-z0-9.\-[\]]{1,63}$/i.test(value) ? value : null;
}

const pick = (section, key, fallback) =>
  section && Object.prototype.hasOwnProperty.call(section, key) ? section[key] : fallback;

/**
 * Every setting with its fallback: settings.json first, then the worker's old meta.json, then the defaults. Effort
 * `null` is the model's own default.
 */
export function resolveSettings(settings, meta, { workerModel = WORKER_DEFAULT_MODEL } = {}) {
  const fast = settings?.fastLane;
  const worker = settings?.worker;
  const shared = settings?.shared;
  const mode = pick(worker, 'mode', meta?.mode);
  const timeZone = pick(shared, 'timeZone', meta?.timeZone);
  return {
    fastLane: {
      model: pick(fast, 'model', null) ?? FAST_LANE_DEFAULTS.model,
      effort: pick(fast, 'effort', FAST_LANE_DEFAULTS.effort),
    },
    worker: {
      model: pick(worker, 'model', meta?.model) ?? workerModel,
      effort: pick(worker, 'effort', meta?.effort ?? null) ?? null,
      mode: MODES[mode] ? mode : DEFAULT_MODE,
    },
    shared: {
      timeZone: isTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE,
      voiceMode: pick(shared, 'voiceMode', meta?.voiceMode),
      voiceName: pick(shared, 'voiceName', meta?.voiceName),
      voiceModel: pick(shared, 'voiceModel', meta?.voiceModel),
    },
  };
}

/** An updateJson change: `patch` merged into one lane's section (`f`, `w` or `s`). */
export function settingsUpdate(lane, patch) {
  const section = LANE_SECTIONS[lane];
  return (current) => ({ ...current, [section]: { ...(current?.[section] ?? {}), ...patch } });
}

/**
 * A control message's settings, validated (it comes through a queue): only known keys with valid values; null when
 * nothing is left. Effort `default` / null: the model's own.
 */
export function validControl(control) {
  if (!control || typeof control !== 'object') return null;
  const out = {};
  if (validModel(control.model)) out.model = validModel(control.model);
  if (control.effort === null || control.effort === 'default') out.effort = null;
  else if (EFFORT_LEVELS.includes(control.effort)) out.effort = control.effort;
  if (MODES[control.mode]) out.mode = control.mode;
  if (isTimeZone(control.timeZone)) out.timeZone = control.timeZone;
  if (VOICE_MODES.includes(control.voiceMode)) out.voiceMode = control.voiceMode;
  if (/^[A-Z][a-z]{1,30}$/.test(String(control.voiceName ?? ''))) out.voiceName = control.voiceName;
  if (VOICE_MODELS[control.voiceModel]) out.voiceModel = control.voiceModel;
  if (validBackgroundTaskId(control.stopTask)) out.stopTask = control.stopTask;
  return Object.keys(out).length ? out : null;
}

/**
 * A control message as the worker applies it (worker.mjs applyControl): the settings of its live session (model,
 * effort, mode: one SDK call each) and the shared ones (time zone, voice: its settings copy and a note for Claude).
 * Null when the message carries nothing valid.
 */
export function splitControl(raw) {
  const control = validControl(raw);
  if (!control) return null;
  const session = {};
  const shared = {};
  let stopTask = null;
  for (const [key, value] of Object.entries(control)) {
    if (key === 'stopTask') stopTask = value;
    else if (['model', 'effort', 'mode'].includes(key)) session[key] = value;
    else shared[key] = value;
  }
  return { session, shared, stopTask };
}

/**
 * The command a control message stands for ("/model opus"): its text in the queue, so it still works where the
 * `control` field is dropped, and what the chat log shows.
 */
export function controlText(control) {
  const [key, value] = Object.entries(control ?? {})[0] ?? [];
  // Stopping a background task has no text form: the /background list shows what runs
  if (key === 'stopTask') return '/background';
  const command = {
    model: '/model',
    effort: '/effort',
    mode: '/mode',
    timeZone: '/timezone',
    voiceMode: '/voice',
    voiceName: '/voice',
  }[key];
  // The speech model has no text form: the /voice menu shows it
  if (!command) return '/voice';
  return `${command} ${value ?? 'default'}`;
}

/** One line in Ukrainian for a changed setting ("модель opus"). */
export function describeControl(control) {
  const names = {
    model: 'модель',
    effort: 'effort',
    mode: 'режим',
    timeZone: 'таймзона',
    voiceMode: 'голосові відповіді',
    voiceName: 'голос',
    voiceModel: 'модель голосу',
  };
  return Object.entries(control ?? {})
    .map(([key, value]) => `${names[key] ?? key} ${value ?? 'за замовчуванням моделі'}`)
    .join(', ');
}
