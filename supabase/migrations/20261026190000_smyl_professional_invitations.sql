-- SMYL · Alta de profesionales exclusivamente por invitación.
-- La cuenta de acceso es la identidad; el perfil profesional se crea cuando
-- la persona acepta el correo de Supabase. Hasta entonces sólo existe una
-- invitación pendiente y no puede recibir citas.

begin;

create table if not exists public.smyl_staff_invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  email text not null check (char_length(btrim(email)) between 5 and 254),
  display_name text not null check (char_length(btrim(display_name)) between 2 and 120),
  member_kind text not null default 'staff' check (member_kind in ('staff', 'professional')),
  specialty text not null default '' check (char_length(specialty) <= 120),
  license_number text not null default '' check (char_length(license_number) <= 80),
  branch_id uuid,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  invited_by uuid references auth.users(id) on delete set null,
  invited_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '7 days'),
  accepted_user_id uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (tenant_id, id),
  foreign key (tenant_id, branch_id)
    references public.smyl_branches(tenant_id, id) on delete restrict
);

create unique index if not exists smyl_staff_invitations_pending_email_idx
  on public.smyl_staff_invitations (tenant_id, lower(email))
  where status = 'pending';

create index if not exists smyl_staff_invitations_status_idx
  on public.smyl_staff_invitations (tenant_id, status, invited_at desc);

alter table public.smyl_staff_invitations enable row level security;

create policy smyl_staff_invitations_read
  on public.smyl_staff_invitations for select to authenticated
  using (public.smyl_has_permission(tenant_id, 'team.read'));

create policy smyl_staff_invitations_manage
  on public.smyl_staff_invitations for all to authenticated
  using (public.smyl_has_permission(tenant_id, 'team.manage'))
  with check (
    tenant_id = public.smyl_current_tenant()
    and public.smyl_has_permission(tenant_id, 'team.manage')
  );

revoke all on public.smyl_staff_invitations from public, anon;
grant select, insert, update on public.smyl_staff_invitations to authenticated;

-- Conserva el alta normal de propietarios y las invitaciones históricas de
-- staff. Cuando existe una invitación profesional válida, crea y vincula el
-- perfil, la primera sede y el rol de odontólogo en la misma transacción.
create or replace function public.camila_crear_tenant_en_signup()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  tenant_invitado uuid := nullif(meta->>'tenant_id_invitado', '')::uuid;
  invitation_id uuid := nullif(meta->>'smyl_invitation_id', '')::uuid;
  invitation public.smyl_staff_invitations;
  professional_id uuid;
  odontologo_role_id uuid;
begin
  if tenant_invitado is not null then
    if invitation_id is not null then
      select * into invitation
      from public.smyl_staff_invitations i
      where i.id = invitation_id
        and i.tenant_id = tenant_invitado
        and i.status = 'pending'
        and i.expires_at > clock_timestamp()
        and lower(i.email) = lower(new.email)
      for update;

      if not found then
        raise exception using
          errcode = '28000',
          message = 'La invitación de SMYL no es válida o ya venció.';
      end if;
    end if;

    insert into public.camila_usuarios (id, tenant_id, rol, nombre, email, activo)
    values (
      new.id,
      tenant_invitado,
      'staff',
      coalesce(invitation.display_name, meta->>'nombre', new.email),
      new.email,
      true
    )
    on conflict (id) do nothing;

    if invitation.id is not null then
      if invitation.member_kind = 'professional' then
        select p.id into professional_id
        from public.smyl_professionals p
        where p.tenant_id = tenant_invitado and p.user_id = new.id and p.active
        limit 1;

        if professional_id is null then
          insert into public.smyl_professionals (
            tenant_id, user_id, display_name, specialty, license_number, created_by
          ) values (
            tenant_invitado, new.id, invitation.display_name,
            invitation.specialty, invitation.license_number, invitation.invited_by
          ) returning id into professional_id;
        end if;

        if invitation.branch_id is not null then
          insert into public.smyl_professional_branches (tenant_id, professional_id, branch_id)
          values (tenant_invitado, professional_id, invitation.branch_id)
          on conflict do nothing;

          insert into public.smyl_member_branches (tenant_id, user_id, branch_id, is_primary)
          values (tenant_invitado, new.id, invitation.branch_id, true)
          on conflict do nothing;
        end if;

        select r.id into odontologo_role_id
        from public.smyl_roles r
        where r.tenant_id = tenant_invitado and r.code = 'odontologo' and r.active
        limit 1;

        if odontologo_role_id is not null then
          insert into public.smyl_member_roles (tenant_id, user_id, role_id)
          values (tenant_invitado, new.id, odontologo_role_id)
          on conflict do nothing;
        end if;
      end if;

      update public.smyl_staff_invitations
      set status = 'accepted', accepted_user_id = new.id,
          accepted_at = clock_timestamp(), updated_at = clock_timestamp()
      where id = invitation.id and tenant_id = tenant_invitado;
    end if;

    return new;
  end if;

  insert into public.camila_tenants (
    id, nombre, email, plan, limite_diagnosticos,
    diagnosticos_usados, activo, vence_en, config
  ) values (
    new.id,
    coalesce(meta->>'nombre', new.email),
    new.email,
    coalesce(meta->>'plan', 'profesional'),
    coalesce((meta->>'limite_diagnosticos')::integer, 40),
    0,
    true,
    clock_timestamp() + interval '1 month',
    '{}'::jsonb
  ) on conflict (id) do nothing;

  insert into public.camila_usuarios (id, tenant_id, rol, nombre, email, activo)
  values (new.id, new.id, 'dueño', coalesce(meta->>'nombre', new.email), new.email, true)
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on table public.smyl_staff_invitations is
  'Invitaciones trazables de SMYL. Un profesional sólo se crea al aceptar una invitación válida.';

commit;
