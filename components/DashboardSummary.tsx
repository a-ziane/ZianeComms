'use client';

import type { DashboardMetrics } from '@/types';

interface DashboardSummaryProps {
  metrics: DashboardMetrics;
}

interface StatRowProps {
  label: string;
  value: number;
  max: number;
  color: string;
}

function StatRow({ label, value, max, color }: StatRowProps) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-36 shrink-0 text-sm text-slate-300 text-right">{label}</div>
      <div className="flex-1 h-5 bg-[#1e2d45] rounded overflow-hidden">
        <div
          className={`h-full rounded transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="w-8 text-sm font-bold text-white tabular-nums text-right">{value}</div>
    </div>
  );
}

export default function DashboardSummary({ metrics }: DashboardSummaryProps) {
  const maxVal = Math.max(
    metrics.incomingCalls,
    metrics.answeredCalls,
    metrics.missedCalls,
    metrics.recoveredCallers,
    metrics.activeResponders,
    metrics.awaitingCallback,
    metrics.priority0Count,
    metrics.resolvedCases,
    1
  );

  return (
    <div className="bg-[#1a2236] border border-[#2a3650] rounded-xl p-5">
      <h2 className="text-base font-bold text-white text-center mb-5">Dashboard Summary</h2>
      <div className="space-y-3">
        <StatRow label="Incoming calls" value={metrics.incomingCalls} max={maxVal} color="bg-blue-500" />
        <StatRow label="Answered calls" value={metrics.answeredCalls} max={maxVal} color="bg-blue-400" />
        <StatRow label="Missed calls" value={metrics.missedCalls} max={maxVal} color="bg-slate-500" />
        <StatRow label="Recovered callers" value={metrics.recoveredCallers} max={maxVal} color="bg-emerald-500" />
        <StatRow label="Active responders" value={metrics.activeResponders} max={maxVal} color="bg-purple-400" />
        <StatRow label="Awaiting callback" value={metrics.awaitingCallback} max={maxVal} color="bg-amber-500" />
        <StatRow label="Priority 0 callers" value={metrics.priority0Count} max={maxVal} color="bg-red-500" />
        <StatRow label="Resolved cases" value={metrics.resolvedCases} max={maxVal} color="bg-emerald-400" />
      </div>
    </div>
  );
}
