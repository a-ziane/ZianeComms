import { parseExtractionMap } from '@/config/retell';
import type { Rulebook } from '@/types';
import { contactKey } from './contact';

export function retellConfig() {
  if (process.env.RETELL_ENABLED !== 'true') throw new Error('Retell is disabled');
  const apiKey = process.env.RETELL_API_KEY;
  const agentId = process.env.RETELL_AGENT_ID;
  const rulebook = process.env.RETELL_RULEBOOK;
  if (!apiKey || !agentId || !['disaster','clinic'].includes(rulebook ?? '') ||
      (process.env.OPERATIONS_PASSWORD?.length ?? 0) < 24) throw new Error('Retell is not configured');
  return { apiKey, agentId, mapping: parseExtractionMap(process.env.RETELL_EXTRACTION_FIELDS), rulebook: rulebook as Rulebook, encryptionKey: contactKey(process.env.CONTACT_ENCRYPTION_KEY) };
}
