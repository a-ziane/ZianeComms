import type { AgentOutcome, EngineInput, LocationZone, NeedCategory, QuestionnaireAnswer, Rulebook } from '@/types';
import { mapExtractionFields, type ExtractionMap } from '@/config/retell';
import { RULEBOOKS } from '@/config/rulebooks';
import { adaptDisasterFacts } from './disaster-facts';
import { normalizePhone, redactPhones } from './contact';

export class RetellInputError extends Error {}
export type RetellEvent = 'call_ended' | 'call_analyzed';
export interface RetellIntake {
  event: RetellEvent; callId: string; agentId: string; status: string; callType: 'phone_call' | 'web_call';
  startedAt: string; endedAt: string; phone?: string; name: string; summary: string;
  questionnaire: QuestionnaireAnswer[]; input: EngineInput; analysisPending: boolean;
  emergencyGuidance: boolean | undefined; humanRequested: boolean | undefined; unresolved: boolean | undefined; automationResolved: boolean | undefined;
  linkedCaseId?: string; notes: string[];
}
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const fail = (): never => { throw new RetellInputError('Invalid Retell payload'); };
const id = (x: unknown): string => typeof x === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(x) ? x : fail();
function string(x: unknown, fallback: string, max = 4000): string {
  if (x === undefined || x === null || x === '') return fallback;
  if (typeof x !== 'string' || x.length > max) return fail();
  return redactPhones(x.trim()) || fallback;
}
function boolean(x: unknown): boolean {
  if (x === undefined || x === null || x === '') return false;
  if (typeof x !== 'boolean') return fail();
  return x;
}
function structured(x: unknown): unknown {
  if (typeof x !== 'string') return x;
  try { return JSON.parse(x); } catch { return fail(); }
}
const needs: NeedCategory[] = ['medical_equipment','evacuation','shelter','welfare_check','mobility_issue','outage_information','general_disaster','severe_pain','urgent_symptoms','prescription','new_patient','appointment','cleaning','billing','other'];
const zones: LocationZone[] = ['active_danger','near_danger','affected_area','outside','unknown'];
export function parseRetellEnvelope(payload: unknown): { event: string; call: Record<string, unknown>; callId: string; agentId: string } {
  if (!record(payload) || typeof payload.event !== 'string' || payload.event.length > 80 || !record(payload.call)) return fail();
  return { event: payload.event, call: payload.call, callId: id(payload.call.call_id), agentId: id(payload.call.agent_id) };
}
export function normalizeRetell(payload: unknown, rulebook: Rulebook, mapping: ExtractionMap): RetellIntake {
  const { event, call, callId, agentId } = parseRetellEnvelope(payload);
  if (!['call_ended','call_analyzed'].includes(event) || !['phone_call','web_call'].includes(call.call_type as string) ||
      !['ended','error','not_connected'].includes(call.call_status as string)) return fail();
  const timestamp = (x: unknown): number => typeof x === 'number' && Number.isSafeInteger(x) && x > 0 && x < 8640000000000000 ? x : fail();
  const start = timestamp(call.start_timestamp);
  const end = timestamp(call.end_timestamp);
  if (end < start) return fail();
  if (call.call_analysis !== undefined && !record(call.call_analysis)) return fail();
  const analysis = record(call.call_analysis) ? call.call_analysis : {};
  if (analysis.custom_analysis_data !== undefined && !record(analysis.custom_analysis_data)) return fail();
  // call_ended has no post-call analysis. Never trust stray custom values on that event.
  const rawFields = event === 'call_analyzed' && record(analysis.custom_analysis_data) ? analysis.custom_analysis_data : {};
  const fields = mapExtractionFields(rawFields, mapping);
  const nativeDisaster = rulebook === 'disaster' && !!mapping.requested_service;
  let analysisPending = event !== 'call_analyzed' || !Object.keys(fields).length;
  const notes = analysisPending ? ['Structured analysis is unavailable; operator review required.'] : [];
  // The inspected agent has one string safety_context_signals field. Accept a documented JSON
  // envelope from that field; preserve legacy free text for humans without guessing clinical signals.
  let unstructuredSafety = '';
  if (fields.safety_context_signals !== undefined && fields.safety_context_signals !== '') {
    if (typeof fields.safety_context_signals !== 'string' || fields.safety_context_signals.length > 4000) return fail();
    const value = fields.safety_context_signals.trim();
    if (value.startsWith('{')) {
      let safety: unknown;
      try { safety = structured(value); } catch { if (!nativeDisaster) return fail(); }
      if (!record(safety)) {
        if (!nativeDisaster) return fail();
        unstructuredSafety = string(value, '');
        notes.push('Legacy safety/context JSON is invalid; retained for operator review.');
      } else for (const key of ['need_category','location_zone','facility_signals','possible_danger','immediate_life_threat']) {
        if (fields[key] === undefined && Object.hasOwn(safety, key)) fields[key] = safety[key];
      }
    } else {
      unstructuredSafety = string(value, '');
      if (!nativeDisaster) {
        analysisPending = true;
        notes.push('Safety/context extraction is unstructured; operator review required. No keyword-based safety inference was applied.');
      }
    }
  }
  const facts = nativeDisaster ? adaptDisasterFacts(fields) : undefined;
  if (facts) {
    fields.need_category = facts.needCategory;
    fields.location_zone = facts.locationZone;
    notes.push(...facts.notes);
    analysisPending ||= facts.notes.length > 0;
  }
  if (!facts && (fields.need_category === undefined || fields.location_zone === undefined || fields.facility_signals === undefined)) {
    analysisPending = true;
    notes.push('Classification/context fields are incomplete; operator review required.');
  }
  const category = fields.need_category === undefined ? 'other' : string(fields.need_category, 'other', 80);
  const needCategory = needs.includes(category as NeedCategory) ? category as NeedCategory : 'other';
  if (category !== needCategory) notes.push('Unrecognized need category; operator review required.');
  const zone = string(fields.location_zone, 'unknown', 40);
  const locationZone = zones.includes(zone as LocationZone) ? zone as LocationZone : 'unknown';
  let signals: unknown = fields.facility_signals ?? [];
  if (typeof signals === 'string') signals = signals.trim().startsWith('[') ? structured(signals) : signals.split(',').map(s => s.trim()).filter(Boolean);
  if (!Array.isArray(signals) || signals.length > 40 || !signals.every(s => typeof s === 'string' && s.length <= 100)) return fail();
  const facilitySignals = Array.from(new Set([...(signals as string[]), ...(facts?.signals ?? [])])).filter(s => Object.hasOwn(RULEBOOKS[rulebook].facilitySignals, s));
  if ((signals as string[]).some(s => !Object.hasOwn(RULEBOOKS[rulebook].facilitySignals, s))) notes.push('Unrecognized safety/context signal ignored; review extraction configuration.');
  const rawAnswers = fields.questionnaire_answers ?? [];
  // Existing Retell field description requests free-text question:answer pairs, not JSON.
  // Preserve those verbatim under one labelled answer rather than guessing their boundaries.
  let answers = typeof rawAnswers === 'string' && !rawAnswers.trim().startsWith('[')
    ? (rawAnswers.trim() ? [{ question: 'Retell questionnaire answers', answer: string(rawAnswers, '', 4000) }] : [])
    : structured(rawAnswers);
  if (!Array.isArray(answers) || answers.length > 40) return fail();
  answers = answers.map(q => {
    if (!record(q) || typeof q.question !== 'string' || typeof q.answer !== 'string') return fail();
    return { question: string(q.question, 'Question', 500), answer: string(q.answer, 'Not answered', 2000) };
  });
  // Mapped safety/outcome booleans must be present and typed; missing extraction is not 'false'.
  if (!facts) for (const key of ['emergency_guidance_provided','unresolved_need','human_requested','automation_resolved_request']) {
    if (typeof fields[key] !== 'boolean') return fail();
  }
  if (unstructuredSafety) (answers as QuestionnaireAnswer[]).push({ question: 'Safety/context signals (unstructured)', answer: unstructuredSafety });
  if (facts) (answers as QuestionnaireAnswer[]).push(...facts.answers);
  const emergencyGuidance = boolean(fields.directed_to_911) ? true : facts ? facts.emergencyGuidance : boolean(fields.emergency_guidance_provided);
  const humanRequested = facts ? facts.humanRequested : boolean(fields.human_requested);
  const unresolved = facts ? facts.unresolved : boolean(fields.unresolved_need);
  const automationResolved = facts ? facts.automationResolved : boolean(fields.automation_resolved_request);
  const possibleDanger = boolean(fields.possible_danger);
  if (boolean(fields.immediate_life_threat) && !facilitySignals.includes('immediate_life_threat')) facilitySignals.push('immediate_life_threat');
  const outcome: AgentOutcome = emergencyGuidance ? 'directed_to_911' : possibleDanger ? 'possible_danger' : unresolved ? 'could_not_resolve' : humanRequested ? 'caller_requested_human' : automationResolved && (!facts || unresolved === false && humanRequested === false) ? 'resolved' : 'unknown';
  let phone: string | undefined;
  if (call.call_type === 'phone_call') {
    if (!['inbound','outbound'].includes(call.direction as string)) return fail();
    phone = normalizePhone(call.direction === 'inbound' ? call.from_number : call.to_number);
  } else phone = normalizePhone(fields.phone_number);
  if (!phone) notes.push('No verified-format callback number collected.');
  const metadata = record(call.metadata) ? call.metadata : {};
  const linkedCaseId = metadata.zianecomms_case_id === undefined ? undefined : id(metadata.zianecomms_case_id);
  const reason = string(fields.reason_for_contact, 'Retell call — operator review required');
  if (facts && notes.length) analysisPending = true;
  return {
    event: event as RetellEvent, callId, agentId, status: call.call_status as string, callType: call.call_type as RetellIntake['callType'],
    startedAt: new Date(start).toISOString(), endedAt: new Date(end).toISOString(), phone,
    name: string(fields.caller_name, 'Retell caller', 200), summary: string(analysis.call_summary, reason),
    questionnaire: answers as QuestionnaireAnswer[], analysisPending, emergencyGuidance, humanRequested, unresolved, automationResolved, linkedCaseId, notes,
    input: { rulebook, needCategory, needDescription: reason, language: string(fields.preferred_language, 'Unknown', 80),
      locationZone, locationDetail: string(fields.location, 'Not collected', 500), waitMinutes: 0, attempts: 1,
      callerMessage: string(fields.caller_message, reason), facilitySignals, agentOutcome: outcome },
  };
}
