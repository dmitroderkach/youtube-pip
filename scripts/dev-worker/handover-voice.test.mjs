import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handOverMessage } from './fast-lane-core.mjs';

test('handOverMessage: a voice message of the owner is handed over marked spoken; a text one is not', () => {
  const now = new Date('2026-11-17T16:09:00Z');
  const voiced = handOverMessage({ task: 'fix it', context: 'said by voice', spoken: true, now });
  assert.equal(voiced.body.spoken, true);
  assert.equal(voiced.body.handover, true);
  const typed = handOverMessage({ task: 'fix it', now });
  assert.equal('spoken' in typed.body, false);
});
