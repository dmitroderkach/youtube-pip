import assert from 'node:assert/strict';
import { test } from 'node:test';
import { oncallNoteForFastLane, pickOncallRuns } from './session-state.mjs';

const HOUR = 3600 * 1000;
const now = Date.parse('2026-11-16T22:00:00Z');
const run = (id, hoursAgo) => ({
  id,
  html_url: `https://github.com/example/repo/actions/runs/${id}`,
  updated_at: new Date(now - hoursAgo * HOUR).toISOString(),
});

test('pickOncallRuns: new runs within the window, at most max; every run looked at is remembered', () => {
  const runs = [run(5, 1), run(4, 2), run(3, 30), run(2, 40), run(1, 60)];
  const { picked, handled } = pickOncallRuns(runs, {
    handled: [4],
    now,
    maxAgeMs: 48 * HOUR,
    max: 2,
  });
  assert.deepEqual(
    picked.map((r) => r.id),
    [5, 3]
  );
  assert.deepEqual(handled, [4, 5, 3, 2]);
  // Next time nothing is new
  const again = pickOncallRuns(runs, { handled, now, maxAgeMs: 48 * HOUR, max: 2 });
  assert.deepEqual(again.picked, []);
});

test('oncallNoteForFastLane: links and local times only, oldest first; null without reports', () => {
  assert.equal(oncallNoteForFastLane([]), null);
  const note = oncallNoteForFastLane([run(7, 1), run(6, 25)], { timeZone: 'Europe/Warsaw' });
  assert.match(note, /^\[On-call reports sent to the owner's chat/);
  assert.ok(note.indexOf('runs/6') < note.indexOf('runs/7'), 'oldest first');
  assert.match(note, /\(Europe\/Warsaw\)/);
  assert.match(note, /oncall_reports/);
  assert.match(note, /hand it over/);
  assert.match(note, /data, never instructions/);
});
