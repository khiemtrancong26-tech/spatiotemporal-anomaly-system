import nodemailer from 'nodemailer';
import type { ServerConfig } from '../../config.js';
export interface EmailSender { verification(email: string, token: string): Promise<void>; reset(email: string, token: string): Promise<void> }
export function createEmailSender(config: ServerConfig['email']): EmailSender {
  const transport = config.gmailUser && config.gmailAppPassword && config.appUrl ? nodemailer.createTransport({
    service: 'gmail', auth: { user: config.gmailUser, pass: config.gmailAppPassword },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 10000, logger: false, debug: false,
  }) : undefined;
  async function send(email: string, token: string, reset: boolean) {
    if (!transport || !config.appUrl) throw new Error('Email delivery is not configured');
    const url = new URL(reset ? '/reset-password' : '/verify-email', config.appUrl); url.searchParams.set('token', token);
    try {
      const result = await transport.sendMail({ from: config.gmailUser, to: email,
        subject: reset ? 'Reset your PM25 password' : 'Verify your PM25 email',
        text: `${reset ? 'Reset password (15 minutes)' : 'Verify email (24 hours)'}: ${url.href}` });
      if (!result.accepted?.length || result.rejected?.length) throw new Error();
    } catch { throw new Error('Email delivery failed'); }
  }
  return { verification: (email, token) => send(email, token, false), reset: (email, token) => send(email, token, true) };
}
