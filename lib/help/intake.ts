import { deployment, type DeploymentId } from '@/config/deployments';
import { adaptDisasterFacts } from '@/lib/retell/disaster-facts';
import { scoreCallerInput } from '@/lib/engine';
import type { Caller, EngineInput, NeedCategory, LocationZone } from '@/types';

export const SERVICES: { value: NeedCategory; label: string }[] = [
  { value: 'evacuation', label: 'Evacuation' }, { value: 'shelter', label: 'Shelter' },
  { value: 'mobility_issue', label: 'Transportation / mobility assistance' }, { value: 'welfare_check', label: 'Welfare check' },
  { value: 'medical_equipment', label: 'Medical equipment' }, { value: 'general_disaster', label: 'Medical / other crisis assistance' },
  { value: 'outage_information', label: 'Outage information' }, { value: 'other', label: 'Other / unsure' },
];
export type Answer = 'yes'|'no'|'unknown';
export interface HelpRequest {
  id: string; deploymentId: DeploymentId; createdOnDeviceAt: string; savedOffline: boolean;
  name: string; contact: string; language: string; need: string; service: NeedCategory;
  immediateDanger: Answer; medicalNeed: Answer; mobilityNeed: Answer; equipmentNeed: Answer;
  crisisContext: Answer; unableToEvacuate: Answer; powerDisruption: Answer; location: Record<string, string>;
}
export const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function validateHelpRequest(value: unknown): HelpRequest {
  if (!value || typeof value !== 'object') throw Error('Invalid help request');
  const v = value as HelpRequest, p = deployment(v.deploymentId);
  const text = (s: unknown, max: number) => typeof s === 'string' && s.length <= max;
  if (!uuidPattern.test(v.id) || !text(v.createdOnDeviceAt, 40) || !Number.isFinite(Date.parse(v.createdOnDeviceAt)) || typeof v.savedOffline !== 'boolean' ||
      !text(v.name, 120) || !text(v.contact, 40) || (v.contact.trim() && !/^\+[1-9][0-9\s().-]{7,25}$/.test(v.contact.trim())) ||
      !text(v.need, 3000) || !v.need.trim() || !text(v.language, 40) || !['unknown', ...p.languages.map(l => l.code)].includes(v.language) ||
      !SERVICES.some(s => s.value === v.service) || ![v.immediateDanger, v.medicalNeed, v.mobilityNeed, v.equipmentNeed, v.crisisContext, v.unableToEvacuate, v.powerDisruption].every(a => ['yes', 'no', 'unknown'].includes(a)) ||
      !v.location || typeof v.location !== 'object' || Array.isArray(v.location) || Object.keys(v.location).some(k => !p.locationSchema.some(f => f.key === k)) ||
      !Object.values(v.location).every(s => text(s, 300))) throw Error('Check the request fields. Contact, if supplied, must include an international + country code.');
  return { id: v.id.toLowerCase(), deploymentId: p.id, createdOnDeviceAt: v.createdOnDeviceAt, savedOffline: v.savedOffline, name: v.name.trim(), contact: v.contact.trim(),
    language: v.language, need: v.need.trim(), service: v.service, immediateDanger: v.immediateDanger, medicalNeed: v.medicalNeed, mobilityNeed: v.mobilityNeed,
    equipmentNeed: v.equipmentNeed, crisisContext: v.crisisContext, unableToEvacuate: v.unableToEvacuate, powerDisruption: v.powerDisruption, location: Object.fromEntries(p.locationSchema.filter(f => v.location[f.key]?.trim()).map(f => [f.key, v.location[f.key].trim()])) };
}
// Facts come from explicit answers, never inferred from words in the caller's narrative.
export function helpCaller(request: HelpRequest, receivedAt: string): Caller {
  const p = deployment(request.deploymentId);
  const location = p.locationSchema.filter(f => request.location[f.key]).map(f => `${f.label}: ${request.location[f.key]}`).join('; ') || 'Location not provided — operator review';
  const service = ({ mobility_issue: 'transportation', medical_equipment: 'medical_assistance', general_disaster: 'other' } as Record<string,string>)[request.service] ?? request.service;
  const facts = adaptDisasterFacts({ immediate_danger: request.immediateDanger, medical_need: request.medicalNeed,
    mobility_limitation: request.mobilityNeed, medical_equipment_dependency: request.equipmentNeed,
    affected_by_active_crisis: request.crisisContext, unable_to_self_evacuate: request.unableToEvacuate,
    power_disruption: request.powerDisruption, requested_service: service, human_requested: 'yes', unresolved_need: 'yes',
    automation_resolved_request: 'no', emergency_guidance_provided: 'no', preferred_language: request.language, location,
    location_zone: request.crisisContext === 'yes' ? 'affected_area' : request.crisisContext === 'no' ? 'outside' : 'unknown' });
  const input: EngineInput = { rulebook: p.rulebook, needCategory: facts.needCategory, needDescription: request.need, callerMessage: request.need,
    language: p.languages.find(l => l.code === request.language)?.label ?? 'Unknown', locationDetail: location,
    locationZone: (request.crisisContext === 'yes' ? 'affected_area' : request.crisisContext === 'no' ? 'outside' : 'unknown') as LocationZone,
    facilitySignals: facts.signals, agentOutcome: 'caller_requested_human', waitMinutes: 0, attempts: 1 };
  const result = scoreCallerInput(input);
  const id = `help-${request.id}`;
  return { id, source: 'offline_help_form', deploymentId: p.id, provenance: 'live', name: request.name || 'Name not provided', phone: request.contact,
    rulebook: p.rulebook, engineInput: input, priority: result.priority, calculatedPriority: result.priority, score: result.score, scoreBreakdown: result.breakdown,
    hardEscalation: result.hardEscalation, escalationReason: result.escalationReason, manualPriority: false, status: 'awaiting_callback',
    needCategory: input.needCategory, needSummary: request.need, callerMessage: request.need,
    aiSummary: 'Caller-submitted structured help request. No AI interpretation. Review unknown answers and verify location. ' + facts.notes.join(' '),
    language: input.language, location, waitMinutes: 0, attempts: 1, createdAt: receivedAt,
    questionnaire: [
      ...p.locationSchema.filter(f => request.location[f.key]).map(f => ({ question: f.label, answer: request.location[f.key] })),
      ...facts.answers,
    ],
    activityLog: [
      { id: `${id}-device`, type: 'form_completed', timestamp: receivedAt, label: request.savedOffline ? 'Offline request created on device' : 'Help request created on device', detail: `Device-reported time: ${request.createdOnDeviceAt}. ${p.name} deployment.` },
      { id: `${id}-sync`, type: 'form_completed', timestamp: receivedAt, label: 'Request synchronized', detail: 'Received by ZianeComms. This does not confirm responder contact.' },
      { id: `${id}-priority`, type: 'priority_calculated', timestamp: receivedAt, label: 'Priority calculated', calculatedPriority: result.priority, detail: 'Existing deterministic rulebook applied to explicit caller answers; unknown facts require operator review.' },
    ] };
}
