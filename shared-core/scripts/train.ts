// Huấn luyện model (ngoài request). Mặc định dùng dữ liệu giả lập; dữ liệu thật qua --csv.
//   npm run train -w shared-core
//   npm run train -w shared-core -- --csv data/pm25.csv --out models/pm25-iforest-v1.json --version 1.1.0
// CSV: station_id,lat,lon,observed_at,pm25[,unit] (observed_at có thể kèm offset, vd +07:00).
import { readFileSync, writeFileSync } from 'node:fs';
import { ReadingSchema, generateSyntheticDataset, trainAnomalyModel, type Reading } from '../src/index.js';

const arg = (name: string, def?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};

function readCsv(path: string): { readings: Reading[]; skipped: number } {
  const [head, ...rest] = readFileSync(path, 'utf8').trim().split(/\r?\n/);
  const cols = head!.split(',').map((c) => c.trim());
  const readings: Reading[] = [];
  let skipped = 0;
  rest.forEach((line, i) => {
    const cells = line.split(',').map((c) => c.trim());
    const row = Object.fromEntries(cols.map((c, j) => [c, cells[j] ?? '']));
    const t = Date.parse(row.observed_at ?? '');
    const parsed = ReadingSchema.safeParse({
      id: `csv-${i + 1}`,
      datasetId: 'training',
      sensorId: row.station_id,
      ts: Number.isNaN(t) ? '' : new Date(t).toISOString(),
      location: { type: 'Point', coordinates: [Number(row.lon), Number(row.lat)] },
      value: Number(row.pm25),
      unit: 'ug/m3',
    });
    if (parsed.success) readings.push(parsed.data);
    else skipped++;
  });
  return { readings, skipped };
}

let readings: Reading[];
const csv = arg('csv');
if (csv) {
  const r = readCsv(csv);
  console.log(`CSV: ${r.readings.length} dòng hợp lệ, ${r.skipped} dòng bị bỏ`);
  readings = r.readings;
} else {
  readings = generateSyntheticDataset({ seed: 100, days: 30, anomalyRate: 0.01 }).readings;
  console.log(`Dùng dữ liệu giả lập: ${readings.length} bản ghi`);
}

const model = trainAnomalyModel(readings, {
  version: arg('version', '1.0.0'),
  contamination: Number(arg('contamination', '0.01')),
  seed: Number(arg('seed', '7')),
  nTrees: Number(arg('trees', '100')),
  sampleSize: Number(arg('sample', '256')),
});
const out = arg('out', 'models/pm25-iforest-v1.json')!;
writeFileSync(out, JSON.stringify(model));
console.log(`Đã ghi ${out} (threshold=${model.threshold}, trees=${model.trees.length})`);
