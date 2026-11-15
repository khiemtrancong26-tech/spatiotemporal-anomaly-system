import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DETECTOR_CONFIG,
  buildAnomalyDrafts,
  AnomalySchema,
  detectIQR,
  detectMovingAverage,
  detectZScore,
  evaluate,
  flaggedIds,
  generateSyntheticDataset,
  proposeSeverity,
  quantileSorted,
  runStatisticalDetector,
  sampleStd,
  type StatisticalDetectorInput,
} from '../src/index.js';
import { base, mk, series } from './helpers.js';

describe('stats', () => {
  it('quantile nội suy và sampleStd', () => {
    expect(quantileSorted([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantileSorted([1, 2, 3, 4, 5], 0.25)).toBe(2);
    expect(quantileSorted([], 0.5)).toBeNaN();
    expect(sampleStd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
    expect(sampleStd([1])).toBeNaN();
  });
});

describe('zscore (series)', () => {
  it('đánh dấu outlier rõ rệt', () => {
    const flagged = detectZScore([...base, 300]).points.filter((p) => p.isAnomaly).map((p) => p.index);
    expect(flagged).toEqual([base.length]);
  });
  it('phương sai 0: score 0, không NaN, reason zero_variance', () => {
    const r = detectZScore([5, 5, 5, 5]);
    expect(r.points.every((p) => !p.isAnomaly && p.score === 0 && p.reason === 'zero_variance')).toBe(true);
  });
  it('chuỗi quá ngắn: evaluated=false', () => {
    const r = detectZScore([1, 100]);
    expect(r.points.every((p) => !p.evaluated && !p.isAnomaly && p.reason === 'insufficient_history')).toBe(true);
    expect(detectZScore([]).points).toEqual([]);
  });
});

describe('iqr (series)', () => {
  it('bắt outlier cao và thấp, không báo dữ liệu bình thường', () => {
    expect(detectIQR(base).points.some((p) => p.isAnomaly)).toBe(false);
    const r = detectIQR([...base, 200, 2]);
    expect(r.points[base.length]!.isAnomaly).toBe(true);
    expect(r.points[base.length + 1]!.isAnomaly).toBe(true);
  });
  it('IQR = 0 vẫn trả score hữu hạn', () => {
    const r = detectIQR([5, 5, 5, 5, 5, 5, 50]);
    expect(r.points[6]!.isAnomaly).toBe(true);
    expect(Number.isFinite(r.points[6]!.score)).toBe(true);
  });
  it('chuỗi < 4 điểm: không đánh giá', () => {
    expect(detectIQR([1, 2, 3]).points.every((p) => !p.evaluated)).toBe(true);
  });
});

describe('moving average (series)', () => {
  it('bắt spike, bỏ qua giai đoạn khởi động', () => {
    const r = detectMovingAverage([...base, 150], { windowSize: 5 });
    expect(r.points.slice(0, 5).every((p) => !p.evaluated && !p.isAnomaly)).toBe(true);
    expect(r.points[base.length]!.isAnomaly).toBe(true);
  });
  it('theo kịp xu hướng tăng dần', () => {
    const trend = Array.from({ length: 30 }, (_, i) => 20 + i);
    expect(detectMovingAverage(trend, { windowSize: 5 }).points.some((p) => p.isAnomaly)).toBe(false);
  });
  it('cửa sổ phẳng không chia cho 0 (sàn minStd)', () => {
    const r = detectMovingAverage([...Array(15).fill(10), 11], { windowSize: 12 });
    expect(r.points.every((p) => Number.isFinite(p.score))).toBe(true);
  });
});

describe('runStatisticalDetector (hợp đồng StatisticalDetectorInput/Output)', () => {
  const run = (method: StatisticalDetectorInput['method'], readings: StatisticalDetectorInput['readings'], config = {}) =>
    runStatisticalDetector({ method, readings, config });

  it('tách theo sensor, tự sắp theo ts, trả kết quả theo thứ tự đầu vào', () => {
    const a = series('A', [...base, 400]);
    const b = series('B', base);
    const shuffled = [...a, ...b].reverse();
    const out = run('zscore', shuffled);
    expect(out.status).toBe('completed');
    expect(out.results.map((r) => r.readingId)).toEqual(shuffled.map((r) => r.id));
    expect(flaggedIds(out.results)).toEqual(['A-r20']);
    expect(out.results.every((r) => r.method === 'zscore' && Number.isFinite(r.score))).toBe(true);
  });

  it('F.9: thiếu dữ liệu -> insufficient_data, không tạo anomaly giả', () => {
    for (const method of ['zscore', 'iqr', 'moving_avg'] as const) {
      const out = run(method, [mk('A', 0, 25.5), mk('A', 1, 150)]);
      expect(out.status).toBe('insufficient_data');
      expect(flaggedIds(out.results)).toEqual([]);
    }
    expect(run('zscore', []).status).toBe('insufficient_data');
  });

  it('F.9: phương sai 0 không sinh NaN hay anomaly', () => {
    const out = run('zscore', series('A', Array(10).fill(30)));
    expect(out.status).toBe('completed');
    expect(out.results.every((r) => r.score === 0 && !r.flagged && r.reason === 'zero_variance')).toBe(true);
  });

  it('invalid_input: sai schema, ngưỡng ≤ 0, id trùng, method lạ', () => {
    expect(run('zscore', [{ ...mk('A', 0, 1), value: -5 }]).status).toBe('invalid_input');
    expect(run('zscore', series('A', base), { threshold: 0 }).status).toBe('invalid_input');
    expect(run('zscore', [mk('A', 0, 1), mk('A', 0, 2)]).message).toMatch(/duplicate/);
    const bad = runStatisticalDetector({ method: 'nope', readings: [], config: {} } as never);
    expect(bad.status).toBe('invalid_input');
    expect(bad.method).toBe('zscore');
    expect(runStatisticalDetector(null as never).status).toBe('invalid_input');
  });

  it('config.threshold / windowSize được áp dụng; mặc định đề xuất có mặt', () => {
    const readings = series('A', [...base, 60]);
    expect(flaggedIds(run('zscore', readings, { threshold: 10 }).results)).toEqual([]);
    expect(flaggedIds(run('zscore', readings, { threshold: 2 }).results)).toContain('A-r20');
    expect(flaggedIds(run('moving_avg', readings, { windowSize: 5, threshold: 4 }).results)).toContain('A-r20');
    expect(DEFAULT_DETECTOR_CONFIG.moving_avg.windowSize).toBe(12);
  });

  it('deterministic: cùng đầu vào cho cùng đầu ra', () => {
    const d = generateSyntheticDataset({ seed: 3, days: 4 });
    const a = run('iqr', d.readings);
    const b = run('iqr', d.readings);
    expect(a).toEqual(b);
  });

  it('chất lượng trên dữ liệu giả lập: Z-score và IQR F1 > 0.85', () => {
    const d = generateSyntheticDataset({ seed: 42, days: 14 });
    for (const method of ['zscore', 'iqr'] as const) {
      expect(evaluate(flaggedIds(run(method, d.readings).results), d.truth).f1).toBeGreaterThan(0.85);
    }
  });
});

describe('buildAnomalyDrafts', () => {
  it('chỉ lấy điểm flagged, đủ field theo contract Anomaly sau khi Backend bổ sung id/run/updatedAt', () => {
    const readings = series('A', [...base, 400]);
    const out = runStatisticalDetector({ method: 'zscore', readings, config: {} });
    const drafts = buildAnomalyDrafts(readings, 'statistical', out.method, out.results);
    expect(drafts).toHaveLength(1);
    const full = { ...drafts[0]!, id: 'anomaly-1', analysisRunId: 'run-1', updatedAt: '2026-11-12T00:00:00.000Z' };
    expect(AnomalySchema.safeParse(full).success).toBe(true);
    expect(drafts[0]).toMatchObject({ status: 'open', version: 1, note: '', family: 'statistical', method: 'zscore' });
  });
  it('bỏ qua readingId không tồn tại', () => {
    expect(buildAnomalyDrafts([], 'ml', 'isolation_forest', [{ readingId: 'x', score: 0.9, flagged: true }])).toEqual([]);
  });
});

describe('proposeSeverity (đề xuất OPEN-04)', () => {
  it('ánh xạ theo family', () => {
    expect(proposeSeverity('statistical', 6)).toBe('high');
    expect(proposeSeverity('statistical', 3.5)).toBe('medium');
    expect(proposeSeverity('statistical', 0.4)).toBe('low');
    expect(proposeSeverity('ml', 0.75)).toBe('high');
    expect(proposeSeverity('ml', 0.62)).toBe('medium');
    expect(proposeSeverity('ml', 0.55)).toBe('low');
  });
});
