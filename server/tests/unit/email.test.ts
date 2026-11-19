import { beforeEach, expect, it, vi } from 'vitest';
import { createEmailSender } from '../../src/modules/auth/email.js';
import { loadTestConfig } from '../helpers.js';
const smtp = vi.hoisted(() => ({ sendMail: vi.fn(), createTransport: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: smtp.createTransport } }));
beforeEach(() => { vi.clearAllMocks(); smtp.createTransport.mockReturnValue({ sendMail: smtp.sendMail }); smtp.sendMail.mockResolvedValue({ accepted: ['recipient@gmail.com'], rejected: [] }); });
const config = { gmailUser: 'schooldemo@gmail.com', gmailAppPassword: 'abcdefghijklmnop', appUrl: 'https://app.example.com' };
it('validates Gmail settings without exposing credentials and leaves legacy login configuration optional', () => {
  expect(loadTestConfig().email.gmailUser).toBeUndefined();
  expect(loadTestConfig({ GMAIL_USER: ' schooldemo@gmail.com ', GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop', PUBLIC_APP_URL: config.appUrl }).email).toEqual(config);
  for (const env of [{ GMAIL_USER: 'bad' }, { GMAIL_APP_PASSWORD: 'private-invalid-secret' }, { PUBLIC_APP_URL: 'https://untrusted.example/path' }]) {
    expect(() => loadTestConfig(env)).toThrow(/Invalid (GMAIL_USER|GMAIL_APP_PASSWORD|PUBLIC_APP_URL)/);
  }
});
it('uses Gmail App Password auth, authenticated From and unchanged verification/reset links for multiple recipients', async () => {
  const sender = createEmailSender(config);
  expect(smtp.createTransport).toHaveBeenCalledWith(expect.objectContaining({ service: 'gmail', auth: { user: config.gmailUser, pass: config.gmailAppPassword }, logger: false, debug: false }));
  await sender.verification('first@gmail.com', 'verify-token'); await sender.reset('second@gmail.com', 'reset-token');
  expect(smtp.sendMail.mock.calls[0]![0]).toMatchObject({ from: config.gmailUser, to: 'first@gmail.com', text: 'Verify email (24 hours): https://app.example.com/verify-email?token=verify-token' });
  expect(smtp.sendMail.mock.calls[1]![0]).toMatchObject({ from: config.gmailUser, to: 'second@gmail.com', text: 'Reset password (15 minutes): https://app.example.com/reset-password?token=reset-token' });
});
it('never reports success for missing config, SMTP rejection or errors, and hides SMTP diagnostics', async () => {
  await expect(createEmailSender({}).verification('recipient@gmail.com', 'token')).rejects.toThrow('not configured');
  expect(smtp.createTransport).not.toHaveBeenCalled();
  const sender = createEmailSender(config);
  smtp.sendMail.mockRejectedValueOnce(new Error('private SMTP credentials and reset URL'));
  const error = await sender.reset('recipient@gmail.com', 'token').catch((error: unknown) => error);
  expect(error).toMatchObject({ message: 'Email delivery failed' }); expect(String(error)).not.toMatch(/private|credentials|URL/);
  smtp.sendMail.mockResolvedValueOnce({ accepted: [], rejected: ['recipient@gmail.com'] });
  await expect(sender.verification('recipient@gmail.com', 'token')).rejects.toThrow('Email delivery failed');
});
