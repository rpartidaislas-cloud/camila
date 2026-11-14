-- Cotizaciones · seguimiento: registro de cada seguimiento que el equipo le hace a un paciente sobre una cotización presentada
-- (WhatsApp, llamada, en persona…). Sirve para sugerir el siguiente seguimiento (3, 7 y 15 días) sin repetir avisos aunque lo
-- haga otra persona o desde otro dispositivo. No guarda el mensaje: sólo que se dio seguimiento.
-- Escritura sólo por función (permiso proposal.followup, cotización aprobada y versión vigente); lectura con proposal.read.
-- Idempotente.

create table if not exists public.smyl_proposal_followups (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  proposal_id uuid not null references public.smyl_proposals(id) on delete cascade,
  proposal_revision integer not null check (proposal_revision > 0),
  channel text not null check (channel in ('whatsapp','phone','in_person','email','other')),
  followed_by uuid references auth.users(id) on delete set null,
  followed_at timestamptz not null default now()
);
create index if not exists smyl_proposal_followups_proposal_idx
  on public.smyl_proposal_followups (tenant_id, proposal_id, proposal_revision, followed_at desc);

alter table public.smyl_proposal_followups enable row level security;
revoke all on public.smyl_proposal_followups from public, anon, authenticated;
grant select on public.smyl_proposal_followups to authenticated;

drop policy if exists smyl_proposal_followups_read on public.smyl_proposal_followups;
create policy smyl_proposal_followups_read on public.smyl_proposal_followups for select to authenticated
  using (tenant_id in (select public.smyl_tenants_with_permission('proposal.read')));

create or replace function public.smyl_log_proposal_followup(
  p_proposal_id uuid,
  p_proposal_revision integer,
  p_channel text
)
returns timestamptz
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_at timestamptz := now();
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'proposal.followup') then
    raise exception using errcode = '42501', message = 'No tienes permiso para registrar seguimientos.';
  end if;
  if p_channel is null or p_channel not in ('whatsapp','phone','in_person','email','other') then
    raise exception using errcode = '22023', message = 'Canal no válido.';
  end if;
  if not exists (
    select 1 from public.smyl_proposals p
    where p.tenant_id = v_tenant and p.id = p_proposal_id and p.status = 'approved' and p.revision = p_proposal_revision
  ) then
    raise exception using errcode = '40001', message = 'Sólo se da seguimiento a la versión aprobada vigente.';
  end if;
  if (select count(*) from public.smyl_proposal_followups f where f.followed_by = auth.uid() and f.followed_at > now() - interval '1 hour') >= 100 then
    return v_at;
  end if;
  insert into public.smyl_proposal_followups (tenant_id, proposal_id, proposal_revision, channel, followed_by, followed_at)
  values (v_tenant, p_proposal_id, p_proposal_revision, p_channel, auth.uid(), v_at);
  return v_at;
end;
$function$;

revoke all on function public.smyl_log_proposal_followup(uuid, integer, text) from public, anon;
grant execute on function public.smyl_log_proposal_followup(uuid, integer, text) to authenticated;
