-- Esquema mínimo adicional para ejecutar 20261128130000 en PGlite.
create schema if not exists extensions;
create or replace function extensions.digest(p_value bytea,p_algorithm text) returns bytea
language sql immutable as $$
  select decode(md5(encode(p_value,'hex'))||md5(encode(p_value,'hex')||p_algorithm),'hex')
$$;
drop table if exists public.smyl_proposal_events cascade;
drop table if exists public.smyl_proposals cascade;
drop table if exists public.smyl_clinical_versions cascade;
drop table if exists public.smyl_finance_charges cascade;

alter table public.smyl_branches add column if not exists active boolean not null default true;

create table public.smyl_treatments(
  id uuid primary key,tenant_id uuid not null references public.camila_tenants(id),patient_id uuid not null,
  seq integer not null,title text not null,reason text not null default '',status text not null default 'active',
  asa text,caries_risk text,recall_months smallint,recall_whatsapp boolean not null default true,
  opened_at timestamptz not null default now(),opened_by uuid,closed_at timestamptz,closed_by uuid,
  closure_note text,plan_revision integer,plan_snapshot jsonb,
  foreign key(tenant_id,patient_id) references public.camila_pacientes(tenant_id,id),
  unique(tenant_id,patient_id,seq)
);
create unique index smyl_treatments_one_active_idx on public.smyl_treatments(tenant_id,patient_id) where status='active';

create table public.smyl_clinical_plans(
  patient_id uuid primary key,tenant_id uuid not null,document jsonb not null,revision integer not null,
  status text not null,updated_by uuid not null references auth.users(id),updated_at timestamptz not null,
  reviewed_by uuid,revised_at timestamptz,reviewed_at timestamptz,
  foreign key(tenant_id,patient_id) references public.camila_pacientes(tenant_id,id)
);
create table public.smyl_clinical_versions(
  patient_id uuid not null,tenant_id uuid not null,revision integer not null,document jsonb not null,status text not null,
  updated_by uuid not null references auth.users(id),updated_at timestamptz not null,reviewed_by uuid,reviewed_at timestamptz,
  primary key(patient_id,revision),foreign key(tenant_id,patient_id) references public.camila_pacientes(tenant_id,id)
);

create table public.smyl_proposals(
  id uuid primary key,tenant_id uuid not null references public.camila_tenants(id),patient_id uuid not null,
  plan_revision integer not null,revision integer not null,status text not null,document jsonb not null,total_cents bigint not null,
  patient_name text not null,clinic_name text not null,professional_name text not null,updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null,approved_by uuid,approved_at timestamptz,branch_id uuid,
  foreign key(tenant_id,patient_id) references public.camila_pacientes(tenant_id,id)
);
create table public.smyl_proposal_versions(
  proposal_id uuid not null references public.smyl_proposals(id),revision integer not null,tenant_id uuid not null,
  snapshot jsonb not null,primary key(proposal_id,revision)
);
create table public.smyl_proposal_events(
  id uuid primary key,tenant_id uuid not null,proposal_id uuid not null references public.smyl_proposals(id),
  proposal_revision integer not null,event_type text not null,channel text not null,note text not null default '',
  occurred_at timestamptz not null,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
  unique(tenant_id,id)
);

create table public.smyl_proposal_charge_batches(
  id uuid primary key,tenant_id uuid not null references public.camila_tenants(id),proposal_id uuid not null references public.smyl_proposals(id),
  proposal_revision integer not null,patient_id uuid not null,branch_id uuid not null,idempotency_key uuid not null,
  charge_count integer not null,total_amount numeric(12,2) not null,source_snapshot jsonb not null,
  created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
  unique(tenant_id,id),unique(tenant_id,idempotency_key),unique(tenant_id,proposal_id,proposal_revision),
  foreign key(tenant_id,patient_id) references public.camila_pacientes(tenant_id,id),
  foreign key(tenant_id,branch_id) references public.smyl_branches(tenant_id,id)
);
create table public.smyl_finance_charges(
  id uuid primary key,tenant_id uuid not null,patient_id uuid not null,branch_id uuid,service_id uuid,proposal_id uuid,
  idempotency_key uuid not null,concept text not null,quantity numeric(10,3) not null,unit_price numeric(12,2) not null,
  discount_amount numeric(12,2) not null,tax_amount numeric(12,2) not null,total_amount numeric(12,2) not null,due_on date,
  status text not null default 'open',created_by uuid not null references auth.users(id),created_at timestamptz default now(),
  proposal_revision integer,proposal_item_id text,proposal_batch_id uuid,service_revision integer,service_snapshot jsonb,
  simulation_case_id uuid,simulation_credit_charge_id uuid,
  unique(tenant_id,id),unique(tenant_id,idempotency_key)
);
create unique index smyl_finance_charges_proposal_line_idx on public.smyl_finance_charges(tenant_id,proposal_id,proposal_revision,proposal_item_id)
  where proposal_id is not null and proposal_revision is not null and proposal_item_id is not null;
grant select on public.smyl_finance_charges,public.smyl_treatments,public.smyl_clinical_plans,
  public.smyl_proposals,public.smyl_proposal_versions to authenticated;

create or replace function public.smyl_is_veneer_service(p_tenant uuid,p_item jsonb) returns boolean
language sql stable as $$ select lower(coalesce(p_item->>'label','')) like '%carilla%' $$;

create or replace function public.smyl_save_proposal_v3(
  p_id uuid,p_tenant_id uuid,p_patient_id uuid,p_plan_revision integer,p_expected_revision integer,
  p_document jsonb,p_approve boolean default false,p_branch_id uuid default null
) returns public.smyl_proposals language plpgsql security definer set search_path=pg_catalog,public as $$
declare v public.smyl_proposals;v_total bigint;
begin
  select coalesce(sum((i->>'quantity')::bigint*(i->>'unit_cents')::bigint),0) into v_total from jsonb_array_elements(p_document->'items') i;
  insert into public.smyl_proposals(id,tenant_id,patient_id,plan_revision,revision,status,document,total_cents,patient_name,
    clinic_name,professional_name,updated_by,updated_at,approved_by,approved_at,branch_id)
  values(p_id,p_tenant_id,p_patient_id,p_plan_revision,p_expected_revision+1,case when p_approve then 'approved' else 'draft' end,
    p_document,v_total,'Paciente','Clínica','Doctora',auth.uid(),clock_timestamp(),case when p_approve then auth.uid() end,
    case when p_approve then clock_timestamp() end,p_branch_id)
  on conflict(id) do update set revision=excluded.revision,status=excluded.status,document=excluded.document,total_cents=excluded.total_cents,
    updated_at=excluded.updated_at,approved_by=excluded.approved_by,approved_at=excluded.approved_at,branch_id=excluded.branch_id returning * into v;
  insert into public.smyl_proposal_versions(proposal_id,revision,tenant_id,snapshot) values(v.id,v.revision,v.tenant_id,to_jsonb(v));
  return v;
end $$;

-- Legado A→B previo a la migración: la misma propuesta conserva dos versiones,
-- cada una nacida de un plan y capítulo distintos. El backfill debe respetar el
-- plan_revision congelado en cada snapshot, no copiar el capítulo de la fila
-- corriente a todo el historial.
insert into auth.users(id) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') on conflict do nothing;
insert into public.camila_tenants(id,nombre) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Clínica A') on conflict do nothing;
insert into public.camila_usuarios(id,tenant_id,rol,nombre,activo) values(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','dueño','Propietaria',true) on conflict do nothing;
insert into public.camila_pacientes(id,tenant_id,nombre) values(
  '12121212-1212-4121-8121-121212121212','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Paciente histórico') on conflict do nothing;
insert into public.smyl_treatments(id,tenant_id,patient_id,seq,title,reason,status,opened_at,opened_by,closed_at,closed_by)
values
  ('a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','12121212-1212-4121-8121-121212121212',1,
   'Capítulo A','Motivo A','closed','2026-01-01T00:00:00Z','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   '2026-02-01T00:00:00Z','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','12121212-1212-4121-8121-121212121212',2,
   'Capítulo B','Motivo B','active','2026-02-01T00:00:00Z','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,null);
insert into public.smyl_clinical_plans(patient_id,tenant_id,document,revision,status,updated_by,updated_at,reviewed_by,reviewed_at)
values('12121212-1212-4121-8121-121212121212','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '{"schema":2,"reason":"Motivo B","background":"","assessment":"","treatments":[]}'::jsonb,2,'reviewed',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-02-15T00:00:00Z','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-02-15T00:00:00Z');
insert into public.smyl_clinical_versions(patient_id,tenant_id,revision,document,status,updated_by,updated_at,reviewed_by,reviewed_at)
values
  ('12121212-1212-4121-8121-121212121212','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,
   '{"schema":2,"reason":"Motivo A","background":"","assessment":"","treatments":[]}'::jsonb,'reviewed',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-01-15T00:00:00Z','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-01-15T00:00:00Z'),
  ('12121212-1212-4121-8121-121212121212','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',2,
   '{"schema":2,"reason":"Motivo B","background":"","assessment":"","treatments":[]}'::jsonb,'reviewed',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-02-15T00:00:00Z','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-02-15T00:00:00Z');
insert into public.smyl_proposals(id,tenant_id,patient_id,plan_revision,revision,status,document,total_cents,patient_name,
  clinic_name,professional_name,updated_by,updated_at,approved_by,approved_at)
values('c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '12121212-1212-4121-8121-121212121212',2,2,'approved',
  '{"schema":2,"title":"Capítulo B","introduction":"","terms":"Pago","valid_until":"2099-12-31","photos":null,"items":[]}'::jsonb,
  0,'Paciente histórico','Clínica A','Doctora','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-02-15T00:00:00Z',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-02-15T00:00:00Z');
insert into public.smyl_proposal_versions(proposal_id,revision,tenant_id,snapshot)
values
  ('c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3',1,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   '{"id":"c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3","patient_id":"12121212-1212-4121-8121-121212121212","plan_revision":1,"revision":1}'::jsonb),
  ('c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3',2,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   '{"id":"c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3","patient_id":"12121212-1212-4121-8121-121212121212","plan_revision":2,"revision":2}'::jsonb);
