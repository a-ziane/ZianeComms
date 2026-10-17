import type {Caller} from '@/types';
import {TERMINAL_STATUSES} from './index';
// Exact legacy verification IDs, not caller-name or transcript inference.
export const INTEGRATION_CASE_IDS = [
 'retell-task6_synthetic_1792263310949',
 'retell-zianecomms_integration_check_routine_20261017',
 'retell-zianecomms_integration_check_emergency_20261017',
];
export function caseProvenance(caller:Caller):'integration_test'|'seed_demo'|'live' {
 if(INTEGRATION_CASE_IDS.includes(caller.id))return 'integration_test';
 if(caller.provenance)return caller.provenance;
 if(/^(dc|cc)-00[1-6]$/.test(caller.id))return 'seed_demo';
 return 'live';
}
export function needsRecovery(caller:Caller):boolean {
 if(TERMINAL_STATUSES.includes(caller.status)||caller.retell?.disconnectionReason==='user_requested_dnc')return false;
 if(['needs_followup','no_answer'].includes(caller.status))return true;
 const o=caller.retell?.outcomes;
 if(o?.unresolvedNeed===true||o?.humanRequested===true)return true;
 if(o?.automationResolvedRequest===true)return false;
 if(['could_not_resolve','caller_requested_human','caller_unsatisfied'].includes(caller.engineInput?.agentOutcome??''))return true;
 if(['resolved','caller_confirmed_resolved'].includes(caller.engineInput?.agentOutcome??''))return false;
 return caller.retell?.disconnectionReason==='user_hangup'&&caller.retell.callSuccessful===false;
}
export function recoveryChatAccess(caller:Caller){
 const blocked=(code:string,reason:string)=>({canOpen:false,canInspect:false,canStart:false,canSend:false,code,reason});
 const origin=caseProvenance(caller);
 if(origin==='integration_test')return blocked('integration_test','Synthetic integration-test case: mocked transport only. Use a fresh real Retell voice call for the Recovery Chat demo.');
 if(origin==='seed_demo')return blocked('seed_demo','Seeded demo case: no real Retell voice session. Use a fresh real Retell voice call for Recovery Chat.');
 if(TERMINAL_STATUSES.includes(caller.status))return {...blocked('closed','This case is closed. Recovery Chat cannot reopen it.'),canInspect:caller.recoveryState?.provider==='retell-chat'&&caller.recoveryState.hasSession};
 if(caller.retell?.disconnectionReason==='user_requested_dnc')return blocked('do_not_contact','Caller requested no further contact.');
 if(caller.rulebook!=='disaster')return blocked('unsupported_mode','This Recovery Chat Agent supports Disaster cases.');
 if(caller.source!=='retell'||!caller.retell)return blocked('no_voice_call','Recovery Chat needs a recorded Retell voice call.');
 const state=caller.recoveryState;
 if(state&&state.callId===caller.retell.callId&&state.provider!=='retell-chat')return blocked('other_transport','This call already has a recovery claim from another transport. No second recovery will be created. Use a fresh real voice attempt.');
 if(state?.provider==='retell-chat'&&state.hasSession&&(!state.ended||!state.analyzed))return {
  canOpen:true,canInspect:true,canStart:false,canSend:!state.ended&&!state.pendingTurn,code:state.pendingTurn?'pending_turn':state.ended?'awaiting_analysis':'continue',
  reason:state.pendingTurn?'A previous message has an uncertain or pending result. Inspect the existing conversation; do not resend.':state.ended?'Conversation ended; waiting for signed analysis.':'Continue the existing recovery conversation.'};
 if(state&&state.callId===caller.retell.callId)return {...blocked(state.hasSession?'completed':'pending_recovery',state.hasSession?
  'This recovery conversation is complete. A new need requires a fresh voice attempt.':'Recovery creation has a pending or uncertain result. Reconcile the existing claim; do not create another session.'),canInspect:state.hasSession};
 if(!needsRecovery(caller))return blocked('no_followup','No current unresolved need, human follow-up or qualifying unfinished interaction is recorded.');
 return {canOpen:true,canInspect:false,canStart:true,canSend:false,code:'eligible',reason:'Active case requires recovery follow-up.'};
}
