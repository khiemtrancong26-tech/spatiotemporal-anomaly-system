import { HttpError } from '../../shared/http/errors.js';
import { createCursorCodec, listSorts, parsePageQuery, queryFingerprint } from '../../shared/pagination.js';
import type { DatasetListQuery, DatasetRepository } from './datasets.types.js';

export function createDatasetService(repository: DatasetRepository, codec: ReturnType<typeof createCursorCodec>) {
  return {
    async list(query: DatasetListQuery) {
      const page = parsePageQuery(query, listSorts.datasets, 'createdAt:desc');
      const fingerprint = queryFingerprint('datasets.list', { status: 'imported' }, page.sort);
      const after = page.cursor ? codec.decode(page.cursor, fingerprint) : undefined;
      if (after && (!/^[0-9a-f]{24}$/i.test(after.id) || !Number.isFinite(Date.parse(after.key)) || new Date(after.key).toISOString() !== after.key)) {
        throw new HttpError(400, 'INVALID_CURSOR', 'Cursor is invalid or incompatible with this query.');
      }
      const documents = await repository.listImported({ direction: page.sort.endsWith(':asc') ? 'asc' : 'desc', limit: page.limit + 1,
        ...(after ? { after } : {}),
      });
      const data = documents.slice(0, page.limit);
      const last = data.at(-1);
      const nextCursor = documents.length > page.limit && last ? codec.encode({ key: last.createdAt, id: last.id }, fingerprint) : null;
      return { data, page: { limit: page.limit, nextCursor } };
    },
  };
}
