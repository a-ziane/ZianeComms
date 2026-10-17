'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Caller, Priority, CallOutcome, ActivityType, Responder, MatchingResult } from '@/types';
import { maskPhone } from '@/lib/scoring';
import { requiresSafetyConfirmation } from '@/lib/engine';
import ResponderPicker from './ResponderPicker';
import { PRIORITY_STYLES } from './CallbackQueue';

interface CallerDetailModalProps {
  caller: Caller;
  readOnly?: boolean;
  responders?: Responder[];
  onRecommendationShown?: (callerId: string, result: MatchingResult, priority: Priority) => void;
  onClose: () => void;
  onStartCall: (callerId: string) => void;
  onRecordOutcome: (callerId: string, outcome: CallOutcome) => void;
  onChangePriority: (callerId: string, priority: Priority, reason: string, safetyConfirmed?: boolean) => void;
  onAssignResponder: (callerId: string, responderId: string, reason?: string) => void;
}

// ── Activity helpers ───────────────────────────────────────────────────────────

const ACTIVITY_ICONS: Record<ActivityType, string> = {
  call_received: '📞',
  conversation_completed: '📱',
  human_followup_requested: '↻',
  priority_calculated: '🔀',
  sms_received: '💬',
  sms_sent:                '💬',
  questionnaire_sent:      '📋',
  questionnaire_completed: '✅',
  form_sent:               '📄',
  form_completed:          '✅',
  info_provided:           'ℹ️',
  told_call_911:           '🚨',
  callback_requested:      '📞',
  priority_changed:        '🔀',
  responder_assigned:      '👤',
  recommendation_shown:    '💡',
  call_attempted:          '📱',
  case_closed:             '🔒',
  followup_required:       '↻',
  priority_recalculated:   '🔀',
};

const ACTIVITY_COLORS: Record<ActivityType, string> = {
  call_received: 'border-blue-600 bg-blue-950/50',
  conversation_completed: 'border-blue-600 bg-blue-950/50',
  human_followup_requested: 'border-orange-600 bg-orange-950/50',
  priority_calculated: 'border-purple-600 bg-purple-950/50',
  sms_received: 'border-blue-600 bg-blue-950/50',
  sms_sent:                'border-blue-600   bg-blue-950/50',
  questionnaire_sent:      'border-slate-600  bg-slate-800/40',
  questionnaire_completed: 'border-emerald-600 bg-emerald-950/50',
  form_sent:               'border-slate-600  bg-slate-800/40',
  form_completed:          'border-emerald-600 bg-emerald-950/50',
  info_provided:           'border-cyan-600   bg-cyan-950/50',
  told_call_911:           'border-red-500    bg-red-950/60',
  callback_requested:      'border-amber-600  bg-amber-950/50',
  priority_changed:        'border-purple-600 bg-purple-950/50',
  responder_assigned:      'border-indigo-600 bg-indigo-950/50',
  recommendation_shown:    'border-blue-600 bg-blue-950/50',
  call_attempted:          'border-blue-600   bg-blue-950/50',
  case_closed:             'border-slate-500  bg-slate-800/40',
  followup_required:       'border-orange-600 bg-orange-950/50',
  priority_recalculated:   'border-purple-600 bg-purple-950/50',
};

function formatTime(iso: string): string {
  const diffMins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMins < 1)  return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const h = Math.floor(diffMins / 60);
  return `${h}h ${diffMins % 60}m ago`;
}

const CLOSE_OUTCOMES: { value: CallOutcome; label: string; style: string }[] = [
  { value: 'resolved',       label: '✓ Resolved',        style: 'bg-emerald-700 hover:bg-emerald-600 border-emerald-500 text-white' },
  { value: 'referred',       label: '↗ Referred',        style: 'bg-purple-700  hover:bg-purple-600  border-purple-500  text-white' },
  { value: 'no_answer',      label: '⊘ No Answer',       style: 'bg-slate-700   hover:bg-slate-600   border-slate-500   text-white' },
  { value: 'needs_followup', label: '↻ Needs Follow-Up', style: 'bg-orange-700  hover:bg-orange-600  border-orange-500  text-white' },
  { value: 'duplicate',      label: '= Duplicate',       style: 'bg-slate-700   hover:bg-slate-600   border-slate-500   text-white' },
  { value: 'unable_to_reach',label: '✕ Unable to Reach', style: 'bg-red-800     hover:bg-red-700     border-red-600     text-white' },
];

// ── Component ──────────────────────────────────────────────────────────────────

export default function CallerDetailModal({
  caller,
  readOnly = false,
  responders = [],
  onRecommendationShown,
  onClose,
  onStartCall,
  onRecordOutcome,
  onChangePriority,
  onAssignResponder,
}: CallerDetailModalProps) {
  const [activeAction, setActiveAction] = useState<'responder' | 'priority' | 'close' | null>(null);
  const [priorityReason, setPriorityReason]   = useState('');
  const [selectedPriority, setSelectedPriority] = useState<Priority | null>(null);

  const [safetyConfirmed, setSafetyConfirmed] = useState(false);
  const safetyDowngrade = selectedPriority !== null && requiresSafetyConfirmation(caller, selectedPriority);
  const rawScore = caller.scoreBreakdown.reduce((sum, item) => sum + item.points, 0);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const toggleAction = useCallback((a: 'responder' | 'priority' | 'close') => {
    setActiveAction(prev => prev === a ? null : a);
    setSafetyConfirmed(false);
  }, []);

  const p       = caller.priority;
  const pStyles = PRIORITY_STYLES[p];
  const isCalling = caller.status === 'calling';
  const isClosed  = ['resolved', 'referred', 'duplicate', 'unable_to_reach'].includes(caller.status);
  const maxPts    = Math.max(...caller.scoreBreakdown.map(b => b.points), 1);

  // Border accent colour for the left edge of the modal
  const accentBorder: Record<Priority, string> = {
    0: 'border-l-red-500',
    1: 'border-l-orange-400',
    2: 'border-l-yellow-400',
    3: 'border-l-emerald-500',
  };

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={`Caller detail: ${caller.name}`}
    >
      {/* Modal shell — 92vw × 92vh, two columns */}
      <div
        className={`relative w-full max-w-6xl h-[92vh] bg-[#111827] rounded-2xl border border-[#2a3650] border-l-4 ${accentBorder[p]} shadow-2xl flex flex-col overflow-hidden`}
        onClick={e => e.stopPropagation()}
      >

        {/* ── Header bar ──────────────────────────────────────────────────── */}
        <div className="shrink-0 flex items-center gap-4 px-6 py-4 bg-[#0d1526] border-b border-[#2a3650]">
          {/* Priority pill */}
          <div className={`flex items-center gap-2.5 px-4 py-2 rounded-xl ${pStyles.badge} shrink-0`}>
            <span className={`text-3xl font-black leading-none ${pStyles.badgeText}`}>{p}</span>
            <div>
              <div className={`text-xs font-bold uppercase tracking-wider ${pStyles.badgeText} opacity-80`}>Priority</div>
              <div className={`text-sm font-black ${pStyles.badgeText}`}>{pStyles.label}</div>
            </div>
          </div>

          {/* Name + phone */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-black text-white leading-tight">{caller.name}</h1>
              {caller.hardEscalation && (
                <span className="text-xs bg-red-900 text-red-200 border border-red-500 px-2 py-1 rounded-lg font-bold tracking-wide animate-pulse">
                  ⚠ HARD ESCALATION
                </span>
              )}
              {caller.manualPriority && (
                <span className="text-xs bg-purple-800 text-purple-200 border border-purple-500 px-2 py-1 rounded-lg font-bold tracking-wide">
                  HUMAN OVERRIDE
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <span className="text-lg font-bold text-slate-300 font-mono tracking-widest">{maskPhone(caller.phone)}</span>
              <StatusBadge status={caller.status} />
              {caller.manualPriority && caller.originalCalculatedPriority !== undefined && (
                <span className="text-xs text-slate-500">
                  (latest engine: {caller.calculatedPriority})
                </span>
              )}
            </div>
          </div>

          {/* Close button */}
          <button
            onClick={onClose}
            className="shrink-0 w-10 h-10 rounded-xl bg-[#1e2d45] hover:bg-[#2a3a55] border border-[#2a3650] flex items-center justify-center text-slate-400 hover:text-white transition-colors text-xl font-bold"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* ── Two-column body ──────────────────────────────────────────────── */}
        <div className="flex-1 flex min-h-0 overflow-hidden">

          {/* Left column — identity + summary + priority breakdown */}
          <div className="w-[42%] shrink-0 flex flex-col border-r border-[#2a3650] overflow-y-auto">
            <div className="px-6 py-5 space-y-5">

              {/* Identity facts grid */}
              <section>
                <SectionLabel>Caller Information</SectionLabel>
                <div className="grid grid-cols-2 gap-2">
                  <FactCell label="Location"  value={caller.location} />
                  <FactCell label="Language"  value={caller.language} />
                  <FactCell label="Wait time" value={`${caller.waitMinutes} min`} />
                  <FactCell label="Attempts"  value={`${caller.attempts}×`} />
                  <div className="col-span-2">
                    <FactCell label="Reason for call" value={caller.needSummary} />
                  </div>
                </div>
              </section>

              {caller.assignedResponderId && <section>
                <SectionLabel>Assigned Responder</SectionLabel>
                <p className="text-sm font-bold text-blue-200">{responders.find(r => r.id === caller.assignedResponderId)?.name ?? caller.assignedResponderId}</p>
              </section>}

              {/* AI Summary */}
              <section>
                <SectionLabel>AI-Generated Summary</SectionLabel>
                <p className="text-sm text-slate-200 leading-relaxed bg-[#1a2740] border border-[#2a3650] rounded-xl px-4 py-3">
                  {caller.aiSummary}
                </p>
              </section>

              {/* Why this priority */}
              <section>
                <SectionLabel>Why this priority?</SectionLabel>

                {/* Hard escalation banner */}
                {caller.hardEscalation && (
                  <div className="mb-3 flex items-start gap-3 bg-red-950 border border-red-600 rounded-xl px-4 py-3">
                    <span className="text-red-400 text-lg shrink-0 mt-0.5">⚠</span>
                    <div>
                      <div className="text-sm font-black text-red-300 uppercase tracking-wide mb-0.5">Hard Safety Escalation — Priority 0</div>
                      <p className="text-xs text-red-400 leading-snug">{caller.escalationReason ?? 'A hard safety rule was triggered.'}</p>
                    </div>
                  </div>
                )}

                {/* Human override context */}
                {caller.manualPriority && (
                  <div className="mb-3 flex items-start gap-3 bg-purple-950 border border-purple-600 rounded-xl px-4 py-3">
                    <span className="text-purple-400 text-lg shrink-0 mt-0.5">✎</span>
                    <div>
                      <div className="text-sm font-bold text-purple-300 mb-0.5">Human Override Active</div>
                      <p className="text-xs text-purple-400 leading-snug">
                        Latest engine calculation: Priority {caller.calculatedPriority}.
                        {caller.originalCalculatedPriority !== undefined && <> Calculation when override was set: Priority {caller.originalCalculatedPriority}. </>}
                        Active human override: Priority {caller.overridePriority ?? caller.priority}.
                        {caller.manualPriorityReason && <><br/>Reason: <span className="text-purple-200">{caller.manualPriorityReason}</span></>}
                      </p>
                    </div>
                  </div>
                )}

                <div className="space-y-2.5">
                  {caller.scoreBreakdown.map((item, idx) => {
                    const pct = item.points > 0 ? Math.round((item.points / maxPts) * 100) : 0;
                    const catColors: Record<string, string> = {
                      facility:     'text-amber-400  bg-amber-950/60  border-amber-800',
                      need:         'text-amber-400  bg-amber-950/60  border-amber-800',
                      context:      'text-cyan-400   bg-cyan-950/60   border-cyan-800',
                      access:       'text-slate-400  bg-slate-800/60  border-slate-700',
                      agentOutcome: 'text-indigo-400 bg-indigo-950/60 border-indigo-800',
                    };
                    const catStyle = catColors[item.category] ?? catColors.access;
                    const isEscalation = item.points === 0 && caller.hardEscalation;
                    return (
                      <div key={idx} className={`bg-[#1a2740] border border-[#2a3650] rounded-xl px-4 py-3 ${isEscalation ? 'border-red-800' : ''}`}>
                        <div className="flex items-center justify-between mb-1.5 gap-2 flex-wrap">
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider ${catStyle}`}>
                              {item.category}
                            </span>
                            <span className="text-sm font-semibold text-white">{item.label}</span>
                          </div>
                          {isEscalation
                            ? <span className="text-xs font-black text-red-400">ESCALATE</span>
                            : <span className={`text-sm font-black tabular-nums ${item.points < 0 ? 'text-emerald-400' : 'text-white'}`}>
                                {item.points >= 0 ? '+' : ''}{item.points}
                              </span>
                          }
                        </div>
                        {item.points > 0 && (
                          <div className="h-2 bg-[#0d1526] rounded-full overflow-hidden mb-1.5">
                            <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                          </div>
                        )}
                        <p className="text-xs text-slate-400 leading-snug">{item.reason}</p>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 flex items-center justify-between text-xs border-t border-[#2a3650] pt-3">
                  <span className="text-slate-500">Deterministic · rule-based · fully explainable</span>
                  <span className="text-slate-300 font-bold">
                    Raw score: <span className="text-white">{rawScore}</span>
                    <br />Final score: <span className="text-white">{caller.score}</span>
                    {rawScore !== caller.score && (rawScore > 100 ? ' (capped at 100)' : ' (floored at 0)')}
                    {' · '}Priority: <span className="text-white">{caller.priority}</span>
                  </span>
                </div>
              </section>

              {/* Customer Fit (clinic only) */}
              {caller.customerFit && caller.customerFit.label !== 'N/A' && (
                <section>
                  <SectionLabel>Customer Fit</SectionLabel>
                  <div className="bg-[#1a2740] border border-[#2a3650] rounded-xl px-4 py-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-bold text-white">Customer Fit Score</span>
                      <span className="text-lg font-black text-blue-300 tabular-nums">{caller.customerFit.score}%</span>
                    </div>
                    <div className="h-2 bg-[#0d1526] rounded-full overflow-hidden mb-2">
                      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${caller.customerFit.score}%` }} />
                    </div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-blue-400 font-semibold">{caller.customerFit.label}</span>
                      <span className="text-xs text-slate-500">Independent of urgency priority</span>
                    </div>
                    <div className="space-y-1">
                      {caller.customerFit.reasons.map((r, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="text-slate-400">{r.label}</span>
                          <span className="text-slate-300 font-bold">+{r.points}</span>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-slate-600 mt-2 border-t border-[#2a3650] pt-2">
                      Customer Fit does not affect urgency priority. Priority {caller.priority} reflects safety/urgency only.
                    </p>
                  </div>
                </section>
              )}

            </div>
          </div>

          {/* Right column — questionnaire + activity timeline */}
          <div className="flex-1 flex flex-col overflow-y-auto">
            <div className="px-6 py-5 space-y-5">

              {/* Questionnaire */}
              <section>
                <SectionLabel>Questionnaire ({caller.questionnaire.length} questions)</SectionLabel>
                <div className="space-y-2">
                  {caller.questionnaire.map((qa, idx) => (
                    <div key={idx} className="bg-[#1a2740] border border-[#2a3650] rounded-xl px-4 py-3">
                      <div className="text-xs text-slate-400 mb-1 font-medium">Q{idx + 1}. {qa.question}</div>
                      <div className="text-sm text-white font-medium leading-snug">{qa.answer}</div>
                    </div>
                  ))}
                </div>
              </section>

              {/* ZianeComms Actions timeline */}
              <section>
                <SectionLabel>ZianeComms Actions</SectionLabel>
                <div className="space-y-2">
                  {caller.activityLog.map((entry, idx) => (
                    <div
                      key={entry.id}
                      className={`border rounded-xl px-4 py-3 ${ACTIVITY_COLORS[entry.type]}`}
                    >
                      <div className="flex items-start gap-3">
                        {/* Icon + connector */}
                        <div className="flex flex-col items-center shrink-0 pt-0.5">
                          <span className="text-base leading-none">{ACTIVITY_ICONS[entry.type]}</span>
                          {idx < caller.activityLog.length - 1 && (
                            <div className="w-px flex-1 bg-white/10 mt-1.5 mb-[-4px] min-h-[8px]" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 flex-wrap mb-0.5">
                            <span className="text-sm font-semibold text-slate-100">{entry.label}</span>
                            <span className="text-xs text-slate-500 shrink-0 tabular-nums">{formatTime(entry.timestamp)}</span>
                          </div>
                          {entry.detail && (
                            <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-line">
                              {entry.detail}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

            </div>
          </div>
        </div>

        {/* ── Action bar ───────────────────────────────────────────────────── */}
        <fieldset disabled={readOnly} className="shrink-0 min-w-0 border-t border-[#2a3650] bg-[#0d1526] px-6 py-4">

          {/* Sub-panels (shown above the buttons when active) */}
          {activeAction === 'responder' && (
            <ResponderPicker caller={caller} responders={responders} onRecommendationShown={onRecommendationShown}
              onAssign={(id, responderId, reason) => { onAssignResponder(id, responderId, reason); setActiveAction(null); }} />
          )}

          {activeAction === 'priority' && (
            <div className="mb-4 bg-[#141e30] border border-[#2a3650] rounded-xl p-4">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                Change Priority <span className="text-slate-600 normal-case font-normal">— current: {p} ({pStyles.label})</span>
              </div>
              <div className="grid grid-cols-4 gap-2 mb-3">
                {([0, 1, 2, 3] as Priority[]).map(pv => {
                  const pvS = PRIORITY_STYLES[pv];
                  return (
                    <button
                      key={pv}
                      onClick={() => { setSelectedPriority(pv); setSafetyConfirmed(false); }}
                      className={`py-3 rounded-xl border-2 flex flex-col items-center gap-1 transition-all font-black ${pvS.badge} ${pvS.badgeText} ${
                        selectedPriority === pv
                          ? 'ring-2 ring-white ring-offset-2 ring-offset-[#141e30] scale-105'
                          : pv === p ? 'opacity-50' : 'opacity-70 hover:opacity-100'
                      }`}
                    >
                      <span className="text-2xl">{pv}</span>
                      <span className={`text-[10px] font-bold uppercase tracking-wide ${pvS.badgeText}`}>{pvS.label}</span>
                    </button>
                  );
                })}
              </div>
              <input
                type="text"
                placeholder="Reason for override (required before confirming)"
                value={priorityReason}
                onChange={e => setPriorityReason(e.target.value)}
                className="w-full px-4 py-2.5 bg-[#1e2d45] border border-[#2a3650] rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 mb-2"
              />
              {safetyDowngrade && (
                <SafetyOverrideConfirmation
                  escalationReason={caller.escalationReason}
                  confirmed={safetyConfirmed}
                  onConfirm={setSafetyConfirmed}
                />
              )}
              <button
                disabled={selectedPriority === null || !priorityReason.trim() || (safetyDowngrade && !safetyConfirmed)}
                onClick={() => {
                  if (selectedPriority !== null && priorityReason.trim() && (!safetyDowngrade || safetyConfirmed)) {
                    onChangePriority(caller.id, selectedPriority, priorityReason.trim(), safetyConfirmed);
                    setSafetyConfirmed(false);
                    setActiveAction(null);
                    setPriorityReason('');
                    setSelectedPriority(null);
                  }
                }}
                className="w-full py-2.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl text-sm transition-all"
              >
                Confirm Priority Override
              </button>
            </div>
          )}

          {activeAction === 'close' && (
            <div className="mb-4 bg-[#141e30] border border-[#2a3650] rounded-xl p-4">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Record Outcome — Select Outcome</div>
              <div className="grid grid-cols-3 gap-2">
                {CLOSE_OUTCOMES.map(oc => (
                  <button
                    key={oc.value}
                    onClick={() => { onRecordOutcome(caller.id, oc.value); setActiveAction(null); }}
                    className={`py-3 px-3 rounded-xl border text-sm font-semibold transition-all ${oc.style}`}
                  >
                    {oc.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Four main action buttons */}
          {!isClosed ? (
            <div className="grid grid-cols-4 gap-3">
              {/* CALL BACK */}
              {!isCalling ? (
                <button
                  onClick={() => { onStartCall(caller.id); setActiveAction(null); }}
                  className="flex flex-col items-center justify-center gap-1 py-4 bg-blue-700 hover:bg-blue-600 text-white font-black rounded-xl border border-blue-500 transition-all text-sm tracking-wide shadow-lg shadow-blue-900/40"
                >
                  <span className="text-xl">📞</span>
                  <span>CALL BACK</span>
                </button>
              ) : (
                <div className="flex flex-col items-center justify-center gap-1 py-4 bg-blue-950 border border-blue-600 rounded-xl">
                  <span className="w-3 h-3 rounded-full bg-blue-400 animate-pulse" />
                  <span className="text-xs font-bold text-blue-300 text-center">Calling…</span>
                </div>
              )}

              {/* ASSIGN RESPONDER */}
              <ActionBtn
                icon="👤"
                label={caller.assignedResponderId ? "REASSIGN RESPONDER" : "ASSIGN RESPONDER"}
                active={activeAction === 'responder'}
                onClick={() => toggleAction('responder')}
              />

              {/* CHANGE PRIORITY */}
              <ActionBtn
                icon="🔀"
                label="CHANGE PRIORITY"
                active={activeAction === 'priority'}
                onClick={() => toggleAction('priority')}
              />

              {/* CLOSE CASE */}
              <ActionBtn
                icon="🔒"
                label="RECORD OUTCOME"
                active={activeAction === 'close'}
                onClick={() => toggleAction('close')}
                danger
              />
            </div>
          ) : (
            <div className="flex items-center justify-center gap-3 py-4 bg-slate-800/50 border border-slate-600 rounded-xl">
              <span className="text-slate-300 font-bold">
                🔒 Case closed — {caller.status.replace(/_/g, ' ').toUpperCase()}
              </span>
              <button
                onClick={onClose}
                className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded-lg text-sm transition-colors border border-slate-500"
              >
                Return to Queue
              </button>
            </div>
          )}
        </fieldset>

      </div>
    </div>
  );
}

// ── Helper components ──────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
      <span className="flex-1 h-px bg-[#2a3650]" />
      <span>{children}</span>
      <span className="flex-1 h-px bg-[#2a3650]" />
    </h3>
  );
}

function FactCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#1a2740] border border-[#2a3650] rounded-xl px-3 py-2.5">
      <div className="text-xs text-slate-500 uppercase tracking-wide mb-0.5">{label}</div>
      <div className="text-sm font-semibold text-white capitalize leading-snug">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    awaiting_callback: 'bg-amber-950 border-amber-600 text-amber-300',
    calling:           'bg-blue-950  border-blue-600  text-blue-300',
    resolved:          'bg-emerald-950 border-emerald-600 text-emerald-300',
    referred:          'bg-purple-950 border-purple-600 text-purple-300',
    no_answer:         'bg-slate-800 border-slate-600 text-slate-300',
    needs_followup:    'bg-orange-950 border-orange-600 text-orange-300',
    duplicate:         'bg-slate-800 border-slate-600 text-slate-300',
    unable_to_reach:   'bg-red-950   border-red-600   text-red-300',
  };
  return (
    <span className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${map[status] ?? 'bg-slate-800 border-slate-600 text-slate-300'}`}>
      {status.replace(/_/g, ' ').toUpperCase()}
    </span>
  );
}

interface ActionBtnProps {
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
  danger?: boolean;
}
function ActionBtn({ icon, label, active, onClick, danger }: ActionBtnProps) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-1 py-4 rounded-xl border font-black text-sm transition-all ${
        active
          ? 'bg-blue-700 border-blue-500 text-white ring-2 ring-blue-400'
          : danger
          ? 'bg-[#1e2030] hover:bg-red-950 border-[#2a3650] hover:border-red-700 text-slate-300 hover:text-red-300'
          : 'bg-[#1e2d45] hover:bg-[#243a55] border-[#2a3650] hover:border-slate-500 text-slate-300 hover:text-white'
      }`}
    >
      <span className="text-xl">{icon}</span>
      <span className="text-[11px] tracking-wide">{label}</span>
    </button>
  );
}


export function SafetyOverrideConfirmation({ escalationReason, confirmed, onConfirm }: {
  escalationReason?: string;
  confirmed: boolean;
  onConfirm: (confirmed: boolean) => void;
}) {
  return (
    <div role="alert" className="mb-3 p-3 rounded-xl border border-red-600 bg-red-950 text-sm text-red-200">
      <p className="font-bold">This case was escalated to Priority 0 by a safety rule.</p>
      <p className="mt-1">{escalationReason ?? 'A hard safety rule was triggered.'}</p>
      <label className="flex items-start gap-2 mt-2">
        <input type="checkbox" checked={confirmed} onChange={e => onConfirm(e.target.checked)} />
        <span>I reviewed the safety escalation and explicitly confirm this downgrade. An override reason is required.</span>
      </label>
    </div>
  );
}
