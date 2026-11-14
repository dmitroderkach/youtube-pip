/**
 * On-call (docs/ONCALL.md, "Agent isolation"): remove the runner's secret values from files the agent produced before
 * they leave the runner (the report goes to Telegram and the public `oncall` artifact, the transcript to the private
 * state bucket). The agent cannot reach the Telegram secrets and is denied /proc, but its own process holds the Claude
 * token: a value that slipped into its output anyway is replaced here.
 * Usage: node scripts/oncall/scrub-secrets.mjs <file>…  (missing files are skipped)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/** Secret values from the environment: the known names and anything else that looks like a credential. */
export function secretValues(environment) {
  const named = ['CLAUDE_CODE_OAUTH_TOKEN', 'TELEGRAM_BOT_TOKEN'];
  const values = new Set();
  for (const [name, value] of Object.entries(environment)) {
    if (!value) continue;
    if (
      named.includes(name) ||
      (/TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY/i.test(name) && value.length >= 16)
    ) {
      values.add(value);
      // The bot token's secret part alone (after "<bot id>:") is a credential too
      if (name === 'TELEGRAM_BOT_TOKEN' && value.includes(':'))
        values.add(value.slice(value.indexOf(':') + 1));
    }
  }
  // Longest first, so a value inside another one never leaves a part of the longer behind
  return [...values].filter((value) => value.length >= 16).sort((a, b) => b.length - a.length);
}

/** The text with every secret value (also JSON-escaped) replaced; [text, count]. */
export function scrub(text, values) {
  let count = 0;
  for (const value of values) {
    for (const form of new Set([value, JSON.stringify(value).slice(1, -1)])) {
      const parts = text.split(form);
      count += parts.length - 1;
      text = parts.join('[redacted]');
    }
  }
  return [text, count];
}

if (process.argv[1]?.endsWith('scrub-secrets.mjs')) {
  const values = secretValues(process.env);
  for (const file of process.argv.slice(2)) {
    if (!existsSync(file)) continue;
    const [text, count] = scrub(readFileSync(file, 'utf8'), values);
    if (count) {
      writeFileSync(file, text);
      console.log(`scrub-secrets: ${count} secret value(s) removed from ${file}`);
    }
  }
}
