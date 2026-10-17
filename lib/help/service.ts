import { createHash } from 'node:crypto';
import { validateHelpRequest, helpCaller } from './intake';
import { contactKey, normalizePhone, protectContact, redactPhones } from '@/lib/retell/contact';
import { operationsRepository, PersistenceError, type RpcClient } from '@/lib/persistence/repository';
import { serializeState } from '@/lib/persistence/mapping';

export async function submitHelp(client: RpcClient, untrusted: unknown, encryptionKey: string | undefined, now = new Date().toISOString()) {
  const request = validateHelpRequest(untrusted);
  const phone = normalizePhone(request.contact);
  if (request.contact && !phone) throw Error('Invalid international contact');
  // Hash the canonical original request, but keep actual contacts in the existing encrypted server-only store.
  const digest = createHash('sha256').update(JSON.stringify(request)).digest('hex');
  const safe = { ...request, name: redactPhones(request.name), need: redactPhones(request.need), location: Object.fromEntries(Object.entries(request.location).map(([k,v]) => [k,redactPhones(v)])) };
  const caller = helpCaller(safe, now);
  const protectedContact = phone ? protectContact(phone, contactKey(encryptionKey), caller.id) : { identity: null, encrypted: null };
  const repo = operationsRepository(client);
  // Each retry reloads the latest state; this path only appends a new case, never replaces another case.
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await repo.load();
    const existing = Object.values(current.state.callersByMode).flat().find(c => c.id === caller.id);
    const state = existing ? current.state : { ...current.state, callersByMode: { ...current.state.callersByMode, [caller.rulebook]: [...current.state.callersByMode[caller.rulebook], caller] } };
    const { error } = await client.rpc('zianecomms_submit_help', { p_expected_revision: current.revision, p_request_id: request.id, p_digest: digest,
      p_payload: serializeState(state), p_contact_encrypted: protectedContact.encrypted, p_contact_identity: protectedContact.identity });
    if (!error) return { acknowledged: true as const, requestId: request.id };
    if (error.code === '40001') continue;
    throw new PersistenceError('Help request could not be confirmed.', error.code === '23505');
  }
  throw new PersistenceError('Help request could not be confirmed. Please retry.', true);
}
