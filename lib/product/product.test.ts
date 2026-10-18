import {describe,it,expect,vi} from 'vitest';
import {LINES,lineKnowledge,lineQuestions,lineRulebook} from '@/config/product/lines';
import {scoreCallerInput} from '@/lib/engine';
import {addScenario,approveAssignment,initialWorkspace,lineCases,productMatching,recoverCase,receiveOffline,offlineScenario} from './workspace';
import {demoLocation,mapPosition,requestLocation,sharedLocation} from './geography';

describe('Command + civilian product story',()=>{
 it('keeps five explicit line presets on the shared generic engine',()=>{
  for(const line of Object.keys(LINES) as (keyof typeof LINES)[]){
   const rule=lineRulebook(line);expect(['disaster','clinic']).toContain(rule.id);
   const input={rulebook:rule.id,needCategory:'other' as const,needDescription:'demo',waitMinutes:0,attempts:1,language:'English',locationZone:'unknown' as const,locationDetail:'Unknown',agentOutcome:'unknown' as const,callerMessage:'',facilitySignals:[]};
   expect(scoreCallerInput(input,rule).priority).toBe(3);
  }
 });
 it('loads every scenario through real scoring and preserves custom organization configuration',()=>{
  let w=initialWorkspace();for(const line of ['911','311','211','defense','custom'] as const)w=addScenario(w,line,'2026-10-18T03:10:00Z');
  for(const line of ['911','311','211','defense','custom'] as const){const c=lineCases(w,line)[0];expect(c.scoreBreakdown.length).toBeGreaterThan(0);expect(scoreCallerInput(c.engineInput!,lineRulebook(line)).priority).toBe(c.calculatedPriority);}
  expect(lineCases(w,'custom')[0].rulebook).toBe('clinic');
 });
 it('uses shared responder data and the existing matcher/assignment approval',()=>{
  const w=addScenario(initialWorkspace(),'211','2026-10-18T03:10:00Z'),c=lineCases(w,'211')[0],match=productMatching(w,c);expect(match.recommendedResponderId).toBeTruthy();
  const next=approveAssignment(w,c.id,match.recommendedResponderId!,'2026-10-18T03:11:00Z');expect(lineCases(next,'211')[0].assignedResponderId).toBe(match.recommendedResponderId);
  expect(next.cases.responders!.find(r=>r.id===match.recommendedResponderId)!.activeCallers).toBeGreaterThan(0);
 });
 it('recovery escalates the same case with explicit facts and real safety rules',()=>{
  const w=addScenario(initialWorkspace(),'211','2026-10-18T03:10:00Z'),before=lineCases(w,'211')[0],next=recoverCase(w,before.id,'2026-10-18T03:12:00Z'),after=lineCases(next,'211')[0];
  expect(before.calculatedPriority).not.toBe(0);expect(after.calculatedPriority).toBe(0);expect(after.hardEscalation).toBe(true);expect(after.activityLog.at(-1)?.type).toBe('priority_recalculated');
 });
 it('requires an explicit geolocation call and never invents coordinate precision',async()=>{
  expect(mapPosition(demoLocation('central'))).toBeTruthy();expect(demoLocation('central').kind).toBe('area');expect(mapPosition(demoLocation('central','algeria'))).toBeNull();
  expect(sharedLocation({coords:{latitude:34,longitude:-118,accuracy:120}}).accuracy).toBe(120);
  const getCurrentPosition=vi.fn((ok:(p:any)=>void)=>ok({coords:{latitude:34,longitude:-118,accuracy:75}}));expect(getCurrentPosition).not.toHaveBeenCalled();
  await requestLocation({getCurrentPosition} as Pick<Geolocation,'getCurrentPosition'>);expect(getCurrentPosition).toHaveBeenCalledOnce();
 });
 it('keeps defense support free of offensive and targeting actions',()=>{
  const text=JSON.stringify({line:LINES.defense,knowledge:lineKnowledge('defense'),questions:lineQuestions('defense'),rule:lineRulebook('defense')}).toLowerCase();
  for(const phrase of ['target selection','strike recommendation','weapon targeting','lethal-force recommendation'])expect(text).not.toContain(phrase);
  expect(text).toContain('personnel');expect(text).toContain('communications');
 });
 it('synchronizes the Algeria demonstration once through the existing normalized intake',()=>{
  const request=offlineScenario('2026-10-18T03:00:00Z','b6e4f04e-0c43-46f9-b553-a8ca6b415dfc'),once=receiveOffline(initialWorkspace(),request,'2026-10-18T03:01:00Z'),twice=receiveOffline(once,request,'2026-10-18T03:02:00Z');
  expect(twice.synchronizedIds).toEqual([request.id]);expect(lineCases(twice,'211').filter(c=>c.id===`help-${request.id}`)).toHaveLength(1);
 });
});
