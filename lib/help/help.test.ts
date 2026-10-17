import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { demoSeed } from '@/lib/persistence/demo';
import { operationsRepository, type RpcClient } from '@/lib/persistence/repository';
import { applyOperationalCommand } from '@/lib/persistence/commands';
import { scoreCallerInput } from '@/lib/engine';
import { decryptContact } from '@/lib/retell/contact';
import { submitHelp } from './service';
import type { HelpRequest } from './intake';
import { POST } from '@/app/api/help/route';
import { NextRequest } from 'next/server';
vi.mock('server-only',()=>({}));
let db: PGlite;
const key = 'ab'.repeat(32);
const request = (): HelpRequest => ({ id: randomUUID(), deploymentId: 'algeria', createdOnDeviceAt: '2026-10-17T20:00:00.000Z', savedOffline: true, name: 'Demo Caller',contact:'',language:'ar',need:'Fictional wildfire evacuation request',service:'evacuation', immediateDanger:'unknown',medicalNeed:'unknown',mobilityNeed:'yes',equipmentNeed:'no',crisisContext:'yes',unableToEvacuate:'yes',powerDisruption:'unknown',location:{wilaya:'Blida',commune:'Fictional commune'} });
const client: RpcClient = { async rpc(name,args={}) {
 await db.exec('savepoint help_rpc');
 try {
  if (!/^zianecomms_[a-z_]+$/.test(name)) throw Error('Unknown RPC');
  const entries=Object.entries(args);
  const types:Record<string,string>={p_payload:'jsonb',p_expected_revision:'bigint',p_request_id:'uuid',p_mutation_id:'uuid'};
  const params=entries.map(([k,v])=>k==='p_payload'?JSON.stringify(v):v);
  const typed=entries.map(([k],i)=>`${k} => $${i+1}::${types[k]??'text'}`);
  const result=await db.query<{result:unknown}>(`select public.${name}(${typed.join(',')}) result`,params);
  await db.exec('release savepoint help_rpc');return {data:result.rows[0].result,error:null};
 } catch(e) { await db.exec('rollback to savepoint help_rpc');return {data:null,error:{message:(e as Error).message,code:(e as {code:string}).code}}; }
} };
const repo=operationsRepository(client);
beforeAll(async()=>{
 db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
 const folder=new URL('../../supabase/migrations/',import.meta.url);
 for(const name of readdirSync(folder).filter(n=>n.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(name,folder),'utf8'));
 await db.query('select public.zianecomms_seed_demo($1::jsonb)', [JSON.stringify(demoSeed())]);
},60000);
beforeEach(async()=>{await db.exec('begin');});
afterEach(async()=>{await db.exec('rollback');vi.restoreAllMocks();});
afterAll(async()=>{await db.close();});
describe('Task 7 server intake through real PostgreSQL persistence',()=>{
 it('creates a normal Supabase-schema case with source, deployment, explicit answers, priority and ordered history',async()=>{
  const r=request(),ack=await submitHelp(client,r,key);
  expect(ack).toEqual({acknowledged:true,requestId:r.id});
  const c=(await repo.load()).state.callersByMode.disaster.find(c=>c.id===`help-${r.id}`)!;
  expect(c).toMatchObject({source:'offline_help_form',deploymentId:'algeria',status:'awaiting_callback',language:'Arabic'});
  expect(c.location).toContain('Wilaya: Blida');expect(c.engineInput?.facilitySignals).toContain('mobility_vulnerability');
  expect(c.activityLog.map(e=>e.label)).toEqual(['Offline request created on device','Request synchronized','Priority calculated']);
  expect(scoreCallerInput(c.engineInput!)).toMatchObject({score:c.score,priority:c.priority});
  const rows=await db.query('select * from public.activity_events where case_id=$1',[c.id]);expect(rows.rows).toHaveLength(3);
  const channel=await db.query<{channel:string}>('select channel from public.contact_attempts where case_id=$1',[c.id]);expect(channel.rows[0].channel).toBe('offline_help_form');
 });
 it('scores LA through the same rulebook and persistence',async()=>{const r={...request(),deploymentId:'los-angeles' as const,language:'es',location:{address:'Fictional demo site'}};await submitHelp(client,r,key);const c=(await repo.load()).state.callersByMode.disaster.find(c=>c.id===`help-${r.id}`)!;expect(c.deploymentId).toBe('los-angeles');expect(c.calculatedPriority).toBe(scoreCallerInput(c.engineInput!).priority);});
 it('duplicate transmission does not create another case, audit entry, contact attempt or revision increment',async()=>{
  const r=request();await submitHelp(client,r,key);const revision=(await repo.load()).revision;await submitHelp(client,r,key);
  expect((await repo.load()).revision).toBe(revision);
  for(const table of ['cases','activity_events','contact_attempts']){const rows=await db.query(`select * from public.${table} where ${table==='cases'?'id':'case_id'}=$1`,[`help-${r.id}`]);expect(rows.rows).toHaveLength(table==='activity_events'?3:1);}
 });
 it('rejects reuse of a request ID with changed payload instead of overwriting a case',async()=>{const r=request();await submitHelp(client,r,key);await expect(submitHelp(client,{...r,need:'Changed facts'},key)).rejects.toMatchObject({conflict:true});const c=(await repo.load()).state.callersByMode.disaster.find(c=>c.id===`help-${r.id}`)!;expect(c.needSummary).toBe(r.need);});
 it('replay acknowledgement does not reopen a case resolved since original intake',async()=>{const r=request();await submitHelp(client,r,key);const loaded=await repo.load();const c=loaded.state.callersByMode.disaster.find(c=>c.id===`help-${r.id}`)!;const next=applyOperationalCommand(loaded.state,{type:'patch',rulebook:'disaster',id:c.id,patch:{status:'resolved'},logEntry:{type:'case_closed'}},new Date().toISOString());await repo.save(next,loaded.revision,randomUUID());await submitHelp(client,r,key);expect((await repo.load()).state.callersByMode.disaster.find(x=>x.id===c.id)?.status).toBe('resolved');});
 it('keeps optional actual contact encrypted server-side and only masked in the operator projection',async()=>{
  const r={...request(),contact:'+213555010999'};await submitHelp(client,r,key);const c=(await repo.load()).state.callersByMode.disaster.find(c=>c.id===`help-${r.id}`)!;
  expect(JSON.stringify(c)).not.toContain(r.contact);expect(c.phone).toBe('(***) ***-0999');
  const rows=await db.query<{contact_value:string}>('select contact_value from zianecomms_private.case_contacts where case_id=$1',[c.id]);expect(decryptContact(rows.rows[0].contact_value,Buffer.from(key,'hex'),c.id)).toBe(r.contact);
 });
 it('refuses to acknowledge a contact-bearing request when encryption is unavailable',async()=>{await expect(submitHelp(client,{...request(),contact:'+213555010999'},undefined)).rejects.toThrow('encryption');});
 it('redacts phone-like text from browser-visible free text',async()=>{const r={...request(),need:'Call +213555010999 for evacuation'};await submitHelp(client,r,key);const c=(await repo.load()).state.callersByMode.disaster.find(c=>c.id===`help-${r.id}`)!;expect(JSON.stringify(c)).not.toContain('+213555010999');expect(c.needSummary).toContain('[phone redacted]');});
 it('reloads/retries after an unrelated revision change without erasing existing work',async()=>{
  let first=true;const racing:RpcClient={async rpc(name,args){if(name==='zianecomms_submit_help'&&first){first=false;const loaded=await repo.load();await repo.save(loaded.state,loaded.revision,randomUUID());}return client.rpc(name,args);}};
  const r=request();await submitHelp(racing,r,key);expect((await repo.load()).state.callersByMode.disaster.some(c=>c.id===`help-${r.id}`)).toBe(true);
 });
 it('never reports acknowledgement on database failure',async()=>{await expect(submitHelp({rpc:async()=>({data:null,error:{message:'unavailable'}})},request(),key)).rejects.toThrow();});
 it('offline responder actions are idempotent and preserve audit history',async()=>{const loaded=await repo.load(),c=loaded.state.callersByMode.disaster[0],id=randomUUID();const next=applyOperationalCommand(loaded.state,{type:'note',id:c.id,rulebook:c.rulebook,note:'Safe demo note',eventId:'device-note',timestamp:new Date().toISOString()},new Date().toISOString());await repo.save(next,loaded.revision,id);await repo.save(next,loaded.revision,id);const result=(await repo.load()).state.callersByMode.disaster[0];expect(result.activityLog.slice(0,-1)).toEqual(c.activityLog);expect(result.activityLog.filter(e=>e.id==='device-note')).toHaveLength(1);const msgs=await db.query("select * from public.messages where case_id=$1 and id='device-note'",[c.id]);expect(msgs.rows).toHaveLength(0);});
 it('concurrent operator change stops offline outcome from overwriting newer priority/state',async()=>{const loaded=await repo.load();await repo.save(loaded.state,loaded.revision,randomUUID());await expect(repo.save(loaded.state,loaded.revision,randomUUID())).rejects.toMatchObject({conflict:true});});
 it('does not give anonymous/browser roles access to receipts or the new service-only function',async()=>{await db.exec('set local role anon');const result=await client.rpc('zianecomms_submit_help',{p_expected_revision:0,p_request_id:randomUUID(),p_digest:'a'.repeat(64),p_payload:{},p_contact_encrypted:null,p_contact_identity:null});expect(result.error?.message).toContain('permission denied');});
 it('new private table uses RLS and RPC is security invoker',async()=>{const t=await db.query<{relrowsecurity:boolean}>("select relrowsecurity from pg_class where oid='zianecomms_private.help_receipts'::regclass");expect(t.rows[0].relrowsecurity).toBe(true);const f=await db.query<{prosecdef:boolean}>("select prosecdef from pg_proc where proname='zianecomms_submit_help'");expect(f.rows[0].prosecdef).toBe(false);});
 it('latches protected operator reads when public caller intake first creates real records',async()=>{await submitHelp(client,request(),key);expect((await repo.load()).accessRequired).toBe(true);});
 it('public intake rejects cross-origin requests without calling persistence',async()=>{const response=await POST(new NextRequest('https://example.test/api/help',{method:'POST',headers:{host:'example.test',origin:'https://other.test'},body:'{}'}));expect(response.status).toBe(403);});
 it('public intake rejects oversized requests before persistence',async()=>{const response=await POST(new NextRequest('https://example.test/api/help',{method:'POST',headers:{host:'example.test',origin:'https://example.test','content-length':'17000'},body:'{}'}));expect(response.status).toBe(413);});
});
