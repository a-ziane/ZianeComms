// ZianeComms — Customer Fit Engine
//
// IMPORTANT: Customer Fit is ENTIRELY SEPARATE from the safety/urgency Priority engine.
// A high Customer Fit score NEVER increases urgency priority.
// A low Customer Fit score NEVER reduces urgency priority.
//
// Customer Fit answers: "Is this a caller we can effectively serve, and how well?"
// Priority answers:      "Who needs human attention first for safety/urgency reasons?"
//
// V1: Simple configurable calculation for Clinic mode only.
// Future: Add distance to facility, service availability, workload matching, etc.

import type { CustomerFitResult, CustomerFitReason, Rulebook } from '@/types';

// ── Customer Fit input ────────────────────────────────────────────────────────

export interface CustomerFitInput {
  rulebook: Rulebook;
  isExistingPatient: boolean;
  facilityCanServeNeed: boolean;     // does the facility offer this service?
  patientLanguageSupported: boolean; // does the facility have language support?
  needCategory?: string;             // optional in V1 — will drive service-match logic later
  distanceKm?: number;               // optional — not used in V1 but modelled here
}

// ── Customer Fit configuration (clinic V1) ────────────────────────────────────

const CLINIC_FIT_CONFIG = {
  existingPatient:         { points: 30, reason: 'Existing patient — facility already has records and context.' },
  newPatient:              { points: 15, reason: 'New patient — acquisition opportunity, slightly less fit context.' },
  facilityCanServe:        { points: 40, reason: 'Facility offers the service being requested.' },
  facilityCannotServe:     { points:  0, reason: 'Facility does not offer this service — likely referral needed.' },
  languageSupported:       { points: 20, reason: 'Patient language is supported by facility staff.' },
  languageNotSupported:    { points:  5, reason: 'Patient language requires external interpreter support.' },
  // Distance scoring (placeholder — not active in V1)
  distanceNear:            { points: 10, reason: 'Patient is within easy travel distance.' },
  distanceFar:             { points:  2, reason: 'Patient is far from facility — may prefer closer provider.' },
} as const;

function labelFromScore(score: number): string {
  if (score >= 80) return 'Excellent Fit';
  if (score >= 60) return 'Good Fit';
  if (score >= 40) return 'Moderate Fit';
  return 'Low Fit';
}

// ── Main Customer Fit function ────────────────────────────────────────────────

export function calculateCustomerFit(input: CustomerFitInput): CustomerFitResult {
  if (input.rulebook !== 'clinic') {
    // Customer Fit not calculated for non-clinic rulebooks in V1
    return { score: 0, label: 'N/A', reasons: [] };
  }

  const reasons: CustomerFitReason[] = [];
  let score = 0;

  // Existing vs new patient
  if (input.isExistingPatient) {
    const cfg = CLINIC_FIT_CONFIG.existingPatient;
    reasons.push({ label: 'Existing patient', points: cfg.points, reason: cfg.reason });
    score += cfg.points;
  } else {
    const cfg = CLINIC_FIT_CONFIG.newPatient;
    reasons.push({ label: 'New patient', points: cfg.points, reason: cfg.reason });
    score += cfg.points;
  }

  // Service availability
  if (input.facilityCanServeNeed) {
    const cfg = CLINIC_FIT_CONFIG.facilityCanServe;
    reasons.push({ label: 'Service available', points: cfg.points, reason: cfg.reason });
    score += cfg.points;
  } else {
    reasons.push({
      label: 'Service not available',
      points: 0,
      reason: CLINIC_FIT_CONFIG.facilityCannotServe.reason,
    });
  }

  // Language support
  if (input.patientLanguageSupported) {
    const cfg = CLINIC_FIT_CONFIG.languageSupported;
    reasons.push({ label: 'Language supported', points: cfg.points, reason: cfg.reason });
    score += cfg.points;
  } else {
    const cfg = CLINIC_FIT_CONFIG.languageNotSupported;
    reasons.push({ label: 'Language requires interpreter', points: cfg.points, reason: cfg.reason });
    score += cfg.points;
  }

  const finalScore = Math.min(score, 100);
  return {
    score: finalScore,
    label: labelFromScore(finalScore),
    reasons,
  };
}
