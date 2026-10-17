-- Task 5: additive provider correlation and encrypted contacts. No scoring rules in SQL.
begin;
alter table zianecomms_private.case_contacts add column phone_identity text;
alter table zianecomms_private.case_contacts add constraint encrypted_phone_only
  check (contact_kind <> 'phone' or (contact_value is not null and phone_identity is not null and contact_value like 'v1:%' and phone_identity ~ '^[a-f0-9]{64}$'));
create table zianecomms_private.retell_calls (
  call_id text primary key, agent_id text not null, case_id text not null references public.cases(id),
  facility_id text not null references public.facilities(id),
  event_type text not null check(event_type='call_analyzed'), call_status text not null,
  call_type text not null check(call_type in ('phone_call','web_call')),
  started_at timestamptz not null, ended_at timestamptz not null, processed_at timestamptz not null default now(),
  check(ended_at>=started_at)
);
create index retell_calls_case on zianecomms_private.retell_calls(case_id);
alter table zianecomms_private.retell_calls enable row level security;
revoke all on zianecomms_private.retell_calls from public,anon,authenticated;
grant select,insert on zianecomms_private.retell_calls to service_role;

create or replace function public.zianecomms_save_demo(p_expected_revision bigint, p_mutation_id uuid, p_payload jsonb)
returns bigint language plpgsql security invoker set search_path = public, pg_temp as $$
declare rev bigint; c jsonb; r jsonb; e jsonb; q jsonb; old_data jsonb; n integer; a integer;
  cid text; rid text; rec jsonb; snapshot jsonb; assignment_id text; terminal boolean;
begin
  select revision into rev from public.facilities where id='zianecomms-demo' and is_demo=true for update;
  if not found then raise exception 'Demo facility has not been seeded'; end if;
  if exists(select 1 from zianecomms_private.mutations where id=p_mutation_id and facility_id='zianecomms-demo') then return rev; end if;
  if rev <> p_expected_revision then raise exception 'Another operator changed the database. Reload and review before retrying.' using errcode='40001'; end if;
  if jsonb_typeof(p_payload->'cases') <> 'array' or jsonb_typeof(p_payload->'responders') <> 'array' then raise exception 'Invalid state'; end if;
  -- Existing cases may not be silently removed by a stale or incomplete save.
  if exists(select 1 from public.cases x where x.facility_id='zianecomms-demo' and not exists(select 1 from jsonb_array_elements(p_payload->'cases') y where y->>'id'=x.id)) then raise exception 'Case deletion is not supported'; end if;
  for r in select value from jsonb_array_elements(p_payload->'responders') loop
    if exists(select 1 from public.responders where id=r->>'id' and facility_id<>'zianecomms-demo') then raise exception 'Responder identifier belongs to another facility'; end if;
    if r->>'facility_id' <> 'zianecomms-demo' then raise exception 'Invalid responder facility'; end if;
    insert into public.responders(id,facility_id,data) values(r->>'id','zianecomms-demo',r->'data')
      on conflict(id) do update set data=excluded.data,updated_at=now() where responders.facility_id='zianecomms-demo';
  end loop;
  for c in select value from jsonb_array_elements(p_payload->'cases') loop
    cid:=c->>'id';
    if exists(select 1 from public.cases where id=cid and facility_id<>'zianecomms-demo') then raise exception 'Case identifier belongs to another facility'; end if;
    if c->>'facility_id' <> 'zianecomms-demo' then raise exception 'Invalid case facility'; end if;
    select data into old_data from public.cases where id=cid;
    if old_data is not null then
      if jsonb_array_length(c->'data'->'activityLog') < jsonb_array_length(old_data->'activityLog') then raise exception 'History cannot be removed'; end if;
      for n in 0..jsonb_array_length(old_data->'activityLog')-1 loop
        if old_data->'activityLog'->n is distinct from c->'data'->'activityLog'->n then raise exception 'History cannot be rewritten'; end if;
      end loop;
    end if;
    insert into public.cases(id,facility_id,rulebook,phone_display,raw_score,data,created_at)
      values(cid,'zianecomms-demo',c->>'rulebook',c->>'phone_display',(c->>'raw_score')::integer,c->'data',(c->'data'->>'createdAt')::timestamptz)
      on conflict(id) do update set phone_display=excluded.phone_display,raw_score=excluded.raw_score,data=excluded.data,updated_at=now()
      where cases.facility_id='zianecomms-demo';
    insert into zianecomms_private.case_contacts(case_id) values(cid) on conflict do nothing;
    snapshot:=jsonb_build_object('calculatedPriority',c->'data'->'calculatedPriority','effectivePriority',c->'data'->'priority',
      'score',c->'data'->'score','rawScore',c->'raw_score','hardEscalation',c->'data'->'hardEscalation',
      'explanation',c->'data'->'scoreBreakdown','overridePriority',c->'data'->'overridePriority',
      'overrideReason',c->'data'->'manualPriorityReason','engineInput',c->'data'->'engineInput');
    insert into public.priority_events(case_id,id,facility_id,occurred_at,data)
      values(cid,'initial-priority','zianecomms-demo',(c->'data'->>'createdAt')::timestamptz,snapshot) on conflict do nothing;
    -- Provider contact attempts are projected once per Retell call by the ingest transaction.
    if coalesce(c->'data'->>'source','demo') <> 'retell' then
    insert into public.contact_attempts(case_id,id,facility_id,occurred_at,wait_minutes,attempt_number,channel,data)
      values(cid,'initial-contact','zianecomms-demo',(c->'data'->>'createdAt')::timestamptz,(c->'data'->>'waitMinutes')::integer,
      (c->'data'->>'attempts')::integer,'demo_inbound',c->'data'->'engineInput') on conflict do nothing;
    insert into public.messages(case_id,id,facility_id,direction,channel,body,occurred_at,status)
      values(cid,'caller-message','zianecomms-demo','inbound','demo',c->'data'->>'callerMessage',(c->'data'->>'createdAt')::timestamptz,'received') on conflict do nothing;
    end if;
    n:=0;
    for q in select value from jsonb_array_elements(c->'data'->'questionnaire') loop
      insert into public.questionnaire_answers(case_id,ordinal,question,answer) values(cid,n,q->>'question',q->>'answer')
        on conflict(case_id,ordinal) do update set question=excluded.question,answer=excluded.answer,updated_at=now(); n:=n+1;
    end loop;
    -- Canonical current answers live in cases.data; prior answer versions are included in questionnaire update events.
    delete from public.questionnaire_answers where case_id=cid and ordinal>=n;
    n:=0;
    for e in select value from jsonb_array_elements(c->'data'->'activityLog') loop
      insert into public.activity_events(case_id,id,facility_id,event_type,occurred_at,sequence,metadata)
        values(cid,e->>'id','zianecomms-demo',e->>'type',(e->>'timestamp')::timestamptz,n,e) on conflict do nothing;
      if e->>'type' in ('priority_changed','priority_recalculated') then
        insert into public.priority_events(case_id,id,facility_id,occurred_at,data)
          values(cid,e->>'id','zianecomms-demo',(e->>'timestamp')::timestamptz,jsonb_build_object('event',e,'snapshot',snapshot)) on conflict do nothing;
      end if;
      if e->>'type' in ('call_attempted','priority_recalculated') then
        select coalesce(max(attempt_number),0)+1 into a from public.contact_attempts where case_id=cid;
        insert into public.contact_attempts(case_id,id,facility_id,occurred_at,wait_minutes,attempt_number,outcome,channel,data)
          values(cid,e->>'id','zianecomms-demo',(e->>'timestamp')::timestamptz,(c->'data'->>'waitMinutes')::integer,a,
          e->'dispatch'->>'outcome',case when e->>'type'='call_attempted' then 'operator_callback' else 'repeat_contact' end,e) on conflict do nothing;
      end if;
      if e->>'type' in ('case_closed','followup_required') then
        update public.contact_attempts set outcome=e->'dispatch'->>'outcome',data=data||jsonb_build_object('outcomeEvent',e)
          where case_id=cid and attempt_number=(select max(attempt_number) from public.contact_attempts where case_id=cid);
      end if;
      if e->>'type'='priority_recalculated' then
        insert into public.messages(case_id,id,facility_id,direction,channel,body,occurred_at,status,data)
          values(cid,e->>'id','zianecomms-demo','inbound','demo',c->'data'->>'callerMessage',(e->>'timestamp')::timestamptz,'received',e) on conflict do nothing;
      end if;
      if e->>'type' in ('sms_sent','info_provided','told_call_911') then
        insert into public.messages(case_id,id,facility_id,direction,channel,body,occurred_at,status,data)
          values(cid,e->>'id','zianecomms-demo','outbound','demo_sms',coalesce(e->>'detail',e->>'label'),(e->>'timestamp')::timestamptz,'simulated',e) on conflict do nothing;
      end if;
      n:=n+1;
    end loop;
    rid:=c->'data'->>'assignedResponderId'; terminal:=c->'data'->>'status' in ('resolved','referred','duplicate','unable_to_reach');
    -- End previous active assignment on transfer or closure; never delete assignment rows.
    update public.assignments set ended_at=case when terminal then now() else coalesce((c->'data'->>'assignedAt')::timestamptz,now()) end
      where case_id=cid and ended_at is null and (responder_id is distinct from rid or terminal);
    for e in select value from jsonb_array_elements(c->'data'->'activityLog') where value->>'type'='responder_assigned' loop
      rec:=e->'dispatch'->'recommendation';
      insert into public.assignments(id,case_id,facility_id,responder_id,recommended_responder_id,recommendation_score,followed_recommendation,operator_id,reason,assigned_at,ended_at,data)
        select e->>'id',cid,'zianecomms-demo',e->'dispatch'->>'selectedResponderId',rec->'result'->>'recommendedResponderId',
          (select (x->>'rawScore')::numeric from jsonb_array_elements(rec->'result'->'candidates') x where x->>'responderId'=rec->'result'->>'recommendedResponderId'),
          (e->'dispatch'->>'followedRecommendation')::boolean,e->>'operatorId',e->>'reason',(e->>'timestamp')::timestamptz,
          case when terminal or e->'dispatch'->>'selectedResponderId' is distinct from rid or e->>'timestamp' is distinct from c->'data'->>'assignedAt' then now() else null end,e
        on conflict(id) do nothing;
    end loop;
  end loop;
  update public.facilities set revision=revision+1,updated_at=now() where id='zianecomms-demo' returning revision into rev;
  insert into zianecomms_private.mutations(id,facility_id,revision) values(p_mutation_id,'zianecomms-demo',rev);
  return rev;
end $$;


create function public.zianecomms_retell_context(p_call_id text,p_linked_case_id text) returns jsonb
language sql security invoker set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'call',(select jsonb_build_object('case_id',case_id,'agent_id',agent_id)
      from zianecomms_private.retell_calls where call_id=p_call_id and facility_id='zianecomms-demo'),
    'targetIdentity',(select cc.phone_identity from zianecomms_private.case_contacts cc
      join public.cases c on c.id=cc.case_id where c.id=p_linked_case_id and c.facility_id='zianecomms-demo'));
$$;

create function public.zianecomms_ingest_retell(p_expected_revision bigint,p_mutation_id uuid,p_payload jsonb,p_call jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare cid text:=p_call->>'case_id'; rev bigint; c jsonb; e jsonb; existing_agent text;
begin
  -- Use the same facility lock as operator saves; all projections and the receipt commit together.
  perform 1 from public.facilities where id='zianecomms-demo' and is_demo=true for update;
  if not found then raise exception 'Facility unavailable'; end if;
  select agent_id into existing_agent from zianecomms_private.retell_calls where call_id=p_call->>'call_id';
  if found then
    if existing_agent <> p_call->>'agent_id' then raise exception 'Call agent mismatch'; end if;
    return jsonb_build_object('duplicate',true);
  end if;
  if p_call->>'event' is distinct from 'call_analyzed' then raise exception 'Unsupported provider event'; end if;
  select value into c from jsonb_array_elements(p_payload->'cases') where value->>'id'=cid;
  if c is null or c->'data'->>'source' is distinct from 'retell' or
    c->'data'->'retell'->>'callId' is distinct from p_call->>'call_id' then raise exception 'Invalid provider case'; end if;
  if exists(select 1 from public.cases where id=cid and facility_id<>'zianecomms-demo') then raise exception 'Invalid case scope'; end if;
  rev:=public.zianecomms_save_demo(p_expected_revision,p_mutation_id,p_payload);
  insert into zianecomms_private.retell_calls(call_id,agent_id,case_id,facility_id,event_type,call_status,call_type,started_at,ended_at)
    values(p_call->>'call_id',p_call->>'agent_id',cid,'zianecomms-demo',p_call->>'event',p_call->>'status',p_call->>'call_type',
      (p_call->>'started_at')::timestamptz,(p_call->>'ended_at')::timestamptz);
  update zianecomms_private.case_contacts set contact_kind=case when p_call->>'contact_encrypted' is null then 'demo' else 'phone' end,
    contact_value=p_call->>'contact_encrypted',phone_identity=p_call->>'contact_identity',updated_at=now() where case_id=cid;
  insert into public.contact_attempts(case_id,id,facility_id,occurred_at,wait_minutes,attempt_number,outcome,channel,data)
    values(cid,'retell-'||(p_call->>'call_id'),'zianecomms-demo',(p_call->>'started_at')::timestamptz,0,
      (c->'data'->>'attempts')::integer,p_call->>'status','retell_voice',
      (p_call-'contact_encrypted'-'contact_identity')||jsonb_build_object('engineInput',c->'data'->'engineInput'));
  insert into public.messages(case_id,id,facility_id,direction,channel,body,occurred_at,status)
    values(cid,'retell-'||(p_call->>'call_id'),'zianecomms-demo','inbound','retell_voice',c->'data'->>'callerMessage',
      (p_call->>'ended_at')::timestamptz,'received');
  for e in select value from jsonb_array_elements(c->'data'->'activityLog')
    where value->>'type'='priority_calculated' and value->'retell'->>'callId'=p_call->>'call_id' loop
    insert into public.priority_events(case_id,id,facility_id,occurred_at,data)
      values(cid,e->>'id','zianecomms-demo',(e->>'timestamp')::timestamptz,
        jsonb_build_object('event',e,'snapshot',jsonb_build_object('calculatedPriority',c->'data'->'calculatedPriority',
          'effectivePriority',c->'data'->'priority','score',c->'data'->'score','rawScore',c->'raw_score',
          'hardEscalation',c->'data'->'hardEscalation','explanation',c->'data'->'scoreBreakdown',
          'overridePriority',c->'data'->'overridePriority','overrideReason',c->'data'->'manualPriorityReason',
          'engineInput',c->'data'->'engineInput'))) on conflict do nothing;
  end loop;
  -- Persistent latch: removing RETELL_ENABLED or the password cannot reopen real case data through the API.
  update public.facilities set configuration=configuration||jsonb_build_object('realCallsEnabled',true,'retellDeployment',
    jsonb_build_object('agentId',p_call->>'agent_id','rulebook',c->>'rulebook')) where id='zianecomms-demo';
  return jsonb_build_object('duplicate',false,'revision',rev);
end $$;
revoke all on function public.zianecomms_retell_context(text,text),public.zianecomms_ingest_retell(bigint,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.zianecomms_retell_context(text,text),public.zianecomms_ingest_retell(bigint,uuid,jsonb,jsonb) to service_role;
commit;
