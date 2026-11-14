import { createHash } from 'node:crypto';
// Sensor external IDs have no HTTP maxLength. Sign a fixed-size digest with the
// anchor ID; the Repository resolves the exact key without a giant URL cursor.
export const sensorCursorKey = (externalId: string) => `sha256:${createHash('sha256').update(externalId).digest('hex')}`;
