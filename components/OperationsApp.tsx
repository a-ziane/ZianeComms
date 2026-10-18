'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import type { Caller, NavPage, Priority, CallOutcome, DashboardMetrics, Rulebook, ActivityEntry, Responder, ResponderStatus, MatchingResult } from '@/types';
import { usePersistentCases } from '@/hooks/usePersistentCases';
import { sortCallers, applyHumanOverride } from '@/lib/engine';
import { recordOutcome, recordCallbackAttempt, TERMINAL_STATUSES, recommendationSignature } from '@/lib/cases';

import { OrganizationProvider, OrganizationBar, useOrganization } from '@/components/organization/OrganizationProvider';
import { ResponderDraftPanel } from '@/components/organization/Editors';
import { DEFAULT_ORGANIZATION, matchingForCaller, operationalRulebook } from '@/lib/organization/model';
import { workspaceMetrics } from '@/lib/organization/metrics';
import OfflineWorkPanel from '@/components/OfflineWorkPanel';
import { deviceStore, withDeviceLock } from '@/lib/offline/storage';
import { OPERATOR_KEY, type OperatorCache } from '@/lib/offline/queue';
import LeftNav from '@/components/LeftNav';
import DashboardSummary from '@/components/DashboardSummary';
import CallbackQueue from '@/components/CallbackQueue';
import CallerDetailModal from '@/components/CallerDetailModal';

// Organization configuration pages
import AgentSetupPage from '@/components/pages/AgentSetupPage';
import KnowledgeBasePage from '@/components/pages/KnowledgeBasePage';
import RespondersPage from '@/components/pages/RespondersPage';
import DispatchRulesPage from '@/components/pages/DispatchRulesPage';
import SettingsPage from '@/components/pages/SettingsPage';

export default function App({publicDemo=true}:{publicDemo?:boolean}) { return <OrganizationProvider publicDemo={publicDemo}><OperationsApp publicDemo={publicDemo}/></OrganizationProvider>; }

function OperationsApp({publicDemo}:{publicDemo:boolean}) {
  const organization = useOrganization();
  const [activePage, setActivePage] = useState<NavPage>('dashboard');
  const { state: caseState, dispatch: dispatchCases, status: databaseStatus, error: databaseError, reload, retry, cancelPending, hasPending, hasLoaded, pendingCount, lastSync, conflict, online } = usePersistentCases(publicDemo);
  const rulebook = operationalRulebook(caseState.rulebook, organization.selectedId, caseState.activeOrganizations, organization.record?.active);
  const callers = caseState.callersByMode[rulebook].filter(c => (c.organizationId ?? DEFAULT_ORGANIZATION) === organization.selectedId);
  const responders = useMemo(() => (caseState.responders ?? []).filter(r => (r.organizationId ?? DEFAULT_ORGANIZATION) === organization.selectedId && (!organization.record?.active || organization.record.active.configuration.responders.some(x=>x.id===r.id))), [caseState.responders, organization.selectedId, organization.record?.active]);
  const [selectedCallerId, setSelectedCallerId] = useState<string | null>(null);

  useEffect(() => { setSelectedCallerId(null); }, [organization.selectedId]);

  // Each mode retains its own modified callers for the current session.
  const handleRulebookChange = useCallback((rb: Rulebook) => {
    if (rb === rulebook || organization.selectedId !== DEFAULT_ORGANIZATION) return;
    dispatchCases({ type: 'switch_mode', rulebook: rb });
    setSelectedCallerId(null);
  }, [rulebook, dispatchCases, organization.selectedId]);

  // Active callers (not terminal)
  const activeCallers = useMemo(
    () => sortCallers(callers.filter(c => !TERMINAL_STATUSES.includes(c.status))),
    [callers]
  );

  const closedCallers = useMemo(
    () => callers.filter(c => TERMINAL_STATUSES.includes(c.status)),
    [callers]
  );

  // Selected caller object (always fresh from state)
  const selectedCaller = useMemo(
    () => callers.find(c => c.id === selectedCallerId) ?? null,
    [callers, selectedCallerId]
  );

  // Dashboard metrics
  const metrics = useMemo(() => workspaceMetrics(callers, responders, rulebook), [callers, responders, rulebook]);

  // Patch a caller in state + append to activity log if provided
  const patchCaller = useCallback((id: string, patch: Partial<Caller>, logEntry?: ActivityEntry) => {
    dispatchCases({ type: 'patch', rulebook, id, patch, logEntry });
  }, [rulebook, dispatchCases]);

  // CALL BACK action
  const handleStartCall = useCallback((callerId: string) => {
    const caller = callers.find(c => c.id === callerId);
    if (!caller) return;
    patchCaller(callerId, { status: 'calling' }, recordCallbackAttempt(caller, new Date().toISOString()));
  }, [patchCaller, callers]);

  // Record an outcome; only terminal outcomes close the case.
  const handleRecordOutcome = useCallback((callerId: string, outcome: CallOutcome) => {
    const { callerPatch, logEntry } = recordOutcome(outcome, callers.find(c => c.id === callerId));
    patchCaller(callerId, callerPatch, logEntry);
    if (TERMINAL_STATUSES.includes(outcome)) {
      setSelectedCallerId(null);
    }
  }, [patchCaller, callers]);

  // CHANGE PRIORITY action — uses engine helper to preserve calculated priority
  const handleChangePriority = useCallback((callerId: string, priority: Priority, reason: string, safetyConfirmed = false) => {
    const caller = callers.find(c => c.id === callerId);
    if (!caller) return;
    const { callerPatch, logEntry } = applyHumanOverride(caller, priority, reason, 'operator-mock-001', safetyConfirmed);
    patchCaller(callerId, callerPatch, logEntry);
  }, [patchCaller, callers]);

  // Store what the operator actually saw before allowing an assignment.
  const handleRecommendationShown = useCallback((callerId: string, result: MatchingResult, priority: Priority) => {
    const shownAt = new Date().toISOString();
    dispatchCases({ type: 'recommendation_shown', rulebook, id: callerId, operatorId: 'operator-mock-001',
      snapshot: { id: `recommendation-${crypto.randomUUID()}`, shownAt, result, callerPriority: priority,
        signature: recommendationSignature(result, priority) } });
  }, [rulebook, dispatchCases]);

  // Only the existing Assign button invokes this approval action.
  const handleAssignResponder = useCallback((callerId: string, responderId: string, reason?: string) => {
    const caller = callers.find(c => c.id === callerId);
    if (!caller?.lastRecommendation) return;
    dispatchCases({ type: 'assign', rulebook, id: callerId, responderId, humanApproved: true,
      snapshotId: caller.lastRecommendation.id, operatorId: 'operator-mock-001', timestamp: new Date().toISOString(),
      eventId: `assignment-${crypto.randomUUID()}`, reason });
  }, [callers, rulebook, dispatchCases]);

  const handleResponderStatus = useCallback((responderId: string, status: ResponderStatus) => {
    dispatchCases({ type: 'responder_status', responderId, status });
  }, [dispatchCases]);

  return (
    <div className="h-screen flex overflow-hidden bg-[#0f1929] text-white">
      {/* Left navigation */}
      <LeftNav activePage={activePage} onNavigate={setActivePage} />

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="shrink-0 px-3 py-2"><OrganizationBar/>{publicDemo&&<p className="mt-1 text-xs text-amber-200">Public demo · Fictional callers · Changes stay on this device</p>}</div>
        {(!online || databaseStatus !== 'ready' || databaseError || hasPending) && <div role={databaseError ? 'alert' : 'status'} className={`relative z-[60] shrink-0 px-4 py-2 text-xs border-b border-[#2a3650] ${databaseError ? 'bg-red-950 text-red-200' : 'bg-[#131f33] text-slate-400'}`}>
          {!online ? `OFFLINE · Last synchronized: ${lastSync ? new Date(lastSync).toLocaleString() : 'never'} · ${pendingCount} actions waiting to sync. Cached cases only.` : databaseStatus === 'offline' ? 'Connection restored — preparing synchronization…' : databaseStatus === 'loading' ? 'Loading saved data… Preview is read-only.' : databaseStatus === 'saving' ? 'Saving action to database…' : databaseError ? `Database error — ${hasLoaded ? 'last loaded data retained' : 'read-only demo preview; no live data loaded'}. Changes disabled. ${databaseError}` : 'Waiting for synchronization confirmation…'}
          {!online && databaseError && <span className="ml-3 text-amber-200">{databaseError}</span>}
          {databaseStatus !== 'saving' && databaseStatus !== 'loading' && <button className="ml-3 underline font-bold" onClick={() => void (databaseError ? retry() : reload())}>{hasPending ? 'Retry unsaved action' : 'Retry connection'}</button>}
          {hasPending && databaseStatus === 'error' && <button className="ml-3 underline" onClick={() => { if (window.confirm('Review required: discard all queued local actions and reload current server data? Already accepted actions will remain in server history.')) void cancelPending(); }}>Discard queued actions and review current data</button>}
        </div>}
        {!online && hasLoaded && <OfflineWorkPanel callers={activeCallers} dispatch={dispatchCases} disabled={conflict} />}
        {conflict && <div role="alert" className="px-4 py-2 text-xs bg-red-950 text-red-200">Conflict — queued actions stopped. Reconnect, reload and review current server data before re-entering any still-needed actions.</div>}
        {!publicDemo && !hasPending && hasLoaded && <button className="text-xs text-slate-500 underline self-end px-4" onClick={async () => {
          if (window.confirm('Clear this device’s cached cases? Reload online before offline work can resume.')) {
            await withDeviceLock('operator', async () => { const saved = await deviceStore.get<OperatorCache>(OPERATOR_KEY); if (!saved?.actions.length) await deviceStore.remove(OPERATOR_KEY); }); window.location.reload();
          }
        }}>Clear device case cache</button>}
        {activePage === 'dashboard' ? (
          <DashboardLayout
            rulebook={rulebook}
            modeLocked={organization.selectedId !== DEFAULT_ORGANIZATION}
            matchingConfig={matchingForCaller(selectedCaller ?? {}, caseState.activeOrganizations)}
            readOnly={databaseStatus !== 'ready'}
            responders={responders}
            onRecommendationShown={handleRecommendationShown}
            activeCallers={activeCallers}
            selectedCaller={selectedCaller}
            metrics={metrics}
            onRulebookChange={handleRulebookChange}
            onCallerClick={(c) => setSelectedCallerId(c.id)}
            onCloseModal={() => setSelectedCallerId(null)}
            onStartCall={handleStartCall}
            onRecordOutcome={handleRecordOutcome}
            onChangePriority={handleChangePriority}
            onAssignResponder={handleAssignResponder}
          />
        ) : activePage === 'agent_setup' ? (
          <AgentSetupPage />
        ) : activePage === 'knowledge_base' ? (
          <KnowledgeBasePage />
        ) : activePage === 'responders' ? (
          <RespondersPage configurationPanel={<ResponderDraftPanel/>} readOnly={databaseStatus !== 'ready'} responders={responders.filter(r => r.rulebooks.includes(rulebook))} callers={Object.values(caseState.callersByMode).flat()} onStatusChange={handleResponderStatus} rulebook={rulebook} />
        ) : activePage === 'dispatch_rules' ? (
          <DispatchRulesPage />
        ) : (
          <SettingsPage />
        )}
      </div>
    </div>
  );
}

// ── Dashboard Layout ───────────────────────────────────────────────────────────

interface DashboardLayoutProps {
  modeLocked?: boolean;
  matchingConfig?: import('@/config/matching').MatchingConfig;
  rulebook: Rulebook;
  readOnly: boolean;
  responders: Responder[];
  onRecommendationShown: (callerId: string, result: MatchingResult, priority: Priority) => void;
  activeCallers: Caller[];
  selectedCaller: Caller | null;
  metrics: DashboardMetrics;
  onRulebookChange: (rb: Rulebook) => void;
  onCallerClick: (caller: Caller) => void;
  onCloseModal: () => void;
  onStartCall: (callerId: string) => void;
  onRecordOutcome: (callerId: string, outcome: CallOutcome) => void;
  onChangePriority: (callerId: string, priority: Priority, reason: string, safetyConfirmed?: boolean) => void;
  onAssignResponder: (callerId: string, responderId: string, reason?: string) => void;
}

function DashboardLayout({
  rulebook,
  modeLocked,
  matchingConfig,
  readOnly,
  responders,
  onRecommendationShown,
  activeCallers,
  selectedCaller,
  metrics,
  onRulebookChange,
  onCallerClick,
  onCloseModal,
  onStartCall,
  onRecordOutcome,
  onChangePriority,
  onAssignResponder,
}: DashboardLayoutProps) {
  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Top bar */}
      <div className="shrink-0 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 px-4 py-3 border-b border-[#2a3650] bg-[#131f33]">
        <div>
          <h1 className="text-sm font-bold text-white">Operations Dashboard</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Rulebook: <span className="text-slate-300 font-medium capitalize">{rulebook}</span>
            {' · '}
            <span className="text-amber-400">{activeCallers.filter(c => c.priority === 0).length} critical</span>
            {' · '}
            <span className="text-slate-400">{activeCallers.length} active</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Rulebook switcher */}
          <div className="flex items-center bg-[#1e2d45] border border-[#2a3650] rounded-lg overflow-hidden text-xs font-semibold">
            {(['disaster', 'clinic'] as Rulebook[]).map(rb => (
              <button
                key={rb}
                disabled={modeLocked}
                onClick={() => onRulebookChange(rb)}
                className={`px-3 py-1.5 transition-colors ${
                  rulebook === rb ? 'bg-blue-700 text-white' : 'text-slate-400 hover:text-white hover:bg-[#243350]'
                }`}
              >
                {rb.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Priority legend */}
          <div className="hidden lg:flex items-center gap-2 text-xs text-slate-400">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-600 flex items-center justify-center text-white font-black text-[8px]">0</span>Critical</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-500 flex items-center justify-center text-white font-black text-[8px]">1</span>Urgent</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-400 flex items-center justify-center text-gray-900 font-black text-[8px]">2</span>Moderate</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-600 flex items-center justify-center text-white font-black text-[8px]">3</span>Standard</span>
          </div>
        </div>
      </div>

      {/* Two-column body: Dashboard Summary left, full Callback Queue right */}
      <div className="flex-1 flex min-h-0 overflow-hidden gap-4 p-4">
        {/* Left column: Dashboard Summary only */}
        <div className="hidden lg:block w-72 shrink-0">
          <DashboardSummary metrics={metrics} />
        </div>

        {/* Right column: Callback Queue — full height */}
        <div className="flex-1 min-w-0 bg-[#1a2236] border border-[#2a3650] rounded-xl overflow-hidden flex flex-col">
          <CallbackQueue
            callers={activeCallers}
            selectedCallerId={selectedCaller?.id ?? null}
            onCallerClick={onCallerClick}
          />
        </div>
      </div>

      {/* Caller Detail Modal — rendered as overlay when a caller is selected */}
      {selectedCaller && (
        <CallerDetailModal
          matchingConfig={matchingConfig}
          key={selectedCaller.id}
          caller={selectedCaller}
          readOnly={readOnly}
          responders={responders}
          onRecommendationShown={onRecommendationShown}
          onClose={onCloseModal}
          onStartCall={onStartCall}
          onRecordOutcome={onRecordOutcome}
          onChangePriority={onChangePriority}
          onAssignResponder={onAssignResponder}
        />
      )}
    </div>
  );
}
