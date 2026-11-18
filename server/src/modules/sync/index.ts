import type { FastifyPluginAsync } from 'fastify';
import type { ReviewConfig } from '../../config.js';
import type { DatasetWriteScheduler } from '../datasets/dataset-write.js';
import { anomalySchema, createAnomalyReviewAccess, reviewRequestSchema, type ReviewRequest } from '../anomalies/index.js';
import { errorSchema, HttpError } from '../../shared/http/errors.js';

type Mutation = ReviewRequest & { clientMutationId: string; anomalyId: string; createdAt: string };
const mutationId = { type: 'string', minLength: 1, maxLength: 128 } as const;
const body = {
  type: 'object', additionalProperties: false, required: ['mutations'],
  properties: { mutations: { type: 'array', minItems: 1, maxItems: 100, items: {
    type: 'object', additionalProperties: false, required: ['clientMutationId', 'anomalyId', 'baseVersion', 'changes', 'createdAt'],
    properties: { ...reviewRequestSchema.properties, clientMutationId: mutationId, anomalyId: { type: 'string', minLength: 1 }, createdAt: { type: 'string', format: 'date-time' } },
  } } },
} as const;
const response = {
  type: 'object', additionalProperties: false, required: ['results'],
  properties: { results: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['clientMutationId', 'outcome'],
    properties: { clientMutationId: mutationId, outcome: { type: 'string', enum: ['applied', 'duplicate', 'conflict', 'rejected'] }, anomaly: anomalySchema, error: errorSchema },
  } } },
} as const;

export const syncRoutes: FastifyPluginAsync<{ review: ReviewConfig; schedule: DatasetWriteScheduler }> = async (app, options) => {
  const review = createAnomalyReviewAccess(app.mongo.client, app.mongo.db, options.review, options.schedule);
  app.post<{ Body: { mutations: Mutation[] } }>('/review-mutation-batches', {
    onRequest: app.authorize(['analyst', 'admin']),
    schema: { body, response: { 200: response, 400: errorSchema, 401: errorSchema, 403: errorSchema, 422: errorSchema, 500: errorSchema, 503: errorSchema } },
  }, async request => {
    async function process({ clientMutationId, anomalyId, createdAt, ...patch }: Mutation) {
      const result = { clientMutationId };
      const reject = (code: string, message: string) => ({ ...result, outcome: 'rejected', error: { error: { code, message } } });
      try {
        const outcome = await review.syncReview(anomalyId, patch, request.principal!, clientMutationId, createdAt);
        switch (outcome.kind) {
          case 'updated': return { ...result, outcome: 'applied', anomaly: outcome.data };
          case 'duplicate': return { ...result, outcome: 'duplicate' };
          case 'conflict': return { ...result, outcome: 'conflict', error: { error: {
            code: 'VERSION_CONFLICT', message: 'Review changed. Read the current anomaly before saving again.', details: { currentVersion: outcome.currentVersion },
          } } };
          case 'mutation-reused': return reject('MUTATION_ID_REUSED', 'This mutation ID already has a different payload.');
          case 'version-exhausted': return reject('VERSION_LIMIT_REACHED', 'Review version cannot be incremented safely.');
          case 'not-found': return reject('ANOMALY_NOT_FOUND', 'Anomaly is unavailable.');
        }
      } catch (error) {
        if (error instanceof HttpError) return reject(error.code, error.message);
        throw error;
      }
    }
    const results = [];
    for (const mutation of request.body.mutations) results.push(await process(mutation));
    return { results };
  });
};
