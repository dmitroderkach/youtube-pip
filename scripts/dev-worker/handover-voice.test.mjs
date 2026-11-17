import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handOverAttachments, handOverMessage } from './fast-lane-core.mjs';

test('handOverMessage: a voice message of the owner is handed over marked spoken; a text one is not', () => {
  const now = new Date('2026-11-17T16:09:00Z');
  const voiced = handOverMessage({ task: 'fix it', context: 'said by voice', spoken: true, now });
  assert.equal(voiced.body.spoken, true);
  assert.equal(voiced.body.handover, true);
  const typed = handOverMessage({ task: 'fix it', now });
  assert.equal('spoken' in typed.body, false);
});

test("handOverAttachments: the turn's photos and files (once each), never voice or audio", () => {
  const photo = { kind: 'photo', file_id: 'p1' };
  const doc = { kind: 'document', file_id: 'd1', file_name: 'log.txt' };
  const files = handOverAttachments([
    { text: 'bug', attachments: [photo, { kind: 'voice', file_id: 'v1' }] },
    { text: 'and this', attachments: [doc, photo, { kind: 'audio', file_id: 'a1' }] },
    { text: 'no files' },
  ]);
  assert.deepEqual(files, [photo, doc]);
  const body = handOverMessage({ task: 'fix the bug', attachments: files }).body;
  assert.deepEqual(body.attachments, [photo, doc]);
  assert.deepEqual(handOverMessage({ task: 'x' }).body.attachments, []);
});
