// Tests of the in-memory S3 client (the fast lane smoke test's state bucket) through s3-objects.mjs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryS3Client } from './memory-s3-client.mjs';

// s3-objects.mjs needs the AWS SDK (npm ci in scripts/dev-worker, as the weekly update job runs it)
const s3Objects = await import('./s3-objects.mjs').catch(() => null);
const needsSdk = { skip: !s3Objects && 'needs npm ci in scripts/dev-worker (the AWS SDK)' };
const createS3Objects = (options) => s3Objects.createS3Objects(options);

test('memory S3 client: get / put / list / delete through s3-objects', needsSdk, async () => {
  const client = createMemoryS3Client({ 'state/a.json': '{"x":1}' });
  const objects = createS3Objects({ region: 'eu-central-1', bucket: 'b', client });
  assert.deepEqual(await objects.getJson('state/a.json'), { x: 1 });
  assert.equal(await objects.get('state/missing'), null);
  await objects.put('state/b.txt', 'hello');
  assert.deepEqual(await objects.list('state/'), ['state/a.json', 'state/b.txt']);
  await objects.delete('state/b.txt');
  assert.equal(client.read('state/b.txt'), null);
});

test(
  'memory S3 client: conditional writes refuse a stale ETag; updateObject retries',
  needsSdk,
  async () => {
    const client = createMemoryS3Client({ 'log.jsonl': 'one\n' });
    const objects = createS3Objects({ region: 'eu-central-1', bucket: 'b', client });
    const first = await objects.getObject('log.jsonl');
    await objects.putObject('log.jsonl', 'one\ntwo\n', { ifMatch: first.etag });
    await assert.rejects(
      objects.putObject('log.jsonl', 'lost\n', { ifMatch: first.etag }),
      (error) => error.$metadata.httpStatusCode === 412
    );
    await assert.rejects(
      objects.putObject('log.jsonl', 'x', { ifNoneMatch: '*' }),
      (error) => error.$metadata.httpStatusCode === 412
    );

    // Another writer appends between our read and our write: the retry keeps both lines
    let raced = false;
    await objects.updateObject('log.jsonl', (text) => {
      if (!raced) {
        raced = true;
        client.objects.set('log.jsonl', { text: `${text}other\n`, etag: '"other"' });
      }
      return `${text}three\n`;
    });
    assert.equal(client.read('log.jsonl'), 'one\ntwo\nother\nthree\n');
  }
);
