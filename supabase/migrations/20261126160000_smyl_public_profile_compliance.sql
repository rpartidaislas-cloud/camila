-- Perfiles públicos y publicidad de servicios de salud (Ley General de Salud arts. 300-312 y su Reglamento en
-- Materia de Publicidad):
--   * Campo para el número de aviso o permiso de publicidad ante COFEPRIS que el profesional o la clínica tramitó.
--   * El directorio muestra también la institución que expidió el título y la cédula de especialidad.
--   * La base rechaza en titular y biografía frases prohibidas o engañosas (garantías, "sin dolor", superlativos,
--     "100 %", "milagro", "cura", resultados inmediatos o permanentes). Solo aplica a textos nuevos o editados.
--   * La vista pública del directorio queda en solo lectura para anon/authenticated.
-- Idempotente.

alter table public.smyl_professional_profiles
  add column if not exists advertising_notice text not null default '' check (char_length(advertising_notice) <= 80);
comment on column public.smyl_professional_profiles.advertising_notice is 'Número de aviso o permiso de publicidad ante COFEPRIS (si aplica).';

create or replace function public.smyl_profile_claims_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_text text := lower(coalesce(new.headline, '') || ' ' || coalesce(new.bio, ''));
begin
  if tg_op = 'UPDATE' and new.headline is not distinct from old.headline and new.bio is not distinct from old.bio then
    return new;
  end if;
  if v_text ~ '(garantiza|garantía de resultado|sin dolor|indoloro|\m(el|la|los|las) mejor(es)?\M|\mn[uú]mero uno\M|100 ?%|milagr|\mcura(mos|r)?\M|resultados? (inmediat|asegurad|permanent|definitiv)|\mperfect[oa]s?\M)' then
    raise exception using errcode = '23514',
      message = 'El texto del perfil no puede prometer resultados ni usar superlativos o frases como «garantizado», «sin dolor», «el mejor», «100 %» o «milagro» (Reglamento de Publicidad en Salud).';
  end if;
  return new;
end;
$$;
drop trigger if exists smyl_profile_claims_guard on public.smyl_professional_profiles;
create trigger smyl_profile_claims_guard before insert or update on public.smyl_professional_profiles
  for each row execute function public.smyl_profile_claims_guard();

-- Directorio público: misma definición vigente + columnas nuevas al final.
create or replace view public.smyl_professional_directory with (security_barrier = true) as
 SELECT profile.slug,
    profile.tenant_id,
    professional.display_name,
    professional.specialty,
    professional.license_number,
    profile.headline,
    profile.bio,
    profile.years_experience,
    profile.languages,
    profile.treatment_focus,
    profile.education,
    profile.memberships,
    profile.public_phone,
    profile.photo_path,
    profile.accepts_new_patients,
    profile.published_at,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', branch.id, 'name', branch.name, 'city', branch.city, 'state', branch.state, 'address', branch.address_line) ORDER BY branch.is_default DESC, branch.name) AS jsonb_agg
           FROM smyl_professional_branches assignment
             JOIN smyl_branches branch ON branch.tenant_id = assignment.tenant_id AND branch.id = assignment.branch_id
          WHERE assignment.tenant_id = profile.tenant_id AND assignment.professional_id = profile.professional_id AND branch.active), '[]'::jsonb) AS locations,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', service.id, 'name', service.name, 'duration_minutes', service.duration_minutes) ORDER BY service.name) AS jsonb_agg
           FROM smyl_professional_services assignment
             JOIN smyl_services service ON service.tenant_id = assignment.tenant_id AND service.id = assignment.service_id
          WHERE assignment.tenant_id = profile.tenant_id AND assignment.professional_id = profile.professional_id AND service.active), '[]'::jsonb) AS services,
    profile.verification_status = 'verified'::text AND NULLIF(btrim(COALESCE(profile.photo_path, ''::text)), ''::text) IS NOT NULL AND char_length(btrim(COALESCE(profile.headline, ''::text))) >= 12 AND char_length(btrim(COALESCE(profile.bio, ''::text))) >= 80 AND NULLIF(btrim(COALESCE(professional.specialty, ''::text)), ''::text) IS NOT NULL AND NULLIF(btrim(COALESCE(professional.license_number, ''::text)), ''::text) IS NOT NULL AS verified_profile,
    profile.verified_at,
    professional.license_institution,
    professional.specialty_license,
    profile.advertising_notice
   FROM smyl_professional_profiles profile
     JOIN smyl_professionals professional ON professional.tenant_id = profile.tenant_id AND professional.id = profile.professional_id AND professional.active
  WHERE profile.status = 'published'::text AND (EXISTS ( SELECT 1
           FROM smyl_professional_branches assignment
             JOIN smyl_branches branch ON branch.tenant_id = assignment.tenant_id AND branch.id = assignment.branch_id AND branch.active
          WHERE assignment.tenant_id = profile.tenant_id AND assignment.professional_id = profile.professional_id)) AND (EXISTS ( SELECT 1
           FROM smyl_professional_services assignment
             JOIN smyl_services service ON service.tenant_id = assignment.tenant_id AND service.id = assignment.service_id AND service.active
          WHERE assignment.tenant_id = profile.tenant_id AND assignment.professional_id = profile.professional_id));

revoke insert, update, delete, truncate, references, trigger on public.smyl_professional_directory from anon, authenticated;
grant select on public.smyl_professional_directory to anon, authenticated;

-- Guardar el número de aviso o permiso de publicidad (quien puede editar el perfil).
create or replace function public.smyl_set_profile_advertising_notice(p_professional_id uuid, p_notice text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_tenant uuid := public.smyl_current_tenant();
begin
  if v_tenant is null or not public.smyl_can_edit_professional_profile(v_tenant, p_professional_id) then
    raise exception using errcode = '42501', message = 'No puedes editar este perfil.';
  end if;
  if char_length(btrim(coalesce(p_notice, ''))) > 80 then
    raise exception using errcode = '22023', message = 'El número de aviso de publicidad es demasiado largo.';
  end if;
  update public.smyl_professional_profiles set advertising_notice = btrim(coalesce(p_notice, ''))
   where tenant_id = v_tenant and professional_id = p_professional_id;
end;
$$;
revoke all on function public.smyl_set_profile_advertising_notice(uuid, text) from public, anon;
grant execute on function public.smyl_set_profile_advertising_notice(uuid, text) to authenticated;
