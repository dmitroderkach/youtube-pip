import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPendingWork } from './fast-lane-core.mjs';

test('pending work: busy while a voice reply is made, settled after; errors stay with the caller', async () => {
  const work = createPendingWork();
  assert.equal(work.busy(), false);
  let finish;
  const tracked = work.track(() => new Promise((resolve) => (finish = resolve)));
  assert.equal(work.busy(), true, 'the invocation must not count as idle');
  assert.equal(await work.settle(20), false, 'still pending after a short wait');
  finish();
  await tracked;
  assert.equal(work.busy(), false);
  assert.equal(await work.settle(20), true);
  await assert.rejects(
    work.track(async () => {
      throw new Error('tts down');
    }),
    /tts down/
  );
  assert.equal(work.busy(), false, 'a failed reply is no longer pending');
});
