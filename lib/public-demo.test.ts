import {describe,it,expect,vi,afterEach} from 'vitest';
import {amaniDemoCaller,publicDemoState,publicDemoOrganizations,PUBLIC_CASE_KEY,PUBLIC_ORG_KEY,PUBLIC_SELECTION_KEY,ZIANE_ORG} from '@/data/public-demo';
import {scoreCallerInput} from '@/lib/engine';
import {recoveryChatAccess} from '@/lib/cases/recovery';
import {applyOperationalCommand} from '@/lib/persistence/commands';
import {activationIssues,validateConfig} from '@/lib/organization/model';
import {NextRequest} from 'next/server';
vi.mock('@/utils/supabase/middleware',()=>({createClient:()=>new Response('private')}));
import {middleware} from '@/middleware';
afterEach(()=>vi.unstubAllEnvs());
describe('Public fictional demonstration workspace',()=>{
 it('opens without operator credentials while private routes remain protected',async()=>{
  vi.stubEnv('RETELL_ENABLED','true');vi.stubEnv('OPERATIONS_PASSWORD','synthetic-test-password-123456789');
  for(const path of ['/','/onboarding','/offline'])expect((await middleware(new NextRequest(`https://demo.test${path}`))).status).toBe(200);
  for(const path of ['/operator','/operator/onboarding','/api/operations','/api/organization','/recovery-chat/private-case'])expect((await middleware(new NextRequest(`https://demo.test${path}`))).status).toBe(401);
 });
 it('uses distinct device keys so anonymous visitors never load an operator cache or organization draft',()=>{
  for(const key of [PUBLIC_CASE_KEY,PUBLIC_ORG_KEY,PUBLIC_SELECTION_KEY]){expect(key).toMatch(/^public-demo-/);expect(key).not.toBe('operator-cache');expect(key).not.toBe('ziane-selected-organization');}
 });
 it('supplies a complete explicitly fictional Amani toothache case to Ziane Org using the unchanged Clinic engine',()=>{
  const c=amaniDemoCaller(),score=scoreCallerInput(c.engineInput!);
  expect(c.name).toBe('Amani');expect(c.organizationId).toBe(ZIANE_ORG);expect(c.provenance).toBe('seed_demo');expect(c.phone).toBe('(***) ***-0100');
  expect(c.needSummary).toContain('Toothache');expect(c.questionnaire.length).toBeGreaterThan(3);expect(c.callerMessage).toContain('FICTIONAL DEMO');
  expect(c.calculatedPriority).toBe(score.priority);expect(c.score).toBe(score.score);expect(c.scoreBreakdown).toEqual(score.breakdown);expect(c.manualPriority).toBe(false);expect(c.status).toBe('awaiting_callback');
  expect(recoveryChatAccess(c).canOpen).toBe(false);
 });
 it('keeps demo organizations valid and approved independently from live configuration',()=>{
  const r=publicDemoOrganizations()[0];expect(r.active!.configuration.name).toBe('Ziane Org');expect(activationIssues(r.draft)).toEqual([]);expect(()=>validateConfig(r.draft,r.id)).not.toThrow();
  expect(r.draft.knowledge.every(k=>k.content.includes('FICTIONAL'))).toBe(true);
 });
 it('supports normal deterministic case actions without changing another mode or the fixture baseline',()=>{
  const original=publicDemoState();const c=amaniDemoCaller();
  const next=applyOperationalCommand(original,{type:'note',rulebook:'clinic',id:c.id,note:'Demo follow-up review',eventId:'demo-note',timestamp:'2026-10-17T21:00:00Z'},'2026-10-17T21:00:00Z');
  expect(next.callersByMode.clinic.find(x=>x.id===c.id)!.activityLog.at(-1)!.detail).toContain('Demo follow-up review');expect(next.callersByMode.disaster).toEqual(original.callersByMode.disaster);expect(amaniDemoCaller().activityLog).toHaveLength(2);
 });
});
