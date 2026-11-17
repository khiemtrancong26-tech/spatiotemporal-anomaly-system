import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useServices } from '../../app/services';
import { AuthFrame, Button, Field } from '../../shared/ui/primitives';
import { DataSourceError, errorMessage } from '../../shared/api/errors';
export function EmailPage({ kind }: { kind: 'verify' | 'forgot' | 'reset' }) {
  const { data, session } = useServices();
  const navigate = useNavigate();
  const [token, setToken] = useState(() => new URL(window.location.href).searchParams.get('token') ?? '');
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(''), [done, setDone] = useState(false);
  useEffect(() => { if (window.location.search) window.history.replaceState(window.history.state, '', window.location.pathname); }, []);
  async function submit(event: FormEvent, resend = false) {
    event.preventDefault(); if (pending) return;
    if (kind === 'reset' && password !== confirm) { setError('Mật khẩu xác nhận không khớp.'); return; }
    setPending(true); setError(''); setMessage('');
    try {
      if (resend || kind === 'forgot') {
        await (resend ? data.auth.resendVerification({ email }) : data.auth.forgotPassword({ email }));
        setMessage('Nếu tài khoản đủ điều kiện, email có thể được gửi. Kiểm tra hộp thư hoặc thử lại sau.');
      } else {
        await (kind === 'verify' ? data.auth.verifyEmail({ token }) : data.auth.resetPassword({ token, newPassword: password }));
        setDone(true); setToken(''); if (kind === 'reset') { session.logout(); await navigate({ to: '/login', search: { reset: true }, replace: true }); }
        setMessage(kind === 'verify' ? 'Email đã xác minh. Vui lòng đăng nhập.' : 'Mật khẩu đã thay đổi. Vui lòng đăng nhập lại.');
      }
    } catch (cause) { setError(cause instanceof DataSourceError && cause.status === 422 ? 'Thông tin hoặc liên kết không hợp lệ, đã hết hạn hoặc đã sử dụng. Hãy yêu cầu email mới.' : errorMessage(cause)); }
    finally { setPassword(''); setConfirm(''); setPending(false); }
  }
  return <AuthFrame><section className="card login-card"><h1>{kind === 'verify' ? 'Xác minh email' : kind === 'forgot' ? 'Quên mật khẩu' : 'Đặt lại mật khẩu'}</h1>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    {!done && kind !== 'forgot' && <form onSubmit={e => void submit(e)}>{!token ? <p>Thiếu token. Mở liên kết mới trong email.</p> : kind === 'reset' ? <><Field label="Mật khẩu mới" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} /><Field label="Xác nhận mật khẩu" type="password" autoComplete="new-password" minLength={8} required value={confirm} onChange={e => setConfirm(e.target.value)} /></> : <p>Nhấn xác nhận để xác minh email. Chỉ mở liên kết không tiêu thụ token.</p>}
      <Button disabled={pending || !token} type="submit">{kind === 'verify' ? 'Xác nhận email' : 'Lưu mật khẩu mới'}</Button></form>}
    {!done && kind !== 'reset' && <form onSubmit={e => void submit(e, kind === 'verify')}><Field label="Email" type="email" required value={email} onChange={e => setEmail(e.target.value)} disabled={pending} /><Button type="submit" disabled={pending}>{kind === 'verify' ? 'Gửi lại xác minh' : 'Yêu cầu đặt lại mật khẩu'}</Button></form>}
    <p><Link to="/login">Đăng nhập</Link> · <Link to="/forgot-password">Yêu cầu liên kết đặt lại mới</Link></p>
  </section></AuthFrame>;
}
