import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createRouter, createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { routeTree } from '../../routeTree.gen';
import { ServicesProvider, createPreviewStore } from '../../app/services';
import type { OnlineDataSource } from '../../shared/data-source/types';
import { DataSourceError } from '../../shared/api/errors';
afterEach(cleanup);
async function show(path: string, registerFailure = false) {
  window.history.replaceState({}, '', path);
  const auth = { verifyEmail: vi.fn().mockResolvedValue({ message: 'Verified' }), forgotPassword: vi.fn().mockResolvedValue({ message: 'Generic' }),
    resendVerification: vi.fn().mockResolvedValue({ message: 'Generic' }), resetPassword: vi.fn().mockResolvedValue({ message: 'Changed' }),
    register: registerFailure ? vi.fn().mockRejectedValue(new DataSourceError('http', 'Failed', 503, { code: 'REGISTRATION_EMAIL_FAILED', message: 'Pending' })) : vi.fn().mockResolvedValue({ id: 'u', username: 'A', role: 'analyst', isActive: true }) };
  const data = { auth, readings: { list: vi.fn() } } as unknown as OnlineDataSource;
  const history = createMemoryHistory({ initialEntries: [path] }), router = createRouter({ routeTree, history });
  render(<ServicesProvider services={{ data, preview: createPreviewStore(), config: { mode: 'online', apiBaseUrl: 'http://localhost:3001/api/v1' } }}><RouterProvider router={router} /></ServicesProvider>);
  await router.load(); return { auth, router };
}
it('opens all public auth routes anonymously and keeps datasets protected', async () => {
  for (const [path, title] of [['/verify-email', 'Xác minh email'], ['/forgot-password', 'Quên mật khẩu'], ['/reset-password', 'Đặt lại mật khẩu']]) {
    await show(path!); expect(await screen.findByRole('heading', { name: title })).toBeVisible(); cleanup();
  }
  const { router } = await show('/datasets'); await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
});
it('requires explicit email confirmation; password mismatch does not submit; successful reset returns to login', async () => {
  const verify = await show('/verify-email?token=verification-secret');
  await screen.findByRole('heading', { name: 'Xác minh email' }); expect(verify.auth.verifyEmail).not.toHaveBeenCalled();
  expect(window.location.search).toBe(''); fireEvent.click(screen.getByRole('button', { name: 'Xác nhận email' }));
  await waitFor(() => expect(verify.auth.verifyEmail).toHaveBeenCalledWith({ token: 'verification-secret' }));
  cleanup();
  const reset = await show('/reset-password?token=reset-secret'); await screen.findByRole('heading', { name: 'Đặt lại mật khẩu' });
  fireEvent.change(screen.getByLabelText('Mật khẩu mới'), { target: { value: 'new-password' } }); fireEvent.change(screen.getByLabelText('Xác nhận mật khẩu'), { target: { value: 'different-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu mật khẩu mới' })); expect(reset.auth.resetPassword).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Xác nhận mật khẩu'), { target: { value: 'new-password' } }); fireEvent.click(screen.getByRole('button', { name: 'Lưu mật khẩu mới' }));
  await waitFor(() => expect(reset.router.state.location.pathname).toBe('/login'));
  expect(reset.auth.resetPassword).toHaveBeenCalledWith({ token: 'reset-secret', newPassword: 'new-password' });
});
it('register requires email and shows pending recovery after success or delivery failure', async () => {
  for (const failed of [false, true]) {
    const f = await show('/register', failed); await screen.findByRole('heading', { name: 'Đăng ký tài khoản' });
    fireEvent.change(screen.getByLabelText('Tên đăng nhập'), { target: { value: 'A' } }); fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.com' } }); fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'initial-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng ký' }));
    expect(await screen.findByRole('heading', { name: 'Chờ xác minh email' })).toBeVisible();
    expect(f.auth.register).toHaveBeenCalledWith({ username: 'A', email: 'a@example.com', password: 'initial-password' }, expect.anything());
    expect(screen.getByRole('link', { name: 'Gửi lại email xác minh' })).toBeVisible(); cleanup();
  }
});
