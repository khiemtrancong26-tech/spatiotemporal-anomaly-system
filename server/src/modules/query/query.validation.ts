import { HttpError } from '../../shared/http/errors.js';
import type { Bbox } from './query.types.js';

export function parseBbox(input: string | undefined): Bbox | undefined {
  if (input === undefined) return undefined;
  const values = input.split(',');
  if (values.length !== 4 || values.some(value => !/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(value.trim()))) {
    throw new HttpError(422, 'INVALID_BBOX', 'Bbox must contain four finite decimal coordinates.');
  }
  const [west, south, east, north] = values.map(Number) as [number, number, number, number];
  if (![west, south, east, north].every(Number.isFinite) || west < -180 || east > 180 || south < -90 || north > 90 || west > east || south > north) {
    throw new HttpError(422, 'INVALID_BBOX', 'Bbox must be an ordered WGS84 rectangle; crossing the antimeridian is not supported.');
  }
  return [west, south, east, north];
}
export function parseQueryTime(input: string | undefined): string | undefined {
  if (input === undefined) return undefined;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(input);
  if (!match) throw new HttpError(422, 'INVALID_TIME', 'Query time must use UTC Z with at most three fractional second digits.');
  const canonical = `${match[1]}.${(match[2] ?? '').padEnd(3, '0')}Z`;
  const date = new Date(canonical);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== canonical) throw new HttpError(422, 'INVALID_TIME', 'Query time is not a valid calendar instant.');
  return canonical;
}
