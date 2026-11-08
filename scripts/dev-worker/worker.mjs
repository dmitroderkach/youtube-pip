/**
 * Dev worker (docs/DEV_WORKER.md): Claude Code session driven from the on-call Telegram chat.
 *
 * Runs inside the `dev-worker` ECS task (terraform/dev-worker): restores the session and the working copy from S3,
 * takes the owner's messages from the SQS FIFO queue filled by the dev-bot Lambda, runs each through Claude Code
 * (`--resume` of one session) and posts the answer to Telegram. Saves the state to S3 after every answer. Stops by
 * itself after IDLE_TIMEOUT_SECONDS without activity or MAX_LIFETIME_SECONDS in total, and on SIGTERM (`/down`,
 * ECS StopTask); every stop it initiates is reported in the chat and ends with exit code REPORTED_EXIT_CODE or 0,
 * which the dev-bot Lambda does not report again.
 *
 * Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, QUEUE_URL, STATE_BUCKET, CLAUDE_CODE_OAUTH_TOKEN, GH_TOKEN,
 *      GITHUB_REPO, UP_AT (unix seconds of /up), IDLE_TIMEOUT_SECONDS, MAX_LIFETIME_SECONDS, CLAUDE_MODEL.
 */
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const env = process.env;
const REPO = env.GITHUB_REPO ?? 'dmitroderkach/youtube-pip';
const REPO_DIR = join(homedir(), 'youtube-pip');
const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects');
const BUCKET = env.STATE_BUCKET;
const QUEUE_URL = env.QUEUE_URL;
const MODEL = env.CLAUDE_MODEL ?? 'opus';
const IDLE_MS = Number(env.IDLE_TIMEOUT_SECONDS ?? 600) * 1000;
const LIFETIME_MS = Number(env.MAX_LIFETIME_SECONDS ?? 14400) * 1000;
const UP_AT = Number(env.UP_AT ?? 0);
/** Exit code of a failure the worker has already reported in the chat (dev-bot does not report it again). */
const REPORTED_EXIT_CODE = 10;
/** SQS long poll per receive: short enough to notice SIGTERM / idle quickly. */
const RECEIVE_WAIT_SECONDS = 10;
const TELEGRAM_MAX_LENGTH = 4000;
const PROGRESS_EDIT_INTERVAL_MS = 4000;
/** SIGTERM from ECS leaves stopTimeout (120 s) to save; Claude gets this long to stop first. */
const CLAUDE_STOP_GRACE_MS = 10000;
const META_KEY = 'state/meta.json';
const WORKSPACE_KEY = 'state/workspace.tar.gz';
const PROJECTS_PREFIX = 'claude/projects/';
/** Rebuilt / reinstalled on start: not worth saving. */
const WORKSPACE_EXCLUDES = ['node_modules', 'dist', 'playwright-report', 'test-results'];
const SYSTEM_PROMPT = readFileSync(new URL('./system-prompt.md', import.meta.url), 'utf8');

const log = (...args) => console.log(new Date().toISOString(), ...args);

// ---------------------------------------------------------------------------------------------- Telegram

async function telegram(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      disable_web_page_preview: true,
      ...body,
    }),
  });
  const json = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
  if (!json.ok) log(`telegram ${method} failed: ${json.error_code ?? ''} ${json.description}`);
  return json.result;
}

function splitMessage(text) {
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

async function say(text) {
  let last;
  for (const chunk of splitMessage(text || '(порожня відповідь)')) {
    last = await telegram('sendMessage', { text: chunk });
  }
  return last;
}

const edit = (messageId, text) =>
  telegram('editMessageText', { message_id: messageId, text: text.slice(0, TELEGRAM_MAX_LENGTH) });

// ---------------------------------------------------------------------------------------------- shell / AWS

async function sh(cmd, args, options = {}) {
  const { stdout } = await execFileAsync(cmd, args, { maxBuffer: 64 * 1024 * 1024, ...options });
  return stdout;
}

const aws = (...args) => sh('aws', [...args, '--region', env.AWS_REGION ?? 'eu-central-1']);

async function s3Exists(key) {
  try {
    await aws('s3api', 'head-object', '--bucket', BUCKET, '--key', key);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------- state

/** { sessionId, savedAt } of the last save, or null. */
let meta = null;

async function restore() {
  if (await s3Exists(META_KEY)) {
    await aws('s3', 'cp', `s3://${BUCKET}/${META_KEY}`, '/tmp/meta.json', '--quiet');
    meta = JSON.parse(readFileSync('/tmp/meta.json', 'utf8'));
  }
  let workspace = false;
  if (await s3Exists(WORKSPACE_KEY)) {
    await aws('s3', 'cp', `s3://${BUCKET}/${WORKSPACE_KEY}`, '/tmp/workspace.tar.gz', '--quiet');
    mkdirSync(REPO_DIR, { recursive: true });
    await sh('tar', ['xzf', '/tmp/workspace.tar.gz', '-C', REPO_DIR]);
    workspace = true;
  }
  if (!existsSync(join(REPO_DIR, '.git'))) {
    await sh('git', ['clone', `https://github.com/${REPO}.git`, REPO_DIR]);
  }
  await sh('git', ['-C', REPO_DIR, 'fetch', '--prune', 'origin']);
  mkdirSync(CLAUDE_PROJECTS_DIR, { recursive: true });
  await aws('s3', 'sync', `s3://${BUCKET}/${PROJECTS_PREFIX}`, CLAUDE_PROJECTS_DIR, '--quiet');
  log(`restored: session=${meta?.sessionId ?? 'none'} workspace=${workspace}`);
  return { workspace };
}

async function save() {
  const excludes = WORKSPACE_EXCLUDES.flatMap((dir) => ['--exclude', `./${dir}`]);
  await sh('tar', ['czf', '/tmp/workspace.tar.gz', ...excludes, '-C', REPO_DIR, '.']);
  await aws('s3', 'cp', '/tmp/workspace.tar.gz', `s3://${BUCKET}/${WORKSPACE_KEY}`, '--quiet');
  // One object per transcript: the bucket's lifecycle rule expires sessions untouched for a week
  await aws('s3', 'sync', CLAUDE_PROJECTS_DIR, `s3://${BUCKET}/${PROJECTS_PREFIX}`, '--quiet');
  meta = { sessionId: meta?.sessionId ?? null, savedAt: new Date().toISOString() };
  writeFileSync('/tmp/meta.json', JSON.stringify(meta));
  await aws('s3', 'cp', '/tmp/meta.json', `s3://${BUCKET}/${META_KEY}`, '--quiet');
  log(`saved: session=${meta.sessionId}`);
}

// ---------------------------------------------------------------------------------------------- Claude

/** Claude Code process of the turn in progress (killed on SIGTERM). */
let claude = null;

function describeTool(name, input = {}) {
  const detail =
    input.command ??
    input.file_path ??
    input.pattern ??
    input.url ??
    input.description ??
    input.path ??
    '';
  return `${name}${detail ? `: ${String(detail).split('\n')[0].slice(0, 120)}` : ''}`;
}

/** Run one message through Claude Code in the saved session; returns { text, isError, sessionId, steps }. */
function runClaude(prompt, sessionId, onStep) {
  const args = [
    '-p',
    prompt,
    '--model',
    MODEL,
    '--output-format',
    'stream-json',
    '--verbose',
    '--dangerously-skip-permissions',
    '--append-system-prompt',
    SYSTEM_PROMPT,
  ];
  if (sessionId) args.push('--resume', sessionId);
  // Claude never needs the Telegram bot: keep it out of its environment
  const childEnv = { ...env };
  delete childEnv.TELEGRAM_BOT_TOKEN;
  delete childEnv.TELEGRAM_CHAT_ID;

  return new Promise((resolve) => {
    const child = spawn('claude', args, { cwd: REPO_DIR, env: childEnv });
    claude = child;
    let buffer = '';
    let stderr = '';
    let steps = 0;
    let result = null;
    let newSessionId = sessionId;
    child.stdout.on('data', (data) => {
      buffer += data;
      for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (event.session_id) newSessionId = event.session_id;
        if (event.type === 'assistant') {
          for (const item of event.message?.content ?? []) {
            if (item.type === 'tool_use') onStep(++steps, describeTool(item.name, item.input));
          }
        }
        if (event.type === 'result') result = event;
      }
    });
    child.stderr.on('data', (data) => {
      stderr = (stderr + data).slice(-4000);
    });
    child.on('close', (code) => {
      claude = null;
      if (result) {
        resolve({
          text: typeof result.result === 'string' ? result.result : '',
          isError: Boolean(result.is_error),
          sessionId: newSessionId,
          steps,
        });
      } else {
        resolve({
          text: `Claude Code завершився без відповіді (код ${code}). ${stderr.trim().slice(-1500)}`,
          isError: true,
          sessionId: newSessionId,
          steps,
        });
      }
    });
  });
}

async function handleMessage(text) {
  const started = Date.now();
  const progress = await telegram('sendMessage', { text: '⏳ Працюю…' });
  let lastEdit = 0;
  const onStep = (step, what) => {
    const now = Date.now();
    if (!progress || now - lastEdit < PROGRESS_EDIT_INTERVAL_MS) return;
    lastEdit = now;
    void edit(progress.message_id, `⏳ Працюю… крок ${step}\n${what}`);
  };

  let answer = await runClaude(text, meta?.sessionId ?? null, onStep);
  if (answer.isError && meta?.sessionId && /no conversation found/i.test(answer.text)) {
    // The saved session is gone (e.g. expired from S3): continue in a new one
    log(`session ${meta.sessionId} not found, starting a new one`);
    await say('ℹ️ Збережену сесію не знайдено (старша за тиждень?): починаю нову.');
    answer = await runClaude(text, null, onStep);
  }
  meta = { ...(meta ?? {}), sessionId: answer.sessionId };
  const seconds = Math.round((Date.now() - started) / 1000);
  if (progress) {
    await edit(
      progress.message_id,
      `${answer.isError ? '⚠️ Завершено з помилкою' : '✅ Готово'} за ${seconds} с, кроків: ${answer.steps}`
    );
  }
  await say(answer.text);
}

// ---------------------------------------------------------------------------------------------- main loop

const startedAt = Date.now();
let lastActivity = Date.now();
/** Why the worker is stopping: 'sigterm' | 'idle' | 'lifetime' | null. */
let stopReason = null;
let turnInterrupted = false;

process.on('SIGTERM', () => {
  log('SIGTERM');
  stopReason ??= 'sigterm';
  if (claude) {
    turnInterrupted = true;
    claude.kill('SIGINT');
    setTimeout(() => claude?.kill('SIGKILL'), CLAUDE_STOP_GRACE_MS).unref();
  }
});

async function receive() {
  const out = await aws(
    'sqs',
    'receive-message',
    '--queue-url',
    QUEUE_URL,
    '--max-number-of-messages',
    '1',
    '--wait-time-seconds',
    String(RECEIVE_WAIT_SECONDS),
    '--output',
    'json'
  );
  const messages = out.trim() ? (JSON.parse(out).Messages ?? []) : [];
  for (const message of messages) {
    // At most once: a message that crashes the worker is not redelivered forever
    await aws(
      'sqs',
      'delete-message',
      '--queue-url',
      QUEUE_URL,
      '--receipt-handle',
      message.ReceiptHandle
    );
  }
  return messages.map((message) => JSON.parse(message.Body));
}

async function stop() {
  const reason = stopReason;
  let saved = true;
  try {
    await save();
  } catch (error) {
    saved = false;
    log('save failed', error);
  }
  const context = saved ? 'контекст збережено' : 'контекст НЕ вдалося зберегти (див. логи)';
  const minutes = Math.round(IDLE_MS / 60000);
  const hours = Math.round(LIFETIME_MS / 3600000);
  const text = {
    idle: `💤 ${minutes} хв без активності: ${context}, воркер зупинився`,
    lifetime: `⏱ Досягнуто ліміту ${hours} год: ${context}, воркер зупинився`,
    sigterm: `⚪ Воркер зупинено, ${context}${turnInterrupted ? '. Поточну задачу перервано' : ''}`,
  }[reason];
  await say(text);
  process.exit(0);
}

async function main() {
  let restored;
  try {
    restored = await restore();
    await sh('npm', ['ci', '--no-audit', '--no-fund'], { cwd: REPO_DIR });
  } catch (error) {
    log('startup failed', error);
    await say(
      `🔴 Не вдалося підготувати воркера: ${String(error.message ?? error).slice(0, 1500)}`
    );
    process.exit(REPORTED_EXIT_CODE);
  }
  const branch = (await sh('git', ['-C', REPO_DIR, 'branch', '--show-current'])).trim();
  await say(
    meta?.sessionId
      ? `🟢 Воркер готовий (Opus). Контекст відновлено з сесії від ${new Date(meta.savedAt).toLocaleString('uk-UA', { timeZone: 'Europe/Warsaw' })}; гілка ${branch || '(detached)'}${restored.workspace ? '' : ', робоча копія свіжа'}.`
      : `🟢 Воркер готовий (Opus). Нова сесія; гілка ${branch || '(detached)'}.`
  );

  let skipped = 0;
  for (;;) {
    if (stopReason) return stop();
    if (Date.now() - lastActivity >= IDLE_MS) stopReason = 'idle';
    else if (Date.now() - startedAt >= LIFETIME_MS) stopReason = 'lifetime';
    if (stopReason) return stop();

    let messages = [];
    try {
      messages = await receive();
    } catch (error) {
      if (stopReason) return stop();
      log('receive failed', error);
      continue;
    }
    for (const message of messages) {
      if (stopReason) break;
      // Sent before this /up (left in the queue by a previous run): not meant for this session
      if (message.date < UP_AT) {
        skipped++;
        continue;
      }
      if (skipped) {
        await say(`ℹ️ Пропустив повідомлень, надісланих до /up: ${skipped}`);
        skipped = 0;
      }
      lastActivity = Date.now();
      try {
        await handleMessage(message.text);
      } catch (error) {
        log('turn failed', error);
        await say(`⚠️ Помилка воркера: ${String(error.message ?? error).slice(0, 1500)}`);
      }
      lastActivity = Date.now();
      if (stopReason) break;
      try {
        await save();
      } catch (error) {
        log('save failed', error);
        await say('⚠️ Не вдалося зберегти контекст у S3 (див. логи воркера).');
      }
    }
  }
}

main().catch(async (error) => {
  log('fatal', error);
  await say(`🔴 Воркер упав: ${String(error.message ?? error).slice(0, 1500)}`).catch(() => {});
  process.exit(REPORTED_EXIT_CODE);
});
