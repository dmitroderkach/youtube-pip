/** Unit tests of session-state.mjs: `node --test scripts/dev-worker/*.test.mjs`. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  backgroundRecord,
  epochProject,
  latestEpochKey,
  restoreNote,
  preservedUuids,
  transcriptEpoch,
} from './session-state.mjs';

const line = (entry) => JSON.stringify(entry);

test('transcript epoch: from the last compaction boundary, named by its time and uuid', () => {
  const lines = [
    line({ type: 'user', uuid: 'u1', timestamp: '2026-11-08T10:00:00.000Z' }),
    line({
      type: 'system',
      subtype: 'compact_boundary',
      uuid: 'b1aaaaaaaa',
      timestamp: '2026-11-08T12:00:00.000Z',
    }),
    line({ type: 'user', uuid: 'u2', timestamp: '2026-11-08T12:00:01.000Z' }),
    line({
      type: 'system',
      subtype: 'compact_boundary',
      uuid: 'b2bbbbbbbb',
      timestamp: '2026-11-09T01:02:03.456Z',
    }),
    line({ type: 'user', isCompactSummary: true, uuid: 'u3' }),
    // The mark inside a message is not a boundary
    line({ type: 'user', uuid: 'u4', message: { content: 'grep "compact_boundary" file' } }),
  ];
  const text = `${lines.join('\n')}\n`;
  const epoch = transcriptEpoch(text);
  assert.ok(text.slice(epoch.start).startsWith(lines[3]));
  assert.equal(epoch.name, '2026-11-09T01-02-03-456Z-b2bbbbbb.jsonl');
});

test('transcript epoch: no compaction yet → whole file, named after its first line', () => {
  const text = `${line({ type: 'summary' })}\n${line({ type: 'user', timestamp: '2026-11-07T08:00:00.000Z' })}\n`;
  assert.deepEqual(transcriptEpoch(text), {
    start: 0,
    name: '2026-11-07T08-00-00-000Z-start.jsonl',
  });
  assert.equal(transcriptEpoch('').name, '0000-00-00T00-00-00-000Z-start.jsonl');
});

test('latest epoch key of a session; project of a key', () => {
  const keys = [
    'claude/transcripts/-home-p/s1/2026-11-07T08-00-00-000Z-start.jsonl',
    'claude/transcripts/-home-p/s1/2026-11-09T01-02-03-456Z-b2bbbbbb.jsonl',
    'claude/transcripts/-home-p/s1/2026-11-08T12-00-00-000Z-b1aaaaaa.jsonl',
    'claude/transcripts/-home-p/s2/2026-12-01T00-00-00-000Z-start.jsonl',
    'claude/transcripts/-home-p/s1/notes.txt',
  ];
  assert.equal(latestEpochKey(keys, 's1'), keys[1]);
  assert.equal(latestEpochKey(keys, 'nope'), null);
  assert.equal(epochProject(keys[1]), '-home-p');
});

test('background record: command or prompt from the tool call, the purpose clipped', () => {
  const now = new Date('2026-11-09T15:00:00Z');
  const shell = backgroundRecord(
    { task_id: 't1', task_type: 'local_bash', description: 'Watch CI' },
    {
      call: { name: 'Bash', input: { command: 'gh run watch 1', description: 'Watch CI' } },
      purpose: 'x'.repeat(1200),
      sessionId: 's1',
      now,
    }
  );
  assert.equal(shell.command, 'gh run watch 1');
  assert.equal(shell.tool, 'Bash');
  assert.equal(shell.purpose.length, 1000);
  assert.equal(shell.startedAt, '2026-11-09T15:00:00.000Z');
  const agent = backgroundRecord(
    {
      task_id: 'a1',
      task_type: 'local_agent',
      description: 'Review',
      subagent_type: 'general-purpose',
    },
    { start: { prompt: 'Review the worker' }, now }
  );
  assert.equal(agent.prompt, 'Review the worker');
  assert.equal(agent.command, null);
  assert.equal(agent.subagentType, 'general-purpose');
});

test('restore note: shells run again, subagents resumed by id with the prompt as fallback', () => {
  const note = restoreNote([
    {
      taskId: 't1',
      taskType: 'local_bash',
      tool: 'Bash',
      description: 'Watch CI',
      command: 'gh run watch 1',
      purpose: 'fix it',
    },
    {
      taskId: 'a1',
      taskType: 'local_agent',
      description: 'Review',
      prompt: 'Review the worker',
      subagentType: 'general-purpose',
    },
  ]);
  assert.match(
    note,
    /1\. Bash task "Watch CI"\. It was started for the owner's message: «fix it»\. .*`gh run watch 1`/
  );
  assert.match(
    note,
    /2\. Subagent \(general-purpose\) "Review", task id a1\. Resume it with SendMessage to "a1"/
  );
  assert.match(note, /«Review the worker»/);
});

test('transcript epoch: starts at the messages the compaction preserved before its boundary', () => {
  const lines = [
    line({ type: 'user', uuid: 'old' }),
    line({ type: 'user', uuid: 'head', parentUuid: 'old' }),
    line({ type: 'assistant', uuid: 'tail', parentUuid: 'head' }),
    line({
      type: 'system',
      subtype: 'compact_boundary',
      uuid: 'b3cccccccc',
      parentUuid: null,
      timestamp: '2026-11-09T02:33:44.050Z',
      compactMetadata: {
        preservedSegment: { headUuid: 'head', anchorUuid: 'sum', tailUuid: 'tail' },
      },
    }),
    line({ type: 'user', uuid: 'sum', isCompactSummary: true }),
  ];
  const text = lines.join('\n');
  const epoch = transcriptEpoch(text);
  assert.ok(text.slice(epoch.start).startsWith(lines[1]));
  assert.equal(epoch.name, '2026-11-09T02-33-44-050Z-b3cccccc.jsonl');
});

test('transcript epoch: preservedMessages.uuids first (as Claude Code loads them), with lines of the same message', () => {
  const lines = [
    line({ type: 'user', uuid: 'old' }),
    // The answer's thinking: same API message as the preserved text line
    line({ type: 'assistant', uuid: 'think', parentUuid: 'old', message: { id: 'msg_1' } }),
    line({ type: 'assistant', uuid: 'answer', parentUuid: 'think', message: { id: 'msg_1' } }),
    line({ type: 'user', uuid: 'next', parentUuid: 'answer' }),
    line({
      type: 'system',
      subtype: 'compact_boundary',
      uuid: 'b4dddddddd',
      parentUuid: null,
      timestamp: '2026-11-09T03:00:00.000Z',
      compactMetadata: {
        // A segment that disagrees: the list wins, like in Claude Code's loader
        preservedSegment: { headUuid: 'next', anchorUuid: 'sum', tailUuid: 'next' },
        preservedMessages: {
          anchorUuid: 'sum',
          uuids: ['answer', 'next'],
          allUuids: ['answer', 'next'],
        },
      },
    }),
    line({ type: 'user', uuid: 'sum', isCompactSummary: true }),
  ];
  const text = lines.join('\n');
  assert.ok(text.slice(transcriptEpoch(text).start).startsWith(lines[1]));
  assert.deepEqual(
    preservedUuids({
      preservedSegment: { headUuid: 'h', tailUuid: 't' },
      preservedMessages: { uuids: ['a', 'b'] },
    }),
    ['a', 'b']
  );
  assert.deepEqual(preservedUuids({ preservedSegment: { headUuid: 'h', tailUuid: 't' } }), [
    'h',
    't',
  ]);
  assert.deepEqual(preservedUuids({ preservedMessages: ['x'] }), ['x']);
});
