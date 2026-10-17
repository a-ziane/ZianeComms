import 'server-only';
import { contactKey } from '@/lib/retell/contact';
import { SMS_TEXT } from '@/lib/messaging/config';
import type { RecoveryConfig } from '@/lib/messaging/provider';
export const CHAT_FIELDS = ['caller_replied','caller_name','phone_number','preferred_language','reason_for_contact','location','questionnaire_answers',
  'unresolved_need','human_requested','automation_resolved_request','emergency_guidance_provided','safety_context_signals','requested_service','location_zone',
  'immediate_danger','medical_need','mobility_limitation','medical_equipment_dependency','affected_by_active_crisis','unable_to_self_evacuate',
  'no_transportation_available','person_unresponsive','person_trapped','power_disruption'] as const;
export interface ChatConfig extends RecoveryConfig { apiKey:string; agentId:string; dynamicVariables:Record<string,string> }
export function chatConfig(env:Record<string,string|undefined>=process.env):ChatConfig|null {
  if(env.RETELL_CHAT_ENABLED!=='true')return null;
  if(!env.RETELL_API_KEY || !/^agent_[A-Za-z0-9_-]{1,150}$/.test(env.RETELL_CHAT_AGENT_ID??'') || (env.OPERATIONS_PASSWORD?.length??0)<24)throw Error('Recovery Chat is not configured');
  let vars:unknown={};
  if(env.RETELL_CHAT_DYNAMIC_VARIABLES)vars=JSON.parse(env.RETELL_CHAT_DYNAMIC_VARIABLES);
  if(!vars || typeof vars!=='object' || Array.isArray(vars) || Object.entries(vars).some(([k,v])=>!['organization_name','organization_type','line_purpose','operating_mode','supported_languages','emergency_instruction','approved_knowledge'].includes(k)||typeof v!=='string'||v.length>4000))throw Error('Invalid organization chat variables');
  return {apiKey:env.RETELL_API_KEY,agentId:env.RETELL_CHAT_AGENT_ID!,encryptionKey:contactKey(env.CONTACT_ENCRYPTION_KEY),recipients:[],
    templates:{disaster:SMS_TEXT.disaster.replace('Reply STOP to opt out.','You can end this demo chat at any time.'),clinic:SMS_TEXT.clinic.replace('Reply STOP to opt out.','You can end this demo chat at any time.')},dynamicVariables:{organization_name:'ZianeComms',organization_type:'Crisis support demo',line_purpose:'Follow up an unresolved voice call',operating_mode:'disaster',
      supported_languages:'Use the caller preferred language where supported; ask if uncertain.',
      emergency_instruction:'For immediate danger, advise the caller to contact local emergency services. Do not claim dispatch or that emergency services were contacted.',
      approved_knowledge:'No service availability, address, capacity or booking has been verified. Do not invent these details.',...vars as Record<string,string>}};
}
