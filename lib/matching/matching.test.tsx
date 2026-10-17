import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MATCHING_CONFIG } from '@/config/matching';
import { matchResponders, scoreResponder } from './index';
import { caseReducer, recommendationSignature, recordOutcome, synchronizeWorkload, recordCallbackAttempt, type CaseState } from '@/lib/cases';
import { CLINIC_CALLERS, DISASTER_CALLERS, MOCK_RESPONDERS } from '@/data/callers';
import { scoreCallerInput } from '@/lib/engine';
import type { Caller, Responder, RecommendationSnapshot, ResponderStatus } from '@/types';
import CallerDetailModal from '@/components/CallerDetailModal';
import ResponderPicker from '@/components/ResponderPicker';
import RespondersPage from '@/components/pages/RespondersPage';

const caller = DISASTER_CALLERS[0];
const base = MOCK_RESPONDERS.find(r => r.id === 'r-005')!;
const responder = (overrides: Partial<Responder> = {}): Responder => ({ ...base, ...overrides });
const factor = (r: Responder, name: string, c = caller) => scoreResponder(c, r).breakdown.find(b => b.factor === name)!.points;
const initial = (): CaseState => ({ rulebook: 'disaster', responders: structuredClone(MOCK_RESPONDERS),
  callersByMode: { disaster: structuredClone(DISASTER_CALLERS), clinic: structuredClone(CLINIC_CALLERS) } });
let eventNumber = 0;
function show(state: CaseState, c: Caller = state.callersByMode.disaster[0]): CaseState {
  const result = matchResponders(c, state.responders!);
  const snapshot: RecommendationSnapshot = { id: `rec-${++eventNumber}`, shownAt: '2026-10-17T12:00:00.000Z',
    callerPriority: c.priority, result, signature: recommendationSignature(result, c.priority) };
  return caseReducer(state, { type: 'recommendation_shown', rulebook: c.rulebook, id: c.id, snapshot, operatorId: 'operator-test' });
}
function assign(state: CaseState, responderId: string, approved = true, reason?: string, c = state.callersByMode.disaster[0]): CaseState {
  return caseReducer(state, { type: 'assign', rulebook: c.rulebook, id: c.id, responderId,
    snapshotId: c.lastRecommendation?.id ?? 'missing', humanApproved: approved, operatorId: 'operator-test',
    timestamp: '2026-10-17T12:01:00.000Z', eventId: `assignment-${++eventNumber}`, reason });
}
function workload(state: CaseState, id: string) { return state.responders!.find(r => r.id === id)!; }

describe('Configurable deterministic responder matching', () => {
  it('exact expertise outranks unrelated expertise with all other factors equal', () => {
    expect(factor(base, 'expertise')).toBe(40);
    const unrelated = responder({ id: 'unrelated', expertise: ['billing'] });
    expect(factor(unrelated, 'expertise')).toBe(0);
    expect(matchResponders(caller, [unrelated, base]).recommendedResponderId).toBe(base.id);
  });
  it('awards related expertise 25 and general relevant expertise 10', () => {
    expect(factor(responder({ expertise: ['mobility_support'] }), 'expertise')).toBe(25);
    expect(factor(responder({ expertise: ['general_crisis'] }), 'expertise')).toBe(10);
  });
  it('language match increases MATCH score, approved interpreter earns partial credit', () => {
    expect(factor(base, 'language')).toBe(20);
    const interpreter = responder({ languages: ['en'], interpreterLanguages: ['es'] });
    expect(factor(interpreter, 'language')).toBe(10);
    const unsupported = responder({ languages: ['en'], interpreterLanguages: [] });
    expect(factor(unsupported, 'language')).toBe(0);
    expect(scoreResponder(caller, base).rawScore).toBeGreaterThan(scoreResponder(caller, unsupported).rawScore);
  });
  it.each(['disaster', 'clinic'] as const)('language does not change %s caller PRIORITY, even with legacy language signals', rulebook => {
    const input = { ...caller.engineInput!, rulebook, facilitySignals: ['medical_equipment_dependency', 'severe_symptoms'] };
    expect(scoreCallerInput({ ...input, language: 'English' })).toEqual(scoreCallerInput({ ...input, language: 'Arabic', facilitySignals: [...input.facilitySignals, 'non_english_speaker'] }));
  });
  it('scores direct coverage 20, adjacent 10, outside or unknown 0', () => {
    expect(factor(base, 'location')).toBe(20);
    expect(factor(responder({ coverageAreas: ['central'] }), 'location')).toBe(10);
    expect(factor(responder({ coverageAreas: ['west'] }), 'location')).toBe(0);
    expect(factor(base, 'location', { ...caller, coverageArea: undefined })).toBe(0);
  });
  it('supports globally disabled location scoring and remote billing requests', () => {
    const config = structuredClone(MATCHING_CONFIG); config.location.enabled = false;
    const result = scoreResponder(caller, base, config);
    expect(result.breakdown.find(b => b.factor === 'location')).toMatchObject({ points: 0, reason: expect.stringContaining('disabled') });
    expect(factor(base, 'location', { ...caller, needCategory: 'billing' })).toBe(0);
  });
  it.each([[0, 15], [1, 10], [2, 5], [3, 0], [9, 0]])('workload %i earns %i points', (activeCallers, points) => {
    expect(factor(responder({ activeCallers }), 'workload')).toBe(points);
  });
  it('explicit relevant experience earns 5, related earns 2, absent earns 0', () => {
    expect(factor(base, 'experience')).toBe(5);
    expect(factor(responder({ experience: ['mobility_assistance'] }), 'experience')).toBe(2);
    expect(factor(responder({ experience: [] }), 'experience')).toBe(0);
  });
  it('offline responders are never primary even when their score is higher', () => {
    const offline = responder({ id: 'offline', status: 'offline' });
    const available = responder({ id: 'available', experience: [] });
    const result = matchResponders(caller, [offline, available]);
    expect(result.recommendedResponderId).toBe('available');
    expect(result.candidates.find(c => c.responderId === 'offline')!.eligible).toBe(false);
  });
  it('busy highly qualified responder never replaces a sufficiently qualified Available primary', () => {
    const busy = responder({ id: 'busy', status: 'busy' });
    const available = responder({ id: 'available', experience: [] });
    const result = matchResponders(caller, [busy, available]);
    expect(result.recommendedResponderId).toBe('available');
    expect(result.candidates.map(c => c.responderId)).toEqual(['available', 'busy']);
  });
  it('honestly identifies weak available match and a better Busy expertise alternative', () => {
    const weak = responder({ id: 'weak', expertise: ['general_crisis'], experience: [], languages: ['en'] });
    const busy = responder({ id: 'busy', status: 'busy' });
    const result = matchResponders(caller, [weak, busy]);
    expect(result.strongAvailableMatch).toBe(false);
    expect(result.explanation).toContain('No fully qualified available responder');
    expect(result.recommendedResponderId).toBe('weak');
    expect(result.bestExpertiseResponderId).toBe('busy');
    const html = renderToStaticMarkup(<ResponderPicker caller={caller} responders={[weak, busy]} onAssign={() => {}} />);
    expect(html).toContain('currently busy');
    expect(html).toContain('No fully qualified available responder');
  });
  it('no Available responders yields no primary; Busy stays alternative; all Offline yields no expertise recommendation', () => {
    expect(matchResponders(caller, [responder({ status: 'busy' })]).recommendedResponderId).toBeUndefined();
    const result = matchResponders(caller, [responder({ status: 'offline' })]);
    expect(result.recommendedResponderId).toBeUndefined(); expect(result.bestExpertiseResponderId).toBeUndefined();
    expect(matchResponders(caller, []).explanation).toContain('No available responder');
  });
  it('factor components sum to raw score and default maxima sum to 100', () => {
    for (const match of matchResponders(caller, MOCK_RESPONDERS).candidates) {
      expect(match.breakdown.reduce((sum, b) => sum + b.points, 0)).toBe(match.rawScore);
      expect(match.breakdown.reduce((sum, b) => sum + b.maxPoints, 0)).toBe(100);
      expect(match.explanation).toContain('+'); expect(match.rawScore).toBeLessThanOrEqual(100);
    }
    expect(scoreResponder(caller, base).rawScore).toBe(100);
  });
  it('configuration changes recommendations without modifying generic logic', () => {
    const expert = responder({ id: 'expert', languages: ['en'], interpreterLanguages: [] });
    const related = responder({ id: 'related', expertise: ['mobility_support'] });
    expect(matchResponders(caller, [expert, related]).recommendedResponderId).toBe('related');
    const config = structuredClone(MATCHING_CONFIG);
    config.weights = { expertise: 70, language: 0, location: 10, workload: 15, experience: 5 };
    config.strongMatch.requireLanguageSupport = false;
    expect(matchResponders(caller, [expert, related], config).recommendedResponderId).toBe('expert');
  });
  it('language rules, expertise mappings, adjacency, workload thresholds and experience mappings are configurable', () => {
    const config = structuredClone(MATCHING_CONFIG);
    config.language.interpreter = 5; config.expertiseMappings.medical_equipment!.exact = ['billing'];
    config.location.adjacency.eastside = ['west']; config.workload[0].points = 12;
    config.experience.mappings.medical_equipment!.exact = ['billing_support'];
    const result = scoreResponder(caller, responder({ expertise: ['billing'], languages: ['en'], interpreterLanguages: ['es'], coverageAreas: ['west'], experience: ['billing_support'] }), config);
    expect(result.breakdown.map(b => b.points)).toEqual([40, 5, 10, 12, 5]);
  });
  it('stable ID tie breaks, mode filtering, and deterministic results do not mutate inputs', () => {
    const a = responder({ id: 'a' }), b = responder({ id: 'b' });
    const responders = [b, a, responder({ id: 'clinic-only', rulebooks: ['clinic'] })];
    const before = structuredClone(responders);
    expect(matchResponders(caller, responders).candidates.map(c => c.responderId)).toEqual(['a', 'b']);
    expect(matchResponders(caller, responders)).toEqual(matchResponders(caller, responders));
    expect(responders).toEqual(before);
  });
  it('rejects weights that cannot represent a score out of 100', () => {
    const config = structuredClone(MATCHING_CONFIG); config.weights.expertise = 90;
    expect(() => matchResponders(caller, [base], config)).toThrow('totaling 100');
  });
});

describe('Human-approved assignment and real workload', () => {
  it('viewing recommendations records all scores without assigning; approval is required', () => {
    const state = show(initial());
    const c = state.callersByMode.disaster[0];
    expect(c.assignedResponderId).toBeUndefined(); expect(workload(state, base.id).activeCallers).toBe(0);
    expect(c.activityLog.at(-1)!.dispatch!.recommendation!.result.candidates).toEqual(matchResponders(c, state.responders!).candidates);
    expect(assign(state, base.id, false)).toBe(state);
    expect(assign(initial(), base.id)).toEqual(initial());
  });
  it('assignment updates caller, active workload, assigned case list and operator history', () => {
    const state = assign(show(initial()), base.id);
    const c = state.callersByMode.disaster[0];
    expect(c.assignedResponderId).toBe(base.id);
    expect(workload(state, base.id)).toMatchObject({ activeCallers: 1, assignedCaseIds: [c.id] });
    expect(c.activityLog.at(-1)).toMatchObject({ operatorId: 'operator-test', timestamp: '2026-10-17T12:01:00.000Z',
      dispatch: { selectedResponderId: base.id, followedRecommendation: true, selectedWorkloadBefore: 0, selectedWorkloadAfter: 1, callerPriority: c.priority } });
    expect(c.activityLog.at(-1)!.detail).toContain('Recommended match: 100%');
  });
  it('reassignment decreases old workload and increases new workload without deleting history', () => {
    let state = assign(show(initial()), base.id);
    const before = state.callersByMode.disaster[0].activityLog;
    state = assign(show(state), 'r-001', true, 'Needs a field visit');
    expect(workload(state, base.id).activeCallers).toBe(0);
    expect(workload(state, 'r-001').activeCallers).toBe(1);
    const c = state.callersByMode.disaster[0];
    expect(c.activityLog.slice(0, before.length)).toEqual(before);
    expect(c.activityLog.at(-1)).toMatchObject({ reason: 'Needs a field visit', dispatch: { previousResponderId: base.id,
      selectedResponderId: 'r-001', followedRecommendation: false, previousWorkloadBefore: 1, previousWorkloadAfter: 0 } });
  });
  it.each(['resolved', 'referred'] as const)('%s closure releases workload; repeating closure never makes it negative', outcome => {
    let state = assign(show(initial()), base.id);
    const c = state.callersByMode.disaster[0];
    const { callerPatch, logEntry } = recordOutcome(outcome, c);
    for (let i = 0; i < 2; i++) state = caseReducer(state, { type: 'patch', rulebook: 'disaster', id: c.id, patch: callerPatch, logEntry });
    expect(workload(state, base.id)).toMatchObject({ activeCallers: 0, assignedCaseIds: [] });
    expect(state.callersByMode.disaster[0].assignedResponderId).toBe(base.id);
    expect(logEntry.dispatch).toMatchObject({ selectedResponderId: base.id, outcome });
  });
  it.each(['no_answer', 'needs_followup'] as const)('%s retains assignment workload', outcome => {
    let state = assign(show(initial()), base.id);
    const c = state.callersByMode.disaster[0]; const result = recordOutcome(outcome, c);
    state = caseReducer(state, { type: 'patch', rulebook: 'disaster', id: c.id, patch: result.callerPatch, logEntry: result.logEntry });
    expect(workload(state, base.id).activeCallers).toBe(1);
    expect(result.logEntry.type).toBe('followup_required');
  });
  it('same responder cannot be double-assigned; old recommendation snapshots stay unchanged', () => {
    let state = show(initial()); const snapshot = state.callersByMode.disaster[0].lastRecommendation!;
    state = assign(state, base.id);
    expect(assign(show(state), base.id).callersByMode.disaster[0].activityLog.filter(e => e.type === 'responder_assigned')).toHaveLength(1);
    expect(snapshot.result.candidates.find(c => c.responderId === base.id)!.activeCases).toBe(0);
    expect(workload(state, base.id).activeCallers).toBe(1);
  });
  it('status changes affect recommendations and invalidate stale approvals; Offline cannot be assigned', () => {
    let state = show(initial());
    for (const status of ['busy', 'offline'] as ResponderStatus[]) {
      state = caseReducer(state, { type: 'responder_status', responderId: base.id, status });
      expect(assign(state, base.id)).toBe(state);
      expect(matchResponders(caller, state.responders!).recommendedResponderId).not.toBe(base.id);
    }
    state = show(state); expect(assign(state, base.id)).toBe(state);
  });
  it('Busy may be manually selected as an explicitly recorded recommendation override', () => {
    const state = assign(show(initial()), 'r-003', true, 'Supervisor requested the case');
    expect(state.callersByMode.disaster[0].activityLog.at(-1)!.dispatch).toMatchObject({ followedRecommendation: false, selectedResponderId: 'r-003' });
    expect(workload(state, 'r-003').activeCallers).toBe(1);
  });
  it('a manual Busy choice with no Available responders is not mislabeled as overriding a nonexistent recommendation', () => {
    let state = initial();
    state.responders = state.responders!.map(r => ({ ...r, status: r.id === 'r-003' ? 'busy' : 'offline' }));
    state = assign(show(state), 'r-003');
    const event = state.callersByMode.disaster[0].activityLog.at(-1)!;
    expect(event.dispatch!.followedRecommendation).toBeUndefined();
    expect(event.detail).toContain('No primary recommendation; operator selected an alternative');
    expect(workload(state, 'r-003').activeCallers).toBe(1);
  });
  it('shared responders count active assignments across both mode datasets', () => {
    let state = assign(show(initial()), 'r-002');
    const clinic = state.callersByMode.clinic[0]; state = show(state, clinic);
    state = assign(state, 'r-002', true, undefined, state.callersByMode.clinic[0]);
    expect(workload(state, 'r-002').activeCallers).toBe(2);
    state = caseReducer(state, { type: 'switch_mode', rulebook: 'clinic' });
    state = caseReducer(state, { type: 'switch_mode', rulebook: 'disaster' });
    expect(workload(state, 'r-002').assignedCaseIds).toEqual(['cc-001', 'dc-001']);
  });
  it('workload changes feed back into matching and distribute the next case', () => {
    const a = responder({ id: 'a' }), b = responder({ id: 'b' });
    let state = initial(); state.responders = [a, b];
    state = assign(show(state), 'a');
    expect(matchResponders(state.callersByMode.disaster[0], state.responders!).recommendedResponderId).toBe('b');
  });
  it('workload synchronization cannot produce negative counts from stale seed values', () => {
    const state = initial(); state.responders![0].activeCallers = -5;
    expect(synchronizeWorkload(state).responders!.every(r => r.activeCallers >= 0)).toBe(true);
  });
  it('captures response time and outcome against the actual assignment recommendation, even after another recommendation is viewed', () => {
    let state = assign(show(initial()), base.id);
    const assigned = state.callersByMode.disaster[0].assignmentRecommendation;
    state = show(state); const c = state.callersByMode.disaster[0];
    const callback = recordCallbackAttempt(c, '2026-10-17T12:01:12.000Z');
    expect(callback.dispatch).toMatchObject({ responseTimeMs: 12000, selectedResponderId: base.id, recommendation: assigned });
    expect(recordOutcome('resolved', c).logEntry.dispatch!.recommendation).toEqual(assigned);
  });
  it('renders the assigned responder by name and directory status, expertise, language, coverage and workload', () => {
    const state = assign(show(initial()), base.id); const c = state.callersByMode.disaster[0];
    const html = renderToStaticMarkup(<CallerDetailModal caller={c} responders={state.responders} onClose={() => {}} onStartCall={() => {}} onRecordOutcome={() => {}} onChangePriority={() => {}} onAssignResponder={() => {}} />);
    expect(html).toContain('Assigned Responder'); expect(html).toContain('Sarah Martinez'); expect(html).toContain('REASSIGN RESPONDER');
    const page = renderToStaticMarkup(<RespondersPage responders={state.responders!} callers={state.callersByMode.disaster} onStatusChange={() => {}} rulebook="disaster" />);
    expect(page).toContain('Status for Sarah Martinez'); expect(page).toContain('medical support'); expect(page).toContain('Spanish'); expect(page).toContain('Eastside'); expect(page).toContain('Maria Gonzalez');
  });
});
