import {createOperationsClient} from '@/lib/persistence/admin';
import {chatConfig} from '@/lib/retell-chat/config';
import {handleChatWebhook} from '@/lib/retell-chat/handler';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request){return handleChatWebhook(request,{config:chatConfig,client:createOperationsClient});}
