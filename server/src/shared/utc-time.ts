import { HttpError } from './http/errors.js';

export function parseUtcTime(input: string | undefined): string | undefined {
  if (input === undefined) return undefined;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(input);
  if (!match) throw new HttpError(422, 'INVALID_TIME', 'Time must use UTC Z with at most three fractional second digits.');
  const canonical = `${match[1]}.${(match[2] ?? '').padEnd(3, '0')}Z`;
  const date = new Date(canonical);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== canonical) throw new HttpError(422, 'INVALID_TIME', 'Time is not a valid calendar instant.');
  return canonical;
}
