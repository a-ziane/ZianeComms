import { NextResponse, type NextRequest } from 'next/server';
import { createOperationsClient } from '@/lib/persistence/admin';
import { operationsRepository, PersistenceError } from '@/lib/persistence/repository';
import { applyOperationalCommand } from '@/lib/persistence/commands';
import { operatorAccess, operatorDenied, operatorGateRequired } from '@/lib/security/operator-access';
import { sameRequestOrigin } from '@/lib/persistence/request-origin';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
const repository = () => operationsRepository(createOperationsClient());
const failure = (error: unknown) => {
  // Do not return raw database errors, URLs or credentials to browser clients.
  console.error('Operations persistence failed', error instanceof Error ? error.name : 'unknown');
  const conflict = error instanceof PersistenceError && error.conflict;
  return NextResponse.json({ error: conflict ? 'Another operator changed the data. Reload and review your action before retrying.' :
    'Database unavailable or not configured. Your action was not confirmed. Check the server key, migrations and demo seed, then retry.' }, { status: conflict ? 409 : 503, headers });
};
export async function GET(request: NextRequest) {
  if (operatorGateRequired() && !operatorAccess(request.headers.get('authorization'))) return operatorDenied();
  try {
    const current = await repository().load();
    // The database latch prevents accidentally reopening real data if deployment env flags are removed.
    if (current.accessRequired && !operatorAccess(request.headers.get('authorization'))) return operatorDenied();
    return NextResponse.json(current, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  if (operatorGateRequired() && !operatorAccess(request.headers.get('authorization'))) return operatorDenied();
  // Public synthetic-demo API only. Reject cross-origin browser writes; never expose a generic service-role proxy.
  const origin = request.headers.get('origin');
  if (!sameRequestOrigin(origin, request.headers.get('host'))) return NextResponse.json({ error: 'Cross-origin operation rejected' }, { status: 403, headers });
  if (Number(request.headers.get('content-length') ?? 0) > 1000000) return NextResponse.json({ error: 'Operation too large' }, { status: 413, headers });
  let input: { command: unknown; revision: number; mutationId: string };
  try {
    const body = await request.text();
    if (body.length > 1000000) throw new Error('Operation too large');
    input = JSON.parse(body);
    if (!Number.isSafeInteger(input.revision) || input.revision < 0 || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(input.mutationId)) throw new Error('Invalid revision/mutation');
  } catch { return NextResponse.json({ error: 'Invalid operation' }, { status: 400, headers }); }
  try {
    const repo = repository();
    const current = await repo.load();
    if (current.accessRequired && !operatorAccess(request.headers.get('authorization'))) return operatorDenied();
    if (await repo.wasApplied(input.mutationId)) return NextResponse.json(current, { headers });
    // SQL performs the authoritative revision check and idempotency check in the save transaction.
    let next;
    try { next = applyOperationalCommand(current.state, input.command, new Date().toISOString()); }
    catch { return NextResponse.json({ error: 'This action is invalid or stale. Reload the case and review it before retrying.' }, { status: 400, headers }); }
    return NextResponse.json(await repo.save(next, input.revision, input.mutationId), { headers });
  } catch (error) { return failure(error); }
}
