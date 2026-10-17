import Retell from 'retell-sdk';
import type {RpcClient} from '@/lib/persistence/repository';
import type {ChatConfig} from './config';
import {normalizeChat,record} from './normalize';
import {ingestChat} from './ingest';
const answer=(status:number,data:Record<string,unknown>)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function handleChatWebhook(request:Request,deps:{config:()=>ChatConfig|null;client:()=>RpcClient}){
 let config;try{config=deps.config();}catch{return answer(503,{error:'Recovery Chat is not configured'});}
 if(!config)return answer(503,{error:'Recovery Chat is disabled'});
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return answer(415,{error:'JSON required'});
 let raw:string;
 try{
  const reader=request.body?.getReader();if(!reader)return answer(400,{error:'Empty body'});
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>2*1024*1024){await reader.cancel();return answer(413,{error:'Body too large'});}chunks.push(r.value);}}finally{reader.releaseLock();}
  raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
 }catch{return answer(400,{error:'Invalid body'});}
 const signature=request.headers.get('x-retell-signature');
 try{if(!signature||!await Retell.verify(raw,config.apiKey,signature))return answer(401,{error:'Invalid signature'});}catch{return answer(401,{error:'Invalid signature'});}
 let intake;
 try{
  const payload:unknown=JSON.parse(raw);
  if(!record(payload)||!record(payload.chat))return answer(400,{error:'Invalid chat envelope'});
  if(payload.chat.agent_id!==config.agentId)return answer(403,{error:'Chat agent is not configured'});
  if(!['chat_ended','chat_analyzed'].includes(String(payload.event)))return answer(200,{received:true,ignored:true});
  intake=normalizeChat(payload.chat,String(payload.event));
 }catch{return answer(400,{error:'Invalid chat payload or case metadata'});}
 try{return answer(200,{received:true,...await ingestChat(deps.client(),intake) as object});}
 catch{return answer(503,{error:'Recovery session unavailable; verify case/session binding or retry delivery'});}
}
