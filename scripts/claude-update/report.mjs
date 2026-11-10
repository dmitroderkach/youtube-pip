/** Claude Code update: the outcome in the owner's Telegram chat (green with the PR, or what failed). */
const e = process.env;
const ok = (outcome) => (outcome === 'success' ? '✅' : outcome === 'skipped' ? '⏭' : '🔴');
const checks = [
  `${ok(e.UNIT)} юніт-тести воркера`,
  `${ok(e.SMOKE)} контракт SDK (живий Claude)`,
  `${ok(e.WORKER)} воркер end to end`,
  `${ok(e.CLI_SMOKE)} CLI онколу`,
];
const green = [e.UNIT, e.SMOKE, e.WORKER, e.CLI_SMOKE].every((o) => o === 'success');
// A forced run on the versions already pinned: a check of the integrations, no PR to open
const unchanged = e.CLI === e.FROM_CLI && e.SDK === e.FROM_SDK;
const head = unchanged
  ? green
    ? `🔁 Перевірочний прогін: версія не змінилась (Claude Code ${e.CLI}, SDK ${e.SDK}), тести зелені, PR не потрібен.`
    : `🔴 Перевірочний прогін на поточній версії (Claude Code ${e.CLI}, SDK ${e.SDK}): наші інтеграції ламаються. Можна віддати воркеру: «розбери прогін».`
  : green
    ? e.PR_URL
      ? `🆕 Claude Code ${e.CLI} (SDK ${e.SDK}): тести зелені, PR готовий — після мерджу прийде кнопка публікації образу воркера.\n${e.PR_URL}`
      : `🆕 Claude Code ${e.CLI} (SDK ${e.SDK}): тести зелені, але PR не вдалося відкрити (${e.PR_OUTCOME}).`
    : `🔴 Claude Code ${e.CLI} (SDK ${e.SDK}) ламає наші інтеграції: лишаємось на ${e.FROM_CLI} / ${e.FROM_SDK}. Можна віддати воркеру: «розбери прогін».`;
const text = `${head}\n\n${checks.join('\n')}\n${e.RUN_URL}`;
const res = await fetch(`https://api.telegram.org/bot${e.TELEGRAM_BOT_TOKEN}/sendMessage`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chat_id: e.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
});
if (!res.ok) console.error(`Telegram: ${res.status} ${await res.text()}`);
console.log(text);
