import { expect, it } from 'vitest';
import { readConfig } from './config';

it('defaults to online and enables mock only by explicit environment choice', () => {
  expect(readConfig({ MODE: 'development' }).mode).toBe('online');
  expect(readConfig({ MODE: 'mock' }).mode).toBe('mock');
  expect(readConfig({ MODE: 'mock', VITE_DATA_MODE: 'online' }).mode).toBe('online');
  expect(() => readConfig({ VITE_DATA_MODE: 'auto' })).toThrow();
});

it('rejects private Mapbox tokens without echoing their values', () => {
  expect(() => readConfig({ VITE_MAPBOX_TOKEN: 'sk.secret' })).toThrow('public pk. token');
  expect(readConfig({ VITE_MAPBOX_TOKEN: 'pk.public' }).apiBaseUrl).toMatch(/\/api\/v1$/);
});
