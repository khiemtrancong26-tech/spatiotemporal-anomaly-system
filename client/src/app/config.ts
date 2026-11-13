export interface AppConfig { mode: 'online' | 'mock'; apiBaseUrl: string }
export function readConfig(env: Record<string, unknown>): AppConfig {
  const mode = env.VITE_DATA_MODE ?? (env.MODE === 'mock' ? 'mock' : 'online');
  if (mode !== 'online' && mode !== 'mock') throw new Error('VITE_DATA_MODE must be online or mock.');
  const apiBaseUrl = String(env.VITE_API_BASE_URL ?? 'http://localhost:3001/api/v1');
  if (env.VITE_MAPBOX_TOKEN && !String(env.VITE_MAPBOX_TOKEN).startsWith('pk.')) throw new Error('VITE_MAPBOX_TOKEN must be a public pk. token.');
  return { mode, apiBaseUrl };
}
