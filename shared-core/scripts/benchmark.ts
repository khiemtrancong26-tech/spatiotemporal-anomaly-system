// Chạy: npm run benchmark -w shared-core [-- --out ../docs/ml-evaluation.md]
import { writeFileSync } from 'node:fs';
import {
  detectWithModel,
  evaluate,
  flaggedIds,
  generateSyntheticDataset,
  runStatisticalDetector,
  trainAnomalyModel,
  type Metrics,
  type Reading,
} from '../src/index.js';

const outIdx = process.argv.indexOf('--out');
const outPath = outIdx > 0 ? process.argv[outIdx + 1] : undefined;

const SEEDS = [11, 12, 13, 14, 15];
const TRAINED_AT = '2026-11-12T00:00:00.000Z';
const train = generateSyntheticDataset({ seed: 100, days: 30, anomalyRate: 0.01 });
const model = trainAnomalyModel(train.readings, { contamination: 0.01, seed: 7, trainedAt: TRAINED_AT });

const stat = (method: 'zscore' | 'iqr' | 'moving_avg') => (readings: Reading[]) =>
  flaggedIds(runStatisticalDetector({ method, readings, config: {} }).results);

const methods: { name: string; run: (r: Reading[]) => string[] }[] = [
  { name: 'Z-score (ngưỡng 3σ)', run: stat('zscore') },
  { name: 'IQR (k=1.5)', run: stat('iqr') },
  { name: 'Moving Average (w=12, 4σ)', run: stat('moving_avg') },
  { name: 'Isolation Forest (ML)', run: (r) => flaggedIds(detectWithModel(r, model).results) },
];

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const fmt = (res: Metrics[], k: 'precision' | 'recall' | 'f1') => avg(res.map((x) => x[k])).toFixed(3);

const lines: string[] = ['| Phương pháp | Precision | Recall | F1 |', '|---|---|---|---|'];
for (const m of methods) {
  const res = SEEDS.map((seed) => {
    const d = generateSyntheticDataset({ seed, days: 14, anomalyRate: 0.01 });
    return evaluate(m.run(d.readings), d.truth);
  });
  lines.push(`| ${m.name} | ${fmt(res, 'precision')} | ${fmt(res, 'recall')} | ${fmt(res, 'f1')} |`);
}

lines.push('', '**Độ nhạy của Isolation Forest theo `contamination`** (tỉ lệ bất thường thật = 0.01):', '');
lines.push('| contamination | Precision | Recall | F1 |', '|---|---|---|---|');
for (const c of [0.005, 0.01, 0.015, 0.02, 0.03]) {
  const mdl = trainAnomalyModel(train.readings, { contamination: c, seed: 7, trainedAt: TRAINED_AT });
  const res = SEEDS.map((seed) => {
    const d = generateSyntheticDataset({ seed, days: 14, anomalyRate: 0.01 });
    return evaluate(flaggedIds(detectWithModel(d.readings, mdl).results), d.truth);
  });
  lines.push(`| ${c} | ${fmt(res, 'precision')} | ${fmt(res, 'recall')} | ${fmt(res, 'f1')} |`);
}

const table = lines.join('\n');
console.log(table);
if (outPath) writeFileSync(outPath, table + '\n');
