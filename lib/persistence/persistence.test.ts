import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { demoSeed } from './demo';
import { deserializeCase, serializeCase, deserializeSnapshot, serializeState, type DatabaseSnapshot } from './mapping';
import { operationsRepository, type RpcClient } from './repository';
import { applyOperationalCommand } from './commands';
import { sameRequestOrigin } from './request-origin';
import { caseReducer, recommendationSignature, recordOutcome } from '@/lib/cases';
import { applyHumanOverride, maskPhone } from '@/lib/engine';
import { matchResponders } from '@/lib/matching';
import { DISASTER_CALLERS, CLINIC_CALLERS } from '@/data/callers';
import type { CaseState } from '@/lib/cases';
import type { Caller } from '@/types';

let db: PGlite;
let counter = 10;
const nextId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12,'0')}`;
const timestamp = '2026-10-17T16:00:00.000Z';
const migration = readFileSync(new URL('../../supabase/migrations/20261017000100_operations_persistence.sql', import.meta.url), 'utf8');
const adapter: RpcClient = { async rpc(name, args = {}) {
  await db.exec('savepoint rpc_call');
  try {
    let rows: { result: unknown }[];
    if (name === 'zianecomms_load_demo') ({ rows } = await db.query<{result:unknown}>('select public.zianecomms_load_demo() as result'));
    else if (name === 'zianecomms_mutation_applied') ({ rows } = await db.query<{result:unknown}>('select public.zianecomms_mutation_applied($1::uuid) as result',[args.p_mutation_id]));
    else if (name === 'zianecomms_seed_demo') ({ rows } = await db.query<{result:unknown}>('select public.zianecomms_seed_demo($1::jsonb) as result',[JSON.stringify(args.p_payload)]));
    else if (name === 'zianecomms_save_demo') ({ rows } = await db.query<{result:unknown}>('select public.zianecomms_save_demo($1::bigint,$2::uuid,$3::jsonb) as result',[args.p_expected_revision,args.p_mutation_id,JSON.stringify(args.p_payload)]));
    else throw new Error('Unexpected RPC');
    await db.exec('release savepoint rpc_call');
    return { data: rows[0].result, error: null };
  } catch (error) {
    await db.exec('rollback to savepoint rpc_call');
    return { data: null, error: { message: (error as Error).message, code: (error as { code?: string }).code } };
  }
} };
const repo = operationsRepository(adapter);
async function persist(next: CaseState, revision: number) { return repo.save(next,revision,nextId()); }
function recommend(state: CaseState, caller = state.callersByMode.disaster[0]) {
  const result = matchResponders(caller,state.responders!);
  return caseReducer(state,{ type:'recommendation_shown',rulebook:caller.rulebook,id:caller.id,operatorId:'operator-test',
    snapshot:{id:`rec-${nextId()}`,shownAt:timestamp,callerPriority:caller.priority,result,signature:recommendationSignature(result,caller.priority)} });
}
function assign(state: CaseState, id: string) {
  const c = state.callersByMode.disaster[0];
  return caseReducer(state,{ type:'assign',rulebook:'disaster',id:c.id,responderId:id,snapshotId:c.lastRecommendation!.id,
    humanApproved:true,operatorId:'operator-test',timestamp, eventId:`assignment-${nextId()}` });
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec(migration);
  await db.query<{result:unknown}>('select public.zianecomms_seed_demo($1::jsonb)',[JSON.stringify(demoSeed())]);
},60000);
beforeEach(async () => { await db.exec('begin'); });
afterEach(async () => { await db.exec('rollback'); });
afterAll(async () => { await db.close(); });

describe('PostgreSQL persistence and existing operational models', () => {
  it('allows same-host browser writes when Next normalizes the URL and rejects cross-origin writes', () => {
    expect(sameRequestOrigin('http://127.0.0.1:3105','127.0.0.1:3105')).toBe(true);
    expect(sameRequestOrigin('https://demo.example','demo.example')).toBe(true);
    expect(sameRequestOrigin('https://other.example','demo.example')).toBe(false);
    expect(sameRequestOrigin('null','demo.example')).toBe(false);
  });
  it('round-trips cases without actual contact values and preserves masked display suffix', () => {
    const original = DISASTER_CALLERS[0], row = serializeCase(original), restored = deserializeCase(row);
    expect(row.data).not.toHaveProperty('phone'); expect(JSON.stringify(row)).not.toContain(original.phone);
    expect(restored.phone).toBe('(***) ***-4567'); expect(maskPhone(restored.phone)).toBe(restored.phone);
    expect({ ...restored, phone: original.phone }).toEqual(original);
  });
  it('applies the migration and loads all 12 callers and 10 responders with both modes separated', async () => {
    const {state} = await repo.load();
    expect(state.callersByMode.disaster).toHaveLength(6); expect(state.callersByMode.clinic).toHaveLength(6); expect(state.responders).toHaveLength(10);
    expect(state.callersByMode.disaster.every(c=>c.rulebook==='disaster')).toBe(true);
    expect(state.callersByMode.clinic.every(c=>c.rulebook==='clinic')).toBe(true);
  });
  it('seed is idempotent and never overwrites operator work', async () => {
    let {state,revision}=await repo.load(); const c=state.callersByMode.disaster[0];
    const o=applyHumanOverride(c,2,'Operator review'); state=caseReducer(state,{type:'patch',rulebook:'disaster',id:c.id,patch:o.callerPatch,logEntry:o.logEntry});
    await persist(state,revision); expect(await repo.seed(demoSeed())).toBe(false);
    expect((await repo.load()).state.callersByMode.disaster[0].priority).toBe(2);
  });
  it('preserves complete priority explanations, raw/capped scores and separate Customer Fit', async () => {
    const {state}=await repo.load(); const c=state.callersByMode.disaster[1];
    expect(c.scoreBreakdown).toEqual(DISASTER_CALLERS[1].scoreBreakdown); expect(c.score).toBe(100);
    const row=await db.query<{raw_score:number}>('select raw_score from public.cases where id=$1',[c.id]); expect(row.rows[0].raw_score).toBe(110);
    const clinic=state.callersByMode.clinic[0]; expect(clinic.customerFit).toEqual(CLINIC_CALLERS[0].customerFit); expect(clinic.calculatedPriority).toBe(0);
  });
  it('persists hard escalation and a confirmed human override separately, including operator metadata', async () => {
    let {state,revision}=await repo.load(); const c=state.callersByMode.clinic[0];
    const o=applyHumanOverride(c,2,'Emergency services now assisting','operator-test',true);
    state=applyOperationalCommand(state,{type:'patch',rulebook:'clinic',id:c.id,patch:o.callerPatch,logEntry:o.logEntry},timestamp);
    const saved=await persist(state,revision); const restored=saved.state.callersByMode.clinic[0];
    expect(restored).toMatchObject({priority:2,overridePriority:2,calculatedPriority:0,hardEscalation:true,manualPriority:true});
    expect(restored.activityLog.at(-1)).toMatchObject({safetyDowngradeConfirmed:true,previousPriority:0,newPriority:2,operatorId:'operator-mock-001'});
    const rows=await db.query<{data:{snapshot:{calculatedPriority:number;effectivePriority:number}}}>('select data from public.priority_events where case_id=$1 and id<>$2',[c.id,'initial-priority']);
    expect(rows.rows.at(-1)!.data.snapshot).toMatchObject({calculatedPriority:0,effectivePriority:2});
  });
  it('server command cannot bypass the hard Priority 0 confirmation safeguard', async () => {
    const {state}=await repo.load(); const c=state.callersByMode.clinic[0];
    expect(()=>applyOperationalCommand(state,{type:'patch',rulebook:'clinic',id:c.id,patch:{priority:3,manualPriorityReason:'Review'},logEntry:{type:'priority_changed'}},timestamp)).toThrow('Explicit confirmation');
  });
  it('persists repeat attempts without losing prior history or active human overrides', async () => {
    let {state,revision}=await repo.load(); const c=state.callersByMode.disaster[5]; const o=applyHumanOverride(c,2,'Known context');
    state=caseReducer(state,{type:'patch',rulebook:'disaster',id:c.id,patch:o.callerPatch,logEntry:o.logEntry});
    const previous=state.callersByMode.disaster[5].activityLog;
    state=applyOperationalCommand(state,{type:'repeat_contact',rulebook:'disaster',id:c.id,input:{facilitySignals:['immediate_life_threat']},detail:'New urgent information'},timestamp);
    const result=await persist(state,revision); const restored=result.state.callersByMode.disaster[5];
    expect(restored.attempts).toBe(c.attempts+1); expect(restored.priority).toBe(2); expect(restored.calculatedPriority).toBe(0);
    expect(restored.activityLog.slice(0,previous.length)).toEqual(previous);
    const attempts=await db.query('select * from public.contact_attempts where case_id=$1',[c.id]); expect(attempts.rows).toHaveLength(2);
  });
  it('persists questionnaire answers and versions in the activity history', async () => {
    const {state,revision}=await repo.load(); const c=state.callersByMode.disaster[0]; const answers=[{question:'Current location?',answer:'At the shelter'}];
    const next=applyOperationalCommand(state,{type:'questionnaire',rulebook:'disaster',id:c.id,answers},timestamp);
    const result=await persist(next,revision); expect(result.state.callersByMode.disaster[0].questionnaire).toEqual(answers);
    const rows=await db.query<{answer:string}>('select answer from public.questionnaire_answers where case_id=$1',[c.id]); expect(rows.rows).toEqual([{answer:'At the shelter'}]);
  });
  it('persists recommendations and assignment with complete structured learning metadata', async () => {
    let {state,revision}=await repo.load(); state=assign(recommend(state),'r-005');
    const result=await persist(state,revision), c=result.state.callersByMode.disaster[0];
    expect(c.assignedResponderId).toBe('r-005'); expect(c.activityLog.at(-1)!.dispatch!.recommendation!.result.candidates).toHaveLength(6);
    expect(result.state.responders!.find(r=>r.id==='r-005')!.activeCallers).toBe(1);
    const rows=await db.query('select * from public.assignments where case_id=$1 and ended_at is null',[c.id]); expect(rows.rows).toHaveLength(1);
  });
  it('reassignment keeps previous assignment rows and transfers workload', async () => {
    let loaded=await repo.load(); loaded=await persist(assign(recommend(loaded.state),'r-005'),loaded.revision);
    const before=loaded.state.callersByMode.disaster[0].activityLog;
    loaded=await persist(assign(recommend(loaded.state),'r-001'),loaded.revision);
    expect(loaded.state.callersByMode.disaster[0].activityLog.slice(0,before.length)).toEqual(before);
    expect(loaded.state.responders!.find(r=>r.id==='r-005')!.activeCallers).toBe(0);
    expect(loaded.state.responders!.find(r=>r.id==='r-001')!.activeCallers).toBe(1);
    const rows=await db.query<{ended_at:Date|null}>('select ended_at from public.assignments'); expect(rows.rows).toHaveLength(2); expect(rows.rows.filter(r=>r.ended_at===null)).toHaveLength(1);
  });
  it.each(['resolved','no_answer','needs_followup'] as const)('persists %s with correct active workload and assignment state', async outcome => {
    let loaded=await repo.load(); loaded=await persist(assign(recommend(loaded.state),'r-005'),loaded.revision);
    const c=loaded.state.callersByMode.disaster[0]; const o=recordOutcome(outcome,c);
    const next=applyOperationalCommand(loaded.state,{type:'patch',rulebook:'disaster',id:c.id,patch:o.callerPatch,logEntry:o.logEntry},timestamp);
    loaded=await persist(next,loaded.revision); const restored=loaded.state.callersByMode.disaster[0];
    expect(restored.status).toBe(outcome); expect(restored.activityLog.at(-1)!.type).toBe(outcome==='resolved'?'case_closed':'followup_required');
    expect(loaded.state.responders!.find(r=>r.id==='r-005')!.activeCallers).toBe(outcome==='resolved'?0:1);
  });
  it('responder status changes survive database reloads without erasing workload', async () => {
    let loaded=await repo.load(); loaded=await persist(assign(recommend(loaded.state),'r-005'),loaded.revision);
    const next=applyOperationalCommand(loaded.state,{type:'responder_status',responderId:'r-005',status:'offline'},timestamp);
    loaded=await persist(next,loaded.revision); expect(loaded.state.responders!.find(r=>r.id==='r-005')).toMatchObject({status:'offline',activeCallers:1});
  });
  it('creates a case with server-calculated priority and derived child data', async () => {
    const {state,revision}=await repo.load(); const incoming={...DISASTER_CALLERS[0],id:'new-demo-case',score:0,priority:3 as const};
    const next=applyOperationalCommand(state,{type:'create_case',caller:incoming},timestamp); const saved=await persist(next,revision);
    const c=saved.state.callersByMode.disaster.find(x=>x.id===incoming.id)!; expect(c.score).toBe(85); expect(c.priority).toBe(1); expect(c.questionnaire).toEqual(incoming.questionnaire);
  });
  it('records callback attempts and response time metadata', async () => {
    let loaded=await repo.load(); loaded=await persist(assign(recommend(loaded.state),'r-005'),loaded.revision); const c=loaded.state.callersByMode.disaster[0];
    const next=applyOperationalCommand(loaded.state,{type:'patch',rulebook:'disaster',id:c.id,patch:{status:'calling'},logEntry:{type:'call_attempted'}},'2026-10-17T16:00:12.000Z');
    loaded=await persist(next,loaded.revision); expect(loaded.state.callersByMode.disaster[0].activityLog.at(-1)!.dispatch!.responseTimeMs).toBe(12000);
  });
  it('detects concurrent edits instead of overwriting newer state', async () => {
    const loaded=await repo.load(); await persist(loaded.state,loaded.revision);
    await expect(persist(loaded.state,loaded.revision)).rejects.toMatchObject({conflict:true});
    expect((await repo.load()).revision).toBe(loaded.revision+1);
  });
  it('idempotent mutation IDs do not duplicate attempts or revision increments', async () => {
    const loaded=await repo.load(); const id=nextId(); await repo.save(loaded.state,loaded.revision,id);
    await repo.save(loaded.state,loaded.revision,id); expect(await repo.wasApplied(id)).toBe(true);
    expect((await repo.load()).revision).toBe(loaded.revision+1);
  });
  it('rejects history rewrites and rolls the entire save back', async () => {
    const loaded=await repo.load(); loaded.state.callersByMode.disaster[0].activityLog=[];
    await expect(persist(loaded.state,loaded.revision)).rejects.toThrow('History cannot be removed');
    expect((await repo.load()).revision).toBe(loaded.revision);
  });
  it('private contact store contains no seeded raw numbers and is absent from browser load responses', async () => {
    const snapshot=await db.query<{result:DatabaseSnapshot}>('select public.zianecomms_load_demo() as result');
    expect(JSON.stringify(snapshot.rows[0].result)).not.toContain('5551234567');
    const rows=await db.query<{contact_value:string|null}>('select contact_value from zianecomms_private.case_contacts'); expect(rows.rows.every(r=>r.contact_value===null)).toBe(true);
    expect(deserializeSnapshot(snapshot.rows[0].result).callersByMode.disaster).toHaveLength(6);
  });
  it('browser roles cannot read operational tables, private contacts, or invoke privileged save functions', async () => {
    await db.exec('set local role anon');
    const res=await adapter.rpc('zianecomms_load_demo'); expect(res.error!.message).toContain('permission denied');
  });
  it('all operational tables have RLS enabled and RPCs do not use SECURITY DEFINER', async () => {
    const tables=await db.query<{relrowsecurity:boolean}>("select relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r'");
    expect(tables.rows.every(t=>t.relrowsecurity)).toBe(true);
    const funcs=await db.query<{prosecdef:boolean}>("select prosecdef from pg_proc where proname like 'zianecomms_%'"); expect(funcs.rows.every(f=>!f.prosecdef)).toBe(true);
  });
  it('server credentials are isolated to server-only modules and never public environment names', () => {
    const admin=readFileSync(new URL('./admin.ts',import.meta.url),'utf8'); expect(admin).toContain("import 'server-only'");
    for (const file of ['../../hooks/usePersistentCases.ts','../../utils/supabase/client.ts','../../app/page.tsx']) {
      const source=readFileSync(new URL(file,import.meta.url),'utf8'); expect(source).not.toContain('SUPABASE_SECRET_KEY'); expect(source).not.toContain('SUPABASE_SERVICE_ROLE_KEY'); expect(source).not.toContain('/admin');
    }
    expect(readFileSync(new URL('../../.env.example',import.meta.url),'utf8')).not.toContain('sb_secret_');
  });
  it('the server service role can load and commit while authenticated browser roles remain denied', async () => {
    await db.exec('set local role service_role');
    const loaded=await repo.load(); await persist(loaded.state,loaded.revision);
    await db.exec('set local role authenticated');
    expect((await adapter.rpc('zianecomms_load_demo')).error!.message).toContain('permission denied');
  });
  it('a demo case ID cannot collide with or overwrite a different facility case', async () => {
    await db.query("insert into public.facilities(id,name,is_demo) values('other','Other facility',false)");
    const row=serializeCase({...DISASTER_CALLERS[0],id:'other-case'});
    await db.query("insert into public.cases(id,facility_id,rulebook,phone_display,raw_score,data,created_at) values($1,'other',$2,$3,$4,$5::jsonb,now())",[row.id,row.rulebook,row.phone_display,row.raw_score,JSON.stringify(row.data)]);
    const loaded=await repo.load();
    const next=applyOperationalCommand(loaded.state,{type:'create_case',caller:{...DISASTER_CALLERS[0],id:'other-case'}},timestamp);
    await expect(persist(next,loaded.revision)).rejects.toThrow('another facility');
    expect((await repo.load()).revision).toBe(loaded.revision);
  });
  it('priority audit snapshots remain unchanged after later overrides', async () => {
    let loaded=await repo.load(); const c=loaded.state.callersByMode.disaster[0];
    const original=await db.query<{data:unknown}>("select data from public.priority_events where case_id=$1 and id='initial-priority'",[c.id]);
    const o=applyHumanOverride(c,3,'Reviewed'); loaded=await persist(caseReducer(loaded.state,{type:'patch',id:c.id,rulebook:'disaster',patch:o.callerPatch,logEntry:o.logEntry}),loaded.revision);
    const after=await db.query<{data:unknown}>("select data from public.priority_events where case_id=$1 and id='initial-priority'",[c.id]);
    expect(after.rows).toEqual(original.rows); expect(loaded.state.callersByMode.disaster[0].priority).toBe(3);
  });
  it('facility rulebook and matching configuration are persisted without nonfinite JSON values', async () => {
    const snapshot=await db.query<{result:DatabaseSnapshot}>('select public.zianecomms_load_demo() as result');
    expect(snapshot.rows[0].result.facility.configuration).toHaveProperty('rulebooks.disaster');
    expect(snapshot.rows[0].result.facility.configuration).toHaveProperty('matching.weights.expertise',40);
    expect(JSON.stringify(snapshot.rows[0].result.facility.configuration)).toContain(String(Number.MAX_SAFE_INTEGER));
  });
  it('database failure is surfaced by the repository, not reported as a successful save', async () => {
    const failing=operationsRepository({rpc:async()=>({data:null,error:{message:'Unavailable'}})});
    await expect(failing.load()).rejects.toThrow('Unavailable');
  });
});
