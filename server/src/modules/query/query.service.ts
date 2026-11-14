import type { DatasetReadAccess } from '../datasets/index.js';
import { HttpError } from '../../shared/http/errors.js';
import { createCursorCodec, listSorts, parsePageQuery, queryFingerprint } from '../../shared/pagination.js';
import { parseBbox, parseQueryTime } from './query.validation.js';
import type { QueryFilters, QueryRepository, SensorsQuery, ReadingsQuery } from './query.types.js';
import { sensorCursorKey } from './query.cursor.js';

export function createQueryService(repository: QueryRepository, datasets: DatasetReadAccess, codec: ReturnType<typeof createCursorCodec>) {
  async function filters(query: ReadingsQuery, readings: boolean): Promise<QueryFilters> {
    const bbox = parseBbox(query.bbox);
    const from = readings ? parseQueryTime(query.from) : undefined, to = readings ? parseQueryTime(query.to) : undefined;
    if (from && to && from > to) throw new HttpError(422, 'INVALID_TIME_RANGE', 'from must be less than or equal to to.');
    const parent = await datasets.getState(query.datasetId);
    if (!parent) throw new HttpError(422, 'DATASET_NOT_FOUND', 'Dataset does not exist.');
    if (parent.status !== 'imported') throw new HttpError(422, 'DATASET_NOT_READY', 'Dataset is not imported.');
    let sensorId: string | undefined;
    if (readings && query.sensorId !== undefined) {
      const id = await repository.sensorIdInDataset(parent.id, query.sensorId);
      if (!id) throw new HttpError(422, 'SENSOR_NOT_IN_DATASET', 'Sensor does not exist in this dataset.');
      sensorId = id;
    }
    return { datasetId: parent.id, ...(bbox ? { bbox } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}), ...(sensorId ? { sensorId } : {}) };
  }
  async function list(query: ReadingsQuery, readings: boolean) {
    const page = parsePageQuery(query, readings ? listSorts.readings : listSorts.sensors, readings ? 'ts:asc' : 'externalId:asc');
    const scope = await filters(query, readings);
    const fingerprint = queryFingerprint(readings ? 'readings.list' : 'sensors.list', { ...scope }, page.sort);
    const after = page.cursor ? codec.decode(page.cursor, fingerprint) : undefined;
    if (after && (!/^[0-9a-f]{24}$/i.test(after.id) || (readings ?
      (!Number.isFinite(Date.parse(after.key)) || new Date(after.key).toISOString() !== after.key) : !/^sha256:[0-9a-f]{64}$/.test(after.key)))) {
      throw new HttpError(400, 'INVALID_CURSOR', 'Cursor is invalid or incompatible with this query.');
    }
    const boundary = after && !readings ? await repository.resolveSensorBoundary(scope.datasetId, after) : after;
    const input = { ...scope, direction: page.sort.endsWith(':asc') ? 'asc' as const : 'desc' as const, limit: page.limit + 1, ...(boundary ? { after: boundary } : {}) };
    const documents = readings ? await repository.readings(input) : await repository.sensors(input);
    const data = documents.slice(0, page.limit), last = data.at(-1);
    const nextCursor = documents.length > page.limit && last
      ? codec.encode({ key: 'ts' in last ? last.ts : sensorCursorKey(last.externalId), id: last.id }, fingerprint) : null;
    return { data, page: { limit: page.limit, nextCursor } };
  }
  return { sensors: (query: SensorsQuery) => list(query, false), readings: (query: ReadingsQuery) => list(query, true) };
}
