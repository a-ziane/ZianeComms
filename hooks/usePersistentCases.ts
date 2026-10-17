'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DISASTER_CALLERS, CLINIC_CALLERS, MOCK_RESPONDERS } from '@/data/callers';
import { caseReducer, type CaseAction, type CaseState } from '@/lib/cases';
import { applyOperationalCommand } from '@/lib/persistence/commands';
import { deviceStore, withDeviceLock } from '@/lib/offline/storage';
import { cacheSnapshot, OPERATOR_KEY, safeOfflineAction, syncActions, type LoadResult, type OperatorCache, type QueuedAction } from '@/lib/offline/queue';
import { connected, useConnectivity } from './useConnectivity';

const EMPTY_STATE: CaseState = { rulebook: 'disaster', callersByMode: { disaster: DISASTER_CALLERS, clinic: CLINIC_CALLERS }, responders: MOCK_RESPONDERS };
export function usePersistentCases() {
  const network = useConnectivity();
  const [state, setState] = useState<CaseState>(EMPTY_STATE);
  const current = useRef<LoadResult>({ state: EMPTY_STATE, revision: 0 });
  const [status, setStatus] = useState<'loading'|'ready'|'saving'|'error'|'offline'>('loading');
  const [error, setError] = useState('');
  const [hasLoaded, setHasLoaded] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [conflict, setConflict] = useState(false);
  const [lastSync, setLastSync] = useState('');
  const queue = useRef<Promise<void>>(Promise.resolve());
  const loaded = useRef(false);
  const apply = useCallback((result: LoadResult) => {
    const next = { ...result.state, rulebook: current.current.state.rulebook };
    current.current = { ...result, state: next }; setState(next); setHasLoaded(true); loaded.current = true;
  }, []);
  const request = useCallback(async (body?: QueuedAction): Promise<LoadResult> => {
    if (!connected()) throw Error('Offline — actions remain on this device.');
    const response = await fetch('/api/operations', body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw Object.assign(Error(result.error || 'Database request failed.'), { status: response.status });
    return result;
  }, []);
  const displayCache = useCallback((cache: OperatorCache) => {
    // Apply queued work for offline viewing only; never send a replacement snapshot to the server.
    let next = cache.snapshot.state;
    for (const action of cache.actions) { try { next = applyOperationalCommand(next, action.command, new Date().toISOString()); } catch { /* Retain queue for server validation/review. */ } }
    apply({ ...cache.snapshot, state: next }); setPendingCount(cache.actions.length); setLastSync(cache.lastSynchronizedAt); setConflict(!!cache.conflict);
  }, [apply]);
  const reload = useCallback(async () => {
    setStatus('loading');
    try {
      await withDeviceLock('operator', async () => {
        let cache = await deviceStore.get<OperatorCache>(OPERATOR_KEY);
        if (cache) displayCache(cache);
        if (!connected()) { setStatus('offline'); if (!cache) setError('No synchronized cases cached on this device.'); return; }
        if (cache?.conflict) { setStatus('error'); setError('Conflict: newer server data or an invalid action needs review. Pending actions have not been discarded.'); return; }
        setStatus(cache?.actions.length ? 'saving' : 'loading');
        cache = await syncActions(deviceStore, request, connected);
        if (!connected()) { if (cache) displayCache(cache); setStatus('offline'); return; }
        const result = await request();
        const saved: OperatorCache = { snapshot: cacheSnapshot(result), actions: [], lastSynchronizedAt: new Date().toISOString() };
        await deviceStore.put(OPERATOR_KEY, saved);
        apply(result); setPendingCount(0); setLastSync(saved.lastSynchronizedAt); setConflict(false); setError(''); setStatus('ready');
      });
    } catch (e) {
      const cache = await deviceStore.get<OperatorCache>(OPERATOR_KEY).catch(() => undefined);
      if (cache) displayCache(cache);
      setStatus(connected() ? 'error' : 'offline'); setError((e as Error).message);
    }
  }, [apply, displayCache, request]);
  useEffect(() => { void reload(); }, [reload, network.online]);
  const dispatch = useCallback((action: CaseAction) => {
    if (action.type === 'switch_mode') { const next = caseReducer(current.current.state, action); current.current.state = next; setState(next); return; }
    if (!loaded.current || conflict) { setError('Load saved cases and resolve conflicts before changing this case.'); return; }
    if (!connected() && !safeOfflineAction(action)) { setError('This action needs an online review. Use the offline note/outcome controls.'); return; }
    queue.current = queue.current.then(async () => {
      try {
        await withDeviceLock('operator', async () => {
          const cache = await deviceStore.get<OperatorCache>(OPERATOR_KEY);
          if (!cache || cache.conflict) throw Error('Saved cases unavailable or conflict awaiting review.');
          if (cache.actions.length >= 50) throw Error('Device queue is full. Synchronize before adding more actions.');
          const operation = { command: action, revision: cache.snapshot.revision + cache.actions.length, mutationId: crypto.randomUUID() };
          const next = { ...cache, actions: [...cache.actions, operation] };
          await deviceStore.put(OPERATOR_KEY, next); // Durable before optimistic display or network transmission.
          displayCache(next); setError(''); setStatus(connected() ? 'saving' : 'offline');
        });
        if (connected()) await reload();
      } catch (e) { setError((e as Error).message); setStatus('error'); }
    });
  }, [conflict, displayCache, reload]);
  const cancelPending = useCallback(async () => {
    if (!connected()) { setError('Reconnect to review the latest server state first.'); return; }
    try {
      await withDeviceLock('operator', async () => {
        const result = await request();
        await deviceStore.put<OperatorCache>(OPERATOR_KEY, { snapshot: cacheSnapshot(result), actions: [], lastSynchronizedAt: new Date().toISOString() });
      });
      await reload();
    } catch (e) { setError((e as Error).message); }
  }, [reload, request]);
  return { state, dispatch, status, error, reload, retry: reload, cancelPending, hasLoaded, hasPending: pendingCount > 0, pendingCount, lastSync, conflict, online: network.online };
}
