import type { DatasetReadAccess } from '../datasets/index.js';
import type { AnalysisConfig } from '../../config.js';
import { HttpError } from '../../shared/http/errors.js';
import { requireIdempotencyKey } from '../../shared/idempotency.js';
import { createCursorCodec, listSorts, parsePageQuery, queryFingerprint } from '../../shared/pagination.js';
import { parseUtcTime } from '../../shared/utc-time.js';
import { onlineStatisticalPolicy } from '../../engines/statistical.policy.js';
import type { StatisticalDetectorInput } from '@pm25/shared-core/contracts';
import type { AnalysisRepository } from './analysis.repository.js';
import type { AnalysisEngine, AnalysisTestHooks, DetectionRequest, HistoryQuery } from './analysis.types.js';
import { AnalysisStoreError } from './analysis.errors.js';

async function store<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (!(error instanceof AnalysisStoreError)) throw error;
    const statuses = { REPLICA_SET_REQUIRED: 503, IDEMPOTENCY_PAYLOAD_MISMATCH: 422,
      IDEMPOTENCY_EXPIRED: 409, REQUEST_IN_PROGRESS: 409, ANALYSIS_QUEUE_FULL: 503 };
    throw new HttpError(statuses[error.code], error.code, error.message);
  }
}

export function normalizeDetection(input: DetectionRequest, config: AnalysisConfig): DetectionRequest {
  if (input.family === 'statistical') {
    if (!['zscore', 'iqr', 'moving_avg'].includes(input.method)) throw new HttpError(422, 'INVALID_METHOD', 'Unsupported statistical method.');
    const error = onlineStatisticalPolicy(input.method as StatisticalDetectorInput['method']).validateConfig(input.config);
    if (error) throw new HttpError(422, 'INVALID_CONFIG', error);
  } else if (input.method !== 'isolation_forest' || Object.keys(input.config).length) {
    throw new HttpError(422, 'INVALID_CONFIG', 'ML requires isolation_forest with config {}.');
  }
  const scope = input.scope ?? {};
  if (scope.sensorIds && (!scope.sensorIds.length || scope.sensorIds.length > config.maxSensorIds)) throw new HttpError(422, 'INVALID_SENSOR_SCOPE', 'sensorIds must be nonempty and within the configured limit.');
  const from = parseUtcTime(scope.from), to = parseUtcTime(scope.to);
  if (from && to && from > to) throw new HttpError(422, 'INVALID_TIME_RANGE', 'from must be less than or equal to to.');
  return { ...input, scope: { ...(scope.sensorIds ? { sensorIds: [...scope.sensorIds] } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) } };
}
export function createAnalysisService(repository: AnalysisRepository, datasets: DatasetReadAccess,
  codec: ReturnType<typeof createCursorCodec>, config: AnalysisConfig, engine: AnalysisEngine, hooks: AnalysisTestHooks = {}) {
  return {
    async create(userId: string, key: unknown, request: DetectionRequest) {
      const intent = { userId, key: requireIdempotencyKey(key), operation: 'POST /api/v1/analysis-runs',
        requestHash: queryFingerprint('POST /api/v1/analysis-runs', { payload: request }, '') };
      await store(repository.prepare);
      const replay = await store(() => repository.replay(intent)); if (replay) return replay;
      const input = normalizeDetection(request, config), parent = await datasets.getState(input.datasetId);
      if (!parent) throw new HttpError(404, 'DATASET_NOT_FOUND', 'Dataset does not exist.');
      if (parent.status !== 'imported') throw new HttpError(422, 'DATASET_NOT_READY', 'Dataset is not imported.');
      if (input.scope?.sensorIds && !await repository.sensorsInDataset(parent.id, input.scope.sensorIds)) throw new HttpError(422, 'SENSOR_NOT_IN_DATASET', 'Every sensor must belong to the dataset.');
      if (input.family === 'ml') {
        try { await engine.ready(); } catch { throw new HttpError(503, 'MODEL_UNAVAILABLE', 'The configured PM2.5 model is not ready. No run was accepted.'); }
      }
      const response = await store(() => repository.accept(intent, { ...input, datasetId: parent.id }, engine.metadata(input.family)));
      await hooks.afterAccepted?.((response.body as { data: import('@pm25/shared-core/contracts').AnalysisRun }).data);
      return response;
    },
    async detail(id: string) {
      const run = await repository.get(id), parent = run ? await datasets.getState(run.datasetId) : null;
      if (!run || parent?.status !== 'imported') throw new HttpError(404, 'ANALYSIS_RUN_NOT_FOUND', 'Analysis run is unavailable.');
      return { data: run };
    },
    async history(query: HistoryQuery) {
      const page = parsePageQuery(query, listSorts.analysisRuns, 'createdAt:desc');
      const fingerprint = queryFingerprint('analysis-runs.list', { datasetId: query.datasetId }, page.sort);
      const after = page.cursor ? codec.decode(page.cursor, fingerprint) : undefined;
      if (after && (!/^[a-f\d]{24}$/i.test(after.id) || !Number.isFinite(Date.parse(after.key)) || new Date(after.key).toISOString() !== after.key)) throw new HttpError(400, 'INVALID_CURSOR', 'Cursor is incompatible with this query.');
      const parent = await datasets.getState(query.datasetId);
      const documents = parent?.status === 'imported' ? await repository.list({ datasetId: parent.id,
        direction: page.sort.endsWith(':asc') ? 'asc' : 'desc', limit: page.limit + 1, ...(after ? { after } : {}) }) : [];
      const data = documents.slice(0, page.limit), last = data.at(-1);
      return { data, page: { limit: page.limit, nextCursor: documents.length > page.limit && last ? codec.encode({ key: last.createdAt, id: last.id }, fingerprint) : null } };
    },
  };
}
