// Sinh CSV mẫu (dạng upload nguồn, timestamp kèm +07:00) cho Dataset Import (Khiêm) và E2E (Cường).
import { writeFileSync } from 'node:fs';
import { generateSyntheticDataset } from '../src/index.js';

const { readings, truth } = generateSyntheticDataset({ seed: 2026, sensors: 5, days: 7, anomalyRate: 0.015 });
const station = (sensorId: string) => `S${sensorId.slice(-2)}`;
const local = (ts: string) => new Date(Date.parse(ts) + 7 * 3_600_000).toISOString().replace('Z', '+07:00');

const csv = ['station_id,lat,lon,observed_at,pm25,unit'];
const labels = ['station_id,observed_at'];
for (const r of readings) {
  const [lng, lat] = r.location.coordinates;
  const at = local(r.ts);
  csv.push(`${station(r.sensorId)},${lat.toFixed(5)},${lng.toFixed(5)},${at},${r.value},ug/m3`);
  if (truth.has(r.id)) labels.push(`${station(r.sensorId)},${at}`);
}
writeFileSync('fixtures/pm25-sample.csv', csv.join('\n') + '\n');
writeFileSync('fixtures/pm25-sample.labels.csv', labels.join('\n') + '\n');
console.log(`pm25-sample.csv: ${readings.length} dòng, ${truth.size} bất thường có nhãn`);
