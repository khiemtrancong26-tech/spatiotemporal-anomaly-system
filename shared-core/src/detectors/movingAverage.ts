import { mean, sampleStd } from './stats.js';
import type { SeriesResult } from './types.js';

export interface MovingAverageOptions {
  /** Số điểm lịch sử đứng trước dùng làm cửa sổ (mặc định 12, tối thiểu 2). */
  windowSize?: number;
  /** Ngưỡng |z| so với cửa sổ (mặc định 4). */
  threshold?: number;
  /** Sàn độ lệch chuẩn (µg/m³) để tránh chia ~0 khi cửa sổ phẳng (mặc định 3). */
  minStd?: number;
}

/**
 * So sánh mỗi điểm với trung bình / độ lệch chuẩn mẫu của `windowSize` điểm đứng TRƯỚC nó
 * (không gồm chính nó). `windowSize` điểm đầu chưa đủ lịch sử -> evaluated=false.
 */
export function detectMovingAverage(values: readonly number[], options: MovingAverageOptions = {}): SeriesResult {
  const windowSize = Math.max(2, Math.floor(options.windowSize ?? 12));
  const threshold = options.threshold ?? 4;
  const minStd = options.minStd ?? 3;

  const points = values.map((value, index) => {
    if (index < windowSize) {
      return { index, value, score: 0, evaluated: false, isAnomaly: false, reason: 'insufficient_history' as const };
    }
    const hist = values.slice(index - windowSize, index);
    const mu = mean(hist);
    const sigma = Math.max(sampleStd(hist, mu), minStd);
    const score = Math.abs(value - mu) / sigma;
    return { index, value, score, evaluated: true, isAnomaly: score > threshold };
  });
  return { method: 'moving_avg', points, meta: { windowSize, threshold, minStd } };
}
