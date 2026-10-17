'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Caller, MatchingResult, Priority, Responder, ResponderMatch } from '@/types';
import { deploymentResponders } from '@/lib/cases/deployment';
import { matchResponders } from '@/lib/matching';
import { recommendationSignature } from '@/lib/cases';

export const STATUS_STYLES = {
  available: 'bg-emerald-900 text-emerald-200', busy: 'bg-amber-950 text-amber-200', offline: 'bg-slate-800 text-slate-400',
};
export function MatchExplanation({ match }: { match: ResponderMatch }) {
  return <ul className="space-y-1 text-xs text-slate-300">
    {match.breakdown.map(factor => <li key={factor.factor}><span className="font-bold text-blue-300">+{factor.points}</span> {factor.reason}</li>)}
  </ul>;
}

export default function ResponderPicker({ caller, responders, onRecommendationShown, onAssign }: {
  caller: Caller;
  responders: Responder[];
  onRecommendationShown?: (callerId: string, result: MatchingResult, priority: Priority) => void;
  onAssign: (callerId: string, responderId: string, reason?: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [reason, setReason] = useState('');
  const { needCategory, language, coverageArea, rulebook, deploymentId } = caller;
  const result = useMemo(() => matchResponders({ needCategory, language, coverageArea, rulebook }, deploymentResponders({ deploymentId }, responders)),
    [needCategory, language, coverageArea, rulebook, deploymentId, responders]);
  const signature = recommendationSignature(result, caller.priority);
  const logged = useRef<string>();
  useEffect(() => {
    if (logged.current !== signature && onRecommendationShown) {
      logged.current = signature;
      onRecommendationShown(caller.id, result, caller.priority);
    }
  }, [signature, onRecommendationShown, caller.id, caller.priority, result]);
  const ready = caller.lastRecommendation?.signature === signature;
  const primary = result.candidates.find(c => c.responderId === result.recommendedResponderId);
  const expertise = result.candidates.find(c => c.responderId === result.bestExpertiseResponderId);
  const responder = (id: string) => responders.find(r => r.id === id)!;
  const assign = (match: ResponderMatch) => onAssign(caller.id, match.responderId, reason.trim() || undefined);

  return <div className="mb-4 bg-[#141e30] border border-[#2a3650] rounded-xl p-4 max-h-[48vh] overflow-y-auto">
    <h3 className="text-xs font-bold text-slate-300 uppercase mb-2">{result.strongAvailableMatch ? 'Recommended Responder' : 'Best Available — Review Required'}</h3>
    <p className={`text-xs mb-3 ${result.strongAvailableMatch ? 'text-slate-400' : 'text-amber-300'}`}>{result.explanation}</p>
    <label className="block text-xs text-slate-400 mb-3">Assignment / reassignment reason (optional)
      <input value={reason} onChange={e => setReason(e.target.value)} className="block w-full mt-1 rounded border border-[#2a3650] bg-[#1e2d45] text-white px-3 py-2" />
    </label>
    {primary && <div className="bg-[#1e2d45] rounded-xl border border-blue-800 p-3 mb-3">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <strong>{responder(primary.responderId).name}</strong><span className="text-blue-300 font-bold">{primary.rawScore}% Match</span>
        <span className={`text-xs px-2 py-1 rounded capitalize ${STATUS_STYLES[primary.status]}`}>{primary.status}</span>
      </div>
      <div className="text-xs font-bold text-slate-400 mb-1">Why {responder(primary.responderId).name}?</div>
      <MatchExplanation match={primary} />
      <button disabled={!ready || caller.assignedResponderId === primary.responderId} onClick={() => assign(primary)}
        className="mt-3 px-4 py-2 bg-blue-700 rounded-lg font-bold text-sm disabled:opacity-40">
        {caller.assignedResponderId === primary.responderId ? 'Currently assigned' : `Assign ${responder(primary.responderId).name}`}
      </button>
    </div>}
    {!result.strongAvailableMatch && expertise && expertise.responderId !== primary?.responderId && <div className="border border-amber-800 rounded-lg p-3 mb-3 text-xs">
      <strong>Best expertise match: {responder(expertise.responderId).name} — {expertise.rawScore}% Match, currently {expertise.status}</strong>
      <MatchExplanation match={expertise} />
      <p className="mt-1 text-slate-400">Review availability before manually choosing this alternative.</p>
    </div>}
    <button className="text-xs text-blue-300 font-bold underline" onClick={() => setShowAll(v => !v)}>{showAll ? 'Hide alternatives' : 'See All Responders'}</button>
    {showAll && <div className="space-y-2 mt-3">
      {result.candidates.length === 0 && <p className="text-sm text-slate-400">No responders registered for this mode.</p>}
      {result.candidates.map((match, index) => <div key={match.responderId} className="rounded-lg p-3 border border-[#2a3650] bg-[#1e2d45]">
        <div className="flex justify-between gap-2 flex-wrap text-sm">
          <strong>{index + 1}. {responder(match.responderId).name} — {match.rawScore}% Match</strong>
          <span className={`text-xs px-2 py-1 rounded capitalize ${STATUS_STYLES[match.status]}`}>{match.status}</span>
        </div>
        <p className="text-xs text-slate-400 my-1">{match.activeCases} active cases · {match.breakdown[0].reason}{match.activeCases >= 3 ? ' · High workload' : ''}</p>
        <details className="text-xs text-slate-300"><summary className="cursor-pointer mb-1">Why this match? Full score breakdown</summary><MatchExplanation match={match} /></details>
        <button disabled={!ready || match.status === 'offline' || caller.assignedResponderId === match.responderId}
          onClick={() => assign(match)} className="mt-2 px-3 py-1 rounded bg-blue-800 text-xs font-bold disabled:opacity-40">
          {match.status === 'offline' ? 'Offline — unavailable' : caller.assignedResponderId === match.responderId ? 'Currently assigned' : `Assign ${responder(match.responderId).name}${match.status === 'busy' ? ' (Busy)' : ''}`}
        </button>
      </div>)}
    </div>}
  </div>;
}
