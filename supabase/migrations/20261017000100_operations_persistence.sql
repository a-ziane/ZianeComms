-- Additive Task 4 schema. No resets, drops, public demo grants or real contact seeds.
begin;
create schema if not exists zianecomms_private;
revoke all on schema zianecomms_private from public, anon, authenticated;
grant usage on schema zianecomms_private to service_role;

create table public.facilities (
  id text primary key, name text not null, is_demo boolean not null default false,
  configuration jsonb not null default '{}', revision bigint not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.responders (
  id text primary key, facility_id text not null references public.facilities(id), data jsonb not null,
  name text generated always as (data->>'name') stored,
  status text generated always as (data->>'status') stored,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (facility_id,id), check (data->>'id'=id), check (data->>'status' in ('available','busy','offline'))
);
create table public.cases (
  id text primary key, facility_id text not null references public.facilities(id), rulebook text not null check (rulebook in ('disaster','clinic')),
  phone_display text not null, raw_score integer not null, data jsonb not null,
  name text generated always as (data->>'name') stored,
  preferred_language text generated always as (data->>'language') stored,
  location text generated always as (data->>'location') stored,
  need_summary text generated always as (data->>'needSummary') stored,
  status text generated always as (data->>'status') stored,
  calculated_priority integer generated always as ((data->>'calculatedPriority')::integer) stored,
  effective_priority integer generated always as ((data->>'priority')::integer) stored,
  hard_escalation boolean generated always as ((data->>'hardEscalation')::boolean) stored,
  score integer generated always as ((data->>'score')::integer) stored,
  assigned_responder_id text generated always as (data->>'assignedResponderId') stored,
  created_at timestamptz not null, updated_at timestamptz not null default now(),
  unique (facility_id,id), foreign key(facility_id,assigned_responder_id) references public.responders(facility_id,id),
  check (data->>'id'=id and data->>'rulebook'=rulebook), check (not data ? 'phone'),
  check (phone_display ~ '^\(\*\*\*\) \*\*\*-[0-9]{4}$' or phone_display='***-****'),
  check (calculated_priority between 0 and 3 and effective_priority between 0 and 3),
  check (score between 0 and 100), check (not hard_escalation or calculated_priority=0),
  check (status in ('awaiting_callback','calling','resolved','referred','no_answer','needs_followup','duplicate','unable_to_reach'))
);
-- Not returned by any load RPC; no browser role privileges. Encryption/key management for REAL numbers is deferred.
create table zianecomms_private.case_contacts (
  case_id text primary key references public.cases(id), contact_value text, contact_kind text not null default 'demo',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (contact_kind in ('demo','phone')), check (contact_kind <> 'demo' or contact_value is null)
);
create table public.activity_events (
  case_id text not null references public.cases(id), id text not null, facility_id text not null references public.facilities(id),
  event_type text not null, occurred_at timestamptz not null, sequence integer not null, metadata jsonb not null,
  primary key(case_id,id)
);
create table public.priority_events (
  case_id text not null references public.cases(id), id text not null, facility_id text not null references public.facilities(id),
  occurred_at timestamptz not null, data jsonb not null, primary key(case_id,id)
);
create table public.contact_attempts (
  case_id text not null references public.cases(id), id text not null, facility_id text not null references public.facilities(id),
  occurred_at timestamptz not null, wait_minutes integer not null, attempt_number integer not null,
  outcome text, channel text not null, data jsonb not null, primary key(case_id,id)
);
create table public.questionnaire_answers (
  case_id text not null references public.cases(id), ordinal integer not null, question text not null, answer text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key(case_id,ordinal)
);
create table public.messages (
  case_id text not null references public.cases(id), id text not null, facility_id text not null references public.facilities(id),
  direction text not null check(direction in ('inbound','outbound')), channel text not null, body text not null,
  occurred_at timestamptz not null, status text not null, data jsonb not null default '{}', primary key(case_id,id)
);
create table public.assignments (
  id text primary key, case_id text not null references public.cases(id), facility_id text not null references public.facilities(id),
  responder_id text not null references public.responders(id), recommended_responder_id text references public.responders(id),
  recommendation_score numeric, followed_recommendation boolean, operator_id text, reason text,
  assigned_at timestamptz not null, ended_at timestamptz, data jsonb not null,
  foreign key(facility_id,case_id) references public.cases(facility_id,id),
  foreign key(facility_id,responder_id) references public.responders(facility_id,id)
);
create unique index assignments_one_active_per_case on public.assignments(case_id) where ended_at is null;
create table zianecomms_private.mutations (
  id uuid primary key, facility_id text not null references public.facilities(id), revision bigint not null, created_at timestamptz not null default now()
);
create index cases_facility_mode on public.cases(facility_id,rulebook);
create index events_case_sequence on public.activity_events(case_id,sequence);

-- A locked demo-facility revision makes each save atomic across all models and detects concurrent edits.
create function public.zianecomms_save_demo(p_expected_revision bigint, p_mutation_id uuid, p_payload jsonb)
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
    insert into public.contact_attempts(case_id,id,facility_id,occurred_at,wait_minutes,attempt_number,channel,data)
      values(cid,'initial-contact','zianecomms-demo',(c->'data'->>'createdAt')::timestamptz,(c->'data'->>'waitMinutes')::integer,
      (c->'data'->>'attempts')::integer,'demo_inbound',c->'data'->'engineInput') on conflict do nothing;
    insert into public.messages(case_id,id,facility_id,direction,channel,body,occurred_at,status)
      values(cid,'caller-message','zianecomms-demo','inbound','demo',c->'data'->>'callerMessage',(c->'data'->>'createdAt')::timestamptz,'received') on conflict do nothing;
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

create function public.zianecomms_load_demo() returns jsonb language sql security invoker set search_path=public,pg_temp as $$
  select jsonb_build_object('revision',f.revision,'facility',jsonb_build_object('id',f.id,'name',f.name,'configuration',f.configuration),
    'cases',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'facility_id',c.facility_id,'rulebook',c.rulebook,'phone_display',c.phone_display,'raw_score',c.raw_score,'data',c.data) order by c.id) from public.cases c where c.facility_id=f.id),'[]'::jsonb),
    'responders',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'facility_id',r.facility_id,'data',r.data) order by r.id) from public.responders r where r.facility_id=f.id),'[]'::jsonb))
    from public.facilities f where f.id='zianecomms-demo' and f.is_demo=true;
$$;
create function public.zianecomms_seed_demo(p_payload jsonb) returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  insert into public.facilities(id,name,is_demo,configuration) values('zianecomms-demo',p_payload->'facility'->>'name',true,p_payload->'facility'->'configuration') on conflict do nothing;
  perform 1 from public.facilities where id='zianecomms-demo' for update;
  if exists(select 1 from public.cases where facility_id='zianecomms-demo') then return false; end if;
  perform public.zianecomms_save_demo((select revision from public.facilities where id='zianecomms-demo'), '00000000-0000-4000-8000-000000000001'::uuid,p_payload);
  return true;
end $$;

create function public.zianecomms_mutation_applied(p_mutation_id uuid) returns boolean language sql security invoker set search_path=public,pg_temp as $$
  select exists(select 1 from zianecomms_private.mutations where id=p_mutation_id and facility_id='zianecomms-demo');
$$;
revoke all on function public.zianecomms_mutation_applied(uuid) from public,anon,authenticated;
grant execute on function public.zianecomms_mutation_applied(uuid) to service_role;

-- Default-deny RLS for browser roles. Only server service_role can use the demo repository.
do $$ declare t text; begin
  foreach t in array array['facilities','cases','responders','activity_events','priority_events','contact_attempts','questionnaire_answers','messages','assignments'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant select, insert, update, delete on public.%I to service_role',t);
  end loop;
end $$;
alter table zianecomms_private.case_contacts enable row level security;
alter table zianecomms_private.mutations enable row level security;
grant all on all tables in schema zianecomms_private to service_role;
revoke all on function public.zianecomms_save_demo(bigint,uuid,jsonb),public.zianecomms_load_demo(),public.zianecomms_seed_demo(jsonb) from public,anon,authenticated;
grant execute on function public.zianecomms_save_demo(bigint,uuid,jsonb),public.zianecomms_load_demo(),public.zianecomms_seed_demo(jsonb) to service_role;
commit;
