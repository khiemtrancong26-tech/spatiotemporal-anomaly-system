import type { Db } from 'mongodb';
import { ExplorationMetadataInputSchema, ExplorationMetadataSchema, type ExplorationMetadata } from '@pm25/shared-core';
import { toObjectId } from '../../shared/persistence/mapping.js';
/** Administrative CLI boundary only. No inference from filename or writes to scientific data. */
export async function configureExplorationMetadata(db: Db, datasetId: string, input: unknown): Promise<ExplorationMetadata> {
  const parsed = ExplorationMetadataInputSchema.parse(input), id = toObjectId(datasetId);
  const row = await db.collection('datasets').findOneAndUpdate({ _id: id, status: 'imported' }, [
    { $set: { explorationMetadata: { version: { $add: [{ $ifNull: ['$explorationMetadata.version', 0] }, 1] },
      timeZone: { $literal: parsed.timeZone }, source: 'configured', provenance: { $literal: parsed.provenance }, sampling: { $literal: parsed.sampling } } } },
  ], { returnDocument: 'after', projection: { explorationMetadata: 1 }, maxTimeMS: 5000 });
  if (!row) throw new Error('Dataset must exist and be imported');
  return ExplorationMetadataSchema.parse(row.explorationMetadata);
}
