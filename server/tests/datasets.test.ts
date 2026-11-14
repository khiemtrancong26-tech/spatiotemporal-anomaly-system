import { describe, expect, it, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import { createDatasetService } from '../src/modules/datasets/datasets.service.js';
import { toDatasetDto } from '../src/modules/datasets/datasets.repository.js';
import { createCursorCodec, queryFingerprint } from '../src/shared/pagination.js';

const codec = createCursorCodec('dataset-tests-signing-key-at-least-32-bytes');
const rows = Array.from({ length: 3 }, (_, index) => ({
  id: new ObjectId().toHexString(), name: `Seed ${index}`, sourceFilename: '[seed] not-imported.csv', status: 'imported' as const,
  createdBy: new ObjectId().toHexString(), createdAt: '2026-11-14T00:00:00.000Z',
}));

describe('dataset service and DTO mapping', () => {
  it('uses a bounded extra row to compute nextCursor and returns a proper empty page', async () => {
    const listImported = vi.fn().mockResolvedValueOnce(rows).mockResolvedValueOnce([]);
    const service = createDatasetService({ listImported }, codec);
    const page = await service.list({ limit: 2 });
    expect(page.data).toEqual(rows.slice(0, 2));
    expect(listImported).toHaveBeenCalledWith({ direction: 'desc', limit: 3 });
    expect(page.page.nextCursor).toBeTypeOf('string');
    const empty = await service.list({ limit: 2, cursor: page.page.nextCursor! });
    expect(empty).toEqual({ data: [], page: { limit: 2, nextCursor: null } });
    expect(listImported).toHaveBeenLastCalledWith({ direction: 'desc', limit: 3,
      after: { id: rows[1]!.id, key: rows[1]!.createdAt },
    });
  });
  it('rejects incompatible sort, malformed boundaries and invalid limits before querying', async () => {
    const listImported = vi.fn().mockResolvedValue([]);
    const service = createDatasetService({ listImported }, codec);
    const fingerprint = queryFingerprint('datasets.list', { status: 'imported' }, 'createdAt:desc');
    for (const boundary of [{ key: 'bad-date', id: rows[0]!.id }, { key: rows[0]!.createdAt, id: 'bad-id' }]) {
      await expect(service.list({ cursor: codec.encode(boundary, fingerprint) })).rejects.toMatchObject({ statusCode: 400 });
    }
    await expect(service.list({ sort: 'createdAt:asc', cursor: codec.encode({ key: rows[0]!.createdAt, id: rows[0]!.id }, fingerprint) }))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(service.list({ limit: 201 })).rejects.toMatchObject({ statusCode: 400 });
    expect(listImported).not.toHaveBeenCalled();
    expect(await service.list({ sort: 'createdAt:asc' })).toEqual({ data: [], page: { limit: 100, nextCursor: null } });
  });
  it('whitelists nested import summary fields without inventing counts or leaking storage metadata', () => {
    const document = { _id: new ObjectId(), createdBy: new ObjectId(), createdAt: new Date(rows[0]!.createdAt),
      name: 'Seed', sourceFilename: '[seed] sample.csv', status: 'imported' as const,
      importSummary: { totalRows: 2, importedRows: 1, duplicateRows: 1, conflictingRows: 0, invalidRows: 0,
        issues: [{ rowNumber: 2, reason: 'DUPLICATE_SAME_VALUE' as const, field: 'value', keptRowNumber: 1, rawPassword: 'private' }],
        storagePath: 'private-path',
      },
      storagePath: 'internal-file',
    };
    const dto = toDatasetDto(document);
    expect(dto.importSummary?.issues).toEqual([{ rowNumber: 2, reason: 'DUPLICATE_SAME_VALUE', field: 'value', keptRowNumber: 1 }]);
    expect(JSON.stringify(dto)).not.toMatch(/private|storagePath|internal-file|rawPassword/);
    expect(dto).not.toHaveProperty('_id');
    expect(dto.status).toBe('imported');
  });
});
