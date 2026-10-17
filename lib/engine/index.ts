// ZianeComms — Generic Priority Engine
//
// Deterministic. Configurable. Explainable.
// No LLM. No ML. No external calls.
//
// Architecture:
//   PriorityScore = Need Severity (facility signals)
//                 + Context (zone proximity)
//                 + Access Difficulty (attempts, wait) — CAPPED at 15
//                 + Agent Outcome (automation result)
//
// Hard-escalation signals bypass numerical thresholds and set Priority 0.
// The caller stays in the queue regardless — Priority 0 means "first, now".
//
// All scoring decisions produce a ScoreBreakdown entry with a named category
// so the UI can explain exactly why a caller was ranked where they were.

import type {
  EngineInput,
  ScoreBreakdown,
  Priority,
  ScoreCategory,
  AgentOutcome,
} from '@/types';
import { RULEBOOKS } from '@/config/rulebooks';
import { CATEGORY_CAPS } from '@/config/engine';

// ── Engine output ─────────────────────────────────────────────────────────────

export interface EngineResult {
  score: number;
  priority: Priority;
  hardEscalation: boolean;
  escalationReason?: string;
  breakdown: ScoreBreakdown[];
}

// ── Main engine function ──────────────────────────────────────────────────────

export function scoreCallerInput(input: EngineInput): EngineResult {
  const rulebook = RULEBOOKS[input.rulebook] ?? RULEBOOKS['disaster'];
  const breakdown: ScoreBreakdown[] = [];
  let rawScore = 0;
  let hardEscalation = false;
  let escalationReason: string | undefined;

  // ── 1. FACILITY SIGNALS ───────────────────────────────────────────────────
  // These represent Need Severity plus facility-specific rules.
  // Hard-escalation signals are checked first.

  for (const signalKey of input.facilitySignals) {
    const rule = rulebook.facilitySignals[signalKey];
    if (!rule) continue;

    if (rule.hardEscalate) {
      hardEscalation = true;
      escalationReason = rule.escalationReason ?? rule.reason;
      breakdown.push({
        label: rule.label,
        points: 0,
        reason: rule.reason,
        category: 'facility',
      });
      // Don't stop scoring — we still build a full breakdown for the audit log
    } else {
      breakdown.push({
        label: rule.label,
        points: rule.points,
        reason: rule.reason,
        category: rule.category,
      });
      rawScore += rule.points;
    }
  }

  // ── 2. CONTEXT ────────────────────────────────────────────────────────────
  // Zone proximity — capped by the config value for this category.

  const contextPoints = rulebook.contextPoints[input.locationZone] ?? 0;
  if (contextPoints > 0) {
    const capped = Math.min(contextPoints, CATEGORY_CAPS.context);
    const zoneLabels: Record<string, string> = {
      active_danger: 'Inside active danger / evacuation zone',
      near_danger:   'Near active danger zone',
      affected_area: 'Inside broadly affected area',
    };
    breakdown.push({
      label: zoneLabels[input.locationZone] ?? `Location zone: ${input.locationZone}`,
      points: capped,
      reason: `${input.locationDetail} — classified as zone: ${input.locationZone}`,
      category: 'context',
    });
    rawScore += capped;
  }

  // ── 3. ACCESS DIFFICULTY ──────────────────────────────────────────────────
  // Represents how hard it was for the caller to reach the service.
  // CAPPED at CATEGORY_CAPS.access — must never overpower serious need.

  let accessTotal = 0;
  const acc = rulebook.accessSignals;

  if (input.attempts >= 5) {
    const pts = Math.min(acc.attempts5plus, CATEGORY_CAPS.access);
    breakdown.push({
      label: 'Five or more call attempts',
      points: pts,
      reason: `Called ${input.attempts} times — strong urgency signal.`,
      category: 'access',
    });
    accessTotal += pts;
  } else if (input.attempts >= 3) {
    breakdown.push({
      label: 'Repeated call attempts',
      points: acc.attempts3plus,
      reason: `Called ${input.attempts} times — indicates persistence and urgency.`,
      category: 'access',
    });
    accessTotal += acc.attempts3plus;
  }

  if (input.waitMinutes >= acc.longWaitMinutes) {
    breakdown.push({
      label: 'Long wait before abandoning',
      points: acc.longWait,
      reason: `Waited ${input.waitMinutes} min before hanging up — indicates genuine need.`,
      category: 'access',
    });
    accessTotal += acc.longWait;
  }

  // Enforce the category cap
  if (accessTotal > CATEGORY_CAPS.access) {
    const excess = accessTotal - CATEGORY_CAPS.access;
    // Reduce last access entry so total = cap
    const lastAccessIdx = breakdown.map(b => b.category).lastIndexOf('access');
    if (lastAccessIdx >= 0) {
      breakdown[lastAccessIdx] = {
        ...breakdown[lastAccessIdx],
        points: breakdown[lastAccessIdx].points - excess,
      };
    }
    accessTotal = CATEGORY_CAPS.access;
  }
  rawScore += accessTotal;

  // ── 4. AGENT OUTCOME ──────────────────────────────────────────────────────
  // What happened during the automated interaction.

  const outcomeConfig = rulebook.agentOutcomePoints[input.agentOutcome as AgentOutcome];

  if (outcomeConfig === 'hard_escalate') {
    hardEscalation = true;
    escalationReason = escalationReason ?? 'Agent directed caller to call 911.';
    breakdown.push({
      label: 'Agent directed caller to 911',
      points: 0,
      reason: 'Voice agent determined this caller required emergency services — hard escalation to Priority 0.',
      category: 'agentOutcome',
    });
  } else if (typeof outcomeConfig === 'number' && outcomeConfig !== 0) {
    const capped = outcomeConfig > 0
      ? Math.min(outcomeConfig, CATEGORY_CAPS.agentOutcome)
      : outcomeConfig;  // negative adjustments are not capped

    const outcomeLabels: Record<AgentOutcome, string> = {
      directed_to_911:           'Agent directed caller to 911',
      possible_danger:           'Agent detected possible danger (uncertain)',
      could_not_resolve:         'Automation could not resolve request',
      caller_unsatisfied:        'Caller reports automated answer did not help',
      caller_requested_human:    'Caller explicitly requested human assistance',
      resolved:                  'Automation successfully resolved request',
      caller_confirmed_resolved: 'Caller confirmed issue resolved',
      unknown:                   'Agent outcome unknown',
    };
    const outcomeReasons: Record<AgentOutcome, string> = {
      directed_to_911:           'Hard escalation — emergency detected.',
      possible_danger:           'Agent flagged possible risk but with uncertain confidence — human review needed.',
      could_not_resolve:         'Automated system was unable to answer this caller\'s request.',
      caller_unsatisfied:        'Caller indicated the automated response did not resolve their situation.',
      caller_requested_human:    'Caller specifically asked to speak with a human operator.',
      resolved:                  'Voice agent successfully answered the request — lower callback urgency.',
      caller_confirmed_resolved: 'Caller confirmed the situation is resolved — callback may not be needed.',
      unknown:                   'No outcome signal was captured from the automated interaction.',
    };

    breakdown.push({
      label: outcomeLabels[input.agentOutcome as AgentOutcome] ?? `Agent outcome: ${input.agentOutcome}`,
      points: capped,
      reason: outcomeReasons[input.agentOutcome as AgentOutcome] ?? '',
      category: 'agentOutcome',
    });
    rawScore += capped;
  }

  // ── 5. DETERMINE PRIORITY ─────────────────────────────────────────────────

  const finalScore = Math.min(Math.max(rawScore, 0), 100);

  let priority: Priority;
  if (hardEscalation) {
    priority = 0;
  } else {
    const thresholds = rulebook.priorityThresholds;
    if (finalScore >= thresholds.urgent) {
      priority = 1;
    } else if (finalScore >= thresholds.moderate) {
      priority = 2;
    } else {
      priority = 3;
    }
  }

  return {
    score: finalScore,
    priority,
    hardEscalation,
    escalationReason,
    breakdown,
  };
}

// ── Human override helper ─────────────────────────────────────────────────────
// Call this when an operator changes the priority.
// Returns a partial Caller patch that:
//   - records the override without destroying the calculated priority
//   - adds an activity log entry
//   - preserves the original calculated value

import type { Caller, ActivityEntry } from '@/types';

export function requiresSafetyConfirmation(caller: Caller, newPriority: Priority): boolean {
  return caller.hardEscalation && newPriority > 0;
}

export function applyHumanOverride(
  caller: Caller,
  newPriority: Priority,
  reason: string,
  operatorId = 'operator-mock-001',
  safetyDowngradeConfirmed = false,
): { callerPatch: Partial<Caller>; logEntry: ActivityEntry } {
  if (!reason.trim()) throw new Error('An override reason is required.');
  if (!operatorId.trim()) throw new Error('An operator ID is required.');
  if (requiresSafetyConfirmation(caller, newPriority) && !safetyDowngradeConfirmed) {
    throw new Error('Explicit confirmation is required to downgrade a safety escalation.');
  }
  reason = reason.trim();
  const logEntry: ActivityEntry = {
    id: `log-override-${Date.now()}`,
    type: 'priority_changed',
    timestamp: new Date().toISOString(),
    label: `Priority changed: ${caller.priority} → ${newPriority} (human override)`,
    detail:
      `Operator override. Previous effective priority: ${caller.priority}. Calculated priority: ${caller.calculatedPriority}. ` +
      `New priority: ${newPriority}. Reason: ${reason}. Operator: ${operatorId}.` +
      (requiresSafetyConfirmation(caller, newPriority) ? ` Safety downgrade explicitly confirmed. Safety rule: ${caller.escalationReason ?? 'Hard safety escalation'}.` : ''),
    operatorId,
    previousPriority: caller.priority,
    newPriority,
    calculatedPriority: caller.calculatedPriority,
    reason,
    safetyDowngradeConfirmed: requiresSafetyConfirmation(caller, newPriority) && safetyDowngradeConfirmed,
  };

  return {
    callerPatch: {
      priority:                  newPriority,
      manualPriority:            true,
      overridePriority:          newPriority,
      manualPriorityReason:      reason,
      originalCalculatedPriority: caller.calculatedPriority,
      overrideTimestamp:         logEntry.timestamp,
      overrideOperatorId:        operatorId,
    },
    logEntry,
  };
}

// ── Repeat-caller re-score helper ─────────────────────────────────────────────
// When the same caller contacts the system again with more information,
// merge the new input with what we know and re-score.
// Returns a full EngineResult — the caller's priority is updated but
// the full previous history is preserved.

export function rescoreRepeatedCaller(
  existingEngineInput: EngineInput,
  newSignals: Partial<EngineInput>,
): EngineResult {
  const mergedInput = mergeRepeatInput(existingEngineInput, newSignals);
  return scoreCallerInput(mergedInput);
}

export function mergeRepeatInput(existingEngineInput: EngineInput, newSignals: Partial<EngineInput>): EngineInput {
  return {
    ...existingEngineInput,
    ...newSignals,
    // Attempts always accumulate
    attempts: (existingEngineInput.attempts ?? 0) + (newSignals.attempts ?? 1),
    // Merge facility signals (union — new info adds to existing)
    facilitySignals: Array.from(new Set([
      ...existingEngineInput.facilitySignals,
      ...(newSignals.facilitySignals ?? []),
    ])),
  };
}

// ── Sort helper ───────────────────────────────────────────────────────────────
// Priority 0 first → 3 last. Within same priority, higher score first.
// Hard escalations within Priority 0 are surfaced first.

import type { Caller as CallerType } from '@/types';

export function sortCallers(callers: CallerType[]): CallerType[] {
  return [...callers].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    // Within same priority: hard escalations first
    if (a.hardEscalation !== b.hardEscalation) return a.hardEscalation ? -1 : 1;
    return b.score - a.score;
  });
}

// ── Phone masking (display utility) ──────────────────────────────────────────

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length >= 7) {
    return `(***) ***-${digits.slice(-4)}`;
  }
  return '***-****';
}
