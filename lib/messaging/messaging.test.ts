import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import twilio from 'twilio';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { demoSeed } from '@/lib/persistence/demo';
import { operationsRepository, type RpcClient } from '@/lib/persistence/repository';
import { normalizeRetell } from '@/lib/retell/normalize';
import { ingestRetell } from '@/lib/retell/ingest';
import { LEGACY_EXTRACTION_CONCEPTS, type ExtractionMap } from '@/config/retell';
import { applyHumanOverride } from '@/lib/engine';
import { caseReducer } from '@/lib/cases';
import { decryptContact, protectContact } from '@/lib/retell/contact';
import { messagingConfig, type MessagingConfig, SMS_TEXT } from './config';
import { recoverCall, recoveryEligible, receiveMessage } from './service';
import { updateFromReply } from './reply';
import { handleTwilio } from './handler';
import { TwilioMessagingProvider } from './twilio';
import type { MessagingProvider } from './provider';
vi.mock('server-only',()=>({}));
const key=Buffer.alloc(32,9), phone='+12025550123', from='+12025550100';
const config:MessagingConfig={accountSid:'AC'+'1'.repeat(32),apiKey:'SK'+'2'.repeat(32),apiSecret:'synthetic-secret',authToken:'synthetic-auth-token',
  from,baseUrl:'https://example.invalid',recipients:[phone],encryptionKey:key,templates:SMS_TEXT};
const mapping=Object.fromEntries(LEGACY_EXTRACTION_CONCEPTS.map(k=>[k,k])) as ExtractionMap;
const sid=(n=1)=>'SM'+n.toString(16).padStart(32,'0');
function payload(id='sms_fixture',fields:Record<string,unknown>={}){
 return {event:'call_analyzed',call:{call_id:id,agent_id:'fixture_agent',call_type:'phone_call',direction:'inbound',from_number:phone,to_number:from,
  call_status:'ended',start_timestamp:Date.now()-60000,end_timestamp:Date.now()-1000,disconnection_reason:'user_hangup',
  call_analysis:{call_successful:false,custom_analysis_data:{caller_name:'Synthetic SMS Test',reason_for_contact:'Request information',need_category:'other',location_zone:'unknown',
  facility_signals:[],unresolved_need:true,human_requested:false,emergency_guidance_provided:false,automation_resolved_request:false,...fields}}}};
}
let db:PGlite;
const signatures:Record<string,string[]>={zianecomms_sms_call_context:['p_call_id'],zianecomms_sms_claim:['p_call_id','p_provider','p_body'],
 zianecomms_sms_mark_unknown:['p_call_id'],zianecomms_sms_correlate:['p_provider','p_message_id','p_identity'],
 zianecomms_sms_status:['p_call_id','p_provider_id','p_status'],zianecomms_retell_context:['p_call_id','p_linked_case_id']};
const adapter:RpcClient={async rpc(name,args={}){
 await db.exec('savepoint sms_rpc');
 try{
 let sql:string,params:unknown[]=[];
 if(name==='zianecomms_load_demo')sql='select public.zianecomms_load_demo() result';
 else if(name==='zianecomms_save_demo'||name==='zianecomms_ingest_retell'||name==='zianecomms_sms_commit'){
  sql=`select public.${name}($1::bigint,$2::uuid,$3::jsonb${name==='zianecomms_save_demo'?'':',$4::jsonb'}) result`;
  params=[args.p_expected_revision,args.p_mutation_id,JSON.stringify(args.p_payload)];
  if(name!=='zianecomms_save_demo')params.push(JSON.stringify(name==='zianecomms_ingest_retell'?args.p_call:args.p_message));
 }else{ const keys=signatures[name];if(!keys)throw Error('Unexpected RPC');params=keys.map(k=>args[k]);sql=`select public.${name}(${keys.map((_,i)=>'$'+(i+1)).join(',')}) result`; }
 const result=await db.query<{result:unknown}>(sql,params);await db.exec('release savepoint sms_rpc');return {data:result.rows[0].result,error:null};
 }catch(e){await db.exec('rollback to savepoint sms_rpc');return {data:null,error:{message:(e as Error).message,code:(e as {code:string}).code}};}
}};
const repo=operationsRepository(adapter);
const send=vi.fn(async()=>({id:sid(),status:'queued'}));
const provider:MessagingProvider={name:'twilio',sendMessage:send,normalizeInboundMessage:f=>({provider:'twilio',id:f.MessageSid,from:f.From,to:f.To,body:f.Body})};
async function setup(id='sms_fixture',fields:Record<string,unknown>={}){await ingestRetell(adapter,normalizeRetell(payload(id,fields),'disaster',mapping),key);return current(id);}
async function current(id='sms_fixture'){return (await repo.load()).state.callersByMode.disaster.find(c=>c.id===`retell-${id}`)!;}
async function recover(id='sms_fixture'){return recoverCall(adapter,provider,config,id);}
const inbound=(body:string,n=2)=>({provider:'twilio',id:sid(n),from:phone,to:from,body});
async function query<T=Record<string,unknown>>(sql:string){return (await db.query<T>(sql)).rows;}
function request(fields:Record<string,string>,valid=true,status=false){
 const url=config.baseUrl+(status?'/api/webhooks/twilio/status?recovery=recovery-sms_fixture':'/api/webhooks/twilio/sms');
 const signature=valid?twilio.getExpectedTwilioSignature(config.authToken,url,fields):'invalid';
 return new Request(url,{method:'POST',body:new URLSearchParams(fields),headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':signature}});
}
const form=(body='URGENT')=>({AccountSid:config.accountSid,MessageSid:sid(2),From:phone,To:from,Body:body,NumMedia:'0'});
const deps={config:()=>config,client:()=>adapter};
beforeAll(async()=>{db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
 for(const name of readdirSync(new URL('../../supabase/migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(`../../supabase/migrations/${name}`,import.meta.url),'utf8'));
 await db.query('select public.zianecomms_seed_demo($1::jsonb)',[JSON.stringify(demoSeed())]);},60000);
beforeEach(async()=>{await db.exec('begin');send.mockReset();send.mockResolvedValue({id:sid(),status:'queued'});});
afterEach(async()=>{await db.exec('rollback');vi.restoreAllMocks();});afterAll(async()=>{await db.close();});
describe('SMS recovery policy and durable delivery',()=>{
 it('qualifying unresolved call sends and persists outbound provider/call metadata',async()=>{await setup();expect(await recover()).toBe('sent');expect(send).toHaveBeenCalledOnce();
 const [m]=await query("select * from public.messages where channel='sms'");expect(m.direction).toBe('outbound');expect(m.provider_message_id).toBe(sid());expect(m.call_id).toBe('sms_fixture');});
 it('resolved automation with no followup does not send even after hangup',async()=>{await setup('sms_fixture',{unresolved_need:false,automation_resolved_request:true});await recover();expect(send).not.toHaveBeenCalled();});
 it('human followup independently qualifies',async()=>{const c=await setup('sms_fixture',{unresolved_need:false,human_requested:true});expect(recoveryEligible(c)).toBe(true);await recover();expect(send).toHaveBeenCalledOnce();});
 it('hangup alone is not unfinished; explicit call failure qualifies',async()=>{const c=await setup('sms_fixture',{unresolved_need:false});expect(recoveryEligible({...c,retell:{...c.retell!,callSuccessful:undefined}})).toBe(false);expect(recoveryEligible(c)).toBe(true);});
 it('do-not-contact blocks even unresolved need',async()=>{const c=await setup();expect(recoveryEligible({...c,retell:{...c.retell!,disconnectionReason:'user_requested_dnc'}})).toBe(false);});
 it('closed case cannot send',async()=>{const c=await setup();const {state,revision}=await repo.load();await repo.save(caseReducer(state,{type:'patch',rulebook:'disaster',id:c.id,patch:{status:'resolved'}}),revision,randomUUID());await recover();expect(send).not.toHaveBeenCalled();});
 it('missing private callback number never sends',async()=>{await setup();await db.exec("update zianecomms_private.case_contacts set contact_kind='demo',phone_identity=null,contact_value=null where case_id='retell-sms_fixture'");expect(await recover()).toBe('missing_contact');expect(send).not.toHaveBeenCalled();});
 it('allowlist excludes nonconsenting/nonverified demo recipients',async()=>{await setup();expect(await recoverCall(adapter,provider,{...config,recipients:[]},'sms_fixture')).toBe('recipient_not_allowed');expect(send).not.toHaveBeenCalled();});
 it('duplicate Retell and worker invocation send once',async()=>{await setup();await recover();await setup();await recover();expect(send).toHaveBeenCalledOnce();expect((await current()).activityLog.filter(e=>e.label==='Recovery SMS sent')).toHaveLength(1);});
 it('provider timeout is unknown and never automatically resent',async()=>{await setup();send.mockRejectedValueOnce(Error('timeout'));expect(await recover()).toBe('unknown');await recover();expect(send).toHaveBeenCalledOnce();expect((await query("select state from zianecomms_private.sms_recovery"))[0].state).toBe('unknown');});
 it('provider can be replaced without changing recovery logic',async()=>{await setup();await recoverCall(adapter,{...provider,name:'replacement'},config,'sms_fixture');expect((await query("select provider from public.messages where channel='sms'"))[0].provider).toBe('replacement');});
 it('disabled configuration returns null and enabled config fails closed',()=>{expect(messagingConfig({})).toBeNull();expect(()=>messagingConfig({TWILIO_ENABLED:'true'})).toThrow();});
});
describe('SMS replies, correlation and existing deterministic scoring',()=>{
 it('valid signed inbound persists and timeline shows send/reply/recalculation',async()=>{await setup();await recover();expect((await handleTwilio(request(form()),deps)).status).toBe(200);
 const c=await current();expect(c.activityLog.slice(-3).map(e=>e.label)).toEqual(['Recovery SMS sent','SMS reply received','Priority recalculated after SMS']);expect(c.status).toBe('needs_followup');
 expect((await query("select * from public.messages where direction='inbound' and channel='sms'"))).toHaveLength(1);});
 it('invalid signature is rejected before persistence',async()=>{expect((await handleTwilio(request(form(),false),deps)).status).toBe(401);expect((await query('select * from zianecomms_private.sms_receipts'))).toHaveLength(0);});
 it('official SDK normalizes actual Twilio form parameters',()=>{expect(new TwilioMessagingProvider(config).normalizeInboundMessage(form('hello'))).toEqual(inbound('hello'));});
 it('duplicate inbound delivery is idempotent',async()=>{await setup();await recover();await receiveMessage(adapter,inbound('URGENT'),config);await receiveMessage(adapter,inbound('URGENT'),config);expect((await current()).activityLog.filter(e=>e.type==='sms_received')).toHaveLength(1);});
 it('reply joins the active recovery case and leaves unrelated historical case alone',async()=>{await setup();await recover();await setup('unrelated');await receiveMessage(adapter,inbound('Need followup'),config);expect((await current()).activityLog.some(e=>e.type==='sms_received')).toBe(true);expect((await current('unrelated')).activityLog.some(e=>e.type==='sms_received')).toBe(false);});
 it('two active recovery cases for same contact are flagged rather than guessed',async()=>{await setup();await recover();await setup('another');send.mockResolvedValueOnce({id:sid(4),status:'queued'});await recover('another');await receiveMessage(adapter,inbound('help'),config);
 expect((await query('select case_id,review_required from zianecomms_private.sms_receipts'))[0]).toMatchObject({case_id:null,review_required:true});expect((await current()).activityLog.some(e=>e.type==='sms_received')).toBe(false);});
 it('closed recovery is excluded and reply retained privately for review',async()=>{const c=await setup();await recover();const {state,revision}=await repo.load();await repo.save(caseReducer(state,{type:'patch',rulebook:'disaster',id:c.id,patch:{status:'referred'}}),revision,randomUUID());await receiveMessage(adapter,inbound('Need followup'),config);expect((await query('select case_id from zianecomms_private.sms_receipts'))[0].case_id).toBeNull();});
 it('explicit equipment and power facts recalculate, preserve history, survive reload',async()=>{const original=await setup();await recover();await receiveMessage(adapter,inbound('medical_equipment_dependency=yes;power_disruption=yes'),config);const c=await current();expect(c.engineInput?.facilitySignals).toContain('medical_equipment_dependency');expect(c.score).toBeGreaterThan(original.score);expect(c.attempts).toBe(original.attempts);expect(c.activityLog.at(-1)?.previousCalculatedPriority).toBe(original.calculatedPriority);expect((await query("select * from public.priority_events where id like 'sms-priority-%'"))).toHaveLength(1);});
 it('active human override is preserved across SMS recalculation',async()=>{const c=await setup();const {state,revision}=await repo.load();const override=applyHumanOverride(c,3,'Synthetic operator decision','operator-test');await repo.save(caseReducer(state,{type:'patch',rulebook:'disaster',id:c.id,patch:override.callerPatch,logEntry:override.logEntry}),revision,randomUUID());await recover();await receiveMessage(adapter,inbound('medical_equipment_dependency=yes;power_disruption=yes'),config);const updated=await current();expect(updated.priority).toBe(3);expect(updated.manualPriority).toBe(true);expect(updated.calculatedPriority).toBeLessThan(3);expect(updated.manualPriorityReason).toBe('Synthetic operator decision');});
 it('free text oxygen example stays unstructured; provider priority is ignored',async()=>{const c=await setup();const next=updateFromReply(c,"My mother's oxygen machine stopped because the power is out;priority=0",sid(),new Date().toISOString());expect(next.engineInput?.facilitySignals).toEqual(c.engineInput?.facilitySignals);expect(next.calculatedPriority).toBe(c.calculatedPriority);expect(next.questionnaire.at(-1)?.answer).toContain('oxygen');});
 it('URGENT requests human followup without inventing a medical emergency',async()=>{const c=await setup();const next=updateFromReply(c,'URGENT',sid(),new Date().toISOString());expect(next.hardEscalation).toBe(c.hardEscalation);expect(next.status).toBe('needs_followup');});
 it('partial equipment facts cannot infer power failure or hard escalation',async()=>{const c=await setup();const next=updateFromReply(c,'medical_equipment_dependency=yes',sid(),new Date().toISOString());expect(next.engineInput?.facilitySignals).not.toContain('medical_equipment_dependency');});
 it('raw reply is encrypted privately and phone text is redacted in dashboard',async()=>{await setup();await recover();const body='Please call '+phone;await receiveMessage(adapter,inbound(body),config);const [r]=await query<{encrypted_body:string}>('select encrypted_body from zianecomms_private.sms_receipts');expect(decryptContact(r.encrypted_body,key,sid(2))).toBe(body);expect(JSON.stringify(await current())).not.toContain(phone);});
 it('STOP persists suppression and blocks subsequent recovery',async()=>{await setup();await recover();await receiveMessage(adapter,inbound('STOP'),config);await setup('nextcall');await recover('nextcall');expect(send).toHaveBeenCalledOnce();});
 it('out-of-order status does not regress delivered message',async()=>{await setup();await recover();const fields={AccountSid:config.accountSid,MessageSid:sid(),From:from,MessageStatus:'delivered'};expect((await handleTwilio(request(fields,true,true),deps,true)).status).toBe(200);await handleTwilio(request({...fields,MessageStatus:'sent'},true,true),deps,true);expect((await query("select status from public.messages where channel='sms'"))[0].status).toBe('delivered');});
 it('wrong account, destination or multimedia input is rejected',()=>{const p=new TwilioMessagingProvider(config);expect(()=>p.normalizeInboundMessage({...form(),To:phone})).toThrow();expect(()=>p.normalizeInboundMessage({...form(),AccountSid:'wrong'})).toThrow();expect(()=>p.normalizeInboundMessage({...form(),NumMedia:'1'})).toThrow();});
 it('encrypted contacts cannot decrypt under another case binding',()=>{const encrypted=protectContact(phone,key,'case-a').encrypted!;expect(()=>decryptContact(encrypted,key,'case-b')).toThrow();});
 it('private tables and RPCs are inaccessible to anonymous clients',async()=>{
 const rows=await query("select has_table_privilege('anon','zianecomms_private.sms_recovery','select') permitted,has_function_privilege('anon','public.zianecomms_sms_claim(text,text,text)','execute') callable");
 expect(rows[0]).toMatchObject({permitted:false,callable:false});
 });
 it('structured facts combine across successive SMS replies without prose guessing',async()=>{
 const c=await setup();const first=updateFromReply(c,'medical_equipment_dependency=yes',sid(2),new Date().toISOString());
 const second=updateFromReply(first,'power_disruption=yes',sid(3),new Date().toISOString());
 expect(second.engineInput?.facilitySignals).toContain('medical_equipment_dependency');
 });
 it('server-only guards protect credentials and provider module imports',()=>{
 for(const name of ['config','service','twilio'])expect(readFileSync(new URL(`./${name}.ts`,import.meta.url),'utf8')).toContain("import 'server-only'");
 expect(readFileSync(new URL('../../.env.example',import.meta.url),'utf8')).not.toContain('NEXT_PUBLIC_TWILIO');
 });
 it('signature validation uses configured public origin behind Vercel proxy',async()=>{
 await setup();await recover();const r=request(form());const proxied=new Request('http://localhost:3000/api/webhooks/twilio/sms',{method:'POST',headers:r.headers,body:await r.text()});
 expect((await handleTwilio(proxied,deps)).status).toBe(200);
 });
 it('provider acceptance can be reconciled by callback without a second send',async()=>{
 await setup();send.mockRejectedValueOnce(Error('HTTP response lost'));await recover();
 const fields={AccountSid:config.accountSid,MessageSid:sid(),From:from,MessageStatus:'delivered'};
 expect((await handleTwilio(request(fields,true,true),deps,true)).status).toBe(200);await recover();expect(send).toHaveBeenCalledOnce();
 expect((await query("select status from public.messages where channel='sms'"))[0].status).toBe('delivered');
 });

 it('unknown latest structured fact cannot establish a new safety conjunction',async()=>{
 const c=await setup();const first=updateFromReply(c,'medical_equipment_dependency=yes',sid(2),new Date().toISOString());
 const uncertain=updateFromReply(first,'medical_equipment_dependency=unknown',sid(3),new Date().toISOString());
 const next=updateFromReply(uncertain,'power_disruption=yes',sid(4),new Date().toISOString());
 expect(next.engineInput?.facilitySignals).not.toContain('medical_equipment_dependency');
 });
 it('database acceptance failure after send cannot cause duplicate SMS',async()=>{
 await setup();const broken:RpcClient={rpc(name,args){return name==='zianecomms_sms_commit'?Promise.resolve({data:null,error:{message:'temporary failure'}}):adapter.rpc(name,args);}};
 await expect(recoverCall(broken,provider,config,'sms_fixture')).rejects.toThrow();await recover();expect(send).toHaveBeenCalledOnce();
 });
 it('revision conflict retries reply transaction without duplicating history',async()=>{
 await setup();await recover();let conflict=true;
 const racing:RpcClient={rpc(name,args){if(name==='zianecomms_sms_commit'&&conflict){conflict=false;return Promise.resolve({data:null,error:{message:'revision changed',code:'40001'}});}return adapter.rpc(name,args);}};
 await receiveMessage(racing,inbound('URGENT'),config);expect((await current()).activityLog.filter(e=>e.type==='sms_received')).toHaveLength(1);
 });
 it('malformed signed SMS is rejected as input rather than retried as a database failure',async()=>{
 expect((await handleTwilio(request({...form(),To:phone}),deps)).status).toBe(400);
 });

});
