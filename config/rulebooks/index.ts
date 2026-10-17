// ZianeComms — Rulebook Configurations
// Each rulebook is a complete, standalone configuration for a specific operational context.
// The generic engine reads these — no business logic is embedded in the engine itself.
//
// DISASTER: More complete implementation.
// CLINIC:   Proves the same engine works in normal commercial operations.
//           Weights are DEMO placeholders — not medically validated rules.

import type { RulebookConfig } from '@/types';
import { DEFAULT_PRIORITY_THRESHOLDS } from '@/config/engine';

// ── DISASTER RULEBOOK ─────────────────────────────────────────────────────────

export const DISASTER_RULEBOOK: RulebookConfig = {
  id: 'disaster',
  label: 'Disaster Response',
  description:
    'Prioritizes immediate life-safety, medical needs, and evacuation support during emergency events.',

  priorityLabels: {
    0: 'Critical',
    1: 'Urgent',
    2: 'Moderate',
    3: 'Standard',
  },

  // ── Context: zone proximity points ───────────────────────────────────────
  contextPoints: {
    active_danger: 25,
    near_danger:   15,
    affected_area:  8,
    outside:        0,
    unknown:        0,
  },

  // ── Access difficulty (total capped at 15 by the engine) ─────────────────
  accessSignals: {
    attempts5plus:       10,
    attempts3plus:        7,
    longWait:             5,
    longWaitMinutes:     15,
    previouslyAbandoned:  5,
  },

  // ── Agent outcome adjustments ─────────────────────────────────────────────
  agentOutcomePoints: {
    directed_to_911:           'hard_escalate',
    possible_danger:            20,
    could_not_resolve:          15,
    caller_unsatisfied:         15,
    caller_requested_human:     10,
    resolved:                  -10,
    caller_confirmed_resolved: -10,
    unknown:                     0,
  },

  // ── Facility-specific signals (category: 'facility') ─────────────────────
  facilitySignals: {
    // ── Hard-escalation signals ───────────────────────────────────────────
    immediate_life_threat: {
      key: 'immediate_life_threat',
      label: 'Immediate threat to life',
      points: 0,
      category: 'facility',
      hardEscalate: true,
      escalationReason: 'Caller reported an immediate threat to life or severe immediate danger.',
      reason: 'Any report of immediate danger bypasses numerical scoring.',
    },

    // ── High-severity need signals ────────────────────────────────────────
    medical_equipment_dependency: {
      key: 'medical_equipment_dependency',
      label: 'Medical equipment dependency',
      points: 50,
      category: 'facility',
      reason: 'Caller depends on powered medical equipment (e.g. oxygen, dialysis). Power disruption is life-threatening.',
    },
    person_trapped: {
      key: 'person_trapped',
      label: 'Person trapped or immediate safety risk',
      points: 50,
      category: 'facility',
      reason: 'Caller or reported person is physically trapped or in immediate danger.',
    },
    mobility_vulnerability: {
      key: 'mobility_vulnerability',
      label: 'Mobility or major vulnerability during crisis',
      points: 40,
      category: 'facility',
      reason: 'Mobility limitation or other significant vulnerability prevents self-evacuation during an active crisis.',
    },
    welfare_check_needed: {
      key: 'welfare_check_needed',
      label: 'Welfare check — person unresponsive',
      points: 35,
      category: 'facility',
      reason: 'Caller is reporting concern for a person who is not responding and may need immediate assistance.',
    },
    urgent_evacuation_shelter: {
      key: 'urgent_evacuation_shelter',
      label: 'Urgent evacuation or shelter need',
      points: 30,
      category: 'facility',
      reason: 'Caller has an immediate evacuation or emergency shelter need.',
    },

    // ── Medium-severity need signals ──────────────────────────────────────
    no_transportation: {
      key: 'no_transportation',
      label: 'No transportation available',
      points: 20,
      category: 'facility',
      reason: 'Caller cannot self-evacuate due to lack of transportation.',
    },
    service_problem_human_needed: {
      key: 'service_problem_human_needed',
      label: 'Service problem requiring human assistance',
      points: 20,
      category: 'facility',
      reason: 'Automation could not resolve the request and human intervention is needed.',
    },

    // ── Lower-severity signals ────────────────────────────────────────────
    info_unresolved: {
      key: 'info_unresolved',
      label: 'Information request automation could not resolve',
      points: 10,
      category: 'facility',
      reason: 'Caller needed information that the automated system could not provide.',
    },
  },

  // ── Priority thresholds ───────────────────────────────────────────────────
  priorityThresholds: DEFAULT_PRIORITY_THRESHOLDS,
};

// ── CLINIC RULEBOOK ───────────────────────────────────────────────────────────
//
// ⚠️  IMPORTANT: These weights are DEMO placeholders for software validation.
// They are NOT medically validated and must NOT be used for actual clinical
// triage decisions. Real clinical implementations require medical professional
// review and approval of all weights.

export const CLINIC_RULEBOOK: RulebookConfig = {
  id: 'clinic',
  label: 'Clinic Operations',
  description:
    'Prioritizes acute medical symptoms, urgent prescriptions, and time-sensitive patient needs. ' +
    'NOTE: Demo weights only — not medically validated.',

  priorityLabels: {
    0: 'Critical',
    1: 'Urgent',
    2: 'Time-Sensitive',
    3: 'Routine',
  },

  contextPoints: {
    active_danger:  0,
    near_danger:    0,
    affected_area:  0,
    outside:        0,
    unknown:        0,
  },

  accessSignals: {
    attempts5plus:       10,
    attempts3plus:        7,
    longWait:             5,
    longWaitMinutes:     10,
    previouslyAbandoned:  5,
  },

  agentOutcomePoints: {
    directed_to_911:           'hard_escalate',
    possible_danger:            20,
    could_not_resolve:          15,
    caller_unsatisfied:         15,
    caller_requested_human:     10,
    resolved:                  -10,
    caller_confirmed_resolved: -10,
    unknown:                     0,
  },

  // ── Facility-specific signals ─────────────────────────────────────────────
  // ⚠️  DEMO weights — not medically validated.
  facilitySignals: {
    // ── Hard-escalation ───────────────────────────────────────────────────
    immediate_life_threat: {
      key: 'immediate_life_threat',
      label: 'Immediate threat to life or severe emergency',
      points: 0,
      category: 'facility',
      hardEscalate: true,
      escalationReason: 'Caller reported an immediate life-threatening emergency.',
      reason: 'Any report of immediate danger bypasses numerical scoring.',
    },

    // ── High-severity (DEMO weights) ─────────────────────────────────────
    severe_symptoms: {
      key: 'severe_symptoms',
      label: 'Severe or worsening symptoms',
      points: 48,
      category: 'facility',
      reason: '[DEMO] Caller describes severe or rapidly worsening symptoms.',
    },
    severe_pain: {
      key: 'severe_pain',
      label: 'Severe pain reported',
      points: 45,
      category: 'facility',
      reason: '[DEMO] Caller reports severe pain (7/10 or above on pain scale).',
    },
    swelling_allergic: {
      key: 'swelling_allergic',
      label: 'Swelling or possible allergic reaction',
      points: 42,
      category: 'facility',
      reason: '[DEMO] Caller describes swelling that may indicate allergic reaction or anaphylaxis risk.',
    },

    // ── Medium-severity (DEMO weights) ───────────────────────────────────
    prescription_urgent: {
      key: 'prescription_urgent',
      label: 'Urgent prescription issue',
      points: 28,
      category: 'facility',
      reason: '[DEMO] Caller is out of a regular medication with potential health consequences if not resolved quickly.',
    },
    new_patient_urgent: {
      key: 'new_patient_urgent',
      label: 'New patient with concerning symptoms',
      points: 20,
      category: 'facility',
      reason: '[DEMO] New patient with symptoms requiring prompt evaluation.',
    },

    // ── Routine signals (DEMO weights) ───────────────────────────────────
    appointment_reschedule: {
      key: 'appointment_reschedule',
      label: 'Appointment reschedule request',
      points: 5,
      category: 'facility',
      reason: '[DEMO] Routine appointment change — no urgent medical concern.',
    },
    billing_inquiry: {
      key: 'billing_inquiry',
      label: 'Billing inquiry',
      points: 2,
      category: 'facility',
      reason: '[DEMO] Administrative billing question — no clinical urgency.',
    },
  },

  priorityThresholds: {
    urgent:   65,   // slightly lower than disaster — symptom severity resolves faster
    moderate: 30,
  },
};

// ── Registry ──────────────────────────────────────────────────────────────────

export const RULEBOOKS: Record<string, RulebookConfig> = {
  disaster: DISASTER_RULEBOOK,
  clinic:   CLINIC_RULEBOOK,
};
