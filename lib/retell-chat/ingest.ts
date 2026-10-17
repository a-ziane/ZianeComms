import 'server-only';
import {randomUUID} from 'node:crypto';
import type {Caller,ActivityEntry} from '@/types';
import {TERMINAL_STATUSES} from '@/lib/cases';
import {operationsRepository,type RpcClient} from '@/lib/persistence/repository';
import {serializeState} from '@/lib/persistence/mapping';
import type {ChatIntake} from './normalize';
import {mergeChatFacts} from './facts';
export interface ChatContext {case_id:string;call_id:string;chat_id:string|null;opening:string;state:string;before_priority:number|null;analyzed:boolean}
export async function chatContext(client:RpcClient,caseId:string){
 const r=await client.rpc('zianecomms_chat_context',{p_case_id:caseId});if(r.error)throw Error('Recovery unavailable');return r.data as ChatContext|null;
}
export function updateChatCase(caller:Caller,intake:ChatIntake):Caller {
 let next=caller;
 if(intake.event==='chat_analyzed'&&!caller.activityLog.some(e=>e.id===`chat_analyzed-${intake.chatId}`)&&(!caller.retell||Date.parse(intake.timestamp)>=Date.parse(caller.retell.endedAt))&&!TERMINAL_STATUSES.includes(caller.status)&&intake.messages.some(m=>m.direction==='inbound'))next=mergeChatFacts(caller,intake.fields,intake.chatId,intake.timestamp);
 const events:ActivityEntry[]=[];
 for(const m of intake.messages){const id=`chat-message-${intake.chatId}-${m.id}`;
  if(!next.activityLog.some(e=>e.id===id))events.push({id,type:'recovery_chat',timestamp:m.timestamp,
   label:m.direction==='inbound'?'Caller replied — Recovery Chat':'Recovery message sent — Retell Chat',detail:m.body});
 }
 if(['chat_ended','chat_analyzed'].includes(intake.event))events.push({id:`${intake.event}-${intake.chatId}`,type:'recovery_chat',timestamp:intake.timestamp,
  label:intake.event==='chat_analyzed'?'Recovery chat analyzed':'Recovery chat completed',detail:intake.summary ||
   (intake.event==='chat_analyzed'?'No confirmed caller update applied. Unknown facts and no-reply analyses do not change priority.':'Waiting for structured analysis; no priority change from this event.')});
 // Context is retained even when no confirmed fact can be applied.
 if(intake.summary)next={...next,questionnaire:[...next.questionnaire,{question:'Recovery chat summary (context)',answer:intake.summary}]};
 // Keep the recalculation after message/analysis events in the readable timeline.
 const priority=caller.activityLog.some(e=>e.id===`chat-priority-${intake.chatId}`)?undefined:next.activityLog.find(e=>e.id===`chat-priority-${intake.chatId}`);
 return {...next,activityLog:[...next.activityLog.filter(e=>e!==priority),...events,...(priority?[priority]:[])]};
}
export async function ingestChat(client:RpcClient,intake:ChatIntake){
 const mutation=randomUUID();
 for(let attempt=0;attempt<4;attempt++){
  const {state,revision}=await operationsRepository(client).load();
  const caller=Object.values(state.callersByMode).flat().find(c=>c.id===intake.caseId);
  if(!caller)throw Error('Unknown recovery case');
  const binding=await client.rpc('zianecomms_chat_binding',{p_chat_id:intake.chatId});
  const context=binding.data as {case_id:string;call_id:string}|null;
  if(binding.error || !context || context.case_id!==intake.caseId || context.call_id!==intake.callId)throw Error('Unknown recovery session');
  // Avoid rebuilding duplicate event history before reaching SQL's authoritative idempotency check.
  const next=updateChatCase(caller,intake);
  const result=await client.rpc('zianecomms_chat_commit',{p_expected_revision:revision,p_mutation_id:mutation,
   p_payload:serializeState({...state,callersByMode:{...state.callersByMode,[caller.rulebook]:state.callersByMode[caller.rulebook].map(c=>c.id===caller.id?next:c)}}),
   p_chat:{case_id:intake.caseId,call_id:intake.callId,chat_id:intake.chatId,event:intake.event,messages:intake.messages}});
  if(!result.error)return result.data;
  if(result.error.code!=='40001')throw Error('Recovery transaction unavailable');
 }
 throw Error('Recovery changed; retry delivery');
}
