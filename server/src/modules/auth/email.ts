import type { ServerConfig } from '../../config.js';
export interface EmailSender { verification(email: string, token: string): Promise<void>; reset(email: string, token: string): Promise<void> }
export function createEmailSender(config: ServerConfig['email']): EmailSender {
  async function send(email: string, token: string, reset: boolean) {
    if (!config.apiKey || !config.from || !config.appUrl) throw new Error('Email delivery is not configured');
    const url = new URL(reset ? '/reset-password' : '/verify-email', config.appUrl); url.searchParams.set('token', token);
    const response = await fetch('https://api.resend.com/emails', { method: 'POST', signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.from, to: [email], subject: reset ? 'Reset your PM25 password' : 'Verify your PM25 email', text: `${reset ? 'Reset password (15 minutes)' : 'Verify email (24 hours)'}: ${url.href}` }) });
    if (!response.ok) throw new Error('Email delivery failed');
    const result = await response.json() as { id?: unknown }; if (typeof result.id !== 'string') throw new Error('Email delivery failed');
  }
  return { verification: (email, token) => send(email, token, false), reset: (email, token) => send(email, token, true) };
}
