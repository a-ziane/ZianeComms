// Keys on the left are ZianeComms adapter concepts, NOT assumed Retell machine field names.
// Values come exclusively from RETELL_EXTRACTION_FIELDS, copied from this agent's post-call schema.
export const LEGACY_EXTRACTION_CONCEPTS = [
  'caller_name','phone_number','preferred_language','reason_for_contact','location','questionnaire_answers',
  'unresolved_need','human_requested','emergency_guidance_provided','directed_to_911',
  'automation_resolved_request','possible_danger','immediate_life_threat','facility_signals','location_zone',
  'need_category','caller_message','safety_context_signals',
] as const;
// Mapping requested_service explicitly opts this deployment into native structured Disaster facts.
export const EXTRACTION_CONCEPTS = [...LEGACY_EXTRACTION_CONCEPTS,
  'requested_service','immediate_danger','medical_need','mobility_limitation','medical_equipment_dependency',
  'affected_by_active_crisis','unable_to_self_evacuate','no_transportation_available','person_unresponsive',
  'person_trapped','power_disruption',
] as const;
export type ExtractionConcept = typeof EXTRACTION_CONCEPTS[number];
export type ExtractionMap = Partial<Record<ExtractionConcept, string>>;
const REQUIRED: ExtractionConcept[] = ['reason_for_contact','unresolved_need','human_requested','emergency_guidance_provided','automation_resolved_request'];
export function parseExtractionMap(value: string | undefined): ExtractionMap {
  let map: ExtractionMap;
  try { map = JSON.parse(value ?? ''); } catch { throw new Error('Configure the actual Retell extraction field mapping'); }
  if (!map || typeof map !== 'object' || Array.isArray(map) ||
    Object.entries(map).some(([key, field]) => !EXTRACTION_CONCEPTS.includes(key as ExtractionConcept) || typeof field !== 'string' || !field.trim() || field.length > 200) ||
    REQUIRED.some(key => !map[key])) throw new Error('Invalid Retell extraction field mapping');
  return map;
}
export function mapExtractionFields(raw: Record<string, unknown>, map: ExtractionMap): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of EXTRACTION_CONCEPTS) {
    const actual = map[key];
    if (actual && Object.hasOwn(raw, actual)) result[key] = raw[actual];
  }
  return result;
}
