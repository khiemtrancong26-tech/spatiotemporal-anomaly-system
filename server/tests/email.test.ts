import { afterEach, expect, it, vi } from 'vitest';
import { createEmailSender } from '../src/modules/auth/email.js';
afterEach(() => vi.unstubAllGlobals());
it('uses Resend REST with trusted origin and fails closed without configuration or provider acceptance', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ id: 'provider-id' })))
    .mockResolvedValueOnce(new Response('{}', { status: 503 })); vi.stubGlobal('fetch', fetch);
  const sender = createEmailSender({ apiKey: 're_test_only', from: 'auth@example.com', appUrl: 'https://app.example.com' });
  await sender.verification('user@example.com', 'test-token');
  expect(fetch.mock.calls[0]![0]).toBe('https://api.resend.com/emails');
  const body = JSON.parse(fetch.mock.calls[0]![1].body); expect(body).toMatchObject({ from: 'auth@example.com', to: ['user@example.com'] });
  expect(body.text).toContain('https://app.example.com/verify-email?token=test-token');
  await expect(sender.reset('user@example.com', 'reset-token')).rejects.toThrow('Email delivery failed');
  await expect(createEmailSender({}).verification('user@example.com', 'token')).rejects.toThrow('not configured');
});
