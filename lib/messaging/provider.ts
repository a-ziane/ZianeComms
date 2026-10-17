import type { Rulebook } from '@/types';
export interface InboundMessage {
  provider: string; id: string; from: string; to: string; body: string;
}
export interface OutboundMessage {
  to:string;body:string;recoveryId:string;
  context?:{caseId:string;originalCallId:string;callerName:string;language:string;reason:string;requestedService:string;location:string};
}
export interface MessagingProvider {
  readonly name: string;
  readonly transport?: 'sms'|'retell_chat';
  readonly rulebooks?: readonly Rulebook[];
  sendMessage(message: OutboundMessage): Promise<{ id: string; status: string }>;
  normalizeInboundMessage(fields: Record<string, string>): InboundMessage;
}

export interface RecoveryConfig {
  encryptionKey: Buffer;
  recipients: string[];
  templates: Record<Rulebook,string>;
}
