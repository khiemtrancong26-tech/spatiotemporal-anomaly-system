import type { ObjectId } from 'mongodb';
import { toGeoPoint, toPublicId } from '../../shared/persistence/mapping.js';
import type { Sensor } from './query.types.js';

export interface SensorDocument {
  _id: ObjectId; datasetId: ObjectId; externalId: string; name: string;
  location: { type: 'Point'; coordinates: [number, number] }; type: 'pm25'; unit: 'ug/m3'; region?: string;
}
export function toSensorDto(document: SensorDocument): Sensor {
  if (document.location.type !== 'Point' || document.type !== 'pm25' || document.unit !== 'ug/m3') throw new TypeError('Invalid persisted sensor');
  return { id: toPublicId(document._id), datasetId: toPublicId(document.datasetId), externalId: document.externalId, name: document.name,
    location: toGeoPoint(document.location.coordinates), type: document.type, unit: document.unit,
    ...(document.region !== undefined ? { region: document.region } : {}),
  };
}
