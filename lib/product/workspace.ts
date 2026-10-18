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
export const PRODUCT_KEY='product-demo-workspace-v1';
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
export function initialWorkspace(now='2026-10-18T03:00:00.000Z'):ProductWorkspace{
 const orgs=publicDemoOrganizations();
 const responders:Responder[]=[...structuredClone(MOCK_RESPONDERS),...orgs.flatMap(o=>o.active!.configuration.responders)];
 let w:ProductWorkspace={cases:{rulebook:'disaster',callersByMode:{disaster:[],clinic:[]},responders,activeOrganizations:organizationSummaries(orgs)},context:{},synchronizedIds:[],updatedAt:now};
 for(const line of ['911','311','defense','custom'] as const)w=addScenario(w,line,now,orgs[0].active!.configuration);
 return w;
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
