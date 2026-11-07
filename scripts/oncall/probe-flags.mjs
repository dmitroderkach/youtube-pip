/**
 * On-call (docs/ONCALL.md): run the e2e suite once per new relevant flag with that flag in the opposite of its
 * usual state — forced on when this page was not served it (or got false), forced off when it got true — so the
 * report says whether the flag actually changes our flows. Compare with the run's `chromium` results (no flags
 * forced). Non-boolean flags are not probed.
 *
 * Extra flags to probe even if not new (manual check): env PROBE_FLAGS=name,name2 (Manual E2E input probe_flags).
 *
 * Usage: node scripts/oncall/probe-flags.mjs <flags.json> <out-dir>
 * Writes <out-dir>/summary.json: { probed: [{ flag, forced, total, passed, failed, flaky }], skipped: [...] }.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { summarizePlaywrightReport } from './lib/playwright-results.mjs';

/** At most this many flags per run: each probe loads YouTube ~18 times (CAPTCHA risk from one IP). */
const MAX_PROBED_FLAGS = 5;
/** The `chromium` project forces no flags; like-dislike (account mutation) is not in it. */
const PROBE_PROJECT = 'chromium';

const [flagsPath, outDir] = process.argv.slice(2);
const flags = JSON.parse(readFileSync(flagsPath, 'utf8'));
mkdirSync(outDir, { recursive: true });

const candidates = new Map();
const requested = (process.env.PROBE_FLAGS ?? '')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean)
  .map((name) => ({ name, value: flags.relevant?.[name]?.value, requested: true }));
for (const f of [...requested, ...(flags.newCodeFlags ?? []), ...(flags.newFlags ?? [])]) {
  if (!candidates.has(f.name)) candidates.set(f.name, f);
}

const probed = [];
const skipped = [];
for (const [name, f] of candidates) {
  const value = f.value === undefined ? undefined : String(f.value);
  if (value !== undefined && value !== 'true' && value !== 'false') {
    skipped.push({ flag: name, kind: 'non_boolean', reason: `non-boolean value "${value}"` });
    continue;
  }
  if (probed.length >= MAX_PROBED_FLAGS) {
    // Not marked as seen by the on-call, so it is new again and probed in the next run
    skipped.push({
      flag: name,
      kind: 'limit',
      reason: `limit of ${MAX_PROBED_FLAGS} probes per run`,
    });
    continue;
  }
  const forced = value === 'true' ? `${name}=false` : name;
  const report = join(outDir, `${name}.json`);
  console.log(`probe: ${PROBE_PROJECT} with ${forced}`);
  const run = spawnSync(
    'npx',
    ['playwright', 'test', `--project=${PROBE_PROJECT}`, '--reporter=json'],
    {
      env: {
        ...process.env,
        E2E_FORCE_EXPERIMENT_FLAGS: forced,
        PLAYWRIGHT_JSON_OUTPUT_NAME: report,
      },
      stdio: ['ignore', 'ignore', 'inherit'],
    }
  );
  const summary = summarizePlaywrightReport(report);
  probed.push({
    flag: name,
    forced: value === 'true' ? 'off' : 'on',
    requested: !!f.requested,
    exitCode: run.status,
    ...summary,
  });
  console.log(
    `probe ${forced}: ${summary.passed}/${summary.total} passed, ${summary.failed.length} failed, ${summary.flaky.length} flaky`
  );
}

writeFileSync(
  join(outDir, 'summary.json'),
  JSON.stringify({ project: PROBE_PROJECT, probed, skipped }, null, 2)
);
console.log(`probes: ${probed.length} run, ${skipped.length} skipped`);
