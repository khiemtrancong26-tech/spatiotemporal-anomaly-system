import { conforms } from '../../shared/api/validation';
import type { DetectionRequest } from '../../shared/api/generated/wire';
export interface Intent { key: string; body: DetectionRequest; createdAt: number; runId?: string }
export function readIntent(storage: Pick<Storage, 'getItem'>, key: string): Intent | undefined {
  try {
    const value = JSON.parse(storage.getItem(key) ?? 'null');
    if (value && typeof value.key === 'string' && /^[0-9a-f-]{36}$/i.test(value.key) && Number.isFinite(value.createdAt) && (value.runId === undefined || typeof value.runId === 'string') && conforms(value.body, { $ref: '#/components/schemas/DetectionRequest' })) return value;
  } catch { /* Invalid storage is not an instruction to resend. */ }
}
export function canReplay(intent: Intent, windowMs: number | undefined, now = Date.now()) {
  return windowMs !== undefined && now >= intent.createdAt && now - intent.createdAt < windowMs;
}
