import 'server-only';
import { deployment } from '@/config/deployments';
import { SCOPE, type ConfigVersion } from './model';
// The same allowlisted payload powers the protected interaction preview and future provider launch.
// No credentials, caller records, draft knowledge, or automatic agent publishing.
export function activeDynamicVariables(active:ConfigVersion){
 const c=active.configuration,p=deployment(c.deploymentId);
 const bounded=(s:string)=>s.slice(0,4000);
 return {organization_name:c.name,organization_type:c.type,line_purpose:c.purpose,operating_mode:c.rulebook,
 supported_languages:c.languages.map(code=>p.languages.find(l=>l.code===code)?.label??code).join(', '),emergency_instruction:c.emergencyGuidance,
 intake_questionnaire:c.questionnaires[SCOPE(c.deploymentId,c.rulebook)].filter(q=>q.enabled).map(q=>`${q.required?'Required':'Optional'}: ${q.text}`).join('\n'),
 callback_expectations:c.callbackExpectations,location_fields:p.locationSchema.map(f=>f.label).join('; '),deployment_id:p.id,configuration_version:String(active.version),
 approved_knowledge:bounded(c.knowledge.filter(k=>k.status==='approved').map(k=>`${k.title}: ${k.content}`).join('\n')||'No organization facts have been approved. Do not invent availability, bookings or services.')};
}
