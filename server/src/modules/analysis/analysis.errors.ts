export type AnalysisStoreCode = 'REPLICA_SET_REQUIRED' | 'IDEMPOTENCY_PAYLOAD_MISMATCH' |
  'IDEMPOTENCY_EXPIRED' | 'REQUEST_IN_PROGRESS' | 'ANALYSIS_QUEUE_FULL';
/** Repository reports domain outcomes; HTTP mapping belongs to the Service boundary. */
export class AnalysisStoreError extends Error {
  constructor(readonly code: AnalysisStoreCode, message: string) { super(message); }
}
