import { createOperationsClient } from '@/lib/persistence/admin';
import { messagingConfig } from '@/lib/messaging/config';
import { handleTwilio } from '@/lib/messaging/handler';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return handleTwilio(request,{config:messagingConfig,client:createOperationsClient});
}
