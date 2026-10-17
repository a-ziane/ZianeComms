import type { CoverageArea, ExperienceTag, ExpertiseTag, LanguageTag, MatchFactor, NeedCategory } from '@/types';

export interface MatchingConfig {
  version: string;
  weights: Record<MatchFactor, number>;
  expertisePoints: { exact: number; related: number; general: number };
  expertiseMappings: Partial<Record<NeedCategory, { exact: ExpertiseTag[]; related: ExpertiseTag[]; general: ExpertiseTag[] }>>;
  language: { aliases: Record<string, LanguageTag>; direct: number; interpreter: number };
  location: { enabled: boolean; disabledNeeds: NeedCategory[]; direct: number; adjacent: number; adjacency: Partial<Record<CoverageArea, CoverageArea[]>> };
  workload: { maxActiveCases: number; points: number }[];
  experience: { exact: number; related: number; mappings: Partial<Record<NeedCategory, { exact: ExperienceTag[]; related: ExperienceTag[] }>> };
  strongMatch: { minimumScore: number; minimumExpertise: number; requireLanguageSupport: boolean };
}

// Category values scale with their configured maxima; default maxima total 100.
export const MATCHING_CONFIG: MatchingConfig = {
  version: 'matching-v1',
  weights: { expertise: 40, language: 20, location: 20, workload: 15, experience: 5 },
  expertisePoints: { exact: 40, related: 25, general: 10 },
  expertiseMappings: {
    medical_equipment: { exact: ['medical_support'], related: ['mobility_support'], general: ['general_crisis'] },
    welfare_check: { exact: ['welfare_check'], related: ['medical_support', 'mobility_support'], general: ['general_crisis'] },
    evacuation: { exact: ['evacuation'], related: ['mobility_support', 'shelter'], general: ['general_crisis'] },
    shelter: { exact: ['shelter'], related: ['evacuation'], general: ['general_crisis'] },
    mobility_issue: { exact: ['mobility_support'], related: ['evacuation', 'medical_support'], general: ['general_crisis'] },
    outage_information: { exact: ['general_crisis'], related: ['shelter'], general: [] },
    general_disaster: { exact: ['general_crisis'], related: ['shelter', 'evacuation'], general: [] },
    severe_pain: { exact: ['medical_support'], related: ['prescription'], general: [] },
    urgent_symptoms: { exact: ['medical_support'], related: ['prescription'], general: [] },
    prescription: { exact: ['prescription'], related: ['medical_support'], general: ['appointments'] },
    new_patient: { exact: ['medical_support'], related: ['appointments'], general: [] },
    appointment: { exact: ['appointments'], related: ['medical_support'], general: ['billing'] },
    cleaning: { exact: ['appointments'], related: [], general: [] },
    billing: { exact: ['billing'], related: ['appointments'], general: [] },
    other: { exact: [], related: [], general: ['general_crisis'] },
  },
  language: {
    aliases: { english: 'en', spanish: 'es', hindi: 'hi', korean: 'ko', mandarin: 'zh', arabic: 'ar', french: 'fr',
      en: 'en', es: 'es', hi: 'hi', ko: 'ko', zh: 'zh', ar: 'ar', fr: 'fr' },
    direct: 20, interpreter: 10,
  },
  location: { enabled: true, disabledNeeds: ['billing', 'appointment', 'cleaning'], direct: 20, adjacent: 10,
    adjacency: { eastside: ['central', 'riverside'], central: ['eastside', 'north', 'west', 'riverside'],
      north: ['central', 'west'], west: ['central', 'north'], riverside: ['central', 'eastside'] } },
  workload: [{ maxActiveCases: 0, points: 15 }, { maxActiveCases: 1, points: 10 }, { maxActiveCases: 2, points: 5 },
    { maxActiveCases: Infinity, points: 0 }],
  experience: { exact: 5, related: 2, mappings: {
    medical_equipment: { exact: ['emergency_medical'], related: ['mobility_assistance'] },
    welfare_check: { exact: ['welfare_visits'], related: ['emergency_medical', 'mobility_assistance'] },
    evacuation: { exact: ['evacuation_operations'], related: ['shelter_operations', 'mobility_assistance'] },
    shelter: { exact: ['shelter_operations'], related: ['evacuation_operations'] },
    mobility_issue: { exact: ['mobility_assistance'], related: ['emergency_medical'] },
    outage_information: { exact: ['evacuation_operations'], related: ['shelter_operations'] },
    general_disaster: { exact: ['shelter_operations'], related: ['evacuation_operations'] },
    severe_pain: { exact: ['emergency_medical'], related: ['medication_coordination'] },
    urgent_symptoms: { exact: ['emergency_medical'], related: ['medication_coordination'] },
    prescription: { exact: ['medication_coordination'], related: ['emergency_medical'] },
    new_patient: { exact: ['patient_intake'], related: ['emergency_medical'] },
    appointment: { exact: ['patient_intake'], related: ['billing_support'] },
    cleaning: { exact: ['patient_intake'], related: [] },
    billing: { exact: ['billing_support'], related: ['patient_intake'] },
  } },
  strongMatch: { minimumScore: 70, minimumExpertise: 25, requireLanguageSupport: true },
};

export const LANGUAGE_LABELS: Record<LanguageTag, string> = { en: 'English', es: 'Spanish', hi: 'Hindi', ko: 'Korean', zh: 'Mandarin', ar: 'Arabic', fr: 'French' };
export const AREA_LABELS: Record<CoverageArea, string> = { eastside: 'Eastside', central: 'Central', north: 'North District', west: 'West Side', riverside: 'Riverside' };
export const tagLabel = (tag: string) => tag.replace(/_/g, ' ');
