import type { Bbox } from '../../shared/data-source/types';
import type { WorkspaceFilters } from './state';
import { explorationUtcTime, type ExplorationTimeZone } from '@pm25/shared-core';

/** datetime-local value is explicitly interpreted in UTC+07, never in the machine timezone. */
export function vietnamTimeToUtc(value: string): string | undefined {
  return value ? explorationUtcTime(value, '+07:00') : undefined;
}

export function parseWorkspaceFilters(input: { sensorId: string; bbox: string; from: string; to: string }, zone: ExplorationTimeZone = '+07:00'): WorkspaceFilters {
  const from = input.from ? explorationUtcTime(input.from, zone) : undefined;
  const to = input.to ? explorationUtcTime(input.to, zone) : undefined;
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
