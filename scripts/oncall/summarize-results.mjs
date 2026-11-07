/**
 * On-call (docs/ONCALL.md): summarize a Playwright JSON report into failed / flaky / passed.
 * Usage: node scripts/oncall/summarize-results.mjs <results.json> <out.json>
 * Writes { found, total, passed, failed: [...], flaky: [...] } and prints a one-line summary.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const [inputPath, outputPath] = process.argv.slice(2);
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

let summary = { found: false, total: 0, passed: 0, failed: [], flaky: [] };
if (inputPath && existsSync(inputPath)) {
  const report = JSON.parse(readFileSync(inputPath, 'utf8'));
  const tests = [];
  for (const suite of report.suites ?? []) collectTests(suite, [], tests);
  summary = {
    found: true,
    total: tests.length,
    passed: tests.filter((t) => t.status === 'expected').length,
    failed: tests.filter((t) => t.status === 'unexpected'),
    flaky: tests.filter((t) => t.status === 'flaky'),
  };
}
writeFileSync(outputPath, JSON.stringify(summary, null, 2));
console.log(
  summary.found
    ? `results: ${summary.total} tests, ${summary.passed} passed, ${summary.failed.length} failed, ${summary.flaky.length} flaky`
    : 'results: no Playwright JSON report found'
);
