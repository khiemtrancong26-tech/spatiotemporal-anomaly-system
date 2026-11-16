// Generated from docs/api/openapi.yaml. Do not edit manually.
import type { components, paths } from './openapi';
export type Anomaly = components['schemas']['Anomaly'];
export type Error = components['schemas']['Error'];
export type ExportPage = components['schemas']['ExportPage'];
export type OfflineReviewMutation = components['schemas']['OfflineReviewMutation'];
export type PageInfo = components['schemas']['PageInfo'];
export type Reading = components['schemas']['Reading'];
export type ReviewChanges = components['schemas']['ReviewChanges'];
export type Sensor = components['schemas']['Sensor'];
export type SyncMutationResult = components['schemas']['SyncMutationResult'];
export type SyncPullResponse = components['schemas']['SyncPullResponse'];
export type SyncPushRequest = components['schemas']['SyncPushRequest'];
export type SyncPushResponse = components['schemas']['SyncPushResponse'];
export type ReviewChangesQuery = NonNullable<paths['/api/v1/review-changes']['get']['parameters']['query']>;
export type ExportsQuery = NonNullable<paths['/api/v1/exports']['get']['parameters']['query']>;
