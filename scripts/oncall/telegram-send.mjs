/**
 * On-call (docs/ONCALL.md): send a plain-text file to Telegram. Reads TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID
 * from the environment (the on-call runner gets them from AWS Secrets Manager). Splits at Telegram's limit.
 * Usage: node scripts/oncall/telegram-send.mjs <message.txt>
 */
import { readFileSync } from 'node:fs';

const TELEGRAM_MAX_LENGTH = 4000;
const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
if (!token || !chatId) throw new Error('TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set');

const text = readFileSync(process.argv[2], 'utf8').trim();
const chunks = [];
for (let rest = text; rest.length > 0; ) {
  let cut =
    rest.length <= TELEGRAM_MAX_LENGTH ? rest.length : rest.lastIndexOf('\n', TELEGRAM_MAX_LENGTH);
  if (cut <= 0) cut = TELEGRAM_MAX_LENGTH;
  chunks.push(rest.slice(0, cut));
  rest = rest.slice(cut).trimStart();
}
for (const chunk of chunks) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: chunk, disable_web_page_preview: true }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`Telegram: ${body.error_code} ${body.description}`);
}
console.log(`telegram: sent ${chunks.length} message(s)`);
