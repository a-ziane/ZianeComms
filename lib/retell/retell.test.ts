import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createHmac, createDecipheriv } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXTRACTION_CONCEPTS, LEGACY_EXTRACTION_CONCEPTS, parseExtractionMap, type ExtractionMap } from '@/config/retell';
import { demoSeed } from '@/lib/persistence/demo';
import { operationsRepository, type RpcClient } from '@/lib/persistence/repository';
import { serializeState } from '@/lib/persistence/mapping';
import { caseReducer } from '@/lib/cases';
import { applyHumanOverride } from '@/lib/engine';
import { ingestRetell } from './ingest';
import { normalizeRetell } from './normalize';
import { handleRetell } from './handler';
import { verifyRetellSignature } from './signature';
import { normalizePhone, protectContact, contactKey } from './contact';
import { retellConfig } from './config';

// Entirely synthetic fixtures: field names deliberately differ from ZianeComms concepts.
// These are not claims about the user's existing agent's unknown extraction schema.
// Freeze the original contract: new opt-in mappings are exercised in structured-extraction.test.ts.
const mapping = Object.fromEntries(LEGACY_EXTRACTION_CONCEPTS.map(k => [k, `fixture_${k}`])) as ExtractionMap;
const secret = 'test-only-api-key';
const key = Buffer.alloc(32, 7);
const start = Date.parse('2026-10-17T12:00:00Z');
function payload(callId = 'fixture_call_01', custom: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  const fields = { caller_name: 'Synthetic Caller', reason_for_contact: 'Wildfire shelter assistance', preferred_language: 'Spanish',
    need_category: 'shelter', location: 'Eastside', location_zone: 'affected_area', facility_signals: ['urgent_evacuation_shelter'],
    questionnaire_answers: JSON.stringify([{ question: 'Are you safe?', answer: 'Yes, seeking shelter.' }]),
    unresolved_need: true, human_requested: true, emergency_guidance_provided: false, automation_resolved_request: false, ...custom };
  return { event: 'call_analyzed', call: { call_id: callId, agent_id: 'fixture_agent', call_type: 'phone_call', direction: 'inbound',
    from_number: '+12025550123', to_number: '+12025550999', start_timestamp: start, end_timestamp: start + 60000,
    call_status: 'ended', transcript: 'Not persisted', recording_url: 'https://example.invalid/private-recording',
    call_analysis: { call_summary: 'Synthetic caller needs shelter.', custom_analysis_data: Object.fromEntries(Object.entries(fields).map(([k,v]) => [`fixture_${k}`,v])) }, ...extra } };
}
const normalize = (p = payload()) => normalizeRetell(p, 'disaster', mapping);
const signed = (body: unknown, timestamp = Date.now()) => {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request('https://example.invalid/api/webhooks/retell', { method:'POST',body:raw,
    headers:{'content-type':'application/json','x-retell-signature':`v=${timestamp},d=${createHmac('sha256',secret).update(raw+timestamp).digest('hex')}`} });
};
let db: PGlite;
const adapter: RpcClient = { async rpc(name,args = {}) {
  await db.exec('savepoint retell_rpc');
  try {
    let result;
    if (name==='zianecomms_load_demo') result=await db.query('select public.zianecomms_load_demo() result');
    else if(name==='zianecomms_retell_context') result=await db.query('select public.zianecomms_retell_context($1,$2) result',[args.p_call_id,args.p_linked_case_id]);
    else if(name==='zianecomms_ingest_retell') result=await db.query('select public.zianecomms_ingest_retell($1::bigint,$2::uuid,$3::jsonb,$4::jsonb) result',[args.p_expected_revision,args.p_mutation_id,JSON.stringify(args.p_payload),JSON.stringify(args.p_call)]);
    else if(name==='zianecomms_save_demo') result=await db.query('select public.zianecomms_save_demo($1::bigint,$2::uuid,$3::jsonb) result',[args.p_expected_revision,args.p_mutation_id,JSON.stringify(args.p_payload)]);
    else throw new Error('Unexpected RPC');
    await db.exec('release savepoint retell_rpc');
    return {data:(result.rows[0] as {result:unknown}).result,error:null};
  } catch(error) { await db.exec('rollback to savepoint retell_rpc'); return {data:null,error:{message:(error as Error).message,code:(error as {code:string}).code}}; }
} };
const repo = operationsRepository(adapter);
const dependencies = { config:()=>({apiKey:secret,agentId:'fixture_agent',rulebook:'disaster' as const,encryptionKey:key,mapping}),client:()=>adapter };
async function calls() { return (await repo.load()).state.callersByMode.disaster.filter(c=>c.source==='retell'); }
async function count(table:string) { return Number((await db.query<{n:number}>(`select count(*) n from ${table}`)).rows[0].n); }
beforeAll(async()=>{
  db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  for(const path of ['20261017000100_operations_persistence.sql','20261017151241_retell_integration.sql']) {
    await db.exec(readFileSync(new URL(`../../supabase/migrations/${path}`,import.meta.url),'utf8'));
  }
  await db.query('select public.zianecomms_seed_demo($1::jsonb)',[JSON.stringify(demoSeed())]);
},60000);
beforeEach(async()=>{await db.exec('begin');});
afterEach(async()=>{await db.exec('rollback'); vi.restoreAllMocks(); vi.unstubAllEnvs();});
afterAll(async()=>{await db.close();});

describe('Retell adapter and provider authentication',()=>{
  it('maps explicit custom field names from actual-format Retell call_analysis',()=>{
    const n=normalize(); expect(n.name).toBe('Synthetic Caller'); expect(n.input.rulebook).toBe('disaster');
    expect(n.input.facilitySignals).toEqual(['urgent_evacuation_shelter']); expect(n.input.agentOutcome).toBe('could_not_resolve');
    expect(n.input.waitMinutes).toBe(0); expect(n.questionnaire).toHaveLength(1);
  });
  it('requires an explicit mapping instead of assuming conceptual labels are actual field keys',()=>{
    expect(()=>parseExtractionMap(undefined)).toThrow(); expect(()=>parseExtractionMap('{}')).toThrow();
    expect(parseExtractionMap(JSON.stringify(mapping))).toEqual(mapping);
    expect(()=>normalizeRetell(payload(),'disaster',{})).toThrow();
  });
  it.each([null,{}, {event:'call_analyzed',call:{}}, {event:'call_analyzed',call:{call_id:'bad/id',agent_id:'a'}}])('rejects malformed envelope %#',p=>{
    expect(()=>normalizeRetell(p,'disaster',mapping)).toThrow();
  });
  it.each([{emergency_guidance_provided:'false'},{questionnaire_answers:{bad:true}},{facility_signals:{bad:true}}])('rejects malformed extracted fields %#',fields=>{
    expect(()=>normalize(payload('bad',fields))).toThrow();
  });
  it('supports the actual agent string extraction fields without inventing safety keywords',()=>{
    const n=normalize(payload('actual-shape',{questionnaire_answers:'Safe location: home; power: unavailable',
      safety_context_signals:'Caller mentions danger but gives no structured classification',facility_signals:undefined,need_category:undefined,location_zone:undefined}));
    expect(n.questionnaire[0].answer).toContain('power: unavailable');
    expect(n.questionnaire[1].answer).toContain('danger');expect(n.input.facilitySignals).toEqual([]);
    expect(n.input.needCategory).toBe('other');expect(n.notes.join(' ')).toContain('operator review');
  });
  it('maps structured safety_context_signals through the existing configured Disaster rulebook',()=>{
    const n=normalize(payload('structured',{need_category:undefined,location_zone:undefined,facility_signals:undefined,
      safety_context_signals:JSON.stringify({need_category:'shelter',location_zone:'affected_area',facility_signals:['urgent_evacuation_shelter']})}));
    expect(n.input.needCategory).toBe('shelter');expect(n.input.locationZone).toBe('affected_area');expect(n.input.facilitySignals).toEqual(['urgent_evacuation_shelter']);
  });
  it('rejects missing safety extraction rather than interpreting missing as false',()=>{
    expect(()=>normalize(payload('missing',{emergency_guidance_provided:undefined}))).toThrow();
  });
  it('uses deployment mode rather than payload mode and ignores Retell priority fields',()=>{
    const p=payload('routine',{need_category:'appointment',facility_signals:[],unresolved_need:false,human_requested:false,priority:0,hard_escalation:true,rulebook:'clinic'});
    expect(normalize(p).input.rulebook).toBe('disaster');
    expect(normalizeRetell(p,'clinic',mapping).input.rulebook).toBe('clinic');
  });
  it('selects the caller side for outbound calls and accepts web calls without phone',()=>{
    expect(normalize(payload('out',{}, {direction:'outbound'})).phone).toBe('+12025550999');
    expect(normalize(payload('web',{}, {call_type:'web_call',from_number:undefined,to_number:undefined})).phone).toBeUndefined();
    expect(normalizePhone('202-555-0123')).toBeUndefined();
  });
  it('verifies raw-body HMAC and rejects missing, tampered, expired and future signatures',()=>{
    const now=Date.now(),raw=' { "event": "call_analyzed" } ';
    const signature=`v=${now},d=${createHmac('sha256',secret).update(raw+now).digest('hex')}`;
    expect(verifyRetellSignature(raw,signature,secret,now)).toBe(true);
    expect(verifyRetellSignature(raw.trim(),signature,secret,now)).toBe(false);
    expect(verifyRetellSignature(raw,null,secret,now)).toBe(false);
    expect(verifyRetellSignature(raw,signature,'wrong',now)).toBe(false);
    expect(verifyRetellSignature(raw,signature,secret,now+300001)).toBe(false);
    expect(verifyRetellSignature(raw,signature,secret,now-300001)).toBe(false);
  });
  it('encrypts contacts with case-bound AES-GCM and a stable non-plaintext identity',()=>{
    const p=protectContact('+12025550123',key,'case-01');
    expect(p.encrypted).not.toContain('+12025550123'); expect(p.identity).toHaveLength(64);
    const [,iv,tag,body]=p.encrypted!.split(':'); const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64'));
    decipher.setAAD(Buffer.from('case-01')); decipher.setAuthTag(Buffer.from(tag,'base64'));
    expect(Buffer.concat([decipher.update(Buffer.from(body,'base64')),decipher.final()]).toString()).toBe('+12025550123');
    expect(()=>contactKey('short')).toThrow();
  });
});
describe('Retell HTTP → existing models → real PostgreSQL persistence',()=>{
  it('creates exactly one case and one contact attempt on a valid signed webhook',async()=>{
    const result=await handleRetell(signed(payload()),dependencies); expect(result.status).toBe(200);
    const records=await calls(); expect(records).toHaveLength(1); const c=records[0];
    expect(c.id).toBe('retell-fixture_call_01'); expect(c.phone).toBe('(***) ***-0123');
    expect(c.retell?.callId).toBe('fixture_call_01'); expect(c.retell?.outcomes).toEqual({emergencyGuidanceProvided:false,humanRequested:true,unresolvedNeed:true,automationResolvedRequest:false}); expect(c.questionnaire[0].answer).toBe('Yes, seeking shelter.');
    expect(c.status).toBe('awaiting_callback'); expect(c.calculatedPriority).toBe(2); expect(c.hardEscalation).toBe(false);
    expect(await count('zianecomms_private.retell_calls')).toBe(1);
    const attempts=await db.query<{channel:string}>('select channel from public.contact_attempts where case_id=$1',[c.id]);
    expect(attempts.rows).toEqual([{channel:'retell_voice'}]);
    expect((await db.query('select * from public.questionnaire_answers where case_id=$1',[c.id])).rows).toHaveLength(1);
  });
  it('persists native Disaster signals and unknown outcome facts through the signed handler and actual SQL',async()=>{
    const nativeMapping=Object.fromEntries(EXTRACTION_CONCEPTS.map(k=>[k,`fixture_${k}`])) as ExtractionMap;
    const p=payload('native_roundtrip',{requested_service:'shelter',affected_by_active_crisis:'yes',immediate_danger:'no',
      facility_signals:undefined,emergency_guidance_provided:undefined,mobility_limitation:'unknown'});
    const result=await handleRetell(signed(p),{...dependencies,config:()=>({...dependencies.config(),mapping:nativeMapping})});
    expect(result.status).toBe(200);const c=(await calls())[0];
    expect(c.score).toBe(53);expect(c.calculatedPriority).toBe(2);expect(c.status).toBe('awaiting_callback');
    expect(c.engineInput?.facilitySignals).toEqual(['urgent_evacuation_shelter']);
    expect(c.retell?.outcomes?.emergencyGuidanceProvided).toBeNull();expect(c.retell?.analysisPending).toBe(true);
    expect(c.questionnaire.find(q=>q.question==='Structured intake — Mobility limitation')?.answer).toBe('unknown');
    expect(c.aiSummary).toContain('operator review');
    const stored=await db.query<{answer:string}>('select answer from public.questionnaire_answers where case_id=$1 and question=$2',[c.id,'Structured intake — Emergency-services guidance provided']);
    expect(stored.rows[0].answer).toBe('unknown');
  });
  it('deduplicates retries, with no additional cases, history, attempts or revision changes',async()=>{
    await ingestRetell(adapter,normalize(),key); const before=await repo.load();
    expect(await ingestRetell(adapter,normalize(),key)).toEqual({duplicate:true});
    expect(await repo.load()).toEqual(before); expect(await calls()).toHaveLength(1);
    expect(await count('zianecomms_private.retell_calls')).toBe(1);
  });
  it('database deduplication wins even when another delivery raced after context lookup',async()=>{
    await ingestRetell(adapter,normalize(),key);
    const snapshot=await repo.load();
    const r=await adapter.rpc('zianecomms_ingest_retell',{p_expected_revision:0,p_mutation_id:'00000000-0000-4000-8000-000000000099',p_payload:serializeState(snapshot.state),p_call:{call_id:'fixture_call_01',agent_id:'fixture_agent'}});
    expect(r.error).toBeNull(); expect(r.data).toEqual({duplicate:true}); expect((await repo.load()).revision).toBe(snapshot.revision);
  });
  it('calculates hard Priority 0 from emergency guidance and records emergency history',async()=>{
    await ingestRetell(adapter,normalize(payload('critical',{emergency_guidance_provided:true,priority:3})),key);
    const c=(await calls())[0]; expect(c.calculatedPriority).toBe(0); expect(c.hardEscalation).toBe(true);
    expect(c.escalationReason).toBeTruthy(); expect(c.activityLog.some(e=>e.type==='told_call_911')).toBe(true);
    expect(c.engineInput?.agentOutcome).toBe('directed_to_911');
  });
  it('does not turn a routine call into Priority 0 because Retell provides a priority field',async()=>{
    await ingestRetell(adapter,normalize(payload('routine',{facility_signals:[],need_category:'general_disaster',unresolved_need:false,human_requested:false,automation_resolved_request:true,priority:0})),key);
    const c=(await calls())[0]; expect(c.priority).toBe(3); expect(c.hardEscalation).toBe(false); expect(c.status).toBe('awaiting_callback');
  });
  it('preserves real call timeline metadata and priority snapshot explanations',async()=>{
    await ingestRetell(adapter,normalize(),key); const c=(await calls())[0];
    expect(c.activityLog.map(e=>e.type)).toEqual(['call_received','conversation_completed','questionnaire_completed','human_followup_requested','priority_calculated']);
    expect(c.activityLog.every(e=>e.retell?.callId==='fixture_call_01')).toBe(true);
    const rows=await db.query<{data:{snapshot:{explanation:unknown}}}>('select data from public.priority_events where case_id=$1 and id=$2',[c.id,'retell-fixture_call_01-priority']);
    expect(rows.rows[0].data.snapshot.explanation).toEqual(c.scoreBreakdown);
  });
  it('never merges unrelated calls just because phone matches',async()=>{
    await ingestRetell(adapter,normalize(),key); await ingestRetell(adapter,normalize(payload('second')),key);
    expect(await calls()).toHaveLength(2);
  });
  it('merges explicit active matching contact/need/mode references and preserves human overrides/history',async()=>{
    await ingestRetell(adapter,normalize(),key); let current=await repo.load(); const first=(await calls())[0];
    const override=applyHumanOverride(first,3,'Test operator reviewed', 'test-operator');
    current.state=caseReducer(current.state,{type:'patch',rulebook:'disaster',id:first.id,patch:override.callerPatch,logEntry:override.logEntry});
    await repo.save(current.state,current.revision,'00000000-0000-4000-8000-000000000123');
    await ingestRetell(adapter,normalize(payload('repeat',{emergency_guidance_provided:true},{start_timestamp:start+120000,end_timestamp:start+180000,metadata:{zianecomms_case_id:first.id}})),key);
    const records=await calls();expect(records).toHaveLength(1); const c=records[0];
    expect(c.attempts).toBe(2); expect(c.calculatedPriority).toBe(0); expect(c.priority).toBe(3);expect(c.manualPriorityReason).toBe('Test operator reviewed');
    expect(c.activityLog.slice(0,first.activityLog.length)).toEqual(first.activityLog);
    expect((await db.query('select * from public.contact_attempts where case_id=$1',[c.id])).rows).toHaveLength(2);
  });
  it.each(['different_phone','different_need','closed','different_mode','older_call'])('refuses unsafe explicit linking: %s',async kind=>{
    await ingestRetell(adapter,normalize(),key); const c=(await calls())[0];
    if(kind==='closed'||kind==='different_mode') await db.query('update public.cases set data=data||$2::jsonb where id=$1',[c.id,JSON.stringify(kind==='closed'?{status:'resolved'}:{needCategory:'billing'})]);
    const p=payload('unrelated',kind==='different_need'?{need_category:'welfare_check'}:{},{start_timestamp:kind==='older_call'?start-120000:start+120000,end_timestamp:kind==='older_call'?start-60000:start+180000,metadata:{zianecomms_case_id:c.id},...(kind==='different_phone'?{from_number:'+12025550456'}:{})});
    // Different deployment mode cannot select a case in another mode's collection.
    const n=kind==='different_mode'?normalizeRetell(p,'clinic',mapping):normalize(p);
    await ingestRetell(adapter,n,key);
    expect(await count('zianecomms_private.retell_calls')).toBe(2);
    expect(Object.values((await repo.load()).state.callersByMode).flat().filter(x=>x.source==='retell')).toHaveLength(2);
  });
  it('keeps contacts encrypted and strips phones from client text without persisting raw transcript/recording',async()=>{
    const p=payload('privacy',{reason_for_contact:'Call me +1 (202) 555-0123',questionnaire_answers:[{question:'Phone?',answer:'+12025550123'}]});
    p.call.call_analysis.call_summary='Contact +12025550123';
    await ingestRetell(adapter,normalize(p),key);
    const exposed=JSON.stringify(await repo.load());expect(exposed).not.toContain('+12025550123');expect(exposed).not.toContain('202) 555');
    expect(exposed).not.toContain('private-recording');expect(exposed).not.toContain('Not persisted');
    const contact=await db.query<{contact_value:string;phone_identity:string}>('select contact_value,phone_identity from zianecomms_private.case_contacts where case_id=$1',['retell-privacy']);
    expect(contact.rows[0].contact_value).toMatch(/^v1:/); expect(contact.rows[0].contact_value).not.toContain('+12025550123');
  });
  it('retains the demo baseline, separate modes and responder workload after ingestion',async()=>{
    await ingestRetell(adapter,normalize(),key); const {state,accessRequired}=await repo.load();
    expect(state.callersByMode.disaster).toHaveLength(7);expect(state.callersByMode.clinic).toHaveLength(6);expect(state.responders).toHaveLength(10);
    expect(accessRequired).toBe(true);
  });
  it('does not grant browser roles access to provider records or ingestion RPCs',async()=>{
    const r=await db.query<{allowed:boolean}>("select has_table_privilege('anon','zianecomms_private.retell_calls','SELECT') allowed");expect(r.rows[0].allowed).toBe(false);
    const f=await db.query<{allowed:boolean}>("select has_function_privilege('authenticated','public.zianecomms_ingest_retell(bigint,uuid,jsonb,jsonb)','EXECUTE') allowed");expect(f.rows[0].allowed).toBe(false);
  });
  it('rejects bad signatures and wrong agents without database writes',async()=>{
    const req=signed(payload());req.headers.set('x-retell-signature','bad');expect((await handleRetell(req,dependencies)).status).toBe(401);
    expect((await handleRetell(signed(payload('other',{}, {agent_id:'wrong_agent'})),dependencies)).status).toBe(403);
    expect(await calls()).toHaveLength(0);
  });
  it('acknowledges earlier/out-of-order signed events without creating premature duplicate cases',async()=>{
    const p=payload();expect((await handleRetell(signed({...p,event:'call_ended'}),dependencies)).status).toBe(200);expect(await calls()).toHaveLength(0);
    await handleRetell(signed(p),dependencies);await handleRetell(signed({...p,event:'call_started'}),dependencies);
    expect(await calls()).toHaveLength(1);
  });
  it('rejects malformed and oversized requests before persistence',async()=>{
    expect((await handleRetell(signed('{broken'),dependencies)).status).toBe(400);
    const req=signed(payload());req.headers.set('content-length','3000000');expect((await handleRetell(req,dependencies)).status).toBe(413);
    const wrongType=signed(payload());wrongType.headers.set('content-type','text/plain');expect((await handleRetell(wrongType,dependencies)).status).toBe(415);
    expect(await calls()).toHaveLength(0);
  });
  it('returns a retryable error on persistence failure with no caller data or secret logs',async()=>{
    const spy=vi.spyOn(console,'error').mockImplementation(()=>{});
    const r=await handleRetell(signed(payload()),{...dependencies,client:()=>({rpc:async()=>{throw new Error('sensitive +12025550123 '+secret);}})});
    expect(r.status).toBe(503);expect(await r.text()).not.toContain(secret);expect(JSON.stringify(spy.mock.calls)).not.toContain('12025550123');
    expect(JSON.stringify(spy.mock.calls)).not.toContain(secret);
  });
  it('retries a revision conflict from freshly loaded state',async()=>{
    let conflicts=0;
    const client:RpcClient={rpc(name,args){if(name==='zianecomms_ingest_retell'&&conflicts++===0)return Promise.resolve({data:null,error:{message:'conflict',code:'40001'}});return adapter.rpc(name,args);}};
    await ingestRetell(client,normalize(),key);expect(await calls()).toHaveLength(1);expect(conflicts).toBe(2);
  });
  it('rolls back case/history and receipt together if the provider transaction fails',async()=>{
    const before=await repo.load(); const real=adapter.rpc.bind(adapter);
    const client:RpcClient={rpc(name,args){return real(name,name==='zianecomms_ingest_retell'?{...args,p_call:{...(args!.p_call as object),ended_at:'invalid'}}:args);}};
    await expect(ingestRetell(client,normalize(),key)).rejects.toThrow();expect(await repo.load()).toEqual(before);expect(await count('zianecomms_private.retell_calls')).toBe(0);
  });
  it('fails closed when required environment configuration is missing',async()=>{
    vi.stubEnv('RETELL_ENABLED','false');expect(()=>retellConfig()).toThrow();
    await expect(handleRetell(signed(payload()),{...dependencies,config:()=>{throw new Error('missing');}})).resolves.toHaveProperty('status',503);
  });
});
