/**
 * Dev worker (docs/DEV_WORKER.md): one-time Telegram setup after `terraform apply`.
 *
 * - generates the webhook secret token if `youtube-pip-dev-worker` has none (kept in that secret, never printed);
 * - points the on-call bot's webhook at the dev-bot Lambda URL with that secret (`message` updates and
 *   `callback_query` for the worker's buttons, one connection at a time so commands and messages arrive in order);
 * - sets the bot's command menu (/up, /down, /mode, /model, /effort, /agents, /plans, /compact, /context, /background, /voice, /timezone, /scheduled, /status).
 *
 * Safe to re-run (e.g. after a menu change): the secret is kept and the webhook set again.
 *
 * Usage: from the dev worker, `dev-ops telegram` (the owner approves; CodeBuild telegram-setup runs this file of a main
 * commit), or locally with AWS credentials of the account, from the repository root:
 *   node scripts/dev-worker/setup-telegram.mjs "$(terraform -chdir=terraform output -raw dev_bot_webhook_url)"
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const REGION = process.env.AWS_REGION ?? 'eu-central-1';
const ONCALL_SECRET = 'youtube-pip-oncall';
const DEV_SECRET = 'youtube-pip-dev-worker';
const webhookUrl = process.argv[2];
if (!webhookUrl?.startsWith('https://'))
  throw new Error('usage: setup-telegram.mjs <dev_bot_webhook_url>');

const readSecret = (id) =>
  JSON.parse(
    execFileSync('aws', [
      'secretsmanager',
      'get-secret-value',
      '--region',
      REGION,
      '--secret-id',
      id,
      '--query',
      'SecretString',
      '--output',
      'text',
    ]).toString()
  );

const oncall = readSecret(ONCALL_SECRET);
const dev = readSecret(DEV_SECRET);
if (!dev.telegram_webhook_secret) {
  // Telegram allows A-Z, a-z, 0-9, _ and - (1–256 chars)
  dev.telegram_webhook_secret = randomBytes(32).toString('hex');
  execFileSync(
    'aws',
    [
      'secretsmanager',
      'put-secret-value',
      '--region',
      REGION,
      '--secret-id',
      DEV_SECRET,
      '--secret-string',
      'file:///dev/stdin',
    ],
    { input: JSON.stringify(dev) }
  );
  console.log('webhook secret: generated and stored');
} else {
  console.log('webhook secret: already set');
}

async function bot(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${oncall.telegram_bot_token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`${method}: ${json.error_code} ${json.description}`);
  return json.result;
}

await bot('setWebhook', {
  url: webhookUrl,
  secret_token: dev.telegram_webhook_secret,
  allowed_updates: ['message', 'callback_query'],
  max_connections: 1,
  drop_pending_updates: true,
});
console.log('webhook: set');
await bot('setMyCommands', {
  commands: [
    { command: 'up', description: 'Підняти воркера (Claude Code)' },
    { command: 'down', description: 'Зупинити воркера, зберегти контекст' },
    { command: 'mode', description: 'Режим: bypass, auto, manual, plan' },
    { command: 'model', description: 'Модель Claude (зберігається між сесіями)' },
    { command: 'effort', description: 'Effort: low … max (зберігається між сесіями)' },
    { command: 'agents', description: 'Агенти: основний і субагенти, чиї повідомлення дивитись' },
    { command: 'plans', description: 'Збережені плани (режим plan)' },
    { command: 'compact', description: 'Стиснути контекст сесії [інструкція]' },
    { command: 'context', description: 'Контекст сесії і ліміти Claude (5 год, тиждень)' },
    { command: 'background', description: 'Фонові задачі Claude' },
    { command: 'voice', description: 'Голосові відповіді: режим, голос, зразки' },
    { command: 'status', description: 'Статус угорі чату: показати й закріпити заново' },
    { command: 'scheduled', description: 'Заплановані задачі (скасувати)' },
    { command: 'timezone', description: 'Робоча таймзона: назва міста або Europe/Kyiv' },
  ],
});
console.log(
  'commands: /up, /down, /mode, /model, /effort, /agents, /plans, /compact, /context, /background, /voice, /timezone, /scheduled, /status'
);
const info = await bot('getWebhookInfo', {});
console.log(
  `webhook info: url matches=${info.url === webhookUrl}, pending=${info.pending_update_count}, last error=${info.last_error_message ?? 'none'}`
);
