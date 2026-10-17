import type { DeviceStore } from './storage';
import type { HelpRequest } from '@/lib/help/intake';
import type { CaseAction, CaseState } from '@/lib/cases';
import { TERMINAL_STATUSES } from '@/lib/cases';
export interface LoadResult { state: CaseState; revision: number }
export interface QueuedAction { command: Exclude<CaseAction, { type: 'switch_mode' }>; revision: number; mutationId: string }
export interface OperatorCache { snapshot: LoadResult; lastSynchronizedAt: string; actions: QueuedAction[]; conflict?: boolean }
export const OPERATOR_KEY = 'operator-cache';
const HELP_KEY = 'help-requests';
export async function saveHelp(store: DeviceStore, request: HelpRequest) {
  const all = await pendingHelp(store);
  await store.put(HELP_KEY, [...all.filter(r => r.id !== request.id), request]);
}
export async function pendingHelp(store: DeviceStore): Promise<HelpRequest[]> {
  return await store.get<HelpRequest[]>(HELP_KEY) ?? [];
}
export async function syncHelp(store: DeviceStore, send: (r: HelpRequest) => Promise<{ acknowledged: boolean; requestId: string }>, connected: () => boolean) {
  let count = 0;
  for (const request of await pendingHelp(store)) {
    if (!connected()) break;
    const ack = await send(request);
    if (!ack.acknowledged || ack.requestId !== request.id) throw Error('Server acknowledgement missing. Request remains on this device.');
    await store.put(HELP_KEY, (await pendingHelp(store)).filter(r => r.id !== request.id));
    count++;
  }
  return count;
}
export function safeOfflineAction(action: QueuedAction['command']) {
  return action.type === 'note' || (action.type === 'patch' && (
    action.logEntry?.type === 'call_attempted' && action.patch.status === 'calling' ||
    ['case_closed','followup_required'].includes(action.logEntry?.type ?? '') && ['resolved','referred','no_answer','needs_followup'].includes(action.patch.status ?? '')
  ));
}
// Cache only active work. Full transcripts, questionnaire answers and historical narrative are not needed for offline actions.
export function cacheSnapshot(result: LoadResult): LoadResult {
  const trim = (c: CaseState['callersByMode']['disaster'][number]) => ({ ...c, callerMessage: '', aiSummary: 'Offline cached case. Reconnect for full conversation and history.', questionnaire: [], activityLog: [],
    engineInput: c.engineInput ? { ...c.engineInput, callerMessage: '' } : undefined, lastRecommendation: undefined, assignmentRecommendation: undefined });
  return { ...result, state: { ...result.state, callersByMode: {
    disaster: result.state.callersByMode.disaster.filter(c => !TERMINAL_STATUSES.includes(c.status)).map(trim),
    clinic: result.state.callersByMode.clinic.filter(c => !TERMINAL_STATUSES.includes(c.status)).map(trim),
  } } };
}
export async function syncActions(store: DeviceStore, send: (action: QueuedAction) => Promise<LoadResult>, connected: () => boolean) {
  let cache = await store.get<OperatorCache>(OPERATOR_KEY);
  if (!cache || cache.conflict) return cache;
  while (cache.actions.length && connected()) {
    try {
      const result = await send(cache.actions[0]);
      cache = { snapshot: cacheSnapshot(result), lastSynchronizedAt: new Date().toISOString(), actions: cache.actions.slice(1) };
      await store.put(OPERATOR_KEY, cache);
    } catch (e) {
      if ((e as { status?: number }).status === 409 || (e as { status?: number }).status === 400) {
        cache = { ...cache, conflict: true }; await store.put(OPERATOR_KEY, cache);
      }
      throw e;
    }
  }
  return cache;
}
