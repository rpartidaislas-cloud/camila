-- camila_casos guarda fotos del paciente, hallazgos/propuesta de la simulación y notas del doctor: es información
-- clínica (dato sensible). Antes la podía leer y modificar cualquier integrante de la clínica (camila_es_miembro),
-- incluidos Recepción, Finanzas e Inventario. Ahora:
--   * leer requiere el permiso clinical.read;
--   * crear o modificar requiere clinical.write.
-- El dueño conserva acceso (smyl_has_permission lo deja pasar). Las Edge Functions con service role no cambian.
-- Idempotente.

alter table public.camila_casos enable row level security;

drop policy if exists camila_casos_select_miembros on public.camila_casos;
drop policy if exists camila_casos_insert_miembros on public.camila_casos;
drop policy if exists camila_casos_update_miembros on public.camila_casos;
drop policy if exists camila_casos_select_clinico on public.camila_casos;
drop policy if exists camila_casos_insert_clinico on public.camila_casos;
drop policy if exists camila_casos_update_clinico on public.camila_casos;

create policy camila_casos_select_clinico on public.camila_casos
  for select to authenticated
  using (
    public.camila_es_miembro(public.camila_uuid_seguro(tenant_id))
    and public.smyl_has_permission(public.camila_uuid_seguro(tenant_id), 'clinical.read')
  );

create policy camila_casos_insert_clinico on public.camila_casos
  for insert to authenticated
  with check (
    public.camila_es_miembro(public.camila_uuid_seguro(tenant_id))
    and public.smyl_has_permission(public.camila_uuid_seguro(tenant_id), 'clinical.write')
  );

create policy camila_casos_update_clinico on public.camila_casos
  for update to authenticated
  using (
    public.camila_es_miembro(public.camila_uuid_seguro(tenant_id))
    and public.smyl_has_permission(public.camila_uuid_seguro(tenant_id), 'clinical.write')
  )
  with check (
    public.camila_es_miembro(public.camila_uuid_seguro(tenant_id))
    and public.smyl_has_permission(public.camila_uuid_seguro(tenant_id), 'clinical.write')
  );

-- Los anónimos nunca leen casos (antes lo impedía solo la política; ahora también el permiso de tabla).
revoke all on public.camila_casos from anon;
