import { MATCHING_CONFIG, type MatchingConfig } from '@/config/matching';
import type { Rulebook, CoverageArea } from '@/types';

export type DeploymentId = 'los-angeles' | 'algeria';
export const HELP_QUESTIONS = [
  { key: 'immediateDanger', label: 'Are you or someone else in immediate danger?' },
  { key: 'medicalNeed', label: 'Is there a medical need?' },
  { key: 'mobilityNeed', label: 'Does anyone have limited mobility?' },
  { key: 'equipmentNeed', label: 'Does anyone depend on medical equipment?' },
  { key: 'crisisContext', label: 'Are you affected by an active crisis?' },
  { key: 'unableToEvacuate', label: 'Are you unable to evacuate without assistance?' },
  { key: 'powerDisruption', label: 'Is power to needed medical equipment disrupted?' },
] as const;
export interface DeploymentProfile {
  id: DeploymentId; name: string; flag: string; rulebook: Rulebook;
  languages: { code: string; label: string; ready?: boolean }[];
  locationSchema: { key: string; label: string; hint?: string }[];
  questionnaire: readonly { key: typeof HELP_QUESTIONS[number]['key']; label: string }[];
  emergencyGuidance: string;
  connectivityPreferences: string[];
  coverage: { key: CoverageArea; label: string }[];
  matching: MatchingConfig;
}
const shared = { questionnaire: HELP_QUESTIONS, rulebook: 'disaster' as const, connectivityPreferences: ['voice', 'recovery messaging', 'offline help form'], matching: MATCHING_CONFIG };
export const DEPLOYMENTS: Record<DeploymentId, DeploymentProfile> = {
  'los-angeles': { ...shared, id: 'los-angeles', name: 'Los Angeles', flag: '🇺🇸',
    languages: [{ code: 'en', label: 'English' }, { code: 'es', label: 'Spanish' }],
    locationSchema: [{ key: 'address', label: 'Address (if known)' }, { key: 'zip', label: 'ZIP' }, { key: 'area', label: 'Neighborhood / local area' }, { key: 'landmark', label: 'Landmark' }, { key: 'zone', label: 'Affected / crisis zone' }, { key: 'details', label: 'Detailed location' }],
    emergencyGuidance: 'If you are in immediate danger, try to reach local emergency services (911 in the United States) if a connection is available. A call may not connect without service. ZianeComms has not contacted emergency services.',
    coverage: [{ key: 'eastside', label: 'Eastside' }, { key: 'central', label: 'Central' }, { key: 'north', label: 'North District' }, { key: 'west', label: 'West Side' }, { key: 'riverside', label: 'Riverside' }],
  },
  algeria: { ...shared, id: 'algeria', name: 'Algeria', flag: '🇩🇿',
    languages: [{ code: 'ar', label: 'Arabic' }, { code: 'fr', label: 'French' }, { code: 'tzm', label: 'Tamazight', ready: true }],
    locationSchema: [{ key: 'wilaya', label: 'Wilaya' }, { key: 'commune', label: 'Commune' }, { key: 'area', label: 'Local area / neighborhood' }, { key: 'landmark', label: 'Landmark' }, { key: 'details', label: 'Any other details that help locate you' }],
    emergencyGuidance: 'If you are in immediate danger, try to reach local emergency services or a nearby trusted person if a connection is available. Calls may not connect without service. ZianeComms has not contacted emergency services.',
    // Local geography is not mapped to LA districts. Unknown coverage earns no location points.
    coverage: [],
  },
};
export function deployment(id: unknown): DeploymentProfile {
  if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(DEPLOYMENTS, id)) throw Error('Unknown deployment');
  return DEPLOYMENTS[id as DeploymentId];
}
export const DEFAULT_DEPLOYMENT: DeploymentId = 'los-angeles';
