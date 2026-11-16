import type { Anomaly, Reading } from '../../shared/api/generated/wire';
import type { OnlineDataSource } from '../../shared/data-source/types';

export interface InvestigationTarget {
  datasetId: string; analysisRunId?: string; anomalyId?: string;
  readingId: string; sensorId: string; ts: string;
  location: { type: 'Point'; coordinates: number[] }; preferredMode: 'map' | 'cube';
}
export const targetFromAnomaly = (item: Anomaly, preferredMode: 'map' | 'cube'): InvestigationTarget => ({ datasetId: item.datasetId, analysisRunId: item.analysisRunId, anomalyId: item.id, readingId: item.readingId, sensorId: item.sensorId, ts: item.ts, location: item.location, preferredMode });

/** Verify identity, never substitute a nearby sample. Bounded even if a server has many rows at T. */
export async function resolveInvestigation(load: OnlineDataSource['readings']['list'], target: InvestigationTarget, signal: AbortSignal): Promise<Reading> {
  let cursor: string | undefined, read = 0;
  const seen = new Set<string>();
  while (read < 2000) {
    const page = await load({ datasetId: target.datasetId, sensorId: target.sensorId, from: target.ts, to: target.ts, sort: 'ts:asc', limit: 100, cursor }, { signal });
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    read += page.data.length;
    const row = page.data.find(r => r.id === target.readingId);
    if (row) {
      if (row.datasetId !== target.datasetId || row.sensorId !== target.sensorId || Date.parse(row.ts) !== Date.parse(target.ts)) throw new Error('Reading trả về không khớp dataset, trạm hoặc thời điểm yêu cầu.');
      return row;
    }
    if (!page.page.nextCursor) throw new Error('Không tìm thấy reading tương ứng trong kết quả truy vấn. Không chọn phép đo gần đúng.');
    if (seen.has(page.page.nextCursor)) throw new Error('Cursor lặp; chưa thể xác minh reading.');
    seen.add(page.page.nextCursor); cursor = page.page.nextCursor;
    if (!page.data.length) break;
  }
  throw new Error('Đã chạm ngân sách xác minh 2.000 readings; phạm vi chưa tải hết.');
}
