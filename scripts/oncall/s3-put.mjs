/**
 * On-call (docs/ONCALL.md, "Agent isolation"): upload a file to the dev worker's private state bucket (STATE_BUCKET,
 * set on the on-call runner task) under oncall/; the task role may only put objects there. Used for the agent's
 * transcript, which holds tool results (bundles, logs) and stays out of the public artifacts. The runner image has no
 * AWS CLI: the SDK client is installed on the fly (like scripts/claude-update/aws-invoke.mjs).
 * Usage: node scripts/oncall/s3-put.mjs <file> <key under oncall/>
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const [file, key] = process.argv.slice(2);
const bucket = process.env.STATE_BUCKET;
if (!file || !key) throw new Error('usage: s3-put.mjs <file> <key under oncall/>');
if (!bucket) throw new Error('STATE_BUCKET is not set (runner-oncall task definition)');

const prefix = '/tmp/aws-sdk-s3';
if (!existsSync(`${prefix}/node_modules/@aws-sdk/client-s3`)) {
  execFileSync(
    'npm',
    ['install', '--prefix', prefix, '--no-audit', '--no-fund', '--silent', '@aws-sdk/client-s3@3'],
    { stdio: 'inherit' }
  );
}
const require = createRequire(`${prefix}/index.js`);
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const client = new S3Client({ region: process.env.AWS_REGION || 'eu-central-1' });
await client.send(
  new PutObjectCommand({
    Bucket: bucket,
    Key: `oncall/${key}`,
    Body: readFileSync(file),
    ContentType: 'application/x-ndjson',
  })
);
// The bucket's name (with the account id) stays out of the public job log
console.log(`s3-put: ${file} -> state bucket, oncall/${key}`);
