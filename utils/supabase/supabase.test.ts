import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type CookieMethodsServer } from '@supabase/ssr';
import { NextRequest } from 'next/server';
import { createClient as refreshSession } from './middleware';
import { createClient as serverClient } from './server';
import { createClient as browserClient } from './client';

const mocks = vi.hoisted(() => ({ server: vi.fn(), browser: vi.fn(), claims: vi.fn() }));
vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.server, createBrowserClient: mocks.browser }));

let cookieAdapter: CookieMethodsServer;
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'test-publishable-key');
  mocks.claims.mockReset().mockResolvedValue({ data: null, error: null });
  mocks.server.mockReset().mockImplementation((_url, _key, options) => {
    cookieAdapter = options.cookies;
    return { auth: { getClaims: mocks.claims } };
  });
  mocks.browser.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe('Supabase SSR session integration', () => {
  it('runs the auth verification/refresh step and passes anonymous requests through without redirecting', async () => {
    const response = await refreshSession(new NextRequest('https://app.example/'));
    expect(mocks.claims).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('forwards refreshed cookies to the request and browser with options and cache protection', async () => {
    const request = new NextRequest('https://app.example/', { headers: { cookie: 'session=old' } });
    mocks.claims.mockImplementation(async () => {
      expect(cookieAdapter.getAll!()).toEqual([{ name: 'session', value: 'old' }]);
      await cookieAdapter.setAll!([{ name: 'session', value: 'refreshed', options: { path: '/', httpOnly: true, secure: true, sameSite: 'lax' } }],
        { 'Cache-Control': 'private, no-store', Expires: '0', Pragma: 'no-cache' });
      return { data: null, error: null };
    });
    const response = await refreshSession(request);
    expect(request.cookies.get('session')?.value).toBe('refreshed');
    expect(response.headers.get('x-middleware-request-cookie')).toContain('session=refreshed');
    expect(response.cookies.get('session')).toMatchObject({ value: 'refreshed', path: '/', httpOnly: true, secure: true, sameSite: 'lax' });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('expires')).toBe('0');
    expect(response.headers.get('pragma')).toBe('no-cache');
  });

  it('preserves earlier cookies and cache headers if the client writes cookies more than once', async () => {
    mocks.claims.mockImplementation(async () => {
      await cookieAdapter.setAll!([{ name: 'first', value: 'one', options: { path: '/' } }], { 'Cache-Control': 'private, no-store' });
      await cookieAdapter.setAll!([{ name: 'second', value: 'two', options: { path: '/' } }], {});
      return { data: null, error: null };
    });
    const response = await refreshSession(new NextRequest('https://app.example/'));
    expect(response.cookies.get('first')?.value).toBe('one');
    expect(response.cookies.get('second')?.value).toBe('two');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('server helper reads and writes the supplied cookie store', () => {
    const store = { getAll: vi.fn().mockReturnValue([{ name: 'session', value: 'existing' }]), set: vi.fn() };
    serverClient(store as unknown as Parameters<typeof serverClient>[0]);
    expect(cookieAdapter.getAll!()).toEqual([{ name: 'session', value: 'existing' }]);
    cookieAdapter.setAll!([{ name: 'session', value: 'new', options: { path: '/' } }], {});
    expect(store.set).toHaveBeenCalledWith('session', 'new', { path: '/' });
  });

  it('server helper tolerates read-only Server Component cookies', () => {
    const store = { getAll: vi.fn().mockReturnValue([]), set: vi.fn(() => { throw new Error('Read-only cookies'); }) };
    serverClient(store as unknown as Parameters<typeof serverClient>[0]);
    expect(() => cookieAdapter.setAll!([{ name: 'session', value: 'new', options: {} }], {})).not.toThrow();
  });

  it('browser helper uses the configured public URL and publishable key', () => {
    browserClient();
    expect(mocks.browser).toHaveBeenCalledWith('https://test.supabase.co', 'test-publishable-key');
  });
});
