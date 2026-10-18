import type { ActivityEntry, Caller, CallOutcome, Rulebook, Responder, ResponderStatus, RecommendationSnapshot } from '@/types';
import { matchingForCaller, type ActiveOrganization } from '@/lib/organization/model';
import { deploymentResponders } from './deployment';
import { matchResponders } from '@/lib/matching';

// Preserve existing terminal handling for duplicate/unreachable cases.
export const TERMINAL_STATUSES: Caller['status'][] = ['resolved', 'referred', 'duplicate', 'unable_to_reach'];

export function recordOutcome(outcome: CallOutcome, caller?: Caller): { callerPatch: Partial<Caller>; logEntry: ActivityEntry } {
  const closed = TERMINAL_STATUSES.includes(outcome);
  return {
    callerPatch: { status: outcome },
    logEntry: {
      id: `log-outcome-${Date.now()}`,
      type: closed ? 'case_closed' : 'followup_required',
      timestamp: new Date().toISOString(),
      operatorId: 'operator-mock-001',
      dispatch: caller ? { callerPriority: caller.priority, outcome, selectedResponderId: caller.assignedResponderId, recommendation: caller.assignmentRecommendation } : undefined,
      label: `${closed ? 'Case closed' : 'Follow-up required'} — ${outcome.replace(/_/g, ' ')}`,
      detail: `Outcome recorded by operator: ${outcome.replace(/_/g, ' ')}.` +
        (closed ? '' : ' Case remains active and requires future follow-up.'),
    },
  };
}

// Response time measures the interval from the latest assignment to this callback attempt.
export function recordCallbackAttempt(caller: Caller, timestamp: string): ActivityEntry {
  return {
    id: `callback-${timestamp}-${caller.id}`, type: 'call_attempted', timestamp,
    operatorId: 'operator-mock-001', label: 'Callback initiated by operator', detail: 'Operator began callback workflow.',
    dispatch: { callerPriority: caller.priority, selectedResponderId: caller.assignedResponderId,
      recommendation: caller.assignmentRecommendation,
      responseTimeMs: caller.assignedAt ? Math.max(0, Date.parse(timestamp) - Date.parse(caller.assignedAt)) : undefined },
  };
}

export interface CaseState {
  rulebook: Rulebook;
  activeOrganizations?: ActiveOrganization[];
  callersByMode: Record<Rulebook, Caller[]>;
  responders?: Responder[]; // optional for compatibility with existing case-only consumers
}

export type CaseAction =
  | { type: 'note'; rulebook: Rulebook; id: string; note: string; eventId: string; timestamp: string }
  | { type: 'switch_mode'; rulebook: Rulebook }
  | { type: 'responder_status'; responderId: string; status: ResponderStatus }
  | { type: 'recommendation_shown'; rulebook: Rulebook; id: string; snapshot: RecommendationSnapshot; operatorId: string }
  | { type: 'assign'; rulebook: Rulebook; id: string; responderId: string; snapshotId: string; humanApproved: boolean; operatorId: string; timestamp: string; eventId: string; reason?: string }
  | { type: 'patch'; rulebook: Rulebook; id: string; patch: Partial<Caller>; logEntry?: ActivityEntry };

// Both counts and lists come from the same active caller assignments across modes.
export function synchronizeWorkload(state: CaseState): CaseState {
  if (!state.responders) return state;
  const allCallers = Object.values(state.callersByMode).flat();
  const responders = state.responders.map(r => {
    const assignedCaseIds = allCallers.filter(c => c.assignedResponderId === r.id && !TERMINAL_STATUSES.includes(c.status)).map(c => c.id).sort();
    if (r.activeCallers === assignedCaseIds.length && r.assignedCaseIds.join(',') === assignedCaseIds.join(',')) return r;
    return { ...r, activeCallers: assignedCaseIds.length, assignedCaseIds };
  });
  return { ...state, responders: responders.every((r, i) => r === state.responders![i]) ? state.responders : responders };
}

export function recommendationSignature(result: RecommendationSnapshot['result'], priority: Caller['priority']): string {
  return JSON.stringify({ result, priority });
}

export function caseReducer(state: CaseState, action: CaseAction): CaseState {
  if (action.type === 'switch_mode') {
    return state.rulebook === action.rulebook ? state : { ...state, rulebook: action.rulebook };
  }
  if (action.type === 'responder_status') {
    return { ...state, responders: state.responders?.map(r => r.id === action.responderId ? { ...r, status: action.status } : r) };
  }
  const caller = state.callersByMode[action.rulebook].find(c => c.id === action.id);
  if (!caller) return state;
  if (action.type === 'note') {
    return caseReducer(state, { type: 'patch', rulebook: action.rulebook, id: action.id, patch: {}, logEntry: { id: action.eventId, type: 'operator_note', timestamp: action.timestamp, operatorId: 'operator-mock-001', label: 'Operator note', detail: action.note } });
  }
  if (action.type === 'recommendation_shown') {
    const result = matchResponders(caller, deploymentResponders(caller, state.responders ?? [],state.activeOrganizations), matchingForCaller(caller,state.activeOrganizations));
    if (action.snapshot.signature !== recommendationSignature(result, caller.priority) ||
      recommendationSignature(action.snapshot.result, caller.priority) !== action.snapshot.signature) return state;
    return caseReducer(state, { type: 'patch', rulebook: action.rulebook, id: action.id,
      patch: { lastRecommendation: action.snapshot }, logEntry: {
        id: action.snapshot.id, type: 'recommendation_shown', timestamp: action.snapshot.shownAt,
        operatorId: action.operatorId, label: 'Responder recommendation shown',
        detail: result.recommendedResponderId
          ? `Recommended: ${state.responders?.find(r => r.id === result.recommendedResponderId)?.name}. ${result.explanation}`
          : result.explanation,
        dispatch: { callerPriority: caller.priority, recommendation: action.snapshot },
      } });
  }
  if (action.type === 'assign') {
    const responders = state.responders ?? [];
    const responder = responders.find(r => r.id === action.responderId);
    const snapshot = caller.lastRecommendation;
    // Viewing a recommendation never assigns a case. Revalidate availability and the shown snapshot at approval time.
    if (!action.humanApproved || !action.operatorId.trim() || !responder || responder.status === 'offline' ||
      !deploymentResponders(caller, [responder],state.activeOrganizations).length || !responder.rulebooks.includes(caller.rulebook) || TERMINAL_STATUSES.includes(caller.status) ||
      caller.assignedResponderId === responder.id || !snapshot || snapshot.id !== action.snapshotId ||
      snapshot.signature !== recommendationSignature(matchResponders(caller, deploymentResponders(caller, responders,state.activeOrganizations), matchingForCaller(caller,state.activeOrganizations)), caller.priority)) return state;
    const previous = responders.find(r => r.id === caller.assignedResponderId);
    const recommended = snapshot.result.candidates.find(c => c.responderId === snapshot.result.recommendedResponderId);
    const followed = snapshot.result.recommendedResponderId ? responder.id === snapshot.result.recommendedResponderId : undefined;
    const logEntry: ActivityEntry = {
      id: action.eventId, type: 'responder_assigned', timestamp: action.timestamp, operatorId: action.operatorId, reason: action.reason?.trim() || undefined,
      label: `${previous ? 'Reassigned' : 'Assigned'} to ${responder.name} by Operator 01`,
      detail: `${previous ? `Previous responder: ${previous.name}. ` : ''}Assigned to ${responder.name} by Operator 01 (${action.operatorId}). ` +
        `Recommended match: ${recommended ? `${recommended.rawScore}% (${responders.find(r => r.id === recommended.responderId)?.name})` : 'none available'}. ` +
        `${followed === undefined ? 'No primary recommendation; operator selected an alternative.' : followed ? 'Operator followed recommendation.' : 'Operator overrode recommendation.'}` +
        (action.reason?.trim() ? ` Reason: ${action.reason.trim()}` : ''),
      dispatch: { callerPriority: caller.priority, recommendation: snapshot, previousResponderId: caller.assignedResponderId,
        selectedResponderId: responder.id, followedRecommendation: followed, selectedWorkloadBefore: responder.activeCallers,
        selectedWorkloadAfter: responder.activeCallers + 1,
        previousWorkloadBefore: previous?.activeCallers, previousWorkloadAfter: previous ? Math.max(0, previous.activeCallers - 1) : undefined },
    };
    return caseReducer(state, { type: 'patch', rulebook: action.rulebook, id: action.id,
      patch: { assignedResponderId: responder.id, assignedAt: action.timestamp, assignmentRecommendation: snapshot }, logEntry });
  }
  return synchronizeWorkload({
    ...state,
    callersByMode: {
      ...state.callersByMode,
      [action.rulebook]: state.callersByMode[action.rulebook].map(c => c.id !== action.id ? c : {
        ...c,
        ...action.patch,
        activityLog: action.logEntry ? [...c.activityLog, action.logEntry] : action.patch.activityLog ?? c.activityLog,
      }),
    },
  });
}
