/**
 * E2E: which experiment flags the page of a test attempt was served — to name the flag when YouTube rolls one out
 * and a test breaks (docs/ONCALL.md, "Flag culprit"). Recorded for every failed attempt and for a passing retry
 * (the flags of a flaky test's passing attempt narrow down the suspects). Candidates: relevant boolean flags
 * (`codeFlags` of docs/experiment-flags-baseline.json) that were `true` for this page and not forced by the project.
 * A logged-out context is bucketed anew on every load, so the on-call reproduces the failed attempt by forcing its
 * candidates on, then bisects by turning them off (scripts/oncall/confirm-flag-culprit.mjs).
 */
import type { Page, TestInfo } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Directory for the per-failure JSON files (set by the Manual E2E workflow); unset = log only. */
const PAGE_FLAGS_DIR_ENV = 'E2E_PAGE_FLAGS_DIR';

export interface PageFlagsRecord {
  project: string;
  file: string;
  line: number;
  title: string;
  /** Attempt index (0 = first run) and its outcome. */
  retry: number;
  status: 'passed' | 'failed';
  /** Relevant flags on for this page and not forced by the project. */
  candidates: string[];
  /** Flags the project forces (left as they are when probing). */
  forced: string[];
}

/** Page (ytcfg EXPERIMENT_FLAGS) and player (serializedExperimentFlags) flags of the main page, name → value. */
function readServedFlags(page: Page): Promise<Record<string, string>> {
  return page
    .evaluate(() => {
      const flags: Record<string, string> = {};
      const data =
        (window as unknown as { ytcfg?: { data_?: Record<string, unknown> } }).ytcfg?.data_ ?? {};
      for (const [name, value] of Object.entries(
        (data.EXPERIMENT_FLAGS as Record<string, unknown>) ?? {}
      )) {
        flags[name] = String(value);
      }
      const contexts =
        (data.WEB_PLAYER_CONTEXT_CONFIGS as Record<
          string,
          { serializedExperimentFlags?: string }
        >) ?? {};
      for (const ctx of Object.values(contexts)) {
        for (const pair of String(ctx.serializedExperimentFlags ?? '').split('&')) {
          const [name, value = ''] = pair.split('=');
          if (name && !(name in flags)) flags[name] = decodeURIComponent(value);
        }
      }
      return flags;
    })
    .catch(() => ({}));
}

/** Record the candidate flags of this test attempt: returns the log line. */
export async function recordPageFlags(
  page: Page,
  testInfo: TestInfo,
  forcedFlags: string[]
): Promise<string> {
  if (page.isClosed()) return '';
  const served = await readServedFlags(page);
  const { codeFlags } = JSON.parse(
    readFileSync(join(process.cwd(), 'docs', 'experiment-flags-baseline.json'), 'utf8')
  ) as { codeFlags: string[] };
  const forcedNames = new Set(forcedFlags.map((f) => f.split('=')[0]));
  const candidates = codeFlags.filter(
    // Only boolean flags: the on-call forces them on / off, which is meaningless for numbers and strings
    (name) => served[name] === 'true' && !forcedNames.has(name)
  );
  const record: PageFlagsRecord = {
    project: testInfo.project.name,
    file: testInfo.file,
    line: testInfo.line,
    title: testInfo.titlePath.slice(1).join(' › '),
    retry: testInfo.retry,
    status: testInfo.status === testInfo.expectedStatus ? 'passed' : 'failed',
    candidates,
    forced: forcedFlags,
  };
  const dir = process.env[PAGE_FLAGS_DIR_ENV];
  if (dir) {
    mkdirSync(dir, { recursive: true });
    const name = `${testInfo.project.name}-${testInfo.testId}-${testInfo.retry}.json`;
    writeFileSync(join(dir, name), JSON.stringify(record, null, 2));
  }
  await testInfo.attach('page-flags', {
    body: JSON.stringify(record, null, 2),
    contentType: 'application/json',
  });
  return `[page flags] ${testInfo.titlePath.join(' › ')}: ${candidates.length} relevant flags on (not forced): ${candidates.join(', ')}`;
}
