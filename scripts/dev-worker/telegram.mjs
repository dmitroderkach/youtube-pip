/**
 * Telegram Bot API I/O of the chat (shared by the worker and the fast lane, docs/DEV_WORKER.md "Code layout"): calls
 * with retries, sending (split to Telegram's limit), HTML with buttons and its plain-text fallback, edits, files to
 * the chat (photos inline, the rest as documents, the outbox), files from the chat (inbox) and voice messages.
 *
 * createTelegram({ token, chatId, log, readFile, inboxDir }) returns the functions; `readFile(path)` reads a file to
 * send (the worker reads Claude's files as Claude's user).
 */
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isPlainFile } from './isolation.mjs';

export const TELEGRAM_MAX_LENGTH = 4000;
/** Telegram Bot API calls: attempts and pause between them (the network to Telegram drops now and then). */
const TELEGRAM_ATTEMPTS = 3;
const TELEGRAM_RETRY_DELAY_MS = 2000;
const PHOTO_EXTENSIONS = /\.(png|jpe?g|webp|gif)$/i;
/** Bot API upload limits: photos up to 10 MB, other files up to 50 MB. */
const TELEGRAM_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const TELEGRAM_FILE_MAX_BYTES = 50 * 1024 * 1024;

/** Split a text at Telegram's message limit, at a line break where there is one. */
export function splitMessage(text) {
  const chunks = [];
  for (let rest = text.trim(); rest.length > 0; ) {
    let cut =
      rest.length <= TELEGRAM_MAX_LENGTH
        ? rest.length
        : rest.lastIndexOf('\n', TELEGRAM_MAX_LENGTH);
    if (cut <= 0) cut = TELEGRAM_MAX_LENGTH;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  return chunks;
}

/** Strip Telegram HTML to plain text (the fallback when Telegram refuses the markup). */
export const htmlToText = (html) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

export function createTelegram({ token, chatId, log, readFile, inboxDir }) {
  const env = { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId };
  const claudeRead = readFile;
  const INBOX_DIR = inboxDir;

  /**
   * POST to the Bot API with retries; never throws (a status that does not arrive must not stop the worker).
   * `makeBody` builds a fresh body per attempt (a FormData stream cannot be sent twice). Returns the parsed JSON.
   */
  async function telegramRequest(method, makeBody, headers = {}) {
    let lastError = '';
    for (let attempt = 1; attempt <= TELEGRAM_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
          method: 'POST',
          headers,
          body: makeBody(),
        });
        const json = await res
          .json()
          .catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
        // 4xx (bad request, message not modified, too big) will not get better with a retry
        if (json.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) return json;
        lastError = `${json.error_code ?? res.status} ${json.description ?? ''}`;
      } catch (error) {
        lastError = String(error?.cause?.code ?? error?.message ?? error);
      }
      if (attempt < TELEGRAM_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, TELEGRAM_RETRY_DELAY_MS * attempt));
      }
    }
    log(`telegram ${method} failed after ${TELEGRAM_ATTEMPTS} attempts: ${lastError}`);
    return { ok: false, description: lastError };
  }

  async function telegram(method, body) {
    const json = await telegramRequest(
      method,
      () =>
        JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, disable_web_page_preview: true, ...body }),
      { 'Content-Type': 'application/json' }
    );
    if (!json.ok) log(`telegram ${method} failed: ${json.error_code ?? ''} ${json.description}`);
    return json.result;
  }

  /** Send text (split to Telegram's limit); `silent`: no sound or banner on the owner's phone. */
  async function say(text, { silent = false } = {}) {
    let last;
    for (const chunk of splitMessage(text || '(порожня відповідь)')) {
      last = await telegram('sendMessage', {
        text: chunk,
        ...(silent ? { disable_notification: true } : {}),
      });
    }
    return last;
  }

  /** Upload a local file to the chat: images as photos (viewable inline), the rest and big images as documents. */
  async function sendFile(path) {
    const name = path.slice(path.lastIndexOf('/') + 1);
    if (!isPlainFile(path)) {
      await say(`⚠️ ${name}: не звичайний файл (посилання чи пристрій), не надсилаю`);
      return;
    }
    const size = statSync(path).size;
    if (size > TELEGRAM_FILE_MAX_BYTES) {
      await say(`⚠️ ${name}: ${Math.round(size / 1048576)} МБ, більше ліміту Telegram (50 МБ)`);
      return;
    }
    const asPhoto = PHOTO_EXTENSIONS.test(name) && size <= TELEGRAM_PHOTO_MAX_BYTES;
    const content = await claudeRead(path);
    const method = asPhoto ? 'sendPhoto' : 'sendDocument';
    const json = await telegramRequest(method, () => {
      const form = new FormData();
      form.append('chat_id', String(env.TELEGRAM_CHAT_ID));
      form.append('caption', name);
      form.append(asPhoto ? 'photo' : 'document', new Blob([content]), name);
      return form;
    });
    if (!json.ok) {
      log(`telegram ${method} failed: ${json.error_code ?? ''} ${json.description}`);
      await say(`⚠️ Не вдалося надіслати ${name}: ${json.description ?? 'помилка Telegram'}`);
    }
  }

  /** Send the files left in OUTBOX_DIR, oldest first; each is moved to OUTBOX_SENT_DIR afterwards. */
  async function flushOutbox(OUTBOX_DIR, OUTBOX_SENT_DIR) {
    if (!existsSync(OUTBOX_DIR)) return;
    const files = readdirSync(OUTBOX_DIR)
      .map((name) => join(OUTBOX_DIR, name))
      // Plain files only: a symlink there would be read with the worker's rights
      .filter((path) => isPlainFile(path))
      .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
    for (const path of files) {
      try {
        await sendFile(path);
      } catch (error) {
        log('outbox send failed', error);
      }
      mkdirSync(OUTBOX_SENT_DIR, { recursive: true });
      renameSync(
        path,
        join(OUTBOX_SENT_DIR, `${Date.now()}-${path.slice(path.lastIndexOf('/') + 1)}`)
      );
    }
  }

  const edit = (messageId, text) =>
    telegram('editMessageText', {
      message_id: messageId,
      text: text.slice(0, TELEGRAM_MAX_LENGTH),
    });

  /** Send an HTML message (with buttons); falls back to plain text if Telegram cannot parse the markup. */
  async function sayHtml(html, replyMarkup) {
    const extra = replyMarkup ? { reply_markup: replyMarkup } : {};
    const sent = await telegram('sendMessage', { text: html, parse_mode: 'HTML', ...extra });
    return (
      sent ??
      telegram('sendMessage', { text: htmlToText(html).slice(0, TELEGRAM_MAX_LENGTH), ...extra })
    );
  }

  /** Replace an HTML message's text (and its buttons: none unless given). */
  async function editHtml(messageId, html, replyMarkup) {
    const body = { message_id: messageId, reply_markup: replyMarkup ?? { inline_keyboard: [] } };
    const edited = await telegram('editMessageText', { ...body, text: html, parse_mode: 'HTML' });
    return (
      edited ??
      telegram('editMessageText', { ...body, text: htmlToText(html).slice(0, TELEGRAM_MAX_LENGTH) })
    );
  }

  const editButtons = (messageId, replyMarkup) =>
    telegram('editMessageReplyMarkup', {
      message_id: messageId,
      reply_markup: replyMarkup ?? { inline_keyboard: [] },
    });

  /** Download a file the owner sent (Bot API getFile, up to 20 MB) to INBOX_DIR; returns its local path. */
  async function downloadTelegramFile(fileId, name) {
    const file = await telegram('getFile', { file_id: fileId });
    if (!file?.file_path) throw new Error('Telegram не віддав файл (більше 20 МБ?)');
    // Retried like the Bot API calls: a dropped connection to Telegram (seen live: ETIMEDOUT) must not lose the message
    let res = null;
    let lastError = null;
    for (let attempt = 1; attempt <= 3 && !res?.ok; attempt++) {
      if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      res = await fetch(
        `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`,
        {
          signal: AbortSignal.timeout(60_000),
        }
      ).catch((error) => {
        lastError = error;
        return null;
      });
    }
    if (!res)
      throw new Error(
        `завантаження файлу: ${lastError?.cause?.code ?? lastError?.message ?? 'збій мережі'}`
      );
    if (!res.ok) throw new Error(`завантаження файлу: HTTP ${res.status}`);
    mkdirSync(INBOX_DIR, { recursive: true });
    const ext = file.file_path.includes('.')
      ? file.file_path.slice(file.file_path.lastIndexOf('.'))
      : '';
    const safeName = (name || `${Date.now()}${ext}`).replace(/[^\w.-]+/g, '_');
    const path = join(INBOX_DIR, `${Date.now()}-${safeName}`);
    // A new file only (wx): never written through a symlink planted at the name
    writeFileSync(path, Buffer.from(await res.arrayBuffer()), { flag: 'wx' });
    return path;
  }

  async function sendVoice(audio, caption) {
    const json = await telegramRequest('sendVoice', () => {
      const form = new FormData();
      form.append('chat_id', String(env.TELEGRAM_CHAT_ID));
      if (caption) form.append('caption', caption);
      form.append('voice', new Blob([audio], { type: 'audio/ogg' }), 'voice.ogg');
      return form;
    });
    if (!json.ok) throw new Error(`sendVoice: ${json.description ?? 'Telegram error'}`);
    return json.result?.message_id ?? null;
  }

  return {
    request: telegramRequest,
    call: telegram,
    say,
    sayHtml,
    editHtml,
    edit,
    editButtons,
    sendFile,
    flushOutbox,
    download: downloadTelegramFile,
    sendVoice,
  };
}
