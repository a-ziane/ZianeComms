import { createHash } from 'node:crypto';
import { redactPhones } from '@/lib/retell/contact';
export const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const id=(v:unknown):string=>{if(typeof v!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(v))throw Error('Invalid chat reference');return v;};
export interface ChatMessage {id:string;direction:'inbound'|'outbound';body:string;timestamp:string}
export interface ChatIntake {chatId:string;agentId:string;caseId:string;callId:string;event:string;status:string;messages:ChatMessage[];fields:Record<string,unknown>;summary:string;timestamp:string}
export function normalizeChat(chat:unknown,event:string):ChatIntake {
 if(!record(chat)||!record(chat.metadata)||!['ongoing','ended','error'].includes(String(chat.chat_status)))throw Error('Invalid chat');
 const chatId=id(chat.chat_id),agentId=id(chat.agent_id),caseId=id(chat.metadata.case_id),callId=id(chat.metadata.original_call_id);
 const messages:ChatMessage[]=[];
 if(chat.message_with_tool_calls!==undefined&&!Array.isArray(chat.message_with_tool_calls))throw Error('Invalid chat messages');
 const raw=Array.isArray(chat.message_with_tool_calls)?chat.message_with_tool_calls:[];
 if(raw.length>500)throw Error('Chat too large');
 for(const m of raw){
  if(!record(m)||!['agent','user'].includes(String(m.role)))continue;
  if(typeof m.content!=='string'||m.content.length>10000)throw Error('Invalid chat text');
  const timestamp=typeof m.created_timestamp==='number'&&Number.isSafeInteger(m.created_timestamp)&&m.created_timestamp>0&&m.created_timestamp<8640000000000000
   ?new Date(m.created_timestamp).toISOString():new Date().toISOString();
  if(messages.some(previous=>previous.id===m.message_id))throw Error('Duplicate chat message');
  messages.push({id:id(m.message_id),direction:m.role==='user'?'inbound':'outbound',body:redactPhones(m.content),timestamp});
 }
 const analysis=record(chat.chat_analysis)?chat.chat_analysis:{};
 const fields=event==='chat_analyzed'&&record(analysis.custom_analysis_data)?analysis.custom_analysis_data:{};
 if(event==='chat_analyzed'&&!record(analysis.custom_analysis_data))throw Error('Chat analysis missing');
 const summary=event==='chat_analyzed'&&typeof analysis.chat_summary==='string'?redactPhones(analysis.chat_summary.slice(0,4000)):'';
 const timestamp=typeof chat.end_timestamp==='number'&&chat.end_timestamp>0&&chat.end_timestamp<8640000000000000?new Date(chat.end_timestamp).toISOString():new Date().toISOString();
 const eventKey=event==='sync'?'sync:'+createHash('sha256').update(JSON.stringify([chat.chat_status,messages.map(m=>[m.id,m.body])])).digest('hex'):event;
 return {chatId,agentId,caseId,callId,event:eventKey,status:String(chat.chat_status),messages,fields,summary,timestamp};
}
