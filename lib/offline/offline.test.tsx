import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEPLOYMENTS, deployment } from '@/config/deployments';
import { scoreCallerInput } from '@/lib/engine';
import { matchResponders } from '@/lib/matching';
import { deploymentResponders } from '@/lib/cases/deployment';
import { DISASTER_CALLERS, CLINIC_CALLERS, MOCK_RESPONDERS } from '@/data/callers';
import { applyOperationalCommand } from '@/lib/persistence/commands';
import type { CaseState } from '@/lib/cases';
import { helpCaller, validateHelpRequest, type HelpRequest } from '@/lib/help/intake';
import type { DeviceStore } from './storage';
import { cacheSnapshot, OPERATOR_KEY, pendingHelp, saveHelp, syncHelp, syncActions, safeOfflineAction, type OperatorCache, type QueuedAction } from './queue';
import { connected, setDemoOffline } from '@/hooks/useConnectivity';
import HelpForm, { OFFLINE_SAFETY } from '@/components/HelpForm';
import { recoveryChatAccess } from '@/lib/cases/recovery';
export const example = (): HelpRequest => ({ id: '11111111-1111-4111-8111-111111111111', deploymentId: 'algeria', createdOnDeviceAt: '2026-10-17T20:00:00.000Z', savedOffline: true,
 name: 'Demo Caller', contact: '', language: 'ar', need: 'Wildfire nearby. My elderly father has limited mobility and we need evacuation assistance.', service: 'evacuation',
 immediateDanger: 'unknown', medicalNeed: 'unknown', mobilityNeed: 'yes', equipmentNeed: 'no', crisisContext: 'yes', unableToEvacuate: 'yes', powerDisruption: 'unknown', location: { wilaya: 'Blida', commune: 'Fictional demo commune', landmark: 'Fictional meeting point' } });
const state = (): CaseState => ({ rulebook: 'disaster', callersByMode: { disaster: DISASTER_CALLERS, clinic: CLINIC_CALLERS }, responders: MOCK_RESPONDERS });
function store() {
 const data = new Map<string, unknown>();
 const instance = (): DeviceStore => ({ get: async <T,>(key: string) => structuredClone(data.get(key)) as T | undefined,
 put: async (key, value) => { data.set(key, structuredClone(value)); }, remove: async key => { data.delete(key); } });
 return { device: instance(), reopen: instance };
}
const cached = (): OperatorCache => ({ snapshot: cacheSnapshot({ state: state(), revision: 12 }), lastSynchronizedAt: '2026-10-17T20:00:00Z', actions: [] });
const note = (): QueuedAction => ({ mutationId: '22222222-2222-4222-8222-222222222222', revision: 12,
 command: { type: 'note', id: DISASTER_CALLERS[0].id, rulebook: 'disaster', note: 'Met caller at agreed location', eventId: 'offline-note', timestamp: '2026-10-17T20:01:00Z' } });
afterEach(() => vi.unstubAllGlobals());
describe('Task 7 deployment configuration', () => {
 it('both deployments use the existing priority engine with identical scoring for identical facts', () => {
  const a = helpCaller(example(), example().createdOnDeviceAt);
  const b = helpCaller({ ...example(), deploymentId: 'los-angeles', language: 'es', location: {} }, example().createdOnDeviceAt);
  expect(a.rulebook).toBe(b.rulebook); expect(a.scoreBreakdown.map(({points,category}) => ({points,category}))).toEqual(b.scoreBreakdown.map(({points,category}) => ({points,category})));
  expect(a.score).toBe(b.score); expect(a.priority).toBe(b.priority);
  expect(scoreCallerInput(a.engineInput!)).toMatchObject({ priority: a.priority, score: a.score });
 });
 it('both deployments use the same matching engine and weights', () => {
  expect(DEPLOYMENTS.algeria.matching).toBe(DEPLOYMENTS['los-angeles'].matching);
  const c = DISASTER_CALLERS[0]; expect(matchResponders(c, MOCK_RESPONDERS, DEPLOYMENTS.algeria.matching)).toEqual(matchResponders(c, MOCK_RESPONDERS, DEPLOYMENTS['los-angeles'].matching));
 });
 it('changes languages and labels without imposing street addresses', () => {
  expect(DEPLOYMENTS.algeria.languages.map(l => l.label)).toEqual(['Arabic','French','Tamazight']);
  expect(DEPLOYMENTS.algeria.languages.at(-1)?.ready).toBe(true);
  expect(DEPLOYMENTS['los-angeles'].languages.map(l => l.code)).toEqual(['en','es']);
  expect(DEPLOYMENTS.algeria.locationSchema.map(l => l.key)).toEqual(['wilaya','commune','area','landmark','details']);
  expect(DEPLOYMENTS['los-angeles'].locationSchema.map(l => l.key)).toContain('zip');
 });
 it('selecting configuration does not mutate case data or active overrides', () => {
  const original = state(), before = structuredClone(original); deployment('algeria'); deployment('los-angeles'); expect(original).toEqual(before);
 });
 it('rejects unknown or prototype deployment identifiers', () => { expect(() => deployment('toString')).toThrow(); expect(() => deployment('other')).toThrow(); });
 it('does not infer immediate danger or medical facts from narrative words', () => {
  const c = helpCaller({ ...example(), mobilityNeed: 'unknown', crisisContext: 'unknown', need: 'immediate danger oxygen equipment fire trapped' }, example().createdOnDeviceAt);
  expect(c.engineInput?.facilitySignals).toEqual([]); expect(c.hardEscalation).toBe(false);
 });
 it('explicit immediate danger reaches existing hard Priority 0 rule', () => { expect(helpCaller({ ...example(), immediateDanger: 'yes' }, example().createdOnDeviceAt)).toMatchObject({ hardEscalation: true, calculatedPriority: 0 }); });
 it('accepts missing contact, name, and all location fields', () => { expect(validateHelpRequest({ ...example(), name: '', contact: '', location: {} })).toMatchObject({ name: '', contact: '', location: {} }); });
 it('rejects country-code guessing and unsupported languages', () => {
  expect(() => validateHelpRequest({ ...example(), contact: '0555555555' })).toThrow();
  expect(() => validateHelpRequest({ ...example(), language: 'es' })).toThrow();
 });
 it('does not offer real Recovery Chat for help cases without a voice session', () => { expect(recoveryChatAccess(helpCaller(example(), example().createdOnDeviceAt)).code).toBe('no_voice_call'); });
 it('keeps LA responders outside Algeria assignments; configured local responders use the same matcher', () => {
  const c = helpCaller(example(), example().createdOnDeviceAt);
  expect(deploymentResponders(c, MOCK_RESPONDERS)).toEqual([]);
  const local = { ...MOCK_RESPONDERS[0], deploymentId: 'algeria' as const, languages: ['ar' as const] };
  expect(matchResponders(c, deploymentResponders(c, [local])).candidates).toHaveLength(1);
 });
 it('renders offline safety language without claiming contact or guaranteed emergency service', () => {
  const html = renderToStaticMarkup(createElement(HelpForm));
  expect(html).toContain('does not contact emergency services'); expect(html).toContain('A street address or callback number is not required');
  expect(OFFLINE_SAFETY).toContain('saved only on this device'); expect(OFFLINE_SAFETY).toContain('cannot contact responders');
  expect(DEPLOYMENTS.algeria.emergencyGuidance).toContain('may not connect without service');
 });
});
describe('durable caller store-and-forward queue', () => {
 it('persists offline help and restores it when the device store reopens', async () => { const s=store(); await saveHelp(s.device,example()); expect(await pendingHelp(s.reopen())).toEqual([example()]); });
 it('never transmits while offline', async () => { const s=store(),send=vi.fn(); await saveHelp(s.device,example()); expect(await syncHelp(s.device,send,()=>false)).toBe(0); expect(send).not.toHaveBeenCalled(); expect(await pendingHelp(s.device)).toHaveLength(1); });
 it('retains the request until a matching success acknowledgement arrives', async () => {
  const s=store(); await saveHelp(s.device,example()); let release!: (v:{acknowledged:boolean;requestId:string})=>void;
  const running=syncHelp(s.device,()=>new Promise(resolve=>{release=resolve;}),()=>true);
  await vi.waitFor(()=>expect(release).toBeTypeOf('function')); expect(await pendingHelp(s.device)).toHaveLength(1);
  release({acknowledged:true,requestId:example().id}); expect(await running).toBe(1); expect(await pendingHelp(s.device)).toEqual([]);
 });
 it.each([{acknowledged:false,requestId:example().id},{acknowledged:true,requestId:'different'}])('retains requests on invalid acknowledgement %j',async ack=>{const s=store();await saveHelp(s.device,example());await expect(syncHelp(s.device,async()=>ack,()=>true)).rejects.toThrow();expect(await pendingHelp(s.device)).toHaveLength(1);});
 it('retries the same ID after an uncertain network result rather than minting another request', async () => {
  const s=store(),ids:string[]=[];await saveHelp(s.device,example());
  await expect(syncHelp(s.device,async r=>{ids.push(r.id);throw Error('response lost');},()=>true)).rejects.toThrow();
  await syncHelp(s.device,async r=>{ids.push(r.id);return {acknowledged:true,requestId:r.id};},()=>true);
  expect(ids).toEqual([example().id,example().id]);expect(await pendingHelp(s.device)).toHaveLength(0);
 });
 it('stops between items if connection is lost', async () => { const s=store(); await saveHelp(s.device,example());await saveHelp(s.device,{...example(),id:'33333333-3333-4333-8333-333333333333'});let online=true;await syncHelp(s.device,async r=>{online=false;return {acknowledged:true,requestId:r.id};},()=>online);expect(await pendingHelp(s.device)).toHaveLength(1); });
 it('demo network switch controls the same connectivity gate as physical loss',()=>{
  const values=new Map();const target=new EventTarget();vi.stubGlobal('window',target);vi.stubGlobal('localStorage',{getItem:(k:string)=>values.get(k),setItem:(k:string,v:string)=>values.set(k,v)});vi.stubGlobal('navigator',{onLine:true});
  expect(connected()).toBe(true);setDemoOffline(true);expect(connected()).toBe(false);setDemoOffline(false);expect(connected()).toBe(true);vi.stubGlobal('navigator',{onLine:false});setDemoOffline(false);expect(connected()).toBe(false);
 });
});
describe('responder offline queue and conflict safety',()=>{
 let s:ReturnType<typeof store>;
 beforeEach(()=>{s=store();});
 it('caches active cases with priorities, locations and assignments but excludes conversation/history payloads',()=>{const c=cacheSnapshot({state:state(),revision:12});expect(c.state.callersByMode.disaster.length).toBeGreaterThan(0);for(const caller of c.state.callersByMode.disaster){expect(caller.location).toBeTruthy();expect(caller.scoreBreakdown.length).toBeGreaterThan(0);expect(caller.callerMessage).toBe('');expect(caller.activityLog).toEqual([]);expect(caller.questionnaire).toEqual([]);expect(caller.status).not.toBe('resolved');}});
 it('durably queues a safe note and shows its optimistic version after reopen',async()=>{const c=cached();c.actions=[note()];await s.device.put(OPERATOR_KEY,c);const reopened=await s.reopen().get<OperatorCache>(OPERATOR_KEY);expect(reopened?.actions).toHaveLength(1);expect(applyOperationalCommand(reopened!.snapshot.state,note().command,new Date().toISOString()).callersByMode.disaster[0].activityLog.at(-1)?.type).toBe('operator_note');});
 it('does not send queued operator actions while offline',async()=>{await s.device.put(OPERATOR_KEY,{...cached(),actions:[note()]});const send=vi.fn();await syncActions(s.device,send,()=>false);expect(send).not.toHaveBeenCalled();expect((await s.device.get<OperatorCache>(OPERATOR_KEY))?.actions).toHaveLength(1);});
 it('reconnect sends queued command and retains only a minimized acknowledged snapshot',async()=>{await s.device.put(OPERATOR_KEY,{...cached(),actions:[note()]});const send=vi.fn(async a=>({state:applyOperationalCommand(state(),a.command,new Date().toISOString()),revision:13}));const result=await syncActions(s.device,send,()=>true);expect(send).toHaveBeenCalledWith(note());expect(result?.actions).toEqual([]);expect(result?.snapshot.revision).toBe(13);});
 it('keeps the same mutation ID after a lost acknowledgement',async()=>{await s.device.put(OPERATOR_KEY,{...cached(),actions:[note()]});const ids:string[]=[];await expect(syncActions(s.device,async a=>{ids.push(a.mutationId);throw Error('lost');},()=>true)).rejects.toThrow();await syncActions(s.device,async a=>{ids.push(a.mutationId);return {state:state(),revision:13};},()=>true);expect(ids).toEqual([note().mutationId,note().mutationId]);});
 it('does not silently rebase when newer server state conflicts',async()=>{await s.device.put(OPERATOR_KEY,{...cached(),actions:[note()]});await expect(syncActions(s.device,async()=>{throw Object.assign(Error('newer server data'),{status:409});},()=>true)).rejects.toThrow();const c=await s.reopen().get<OperatorCache>(OPERATOR_KEY);expect(c?.conflict).toBe(true);expect(c?.actions[0]).toEqual(note());const send=vi.fn();await syncActions(s.device,send,()=>true);expect(send).not.toHaveBeenCalled();});
 it('blocks stale/invalid commands for review and retains them',async()=>{await s.device.put(OPERATOR_KEY,{...cached(),actions:[note()]});await expect(syncActions(s.device,async()=>{throw Object.assign(Error('stale'),{status:400});},()=>true)).rejects.toThrow();expect((await s.device.get<OperatorCache>(OPERATOR_KEY))?.conflict).toBe(true);});
 it('retains work after authorization loss without retrying with weaker access',async()=>{await s.device.put(OPERATOR_KEY,{...cached(),actions:[note()]});await expect(syncActions(s.device,async()=>{throw Object.assign(Error('unauthorized'),{status:401});},()=>true)).rejects.toThrow();expect((await s.device.get<OperatorCache>(OPERATOR_KEY))?.actions).toHaveLength(1);});
 it('allows notes/outcomes but requires online review for priorities, assignments and responder status',()=>{expect(safeOfflineAction(note().command)).toBe(true);expect(safeOfflineAction({type:'responder_status',responderId:'r1',status:'available'})).toBe(false);expect(safeOfflineAction({type:'patch',rulebook:'disaster',id:'x',patch:{priority:3},logEntry:{id:'p',type:'priority_changed',label:'override',timestamp:''}})).toBe(false);});
});
