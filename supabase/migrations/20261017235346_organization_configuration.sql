-- Task 8: organization configuration inside the existing protected facility workspace.
-- No demo reset, agent changes, public grants, case updates or migration-history edits.
create table zianecomms_private.organization_configs (
 id text primary key check (id ~ '^org-[a-f0-9-]{36}$'),
 facility_id text not null references public.facilities(id),
 draft jsonb not null, revision bigint not null default 0,
 active_version integer, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table zianecomms_private.organization_versions (
 organization_id text not null references zianecomms_private.organization_configs(id),
 version integer not null, configuration jsonb not null, activated_at timestamptz not null default now(),
 primary key(organization_id,version)
);
create table zianecomms_private.organization_commands (
 id uuid primary key, organization_id text not null references zianecomms_private.organization_configs(id),
 operation text not null, created_at timestamptz not null default now()
);
alter table zianecomms_private.organization_configs enable row level security;
alter table zianecomms_private.organization_versions enable row level security;
alter table zianecomms_private.organization_commands enable row level security;
revoke all on zianecomms_private.organization_configs,zianecomms_private.organization_versions,zianecomms_private.organization_commands from public,anon,authenticated;
grant select,insert,update on zianecomms_private.organization_configs to service_role;
grant select,insert on zianecomms_private.organization_versions,zianecomms_private.organization_commands to service_role;
create index organization_configs_facility on zianecomms_private.organization_configs(facility_id);

create function public.zianecomms_organizations() returns jsonb language sql security invoker set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'revision',o.revision,'draft',o.draft,
 'active',(select jsonb_build_object('version',v.version,'activatedAt',v.activated_at,'configuration',v.configuration) from zianecomms_private.organization_versions v where v.organization_id=o.id and v.version=o.active_version),
 'history',(select coalesce(jsonb_agg(jsonb_build_object('version',v.version,'activatedAt',v.activated_at) order by v.version desc),'[]'::jsonb) from zianecomms_private.organization_versions v where v.organization_id=o.id)) order by o.created_at),'[]'::jsonb)
 from zianecomms_private.organization_configs o where o.facility_id='zianecomms-demo';
$$;
create function public.zianecomms_configure_organization(p_id text,p_expected_revision bigint,p_command_id uuid,p_operation text,p_payload jsonb)
 returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
 declare current_revision bigint; current_version integer; r jsonb;
 begin
 -- Same lock as case/responder saves. Publishing responders cannot race an operational snapshot.
 perform 1 from public.facilities where id='zianecomms-demo' for update;
 if not found then raise exception 'Facility not seeded'; end if;
 if exists(select 1 from zianecomms_private.organization_commands where id=p_command_id and organization_id=p_id and operation=p_operation) then return public.zianecomms_organizations(); end if;
 if exists(select 1 from zianecomms_private.organization_commands where id=p_command_id) then raise exception 'Command identifier already used'; end if;
 if p_operation='create' then
  insert into zianecomms_private.organization_configs(id,facility_id,draft) values(p_id,'zianecomms-demo',p_payload->'draft');
 else
  select revision,active_version into current_revision,current_version from zianecomms_private.organization_configs where id=p_id and facility_id='zianecomms-demo' for update;
  if not found then raise exception 'Organization not found'; end if;
  if current_revision<>p_expected_revision then raise exception 'Configuration changed; reload and review' using errcode='40001'; end if;
  if p_operation not in ('save','activate') then raise exception 'Unknown operation'; end if;
  update zianecomms_private.organization_configs set draft=p_payload->'draft',revision=revision+1,updated_at=now() where id=p_id;
  if p_operation='activate' then
   if p_payload->'published'->>'id'<>p_id or exists(select 1 from jsonb_array_elements(p_payload->'published'->'knowledge') k where k->>'status'<>'approved') then raise exception 'Invalid approved snapshot'; end if;
   current_version:=coalesce(current_version,0)+1;
   insert into zianecomms_private.organization_versions(organization_id,version,configuration) values(p_id,current_version,p_payload->'published');
   update zianecomms_private.organization_configs set active_version=current_version where id=p_id;
   for r in select value from jsonb_array_elements(p_payload->'published'->'responders') loop
    if r->>'organizationId'<>p_id or exists(select 1 from public.responders where id=r->>'id' and (facility_id<>'zianecomms-demo' or data->>'organizationId' is distinct from p_id)) then raise exception 'Responder belongs to another workspace'; end if;
    insert into public.responders(id,facility_id,data) values(r->>'id','zianecomms-demo',r-'activeCallers'-'assignedCaseIds')
     on conflict(id) do update set data=excluded.data || jsonb_build_object('status',responders.data->'status'),updated_at=now();
   end loop;
   update public.facilities set revision=revision+1,updated_at=now() where id='zianecomms-demo';
  end if;
 end if;
 insert into zianecomms_private.organization_commands(id,organization_id,operation) values(p_command_id,p_id,p_operation);
 return public.zianecomms_organizations();
 end $$;
revoke all on function public.zianecomms_organizations(),public.zianecomms_configure_organization(text,bigint,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.zianecomms_organizations(),public.zianecomms_configure_organization(text,bigint,uuid,text,jsonb) to service_role;

-- Add read-only active summaries; retain existing recovery projection and grants.
create or replace function public.zianecomms_load_demo() returns jsonb language sql security invoker set search_path=public,pg_temp as $$
  select jsonb_build_object('revision',f.revision,'facility',jsonb_build_object('id',f.id,'name',f.name,'configuration',f.configuration),
    'activeOrganizations',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',v.configuration->>'name','version',v.version,'rulebook',v.configuration->>'rulebook','deploymentId',v.configuration->>'deploymentId','matchingWeights',v.configuration->'matchingWeights','responderIds',(select jsonb_agg(r->>'id') from jsonb_array_elements(v.configuration->'responders') r))) from zianecomms_private.organization_configs o join zianecomms_private.organization_versions v on v.organization_id=o.id and v.version=o.active_version where o.facility_id=f.id),'[]'::jsonb),
    'cases',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'facility_id',c.facility_id,'rulebook',c.rulebook,'phone_display',c.phone_display,'raw_score',c.raw_score,'data',c.data) || case when rec.call_id is null then '{}'::jsonb else jsonb_build_object('recovery_state',jsonb_build_object(
     'callId',rec.call_id,'provider',rec.provider,'state',rec.state,'hasSession',rec.provider_message_id is not null,
     'ended',exists(select 1 from zianecomms_private.recovery_chat_events e where e.chat_id=rec.provider_message_id and e.event_key in ('chat_ended','chat_analyzed')),
     'analyzed',exists(select 1 from zianecomms_private.recovery_chat_events e where e.chat_id=rec.provider_message_id and e.event_key='chat_analyzed'),
     'pendingTurn',exists(select 1 from zianecomms_private.recovery_chat_events e where e.chat_id=rec.provider_message_id and e.state='sending'))) end order by c.id)
     from public.cases c left join lateral (select r.* from zianecomms_private.sms_recovery r where r.case_id=c.id order by r.created_at desc,r.call_id desc limit 1) rec on true where c.facility_id=f.id),'[]'::jsonb),
    'responders',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'facility_id',r.facility_id,'data',r.data) order by r.id) from public.responders r where r.facility_id=f.id),'[]'::jsonb))
    from public.facilities f where f.id='zianecomms-demo' and f.is_demo=true;
$$;
