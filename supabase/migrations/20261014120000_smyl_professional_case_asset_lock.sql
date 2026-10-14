-- SMYL · Inmutabilidad de evidencia durante revisión y publicación.

begin;

create or replace function public.smyl_can_mutate_professional_case_asset(
  p_tenant_id uuid,p_professional_id uuid,p_case_id uuid
)
returns boolean language sql security definer stable
set search_path=pg_catalog,public
as $$
  select public.smyl_can_edit_professional_profile(p_tenant_id,p_professional_id)
    and not exists (
      select 1 from public.smyl_professional_cases c
      where c.tenant_id=p_tenant_id and c.professional_id=p_professional_id
        and c.id=p_case_id and c.status in ('review','published')
    );
$$;
revoke all on function public.smyl_can_mutate_professional_case_asset(uuid,uuid,uuid) from public,anon;
grant execute on function public.smyl_can_mutate_professional_case_asset(uuid,uuid,uuid) to authenticated;

drop policy if exists smyl_professional_cases_storage_insert on storage.objects;
drop policy if exists smyl_professional_cases_storage_update on storage.objects;
drop policy if exists smyl_professional_cases_storage_delete on storage.objects;

create policy smyl_professional_cases_storage_insert on storage.objects for insert to authenticated
with check (
  bucket_id='smyl-professional-cases'
  and public.smyl_can_mutate_professional_case_asset(
    ((storage.foldername(name))[1])::uuid,((storage.foldername(name))[2])::uuid,
    ((storage.foldername(name))[3])::uuid
  )
);
create policy smyl_professional_cases_storage_update on storage.objects for update to authenticated
using (
  bucket_id='smyl-professional-cases'
  and public.smyl_can_mutate_professional_case_asset(
    ((storage.foldername(name))[1])::uuid,((storage.foldername(name))[2])::uuid,
    ((storage.foldername(name))[3])::uuid
  )
) with check (
  bucket_id='smyl-professional-cases'
  and public.smyl_can_mutate_professional_case_asset(
    ((storage.foldername(name))[1])::uuid,((storage.foldername(name))[2])::uuid,
    ((storage.foldername(name))[3])::uuid
  )
);
create policy smyl_professional_cases_storage_delete on storage.objects for delete to authenticated
using (
  bucket_id='smyl-professional-cases'
  and public.smyl_can_mutate_professional_case_asset(
    ((storage.foldername(name))[1])::uuid,((storage.foldername(name))[2])::uuid,
    ((storage.foldername(name))[3])::uuid
  )
);

commit;
