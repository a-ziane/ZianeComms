import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Caller } from '@/types';
import type { RpcClient } from '@/lib/persistence/repository';
import { operationsRepository } from '@/lib/persistence/repository';
import { serializeState } from '@/lib/persistence/mapping';
import { TERMINAL_STATUSES } from '@/lib/cases';
import { decryptContact, normalizePhone, protectContact, redactPhones } from '@/lib/retell/contact';
import type { InboundMessage, MessagingProvider, RecoveryConfig } from './provider';
import { isStop, updateFromReply } from './reply';
async function rpc<T>(client: RpcClient, name: string, args: Record<string,unknown>): Promise<T> {
  const result = await client.rpc(name,args);
  if (result.error) throw Object.assign(new Error('SMS persistence unavailable'), {code:result.error.code});
  return result.data as T;
}
export function recoveryEligible(caller: Caller): boolean {
  const r = caller.retell, o = r?.outcomes;
  if (TERMINAL_STATUSES.includes(caller.status) || !r || r.disconnectionReason === 'user_requested_dnc') return false;
  if (o?.automationResolvedRequest === true && o.humanRequested !== true && o.unresolvedNeed !== true) return false;
  return o?.unresolvedNeed === true || o?.humanRequested === true ||
    r.disconnectionReason === 'user_hangup' && r.callSuccessful === false;
}
// DB claim is durable BEFORE the sole provider attempt. No automatic resend on timeout/crash.
export async function recoverCall(client: RpcClient, provider: MessagingProvider, config: RecoveryConfig, callId: string) {
  const context = await rpc<{case_id:string; encrypted:string|null}|null>(client,'zianecomms_sms_call_context',{p_call_id:callId});
  if (!context || (!context.encrypted && provider.transport !== 'retell_chat')) return 'missing_contact';
  const {state} = await operationsRepository(client).load();
  const caller = Object.values(state.callersByMode).flat().find(c => c.id === context.case_id);
  if (!caller || provider.rulebooks && !provider.rulebooks.includes(caller.rulebook) || caller.retell?.callId !== callId || !recoveryEligible(caller)) return 'ineligible';
  const phone = provider.transport === 'retell_chat' ? undefined : normalizePhone(decryptContact(context.encrypted!,config.encryptionKey,caller.id));
  if (provider.transport !== 'retell_chat' && (!phone || !config.recipients.includes(phone))) return 'recipient_not_allowed';
  const body = config.templates[caller.rulebook];
  if (!body.trim() || body.length > 1000) throw new Error('Invalid SMS template');
  const id = `recovery-${callId}`;
  const claimed = await rpc<boolean>(client,'zianecomms_sms_claim',{p_call_id:callId,p_provider:provider.name,p_body:body});
  if (!claimed) return 'duplicate_or_ineligible';
  let sent: {id:string;status:string};
  try { sent = await provider.sendMessage({to:phone ?? caller.id,body,recoveryId:id,context:{caseId:caller.id,originalCallId:callId,
      callerName:caller.name,language:caller.language,reason:caller.needSummary,location:caller.location,
      requestedService:caller.questionnaire.filter(q=>q.question==='Structured intake — Requested service').at(-1)?.answer ?? caller.needCategory}}); }
  catch {
    await rpc(client,'zianecomms_sms_mark_unknown',{p_call_id:callId});
    return 'unknown';
  }
  // If recording acceptance fails, webhook retries see the durable claim and cannot send again.
  await persistMessage(client,{id,call_id:callId,case_id:caller.id,provider:provider.name,provider_id:sent.id,
    body:redactPhones(body),direction:'outbound',channel:provider.transport ?? 'sms',status:sent.status,timestamp:new Date().toISOString()});
  return 'sent';
}
interface StoredMessage { id:string; provider:string; provider_id:string; case_id:string|null; call_id:string|null; body:string; direction:'inbound'|'outbound'; status:string; timestamp:string; channel?:'sms'|'retell_chat'; identity?:string|null; encrypted?:string|null; stop?:boolean }
async function persistMessage(client: RpcClient, message: StoredMessage) {
  const mutation = randomUUID();
  for (let attempt=0;attempt<4;attempt++) {
    if (message.direction === 'inbound') {
      const fresh = await rpc<{duplicate:boolean;case_id:string|null;call_id:string|null}>(client,'zianecomms_sms_correlate',{
        p_provider:message.provider,p_message_id:message.provider_id,p_identity:message.identity});
      if (fresh.duplicate) return {duplicate:true};
      message = {...message,case_id:fresh.case_id,call_id:fresh.call_id};
    }
    const {state,revision} = await operationsRepository(client).load();
    const caller = Object.values(state.callersByMode).flat().find(c=>c.id===message.case_id);
    let updated = caller;
    if (caller && message.direction === 'inbound' && !TERMINAL_STATUSES.includes(caller.status)) {
      updated = updateFromReply(caller,message.body,message.provider_id,message.timestamp);
    } else if (caller && message.direction === 'outbound') {
      updated = {...caller,activityLog:[...caller.activityLog,{id:message.id,type:message.channel==='retell_chat'?'recovery_chat':'sms_sent',timestamp:message.timestamp,
        label:message.channel==='retell_chat'?'Recovery initiated — Retell Chat':'Recovery SMS sent',detail:message.channel==='retell_chat'?`${message.body} (Carrier simulated for hackathon demo.)`:`${message.body} (Provider accepted; delivery status: ${message.status}.)`}]};
    }
    const next = updated ? {...state,callersByMode:{...state.callersByMode,[updated.rulebook]:state.callersByMode[updated.rulebook].map(c=>c.id===updated!.id?updated!:c)}} : state;
    const result = await client.rpc('zianecomms_sms_commit',{p_expected_revision:revision,p_mutation_id:mutation,p_payload:serializeState(next),p_message:message});
    if (!result.error) return result.data;
    if (result.error.code !== '40001') throw new Error('SMS transaction unavailable');
  }
  throw new Error('SMS concurrent update; retry webhook');
}
export async function receiveMessage(client: RpcClient, message: InboundMessage, config: RecoveryConfig) {
  const identity = protectContact(message.from,config.encryptionKey,'identity').identity;
  const correlation = await rpc<{duplicate:boolean;case_id:string|null;call_id:string|null}>(client,'zianecomms_sms_correlate',{
    p_provider:message.provider,p_message_id:message.id,p_identity:identity});
  if (correlation.duplicate) return {duplicate:true};
  return persistMessage(client,{id:`sms-${message.id}`,provider:message.provider,provider_id:message.id,
    case_id:correlation.case_id,call_id:correlation.call_id,body:redactPhones(message.body),direction:'inbound',status:'received',
    timestamp:new Date().toISOString(),identity,encrypted:protectContact(message.body || '(empty SMS)',config.encryptionKey,message.id).encrypted,
    stop:isStop(message.body)});
}
