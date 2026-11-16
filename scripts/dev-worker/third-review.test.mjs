import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claimMarker, tokenWarningKey } from './fast-lane-core.mjs';
import {
  STARTING_STALE_MS,
  STOPPING_STALE_MS,
  workerAsleepFromRead,
  workerAsleepNow,
  workerLiveness,
  workerReachable,
} from './session-state.mjs';
import { renderStatus, workerView } from './status.mjs';

const NOW = Date.parse('2026-11-16T22:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();

test('a stopping worker is not asleep: its final save (s3 sync --delete) is still to come', () => {
  const stopping = { worker: 'stopping', updatedAt: ago(30_000) };
  assert.equal(workerLiveness(stopping, NOW), 'stopping');
  assert.equal(workerAsleepNow(stopping, NOW), false);
  assert.equal(workerReachable(stopping, NOW), false);
  // A stop that died before writing `stopped`: stale, so asleep
  const dead = { worker: 'stopping', updatedAt: ago(STOPPING_STALE_MS + 1000) };
  assert.equal(workerLiveness(dead, NOW), 'stale');
  assert.equal(workerAsleepNow(dead, NOW), true);
  assert.equal(workerAsleepNow({ worker: 'stopped', updatedAt: ago(1000) }, NOW), true);
});

test('a starting worker is not asleep for its whole stale bound (heartbeat from the first step)', () => {
  assert.equal(STARTING_STALE_MS, 15 * 60 * 1000);
  const slowRestore = { worker: 'starting', updatedAt: ago(10 * 60 * 1000) };
  assert.equal(workerLiveness(slowRestore, NOW), 'starting');
  assert.equal(workerAsleepNow(slowRestore, NOW), false);
  const failed = { worker: 'starting', updatedAt: ago(STARTING_STALE_MS + 1000) };
  assert.equal(workerAsleepNow(failed, NOW), true);
});

test('workerAsleepFromRead: a missing record is asleep, a failed read is not', async () => {
  assert.equal(await workerAsleepFromRead(async () => null, NOW), true);
  assert.equal(
    await workerAsleepFromRead(async () => ({ worker: 'running', updatedAt: ago(1000) }), NOW),
    false
  );
  assert.equal(
    await workerAsleepFromRead(async () => {
      throw Object.assign(new Error('Access Denied'), { name: 'AccessDenied' });
    }, NOW),
    false
  );
});

test('the pinned status shows a stopping worker as falling asleep', () => {
  const worker = workerView(
    { state: 'busy', model: 'opus' },
    { progress: { worker: 'stopping', updatedAt: ago(10_000) }, stored: {}, now: NOW }
  );
  assert.equal(worker.state, 'stopping');
  const text = renderStatus({ worker }, { modes: {} });
  assert.match(text.split('\n')[0], /^😴/);
});

test('claimMarker: only the call that creates the day marker may send the token warning', async () => {
  const objects = new Map();
  const putObject = async (key, body, { ifNoneMatch } = {}) => {
    if (ifNoneMatch === '*' && objects.has(key))
      throw Object.assign(
        new Error('At least one of the pre-conditions you specified did not hold'),
        {
          name: 'PreconditionFailed',
          $metadata: { httpStatusCode: 412 },
        }
      );
    objects.set(key, body);
  };
  const key = tokenWarningKey('2026-11-16', 'expiring');
  assert.equal(key, 'fast-lane/token-warning-2026-11-16-expiring.json');
  const results = await Promise.all([
    claimMarker(putObject, key, '{}'),
    claimMarker(putObject, key, '{}'),
  ]);
  assert.deepEqual(results.sort(), [false, true]);
  assert.equal(await claimMarker(putObject, tokenWarningKey('2026-11-17', 'expiring'), '{}'), true);
  await assert.rejects(
    claimMarker(
      async () => {
        throw Object.assign(new Error('boom'), { $metadata: { httpStatusCode: 500 } });
      },
      key,
      '{}'
    ),
    /boom/
  );
});
