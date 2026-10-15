-- SMYL · Etapa 7: cierre profesional y puerta operativa de lanzamiento.
-- El diagnóstico devuelve únicamente configuración y conteos; nunca PHI.
begin;

create table public.smyl_operational_readiness (
  tenant_id uuid primary key references public.camila_tenants(id) on delete cascade,
  support_contact_email text not null default '' check (char_length(support_contact_email) <= 254),
  privacy_reviewed_at timestamptz,
  team_training_completed_at timestamptz,
  recovery_drill_completed_at timestamptz,
  launch_approved_at timestamptz,
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.smyl_operational_readiness enable row level security;
create policy smyl_operational_readiness_read on public.smyl_operational_readiness
  for select to authenticated
  using (public.smyl_has_permission(tenant_id,'settings.manage'));

grant select on public.smyl_operational_readiness to authenticated;
revoke insert,update,delete on public.smyl_operational_readiness from anon,authenticated;
revoke all on public.smyl_operational_readiness from anon;

create trigger smyl_operational_readiness_touch before update on public.smyl_operational_readiness
  for each row execute function public.smyl_touch_updated_at();
create trigger smyl_operational_readiness_audit after insert or update or delete on public.smyl_operational_readiness
  for each row execute function public.smyl_audit_row();

create or replace function public.smyl_operational_readiness_report()
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_tenant uuid:=public.smyl_current_tenant();
  v_settings public.smyl_operational_readiness%rowtype;
  v_automated jsonb;
  v_manual jsonb;
  v_automatic_ready boolean;
  v_manual_ready boolean;
  v_stale_cash integer;
  v_failed_reminders integer;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'settings.manage') then
    raise exception using errcode='42501',message='Solo administración puede revisar la preparación operativa.';
  end if;

  select * into v_settings from public.smyl_operational_readiness where tenant_id=v_tenant;
  select count(*) into v_stale_cash from public.smyl_cash_sessions
    where tenant_id=v_tenant and status='open' and opened_at<now()-interval '18 hours';
  select count(*) into v_failed_reminders from public.smyl_appointment_reminders
    where tenant_id=v_tenant and status='failed' and updated_at>now()-interval '7 days';

  v_automated:=jsonb_build_array(
    jsonb_build_object('id','default_branch','label','Sucursal principal activa','passed',exists(select 1 from public.smyl_branches where tenant_id=v_tenant and active and is_default),'route','clinica'),
    jsonb_build_object('id','branch_contact','label','Datos de contacto de la clínica','passed',exists(select 1 from public.smyl_branches where tenant_id=v_tenant and active and is_default and btrim(phone)<>'' and btrim(address_line)<>'' and btrim(city)<>''),'route','clinica'),
    jsonb_build_object('id','room','label','Consultorio o sillón configurado','passed',exists(select 1 from public.smyl_rooms where tenant_id=v_tenant and active),'route','clinica'),
    jsonb_build_object('id','clinic_hours','label','Horario de atención configurado','passed',exists(select 1 from public.smyl_clinic_hours where tenant_id=v_tenant and active),'route','clinica'),
    jsonb_build_object('id','licensed_professional','label','Profesional activo con cédula registrada','passed',exists(select 1 from public.smyl_professionals where tenant_id=v_tenant and active and btrim(license_number)<>''),'route','clinica'),
    jsonb_build_object('id','service','label','Servicio dental publicable','passed',exists(select 1 from public.smyl_services where tenant_id=v_tenant and active),'route','agenda'),
    jsonb_build_object('id','availability','label','Disponibilidad profesional','passed',exists(select 1 from public.smyl_professional_hours where tenant_id=v_tenant and active),'route','agenda'),
    jsonb_build_object('id','team_roles','label','Todo el equipo activo tiene un rol','passed',not exists(select 1 from public.camila_usuarios u where u.tenant_id=v_tenant and u.activo and not exists(select 1 from public.smyl_member_roles mr where mr.tenant_id=v_tenant and mr.user_id=u.id)),'route','clinica'),
    jsonb_build_object('id','cash_current','label','Sin cajas abiertas por más de 18 horas','passed',v_stale_cash=0,'detail',v_stale_cash,'route','caja'),
    jsonb_build_object('id','reminders_healthy','label','Sin recordatorios fallidos en 7 días','passed',v_failed_reminders=0,'detail',v_failed_reminders,'route','agenda')
  );

  v_manual:=jsonb_build_array(
    jsonb_build_object('id','support_contact','label','Contacto de soporte e incidentes','passed',coalesce(v_settings.support_contact_email,'')<>''),
    jsonb_build_object('id','privacy','label','Aviso de privacidad y conservación revisados','passed',v_settings.privacy_reviewed_at is not null),
    jsonb_build_object('id','team_training','label','Equipo capacitado en roles y emergencias','passed',v_settings.team_training_completed_at is not null),
    jsonb_build_object('id','recovery_drill','label','Prueba de recuperación documentada','passed',v_settings.recovery_drill_completed_at is not null),
    jsonb_build_object('id','launch_approval','label','Aprobación final del propietario','passed',v_settings.launch_approved_at is not null)
  );
  select coalesce(bool_and((x->>'passed')::boolean),false) into v_automatic_ready from jsonb_array_elements(v_automated) x;
  select coalesce(bool_and((x->>'passed')::boolean),false) into v_manual_ready from jsonb_array_elements(v_manual) x;

  return jsonb_build_object(
    'generated_at',now(),
    'contains_phi',false,
    'status',case when v_automatic_ready and v_manual_ready then 'ready' when v_automatic_ready then 'review' else 'blocked' end,
    'automated',v_automated,
    'manual',v_manual,
    'support_contact_email',coalesce(v_settings.support_contact_email,''),
    'approved_at',v_settings.launch_approved_at,
    'last_updated_at',v_settings.updated_at
  );
end;
$$;

create or replace function public.smyl_set_operational_check(p_check text,p_completed boolean,p_value text default null)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_tenant uuid:=public.smyl_current_tenant();
  v_report jsonb;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'settings.manage') then
    raise exception using errcode='42501',message='Solo administración puede confirmar controles operativos.';
  end if;
  if p_check not in ('support_contact','privacy','team_training','recovery_drill','launch_approval') then
    raise exception using errcode='22023',message='Control operativo no reconocido.';
  end if;
  if p_check='support_contact' and p_completed and (p_value is null or p_value !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    raise exception using errcode='22023',message='Captura un correo válido para soporte e incidentes.';
  end if;

  insert into public.smyl_operational_readiness(tenant_id,updated_by)
  values(v_tenant,auth.uid()) on conflict(tenant_id) do nothing;

  if p_check='support_contact' then
    update public.smyl_operational_readiness set support_contact_email=case when p_completed then btrim(p_value) else '' end,updated_by=auth.uid() where tenant_id=v_tenant;
  elsif p_check='privacy' then
    update public.smyl_operational_readiness set privacy_reviewed_at=case when p_completed then now() else null end,launch_approved_at=null,updated_by=auth.uid() where tenant_id=v_tenant;
  elsif p_check='team_training' then
    update public.smyl_operational_readiness set team_training_completed_at=case when p_completed then now() else null end,launch_approved_at=null,updated_by=auth.uid() where tenant_id=v_tenant;
  elsif p_check='recovery_drill' then
    update public.smyl_operational_readiness set recovery_drill_completed_at=case when p_completed then now() else null end,launch_approved_at=null,updated_by=auth.uid() where tenant_id=v_tenant;
  else
    if p_completed then
      v_report:=public.smyl_operational_readiness_report();
      if exists(select 1 from jsonb_array_elements(v_report->'automated') x where not (x->>'passed')::boolean)
         or exists(select 1 from jsonb_array_elements(v_report->'manual') x where x->>'id'<>'launch_approval' and not (x->>'passed')::boolean) then
        raise exception using errcode='23514',message='Completa los controles automáticos y manuales antes de aprobar el lanzamiento.';
      end if;
    end if;
    update public.smyl_operational_readiness set launch_approved_at=case when p_completed then now() else null end,updated_by=auth.uid() where tenant_id=v_tenant;
  end if;
  return public.smyl_operational_readiness_report();
end;
$$;

revoke all on function public.smyl_operational_readiness_report() from public,anon;
revoke all on function public.smyl_set_operational_check(text,boolean,text) from public,anon;
grant execute on function public.smyl_operational_readiness_report() to authenticated;
grant execute on function public.smyl_set_operational_check(text,boolean,text) to authenticated;

comment on table public.smyl_operational_readiness is 'Confirmaciones auditadas para la puerta operativa de SMYL; no almacena datos clínicos.';
comment on function public.smyl_operational_readiness_report() is 'Diagnóstico tenant-scoped de preparación operativa, sin PHI.';
commit;
