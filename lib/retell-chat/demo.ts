import 'server-only';
import type {RpcClient} from '@/lib/persistence/repository';
import {operationsRepository} from '@/lib/persistence/repository';
import {TERMINAL_STATUSES} from '@/lib/cases';
import {recoverCall} from '@/lib/messaging/service';
import type {ChatConfig} from './config';
import {RetellChatProvider,chatClient} from './provider';
import {chatContext,ingestChat} from './ingest';
import {normalizeChat} from './normalize';
export async function demoSession(client:RpcClient,config:ChatConfig,caseId:string,operation?:{action:string;content?:string;requestId?:string;chatId?:string},api=chatClient(config)){
 const repo=operationsRepository(client);
 const caller=Object.values((await repo.load()).state.callersByMode).flat().find(c=>c.id===caseId);
 if(!caller)throw Error('Case not found');
 if(operation?.action==='start'){
  if(caller.rulebook!=='disaster')throw Error('This recovery agent is configured for Disaster');
  if(!caller.retell)throw Error('Recovery requires an existing Retell voice call');
  const outcome=await recoverCall(client,new RetellChatProvider(config,api),config,caller.retell.callId);
  if(!['sent','duplicate_or_ineligible'].includes(outcome))throw Error('Recovery is ineligible or requires reconciliation');
 }
 let context=await chatContext(client,caseId);
 if(operation?.action==='start'&&!context)throw Error('No chat created; case may be ineligible or already claimed by another provider');
 if(!context?.chat_id)return {caseId,name:caller.name,calculatedPriority:caller.calculatedPriority,effectivePriority:caller.priority,
  beforePriority:caller.calculatedPriority,status:context?'unknown':'not_started',analyzed:false,opening:context?.opening??'',messages:[]};
 const chatId=context.chat_id;
 const before=await api.chat.retrieve(chatId);
 const intake=normalizeChat(before,'sync');
 if(intake.agentId!==config.agentId||intake.caseId!==caseId||intake.callId!==context.call_id)throw Error('Session binding invalid');
 if(operation&&operation.action!=='start'){
  if(TERMINAL_STATUSES.includes(caller.status))throw Error('Case is closed');
  if(operation.chatId!==chatId)throw Error('Session changed; reload before sending');
  if(operation.action==='send'){
   if(before.chat_status!=='ongoing')throw Error('Chat is complete');
   const claimed=await client.rpc('zianecomms_chat_turn_claim',{p_case_id:caseId,p_chat_id:chatId,p_request_id:operation.requestId});
   if(claimed.error)throw Error('Cannot claim message');
   if(claimed.data===true){
    // On an uncertain API result the sending claim remains: never blindly replay an expensive turn.
    await api.chat.createChatCompletion({chat_id:chatId,content:operation.content!});
    const finished=await client.rpc('zianecomms_chat_turn_finish',{p_chat_id:chatId,p_request_id:operation.requestId});
    if(finished.error)throw Error('Reply accepted; reload to reconcile before sending again');
   }else {
    const prior=await client.rpc('zianecomms_chat_turn_state',{p_chat_id:chatId,p_request_id:operation.requestId});
    if(prior.error||prior.data!=='complete')throw Error('Message already attempted or another turn is pending; reload rather than resend');
   }
  }else if(operation.action==='end'&&before.chat_status==='ongoing')await api.chat.end(chatId);
 }
 const latest=operation&&operation.action!=='start'?await api.chat.retrieve(chatId):before;
 const normalized=normalizeChat(latest,'sync');
 await ingestChat(client,normalized); // Retrieval sync records messages only; analysis is applied exclusively by the signed webhook.
 context=await chatContext(client,caseId);
 const updated=Object.values((await repo.load()).state.callersByMode).flat().find(c=>c.id===caseId)!;
 return {caseId,name:updated.name,chatId,calculatedPriority:updated.calculatedPriority,effectivePriority:updated.priority,
  beforePriority:context?.before_priority??caller.calculatedPriority,status:latest.chat_status,analyzed:context?.analyzed??false,
  opening:context?.opening??'',messages:normalized.messages};
}
