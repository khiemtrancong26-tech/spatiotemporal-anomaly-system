import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, rename, unlink, access } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { HttpError } from '../../shared/http/errors.js';

export function createSourceFiles(directory: string) {
  const root = resolve(directory);
  function path(fileId: string) {
    if (!/^(?:[0-9a-f]{24}\.source|[0-9a-f-]{36}\.tmp)$/.test(fileId)) throw new Error('Invalid source reference');
    const target = resolve(root, fileId);
    if (!target.startsWith(root + sep)) throw new Error('Source path escaped storage root');
    return target;
  }
  async function remove(fileId: string) {
    try { await unlink(path(fileId)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return {
    async spool(input: Readable, maximum: number, signal: AbortSignal) {
      await mkdir(root, { recursive: true });
      const fileId = `${randomUUID()}.tmp`;
      const hash = createHash('sha256');
      let bytes = 0;
      const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > maximum) return callback(new HttpError(413, 'FILE_TOO_LARGE', 'Source file exceeds the configured byte limit.'));
        hash.update(chunk); callback(null, chunk);
      } });
      try {
        await pipeline(input, meter, createWriteStream(path(fileId), { flags: 'wx', mode: 0o600 }), { signal });
        const handle = await open(path(fileId), 'r+');
        try { await handle.sync(); } finally { await handle.close(); }
        return { fileId, bytes, checksum: hash.digest('hex') };
      } catch (error) {
        await remove(fileId);
        throw error;
      }
    },
    async persist(temporaryId: string, datasetId: string) {
      const fileId = `${datasetId}.source`;
      await rename(path(temporaryId), path(fileId));
      return fileId;
    },
    async exists(fileId: string) { try { await access(path(fileId)); return true; } catch { return false; } },
    remove,
    read: (fileId: string, signal?: AbortSignal) => createReadStream(path(fileId), { highWaterMark: 64 * 1024, ...(signal ? { signal } : {}) }),
    verified(fileId: string, checksum: string, signal?: AbortSignal) {
      const input = createReadStream(path(fileId), { highWaterMark: 64 * 1024, ...(signal ? { signal } : {}) });
      return Readable.from((async function* () {
        const hash = createHash('sha256');
        try {
          for await (const chunk of input) { hash.update(chunk as Buffer); yield chunk; }
          if (hash.digest('hex') !== checksum) throw new HttpError(503, 'SOURCE_CHANGED', 'Persistent source no longer matches the uploaded checksum.');
        } finally { input.destroy(); }
      })(), { objectMode: false });
    },
    // No API accepts an arbitrary path; only opaque internally generated file IDs are resolved.
  };
}
export type SourceFiles = ReturnType<typeof createSourceFiles>;
