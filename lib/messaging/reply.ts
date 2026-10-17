import type { Caller, ActivityEntry, EngineInput } from '@/types';
import { simulateRepeatContact } from '@/data/callers';
import { adaptDisasterFacts, DISASTER_FACT_FIELDS, DISASTER_SERVICES, DISASTER_FACT_LABELS } from '@/lib/retell/disaster-facts';
import { redactPhones } from '@/lib/retell/contact';
export const isStop = (body: string) => /^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT)$/i.test(body.trim());
// Explicit protocol, not prose inference. Partial/invalid fields remain unknown. No caller-supplied weights or priority.
export function updateFromReply(caller: Caller, body: string, id: string, timestamp: string): Caller {
  const safeBody = redactPhones(body);
  const urgent = body.trim().toUpperCase() === 'URGENT';
  const fields: Record<string,unknown> = {};
  // Exact structured questionnaire keys retain prior facts across voice/SMS contacts.
  const questionKeys: Record<string,string> = Object.fromEntries(Object.entries(DISASTER_FACT_LABELS).map(([k,v])=>[`Structured intake — ${v}`,k]));
  questionKeys['Structured intake — Requested service']='requested_service';
  questionKeys['Structured intake — Crisis location zone']='location_zone';
  for (const answer of caller.questionnaire) {
    const field = questionKeys[answer.question];
    if (field) fields[field]=answer.answer;
  }
  const seen = new Set<string>();
  let structuredReply = false;
  const allowed = [...DISASTER_FACT_FIELDS, 'requested_service', 'location_zone', 'preferred_language', 'location'];
  for (const token of body.split(';')) {
    const match = /^\s*([a-z_]+)\s*=\s*([^;=]{1,500})\s*$/i.exec(token);
    if (!match || !allowed.includes(match[1].toLowerCase())) continue;
    const key = match[1].toLowerCase(), value = match[2].trim();
    structuredReply = true;
    if (seen.has(key)) { fields[key] = 'unknown'; continue; }
    seen.add(key);
    fields[key] = ['location','preferred_language'].includes(key) ? redactPhones(value) : value.toLowerCase();
  }
  const patch: Partial<EngineInput> = { attempts: 0 };
  if (urgent && ['unknown','resolved','caller_confirmed_resolved'].includes(caller.engineInput?.agentOutcome ?? 'unknown')) patch.agentOutcome = 'caller_requested_human';
  const facts = caller.rulebook === 'disaster' && structuredReply ? adaptDisasterFacts(fields) : undefined;
  if (facts) {
    patch.facilitySignals = facts.signals;
    if (DISASTER_SERVICES.includes(fields.requested_service as typeof DISASTER_SERVICES[number]) && fields.requested_service !== 'unknown') patch.needCategory = facts.needCategory;
    if (facts.locationZone !== 'unknown') patch.locationZone = facts.locationZone;
    if (typeof fields.location === 'string' && fields.location.toLowerCase() !== 'unknown') patch.locationDetail = fields.location;
    if (typeof fields.preferred_language === 'string' && fields.preferred_language.toLowerCase() !== 'unknown') patch.language = fields.preferred_language;
  }
  const event: ActivityEntry = { id: `sms-${id}`, type: 'sms_received', timestamp, label: 'SMS reply received', detail: safeBody || '(empty SMS)' };
  if (isStop(body)) return { ...caller, activityLog: [...caller.activityLog, { ...event, detail: 'Caller opted out of recovery SMS.' }] };
  let next = simulateRepeatContact(caller, patch, 'SMS reply received; only explicit structured facts used.');
  // SMS is not another voice-call attempt. Store an SMS priority event without the demo-repeat projector.
  const calculated = next.activityLog.at(-1)!;
  next = { ...next, status: 'needs_followup', lastRecommendation: undefined,
    questionnaire: [...caller.questionnaire, {question:'SMS reply — operator review required',answer:safeBody || '(empty SMS)'},
      ...(facts?.answers ?? [])],
    activityLog: [...caller.activityLog, event, { ...calculated, id:`sms-priority-${id}`, type:'priority_calculated', timestamp,
      label:'Priority recalculated after SMS', detail: calculated.detail + (urgent ? ' Explicit URGENT requests human follow-up; it does not assert a medical emergency.' : '') + ' Free text/unknown facts require operator review.' }] };
  return next;
}
