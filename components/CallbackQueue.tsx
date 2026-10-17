'use client';

import type { Caller, Priority } from '@/types';
import {caseProvenance} from '@/lib/cases/recovery';
import { maskPhone } from '@/lib/scoring';

interface CallbackQueueProps {
  callers: Caller[];
  selectedCallerId: string | null;
  onCallerClick: (caller: Caller) => void;
}

export const PRIORITY_STYLES: Record<Priority, {
  badge: string;
  badgeText: string;
  row: string;
  label: string;
}> = {
  0: {
    badge: 'bg-red-600',
    badgeText: 'text-white font-black',
    row: 'border-l-4 border-red-500',
    label: 'Critical',
  },
  1: {
    badge: 'bg-orange-500',
    badgeText: 'text-white font-black',
    row: 'border-l-4 border-orange-400',
    label: 'Urgent',
  },
  2: {
    badge: 'bg-yellow-400',
    badgeText: 'text-gray-900 font-black',
    row: 'border-l-4 border-yellow-400',
    label: 'Moderate',
  },
  3: {
    badge: 'bg-emerald-600',
    badgeText: 'text-white font-black',
    row: 'border-l-4 border-emerald-500',
    label: 'Standard',
  },
};

function formatWait(mins: number): string {
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export default function CallbackQueue({ callers, selectedCallerId, onCallerClick }: CallbackQueueProps) {
  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="px-4 py-3 border-b border-[#2a3650]">
        <h2 className="text-base font-bold text-white text-center">CallBack Queue</h2>
        <p className="text-xs text-slate-500 text-center mt-0.5">
          {callers.length} caller{callers.length !== 1 ? 's' : ''} — Priority → Name — Reason — Location — Attempts
        </p>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 p-3">
        {callers.length === 0 && (
          <div className="text-center text-slate-500 text-sm py-10">
            Queue is clear — no active callers.
          </div>
        )}
        {callers.map((caller) => {
          const p = caller.priority;
          const styles = PRIORITY_STYLES[p];
          const isSelected = caller.id === selectedCallerId;

          return (
            <button
              key={caller.id}
              onClick={() => onCallerClick(caller)}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all text-left
                bg-[#1e2d45] hover:bg-[#243350]
                ${styles.row}
                ${isSelected ? 'ring-2 ring-blue-400 bg-[#1e3060]' : ''}
              `}
              aria-label={`Select ${caller.name}, Priority ${p}`}
            >
              {/* Priority badge */}
              <div className={`w-9 h-9 rounded-lg ${styles.badge} flex items-center justify-center shrink-0 text-lg ${styles.badgeText}`}>
                {p}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-white truncate">{caller.name}</span>
                  {caseProvenance(caller)!=='live'&&<span className="text-xs text-amber-200">{caseProvenance(caller)==='integration_test'?'INTEGRATION TEST':'SEEDED DEMO'}</span>}
                  {caller.manualPriority && (
                    <span className="text-xs bg-purple-800 text-purple-200 border border-purple-600 px-1.5 py-0.5 rounded font-semibold leading-none">
                      OVERRIDE
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-400 mt-0.5 truncate">
                  {caller.needSummary} · {caller.location}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {formatWait(caller.waitMinutes)} wait · {caller.attempts} attempt{caller.attempts !== 1 ? 's' : ''}
                </div>
              </div>

              {/* Phone (masked) */}
              <div className="text-xs text-slate-500 font-mono shrink-0 hidden sm:block">
                {maskPhone(caller.phone)}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
