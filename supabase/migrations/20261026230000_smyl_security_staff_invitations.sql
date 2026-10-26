-- Seguridad P0: tenant_id_invitado es metadato controlado por el cliente y no
-- autoriza por sí solo a incorporarse a una clínica. La única autorización es
-- una fila pendiente en smyl_staff_invitations cuyo id, tenant y correo coinciden.

begin;

revoke all on public.smyl_staff_invitations from public, anon;

create or replace function public.camila_crear_tenant_en_signup()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  tenant_invitado uuid := case
    when meta->>'tenant_id_invitado' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then (meta->>'tenant_id_invitado')::uuid
  end;
  invitation_id uuid := case
    when meta->>'smyl_invitation_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then (meta->>'smyl_invitation_id')::uuid
  end;
  invitation public.smyl_staff_invitations;
  professional_id uuid;
  odontologo_role_id uuid;
begin
  if tenant_invitado is not null and invitation_id is not null and new.email is not null then
    select * into invitation
    from public.smyl_staff_invitations i
    where i.id = invitation_id
      and i.tenant_id = tenant_invitado
      and i.status = 'pending'
      and i.expires_at > clock_timestamp()
      and lower(i.email) = lower(new.email)
    for update;

    if found then
      insert into public.camila_usuarios (id, tenant_id, rol, nombre, email, activo)
      values (
        new.id, tenant_invitado, 'staff',
        coalesce(invitation.display_name, meta->>'nombre', new.email),
        new.email, true
      )
      on conflict (id) do nothing;

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

      return new;
    end if;

    raise exception using
      errcode = '28000',
      message = 'La invitación de SMYL no es válida o ya venció.';
  end if;

  -- Un tenant_id aislado o inválido se ignora. Nunca produce una membresía.
  insert into public.camila_tenants (
    id, nombre, email, plan, limite_diagnosticos,
    diagnosticos_usados, activo, vence_en, config
  ) values (
    new.id,
    coalesce(meta->>'nombre', new.email),
    new.email,
    coalesce(meta->>'plan', 'profesional'),
    coalesce((meta->>'limite_diagnosticos')::integer, 40),
    0, true, clock_timestamp() + interval '1 month', '{}'::jsonb
  ) on conflict (id) do nothing;

  insert into public.camila_usuarios (id, tenant_id, rol, nombre, email, activo)
  values (new.id, new.id, 'dueño', coalesce(meta->>'nombre', new.email), new.email, true)
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function public.camila_crear_tenant_en_signup() is
  'Crea un propietario o acepta una invitación SMYL verificada; nunca confía únicamente en metadatos del cliente.';

commit;
