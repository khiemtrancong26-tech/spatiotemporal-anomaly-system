import { parse } from 'csv-parse';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { HttpError } from '../../shared/http/errors.js';
import type { SourceFormat, SourceRow } from './import.types.js';

function invalid(message: string) { return new HttpError(422, 'INVALID_SOURCE', message); }
async function* utf8(input: Readable): AsyncGenerator<string> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for await (const chunk of input) yield decoder.decode(chunk as Uint8Array, { stream: true });
  const tail = decoder.decode();
  if (tail) yield tail;
}

/** Frame array elements, then let native JSON.parse validate each full record.
 * Memory is bounded by one input chunk and one admitted record, never the whole array.
 */
async function* jsonArray(input: AsyncIterable<string>, maximum: number): AsyncGenerator<unknown> {
  let opened = false, closed = false, inString = false, escaped = false, afterComma = false;
  const brackets: string[] = [];
  let parts: string[] = [], bytes = 0;
  const append = (text: string) => {
    bytes += Buffer.byteLength(text);
    if (bytes > maximum) throw invalid('A JSON record exceeds the configured record byte limit.');
    if (text) parts.push(text);
  };
  const record = () => {
    const text = parts.join('');
    parts = []; bytes = 0;
    if (!/[^ \t\r\n]/.test(text)) throw invalid('Invalid JSON array element.');
    try { return JSON.parse(text) as unknown; } catch { throw invalid('Invalid JSON source syntax.'); }
  };
  for await (const chunk of input) {
    let start = 0;
    for (let index = 0; index < chunk.length; index++) {
      const char = chunk[index]!;
      if (!opened) {
        if (/[ \t\r\n]/.test(char)) { start = index + 1; continue; }
        if (char !== '[') throw invalid('JSON source must be a top-level array.');
        opened = true; start = index + 1; continue;
      }
      if (closed) {
        if (!/[ \t\r\n]/.test(char)) throw invalid('Unexpected content after JSON array.');
        start = index + 1; continue;
      }
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') { inString = true; continue; }
      if (char === '{' || char === '[') { brackets.push(char); continue; }
      if (char === '}' || (char === ']' && brackets.length)) {
        if (brackets.pop() !== (char === '}' ? '{' : '[')) throw invalid('Unbalanced JSON record.');
        continue;
      }
      if ((char === ',' || char === ']') && brackets.length === 0) {
        append(chunk.slice(start, index));
        const nonempty = /[^ \t\r\n]/.test(parts.join(''));
        if (char === ',' || nonempty) yield record();
        else if (afterComma) throw invalid('JSON array must not end with a trailing comma.');
        afterComma = char === ',';
        if (char === ']') { closed = true; parts = []; bytes = 0; }
        start = index + 1;
      }
    }
    if (opened && !closed) append(chunk.slice(start));
  }
  if (!opened || !closed || inString || brackets.length) throw invalid('Incomplete JSON array source.');
}

export async function* readSourceRows(
  input: Readable, format: SourceFormat, maxRecordBytes: number, columns: Set<string>,
): AsyncGenerator<SourceRow> {
  let columnBytes = [...columns].reduce((sum, name) => sum + Buffer.byteLength(name), 0);
  function addColumns(names: string[]) {
    for (const name of names) { if (!columns.has(name)) { columns.add(name); columnBytes += Buffer.byteLength(name); } }
    if (columnBytes > maxRecordBytes) {
      throw invalid('Source column metadata exceeds the configured record byte budget.');
    }
  }
  try {
    if (format === 'json') {
      let ordinal = 0;
      for await (const value of jsonArray(utf8(input), maxRecordBytes)) {
        ordinal++;
        const isObject = value !== null && typeof value === 'object' && !Array.isArray(value);
        const values = isObject ? value as Record<string, unknown> : {};
        const structuralValid = isObject && Object.values(values).every(item => item === null || typeof item !== 'object');
        if (isObject) addColumns(Object.keys(values));
        yield { rowNumber: ordinal, values, structuralValid };
      }
      return;
    }
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const decoding = new Transform({ transform(chunk: Buffer, _encoding, done) {
      try { done(null, decoder.decode(chunk, { stream: true })); } catch { done(invalid('CSV source must be valid UTF-8.')); }
    }, flush(done) {
      try { done(null, decoder.decode()); } catch { done(invalid('CSV source must be valid UTF-8.')); }
    } });
    const csv = parse({ bom: true, raw: true, info: true, skip_empty_lines: true, relax_column_count: true, max_record_size: maxRecordBytes });
    let failure: unknown;
    const complete = pipeline(input, decoding, csv).catch(error => { failure = error; });
    let header: string[] | undefined;
    let quotedCrLf = 0;
    try {
      for await (const item of csv as AsyncIterable<{ record: string[]; raw: string; info: { lines: number } }>) {
        if (Buffer.byteLength(item.raw) > maxRecordBytes) throw invalid('A CSV record exceeds the configured record byte limit.');
        if (!header) {
          header = item.record;
          if (header.some(name => !name.trim()) || new Set(header).size !== header.length) throw invalid('CSV headers must be nonempty and unique.');
          addColumns(header); continue;
        }
        const rawWithoutDelimiter = item.raw.replace(/(?:\r\n|\r|\n)$/, '');
        const innerBreaks = rawWithoutDelimiter.match(/\r\n|\r|\n/g)?.length ?? 0;
        // csv-parse 7 counts CR and LF separately inside quoted records, but as one
        // outside quotes. Correct its cumulative line counter to physical lines.
        quotedCrLf += rawWithoutDelimiter.match(/\r\n/g)?.length ?? 0;
        yield { rowNumber: item.info.lines - innerBreaks - quotedCrLf, values: Object.fromEntries(header.map((name, index) => [name, item.record[index]])),
          structuralValid: item.record.length === header.length };
      }
      if (failure) throw failure;
      if (!header) throw invalid('CSV source has no header.');
    } finally { input.destroy(); decoding.destroy(); csv.destroy(); await complete; }
  } catch (error) {
    if (error instanceof HttpError || (error as Error).name === 'AbortError') throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error;
    throw invalid('Source syntax, encoding or record size is invalid.');
  } finally { input.destroy(); }
}
