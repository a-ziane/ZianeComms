-- Task 6.1: extend existing recovery claims for a phone-less Retell Chat transport.
begin;
alter table zianecomms_private.sms_recovery add column before_calculated_priority integer check(before_calculated_priority between 0 and 3);
create table zianecomms_private.recovery_chat_events (
 chat_id text not null, event_key text not null, case_id text not null references public.cases(id),
 state text not null default 'complete', created_at timestamptz not null default now(), primary key(chat_id,event_key)
);
create index recovery_chat_events_case on zianecomms_private.recovery_chat_events(case_id);
alter table zianecomms_private.recovery_chat_events enable row level security;
revoke all on zianecomms_private.recovery_chat_events from public,anon,authenticated;
grant select,insert,update on zianecomms_private.recovery_chat_events to service_role;
create or replace function public.zianecomms_sms_claim(p_call_id text,p_provider text,p_body text) returns boolean
language plpgsql security invoker set search_path=public,pg_temp as $$
declare cid text; identity text; d jsonb;
begin
 perform 1 from public.facilities where id='zianecomms-demo' for update;
 select c.id,c.data,cc.phone_identity into cid,d,identity from zianecomms_private.retell_calls r
 join public.cases c on c.id=r.case_id join zianecomms_private.case_contacts cc on cc.case_id=c.id
 where r.call_id=p_call_id and r.facility_id='zianecomms-demo' and (cc.contact_kind='phone' or p_provider='retell-chat');
 if p_provider='retell-chat' and cid is not null then identity:='case:'||cid; end if;
 if cid is null or identity is null or d->>'status' in ('resolved','referred','duplicate','unable_to_reach')
   or d->'retell'->>'callId' is distinct from p_call_id or d->'retell'->>'disconnectionReason'='user_requested_dnc'
   or exists(select 1 from zianecomms_private.sms_opt_out where phone_identity=identity) then return false; end if;
 if not coalesce((coalesce((d->'retell'->'outcomes'->>'unresolvedNeed')::boolean,false) or
   coalesce((d->'retell'->'outcomes'->>'humanRequested')::boolean,false) or
   (d->'retell'->>'disconnectionReason'='user_hangup' and d->'retell'->>'callSuccessful'='false')),false) then return false; end if;
 if d->'retell'->'outcomes'->>'automationResolvedRequest'='true' and
   not coalesce((d->'retell'->'outcomes'->>'humanRequested')::boolean,false) and
   not coalesce((d->'retell'->'outcomes'->>'unresolvedNeed')::boolean,false) then return false; end if;
 insert into zianecomms_private.sms_recovery(call_id,case_id,provider,phone_identity,body,before_calculated_priority) values(p_call_id,cid,p_provider,identity,p_body,(d->>'calculatedPriority')::integer) on conflict do nothing;
 if not found then return false; end if;
 insert into public.messages(case_id,id,facility_id,direction,channel,body,occurred_at,status,provider,call_id)
 values(cid,'recovery-'||p_call_id,'zianecomms-demo','outbound',case when p_provider='retell-chat' then 'retell_chat' else 'sms' end,p_body,now(),'sending',p_provider,p_call_id);
 return true;
end $$;
create or replace function public.zianecomms_sms_commit(p_expected_revision bigint,p_mutation_id uuid,p_payload jsonb,p_message jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare cid text:=p_message->>'case_id'; mid text:=p_message->>'id'; inbound boolean:=p_message->>'direction'='inbound';
 d jsonb; e jsonb; rev bigint; correlated jsonb; identity text; r zianecomms_private.sms_recovery%rowtype;
begin
 perform 1 from public.facilities where id='zianecomms-demo' for update;
 if inbound then
   if exists(select 1 from zianecomms_private.sms_receipts where provider=p_message->>'provider' and provider_message_id=p_message->>'provider_id') then return jsonb_build_object('duplicate',true); end if;
   correlated:=public.zianecomms_sms_correlate(p_message->>'provider',p_message->>'provider_id',p_message->>'identity');
   -- Recheck correlation while holding the same lock used by closure and all operator saves.
   if correlated->>'case_id' is distinct from cid then raise exception 'Correlation changed' using errcode='40001'; end if;
 else
   select * into r from zianecomms_private.sms_recovery where call_id=p_message->>'call_id';
   if not found or r.case_id is distinct from cid or r.provider is distinct from p_message->>'provider' then raise exception 'Missing delivery claim'; end if;
   if exists(select 1 from public.activity_events where case_id=cid and id=mid) then return jsonb_build_object('duplicate',true); end if;
 end if;
 if cid is not null then
   rev:=public.zianecomms_save_demo(p_expected_revision,p_mutation_id,p_payload);
   select data into d from public.cases where id=cid;
   if not found then raise exception 'Missing case'; end if;
   -- save_demo's legacy SMS projection is replaced by the actual provider message below.
   insert into public.messages(case_id,id,facility_id,direction,channel,body,occurred_at,status,provider,provider_message_id,call_id,data)
   values(cid,mid,'zianecomms-demo',p_message->>'direction',case when p_message->>'provider'='retell-chat' then 'retell_chat' else 'sms' end,p_message->>'body',(p_message->>'timestamp')::timestamptz,
     p_message->>'status',p_message->>'provider',p_message->>'provider_id',p_message->>'call_id',jsonb_build_object('provider',p_message->>'provider'))
   on conflict(case_id,id) do update set channel=excluded.channel,direction=excluded.direction,body=excluded.body,status=case when messages.status in ('sent','delivered','undelivered','failed') then messages.status else excluded.status end,
     provider=excluded.provider,provider_message_id=excluded.provider_message_id,call_id=excluded.call_id;
   if inbound then
     for e in select value from jsonb_array_elements(d->'activityLog') where value->>'id'='sms-priority-'||(p_message->>'provider_id') loop
       insert into public.priority_events(case_id,id,facility_id,occurred_at,data) values(cid,e->>'id','zianecomms-demo',(e->>'timestamp')::timestamptz,
       jsonb_build_object('event',e,'snapshot',d-'activityLog')) on conflict do nothing;
     end loop;
   end if;
 end if;
 if inbound then
   insert into zianecomms_private.sms_receipts(provider,provider_message_id,case_id,phone_identity,encrypted_body,review_required,reason)
   values(p_message->>'provider',p_message->>'provider_id',cid,p_message->>'identity',p_message->>'encrypted',true,
     case when cid is null then 'Unmatched, closed or ambiguous recovery; operator review required' else 'SMS content requires operator review' end);
   if (p_message->>'stop')::boolean then insert into zianecomms_private.sms_opt_out(phone_identity) values(p_message->>'identity') on conflict do nothing; end if;
 else
   update zianecomms_private.sms_recovery set state='accepted',provider_message_id=p_message->>'provider_id' where call_id=p_message->>'call_id';
 end if;
 return jsonb_build_object('duplicate',false,'matched',cid is not null);
end $$;

create function public.zianecomms_chat_context(p_case_id text) returns jsonb language sql security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('case_id',r.case_id,'call_id',r.call_id,'chat_id',r.provider_message_id,'opening',r.body,
 'state',r.state,'before_priority',r.before_calculated_priority,
 'analyzed',exists(select 1 from zianecomms_private.recovery_chat_events e where e.chat_id=r.provider_message_id and e.event_key='chat_analyzed'))
 from zianecomms_private.sms_recovery r where r.case_id=p_case_id and r.provider='retell-chat' order by r.created_at desc limit 1;
$$;
create function public.zianecomms_chat_binding(p_chat_id text) returns jsonb language sql security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('case_id',case_id,'call_id',call_id) from zianecomms_private.sms_recovery
 where provider='retell-chat' and provider_message_id=p_chat_id;
$$;
create function public.zianecomms_chat_turn_claim(p_case_id text,p_chat_id text,p_request_id uuid) returns boolean
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 perform 1 from public.facilities where id='zianecomms-demo' for update;
 if not exists(select 1 from zianecomms_private.sms_recovery r join public.cases c on c.id=r.case_id
 where r.case_id=p_case_id and r.provider_message_id=p_chat_id and r.provider='retell-chat'
 and c.status not in ('resolved','referred','duplicate','unable_to_reach')) then return false; end if;
 -- One in-flight turn per session. A lost response requires reconciliation, never automatic resend.
 if exists(select 1 from zianecomms_private.recovery_chat_events where chat_id=p_chat_id and state='sending') then return false; end if;
 insert into zianecomms_private.recovery_chat_events(chat_id,event_key,case_id,state) values(p_chat_id,'turn:'||p_request_id,p_case_id,'sending') on conflict do nothing;
 return found;
end $$;
create function public.zianecomms_chat_turn_state(p_chat_id text,p_request_id uuid) returns text
language sql security invoker set search_path=public,pg_temp as $$
 select state from zianecomms_private.recovery_chat_events where chat_id=p_chat_id and event_key='turn:'||p_request_id;
$$;
create function public.zianecomms_chat_turn_finish(p_chat_id text,p_request_id uuid) returns void
language sql security invoker set search_path=public,pg_temp as $$
 update zianecomms_private.recovery_chat_events set state='complete' where chat_id=p_chat_id and event_key='turn:'||p_request_id;
$$;
create function public.zianecomms_chat_commit(p_expected_revision bigint,p_mutation_id uuid,p_payload jsonb,p_chat jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare cid text:=p_chat->>'case_id'; chatid text:=p_chat->>'chat_id'; ev text:=p_chat->>'event'; m jsonb; e jsonb; d jsonb;
begin
 perform 1 from public.facilities where id='zianecomms-demo' for update;
 -- Metadata alone cannot authorize a session: require the exact durable provider/case/original-call binding.
 if not exists(select 1 from zianecomms_private.sms_recovery where case_id=cid and call_id=p_chat->>'call_id'
 and provider='retell-chat' and provider_message_id=chatid) then raise exception 'Unknown recovery session'; end if;
 if exists(select 1 from zianecomms_private.recovery_chat_events where chat_id=chatid and event_key=ev) then return jsonb_build_object('duplicate',true); end if;
 perform public.zianecomms_save_demo(p_expected_revision,p_mutation_id,p_payload);
 select data into d from public.cases where id=cid;
 for m in select value from jsonb_array_elements(p_chat->'messages') loop
  insert into public.messages(case_id,id,facility_id,direction,channel,body,occurred_at,status,provider,provider_message_id,call_id)
  values(cid,'retell-chat-'||(m->>'id'),'zianecomms-demo',m->>'direction','retell_chat',m->>'body',(m->>'timestamp')::timestamptz,
   'recorded','retell-chat',chatid||':'||(m->>'id'),p_chat->>'call_id') on conflict do nothing;
 end loop;
 for e in select value from jsonb_array_elements(d->'activityLog') where value->>'id'='chat-priority-'||chatid loop
  insert into public.priority_events(case_id,id,facility_id,occurred_at,data) values(cid,e->>'id','zianecomms-demo',(e->>'timestamp')::timestamptz,
    jsonb_build_object('event',e,'snapshot',d-'activityLog')) on conflict do nothing;
 end loop;
 insert into zianecomms_private.recovery_chat_events(chat_id,event_key,case_id) values(chatid,ev,cid);
 return jsonb_build_object('duplicate',false);
end $$;
revoke all on function public.zianecomms_chat_context(text),public.zianecomms_chat_binding(text),public.zianecomms_chat_turn_claim(text,text,uuid),public.zianecomms_chat_turn_state(text,uuid),public.zianecomms_chat_turn_finish(text,uuid),public.zianecomms_chat_commit(bigint,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.zianecomms_chat_context(text),public.zianecomms_chat_binding(text),public.zianecomms_chat_turn_claim(text,text,uuid),public.zianecomms_chat_turn_state(text,uuid),public.zianecomms_chat_turn_finish(text,uuid),public.zianecomms_chat_commit(bigint,uuid,jsonb,jsonb) to service_role;
commit;
