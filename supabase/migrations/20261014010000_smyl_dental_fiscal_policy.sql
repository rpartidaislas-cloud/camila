-- SMYL · Política fiscal odontológica v1 (aditiva, sin timbrado).
-- Distingue servicio profesional, producto y tratamiento de IVA. Toda
-- activación fiscal continúa requiriendo revisión humana del emisor/contador.
begin;

alter table public.smyl_services
  add column fiscal_service_kind text not null default 'professional_dental',
  add column tax_treatment text not null default 'pending',
  add column tax_rate numeric(7,6),
  add column deduction_profile text not null default 'review',
  add column professional_title_required boolean not null default true,
  add column fiscal_policy_note text not null default '';

-- Las revisiones anteriores no distinguían exento, gravado y no objeto.
-- Se reabren deliberadamente para evitar conservar una aprobación incompleta.
update public.smyl_services
set fiscal_status='pending',fiscal_reviewed_by=null,fiscal_reviewed_at=null
where fiscal_status='reviewed';

alter table public.smyl_services
  add constraint smyl_services_fiscal_kind check(fiscal_service_kind in (
    'professional_dental','dental_hygiene','oral_surgery','orthodontics',
    'dental_imaging','dental_lab','dental_product','dental_other')),
  add constraint smyl_services_tax_treatment check(tax_treatment in ('pending','exempt','rate','non_object')),
  add constraint smyl_services_tax_rate check(tax_rate is null or (tax_rate>=0 and tax_rate<=1)),
  add constraint smyl_services_deduction_profile check(deduction_profile in ('dental_candidate','disability_candidate','not_personal','review')),
  add constraint smyl_services_fiscal_policy_note check(char_length(fiscal_policy_note)<=500),
  add constraint smyl_services_tax_consistency check(
    (tax_treatment='pending')
    or (tax_treatment='exempt' and tax_object_code='02' and tax_rate is null)
    or (tax_treatment='rate' and tax_object_code='02' and tax_rate is not null)
    or (tax_treatment='non_object' and tax_object_code='01' and tax_rate is null)
  ),
  add constraint smyl_services_no_review_while_tax_pending check(not(fiscal_status='reviewed' and tax_treatment='pending'));

create or replace function public.smyl_service_catalog_revision()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if row(new.name,new.patient_name,new.description,new.category,new.specialty,new.duration_minutes,
    new.reference_price,new.currency,new.scope_type,new.pricing_mode,new.sat_product_service_code,
    new.sat_unit_code,new.tax_object_code,new.fiscal_service_kind,new.tax_treatment,new.tax_rate,
    new.deduction_profile,new.professional_title_required,new.fiscal_policy_note,new.fiscal_status,new.featured,new.active)
    is distinct from
    row(old.name,old.patient_name,old.description,old.category,old.specialty,old.duration_minutes,
    old.reference_price,old.currency,old.scope_type,old.pricing_mode,old.sat_product_service_code,
    old.sat_unit_code,old.tax_object_code,old.fiscal_service_kind,old.tax_treatment,old.tax_rate,
    old.deduction_profile,old.professional_title_required,old.fiscal_policy_note,old.fiscal_status,old.featured,old.active) then
    new.catalog_revision:=old.catalog_revision+1;
  end if;
  if new.fiscal_status='reviewed' and old.fiscal_status is distinct from 'reviewed' then
    new.fiscal_reviewed_by:=auth.uid();new.fiscal_reviewed_at:=clock_timestamp();
  elsif new.fiscal_status='pending' then
    new.fiscal_reviewed_by:=null;new.fiscal_reviewed_at:=null;
  end if;
  return new;
end $$;

comment on column public.smyl_services.tax_treatment is 'Dental fiscal policy only: pending, IVA exempt, rated IVA or non-object. Not a PAC validation.';
comment on column public.smyl_services.deduction_profile is 'Guidance only; never guarantees personal deductibility for the receiver.';
commit;
