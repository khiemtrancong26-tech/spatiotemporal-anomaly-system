import { Readable } from 'node:stream';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSourceRows } from '../src/modules/datasets/source-parser.js';
import { normalizeRow, normalizeTimestamp, mappingSuggestions } from '../src/modules/datasets/normalization.js';
import { createSourceFiles } from '../src/modules/datasets/source-files.js';
import { loadTestConfig } from './helpers.js';
import { createTaskLimiter } from '../src/shared/concurrency.js';

async function cleanup(root: string) {
  if (!root.startsWith(resolve(tmpdir()) + sep) || !root.includes('pm25-b3-unit-')) throw new Error('Unsafe test cleanup');
  await rm(root, { recursive: true, force: true });
}
const mapping = { fieldMap: { sensorId: 'id', latitude: 'lat', longitude: 'lon', timestamp: 'ts', value: 'v' }, unit: 'ug/m3' as const };
async function parse(source: string | Buffer, format: 'csv' | 'json', size = 1024, chunkSize = 1) {
  const bytes = Buffer.from(source), chunks: Buffer[] = [];
  for (let start = 0; start < bytes.length; start += chunkSize) chunks.push(bytes.subarray(start, start + chunkSize));
  const columns = new Set<string>(), rows = [];
  for await (const row of readSourceRows(Readable.from(chunks), format, size, columns)) rows.push(row);
  return { columns: [...columns], rows };
}
describe('B3 streaming parser, normalization and source storage', () => {
  it('parses UTF-8 JSON across every byte boundary, escaped strings and array punctuation inside text', async () => {
    const values = [{ name: 'Trạm Đà Nẵng [a], b\\"c', v: 0 }, { v: 1e3 }, null, { nested: {} }, 7];
    const result = await parse(JSON.stringify(values), 'json');
    expect(result.columns).toEqual(['name', 'v', 'nested']);
    expect(result.rows.map(row => row.structuralValid)).toEqual([true, true, false, false, false]);
    expect(result.rows[0]?.values).toEqual(values[0]);
  });
  it.each(['{}', '[{},]', '[,{}]', '[{}', '[{}]garbage', '[{"a":}]', '[{"a":1]]', '[true false]', '["\\uZZZZ"]', '\u00a0[]', '[{}\u00a0]', '[]\u00a0', '[\u00a0]'])('rejects malformed JSON %s', async source => {
    await expect(parse(source, 'json')).rejects.toMatchObject({ statusCode: 422 });
  });
  it('preserves physical CSV record start lines and detects ragged rows without discarding following rows', async () => {
    const result = await parse('\ufeffid,name\r\na,"two\r\nlines"\r\nb\r\nc,d\r\n', 'csv');
    expect(result.columns).toEqual(['id', 'name']);
    expect(result.rows.map(row => [row.rowNumber, row.structuralValid])).toEqual([[2, true], [4, false], [5, true]]);
    expect(result.rows[0]?.values.name).toBe('two\r\nlines');
  });
  it('rejects duplicate/blank CSV headers, broken quotes, invalid UTF-8 and oversized records in either format', async () => {
    for (const source of ['a,a\n1,2', 'a, \n1,2', 'a,b\n"broken,2']) await expect(parse(source, 'csv')).rejects.toMatchObject({ statusCode: 422 });
    for (const format of ['csv', 'json'] as const) {
      await expect(parse(Buffer.from([0xff]), format)).rejects.toMatchObject({ statusCode: 422 });
      await expect(parse(format === 'json' ? '[{"x":"123456789"}]' : 'x\n123456789\n', format, 8)).rejects.toMatchObject({ statusCode: 422 });
    }
  });
  it('normalizes offset and millisecond precision without accepting calendar rollover or rounding', () => {
    expect(normalizeTimestamp('2026-01-01T07:00:00.1+07:00')).toBe('2026-01-01T00:00:00.100Z');
    expect(normalizeTimestamp('2024-02-29T00:00:00.123Z')).toBe('2024-02-29T00:00:00.123Z');
    for (const source of ['2026-02-29T00:00:00Z', '2026-01-01T24:00:00Z', '2026-01-01T00:00:00', '2026-01-01T00:00:00.1234Z', '2026-01-01T00:00:60Z', '2026-01-01T00:00:00+24:00']) expect(normalizeTimestamp(source)).toBeNull();
  });
  it('accepts zero/high PM2.5 but rejects nonfinite, negative, unknown unit and invalid coordinates', () => {
    const values = { id: ' A ', lat: '10', lon: '106', ts: '2026-01-01T00:00:00Z', v: '0' };
    const normalize = (extra: object) => normalizeRow({ rowNumber: 2, values: { ...values, ...extra }, structuralValid: true }, mapping);
    expect(normalize({})).toMatchObject({ value: { externalId: 'A', value: 0, longitude: 106, latitude: 10 } });
    expect(normalize({ v: '999999' })).toHaveProperty('value');
    for (const extra of [{ v: -1 }, { v: '' }, { v: 'NaN' }, { v: 'Infinity' }, { v: Number.POSITIVE_INFINITY }, { v: '0x10' }, { lat: 91 }, { lon: -181 }, { id: ' ' }, { unit: 'mg/m3' }]) expect(normalize(extra)).toHaveProperty('issue');
    expect(mappingSuggestions(['lat', 'latitude', 'longitude', 'station_id'])).toEqual({ longitude: 'longitude', sensorId: 'station_id' });
    expect(normalize({ v: -1, lat: 91, ts: 'no timezone', unit: 'mg/m3' })).toMatchObject({ issues: [
      { field: 'latitude' }, { field: 'timestamp' }, { field: 'value' }, { field: 'unit' },
    ] });
  });
  it('enforces streaming file limits, checksum verification and safe paths with owned temporary cleanup', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'pm25-b3-unit-'));
    try {
      const files = createSourceFiles(root);
      const stored = await files.spool(Readable.from(['ab', 'cd']), 4, AbortSignal.timeout(2000));
      const id = '0123456789abcdef01234567';
      const fileId = await files.persist(stored.fileId, id);
      let actual = ''; for await (const chunk of files.verified(fileId, stored.checksum)) actual += chunk;
      expect(actual).toBe('abcd');
      await writeFile(resolve(root, fileId), 'changed');
      await expect(files.verified(fileId, stored.checksum).toArray()).rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
      await expect(files.spool(Readable.from(['12345']), 4, AbortSignal.timeout(2000))).rejects.toMatchObject({ statusCode: 413 });
      await expect(files.remove('../escape')).rejects.toThrow('Invalid source reference');
    } finally {
      await cleanup(root);
    }
  });
  it('uses the approved initial limits and rejects an unapproved concurrency increase', () => {
    expect(loadTestConfig().imports).toMatchObject({ maxFileBytes: 104857600, maxRecordBytes: 1048576, batchSize: 1000, maxIssues: 1000,
      maxSensors: 10000, uploadConcurrency: 2, importConcurrency: 1, timeoutMs: 120000, replayMs: 86400000 });
    expect(() => loadTestConfig({ IMPORT_CONCURRENCY: '2' })).toThrow();
  });
  it('spools the full approved 100 MiB cap with backpressure, then rejects the next byte', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'pm25-b3-unit-'));
    const maximum = 100 * 1024 * 1024, chunk = Buffer.alloc(64 * 1024, 120);
    async function* content(extra: boolean) {
      for (let bytes = 0; bytes < maximum; bytes += chunk.length) yield chunk;
      if (extra) yield Buffer.from('x');
    }
    try {
      const files = createSourceFiles(root);
      const accepted = await files.spool(Readable.from(content(false)), maximum, AbortSignal.timeout(10000));
      expect(accepted.bytes).toBe(maximum); await files.remove(accepted.fileId);
      await expect(files.spool(Readable.from(content(true)), maximum, AbortSignal.timeout(10000))).rejects.toMatchObject({ statusCode: 413 });
    } finally { await cleanup(root); }
  }, 20000);
  it('removes expired scans from the queue and preserves capacity for the next task', async () => {
    const run = createTaskLimiter(1), controller = new AbortController();
    let release!: () => void, ran = false;
    const first = run(() => new Promise<void>(resolve => { release = resolve; }));
    await Promise.resolve();
    const queued = run(async () => { ran = true; }, controller.signal).catch(error => error);
    controller.abort(new Error('deadline'));
    expect((await queued).message).toBe('deadline'); expect(ran).toBe(false);
    release(); await first;
    expect(await run(async () => 'available')).toBe('available');
  });
});
