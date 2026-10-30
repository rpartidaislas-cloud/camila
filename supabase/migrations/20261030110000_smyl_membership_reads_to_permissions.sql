-- Seguridad (auditoría 2026-10-26, S5): varias tablas se leían con camila_es_miembro(), es decir, "ser miembro
-- del equipo" bastaba para ver el chat con pacientes y las notas/transcripciones de MILA. Un rol sin permisos
-- clínicos (inventario, finanzas, asistente sin clinical.read) los leía igual y el modelo de permisos
-- (smyl_has_permission) quedaba anulado en esas tablas.
--
-- Ahora cada lectura exige el permiso del dominio:
--   * Conversaciones, mensajes, traspasos a humano y vínculos clínicos del chat -> messages.read
--     (actualizar una conversación -> messages.respond).
--   * Sesiones, grabaciones, transcripciones, notas, confirmaciones y llamadas de MILA -> clinical.read.
-- El dueño y los roles que ya tienen esos permisos (propietario, administrador, odontólogo, recepción para
-- mensajes) siguen leyendo igual. Las Edge Functions con service role no se ven afectadas.
--
-- NO se tocan camila_casos ni camila_pacientes: casos de simulación los usa el flujo histórico de staff y
-- pacientes ya tiene alcance por rol (20261015040000). Decisión de producto pendiente para camila_casos.
--
-- Efecto a tener en cuenta: smyl_has_permission exige que la clínica esté activa (camila_tenants.activo) incluso para
-- el dueño, igual que el resto de las tablas smyl_*; camila_es_miembro no lo exigía.
begin;

do $$
declare
  v_mila text;
begin
  -- Chat (SMYL en transición: la fuente canónica de conversaciones es LANA)
  if to_regclass('public.camila_conversaciones') is not null then
    drop policy if exists camila_conv_select_miembros on public.camila_conversaciones;
    create policy camila_conv_select_miembros on public.camila_conversaciones
      for select to authenticated using (public.smyl_has_permission(tenant_id, 'messages.read'));
    drop policy if exists camila_conv_update_miembros on public.camila_conversaciones;
    create policy camila_conv_update_miembros on public.camila_conversaciones
      for update to authenticated
      using (public.smyl_has_permission(tenant_id, 'messages.respond'))
      with check (public.smyl_has_permission(tenant_id, 'messages.respond'));
  end if;

  if to_regclass('public.camila_mensajes') is not null and to_regclass('public.camila_conversaciones') is not null then
    drop policy if exists camila_msg_select_miembros on public.camila_mensajes;
    create policy camila_msg_select_miembros on public.camila_mensajes
      for select to authenticated using (
        exists (
          select 1 from public.camila_conversaciones c
          where c.id = conversacion_id
            and public.smyl_has_permission(c.tenant_id, 'messages.read')
        )
      );
  end if;

  if to_regclass('public.camila_lana_handoffs') is not null then
    drop policy if exists camila_lana_handoffs_read on public.camila_lana_handoffs;
    create policy camila_lana_handoffs_read on public.camila_lana_handoffs
      for select to authenticated using (public.smyl_has_permission(tenant_id, 'messages.read'));
  end if;

  if to_regclass('public.camila_lana_clinical_links') is not null then
    drop policy if exists camila_lana_clinical_links_read on public.camila_lana_clinical_links;
    create policy camila_lana_clinical_links_read on public.camila_lana_clinical_links
      for select to authenticated using (public.smyl_has_permission(tenant_id, 'messages.read'));
  end if;

  -- MILA: tabla -> nombre de la política de lectura (20261015160000_mila_core_and_consumables.sql)
  for v_mila in
    select unnest(array[
      'mila_sessions:mila_sessions_select_miembros',
      'mila_recordings:mila_recordings_select_miembros',
      'mila_transcripts:mila_transcripts_select_miembros',
      'mila_clinical_notes:mila_notes_select_miembros',
      'mila_confirmations:mila_confirmations_select_miembros',
      'mila_tool_calls:mila_tool_calls_select_miembros'
    ])
  loop
    if to_regclass('public.' || split_part(v_mila, ':', 1)) is not null then
      execute format('drop policy if exists %I on public.%I', split_part(v_mila, ':', 2), split_part(v_mila, ':', 1));
      execute format(
        'create policy %I on public.%I for select to authenticated using (public.smyl_has_permission(tenant_id, %L))',
        split_part(v_mila, ':', 2), split_part(v_mila, ':', 1), 'clinical.read'
      );
    end if;
  end loop;
end;
$$;

commit;
