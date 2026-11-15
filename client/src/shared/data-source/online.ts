import type * as W from '../api/generated/wire';
import { createHttpClient } from '../api/http-client';
import type { OnlineDataSource, OnlineAdapterOptions, Bbox } from './types';

function bbox(value?: Bbox): string | undefined {
  if (!value) return undefined;
  const [west, south, east, north] = value;
  if (value.length !== 4 || !value.every(Number.isFinite) || west < -180 || east > 180 || south < -90 || north > 90 || west > east || south > north) throw new TypeError('Invalid bbox.');
  return value.join(',');
}
export function createOnlineDataSource(options: OnlineAdapterOptions): OnlineDataSource {
  const request = createHttpClient(options);
  return {
    health: (opts) => request<W.HealthResponse>('get_api_v1_health', opts),
    auth: {
      register: async (body, opts) => (await request<W.UserResponse>('post_api_v1_auth_register', { ...opts, body })).data,
      login: (body, opts) => request<W.LoginResponse>('post_api_v1_auth_tokens', { ...opts, body }),
      me: async (opts) => (await request<W.UserResponse>('get_api_v1_users_me', opts)).data,
    },
    datasets: {
      list: (query, opts) => request<W.DatasetPage>('get_api_v1_datasets', { ...opts, query }),
      upload: async (body, opts) => (await request<W.SingleDataset>('post_api_v1_datasets', { ...opts, body })).data,
      validation: (id, opts) => request<W.ValidationReport>('get_api_v1_datasets_by_id_validation', { ...opts, path: { id } }),
      setMapping: async (id, body, opts) => (await request<W.SingleDataset>('put_api_v1_datasets_by_id_mapping', { ...opts, path: { id }, body })).data,
      import: async (id, opts) => (await request<W.SingleDataset>('post_api_v1_datasets_by_id_imports', { ...opts, path: { id } })).data,
    },
    sensors: { list: (query, opts) => request<W.SensorPage>('get_api_v1_sensors', { ...opts, query: { ...query, bbox: bbox(query.bbox) } }) },
    readings: { list: (query, opts) => request<W.ReadingPage>('get_api_v1_readings', { ...opts, query: { ...query, bbox: bbox(query.bbox) } }) },
    analysis: {
      get: async (id, opts) => (await request<W.AnalysisCreateResponse>('get_api_v1_analysis_runs_id', { ...opts, path: { id } })).data,
      list: (query, opts) => request<W.AnalysisRunPage>('get_api_v1_analysis_runs', { ...opts, query }),
      create: (body, opts) => request<W.AnalysisCreateResponse>('post_api_v1_analysis_runs', { ...opts, body }),
    },
    anomalies: {
      list: (query, opts) => request<W.AnomalyPage>('get_api_v1_anomalies', { ...opts, query }),
      get: async (id, opts) => (await request<W.SingleAnomaly>('get_api_v1_anomalies_id', { ...opts, path: { id } })).data,
      review: async (id, body, opts) => (await request<W.SingleAnomaly>('patch_api_v1_anomalies_id', { ...opts, path: { id }, body })).data,
    },
    adminUsers: {
      list: (query, opts) => request<W.UserPage>('get_api_v1_admin_users', { ...opts, query }),
      create: async (body, opts) => (await request<W.UserResponse>('post_api_v1_admin_users', { ...opts, body })).data,
      update: async (id, body, opts) => (await request<W.UserResponse>('patch_api_v1_admin_users_id', { ...opts, path: { id }, body })).data,
    },
  };
}
