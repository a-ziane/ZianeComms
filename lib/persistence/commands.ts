import type { Caller, EngineInput, QuestionnaireAnswer, ActivityEntry, CallOutcome, ResponderStatus } from '@/types';
import { applyHumanOverride, scoreCallerInput } from '@/lib/engine';
import { caseReducer, recordOutcome, recordCallbackAttempt, type CaseAction, type CaseState } from '@/lib/cases';
import { simulateRepeatContact } from '@/data/callers';

export type OperationalCommand = Exclude<CaseAction, { type: 'switch_mode' }> |
  { type: 'create_case'; caller: Caller } |
  { type: 'repeat_contact'; id: string; rulebook: Caller['rulebook']; input: Partial<EngineInput>; detail: string } |
  { type: 'questionnaire'; id: string; rulebook: Caller['rulebook']; answers: QuestionnaireAnswer[] };
const statuses: ResponderStatus[] = ['available','busy','offline'];
const outcomes: CallOutcome[] = ['resolved','referred','no_answer','needs_followup','duplicate','unable_to_reach'];
const operatorId = 'operator-mock-001';
const text = (v: unknown): v is string => typeof v === 'string' && v.length <= 20000;
const validCaller = (c: Caller) => c && text(c.id) && text(c.name) && text(c.phone) && text(c.callerMessage) &&
  ['disaster','clinic'].includes(c.rulebook) && Array.isArray(c.questionnaire) && Array.isArray(c.activityLog) && c.engineInput;

export function applyOperationalCommand(state: CaseState, untrusted: unknown, timestamp: string): CaseState {
  if (!untrusted || typeof untrusted !== 'object') throw new Error('Invalid operation');
  const command = untrusted as OperationalCommand;
  if (command.type === 'responder_status') {
    if (!statuses.includes(command.status) || !state.responders?.some(r => r.id === command.responderId)) throw new Error('Invalid responder status');
    return caseReducer(state, command);
  }
  if (command.type === 'create_case') {
    if (!validCaller(command.caller)) throw new Error('Invalid case');
    const c = command.caller;
    if (Object.values(state.callersByMode).flat().some(x => x.id === c.id)) throw new Error('Case already exists');
    const input = { ...c.engineInput!, rulebook: c.rulebook };
    const result = scoreCallerInput(input);
    const caller: Caller = { ...c, engineInput: input, needCategory: input.needCategory, needSummary: input.needDescription, language: input.language, location: input.locationDetail, waitMinutes: input.waitMinutes, attempts: input.attempts, callerMessage: input.callerMessage, priority: result.priority,
      calculatedPriority: result.priority, score: result.score, scoreBreakdown: result.breakdown, hardEscalation: result.hardEscalation,
      escalationReason: result.escalationReason, status: 'awaiting_callback', manualPriority: false,
      overridePriority: undefined, manualPriorityReason: undefined, originalCalculatedPriority: undefined, overrideTimestamp: undefined, overrideOperatorId: undefined, assignedResponderId: undefined, assignedAt: undefined, lastRecommendation: undefined, assignmentRecommendation: undefined,
      createdAt: timestamp, activityLog: [{ id: `created-${c.id}`, type: 'priority_recalculated', timestamp,
        label: 'Case created and priority calculated', detail: 'Priority calculated from intake information.' }] };
    return { ...state, callersByMode: { ...state.callersByMode, [caller.rulebook]: [...state.callersByMode[caller.rulebook], caller] } };
  }
  if (!('rulebook' in command) || !['disaster','clinic'].includes(command.rulebook) || !('id' in command)) throw new Error('Invalid operation mode');
  const caller = state.callersByMode[command.rulebook].find(c => c.id === command.id);
  if (!caller) throw new Error('Case not found');
  if (command.type === 'note') {
    if (!text(command.note) || !command.note.trim() || command.note.length > 2000 || !text(command.eventId) || !command.eventId) throw new Error('Invalid note');
    return caseReducer(state, { ...command, note: command.note.trim(), timestamp });
  }
  if (command.type === 'repeat_contact') {
    if (!command.input || command.input.rulebook && command.input.rulebook !== caller.rulebook || !text(command.detail)) throw new Error('Invalid repeat contact');
    const updated = simulateRepeatContact(caller, command.input, command.detail);
    return caseReducer(state, { type: 'patch', id: caller.id, rulebook: caller.rulebook, patch: updated });
  }
  if (command.type === 'questionnaire') {
    if (!Array.isArray(command.answers) || !command.answers.every(q => text(q.question) && text(q.answer))) throw new Error('Invalid questionnaire');
    return caseReducer(state, { type: 'patch', id: caller.id, rulebook: caller.rulebook, patch: { questionnaire: command.answers },
      logEntry: { id: `questionnaire-${timestamp}`, type: 'questionnaire_completed', timestamp, operatorId,
        label: 'Questionnaire updated', detail: JSON.stringify({ previous: caller.questionnaire, current: command.answers }) } });
  }
  if (command.type === 'patch') {
    // Rebuild trusted workflow patches on the server rather than accepting arbitrary client state or scores.
    let patch: Partial<Caller>; let logEntry: ActivityEntry;
    const incoming = command.logEntry;
    if (incoming?.type === 'priority_changed') {
      const p = command.patch.priority;
      if (p === undefined || ![0,1,2,3].includes(p) || !text(command.patch.manualPriorityReason)) throw new Error('Invalid priority override');
      ({ callerPatch: patch, logEntry } = applyHumanOverride(caller, p, command.patch.manualPriorityReason, operatorId, incoming.safetyDowngradeConfirmed === true));
    } else if (incoming?.type === 'call_attempted' && command.patch.status === 'calling') {
      patch = { status: 'calling' }; logEntry = recordCallbackAttempt(caller, timestamp);
    } else if ((incoming?.type === 'case_closed' || incoming?.type === 'followup_required') && outcomes.includes(command.patch.status as CallOutcome)) {
      ({ callerPatch: patch, logEntry } = recordOutcome(command.patch.status as CallOutcome, caller));
    } else throw new Error('Unsupported case patch');
    return caseReducer(state, { type: 'patch', rulebook: caller.rulebook, id: caller.id, patch, logEntry });
  }
  if (command.type === 'recommendation_shown') {
    const snapshot = command.snapshot;
    if (!snapshot || !text(snapshot.id) || !text(snapshot.signature) || !snapshot.result) throw new Error('Invalid recommendation');
    const next = caseReducer(state, { ...command, operatorId, snapshot: { ...snapshot, shownAt: timestamp } });
    if (next === state) throw new Error('Recommendation changed. Open responder selection again.');
    return next;
  }
  if (command.type === 'assign') {
    if (!text(command.responderId) || !text(command.snapshotId) || !text(command.eventId) || command.reason !== undefined && !text(command.reason)) throw new Error('Invalid assignment');
    const next = caseReducer(state, { ...command, operatorId, timestamp });
    if (next === state) throw new Error('Assignment not approved or recommendation is no longer current. Reopen responder selection.');
    return next;
  }
  throw new Error('Unsupported operation');
}
