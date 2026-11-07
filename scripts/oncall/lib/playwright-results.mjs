/**
 * On-call (docs/ONCALL.md): summarize a Playwright JSON report into failed / flaky / passed.
 */
import { existsSync, readFileSync } from 'node:fs';

const MAX_ERROR_LENGTH = 600;

function collectTests(suite, titlePath, out) {
  const path = suite.title ? [...titlePath, suite.title] : titlePath;
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const lastError = [...(test.results ?? [])].reverse().find((r) => r.error)?.error;
      out.push({
        project: test.projectName,
        title: [...path, spec.title].join(' › '),
        file: spec.file,
        status: test.status, // expected | unexpected | flaky | skipped
        attempts: (test.results ?? []).length,
        error: (lastError?.message ?? '')
          // eslint-disable-next-line no-control-regex -- strip ANSI colors from Playwright error messages
          .replace(/\u001b\[[0-9;]*m/g, '')
          .slice(0, MAX_ERROR_LENGTH),
      });
    }
  }
  for (const child of suite.suites ?? []) collectTests(child, path, out);
}

/** { found, total, passed, failed: [...], flaky: [...] } of the report at `path` (found: false if missing). */
export function summarizePlaywrightReport(path) {
  if (!path || !existsSync(path))
    return { found: false, total: 0, passed: 0, failed: [], flaky: [] };
  const report = JSON.parse(readFileSync(path, 'utf8'));
  const tests = [];
  for (const suite of report.suites ?? []) collectTests(suite, [], tests);
  return {
    found: true,
    total: tests.length,
    passed: tests.filter((t) => t.status === 'expected').length,
    failed: tests.filter((t) => t.status === 'unexpected'),
    flaky: tests.filter((t) => t.status === 'flaky'),
  };
}
