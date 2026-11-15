import {
  StatisticalDetectorInputSchema,
  StatisticalMethodSchema,
  type Anomaly,
  type Reading,
  type StatisticalDetectorInput,
  type StatisticalDetectorOutput,
} from '../contracts/index.js';
import { proposeSeverity } from '../severity.js';
import { detectIQR } from './iqr.js';
import { detectMovingAverage } from './movingAverage.js';
import type { DetectorMethod, SeriesResult } from './types.js';
import { detectZScore } from './zscore.js';

/**
 * Cấu hình mặc định ĐỀ XUẤT (OPEN-04 chưa chốt). `threshold` của IQR là hệ số Tukey k.
 * Được chỉnh trên dữ liệu giả lập; cần hiệu chỉnh lại khi có dữ liệu PM2.5 thật.
 */
export const DEFAULT_DETECTOR_CONFIG = {
  zscore: { threshold: 3 },
  iqr: { threshold: 1.5 },
  moving_avg: { threshold: 4, windowSize: 12 },
} as const satisfies Record<DetectorMethod, { threshold: number; windowSize?: number }>;

function runSeries(method: DetectorMethod, values: number[], config: StatisticalDetectorInput['config']): SeriesResult {
  switch (method) {
    case 'zscore':
      return detectZScore(values, { threshold: config.threshold });
    case 'iqr':
      return detectIQR(values, { threshold: config.threshold });
    case 'moving_avg':
      return detectMovingAverage(values, { threshold: config.threshold, windowSize: config.windowSize });
  }
}

function invalid(input: unknown, message: string): StatisticalDetectorOutput {
  const m = StatisticalMethodSchema.safeParse((input as { method?: unknown } | null)?.method);
  return { method: m.success ? m.data : 'zscore', status: 'invalid_input', results: [], message };
}

/**
 * Detector thống kê quyết định (deterministic), dùng chung Server và Web Worker.
 *
 * - Tự nhóm theo `sensorId`, sắp theo `ts`; đầu vào không cần sắp xếp.
 * - Trả về MỘT kết quả cho MỖI reading, theo thứ tự đầu vào (Backend chỉ lưu `flagged = true`).
 * - `insufficient_data`: không sensor nào đủ điểm để đánh giá (không tạo anomaly giả).
 * - `invalid_input`: đầu vào sai schema, ngưỡng ≤ 0 hoặc trùng `readingId`.
 * - Score luôn hữu hạn; phương sai bằng 0 -> score 0, `reason: 'zero_variance'`.
 */
export function runStatisticalDetector(input: StatisticalDetectorInput): StatisticalDetectorOutput {
  const parsed = StatisticalDetectorInputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return invalid(input, `${issue?.path.join('.') || 'input'}: ${issue?.message ?? 'invalid'}`);
  }
  const { method, readings, config } = parsed.data;

  if (config.threshold !== undefined && config.threshold <= 0) {
    return invalid(input, 'config.threshold must be > 0');
  }
  const ids = new Set(readings.map((r) => r.id));
  if (ids.size !== readings.length) return invalid(input, 'readings contain duplicate id');

  const bySensor = new Map<string, Reading[]>();
  for (const r of readings) {
    const list = bySensor.get(r.sensorId);
    if (list) list.push(r);
    else bySensor.set(r.sensorId, [r]);
  }

  const byId = new Map<string, StatisticalDetectorOutput['results'][number]>();
  let evaluated = 0;
  for (const list of bySensor.values()) {
    list.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts) || a.id.localeCompare(b.id));
    const series = runSeries(method, list.map((r) => r.value), config);
    for (const p of series.points) {
      if (p.evaluated) evaluated++;
      const score = Number.isFinite(p.score) ? p.score : 0;
      byId.set(list[p.index]!.id, {
        readingId: list[p.index]!.id,
        method,
        score,
        flagged: p.isAnomaly,
        ...(p.reason ? { reason: p.reason } : {}),
      });
    }
  }

  const results = readings.map((r) => byId.get(r.id)!);
  if (evaluated === 0) {
    return { method, status: 'insufficient_data', results, message: 'Not enough readings per sensor to evaluate' };
  }
  return { method, status: 'completed', results };
}

export type AnomalyDraft = Omit<Anomaly, 'id' | 'analysisRunId' | 'updatedAt'>;

export interface FlaggedPoint {
  readingId: string;
  score: number;
  flagged: boolean;
}

/**
 * Dựng bản nháp Anomaly từ các điểm `flagged` (thống kê hoặc ML). Backend bổ sung
 * `id`, `analysisRunId`, `updatedAt` rồi lưu. Review mặc định: `open`, `version: 1`, `note: ''`.
 */
export function buildAnomalyDrafts(
  readings: readonly Reading[],
  family: 'statistical' | 'ml',
  method: string,
  points: readonly FlaggedPoint[],
): AnomalyDraft[] {
  const byId = new Map(readings.map((r) => [r.id, r]));
  const drafts: AnomalyDraft[] = [];
  for (const p of points) {
    if (!p.flagged) continue;
    const r = byId.get(p.readingId);
    if (!r) continue;
    drafts.push({
      datasetId: r.datasetId,
      sensorId: r.sensorId,
      readingId: r.id,
      ts: r.ts,
      location: r.location,
      family,
      method,
      score: p.score,
      severity: proposeSeverity(family, p.score),
      status: 'open',
      note: '',
      version: 1,
    });
  }
  return drafts;
}
