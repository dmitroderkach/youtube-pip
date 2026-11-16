import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tokenExpiryWarning, TOKEN_WARN_DAYS } from './fast-lane-core.mjs';
import { syncNote, workerAsleepNow } from './session-state.mjs';
import { renderStatus, taskLabel, workerView } from './status.mjs';

test('tokenExpiryWarning: GitHub expiry header within a week, a 401, nothing otherwise', () => {
  const now = Date.parse('2026-11-16T20:00:00Z');
  assert.deepEqual(
    tokenExpiryWarning({ status: 200, expiration: '2026-11-20 10:00:00 UTC', now }),
    {
      reason: 'expiring',
      daysLeft: 3,
      expiresAt: '2026-11-20T10:00:00.000Z',
    }
  );
  assert.equal(
    tokenExpiryWarning({ status: 200, expiration: '2026-11-20 10:00:00 +0100', now }).expiresAt,
    '2026-11-20T09:00:00.000Z'
  );
  assert.equal(
    tokenExpiryWarning({ status: 200, expiration: '2027-01-01 00:00:00 UTC', now }),
    null
  );
  assert.equal(tokenExpiryWarning({ status: 200, expiration: null, now }), null);
  assert.equal(tokenExpiryWarning({ status: 200, expiration: 'garbage', now }), null);
  assert.equal(tokenExpiryWarning({ status: 401, now }).reason, 'expired');
  assert.equal(
    tokenExpiryWarning({ status: 200, expiration: '2026-11-15 00:00:00 UTC', now }).reason,
    'expired'
  );
  assert.equal(TOKEN_WARN_DAYS, 7);
});

test('taskLabel: the task of a busy worker for the pinned status, without the notes, clipped', () => {
  assert.equal(
    taskLabel(
      '[Handed over by the fast lane (x).]\n\nTask: Fix the pinned status card bug for good\n\n[Context: y]'
    ),
    'Fix the pinned status card bug for good'
  );
  assert.equal(taskLabel('Перевір CI\nі ще щось'), 'Перевір CI');
  assert.equal(taskLabel('x'.repeat(60)).length, 40);
  assert.equal(taskLabel('[Worker note: only a note]'), null);
  assert.equal(taskLabel(null), null);
  const busy = workerView(
    { state: 'busy', model: 'opus' },
    {
      progress: {
        worker: 'running',
        turnActive: true,
        updatedAt: '2026-11-16T20:00:00Z',
        purpose: 'Розбери логи Лямбди',
      },
      stored: {},
      now: Date.parse('2026-11-16T20:01:00Z'),
    }
  );
  assert.equal(busy.task, 'Розбери логи Лямбди');
  assert.match(renderStatus({ worker: busy }, { modes: {} }), /працює над «Розбери логи Лямбди»/);
});

test('workerAsleepNow: stopped, or a running / starting record nobody refreshed', () => {
  const now = Date.parse('2026-11-16T20:00:00Z');
  const at = (minutes) => new Date(now - minutes * 60_000).toISOString();
  assert.equal(workerAsleepNow({ worker: 'stopped', updatedAt: at(1) }, now), true);
  assert.equal(workerAsleepNow({ worker: 'running', updatedAt: at(1) }, now), false);
  assert.equal(workerAsleepNow({ worker: 'running', updatedAt: at(60) }, now), true);
  assert.equal(workerAsleepNow({ worker: 'starting', updatedAt: at(1) }, now), false);
  assert.equal(workerAsleepNow({ worker: 'starting', updatedAt: at(30) }, now), true);
  assert.equal(workerAsleepNow(null, now), true);
});

test('syncNote: the fast lane gets the memory index and plan titles once (lazy context)', () => {
  const note = syncNote({
    lane: 'fast-lane',
    delta: { lines: [], total: 0 },
    progress: null,
    context: { memoryIndex: '- [A](a.md) - one', planTitles: ['p1.md', 'p2.md'] },
  });
  assert.match(
    note,
    /Memory index \(MEMORY\.md, read a file with memory_read\):\n- \[A\]\(a\.md\) - one/
  );
  assert.match(note, /Saved plans \(read one with plan_read\): p1\.md; p2\.md/);
  assert.doesNotMatch(
    syncNote({ lane: 'fast-lane', delta: { lines: [], total: 0 }, progress: null }),
    /Memory index/
  );
});
