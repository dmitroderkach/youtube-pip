/** Preloaded into the worker by worker-e2e.sh: Bot API calls are logged to $FAKE_ROOT/telegram.log and answered ok. */
import fs from 'node:fs';
const real = globalThis.fetch;
let id = 1000;
globalThis.fetch = async (url, init) => {
  if (!String(url).includes('api.telegram.org')) return real(url, init);
  let body = {};
  try {
    body = JSON.parse(init?.body ?? '{}');
  } catch {
    // multipart (voice): not needed by the test
  }
  fs.appendFileSync(
    `${process.env.FAKE_ROOT}/telegram.log`,
    `${JSON.stringify({ method: String(url).split('/').pop(), body })}\n`
  );
  return new Response(JSON.stringify({ ok: true, result: { message_id: ++id } }));
};
