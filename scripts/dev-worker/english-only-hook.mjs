/**
 * Dev worker (docs/DEV_WORKER.md): Claude Code PreToolUse hook (Bash). Text that goes to GitHub or into git history
 * must be in English (CLAUDE.md, "Language"). The owner writes in Ukrainian, and the model tends to copy earlier
 * Ukrainian PR texts from the session despite the system prompt; this blocks such a command (exit code 2: the
 * message goes back to the model, which rewrites the text in English).
 *
 * Checked: `gh pr|issue|release|api …` and `git commit|tag …` commands, including files passed with --body-file,
 * --notes-file, -F / --file.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const CYRILLIC = /[Ѐ-ӿ]/;
const GITHUB_OR_HISTORY = /\b(gh\s+(pr|issue|release|api)|git\s+(commit|tag))\b/;
const FILE_ARGS = /(?:--body-file|--notes-file|--file|-F)[=\s]+("[^"]+"|'[^']+'|\S+)/g;

let input = '';
process.stdin.on('data', (data) => (input += data));
process.stdin.on('end', () => {
  let event;
  try {
    event = JSON.parse(input);
  } catch {
    process.exit(0);
  }
  const command = event?.tool_input?.command;
  if (
    event?.tool_name !== 'Bash' ||
    typeof command !== 'string' ||
    !GITHUB_OR_HISTORY.test(command)
  ) {
    process.exit(0);
  }
  let text = command;
  const cwd = event.cwd ?? resolve(homedir(), 'youtube-pip');
  for (const match of command.matchAll(FILE_ARGS)) {
    const path = match[1].replace(/^["']|["']$/g, '').replace(/^~(?=\/)/, homedir());
    try {
      text += `\n${readFileSync(resolve(cwd, path), 'utf8')}`;
    } catch {
      // not a file (e.g. `gh api -F key=value`): the value is in the command text already
    }
  }
  if (CYRILLIC.test(text)) {
    console.error(
      'Blocked: text sent to GitHub or into git history must be in English (CLAUDE.md, "Language"). ' +
        'Rewrite the title / body / comment / commit message in English and run the command again. ' +
        'Only your chat answers to the owner are in Ukrainian.'
    );
    process.exit(2);
  }
  process.exit(0);
});
