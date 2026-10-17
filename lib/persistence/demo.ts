import { DISASTER_CALLERS, CLINIC_CALLERS, MOCK_RESPONDERS } from '@/data/callers';
import { RULEBOOKS } from '@/config/rulebooks';
import { MATCHING_CONFIG } from '@/config/matching';
import { CATEGORY_CAPS } from '@/config/engine';
import { DEMO_FACILITY_ID, serializeState } from './mapping';

export function demoSeed() {
  return JSON.parse(JSON.stringify({ facility: { id: DEMO_FACILITY_ID, name: 'zianeComms Hackathon Demo',
    configuration: { activeRulebook: 'disaster', modes: ['disaster', 'clinic'], rulebooks: RULEBOOKS, categoryCaps: CATEGORY_CAPS, matching: MATCHING_CONFIG } },
    ...serializeState({ rulebook: 'disaster', callersByMode: { disaster: DISASTER_CALLERS, clinic: CLINIC_CALLERS }, responders: MOCK_RESPONDERS }),
  }, (_key, value) => value === Infinity ? Number.MAX_SAFE_INTEGER : value));
}
