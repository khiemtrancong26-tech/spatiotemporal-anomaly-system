import { ObjectId } from 'mongodb';
import type { Principal } from '../../plugins/auth.js';
export type DatasetActor = Pick<Principal, 'id' | 'role'>;
/** One fail-closed predicate for all public dataset access, including atomic writes.
 * Malformed/missing legacy owners are quarantined; no ownership is inferred or migrated.
 */
export function datasetAccessFilter(actor: DatasetActor) {
  if (!actor || !/^[a-f\d]{24}$/i.test(actor.id) || !['admin', 'analyst'].includes(actor.role)) return { _id: { $exists: false } };
  return actor.role === 'admin' ? { createdBy: { $type: 'objectId' as const } } : { createdBy: new ObjectId(actor.id) };
}
export const datasetCursorScope = (actor: DatasetActor) => ({ userId: actor.id, role: actor.role });
