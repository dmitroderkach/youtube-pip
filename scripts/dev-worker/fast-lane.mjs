#!/usr/bin/env node
/**
 * The fast lane of the dev chat (docs/DEV_WORKER.md "Fast lane"; plan "Fast lane for the dev chat"): a Lambda
 * (same image as the worker, this entry point) that answers the owner in seconds while the long-running worker
 * sleeps or works, and hands real work over to it.
 *
 * One invocation at a time (reserved concurrency 1). dev-bot puts the owner's message into the fast lane's FIFO queue
 * and invokes it with { wake: true }; the handler then runs a receive loop like the worker's (messages written while
 * it answers join the running turn) until it is idle for IDLE_SECONDS, saves its own Claude session to S3 and returns.
 *
 * Isolation (the same rule as the worker's, without a second Linux user): the handler keeps the secrets in memory
 * (Secrets Manager, never env vars); Claude Code gets an environment built from scratch with only the token proxy's
 * URL and placeholder (anthropic-proxy.mjs), no built-in tool but AskUserQuestion, and only the in-process tools of
 * assistant-tools.mjs, which run here, in the handler: GitHub and AWS credentials never reach the agent. Both are
 * checked before every session (fast-lane-core.mjs); a failed check fails closed: the message goes to the worker.
 *
 * Chat features come from the shared modules (telegram, voice, incoming, interactions), like the worker's.
 */
import { execFile } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { startAnthropicProxy } from './anthropic-proxy.mjs';
import { createTools, STATE_KEYS } from './assistant-tools.mjs';
import {
  checkChildEnv,
  checkToolList,
  childEnv,
  handOverMessage,
  prefixCallbacks,
  runtimeLoop,
  stripCallbackPrefix,
  taskTitle,
  tooBigToResume,
} from './fast-lane-core.mjs';
import { createIncoming } from './incoming.mjs';
import { createInteractions } from './interactions.mjs';
import { appendChatLog, chatLogEntry, voiceReplyWanted } from './session-state.mjs';
import { createTelegram } from './telegram.mjs';
import { parseCallback } from './telegram-format.mjs';
import { createVoice } from './voice.mjs';

const execFileAsync = promisify(execFile);
const env = process.env;
const log = (...args) => console.log(new Date().toISOString(), ...args);

const REGION = env.AWS_REGION ?? 'eu-central-1';
const BUCKET = env.STATE_BUCKET;
const QUEUE_URL = env.QUEUE_URL;
const DEV_BOT_FUNCTION = env.DEV_BOT_FUNCTION;
const REPO = env.GITHUB_REPO ?? 'dmitroderkach/youtube-pip';
/** Claude Code's memory project of the worker (memory/<project>/ in the state bucket). */
const MEMORY_PROJECT = env.MEMORY_PROJECT ?? '-home-worker-youtube-pip';
/** No message and no turn for this long: the invocation ends. */
const IDLE_MS = Number(env.IDLE_SECONDS ?? 60) * 1000;
/** Stop this long before the Lambda's deadline (save the session, answer the invocation). */
const DEADLINE_MARGIN_MS = 90_000;
const RECEIVE_WAIT_SECONDS = 5;
/** /tmp is the only writable place in a Lambda; Claude Code's home and the working directory live there. */
const HOME = env.FAST_LANE_HOME ?? '/tmp/fast-lane';
const WORK_DIR = join(HOME, 'work');
const INBOX_DIR = join(HOME, 'inbox');
/** The fast lane's own session in the state bucket (fast-lane/), resumed across invocations. */
const SESSION_KEY = 'fast-lane/session.json';
const TRANSCRIPT_KEY = 'fast-lane/transcript.jsonl';
const SETTINGS_KEY = 'state/settings.json';
const DEFAULTS = { model: 'sonnet', effort: 'low' };
const MCP_NAME = 'fast_lane';
/** Built-in tools Claude Code may use: none but asking the owner. */
const BUILTIN_TOOLS = ['AskUserQuestion'];
const PROMPT = readFileSync(new URL('./fast-lane-prompt.md', import.meta.url), 'utf8');

const s3 = new S3Client({ region: REGION });
const sqs = new SQSClient({ region: REGION });
const lambda = new LambdaClient({ region: REGION });

// ---------------------------------------------------------------------------------------------- S3

const isMissing = (error) =>
  error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404;

/** { text, etag } of an object, or null when it does not exist. */
async function getObject(key) {
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    return { text: await out.Body.transformToString(), etag: out.ETag };
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

async function putObject(key, body, { ifMatch, ifNoneMatch } = {}) {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ...(ifMatch ? { IfMatch: ifMatch } : {}),
      ...(ifNoneMatch ? { IfNoneMatch: ifNoneMatch } : {}),
    })
  );
}

/**
 * Read-modify-write with a conditional write (ETag), retried on a conflict: the worker and the fast lane write the
 * same object (the chat log) at any time and neither may drop the other's lines.
 */
async function updateObject(key, change, attempts = 4) {
  for (let attempt = 1; ; attempt++) {
    const current = await getObject(key);
    const next = change(current?.text ?? null);
    try {
      await putObject(key, next, current ? { ifMatch: current.etag } : { ifNoneMatch: '*' });
      return;
    } catch (error) {
      const conflict = [409, 412].includes(error?.$metadata?.httpStatusCode);
      if (!conflict || attempt >= attempts) throw error;
    }
  }
}

const s3Client = {
  get: async (key) => (await getObject(key))?.text ?? null,
  async list(prefix) {
    const out = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix }));
    return (out.Contents ?? []).map((item) => item.Key);
  },
  put: (key, text) => putObject(key, text),
  delete: (key) => s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })),
};

/** getJson / putJson for the shared modules (voice budget, voice transcripts). */
const stateStore = {
  async getJson(key) {
    const object = await getObject(key);
    return object ? JSON.parse(object.text) : null;
  },
  putJson: (key, value) => putObject(key, JSON.stringify(value)),
};

/** The AWS CLI (in the image): AWS Transcribe of voice messages when Gemini is not configured. */
const aws = async (...args) =>
  (await execFileAsync('aws', [...args, '--region', REGION], { maxBuffer: 16 * 1024 * 1024 }))
    .stdout;

// ---------------------------------------------------------------------------------------------- secrets

/** The handler's secrets, in memory only (never env vars: a child of the same user could read /proc/1/environ). */
let secrets = null;

async function loadSecrets() {
  if (secrets) return secrets;
  const client = new SecretsManagerClient({ region: REGION });
  const out = await client.send(new GetSecretValueCommand({ SecretId: env.ONCALL_SECRET_ARN }));
  const value = JSON.parse(out.SecretString);
  secrets = {
    claudeToken: value.claude_code_oauth_token,
    botToken: value.telegram_bot_token,
    chatId: value.telegram_chat_id,
    githubToken: (value.github_read_token ?? '').trim() || null,
    googleKey: (value.google_tts_api_key ?? '').trim() || null,
  };
  return secrets;
}

/** Tests only (fast-lane-smoke.mjs): secrets given directly, never inside a Lambda. */
export function useSecretsForTest(value) {
  if (env.AWS_LAMBDA_RUNTIME_API) throw new Error('not in a Lambda');
  secrets = value;
}

const secretValues = () =>
  secrets
    ? [secrets.claudeToken, secrets.botToken, secrets.githubToken, secrets.googleKey].filter(
        Boolean
      )
    : [];

// ---------------------------------------------------------------------------------------------- chat

let tg = null;
let voice = null;
let incoming = null;
let interactions = null;
let proxy = null;
let settings = {};

/** The Telegram client with every button the fast lane sends prefixed (dev-bot routes their presses back here). */
function fastLaneTelegram(client) {
  return {
    ...client,
    call: (method, body) =>
      client.call(
        method,
        body?.reply_markup ? { ...body, reply_markup: prefixCallbacks(body.reply_markup) } : body
      ),
    sayHtml: (html, markup) => client.sayHtml(html, prefixCallbacks(markup)),
    editHtml: (id, html, markup) => client.editHtml(id, html, prefixCallbacks(markup)),
    editButtons: (id, markup) => client.editButtons(id, prefixCallbacks(markup)),
  };
}

async function initChat() {
  await loadSecrets();
  mkdirSync(INBOX_DIR, { recursive: true });
  if (!tg) {
    tg = fastLaneTelegram(
      createTelegram({
        token: secrets.botToken,
        chatId: secrets.chatId,
        log,
        readFile: (path) => readFileSync(path),
        inboxDir: INBOX_DIR,
      })
    );
    voice = createVoice({
      env: {
        GOOGLE_TTS_API_KEY: secrets.googleKey ?? undefined,
        TRANSCRIBE_LANGUAGE: env.TRANSCRIBE_LANGUAGE,
      },
      log,
      telegram: tg,
      // The voice settings are shared with the worker (state/meta.json today); changing them is the worker's in
      // this version (C3 moves the commands here)
      settings: { get: () => settings.voice ?? {}, set: () => {} },
      store: stateStore,
      aws,
      upload: (file, uri) => aws('s3', 'cp', file, uri, '--quiet'),
      bucket: BUCKET,
      formatTime: (date) =>
        date.toLocaleTimeString('uk-UA', { timeZone: settings.timeZone ?? 'Europe/Warsaw' }),
    });
    incoming = createIncoming({ log, telegram: tg, voice, store: stateStore });
    interactions = createInteractions({ telegram: tg });
  }
  if (!proxy) proxy = await startAnthropicProxy({ token: secrets.claudeToken, log });
}

/** The fast lane's model and effort (state/settings.json, fastLane.*) and the shared voice / time zone settings. */
async function loadSettings() {
  const [own, meta] = await Promise.all([
    stateStore.getJson(SETTINGS_KEY).catch(() => null),
    stateStore.getJson(STATE_KEYS.META).catch(() => null),
  ]);
  settings = {
    model: own?.fastLane?.model ?? DEFAULTS.model,
    effort: own?.fastLane?.effort ?? DEFAULTS.effort,
    timeZone: own?.timeZone ?? meta?.timeZone ?? 'Europe/Warsaw',
    voice: {
      voiceMode: own?.voice?.voiceMode ?? meta?.voiceMode,
      voiceName: own?.voice?.voiceName ?? meta?.voiceName,
      voiceModel: own?.voice?.voiceModel ?? meta?.voiceModel,
    },
  };
}

/** One line in the shared chat log (role fast-lane / owner), conditional write: the worker writes it too. */
async function logChat(role, text, options = {}) {
  if (!text) return;
  try {
    await updateObject(STATE_KEYS.CHAT_LOG, (content) =>
      appendChatLog(content, chatLogEntry(role, text, options))
    );
  } catch (error) {
    log('chat log failed', error);
  }
}

// ---------------------------------------------------------------------------------------------- hand-over

/**
 * The task goes to the worker through dev-bot (dated now: the worker skips older messages); dev-bot starts the worker
 * (a no-op when it runs) and posts "🛠 Довга задача: піднімаю…".
 */
async function handOver(task, context) {
  const { body, date } = handOverMessage({ task, context });
  return toWorker(body, date, taskTitle(task));
}

/**
 * The owner's message as it came (attachments too), passed on to the worker unchanged but dated now and marked as a
 * hand-over: voice messages (AWS Transcribe is outside the project's permissions boundary, so the fast lane does not
 * transcribe) and messages the fast lane cannot take (fail closed).
 */
async function handOverRaw(message, reason) {
  const date = Math.floor(Date.now() / 1000);
  const body = { ...message, date, handover: true };
  delete body.callback;
  return toWorker(body, date, reason);
}

/**
 * Through dev-bot ({ action: hand_over }): the project's permissions boundary lets no role but the gate's dev-bot
 * write the worker's queue (a message there is the owner's word), so dev-bot puts the task there, marked as handed
 * over, and starts the worker (UP_AT = min(now, since), so it takes this message).
 */
async function toWorker(body, date, reason) {
  try {
    const out = await lambda.send(
      new InvokeCommand({
        FunctionName: DEV_BOT_FUNCTION,
        InvocationType: 'Event',
        Payload: Buffer.from(
          JSON.stringify({ action: 'hand_over', reason, since: date, message: body })
        ),
      })
    );
    if (out.StatusCode !== 202) throw new Error(`invoke status ${out.StatusCode}`);
  } catch (error) {
    log('hand_over request failed', error);
    return 'Handing over failed: tell the owner the working worker could not be reached and to send /up.';
  }
  return 'Handed over: dev-bot puts the task into the worker queue and starts the worker (or it is already running).';
}

// ---------------------------------------------------------------------------------------------- tools

/** Files the owner sent, in the inbox: the agent opens them only through this tool (no Read tool). */
function inboxFile(path) {
  const full = resolve(String(path ?? ''));
  if (!full.startsWith(`${INBOX_DIR}/`) || !existsSync(full)) return null;
  const stat = lstatSync(full);
  return stat.isFile() && stat.size <= 10 * 1024 * 1024 ? full : null;
}

const text = (value) => ({ content: [{ type: 'text', text: String(value) }] });

export function mcpServer() {
  const github = async (path) => {
    const res = await fetch(`https://api.github.com/${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'youtube-pip-fast-lane',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(secrets.githubToken ? { Authorization: `Bearer ${secrets.githubToken}` } : {}),
      },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`GitHub ${res.status}: ${json.message ?? ''}`);
    return json;
  };
  const tools = createTools({ s3: s3Client, github, repo: REPO, project: MEMORY_PROJECT });
  const wrap = (fn) => async (args) => {
    try {
      return text(await fn(args ?? {}));
    } catch (error) {
      return { ...text(`Error: ${String(error?.message ?? error).slice(0, 500)}`), isError: true };
    }
  };
  return createSdkMcpServer({
    name: MCP_NAME,
    version: '1.0.0',
    tools: [
      tool(
        'chat_log',
        'The last lines of the conversation (owner, worker, fast lane).',
        { lines: z.number().int().optional() },
        wrap(tools.chatLog)
      ),
      tool(
        'progress',
        "The long-running worker's progress record: what it is doing now.",
        {},
        wrap(tools.progress)
      ),
      tool('memory_index', 'The memory index (one line per memory).', {}, wrap(tools.memoryIndex)),
      tool(
        'memory_read',
        'One memory file by name (from the index).',
        { name: z.string() },
        wrap(tools.memoryRead)
      ),
      tool('plans_list', 'Saved plans (file names).', {}, wrap(tools.plansList)),
      tool('plan_read', 'One saved plan by file name.', { name: z.string() }, wrap(tools.planRead)),
      tool(
        'pull_requests',
        'Pull requests of the repository.',
        { state: z.enum(['open', 'closed', 'all']).optional() },
        wrap(tools.pullRequests)
      ),
      tool(
        'pull_request',
        'One pull request with its checks.',
        { number: z.number().int() },
        wrap(tools.pullRequest)
      ),
      tool(
        'workflow_runs',
        'Recent workflow runs (all, or one workflow file).',
        { workflow: z.string().optional() },
        wrap(tools.workflowRuns)
      ),
      tool(
        'read_file',
        'A file (or directory listing) of the repository, main or another ref.',
        { path: z.string(), ref: z.string().optional() },
        wrap(tools.readFile)
      ),
      tool(
        'search_code',
        'Code search in the repository.',
        { query: z.string() },
        wrap(tools.searchCode)
      ),
      tool(
        'schedule_add',
        'Schedule a one-off task / reminder: when = "YYYY-MM-DD HH:MM" in the owner\'s time zone.',
        { when: z.string(), text: z.string(), zone: z.string().optional() },
        wrap(tools.scheduleAdd)
      ),
      tool('schedule_list', "The owner's scheduled tasks.", {}, wrap(tools.scheduleList)),
      tool(
        'schedule_cancel',
        'Cancel a scheduled task by id.',
        { id: z.string() },
        wrap(tools.scheduleCancel)
      ),
      tool(
        'view_attachment',
        'Open a photo or file the owner sent (a path under the inbox, given in the message).',
        { path: z.string() },
        async ({ path }) => {
          const file = inboxFile(path);
          if (!file) return text('Not a file the owner sent.');
          const data = readFileSync(file);
          const image = /\.(png|jpe?g|webp|gif)$/i.exec(file);
          if (image) {
            const type = image[1].toLowerCase().replace('jpg', 'jpeg');
            return {
              content: [
                { type: 'image', data: data.toString('base64'), mimeType: `image/${type}` },
              ],
            };
          }
          return text(data.toString('utf8').slice(0, 30000));
        }
      ),
      tool(
        'hand_over',
        'Give a task to the long-running worker (code, tests, PRs, terraform, browser, long work, merges / releases). Starts it if it sleeps.',
        { task: z.string(), context: z.string().optional() },
        wrap(({ task, context }) => handOver(task, context))
      ),
    ],
  });
}

export const EXPECTED_TOOLS = [
  ...BUILTIN_TOOLS,
  ...[
    'chat_log',
    'progress',
    'memory_index',
    'memory_read',
    'plans_list',
    'plan_read',
    'pull_requests',
    'pull_request',
    'workflow_runs',
    'read_file',
    'search_code',
    'schedule_add',
    'schedule_list',
    'schedule_cancel',
    'view_attachment',
    'hand_over',
  ].map((name) => `mcp__${MCP_NAME}__${name}`),
];

// ---------------------------------------------------------------------------------------------- session

const inputQueue = [];
let wakeInput = null;
async function* userMessages() {
  for (;;) {
    while (inputQueue.length) yield inputQueue.shift();
    await new Promise((resolveWake) => (wakeInput = resolveWake));
    wakeInput = null;
  }
}
function sendToClaude(content, priority) {
  inputQueue.push({
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null,
    ...(priority ? { priority } : {}),
  });
  wakeInput?.();
}

let session = null;
let sessionDone = null;
let sessionId = null;
let turnActive = false;
let voiceTrigger = null;
let isolationFailed = null;

/** The transcript of a session id under Claude Code's projects directory, or null. */
function findTranscript(id) {
  const projects = join(HOME, '.claude', 'projects');
  if (!id || !existsSync(projects)) return null;
  for (const dir of readdirSync(projects)) {
    const path = join(projects, dir, `${id}.jsonl`);
    if (existsSync(path)) return path;
  }
  return null;
}

/** Restore the fast lane's session from S3 (a fresh one when there is none or it got too big). */
async function restoreSession() {
  const saved = await stateStore.getJson(SESSION_KEY).catch(() => null);
  if (!saved?.sessionId) return null;
  const transcript = await getObject(TRANSCRIPT_KEY).catch(() => null);
  if (!transcript || tooBigToResume(Buffer.byteLength(transcript.text))) return null;
  // Claude Code keeps a session under projects/<cwd with "/" as "-">/
  const dir = join(HOME, '.claude', 'projects', WORK_DIR.replace(/[^A-Za-z0-9]/g, '-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${saved.sessionId}.jsonl`), transcript.text);
  return saved.sessionId;
}

async function saveSession() {
  if (!sessionId) return;
  const path = findTranscript(sessionId);
  if (!path) return;
  await putObject(TRANSCRIPT_KEY, readFileSync(path));
  await stateStore.putJson(SESSION_KEY, { sessionId, savedAt: new Date().toISOString() });
}

async function canUseTool(toolName, input, options) {
  if (toolName === 'AskUserQuestion') return interactions.askQuestions(input, options.signal);
  // Every other tool is one of ours (allowed below); anything else is refused
  return {
    behavior: 'deny',
    message: 'Not available in the fast lane: hand the task over to the worker.',
  };
}

/**
 * The SDK options of the fast lane's session: no built-in tool but AskUserQuestion, only our in-process tools, no
 * settings files, no MCP servers from configuration, the environment given (childEnv).
 */
export function queryOptions({ environment, resumeId, model, effort, ask = canUseTool }) {
  mkdirSync(WORK_DIR, { recursive: true });
  return {
    model,
    effort,
    cwd: WORK_DIR,
    ...(resumeId ? { resume: resumeId } : {}),
    tools: BUILTIN_TOOLS,
    allowedTools: EXPECTED_TOOLS.filter((name) => name.startsWith('mcp__')),
    mcpServers: { [MCP_NAME]: mcpServer() },
    strictMcpConfig: true,
    settingSources: [],
    canUseTool: ask,
    permissionMode: 'default',
    systemPrompt: PROMPT,
    env: environment,
    stderr: (data) => log(`claude: ${String(data).trim().slice(0, 1000)}`),
  };
}

async function startSession() {
  mkdirSync(WORK_DIR, { recursive: true });
  const resumeId = await restoreSession();
  const environment = childEnv({ home: HOME, proxyUrl: proxy.url, placeholder: proxy.placeholder });
  const problems = checkChildEnv(environment, {
    placeholder: proxy.placeholder,
    secrets: secretValues(),
  });
  if (problems.length) throw new Error(`isolation self-check: ${problems.join('; ')}`);
  session = query({
    prompt: userMessages(),
    options: queryOptions({
      environment,
      resumeId,
      model: settings.model,
      effort: settings.effort,
    }),
  });
  sessionDone = consume().catch((error) => {
    log('session failed', error);
    turnActive = false;
  });
}

/** The stream of the session: the isolation check on init, the answer of each turn to the chat. */
async function consume() {
  let answer = '';
  for await (const message of session) {
    if (message.session_id) sessionId = message.session_id;
    if (message.type === 'system' && message.subtype === 'init') {
      const { unexpected, missing } = checkToolList(message.tools, EXPECTED_TOOLS);
      if (unexpected.length || missing.length) {
        isolationFailed = `tools: unexpected ${unexpected.join(', ') || '-'}; missing ${missing.join(', ') || '-'}`;
        log(`isolation self-check failed: ${isolationFailed}`);
        await session.interrupt().catch(() => {});
        session.close();
        return;
      }
    }
    if (message.type === 'assistant' && !message.parent_tool_use_id) {
      const parts = (message.message?.content ?? []).filter((item) => item.type === 'text');
      if (parts.length) answer = parts.map((item) => item.text).join('\n');
    }
    if (message.type === 'result') {
      turnActive = false;
      const final = (typeof message.result === 'string' && message.result) || answer;
      answer = '';
      await finishTurn(final, message.is_error);
    }
  }
}

async function finishTurn(answerText, failed) {
  const { text: shown, spoken } = voice.splitVoiceBlock(answerText ?? '');
  if (shown) {
    await tg.say(shown);
    await logChat('fast-lane', shown);
  } else if (failed) {
    await tg.say('⚠️ Швидка смуга не змогла відповісти (див. логи)');
  }
  const trigger = voiceTrigger;
  voiceTrigger = null;
  if (shown && !failed && secrets.googleKey && voiceReplyWanted(voice.voiceMode(), trigger)) {
    try {
      const speech = (spoken ?? voice.speakable(shown)).slice(0, voice.TTS_MAX_CHARS * 2);
      const messageId = await tg.sendVoice(await voice.synthesizeWithFallback(speech));
      await incoming.keepVoiceTranscript(messageId, speech);
    } catch (error) {
      log('voice reply failed', error);
    }
  }
}

// ---------------------------------------------------------------------------------------------- messages

/** A message from the queue: a button press of ours, an answer to a waiting question, or a new prompt. */
async function deliver(message) {
  if (message.callback) {
    const data = stripCallbackPrefix(message.callback.data);
    if (data === null) return;
    const { kind, id, value } = parseCallback(data);
    if (kind === 'voice') return voice.onVoiceButton(message.callback.message_id, id, value);
    const entry = interactions.getPending(id);
    if (!entry || entry.kind !== kind) {
      await tg.editButtons(message.callback.message_id);
      await tg.say('ℹ️ Це питання вже неактуальне');
      return;
    }
    if (kind === 'q') await interactions.onQuestionButton(entry, value);
    return;
  }
  const audio = (message.attachments ?? []).some((a) => a.kind === 'voice' || a.kind === 'audio');
  if (interactions.answersPending(message)) {
    if (audio) {
      await tg.say('🎙 Тут аудіо не розпізнаю: відповідай на питання текстом або кнопкою');
      return;
    }
    interactions.answerText(await incoming.spokenText(message));
    return;
  }
  let status = null;
  const setStatus = async (line) => {
    if (status) await tg.edit(status.message_id, line);
    else status = await tg.call('sendMessage', { text: line });
  };
  if (audio) {
    await tg.say('🎙 Аудіо розпізнає робочий воркер: передаю йому повідомлення');
    await logChat(
      'fast-lane',
      'Voice / audio message handed over to the worker (not transcribed here).'
    );
    const result = await handOverRaw(message, 'голосове повідомлення');
    if (/failed/.test(result)) await tg.say('⚠️ Не вдалося підняти воркер: надішли /up');
    return;
  }
  let prompt = await incoming.buildPrompt(message, setStatus);
  if (!prompt) return;
  // No Read tool here: files the owner sent are opened with view_attachment
  prompt = prompt.replaceAll('with the Read tool', 'with the view_attachment tool');
  const spoken = (message.attachments ?? []).some((a) => a.kind === 'voice');
  await logChat('owner', prompt, { kind: spoken ? 'voice' : 'text' });
  if (voiceTrigger !== 'voice') voiceTrigger = spoken ? 'voice' : 'text';
  if (secrets.googleKey && voiceReplyWanted(voice.voiceMode(), voiceTrigger)) {
    prompt = `${prompt}\n\n${voice.VOICE_NOTE}`;
  }
  void tg.call('sendChatAction', { action: 'typing' });
  if (isolationFailed) throw new Error(`isolation self-check: ${isolationFailed}`);
  if (!session) await startSession();
  if (turnActive) {
    sendToClaude(
      `[New message from the owner while you were answering. Read it first.]\n\n${prompt}`,
      'next'
    );
  } else {
    turnActive = true;
    sendToClaude(prompt);
  }
}

async function receive() {
  const out = await sqs.send(
    new ReceiveMessageCommand({
      QueueUrl: QUEUE_URL,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: RECEIVE_WAIT_SECONDS,
    })
  );
  const messages = out.Messages ?? [];
  for (const message of messages) {
    // At most once, like the worker: a message that breaks the fast lane is not redelivered forever
    await sqs.send(
      new DeleteMessageCommand({ QueueUrl: QUEUE_URL, ReceiptHandle: message.ReceiptHandle })
    );
  }
  return messages.map((message) => JSON.parse(message.Body));
}

/** Fail closed: the fast lane cannot answer safely, so the owner's message goes to the worker as it is. */
async function failClosed(message, reason) {
  log(`fail closed: ${reason}`);
  await tg
    ?.say('⚠️ Швидка смуга недоступна: передаю повідомлення робочому воркеру')
    .catch(() => {});
  if (message && !message.callback) {
    await handOverRaw(message, taskTitle(message.text || 'повідомлення з вкладенням')).catch(
      (error) => log('fail-closed hand-over failed', error)
    );
  }
}

/** One invocation: receive and answer until idle (or close to the deadline), then save the session. */
export async function handler(event, context = {}) {
  const deadline = context.deadline ?? Date.now() + 900_000;
  await initChat();
  await loadSettings();
  let lastActivity = Date.now();
  let handled = 0;
  for (;;) {
    if (Date.now() > deadline - DEADLINE_MARGIN_MS) break;
    const idle = !turnActive && !interactions.getTextTarget();
    if (idle && Date.now() - lastActivity > IDLE_MS) break;
    let messages = [];
    try {
      messages = await receive();
    } catch (error) {
      log('receive failed', error);
      continue;
    }
    for (const message of messages) {
      lastActivity = Date.now();
      handled++;
      try {
        await deliver(message);
      } catch (error) {
        await failClosed(message, String(error?.message ?? error));
      }
    }
    if (turnActive) lastActivity = Date.now();
  }
  interactions.abortAll();
  if (session) {
    session.close();
    await Promise.race([sessionDone, new Promise((r) => setTimeout(r, 10_000))]);
    await saveSession().catch((error) => log('session save failed', error));
  }
  session = null;
  sessionDone = null;
  turnActive = false;
  isolationFailed = null;
  rmSync(INBOX_DIR, { recursive: true, force: true });
  log(`invocation done: ${handled} message(s)`);
  return { handled, wake: Boolean(event?.wake) };
}

if (env.AWS_LAMBDA_RUNTIME_API) {
  await runtimeLoop(handler, { api: env.AWS_LAMBDA_RUNTIME_API, log });
} else if (process.argv[1]?.endsWith('fast-lane.mjs') && process.argv.includes('--once')) {
  // Local run (tests): one invocation
  console.log(JSON.stringify(await handler({ wake: true })));
}
