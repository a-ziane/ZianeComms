import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { operatorAccess, operatorDenied } from '@/lib/security/operator-access';

const load = vi.hoisted(()=>vi.fn());
vi.mock('@/lib/persistence/admin',()=>({createOperationsClient:()=>({})}));
vi.mock('@/lib/persistence/repository',()=>({operationsRepository:()=>({load}),PersistenceError:class extends Error{}}));
vi.mock('@/utils/supabase/middleware',()=>({createClient:()=>new Response('passthrough')}));
import { GET, POST } from '@/app/api/operations/route';
import { middleware } from '@/middleware';
const password='synthetic-operator-password-123456';
const auth='Basic '+btoa('operator:'+password);
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
describe('Operator protection for real integration data',()=>{
  it('requires the correct shared operator credential and rejects malformed/short configuration',()=>{
    expect(operatorAccess(auth,password)).toBe(true);expect(operatorAccess(null,password)).toBe(false);
    expect(operatorAccess('Basic !!!',password)).toBe(false);expect(operatorAccess(auth,'short')).toBe(false);
    expect(operatorAccess('Basic '+btoa('someone:'+password),password)).toBe(false);
  });
  it('gates live operations in middleware while allowing provider-signed webhook requests through',async()=>{
    vi.stubEnv('RETELL_ENABLED','true');vi.stubEnv('OPERATIONS_PASSWORD',password);
    expect((await middleware(new NextRequest('https://example.test/operator'))).status).toBe(401);
    expect((await middleware(new NextRequest('https://example.test/api/webhooks/retell'))).status).toBe(200);
    const ok=await middleware(new NextRequest('https://example.test/operator',{headers:{authorization:auth}}));expect(await ok.text()).toBe('passthrough');
  });
  it('API GET and POST reject unauthorized access even without middleware',async()=>{
    vi.stubEnv('RETELL_ENABLED','true');vi.stubEnv('OPERATIONS_PASSWORD',password);
    expect((await GET(new NextRequest('https://example.test/api/operations'))).status).toBe(401);
    expect((await POST(new NextRequest('https://example.test/api/operations',{method:'POST'}))).status).toBe(401);
    expect(load).not.toHaveBeenCalled();
  });
  it('fails closed if the password is removed after live ingestion, even when Retell is disabled',async()=>{
    vi.stubEnv('RETELL_ENABLED','false');vi.stubEnv('OPERATIONS_PASSWORD','');
    load.mockResolvedValue({state:{sensitive:'must not leave server'},revision:1,accessRequired:true});
    const r=await GET(new NextRequest('https://example.test/api/operations'));expect(r.status).toBe(503);
    expect(await r.text()).not.toContain('sensitive');expect(operatorDenied().status).toBe(503);
  });
  it('returns saved live data only after correct operator authorization',async()=>{
    vi.stubEnv('RETELL_ENABLED','true');vi.stubEnv('OPERATIONS_PASSWORD',password);
    load.mockResolvedValue({state:{demo:true},revision:1,accessRequired:true});
    const r=await GET(new NextRequest('https://example.test/api/operations',{headers:{authorization:auth}}));
    expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('no-store');
  });
});
