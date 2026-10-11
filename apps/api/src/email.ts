import type { Env } from './env';

/** Sends a plain-text email through Resend. In local development it prints to the console instead. */
export async function sendEmail(env: Env, message: { to: string; subject: string; text: string }): Promise<void> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    if (env.ENVIRONMENT === 'production') {
      console.error('Email is not configured: set RESEND_API_KEY and EMAIL_FROM');
      return;
    }
    console.log(`[dev email] to=${message.to} subject=${message.subject}\n${message.text}`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [message.to], subject: message.subject, text: message.text }),
  });
  // Never log the address or the body: they are personal data / secrets.
  if (!res.ok) console.error(`email send failed with ${res.status}`);
}
