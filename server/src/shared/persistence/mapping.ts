import { ObjectId } from 'mongodb';

export function toObjectId(id: string): ObjectId {
  if (!/^[0-9a-f]{24}$/i.test(id)) throw new TypeError('Invalid persistence ID');
  return new ObjectId(id);
}
export function toPublicId(id: ObjectId): string { return id.toHexString(); }
export function toUtcIso(date: Date): string {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new TypeError('Invalid persistence date');
  return date.toISOString();
}
export function toGeoPoint(coordinates: readonly number[]): { type: 'Point'; coordinates: [number, number] } {
  const [lon, lat] = coordinates;
  if (coordinates.length !== 2 || lon === undefined || lat === undefined || !Number.isFinite(lon) ||
      !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) throw new TypeError('Invalid WGS84 point');
  return { type: 'Point', coordinates: [lon, lat] };
}

export interface ReadingDocument {
  _id: ObjectId; datasetId: ObjectId; sensorId: ObjectId; ts: Date;
  location: { type: 'Point'; coordinates: [number, number] }; value: number; unit: 'ug/m3';
}
export function toReadingDto(document: ReadingDocument) {
  if (!Number.isFinite(document.value) || document.value < 0 || document.unit !== 'ug/m3' || document.location.type !== 'Point') {
    throw new TypeError('Invalid persisted PM2.5 reading');
  }
  // Whitelist DTO fields: never spread a persistence document into an API response.
  return {
    id: toPublicId(document._id), datasetId: toPublicId(document.datasetId), sensorId: toPublicId(document.sensorId),
    ts: toUtcIso(document.ts), location: toGeoPoint(document.location.coordinates), value: document.value, unit: document.unit,
  };
}

export function assertSameDataset(expected: ObjectId, ...related: { datasetId: ObjectId }[]): void {
  if (related.some((document) => !document.datasetId.equals(expected))) throw new TypeError('Cross-dataset reference');
}
