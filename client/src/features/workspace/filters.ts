import type { Bbox } from '../../shared/data-source/types';
import type { WorkspaceFilters } from './state';

/** datetime-local value is explicitly interpreted in UTC+07, never in the machine timezone. */
export function vietnamTimeToUtc(value: string): string | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) throw new Error('Ngày giờ chưa đúng định dạng.');
  const local = value.length === 16 ? `${value}:00` : value;
  const date = new Date(`${local}+07:00`);
  if (Number.isNaN(date.getTime()) || new Date(date.getTime() + 7 * 3600_000).toISOString().slice(0, 19) !== local) {
    throw new Error('Ngày giờ không hợp lệ.');
  }
  return date.toISOString();
}

export function parseWorkspaceFilters(input: { sensorId: string; bbox: string; from: string; to: string }): WorkspaceFilters {
  const from = vietnamTimeToUtc(input.from);
  const to = vietnamTimeToUtc(input.to);
  if (from && to && from > to) throw new Error('Thời gian bắt đầu phải trước hoặc bằng thời gian kết thúc.');
  let bbox: Bbox | undefined;
  if (input.bbox.trim()) {
    const parts = input.bbox.split(',').map((part) => part.trim());
    if (parts.length !== 4 || parts.some((part) => part === '')) throw new Error('Vùng cần đủ bốn tọa độ west,south,east,north.');
    const values = parts.map(Number);
    const [west, south, east, north] = values;
    if (!values.every(Number.isFinite) || west < -180 || east > 180 || south < -90 || north > 90 || west > east || south > north) {
      throw new Error('Tọa độ vùng không hợp lệ.');
    }
    bbox = [west, south, east, north];
  }
  return { sensorId: input.sensorId.trim() || undefined, bbox, from, to };
}
