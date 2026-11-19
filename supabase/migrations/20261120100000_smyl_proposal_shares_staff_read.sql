-- Aviso en la lista de cotizaciones: el equipo con permiso `proposal.read` puede ver SI un enlace compartido se abrió, le interesa
-- al paciente o fue aceptado. Solo esas columnas: nunca la copia congelada (snapshot), el resumen de historial ni el hash del token.
begin;

grant select (id, tenant_id, proposal_id, proposal_revision, status, expires_at, open_count, first_opened_at, last_opened_at,
              interested_at, accepted_at, created_at)
  on public.smyl_proposal_shares to authenticated;

drop policy if exists smyl_proposal_shares_staff_read on public.smyl_proposal_shares;
create policy smyl_proposal_shares_staff_read on public.smyl_proposal_shares for select to authenticated
  using (tenant_id in (select public.smyl_tenants_with_permission('proposal.read')));

commit;
