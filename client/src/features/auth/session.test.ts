import { expect, it, vi } from 'vitest';
import { createSession } from './session';
import { safeDestination } from './pages';
import type { OnlineDataSource } from '../../shared/data-source/types';

const user = { id: 'u', username: 'analyst', role: 'analyst' as const, isActive: true };
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
it('persists only token, revalidates user on reload and clears token on logout', async () => {
  const memory = storage();
  const api = { auth: { login: vi.fn().mockResolvedValue({ accessToken: 'token', user }), me: vi.fn().mockResolvedValue(user) } } as unknown as OnlineDataSource;
  const session = createSession(memory, 'auth');
  await session.login(api, 'analyst', 'password');
  expect(memory.getItem('auth')).toBe('token');
  const restored = createSession(memory, 'auth');
  expect(restored.store.getState().status).toBe('checking');
  await restored.restore(api);
  expect(api.auth.me).toHaveBeenCalledOnce();
  expect(restored.store.getState().user).toEqual(user);
  restored.logout();
  expect(restored.getToken()).toBeUndefined();
  expect(restored.store.getState().user).toBeUndefined();
  expect(memory.getItem('auth')).toBeNull();
});
it('does not let an old login response resurrect a logged-out session', async () => {
  let resolve!: (value: unknown) => void;
  const api = { auth: { login: () => new Promise((done) => { resolve = done; }) } } as unknown as OnlineDataSource;
  const session = createSession(storage(), 'auth');
  const pending = session.login(api, 'user', 'password');
  session.logout();
  resolve({ accessToken: 'stale', user });
  await pending;
  expect(session.store.getState().status).toBe('anonymous');
  expect(session.getToken()).toBeUndefined();
});
it('does not invalidate a new token because an older request got 401', async () => {
  const api = { auth: { login: vi.fn().mockResolvedValue({ accessToken: 'new-token', user }) } } as unknown as OnlineDataSource;
  const session = createSession(storage(), 'auth');
  await session.login(api, 'user', 'password');
  session.invalidate('old-token');
  expect(session.getToken()).toBe('new-token');
  session.invalidate('new-token');
  expect(session.store.getState().status).toBe('anonymous');
});
it('limits login destinations to application routes', () => {
  expect(safeDestination('//evil.example')).toBe('/datasets');
  expect(safeDestination('https://evil.example')).toBe('/datasets');
  expect(safeDestination('/workspace/dataset-1')).toBe('/workspace/dataset-1');
});
