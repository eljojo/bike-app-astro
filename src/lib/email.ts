/**
 * Email service abstraction — vendor-isolated.
 * Local: logs to console. Production: uses SMTP relay via fetch.
 */

export interface EmailService {
  send(to: string, subject: string, textBody: string, htmlBody?: string): Promise<void>;
}

export function createLocalEmailService(): EmailService {
  return {
    async send(to, subject, textBody) {
      console.log(`\n📧 Email to ${to}`);
      console.log(`   Subject: ${subject}`);
      console.log(`   Body:\n${textBody}\n`);
    },
  };
}
