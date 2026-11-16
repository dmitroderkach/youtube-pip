/**
 * An in-memory S3 bucket with the client interface s3-objects.mjs uses (`send(command)` for Get / Put / List /
 * Delete, ETags and the conditional writes IfMatch / IfNoneMatch). For tests and the fast lane smoke test in
 * claude-code-update.yml, which has no AWS. Not part of the image.
 */
import { createHash } from 'node:crypto';

const error = (name, status) =>
  Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });

export function createMemoryS3Client(initial = {}) {
  const objects = new Map();
  const etagOf = (text) => `"${createHash('md5').update(text).digest('hex')}"`;
  const store = (key, text) => objects.set(key, { text, etag: etagOf(text) });
  for (const [key, text] of Object.entries(initial)) store(key, String(text));

  return {
    objects,
    /** The text of an object, or null (for assertions). */
    read: (key) => objects.get(key)?.text ?? null,
    async send(command) {
      const input = command.input ?? {};
      switch (command.constructor.name) {
        case 'GetObjectCommand': {
          const object = objects.get(input.Key);
          if (!object) throw error('NoSuchKey', 404);
          return { Body: { transformToString: async () => object.text }, ETag: object.etag };
        }
        case 'PutObjectCommand': {
          const current = objects.get(input.Key);
          if (input.IfNoneMatch === '*' && current) throw error('PreconditionFailed', 412);
          if (input.IfMatch && current?.etag !== input.IfMatch)
            throw error('PreconditionFailed', 412);
          const body = input.Body;
          store(input.Key, typeof body === 'string' ? body : Buffer.from(body).toString('utf8'));
          return { ETag: objects.get(input.Key).etag };
        }
        case 'ListObjectsV2Command':
          return {
            Contents: [...objects.keys()]
              .filter((key) => key.startsWith(input.Prefix ?? ''))
              .sort()
              .map((Key) => ({ Key })),
          };
        case 'DeleteObjectCommand':
          objects.delete(input.Key);
          return {};
        default:
          throw new Error(`memory S3: ${command.constructor.name} is not supported`);
      }
    },
  };
}
