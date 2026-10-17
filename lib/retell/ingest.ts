import { randomUUID } from 'node:crypto';
import type { ActivityEntry, Caller } from '@/types';
import { scoreCallerInput, maskPhone } from '@/lib/engine';
import { TERMINAL_STATUSES, synchronizeWorkload, type CaseState } from '@/lib/cases';
import { simulateRepeatContact } from '@/data/callers';
import { operationsRepository, PersistenceError, type RpcClient } from '@/lib/persistence/repository';
import { serializeState } from '@/lib/persistence/mapping';
import { protectContact } from './contact';
import type { RetellIntake } from './normalize';

export interface RetellContext {
  call: { case_id: string; agent_id: string } | null;
  targetIdentity: string | null;
}
export function buildRetellCase(state: CaseState, intake: RetellIntake, context: RetellContext, identity: string | null): { state: CaseState; caller: Caller } {
  const callers = state.callersByMode[intake.input.rulebook];
  const linked = callers.find(c => c.id === intake.linkedCaseId);
  // A number alone never links two cases. The reference must come from trusted call metadata.
  const existing = linked && identity && identity === context.targetIdentity && !TERMINAL_STATUSES.includes(linked.status) &&
    linked.source === 'retell' && linked.needCategory === intake.input.needCategory &&
    (!linked.retell || Date.parse(linked.retell.endedAt) <= Date.parse(intake.startedAt)) ? linked : undefined;
  const caseId = existing?.id ?? `retell-${intake.callId}`;
  const input = { ...intake.input };
  // The existing repeat helper unions safety signals, preserves overrides and accumulates attempts.
  // A later conversation must not silently retract an earlier emergency-services instruction.
  if (existing?.engineInput?.agentOutcome === 'directed_to_911') input.agentOutcome = 'directed_to_911';
  const result = scoreCallerInput(input);
  let caller: Caller = existing ? simulateRepeatContact(existing, input, 'New Retell conversation received.') : {
    id: caseId, name: intake.name, phone: intake.phone ? maskPhone(intake.phone) : '***-****', rulebook: input.rulebook,
    priority: result.priority, calculatedPriority: result.priority, score: result.score, scoreBreakdown: result.breakdown,
    hardEscalation: result.hardEscalation, escalationReason: result.escalationReason, manualPriority: false,
    engineInput: input, status: 'awaiting_callback', needCategory: input.needCategory, needSummary: input.needDescription,
    callerMessage: input.callerMessage, aiSummary: intake.summary, questionnaire: intake.questionnaire, activityLog: [],
    waitMinutes: input.waitMinutes, attempts: 1, language: input.language, location: input.locationDetail, createdAt: intake.startedAt,
  };
  // Replace only the helper's new audit entry with stable provider-correlated events below.
  caller = { ...caller, source: 'retell', name: intake.name === 'Retell caller' && existing ? existing.name : intake.name,
    phone: intake.phone ? maskPhone(intake.phone) : caller.phone,
    aiSummary: (intake.analysisPending ? 'Intake classification incomplete — operator review required. ' : '') + intake.summary, questionnaire: intake.questionnaire, status: 'awaiting_callback',
    activityLog: existing?.activityLog ?? [], lastRecommendation: undefined,
    retell: { callId: intake.callId, agentId: intake.agentId, status: intake.status, event: intake.event,
      startedAt: intake.startedAt, endedAt: intake.endedAt, analysisPending: intake.analysisPending, disconnectionReason: intake.disconnectionReason, callSuccessful: intake.callSuccessful,
      outcomes: { emergencyGuidanceProvided: intake.emergencyGuidance ?? null, humanRequested: intake.humanRequested ?? null,
        unresolvedNeed: intake.unresolved ?? null, automationResolvedRequest: intake.automationResolved ?? null } } };
  const reference = { callId: intake.callId, agentId: intake.agentId, event: intake.event, status: intake.status };
  const event = (suffix: string, type: ActivityEntry['type'], label: string, timestamp = intake.endedAt, detail?: string): ActivityEntry => ({
    id: `retell-${intake.callId}-${suffix}`, type, label, timestamp, detail, retell: reference,
  });
  const events: ActivityEntry[] = [
    event('received','call_received','Call received via Retell',intake.startedAt),
    event('completed','conversation_completed','Retell conversation completed',intake.endedAt,
      `Call status: ${intake.status}. ${intake.notes.join(' ')}`.trim()),
  ];
  if (intake.questionnaire.length) events.push({ ...event('questionnaire','questionnaire_completed','Questionnaire information collected',intake.endedAt,
    `${intake.questionnaire.length} questionnaire answers collected.`), questionnaireChange: { previous: existing?.questionnaire ?? [], current: intake.questionnaire } });
  if (intake.emergencyGuidance) events.push(event('emergency','told_call_911','Emergency-services guidance provided',intake.endedAt,
    'Retell reported that the agent instructed the caller to contact emergency services. This does not confirm dispatch or caller action.'));
  if (intake.humanRequested || intake.unresolved) events.push(event('followup','human_followup_requested','Human follow-up requested',intake.endedAt,
    intake.unresolved ? 'The automated conversation did not resolve the need.' : 'Caller requested human assistance.'));
  if (intake.automationResolved) events.push(event('resolved','info_provided','Automation reported request resolved',intake.endedAt,
    'Retained for operator review; the case is not automatically closed.'));
  events.push({ ...event('priority','priority_calculated','ZianeComms priority calculated',intake.endedAt,
    `Calculated Priority ${caller.calculatedPriority}; effective Priority ${caller.priority}. ${caller.manualPriority ? 'Existing human override preserved.' : ''}`.trim()),
    previousCalculatedPriority: existing?.calculatedPriority, calculatedPriority: caller.calculatedPriority,
    previousPriority: existing?.priority, newPriority: caller.priority });
  caller.activityLog = [...caller.activityLog, ...events];
  return { caller, state: synchronizeWorkload({ ...state, callersByMode: { ...state.callersByMode,
    [caller.rulebook]: existing ? callers.map(c => c.id === caller.id ? caller : c) : [...callers, caller] } }) };
}

export async function ingestRetell(client: RpcClient, intake: RetellIntake, encryptionKey: Buffer) {
  const repo = operationsRepository(client);
  const mutationId = randomUUID();
  for (let attempt = 0; attempt < 3; attempt++) {
    const contextResult = await client.rpc('zianecomms_retell_context', { p_call_id: intake.callId, p_linked_case_id: intake.linkedCaseId ?? null });
    if (contextResult.error) throw new PersistenceError('Retell correlation unavailable');
    const context = contextResult.data as RetellContext;
    if (context.call) {
      if (context.call.agent_id !== intake.agentId) throw new PersistenceError('Retell correlation conflict');
      return { duplicate: true };
    }
    const { state, revision } = await repo.load();
    const provisional = protectContact(intake.phone, encryptionKey, `retell-${intake.callId}`);
    const built = buildRetellCase(state, intake, context, provisional.identity);
    const contact = protectContact(intake.phone, encryptionKey, built.caller.id);
    const { data, error } = await client.rpc('zianecomms_ingest_retell', {
      p_expected_revision: revision, p_mutation_id: mutationId, p_payload: serializeState(built.state),
      p_call: { call_id: intake.callId, agent_id: intake.agentId, case_id: built.caller.id, event: intake.event,
        status: intake.status, call_type: intake.callType, outcomes: built.caller.retell?.outcomes, started_at: intake.startedAt, ended_at: intake.endedAt,
        contact_identity: contact.identity, contact_encrypted: contact.encrypted },
    });
    if (!error) return { duplicate: (data as { duplicate: boolean }).duplicate };
    if (error.code !== '40001') throw new PersistenceError('Retell transaction failed');
  }
  throw new PersistenceError('Concurrent change; webhook should retry', true);
}
