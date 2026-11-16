/**
 * `/model`, `/effort` and `/mode` for both lanes (plan "Fast lane for the dev chat", "Commands: who handles what"):
 * the same buttons in the fast lane and in the worker, with a lane switch (⚡ Лямбда / 🛠 Воркер). A change is written
 * to the lane's section of `state/settings.json` (settings.mjs); the host applies a change of its own lane to its live
 * session (`applyLive`) and tells the other lane about a change of its lane (`notifyOther`: the fast lane sends a
 * running worker a control message; the fast lane itself reads its settings at each invocation). `/mode` is the
 * worker's only: the fast lane always just reads.
 *
 * createSettingsCommands({ host, telegram, store, readMeta, applyLive, notifyOther }):
 *   host: 'f' (the fast lane) or 'w' (the worker): the lane `/model <name>` / `/effort <level>` set, shown first;
 *   telegram: { say, sayHtml, editHtml }; store: { getJson, updateJson } (s3-objects.mjs);
 *   readMeta(): the worker's meta.json (the old settings, a fallback);
 *   applyLive(lane, patch) -> false when the session refused it (nothing is written then);
 *   notifyOther(lane, patch) -> a line for the owner (e.g. "передано робочому воркеру").
 */
import {
  LANE_SECTIONS,
  MODEL_CHOICES,
  SETTINGS_KEY,
  describeControl,
  resolveSettings,
  settingsUpdate,
  validModel,
} from './settings.mjs';
import {
  EFFORT_LEVELS,
  LANES,
  MODES,
  effortKeyboard,
  escapeHtml,
  laneSwitchRow,
  modeKeyboard,
  modeText,
  modelKeyboard,
  modelText,
} from './telegram-format.mjs';

/** The /mode message: the fast lane's row, then the worker's modes. */
export const MODE_HEADER =
  '⚡ Лямбда: завжди лише читає (режимів не має).\n🛠 Режим робочого воркера:\n\n';

export function createSettingsCommands({
  host,
  telegram,
  store,
  readMeta = async () => null,
  applyLive = async () => true,
  notifyOther = async () => '',
  log = () => {},
}) {
  async function current() {
    const [settings, meta] = await Promise.all([
      store.getJson(SETTINGS_KEY).catch(() => null),
      readMeta().catch(() => null),
    ]);
    return resolveSettings(settings, meta);
  }

  const laneOf = (value) => (value === 'w' || value === 'f' ? value : host);
  const laneSettings = async (lane) => (await current())[LANE_SECTIONS[lane]];

  async function modelView(lane) {
    const { model } = await laneSettings(lane);
    const keyboard = modelKeyboard(MODEL_CHOICES, model, { lane });
    keyboard.inline_keyboard.push(laneSwitchRow('model', lane));
    const header = `${LANES[lane].emoji} Модель (${LANES[lane].name})`;
    return { html: modelText(MODEL_CHOICES, model, { header }), keyboard };
  }

  async function effortView(lane) {
    const { model, effort } = await laneSettings(lane);
    const html =
      `${LANES[lane].emoji} Effort (${LANES[lane].name}): <b>${escapeHtml(effort ?? 'за замовчуванням моделі')}</b> · модель ${escapeHtml(model)}\n` +
      '<i>Або текстом: /effort low | medium | high | xhigh | max | default</i>';
    const keyboard = effortKeyboard(EFFORT_LEVELS, effort, { lane });
    keyboard.inline_keyboard.push(laneSwitchRow('effort', lane));
    return { html, keyboard };
  }

  async function modeView() {
    const { mode } = await laneSettings('w');
    return { html: `${MODE_HEADER}${modeText(mode)}`, keyboard: modeKeyboard(mode) };
  }

  /**
   * Change a lane's setting: the host's own lane is applied to its session first (a refusal writes nothing), then
   * the lane's section of settings.json; the other lane is told. Returns { ok, note }.
   */
  async function change(lane, patch) {
    if (lane === host && !(await applyLive(lane, patch))) return { ok: false, note: '' };
    try {
      await store.updateJson(SETTINGS_KEY, settingsUpdate(lane, patch));
    } catch (error) {
      log('settings write failed', error);
      await telegram.say(
        `⚠️ Налаштування не збереглося: ${String(error.message ?? error).slice(0, 200)}`
      );
      return { ok: false, note: '' };
    }
    const note = lane === host ? '' : await notifyOther(lane, patch);
    return { ok: true, note };
  }

  async function confirm(lane, patch, note) {
    await telegram.say(
      `${LANES[lane].emoji} ${LANES[lane].name}: ${describeControl(patch)}${note ? ` (${note})` : ''}`
    );
  }

  async function modelCommand(argument) {
    if (!argument) {
      const { html, keyboard } = await modelView(host);
      return telegram.sayHtml(html, keyboard);
    }
    const model = validModel(argument);
    if (!model) return telegram.say('ℹ️ /model <назва>, наприклад /model haiku');
    const { ok, note } = await change(host, { model });
    if (ok) await confirm(host, { model }, note);
  }

  async function effortCommand(argument) {
    const level = argument.toLowerCase();
    if (!level) {
      const { html, keyboard } = await effortView(host);
      return telegram.sayHtml(html, keyboard);
    }
    if (level !== 'default' && !EFFORT_LEVELS.includes(level))
      return telegram.say('ℹ️ /effort low | medium | high | xhigh | max | default');
    const patch = { effort: level === 'default' ? null : level };
    const { ok, note } = await change(host, patch);
    if (ok) await confirm(host, patch, note);
  }

  async function modeCommand(argument) {
    const mode = argument.toLowerCase();
    if (!mode) {
      const { html, keyboard } = await modeView();
      return telegram.sayHtml(html, keyboard);
    }
    if (!MODES[mode]) return telegram.say('ℹ️ /mode bypass | auto | manual | plan');
    const { ok, note } = await change('w', { mode });
    if (ok) await confirm('w', { mode }, note);
  }

  /** `/model`, `/effort`, `/mode` [argument]; false for any other command. */
  async function handleCommand(name, argument = '') {
    const handlers = { model: modelCommand, effort: effortCommand, mode: modeCommand };
    if (!handlers[name]) return false;
    await handlers[name](String(argument ?? '').trim());
    return true;
  }

  /**
   * A button of these commands (callback data parsed: `model:<index|show>:<lane>`, `effort:<level|show>:<lane>`,
   * `mode:<mode>`); the message is edited to show the lane's setting now. False for any other button.
   */
  async function handleCallback(messageId, { kind, id, value }) {
    if (kind === 'model' || kind === 'effort') {
      const lane = laneOf(value);
      let note = '';
      if (kind === 'model' && id !== 'show') {
        const model = MODEL_CHOICES[Number(id)];
        if (model) ({ note } = await change(lane, { model: model.value }));
      } else if (kind === 'effort' && (id === 'default' || EFFORT_LEVELS.includes(id))) {
        ({ note } = await change(lane, { effort: id === 'default' ? null : id }));
      }
      const { html, keyboard } = kind === 'model' ? await modelView(lane) : await effortView(lane);
      await telegram.editHtml(
        messageId,
        note ? `${html}\n\n<i>${escapeHtml(note)}</i>` : html,
        keyboard
      );
      return true;
    }
    if (kind === 'mode') {
      // Also the current mode: pressing it again re-applies it to the session (resync)
      let note = '';
      if (MODES[id]) ({ note } = await change('w', { mode: id }));
      const { html, keyboard } = await modeView();
      await telegram.editHtml(
        messageId,
        note ? `${html}\n\n<i>${escapeHtml(note)}</i>` : html,
        keyboard
      );
      return true;
    }
    return false;
  }

  return { handleCommand, handleCallback, current };
}
