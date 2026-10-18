// ZianeComms — core domain types
// Backend-agnostic: mock data today, FastAPI + Supabase later.

export type Rulebook = 'disaster' | 'clinic';

/** 0 = Critical (red), 1 = Urgent (orange), 2 = Moderate (yellow), 3 = Standard (green) */
export type Priority = 0 | 1 | 2 | 3;

export type CallerStatus =
  | 'awaiting_callback'
  | 'calling'
  | 'resolved'
  | 'referred'
  | 'no_answer'
  | 'needs_followup'
  | 'duplicate'
  | 'unable_to_reach';

export type CallOutcome =
  | 'resolved'
  | 'referred'
  | 'no_answer'
  | 'needs_followup'
  | 'duplicate'
  | 'unable_to_reach';

export type NeedCategory =
  | 'medical_equipment'
  | 'evacuation'
  | 'shelter'
  | 'welfare_check'
  | 'mobility_issue'
  | 'outage_information'
  | 'general_disaster'
  | 'severe_pain'
  | 'urgent_symptoms'
  | 'prescription'
  | 'new_patient'
  | 'appointment'
  | 'cleaning'
  | 'billing'
  | 'other';

export type NavPage =
  | 'dashboard'
  | 'agent_setup'
  | 'knowledge_base'
  | 'responders'
  | 'dispatch_rules'
  | 'settings';

// ── Scoring categories ────────────────────────────────────────────────────────

/** The five buckets that compose a priority score. */
export type ScoreCategory =
  | 'need'          // Need Severity
  | 'context'       // Situational context (zone, proximity)
  | 'access'        // Access difficulty (attempts, wait)
  | 'agentOutcome'  // What the automation already did
  | 'facility';     // Facility-specific rules

// ── Score breakdown ───────────────────────────────────────────────────────────

export interface ScoreBreakdown {
  label: string;
  points: number;
  reason: string;
  category: ScoreCategory;
}

// ── Engine input ──────────────────────────────────────────────────────────────

/** Everything the engine needs to produce a score.
 *  Store this on the Caller so repeat calls can re-score with updated data. */
export interface EngineInput {
  needCategory: NeedCategory;
  needDescription: string;          // free-text label for the queue row
  waitMinutes: number;
  attempts: number;
  language: string;
  locationZone: LocationZone;       // structured — replaces free-text location
  locationDetail: string;           // human-readable address / area description
  agentOutcome: AgentOutcome;
  callerMessage: string;
  facilitySignals: string[];        // list of signal keys from the rulebook
  rulebook: Rulebook;
}

/** Structured location context — designed to be replaceable with real geo data. */
export type LocationZone =
  | 'active_danger'      // inside active danger / mandatory evacuation zone
  | 'near_danger'        // close to zone boundary
  | 'affected_area'      // broader affected area
  | 'outside'            // outside all affected areas
  | 'unknown';           // not determined

/** What the voice agent determined during the automated interaction. */
export type AgentOutcome =
  | 'directed_to_911'        // → hard Priority 0
  | 'possible_danger'        // uncertain — +20
  | 'could_not_resolve'      // automation failed — +15
  | 'caller_unsatisfied'     // caller says answer didn't help — +15
  | 'caller_requested_human' // caller explicitly asked for human — +10
  | 'resolved'               // successfully answered — -10
  | 'caller_confirmed_resolved' // caller confirmed resolved → candidate for closure
  | 'unknown';

// ── Questionnaire ─────────────────────────────────────────────────────────────

export interface QuestionnaireAnswer {
  question: string;
  answer: string;
}

// ── Activity log ──────────────────────────────────────────────────────────────

export type ActivityType =
  | 'operator_note'
  | 'data_corrected'
  | 'recovery_chat'
  | 'sms_received'
  | 'sms_sent'
  | 'questionnaire_sent'
  | 'questionnaire_completed'
  | 'form_sent'
  | 'form_completed'
  | 'info_provided'
  | 'told_call_911'
  | 'callback_requested'
  | 'priority_changed'
  | 'responder_assigned'
  | 'call_attempted'
  | 'case_closed'
  | 'followup_required'
  | 'priority_recalculated'
  | 'recommendation_shown'
  | 'call_received'
  | 'conversation_completed'
  | 'human_followup_requested'
  | 'priority_calculated';

export interface ActivityEntry {
  id: string;
  type: ActivityType;
  timestamp: string; // ISO
  label: string;
  detail?: string;
  operatorId?: string;
  previousPriority?: Priority;
  newPriority?: Priority;
  previousCalculatedPriority?: Priority;
  calculatedPriority?: Priority;
  reason?: string;
  safetyDowngradeConfirmed?: boolean;
  retell?: { callId: string; agentId: string; event: string; status: string };
  questionnaireChange?: { previous: QuestionnaireAnswer[]; current: QuestionnaireAnswer[] };
  dispatch?: DispatchAudit;

}

// ── Responder ─────────────────────────────────────────────────────────────────

export type ResponderStatus = 'available' | 'busy' | 'offline';
export type ExpertiseTag = 'medical_support' | 'welfare_check' | 'evacuation' | 'shelter' |
  'mobility_support' | 'prescription' | 'appointments' | 'billing' | 'general_crisis';
export type LanguageTag = 'en' | 'es' | 'hi' | 'ko' | 'zh' | 'ar' | 'fr';
export type CoverageArea = 'eastside' | 'central' | 'north' | 'west' | 'riverside';
export type ExperienceTag = 'emergency_medical' | 'welfare_visits' | 'evacuation_operations' |
  'shelter_operations' | 'mobility_assistance' | 'medication_coordination' | 'patient_intake' | 'billing_support';

export interface Responder {
  organizationId?: string;
  deploymentId?: import('@/config/deployments').DeploymentId;
  id: string;
  name: string;
  role: string;
  status: ResponderStatus;
  rulebooks: Rulebook[];
  expertise: ExpertiseTag[];
  languages: LanguageTag[];
  interpreterLanguages: LanguageTag[]; // explicitly approved support only
  location: string;
  coverageAreas: CoverageArea[];
  experience: ExperienceTag[];
  activeCallers: number; // derived from assigned active cases
  assignedCaseIds: string[]; // active assignments only
}

export type MatchFactor = 'expertise' | 'language' | 'location' | 'workload' | 'experience';
export interface MatchBreakdown {
  factor: MatchFactor;
  points: number;
  maxPoints: number;
  reason: string;
}
export interface ResponderMatch {
  responderId: string;
  status: ResponderStatus;
  eligible: boolean; // available primary candidate; busy is an alternative only
  rawScore: number;
  activeCases: number;
  breakdown: MatchBreakdown[];
  explanation: string;
  strongMatch: boolean;
}
export interface MatchingResult {
  configVersion: string;
  candidates: ResponderMatch[];
  recommendedResponderId?: string;
  bestExpertiseResponderId?: string;
  strongAvailableMatch: boolean;
  explanation: string;
}
export interface RecommendationSnapshot {
  id: string;
  shownAt: string;
  signature: string;
  callerPriority: Priority;
  result: MatchingResult;
}
export interface DispatchAudit {
  recommendation?: RecommendationSnapshot;
  selectedResponderId?: string;
  previousResponderId?: string;
  followedRecommendation?: boolean;
  selectedWorkloadBefore?: number;
  selectedWorkloadAfter?: number;
  previousWorkloadBefore?: number;
  previousWorkloadAfter?: number;
  callerPriority: Priority;
  responseTimeMs?: number; // interval from latest assignment to this callback attempt
  outcome?: CallOutcome;
}

// ── Customer Fit (separate from urgency/safety priority) ──────────────────────

export interface CustomerFitResult {
  score: number;               // 0–100
  label: string;               // e.g. "High", "Medium", "Low"
  reasons: CustomerFitReason[];
}

export interface CustomerFitReason {
  label: string;
  points: number;
  reason: string;
}

// ── Caller ────────────────────────────────────────────────────────────────────

export interface Caller {
  organizationId?: string;
  id: string;
  source?: 'retell' | 'offline_help_form';
  deploymentId?: import('@/config/deployments').DeploymentId;
  provenance?: 'integration_test'|'seed_demo'|'live';
  // Read-only projection of the durable recovery claim; not accepted as writable case data.
  recoveryState?: {callId:string;provider:string;state:string;hasSession:boolean;ended:boolean;analyzed:boolean;pendingTurn:boolean};
  retell?: { callId: string; agentId: string; event: string; status: string; startedAt: string; endedAt: string; analysisPending: boolean; disconnectionReason?: string; callSuccessful?: boolean;
    outcomes?: { emergencyGuidanceProvided: boolean | null; humanRequested: boolean | null; unresolvedNeed: boolean | null; automationResolvedRequest: boolean | null } };
  name: string;
  phone: string;            // persisted/browser values are masked; real contacts stay encrypted server-side

  // ── Effective priority (what the system and humans agree on) ──
  priority: Priority;       // effective priority (human override if set, else calculated)

  // ── Engine output — NEVER overwritten by human override ───────
  calculatedPriority: Priority;
  hardEscalation: boolean;
  escalationReason?: string;  // e.g. "Agent directed caller to 911"
  score: number;
  scoreBreakdown: ScoreBreakdown[];

  // ── Human override — stored alongside engine output ────────────
  manualPriority: boolean;
  manualPriorityReason?: string;
  overridePriority?: Priority; // active human selection, separate from latest engine output
  originalCalculatedPriority?: Priority; // snapshot at time of override
  overrideTimestamp?: string;
  overrideOperatorId?: string;           // future: real operator ID

  // ── Customer Fit (clinic only in V1) ──────────────────────────
  customerFit?: CustomerFitResult;

  // ── Engine input — stored for repeat-caller re-scoring ────────
  engineInput?: EngineInput;

  // ── Case data ────────────────────────────────────────────────
  status: CallerStatus;
  needCategory: NeedCategory;
  needSummary: string;
  callerMessage: string;
  aiSummary: string;
  questionnaire: QuestionnaireAnswer[];
  activityLog: ActivityEntry[];

  // ── Demographics / context ───────────────────────────────────
  waitMinutes: number;
  attempts: number;
  language: string;
  location: string;
  rulebook: Rulebook;
  assignedResponderId?: string;
  coverageArea?: CoverageArea;
  lastRecommendation?: RecommendationSnapshot;
  assignedAt?: string;
  assignmentRecommendation?: RecommendationSnapshot;

  createdAt: string; // ISO
}

// ── Dashboard metrics ─────────────────────────────────────────────────────────

export interface DashboardMetrics {
  averageWaitMinutes?: number;
  offlineRequests?: number;
  priorityDistribution?: number[];
  incomingCalls: number;
  answeredCalls: number;
  missedCalls: number;
  recoveredCallers: number;
  activeResponders: number;
  awaitingCallback: number;
  priority0Count: number;
  resolvedCases: number;
}

// ── Rulebook config ───────────────────────────────────────────────────────────

export interface FacilitySignalRule {
  key: string;           // e.g. "medical_equipment_dependency"
  label: string;         // human-readable label for explainability
  points: number;
  category: ScoreCategory;
  hardEscalate?: boolean; // if true, triggers Priority 0 regardless of score
  escalationReason?: string;
  reason: string;        // explanation shown in "Why this priority?"
}

export interface RulebookConfig {
  id: Rulebook;
  label: string;
  description: string;
  priorityLabels: Record<Priority, string>;
  // Context zone points — injected into scoring without changing generic engine
  contextPoints: Record<LocationZone, number>;
  // Access difficulty signals (all capped at category cap in engine)
  accessSignals: {
    attempts5plus: number;
    attempts3plus: number;
    longWait: number;
    longWaitMinutes: number;
    previouslyAbandoned: number;
  };
  // Agent outcome adjustments
  agentOutcomePoints: Record<AgentOutcome, number | 'hard_escalate'>;
  // Facility-specific signal rules keyed by signal key
  facilitySignals: Record<string, FacilitySignalRule>;
  // Score → priority thresholds (kept here, NOT scattered in engine)
  priorityThresholds: {
    urgent: number;    // score >= this → Priority 1
    moderate: number;  // score >= this → Priority 2  (else Priority 3)
  };
}
