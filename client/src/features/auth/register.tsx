import { runClientTask } from '../../app/error-handling';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate } from '@tanstack/react-router';
import { useStore } from 'zustand';
import { useServices } from '../../app/services';
import { AuthFrame, Button, Field, LoadingState } from '../../shared/ui/primitives';
import { DataSourceError, errorMessage } from '../../shared/api/errors';
export function RegisterPage() {
  const { data, session } = useServices();
  const auth = useStore(session.store);
  const [email, setEmail] = useState('');
  const [created, setCreated] = useState(false);
  const [notice, setNotice] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (active.current && !active.current.signal.aborted) return;
    if (!username.trim()) { setError('Tên đăng nhập không được để trống.'); return; }
    const controller = new AbortController(); active.current = controller;
    setPending(true); setError('');
    try {
      await data.auth.register({ username: username.trim(), email: email.trim(), password }, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setPassword('');
      setCreated(true); setNotice('Tài khoản đang chờ xác minh email. Mở email và xác nhận trước khi đăng nhập.');
    } catch (cause) {
      if (cause instanceof DataSourceError && cause.error?.code === 'REGISTRATION_EMAIL_FAILED') { setCreated(true); setNotice('Tài khoản đã tạo nhưng chưa gửi được email. Dùng Gửi lại xác minh; không đăng ký lại.'); }
      else if (!controller.signal.aborted) setError(cause instanceof DataSourceError && cause.status === 409 ? 'Username hoặc email đã được đăng ký.' : cause instanceof DataSourceError && cause.status === 422 ? 'Thông tin đăng ký chưa hợp lệ. Kiểm tra username, email và mật khẩu.' : errorMessage(cause));
    } finally { if (!controller.signal.aborted) { active.current = null; setPassword(''); setPending(false); } }
  }
  if (auth.status === 'checking') return <LoadingState label="Đang kiểm tra phiên đăng nhập…" />;
  if (auth.status === 'authenticated') return <Navigate to="/datasets" replace />;
  if (created) return <AuthFrame><section className="card login-card"><h1>Chờ xác minh email</h1><p role="status">{notice}</p><p>{email}</p><Link to="/verify-email">Gửi lại email xác minh</Link><p><Link to="/login">Đăng nhập sau khi xác minh</Link></p></section></AuthFrame>;
  return <AuthFrame><section className="card login-card"><h1>Đăng ký tài khoản</h1><p className="muted">Tạo tài khoản Analyst để bắt đầu làm việc với dữ liệu PM2.5.</p><form onSubmit={(event) => { runClientTask(submit(event)); }}><Field label="Tên đăng nhập" autoComplete="username" required disabled={pending} value={username} onChange={(e) => setUsername(e.target.value)} /><Field label="Email" type="email" autoComplete="email" required disabled={pending} value={email} onChange={e => setEmail(e.target.value)} /><Field label="Mật khẩu" type="password" autoComplete="new-password" required minLength={8} hint="Tối thiểu 8 ký tự." disabled={pending} value={password} onChange={(e) => setPassword(e.target.value)} />{error && <p role="alert" className="text-error">{error}</p>}<Button type="submit" disabled={pending}>{pending ? 'Đang đăng ký…' : 'Đăng ký'}</Button></form><p className="auth-link"><Link to="/login" className="text-link">Đã có tài khoản? Đăng nhập</Link></p></section></AuthFrame>;
}
