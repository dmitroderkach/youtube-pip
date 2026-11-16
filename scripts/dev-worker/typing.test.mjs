import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTypingKeeper, TYPING_INTERVAL_MS } from './fast-lane-core.mjs';

/** Fake interval timers: tick() runs every active interval once. */
function fakeTimers() {
  const timers = new Set();
  return {
    setTimer: (fn) => {
      const timer = { fn };
      timers.add(timer);
      return timer;
    },
    clearTimer: (timer) => timers.delete(timer),
    tick: () => [...timers].forEach((timer) => timer.fn()),
    count: () => timers.size,
  };
}

test('typing: sent at once and on every interval until stopped; one timer for several messages', () => {
  const timers = fakeTimers();
  let sent = 0;
  const typing = createTypingKeeper({ send: () => sent++, ...timers });
  typing.start();
  typing.start(); // a second queued message: same timer
  assert.equal(sent, 1);
  assert.equal(timers.count(), 1);
  timers.tick();
  timers.tick();
  assert.equal(sent, 3);
  typing.stop();
  assert.equal(timers.count(), 0, 'no timer left to hold the invocation');
  timers.tick();
  assert.equal(sent, 3);
  typing.stop(); // idempotent
  assert.equal(typing.running(), false);
});

test('typing: paused while a question waits for the owner, resumed after', () => {
  const timers = fakeTimers();
  let sent = 0;
  let waiting = false;
  const typing = createTypingKeeper({ send: () => sent++, active: () => !waiting, ...timers });
  typing.start();
  waiting = true;
  timers.tick();
  timers.tick();
  assert.equal(sent, 1);
  waiting = false;
  timers.tick();
  assert.equal(sent, 2);
  typing.stop();
});

test('typing: refreshed within the ~5 s Telegram keeps a chat action', () => {
  assert.ok(TYPING_INTERVAL_MS < 5000);
});
