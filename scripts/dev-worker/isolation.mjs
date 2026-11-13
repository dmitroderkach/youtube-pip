/**
 * Claude Code as a separate Linux user (docs/DEV_WORKER.md, "Claude Code as a separate user"): the worker process
 * (user `devworker`) holds the secrets (bot token, GitHub App key, Google key) in its environment; Claude Code and every
 * command it runs work as CLAUDE_USER with an environment that has none of them, and cannot read the worker's
 * /proc/<pid>/environ (another uid). The worker never runs code from Claude's home: git, npm, tar and the S3 syncs of
 * Claude's directories run as CLAUDE_USER too, and files the worker reads there are refused when they are not plain
 * files (a symlink to /proc/1/environ must not be read with the worker's rights).
 *
 * Without CLAUDE_USER (the worker e2e harness, a laptop) everything runs as the current user, as before.
 */
import { spawn } from 'node:child_process';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';

export const CLAUDE_USER = process.env.CLAUDE_USER || null;
export const CLAUDE_HOME = CLAUDE_USER
  ? process.env.CLAUDE_HOME || `/home/${CLAUDE_USER}`
  : homedir();

/** Names of the worker's secrets; on top of them anything that looks like a credential is dropped. */
const SECRET_NAMES = new Set([
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'GOOGLE_TTS_API_KEY',
  'GITHUB_APP_ID',
  'GITHUB_APP_INSTALLATION_ID',
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_TOKEN',
  'GH_TOKEN',
]);
const SECRET_PATTERN = /TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY/i;
/** Credentials Claude does need: its own OAuth token (it runs on it) and the ECS credentials endpoint (the task role). */
const ALLOWED = new Set(['CLAUDE_CODE_OAUTH_TOKEN', 'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI']);

/**
 * The environment for Claude Code (claude = true) or for another command run as CLAUDE_USER: the worker's secrets
 * removed, HOME set to Claude's home. Claude's OAuth token only goes to Claude Code itself.
 */
export function claudeEnv(base, { claude = false } = {}) {
  const result = {};
  for (const [name, value] of Object.entries(base ?? {})) {
    if (value === undefined) continue;
    if (SECRET_NAMES.has(name)) continue;
    if (name === 'CLAUDE_CODE_OAUTH_TOKEN' && !claude) continue;
    if (SECRET_PATTERN.test(name) && !ALLOWED.has(name)) continue;
    result[name] = String(value);
  }
  if (CLAUDE_USER) {
    Object.assign(result, { HOME: CLAUDE_HOME, USER: CLAUDE_USER, LOGNAME: CLAUDE_USER });
  }
  return result;
}

/**
 * [command, args] that run `cmd args` as CLAUDE_USER with `environment` (sudo resets the environment; `env -i` sets
 * exactly the given one). Without CLAUDE_USER: as is.
 */
export function asClaude(cmd, args, environment) {
  if (!CLAUDE_USER) return [cmd, args];
  const pairs = Object.entries(environment).map(([name, value]) => `${name}=${value}`);
  return ['sudo', ['-n', '-u', CLAUDE_USER, '--', '/usr/bin/env', '-i', ...pairs, cmd, ...args]];
}

/**
 * Agent SDK `spawnClaudeCodeProcess`: Claude Code as CLAUDE_USER, with the SDK's environment minus the worker's
 * secrets. sudo relays signals (interrupt, stop) to the process it runs.
 */
export function spawnClaudeCode(options) {
  const environment = claudeEnv(options.env, { claude: true });
  const [cmd, args] = asClaude(options.command, options.args, environment);
  return spawn(cmd, args, {
    cwd: options.cwd,
    env: CLAUDE_USER ? { PATH: process.env.PATH } : environment,
    signal: options.signal,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/** True for a plain file (not a symlink, device, FIFO or directory). */
export function isPlainFile(path) {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Read a file from Claude's home with the worker's rights: only a plain file, opened without following a symlink
 * (O_NOFOLLOW; checked again on the open descriptor, so a swap after the check is refused too). Throws otherwise.
 */
export function readPlainFile(path, encoding) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!fstatSync(fd).isFile()) throw new Error(`not a plain file: ${path}`);
    return readFileSync(fd, encoding);
  } finally {
    closeSync(fd);
  }
}
