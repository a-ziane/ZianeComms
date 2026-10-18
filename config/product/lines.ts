import {CLINIC_RULEBOOK,DISASTER_RULEBOOK} from '@/config/rulebooks';
import type {RulebookConfig,FacilitySignalRule} from '@/types';
import type {OrganizationConfig} from '@/lib/organization/model';
export type LineId='911'|'311'|'211'|'defense'|'custom';
export type ProductView='civilian'|'responder'|'command';
export interface LinePreset {id:LineId;label:string;name:string;short:string;description:string;icon:string;questions:string[];knowledge:{title:string;body:string}[];signals:string[];examples:string[]}
const common=['What happened and what help do you need?','What name and callback number may we use? Confirm both if supplied.','What language do you prefer?','Where are you? Confirm critical location details; unknown is acceptable.'];
export const LINES:Record<LineId,LinePreset>={
 '911':{id:'911',label:'911',name:'Emergency response',short:'Emergency',description:'Life safety comes first.',icon:'✳',questions:[common[0],'Is anyone injured, trapped, unresponsive or having trouble breathing?','Is the danger still happening? Can you safely move away?','Does anyone need medical equipment or mobility assistance?',...common.slice(1)],signals:['immediate_life_threat','person_unresponsive','breathing_difficulty','person_trapped','medical_equipment_dependency','mobility_vulnerability'],examples:['Person trapped with fire exposure','Unresponsive person','Powered medical equipment unavailable'],knowledge:[{title:'Immediate danger',body:'DEMO guidance: try to contact official local emergency services when a connection is available. This prototype has not contacted or dispatched them.'},{title:'Location first',body:'Confirm the best available area, landmark and callback. Never turn an uncertain area into an exact address.'},{title:'Caller safety',body:'Do not instruct a caller to approach danger, perform an unverified medical procedure or delay official emergency assistance.'},{title:'Medical & evacuation support',body:'Capture explicit symptoms, mobility barriers and equipment dependencies. Escalate confirmed life-safety facts for immediate human review.'}]},
 '311':{id:'311',label:'311',name:'City services',short:'City services',description:'Small reports. Safer communities.',icon:'▥',questions:['What city-service issue are you reporting?','Where is it? Is access blocked?','Is there an immediate public-safety hazard?','How many people or areas appear affected?','When did you notice it?',...common.slice(1,3)],signals:['immediate_life_threat','dangerous_infrastructure','blocked_access','multiple_people_affected','service_problem_human_needed','info_unresolved'],examples:['Fallen tree blocks a roadway','Traffic signal failure','Water leak, streetlight or sanitation issue'],knowledge:[{title:'Public works & infrastructure',body:'DEMO routing: record asset type, observed condition, location and access restrictions. No city work order or response time is promised.'},{title:'Sanitation & property',body:'Collect the issue and area without unnecessary personal information. Human review determines the appropriate service team.'},{title:'Transport & accessibility',body:'Confirm whether a route or accessible entrance is blocked. An immediate threat to life still triggers the shared safety rule.'},{title:'Repeat reports',body:'Preserve previous reports and timing. More reports alone never outrank a confirmed life-safety emergency.'}]},
 '211':{id:'211',label:'211',name:'Community resources',short:'Community help',description:'A path forward for every request.',icon:'⌂',questions:['What do you need help with?','Do you need shelter, food, transport, utility assistance or medical-resource navigation?','Is the need immediate? Is anyone especially vulnerable?','Are you affected by an active crisis?',...common.slice(1)],signals:['immediate_life_threat','urgent_evacuation_shelter','no_transportation','mobility_vulnerability','medical_equipment_dependency','resource_navigation'],examples:['Family displaced and needing shelter','Food or utility support','Transport and welfare assistance'],knowledge:[{title:'Shelter & housing',body:'DEMO resource navigation only: collect household needs and area. No shelter inventory, bed availability or housing placement is verified.'},{title:'Food & utility support',body:'Record the support requested, time sensitivity and any explicit safety dependency. A human must verify eligibility and current resources.'},{title:'Transportation & access',body:'Ask about mobility, language and access barriers only when relevant. Unknown answers remain unknown.'},{title:'Welfare & medical resources',body:'Collect the need without diagnosing. Confirmed immediate danger bypasses routine resource navigation.'}]},
 defense:{id:'defense',label:'DEFENSE SUPPORT',name:'Personnel & continuity',short:'Defense support',description:'Personnel safe. Support connected.',icon:'◇',questions:['What support is needed?','Is anyone in immediate danger or in need of medical assistance?','Where is the person, team or facility needing support?','Is communication available?','Is evacuation or transportation needed?','Is infrastructure or equipment unavailable? What resources are needed?',...common.slice(1,3)],signals:['immediate_life_threat','medical_equipment_dependency','welfare_check_needed','communications_loss','logistics_disruption','no_transportation'],examples:['Personnel medical support','Communications or logistics interruption','Welfare check and evacuation support'],knowledge:[{title:'Personnel safety & medical support',body:'DEMO support intake: capture confirmed safety facts and medical support needs. Consequential decisions stay with responsible humans.'},{title:'Welfare & evacuation',body:'Record who needs help, last confirmed contact and access constraints. Never infer a person’s condition or precise position.'},{title:'Communications & infrastructure',body:'Record communications loss, service interruption and operational dependency as support needs, with uncertainty preserved.'},{title:'Logistics & transport',body:'Coordinate requests for supplies, transport and continuity support. This interface has no weapons, targeting or offensive decision functionality.'}]},
 custom:{id:'custom',label:'CUSTOM',name:'Your organization',short:'My organization',description:'Every day. Every missed caller.',icon:'▦',questions:[],signals:[],examples:['Clinic · dental callback','Utility · service interruption','University · student support','Business · customer service'],knowledge:[]},
};
function signal(key:string,label:string,points:number,reason:string,hard=false):FacilitySignalRule{return {key,label,points,reason:`[DEMO] ${reason}`,category:'facility',...(hard?{hardEscalate:true,escalationReason:`Confirmed ${label.toLowerCase()} requires immediate human safety review.`}:{})};}
const factorDomains=['Safety context','Medical access','Mobility','Communication','Shelter','Utilities','Transportation','Physical access','Household','Continuity'];
const factorDimensions=['confirmed now','worsening','repeat contact','no safe alternative','time sensitive','language barrier','accessibility barrier','location uncertainty','dependent affected','resource unavailable'];
export const DEMO_FACTOR_LIBRARY:Record<string,FacilitySignalRule>=Object.fromEntries(factorDomains.flatMap((domain,di)=>factorDimensions.map((dimension,xi)=>{
 const key=`demo_${domain.toLowerCase().replaceAll(' ','_')}_${dimension.replaceAll(' ','_')}`;
 return [key,signal(key,`${domain} · ${dimension}`,Math.min(12,2+((di+xi)%9)),`Explicit ${domain.toLowerCase()} fact with ${dimension} context contributes to the explainable demo score.`)];
})));
// Additive demo configurations. The live Disaster/Clinic registry and weights are untouched.
export function lineRulebook(line:LineId,organization?:OrganizationConfig):RulebookConfig{
 if(line==='custom'){const base=organization?.rulebook==='disaster'?DISASTER_RULEBOOK:CLINIC_RULEBOOK;return {...base,label:`${organization?.name??'Organization'} · editable demo rules`,facilitySignals:{...base.facilitySignals,...DEMO_FACTOR_LIBRARY}};}
 const extra:Record<string,FacilitySignalRule>=line==='911'?{
  person_unresponsive:signal('person_unresponsive','Person unresponsive',0,'Explicit unresponsive-person fact bypasses the score.',true),
  breathing_difficulty:signal('breathing_difficulty','Breathing difficulty',0,'Explicit breathing difficulty requires immediate safety review.',true),
 }:line==='311'?{
  dangerous_infrastructure:signal('dangerous_infrastructure','Dangerous infrastructure',40,'An explicitly reported public-safety hazard needs human assessment.'),
  blocked_access:signal('blocked_access','Roadway or accessible route blocked',25,'Confirmed blockage limits access.'),
  multiple_people_affected:signal('multiple_people_affected','Multiple people affected',15,'Explicit shared impact raises attention.'),
 }:line==='211'?{resource_navigation:signal('resource_navigation','Community resource navigation',15,'An unresolved food, utility or community-resource need requires follow-up.')}: {
  communications_loss:signal('communications_loss','Communications unavailable',25,'Confirmed communications loss can isolate personnel requesting support.'),
  logistics_disruption:signal('logistics_disruption','Logistics support interruption',20,'A confirmed support dependency is unavailable.'),
 };
 return {...DISASTER_RULEBOOK,label:`${LINES[line].label} · demo support rules`,description:'Configurable prototype decision support. Not official dispatch or clinical protocols.',facilitySignals:{...DISASTER_RULEBOOK.facilitySignals,...extra,...DEMO_FACTOR_LIBRARY}};
}
export function lineQuestions(line:LineId,organization?:OrganizationConfig){return line==='custom'&&organization?(organization.questionnaires[`${organization.deploymentId}:${organization.rulebook}`]??[]).filter(q=>q.enabled).map(q=>q.text):LINES[line].questions;}
const supplementalKnowledge:Record<LineId,{title:string;body:string}[]>={
 '911':[
  {title:'Call continuity',body:'Keep a callback method and the best available location together with the case. If contact drops, preserve confirmed facts and mark everything else unknown.'},
  {title:'Fire and smoke context',body:'Capture visible smoke, blocked exits, trapped people and whether danger is approaching. Do not direct someone back into a hazardous area.'},
  {title:'Accessibility',body:'Record mobility, communication and equipment needs in the caller’s own terms so a human can plan appropriate assistance.'},
  {title:'Children and dependents',body:'Record the number of dependents and whether they are together. Do not infer custody, medical condition or location.'},
  {title:'Language access',body:'Preserve the preferred language and whether interpretation is needed. Safety facts remain explicit structured fields.'},
  {title:'Handoff checklist',body:'A useful handoff includes callback, best location, immediate danger, people affected, access barriers and what remains unknown.'},
 ],
 '311':[
  {title:'Road and sidewalk hazards',body:'Record the affected route, direction, obstruction type, accessible-path impact and whether people can safely pass.'},
  {title:'Traffic controls',body:'Capture the intersection or landmark and which signal or sign appears affected. Never promise a repair time.'},
  {title:'Water and utility observations',body:'Describe what is visible, the area affected and whether property access is unsafe. Do not diagnose the cause.'},
  {title:'Trees and debris',body:'Record whether a road, entrance, sidewalk, power line or transit path is blocked and whether the condition is changing.'},
  {title:'Sanitation',body:'Capture location, material type when known and public access impact while avoiding unnecessary personal data.'},
  {title:'Duplicate reports',body:'Link repeat reports to the same incident when evidence supports it. Preserve each contact and any new facts.'},
 ],
 '211':[
  {title:'Household composition',body:'Ask how many adults, children and dependents need support only when it affects resource matching.'},
  {title:'Accessibility needs',body:'Record mobility, sensory, language and equipment needs without inferring disability or diagnosis.'},
  {title:'Safe contact',body:'Confirm when and how the person may be contacted. A missing phone number does not remove a request from the queue.'},
  {title:'Documents and eligibility',body:'Explain that a provider may ask for documents, but never claim eligibility before a responsible organization verifies it.'},
  {title:'Domestic safety and privacy',body:'Use the caller’s safe-contact preference and minimize sensitive details. Escalate explicit immediate danger through the safety rule.'},
  {title:'Resource verification',body:'Addresses, hours, capacity and eligibility can change. A human should verify current availability before referral.'},
 ],
 defense:[
  {title:'Continuity handoff',body:'Record responsible contact, affected function, known dependencies, available alternate communication and the next review time.'},
  {title:'Accountability',body:'Preserve last confirmed contact and source. Unknown personnel status remains unknown until a responsible human confirms it.'},
  {title:'Equipment dependency',body:'Capture the supported function and consequence of loss without collecting restricted technical details.'},
  {title:'Transport support',body:'Record origin area, destination function, mobility constraints and timing need. This demo does not route vehicles.'},
  {title:'Supply request',body:'Capture category, quantity when known, destination area and operational need. Human review confirms authority and availability.'},
  {title:'Information boundaries',body:'Do not enter classified, targeting, weapons or operational intelligence. Use approved systems for restricted information.'},
 ],
 custom:[
  {title:'Appointments',body:'Collect preferred callback time, service type and accessibility needs. A request is not a confirmed appointment.'},
  {title:'Prescription requests',body:'Record medication name only when volunteered, the request type and callback details. Do not promise authorization or diagnose.'},
  {title:'Billing support',body:'Capture the statement or claim question without storing full payment-card details in notes.'},
  {title:'Language and access',body:'Preserve language, interpretation and accessibility preferences for the responding team.'},
  {title:'Urgent symptoms',body:'Explicit danger or configured safety facts receive immediate human review under the organization rulebook.'},
  {title:'Closed-loop follow-up',body:'Record the outcome, next owner and whether the person still needs help. Unresolved requests remain active.'},
 ],
};
export function lineKnowledge(line:LineId,organization?:OrganizationConfig){const approved=line==='custom'&&organization?organization.knowledge.filter(k=>k.status==='approved').map(k=>({title:k.title,body:k.content})):LINES[line].knowledge;return [...approved,...supplementalKnowledge[line]];}
