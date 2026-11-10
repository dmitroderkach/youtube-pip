/**
 * Invoke one of this project's Lambdas from a workflow on the on-call runner (its task role may invoke the
 * oncall-schedule and dev-ops Lambdas). The runner image has no AWS CLI: the SDK client is installed on the fly.
 * Usage: node scripts/claude-update/aws-invoke.mjs <function name> '<json payload>'  -> prints the JSON answer.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const prefix = '/tmp/aws-sdk-lambda';
if (!existsSync(`${prefix}/node_modules/@aws-sdk/client-lambda`)) {
  execFileSync(
    'npm',
    [
      'install',
      '--prefix',
      prefix,
      '--no-audit',
      '--no-fund',
      '--silent',
      '@aws-sdk/client-lambda@3',
    ],
    {
      stdio: 'inherit',
    }
  );
}
const require = createRequire(`${prefix}/index.js`);
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

export async function invoke(name, payload) {
  const client = new LambdaClient({ region: process.env.AWS_REGION || 'eu-central-1' });
  const out = await client.send(
    new InvokeCommand({ FunctionName: name, Payload: Buffer.from(JSON.stringify(payload)) })
  );
  const text = Buffer.from(out.Payload ?? []).toString('utf8');
  if (out.FunctionError) throw new Error(`${name}: ${out.FunctionError} ${text.slice(0, 500)}`);
  return JSON.parse(text || 'null');
}

if (process.argv[1]?.endsWith('aws-invoke.mjs')) {
  console.log(JSON.stringify(await invoke(process.argv[2], JSON.parse(process.argv[3] ?? '{}'))));
}
