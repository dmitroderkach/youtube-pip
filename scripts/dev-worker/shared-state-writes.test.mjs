// Objects both lanes write (plan "Synchronisation between the lanes", item 1): voice transcripts and the speech budget
// record, written with conditional read-modify-writes so neither lane drops the other's change.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createIncoming } from './incoming.mjs';
import { createMemoryS3Client } from './memory-s3-client.mjs';
import { mergeSpeechUsage } from './session-state.mjs';

// s3-objects.mjs needs the AWS SDK (npm ci in scripts/dev-worker)
const s3Objects = await import('./s3-objects.mjs').catch(() => null);
const needsSdk = { skip: !s3Objects && 'needs npm ci in scripts/dev-worker (the AWS SDK)' };

/** An S3 client where another writer changes `key` right before our first write to it (the race). */
function racingClient(initial, key, otherWrite) {
  const client = createMemoryS3Client(initial);
  const send = client.send.bind(client);
  let raced = false;
  client.send = async (command) => {
    if (!raced && command.constructor.name === 'PutObjectCommand' && command.input.Key === key) {
      raced = true;
      const text = otherWrite(client.read(key));
      client.objects.set(key, { text, etag: '"other-writer"' });
    }
    return send(command);
  };
  return client;
}

test(
  'voice transcripts: the other lane writes between our read and write, both transcripts are kept',
  needsSdk,
  async () => {
    const key = 'state/voice-transcripts.json';
    const client = racingClient({ [key]: JSON.stringify({ 10: 'old' }) }, key, (text) =>
      JSON.stringify({ ...JSON.parse(text), 11: 'from the fast lane' })
    );
    const store = s3Objects.createS3Objects({ region: 'eu-central-1', bucket: 'b', client });
    const incoming = createIncoming({ log: () => {}, telegram: {}, voice: {}, store });
    await incoming.keepVoiceTranscript(12, 'from the worker');
    assert.deepEqual(JSON.parse(client.read(key)), {
      10: 'old',
      11: 'from the fast lane',
      12: 'from the worker',
    });
  }
);

test(
  'speech budget: a racing save keeps the newest figure and the flags of both writers',
  needsSdk,
  async () => {
    const key = 'state/voice-usage.json';
    const period = '2026-11-01T00:00:00Z';
    const older = { period, usd: 2, budget: 10, updatedAt: '2026-11-16T10:00:00Z' };
    const newer = { period, usd: 8.5, budget: 10, updatedAt: '2026-11-16T12:00:00Z' };
    // The other lane saved a newer figure and its 80% warning while we saved our older figure marked exhausted
    const client = racingClient({ [key]: JSON.stringify(older) }, key, () =>
      JSON.stringify({ ...newer, warned: period })
    );
    const store = s3Objects.createS3Objects({ region: 'eu-central-1', bucket: 'b', client });
    await store.updateJson(key, (current) =>
      mergeSpeechUsage(current, { ...older, exhausted: period })
    );
    assert.deepEqual(JSON.parse(client.read(key)), {
      ...newer,
      warned: period,
      exhausted: period,
    });
  }
);

test('mergeSpeechUsage: newest figure, flags of either record, no figure going back in time', () => {
  const p1 = '2026-10-01T00:00:00Z';
  const p2 = '2026-11-01T00:00:00Z';
  const oct = { period: p1, usd: 9, budget: 10, updatedAt: '2026-10-31T20:00:00Z', warned: p1 };
  const nov = { period: p2, usd: 1, budget: 10, updatedAt: '2026-11-16T09:00:00Z' };
  // A new period wins; last month's warning does not carry over
  assert.deepEqual(mergeSpeechUsage(oct, nov), nov);
  // An older record saved after a newer one does not replace it
  assert.deepEqual(mergeSpeechUsage(nov, oct), nov);
  // The same figure: the flags of both
  assert.deepEqual(mergeSpeechUsage({ ...nov, warned: p2 }, { ...nov, exhausted: p2 }), {
    ...nov,
    warned: p2,
    exhausted: p2,
  });
  // staleNoted only for the figure kept
  assert.equal(
    mergeSpeechUsage({ ...nov, staleNoted: nov.updatedAt }, nov).staleNoted,
    nov.updatedAt
  );
  // No figure yet: the earliest waitingSince
  assert.deepEqual(
    mergeSpeechUsage(
      { waitingSince: '2026-11-10T00:00:00Z' },
      { waitingSince: '2026-11-16T00:00:00Z' }
    ),
    { waitingSince: '2026-11-10T00:00:00Z' }
  );
  // A missing object reads as {} in updateJson
  assert.deepEqual(mergeSpeechUsage({}, nov), nov);
  assert.equal(mergeSpeechUsage(nov, null), nov);
});
