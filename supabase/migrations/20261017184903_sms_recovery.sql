-- Task 6: private delivery claims/receipts; reuse canonical public messages and activity.
begin;
alter table public.messages add column provider text;
alter table public.messages add column provider_message_id text;
alter table public.messages add column call_id text;
create unique index messages_provider_receipt on public.messages(provider,provider_message_id) where provider_message_id is not null;
create index case_contact_identity on zianecomms_private.case_contacts(phone_identity) where phone_identity is not null;
create table zianecomms_private.sms_recovery (
  call_id text primary key references zianecomms_private.retell_calls(call_id),
  case_id text not null references public.cases(id), provider text not null, phone_identity text not null,
  body text not null, state text not null default 'sending' check(state in ('sending','unknown','accepted')),
  provider_message_id text, created_at timestamptz not null default now()
);
create index sms_recovery_contact on zianecomms_private.sms_recovery(phone_identity,created_at desc);
create table zianecomms_private.sms_receipts (
  provider text not null, provider_message_id text not null, case_id text references public.cases(id),
  phone_identity text not null, encrypted_body text not null, review_required boolean not null,
  reason text not null, created_at timestamptz not null default now(), primary key(provider,provider_message_id)
);
create table zianecomms_private.sms_opt_out (
  phone_identity text primary key, created_at timestamptz not null default now()
);
alter table zianecomms_private.sms_recovery enable row level security;
alter table zianecomms_private.sms_receipts enable row level security;
alter table zianecomms_private.sms_opt_out enable row level security;
revoke all on zianecomms_private.sms_recovery,zianecomms_private.sms_receipts,zianecomms_private.sms_opt_out from public,anon,authenticated;
grant select,insert,update on zianecomms_private.sms_recovery,zianecomms_private.sms_receipts,zianecomms_private.sms_opt_out to service_role;

create function public.zianecomms_sms_call_context(p_call_id text) returns jsonb language sql security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('case_id',r.case_id,'encrypted',cc.contact_value)
 from zianecomms_private.retell_calls r join zianecomms_private.case_contacts cc on cc.case_id=r.case_id
 where r.call_id=p_call_id and r.facility_id='zianecomms-demo';
$$;
create function public.zianecomms_sms_claim(p_call_id text,p_provider text,p_body text) returns boolean
language plpgsql security invoker set search_path=public,pg_temp as $$
declare cid text; identity text; d jsonb;
begin
 perform 1 from public.facilities where id='zianecomms-demo' for update;
 select c.id,c.data,cc.phone_identity into cid,d,identity from zianecomms_private.retell_calls r
 join public.cases c on c.id=r.case_id join zianecomms_private.case_contacts cc on cc.case_id=c.id
 where r.call_id=p_call_id and r.facility_id='zianecomms-demo' and cc.contact_kind='phone';
 if cid is null or identity is null or d->>'status' in ('resolved','referred','duplicate','unable_to_reach')
   or d->'retell'->>'callId' is distinct from p_call_id or d->'retell'->>'disconnectionReason'='user_requested_dnc'
   or exists(select 1 from zianecomms_private.sms_opt_out where phone_identity=identity) then return false; end if;
 if not coalesce((coalesce((d->'retell'->'outcomes'->>'unresolvedNeed')::boolean,false) or
   coalesce((d->'retell'->'outcomes'->>'humanRequested')::boolean,false) or
   (d->'retell'->>'disconnectionReason'='user_hangup' and d->'retell'->>'callSuccessful'='false')),false) then return false; end if;
 if d->'retell'->'outcomes'->>'automationResolvedRequest'='true' and
   not coalesce((d->'retell'->'outcomes'->>'humanRequested')::boolean,false) and
   not coalesce((d->'retell'->'outcomes'->>'unresolvedNeed')::boolean,false) then return false; end if;
 insert into zianecomms_private.sms_recovery(call_id,case_id,provider,phone_identity,body) values(p_call_id,cid,p_provider,identity,p_body) on conflict do nothing;
 if not found then return false; end if;
 insert into public.messages(case_id,id,facility_id,direction,channel,body,occurred_at,status,provider,call_id)
 values(cid,'recovery-'||p_call_id,'zianecomms-demo','outbound','sms',p_body,now(),'sending',p_provider,p_call_id);
 return true;
end $$;
create function public.zianecomms_sms_mark_unknown(p_call_id text) returns void
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 perform 1 from public.facilities where id='zianecomms-demo' for update;
 update zianecomms_private.sms_recovery set state='unknown' where call_id=p_call_id and state='sending';
 update public.messages set status='unknown' where id='recovery-'||p_call_id and channel='sms' and provider_message_id is null;
end $$;
create function public.zianecomms_sms_correlate(p_provider text,p_message_id text,p_identity text) returns jsonb
language sql security invoker set search_path=public,pg_temp as $$
 with candidates as (
 select distinct on (r.case_id) r.case_id,r.call_id,r.created_at from zianecomms_private.sms_recovery r
 join public.cases c on c.id=r.case_id where r.phone_identity=p_identity and r.provider=p_provider
 and c.status not in ('resolved','referred','duplicate','unable_to_reach') and r.created_at>now()-interval '48 hours'
 order by r.case_id,r.created_at desc), chosen as (select * from candidates order by created_at desc limit 1)
 select jsonb_build_object('duplicate',exists(select 1 from zianecomms_private.sms_receipts where provider=p_provider and provider_message_id=p_message_id),
 'case_id',case when (select count(*) from candidates)=1 then (select case_id from chosen) end,
 'call_id',case when (select count(*) from candidates)=1 then (select call_id from chosen) end);
$$;
create function public.zianecomms_sms_commit(p_expected_revision bigint,p_mutation_id uuid,p_payload jsonb,p_message jsonb) returns jsonb
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
   values(cid,mid,'zianecomms-demo',p_message->>'direction','sms',p_message->>'body',(p_message->>'timestamp')::timestamptz,
     p_message->>'status',p_message->>'provider',p_message->>'provider_id',p_message->>'call_id',jsonb_build_object('provider',p_message->>'provider'))
   on conflict(case_id,id) do update set channel='sms',direction=excluded.direction,body=excluded.body,status=case when messages.status in ('sent','delivered','undelivered','failed') then messages.status else excluded.status end,
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
create function public.zianecomms_sms_status(p_call_id text,p_provider_id text,p_status text) returns void
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 perform 1 from public.facilities where id='zianecomms-demo' for update;
 -- Callback can reconcile an accepted send whose HTTP response was lost. Never resend.
 update zianecomms_private.sms_recovery set state='accepted',provider_message_id=p_provider_id
 where call_id=p_call_id and provider='twilio' and (provider_message_id is null or provider_message_id=p_provider_id);
 if not found then return; end if;
 update public.messages set provider_message_id=p_provider_id,status=p_status where id='recovery-'||p_call_id and provider='twilio'
 and status not in ('delivered','undelivered','failed') and (provider_message_id is null or provider_message_id=p_provider_id);
end $$;
revoke all on function public.zianecomms_sms_call_context(text),public.zianecomms_sms_claim(text,text,text),
 public.zianecomms_sms_mark_unknown(text),public.zianecomms_sms_correlate(text,text,text),
 public.zianecomms_sms_commit(bigint,uuid,jsonb,jsonb),public.zianecomms_sms_status(text,text,text) from public,anon,authenticated;
grant execute on function public.zianecomms_sms_call_context(text),public.zianecomms_sms_claim(text,text,text),
 public.zianecomms_sms_mark_unknown(text),public.zianecomms_sms_correlate(text,text,text),
 public.zianecomms_sms_commit(bigint,uuid,jsonb,jsonb),public.zianecomms_sms_status(text,text,text) to service_role;
commit;
