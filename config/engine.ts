// ZianeComms — Global Priority Engine Configuration
// Thresholds, caps, and hard-safety rules live here.
// These are NOT scattered throughout the engine or UI code.
// Administrators will eventually edit these through the Agent Setup / Dispatch Rules UI.

import type { Priority } from '@/types';

// ── Priority level definitions ────────────────────────────────────────────────

export const PRIORITY_LABELS: Record<Priority, { label: string; color: string }> = {
  0: { label: 'Critical',  color: 'red'    },
  1: { label: 'Urgent',    color: 'orange' },
  2: { label: 'Moderate',  color: 'yellow' },
  3: { label: 'Standard',  color: 'green'  },
};

// ── Hard-escalation triggers ──────────────────────────────────────────────────
// Any caller matching these signals is immediately assigned Priority 0.
// The numerical score is still calculated and stored for audit purposes.
// The caller stays in the queue — hard escalation never removes anyone.

export const HARD_ESCALATION_SIGNALS = {
  IMMEDIATE_LIFE_THREAT: {
    key: 'immediate_life_threat',
    label: 'Immediate threat to life',
    reason: 'Caller reported an immediate threat to life or severe immediate danger.',
  },
  AGENT_DIRECTED_911: {
    key: 'agent_directed_911',
    label: 'Agent directed caller to 911',
    reason: 'The voice agent determined this caller required emergency services and provided 911 guidance.',
  },
} as const;

// ── Category caps ─────────────────────────────────────────────────────────────
// Access Difficulty must never overpower serious need.
// Cap is enforced by the engine — NOT by each rulebook individually.

export const CATEGORY_CAPS = {
  access: 15,        // Access Difficulty max contribution
  context: 25,       // Context max (matches active_danger points)
  agentOutcome: 20,  // Agent Outcome max positive contribution
  // 'need' and 'facility' are uncapped — they represent the core safety signal
} as const;

// ── Score → Priority mapping ──────────────────────────────────────────────────
// Default thresholds used when a rulebook doesn't override them.
// Rulebooks CAN set their own thresholds via priorityThresholds.

export const DEFAULT_PRIORITY_THRESHOLDS = {
  urgent:   70,   // score >= 70 → Priority 1
  moderate: 35,   // score >= 35 → Priority 2 (else Priority 3)
} as const;

// ── Access difficulty scoring defaults ───────────────────────────────────────
// Rulebooks override these values in their accessSignals config.

export const DEFAULT_ACCESS_SIGNALS = {
  attempts5plus:       10,
  attempts3plus:       7,
  longWait:            5,
  longWaitMinutes:     15,
  previouslyAbandoned: 5,
} as const;
