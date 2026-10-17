-- Read-only recovery state for consistent server/UI eligibility; no delivery retry or deletion.
begin;
-- Explicitly quarantine the three known historical integration fixtures, not real callers with similar names.
update public.cases set data=data||jsonb_build_object('provenance','integration_test'),updated_at=now()
 where facility_id='zianecomms-demo' and id in ('retell-task6_synthetic_1792263310949',
 'retell-zianecomms_integration_check_routine_20261017','retell-zianecomms_integration_check_emergency_20261017');
update public.cases set data=data||jsonb_build_object('provenance','seed_demo'),updated_at=now()
 where facility_id='zianecomms-demo' and id ~ '^(dc|cc)-00[1-6]$' and data->>'source' is null;
create or replace function public.zianecomms_sms_claim(p_call_id text,p_provider text,p_body text) returns boolean
language plpgsql security invoker set search_path=public,pg_temp as $$
declare cid text; identity text; d jsonb;
begin
 perform 1 from public.facilities where id='zianecomms-demo' for update;
 select c.id,c.data,cc.phone_identity into cid,d,identity from zianecomms_private.retell_calls r
 join public.cases c on c.id=r.case_id join zianecomms_private.case_contacts cc on cc.case_id=c.id
 where r.call_id=p_call_id and r.facility_id='zianecomms-demo' and (cc.contact_kind='phone' or p_provider='retell-chat');
 if p_provider='retell-chat' and cid is not null then identity:='case:'||cid; end if;
 if cid is null or identity is null or d->>'provenance'='integration_test' or d->>'status' in ('resolved','referred','duplicate','unable_to_reach')
   or d->'retell'->>'callId' is distinct from p_call_id or d->'retell'->>'disconnectionReason'='user_requested_dnc'
   or exists(select 1 from zianecomms_private.sms_opt_out where phone_identity=identity) then return false; end if;
 if not coalesce((d->>'status' in ('needs_followup','no_answer') or d->'engineInput'->>'agentOutcome' in ('could_not_resolve','caller_requested_human','caller_unsatisfied') or coalesce((d->'retell'->'outcomes'->>'unresolvedNeed')::boolean,false) or
   coalesce((d->'retell'->'outcomes'->>'humanRequested')::boolean,false) or
   (d->'retell'->>'disconnectionReason'='user_hangup' and d->'retell'->>'callSuccessful'='false')),false) then return false; end if;
 if d->'retell'->'outcomes'->>'automationResolvedRequest'='true' and d->>'status' not in ('needs_followup','no_answer') and
   not coalesce((d->'retell'->'outcomes'->>'humanRequested')::boolean,false) and
   not coalesce((d->'retell'->'outcomes'->>'unresolvedNeed')::boolean,false) then return false; end if;
 insert into zianecomms_private.sms_recovery(call_id,case_id,provider,phone_identity,body,before_calculated_priority) values(p_call_id,cid,p_provider,identity,p_body,(d->>'calculatedPriority')::integer) on conflict do nothing;
 if not found then return false; end if;
 insert into public.messages(case_id,id,facility_id,direction,channel,body,occurred_at,status,provider,call_id)
 values(cid,'recovery-'||p_call_id,'zianecomms-demo','outbound',case when p_provider='retell-chat' then 'retell_chat' else 'sms' end,p_body,now(),'sending',p_provider,p_call_id);
 return true;
end $$;
create or replace function public.zianecomms_load_demo() returns jsonb language sql security invoker set search_path=public,pg_temp as $$
  select jsonb_build_object('revision',f.revision,'facility',jsonb_build_object('id',f.id,'name',f.name,'configuration',f.configuration),
    'cases',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'facility_id',c.facility_id,'rulebook',c.rulebook,'phone_display',c.phone_display,'raw_score',c.raw_score,'data',c.data) || case when rec.call_id is null then '{}'::jsonb else jsonb_build_object('recovery_state',jsonb_build_object(
     'callId',rec.call_id,'provider',rec.provider,'state',rec.state,'hasSession',rec.provider_message_id is not null,
     'ended',exists(select 1 from zianecomms_private.recovery_chat_events e where e.chat_id=rec.provider_message_id and e.event_key in ('chat_ended','chat_analyzed')),
     'analyzed',exists(select 1 from zianecomms_private.recovery_chat_events e where e.chat_id=rec.provider_message_id and e.event_key='chat_analyzed'),
     'pendingTurn',exists(select 1 from zianecomms_private.recovery_chat_events e where e.chat_id=rec.provider_message_id and e.state='sending'))) end order by c.id)
     from public.cases c left join lateral (select r.* from zianecomms_private.sms_recovery r where r.case_id=c.id order by r.created_at desc,r.call_id desc limit 1) rec on true where c.facility_id=f.id),'[]'::jsonb),
    'responders',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'facility_id',r.facility_id,'data',r.data) order by r.id) from public.responders r where r.facility_id=f.id),'[]'::jsonb))
    from public.facilities f where f.id='zianecomms-demo' and f.is_demo=true;
$$;

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
      if e->>'type' in ('priority_changed','priority_recalculated','data_corrected') then
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



-- The load/claim functions retain their service-role-only invoker permissions.
update public.facilities set revision=revision+1,updated_at=now() where id='zianecomms-demo';
commit;
