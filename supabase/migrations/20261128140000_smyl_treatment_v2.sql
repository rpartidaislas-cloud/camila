-- SMYL · Tratamiento v2
-- Capítulos canónicos, aceptación por concepto, cargos selectivos y cambio de capítulo atómico.
-- Es una expansión compatible: los documentos schema 2 y los RPC históricos siguen siendo legibles.
begin;

-- ---------------------------------------------------------------------------
-- 1. Capítulo canónico en plan, versiones y propuestas.

alter table public.smyl_treatments
  add column if not exists revision integer not null default 1 check (revision > 0),
  add column if not exists predecessor_treatment_id uuid;

create unique index if not exists smyl_treatments_tenant_patient_id_uq
  on public.smyl_treatments(tenant_id, patient_id, id);
create unique index if not exists smyl_treatments_tenant_id_uq
  on public.smyl_treatments(tenant_id, id);

do $$ begin
  if not exists (select 1 from pg_constraint where conname='smyl_treatments_predecessor_fk') then
    alter table public.smyl_treatments add constraint smyl_treatments_predecessor_fk
      foreign key (tenant_id,patient_id,predecessor_treatment_id)
      references public.smyl_treatments(tenant_id,patient_id,id) on delete restrict;
  end if;
end $$;

alter table public.smyl_clinical_plans add column if not exists treatment_id uuid;
alter table public.smyl_clinical_versions add column if not exists treatment_id uuid;
alter table public.smyl_proposals add column if not exists treatment_id uuid;
alter table public.smyl_proposal_versions add column if not exists treatment_id uuid;

-- La fila corriente pertenece al capítulo activo. Las versiones se asignan sólo
-- si su fecha cae inequívocamente dentro de un capítulo; nunca se adivina.
update public.smyl_clinical_plans p set treatment_id=t.id
from public.smyl_treatments t
where p.treatment_id is null and t.tenant_id=p.tenant_id and t.patient_id=p.patient_id and t.status='active';

with matches as (
  select v.patient_id,v.revision,min(t.id::text)::uuid as treatment_id,count(*) as n
  from public.smyl_clinical_versions v
  join public.smyl_treatments t on t.tenant_id=v.tenant_id and t.patient_id=v.patient_id
   and v.updated_at>=t.opened_at and v.updated_at<coalesce(t.closed_at,'infinity'::timestamptz)
  where v.treatment_id is null
  group by v.patient_id,v.revision
)
update public.smyl_clinical_versions v set treatment_id=m.treatment_id
from matches m where m.n=1 and v.patient_id=m.patient_id and v.revision=m.revision;

-- Cuando sólo existe un capítulo, no hay ambigüedad aun si las fechas históricas
-- no tienen la precisión actual.
with only_one as (
  select tenant_id,patient_id,min(id::text)::uuid as treatment_id from public.smyl_treatments
  group by tenant_id,patient_id having count(*)=1
)
update public.smyl_clinical_versions v set treatment_id=o.treatment_id
from only_one o where v.treatment_id is null and v.tenant_id=o.tenant_id and v.patient_id=o.patient_id;

update public.smyl_proposals p set treatment_id=v.treatment_id
from public.smyl_clinical_versions v
where p.treatment_id is null and v.tenant_id=p.tenant_id and v.patient_id=p.patient_id
  and v.revision=p.plan_revision and v.treatment_id is not null;
-- Cada revisión se liga al capítulo de su propio plan congelado. El mismo
-- proposal_id podía reutilizarse históricamente después de cambiar de plan, por
-- lo que copiar el capítulo de la fila corriente corrompería las revisiones
-- anteriores. Si el snapshot no identifica un plan con capítulo inequívoco, se
-- conserva NULL para que el equipo pueda resolverlo sin inventar lineage.
with version_matches as (
  select pv.tenant_id,pv.proposal_id,pv.revision,
    min(v.treatment_id::text)::uuid as treatment_id,
    count(distinct v.treatment_id) as match_count
  from public.smyl_proposal_versions pv
  join public.smyl_proposals p on p.tenant_id=pv.tenant_id and p.id=pv.proposal_id
  join public.smyl_clinical_versions v on v.tenant_id=pv.tenant_id and v.patient_id=p.patient_id
    and v.revision=case
      when coalesce(pv.snapshot->>'plan_revision','')~'^[1-9][0-9]*$'
      then (pv.snapshot->>'plan_revision')::integer
    end
  where pv.treatment_id is null and v.treatment_id is not null
  group by pv.tenant_id,pv.proposal_id,pv.revision
)
update public.smyl_proposal_versions pv set treatment_id=m.treatment_id
from version_matches m
where m.match_count=1 and pv.tenant_id=m.tenant_id and pv.proposal_id=m.proposal_id and pv.revision=m.revision;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='smyl_clinical_plans_treatment_fk') then
    alter table public.smyl_clinical_plans add constraint smyl_clinical_plans_treatment_fk
      foreign key (tenant_id,patient_id,treatment_id)
      references public.smyl_treatments(tenant_id,patient_id,id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname='smyl_clinical_versions_treatment_fk') then
    alter table public.smyl_clinical_versions add constraint smyl_clinical_versions_treatment_fk
      foreign key (tenant_id,patient_id,treatment_id)
      references public.smyl_treatments(tenant_id,patient_id,id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname='smyl_proposals_treatment_fk') then
    alter table public.smyl_proposals add constraint smyl_proposals_treatment_fk
      foreign key (tenant_id,patient_id,treatment_id)
      references public.smyl_treatments(tenant_id,patient_id,id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname='smyl_proposal_versions_treatment_fk') then
    alter table public.smyl_proposal_versions add constraint smyl_proposal_versions_treatment_fk
      foreign key (tenant_id,treatment_id)
      references public.smyl_treatments(tenant_id,id) on delete restrict;
  end if;
end $$;

create index if not exists smyl_clinical_versions_treatment_idx
  on public.smyl_clinical_versions(tenant_id,treatment_id,revision desc);
create index if not exists smyl_proposals_treatment_idx
  on public.smyl_proposals(tenant_id,treatment_id,updated_at desc);

-- Compatibilidad: los guardados v2 todavía insertan versiones sin treatment_id.
-- El trigger toma el capítulo ya fijado en el plan corriente, no una fecha aproximada.
create or replace function public.smyl_bind_clinical_treatment()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.treatment_id is null then
    if tg_table_name='smyl_clinical_versions' then
      select p.treatment_id into new.treatment_id from public.smyl_clinical_plans p
       where p.tenant_id=new.tenant_id and p.patient_id=new.patient_id;
    else
      select t.id into new.treatment_id from public.smyl_treatments t
       where t.tenant_id=new.tenant_id and t.patient_id=new.patient_id and t.status='active';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists smyl_clinical_plan_bind_treatment on public.smyl_clinical_plans;
create trigger smyl_clinical_plan_bind_treatment before insert on public.smyl_clinical_plans
  for each row execute function public.smyl_bind_clinical_treatment();
drop trigger if exists smyl_clinical_version_bind_treatment on public.smyl_clinical_versions;
create trigger smyl_clinical_version_bind_treatment before insert on public.smyl_clinical_versions
  for each row execute function public.smyl_bind_clinical_treatment();

-- Los clientes que todavía llaman save_proposal_v2/v3 también deben quedar
-- ligados al capítulo exacto de la versión clínica. Una propuesta existente no
-- puede saltar silenciosamente a otro capítulo mediante un RPC histórico.
create or replace function public.smyl_bind_proposal_treatment()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_treatment uuid;
begin
  select v.treatment_id into v_treatment from public.smyl_clinical_versions v
   where v.tenant_id=new.tenant_id and v.patient_id=new.patient_id and v.revision=new.plan_revision;
  if new.treatment_id is null then
    new.treatment_id:=v_treatment;
  elsif v_treatment is null or new.treatment_id<>v_treatment then
    raise exception using errcode='40001',message='La propuesta no coincide con el capítulo de su plan clínico.';
  end if;
  if new.status='approved' and new.treatment_id is null then
    raise exception using errcode='23514',message='Una propuesta aprobada debe pertenecer a un tratamiento.';
  end if;
  return new;
end $$;
drop trigger if exists smyl_proposal_bind_treatment on public.smyl_proposals;
create trigger smyl_proposal_bind_treatment before insert or update of tenant_id,patient_id,plan_revision,treatment_id,status
  on public.smyl_proposals for each row execute function public.smyl_bind_proposal_treatment();

create or replace function public.smyl_bind_proposal_version_treatment()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_treatment uuid;
begin
  select p.treatment_id into v_treatment from public.smyl_proposals p
   where p.tenant_id=new.tenant_id and p.id=new.proposal_id;
  if not found then
    raise exception using errcode='23503',message='La propuesta de esta versión no existe.';
  end if;
  if new.treatment_id is null then
    new.treatment_id:=v_treatment;
  elsif new.treatment_id is distinct from v_treatment then
    raise exception using errcode='40001',message='La versión no coincide con el capítulo de su propuesta.';
  end if;
  return new;
end $$;
drop trigger if exists smyl_proposal_version_bind_treatment on public.smyl_proposal_versions;
create trigger smyl_proposal_version_bind_treatment before insert or update of tenant_id,proposal_id,treatment_id
  on public.smyl_proposal_versions for each row execute function public.smyl_bind_proposal_version_treatment();

-- Compatibilidad con la creación histórica del primer plan y con
-- smyl_open_treatment: ambos crean el capítulo después de haber preparado la
-- fila corriente. Al insertar un capítulo activo, su plan queda ligado en la
-- misma transacción; la versión siguiente hereda el id mediante el trigger de
-- arriba. Esto evita planes corrientes sin capítulo canónico.
create or replace function public.smyl_bind_active_treatment_plan()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.status='active' then
    update public.smyl_clinical_plans
       set treatment_id=new.id
     where tenant_id=new.tenant_id and patient_id=new.patient_id
       and treatment_id is distinct from new.id;
  end if;
  return new;
end $$;
drop trigger if exists smyl_treatment_bind_current_plan on public.smyl_treatments;
create trigger smyl_treatment_bind_current_plan after insert on public.smyl_treatments
  for each row execute function public.smyl_bind_active_treatment_plan();

create or replace function public.smyl_save_clinical_plan_v3(
  p_tenant_id uuid,p_patient_id uuid,p_expected_revision integer,p_document jsonb,
  p_review boolean default false,p_treatment_id uuid default null
) returns public.smyl_clinical_plans
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_result public.smyl_clinical_plans;
begin
  if auth.uid() is null or p_tenant_id is distinct from public.smyl_current_tenant()
     or not public.smyl_has_permission(p_tenant_id,'clinical.write')
     or (p_review and not public.smyl_has_permission(p_tenant_id,'clinical.approve'))
     or not public.smyl_can_access_patient(p_tenant_id,p_patient_id,'clinical') then
    raise exception using errcode='42501',message='No tienes acceso al plan de este paciente.';
  end if;
  if p_treatment_id is null or not exists(select 1 from public.smyl_treatments t
    where t.tenant_id=p_tenant_id and t.patient_id=p_patient_id and t.id=p_treatment_id and t.status='active') then
    raise exception using errcode='23514',message='El plan debe pertenecer al tratamiento activo.';
  end if;
  v_result:=public.smyl_save_clinical_plan_v2(p_tenant_id,p_patient_id,p_expected_revision,p_document,p_review);
  update public.smyl_clinical_plans set treatment_id=p_treatment_id
    where tenant_id=p_tenant_id and patient_id=p_patient_id returning * into v_result;
  update public.smyl_clinical_versions set treatment_id=p_treatment_id
    where tenant_id=p_tenant_id and patient_id=p_patient_id and revision=v_result.revision;
  return v_result;
end $$;

-- v4 conserva la validación de documento de v3, pero añade y congela sucursal +
-- capítulo en la misma transacción, además del alcance real al paciente.
create or replace function public.smyl_save_proposal_v4(
  p_id uuid,p_tenant_id uuid,p_patient_id uuid,p_plan_revision integer,
  p_expected_revision integer,p_document jsonb,p_approve boolean default false,
  p_branch_id uuid default null,p_treatment_id uuid default null
) returns public.smyl_proposals
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_result public.smyl_proposals; v_existing public.smyl_proposals;
begin
  if auth.uid() is null or p_tenant_id is distinct from public.smyl_current_tenant()
     or not public.smyl_has_permission(p_tenant_id,'proposal.write')
     or (p_approve and not public.smyl_has_permission(p_tenant_id,'proposal.approve'))
     or not public.smyl_can_access_patient(p_tenant_id,p_patient_id,'clinical') then
    raise exception using errcode='42501',message='No tienes acceso a la propuesta de este paciente.';
  end if;
  if p_treatment_id is null or not exists(
    select 1 from public.smyl_treatments t where t.id=p_treatment_id and t.tenant_id=p_tenant_id
      and t.patient_id=p_patient_id and t.status='active'
  ) then raise exception using errcode='23514',message='Selecciona el tratamiento activo del paciente.'; end if;
  if not exists(
    select 1 from public.smyl_clinical_versions v where v.tenant_id=p_tenant_id and v.patient_id=p_patient_id
      and v.revision=p_plan_revision and v.status='reviewed' and v.treatment_id=p_treatment_id
  ) then raise exception using errcode='40001',message='El plan revisado no pertenece al tratamiento seleccionado.'; end if;
  select * into v_existing from public.smyl_proposals where id=p_id;
  if found and v_existing.treatment_id is not null and v_existing.treatment_id<>p_treatment_id then
    raise exception using errcode='40001',message='Una cotización no puede cambiar de tratamiento.';
  end if;
  v_result:=public.smyl_save_proposal_v3(p_id,p_tenant_id,p_patient_id,p_plan_revision,
    p_expected_revision,p_document,p_approve,p_branch_id);
  update public.smyl_proposals set treatment_id=p_treatment_id,branch_id=p_branch_id
   where id=v_result.id and tenant_id=p_tenant_id returning * into v_result;
  update public.smyl_proposal_versions
     set treatment_id=p_treatment_id,snapshot=to_jsonb(v_result)
   where proposal_id=v_result.id and tenant_id=p_tenant_id and revision=v_result.revision;
  return v_result;
end $$;

-- La exportación de una propuesta histórica se valida contra su versión clínica
-- inmutable, no contra el plan corriente de otro capítulo.
create or replace function public.smyl_proposal_for_export(p_id uuid,p_revision integer)
returns public.smyl_proposals language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_result public.smyl_proposals;
begin
  select * into v_result from public.smyl_proposals where id=p_id;
  if not found or not public.smyl_has_permission(v_result.tenant_id,'proposal.read')
     or not public.smyl_can_access_patient(v_result.tenant_id,v_result.patient_id,'clinical') then
    raise exception using errcode='42501',message='No tienes acceso a esta propuesta.';
  end if;
  if v_result.revision is distinct from p_revision or v_result.status<>'approved'
     or (v_result.document->>'valid_until')::date<(now() at time zone 'America/Mexico_City')::date
     or not exists(select 1 from public.smyl_clinical_versions v
       where v.tenant_id=v_result.tenant_id and v.patient_id=v_result.patient_id
         and v.revision=v_result.plan_revision and v.status='reviewed'
         and (v_result.treatment_id is null or v.treatment_id=v_result.treatment_id)) then
    raise exception using errcode='40001',message='La propuesta debe revisarse nuevamente.';
  end if;
  return v_result;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Decisión canónica por concepto (una decisión final por revisión).

create table public.smyl_proposal_decisions(
  id uuid primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete restrict,
  patient_id uuid not null,
  proposal_id uuid not null references public.smyl_proposals(id) on delete restrict,
  proposal_revision integer not null check(proposal_revision>0),
  treatment_id uuid not null,
  decision_type text not null check(decision_type in ('accepted_full','accepted_partial','declined','changes_requested')),
  channel text not null check(channel in ('in_person','email','whatsapp','phone','other')),
  note text not null default '' check(char_length(note)<=1000),
  accepted_cents bigint not null default 0 check(accepted_cents>=0),
  pending_cents bigint not null default 0 check(pending_cents>=0),
  declined_cents bigint not null default 0 check(declined_cents>=0),
  request_hash text not null check(request_hash~'^[0-9a-f]{64}$'),
  occurred_at timestamptz not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(tenant_id,id),
  unique(tenant_id,proposal_id,proposal_revision),
  foreign key(tenant_id,patient_id) references public.camila_pacientes(tenant_id,id) on delete restrict,
  foreign key(tenant_id,patient_id,treatment_id) references public.smyl_treatments(tenant_id,patient_id,id) on delete restrict
);
create table public.smyl_proposal_decision_items(
  decision_id uuid not null,
  tenant_id uuid not null,
  proposal_item_id text not null check(proposal_item_id~'^[A-Za-z0-9-]{1,80}$'),
  item_status text not null check(item_status in ('accepted','rejected','pending')),
  accepted_quantity numeric(10,3) not null default 0 check(accepted_quantity>=0),
  item_snapshot jsonb not null check(jsonb_typeof(item_snapshot)='object'),
  primary key(decision_id,proposal_item_id),
  foreign key(tenant_id,decision_id) references public.smyl_proposal_decisions(tenant_id,id) on delete restrict
);

alter table public.smyl_proposal_decisions enable row level security;
alter table public.smyl_proposal_decision_items enable row level security;
create or replace function public.smyl_can_read_proposal_decision_finance(p_tenant uuid,p_decision_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select auth.uid() is not null
    and p_tenant=public.smyl_current_tenant()
    and public.smyl_has_permission(p_tenant,'finance.read')
    and exists(
      select 1 from public.smyl_proposal_decisions d
      join public.smyl_proposals p on p.tenant_id=d.tenant_id and p.id=d.proposal_id
      where d.tenant_id=p_tenant and d.id=p_decision_id
        and public.smyl_can_access_finance_patient(p.tenant_id,p.patient_id,p.branch_id)
    )
$$;
create policy smyl_proposal_decisions_read on public.smyl_proposal_decisions for select to authenticated
  using(public.smyl_has_permission(tenant_id,'proposal.read') and public.smyl_can_access_patient(tenant_id,patient_id,'clinical'));
create policy smyl_proposal_decision_items_read on public.smyl_proposal_decision_items for select to authenticated
  using(exists(select 1 from public.smyl_proposal_decisions d where d.tenant_id=smyl_proposal_decision_items.tenant_id
    and d.id=smyl_proposal_decision_items.decision_id and public.smyl_has_permission(d.tenant_id,'proposal.read')
    and public.smyl_can_access_patient(d.tenant_id,d.patient_id,'clinical')));
create policy smyl_proposal_decisions_finance_read on public.smyl_proposal_decisions for select to authenticated
  using(public.smyl_can_read_proposal_decision_finance(tenant_id,id));
create policy smyl_proposal_decision_items_finance_read on public.smyl_proposal_decision_items for select to authenticated
  using(public.smyl_can_read_proposal_decision_finance(tenant_id,decision_id));
revoke all on public.smyl_proposal_decisions,public.smyl_proposal_decision_items from public,anon,authenticated;
grant select on public.smyl_proposal_decisions,public.smyl_proposal_decision_items to authenticated;

create or replace function public.smyl_treatment_v2_append_only_guard()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin raise exception using errcode='55000',message='Este registro clínico es inmutable.'; end $$;
create trigger smyl_proposal_decisions_immutable before update or delete on public.smyl_proposal_decisions
  for each row execute function public.smyl_treatment_v2_append_only_guard();
create trigger smyl_proposal_decision_items_immutable before update or delete on public.smyl_proposal_decision_items
  for each row execute function public.smyl_treatment_v2_append_only_guard();
create trigger smyl_proposal_decisions_audit after insert or update or delete on public.smyl_proposal_decisions
  for each row execute function public.smyl_audit_row();
create trigger smyl_proposal_decision_items_audit after insert or update or delete on public.smyl_proposal_decision_items
  for each row execute function public.smyl_audit_row();

-- Impide que el RPC histórico registre aceptación total después de una decisión
-- parcial. Sólo este RPC puede crear el evento de compatibilidad de una decisión full.
create or replace function public.smyl_guard_legacy_proposal_decision_event()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  if new.event_type in ('accepted','declined','changes_requested')
     and exists(select 1 from public.smyl_proposal_decisions d where d.tenant_id=new.tenant_id
       and d.proposal_id=new.proposal_id and d.proposal_revision=new.proposal_revision)
     and coalesce(current_setting('smyl.proposal_decision_event',true),'')<>'allow' then
    raise exception using errcode='40001',message='Esta revisión ya tiene una decisión por concepto.';
  end if;
  return new;
end $$;
create trigger smyl_guard_legacy_proposal_decision_event before insert on public.smyl_proposal_events
  for each row execute function public.smyl_guard_legacy_proposal_decision_event();

create or replace function public.smyl_record_proposal_decision_v1(
  p_operation_id uuid,p_proposal_id uuid,p_proposal_revision integer,
  p_accepted_item_ids text[],p_rejected_item_ids text[],p_pending_item_ids text[],
  p_channel text,p_note text default '',p_occurred_at timestamptz default now()
) returns public.smyl_proposal_decisions
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_tenant uuid:=public.smyl_current_tenant(); v_proposal public.smyl_proposals;
  v_existing public.smyl_proposal_decisions; v_result public.smyl_proposal_decisions;
  v_item jsonb; v_id text; v_status text; v_kind text; v_note text:=btrim(coalesce(p_note,''));
  v_all text[]; v_a text[]; v_r text[]; v_p text[]; v_union text[];
  v_total integer; v_accepted integer; v_line bigint; v_ac bigint:=0; v_pc bigint:=0; v_dc bigint:=0;
  v_hash text;
begin
  v_a:=coalesce(p_accepted_item_ids,array[]::text[]); v_r:=coalesce(p_rejected_item_ids,array[]::text[]);
  v_p:=coalesce(p_pending_item_ids,array[]::text[]);
  select coalesce(array_agg(x order by x),array[]::text[]) into v_a from unnest(v_a) x;
  select coalesce(array_agg(x order by x),array[]::text[]) into v_r from unnest(v_r) x;
  select coalesce(array_agg(x order by x),array[]::text[]) into v_p from unnest(v_p) x;
  v_hash:=encode(extensions.digest(convert_to(jsonb_build_object('proposal_id',p_proposal_id,'revision',p_proposal_revision,
    'accepted',v_a,'rejected',v_r,'pending',v_p,'channel',p_channel,'note',v_note,'occurred_at',p_occurred_at)::text,'UTF8'),'sha256'),'hex');
  select * into v_existing from public.smyl_proposal_decisions
   where tenant_id=v_tenant and (id=p_operation_id or (proposal_id=p_proposal_id and proposal_revision=p_proposal_revision));
  if found then
    if v_existing.id<>p_operation_id or v_existing.request_hash<>v_hash then
      raise exception using errcode='40001',message='La operación ya fue utilizada con otra decisión.';
    end if;
    return v_existing;
  end if;
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'proposal.followup')
     or p_operation_id is null or p_proposal_id is null or p_proposal_revision<1
     or p_channel not in ('in_person','email','whatsapp','phone','other')
     or p_occurred_at is null or p_occurred_at>clock_timestamp()+interval '5 minutes' or char_length(v_note)>1000 then
    raise exception using errcode='22023',message='La decisión no es válida.';
  end if;
  if cardinality(v_a)<>cardinality(array(select distinct x from unnest(v_a) x))
     or cardinality(v_r)<>cardinality(array(select distinct x from unnest(v_r) x))
     or cardinality(v_p)<>cardinality(array(select distinct x from unnest(v_p) x)) then
    raise exception using errcode='22023',message='Un concepto aparece más de una vez.';
  end if;
  v_union:=v_a||v_r||v_p;
  if cardinality(v_union)<>cardinality(array(select distinct x from unnest(v_union) x)) then
    raise exception using errcode='22023',message='Cada concepto debe tener una sola decisión.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_proposal_id::text||':'||p_proposal_revision::text,4));
  select * into v_proposal from public.smyl_proposals where tenant_id=v_tenant and id=p_proposal_id for update;
  if not found or v_proposal.status<>'approved' or v_proposal.revision<>p_proposal_revision
     or v_proposal.treatment_id is null or not public.smyl_can_access_patient(v_tenant,v_proposal.patient_id,'clinical') then
    raise exception using errcode='42501',message='No puedes decidir sobre esta propuesta.';
  end if;
  if (v_proposal.document->>'valid_until')::date<(now() at time zone 'America/Mexico_City')::date then
    raise exception using errcode='40001',message='La vigencia de la propuesta terminó; prepara una nueva revisión.';
  end if;
  if not exists(select 1 from public.smyl_proposal_events e where e.tenant_id=v_tenant and e.proposal_id=p_proposal_id
    and e.proposal_revision=p_proposal_revision and e.event_type='presented' and e.occurred_at<=p_occurred_at) then
    raise exception using errcode='40001',message='Registra primero la presentación al paciente.';
  end if;
  if exists(select 1 from public.smyl_proposal_events e where e.tenant_id=v_tenant and e.proposal_id=p_proposal_id
    and e.proposal_revision=p_proposal_revision and e.event_type in ('accepted','declined','changes_requested')) then
    raise exception using errcode='40001',message='La revisión ya tiene una decisión histórica.';
  end if;
  select array_agg(value->>'id' order by value->>'id'),count(*) into v_all,v_total
    from jsonb_array_elements(v_proposal.document->'items');
  if coalesce(v_all,array[]::text[]) is distinct from array(select x from unnest(v_union) x order by x) then
    raise exception using errcode='22023',message='Clasifica exactamente todos los conceptos de la propuesta.';
  end if;
  v_accepted:=cardinality(v_a);
  if v_accepted=v_total then v_kind:='accepted_full';
  elsif v_accepted>0 then v_kind:='accepted_partial';
  elsif cardinality(v_r)=v_total then v_kind:='declined';
  else v_kind:='changes_requested'; end if;
  if v_kind in ('declined','changes_requested') and char_length(v_note)=0 then
    raise exception using errcode='22023',message='Explica la decisión del paciente.';
  end if;
  for v_item in select value from jsonb_array_elements(v_proposal.document->'items') loop
    v_id:=v_item->>'id'; v_line:=(v_item->>'quantity')::bigint*(v_item->>'unit_cents')::bigint;
    if v_id=any(v_a) then v_ac:=v_ac+v_line;
    elsif v_id=any(v_r) then v_dc:=v_dc+v_line;
    else v_pc:=v_pc+v_line; end if;
  end loop;
  insert into public.smyl_proposal_decisions(id,tenant_id,patient_id,proposal_id,proposal_revision,treatment_id,
    decision_type,channel,note,accepted_cents,pending_cents,declined_cents,request_hash,occurred_at,created_by)
  values(p_operation_id,v_tenant,v_proposal.patient_id,v_proposal.id,v_proposal.revision,v_proposal.treatment_id,
    v_kind,p_channel,v_note,v_ac,v_pc,v_dc,v_hash,p_occurred_at,auth.uid()) returning * into v_result;
  for v_item in select value from jsonb_array_elements(v_proposal.document->'items') loop
    v_id:=v_item->>'id';
    if v_id=any(v_a) then v_status:='accepted'; elsif v_id=any(v_r) then v_status:='rejected'; else v_status:='pending'; end if;
    insert into public.smyl_proposal_decision_items(decision_id,tenant_id,proposal_item_id,item_status,accepted_quantity,item_snapshot)
    values(v_result.id,v_tenant,v_id,v_status,case when v_status='accepted' then (v_item->>'quantity')::numeric else 0 end,v_item);
  end loop;
  if v_kind in ('accepted_full','declined','changes_requested') then
    perform set_config('smyl.proposal_decision_event','allow',true);
    insert into public.smyl_proposal_events(id,tenant_id,proposal_id,proposal_revision,event_type,channel,note,occurred_at,created_by)
    values(gen_random_uuid(),v_tenant,v_proposal.id,v_proposal.revision,
      case v_kind when 'accepted_full' then 'accepted' when 'declined' then 'declined' else 'changes_requested' end,
      p_channel,v_note,p_occurred_at,auth.uid());
  end if;
  return v_result;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Cargos exclusivamente desde la selección aceptada.

alter table public.smyl_proposal_charge_batches add column if not exists decision_id uuid;
alter table public.smyl_proposal_charge_batches add column if not exists request_hash text;
create unique index if not exists smyl_proposal_charge_batches_decision_uq
  on public.smyl_proposal_charge_batches(tenant_id,decision_id) where decision_id is not null;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='smyl_proposal_charge_batches_decision_fk') then
    alter table public.smyl_proposal_charge_batches add constraint smyl_proposal_charge_batches_decision_fk
      foreign key(tenant_id,decision_id) references public.smyl_proposal_decisions(tenant_id,id) on delete restrict;
  end if;
end $$;

create or replace function public.smyl_post_proposal_decision_charges_v1(
  p_batch_id uuid,p_idempotency_key uuid,p_decision_id uuid,p_branch_id uuid,p_due_on date default null,
  p_simulation_charge_id uuid default null
) returns public.smyl_proposal_charge_batches
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_tenant uuid:=public.smyl_current_tenant(); v_decision public.smyl_proposal_decisions;
  v_proposal public.smyl_proposals; v_batch public.smyl_proposal_charge_batches;
  v_row public.smyl_proposal_decision_items; v_item jsonb; v_count integer:=0;
  v_qty numeric; v_unit numeric; v_line numeric; v_total numeric(12,2):=0; v_hash text;
  v_sim public.smyl_finance_charges; v_credit numeric(12,2):=0; v_left numeric(12,2):=0;
  v_discount numeric(12,2):=0; v_veneer_total numeric(12,2):=0; v_veneer_count integer:=0;
  v_credit_marked boolean:=false; v_is_veneer boolean;
begin
  v_hash:=encode(extensions.digest(convert_to(jsonb_build_object('decision_id',p_decision_id,'branch_id',p_branch_id,
    'due_on',p_due_on,'simulation_charge_id',p_simulation_charge_id)::text,'UTF8'),'sha256'),'hex');
  select * into v_batch from public.smyl_proposal_charge_batches where tenant_id=v_tenant
    and (idempotency_key=p_idempotency_key or decision_id=p_decision_id);
  if found then
    if v_batch.id<>p_batch_id or v_batch.request_hash is distinct from v_hash then
      raise exception using errcode='40001',message='La operación ya fue utilizada con otros datos.';
    end if;
    return v_batch;
  end if;
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'finance.manage') or p_batch_id is null
     or p_idempotency_key is null or p_decision_id is null or p_branch_id is null
     or (p_due_on is not null and p_due_on<current_date) then
    raise exception using errcode='22023',message='Datos de conversión inválidos.';
  end if;
  select * into v_decision from public.smyl_proposal_decisions where tenant_id=v_tenant and id=p_decision_id;
  if not found or v_decision.accepted_cents<=0
     or not public.smyl_can_access_finance_patient(v_tenant,v_decision.patient_id,p_branch_id) then
    raise exception using errcode='42501',message='No hay conceptos aceptados disponibles para cobrar.';
  end if;
  select * into v_proposal from public.smyl_proposals where tenant_id=v_tenant and id=v_decision.proposal_id for update;
  if not found or v_proposal.revision<>v_decision.proposal_revision or v_proposal.status<>'approved'
     or v_proposal.treatment_id<>v_decision.treatment_id then
    raise exception using errcode='40001',message='La propuesta aceptada ya no coincide con esta revisión.';
  end if;
  if (v_proposal.document->>'valid_until')::date<(now() at time zone 'America/Mexico_City')::date then
    raise exception using errcode='40001',message='La vigencia de la propuesta aceptada terminó; prepara una nueva revisión.';
  end if;
  if v_proposal.branch_id is distinct from p_branch_id then
    raise exception using errcode='40001',message='Los cargos deben registrarse en la sucursal de la propuesta aceptada.';
  end if;
  if not exists(select 1 from public.smyl_branches where tenant_id=v_tenant and id=p_branch_id and active) then
    raise exception using errcode='23503',message='Selecciona una sucursal activa.';
  end if;
  for v_row in select * from public.smyl_proposal_decision_items where tenant_id=v_tenant
    and decision_id=v_decision.id and item_status='accepted' order by proposal_item_id loop
    v_item:=v_row.item_snapshot; v_qty:=v_row.accepted_quantity;
    v_unit:=round((v_item->>'unit_cents')::numeric/100,2); v_line:=round(v_qty*v_unit,2);
    if v_qty<=0 or v_unit<0 then raise exception using errcode='23514',message='La decisión contiene importes inválidos.'; end if;
    if v_line>0 then
      v_count:=v_count+1;v_total:=v_total+v_line;
      if public.smyl_is_veneer_service(v_tenant,v_item) then
        v_veneer_total:=v_veneer_total+v_line;v_veneer_count:=v_veneer_count+1;
      end if;
    end if;
  end loop;
  if v_count=0 or round(v_total*100)::bigint<>v_decision.accepted_cents then
    raise exception using errcode='23514',message='El total aceptado no coincide con sus conceptos.';
  end if;
  if p_simulation_charge_id is not null then
    select * into v_sim from public.smyl_finance_charges
      where tenant_id=v_tenant and id=p_simulation_charge_id for update;
    if not found or v_sim.status<>'open' or v_sim.simulation_case_id is null or v_sim.patient_id<>v_decision.patient_id
       or v_sim.branch_id is distinct from p_branch_id then
      raise exception using errcode='23514',message='La simulación seleccionada no tiene un cobro vigente de este paciente.';
    end if;
    if exists(select 1 from public.smyl_finance_charges where tenant_id=v_tenant
      and simulation_credit_charge_id=p_simulation_charge_id and status='open') then
      raise exception using errcode='23505',message='Esta simulación ya se descontó en otro tratamiento.';
    end if;
    if v_veneer_total<=0 then
      raise exception using errcode='23514',message='Los conceptos aceptados no incluyen carillas; el descuento no aplica.';
    end if;
    v_credit:=least(v_sim.total_amount,v_veneer_total-0.01*v_veneer_count);
    if v_credit<=0 then raise exception using errcode='23514',message='El importe de las carillas no alcanza para aplicar el descuento.'; end if;
    v_left:=v_credit;
  end if;
  insert into public.smyl_proposal_charge_batches(id,tenant_id,proposal_id,proposal_revision,patient_id,branch_id,
    idempotency_key,charge_count,total_amount,source_snapshot,created_by,decision_id,request_hash)
  values(p_batch_id,v_tenant,v_proposal.id,v_proposal.revision,v_proposal.patient_id,p_branch_id,p_idempotency_key,
    v_count,v_total-v_credit,jsonb_build_object('decision_id',v_decision.id,'decision_type',v_decision.decision_type,
      'request_hash',v_decision.request_hash,'treatment_id',v_decision.treatment_id,'proposal_id',v_proposal.id,
      'proposal_revision',v_proposal.revision,'plan_revision',v_proposal.plan_revision,'accepted_cents',v_decision.accepted_cents,
      'simulation_credit',case when v_credit>0 then jsonb_build_object('charge_id',p_simulation_charge_id,
        'case_id',v_sim.simulation_case_id,'amount',v_credit) else null end),auth.uid(),
    v_decision.id,v_hash) returning * into v_batch;
  for v_row in select * from public.smyl_proposal_decision_items where tenant_id=v_tenant
    and decision_id=v_decision.id and item_status='accepted' order by proposal_item_id loop
    v_item:=v_row.item_snapshot;v_qty:=v_row.accepted_quantity;v_unit:=round((v_item->>'unit_cents')::numeric/100,2);v_line:=round(v_qty*v_unit,2);
    if v_line>0 then
      v_discount:=0;v_is_veneer:=v_left>0 and public.smyl_is_veneer_service(v_tenant,v_item);
      if v_is_veneer then v_discount:=least(v_left,v_line-0.01);v_left:=v_left-v_discount;end if;
      insert into public.smyl_finance_charges(id,tenant_id,patient_id,branch_id,service_id,proposal_id,idempotency_key,
        concept,quantity,unit_price,discount_amount,tax_amount,total_amount,due_on,created_by,proposal_revision,
        proposal_item_id,proposal_batch_id,service_revision,service_snapshot,simulation_credit_charge_id)
      values(gen_random_uuid(),v_tenant,v_proposal.patient_id,p_branch_id,
        case when v_item->'service_id'='null'::jsonb then null else (v_item->>'service_id')::uuid end,
        v_proposal.id,gen_random_uuid(),btrim(v_item->>'label'),v_qty,v_unit,v_discount,0,v_line-v_discount,p_due_on,auth.uid(),
        v_proposal.revision,v_item->>'id',v_batch.id,
        case when v_item->'service_revision'='null'::jsonb then null else (v_item->>'service_revision')::integer end,
        case when v_item->'service_snapshot'='null'::jsonb then null else v_item->'service_snapshot' end,
        case when v_discount>0 and not v_credit_marked then p_simulation_charge_id else null end);
      if v_discount>0 then v_credit_marked:=true;end if;
    end if;
  end loop;
  return v_batch;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Cerrar y abrir capítulo en una sola transacción, con carry explícito.

create table public.smyl_treatment_plan_carries(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete restrict,
  patient_id uuid not null,
  from_treatment_id uuid not null,
  to_treatment_id uuid not null,
  from_plan_revision integer not null check(from_plan_revision>0),
  from_plan_item_id text not null,
  to_plan_revision integer not null check(to_plan_revision>0),
  to_plan_item_id text not null,
  item_snapshot jsonb not null check(jsonb_typeof(item_snapshot)='object'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(tenant_id,from_treatment_id,from_plan_revision,from_plan_item_id,to_treatment_id),
  unique(tenant_id,to_treatment_id,to_plan_revision,to_plan_item_id),
  foreign key(tenant_id,patient_id,from_treatment_id) references public.smyl_treatments(tenant_id,patient_id,id) on delete restrict,
  foreign key(tenant_id,patient_id,to_treatment_id) references public.smyl_treatments(tenant_id,patient_id,id) on delete restrict
);
create table public.smyl_treatment_transition_requests(
  idempotency_key uuid primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete restrict,
  patient_id uuid not null,
  from_treatment_id uuid not null,
  to_treatment_id uuid not null,
  request_hash text not null check(request_hash~'^[0-9a-f]{64}$'),
  result jsonb not null check(jsonb_typeof(result)='object'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(tenant_id,idempotency_key),
  foreign key(tenant_id,patient_id,from_treatment_id) references public.smyl_treatments(tenant_id,patient_id,id) on delete restrict,
  foreign key(tenant_id,patient_id,to_treatment_id) references public.smyl_treatments(tenant_id,patient_id,id) on delete restrict
);
alter table public.smyl_treatment_plan_carries enable row level security;
alter table public.smyl_treatment_transition_requests enable row level security;
create policy smyl_treatment_plan_carries_read on public.smyl_treatment_plan_carries for select to authenticated
  using(public.smyl_has_permission(tenant_id,'clinical.read') and public.smyl_can_access_patient(tenant_id,patient_id,'clinical'));
create policy smyl_treatment_transition_requests_read on public.smyl_treatment_transition_requests for select to authenticated
  using(public.smyl_has_permission(tenant_id,'clinical.read') and public.smyl_can_access_patient(tenant_id,patient_id,'clinical'));
revoke all on public.smyl_treatment_plan_carries,public.smyl_treatment_transition_requests from public,anon,authenticated;
grant select on public.smyl_treatment_plan_carries,public.smyl_treatment_transition_requests to authenticated;
create trigger smyl_treatment_plan_carries_immutable before update or delete on public.smyl_treatment_plan_carries
  for each row execute function public.smyl_treatment_v2_append_only_guard();
create trigger smyl_treatment_transition_requests_immutable before update or delete on public.smyl_treatment_transition_requests
  for each row execute function public.smyl_treatment_v2_append_only_guard();
create trigger smyl_treatment_plan_carries_audit after insert or update or delete on public.smyl_treatment_plan_carries
  for each row execute function public.smyl_audit_row();
create trigger smyl_treatment_transition_requests_audit after insert or update or delete on public.smyl_treatment_transition_requests
  for each row execute function public.smyl_audit_row();

create or replace function public.smyl_transition_treatment_v1(
  p_current_id uuid,p_expected_treatment_revision integer,p_expected_plan_revision integer,
  p_outcome text,p_note text,p_new_id uuid,p_new_title text,p_new_reason text,
  p_carry_item_ids text[],p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_tenant uuid:=public.smyl_current_tenant(); v_current public.smyl_treatments; v_plan public.smyl_clinical_plans;
  v_request public.smyl_treatment_transition_requests; v_ids text[]; v_hash text; v_note text:=nullif(btrim(coalesce(p_note,'')),'');
  v_title text:=btrim(coalesce(p_new_title,'')); v_reason text:=left(btrim(coalesce(p_new_reason,'')),2000);
  v_item jsonb; v_new_item jsonb; v_new_item_id text; v_items jsonb:='[]'::jsonb; v_new_doc jsonb;
  v_new_revision integer; v_seq integer; v_count integer:=0; v_result jsonb; v_stamp timestamptz:=clock_timestamp();
begin
  v_ids:=coalesce(p_carry_item_ids,array[]::text[]);
  select coalesce(array_agg(x order by x),array[]::text[]) into v_ids from unnest(v_ids) x;
  v_hash:=encode(extensions.digest(convert_to(jsonb_build_object('current_id',p_current_id,'treatment_revision',p_expected_treatment_revision,
    'plan_revision',p_expected_plan_revision,'outcome',p_outcome,'note',v_note,'new_id',p_new_id,'title',v_title,
    'reason',v_reason,'carry',v_ids)::text,'UTF8'),'sha256'),'hex');
  select * into v_request from public.smyl_treatment_transition_requests where tenant_id=v_tenant and idempotency_key=p_idempotency_key;
  if found then
    if v_request.request_hash<>v_hash then raise exception using errcode='40001',message='La operación ya fue utilizada con otros datos.'; end if;
    return v_request.result;
  end if;
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'clinical.write') or p_current_id is null or p_new_id is null
     or p_idempotency_key is null or p_expected_treatment_revision<1 or p_expected_plan_revision<1
     or p_outcome not in ('closed','abandoned','cancelled') or char_length(v_title) not between 3 and 120
     or char_length(coalesce(v_note,''))>2000 or (p_outcome='abandoned' and char_length(coalesce(v_note,''))<10)
     or cardinality(v_ids)<>cardinality(array(select distinct x from unnest(v_ids) x)) then
    raise exception using errcode='22023',message='Revisa los datos para cerrar y abrir el tratamiento.';
  end if;
  -- Mismo orden de locks que el plan histórico; además serializa tratamientos.
  select * into v_current from public.smyl_treatments where tenant_id=v_tenant and id=p_current_id;
  if not found or not public.smyl_can_access_patient(v_tenant,v_current.patient_id,'clinical') then
    raise exception using errcode='42501',message='No tienes acceso a este tratamiento.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_current.patient_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('treatment:'||v_current.patient_id::text,0));
  select * into v_current from public.smyl_treatments where tenant_id=v_tenant and id=p_current_id for update;
  select * into v_plan from public.smyl_clinical_plans where tenant_id=v_tenant and patient_id=v_current.patient_id for update;
  if v_current.status<>'active' or v_current.revision<>p_expected_treatment_revision
     or v_plan.revision<>p_expected_plan_revision or v_plan.treatment_id<>v_current.id
     or v_plan.document->'schema' is distinct from '2'::jsonb then
    raise exception using errcode='40001',message='El tratamiento o el plan cambió; vuelve a revisar antes de continuar.';
  end if;
  if exists(select 1 from unnest(v_ids) x where not exists(
    select 1 from jsonb_array_elements(v_plan.document->'treatments') i where i->>'id'=x)) then
    raise exception using errcode='22023',message='Uno de los procedimientos ya no pertenece al plan actual.';
  end if;
  if exists(select 1 from public.smyl_treatments where tenant_id=v_tenant and id=p_new_id) then
    raise exception using errcode='40001',message='El identificador del tratamiento ya existe.';
  end if;
  update public.smyl_treatments set status=p_outcome,closed_at=v_stamp,closed_by=auth.uid(),closure_note=v_note,
    plan_revision=v_plan.revision,plan_snapshot=v_plan.document,revision=revision+1 where id=v_current.id;
  select coalesce(max(seq),0)+1 into v_seq from public.smyl_treatments where tenant_id=v_tenant and patient_id=v_current.patient_id;
  insert into public.smyl_treatments(id,tenant_id,patient_id,seq,title,reason,status,opened_at,opened_by,predecessor_treatment_id,revision)
  values(p_new_id,v_tenant,v_current.patient_id,v_seq,v_title,v_reason,'active',v_stamp,auth.uid(),v_current.id,1);
  v_new_revision:=v_plan.revision+1;
  for v_item in select value from jsonb_array_elements(v_plan.document->'treatments')
    where value->>'id'=any(v_ids) order by value->>'id' loop
    v_new_item_id:='carry-'||replace(gen_random_uuid()::text,'-','');
    v_new_item:=jsonb_set(v_item,'{id}',to_jsonb(v_new_item_id));
    v_items:=v_items||jsonb_build_array(v_new_item);v_count:=v_count+1;
    insert into public.smyl_treatment_plan_carries(tenant_id,patient_id,from_treatment_id,to_treatment_id,
      from_plan_revision,from_plan_item_id,to_plan_revision,to_plan_item_id,item_snapshot,created_by)
    values(v_tenant,v_current.patient_id,v_current.id,p_new_id,v_plan.revision,v_item->>'id',v_new_revision,v_new_item_id,v_item,auth.uid());
  end loop;
  v_new_doc:=jsonb_build_object('schema',2,'reason',v_reason,'background','','assessment','','treatments',v_items);
  update public.smyl_clinical_plans set document=v_new_doc,revision=v_new_revision,status='draft',updated_by=auth.uid(),
    updated_at=v_stamp,reviewed_by=null,reviewed_at=null,treatment_id=p_new_id where patient_id=v_current.patient_id;
  insert into public.smyl_clinical_versions(patient_id,tenant_id,document,revision,status,updated_by,updated_at,reviewed_by,reviewed_at,treatment_id)
  values(v_current.patient_id,v_tenant,v_new_doc,v_new_revision,'draft',auth.uid(),v_stamp,null,null,p_new_id);
  v_result:=jsonb_build_object('current_treatment_id',v_current.id,'new_treatment_id',p_new_id,
    'plan_revision',v_new_revision,'carried_count',v_count);
  insert into public.smyl_treatment_transition_requests(idempotency_key,tenant_id,patient_id,from_treatment_id,
    to_treatment_id,request_hash,result,created_by)
  values(p_idempotency_key,v_tenant,v_current.patient_id,v_current.id,p_new_id,v_hash,v_result,auth.uid());
  return v_result;
end $$;

revoke all on function public.smyl_bind_clinical_treatment(),public.smyl_bind_active_treatment_plan(),
  public.smyl_bind_proposal_treatment(),public.smyl_bind_proposal_version_treatment(),public.smyl_treatment_v2_append_only_guard(),
  public.smyl_guard_legacy_proposal_decision_event() from public,anon,authenticated;
revoke all on function public.smyl_can_read_proposal_decision_finance(uuid,uuid) from public,anon;
revoke all on function public.smyl_save_proposal_v4(uuid,uuid,uuid,integer,integer,jsonb,boolean,uuid,uuid),
  public.smyl_save_clinical_plan_v3(uuid,uuid,integer,jsonb,boolean,uuid),
  public.smyl_record_proposal_decision_v1(uuid,uuid,integer,text[],text[],text[],text,text,timestamptz),
  public.smyl_post_proposal_decision_charges_v1(uuid,uuid,uuid,uuid,date,uuid),
  public.smyl_transition_treatment_v1(uuid,integer,integer,text,text,uuid,text,text,text[],uuid)
  from public,anon;
grant execute on function public.smyl_can_read_proposal_decision_finance(uuid,uuid) to authenticated;
grant execute on function public.smyl_save_proposal_v4(uuid,uuid,uuid,integer,integer,jsonb,boolean,uuid,uuid),
  public.smyl_save_clinical_plan_v3(uuid,uuid,integer,jsonb,boolean,uuid),
  public.smyl_record_proposal_decision_v1(uuid,uuid,integer,text[],text[],text[],text,text,timestamptz),
  public.smyl_post_proposal_decision_charges_v1(uuid,uuid,uuid,uuid,date,uuid),
  public.smyl_transition_treatment_v1(uuid,integer,integer,text,text,uuid,text,text,text[],uuid)
  to authenticated;

comment on table public.smyl_proposal_decisions is 'Decisión informada por concepto; no sustituye consentimiento clínico ni firma digital.';
comment on table public.smyl_treatment_plan_carries is 'Linaje inmutable de procedimientos seleccionados explícitamente al cambiar de capítulo.';
comment on function public.smyl_transition_treatment_v1(uuid,integer,integer,text,text,uuid,text,text,text[],uuid)
  is 'Cierra el capítulo, congela el plan, abre el siguiente y clona sólo los procedimientos elegidos en una transacción.';

commit;
