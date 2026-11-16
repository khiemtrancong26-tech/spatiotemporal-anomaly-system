import type { Db, Document, FindOptions } from 'mongodb';
import { toObjectId, toPublicId, toReadingDto, type ReadingDocument } from '../../shared/persistence/mapping.js';
import { keysetPredicate } from '../../shared/persistence/keyset.js';
import { toSensorDto, type SensorDocument } from './query.mapping.js';
import type { PageInput, QueryRepository } from './query.types.js';
import { sensorCursorKey } from './query.cursor.js';
import { HttpError } from '../../shared/http/errors.js';

export function bboxCoveringCircle(bbox: NonNullable<PageInput['bbox']>): { center: [number, number]; radius: number } | null {
  const [west, south, east, north] = bbox;
  // A meridian + parallel path bounds every great-circle distance by
  // |delta latitude| + |delta longitude|. Add ~6 m of angular padding;
  // exact scalar bounds below still decide membership, including every edge.
  const radius = ((east - west) / 2 + (north - south) / 2) * Math.PI / 180 + 1e-6;
  return radius >= Math.PI ? null : { center: [(west + east) / 2, (south + north) / 2], radius };
}

// Shared by the production reads and the explain harness: no duplicate benchmark query.
export function buildQuery(input: PageInput, readings: boolean) {
  const filter: Document = { datasetId: toObjectId(input.datasetId) };
  if (input.bbox) {
    const [west, south, east, north] = input.bbox;
    // Exact coordinate rectangle, inclusive even for a line/point/world bbox.
    // GeoJSON polygon edges are spherical and cannot substitute for this contract.
    filter['location.coordinates.0'] = { $gte: west, $lte: east };
    filter['location.coordinates.1'] = { $gte: south, $lte: north };
    const cover = bboxCoveringCircle(input.bbox);
    if (cover) filter.location = { $geoWithin: { $centerSphere: [cover.center, cover.radius] } };
  }
  if (readings && input.sensorId) filter.sensorId = toObjectId(input.sensorId);
  if (readings && (input.from || input.to)) filter.ts = { ...(input.from ? { $gte: new Date(input.from) } : {}), ...(input.to ? { $lte: new Date(input.to) } : {}) };
  const field = readings ? 'ts' : 'externalId';
  if (input.after) filter.$and = [keysetPredicate(field, input.direction, {
    key: readings ? new Date(input.after.key) : input.after.key, id: toObjectId(input.after.id),
  })];
  const direction = input.direction === 'asc' ? 1 : -1;
  const options: FindOptions = { projection: readings
    ? { _id: 1, datasetId: 1, sensorId: 1, ts: 1, location: 1, value: 1, unit: 1 }
    : { _id: 1, datasetId: 1, externalId: 1, name: 1, location: 1, type: 1, unit: 1, region: 1 },
    sort: { [field]: direction, _id: direction }, limit: input.limit, batchSize: input.limit,
    readPreference: 'primary',
  };
  return { filter, options };
}
export function createQueryRepository(db: Db): QueryRepository {
  return {
    async resolveSensorBoundary(datasetId, after) {
      const sensor = await db.collection<SensorDocument>('sensors').findOne({ _id: toObjectId(after.id), datasetId: toObjectId(datasetId) }, { projection: { _id: 1, externalId: 1 } });
      if (!sensor || sensorCursorKey(sensor.externalId) !== after.key) throw new HttpError(400, 'INVALID_CURSOR', 'Sensor cursor anchor was removed or changed. Restart pagination.');
      return { id: toPublicId(sensor._id), key: sensor.externalId };
    },
    async sensorIdInDataset(datasetId, sensorId) {
      if (!/^[0-9a-f]{24}$/i.test(sensorId)) return null;
      const sensor = await db.collection('sensors').findOne({ _id: toObjectId(sensorId), datasetId: toObjectId(datasetId) }, { projection: { _id: 1 } });
      return sensor ? toPublicId(sensor._id) : null;
    },
    async sensors(input) {
      const { filter, options } = buildQuery(input, false);
      return (await db.collection<SensorDocument>('sensors').find(filter, options).toArray()).map(toSensorDto);
    },
    async readings(input) {
      const { filter, options } = buildQuery(input, true);
      return (await db.collection<ReadingDocument>('readings').find(filter, options).toArray()).map(toReadingDto);
    },
  };
}
