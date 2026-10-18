import { deployment, DEPLOYMENTS, type DeploymentId } from '@/config/deployments';
import { MATCHING_CONFIG } from '@/config/matching';
import type { Responder, Rulebook, MatchFactor, Caller } from '@/types';
export interface Question { id: string; text: string; required: boolean; enabled: boolean }
export interface KnowledgeItem { id: string; title: string; content: string; status: 'draft'|'ai_suggestion'|'approved'; updatedAt: string; source: string }
export interface Suggestion { id: string; kind: 'questionnaire'|'knowledge'; status: 'pending'|'accepted'|'rejected'; questions?: Question[]; item?: KnowledgeItem }
export interface OrganizationConfig {
 id: string; name: string; type: string; description: string; serviceArea: string; operatingHours: string;
 deploymentId: DeploymentId; languages: string[]; purpose: string; operatingMode: 'normal'|'crisis'|'both'; rulebook: Rulebook;
 channels: ('voice'|'recovery_chat'|'offline_help_form')[]; recoveryEnabled: boolean; emergencyGuidance: string; callbackExpectations: string;
 questionnaires: Record<string,Question[]>; knowledge: KnowledgeItem[]; responders: Responder[];
 matchingWeights: Record<MatchFactor,number>; suggestions: Suggestion[];
}
export interface ConfigVersion { version: number; activatedAt: string; configuration: OrganizationConfig }
export interface OrganizationRecord { id: string; revision: number; draft: OrganizationConfig; active: ConfigVersion|null; history: {version:number;activatedAt:string}[] }
export interface ActiveOrganization { id:string; name:string; version:number; rulebook:Rulebook; deploymentId:DeploymentId; matchingWeights:Record<MatchFactor,number>; responderIds:string[] }
export const SCOPE = (deploymentId: DeploymentId, mode: Rulebook) => `${deploymentId}:${mode}`;
export const DEFAULT_ORGANIZATION = 'zianecomms-demo';
export const ORGANIZATION_TYPES = ['Clinic / healthcare office','Utility','City / public information line','University','Service business','Crisis / disaster assistance','Other'];
export const QUESTION_DEFAULTS:Record<Rulebook,Question[]> = {
 clinic: [
  ['purpose','What can we help you with today?'],['severe-pain','Are you experiencing severe pain?'],['allergic','Is there swelling or a possible allergic reaction?'],
  ['worsening','Is the problem getting rapidly worse?'],['prescription','Is this about a prescription?'],['appointment','Do you need an appointment?'],['language','What language would you prefer for follow-up?'],
 ].map(([id,text])=>({id:`clinic-${id}`,text,enabled:true,required:['purpose','severe-pain','allergic'].includes(id)})),
 disaster: [['purpose','What happened and what help do you need?'],['danger','Are you or someone else in immediate danger?'],['location','Where are you? Share any area, landmark or other details you know.'],['mobility','Does anyone need help evacuating because of limited mobility?'],['language','What language would you prefer?']].map(([id,text])=>({id:`disaster-${id}`,text,enabled:true,required:['purpose','danger'].includes(id)})),
};
export function safetyQuestion(id:string) { return ['clinic-severe-pain','clinic-allergic','disaster-danger'].includes(id); }
export function newOrganization(id:string, dental=false):OrganizationConfig {
 const profile=deployment('los-angeles');
 return { id,name:dental?'Ziane Dental Demo':'',type:dental?ORGANIZATION_TYPES[0]:'Other',description:dental?'Fictional dental clinic for the ZianeComms demo.':'',serviceArea:dental?'Fictional Los Angeles service area':'',operatingHours:dental?'Fictional demo hours: Monday–Friday, 09:00–17:00':'',
 deploymentId:profile.id,languages:['en','es'],purpose:dental?'Patients call for appointments, billing, prescription questions and urgent dental symptoms.':'',operatingMode:dental?'normal':'crisis',rulebook:dental?'clinic':'disaster',channels:['voice','recovery_chat','offline_help_form'],recoveryEnabled:true,
 emergencyGuidance:profile.emergencyGuidance,callbackExpectations:'A human reviews follow-up requests. A response time is not guaranteed.',
 questionnaires:Object.fromEntries(Object.values(DEPLOYMENTS).flatMap(p=>(['clinic','disaster'] as Rulebook[]).map(mode=>[SCOPE(p.id,mode),structuredClone(QUESTION_DEFAULTS[mode])]))),
 knowledge:dental?[{id:'dental-demo-hours',title:'Fictional demo operating hours',content:'FICTIONAL DEMO CONTENT: This is not a real clinic. Demo office hours: Monday–Friday, 09:00–17:00.',status:'approved',updatedAt:new Date().toISOString(),source:'Human-selected fictional demo template'},
 {id:'dental-demo-services',title:'Fictional demo services',content:'FICTIONAL DEMO CONTENT: Demo appointments, billing enquiries and prescription questions. No real services or prescriptions are provided.',status:'approved',updatedAt:new Date().toISOString(),source:'Human-selected fictional demo template'},
 {id:'dental-demo-appointments',title:'Fictional appointment information',content:'FICTIONAL DEMO CONTENT: An operator can review an appointment request. This demo cannot book an appointment.',status:'approved',updatedAt:new Date().toISOString(),source:'Human-selected fictional demo template'}]:[],responders:[],matchingWeights:{...MATCHING_CONFIG.weights},suggestions:[] };
}
export function validWeights(weights:unknown):weights is OrganizationConfig['matchingWeights'] {
 if(!weights||typeof weights!=='object'||Array.isArray(weights))return false;
 const w=weights as Record<string,number>;const keys=Object.keys(MATCHING_CONFIG.weights);
 return Object.keys(w).length===keys.length&&keys.every(k=>Number.isFinite(w[k])&&w[k]>=0&&w[k]<=100)&&keys.reduce((n,k)=>n+w[k],0)===100;
}
export function activationIssues(c:OrganizationConfig):string[] {
 const missing=[];
 if(!c.name.trim())missing.push('Organization name');if(!c.purpose.trim())missing.push('Phone line purpose');if(!c.serviceArea.trim())missing.push('Service area');
 if(!c.languages.length)missing.push('At least one supported language');if(!c.emergencyGuidance.trim())missing.push('Emergency guidance');if(!c.callbackExpectations.trim())missing.push('Callback expectations');
 if(!c.channels.length)missing.push('At least one communication channel');if(!validWeights(c.matchingWeights))missing.push('Matching weights must total 100');
 if(!(c.questionnaires[SCOPE(c.deploymentId,c.rulebook)]??[]).some(q=>q.enabled))missing.push('Enabled questionnaire');
 if(!c.responders.length)missing.push('At least one responder');
 else if(!c.responders.some(r=>r.rulebooks.includes(c.rulebook)))missing.push('At least one responder for the selected rulebook');
 if(c.knowledge.some(k=>k.status==='approved'&&(!k.title.trim()||!k.content.trim()||k.content.includes('Add verified organization information here'))))missing.push('Verified non-empty approved knowledge');
 if(c.knowledge.filter(k=>k.status==='approved').map(k=>`${k.title}: ${k.content}`).join('\n').length>4000)missing.push('Approved knowledge exceeds the 4,000-character publishing limit');
 if((c.questionnaires[SCOPE(c.deploymentId,c.rulebook)]??[]).filter(q=>q.enabled).map(q=>q.text).join('\n').length>3500)missing.push('Enabled questionnaire exceeds the publishing limit');
 return missing;
}
export function validateConfig(value:unknown,id:string):OrganizationConfig {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid configuration');
 const c=value as OrganizationConfig;const template=newOrganization(id);const keys=Object.keys(template);
 if(Object.keys(c).some(k=>!keys.includes(k))||keys.some(k=>!(k in c))||c.id!==id)throw Error('Invalid configuration fields');
 const text=(s:unknown,max=2000):s is string=>typeof s==='string'&&s.length<=max;
 for(const key of ['name','type','description','serviceArea','operatingHours','purpose','emergencyGuidance','callbackExpectations'] as const)if(!text(c[key]))throw Error('Invalid text');
 const profile=deployment(c.deploymentId);
 if(!['clinic','disaster'].includes(c.rulebook)||!['normal','crisis','both'].includes(c.operatingMode)||typeof c.recoveryEnabled!=='boolean'||!Array.isArray(c.languages)||c.languages.some(l=>!profile.languages.some(p=>p.code===l))||new Set(c.languages).size!==c.languages.length)throw Error('Invalid deployment/languages');
 if(!Array.isArray(c.channels)||c.channels.some(ch=>!['voice','recovery_chat','offline_help_form'].includes(ch))||!validWeights(c.matchingWeights))throw Error('Invalid communication/weights');
 const unique=(items:{id:string}[])=>items.every(x=>text(x.id,100)&&/^[\w-]+$/.test(x.id))&&new Set(items.map(x=>x.id)).size===items.length;
 if(!c.questionnaires||typeof c.questionnaires!=='object'||Array.isArray(c.questionnaires)||Object.keys(c.questionnaires).some(k=>!Object.keys(template.questionnaires).includes(k)))throw Error('Invalid questionnaire scopes');
 for(const [scope,base]of Object.entries(template.questionnaires)){
  const questions=c.questionnaires[scope];if(!Array.isArray(questions)||questions.length>30||!unique(questions)||questions.some(q=>!text(q.text,500)||!q.text.trim()||typeof q.enabled!=='boolean'||typeof q.required!=='boolean'||Object.keys(q).some(k=>!['id','text','enabled','required'].includes(k))))throw Error('Invalid questions');
  for(const q of base.filter(q=>safetyQuestion(q.id)))if(!questions.some(x=>x.id===q.id&&x.enabled&&x.required&&x.text===q.text))throw Error('Core safety questions are locked for this MVP');
 }
 if(!Array.isArray(c.knowledge)||c.knowledge.length>50||!unique(c.knowledge)||c.knowledge.some(k=>!text(k.title,200)||!text(k.content,3000)||!text(k.source,500)||!['draft','ai_suggestion','approved'].includes(k.status)||!Number.isFinite(Date.parse(k.updatedAt))||Object.keys(k).some(n=>!['id','title','content','status','updatedAt','source'].includes(n))))throw Error('Invalid knowledge');
 if(!Array.isArray(c.responders)||c.responders.length>50||!unique(c.responders))throw Error('Invalid responders');
 for(const r of c.responders){
  const arrays=['expertise','languages','interpreterLanguages','coverageAreas','experience','rulebooks'] as const;
  if(r.organizationId!==id||r.deploymentId!==c.deploymentId||!text(r.name,120)||!r.name.trim()||!text(r.role,120)||!text(r.location,300)||!['available','busy','offline'].includes(r.status)||arrays.some(k=>!Array.isArray(r[k])||r[k].length>20||r[k].some(v=>!text(v,80)))||!r.rulebooks.length||r.rulebooks.some(m=>!['clinic','disaster'].includes(m)))throw Error('Invalid responder');
  if(!Number.isInteger(r.activeCallers)||r.activeCallers!==0||!Array.isArray(r.assignedCaseIds)||r.assignedCaseIds.length)throw Error('Draft workloads must be derived from operational cases');
  const expertiseTags=Object.values(MATCHING_CONFIG.expertiseMappings).flatMap(m=>[...m!.exact,...m!.related,...m!.general]);
  const experienceTags=Object.values(MATCHING_CONFIG.experience.mappings).flatMap(m=>[...m!.exact,...m!.related]);
  if(r.expertise.some(t=>!expertiseTags.includes(t))||r.experience.some(t=>!experienceTags.includes(t)))throw Error('Unknown responder skill tag');
  if(r.languages.some(l=>!['en','es','ar','fr','hi','ko','zh'].includes(l))||r.interpreterLanguages.some(l=>!['en','es','ar','fr','hi','ko','zh'].includes(l))||r.coverageAreas.some(a=>!profile.coverage.some(c=>c.key===a)))throw Error('Unverified language or coverage tag');
  if(Object.keys(r).some(k=>!['id','organizationId','deploymentId','name','role','location','status','rulebooks','expertise','languages','interpreterLanguages','coverageAreas','experience','activeCallers','assignedCaseIds'].includes(k)))throw Error('Unexpected responder fields');
 }
 if(!Array.isArray(c.suggestions)||c.suggestions.length>20||!unique(c.suggestions)||JSON.stringify(c.suggestions).length>40000)throw Error('Invalid suggestions');
 // Bound and validate suggestion content by applying it to a throwaway candidate when accepted.
 for(const s of c.suggestions){if(!['questionnaire','knowledge'].includes(s.kind)||!['pending','accepted','rejected'].includes(s.status)||Object.keys(s).some(k=>!['id','kind','status','questions','item'].includes(k)))throw Error('Invalid suggestion');
  if(s.questions&&(!Array.isArray(s.questions)||s.questions.length>30||!unique(s.questions)||s.questions.some(q=>!text(q.text,500)||!q.text.trim()||typeof q.required!=='boolean'||typeof q.enabled!=='boolean'||Object.keys(q).some(k=>!['id','text','required','enabled'].includes(k)))))throw Error('Invalid suggested questions');
  if(s.item&&(!text(s.item.id,100)||!Number.isFinite(Date.parse(s.item.updatedAt))||Object.keys(s.item).some(k=>!['id','title','content','status','updatedAt','source'].includes(k))||!text(s.item.title,200)||!text(s.item.content,3000)||!text(s.item.source,500)||s.item.status!=='ai_suggestion'))throw Error('Invalid suggested knowledge');
 }
 return JSON.parse(JSON.stringify(c));
}
export function publishableConfig(config:OrganizationConfig):OrganizationConfig {
 const next=structuredClone(config);next.knowledge=next.knowledge.filter(k=>k.status==='approved');next.suggestions=[];return next;
}
export function matchingForCaller(caller:Pick<Caller,'organizationId'>,organizations:ActiveOrganization[]=[]){
 const active=organizations.find(o=>o.id===caller.organizationId);
 return active?{...MATCHING_CONFIG,version:`${MATCHING_CONFIG.version}:${active.id}:${active.version}`,weights:active.matchingWeights}:MATCHING_CONFIG;
}

// Active summaries travel with the Task 7 case cache, so offline organization work does not depend on fetching draft settings.
export function operationalRulebook(fallback:Rulebook,organizationId:string,activeOrganizations:ActiveOrganization[]=[],active?:ConfigVersion|null):Rulebook {
 return active?.configuration.rulebook ?? activeOrganizations.find(o=>o.id===organizationId)?.rulebook ?? fallback;
}
