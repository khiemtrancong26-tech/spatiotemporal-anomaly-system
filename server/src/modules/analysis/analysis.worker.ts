import type { AnalysisConfig } from '../../config.js';
import { EngineError } from '../../engines/python-runner.js';
import { projectCandidates } from '../../engines/results.js';
import { RunOwnershipLost, type AnalysisRepository } from './analysis.repository.js';
import type { AnalysisEngine, AnalysisTestHooks, RunGuard } from './analysis.types.js';
import { ScoringSummarySchema } from '@pm25/shared-core';

const errorCodes = new Set(['INSUFFICIENT_DATA', 'SCOPE_LIMIT_EXCEEDED', 'ENGINE_INPUT_INVALID', 'ENGINE_OUTPUT_INVALID',
  'ENGINE_UNAVAILABLE', 'ENGINE_TIMEOUT', 'ENGINE_INPUT_LIMIT', 'ENGINE_OUTPUT_LIMIT', 'ENGINE_PROTOCOL_ERROR',
  'MODEL_RUNTIME_MISMATCH', 'MODEL_INTEGRITY_ERROR', 'FEATURE_SCHEMA_MISMATCH', 'INVALID_FEATURES', 'MODEL_TYPE_MISMATCH',
  'INVALID_MODEL_OUTPUT', 'MODEL_UNAVAILABLE', 'MODEL_VERSION_UNAVAILABLE', 'POLICY_VERSION_UNAVAILABLE', 'ENGINE_VERSION_UNAVAILABLE', 'INSUFFICIENT_CONTEXT', 'CONTEXT_LIMIT_EXCEEDED']);
const scopeFailureCodes = new Set(['INSUFFICIENT_DATA', 'SCOPE_LIMIT_EXCEEDED', 'INSUFFICIENT_CONTEXT', 'CONTEXT_LIMIT_EXCEEDED']);

export function createAnalysisWorker(repository: AnalysisRepository, engine: AnalysisEngine, config: AnalysisConfig,
  reportFailure: (stage: string, error: unknown) => void, hooks: AnalysisTestHooks = {}) {
  let closed = false, pumping: Promise<void> | undefined, timer: ReturnType<typeof setInterval> | undefined;
  const active = new Map<Promise<void>, AbortController>();
  async function execute(guard: RunGuard, controller: AbortController) {
    let lost = false, timedOut = false, renewing: Promise<void> | undefined;
    const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, config.timeoutMs); deadline.unref();
    const heartbeat = setInterval(() => {
      if (renewing || controller.signal.aborted) return;
      renewing = repository.renew(guard).then(owned => { if (!owned) { lost = true; controller.abort(); } })
        .catch((error: unknown) => {
          reportFailure('lease_renewal', error);
          lost = true;
          controller.abort();
        }).finally(() => { renewing = undefined; });
    }, config.heartbeatMs); heartbeat.unref();
    try {
      if (guard.attempt > config.maxAttempts) {
        await repository.terminal(guard, { code: 'WORKER_RETRIES_EXHAUSTED', message: 'Analysis exceeded the configured crash recovery attempts.' }); return;
      }
      await hooks.afterClaim?.(guard);
      await repository.cleanup(guard);
      const readings = await repository.readings(guard, controller.signal);
      const ml = guard.run.family === 'ml';
      const context = ml ? await repository.context(guard, readings, controller.signal) : undefined;
      const result = await engine.run(guard, readings, controller.signal, context);
      if (result.engineVersion !== guard.run.engineVersion || result.modelVersion !== guard.run.modelVersion) throw new EngineError('ENGINE_OUTPUT_INVALID', 'Engine version does not match the accepted run.');
      // Rebuild metadata from authoritative scope. Reject nonfinite/duplicate/foreign IDs
      // even when a test double or future engine violates its own adapter contract.
      const candidates = projectCandidates(readings, result.candidates.map(point => ({ readingId: point.readingId, score: point.score, flagged: true })));
      if (ml) {
        if (!Array.isArray(result.scoredReadingIds)) throw new EngineError('ENGINE_OUTPUT_INVALID', 'Missing scored target identities.');
        const summary = ScoringSummarySchema.safeParse(result.scoringSummary), ids = new Set(result.scoredReadingIds), scope = new Set(readings.map(r => r.id));
        if (!summary.success || summary.data.targetCount !== readings.length || !result.scoredReadingIds || ids.size !== result.scoredReadingIds.length ||
          ids.size !== summary.data.scoredCount || [...ids].some(id => !scope.has(id)) || candidates.some(p => !ids.has(p.readingId))) throw new EngineError('ENGINE_OUTPUT_INVALID', 'Invalid ML scoring partition.');
      } else if (result.scoringSummary !== undefined || result.scoredReadingIds !== undefined) throw new EngineError('ENGINE_OUTPUT_INVALID', 'Statistical results must omit scoring summary.');
      for (let offset = 0; offset < candidates.length; offset += config.batchSize) {
        if (controller.signal.aborted) throw new EngineError('ENGINE_ABORTED', 'Analysis stopped.');
        await repository.writeBatch(guard, candidates.slice(offset, offset + config.batchSize));
        await hooks.afterBatch?.(guard, Math.min(offset + config.batchSize, candidates.length));
      }
      if (controller.signal.aborted) throw new EngineError('ENGINE_ABORTED', 'Analysis stopped.');
      await repository.terminal(guard, undefined, result.scoringSummary);
    } catch (error) {
      if (closed || lost || error instanceof RunOwnershipLost) return;
      const code = timedOut ? 'ENGINE_TIMEOUT' : error instanceof EngineError && errorCodes.has(error.code) ? error.code : 'ANALYSIS_FAILED';
      if (!scopeFailureCodes.has(code)) reportFailure('execute', error);
      try { await repository.terminal(guard, { code, message: 'Analysis did not complete. Partial results are not published.' }); }
      catch (failure) { if (!(failure instanceof RunOwnershipLost)) reportFailure('terminal_write', failure); }
    } finally {
      clearTimeout(deadline); clearInterval(heartbeat); await renewing;
    }
  }
  async function pump() {
    while (!closed && active.size < config.concurrency) {
      const guard = await repository.claim(); if (!guard || closed) return;
      const controller = new AbortController();
      const work = execute(guard, controller).catch((error: unknown) => reportFailure('worker_task', error)).finally(() => { active.delete(work); });
      active.set(work, controller);
    }
  }
  function tick() {
    if (closed || pumping) return;
    pumping = pump().catch((error: unknown) => reportFailure('claim', error)).finally(() => { pumping = undefined; });
  }
  return {
    start() { timer = setInterval(tick, config.pollMs); timer.unref(); tick(); },
    async close() {
      closed = true; clearInterval(timer);
      for (const controller of active.values()) controller.abort();
      await pumping; await Promise.allSettled(active.keys());
    },
  };
}
