// ZianeComms — Mock caller data
// All callers are now scored through the real priority engine.
// scoreCallerInput() is called inline so the breakdown reflects actual engine output.

import type { Caller, EngineInput, Responder, CoverageArea } from '@/types';
import { scoreCallerInput } from '@/lib/engine';
import { calculateCustomerFit } from '@/lib/customerFit';

// ── Mock Responders ────────────────────────────────────────────────────────────
export const MOCK_RESPONDERS: Responder[] = [
  { id: 'r-001', name: 'Officer Dana Reyes', role: 'Field Responder', status: 'available', rulebooks: ['disaster'],
    expertise: ['welfare_check', 'evacuation', 'mobility_support'], languages: ['en', 'es'], interpreterLanguages: [],
    location: 'Eastside Station', coverageAreas: ['eastside', 'central'], experience: ['welfare_visits', 'evacuation_operations'], activeCallers: 0, assignedCaseIds: [] },
  { id: 'r-002', name: 'Nurse Patel', role: 'Medical Liaison', status: 'available', rulebooks: ['disaster', 'clinic'],
    expertise: ['medical_support', 'prescription'], languages: ['en', 'hi'], interpreterLanguages: ['es', 'ar'],
    location: 'Central Clinic', coverageAreas: ['central', 'eastside'], experience: ['emergency_medical', 'medication_coordination'], activeCallers: 0, assignedCaseIds: [] },
  { id: 'r-003', name: 'Supervisor Kim', role: 'Shift Supervisor', status: 'busy', rulebooks: ['disaster'],
    expertise: ['welfare_check', 'evacuation', 'general_crisis'], languages: ['en', 'ko'], interpreterLanguages: ['es'],
    location: 'Command Center', coverageAreas: ['central', 'riverside'], experience: ['welfare_visits', 'evacuation_operations'], activeCallers: 0, assignedCaseIds: [] },
  { id: 'r-004', name: 'Volunteer Chen', role: 'Community Volunteer', status: 'available', rulebooks: ['disaster'],
    expertise: ['shelter', 'general_crisis'], languages: ['en', 'zh'], interpreterLanguages: [],
    location: 'North Hub', coverageAreas: ['north', 'west'], experience: ['shelter_operations'], activeCallers: 0, assignedCaseIds: [] },
  { id: 'r-005', name: 'Sarah Martinez', role: 'Emergency Medical Responder', status: 'available', rulebooks: ['disaster'],
    expertise: ['medical_support', 'mobility_support', 'shelter'], languages: ['en', 'es'], interpreterLanguages: [],
    location: 'Eastside Medical Post', coverageAreas: ['eastside'], experience: ['emergency_medical', 'mobility_assistance'], activeCallers: 0, assignedCaseIds: [] },
  { id: 'r-006', name: 'Adam Wilson', role: 'Evacuation Specialist', status: 'offline', rulebooks: ['disaster'],
    expertise: ['evacuation', 'shelter', 'mobility_support'], languages: ['en', 'es'], interpreterLanguages: [],
    location: 'Riverside Station', coverageAreas: ['riverside', 'eastside'], experience: ['evacuation_operations', 'shelter_operations'], activeCallers: 0, assignedCaseIds: [] },
  { id: 'r-007', name: 'Sofia Haddad', role: 'Registered Nurse', status: 'busy', rulebooks: ['clinic'],
    expertise: ['medical_support', 'prescription'], languages: ['en', 'ar'], interpreterLanguages: [],
    location: 'Central Clinic', coverageAreas: ['central', 'north'], experience: ['emergency_medical', 'medication_coordination'], activeCallers: 0, assignedCaseIds: [] },
  { id: 'r-008', name: 'James Lee', role: 'Patient Services Coordinator', status: 'available', rulebooks: ['clinic'],
    expertise: ['appointments', 'billing'], languages: ['en', 'ko', 'fr'], interpreterLanguages: ['ar'],
    location: 'West Clinic', coverageAreas: ['west', 'central'], experience: ['patient_intake', 'billing_support'], activeCallers: 0, assignedCaseIds: [] },
  { id: 'r-009', name: 'Lucia Torres', role: 'Pharmacy Coordinator', status: 'available', rulebooks: ['clinic'],
    expertise: ['prescription', 'appointments'], languages: ['en', 'es'], interpreterLanguages: [],
    location: 'Central Clinic', coverageAreas: ['central', 'riverside'], experience: ['medication_coordination', 'patient_intake'], activeCallers: 0, assignedCaseIds: [] },
  { id: 'r-010', name: 'Amira Nasser', role: 'Clinic Physician', status: 'offline', rulebooks: ['clinic'],
    expertise: ['medical_support', 'prescription'], languages: ['en', 'ar', 'fr'], interpreterLanguages: [],
    location: 'North Clinic', coverageAreas: ['north', 'central'], experience: ['emergency_medical'], activeCallers: 0, assignedCaseIds: [] },
];

// Structured demo geography; no parsing of addresses or display strings.
const CALLER_COVERAGE: Record<string, CoverageArea> = {
  'dc-001': 'eastside', 'dc-002': 'central', 'dc-003': 'eastside', 'dc-004': 'riverside', 'dc-005': 'north', 'dc-006': 'west',
  'cc-001': 'central', 'cc-002': 'north', 'cc-003': 'central', 'cc-004': 'central', 'cc-005': 'west', 'cc-006': 'north',
};

// ── Helper: build a Caller from an EngineInput ────────────────────────────────

function makeCaller(
  base: Omit<Caller,
    | 'priority' | 'calculatedPriority' | 'hardEscalation' | 'escalationReason'
    | 'score' | 'scoreBreakdown' | 'engineInput'
    | 'manualPriority' | 'customerFit'
  > & { engineInput: EngineInput; isExistingPatient?: boolean },
): Caller {
  const result = scoreCallerInput(base.engineInput);

  const customerFit = base.engineInput.rulebook === 'clinic'
    ? calculateCustomerFit({
        rulebook: 'clinic',
        isExistingPatient: base.isExistingPatient ?? true,
        facilityCanServeNeed: true,
        patientLanguageSupported: base.engineInput.language.toLowerCase() === 'english',
      })
    : undefined;

  return {
    ...base,
    coverageArea: CALLER_COVERAGE[base.id],
    priority:            result.priority,
    calculatedPriority:  result.priority,
    hardEscalation:      result.hardEscalation,
    escalationReason:    result.escalationReason,
    score:               result.score,
    scoreBreakdown:      result.breakdown,
    engineInput:         base.engineInput,
    manualPriority:      false,
    customerFit,
  };
}

// ── DISASTER CALLERS ──────────────────────────────────────────────────────────

export const DISASTER_CALLERS: Caller[] = [

  makeCaller({
    id: 'dc-001',
    name: 'Maria Gonzalez',
    phone: '5551234567',
    status: 'awaiting_callback',
    needCategory: 'medical_equipment',
    needSummary: 'Power outage affecting home oxygen equipment',
    callerMessage: 'My name is Maria. I am 78 years old. The power has been out since this morning and I need my oxygen machine. Please call me back quickly. I have called several times.',
    aiSummary: 'Elderly Spanish-speaking caller with life-critical medical dependency on home oxygen equipment. Power outage in her zone is directly threatening her safety. Multiple call attempts and extended wait time confirm high urgency. Immediate callback with Spanish-speaking responder strongly recommended.',
    questionnaire: [
      { question: 'Are you currently in a safe location?',                    answer: 'Yes, I am home but without power.' },
      { question: 'Is anyone with you?',                                       answer: 'No, I live alone.' },
      { question: 'Do you have a medical condition requiring electricity?',    answer: 'Yes, I use an oxygen concentrator 24 hours a day.' },
      { question: 'How long have you been without power?',                     answer: 'Since 6 AM this morning, about 8 hours.' },
      { question: 'Do you have backup power?',                                 answer: 'No, I have nothing.' },
      { question: 'What is your preferred language?',                          answer: 'Spanish.' },
    ],
    activityLog: [
      { id: 'al-001-1', type: 'callback_requested',      timestamp: new Date(Date.now() - 25 * 60000).toISOString(), label: 'Callback requested',           detail: 'Caller abandoned after 20 min wait. System detected and queued.' },
      { id: 'al-001-2', type: 'sms_sent',                timestamp: new Date(Date.now() - 24 * 60000).toISOString(), label: 'SMS sent to caller',            detail: 'Hi Maria, this is ZianeComms. We received your call and you are in our callback queue. We will reach you shortly. Priority: Urgent.' },
      { id: 'al-001-3', type: 'questionnaire_sent',      timestamp: new Date(Date.now() - 23 * 60000).toISOString(), label: 'Questionnaire sent via SMS',    detail: 'Standard disaster intake questionnaire sent.' },
      { id: 'al-001-4', type: 'questionnaire_completed', timestamp: new Date(Date.now() - 20 * 60000).toISOString(), label: 'Questionnaire completed',       detail: 'All 6 questions answered. Medical equipment dependency confirmed.' },
      { id: 'al-001-5', type: 'priority_changed',        timestamp: new Date(Date.now() - 20 * 60000).toISOString(), label: 'Priority set to 1 (Urgent)',  detail: 'Engine calculated score 85 from medical equipment dependency, location, attempts, wait, and automation outcome — Priority 1 assigned.' },
    ],
    waitMinutes: 20,
    attempts: 4,
    language: 'Spanish',
    location: 'Eastside — Affected Zone A',
    rulebook: 'disaster',
    createdAt: new Date(Date.now() - 25 * 60000).toISOString(),
    engineInput: {
      needCategory:     'medical_equipment',
      needDescription:  'Power outage affecting home oxygen equipment',
      waitMinutes:      20,
      attempts:         4,
      language:         'Spanish',
      locationZone:     'affected_area',
      locationDetail:   'Eastside — Affected Zone A',
      agentOutcome:     'could_not_resolve',
      callerMessage:    'Oxygen concentrator requires power. Life-critical.',
      facilitySignals:  ['medical_equipment_dependency'],
      rulebook:         'disaster',
    },
  }),

  makeCaller({
    id: 'dc-002',
    name: 'Robert Tran',
    phone: '5559876543',
    status: 'awaiting_callback',
    needCategory: 'welfare_check',
    needSummary: 'Welfare check — elderly neighbor cannot self-evacuate',
    callerMessage: "I'm calling about my neighbor, Mrs. Patterson. She's in her 80s, uses a walker, and she hasn't answered her door. I saw her earlier but now I'm worried. Can someone check on her?",
    aiSummary: 'Caller is reporting concern for an elderly neighbor with mobility limitations located in a mandatory evacuation zone. The neighbor has not responded to door checks. This is a potential welfare emergency requiring in-person verification. Field responder dispatch recommended.',
    questionnaire: [
      { question: 'What is the address of the person you are concerned about?', answer: '42 Maple Street, Evacuation Zone B.' },
      { question: 'When did you last see or speak to them?',                    answer: 'This morning around 9 AM. She was home.' },
      { question: 'Do they have any known medical conditions?',                 answer: 'She uses a walker and I think she has heart issues.' },
      { question: 'Have you contacted anyone else about this?',                 answer: 'No, I tried calling but no one answered.' },
      { question: 'Is there emergency access to the property?',                 answer: 'I think a spare key is with the building manager.' },
    ],
    activityLog: [
      { id: 'al-002-1', type: 'callback_requested',      timestamp: new Date(Date.now() - 22 * 60000).toISOString(), label: 'Callback requested',         detail: 'Caller abandoned after 18 min wait.' },
      { id: 'al-002-2', type: 'sms_sent',                timestamp: new Date(Date.now() - 21 * 60000).toISOString(), label: 'SMS sent to caller',          detail: 'Hi Robert, we received your call and have added you to our priority callback queue. We take welfare checks very seriously.' },
      { id: 'al-002-3', type: 'questionnaire_sent',      timestamp: new Date(Date.now() - 21 * 60000).toISOString(), label: 'Questionnaire sent via SMS',  detail: 'Welfare check intake questionnaire sent.' },
      { id: 'al-002-4', type: 'questionnaire_completed', timestamp: new Date(Date.now() - 18 * 60000).toISOString(), label: 'Questionnaire completed',     detail: 'Address and details confirmed. Building manager key noted.' },
    ],
    waitMinutes: 18,
    attempts: 2,
    language: 'English',
    location: 'Maple Street — Evacuation Zone B',
    rulebook: 'disaster',
    createdAt: new Date(Date.now() - 22 * 60000).toISOString(),
    engineInput: {
      needCategory:     'welfare_check',
      needDescription:  'Welfare check — elderly neighbor cannot self-evacuate',
      waitMinutes:      18,
      attempts:         2,
      language:         'English',
      locationZone:     'near_danger',
      locationDetail:   'Maple Street — Evacuation Zone B',
      agentOutcome:     'could_not_resolve',
      callerMessage:    'Elderly neighbor unresponsive, mobility limitation, evacuation zone.',
      facilitySignals:  ['welfare_check_needed', 'mobility_vulnerability'],
      rulebook:         'disaster',
    },
  }),

  makeCaller({
    id: 'dc-003',
    name: 'Carlos Mendoza',
    phone: '5554567890',
    status: 'awaiting_callback',
    needCategory: 'shelter',
    needSummary: 'Family needs wildfire emergency shelter',
    callerMessage: 'Hola, necesito ayuda. My family — my wife and two children — we had to leave our house because of the fire. We are at the corner of Oak and 5th. Where is the shelter? We have nowhere to go tonight.',
    aiSummary: 'Spanish-speaking caller with wife and two young children displaced by wildfire. Family is currently at Oak & 5th with no shelter for the night. Needs immediate directions to nearest emergency shelter and potentially a Spanish-speaking responder for coordination.',
    questionnaire: [
      { question: 'How many people are in your group?',            answer: '4 — me, my wife, and our two children aged 6 and 9.' },
      { question: 'Do any group members have medical needs?',       answer: 'My wife is 6 months pregnant.' },
      { question: 'Do you have transportation?',                    answer: 'Yes, we have our car.' },
      { question: 'What language do you prefer?',                   answer: 'Spanish, but I speak a little English.' },
      { question: 'Do you have identification documents with you?', answer: 'Yes, we grabbed our documents.' },
    ],
    activityLog: [
      { id: 'al-003-1', type: 'callback_requested', timestamp: new Date(Date.now() - 15 * 60000).toISOString(), label: 'Callback requested',         detail: 'Caller abandoned after 12 min wait.' },
      { id: 'al-003-2', type: 'sms_sent',           timestamp: new Date(Date.now() - 14 * 60000).toISOString(), label: 'SMS sent (Spanish)',          detail: 'Hola Carlos, recibimos su llamada. Está en nuestra lista de prioridad. Le llamaremos en breve.' },
      { id: 'al-003-3', type: 'info_provided',      timestamp: new Date(Date.now() - 14 * 60000).toISOString(), label: 'Shelter information SMS sent', detail: 'Nearest shelter: Lincoln High School, 200 Lincoln Ave. Open 24h. Capacity available.' },
      { id: 'al-003-4', type: 'questionnaire_completed', timestamp: new Date(Date.now() - 12 * 60000).toISOString(), label: 'Questionnaire completed', detail: 'Pregnant wife noted — flagged for medical check-in at shelter.' },
    ],
    waitMinutes: 12,
    attempts: 3,
    language: 'Spanish',
    location: 'Oak Street — Wildfire Perimeter',
    rulebook: 'disaster',
    createdAt: new Date(Date.now() - 15 * 60000).toISOString(),
    engineInput: {
      needCategory:     'shelter',
      needDescription:  'Family needs wildfire emergency shelter',
      waitMinutes:      12,
      attempts:         3,
      language:         'Spanish',
      locationZone:     'near_danger',
      locationDetail:   'Oak Street — Wildfire Perimeter',
      agentOutcome:     'could_not_resolve',
      callerMessage:    'Family displaced, pregnant wife, needs shelter tonight.',
      facilitySignals:  ['urgent_evacuation_shelter'],
      rulebook:         'disaster',
    },
  }),

  makeCaller({
    id: 'dc-004',
    name: 'Sarah Chen',
    phone: '5552223333',
    status: 'awaiting_callback',
    needCategory: 'evacuation',
    needSummary: 'Needs official evacuation zone boundary confirmation',
    callerMessage: "Hi, I live on Riverside Drive and I'm not sure if I need to evacuate. Some neighbors left but others say we're fine. I need to know if I'm in an evacuation zone before making decisions.",
    aiSummary: 'Caller on Riverside Drive is uncertain whether her address falls within the mandatory evacuation zone. Some neighbors have left while others remain. She needs a definitive zone status answer before deciding whether to evacuate. Information provision via callback should resolve this quickly.',
    questionnaire: [
      { question: 'What is your exact address?',                      answer: '1820 Riverside Drive.' },
      { question: 'Have you received any official evacuation notices?', answer: 'No official notices, just seeing neighbors leave.' },
      { question: 'Are you able to evacuate if needed?',              answer: 'Yes, I have a car and can leave tonight.' },
      { question: 'Do you have pets or livestock?',                   answer: 'I have two dogs.' },
    ],
    activityLog: [
      { id: 'al-004-1', type: 'callback_requested',      timestamp: new Date(Date.now() - 10 * 60000).toISOString(), label: 'Callback requested',        detail: 'Caller abandoned after 8 min wait.' },
      { id: 'al-004-2', type: 'sms_sent',                timestamp: new Date(Date.now() - 9 * 60000).toISOString(),  label: 'SMS sent to caller',         detail: "Hi Sarah, we received your call about evacuation zone status. You're in our queue. We'll call back with official zone information." },
      { id: 'al-004-3', type: 'questionnaire_completed', timestamp: new Date(Date.now() - 7 * 60000).toISOString(),  label: 'Questionnaire completed',    detail: 'Address at 1820 Riverside Drive confirmed. Dogs noted — pet-friendly shelter may be needed.' },
    ],
    waitMinutes: 8,
    attempts: 1,
    language: 'English',
    location: 'Riverside Drive — Zone boundary unclear',
    rulebook: 'disaster',
    createdAt: new Date(Date.now() - 10 * 60000).toISOString(),
    engineInput: {
      needCategory:     'evacuation',
      needDescription:  'Needs official evacuation zone boundary confirmation',
      waitMinutes:      8,
      attempts:         1,
      language:         'English',
      locationZone:     'affected_area',
      locationDetail:   'Riverside Drive — Zone boundary unclear',
      agentOutcome:     'could_not_resolve',
      callerMessage:    'Unclear if in evacuation zone. Needs official confirmation.',
      facilitySignals:  ['service_problem_human_needed'],
      rulebook:         'disaster',
    },
  }),

  makeCaller({
    id: 'dc-005',
    name: 'John Harrington',
    phone: '5556667777',
    status: 'awaiting_callback',
    needCategory: 'outage_information',
    needSummary: 'Requesting power restoration timeline',
    callerMessage: 'Yes, hi. My power has been out since this morning. I was wondering if you could tell me when it might come back on. My food is starting to spoil. Not an emergency but would appreciate a callback.',
    aiSummary: 'Non-urgent caller requesting an estimated power restoration timeline. Primary concern is food spoilage. No medical dependencies or safety risks reported. A brief callback providing the current restoration estimate should fully resolve this case.',
    questionnaire: [
      { question: 'Are you and everyone in your household safe?',          answer: 'Yes, everyone is fine.' },
      { question: 'Do you have any medical equipment that requires power?', answer: 'No.' },
      { question: 'How long have you been without power?',                  answer: 'Since about 7 AM, so roughly 10 hours.' },
      { question: 'Do you need emergency supplies?',                        answer: "No, I'm okay for now." },
    ],
    activityLog: [
      { id: 'al-005-1', type: 'callback_requested', timestamp: new Date(Date.now() - 18 * 60000).toISOString(), label: 'Callback requested',   detail: 'Caller abandoned after 15 min wait.' },
      { id: 'al-005-2', type: 'sms_sent',           timestamp: new Date(Date.now() - 17 * 60000).toISOString(), label: 'SMS sent to caller',    detail: 'Hi John, we got your call about the power outage. You are in our callback queue. Expected wait: 30-45 min due to high volume.' },
      { id: 'al-005-3', type: 'info_provided',      timestamp: new Date(Date.now() - 17 * 60000).toISOString(), label: 'Outage info SMS sent',  detail: 'Current restoration estimate for your area: tonight by 9 PM. Updates at: outageinfo.gov/realtime' },
    ],
    waitMinutes: 15,
    attempts: 1,
    language: 'English',
    location: 'North District',
    rulebook: 'disaster',
    createdAt: new Date(Date.now() - 18 * 60000).toISOString(),
    engineInput: {
      needCategory:     'outage_information',
      needDescription:  'Requesting power restoration timeline',
      waitMinutes:      15,
      attempts:         1,
      language:         'English',
      locationZone:     'affected_area',
      locationDetail:   'North District',
      agentOutcome:     'resolved',
      callerMessage:    'Power out, food spoiling. Wants timeline. Not urgent.',
      facilitySignals:  ['info_unresolved'],
      rulebook:         'disaster',
    },
  }),

  makeCaller({
    id: 'dc-006',
    name: 'David Okafor',
    phone: '5558889999',
    status: 'awaiting_callback',
    needCategory: 'general_disaster',
    needSummary: 'General information request about disaster services',
    callerMessage: "I just wanted to know if community centers are open and if there are any free meals being provided. I'm okay but heard there might be resources available.",
    aiSummary: 'Caller is safe and seeking general information about available community resources — specifically meal programs and open community centers. Low urgency; can be resolved with a quick informational callback or an SMS with the current resource list.',
    questionnaire: [
      { question: 'Are you and your family safe?',           answer: 'Yes, everyone is fine.' },
      { question: 'Do you need emergency shelter?',          answer: 'No, I have a home.' },
      { question: 'Are you in need of food assistance?',     answer: 'It would be helpful but not critical.' },
      { question: 'How many people are in your household?',  answer: 'Just me.' },
    ],
    activityLog: [
      { id: 'al-006-1', type: 'callback_requested', timestamp: new Date(Date.now() - 8 * 60000).toISOString(), label: 'Callback requested', detail: 'Caller abandoned after 4 min wait.' },
      { id: 'al-006-2', type: 'sms_sent',           timestamp: new Date(Date.now() - 7 * 60000).toISOString(), label: 'SMS sent to caller',  detail: 'Hi David, thanks for calling. You are in our callback queue. We will be in touch soon with resource information.' },
    ],
    waitMinutes: 4,
    attempts: 1,
    language: 'English',
    location: 'West Side',
    rulebook: 'disaster',
    createdAt: new Date(Date.now() - 8 * 60000).toISOString(),
    engineInput: {
      needCategory:     'general_disaster',
      needDescription:  'General information request about disaster services',
      waitMinutes:      4,
      attempts:         1,
      language:         'English',
      locationZone:     'outside',
      locationDetail:   'West Side',
      agentOutcome:     'resolved',
      callerMessage:    'Safe. Asking about community resources. Low urgency.',
      facilitySignals:  [],
      rulebook:         'disaster',
    },
  }),

];

// ── CLINIC CALLERS ────────────────────────────────────────────────────────────

export const CLINIC_CALLERS: Caller[] = [

  makeCaller({
    id: 'cc-001',
    name: 'Patricia Wells',
    phone: '5551112222',
    status: 'awaiting_callback',
    needCategory: 'severe_pain',
    needSummary: 'Chest tightness and left-arm pain — urgent cardiac concern',
    callerMessage: "Hello, this is Patricia Wells, patient ID 442. I'm having chest tightness and my left arm feels heavy. It started about an hour ago. I called 911 but they said to follow up with my doctor. Please call me back.",
    aiSummary: 'Established patient presenting with classic cardiac warning signs: chest tightness and left-arm heaviness. Already seen by emergency services who directed her to follow up with her provider. Symptoms reportedly started 1 hour ago and appear to be ongoing. Requires immediate clinical assessment — do not delay callback.',
    questionnaire: [
      { question: 'Can you describe your symptoms?',       answer: 'Chest tightness and my left arm feels heavy and numb.' },
      { question: 'On a scale of 1–10, how severe?',       answer: '7 out of 10.' },
      { question: 'When did symptoms start?',              answer: 'About an hour ago, around 11 AM.' },
      { question: 'Have you called 911?',                  answer: 'Yes. They checked me and said to call my doctor immediately.' },
      { question: 'Are you alone?',                        answer: 'My husband is with me.' },
      { question: 'Do you have any cardiac history?',      answer: 'Yes, I had a stent placed two years ago.' },
    ],
    activityLog: [
      { id: 'al-c001-1', type: 'callback_requested',      timestamp: new Date(Date.now() - 20 * 60000).toISOString(), label: 'Callback requested',                    detail: 'Patient abandoned after 14 min hold.' },
      { id: 'al-c001-2', type: 'told_call_911',           timestamp: new Date(Date.now() - 19 * 60000).toISOString(), label: 'Instructed to call 911 if worsening',   detail: 'SMS sent: "If symptoms worsen at any point, call 911 immediately. Do not wait for our callback."' },
      { id: 'al-c001-3', type: 'sms_sent',                timestamp: new Date(Date.now() - 19 * 60000).toISOString(), label: 'Urgent SMS sent',                        detail: 'Patricia, you are our top priority callback. A nurse will call you within 5 minutes. If symptoms worsen, call 911.' },
      { id: 'al-c001-4', type: 'questionnaire_completed', timestamp: new Date(Date.now() - 17 * 60000).toISOString(), label: 'Questionnaire completed',                detail: 'Cardiac stent history confirmed. Husband present. Pain at 7/10.' },
      { id: 'al-c001-5', type: 'priority_changed',        timestamp: new Date(Date.now() - 17 * 60000).toISOString(), label: 'Priority set to 0 (Critical)',           detail: 'Engine detected severe_pain + directed_to_911 signals — Priority 0 (hard escalation).' },
    ],
    waitMinutes: 14,
    attempts: 4,
    language: 'English',
    location: 'At home',
    rulebook: 'clinic',
    createdAt: new Date(Date.now() - 20 * 60000).toISOString(),
    isExistingPatient: true,
    engineInput: {
      needCategory:     'severe_pain',
      needDescription:  'Chest tightness and left-arm pain — urgent cardiac concern',
      waitMinutes:      14,
      attempts:         4,
      language:         'English',
      locationZone:     'outside',
      locationDetail:   'At home',
      agentOutcome:     'directed_to_911',
      callerMessage:    'Chest tightness, left arm heavy. Cardiac stent history. 911 already contacted.',
      facilitySignals:  ['severe_pain', 'severe_symptoms'],
      rulebook:         'clinic',
    },
  }),

  makeCaller({
    id: 'cc-002',
    name: 'Ahmed Hassan',
    phone: '5553334444',
    status: 'awaiting_callback',
    needCategory: 'urgent_symptoms',
    needSummary: 'Allergic reaction — facial swelling, prior anaphylaxis history',
    callerMessage: 'I am Ahmed. I ate something and my face is starting to swell. I have had a bad reaction before. I have an EpiPen but I need to speak to someone please. I called three times.',
    aiSummary: 'Arabic-speaking patient with known anaphylaxis history is experiencing facial swelling after eating. Has an EpiPen available. Prior reaction history significantly elevates risk. Needs immediate guidance on EpiPen use threshold and monitoring parameters. Arabic-speaking responder preferred.',
    questionnaire: [
      { question: 'Describe the reaction you are experiencing', answer: 'My face is swelling, especially around my lips and eyes.' },
      { question: 'Have you used your EpiPen?',                 answer: 'Not yet. I am waiting to see if it gets worse.' },
      { question: 'Are you having difficulty breathing?',       answer: 'A little. It is hard to take deep breaths.' },
      { question: 'When did this start?',                       answer: 'About 20 minutes ago after eating dinner.' },
      { question: 'What did you eat?',                          answer: 'A new type of sauce. I am not sure of all the ingredients.' },
    ],
    activityLog: [
      { id: 'al-c002-1', type: 'callback_requested', timestamp: new Date(Date.now() - 12 * 60000).toISOString(), label: 'Callback requested',     detail: 'Patient abandoned after 9 min hold.' },
      { id: 'al-c002-2', type: 'told_call_911',      timestamp: new Date(Date.now() - 11 * 60000).toISOString(), label: '911 instructions sent',   detail: 'SMS (Arabic + English): If breathing becomes difficult, use EpiPen and call 911 immediately.' },
      { id: 'al-c002-3', type: 'questionnaire_completed', timestamp: new Date(Date.now() - 9 * 60000).toISOString(), label: 'Questionnaire completed', detail: 'Breathing difficulty noted. EpiPen not yet used. Escalated to urgent.' },
    ],
    waitMinutes: 9,
    attempts: 3,
    language: 'Arabic',
    location: 'At home',
    rulebook: 'clinic',
    createdAt: new Date(Date.now() - 12 * 60000).toISOString(),
    isExistingPatient: true,
    engineInput: {
      needCategory:     'urgent_symptoms',
      needDescription:  'Allergic reaction — facial swelling, prior anaphylaxis history',
      waitMinutes:      9,
      attempts:         3,
      language:         'Arabic',
      locationZone:     'outside',
      locationDetail:   'At home',
      agentOutcome:     'possible_danger',
      callerMessage:    'Facial swelling after eating, anaphylaxis history, breathing difficulty.',
      facilitySignals:  ['swelling_allergic', 'severe_symptoms'],
      rulebook:         'clinic',
    },
  }),

  makeCaller({
    id: 'cc-003',
    name: 'Linda Kowalski',
    phone: '5555556666',
    status: 'awaiting_callback',
    needCategory: 'prescription',
    needSummary: 'Cardiac medication refill authorization needed — pharmacy on hold',
    callerMessage: "This is Linda Kowalski. I take metoprolol every day for my heart and I'm completely out. The pharmacy faxed a refill request yesterday but nobody has responded. I cannot miss this medication.",
    aiSummary: 'Established patient is out of metoprolol, a daily cardiac medication. Pharmacy has already sent a refill request that has gone unanswered. Missing this medication carries real cardiac risk. Authorization callback to the pharmacy should be the primary action.',
    questionnaire: [
      { question: 'What medication do you need?',                    answer: 'Metoprolol 50mg, once daily.' },
      { question: 'How long have you been without the medication?',  answer: 'Since yesterday morning — about 30 hours.' },
      { question: 'Have you experienced any symptoms without it?',   answer: 'Some palpitations this morning.' },
      { question: 'Which pharmacy did you use?',                     answer: 'Walgreens on Main Street. They faxed yesterday at 2 PM.' },
    ],
    activityLog: [
      { id: 'al-c003-1', type: 'callback_requested',      timestamp: new Date(Date.now() - 14 * 60000).toISOString(), label: 'Callback requested',   detail: 'Patient abandoned after 11 min hold.' },
      { id: 'al-c003-2', type: 'sms_sent',                timestamp: new Date(Date.now() - 13 * 60000).toISOString(), label: 'SMS sent',              detail: 'Hi Linda, we received your request about your prescription. You are in our callback queue. A staff member will call you shortly.' },
      { id: 'al-c003-3', type: 'questionnaire_completed', timestamp: new Date(Date.now() - 10 * 60000).toISOString(), label: 'Questionnaire completed', detail: 'Palpitations noted. Walgreens Main St pharmacy confirmed. Urgent prescription fax follow-up needed.' },
    ],
    waitMinutes: 11,
    attempts: 2,
    language: 'English',
    location: 'At home',
    rulebook: 'clinic',
    createdAt: new Date(Date.now() - 14 * 60000).toISOString(),
    isExistingPatient: true,
    engineInput: {
      needCategory:     'prescription',
      needDescription:  'Cardiac medication refill authorization needed',
      waitMinutes:      11,
      attempts:         2,
      language:         'English',
      locationZone:     'outside',
      locationDetail:   'At home',
      agentOutcome:     'could_not_resolve',
      callerMessage:    'Out of daily cardiac medication for 30 hours. Palpitations starting.',
      facilitySignals:  ['prescription_urgent'],
      rulebook:         'clinic',
    },
  }),

  makeCaller({
    id: 'cc-004',
    name: 'James Okoro',
    phone: '5557778888',
    status: 'awaiting_callback',
    needCategory: 'new_patient',
    needSummary: 'New patient — persistent daily headaches with visual disturbances',
    callerMessage: "Hi, my name is James Okoro. I'm a new patient. I've been having headaches every day for two weeks and my vision is a little blurry sometimes. I need to see someone as soon as possible.",
    aiSummary: 'New patient presenting with two weeks of daily headaches accompanied by intermittent visual disturbances. This symptom combination warrants prompt evaluation to rule out elevated intracranial pressure or other neurological causes. Should be seen within 24–48 hours.',
    questionnaire: [
      { question: 'How long have you had these headaches?',   answer: 'Every day for two weeks.' },
      { question: 'Describe the headaches.',                  answer: 'Dull pressure, mostly behind my eyes. Gets worse in the afternoon.' },
      { question: 'Tell me about the vision changes.',        answer: 'Blurry spots, sometimes for a few minutes then it clears.' },
      { question: 'Any other symptoms?',                      answer: 'Occasional nausea. No vomiting.' },
      { question: "Have you seen a doctor for this before?",  answer: "No, I just moved to this area and don't have a doctor yet." },
    ],
    activityLog: [
      { id: 'al-c004-1', type: 'callback_requested',      timestamp: new Date(Date.now() - 9 * 60000).toISOString(), label: 'Callback requested',    detail: 'Patient abandoned after 7 min hold.' },
      { id: 'al-c004-2', type: 'sms_sent',                timestamp: new Date(Date.now() - 8 * 60000).toISOString(), label: 'SMS sent',               detail: 'Hi James, we received your call. You are in our new patient callback queue. We will reach out shortly to schedule your appointment.' },
      { id: 'al-c004-3', type: 'questionnaire_completed', timestamp: new Date(Date.now() - 6 * 60000).toISOString(), label: 'Questionnaire completed', detail: 'Visual changes + daily headaches for 2 weeks. Prompt neurology referral may be needed.' },
    ],
    waitMinutes: 7,
    attempts: 2,
    language: 'English',
    location: 'Downtown',
    rulebook: 'clinic',
    createdAt: new Date(Date.now() - 9 * 60000).toISOString(),
    isExistingPatient: false,
    engineInput: {
      needCategory:     'new_patient',
      needDescription:  'New patient — persistent daily headaches with visual disturbances',
      waitMinutes:      7,
      attempts:         2,
      language:         'English',
      locationZone:     'outside',
      locationDetail:   'Downtown',
      agentOutcome:     'caller_requested_human',
      callerMessage:    'Daily headaches 2 weeks, blurry vision. New patient, needs appointment.',
      facilitySignals:  ['new_patient_urgent'],
      rulebook:         'clinic',
    },
  }),

  makeCaller({
    id: 'cc-005',
    name: 'Diane Moreau',
    phone: '5559990011',
    status: 'awaiting_callback',
    needCategory: 'appointment',
    needSummary: 'Reschedule routine annual check-up',
    callerMessage: 'Hello, this is Diane Moreau. I need to reschedule my annual physical that was booked for Thursday. Any day next week would work. Please call me back when you get a chance. Thank you.',
    aiSummary: 'Patient is requesting a routine reschedule of her annual physical. No urgent medical concerns mentioned. Any available slot next week is acceptable. Can be handled by admin staff; no clinical consultation needed.',
    questionnaire: [
      { question: 'What appointment are you looking to reschedule?', answer: 'My annual physical booked for this Thursday.' },
      { question: 'What dates/times work for you?',                  answer: 'Any day next week is fine. I prefer mornings.' },
      { question: 'Is there a medical reason for the original appointment?', answer: 'No, just my yearly check-up.' },
    ],
    activityLog: [
      { id: 'al-c005-1', type: 'callback_requested', timestamp: new Date(Date.now() - 8 * 60000).toISOString(), label: 'Callback requested', detail: 'Patient abandoned after 6 min hold.' },
      { id: 'al-c005-2', type: 'sms_sent',           timestamp: new Date(Date.now() - 7 * 60000).toISOString(), label: 'SMS sent',           detail: 'Hi Diane, we received your reschedule request. We will call you back to confirm a new appointment time.' },
    ],
    waitMinutes: 6,
    attempts: 1,
    language: 'French',
    location: 'Westdale',
    rulebook: 'clinic',
    createdAt: new Date(Date.now() - 8 * 60000).toISOString(),
    isExistingPatient: true,
    engineInput: {
      needCategory:     'appointment',
      needDescription:  'Reschedule routine annual check-up',
      waitMinutes:      6,
      attempts:         1,
      language:         'French',
      locationZone:     'outside',
      locationDetail:   'Westdale',
      agentOutcome:     'resolved',
      callerMessage:    'Routine annual physical reschedule. No urgency.',
      facilitySignals:  ['appointment_reschedule'],
      rulebook:         'clinic',
    },
  }),

  makeCaller({
    id: 'cc-006',
    name: 'Terry Sullivan',
    phone: '5550001234',
    status: 'awaiting_callback',
    needCategory: 'billing',
    needSummary: 'Question about unrecognized charge on recent invoice',
    callerMessage: "Hi there, Terry Sullivan here. I received an invoice last week that doesn't look right — there's a charge I don't recognize. Nothing urgent, just want to get it sorted out.",
    aiSummary: 'Non-urgent billing inquiry. Patient is questioning an unrecognized charge on a recent invoice. No clinical or safety concerns. Can be handled entirely by billing staff. Low priority but should be contacted to maintain patient satisfaction.',
    questionnaire: [
      { question: 'What is the invoice date?',                      answer: 'It shows November 12th.' },
      { question: 'What is the charge you do not recognize?',       answer: 'A "facility fee" of $85. I have never seen this before.' },
      { question: 'Would you like a callback or email response?',   answer: 'Callback is fine.' },
    ],
    activityLog: [
      { id: 'al-c006-1', type: 'callback_requested', timestamp: new Date(Date.now() - 5 * 60000).toISOString(), label: 'Callback requested', detail: 'Patient abandoned after 3 min hold.' },
      { id: 'al-c006-2', type: 'sms_sent',           timestamp: new Date(Date.now() - 4 * 60000).toISOString(), label: 'SMS sent',           detail: 'Hi Terry, we received your billing inquiry. Our team will call you back shortly to resolve your question.' },
    ],
    waitMinutes: 3,
    attempts: 1,
    language: 'English',
    location: 'North End',
    rulebook: 'clinic',
    createdAt: new Date(Date.now() - 5 * 60000).toISOString(),
    isExistingPatient: true,
    engineInput: {
      needCategory:     'billing',
      needDescription:  'Question about unrecognized charge on recent invoice',
      waitMinutes:      3,
      attempts:         1,
      language:         'English',
      locationZone:     'outside',
      locationDetail:   'North End',
      agentOutcome:     'resolved',
      callerMessage:    'Billing inquiry. No urgency.',
      facilitySignals:  ['billing_inquiry'],
      rulebook:         'clinic',
    },
  }),

];

// ── Repeat-caller simulation helper ──────────────────────────────────────────
// Simulates a caller contacting the system again with new or escalated information.
// Returns a NEW Caller object with updated score and appended activity.

import { mergeRepeatInput } from '@/lib/engine';
import type { EngineInput as EI } from '@/types';

export function simulateRepeatContact(
  existing: Caller,
  newSignals: Partial<EI>,
  newActivityDetail: string,
): Caller {
  if (!existing.engineInput) return existing;

  const input = mergeRepeatInput(existing.engineInput, newSignals);
  const result = scoreCallerInput(input);
  const effectivePriority = existing.manualPriority
    ? existing.overridePriority ?? existing.priority
    : result.priority;
  const newEntry = {
    id: `log-repeat-${Date.now()}`,
    type: 'priority_recalculated' as const,
    timestamp: new Date().toISOString(),
    label: `Repeat contact — calculated priority ${existing.calculatedPriority} → ${result.priority}`,
    detail: `${newActivityDetail} Previous calculated priority: ${existing.calculatedPriority}. New calculated priority: ${result.priority}. ` +
      (existing.manualPriority
        ? `Human override remains active at Priority ${effectivePriority}. Reason: ${existing.manualPriorityReason}. Operator: ${existing.overrideOperatorId}.`
        : `Effective priority: ${effectivePriority}.`),
    previousCalculatedPriority: existing.calculatedPriority,
    calculatedPriority: result.priority,
    previousPriority: existing.priority,
    newPriority: effectivePriority,
  };

  return {
    ...existing,
    priority: effectivePriority,
    overridePriority: existing.manualPriority ? effectivePriority : undefined,
    calculatedPriority: result.priority,
    hardEscalation: result.hardEscalation,
    escalationReason: result.escalationReason,
    score: result.score,
    scoreBreakdown: result.breakdown,
    attempts: input.attempts,
    waitMinutes: input.waitMinutes,
    language: input.language,
    location: input.locationDetail,
    needCategory: input.needCategory,
    needSummary: input.needDescription,
    callerMessage: input.callerMessage,
    rulebook: input.rulebook,
    engineInput: input,
    activityLog: [...existing.activityLog, newEntry],
  };
}
