import { createStore } from 'zustand/vanilla';
import type { OnlineDataSource } from '../../shared/data-source/types';
import type { UserPublic } from '../../shared/api/generated/wire';
import { reportClientError } from '../../app/error-handling';
export function createSession(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, key: string) {
  let token: string | undefined;
  try { token = storage.getItem(key) || undefined; }
  catch (error) { reportClientError('session-storage-read', error); }
  let generation = 0;
  const store = createStore<{ status: 'anonymous' | 'checking' | 'authenticated' | 'offline' | 'error'; user?: UserPublic; error?: unknown; revision: number }>(() => ({ status: token ? 'checking' : 'anonymous', revision: 0 }));
  const clear = () => {
    generation++;
    token = undefined;
    try { storage.removeItem(key); }
    catch (error) { reportClientError('session-storage-clear', error); }
    store.setState({ status: 'anonymous', user: undefined, error: undefined, revision: store.getState().revision + 1 });
  };
  return {
    store, getToken: () => token, logout: clear,
    invalidate(expected: string) { if (token === expected) clear(); },
    useOffline(user: UserPublic) { store.setState({ status: 'offline', user, error: undefined }); },
    async verify(api: OnlineDataSource, signal?: AbortSignal) {
      const current = generation;
      const expected = store.getState().user?.id;
      if (!token || !expected) return false;
      const user = await api.auth.me({ signal });
      if (generation !== current) return false;
      if (user.id !== expected || !user.isActive) { clear(); return false; }
      if (store.getState().status === 'offline') store.setState({ status: 'authenticated', user, error: undefined });
      return true;
    },
    async restore(api: OnlineDataSource) {
      if (!token) return;
      const current = ++generation;
      store.setState({ status: 'checking', error: undefined });
      try {
        const user = await api.auth.me();
        if (current !== generation) return;
        if (!user.isActive) { clear(); return; }
        store.setState({ status: 'authenticated', user, revision: store.getState().revision + 1 });
      } catch (error) { if (current === generation) store.setState({ status: 'error', error }); }
    },
    async login(api: OnlineDataSource, username: string, password: string, signal?: AbortSignal) {
      const current = ++generation;
      const result = await api.auth.login({ username, password }, { signal });
      if (current !== generation || signal?.aborted) return;
      if (!result.user.isActive) throw new Error('Tài khoản đã bị vô hiệu hóa.');
      try { storage.setItem(key, result.accessToken); }
      catch (cause) { throw new Error('Trình duyệt không cho lưu phiên trong tab. Hãy cho phép sessionStorage rồi thử lại.', { cause }); }
      token = result.accessToken;
      store.setState({ status: 'authenticated', user: result.user, error: undefined, revision: store.getState().revision + 1 });
    },
  };
}
export type Session = ReturnType<typeof createSession>;
