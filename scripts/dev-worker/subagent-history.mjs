#!/usr/bin/env node
/**
 * A subagent's conversation for the worker's /agents view, read with Claude's rights (worker.mjs runs it as
 * CLAUDE_USER: Claude Code writes subagent transcripts with mode 0600, which the worker's own user cannot read).
 * Usage: node subagent-history.mjs <session id> <agent id> <project dir>; prints the messages as JSON
 * ([{ type, content }]) on stdout.
 */
import { getSubagentMessages } from '@anthropic-ai/claude-agent-sdk';

const [sessionId, agentId, dir] = process.argv.slice(2);
const messages = await getSubagentMessages(sessionId ?? '', agentId ?? '', { dir });
process.stdout.write(
  JSON.stringify(messages.map((m) => ({ type: m.type, content: m.message?.content ?? null })))
);
