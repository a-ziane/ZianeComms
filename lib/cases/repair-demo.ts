import type {Caller} from '@/types';
import {simulateRepeatContact} from '@/data/callers';
import {TERMINAL_STATUSES} from './index';
import {caseProvenance} from './recovery';
export const INCOMPLETE_SEED_IDS=['dc-006','cc-005','cc-006'];
// An explicit one-time seed-data correction, never a generic production auto-close rule.
export function repairIncompleteSeed(caller:Caller,timestamp:string):Caller {
 if(caseProvenance(caller)!=='seed_demo'||!INCOMPLETE_SEED_IDS.includes(caller.id)||caller.source||
  TERMINAL_STATUSES.includes(caller.status)||caller.engineInput?.agentOutcome!=='resolved'||
  caller.activityLog.some(e=>e.type==='case_closed'||e.type==='info_provided'))return caller;
 const next=simulateRepeatContact(caller,{attempts:0,agentOutcome:'could_not_resolve'},
  'Corrected contradictory seeded automation outcome: historical messages promised a callback; no resolution was recorded. Original events preserved.');
 const event=next.activityLog.at(-1)!;
 return {...next,provenance:'seed_demo',activityLog:[...caller.activityLog,{...event,id:`seed-outcome-correction-${caller.id}`,
  type:'data_corrected',timestamp,operatorId:'data-maintenance',label:'Seeded demo outcome corrected — follow-up still required',
  reason:'Seed data consistency correction, not a human priority override.'}]};
}
