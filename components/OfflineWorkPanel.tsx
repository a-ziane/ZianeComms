'use client';
import { useState } from 'react';
import type { Caller, CallOutcome } from '@/types';
import { recordOutcome, recordCallbackAttempt, type CaseAction } from '@/lib/cases';
export default function OfflineWorkPanel({ callers, dispatch, disabled = false }: { callers: Caller[]; dispatch: (action: CaseAction) => void; disabled?: boolean }) {
  const [id, setId] = useState(''), [note, setNote] = useState('');
  const caller = callers.find(c => c.id === id);
  const outcome = (value: CallOutcome) => { if (caller) { const result = recordOutcome(value, caller); dispatch({ type: 'patch', rulebook: caller.rulebook, id: caller.id, patch: result.callerPatch, logEntry: result.logEntry }); } };
  return <fieldset disabled={disabled} className="px-4 py-2 text-xs border-b border-amber-800 bg-amber-950/30 flex flex-wrap items-center gap-3">
    <strong>Offline work · queued on this device</strong>
    <select aria-label="Cached case" className="bg-slate-800 p-1 max-w-48" value={id} onChange={e => setId(e.target.value)}><option value="">Select cached case</option>{callers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
    <input aria-label="Offline note" placeholder="Add operator note" maxLength={2000} value={note} onChange={e => setNote(e.target.value)} className="bg-slate-800 p-1" />
    <button disabled={!caller || !note.trim()} className="underline disabled:opacity-40" onClick={() => { if (caller && note.trim()) { dispatch({ type: 'note', rulebook: caller.rulebook, id: caller.id, note, eventId: crypto.randomUUID(), timestamp: new Date().toISOString() }); setNote(''); } }}>Save note</button>
    <button disabled={!caller} className="underline disabled:opacity-40" onClick={() => { if (caller) dispatch({ type: 'patch', rulebook: caller.rulebook, id: caller.id, patch: { status: 'calling' }, logEntry: recordCallbackAttempt(caller, new Date().toISOString()) }); }}>Record callback attempt</button>
    <select aria-label="Offline callback outcome" value="" className="bg-slate-800 p-1" disabled={!caller} onChange={e => outcome(e.target.value as CallOutcome)}><option value="">Record outcome…</option>{(['no_answer','needs_followup','resolved','referred'] as const).map(o => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}</select>
    <span className="text-amber-200">Assignments and priority overrides require connection and current review.</span>
  </fieldset>;
}
