import { messagingConfig } from '@/lib/messaging/config';
import { TwilioMessagingProvider } from '@/lib/messaging/twilio';
import { recoverCall } from '@/lib/messaging/service';
import { createOperationsClient } from '@/lib/persistence/admin';
import { retellConfig } from '@/lib/retell/config';
import { handleRetell } from '@/lib/retell/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return handleRetell(request, { config: retellConfig, client: createOperationsClient, afterIngest: async callId => {
    const config = messagingConfig();
    if (config) await recoverCall(createOperationsClient(),new TwilioMessagingProvider(config),config,callId);
  } });
}
