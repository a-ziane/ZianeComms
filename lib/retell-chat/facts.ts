import type { Caller,EngineInput,QuestionnaireAnswer } from '@/types';
import { simulateRepeatContact } from '@/data/callers';
import { adaptDisasterFacts,DISASTER_FACT_FIELDS,DISASTER_FACT_LABELS,DISASTER_SERVICES } from '@/lib/retell/disaster-facts';
import { redactPhones } from '@/lib/retell/contact';
const knownText=(v:unknown):v is string=>typeof v==='string'&&!!v.trim()&&v.trim().toLowerCase()!=='unknown'&&v.length<=4000;
const bool=(v:unknown)=>v===true||v==='yes'?true:v===false||v==='no'?false:undefined;
const questions:Record<string,string>={...Object.fromEntries(DISASTER_FACT_FIELDS.map(k=>[`Structured intake — ${DISASTER_FACT_LABELS[k]}`,k])),
 'Structured intake — Requested service':'requested_service','Structured intake — Crisis location zone':'location_zone',
 'Structured intake — Emergency-services guidance provided':'emergency_guidance_provided','Structured intake — Human follow-up requested':'human_requested',
 'Structured intake — Unresolved need':'unresolved_need','Structured intake — Automation resolved request':'automation_resolved_request'};
export function mergeChatFacts(caller:Caller,incoming:Record<string,unknown>,chatId:string,timestamp:string):Caller {
 if(incoming.caller_replied!=='yes'&&incoming.caller_replied!==true)return caller;
 if(caller.rulebook!=='disaster'||!caller.engineInput)return caller;
 const fields:Record<string,unknown>={};
 for(const answer of caller.questionnaire)if(questions[answer.question]&&knownText(answer.answer))fields[questions[answer.question]]=answer.answer;
 let changed=false;
 for(const k of [...DISASTER_FACT_FIELDS,'unresolved_need','human_requested','automation_resolved_request','emergency_guidance_provided']){
  const value=bool(incoming[k]);if(value!==undefined){fields[k]=value?'yes':'no';changed=true;}
 }
 if(DISASTER_SERVICES.includes(incoming.requested_service as typeof DISASTER_SERVICES[number])&&incoming.requested_service!=='unknown'){fields.requested_service=incoming.requested_service;changed=true;}
 if(['active_danger','near_danger','affected_area','outside'].includes(String(incoming.location_zone))){fields.location_zone=incoming.location_zone;changed=true;}
 const patch:Partial<EngineInput>={attempts:0};
 for(const [field,target]of [['location','locationDetail'],['preferred_language','language'],['reason_for_contact','needDescription']] as const){
  if(knownText(incoming[field])){patch[target]=redactPhones(incoming[field].trim());changed=true;}
 }
 const extra:QuestionnaireAnswer[]=[];
 for(const k of ['safety_context_signals','questionnaire_answers'])if(knownText(incoming[k]))extra.push({question:`Recovery chat — ${k} (context)`,answer:redactPhones(incoming[k])});
 const name=knownText(incoming.caller_name)?redactPhones(incoming.caller_name):caller.name;
 if(!changed)return {...caller,name,questionnaire:[...caller.questionnaire,...extra]};
 const facts=adaptDisasterFacts(fields);
 patch.facilitySignals=facts.signals;
 if(fields.requested_service&&fields.requested_service!=='unknown')patch.needCategory=facts.needCategory;
 if(facts.locationZone!=='unknown')patch.locationZone=facts.locationZone;
 // An earlier safety escalation cannot be silently retracted by a later resolved/unknown report.
 if(caller.engineInput.agentOutcome==='directed_to_911'||facts.emergencyGuidance)patch.agentOutcome='directed_to_911';
 else if(facts.unresolved===true)patch.agentOutcome='could_not_resolve';
 else if(facts.humanRequested===true)patch.agentOutcome='caller_requested_human';
 else if(facts.automationResolved===true&&facts.unresolved===false&&facts.humanRequested===false)patch.agentOutcome='resolved';
 const next=simulateRepeatContact(caller,patch,'Confirmed structured Retell recovery chat facts; unknown values ignored.');
 const previous=next.activityLog.at(-1)!;
 return {...next,name,status:'needs_followup',lastRecommendation:undefined,
  questionnaire:[...caller.questionnaire,...facts.answers.filter(a=>a.answer!=='unknown'),...extra],
  activityLog:[...caller.activityLog,{...previous,id:`chat-priority-${chatId}`,type:'priority_calculated',timestamp,
   label:'Priority recalculated after recovery chat',detail:previous.detail+' Retell extracted facts; ZianeComms calculated the priority.'}]};
}
