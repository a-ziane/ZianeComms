import {scoreCallerInput,sortCallers,mergeRepeatInput} from '@/lib/engine';
import {caseReducer,recommendationSignature,recordOutcome,synchronizeWorkload,TERMINAL_STATUSES,type CaseState,type CaseAction} from '@/lib/cases';
import {matchResponders} from '@/lib/matching';
import {deploymentResponders} from '@/lib/cases/deployment';
import {matchingForCaller,type OrganizationConfig,type OrganizationRecord} from '@/lib/organization/model';
import {amaniDemoCaller,publicDemoOrganizations} from '@/data/public-demo';
import {MOCK_RESPONDERS} from '@/data/callers';
import {LINES,lineRulebook,type LineId} from '@/config/product/lines';
import {demoLocation,type CaseLocation} from './geography';
import type {Caller,EngineInput,NeedCategory,Responder} from '@/types';
import type {DeploymentId} from '@/config/deployments';
import {helpCaller,validateHelpRequest,type HelpRequest} from '@/lib/help/intake';
export interface CaseContext {line:LineId;location:CaseLocation;receipt:'received'|'synchronized';method:'demo_intake'|'demo_recovery'|'offline_form';confirmed:string[];unknown:string[]}
export interface ProductWorkspace {cases:CaseState;context:Record<string,CaseContext>;synchronizedIds:string[];updatedAt:string}
export const PRODUCT_KEY='product-demo-workspace-v2';
export const PRODUCT_PREFIX='product-demo-queue:';
export function organizationSummaries(records:OrganizationRecord[]){return records.filter(r=>r.active).map(r=>({id:r.id,name:r.active!.configuration.name,version:r.active!.version,rulebook:r.active!.configuration.rulebook,deploymentId:r.active!.configuration.deploymentId,matchingWeights:r.active!.configuration.matchingWeights,responderIds:r.active!.configuration.responders.map(x=>x.id)}));}
export function allCases(w:ProductWorkspace){return Object.values(w.cases.callersByMode).flat();}
export function lineCases(w:ProductWorkspace,line:LineId){return sortCallers(allCases(w).filter(c=>w.context[c.id]?.line===line));}
const scenes:Record<Exclude<LineId,'custom'>,{name:string;title:string;message:string;category:NeedCategory;signals:string[];area:'central'|'eastside'|'west'|'north';facts:string[]}>={
 '911':{name:'Jordan Lee',title:'Person trapped · smoke approaching',message:'My neighbor cannot leave the building. There is smoke outside and the exit is blocked.',category:'evacuation',signals:['immediate_life_threat','person_trapped','mobility_vulnerability'],area:'eastside',facts:['Person trapped: confirmed in synthetic scenario','Immediate danger: confirmed in synthetic scenario','Mobility assistance needed: confirmed']},
 '311':{name:'Morgan Reyes',title:'Fallen tree blocking the road',message:'A fallen tree is blocking the road and accessible crossing. Several neighbors cannot get through.',category:'general_disaster',signals:['dangerous_infrastructure','blocked_access','multiple_people_affected'],area:'west',facts:['Roadway blocked: confirmed in synthetic scenario','Public-safety impact: confirmed','Multiple people affected: confirmed']},
 '211':{name:'Samira Bennett',title:'Family displaced · needs shelter',message:'We had to leave our home. We are safe right now, but our family needs somewhere to stay tonight.',category:'shelter',signals:['urgent_evacuation_shelter'],area:'central',facts:['Shelter requested: confirmed','Currently safe: confirmed in synthetic scenario','Human follow-up requested: confirmed']},
 defense:{name:'Alex Rivera',title:'Personnel support · communications outage',message:'Our support facility has lost communications and a supply delivery is delayed. Everyone is currently safe. We need a continuity check.',category:'welfare_check',signals:['communications_loss','logistics_disruption'],area:'north',facts:['Communications unavailable: confirmed','Logistics interruption: confirmed','Immediate danger: no in this synthetic scenario']},
};
export function scenarioCaller(line:LineId,now:string,organization?:OrganizationConfig,profile:DeploymentId='los-angeles'):Caller{
 if(line==='custom'){
  const c=amaniDemoCaller();const config=lineRulebook(line,organization),engineInput={...c.engineInput!,rulebook:config.id};
  if(config.id==='disaster'){engineInput.needCategory='outage_information';engineInput.facilitySignals=['info_unresolved'];engineInput.needDescription='Organization service request requiring follow-up';}
  const r=scoreCallerInput(engineInput,config);
  return {...c,organizationId:organization?.id??c.organizationId,deploymentId:organization?.deploymentId??profile,rulebook:config.id,engineInput,createdAt:now,priority:r.priority,calculatedPriority:r.priority,score:r.score,scoreBreakdown:r.breakdown,hardEscalation:r.hardEscalation,escalationReason:r.escalationReason,activityLog:[{id:`${c.id}-created`,type:'callback_requested',timestamp:now,label:'Demo caller received',detail:'Fictional organization callback; no provider call or SMS sent.'}]};
 }
 const s=scenes[line],input:EngineInput={rulebook:'disaster',needCategory:s.category,needDescription:s.title,callerMessage:s.message,waitMinutes:0,attempts:1,language:profile==='algeria'?'French':'English',locationZone:'unknown',locationDetail:demoLocation(s.area,profile).label,agentOutcome:'caller_requested_human',facilitySignals:[...s.signals]};
 const r=scoreCallerInput(input,lineRulebook(line));
 return {id:`product-${line}-demo`,name:s.name,phone:'(***) ***-0101',provenance:'seed_demo',deploymentId:profile,rulebook:'disaster',status:'awaiting_callback',needCategory:s.category,needSummary:s.title,callerMessage:s.message,aiSummary:`SYNTHETIC SCENARIO. ${s.message} Explicit demo facts supplied; no live AI extraction ran.`,language:input.language,location:input.locationDetail,coverageArea:profile==='los-angeles'?s.area:undefined,waitMinutes:0,attempts:1,createdAt:now,engineInput:input,priority:r.priority,calculatedPriority:r.priority,hardEscalation:r.hardEscalation,escalationReason:r.escalationReason,score:r.score,scoreBreakdown:r.breakdown,manualPriority:false,questionnaire:s.facts.map(f=>({question:f.split(':')[0],answer:f.split(':').slice(1).join(':').trim()})),activityLog:[{id:`product-${line}-intake`,type:'callback_requested',timestamp:now,label:'Request received · demo',detail:'Explicit synthetic scenario received locally. No emergency service contacted.'},{id:`product-${line}-score`,type:'priority_calculated',timestamp:now,label:`Priority ${r.priority} · ${LINES[line].label} rules`,detail:'Existing generic deterministic engine, demo line configuration.'}]};
}
export function addScenario(w:ProductWorkspace,line:LineId,now:string,organization?:OrganizationConfig,profile:DeploymentId='los-angeles',changes?:{message?:string;name?:string;language?:string;location?:CaseLocation;danger?:'yes'|'no'|'unknown'}):ProductWorkspace{
 let c=scenarioCaller(line,now,organization,profile);
 const existing=allCases(w).find(x=>x.id===c.id);
 if(existing)return w; // Scenario controls never overwrite an already reviewed case or its history.
 if(changes){
  const input={...c.engineInput!,callerMessage:changes.message?.trim()||c.callerMessage,language:changes.language||c.language,locationDetail:changes.location?.label??c.location};
  if(changes.danger==='yes')input.facilitySignals=Array.from(new Set([...input.facilitySignals,'immediate_life_threat']));
  const r=scoreCallerInput(input,lineRulebook(line,organization));
  c={...c,name:changes.name?.trim()||c.name,callerMessage:input.callerMessage,language:input.language,location:input.locationDetail,engineInput:input,priority:r.priority,calculatedPriority:r.priority,hardEscalation:r.hardEscalation,escalationReason:r.escalationReason,score:r.score,scoreBreakdown:r.breakdown,aiSummary:`DEMO intake. Structured facts are selected explicitly; free text is retained for human review. ${input.callerMessage}`};
 }
 const loc=changes?.location??demoLocation(c.coverageArea,profile);
 return {...w,cases:{...w.cases,callersByMode:{...w.cases.callersByMode,[c.rulebook]:[...w.cases.callersByMode[c.rulebook],c]}},context:{...w.context,[c.id]:{line,location:loc,receipt:'received',method:'demo_intake',confirmed:c.questionnaire.map(q=>`${q.question}: ${q.answer}`),unknown:['Exact address unless explicitly shared','Resource availability','Response time']}},updatedAt:now};
}
const extraScenarios:Array<{line:LineId;slug:string;name:string;summary:string;message:string;category:NeedCategory;signals:string[];outcome:EngineInput['agentOutcome'];wait:number;attempts:number;area:'central'|'eastside'|'west'|'north';language?:string}>=[
 {line:'911',slug:'unresponsive',name:'Elena Martinez',summary:'Unresponsive adult · breathing uncertain',message:'An adult collapsed and is not responding. Breathing is uncertain.',category:'urgent_symptoms',signals:['person_unresponsive'],outcome:'directed_to_911',wait:1,attempts:1,area:'central',language:'Spanish'},
 {line:'911',slug:'equipment',name:'Robert Chen',summary:'Powered medical equipment unavailable',message:'A power failure stopped essential medical equipment. The caller confirms an immediate safety concern.',category:'medical_equipment',signals:['medical_equipment_dependency','affected_by_active_crisis'],outcome:'caller_requested_human',wait:3,attempts:2,area:'north'},
 {line:'911',slug:'welfare',name:'Nadia Brooks',summary:'Welfare check · no immediate danger confirmed',message:'A neighbor has not answered. No danger, injury, or emergency condition is confirmed.',category:'welfare_check',signals:['welfare_check_needed'],outcome:'caller_requested_human',wait:8,attempts:1,area:'west'},
 {line:'311',slug:'signal',name:'Priya Shah',summary:'Traffic signal dark at major crossing',message:'The traffic signal is dark and vehicles are entering the crossing without direction.',category:'general_disaster',signals:['dangerous_infrastructure','multiple_people_affected'],outcome:'caller_requested_human',wait:12,attempts:2,area:'central'},
 {line:'311',slug:'sidewalk',name:'Marcus Green',summary:'Accessible sidewalk blocked',message:'Construction debris blocks the accessible sidewalk route. No immediate danger is confirmed.',category:'mobility_issue',signals:['blocked_access'],outcome:'caller_requested_human',wait:24,attempts:1,area:'eastside'},
 {line:'311',slug:'streetlight',name:'Sofia Alvarez',summary:'Streetlight outage report',message:'Two streetlights are out on the block. The report is complete and no hazard is confirmed.',category:'outage_information',signals:['info_unresolved'],outcome:'resolved',wait:4,attempts:1,area:'west',language:'Spanish'},
 {line:'211',slug:'shelter',name:'Samira Bennett',summary:'Family displaced · shelter tonight',message:'The family is safe now but displaced and needs shelter tonight.',category:'shelter',signals:['urgent_evacuation_shelter','affected_by_active_crisis'],outcome:'caller_requested_human',wait:18,attempts:2,area:'central'},
 {line:'211',slug:'transport',name:'DeShawn Wilson',summary:'Transportation to cooling center',message:'An older adult needs accessible transportation to a cooling center. No immediate danger is confirmed.',category:'mobility_issue',signals:['no_transportation','mobility_vulnerability'],outcome:'caller_requested_human',wait:31,attempts:3,area:'eastside'},
 {line:'211',slug:'food',name:'Fatima Rahal',summary:'Food and utility resource navigation',message:'The caller needs food and utility assistance information after a service interruption.',category:'other',signals:['resource_navigation'],outcome:'caller_requested_human',wait:43,attempts:1,area:'north',language:'Arabic'},
 {line:'defense',slug:'medical',name:'Taylor Morgan',summary:'Personnel medical support requested',message:'A team member needs medical support and powered equipment is unavailable.',category:'medical_equipment',signals:['medical_equipment_dependency','communications_loss'],outcome:'caller_requested_human',wait:4,attempts:1,area:'north'},
 {line:'defense',slug:'welfare',name:'Casey Nguyen',summary:'Welfare check after communications loss',message:'Routine contact was missed after a communications interruption. No danger is confirmed.',category:'welfare_check',signals:['welfare_check_needed','communications_loss'],outcome:'caller_requested_human',wait:15,attempts:2,area:'west'},
 {line:'defense',slug:'supply',name:'Robin Davis',summary:'Continuity supply delivery delayed',message:'A support supply delivery is delayed. Personnel are safe and an updated handoff is needed.',category:'other',signals:['logistics_disruption'],outcome:'caller_requested_human',wait:27,attempts:1,area:'central'},
 {line:'custom',slug:'urgent-dental',name:'Lena Ortiz',summary:'Facial swelling · urgent dental callback',message:'Facial swelling and severe dental pain began today. A clinician callback is requested.',category:'urgent_symptoms',signals:['severe_symptoms'],outcome:'caller_requested_human',wait:6,attempts:2,area:'eastside',language:'Spanish'},
 {line:'custom',slug:'prescription',name:'Omar Haddad',summary:'Prescription refill question',message:'The patient needs help understanding how to request a routine refill.',category:'prescription',signals:[],outcome:'caller_requested_human',wait:22,attempts:1,area:'north',language:'Arabic'},
 {line:'custom',slug:'billing',name:'Grace Kim',summary:'Billing statement question',message:'The caller has a nonurgent question about a statement and insurance entry.',category:'billing',signals:[],outcome:'resolved',wait:35,attempts:1,area:'west'},
];
function addCatalogCases(w:ProductWorkspace,now:string,organization?:OrganizationConfig,profile:DeploymentId='los-angeles'){
 let next=w;
 for(const s of extraScenarios){
  const config=lineRulebook(s.line,organization),input:EngineInput={rulebook:config.id,needCategory:s.category,needDescription:s.summary,callerMessage:s.message,waitMinutes:s.wait,attempts:s.attempts,language:s.language??'English',locationZone:'unknown',locationDetail:demoLocation(s.area,profile).label,agentOutcome:s.outcome,facilitySignals:s.signals};
  const result=scoreCallerInput(input,config),id=`product-${s.line}-${s.slug}`;
  const caller:Caller={id,name:s.name,phone:'(***) ***-0101',provenance:'seed_demo',deploymentId:s.line==='custom'?(organization?.deploymentId??profile):profile,organizationId:s.line==='custom'?organization?.id:undefined,rulebook:config.id,status:s.outcome==='resolved'?'resolved':'awaiting_callback',needCategory:s.category,needSummary:s.summary,callerMessage:s.message,aiSummary:`SYNTHETIC SCENARIO. ${s.message} Structured facts are explicit demo inputs.`,language:input.language,location:input.locationDetail,coverageArea:profile==='los-angeles'?s.area:undefined,waitMinutes:s.wait,attempts:s.attempts,createdAt:now,engineInput:input,priority:result.priority,calculatedPriority:result.priority,hardEscalation:result.hardEscalation,escalationReason:result.escalationReason,score:result.score,scoreBreakdown:result.breakdown,manualPriority:false,questionnaire:s.signals.map(signal=>({question:signal.replaceAll('_',' '),answer:'Confirmed in synthetic scenario'})),activityLog:[{id:`${id}-created`,type:'callback_requested',timestamp:now,label:'Synthetic request received',detail:'Fictional training case; no call, SMS, dispatch, or provider action occurred.'},{id:`${id}-score`,type:'priority_calculated',timestamp:now,label:`Calculated Priority ${result.priority}`,detail:`Deterministic ${LINES[s.line].label} demo rulebook.`}]};
  next={...next,cases:{...next.cases,callersByMode:{...next.cases.callersByMode,[caller.rulebook]:[...next.cases.callersByMode[caller.rulebook],caller]}},context:{...next.context,[id]:{line:s.line,location:demoLocation(s.area,profile),receipt:'received',method:'demo_intake',confirmed:s.signals.map(x=>`${x.replaceAll('_',' ')}: confirmed`),unknown:['Exact address unless explicitly shared','Current resource availability','Response time']}},updatedAt:now};
 }
 return next;
}
export function initialWorkspace(now='2026-10-18T03:00:00.000Z'):ProductWorkspace{
 const orgs=publicDemoOrganizations();
 const responders:Responder[]=[...structuredClone(MOCK_RESPONDERS),...orgs.flatMap(o=>o.active!.configuration.responders)];
 let w:ProductWorkspace={cases:{rulebook:'disaster',callersByMode:{disaster:[],clinic:[]},responders,activeOrganizations:organizationSummaries(orgs)},context:{},synchronizedIds:[],updatedAt:now};
 for(const line of ['911','311','211','defense','custom'] as const)w=addScenario(w,line,now,orgs[0].active!.configuration);
 return addCatalogCases(w,now,orgs[0].active!.configuration);
}
export function productMatching(w:ProductWorkspace,c:Caller){return matchResponders(c,deploymentResponders(c,w.cases.responders??[],w.cases.activeOrganizations),matchingForCaller(c,w.cases.activeOrganizations));}
export function approveAssignment(w:ProductWorkspace,caseId:string,responderId:string,now:string):ProductWorkspace{
 const c=allCases(w).find(x=>x.id===caseId);if(!c)throw Error('Case unavailable');
 const result=productMatching(w,c),id=`recommendation-${caseId}-${now}`;
 const snapshot={id,shownAt:now,result,callerPriority:c.priority,signature:recommendationSignature(result,c.priority)};
 let cases=caseReducer(w.cases,{type:'recommendation_shown',rulebook:c.rulebook,id:c.id,snapshot,operatorId:'demo-human'});
 cases=caseReducer(cases,{type:'assign',rulebook:c.rulebook,id:c.id,responderId,snapshotId:id,humanApproved:true,operatorId:'demo-human',timestamp:now,eventId:`assignment-${caseId}-${now}`});
 const assigned=Object.values(cases.callersByMode).flat().find(x=>x.id===caseId);
 if(assigned?.assignedResponderId!==responderId)throw Error('Assignment unavailable. Review responder status and the latest case.');
 return {...w,cases,updatedAt:now};
}
export function recoverCase(w:ProductWorkspace,id:string,now:string):ProductWorkspace{
 const c=allCases(w).find(x=>x.id===id);if(!c?.engineInput||TERMINAL_STATUSES.includes(c.status))throw Error('Choose an active case for recovery.');
 const line=w.context[id].line;
 const input=mergeRepeatInput(c.engineInput,{needCategory:'medical_equipment',facilitySignals:['immediate_life_threat','medical_equipment_dependency'],agentOutcome:'directed_to_911',callerMessage:'SYNTHETIC RECOVERY: Our oxygen machine has stopped because power failed. Breathing support is unavailable. Immediate danger confirmed.'});
 const r=scoreCallerInput(input,lineRulebook(line));
 const cases=caseReducer(w.cases,{type:'patch',rulebook:c.rulebook,id,patch:{engineInput:input,needCategory:input.needCategory,needSummary:'Recovery · oxygen equipment stopped',callerMessage:input.callerMessage,attempts:input.attempts,calculatedPriority:r.priority,priority:c.manualPriority?c.overridePriority??c.priority:r.priority,score:r.score,scoreBreakdown:r.breakdown,hardEscalation:r.hardEscalation,escalationReason:r.escalationReason,lastRecommendation:undefined},logEntry:{id:`recovery-${id}-${now}`,type:'priority_recalculated',timestamp:now,label:`Recovery · Priority ${c.calculatedPriority} → ${r.priority}`,previousPriority:c.priority,newPriority:c.manualPriority?c.priority:r.priority,calculatedPriority:r.priority,detail:'Simulated structured recovery facts, not a live Retell conversation. Oxygen equipment power loss and immediate danger explicitly confirmed. Existing human overrides are preserved.'}});
 return {...w,cases,context:{...w.context,[id]:{...w.context[id],method:'demo_recovery',confirmed:[...w.context[id].confirmed,'Medical equipment failed: confirmed','Immediate danger: confirmed']}},updatedAt:now};
}
export function changeCase(w:ProductWorkspace,action:CaseAction,now:string):ProductWorkspace{return {...w,cases:caseReducer(w.cases,action),updatedAt:now};}
export function outcomeCase(w:ProductWorkspace,id:string,outcome:Parameters<typeof recordOutcome>[0],now:string):ProductWorkspace{
 const c=allCases(w).find(x=>x.id===id);if(!c)throw Error('Case unavailable');const {callerPatch,logEntry}=recordOutcome(outcome,c);
 return changeCase(w,{type:'patch',rulebook:c.rulebook,id,patch:callerPatch,logEntry:{...logEntry,timestamp:now}},now);
}
export function offlineScenario(now:string,id:string):HelpRequest{return validateHelpRequest({id,deploymentId:'algeria',createdOnDeviceAt:now,savedOffline:true,name:'DEMO · Famille Amrani',contact:'',language:'fr',need:'SYNTHETIC DEMO: famille déplacée, besoin d’un abri. Localisation approximative fournie.',service:'shelter',immediateDanger:'no',medicalNeed:'unknown',mobilityNeed:'unknown',equipmentNeed:'unknown',crisisContext:'yes',unableToEvacuate:'unknown',powerDisruption:'unknown',location:{wilaya:'Alger',commune:'Zone de démonstration',details:'Synthetic area only; no exact address'}});}
export function receiveOffline(w:ProductWorkspace,request:HelpRequest,now:string):ProductWorkspace{
 if(w.synchronizedIds.includes(request.id))return w;
 const c={...helpCaller(validateHelpRequest(request),now),provenance:'seed_demo' as const,phone:'***-****'};
 return {...w,cases:synchronizeWorkload({...w.cases,callersByMode:{...w.cases.callersByMode,disaster:[...w.cases.callersByMode.disaster,c]}}),context:{...w.context,[c.id]:{line:'211',location:demoLocation('central','algeria'),receipt:'synchronized',method:'offline_form',confirmed:['Caller-selected shelter need','Caller-confirmed crisis context','French preferred'],unknown:['Exact location','Medical and mobility needs','Resource availability']}},synchronizedIds:[...w.synchronizedIds,request.id],updatedAt:now};
}
