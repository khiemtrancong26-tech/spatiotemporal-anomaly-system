import { ObjectId, type Document, type Filter } from 'mongodb';

/** Repository-only helper. Services/routes pass DTO cursors, never BSON queries. */
export function keysetPredicate(
  field: 'ts' | 'createdAt' | 'externalId' | 'usernameNormalized',
  direction: 'asc' | 'desc',
  last: { key: Date | string; id: ObjectId },
): Filter<Document> {
  const operator = direction === 'asc' ? '$gt' : '$lt';
  return { $or: [{ [field]: { [operator]: last.key } }, { [field]: last.key, _id: { [operator]: last.id } }] };
}
