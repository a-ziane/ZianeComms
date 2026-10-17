import React from 'react';
import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {DISASTER_CALLERS,CLINIC_CALLERS} from '@/data/callers';
import {applyHumanOverride,scoreCallerInput} from '@/lib/engine';
import CallerDetailModal from '@/components/CallerDetailModal';
import {serializeCase} from '@/lib/persistence/mapping';
import type {Caller} from '@/types';
import {caseProvenance,needsRecovery,recoveryChatAccess,INTEGRATION_CASE_IDS} from './recovery';
import {repairIncompleteSeed} from './repair-demo';
const time='2026-10-17T20:00:00.000Z';
function live():Caller{return {...DISASTER_CALLERS[5],id:'retell-real_fixture',provenance:'live',source:'retell',
 retell:{callId:'real_fixture',agentId:'agent_fixture',event:'call_analyzed',status:'ended',startedAt:time,endedAt:time,analysisPending:false,
 outcomes:{unresolvedNeed:true,humanRequested:false,automationResolvedRequest:false,emergencyGuidanceProvided:false}}};}
function resolved():Caller{const c=live();return {...c,engineInput:{...c.engineInput!,agentOutcome:'resolved'},retell:{...c.retell!,outcomes:{...c.retell!.outcomes!,unresolvedNeed:false,humanRequested:false,automationResolvedRequest:true}}};}
const state:NonNullable<Caller['recoveryState']>={callId:'real_fixture',provider:'retell-chat',state:'accepted',hasSession:true,ended:false,analyzed:false,pendingTurn:false};
function modal(c:Caller,readOnly=false){return renderToStaticMarkup(<CallerDetailModal caller={c} readOnly={readOnly} onClose={()=>{}} onStartCall={()=>{}} onRecordOutcome={()=>{}} onChangePriority={()=>{}} onAssignResponder={()=>{}}/>);}
describe('Shared actual-need and Recovery Chat availability',()=>{
 it('unresolved live Disaster cases receive an actionable button',()=>{expect(recoveryChatAccess(live()).canStart).toBe(true);expect(modal(live())).toContain('Open Recovery Chat');});
 it('explicit human followup independently qualifies',()=>{const c=resolved();c.retell!.outcomes!.humanRequested=true;expect(needsRecovery(c)).toBe(true);});
 it.each(['needs_followup','no_answer'] as const)('explicit %s status survives an older automation resolution',status=>{expect(needsRecovery({...resolved(),status})).toBe(true);});
 it('qualifying unsuccessful hangup needs explicit structured evidence',()=>{const c=live();c.engineInput={...c.engineInput!,agentOutcome:'unknown'};c.retell!.outcomes=undefined;c.retell!.disconnectionReason='user_hangup';expect(needsRecovery(c)).toBe(false);c.retell!.callSuccessful=false;expect(needsRecovery(c)).toBe(true);});
 it('stale callback/SMS history cannot revive a genuinely resolved request',()=>{const c=resolved();expect(c.activityLog.some(e=>e.type==='callback_requested')).toBe(true);expect(needsRecovery(c)).toBe(false);expect(modal(c)).not.toContain('Open Recovery Chat');});
 it.each(['resolved','referred','duplicate','unable_to_reach'] as const)('terminal %s never permits starting or continuing',status=>{const result=recoveryChatAccess({...live(),status,recoveryState:state});expect(result.canOpen).toBe(false);expect(result.canStart).toBe(false);expect(result.canSend).toBe(false);});
 it('do-not-contact blocks even an existing conversation',()=>{const c=live();c.retell!.disconnectionReason='user_requested_dnc';expect(recoveryChatAccess({...c,recoveryState:state}).canOpen).toBe(false);});
 it('an active existing conversation is continuable even if original voice analysis reported resolution',()=>{expect(recoveryChatAccess({...resolved(),recoveryState:state})).toMatchObject({canOpen:true,canStart:false,canSend:true,code:'continue'});});
 it('ended session awaiting analysis stays inspectable without sending',()=>{expect(recoveryChatAccess({...live(),recoveryState:{...state,ended:true}})).toMatchObject({canOpen:true,canSend:false,code:'awaiting_analysis'});});
 it('completed recovery is inspectable but cannot create a duplicate session',()=>{expect(recoveryChatAccess({...live(),recoveryState:{...state,ended:true,analyzed:true}})).toMatchObject({canOpen:false,canInspect:true,canStart:false,code:'completed'});});
 it('other-provider claim blocks another transport and explains why',()=>{expect(recoveryChatAccess({...live(),recoveryState:{...state,provider:'task6-mock'}})).toMatchObject({canStart:false,canOpen:false,code:'other_transport'});});
 it('uncertain creation or pending turn never enables another send',()=>{expect(recoveryChatAccess({...live(),recoveryState:{...state,hasSession:false,state:'unknown'}})).toMatchObject({canStart:false,code:'pending_recovery'});expect(recoveryChatAccess({...live(),recoveryState:{...state,pendingTurn:true}})).toMatchObject({canOpen:true,canSend:false,code:'pending_turn'});});
 it('a claim for an older completed call does not prevent a fresh eligible voice attempt',()=>{expect(recoveryChatAccess({...live(),recoveryState:{...state,callId:'old_call',ended:true,analyzed:true}}).canStart).toBe(true);});
 it('unsupported mode and read-only preview have no active button',()=>{expect(modal({...live(),rulebook:'clinic'})).not.toContain('Open Recovery Chat');expect(modal(live(),true)).not.toContain('Open Recovery Chat');});
 it.each(INTEGRATION_CASE_IDS)('known verification record %s never starts real Chat',id=>{const c={...live(),id,provenance:undefined};expect(caseProvenance(c)).toBe('integration_test');expect(recoveryChatAccess(c).code).toBe('integration_test');expect(modal(c)).toContain('INTEGRATION TEST');expect(modal(c)).not.toContain('Open Recovery Chat');});
 it('explicit integration provenance blocks future fixtures without caller-name heuristics',()=>{expect(recoveryChatAccess({...live(),provenance:'integration_test'}).canStart).toBe(false);expect(recoveryChatAccess({...live(),name:'Synthetic is my actual surname'}).canStart).toBe(true);});
 it('seeded cases can require human followup without pretending to have a real voice session',()=>{const david=DISASTER_CALLERS[5];expect(needsRecovery(david)).toBe(true);expect(recoveryChatAccess(david).code).toBe('seed_demo');expect(modal(david)).toContain('SEEDED DEMO');expect(modal(david)).not.toContain('Open Recovery Chat');});
 it('read-only projected recovery data is never written back as authoritative case state',()=>{expect(serializeCase({...live(),recoveryState:state}).data).not.toHaveProperty('recoveryState');});
});
describe('Truthful seeded outcomes and append-only correction',()=>{
 it.each([DISASTER_CALLERS[5],CLINIC_CALLERS[4],CLINIC_CALLERS[5]])('$name needs promised followup, not a resolved discount',c=>{expect(c.engineInput?.agentOutcome).toBe('could_not_resolve');expect(c.activityLog.some(e=>e.type==='callback_requested')).toBe(true);expect(c.activityLog.some(e=>e.type==='sms_sent')).toBe(true);expect(c.scoreBreakdown.some(b=>b.points<0)).toBe(false);});
 it('genuinely resolved outage seed is closed and historical events remain',()=>{const john=DISASTER_CALLERS[4];expect(john.status).toBe('resolved');expect(john.engineInput?.facilitySignals).not.toContain('info_unresolved');expect(john.activityLog.some(e=>e.type==='callback_requested')).toBe(true);expect(john.activityLog.at(-1)?.type).toBe('case_closed');});
 function legacy():Caller{const c=DISASTER_CALLERS[5];const input={...c.engineInput!,agentOutcome:'resolved' as const};const r=scoreCallerInput(input);return {...c,engineInput:input,score:r.score,scoreBreakdown:r.breakdown,priority:r.priority,calculatedPriority:r.priority,activityLog:c.activityLog.filter(e=>e.type!=='data_corrected')};}
 it('repairs legacy David via engine without erasing history or adding a voice attempt',()=>{const c=legacy(),next=repairIncompleteSeed(c,time);expect(next.engineInput?.agentOutcome).toBe('could_not_resolve');expect(next.score).toBe(scoreCallerInput(next.engineInput!).score);expect(next.activityLog.slice(0,c.activityLog.length)).toEqual(c.activityLog);expect(next.activityLog.at(-1)?.type).toBe('data_corrected');expect(next.attempts).toBe(c.attempts);expect(repairIncompleteSeed(next,time)).toBe(next);});
 it('correction preserves an active human override and its audit',()=>{let c=legacy();const o=applyHumanOverride(c,2,'Keep original human decision','operator-test');c={...c,...o.callerPatch,activityLog:[...c.activityLog,o.logEntry]};const next=repairIncompleteSeed(c,time);expect(next.priority).toBe(2);expect(next.manualPriorityReason).toBe('Keep original human decision');expect(next.activityLog).toContainEqual(o.logEntry);});
 it('does not reopen or rewrite an operator-resolved or real case',()=>{const c=legacy();expect(repairIncompleteSeed({...c,status:'resolved'},time).status).toBe('resolved');const real=live();expect(repairIncompleteSeed(real,time)).toBe(real);});
});
