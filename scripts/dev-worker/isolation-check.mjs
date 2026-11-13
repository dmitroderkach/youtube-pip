/**
 * Isolation check of the dev worker image (docs/DEV_WORKER.md, "Claude Code as a separate user"), run inside the
 * container as its PID 1 with fake secrets in the environment (.github/workflows/dev-worker-image.yml):
 *   docker run --rm -e TELEGRAM_BOT_TOKEN=… -v "$PWD/scripts/dev-worker:/check:ro" --entrypoint node <image> /check/isolation-check.mjs
 * Claude Code's user must not see the worker's secrets, read its process or files, or gain its rights; the token
 * broker, the umask for shared files and the Claude Code executable must work. Prints one line per check, exit 1 on
 * a failure.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
import {
  asClaude,
  CLAUDE_HOME,
  CLAUDE_USER,
  claudeEnv,
  spawnClaudeCode,
} from '/opt/dev-worker/isolation.mjs';

const FAKE = ['fake-bot-token', 'fake-app-key', 'fake-google-key'];
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

/** Run as Claude's user with Claude's environment; { status, out } (stdout + stderr). */
function asClaudeRun(cmd, args, extra = {}) {
  const [command, commandArgs] = asClaude(cmd, args, { ...claudeEnv(process.env), ...extra });
  const result = spawnSync(command, commandArgs, { encoding: 'utf8' });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

check(
  'worker process runs as devworker',
  execFileSync('id', ['-un'], { encoding: 'utf8' }).trim() === 'devworker'
);
check('CLAUDE_USER is worker', CLAUDE_USER === 'worker' && CLAUDE_HOME === '/home/worker');
check(
  'fake secrets present in the worker',
  FAKE.every((value) => Object.values(process.env).includes(value))
);

const who = asClaudeRun('id', ['-un']);
check(
  'a command as Claude runs as worker',
  who.status === 0 && who.out.trim() === 'worker',
  who.out.trim()
);

const environ = asClaudeRun('cat', [`/proc/${process.pid}/environ`]);
check(
  "Claude cannot read the worker's /proc/<pid>/environ",
  environ.status !== 0 && !FAKE.some((v) => environ.out.includes(v)),
  environ.out.trim().slice(0, 80)
);

const env = asClaudeRun('env', []);
check(
  "Claude's environment has none of the secrets",
  env.status === 0 && !FAKE.some((v) => env.out.includes(v))
);

const home = asClaudeRun('ls', ['/var/lib/dev-worker']);
check("Claude cannot list the worker's home", home.status !== 0);

const sudo = asClaudeRun('sudo', ['-n', 'true']);
check('Claude has no sudo', sudo.status !== 0);

const code = asClaudeRun('sh', ['-c', 'echo x > /opt/dev-worker/probe 2>&1; echo $?']);
check(
  "Claude cannot write the worker's code",
  code.out.trim().endsWith('1') || code.out.includes('denied'),
  code.out.trim()
);

const umask = asClaudeRun('sh', [
  '-c',
  `f=${CLAUDE_HOME}/.umask-probe; : > $f && stat -c %a $f && rm -f $f`,
]);
check(
  "Claude's files are group-writable (umask 002)",
  umask.out.trim() === '664',
  umask.out.trim()
);

// Claude Code itself as worker, through the SDK's spawn hook: the bundled executable starts and sees no secrets
// The platform package of the Agent SDK carries the Claude Code executable
const claudeBin = '/opt/dev-worker/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude';
const child = spawnClaudeCode({
  command: claudeBin,
  args: ['--version'],
  cwd: CLAUDE_HOME,
  env: process.env,
});
let version = '';
child.stdout.on('data', (data) => (version += data));
child.stderr.on('data', (data) => (version += data));
const exitCode = await new Promise((resolve) => child.on('exit', resolve));
check(
  'Claude Code starts through spawnClaudeCode',
  exitCode === 0 && /\d+\.\d+\.\d+/.test(version),
  version.trim()
);
const spawnedEnv = spawnClaudeCode({
  command: 'sh',
  args: ['-c', 'id -un; env'],
  cwd: CLAUDE_HOME,
  env: process.env,
});
let spawnedOut = '';
spawnedEnv.stdout.on('data', (data) => (spawnedOut += data));
await new Promise((resolve) => spawnedEnv.on('exit', resolve));
check(
  'spawnClaudeCode: as worker, no secrets',
  spawnedOut.startsWith('worker') && !FAKE.some((v) => spawnedOut.includes(v))
);

// The token broker: a stand-in on the real socket path, asked by github-token as Claude
const socket = process.env.GITHUB_BROKER_SOCKET;
rmSync(socket, { force: true });
const server = createServer((req, res) => res.end(req.url === '/token' ? 'broker-token' : 'no'));
await new Promise((resolve) => server.listen(socket, resolve));
const token = asClaudeRun('github-token', []);
check(
  'github-token as Claude gets the broker token',
  token.status === 0 && token.out.trim() === 'broker-token',
  token.out.trim()
);
const credential = asClaudeRun('sh', [
  '-c',
  'printf "protocol=https\\nhost=github.com\\n\\n" | git credential fill',
]);
check(
  'git credential helper as Claude uses the broker',
  credential.out.includes('password=broker-token')
);
server.close();

console.log(failed ? `${failed} check(s) failed` : 'all isolation checks passed');
process.exit(failed ? 1 : 0);
