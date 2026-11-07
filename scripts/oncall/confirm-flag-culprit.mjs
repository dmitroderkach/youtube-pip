/**
 * On-call (docs/ONCALL.md, "Flag culprit"): for tests that failed or were flaky in the e2e run, find out whether an
 * experiment flag the page was served is the cause, and which one. The e2e fixtures record the relevant boolean
 * flags that were on for each failed attempt and for a passing retry (e2e/fixtures/page-flags.ts).
 *
 * A logged-out context lands in a random experiment bucket on every load, so a flag may show up in one attempt only
 * and a plain re-run proves nothing. Instead:
 *   0. suspects = flags on in every failed attempt of the test, minus flags also on in its passing attempt (flaky);
 *   1. re-run with all suspects forced on (the failed attempt's state) — passes → not reproduced by these flags;
 *   2. re-run with all suspects forced off — still fails → not caused by these flags;
 *   3. otherwise bisect with the suspects on: turn off half until one flag remains (or report the interacting set).
 * Failed tests first, then flaky ones; at most MAX_TESTS per run.
 *
 * Usage: node scripts/oncall/confirm-flag-culprit.mjs <results.json> <page-flags-dir> <out-dir>
 * Writes <out-dir>/summary.json:
 *   [{ project, title, file, line, status, suspects, result, culprit?, set?, runs }]
 *   result: culprit | interaction | not_reproduced | not_flags | no_suspects | skipped_limit
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { summarizePlaywrightReport } from './lib/playwright-results.mjs';

/** At most this many tests per run: each bisection is ~log2(suspects) + 2 test runs. */
const MAX_TESTS = 2;

const [resultsPath, flagsDir, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const results = summarizePlaywrightReport(resultsPath);
const records = existsSync(flagsDir)
  ? readdirSync(flagsDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(flagsDir, f), 'utf8')))
  : [];

/** Path relative to the repo, e.g. e2e/tests/pip-stub.spec.ts (the record holds the e2e runner's absolute path). */
const repoPath = (file) => file.slice(file.indexOf('e2e/'));

/** One target per failed / flaky test that has a recorded failed attempt. */
const targets = [];
for (const test of [
  ...results.failed.map((t) => ({ ...t, kind: 'failed' })),
  ...results.flaky.map((t) => ({ ...t, kind: 'flaky' })),
]) {
  const attempts = records.filter(
    (r) =>
      r.project === test.project &&
      repoPath(r.file).endsWith(test.file) &&
      test.title.endsWith(r.title)
  );
  const failedAttempts = attempts.filter((r) => r.status !== 'passed');
  if (!failedAttempts.length) continue;
  const { project, file, line, title } = failedAttempts[0];
  if (targets.some((t) => t.project === project && t.file === file && t.line === line)) continue;
  // A single culprit is on in every failed attempt and off in the passing one
  const onInPassing = new Set(
    attempts.filter((r) => r.status === 'passed').flatMap((r) => r.candidates)
  );
  const suspects = failedAttempts[0].candidates.filter(
    (name) => failedAttempts.every((r) => r.candidates.includes(name)) && !onInPassing.has(name)
  );
  targets.push({ project, file, line, title, status: test.kind, suspects });
}

let runCounter = 0;
/** Run the one test with all `suspects` forced on except `off` (forced off); true when it passes. */
function passesWith(target, off) {
  const offSet = new Set(off);
  const report = join(outDir, `run-${++runCounter}.json`);
  spawnSync(
    'npx',
    [
      'playwright',
      'test',
      `${repoPath(target.file)}:${target.line}`,
      `--project=${target.project}`,
      '--retries=0',
      '--reporter=json',
    ],
    {
      env: {
        ...process.env,
        E2E_FORCE_EXPERIMENT_FLAGS: target.suspects
          .map((name) => (offSet.has(name) ? `${name}=false` : name))
          .join(','),
        PLAYWRIGHT_JSON_OUTPUT_NAME: report,
      },
      stdio: ['ignore', 'ignore', 'inherit'],
    }
  );
  const summary = summarizePlaywrightReport(report);
  const passed = summary.found && summary.total > 0 && summary.failed.length === 0;
  console.log(
    `  run ${runCounter}: ${target.suspects.length - offSet.size} on, ${offSet.size} off → ${passed ? 'passed' : 'failed'}`
  );
  return passed;
}

function check(target) {
  const startRuns = runCounter;
  const entry = {
    project: target.project,
    title: target.title,
    file: repoPath(target.file),
    line: target.line,
    status: target.status,
    suspects: target.suspects.length,
  };
  const done = (fields) => ({ ...entry, ...fields, runs: runCounter - startRuns });
  if (!target.suspects.length) return done({ result: 'no_suspects' });
  if (passesWith(target, [])) return done({ result: 'not_reproduced' });
  if (!passesWith(target, target.suspects)) return done({ result: 'not_flags' });
  let set = target.suspects;
  while (set.length > 1) {
    const left = set.slice(0, Math.ceil(set.length / 2));
    const right = set.slice(left.length);
    if (passesWith(target, left)) set = left;
    else if (passesWith(target, right)) set = right;
    else return done({ result: 'interaction', set });
  }
  return done({ result: 'culprit', culprit: set[0] });
}

const summary = [];
for (const [index, target] of targets.entries()) {
  if (index >= MAX_TESTS) {
    summary.push({
      project: target.project,
      title: target.title,
      file: repoPath(target.file),
      line: target.line,
      status: target.status,
      suspects: target.suspects.length,
      result: 'skipped_limit',
      runs: 0,
    });
    continue;
  }
  console.log(
    `culprit: ${target.status} [${target.project}] ${target.title} (${target.suspects.length} suspect flags)`
  );
  summary.push(check(target));
}
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(
  `culprits: ${summary.map((s) => `${s.project} ${s.result}${s.culprit ? ` ${s.culprit}` : ''}`).join('; ') || 'nothing to check'}`
);
