import { mean, std } from './stats.js';
import type { SeriesResult } from './types.js';

export const ZSCORE_MIN_POINTS = 3;

export interface ZScoreOptions {
  /** Ngưỡng |z| (mặc định 3). */
  threshold?: number;
}

/** Z-score trên toàn chuỗi một sensor (độ lệch chuẩn tổng thể). Score = |z|. */
export function detectZScore(values: readonly number[], options: ZScoreOptions = {}): SeriesResult {
  const threshold = options.threshold ?? 3;
  if (values.length < ZSCORE_MIN_POINTS) {
    return {
      method: 'zscore',
      points: values.map((value, index) => ({
        index, value, score: 0, evaluated: false, isAnomaly: false, reason: 'insufficient_history' as const,
      })),
      meta: { threshold },
    };
  }
  const mu = mean(values);
  const sigma = std(values, mu);
  const flat = !(sigma > 0);
  const points = values.map((value, index) => {
    if (flat) {
      return { index, value, score: 0, evaluated: true, isAnomaly: false, reason: 'zero_variance' as const };
    }
    const score = Math.abs(value - mu) / sigma;
    return { index, value, score, evaluated: true, isAnomaly: score > threshold };
  });
  return { method: 'zscore', points, meta: { mean: mu, std: sigma, threshold } };
}
