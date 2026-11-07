/**
 * On-call (docs/ONCALL.md): summarize the e2e run's Playwright JSON report into failed / flaky / passed.
 * Usage: node scripts/oncall/summarize-results.mjs <results.json> <out.json>
 */
import { writeFileSync } from 'node:fs';
import { summarizePlaywrightReport } from './lib/playwright-results.mjs';

const [inputPath, outputPath] = process.argv.slice(2);
const summary = summarizePlaywrightReport(inputPath);
writeFileSync(outputPath, JSON.stringify(summary, null, 2));
console.log(
  summary.found
    ? `results: ${summary.total} tests, ${summary.passed} passed, ${summary.failed.length} failed, ${summary.flaky.length} flaky`
    : 'results: no Playwright JSON report found'
);
