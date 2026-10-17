import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import Retell,{sign} from 'retell-sdk';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {demoSeed} from '@/lib/persistence/demo';
import {operationsRepository,type RpcClient} from '@/lib/persistence/repository';
import {normalizeRetell} from '@/lib/retell/normalize';
import {ingestRetell} from '@/lib/retell/ingest';
import {LEGACY_EXTRACTION_CONCEPTS,type ExtractionMap} from '@/config/retell';
import {caseReducer} from '@/lib/cases';
import {applyHumanOverride,scoreCallerInput} from '@/lib/engine';
import {recoverCall} from '@/lib/messaging/service';
import {RetellChatProvider} from './provider';
import {chatConfig,type ChatConfig} from './config';
import {normalizeChat} from './normalize';
import {mergeChatFacts} from './facts';
import {chatContext,ingestChat,updateChatCase} from './ingest';
import {handleChatWebhook} from './handler';
import {demoSession} from './demo';
import RecoveryChatDemo from '@/components/RecoveryChatDemo';
vi.mock('server-only',()=>({}));
const key=Buffer.alloc(32,8),secret='synthetic-chat-signing-key';
const config:ChatConfig={apiKey:secret,agentId:'agent_synthetic_chat',encryptionKey:key,recipients:[],dynamicVariables:{organization_name:'Synthetic support'},
 templates:{disaster:'ZianeComms recovery invitation — carrier simulated.',clinic:'Clinic recovery invitation.'}};
const mapping=Object.fromEntries(LEGACY_EXTRACTION_CONCEPTS.map(k=>[k,k])) as ExtractionMap;
let db:PGlite;
const adapter:RpcClient={async rpc(name,args={}){
 await db.exec('savepoint chat_rpc');
 try{
  if(!/^zianecomms_[a-z_]+$/.test(name))throw Error('Unexpected RPC');
  const entries=Object.entries(args);
  const params=entries.map(([k,v])=>['p_payload','p_call','p_chat','p_message'].includes(k)?JSON.stringify(v):v);
  const typed=entries.map(([k],i)=>`${k} => $${i+1}::${['p_payload','p_call','p_chat','p_message'].includes(k)?'jsonb':k==='p_expected_revision'?'bigint':['p_mutation_id','p_request_id'].includes(k)?'uuid':'text'}`);
  const result=await db.query<{result:unknown}>(`select public.${name}(${typed.join(',')}) result`,params);
  await db.exec('release savepoint chat_rpc');return {data:result.rows[0].result,error:null};
 }catch(e){await db.exec('rollback to savepoint chat_rpc');return {data:null,error:{message:(e as Error).message,code:(e as {code:string}).code}};}
}};
const repo=operationsRepository(adapter);
function voice(id='voice_chat_fixture'){
 const now=Date.now();return {event:'call_analyzed',call:{call_id:id,agent_id:'voice_fixture_agent',call_type:'web_call',call_status:'ended',start_timestamp:now-60000,end_timestamp:now,
 call_analysis:{custom_analysis_data:{caller_name:'Synthetic Recovery Caller',reason_for_contact:'Safe caller displaced by wildfire, requesting shelter',
 preferred_language:'English',location:'Shelter waiting area',need_category:'shelter',location_zone:'outside',facility_signals:[],
 human_requested:true,unresolved_need:true,emergency_guidance_provided:false,automation_resolved_request:false}}}};
}
function chat(fields:Record<string,unknown>={},overrides:Record<string,unknown>={}){
 return {chat_id:'chat_fixture',agent_id:config.agentId,chat_status:'ended',metadata:{case_id:'retell-voice_chat_fixture',original_call_id:'voice_chat_fixture'},
 end_timestamp:Date.now(),message_with_tool_calls:[{message_id:'user_fixture',role:'user',content:"My mother's oxygen machine stopped because the power went out.",created_timestamp:Date.now()}],
 chat_analysis:{chat_summary:'Caller reports new equipment and electricity concerns.',custom_analysis_data:{caller_replied:'yes',medical_equipment_dependency:'yes',power_disruption:'yes',...fields}},...overrides};
}
const create=vi.fn(async(_body:unknown)=>({chat_id:'chat_fixture',agent_id:config.agentId,chat_status:'ongoing'}));
const retrieve=vi.fn(async(_id:string)=>chat({}, {chat_status:'ongoing'}));
const completion=vi.fn(async(_body:unknown)=>({messages:[]}));const end=vi.fn(async(_id:string)=>{});
const api={chat:{create,retrieve,createChatCompletion:completion,end}} as unknown as Retell;
const provider=()=>new RetellChatProvider(config,api);
async function setup(id='voice_chat_fixture'){
 await ingestRetell(adapter,normalizeRetell(voice(id),'disaster',mapping),key);
 return (await repo.load()).state.callersByMode.disaster.find(c=>c.id==='retell-'+id)!;
}
async function start(){await setup();expect(await recoverCall(adapter,provider(),config,'voice_chat_fixture')).toBe('sent');return current();}
async function current(){return (await repo.load()).state.callersByMode.disaster.find(c=>c.id==='retell-voice_chat_fixture')!;}
async function sql<T=Record<string,unknown>>(q:string){return (await db.query<T>(q)).rows;}
async function signed(payload:unknown,valid=true){const raw=JSON.stringify(payload);return new Request('https://example.invalid/api/webhooks/retell-chat',{
 method:'POST',body:raw,headers:{'content-type':'application/json','x-retell-signature':valid?await sign(raw,secret):'invalid'}});}
const deps={config:()=>config,client:()=>adapter};
beforeAll(async()=>{db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
 for(const file of readdirSync(new URL('../../supabase/migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(`../../supabase/migrations/${file}`,import.meta.url),'utf8'));
 await db.query('select public.zianecomms_seed_demo($1::jsonb)',[JSON.stringify(demoSeed())]);},60000);
beforeEach(async()=>{await db.exec('begin');create.mockClear();retrieve.mockClear();completion.mockClear();end.mockClear();});
afterEach(async()=>{await db.exec('rollback');vi.restoreAllMocks();vi.unstubAllEnvs();});afterAll(async()=>{await db.close();});
describe('Retell Chat as a replaceable recovery transport',()=>{
 it('satisfies provider interface and normalizes a logical chat address without a phone',()=>{
 const p=provider();expect(p.transport).toBe('retell_chat');expect(p.normalizeInboundMessage({case_id:'case_a',chat_id:'chat_a',message_id:'msg_a',content:'Hello'})).toEqual({provider:'retell-chat',id:'chat_a:msg_a',from:'case_a',to:'chat_a',body:'Hello'});
 });
 it('uses existing recovery engine without requiring a telephone contact',async()=>{await start();expect(create).toHaveBeenCalledOnce();const [m]=await sql("select * from public.messages where channel='retell_chat'");expect(m.provider).toBe('retell-chat');expect(m.direction).toBe('outbound');});
 it('passes verified case/original-call metadata and latest published agent',async()=>{await start();expect(create.mock.calls[0]?.[0]).toMatchObject({agent_id:config.agentId,agent_version:'latest_published',metadata:{case_id:'retell-voice_chat_fixture',original_call_id:'voice_chat_fixture',transport:'hackathon_carrier_simulated'}});});
 it('maps dynamic context and organization variables without client credentials',async()=>{await start();expect(create.mock.calls[0]?.[0]).toMatchObject({retell_llm_dynamic_variables:{case_id:'retell-voice_chat_fixture',original_call_id:'voice_chat_fixture',caller_name:'Synthetic Recovery Caller',preferred_language:'English',previous_location:'Shelter waiting area',previous_requested_service:'shelter',organization_name:'Synthetic support',opt_out_text:'You can end this demo chat at any time.'}});});
 it('duplicate recovery attempts do not create a second session',async()=>{await start();await recoverCall(adapter,provider(),config,'voice_chat_fixture');expect(create).toHaveBeenCalledOnce();});
 it('recovery creates an existing-timeline event with transparent transport wording',async()=>{const c=await start();expect(c.activityLog.at(-1)?.label).toBe('Recovery initiated — Retell Chat');expect(c.activityLog.at(-1)?.detail).toContain('Carrier simulated');});
 it('disabled config does not require credentials; enabled config fails closed',()=>{expect(chatConfig({})).toBeNull();expect(()=>chatConfig({RETELL_CHAT_ENABLED:'true'})).toThrow();});
 it('case metadata cannot be overridden through organization dynamic variables',async()=>{const c=await setup();await recoverCall(adapter,new RetellChatProvider({...config,dynamicVariables:{case_id:'wrong'}},api),config,c.retell!.callId);expect(create.mock.calls[0]?.[0]).toMatchObject({retell_llm_dynamic_variables:{case_id:c.id}});});
});
describe('Signed events, correlation, persistence and deterministic facts',()=>{
 it('rejects invalid official Retell signature',async()=>{expect((await handleChatWebhook(await signed({event:'chat_analyzed',chat:chat()},false),deps)).status).toBe(401);});
 it('rejects a wrong configured chat agent',async()=>{expect((await handleChatWebhook(await signed({event:'chat_analyzed',chat:chat({}, {agent_id:'agent_wrong'})}),deps)).status).toBe(403);});
 it('accepts actual-format signed analysis and persists recalculated state',async()=>{const c=await start();const response=await handleChatWebhook(await signed({event:'chat_analyzed',chat:chat()}),deps);expect(response.status).toBe(200);const next=await current();expect(next.score).toBeGreaterThan(c.score);expect(next.engineInput?.facilitySignals).toContain('medical_equipment_dependency');expect(next.calculatedPriority).toBe(scoreCallerInput(next.engineInput!).priority);});
 it('duplicate analyzed event commits once',async()=>{await start();const p={event:'chat_analyzed',chat:chat()};await handleChatWebhook(await signed(p),deps);await handleChatWebhook(await signed(p),deps);expect((await current()).activityLog.filter(e=>e.label==='Recovery chat analyzed')).toHaveLength(1);expect((await sql("select * from public.priority_events where id='chat-priority-chat_fixture'"))).toHaveLength(1);});
 it('metadata chooses exact case while unrelated cases are unchanged',async()=>{await start();const other=await setup('other_voice');await ingestChat(adapter,normalizeChat(chat(),'chat_analyzed'));expect((await repo.load()).state.callersByMode.disaster.find(c=>c.id===other.id)).toEqual(other);});
 it.each([{}, {case_id:'bad/path',original_call_id:'voice_chat_fixture'}, {original_call_id:'voice_chat_fixture'}])('missing/invalid metadata cannot attach %#',async metadata=>{await start();expect((await handleChatWebhook(await signed({event:'chat_analyzed',chat:chat({}, {metadata})}),deps)).status).toBe(400);});
 it('valid-looking metadata cannot hijack another case/session',async()=>{await start();const other=await setup('other_voice');await expect(ingestChat(adapter,normalizeChat(chat({}, {metadata:{case_id:other.id,original_call_id:'other_voice'}}),'chat_analyzed'))).rejects.toThrow();expect((await repo.load()).state.callersByMode.disaster.find(c=>c.id===other.id)).toEqual(other);});
 it('caller_replied=no preserves facts and priority even if empty analysis asserts equipment',async()=>{const c=await start();await ingestChat(adapter,normalizeChat(chat({caller_replied:'no'}),'chat_analyzed'));const next=await current();expect(next.engineInput).toEqual(c.engineInput);expect(next.priority).toBe(c.priority);});
 it('unknown caller_replied does not apply extraction',async()=>{const c=await start();await ingestChat(adapter,normalizeChat(chat({caller_replied:'unknown'}),'chat_analyzed'));expect((await current()).engineInput).toEqual(c.engineInput);});
 it('no actual caller messages prevents an affirmative extraction from changing priority',async()=>{const c=await start();await ingestChat(adapter,normalizeChat(chat({}, {message_with_tool_calls:[]}),'chat_analyzed'));expect((await current()).engineInput).toEqual(c.engineInput);});
 it('unknown fields do not overwrite known language, location, zone or service',async()=>{const c=await setup();const next=mergeChatFacts(c,{caller_replied:'yes',preferred_language:'unknown',location:'unknown',location_zone:'unknown',requested_service:'unknown'},'chat_fixture',new Date().toISOString());expect(next.engineInput).toEqual(c.engineInput);expect(next.language).toBe(c.language);});
 it('confirmed new fields update state and keep attempts stable',async()=>{const c=await start();await ingestChat(adapter,normalizeChat(chat({location:'New safe meeting point',preferred_language:'Spanish'}),'chat_analyzed'));const next=await current();expect(next.location).toBe('New safe meeting point');expect(next.language).toBe('Spanish');expect(next.attempts).toBe(c.attempts);});
 it('preserves free text and existing voice/questionnaire history',async()=>{const c=await start();await ingestChat(adapter,normalizeChat(chat({safety_context_signals:'Specific equipment model unknown; caller requests help.'}),'chat_analyzed'));const next=await current();expect(next.activityLog.slice(0,c.activityLog.length)).toEqual(c.activityLog);expect(next.activityLog.some(e=>e.detail?.includes('oxygen machine'))).toBe(true);expect(next.questionnaire.some(q=>q.answer.includes('equipment model unknown'))).toBe(true);});
 it('preserves a human override independently of calculated priority',async()=>{const c=await start();const {state,revision}=await repo.load();const o=applyHumanOverride(c,3,'Synthetic override','operator-test');await repo.save(caseReducer(state,{type:'patch',rulebook:'disaster',id:c.id,patch:o.callerPatch,logEntry:o.logEntry}),revision,randomUUID());await ingestChat(adapter,normalizeChat(chat(),'chat_analyzed'));const next=await current();expect(next.priority).toBe(3);expect(next.manualPriorityReason).toBe('Synthetic override');expect(next.calculatedPriority).toBeLessThan(3);});
 it('Retell priority/score/rule keys are ignored',async()=>{const c=await setup();expect(mergeChatFacts(c,{caller_replied:'yes',priority:0,score:100,facility_signals:['immediate_life_threat']},'x',new Date().toISOString()).engineInput).toEqual(c.engineInput);});
 it('chat_ended stores history but ignores all analysis fields',async()=>{const c=await start();await ingestChat(adapter,normalizeChat(chat(),'chat_ended'));expect((await current()).engineInput).toEqual(c.engineInput);expect((await current()).activityLog.at(-1)?.label).toBe('Recovery chat completed');});
 it('late chat_ended after analyzed never rewrites priority history',async()=>{await start();await ingestChat(adapter,normalizeChat(chat(),'chat_analyzed'));const before=await current();await ingestChat(adapter,normalizeChat(chat(),'chat_ended'));const after=await current();expect(after.activityLog.slice(0,before.activityLog.length)).toEqual(before.activityLog);});
 it('closed case keeps priority and status while retaining the chat audit',async()=>{const c=await start();const {state,revision}=await repo.load();await repo.save(caseReducer(state,{type:'patch',rulebook:'disaster',id:c.id,patch:{status:'resolved'}}),revision,randomUUID());await ingestChat(adapter,normalizeChat(chat(),'chat_analyzed'));expect((await current()).status).toBe('resolved');expect((await current()).score).toBe(c.score);});
 it('raw phone-like content is redacted before reaching stored chat messages',async()=>{await start();await ingestChat(adapter,normalizeChat(chat({}, {message_with_tool_calls:[{message_id:'msg_phone',role:'user',content:'Call +12025550123'}]}),'chat_analyzed'));expect(JSON.stringify(await current())).not.toContain('+12025550123');});
 it('a refresh sync cannot apply analysis and creates no duplicate messages',async()=>{const c=await start();const i=normalizeChat(chat(),'sync');await ingestChat(adapter,i);await ingestChat(adapter,i);expect((await current()).engineInput).toEqual(c.engineInput);expect((await sql("select * from public.messages where provider_message_id='chat_fixture:user_fixture'"))).toHaveLength(1);});
 it('full history shows initiated, reply, analyzed then recalculation',async()=>{await start();await ingestChat(adapter,normalizeChat(chat(),'chat_analyzed'));const labels=(await current()).activityLog.map(e=>e.label);expect(labels).toContain('Recovery initiated — Retell Chat');expect(labels.slice(-3)).toEqual(['Caller replied — Recovery Chat','Recovery chat analyzed','Priority recalculated after recovery chat']);});
});
describe('Demo UI, turn idempotency and existing safety boundaries',()=>{
 it('demo UI explicitly discloses simulated carrier transport',()=>{const html=renderToStaticMarkup(createElement(RecoveryChatDemo,{caseId:'case_fixture'}));expect(html).toContain('Carrier simulated for hackathon demo');expect(html).toContain('No carrier SMS is sent');expect(html).not.toContain('SMS delivered');});
 it('turn claim only accepts one in-flight operation and blocks repeats',async()=>{await start();const id=randomUUID();const a={p_case_id:'retell-voice_chat_fixture',p_chat_id:'chat_fixture',p_request_id:id};expect((await adapter.rpc('zianecomms_chat_turn_claim',a)).data).toBe(true);expect((await adapter.rpc('zianecomms_chat_turn_claim',a)).data).toBe(false);expect((await adapter.rpc('zianecomms_chat_turn_claim',{...a,p_request_id:randomUUID()})).data).toBe(false);});
 it('demo sends through the real SDK boundary and syncs responses without scoring prose',async()=>{const c=await start();const result=await demoSession(adapter,config,c.id,{action:'send',content:"My mother's oxygen machine stopped because the power went out.",requestId:randomUUID(),chatId:'chat_fixture'},api);expect(completion).toHaveBeenCalledOnce();expect(result.chatId).toBe('chat_fixture');expect((await current()).engineInput).toEqual(c.engineInput);});
 it('demo end action invokes Retell end-chat',async()=>{const c=await start();await demoSession(adapter,config,c.id,{action:'end',chatId:'chat_fixture'},api);expect(end).toHaveBeenCalledWith('chat_fixture');});
 it('recovery context records before priority and analyzed receipt',async()=>{const c=await start();expect((await chatContext(adapter,c.id))?.before_priority).toBe(c.calculatedPriority);await ingestChat(adapter,normalizeChat(chat(),'chat_analyzed'));expect((await chatContext(adapter,c.id))?.analyzed).toBe(true);});
 it('private chat functions and events do not grant anonymous access',async()=>{const [r]=await sql("select has_function_privilege('anon','public.zianecomms_chat_commit(bigint,uuid,jsonb,jsonb)','execute') callable,has_table_privilege('anon','zianecomms_private.recovery_chat_events','select') readable");expect(r).toEqual({callable:false,readable:false});});
 it('Twilio and voice signature verification implementations remain present',()=>{expect(readFileSync(new URL('../messaging/twilio.ts',import.meta.url),'utf8')).toContain('twilio.validateRequest');expect(readFileSync(new URL('../retell/handler.ts',import.meta.url),'utf8')).toContain('verifyRetellSignature');});
 it('retrying a completed UI request never sends a second Retell turn',async()=>{
 const c=await start();const op={action:'send',content:'Additional information',requestId:randomUUID(),chatId:'chat_fixture'};
 await demoSession(adapter,config,c.id,op,api);await demoSession(adapter,config,c.id,op,api);expect(completion).toHaveBeenCalledOnce();
 });
 it('old completed chat facts cannot overwrite a newer voice intake',async()=>{
 const c=await start();const i=normalizeChat(chat({}, {end_timestamp:Date.parse(c.retell!.endedAt)-1000}),'chat_analyzed');
 await ingestChat(adapter,i);expect((await current()).engineInput).toEqual(c.engineInput);
 });
 it('recorded older session remains bound even after another recovery for the same case',async()=>{
 const c=await start();await db.query("insert into zianecomms_private.retell_calls(call_id,agent_id,case_id,facility_id,event_type,call_status,call_type,started_at,ended_at) values('voice_second','voice_fixture_agent',$1,'zianecomms-demo','call_analyzed','ended','web_call',now(),now())",[c.id]);
 await db.query("insert into zianecomms_private.sms_recovery(call_id,case_id,provider,phone_identity,body,state,provider_message_id,created_at) values('voice_second',$1,'retell-chat','case:'||$1,'Another invitation','accepted','chat_second',now()+interval '1 second')",[c.id]);
 await expect(ingestChat(adapter,normalizeChat(chat(),'chat_analyzed'))).resolves.toEqual({duplicate:false});
 });
 it('duplicate provider message identifiers are rejected before audit mutation',()=>{
 const raw=chat();raw.message_with_tool_calls.push(raw.message_with_tool_calls[0]);expect(()=>normalizeChat(raw,'chat_analyzed')).toThrow();
 });

 it('free-text-only extraction remains visible without a priority event',async()=>{
 const c=await setup();const next=mergeChatFacts(c,{caller_replied:'yes',safety_context_signals:'Situation unclear; needs operator review'},'ctx',new Date().toISOString());
 expect(next.engineInput).toEqual(c.engineInput);expect(next.activityLog).toEqual(c.activityLog);expect(next.questionnaire.at(-1)?.answer).toContain('Situation unclear');
 });
 it('Disaster chat agent cannot silently handle a Clinic deployment',async()=>{
 await ingestRetell(adapter,normalizeRetell(voice(),'clinic',mapping),key);
 expect(await recoverCall(adapter,provider(),config,'voice_chat_fixture')).toBe('ineligible');expect(create).not.toHaveBeenCalled();
 });

 it('production failure reproduction: accepted mock claim is explained without any Retell API call',async()=>{
 const id='task6_synthetic_1792263310949';await setup(id);
 await db.query("insert into zianecomms_private.sms_recovery(call_id,case_id,provider,phone_identity,body,state,provider_message_id) values($1,$2,'task6-mock','fixture-identity','Mock verification invitation','accepted','synthetic_out_fixture')",[id,'retell-'+id]);
 const result=await demoSession(adapter,config,'retell-'+id,{action:'start'},api);
 expect(result).toMatchObject({code:'integration_test',canStart:false,status:'unavailable'});
 expect(create).not.toHaveBeenCalled();expect(retrieve).not.toHaveBeenCalled();expect(completion).not.toHaveBeenCalled();
 expect((await sql("select provider,state from zianecomms_private.sms_recovery"))[0]).toEqual({provider:'task6-mock',state:'accepted'});
 });
 it('a real case with an accepted different-provider claim is not blindly retried',async()=>{
 const c=await setup();await db.query("insert into zianecomms_private.sms_recovery(call_id,case_id,provider,phone_identity,body,state,provider_message_id) values($1,$2,'twilio','fixture-identity','Already attempted','accepted','fixture_sms')",[c.retell!.callId,c.id]);
 expect(await demoSession(adapter,config,c.id,{action:'start'},api)).toMatchObject({code:'other_transport',canStart:false});expect(create).not.toHaveBeenCalled();
 });
 it('complete conversation remains readable after signed analysis without offering another recovery',async()=>{
 const c=await start();await ingestChat(adapter,normalizeChat(chat(),'chat_analyzed'));
 const result=await demoSession(adapter,config,c.id,undefined,api);
 expect(result).toMatchObject({chatId:'chat_fixture',canStart:false,canInspect:true,analyzed:true});expect(create).toHaveBeenCalledOnce();
 });
 it('projected pending-turn state prevents blind retry while preserving inspection',async()=>{
 const c=await start();await adapter.rpc('zianecomms_chat_turn_claim',{p_case_id:c.id,p_chat_id:'chat_fixture',p_request_id:randomUUID()});
 const result=await demoSession(adapter,config,c.id,undefined,api);expect(result).toMatchObject({canOpen:true,canSend:false,code:'pending_turn'});
 });

 it('database claim guard also rejects explicit integration provenance',async()=>{
 const c=await setup();await db.query("update public.cases set data=data||jsonb_build_object('provenance','integration_test') where id=$1",[c.id]);
 expect((await adapter.rpc('zianecomms_sms_claim',{p_call_id:c.retell!.callId,p_provider:'retell-chat',p_body:'Must not send'})).data).toBe(false);
 expect((await sql('select * from zianecomms_private.sms_recovery'))).toHaveLength(0);expect(create).not.toHaveBeenCalled();
 });

});
