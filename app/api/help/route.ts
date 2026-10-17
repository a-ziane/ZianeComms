import { NextResponse, type NextRequest } from 'next/server';
import { sameRequestOrigin } from '@/lib/persistence/request-origin';
import { createOperationsClient } from '@/lib/persistence/admin';
import { validateHelpRequest } from '@/lib/help/intake';
import { submitHelp } from '@/lib/help/service';
import { PersistenceError } from '@/lib/persistence/repository';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
// Public write-only, bounded intake. No case lookup, operator commands, or private data returned here.
export async function POST(request: NextRequest) {
  if (!sameRequestOrigin(request.headers.get('origin'), request.headers.get('host'))) return NextResponse.json({ error: 'Cross-origin request rejected.' }, { status: 403, headers });
  if (Number(request.headers.get('content-length') ?? 0) > 16000) return NextResponse.json({ error: 'Request too large.' }, { status: 413, headers });
  let input;
  try { const raw = await request.text(); if (raw.length > 16000) throw Error(); input = validateHelpRequest(JSON.parse(raw)); }
  catch { return NextResponse.json({ error: 'Check the form fields. Optional phone numbers need an international + country code.' }, { status: 400, headers }); }
  try { return NextResponse.json(await submitHelp(createOperationsClient(), input, process.env.CONTACT_ENCRYPTION_KEY), { headers }); }
  catch (error) {
    // Never log caller text, contact, ciphertext, or database/provider errors.
    return NextResponse.json({ error: 'Request not confirmed. Your saved request remains on this device; retry after checking the connection.' }, { status: error instanceof PersistenceError && error.conflict ? 409 : 503, headers });
  }
}
