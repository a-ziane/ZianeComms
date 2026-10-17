import type { Caller, Responder } from '@/types';
import { synchronizeWorkload, type CaseState } from '@/lib/cases';
import { maskPhone } from '@/lib/engine';

export const DEMO_FACILITY_ID = 'zianecomms-demo';
export interface CaseRow {
  id: string; facility_id: string; rulebook: Caller['rulebook']; phone_display: string;
  raw_score: number; data: Omit<Caller, 'phone'|'recoveryState'>; recovery_state?:Caller['recoveryState'];
}
export interface ResponderRow {
  id: string; facility_id: string; data: Omit<Responder, 'activeCallers' | 'assignedCaseIds'>;
}
export interface DatabaseSnapshot {
  revision: number;
  facility: { id: string; name: string; configuration: Record<string, unknown> };
  cases: CaseRow[];
  responders: ResponderRow[];
}
export function serializeCase(caller: Caller): CaseRow {
  const { phone, recoveryState: _recoveryState, ...data } = caller;
  return { id: caller.id, facility_id: DEMO_FACILITY_ID, rulebook: caller.rulebook,
    phone_display: /^\(\*\*\*\) \*\*\*-\d{4}$/.test(phone) ? phone : maskPhone(phone),
    raw_score: caller.scoreBreakdown.reduce((sum, b) => sum + b.points, 0), data };
}
export function deserializeCase(row: CaseRow): Caller {
  if (row.facility_id !== DEMO_FACILITY_ID || row.data.id !== row.id || row.data.rulebook !== row.rulebook) throw new Error('Case facility/mode mismatch');
  return { ...row.data, phone: row.phone_display, ...(row.recovery_state?{recoveryState:row.recovery_state}:{}) };
}
export function serializeResponder(responder: Responder): ResponderRow {
  const { activeCallers: _count, assignedCaseIds: _ids, ...data } = responder;
  return { id: responder.id, facility_id: DEMO_FACILITY_ID, data };
}
export function deserializeSnapshot(snapshot: DatabaseSnapshot, mode: CaseState['rulebook'] = 'disaster'): CaseState {
  if (snapshot.facility.id !== DEMO_FACILITY_ID) throw new Error('Unexpected facility');
  const callers = snapshot.cases.map(deserializeCase);
  const responders = snapshot.responders.map(row => {
    if (row.facility_id !== DEMO_FACILITY_ID || row.data.id !== row.id) throw new Error('Responder facility mismatch');
    return { ...row.data, activeCallers: 0, assignedCaseIds: [] };
  });
  return synchronizeWorkload({ rulebook: mode, callersByMode: {
    disaster: callers.filter(c => c.rulebook === 'disaster'), clinic: callers.filter(c => c.rulebook === 'clinic'),
  }, responders });
}
export function serializeState(state: CaseState) {
  return { cases: Object.values(state.callersByMode).flat().map(serializeCase), responders: (state.responders ?? []).map(serializeResponder) };
}
