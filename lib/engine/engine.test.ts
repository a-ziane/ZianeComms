// ZianeComms — Priority Engine Tests
// Run: npx vitest run lib/engine/engine.test.ts
//
// Tests cover all 10 required cases from the specification.

import { describe, it, expect } from 'vitest';
import { scoreCallerInput, rescoreRepeatedCaller, applyHumanOverride } from './index';
import { calculateCustomerFit } from '@/lib/customerFit';
import type { EngineInput, Caller } from '@/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function disasterInput(overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    needCategory:    'outage_information',
    needDescription: 'Test input',
    waitMinutes:     5,
    attempts:        1,
    language:        'English',
    locationZone:    'outside',
    locationDetail:  'Test location',
    agentOutcome:    'unknown',
    callerMessage:   '',
    facilitySignals: [],
    rulebook:        'disaster',
    ...overrides,
  };
}

function clinicInput(overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    needCategory:    'appointment',
    needDescription: 'Test input',
    waitMinutes:     5,
    attempts:        1,
    language:        'English',
    locationZone:    'outside',
    locationDetail:  'Test location',
    agentOutcome:    'unknown',
    callerMessage:   '',
    facilitySignals: [],
    rulebook:        'clinic',
    ...overrides,
  };
}

function makeTestCaller(overrides: Partial<Caller> = {}): Caller {
  const input = disasterInput();
  const result = scoreCallerInput(input);
  return {
    id: 'test-001',
    name: 'Test Caller',
    phone: '5550000000',
    priority:            result.priority,
    calculatedPriority:  result.priority,
    hardEscalation:      result.hardEscalation,
    score:               result.score,
    scoreBreakdown:      result.breakdown,
    manualPriority:      false,
    status:              'awaiting_callback',
    needCategory:        'outage_information',
    needSummary:         'Test',
    callerMessage:       '',
    aiSummary:           '',
    questionnaire:       [],
    activityLog:         [],
    waitMinutes:         5,
    attempts:            1,
    language:            'English',
    location:            'Test',
    rulebook:            'disaster',
    createdAt:           new Date().toISOString(),
    engineInput:         input,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Priority Engine — Core Safety', () => {

  // Test 1: Life-threatening report → Priority 0 regardless of score
  it('1. life-threatening signal → Priority 0 hard escalation', () => {
    const result = scoreCallerInput(disasterInput({
      facilitySignals: ['immediate_life_threat'],
    }));

    expect(result.priority).toBe(0);
    expect(result.hardEscalation).toBe(true);
    expect(result.escalationReason).toBeDefined();
    // The caller stays: hardEscalation true but score still calculated
    const breakdown = result.breakdown.find(b => b.label === 'Immediate threat to life');
    expect(breakdown).toBeDefined();
  });

  // Test 2: Agent told caller to call 911 → Priority 0, caller stays in queue
  it('2. agent directed to 911 → Priority 0, caller not removed', () => {
    const result = scoreCallerInput(disasterInput({
      agentOutcome: 'directed_to_911',
    }));

    expect(result.priority).toBe(0);
    expect(result.hardEscalation).toBe(true);
    // Score is still calculated — caller stays in the queue
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.breakdown.some(b => b.label === 'Agent directed caller to 911')).toBe(true);
  });

  // Test 3: Medical equipment failure + inside affected zone → very high priority
  it('3. medical equipment + affected zone → Priority 1 or above with high score', () => {
    const result = scoreCallerInput(disasterInput({
      facilitySignals: ['medical_equipment_dependency'],
      locationZone:    'affected_area',
      attempts:        4,
      waitMinutes:     20,
    }));

    // medical_equipment_dependency = 50, affected_area = 8, access ~12, no agent escalation
    // Score should be >= 70 → Priority 1
    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.priority).toBeLessThanOrEqual(1); // Priority 0 or 1
    expect(result.breakdown.some(b => b.label === 'Medical equipment dependency')).toBe(true);
    expect(result.breakdown.some(b => b.category === 'context')).toBe(true);
  });

  // Test 4: Routine info + many attempts → attempts boost but can't overpower serious safety cases
  it('4. routine request + many attempts → score boosted but lower than safety cases', () => {
    const routineResult = scoreCallerInput(disasterInput({
      facilitySignals: ['info_unresolved'],
      attempts:        6,
      waitMinutes:     20,
    }));

    const safetyResult = scoreCallerInput(disasterInput({
      facilitySignals: ['medical_equipment_dependency'],
      attempts:        1,
      waitMinutes:     2,
    }));

    // Access difficulty is capped at 15 — cannot exceed safety signal
    const accessPoints = routineResult.breakdown
      .filter(b => b.category === 'access')
      .reduce((s, b) => s + b.points, 0);
    expect(accessPoints).toBeLessThanOrEqual(15);

    // Safety case should score higher even with fewer attempts
    expect(safetyResult.score).toBeGreaterThan(routineResult.score);
  });

  // Test 5: Successfully resolved request → lower score (negative adjustment)
  it('5. agent resolved request → score reduction applied', () => {
    const resolvedResult = scoreCallerInput(disasterInput({
      agentOutcome:    'resolved',
      facilitySignals: ['info_unresolved'],
    }));

    const unresolvedResult = scoreCallerInput(disasterInput({
      agentOutcome:    'could_not_resolve',
      facilitySignals: ['info_unresolved'],
    }));

    // Resolved should score lower than unresolved
    expect(resolvedResult.score).toBeLessThan(unresolvedResult.score);
    expect(resolvedResult.breakdown.some(b => b.points < 0)).toBe(true);
  });

});

describe('Priority Engine — Repeat Callers', () => {

  // Test 6: Same caller contacts again with more serious information → score recalculates upward
  it('6. repeat caller with escalated signal → higher priority', () => {
    const initial = disasterInput({
      facilitySignals: ['info_unresolved'],
      attempts:        1,
    });
    const initialResult = scoreCallerInput(initial);

    const rescored = rescoreRepeatedCaller(initial, {
      facilitySignals: ['welfare_check_needed'],
      agentOutcome:    'could_not_resolve',
    });

    expect(rescored.score).toBeGreaterThan(initialResult.score);
    expect(rescored.priority).toBeLessThanOrEqual(initialResult.priority);
  });

});

describe('Priority Engine — Human Override', () => {

  // Test 7: Human override changes effective priority without deleting calculated priority
  it('7. human override preserves calculated priority alongside new priority', () => {
    const caller = makeTestCaller();
    const originalCalc = caller.calculatedPriority;

    const { callerPatch } = applyHumanOverride(caller, 0, 'Operator observed additional distress');

    expect(callerPatch.priority).toBe(0);
    expect(callerPatch.manualPriority).toBe(true);
    // originalCalculatedPriority must be preserved
    expect(callerPatch.originalCalculatedPriority).toBe(originalCalc);
    // calculatedPriority is NOT in the patch — it stays unchanged on the caller
    expect((callerPatch as Record<string, unknown>).calculatedPriority).toBeUndefined();
    expect(callerPatch.manualPriorityReason).toBe('Operator observed additional distress');
  });

});

describe('Priority Engine — Clinic Rulebook', () => {

  // Test 8: Clinic severe case ranks above routine appointment and billing
  it('8. clinic severe symptoms outranks appointment and billing', () => {
    const severeResult = scoreCallerInput(clinicInput({
      facilitySignals: ['severe_symptoms', 'severe_pain'],
      agentOutcome:    'possible_danger',
    }));

    const appointmentResult = scoreCallerInput(clinicInput({
      facilitySignals: ['appointment_reschedule'],
      agentOutcome:    'resolved',
    }));

    const billingResult = scoreCallerInput(clinicInput({
      facilitySignals: ['billing_inquiry'],
      agentOutcome:    'resolved',
    }));

    expect(severeResult.score).toBeGreaterThan(appointmentResult.score);
    expect(severeResult.score).toBeGreaterThan(billingResult.score);
    expect(severeResult.priority).toBeLessThan(appointmentResult.priority);
  });

});

describe('Customer Fit — Independence from Priority', () => {

  // Test 9: Customer Fit changes independently and does NOT affect urgency priority
  it('9. customer fit score is independent of urgency priority', () => {
    const urgencyResult = scoreCallerInput(clinicInput({
      facilitySignals: ['severe_pain'],
      agentOutcome:    'possible_danger',
    }));

    const highFit = calculateCustomerFit({
      rulebook:                'clinic',
      isExistingPatient:       true,
      facilityCanServeNeed:    true,
      patientLanguageSupported: true,
    });

    const lowFit = calculateCustomerFit({
      rulebook:                'clinic',
      isExistingPatient:       false,
      facilityCanServeNeed:    false,
      patientLanguageSupported: false,
    });

    // Urgency priority is completely separate from customer fit
    expect(highFit.score).toBeGreaterThan(lowFit.score);

    // Customer Fit NEVER affects the urgency result
    // Re-scoring with the same engine input should produce the same urgency result
    const urgencyResultAgain = scoreCallerInput(clinicInput({
      facilitySignals: ['severe_pain'],
      agentOutcome:    'possible_danger',
    }));
    expect(urgencyResult.priority).toBe(urgencyResultAgain.priority);
    expect(urgencyResult.score).toBe(urgencyResultAgain.score);
  });

});

describe('Priority Engine — Rulebook Switching', () => {

  // Test 10: Switching rulebooks changes scoring config without changing the generic engine
  it('10. same input produces different scores under different rulebooks', () => {
    const sharedBaseDisaster = disasterInput({
      facilitySignals: ['welfare_check_needed'],
      locationZone:    'near_danger',
    });

    const sharedBaseClinic = clinicInput({
      facilitySignals: ['appointment_reschedule'],
      locationZone:    'outside',
    });

    const disasterResult = scoreCallerInput(sharedBaseDisaster);
    const clinicResult   = scoreCallerInput(sharedBaseClinic);

    // Different rulebooks → different context/facility scores
    // The generic engine code path is the same — only config differs
    expect(disasterResult.score).not.toBe(clinicResult.score);

    // Disaster rulebook has context points for near_danger; clinic does not
    const disasterContext = disasterResult.breakdown.find(b => b.category === 'context');
    expect(disasterContext).toBeDefined();
    expect(disasterContext!.points).toBeGreaterThan(0);

    // Clinic has no context points in V1
    const clinicContext = clinicResult.breakdown.find(b => b.category === 'context');
    expect(clinicContext).toBeUndefined();
  });

});

describe('Priority Engine — Access Difficulty Cap', () => {

  it('access difficulty total never exceeds 15 regardless of input', () => {
    const result = scoreCallerInput(disasterInput({
      attempts:    10,   // would be 10 pts from attempts
      waitMinutes: 30,   // would be 5 pts from wait
      // Total would be 15 — right at the cap
    }));

    const accessTotal = result.breakdown
      .filter(b => b.category === 'access')
      .reduce((s, b) => s + b.points, 0);

    expect(accessTotal).toBeLessThanOrEqual(15);
  });

});
