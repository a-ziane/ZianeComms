import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CLINIC_CALLERS, DISASTER_CALLERS, simulateRepeatContact } from '@/data/callers';
import { applyHumanOverride, requiresSafetyConfirmation, scoreCallerInput, sortCallers } from '@/lib/engine';
import { caseReducer, recordOutcome, TERMINAL_STATUSES, type CaseState } from './index';
import CallerDetailModal, { SafetyOverrideConfirmation } from '@/components/CallerDetailModal';
import type { Caller, CallOutcome, Priority } from '@/types';

function override(caller: Caller, priority: Priority, reason = 'Reviewed by operator', confirmed = false): Caller {
  const { callerPatch, logEntry } = applyHumanOverride(caller, priority, reason, 'operator-test', confirmed);
  return { ...caller, ...callerPatch, activityLog: [...caller.activityLog, logEntry] };
}

function modal(caller: Caller) {
  return renderToStaticMarkup(<CallerDetailModal caller={caller} onClose={() => {}} onStartCall={() => {}}
    onRecordOutcome={() => {}} onChangePriority={() => {}} onAssignResponder={() => {}} />);
}

const hardCaller = CLINIC_CALLERS[0];

describe('Safety downgrade safeguard', () => {
  it.each([1, 2, 3] as Priority[])('rejects unconfirmed hard escalation downgrade to %i', priority => {
    expect(requiresSafetyConfirmation(hardCaller, priority)).toBe(true);
    expect(() => override(hardCaller, priority)).toThrow('Explicit confirmation');
  });

  it('requires a nonempty reason even when safety downgrade is confirmed', () => {
    expect(() => override(hardCaller, 2, '   ', true)).toThrow('reason is required');
  });

  it('preserves calculated Priority 0 and records a confirmed human override with full audit fields', () => {
    const caller = override(hardCaller, 2, 'Emergency services confirmed care', true);
    expect(caller).toMatchObject({ priority: 2, overridePriority: 2, calculatedPriority: 0, hardEscalation: true,
      manualPriority: true, overrideOperatorId: 'operator-test' });
    const log = caller.activityLog.at(-1)!;
    expect(log).toMatchObject({ previousPriority: 0, newPriority: 2, calculatedPriority: 0,
      operatorId: 'operator-test', reason: 'Emergency services confirmed care', safetyDowngradeConfirmed: true });
    expect(Number.isNaN(Date.parse(log.timestamp))).toBe(false);
    expect(caller.overrideTimestamp).toBe(log.timestamp);
    expect(log.detail).toContain(hardCaller.escalationReason);
  });

  it('records the previous effective priority when an override is changed again', () => {
    const caller = override(override(hardCaller, 2, 'First review', true), 1, 'Second review', true);
    expect(caller.activityLog.at(-1)).toMatchObject({ previousPriority: 2, newPriority: 1 });
    expect(caller.activityLog.at(-1)!.label).toContain('2 → 1');
    expect(caller.activityLog.filter(e => e.operatorId === 'operator-test')).toHaveLength(2);
  });

  it('allows retaining hard Priority 0 and ordinary overrides without extra acknowledgement', () => {
    expect(override(hardCaller, 0).priority).toBe(0);
    expect(override(DISASTER_CALLERS[0], 3).priority).toBe(3);
  });

  it('renders the safety warning, actual reason, and explicit unchecked acknowledgement', () => {
    const html = renderToStaticMarkup(<SafetyOverrideConfirmation escalationReason={hardCaller.escalationReason}
      confirmed={false} onConfirm={() => {}} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('escalated to Priority 0 by a safety rule');
    expect(html).toContain(hardCaller.escalationReason);
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain('checked=""');
    expect(html).toContain('explicitly confirm this downgrade');
  });
});

describe('Case outcomes', () => {
  it.each(['no_answer', 'needs_followup'] as CallOutcome[])('%s stays active with a follow-up history entry', outcome => {
    const { callerPatch, logEntry } = recordOutcome(outcome);
    const caller = { ...hardCaller, ...callerPatch };
    expect(TERMINAL_STATUSES).not.toContain(caller.status);
    expect(sortCallers([caller])).toHaveLength(1);
    expect(logEntry.type).toBe('followup_required');
    expect(logEntry.label).not.toContain('Case closed');
    expect(logEntry.detail).toContain('requires future follow-up');
  });

  it.each(['resolved', 'referred'] as CallOutcome[])('%s closes the case', outcome => {
    const { callerPatch, logEntry } = recordOutcome(outcome);
    expect(TERMINAL_STATUSES).toContain(callerPatch.status);
    expect(logEntry.type).toBe('case_closed');
    expect(logEntry.label).toContain('Case closed');
  });
});

describe('Repeat contact and override history', () => {
  it('updates calculated priority while preserving the active override and prior history', () => {
    const initial = override(DISASTER_CALLERS[5], 2, 'Operator has additional context');
    const repeated = simulateRepeatContact(initial, { facilitySignals: ['immediate_life_threat'], waitMinutes: 30,
      language: 'Spanish', locationDetail: 'New location', needDescription: 'Updated need' }, 'New danger reported');
    expect(repeated).toMatchObject({ calculatedPriority: 0, priority: 2, overridePriority: 2, hardEscalation: true,
      manualPriority: true, manualPriorityReason: initial.manualPriorityReason, overrideTimestamp: initial.overrideTimestamp,
      overrideOperatorId: initial.overrideOperatorId, attempts: initial.attempts + 1, waitMinutes: 30,
      language: 'Spanish', location: 'New location', needSummary: 'Updated need' });
    expect(repeated.activityLog.slice(0, -1)).toEqual(initial.activityLog);
    expect(repeated.activityLog.at(-1)).toMatchObject({ previousCalculatedPriority: initial.calculatedPriority,
      calculatedPriority: 0, previousPriority: 2, newPriority: 2 });
    expect(repeated.activityLog.at(-1)!.detail).toContain('Human override remains active');
    expect(modal(repeated)).toContain('Latest engine calculation: Priority 0');
    expect(modal(repeated)).toContain('Active human override: Priority 2');
    expect(initial.calculatedPriority).toBe(3);
  });

  it('uses new calculated priority when no human override is active and retains successive calculations', () => {
    const initial = DISASTER_CALLERS[5];
    const first = simulateRepeatContact(initial, { facilitySignals: ['welfare_check_needed'] }, 'Welfare concern');
    const second = simulateRepeatContact(first, { facilitySignals: ['immediate_life_threat'] }, 'Immediate threat');
    expect(first.priority).toBe(first.calculatedPriority);
    expect(second.priority).toBe(0);
    expect(second.engineInput!.attempts).toBe(initial.attempts + 2);
    expect(second.engineInput!.facilitySignals).toEqual(['welfare_check_needed', 'immediate_life_threat']);
    expect(second.activityLog.slice(-2).map(e => [e.previousCalculatedPriority, e.calculatedPriority]))
      .toEqual([[initial.calculatedPriority, first.calculatedPriority], [first.calculatedPriority, 0]]);
  });
});

describe('Mock data and score explanations', () => {
  it('keeps all mock historical priority events consistent with calculated output', () => {
    for (const caller of [...DISASTER_CALLERS, ...CLINIC_CALLERS]) {
      expect(caller.calculatedPriority).toBe(scoreCallerInput(caller.engineInput!).priority);
      for (const entry of caller.activityLog.filter(e => e.type === 'priority_changed')) {
        expect(entry.label).toContain(`Priority set to ${caller.calculatedPriority}`);
        expect(entry.detail).toContain(`Priority ${caller.calculatedPriority}`);
      }
    }
    expect(DISASTER_CALLERS[0].calculatedPriority).toBe(1);
    expect(DISASTER_CALLERS[0].activityLog.find(e => e.type === 'sms_sent')!.detail).toContain('Priority: Urgent');
  });

  it('shows actual raw contribution total and the capped final score above 100', () => {
    const caller = DISASTER_CALLERS[1];
    const raw = caller.scoreBreakdown.reduce((sum, b) => sum + b.points, 0);
    expect(raw).toBe(110);
    expect(caller.score).toBe(100);
    const html = modal(caller);
    expect(html).toContain(`Raw score: <span class="text-white">${raw}</span>`);
    expect(html).toContain('Final score: <span class="text-white">100</span> (capped at 100)');
  });

  it('explains the lower bound when negative contributions produce a zero final score', () => {
    const html = modal(DISASTER_CALLERS[5]);
    expect(html).toContain('Raw score: <span class="text-white">-10</span>');
    expect(html).toContain('Final score: <span class="text-white">0</span> (floored at 0)');
  });
});

describe('Independent mode state', () => {
  it('same-mode clicks preserve state and switching back preserves each mode’s edits and history', () => {
    let state: CaseState = { rulebook: 'disaster', callersByMode: { disaster: [...DISASTER_CALLERS], clinic: [...CLINIC_CALLERS] } };
    const { callerPatch, logEntry } = applyHumanOverride(DISASTER_CALLERS[0], 2, 'Reviewed');
    state = caseReducer(state, { type: 'patch', rulebook: 'disaster', id: DISASTER_CALLERS[0].id, patch: callerPatch, logEntry });
    const disaster = state.callersByMode.disaster;
    expect(caseReducer(state, { type: 'switch_mode', rulebook: 'disaster' })).toBe(state);
    state = caseReducer(state, { type: 'switch_mode', rulebook: 'clinic' });
    const outcome = recordOutcome('no_answer');
    state = caseReducer(state, { type: 'patch', rulebook: 'clinic', id: hardCaller.id, patch: outcome.callerPatch, logEntry: outcome.logEntry });
    const clinic = state.callersByMode.clinic;
    state = caseReducer(state, { type: 'switch_mode', rulebook: 'disaster' });
    expect(state.callersByMode.disaster).toBe(disaster);
    expect(state.callersByMode.disaster[0].overridePriority).toBe(2);
    expect(state.callersByMode.disaster[0].activityLog.at(-1)).toEqual(logEntry);
    state = caseReducer(state, { type: 'switch_mode', rulebook: 'clinic' });
    expect(state.callersByMode.clinic).toBe(clinic);
    expect(state.callersByMode.clinic[0].status).toBe('no_answer');
    expect(DISASTER_CALLERS[0].manualPriority).toBe(false);
    expect(hardCaller.status).toBe('awaiting_callback');
  });
});
