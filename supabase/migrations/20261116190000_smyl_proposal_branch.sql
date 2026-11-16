-- Cotizaciones por sucursal: la propuesta guarda en qué sede se atenderá (columna aparte; el documento v2 no cambia).
--   * smyl_save_proposal_v3 = smyl_save_proposal_v2 + sucursal, en la misma transacción. Con más de una sede activa,
--     aprobar exige elegir sucursal. Sin sucursal (clínicas de una sola sede) todo funciona como antes.
--   * Los precios de cada concepto se calculan en el navegador con el precio de la sede y quedan congelados en la propuesta.
-- Idempotente.
begin;

alter table public.smyl_proposals add column if not exists branch_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'smyl_proposals_branch_fk') then
    alter table public.smyl_proposals
      add constraint smyl_proposals_branch_fk foreign key (tenant_id, branch_id)
      references public.smyl_branches (tenant_id, id);
  end if;
end;
$$;

create or replace function public.smyl_save_proposal_v3(
  p_id uuid, p_tenant_id uuid, p_patient_id uuid, p_plan_revision integer,
  p_expected_revision integer, p_document jsonb, p_approve boolean default false,
  p_branch_id uuid default null
) returns public.smyl_proposals
language plpgsql security definer set search_path = '' as $$
declare
  result public.smyl_proposals;
  v_active integer;
begin
  if auth.uid() is null or not public.smyl_has_permission(p_tenant_id, 'proposal.write') then
    raise exception 'Proposal access denied' using errcode = '42501';
  end if;
  select count(*) into v_active from public.smyl_branches where tenant_id = p_tenant_id and active;
  if p_branch_id is not null and not exists (
    select 1 from public.smyl_branches where tenant_id = p_tenant_id and id = p_branch_id and active
  ) then
    raise exception 'Branch not available' using errcode = '22023';
  end if;
  if p_approve and v_active > 1 and p_branch_id is null then
    raise exception 'Choose a branch' using errcode = '22023';
  end if;
  result := public.smyl_save_proposal_v2(p_id, p_tenant_id, p_patient_id, p_plan_revision, p_expected_revision, p_document, p_approve);
  update public.smyl_proposals set branch_id = p_branch_id
   where id = result.id and tenant_id = p_tenant_id
   returning * into result;
  return result;
end;
$$;

revoke all on function public.smyl_save_proposal_v3(uuid, uuid, uuid, integer, integer, jsonb, boolean, uuid) from public, anon;
grant execute on function public.smyl_save_proposal_v3(uuid, uuid, uuid, integer, integer, jsonb, boolean, uuid) to authenticated;

commit;
