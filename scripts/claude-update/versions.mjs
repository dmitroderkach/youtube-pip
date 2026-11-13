/**
 * Claude Code update check (.github/workflows/claude-code-update.yml): the pinned and the newest versions of the Agent
 * SDK (dev worker) and of Claude Code (on-call CLI). Prints GITHUB_OUTPUT lines: update (true / false), sdk, cli,
 * from_sdk, from_cli. No update when the pins are the newest, or when a PR branch for these versions exists already
 * (unless FORCE=true).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const npmLatest = (name) =>
  execFileSync('npm', ['view', name, 'version'], { encoding: 'utf8' }).trim();

const fromSdk = JSON.parse(readFileSync('scripts/dev-worker/package.json', 'utf8')).dependencies[
  '@anthropic-ai/claude-agent-sdk'
];
const fromCli = readFileSync('.github/workflows/e2e-manual.yml', 'utf8').match(
  /@anthropic-ai\/claude-code@([0-9][0-9.]*)/
)?.[1];
const sdk = npmLatest('@anthropic-ai/claude-agent-sdk');
const cli = npmLatest('@anthropic-ai/claude-code');
const branch = `deps/claude-code-${cli}`;

let update = sdk !== fromSdk || cli !== fromCli;
if (update && process.env.FORCE !== 'true') {
  const res = await fetch(
    `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/branches/${encodeURIComponent(branch)}`,
    // Authenticated: anonymous API calls share a small per-IP rate limit
    process.env.GITHUB_TOKEN
      ? { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } }
      : {}
  );
  if (res.ok) {
    console.error(`${branch} exists already: its PR is waiting for the owner`);
    update = false;
  }
}
if (process.env.FORCE === 'true') update = true;

console.error(`SDK ${fromSdk} -> ${sdk}, CLI ${fromCli} -> ${cli}, update: ${update}`);
for (const [key, value] of Object.entries({
  update,
  sdk,
  cli,
  from_sdk: fromSdk,
  from_cli: fromCli,
  branch,
}))
  console.log(`${key}=${value}`);
