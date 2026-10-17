-- Task 7: bounded, idempotent caller intake through the existing case-save transaction.
-- Browser roles receive no grants. The public HTTP endpoint validates/normalizes facts;
-- only the server role can invoke this function. No second offline case system.
create table zianecomms_private.help_receipts (
  request_id uuid primary key,
  case_id text not null unique references public.cases(id),
  digest text not null check (digest ~ '^[a-f0-9]{64}$'),
  received_at timestamptz not null default now()
);
alter table zianecomms_private.help_receipts enable row level security;
revoke all on zianecomms_private.help_receipts from public, anon, authenticated;
grant select, insert on zianecomms_private.help_receipts to service_role;
create index help_receipts_received_at on zianecomms_private.help_receipts(received_at);

create function public.zianecomms_submit_help(
 p_expected_revision bigint, p_request_id uuid, p_digest text, p_payload jsonb,
 p_contact_encrypted text, p_contact_identity text
) returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare rev bigint; prior text; cid text := 'help-' || p_request_id::text;
begin
 select revision into rev from public.facilities where id='zianecomms-demo' and is_demo=true for update;
 if not found then raise exception 'Facility not configured'; end if;
 select digest into prior from zianecomms_private.help_receipts where request_id=p_request_id;
 if found then
   if prior <> p_digest then raise exception 'Request identifier already used' using errcode='23505'; end if;
   return true;
 end if;
 if p_digest !~ '^[a-f0-9]{64}$' then raise exception 'Invalid receipt'; end if;
 -- Demo bound only, not a replacement for production bot protection/per-client rate limits.
 if (select count(*) from zianecomms_private.help_receipts where received_at > now()-interval '1 minute') >= 60 then
   raise exception 'Intake busy' using errcode='53300';
 end if;
 if exists(select 1 from public.cases where id=cid) then raise exception 'Case identifier already used' using errcode='23505'; end if;
 if not exists(select 1 from jsonb_array_elements(p_payload->'cases') c where c->>'id'=cid and c->'data'->>'source'='offline_help_form' and c->'data'->>'deploymentId' in ('los-angeles','algeria')) then
   raise exception 'Missing validated help case';
 end if;
 perform public.zianecomms_save_demo(p_expected_revision,p_request_id,p_payload);
 if not exists(select 1 from public.cases where id=cid) then raise exception 'Case save not confirmed'; end if;
 update zianecomms_private.case_contacts set
   contact_kind=case when p_contact_encrypted is null then 'demo' else 'phone' end,
   contact_value=p_contact_encrypted, phone_identity=p_contact_identity, updated_at=now() where case_id=cid;
 update public.contact_attempts set channel='offline_help_form' where case_id=cid and id='initial-contact';
 update public.messages set channel='help_form' where case_id=cid and id='caller-message';
 insert into zianecomms_private.help_receipts(request_id,case_id,digest) values(p_request_id,cid,p_digest);
 -- Public caller intake introduces sensitive records even if voice integration is disabled later.
 update public.facilities set configuration=configuration || '{"realCallsEnabled":true}'::jsonb where id='zianecomms-demo';
 return true;
end $$;
revoke all on function public.zianecomms_submit_help(bigint,uuid,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.zianecomms_submit_help(bigint,uuid,text,jsonb,text,text) to service_role;
