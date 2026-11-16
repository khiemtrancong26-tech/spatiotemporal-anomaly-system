import type { DatasetReadAccess } from '../datasets/index.js';
import type { AnalysisReadAccess } from '../analysis/index.js';
import { HttpError } from '../../shared/http/errors.js';
import { createCursorCodec, listSorts, parsePageQuery, queryFingerprint } from '../../shared/pagination.js';
import { parseUtcTime } from '../../shared/utc-time.js';
import type { AnomalyRepository } from './anomalies.repository.js';
import type { AnomaliesQuery, AnomalyFilters, ReviewRequest } from './anomalies.types.js';

/** Public domain review boundary; no HTTP/Sync transport or offline ledger here. */
export function createAnomalyReviewService(repository: AnomalyRepository) {
  return {
    async review(id: string, request: ReviewRequest) {
      if (!Number.isSafeInteger(request.baseVersion) || request.baseVersion < 1) throw new HttpError(422, 'INVALID_VERSION', 'baseVersion must be a positive safe integer.');
      // Validate at the reusable service boundary as well as the HTTP schema.
      const changes = request.changes;
      if (!changes || typeof changes !== 'object' || Array.isArray(changes) || Object.keys(changes).some(key => !['status', 'note'].includes(key)) ||
          (changes.status === undefined && changes.note === undefined) ||
          (changes.status !== undefined && !['open', 'confirmed', 'false_positive'].includes(changes.status)) ||
          (changes.note !== undefined && typeof changes.note !== 'string')) throw new HttpError(422, 'INVALID_REVIEW', 'Review changes must contain only status and/or note.');
      const outcome = await repository.review(id, { baseVersion: request.baseVersion,
        changes: { ...(changes.status !== undefined ? { status: changes.status } : {}), ...(changes.note !== undefined ? { note: changes.note } : {}) } });
      if (outcome.kind === 'not-found') throw new HttpError(404, 'ANOMALY_NOT_FOUND', 'Anomaly is unavailable.');
      if (outcome.kind === 'conflict') throw new HttpError(409, 'VERSION_CONFLICT', 'Review changed. Read the current anomaly before saving again.', { currentVersion: outcome.currentVersion });
      if (outcome.kind === 'version-exhausted') throw new HttpError(422, 'VERSION_LIMIT_REACHED', 'Review version cannot be incremented safely.');
      return { data: outcome.data };
    },
  };
}
export function createAnomalyService(repository: AnomalyRepository, datasets: DatasetReadAccess,
  runs: AnalysisReadAccess, codec: ReturnType<typeof createCursorCodec>) {
  return {
    ...createAnomalyReviewService(repository),
    async detail(id: string) {
      const data = await repository.get(id);
      if (!data) throw new HttpError(404, 'ANOMALY_NOT_FOUND', 'Anomaly is unavailable.');
      return { data };
    },
    async list(query: AnomaliesQuery) {
      const page = parsePageQuery(query, listSorts.anomalies, 'ts:asc');
      const from = parseUtcTime(query.from), to = parseUtcTime(query.to);
      if (from && to && from > to) throw new HttpError(422, 'INVALID_TIME_RANGE', 'from must be less than or equal to to.');
      const parent = await datasets.getState(query.datasetId);
      if (!parent) throw new HttpError(422, 'DATASET_NOT_FOUND', 'Dataset does not exist.');
      if (parent.status !== 'imported') throw new HttpError(422, 'DATASET_NOT_READY', 'Dataset is not imported.');
      let runId: string | undefined;
      if (query.analysisRunId !== undefined) {
        const run = await runs.getState(query.analysisRunId);
        if (!run) throw new HttpError(422, 'ANALYSIS_RUN_NOT_FOUND', 'Analysis run does not exist.');
        if (run.datasetId !== parent.id) throw new HttpError(422, 'ANALYSIS_RUN_NOT_IN_DATASET', 'Analysis run belongs to a different dataset.');
        if (run.status !== 'completed') throw new HttpError(409, 'ANALYSIS_NOT_READY', 'Analysis run results are not published.');
        runId = run.id;
      }
      const filters: AnomalyFilters = { datasetId: parent.id, ...(runId ? { analysisRunId: runId } : {}),
        ...(query.status !== undefined ? { status: query.status } : {}), ...(query.severity !== undefined ? { severity: query.severity } : {}),
        ...(query.family !== undefined ? { family: query.family } : {}), ...(query.method !== undefined ? { method: query.method } : {}),
        ...(from ? { from } : {}), ...(to ? { to } : {}) };
      const fingerprint = queryFingerprint('anomalies.list', { ...filters }, page.sort);
      const after = page.cursor ? codec.decode(page.cursor, fingerprint) : undefined;
      if (after && (!/^[\da-f]{24}$/i.test(after.id) || !Number.isFinite(Date.parse(after.key)) || new Date(after.key).toISOString() !== after.key)) throw new HttpError(400, 'INVALID_CURSOR', 'Cursor is invalid for this query.');
      const documents = await repository.list({ ...filters, direction: page.sort.endsWith(':asc') ? 'asc' : 'desc', limit: page.limit + 1, ...(after ? { after } : {}) });
      const data = documents.slice(0, page.limit), last = data.at(-1);
      return { data, page: { limit: page.limit, nextCursor: documents.length > page.limit && last ? codec.encode({ key: last.ts, id: last.id }, fingerprint) : null } };
    },
  };
}
