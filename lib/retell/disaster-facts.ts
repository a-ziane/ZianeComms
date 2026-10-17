import type { LocationZone, NeedCategory, QuestionnaireAnswer } from '@/types';

export type ExtractedFact = 'yes' | 'no' | 'unknown';
export const DISASTER_FACT_FIELDS = [
  'immediate_danger', 'medical_need', 'mobility_limitation', 'medical_equipment_dependency',
  'affected_by_active_crisis', 'unable_to_self_evacuate', 'no_transportation_available',
  'person_unresponsive', 'person_trapped', 'power_disruption',
] as const;
export const DISASTER_SERVICES = ['shelter','evacuation','transportation','welfare_check','outage_information','medical_assistance','other','unknown'] as const;
const labels: Record<typeof DISASTER_FACT_FIELDS[number], string> = {
  immediate_danger: 'Immediate threat to life', medical_need: 'Medical need', mobility_limitation: 'Mobility limitation',
  medical_equipment_dependency: 'Powered medical equipment dependency', affected_by_active_crisis: 'Affected by active crisis',
  unable_to_self_evacuate: 'Unable to self-evacuate', no_transportation_available: 'No transportation available',
  person_unresponsive: 'Person unresponsive', person_trapped: 'Person trapped', power_disruption: 'Power disruption',
};
const services: Record<typeof DISASTER_SERVICES[number], NeedCategory> = {
  shelter:'shelter',evacuation:'evacuation',transportation:'mobility_issue',welfare_check:'welfare_check',
  outage_information:'outage_information',medical_assistance:'other',other:'other',unknown:'other',
};
const zones: LocationZone[] = ['active_danger','near_danger','affected_area','outside','unknown'];

// Classification adapter only: maps explicit facts to existing rule keys. No weights, text matching,
// geographic inference or new triage rules. Unknown never becomes a negative or a positive fact.
export function adaptDisasterFacts(fields: Record<string, unknown>) {
  const notes: string[] = [];
  const answers: QuestionnaireAnswer[] = [];
  function fact(key: string, label: string): ExtractedFact {
    const raw = fields[key];
    const value: ExtractedFact = raw === true || raw === 'yes' ? 'yes' : raw === false || raw === 'no' ? 'no' : 'unknown';
    if (value === 'unknown') notes.push(`${label} is missing, uncertain or invalid; operator review required.`);
    answers.push({ question: `Structured intake — ${label}`, answer: value });
    return value;
  }
  const facts = Object.fromEntries(DISASTER_FACT_FIELDS.map(k => [k, fact(k, labels[k])])) as Record<typeof DISASTER_FACT_FIELDS[number], ExtractedFact>;
  const outcome = {
    emergency: fact('emergency_guidance_provided','Emergency-services guidance provided'),
    human: fact('human_requested','Human follow-up requested'),
    unresolved: fact('unresolved_need','Unresolved need'),
    resolved: fact('automation_resolved_request','Automation resolved request'),
  };
  const service = DISASTER_SERVICES.includes(fields.requested_service as typeof DISASTER_SERVICES[number])
    ? fields.requested_service as typeof DISASTER_SERVICES[number] : 'unknown';
  answers.push({question:'Structured intake — Requested service',answer:service});
  if (service === 'unknown') notes.push('Requested service is missing, uncertain or invalid; operator review required.');
  const locationZone = zones.includes(fields.location_zone as LocationZone) ? fields.location_zone as LocationZone : 'unknown';
  answers.push({question:'Structured intake — Crisis location zone',answer:locationZone});
  if (locationZone === 'unknown') notes.push('Crisis location zone is missing, uncertain or invalid; operator review required.');
  for (const key of ['preferred_language','location']) {
    if (typeof fields[key] !== 'string' || !fields[key].trim() || fields[key].trim().toLowerCase() === 'unknown') notes.push(`${key} is missing or uncertain; operator review required.`);
  }
  const signals: string[] = [];
  if (facts.immediate_danger === 'yes') signals.push('immediate_life_threat');
  if (facts.person_trapped === 'yes') signals.push('person_trapped');
  if (facts.medical_equipment_dependency === 'yes' && facts.power_disruption === 'yes') signals.push('medical_equipment_dependency');
  if (facts.mobility_limitation === 'yes' && facts.unable_to_self_evacuate === 'yes' && facts.affected_by_active_crisis === 'yes') signals.push('mobility_vulnerability');
  if (facts.person_unresponsive === 'yes' && service === 'welfare_check') signals.push('welfare_check_needed');
  if ((service === 'shelter' || service === 'evacuation') && facts.affected_by_active_crisis === 'yes' && outcome.unresolved === 'yes') signals.push('urgent_evacuation_shelter');
  if (facts.no_transportation_available === 'yes' && facts.unable_to_self_evacuate === 'yes' && facts.affected_by_active_crisis === 'yes') signals.push('no_transportation');
  if (service === 'outage_information' && outcome.unresolved === 'yes') signals.push('info_unresolved');
  if (outcome.resolved === 'yes' && (outcome.unresolved === 'yes' || outcome.human === 'yes')) notes.push('Resolution and follow-up facts conflict; operator review required. Unresolved/human need takes precedence.');
  if (facts.immediate_danger === 'no' && locationZone === 'active_danger') notes.push('Immediate danger and location zone facts conflict; operator review required. Zone alone does not assert an immediate life threat.');
  if (facts.medical_need === 'yes' && !signals.includes('medical_equipment_dependency')) notes.push('Medical need recorded; no generic medical-severity rule exists in the Disaster rulebook. Operator review required.');
  if (service === 'medical_assistance' && facts.medical_equipment_dependency !== 'yes') notes.push('Medical assistance recorded as other; no matching generic medical category exists. Operator review required.');
  if (facts.medical_equipment_dependency === 'yes' && facts.power_disruption !== 'yes') notes.push('Equipment dependency recorded without confirmed power disruption; no equipment-at-risk signal inferred. Operator review required.');
  if (service === 'welfare_check' && facts.person_unresponsive !== 'yes') notes.push('Welfare check requested without confirmed unresponsiveness; no unresponsive-person signal inferred. Operator review required.');
  let needCategory = services[service];
  if (service === 'medical_assistance' && facts.medical_equipment_dependency === 'yes') needCategory = 'medical_equipment';
  const asBoolean = (v: ExtractedFact): boolean | undefined => v === 'unknown' ? undefined : v === 'yes';
  return { signals, needCategory, locationZone, answers, notes,
    emergencyGuidance: asBoolean(outcome.emergency), humanRequested: asBoolean(outcome.human),
    unresolved: asBoolean(outcome.unresolved), automationResolved: asBoolean(outcome.resolved) };
}
