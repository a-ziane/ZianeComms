// Public fixtures only. Never build this workspace from production database rows.
import { CLINIC_CALLERS, DISASTER_CALLERS, MOCK_RESPONDERS } from './callers';
import { scoreCallerInput } from '@/lib/engine';
import { calculateCustomerFit } from '@/lib/customerFit';
import { newOrganization, type OrganizationRecord } from '@/lib/organization/model';
import type { CaseState } from '@/lib/cases';
import type { Caller, EngineInput } from '@/types';
export const ZIANE_ORG = 'org-d3c2bdba-2e3a-4795-b0a2-ed2254a71443';
export const PUBLIC_CASE_KEY = 'public-demo-cases-v1';
export const PUBLIC_ORG_KEY = 'public-demo-organizations-v1';
export const PUBLIC_SELECTION_KEY = 'public-demo-selected-organization-v1';
const createdAt = '2026-10-17T20:00:00.000Z';
export function amaniDemoCaller(): Caller {
 const message = 'FICTIONAL DEMO: I have had a toothache in my lower right molar since yesterday. The pain is 7/10. I would like a dental assessment and a callback. No swelling, breathing difficulty or rapidly worsening symptoms.';
 const input: EngineInput = { rulebook:'clinic',needCategory:'severe_pain',needDescription:'Toothache in lower right molar for one day; pain 7/10',waitMinutes:8,attempts:1,language:'English',locationZone:'outside',locationDetail:'Fictional demo home, Central Los Angeles',agentOutcome:'caller_requested_human',callerMessage:message,facilitySignals:['severe_pain'] };
 const result=scoreCallerInput(input);
 return {id:'demo-amani-toothache',organizationId:ZIANE_ORG,deploymentId:'los-angeles',provenance:'seed_demo',name:'Amani',phone:'(***) ***-0100',rulebook:'clinic',status:'awaiting_callback',needCategory:'severe_pain',needSummary:'DEMO · Toothache — lower right molar, pain 7/10',callerMessage:message,aiSummary:'Fictional dental demonstration case. Toothache began yesterday; persistent pain 7/10. No reported swelling, breathing difficulty, allergy or rapidly worsening symptoms. Amani requests a human callback for assessment; no appointment has been booked.',language:'English',location:'Fictional demo home, Central Los Angeles',coverageArea:'central',waitMinutes:8,attempts:1,createdAt,engineInput:input,priority:result.priority,calculatedPriority:result.priority,hardEscalation:result.hardEscalation,escalationReason:result.escalationReason,score:result.score,scoreBreakdown:result.breakdown,manualPriority:false,customerFit:calculateCustomerFit({rulebook:'clinic',isExistingPatient:false,facilityCanServeNeed:true,patientLanguageSupported:true}),questionnaire:[{question:'What is the problem?',answer:'FICTIONAL DEMO: Lower right molar toothache since yesterday.'},{question:'How severe is the pain?',answer:'7 out of 10; requests dental assessment.'},{question:'Any swelling, breathing difficulty or rapid worsening?',answer:'No, in this fictional scenario.'},{question:'Allergies or current medication?',answer:'None reported in this fictional scenario; confirm during callback.'},{question:'Preferred language and callback?',answer:'English. Human follow-up requested; fictional contact only.'}],activityLog:[{id:'demo-amani-intake',type:'callback_requested',timestamp:createdAt,label:'Demo callback requested',detail:'User-authorized fictional dental scenario; no real call or SMS was sent.'},{id:'demo-amani-priority',type:'priority_recalculated',timestamp:createdAt,label:`Calculated priority ${result.priority}`,detail:'Existing deterministic Clinic Priority Engine; severe pain signal explicitly supplied for the fictional scenario.'}]};
}
export function publicDemoOrganizations(): OrganizationRecord[] {
 const c=newOrganization(ZIANE_ORG,true);c.name='Ziane Org';
 c.responders=MOCK_RESPONDERS.filter(r=>r.rulebooks.includes('clinic')).map(r=>({...structuredClone(r),id:`public-${r.id}`,organizationId:ZIANE_ORG,deploymentId:'los-angeles'}));
 return [{id:ZIANE_ORG,revision:1,draft:c,active:{version:1,activatedAt:createdAt,configuration:structuredClone(c)},history:[{version:1,activatedAt:createdAt}]}];
}
export function publicDemoState(records=publicDemoOrganizations()): CaseState {
 const active=records.filter(r=>r.active).map(r=>({id:r.id,name:r.active!.configuration.name,version:r.active!.version,rulebook:r.active!.configuration.rulebook,deploymentId:r.active!.configuration.deploymentId,matchingWeights:r.active!.configuration.matchingWeights,responderIds:r.active!.configuration.responders.map(x=>x.id)}));
 return {rulebook:'clinic',callersByMode:{clinic:[amaniDemoCaller(),...structuredClone(CLINIC_CALLERS)],disaster:structuredClone(DISASTER_CALLERS)},responders:[...structuredClone(MOCK_RESPONDERS),...records.flatMap(r=>r.active?.configuration.responders??[])],activeOrganizations:active};
}
