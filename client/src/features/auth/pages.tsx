import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from '@tanstack/react-router';
import { useStore } from 'zustand';
import { useServices } from '../../app/services';
import { Button, Field, ErrorState, LoadingState, EmptyState } from '../../shared/ui/primitives';
import { errorMessage, DataSourceError } from '../../shared/api/errors';
export function safeDestination(value?: string) { return value && /^\/(datasets(?:\/import)?|workspace\/[^/?#]+|admin\/users)(?:\?.*)?$/.test(value) ? value : '/datasets'; }
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, data } = useServices();
  const state = useStore(session.store);
  const location = useLocation();
  if (location.pathname === '/login') return children;
  if (state.status === 'checking') return <LoadingState label="Đang kiểm tra phiên đăng nhập…" />;
  if (state.status === 'error') return <><ErrorState message={errorMessage(state.error)} retry={() => { void session.restore(data); }} /><Button onClick={session.logout}>Đăng nhập lại</Button></>;
  if (state.status !== 'authenticated') return <Navigate to="/login" search={{ redirect: location.pathname + location.searchStr }} replace />;
  if (location.pathname.startsWith('/admin/') && state.user?.role !== 'admin') return <EmptyState title="Không có quyền truy cập" description="Chức năng này chỉ dành cho Admin (403)." />;
  return <div key={state.revision}>{children}</div>;
}
export function LoginPage({ destination }: { destination?: string }) {
  const { session, data, mock } = useServices();
  const state = useStore(session.store);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); if (pending) return;
    setPending(true); setError('');
    try { await session.login(data, username.trim(), password); }
    catch (cause) { setError(cause instanceof DataSourceError ? cause.status === 401 ? 'Tên đăng nhập hoặc mật khẩu không đúng.' : errorMessage(cause) : cause instanceof Error ? cause.message : 'Không thể đăng nhập.'); }
    finally { setPassword(''); setPending(false); }
  }
  if (state.status === 'authenticated') return <Navigate to={safeDestination(destination)} replace />;
  if (state.status === 'checking') return <LoadingState label="Đang kiểm tra phiên đăng nhập…" />;
  return <section className="card login-card"><h1>Đăng nhập</h1><p className="muted">Phiên được giữ trong tab này. Không lưu mật khẩu.</p>{mock && <p className="mock-help">Mock: analyst01 hoặc admin01 / demo-password</p>}<form onSubmit={(event) => { void submit(event); }}><Field label="Tên đăng nhập" autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} disabled={pending} /><Field label="Mật khẩu" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} disabled={pending} />{error && <p role="alert" className="text-error">{error}</p>}<Button type="submit" disabled={pending}>{pending ? 'Đang đăng nhập…' : 'Đăng nhập'}</Button></form></section>;
}
