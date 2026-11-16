import type { AnalysisRun, DetectionRequest, Sensor } from '../../shared/api/generated/wire';
import type { WorkspaceFilters } from './state';

export type AnalysisScope = NonNullable<DetectionRequest['scope']>;
export const METHODS = {
  zscore: { name: 'Z-score', family: 'statistical', config: { threshold: 3 }, description: 'Giá trị lệch mạnh khỏi phân bố PM2.5 của từng trạm trong phạm vi.', setting: 'Ngưỡng cố định |Z| > 3', score: '|Z|' },
  iqr: { name: 'IQR', family: 'statistical', config: { multiplier: 1.5 }, description: 'Giá trị nằm ngoài khoảng giới hạn tứ phân vị của từng trạm.', setting: 'Hệ số cố định 1,5', score: 'Khoảng vượt fence · µg/m³' },
  isolation_forest: { name: 'Isolation Forest', family: 'ml', config: {}, description: 'Model baseline so sánh giá trị PM2.5 với phân bố đã học. Chưa được đánh giá cho bất thường không gian–thời gian.', setting: 'Model value-only do Server quản lý', score: 'Model score · −decision_function' },
} as const;
export type Method = keyof typeof METHODS;
export const methodName = (method: string) => METHODS[method as Method]?.name ?? method;
export const scoreLabel = (method: string) => METHODS[method as Method]?.score ?? `Score · ${method}`;
export const number = (value: number | null | undefined, digits = 2) => value == null ? '—' : value.toLocaleString('vi-VN', { maximumFractionDigits: digits });
export const shortId = (id: string) => id.length > 12 ? `…${id.slice(-8)}` : id;
export const sensorName = (id: string, sensors: Sensor[]) => sensors.find(s => s.id === id)?.name ?? id;
export const scopeFromFilters = (filters: WorkspaceFilters): AnalysisScope => ({ ...(filters.sensorId ? { sensorIds: [filters.sensorId] } : {}), ...(filters.from ? { from: filters.from } : {}), ...(filters.to ? { to: filters.to } : {}) });
export const scopeKey = (scope: AnalysisScope) => JSON.stringify([scope.sensorIds ? [...scope.sensorIds].sort() : null, scope.from ?? null, scope.to ?? null]);
export function runScope(run: AnalysisRun): AnalysisScope { return run.scope ?? {}; }
