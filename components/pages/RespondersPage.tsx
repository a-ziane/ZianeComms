'use client';

import type { Caller, Responder, ResponderStatus, Rulebook } from '@/types';
import { AREA_LABELS, LANGUAGE_LABELS, tagLabel } from '@/config/matching';
import { STATUS_STYLES } from '@/components/ResponderPicker';

export default function RespondersPage({ responders, callers, onStatusChange, rulebook, readOnly = false, configurationPanel }: {
  configurationPanel?: React.ReactNode;
  readOnly?: boolean;
  responders: Responder[];
  callers: Caller[];
  onStatusChange: (id: string, status: ResponderStatus) => void;
  rulebook: Rulebook;
}) {
  return (
    <div className="flex-1 p-6 overflow-y-auto">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-xl font-black text-white mb-2">Responders</h1>
        <p className="text-sm text-slate-400 mb-6">{rulebook === 'disaster' ? 'Disaster' : 'Clinic'} responders — status changes update recommendations immediately. Workload counts active assignments across both modes.</p>
        {configurationPanel}
        {(['available', 'busy', 'offline'] as ResponderStatus[]).map(status => <section key={status} className="mb-6">
          <h2 className="capitalize font-bold text-sm text-slate-300 mb-3">{status} responders ({responders.filter(r => r.status === status).length})</h2>
          <div className="space-y-3">
            {responders.filter(r => r.status === status).map(r => <div key={r.id} className="bg-[#1e2d45] border border-[#2a3650] rounded-xl px-4 py-4">
              <div className="flex items-center justify-between gap-4">
                <div><span className="text-sm font-bold text-white">{r.name}</span><span className={`text-xs ml-2 px-2 py-1 rounded capitalize ${STATUS_STYLES[r.status]}`}>{r.status}</span>
                  <div className="text-xs text-slate-400 mt-2">{r.role} · {r.location}</div></div>
                <div className="text-right text-xs text-slate-400"><div className="font-bold text-white text-lg">{r.activeCallers}</div>active cases</div>
              </div>
              <div className="text-xs text-slate-400 mt-2 space-y-1">
                <div>Expertise: {r.expertise.map(tagLabel).join(', ')}</div>
                <div>Languages: {r.languages.map(l => LANGUAGE_LABELS[l]).join(', ')}</div>
                <div>Approved interpreters: {r.interpreterLanguages.map(l => LANGUAGE_LABELS[l]).join(', ') || 'None'}</div>
                <div>Coverage: {r.coverageAreas.map(a => AREA_LABELS[a]).join(', ')}</div>
                <div>Experience: {r.experience.map(tagLabel).join(', ') || 'None listed'}</div>
                <div>Assigned active cases: {r.assignedCaseIds.map(id => callers.find(c => c.id === id)?.name ?? id).join(', ') || 'None'}</div>
              </div>
              <label className="text-xs text-slate-300 block mt-3">Status for {r.name}
                <select disabled={readOnly} value={r.status} onChange={e => onStatusChange(r.id, e.target.value as ResponderStatus)} className="ml-2 rounded border border-[#2a3650] px-2 py-1 bg-[#141e30] text-white">
                  <option value="available">Available</option><option value="busy">Busy</option><option value="offline">Offline</option>
                </select>
              </label>
            </div>)}
          </div>
        </section>)}
      </div>
    </div>
  );
}
