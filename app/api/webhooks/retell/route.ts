import { createOperationsClient } from '@/lib/persistence/admin';
import { retellConfig } from '@/lib/retell/config';
import { handleRetell } from '@/lib/retell/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return handleRetell(request, { config: retellConfig, client: createOperationsClient });
}
