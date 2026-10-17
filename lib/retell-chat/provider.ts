import 'server-only';
import Retell from 'retell-sdk';
import type { InboundMessage, MessagingProvider, OutboundMessage } from '@/lib/messaging/provider';
import type { ChatConfig } from './config';
import {redactPhones} from '@/lib/retell/contact';
export function chatClient(config:ChatConfig) { return new Retell({apiKey:config.apiKey,maxRetries:0,timeout:8000}); }
export class RetellChatProvider implements MessagingProvider {
  readonly name='retell-chat';
  readonly transport='retell_chat' as const;
  readonly rulebooks=['disaster'] as const;
  constructor(private config:ChatConfig,private client=chatClient(config)){}
  async sendMessage(message:OutboundMessage){
    const context=message.context;
    if(!context)throw Error('Recovery context required');
    const vars={...this.config.dynamicVariables,case_id:context.caseId,original_call_id:context.originalCallId,
      caller_name:context.callerName,preferred_language:context.language,previous_reason_for_contact:context.reason,
      previous_requested_service:context.requestedService,previous_location:context.location,
      opt_out_text:'You can end this demo chat at any time.',recovery_message:message.body};
    const chat=await this.client.chat.create({agent_id:this.config.agentId,agent_version:'latest_published',
      metadata:{case_id:context.caseId,original_call_id:context.originalCallId,transport:'hackathon_carrier_simulated'},retell_llm_dynamic_variables:vars});
    if(chat.agent_id!==this.config.agentId || !chat.chat_id)throw Error('Unexpected recovery session');
    return {id:chat.chat_id,status:chat.chat_status};
  }
  normalizeInboundMessage(fields:Record<string,string>):InboundMessage {
    for(const key of ['case_id','chat_id','message_id'])if(!/^[A-Za-z0-9_-]{1,200}$/.test(fields[key]??''))throw Error('Invalid chat text reference');
    if(typeof fields.content!=='string'||fields.content.length>10000)throw Error('Invalid chat text');
    // Logical sender/session addresses, deliberately not telephone numbers.
    return {provider:this.name,id:`${fields.chat_id}:${fields.message_id}`,from:fields.case_id,to:fields.chat_id,body:redactPhones(fields.content)};
  }
}
