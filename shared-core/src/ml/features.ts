import type { Reading } from '../contracts/index.js';
import { mean, std } from '../detectors/stats.js';

/** Thứ tự feature - PHẢI khớp model artifact (được kiểm tra khi nạp model). */
export const FEATURE_NAMES = [
  'value',
  'delta_prev',
  'rolling_dev',
  'hour_sin',
  'hour_cos',
  'spatial_dev',
] as const;

export interface FeatureRow {
  readingId: string;
  sensorId: string;
  ts: string;
  value: number;
  features: number[];
}

export interface FeatureOptions {
  /** Số điểm lịch sử cho rolling_dev (mặc định 6). */
  window?: number;
}

const HOUR_MS = 3_600_000;

/**
 * Dựng vector đặc trưng không gian - thời gian cho từng Reading:
 *  - value: PM2.5 (µg/m³)
 *  - delta_prev: chênh lệch so với điểm liền trước của cùng sensor
 *  - rolling_dev: độ lệch (đơn vị std) so với `window` điểm trước
 *  - hour_sin/cos: chu kỳ ngày (giờ UTC)
 *  - spatial_dev: chênh lệch so với trung bình các sensor khác cùng khung giờ
 * Kết quả sắp theo sensor rồi theo thời gian.
 */
export function buildFeatures(readings: readonly Reading[], options: FeatureOptions = {}): FeatureRow[] {
  const window = Math.max(2, Math.floor(options.window ?? 6));

  const buckets = new Map<number, { sum: number; count: number }>();
  const bySensor = new Map<string, Reading[]>();
  for (const r of readings) {
    const key = Math.floor(Date.parse(r.ts) / HOUR_MS);
    const b = buckets.get(key);
    if (b) {
      b.sum += r.value;
      b.count++;
    } else buckets.set(key, { sum: r.value, count: 1 });

    const list = bySensor.get(r.sensorId);
    if (list) list.push(r);
    else bySensor.set(r.sensorId, [r]);
  }

  const rows: FeatureRow[] = [];
  for (const [sensorId, list] of bySensor) {
    list.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts) || a.id.localeCompare(b.id));
    for (let i = 0; i < list.length; i++) {
      const r = list[i]!;
      const t = Date.parse(r.ts);
      const delta = i > 0 ? r.value - list[i - 1]!.value : 0;

      let rollingDev = 0;
      if (i >= 3) {
        const hist = list.slice(Math.max(0, i - window), i).map((x) => x.value);
        rollingDev = (r.value - mean(hist)) / Math.max(std(hist), 1);
      }

      const d = new Date(t);
      const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
      const angle = (2 * Math.PI * hour) / 24;

      const b = buckets.get(Math.floor(t / HOUR_MS))!;
      const spatialDev = b.count > 1 ? r.value - (b.sum - r.value) / (b.count - 1) : 0;

      rows.push({
        readingId: r.id,
        sensorId,
        ts: r.ts,
        value: r.value,
        features: [r.value, delta, rollingDev, Math.sin(angle), Math.cos(angle), spatialDev],
      });
    }
  }
  return rows;
}
