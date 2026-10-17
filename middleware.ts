import { type NextRequest } from 'next/server';
import { operatorAccess, operatorDenied, operatorGateRequired } from '@/lib/security/operator-access';
import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/middleware';

export async function middleware(request: NextRequest) {
  // Public write-only caller intake and non-sensitive offline shells do not use operator authentication.
  if (['/help', '/api/help', '/offline', '/offline-sw.js'].includes(request.nextUrl.pathname)) return NextResponse.next();
  // Retell authenticates with its provider signature, independently of the operator gate.
  if (['/api/webhooks/retell', '/api/webhooks/retell-chat', '/api/webhooks/twilio/sms', '/api/webhooks/twilio/status'].includes(request.nextUrl.pathname)) return NextResponse.next();
  if (operatorGateRequired() && !operatorAccess(request.headers.get('authorization'))) return operatorDenied();
  return createClient(request);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
