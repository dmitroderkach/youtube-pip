/**
 * Green Claude Code update: commit the bumped pins on deps/claude-code-<cli>, push it and open a PR as the GitHub App
 * (a short-lived token from the oncall-schedule Lambda, action app_token), so the PR's checks run. Prints url=<PR url>.
 */
import { execFileSync } from 'node:child_process';
import { invoke } from './aws-invoke.mjs';

const { SDK, CLI, FROM_SDK, FROM_CLI, RUN_URL, GITHUB_REPOSITORY } = process.env;
const branch = `deps/claude-code-${CLI}`;
const prefix = process.env.NAME_PREFIX || 'youtube-pip-prod';
const { token } = await invoke(`${prefix}-oncall-schedule`, { action: 'app_token' });
const git = (...args) => execFileSync('git', args, { stdio: 'inherit' });

git('config', 'user.name', 'youtube-pip-fargate-runner[bot]');
git('config', 'user.email', 'youtube-pip-fargate-runner[bot]@users.noreply.github.com');
git('checkout', '-b', branch);
git(
  'add',
  'scripts/dev-worker/package.json',
  'scripts/dev-worker/package-lock.json',
  '.github/workflows/e2e-manual.yml'
);
git(
  'commit',
  '-m',
  `Claude Code ${CLI} (Agent SDK ${SDK})\n\nWeekly update check: unit tests, the SDK contract smoke test, the worker end to end and the on-call CLI smoke test passed (${RUN_URL}).`
);
git(
  'push',
  `https://x-access-token:${token}@github.com/${GITHUB_REPOSITORY}.git`,
  `HEAD:refs/heads/${branch}`
);

const body = [
  '## What',
  '',
  `- Dev worker: \`@anthropic-ai/claude-agent-sdk\` ${FROM_SDK} -> **${SDK}** (\`scripts/dev-worker/package.json\`, lock).`,
  `- On-call: \`@anthropic-ai/claude-code\` ${FROM_CLI} -> **${CLI}** (\`.github/workflows/e2e-manual.yml\`).`,
  '',
  '## Checked by the weekly update job',
  '',
  '- worker unit tests and `node --check`;',
  '- SDK contract smoke test with the real Claude (`scripts/dev-worker/sdk-smoke.mjs`): permission callback allow / deny, AskUserQuestion answers, permission mode status, model switch, background task events, rate-limit event, resume with `CLAUDE_CODE_TRANSCRIPT_LOCAL_GC`;',
  '- the worker end to end with a fake AWS / Telegram and the real Claude (`scripts/claude-update/worker-e2e.sh`);',
  '- the on-call CLI in print mode.',
  '',
  `Run: ${RUN_URL}`,
  '',
  'Changelogs: [Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md), [Claude Code](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md).',
  '',
  'After the merge, `dev-worker-publish.yml` asks the owner (Telegram, ✅) to publish the worker image; the on-call uses the new CLI from its next run.',
].join('\n');
const res = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/pulls`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    title: `Claude Code ${CLI} (Agent SDK ${SDK})`,
    head: branch,
    base: 'main',
    body,
  }),
});
const pr = await res.json();
if (!res.ok) throw new Error(`PR: ${res.status} ${pr.message ?? ''}`);
console.log(`url=${pr.html_url}`);
