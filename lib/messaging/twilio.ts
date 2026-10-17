import 'server-only';
import twilio from 'twilio';
import { normalizePhone } from '@/lib/retell/contact';
import type { MessagingConfig } from './config';
import type { InboundMessage, MessagingProvider } from './provider';
// This module is imported exclusively by server routes, never by components.
export class TwilioMessagingProvider implements MessagingProvider {
  readonly name = 'twilio';
  private client;
  constructor(private config: MessagingConfig) {
    this.client = twilio(config.apiKey, config.apiSecret, { accountSid: config.accountSid, autoRetry: false, maxRetries: 0, timeout: 3500 });
  }
  async sendMessage(message: { to: string; body: string; recoveryId: string }) {
    const result = await this.client.messages.create({ from: this.config.from, to: message.to, body: message.body,
      statusCallback: `${this.config.baseUrl}/api/webhooks/twilio/status?recovery=${encodeURIComponent(message.recoveryId)}` });
    return { id: result.sid, status: result.status };
  }
  normalizeInboundMessage(fields: Record<string,string>): InboundMessage {
    const from = normalizePhone(fields.From), to = normalizePhone(fields.To);
    if (!from || to !== this.config.from || fields.AccountSid !== this.config.accountSid || !/^(SM|MM)[a-f0-9]{32}$/i.test(fields.MessageSid) ||
      typeof fields.Body !== 'string' || fields.Body.length > 4000 || (fields.NumMedia !== undefined && fields.NumMedia !== '0')) throw new Error('Unsupported SMS');
    return { provider: this.name, id: fields.MessageSid, from, to, body: fields.Body };
  }
}
export function validTwilioSignature(config: MessagingConfig, signature: string | null, pathAndQuery: string, fields: Record<string,string>) {
  return !!signature && twilio.validateRequest(config.authToken, signature, config.baseUrl + pathAndQuery, fields);
}
