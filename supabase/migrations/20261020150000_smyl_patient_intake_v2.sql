-- Alta de pacientes v2: datos de captación y atención, consentimiento de
-- WhatsApp y detección de duplicados con la misma regla de teléfono que usa la
-- vinculación automática del chat (smyl_normalize_contact_phone).
--
-- Se aplica con el flujo manual .github/workflows/smyl-pacientes-alta-v2-migracion.yml
-- (Actions > Run workflow). Mientras no se aplique, el cliente guarda los datos
-- básicos y avisa (PGRST204). Es idempotente.

begin;

alter table public.camila_pacientes
  add column if not exists origen text not null default ''
    check (origen in ('', 'whatsapp', 'instagram', 'messenger', 'recomendacion', 'google', 'sitio_web', 'visita', 'otro')),
  add column if not exists branch_id uuid,
  add column if not exists professional_id uuid,
  add column if not exists alertas_medicas text[] not null default '{}'
    check (cardinality(alertas_medicas) <= 20),
  add column if not exists consentimiento_whatsapp boolean not null default false,
  add column if not exists consentimiento_whatsapp_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'camila_pacientes_branch_fk') then
    alter table public.camila_pacientes
      add constraint camila_pacientes_branch_fk
      foreign key (tenant_id, branch_id) references public.smyl_branches(tenant_id, id)
      on delete set null (branch_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'camila_pacientes_professional_fk') then
    alter table public.camila_pacientes
      add constraint camila_pacientes_professional_fk
      foreign key (tenant_id, professional_id) references public.smyl_professionals(tenant_id, id)
      on delete set null (professional_id);
  end if;
end;
$$;

comment on column public.camila_pacientes.origen is 'Canal por el que llegó el paciente. Vacío = no registrado.';
comment on column public.camila_pacientes.alertas_medicas is 'Etiquetas breves de alerta (alergias, anticoagulantes…). El antecedente completo vive en el expediente clínico.';
comment on column public.camila_pacientes.consentimiento_whatsapp is 'El paciente aceptó recibir recordatorios y mensajes de la clínica por WhatsApp.';

-- Sella la fecha del consentimiento cuando se otorga y la borra cuando se retira.
create or replace function public.smyl_patient_consent_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.consentimiento_whatsapp and (tg_op = 'INSERT' or not coalesce(old.consentimiento_whatsapp, false)) then
    new.consentimiento_whatsapp_at := now();
  elsif not new.consentimiento_whatsapp then
    new.consentimiento_whatsapp_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists smyl_patient_consent_stamp on public.camila_pacientes;
create trigger smyl_patient_consent_stamp
  before insert or update of consentimiento_whatsapp on public.camila_pacientes
  for each row execute function public.smyl_patient_consent_stamp();

-- Posibles duplicados por correo o teléfono normalizado, limitados a lo que el
-- actor puede ver (permiso patients.read y alcance de datos de su rol).
create or replace function public.smyl_patient_duplicates(
  p_tenant_id uuid,
  p_email text default '',
  p_telefono text default '',
  p_exclude_id uuid default null
)
returns table (id uuid, name text, email text, phone text, match text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with identity as (
    select
      lower(trim(coalesce(p_email, ''))) as email_key,
      public.smyl_normalize_contact_phone(p_telefono) as phone_key
  )
  select
    p.id,
    trim(concat_ws(' ', p.nombre, p.apellido)) as name,
    p.email,
    p.telefono as phone,
    case
      when i.phone_key <> '' and public.smyl_normalize_contact_phone(p.telefono) = i.phone_key then 'telefono'
      else 'email'
    end as match
  from public.camila_pacientes p
  cross join identity i
  where p_tenant_id is not null
    and p_tenant_id = public.smyl_current_tenant()
    and public.smyl_has_permission(p_tenant_id, 'patients.read')
    and p.tenant_id = p_tenant_id
    and (p_exclude_id is null or p.id <> p_exclude_id)
    and public.smyl_can_access_patient(p_tenant_id, p.id, 'patients')
    and (
      (i.email_key <> '' and lower(trim(coalesce(p.email, ''))) = i.email_key)
      or (i.phone_key <> '' and public.smyl_normalize_contact_phone(p.telefono) = i.phone_key)
    )
  order by p.updated_at desc, p.id
  limit 5
$$;

revoke all on function public.smyl_patient_duplicates(uuid, text, text, uuid) from public, anon;
grant execute on function public.smyl_patient_duplicates(uuid, text, text, uuid) to authenticated;

comment on function public.smyl_patient_duplicates(uuid, text, text, uuid) is
  'Candidatos a duplicado del alta de pacientes: mismo correo o mismo teléfono normalizado, dentro del tenant de la sesión y del alcance del rol.';

commit;
