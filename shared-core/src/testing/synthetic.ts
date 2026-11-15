import type { Reading } from '../contracts/index.js';
import { createRng, gaussian } from '../utils/random.js';

export interface SyntheticOptions {
  sensors?: number;
  days?: number;
  stepMinutes?: number;
  /** Tỉ lệ điểm bị chèn bất thường (mặc định 0.01). */
  anomalyRate?: number;
  seed?: number;
  start?: string;
  datasetId?: string;
}

export interface SyntheticDataset {
  readings: Reading[];
  /** Tập `Reading.id` của các điểm bất thường thật (ground truth). */
  truth: Set<string>;
}

/**
 * Sinh dữ liệu PM2.5 GIẢ LẬP đúng hợp đồng `Reading`: nền theo sensor + chu kỳ ngày + nhiễu AR(1)
 * + yếu tố chung toàn thành phố (tương quan không gian) + bất thường có nhãn
 * (75% đột biến tăng, 25% rơi đột ngột kiểu cảm biến lỗi).
 */
export function generateSyntheticDataset(options: SyntheticOptions = {}): SyntheticDataset {
  const nSensors = options.sensors ?? 8;
  const days = options.days ?? 14;
  const step = options.stepMinutes ?? 60;
  const rate = options.anomalyRate ?? 0.01;
  const datasetId = options.datasetId ?? 'synthetic-dataset';
  const rng = createRng(options.seed ?? 1);
  const t0 = Date.parse(options.start ?? '2026-10-01T00:00:00Z');

  const sensors = Array.from({ length: nSensors }, (_, i) => ({
    id: `sensor-${String(i + 1).padStart(2, '0')}`,
    base: 25 + rng() * 20,
    lat: 10.7 + rng() * 0.15,
    lng: 106.6 + rng() * 0.15,
    ar: 0,
  }));

  const readings: Reading[] = [];
  const truth = new Set<string>();
  const steps = Math.floor((days * 24 * 60) / step);
  let city = 0;
  let n = 0;

  for (let k = 0; k < steps; k++) {
    const t = t0 + k * step * 60_000;
    const d = new Date(t);
    const ts = d.toISOString();
    const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
    const diurnal = 8 * Math.sin((2 * Math.PI * (hour - 3)) / 24) + 4 * Math.exp(-((hour - 1) ** 2) / 4);
    city = 0.9 * city + gaussian(rng) * 1.5;

    for (const s of sensors) {
      s.ar = 0.7 * s.ar + gaussian(rng) * 2.5;
      let v = Math.max(1, s.base + diurnal + city + s.ar);
      const id = `reading-${++n}`;
      if (rng() < rate) {
        v = rng() < 0.75 ? v + 35 + rng() * 85 : Math.max(0, v * 0.15);
        truth.add(id);
      }
      readings.push({
        id,
        datasetId,
        sensorId: s.id,
        ts,
        location: { type: 'Point', coordinates: [s.lng, s.lat] },
        value: Math.min(1000, Math.round(v * 10) / 10),
        unit: 'ug/m3',
      });
    }
  }
  return { readings, truth };
}
