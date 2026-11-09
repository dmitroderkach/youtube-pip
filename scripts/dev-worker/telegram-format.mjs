/**
 * Dev worker (docs/DEV_WORKER.md): Telegram rendering helpers without side effects (unit-tested in
 * telegram-format.test.mjs, `node --test scripts/dev-worker/`).
 *
 * - Markdown of a plan → Telegram HTML messages (parse_mode HTML): headings in bold, lists with bullets, code in
 *   <code> / <pre>, tables as aligned monospace blocks, long sections folded into expandable blockquotes.
 * - Inline keyboards and callback data of the worker's buttons (questions, plan approval, permission prompts, /mode).
 */

/** Telegram allows 4096 characters per message; HTML tags count too, so keep a margin. */
export const HTML_CHUNK_MAX = 3800;
/** A section with more lines than this is folded into an expandable blockquote (tap to expand). */
export const FOLD_SECTION_LINES = 8;
/** Telegram limits callback_data to 64 bytes. */
export const CALLBACK_DATA_MAX = 64;

/** Worker modes (the owner's names) → SDK permission handling. `bypass` is the default. */
export const MODES = {
  bypass: { emoji: '🚀', label: 'bypass', about: 'без перевірок, дозволено все' },
  auto: { emoji: '🤖', label: 'auto', about: 'класифікатор: безпечне сам, ризиковане питає' },
  manual: { emoji: '✋', label: 'manual', about: 'кожна дія зі змінами на підтвердження' },
  plan: { emoji: '📋', label: 'plan', about: 'тільки читаю й аналізую, в кінці план' },
};
export const DEFAULT_MODE = 'bypass';

export const escapeHtml = (text) =>
  String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Inline Markdown (code, bold, italic, links) of one line → Telegram HTML; everything else is escaped. */
export function inlineHtml(text) {
  const codes = [];
  // Code spans first: nothing inside them is formatted
  let out = String(text).replace(/`([^`]+)`/g, (_, code) => {
    codes.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  out = escapeHtml(out)
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      (_, label, url) => `<a href="${url}">${label}</a>`
    )
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/__(.+?)__/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,:;!?]|$)/g, '$1<i>$2</i>')
    .replace(/(^|[\s(])_([^_\s][^_]*?)_(?=[\s).,:;!?]|$)/g, '$1<i>$2</i>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>');
  // eslint-disable-next-line no-control-regex
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** A Markdown table → aligned monospace lines (Telegram has no tables). */
export function tableText(lines) {
  const rows = lines
    .filter((line) => !TABLE_RULE.test(line))
    .map((line) =>
      line
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((cell) => cell.trim().replace(/\*\*|`/g, ''))
    );
  const widths = [];
  for (const row of rows) {
    row.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, [...cell].length)));
  }
  const out = rows.map((row) =>
    row
      .map((cell, i) => cell + ' '.repeat(widths[i] - [...cell].length))
      .join(' │ ')
      .trimEnd()
  );
  if (out.length > 1) {
    out.splice(1, 0, widths.map((w) => '─'.repeat(w)).join('─┼─'));
  }
  return out.join('\n');
}

/**
 * Markdown → blocks of Telegram HTML, each a self-contained piece (tags never span two blocks), so the messages can
 * be cut between blocks: [{ html, heading }] where `heading` marks a section start.
 */
export function markdownBlocks(markdown) {
  const lines = String(markdown).replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^\s*```/);
    if (fence) {
      const code = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
      blocks.push({ html: `<pre>${escapeHtml(code.join('\n'))}</pre>` });
      continue;
    }
    if (TABLE_ROW.test(line)) {
      const table = [];
      for (; i < lines.length && TABLE_ROW.test(lines[i]); i++) table.push(lines[i]);
      i--;
      blocks.push({ html: `<pre>${escapeHtml(tableText(table))}</pre>` });
      continue;
    }
    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (heading) {
      const text = inlineHtml(heading[2].replace(/\s*#+\s*$/, ''));
      blocks.push({
        html: heading[1].length <= 2 ? `<b>${text}</b>` : `<b><i>${text}</i></b>`,
        heading: heading[1].length,
      });
      continue;
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      blocks.push({ html: '──────────' });
      continue;
    }
    const bullet = line.match(/^(\s*)[-*+]\s+(\[[ xX]\]\s+)?(.*)$/);
    if (bullet) {
      const depth = Math.floor(bullet[1].replace(/\t/g, '  ').length / 2);
      const box = bullet[2] ? (/x/i.test(bullet[2]) ? '☑️ ' : '⬜ ') : '';
      blocks.push({
        html: `${'   '.repeat(depth)}${depth ? '◦' : '•'} ${box}${inlineHtml(bullet[3])}`,
      });
      continue;
    }
    const numbered = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
    if (numbered) {
      const depth = Math.floor(numbered[1].replace(/\t/g, '  ').length / 2);
      blocks.push({
        html: `${'   '.repeat(depth)}<b>${numbered[2]}.</b> ${inlineHtml(numbered[3])}`,
      });
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      blocks.push({ html: `┃ <i>${inlineHtml(quote[1])}</i>` });
      continue;
    }
    blocks.push({ html: line.trim() ? inlineHtml(line.trim()) : '' });
  }
  // Collapse runs of empty lines
  return blocks.filter((block, i) => block.html || (i > 0 && blocks[i - 1].html));
}

/** Cut a block too long for one message (a huge code block or paragraph) into pieces that each fit. */
function splitBlock(html, max) {
  if (html.length <= max) return [html];
  const pre = html.startsWith('<pre>');
  const body = pre ? html.slice(5, -6) : html;
  const pieces = [];
  let rest = body;
  while (rest.length) {
    let cut = rest.length <= max - 11 ? rest.length : rest.lastIndexOf('\n', max - 11);
    if (cut <= 0) cut = max - 11;
    // Never cut inside an HTML entity or tag
    const amp = rest.lastIndexOf('&', cut);
    if (amp > cut - 8 && rest.indexOf(';', amp) >= cut) cut = amp;
    const lt = rest.lastIndexOf('<', cut);
    if (!pre && lt > rest.lastIndexOf('>', cut)) cut = lt || cut;
    pieces.push(pre ? `<pre>${rest.slice(0, cut)}</pre>` : rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  return pieces;
}

/**
 * A plan (Markdown) → Telegram HTML messages. The title line goes first; every section (## heading) whose body is
 * longer than FOLD_SECTION_LINES lines is folded into an expandable blockquote, so the phone shows the outline and
 * the owner expands what they want to read.
 */
export function planMessages(markdown, header, max = HTML_CHUNK_MAX) {
  const blocks = markdownBlocks(markdown);
  // Sections: a heading and the blocks up to the next heading of the same or a higher level
  const sections = [];
  let current = { heading: null, body: [] };
  for (const block of blocks) {
    if (block.heading && block.heading <= 2) {
      if (current.heading || current.body.length) sections.push(current);
      current = { heading: block.html, body: [] };
    } else {
      current.body.push(block.html);
    }
  }
  if (current.heading || current.body.length) sections.push(current);

  // Units of a message: { text, sep } (sep: the separator before it when it joins the message being built)
  const units = [{ text: header, sep: '' }];
  for (const section of sections) {
    const body = section.body.join('\n').replace(/^\n+|\n+$/g, '');
    const lines = body ? body.split('\n').length : 0;
    const fold = section.heading && lines > FOLD_SECTION_LINES;
    const whole = [
      section.heading ?? '',
      fold ? `<blockquote expandable>${body}</blockquote>` : body,
    ]
      .filter(Boolean)
      .join('\n');
    if (whole.length <= max) {
      units.push({ text: whole, sep: '\n\n' });
      continue;
    }
    // Too long for one message: block by block (a block too long itself is cut into pieces)
    if (section.heading) units.push({ text: section.heading, sep: '\n\n' });
    section.body.forEach((block) => {
      for (const piece of splitBlock(block, max)) {
        units.push({ text: piece, sep: '\n' });
      }
    });
  }

  const messages = [];
  let message = '';
  for (const { text, sep } of units) {
    const next = message ? `${message}${sep}${text}` : text;
    if (next.length <= max) {
      message = next;
      continue;
    }
    if (message) messages.push(message);
    message = text;
  }
  if (message) messages.push(message);
  return messages;
}

/** The first heading of a plan (its title), else its first line, plain text. */
export function planTitle(markdown) {
  const lines = String(markdown)
    .split('\n')
    .map((line) => line.trim());
  const heading = lines.find((line) => /^#{1,3}\s+\S/.test(line));
  const title = (heading ?? lines.find(Boolean) ?? 'План')
    .replace(/^#+\s*/, '')
    .replace(/[*_`]/g, '');
  return title.slice(0, 120);
}

/** "2026-11-09T14-05-plan-title" for the S3 key of a plan. */
export function planSlug(title, date = new Date()) {
  const stamp = date.toISOString().slice(0, 16).replace(/:/g, '-');
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return slug ? `${stamp}-${slug}` : stamp;
}

// ------------------------------------------------------------------------------------------- buttons

/** Callback data "<kind>:<id>:<value>" (kind: q question, p plan, perm permission, mode, plans). */
export function callbackData(...parts) {
  const data = parts.join(':');
  if (Buffer.byteLength(data) > CALLBACK_DATA_MAX)
    throw new Error(`callback data too long: ${data}`);
  return data;
}

export function parseCallback(data) {
  const [kind, id, ...rest] = String(data ?? '').split(':');
  return { kind, id, value: rest.join(':') };
}

/** Telegram limits button text to 64 characters; keep labels short on a phone anyway. */
const buttonText = (text) => (text.length > 60 ? `${text.slice(0, 59)}…` : text);

/**
 * Keyboard of one AskUserQuestion question: one option per row ("☑️" marks the picked ones of a multi-select),
 * then "Done" for a multi-select and "Own answer".
 */
export function questionKeyboard(id, index, question, picked = new Set()) {
  const rows = question.options.map((option, i) => [
    {
      text: buttonText(
        `${question.multiSelect ? (picked.has(i) ? '☑️ ' : '⬜ ') : ''}${option.label}`
      ),
      callback_data: callbackData('q', id, `${index}.${i}`),
    },
  ]);
  if (question.multiSelect) {
    rows.push([{ text: '✅ Готово', callback_data: callbackData('q', id, `${index}.done`) }]);
  }
  rows.push([{ text: '✏️ Свій варіант', callback_data: callbackData('q', id, `${index}.own`) }]);
  return { inline_keyboard: rows };
}

/** The text of one AskUserQuestion question (HTML): header, question, options with their descriptions. */
export function questionHtml(question, index, total) {
  const lines = [
    `❓ <b>${escapeHtml(question.header || 'Питання')}</b>${total > 1 ? ` (${index + 1}/${total})` : ''}`,
    escapeHtml(question.question),
    '',
  ];
  question.options.forEach((option, i) => {
    lines.push(`<b>${i + 1}. ${escapeHtml(option.label)}</b>`);
    if (option.description) lines.push(escapeHtml(option.description));
    if (option.preview)
      lines.push(`<pre>${escapeHtml(String(option.preview).slice(0, 600))}</pre>`);
  });
  lines.push(
    '',
    question.multiSelect
      ? '<i>Можна кілька: познач і натисни «Готово», або напиши свою відповідь.</i>'
      : '<i>Натисни варіант або напиши свою відповідь.</i>'
  );
  return lines.join('\n');
}

export function planKeyboard(id) {
  return {
    inline_keyboard: [
      [{ text: '✅ Так, auto', callback_data: callbackData('p', id, 'auto') }],
      [{ text: '🚀 Так, bypass', callback_data: callbackData('p', id, 'bypass') }],
      [{ text: '✋ Так, manual', callback_data: callbackData('p', id, 'manual') }],
      [{ text: '✏️ Доопрацювати', callback_data: callbackData('p', id, 'revise') }],
    ],
  };
}

export function permissionKeyboard(id, canAlwaysAllow) {
  const row = [
    { text: '✅ Дозволити', callback_data: callbackData('perm', id, 'allow') },
    { text: '❌ Відхилити', callback_data: callbackData('perm', id, 'deny') },
  ];
  return {
    inline_keyboard: canAlwaysAllow
      ? [
          row,
          [
            {
              text: '♾ Дозволяти до кінця сесії',
              callback_data: callbackData('perm', id, 'always'),
            },
          ],
        ]
      : [row],
  };
}

export function modeKeyboard(current) {
  return {
    inline_keyboard: Object.entries(MODES).map(([name, mode]) => [
      {
        text: `${name === current ? '✓ ' : ''}${mode.emoji} ${mode.label}${name === DEFAULT_MODE ? ' (дефолт)' : ''}`,
        callback_data: callbackData('mode', name),
      },
    ]),
  };
}

export function modeText(current) {
  return [
    `Режим: ${MODES[current].emoji} <b>${current}</b>`,
    '',
    ...Object.entries(MODES).map(
      ([name, mode]) => `${mode.emoji} <b>${name}</b>: ${escapeHtml(mode.about)}`
    ),
    '',
    '<i>Або текстом: /mode bypass | auto | manual | plan</i>',
  ].join('\n');
}

/** Voice reply modes of `/voice` with what each does. */
export const VOICE_MODE_ABOUT = {
  auto: 'на твої голосові',
  on: 'на кожну відповідь',
  off: 'ніколи',
};

/** `/voice` keyboard: the reply mode, the voices (the current one marked) and the samples button. */
export function voiceKeyboard(voices, mode, current) {
  const mark = (on) => (on ? '✓ ' : '');
  const rows = [
    Object.keys(VOICE_MODE_ABOUT).map((name) => ({
      text: `${mark(name === mode)}${name}`,
      callback_data: callbackData('voice', 'mode', name),
    })),
  ];
  for (let i = 0; i < voices.length; i += 3)
    rows.push(
      voices.slice(i, i + 3).map((name) => ({
        text: `${mark(name === current)}${name}`,
        callback_data: callbackData('voice', 'name', name),
      }))
    );
  rows.push([{ text: '🔈 Зразки голосів', callback_data: callbackData('voice', 'samples') }]);
  return { inline_keyboard: rows };
}

export function voiceText(mode, current) {
  return [
    `🔊 Голосові відповіді: <b>${escapeHtml(mode)}</b> · голос <b>${escapeHtml(current)}</b>`,
    '',
    ...Object.entries(VOICE_MODE_ABOUT).map(([name, about]) => `<b>${name}</b>: ${about}`),
    '',
    '<i>Вибір голосу надсилає його зразок. Або текстом: /voice auto | on | off | samples | &lt;імʼя&gt;</i>',
  ].join('\n');
}

/** What a permission prompt asks for, in one HTML message: the action and its details (command, file, diff). */
export function permissionHtml(toolName, input = {}, options = {}) {
  const title = options.title || `Claude хоче використати ${toolName}`;
  const lines = [`🔐 <b>${escapeHtml(title)}</b>`];
  if (options.agentID) lines.push(`<i>субагент ${escapeHtml(options.agentID)}</i>`);
  if (options.description) lines.push(escapeHtml(options.description));
  if (typeof input.command === 'string') {
    lines.push(`<pre>${escapeHtml(input.command.slice(0, 1500))}</pre>`);
    if (input.description) lines.push(`<i>${escapeHtml(input.description)}</i>`);
  } else if (typeof input.file_path === 'string') {
    lines.push(`<code>${escapeHtml(input.file_path)}</code>`);
    if (typeof input.old_string === 'string' && typeof input.new_string === 'string') {
      const diff = [
        ...input.old_string.split('\n').map((line) => `- ${line}`),
        ...input.new_string.split('\n').map((line) => `+ ${line}`),
      ].join('\n');
      lines.push(`<pre>${escapeHtml(diff.slice(0, 1500))}</pre>`);
    } else if (typeof input.content === 'string') {
      lines.push(`<pre>${escapeHtml(input.content.slice(0, 1200))}</pre>`);
    }
  } else if (Object.keys(input).length) {
    lines.push(`<pre>${escapeHtml(JSON.stringify(input, null, 1).slice(0, 1500))}</pre>`);
  }
  if (options.decisionReason)
    lines.push(`<i>${escapeHtml(String(options.decisionReason).slice(0, 300))}</i>`);
  lines.push('', '<i>Або напиши текстом, що зробити натомість (це відхилить дію).</i>');
  return lines.join('\n');
}

/** Effort levels of Claude Code (`/effort`); a model may support fewer (ModelInfo.supportedEffortLevels). */
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

/** `/model` buttons: one per model of `supportedModels()` (by index: model ids can be long), the current one marked. */
export function modelKeyboard(models, current) {
  return {
    inline_keyboard: models.map((model, i) => [
      {
        text: buttonText(
          `${model.value === current ? '✓ ' : ''}${model.displayName || model.value}`
        ),
        callback_data: callbackData('model', String(i)),
      },
    ]),
  };
}

export function modelText(models, current) {
  return [
    `Модель: <b>${escapeHtml(current)}</b>`,
    '',
    ...models.map(
      (model) =>
        `<b>${escapeHtml(model.displayName || model.value)}</b> <code>${escapeHtml(model.value)}</code>${model.description ? `\n${escapeHtml(model.description)}` : ''}`
    ),
    '',
    '<i>Або текстом: /model &lt;назва&gt;</i>',
  ].join('\n');
}

/** `/effort` buttons: the levels the model supports and "default" (the model's own), the current one marked. */
export function effortKeyboard(levels, current) {
  const mark = (level) => (level === current ? '✓ ' : '');
  return {
    inline_keyboard: [
      levels.map((level) => ({
        text: `${mark(level)}${level}`,
        callback_data: callbackData('effort', level),
      })),
      [
        {
          text: `${current ? '' : '✓ '}за замовчуванням моделі`,
          callback_data: callbackData('effort', 'default'),
        },
      ],
    ],
  };
}

/** Background tasks of the previous run offered for restoring: what each was, why and when it started. */
export function backgroundRestoreHtml(
  records,
  { picked = new Set(), decision = null, timeZone } = {}
) {
  const clip = (text, max) => {
    const value = String(text ?? '').trim();
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
  };
  const head = {
    null: '⏸ <b>Фонові задачі попереднього запуску не завершились</b> (воркер або сесія зупинились):',
    restore: '♻️ <b>Відновлюю фонові задачі</b> (позначені ✓):',
    none: '🚫 <b>Фонові задачі не відновлюю:</b>',
  }[decision ?? 'null'];
  const items = records.map((record, i) => {
    const agent = record.taskType === 'local_agent' || Boolean(record.prompt && !record.command);
    const mark = decision === 'restore' ? (picked.has(i) ? '✓ ' : '✗ ') : '';
    const kind = agent
      ? `🤖 субагент${record.subagentType ? ` ${escapeHtml(record.subagentType)}` : ''}`
      : `💻 ${escapeHtml(record.tool ?? 'команда')}`;
    const lines = [
      `${mark}<b>${i + 1}.</b> ${kind} · ${escapeHtml(clip(record.description, 120))}`,
    ];
    if (record.command) lines.push(`<pre>${escapeHtml(clip(record.command, 400))}</pre>`);
    else if (record.prompt) lines.push(`Завдання: <i>${escapeHtml(clip(record.prompt, 300))}</i>`);
    if (record.purpose)
      lines.push(`Мета (твоє повідомлення): «${escapeHtml(clip(record.purpose, 300))}»`);
    if (record.startedAt) {
      const started = new Date(record.startedAt).toLocaleString('uk-UA', {
        ...(timeZone ? { timeZone } : {}),
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
      lines.push(`Запущено: ${started}`);
    }
    return lines.join('\n');
  });
  const tail = decision ? '' : '\n\nВідновити? Позначай задачі кнопками або вибери все / нічого.';
  return `${head}\n\n${items.join('\n\n')}${tail}`;
}

/** Buttons of the restore offer: one toggle per task, then restore the picked ones, all, or none. */
export function backgroundRestoreKeyboard(id, records, picked = new Set()) {
  const rows = records.map((record, i) => [
    {
      text: `${picked.has(i) ? '☑️' : '⬜'} ${i + 1}. ${String(record.description || record.command || 'задача').slice(0, 40)}`,
      callback_data: callbackData('bg', id, String(i)),
    },
  ]);
  if (picked.size)
    rows.push([
      {
        text: `✅ Відновити вибрані (${picked.size})`,
        callback_data: callbackData('bg', id, 'picked'),
      },
    ]);
  rows.push([
    { text: '♻️ Відновити всі', callback_data: callbackData('bg', id, 'all') },
    { text: '🚫 Жодної', callback_data: callbackData('bg', id, 'none') },
  ]);
  return { inline_keyboard: rows };
}
