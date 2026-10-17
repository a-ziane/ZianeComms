import type { Rulebook } from '@/types';
export interface InboundMessage {
  provider: string; id: string; from: string; to: string; body: string;
}
export interface MessagingProvider {
  readonly name: string;
  sendMessage(message: { to: string; body: string; recoveryId: string }): Promise<{ id: string; status: string }>;
  normalizeInboundMessage(fields: Record<string, string>): InboundMessage;
}

export interface RecoveryConfig {
  encryptionKey: Buffer;
  recipients: string[];
  templates: Record<Rulebook,string>;
}
