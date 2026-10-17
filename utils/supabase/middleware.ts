import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

export const createClient = async (request: NextRequest) => {
  let supabaseResponse = NextResponse.next({ request });
  const refreshHeaders = new Headers();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, cacheHeaders) {
          // Forward refreshed cookies to Server Components and the browser.
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          const previousCookies = supabaseResponse.cookies.getAll();
          supabaseResponse = NextResponse.next({ request });
          previousCookies.forEach(cookie => supabaseResponse.cookies.set(cookie));
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
          Object.entries(cacheHeaders).forEach(([name, value]) => refreshHeaders.set(name, value));
          refreshHeaders.forEach((value, name) => supabaseResponse.headers.set(name, value));
        },
      },
    },
  );

  // Creating a client alone does not refresh or validate a session.
  await supabase.auth.getClaims();

  return supabaseResponse;
};
