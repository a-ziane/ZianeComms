import type { RpcClient } from '@/lib/persistence/repository';
import type { MessagingConfig } from './config';
import { TwilioMessagingProvider, validTwilioSignature } from './twilio';
import { receiveMessage } from './service';
const answer = (status: number) => new Response(status===200?'<Response/>':'SMS request unavailable',{
  status,headers:{'Cache-Control':'no-store','Content-Type':status===200?'text/xml':'text/plain'}});
export async function handleTwilio(request: Request, deps: {config:()=>MessagingConfig|null;client:()=>RpcClient}, statusCallback = false) {
  let config;
  try { config=deps.config(); } catch { return answer(503); }
  if (!config) return answer(503);
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/x-www-form-urlencoded') return answer(415);
  let fields: Record<string,string>;
  try {
    if (Number(request.headers.get('content-length')??0)>32768) return answer(413);
    const reader=request.body?.getReader(); if (!reader) return answer(400);
    const chunks:Uint8Array[]=[];let length=0;
    try { while(true) { const r=await reader.read();if(r.done)break;length+=r.value.byteLength;
      if(length>32768){await reader.cancel();return answer(413);}chunks.push(r.value); } } finally {reader.releaseLock();}
    const form=new URLSearchParams(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
    if(new Set(form.keys()).size!==Array.from(form.keys()).length) return answer(400);
    fields=Object.fromEntries(form);
    const url=new URL(request.url);
    const path=statusCallback?'/api/webhooks/twilio/status':'/api/webhooks/twilio/sms';
    if(url.pathname!==path || (!statusCallback && url.search))return answer(400);
    if(!validTwilioSignature(config,request.headers.get('x-twilio-signature'),path+url.search,fields)) return answer(401);
  } catch { return answer(400); }
  try {
    if(statusCallback){
      const recovery=new URL(request.url).searchParams.get('recovery');
      if(fields.AccountSid!==config.accountSid || fields.From!==config.from || !recovery?.startsWith('recovery-') ||
        !/^(SM|MM)[a-f0-9]{32}$/i.test(fields.MessageSid) || !['accepted','queued','sending','sent','delivered','undelivered','failed'].includes(fields.MessageStatus)) return answer(400);
      const result=await deps.client().rpc('zianecomms_sms_status',{p_call_id:recovery.slice(9),p_provider_id:fields.MessageSid,p_status:fields.MessageStatus});
      if(result.error) return answer(503);
    } else {
      let inbound;
      try { inbound = new TwilioMessagingProvider(config).normalizeInboundMessage(fields); }
      catch { return answer(400); }
      await receiveMessage(deps.client(),inbound,config);
    }
    return answer(200);
  } catch { console.error('SMS processing unavailable; provider should retry');return answer(503); }
}
