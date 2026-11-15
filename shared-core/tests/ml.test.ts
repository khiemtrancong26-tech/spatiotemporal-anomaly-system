import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AnomalySchema,
  FEATURE_NAMES,
  ML_METHOD,
  avgPathLength,
  buildAnomalyDrafts,
  buildFeatures,
  createMlAdapter,
  detectWithModel,
  evaluate,
  flaggedIds,
  generateSyntheticDataset,
  loadModelArtifact,
  runStatisticalDetector,
  scoreIsolationForest,
  trainAnomalyModel,
  trainIsolationForest,
} from '../src/index.js';
import { mk } from './helpers.js';

const FIXED = '2026-11-12T00:00:00.000Z';

describe('isolation forest', () => {
  it('avgPathLength khớp giá trị tham chiếu', () => {
    expect(avgPathLength(1)).toBe(0);
    expect(avgPathLength(2)).toBe(1);
    expect(avgPathLength(256)).toBeCloseTo(10.2448, 3);
  });

  it('điểm xa cụm có score cao hơn điểm trong cụm', () => {
    const rng = (() => { let s = 1; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
    const data = Array.from({ length: 300 }, () => [rng(), rng()]);
    const forest = trainIsolationForest(data, { nTrees: 100, seed: 3 });
    const inlier = scoreIsolationForest(forest, [0.5, 0.5]);
    const outlier = scoreIsolationForest(forest, [8, 8]);
    // Score bão hoà khi vượt ngoài miền huấn luyện (không tăng theo khoảng cách).
    expect(outlier).toBeGreaterThan(0.6);
    expect(inlier).toBeLessThan(0.55);
    expect(outlier - inlier).toBeGreaterThan(0.1);
  });

  it('tái lập với cùng seed, khác nhau khi đổi seed', () => {
    const data = Array.from({ length: 100 }, (_, i) => [i % 7, (i * 3) % 11]);
    const a = trainIsolationForest(data, { nTrees: 5, seed: 1 });
    expect(a).toEqual(trainIsolationForest(data, { nTrees: 5, seed: 1 }));
    expect(a).not.toEqual(trainIsolationForest(data, { nTrees: 5, seed: 2 }));
  });

  it('lỗi khi quá ít mẫu; dữ liệu hằng vẫn cho score hữu hạn', () => {
    expect(() => trainIsolationForest([[1]])).toThrow();
    const f = trainIsolationForest(Array.from({ length: 20 }, () => [1, 1]), { nTrees: 3 });
    expect(Number.isFinite(scoreIsolationForest(f, [1, 1]))).toBe(true);
  });
});

describe('features', () => {
  it('đủ chiều; spatial_dev phản ánh lệch với sensor khác cùng giờ', () => {
    const ts = '2026-11-01T03:00:00.000Z';
    const rows = buildFeatures([
      mk('a', 0, 100, { ts }), mk('b', 0, 40, { ts }), mk('c', 0, 40, { ts }),
    ]);
    expect(rows[0]!.features).toHaveLength(FEATURE_NAMES.length);
    const a = rows.find((r) => r.sensorId === 'a')!;
    expect(a.features[FEATURE_NAMES.indexOf('spatial_dev')]).toBe(60);
    expect(a.readingId).toBe('a-r0');
  });
});

describe('model artifact: train -> save -> load -> predict (SDD)', () => {
  const train = generateSyntheticDataset({ seed: 100, days: 14 });

  it('qua JSON cho kết quả giống hệt model gốc', () => {
    const model = trainAnomalyModel(train.readings, { nTrees: 30, seed: 5, trainedAt: FIXED });
    const reloaded = loadModelArtifact(JSON.parse(JSON.stringify(model)));
    const test = generateSyntheticDataset({ seed: 7, days: 5 });
    expect(detectWithModel(test.readings, reloaded)).toEqual(detectWithModel(test.readings, model));
  });

  it('từ chối artifact sai feature / sai định dạng', () => {
    const model = trainAnomalyModel(train.readings, { nTrees: 5, trainedAt: FIXED });
    expect(() => loadModelArtifact({ ...model, featureNames: ['x'] })).toThrow(/mismatch/);
    expect(() => loadModelArtifact({ ...model, schemaVersion: 2 })).toThrow();
    expect(() => loadModelArtifact(null)).toThrow();
  });

  it('từ chối huấn luyện khi quá ít dữ liệu; trainedAt mặc định là UTC có Z', () => {
    expect(() => trainAnomalyModel(train.readings.slice(0, 10))).toThrow(/at least/);
    expect(trainAnomalyModel(train.readings, { nTrees: 2 }).trainedAt).toMatch(/Z$/);
  });

  it('model v1 đã commit nạp được và phát hiện tốt trên dữ liệu chưa thấy', () => {
    const artifact = loadModelArtifact(JSON.parse(readFileSync('models/pm25-iforest-v1.json', 'utf8')));
    const d = generateSyntheticDataset({ seed: 2026, sensors: 5, days: 7, anomalyRate: 0.015 });
    const m = evaluate(flaggedIds(detectWithModel(d.readings, artifact).results), d.truth);
    expect(m.recall).toBeGreaterThan(0.8);
    expect(m.precision).toBeGreaterThan(0.6);
  });
});

describe('detectWithModel', () => {
  const train = generateSyntheticDataset({ seed: 100, days: 14 });
  const model = trainAnomalyModel(train.readings, { nTrees: 30, trainedAt: FIXED, version: '2.0.0' });

  it('một kết quả cho mỗi reading theo thứ tự đầu vào; mang modelVersion', () => {
    const d = generateSyntheticDataset({ seed: 9, days: 3 });
    const shuffled = [...d.readings].reverse();
    const out = detectWithModel(shuffled, model);
    expect(out).toMatchObject({ family: 'ml', method: ML_METHOD, modelVersion: '2.0.0', status: 'completed' });
    expect(out.results.map((r) => r.readingId)).toEqual(shuffled.map((r) => r.id));
    expect(out.results.every((r) => r.score > 0 && r.score < 1)).toBe(true);
  });

  it('threshold tuỳ chỉnh ghi đè ngưỡng của model', () => {
    const d = generateSyntheticDataset({ seed: 9, days: 3 });
    expect(flaggedIds(detectWithModel(d.readings, model, { threshold: 0.99 }).results)).toEqual([]);
    expect(flaggedIds(detectWithModel(d.readings, model, { threshold: 0.01 }).results)).toHaveLength(d.readings.length);
  });

  it('rỗng -> insufficient_data; sai schema / id trùng -> invalid_input', () => {
    expect(detectWithModel([], model).status).toBe('insufficient_data');
    expect(detectWithModel([{ ...mk('a', 0, 1), value: -1 }], model).status).toBe('invalid_input');
    expect(detectWithModel([mk('a', 0, 1), mk('a', 0, 2)], model).message).toMatch(/duplicate/);
  });

  it('nhánh ML tách biệt với thống kê: cùng reading, hai nguồn kết quả độc lập (BR-09)', () => {
    const d = generateSyntheticDataset({ seed: 11, days: 7 });
    const ml = buildAnomalyDrafts(d.readings, 'ml', ML_METHOD, detectWithModel(d.readings, model).results);
    const st = runStatisticalDetector({ method: 'zscore', readings: d.readings, config: {} });
    const stDrafts = buildAnomalyDrafts(d.readings, 'statistical', st.method, st.results);
    expect(ml.every((a) => a.family === 'ml' && a.method === ML_METHOD)).toBe(true);
    expect(stDrafts.every((a) => a.family === 'statistical')).toBe(true);
    const full = { ...ml[0]!, id: 'a', analysisRunId: 'r', updatedAt: FIXED };
    expect(AnomalySchema.safeParse(full).success).toBe(true);
  });
});

describe('adapter', () => {
  it('validate artifact, mang modelVersion, suy luận bất đồng bộ', async () => {
    const train = generateSyntheticDataset({ seed: 100, days: 14 });
    const model = trainAnomalyModel(train.readings, { version: '9.9.9', trainedAt: FIXED, nTrees: 20 });
    const adapter = createMlAdapter(JSON.parse(JSON.stringify(model)));
    expect(adapter).toMatchObject({ family: 'ml', method: ML_METHOD, modelVersion: '9.9.9' });
    const out = await adapter.detect(train.readings);
    expect(out.status).toBe('completed');
    expect(flaggedIds(out.results).length).toBeGreaterThan(0);
    expect(() => createMlAdapter({ bogus: true })).toThrow();
  });
});

describe('synthetic dataset', () => {
  it('tái lập theo seed; đúng contract Reading; có nhãn', async () => {
    const a = generateSyntheticDataset({ seed: 5, days: 3 });
    expect(a.readings).toEqual(generateSyntheticDataset({ seed: 5, days: 3 }).readings);
    expect(a.truth.size).toBeGreaterThan(0);
    const { ReadingSchema } = await import('../src/index.js');
    expect(a.readings.every((r) => ReadingSchema.safeParse(r).success)).toBe(true);
  });
});

describe('evaluate', () => {
  it('tính precision/recall/F1, xử lý tập rỗng', () => {
    const m = evaluate(['a', 'b', 'x'], new Set(['a', 'b', 'c', 'd']));
    expect(m).toMatchObject({ truePositives: 2, falsePositives: 1, falseNegatives: 2 });
    expect(m.precision).toBeCloseTo(2 / 3);
    expect(m.recall).toBe(0.5);
    expect(evaluate([], new Set(['a'])).f1).toBe(0);
  });
});
