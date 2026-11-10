#!/usr/bin/env node
/**
 * A fake `aws` CLI for the worker end-to-end test (worker-e2e.sh): S3 as a directory ($FAKE_ROOT/s3), the SQS queue as
 * files ($FAKE_ROOT/queue), everything else answers nothing. Implements only what worker.mjs calls.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(process.env.FAKE_ROOT, 's3');
const QUEUE = path.join(process.env.FAKE_ROOT, 'queue');
let a = process.argv.slice(2);
const r = a.indexOf('--region');
if (r >= 0) a.splice(r, 2);
a = a
  .filter((x) => x !== '--quiet')
  .flatMap((x) => (x.startsWith('--exclude=') ? ['--exclude', x.slice(10)] : [x]));
const s3p = (u) => path.join(ROOT, u.replace(/^s3:\/\/[^/]+\//, ''));
const walk = (d) =>
  fs.existsSync(d)
    ? fs
        .readdirSync(d, { withFileTypes: true })
        .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]))
    : [];
const glob = (p, rel) =>
  new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(rel);
const [svc, cmd, ...rest] = a;
if (svc === 's3' && cmd === 'cp') {
  const [src, dst] = rest;
  const from = src.startsWith('s3://') ? s3p(src) : src;
  if (!fs.existsSync(from)) process.exit(1);
  if (dst === '-') {
    process.stdout.write(fs.readFileSync(from));
    process.exit(0);
  }
  const to = dst.startsWith('s3://') ? s3p(dst) : dst;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
} else if (svc === 's3' && cmd === 'rm') {
  fs.rmSync(s3p(rest[0]), { force: true, recursive: rest.includes('--recursive') });
} else if (svc === 's3' && cmd === 'sync') {
  const [src, dst, ...flags] = rest;
  const filters = [];
  for (let k = 0; k < flags.length; k++)
    if (flags[k] === '--exclude' || flags[k] === '--include') filters.push([flags[k], flags[++k]]);
  const from = src.startsWith('s3://') ? s3p(src) : src;
  const to = dst.startsWith('s3://') ? s3p(dst) : dst;
  for (const f of walk(from)) {
    const rel = path.relative(from, f);
    let ok = true;
    for (const [t, p] of filters) if (glob(p, rel)) ok = t === '--include';
    if (!ok) continue;
    const target = path.join(to, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(f, target);
  }
} else if (svc === 's3api' && cmd === 'head-object') {
  process.exit(fs.existsSync(path.join(ROOT, rest[rest.indexOf('--key') + 1])) ? 0 : 1);
} else if (svc === 's3api' && cmd === 'list-objects-v2') {
  const p = rest[rest.indexOf('--prefix') + 1];
  const keys = walk(ROOT)
    .map((f) => path.relative(ROOT, f))
    .filter((k) => k.startsWith(p));
  console.log(JSON.stringify(keys.length ? keys : null));
} else if (svc === 'sqs' && cmd === 'receive-message') {
  const files = fs.existsSync(QUEUE) ? fs.readdirSync(QUEUE).sort() : [];
  if (!files.length) {
    require('child_process').execSync('sleep 1');
    console.log('');
  } else {
    const body = fs.readFileSync(path.join(QUEUE, files[0]), 'utf8');
    console.log(JSON.stringify({ Messages: [{ Body: body, ReceiptHandle: files[0] }] }));
  }
} else if (svc === 'sqs' && cmd === 'delete-message') {
  fs.rmSync(path.join(QUEUE, rest[rest.indexOf('--receipt-handle') + 1]), { force: true });
} else {
  console.log('');
}
