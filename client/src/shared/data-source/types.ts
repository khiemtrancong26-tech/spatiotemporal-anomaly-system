/** Online data source contract. Offline semantics require a separate review. */
import type * as Wire from '../api/generated/wire';

export type Bbox = readonly [minLon: number, minLat: number, maxLon: number, maxLat: number];
export interface RequestOptions { signal?: AbortSignal }
export interface IdempotentOptions extends RequestOptions { idempotencyKey: string }
export interface UploadInput { file: File; name?: string }
export type SensorsQuery = Omit<Wire.SensorsQuery, 'bbox'> & { bbox?: Bbox };
export type ReadingsQuery = Omit<Wire.ReadingsQuery, 'bbox'> & { bbox?: Bbox };

/** Error shape to be implemented/normalized in M1. Promise rejection types are not enforced by TS. */
export type DataSourceError =
  | { kind: 'http'; status: number; error: Wire.Error['error'] }
  | { kind: 'network'; message: string }
  | { kind: 'aborted'; message: string }
  | { kind: 'invalid-response'; status?: number; message: string };

export interface OnlineDataSource {
  health(options?: RequestOptions): Promise<Wire.HealthResponse>;
  auth: {
    register(input: Wire.RegisterRequest, options?: RequestOptions): Promise<Wire.UserPublic>;
    login(input: Wire.LoginRequest, options?: RequestOptions): Promise<Wire.LoginResponse>;
    me(options?: RequestOptions): Promise<Wire.UserPublic>;
  };
  datasets: {
    list(query: Wire.DatasetsQuery, options?: RequestOptions): Promise<Wire.DatasetPage>;
    upload(input: UploadInput, options: IdempotentOptions): Promise<Wire.Dataset>;
    validation(id: string, options?: RequestOptions): Promise<Wire.ValidationReport>;
    setMapping(id: string, input: Wire.MappingRequest, options?: RequestOptions): Promise<Wire.Dataset>;
    import(id: string, options: IdempotentOptions): Promise<Wire.Dataset>;
  };
  sensors: {
    list(query: SensorsQuery, options?: RequestOptions): Promise<Wire.SensorPage>;
  };
  readings: {
    list(query: ReadingsQuery, options?: RequestOptions): Promise<Wire.ReadingPage>;
  };
  analysis: {
    get(id: string, options?: RequestOptions): Promise<Wire.AnalysisRun>;
    create(input: Wire.DetectionRequest, options: IdempotentOptions): Promise<Wire.AnalysisCreateResponse>;
    list(query: Wire.AnalysisRunsQuery, options?: RequestOptions): Promise<Wire.AnalysisRunPage>;
  };
  anomalies: {
    list(query: Wire.AnomaliesQuery, options?: RequestOptions): Promise<Wire.AnomalyPage>;
    get(id: string, options?: RequestOptions): Promise<Wire.Anomaly>;
    review(id: string, input: Wire.ReviewPatchRequest, options?: RequestOptions): Promise<Wire.Anomaly>;
  };
  adminUsers: {
    list(query: Wire.AdminUsersQuery, options?: RequestOptions): Promise<Wire.UserPage>;
    create(input: Wire.AdminUserCreateRequest, options: IdempotentOptions): Promise<Wire.UserPublic>;
    update(id: string, input: Wire.AdminUserUpdateRequest, options?: RequestOptions): Promise<Wire.UserPublic>;
  };
}

/** Factory input for M1; does not prescribe token persistence. Injecting fetch permits a mock transport. */
export interface OnlineAdapterOptions {
  baseUrl: string; // Ends in /api/v1; URL assembly must not drop the /api/v1 prefix.
  getAccessToken: () => string | undefined;
  fetch: typeof globalThis.fetch;
}

/** Adapter factory injected at the composition root. */
export type OnlineDataSourceFactory = (options: OnlineAdapterOptions) => OnlineDataSource;

