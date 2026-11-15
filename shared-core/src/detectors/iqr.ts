import { quantileSorted } from './stats.js';
import type { SeriesResult } from './types.js';

export const IQR_MIN_POINTS = 4;

export interface IqrOptions {
  /** Hệ số Tukey k (mặc định 1.5). Trong contract đây là `config.threshold`. */
  threshold?: number;
}

/**
 * IQR / hàng rào Tukey: bất thường nếu < Q1 - k·IQR hoặc > Q3 + k·IQR.
 * Score = khoảng cách vượt hàng rào tính theo đơn vị IQR (0 nếu trong hàng rào);
 * khi IQR = 0, score = khoảng cách tuyệt đối (luôn hữu hạn).
 */
export function detectIQR(values: readonly number[], options: IqrOptions = {}): SeriesResult {
  const k = options.threshold ?? 1.5;
  if (values.length < IQR_MIN_POINTS) {
    return {
      method: 'iqr',
      points: values.map((value, index) => ({
        index, value, score: 0, evaluated: false, isAnomaly: false, reason: 'insufficient_history' as const,
      })),
      meta: { k },
    };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantileSorted(sorted, 0.25);
  const q3 = quantileSorted(sorted, 0.75);
  const iqr = q3 - q1;
  const lower = q1 - k * iqr;
  const upper = q3 + k * iqr;
  const points = values.map((value, index) => {
    const dist = value < lower ? lower - value : value > upper ? value - upper : 0;
    const score = iqr > 0 ? dist / iqr : dist;
    return { index, value, score, evaluated: true, isAnomaly: dist > 0 };
  });
  return { method: 'iqr', points, meta: { q1, q3, iqr, lower, upper, k } };
}
