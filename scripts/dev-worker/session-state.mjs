/**
 * Pure helpers of the dev worker's state in S3 (no I/O): the background task records shown for restoring after a
 * restart.
 *
 * Transcripts themselves need no helper: Claude Code trims its own transcript file after a compaction
 * (`CLAUDE_CODE_TRANSCRIPT_LOCAL_GC=1`, set by the worker), so the worker uploads the file as it is.
 */

const clip = (text, max) => {
  const value = String(text ?? '').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

/**
 * A record of a live background task, saved while it runs: what it is (shell command / subagent), its command or
 * prompt, and the owner's message it was started for.
 */
export function backgroundRecord(task, { start, call, purpose, sessionId, now = new Date() } = {}) {
  const input = call?.input ?? {};
  return {
    taskId: task.task_id,
    taskType: task.task_type ?? start?.task_type ?? 'unknown',
    tool: call?.name ?? null,
    description: task.description || start?.description || input.description || '',
    command: input.command ?? null,
    prompt: input.prompt ?? start?.prompt ?? null,
    subagentType: task.subagent_type ?? start?.subagent_type ?? input.subagent_type ?? null,
    purpose: purpose ? clip(purpose, 1000) : null,
    startedAt: now.toISOString(),
    sessionId: sessionId ?? null,
  };
}

const isAgent = (record) =>
  record.taskType === 'local_agent' || Boolean(record.prompt && !record.command);

/** Claude's instructions to start the chosen tasks again (English, like every note for Claude). */
export function restoreNote(records) {
  const lines = records.map((record, i) => {
    const purpose = record.purpose
      ? ` It was started for the owner's message: «${clip(record.purpose, 600)}».`
      : '';
    if (isAgent(record)) {
      return (
        `${i + 1}. Subagent${record.subagentType ? ` (${record.subagentType})` : ''} "${record.description}", ` +
        `task id ${record.taskId}.${purpose} Resume it with SendMessage to "${record.taskId}" (its transcript is ` +
        `restored), asking it to continue where it stopped; if that fails, launch it again in the background with ` +
        `the same prompt: «${clip(record.prompt, 4000)}»`
      );
    }
    return (
      `${i + 1}. ${record.tool ?? 'Shell'} task "${record.description}".${purpose} Run it again in the background ` +
      `(run_in_background): ${record.command ? `\`${clip(record.command, 4000)}\`` : '(the command was not recorded: rebuild it from the description and the conversation)'}`
    );
  });
  return (
    '[Worker note: these background tasks were still running when the previous worker run ended (or the Claude ' +
    'session restarted), so they were stopped. The owner chose to restore them: start each again the same way, ' +
    'then tell the owner in one or two lines what you restarted.\n' +
    `${lines.join('\n')}]`
  );
}

/**
 * A Claude API failure Claude Code gave up on (after its own retries), in plain words: { text, retry } or null when
 * the text is not a known API error. `retry`: a transient failure, worth sending the same message again.
 */
export function apiErrorKind(text) {
  const value = String(text ?? '');
  if (/\b529\b|overloaded/i.test(value)) {
    return { text: '🌩 Claude зараз перевантажений (529). Спробуй за кілька хвилин.', retry: true };
  }
  if (/\b(401|403)\b|authentication|invalid (?:x-api-key|api key|token)|oauth token/i.test(value)) {
    return {
      text:
        '🔑 Claude не приймає токен (помилка автентифікації). Можливо, протермінований claude_code_oauth_token ' +
        'у секреті youtube-pip-oncall: онови його через claude setup-token.',
      retry: false,
    };
  }
  if (
    /prompt is too long|context (?:length|window)|exceeds? the (?:maximum|context)/i.test(value)
  ) {
    return {
      text: '📚 Контекст переповнений: стисни його через /compact і повтори.',
      retry: false,
    };
  }
  if (/\b429\b|rate_limit_error|too many requests/i.test(value)) {
    return {
      text: '⏳ Забагато запитів до Claude за короткий час. Спробуй за хвилину.',
      retry: true,
    };
  }
  if (/\b5\d\d\b|api_error|internal server error|service unavailable|bad gateway/i.test(value)) {
    return {
      text: '🌩 Збій на боці Anthropic (5xx). Зазвичай минає за кілька хвилин.',
      retry: true,
    };
  }
  if (
    /timed? ?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up|fetch failed|network error/i.test(
      value
    )
  ) {
    return { text: "📡 Обрив зв'язку з Claude або таймаут.", retry: true };
  }
  return null;
}

/** A valid IANA time zone name (`Europe/Kyiv`), as the runtime knows them. */
export function isTimeZone(name) {
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$/.test(String(name ?? ''))) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/** Lower case without diacritics and with one apostrophe: "Kraków" = "krakow", "Львів" = "львів". */
const normalise = (text) =>
  String(text ?? '')
    .trim()
    .toLocaleLowerCase('uk')
    .replace(/[’ʼ`]/g, "'")
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC');

/**
 * Time zone choices of an Open-Meteo geocoding answer for `query`: only exact name matches (it also returns names
 * that merely start with the query; `names` may carry the place's names in other languages, e.g. "Kyiv" for "Київ"), one per place, the largest first, at most four. `auto` is the zone when all of
 * them share it (no question needed), else null.
 */
export function timeZoneChoices(results, query) {
  const wanted = normalise(query);
  const seen = new Set();
  const choices = [];
  for (const result of results ?? []) {
    const names = [result?.name, ...(result?.names ?? [])].map(normalise);
    if (!result?.timezone || !names.includes(wanted)) continue;
    const label = [result.name, result.admin1, result.country].filter(Boolean).join(', ');
    if (seen.has(label)) continue;
    seen.add(label);
    choices.push({ label, timeZone: result.timezone, population: result.population ?? 0 });
  }
  choices.sort((a, b) => b.population - a.population);
  const top = choices.slice(0, 4);
  const zones = new Set(top.map((choice) => choice.timeZone));
  if (!top.length) return { choices: top, auto: null, guessed: false };
  if (zones.size === 1) return { choices: top, auto: top[0]?.timeZone ?? null, guessed: false };
  // One place far bigger than the rest (Warsaw, Poland vs the US towns): take it, the others stay one button away
  const [first, second] = top;
  const dominant = first.population >= 10000 && first.population >= 10 * (second.population || 0);
  return { choices: top, auto: dominant ? first.timeZone : null, guessed: dominant };
}

/** Name of the Cloud Billing budget whose Pub/Sub notifications give the Gemini speech spend (docs/DEV_WORKER.md). */
export const SPEECH_BUDGET_NAME = 'tts-voice-monthly';

/**
 * Budget states from pulled Pub/Sub messages (`receivedMessages` of subscriptions.pull): only real budget notifications
 * (attributes `budgetId` and `billingAccountId`, `budgetDisplayName` = SPEECH_BUDGET_NAME), anything else (a test
 * message published by hand) is skipped. Each: { period, usd, budget, currency, updatedAt } with Google's figures.
 */
export function budgetStates(received, name = SPEECH_BUDGET_NAME) {
  const states = [];
  for (const item of received ?? []) {
    const message = item?.message ?? {};
    const attributes = message.attributes ?? {};
    if (!attributes.budgetId || !attributes.billingAccountId) continue;
    let data;
    try {
      data = JSON.parse(Buffer.from(message.data ?? '', 'base64').toString('utf8'));
    } catch {
      continue;
    }
    if (data?.budgetDisplayName !== name) continue;
    const usd = Number(data.costAmount);
    const budget = Number(data.budgetAmount);
    if (!Number.isFinite(usd) || !Number.isFinite(budget) || !data.costIntervalStart) continue;
    states.push({
      period: data.costIntervalStart,
      usd,
      budget,
      currency: data.currencyCode ?? 'USD',
      updatedAt: message.publishTime ?? null,
    });
  }
  return states;
}

/** The newest budget state: a later period wins, then a later publish time (`current` may be null). */
export function latestBudgetState(current, states) {
  let best = current?.period ? current : null;
  for (const state of states ?? []) {
    const newer =
      !best ||
      Date.parse(state.period) > Date.parse(best.period) ||
      (state.period === best.period &&
        Date.parse(state.updatedAt ?? 0) > Date.parse(best.updatedAt ?? 0));
    if (newer) best = { ...(best?.period === state.period ? best : {}), ...state };
  }
  return best;
}

/**
 * How far the budget is spent: 'none' (no figure for the current period yet: Google's budget period is a calendar
 * month, so a state whose period started over a month ago is stale), 'ok', 'warn' (80%) or 'exhausted' (100%).
 */
export function budgetLevel(state, now = Date.now()) {
  if (!state?.period || !(state.budget > 0)) return 'none';
  const end = new Date(state.period);
  end.setUTCMonth(end.getUTCMonth() + 1);
  if (now >= end.getTime()) return 'none';
  if (state.usd >= state.budget) return 'exhausted';
  return state.usd >= state.budget * 0.8 ? 'warn' : 'ok';
}

/** Text for comparing: lowercase, no Markdown punctuation, single spaces. */
const comparable = (text) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/[*_`#>|~[\]()-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * A tool result that is the auto mode classifier's refusal ("Permission for this action was denied by the Claude Code
 * auto mode classifier. Reason: [Unsanctioned Communication]. …"): { reason } (null when it gives none), or undefined
 * for any other result. content: the tool_result's content (a string or text blocks).
 */
export function classifierDenial(content) {
  const text = Array.isArray(content)
    ? content.map((block) => (block?.type === 'text' ? block.text : '')).join('\n')
    : String(content ?? '');
  if (!/denied by the Claude Code auto mode classifier/i.test(text)) return undefined;
  const reason = text.match(/Reason:\s*\[?([^\]\n.]+)\]?/i)?.[1]?.trim();
  return { reason: reason || null };
}

/**
 * Whether an answer goes out as a voice message too, decided when it is sent, with the voice mode of that moment
 * (the owner may switch it while Claude works): `on` = every answer, also to background tasks and other turns that no
 * message of the owner started; `auto` = only the answer to the owner's voice message; `off` = never.
 * trigger: 'voice' / 'text' = the owner's message this answer is for, null = no message of the owner.
 */
export function voiceReplyWanted(mode, trigger) {
  if (mode === 'on') return true;
  if (mode === 'auto') return trigger === 'voice';
  return false;
}

/**
 * The main agent's answer without the paragraphs that repeat a subagent's final message the owner has just seen in
 * its view (/agents): a paragraph goes when the subagent's text contains it, or when nearly all its words (85%) are
 * the subagent's. What is left (Claude's own conclusions, next steps) stays; '' when nothing is.
 */
export function withoutRepeated(answer, seen) {
  const source = comparable(seen);
  if (!source) return String(answer ?? '').trim();
  const sourceWords = new Set(source.split(' '));
  return String(answer ?? '')
    .split(/\n\s*\n/)
    .filter((paragraph) => {
      const text = comparable(paragraph);
      if (!text) return false;
      if (text.length >= 20 && source.includes(text)) return false;
      const words = text.split(' ');
      const repeated = words.filter((word) => sourceWords.has(word)).length;
      return !(words.length >= 6 && repeated / words.length >= 0.85);
    })
    .join('\n\n')
    .trim();
}
