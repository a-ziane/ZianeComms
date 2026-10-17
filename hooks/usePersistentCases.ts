'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DISASTER_CALLERS, CLINIC_CALLERS, MOCK_RESPONDERS } from '@/data/callers';
import { caseReducer, type CaseAction, type CaseState } from '@/lib/cases';

const EMPTY_STATE: CaseState = { rulebook: 'disaster', callersByMode: { disaster: DISASTER_CALLERS, clinic: CLINIC_CALLERS }, responders: MOCK_RESPONDERS };
interface LoadResult { state: CaseState; revision: number }
interface Pending { command: Exclude<CaseAction, { type: 'switch_mode' }>; revision: number; mutationId: string }

export function usePersistentCases() {
  const [state, setState] = useState<CaseState>(EMPTY_STATE);
  const current = useRef({ state: EMPTY_STATE, revision: 0 });
  const [status, setStatus] = useState<'loading'|'ready'|'saving'|'error'>('loading');
  const [error, setError] = useState('');
  const [hasLoaded, setHasLoaded] = useState(false);
  const pending = useRef<Pending>();
  const enabled = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const apply = useCallback((result: LoadResult) => {
    const next = { ...result.state, rulebook: current.current.state.rulebook };
    current.current = { state: next, revision: result.revision }; setState(next); setHasLoaded(true);
  }, []);
  const request = useCallback(async (body?: Pending): Promise<LoadResult> => {
    const response = await fetch('/api/operations', body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Database request failed.');
    return result;
  }, []);
  const reload = useCallback(async () => {
    if (pending.current) { setError('An action is awaiting confirmation. Retry that action before reloading.'); return; }
    enabled.current = false; setStatus('loading');
    try { apply(await request()); setError(''); enabled.current = true; setStatus('ready'); }
    catch (e) { setStatus('error'); setError((e as Error).message); }
  }, [apply, request]);
  useEffect(() => { void reload(); }, [reload]);
  const send = useCallback(async (operation: Pending) => {
    pending.current = operation; enabled.current = false; setStatus('saving');
    try { apply(await request(operation)); pending.current = undefined; setError(''); enabled.current = true; setStatus('ready'); }
    catch (e) { setError((e as Error).message + ' The action remains pending in this tab; retry before closing or refreshing.'); setStatus('error'); }
  }, [apply, request]);
  const retry = useCallback(() => pending.current ? send(pending.current) : reload(), [send, reload]);
  const dispatch = useCallback((action: CaseAction) => {
    if (action.type === 'switch_mode') {
      const next = caseReducer(current.current.state, action); current.current.state = next; setState(next); return;
    }
    if (!enabled.current) { setError('Database is not ready. This action was not applied.'); return; }
    queue.current = queue.current.then(async () => {
      if (pending.current) { setError('Previous action is not confirmed. Retry it before making another change.'); return; }
      const operation = { command: action, revision: current.current.revision, mutationId: crypto.randomUUID() };
      await send(operation);
    });
  }, [send]);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => { if (pending.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', protect); return () => window.removeEventListener('beforeunload', protect);
  }, []);
  const cancelPending = useCallback(async () => { pending.current = undefined; await reload(); }, [reload]);
  return { state, dispatch, status, error, reload, retry, cancelPending, hasLoaded, hasPending: !!pending.current };
}
