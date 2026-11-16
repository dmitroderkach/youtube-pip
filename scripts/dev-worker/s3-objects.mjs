/**
 * Objects of the state bucket for both lanes (the worker and the fast lane): read, write, conditional
 * read-modify-write (ETag, retried on a conflict) for the stores both write at any time (the chat log, settings,
 * meta.json while the worker sleeps). Credentials come from the process's role (the worker task's or the Lambda's).
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const isMissing = (error) =>
  error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404;
const isConflict = (error) => [409, 412].includes(error?.$metadata?.httpStatusCode);

export function createS3Objects({ region, bucket, client = new S3Client({ region }) }) {
  /** { text, etag } of an object, or null when it does not exist. */
  async function getObject(key) {
    try {
      const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return { text: await out.Body.transformToString(), etag: out.ETag };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async function putObject(key, body, { ifMatch, ifNoneMatch } = {}) {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ...(ifMatch ? { IfMatch: ifMatch } : {}),
        ...(ifNoneMatch ? { IfNoneMatch: ifNoneMatch } : {}),
      })
    );
  }

  /**
   * Read-modify-write with a conditional write (ETag), retried on a conflict: neither writer drops the other's
   * change. `change(text | null)` returns the new body (or null: nothing to write). Returns the body written.
   */
  async function updateObject(key, change, attempts = 4) {
    for (let attempt = 1; ; attempt++) {
      const current = await getObject(key);
      const next = change(current?.text ?? null);
      if (next === null || next === undefined) return current?.text ?? null;
      try {
        await putObject(key, next, current ? { ifMatch: current.etag } : { ifNoneMatch: '*' });
        return next;
      } catch (error) {
        if (!isConflict(error) || attempt >= attempts) throw error;
      }
    }
  }

  /** A JSON object merged with `patch` (keys set to undefined are removed), written conditionally. */
  async function updateJson(key, patch) {
    let merged = null;
    await updateObject(key, (text) => {
      let current = {};
      try {
        current = text ? JSON.parse(text) : {};
      } catch {
        current = {};
      }
      merged = typeof patch === 'function' ? patch(current) : { ...current, ...patch };
      for (const [name, value] of Object.entries(merged))
        if (value === undefined) delete merged[name];
      return JSON.stringify(merged);
    });
    return merged;
  }

  async function list(prefix) {
    const out = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
    return (out.Contents ?? []).map((item) => item.Key);
  }

  return {
    getObject,
    putObject,
    updateObject,
    updateJson,
    list,
    get: async (key) => (await getObject(key))?.text ?? null,
    put: (key, text) => putObject(key, text),
    delete: (key) => client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
    async getJson(key) {
      const object = await getObject(key);
      return object ? JSON.parse(object.text) : null;
    },
    putJson: (key, value) => putObject(key, JSON.stringify(value)),
  };
}
