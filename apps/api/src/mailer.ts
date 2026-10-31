import type { FastifyBaseLogger } from 'fastify';

export interface Email {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  // True when messages actually leave the server; false means they are only logged.
  readonly delivers: boolean;
  send(email: Email): Promise<void>;
}

// No email provider configured: messages (including reset links) go to the server log, where an
// operator can relay them. Invitations work without email through copyable links in the dashboard.
export function logMailer(log: Pick<FastifyBaseLogger, 'info'>): Mailer {
  return {
    delivers: false,
    async send(email) {
      log.info({ email }, `Email not sent (no EMAIL_PROVIDER): ${email.subject} → ${email.to}`);
    },
  };
}

// https://resend.com/docs/api-reference/emails/send-email
export function resendMailer(apiKey: string, from: string): Mailer {
  return {
    delivers: true,
    async send(email) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to: [email.to], subject: email.subject, text: email.text }),
      });
      if (!response.ok) throw new Error(`Resend rejected the email: ${response.status} ${await response.text()}`);
    },
  };
}
