/** Unit tests of session-state.mjs: `node --test scripts/dev-worker/*.test.mjs`. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  backgroundRecord,
  epochProject,
  latestEpochKey,
  restoreNote,
  transcriptEpoch,
} from './session-state.mjs';

const line = (entry) => JSON.stringify(entry);

const boundary = (uuid, timestamp, compactMetadata) =>
  line({
    type: 'system',
    subtype: 'compact_boundary',
    uuid,
    parentUuid: null,
    timestamp,
    compactMetadata,
  });
const rows = (text) =>
  text
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));

test('transcript epoch: the last boundary on, named by its time and uuid; a mark inside a message is no boundary', () => {
  const text =
    [
      line({ type: 'user', uuid: 'u1', timestamp: '2026-11-08T10:00:00.000Z' }),
      boundary('b1aaaaaaaa', '2026-11-08T12:00:00.000Z'),
      line({ type: 'user', uuid: 'u2', parentUuid: null }),
      boundary('b2bbbbbbbb', '2026-11-09T01:02:03.456Z'),
      line({ type: 'user', isCompactSummary: true, uuid: 'u3', parentUuid: 'b2bbbbbbbb' }),
      line({
        type: 'user',
        uuid: 'u4',
        parentUuid: 'u3',
        message: { content: 'grep "compact_boundary" f' },
      }),
    ].join('\n') + '\n';
  const epoch = transcriptEpoch(text);
  assert.equal(epoch.kind, 'plan');
  assert.deepEqual(
    rows(epoch.text).map((r) => r.uuid),
    ['b2bbbbbbbb', 'u3', 'u4']
  );
  assert.equal(epoch.name, '2026-11-09T01-02-03-456Z-b2bbbbbb.jsonl');
});

test('transcript epoch: no compaction yet → whole file, named after its first row', () => {
  const text = `${line({ type: 'summary' })}\n${line({ type: 'user', timestamp: '2026-11-07T08:00:00.000Z' })}\n`;
  assert.deepEqual(transcriptEpoch(text), {
    text,
    name: '2026-11-07T08-00-00-000Z-start.jsonl',
    kind: 'skip',
  });
  assert.equal(transcriptEpoch('').name, '0000-00-00T00-00-00-000Z-start.jsonl');
});

test('transcript epoch: rows above the boundary kept like Claude Code 2.1.319 compacts the file', () => {
  const s = 'sess';
  const text =
    [
      line({ type: 'user', uuid: 'old', parentUuid: null }),
      line({ type: 'custom-title', sessionId: s, customTitle: 'first' }),
      line({ type: 'custom-title', sessionId: s, customTitle: 'second' }),
      line({ type: 'pr-link', sessionId: s, prNumber: 1 }),
      line({ type: 'content-replacement', sessionId: s, n: 1 }),
      line({ type: 'some-new-type', sessionId: s }),
      line({ type: 'progress', sessionId: s }),
      line({ type: 'cost-state', sessionId: s, broken: true }),
      line({ type: 'assistant', uuid: 'think', parentUuid: 'old', message: { id: 'm1' } }),
      line({ type: 'assistant', uuid: 'answer', parentUuid: 'think', message: { id: 'm1' } }),
      line({ type: 'file-history-snapshot', messageId: 'answer' }),
      line({ type: 'queue-operation', sessionId: s, operation: 'enqueue' }),
      line({ type: 'user', uuid: 'next', parentUuid: 'answer' }),
      boundary('bbbbbbbbbb', '2026-11-09T03:00:00.000Z', {
        // The list wins over the segment, like in Claude Code's loader
        preservedSegment: { headUuid: 'next', tailUuid: 'next' },
        preservedMessages: {
          anchorUuid: 'sum',
          uuids: ['answer', 'next'],
          allUuids: ['answer', 'next'],
        },
      }),
      line({ type: 'user', uuid: 'sum', parentUuid: 'bbbbbbbbbb', isCompactSummary: true }),
      line({ type: 'pr-link', sessionId: s, prNumber: 2 }),
      // A row after the boundary keeps its parent from above it
      line({ type: 'user', uuid: 'late', parentUuid: 'old' }),
    ].join('\n') + '\n';
  const out = rows(transcriptEpoch(text).text).map(
    (r) =>
      r.uuid ??
      `${r.type}${r.customTitle ? `:${r.customTitle}` : ''}${r.prNumber ? `:${r.prNumber}` : ''}`
  );
  assert.deepEqual(out, [
    'old', // parent of "late"
    'content-replacement', // accumulate
    'some-new-type', // unknown types accumulate
    'cost-state', // fails the cost-state schema: kept
    'answer', // preserved
    'file-history-snapshot', // of a preserved message
    'next', // preserved
    'bbbbbbbbbb',
    // last-wins rows from above, the newest of each, right after the boundary
    'custom-title:second',
    'queue-operation',
    'sum',
    'pr-link:2', // the newer pr-link stays in place; the older one above is dropped
    'late',
  ]);
});

test('transcript epoch: kept whole when Claude Code would not compact it', () => {
  const text =
    [
      line({ type: 'user', uuid: 'a', parentUuid: null }),
      boundary('cccccccccc', '2026-11-09T04:00:00.000Z', {
        preservedMessages: { uuids: ['missing'] },
      }),
    ].join('\n') + '\n';
  assert.deepEqual(
    (({ text: t, kind, reason }) => ({ same: t === text, kind, reason }))(transcriptEpoch(text)),
    { same: true, kind: 'abort', reason: 'preserved_uuid_missing' }
  );
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

test('transcript epoch: a line still being written is left for the next save', () => {
  const done = line({ type: 'user', uuid: 'a', timestamp: '2026-11-09T05:00:00.000Z' });
  const epoch = transcriptEpoch(`${done}\n{"type":"assistant","uu`);
  assert.equal(epoch.text, `${done}\n`);
});

test('transcript epoch: the resume check keeps the whole file when a kept message lost its parent', () => {
  // A message below the boundary whose parent is in no row at all: Claude Code compacts, the check refuses
  const text =
    [
      line({ type: 'user', uuid: 'a', parentUuid: null }),
      boundary('dddddddddd', '2026-11-09T06:00:00.000Z'),
      line({ type: 'user', uuid: 'sum', parentUuid: 'dddddddddd', isCompactSummary: true }),
      line({ type: 'user', uuid: 'b', parentUuid: 'nowhere' }),
    ].join('\n') + '\n';
  const epoch = transcriptEpoch(text);
  assert.deepEqual(
    [epoch.text === text, epoch.kind, epoch.reason],
    [true, 'abort', 'check_parent_missing']
  );
});
