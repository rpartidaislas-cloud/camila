-- Cobros · «Nuevo cargo» listo para facturar.
-- Antes, un cargo capturado a mano con un servicio del catálogo NO guardaba los datos fiscales del servicio
-- (service_snapshot): sólo los cargos importados de una cotización los tenían. Al preparar el CFDI de ese pago, la
-- prevalidación bloqueaba con «ClaveProdServ inválida o pendiente» aunque el servicio sí estuviera revisado.
-- Ahora smyl_post_charge (misma firma) guarda el snapshot y la revisión del servicio, con las mismas claves que usa la
-- cotización, y decide el impuesto según la política fiscal del servicio:
--   exento / no objeto → IVA 0; tasa → base × tasa (redondeo a centavos); pendiente o concepto libre → lo que capture la clínica.
-- No timbra ni consulta al SAT. Idempotente (create or replace, misma firma y permisos).

create or replace function public.smyl_post_charge(p_id uuid,p_idempotency_key uuid,p_patient_id uuid,p_branch_id uuid,p_appointment_id uuid,p_service_id uuid,p_proposal_id uuid,p_concept text,p_quantity numeric,p_unit_price numeric,p_discount_amount numeric default 0,p_tax_amount numeric default 0,p_due_on date default null)
returns public.smyl_finance_charges language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_tenant uuid:=public.smyl_current_tenant();
  v_row public.smyl_finance_charges;
  v_service public.smyl_services;
  v_snapshot jsonb;
  v_revision integer;
  v_base numeric(12,2);
  v_tax numeric(12,2):=coalesce(p_tax_amount,0);
  v_total numeric(12,2);
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'finance.manage') then raise exception using errcode='42501',message='Sin permiso para registrar cargos.'; end if;
  select * into v_row from public.smyl_finance_charges where tenant_id=v_tenant and idempotency_key=p_idempotency_key;
  if found then return v_row; end if;
  if not exists(select 1 from public.camila_pacientes where tenant_id=v_tenant and id=p_patient_id) then raise exception using errcode='23503',message='Paciente no disponible.'; end if;
  if p_appointment_id is not null and not exists(select 1 from public.smyl_appointments where tenant_id=v_tenant and id=p_appointment_id and patient_id=p_patient_id) then raise exception using errcode='23514',message='La cita no pertenece a este paciente.'; end if;
  if p_quantity is null or p_unit_price is null or p_quantity<=0 or p_unit_price<0 or coalesce(p_discount_amount,0)<0 or coalesce(p_tax_amount,0)<0 then raise exception using errcode='22003',message='Importes inválidos.'; end if;
  v_base:=round(p_quantity*p_unit_price-coalesce(p_discount_amount,0),2);
  if v_base<=0 then raise exception using errcode='22003',message='El descuento no puede ser mayor que el importe.'; end if;
  if p_service_id is not null then
    select * into v_service from public.smyl_services where tenant_id=v_tenant and id=p_service_id;
    if not found then raise exception using errcode='23503',message='Servicio no disponible.'; end if;
    v_revision:=v_service.catalog_revision;
    v_snapshot:=jsonb_build_object(
      'name',v_service.name,'patient_name',v_service.patient_name,'category',v_service.category,'specialty',v_service.specialty,
      'scope_type',v_service.scope_type,'pricing_mode',v_service.pricing_mode,'reference_price',v_service.reference_price,
      'currency',v_service.currency,'sat_product_service_code',v_service.sat_product_service_code,
      'sat_unit_code',v_service.sat_unit_code,'tax_object_code',v_service.tax_object_code,'fiscal_status',v_service.fiscal_status,
      'tax_treatment',v_service.tax_treatment,'tax_rate',v_service.tax_rate);
    if v_service.tax_treatment in ('exempt','non_object') then v_tax:=0;
    elsif v_service.tax_treatment='rate' and v_service.tax_rate is not null then v_tax:=round(v_base*v_service.tax_rate,2);
    end if;
  end if;
  v_total:=round(v_base+v_tax,2);
  if v_total<=0 then raise exception using errcode='22003',message='Importes inválidos.'; end if;
  insert into public.smyl_finance_charges(id,tenant_id,patient_id,branch_id,appointment_id,service_id,proposal_id,idempotency_key,concept,quantity,unit_price,discount_amount,tax_amount,total_amount,due_on,created_by,service_revision,service_snapshot)
  values(p_id,v_tenant,p_patient_id,p_branch_id,p_appointment_id,p_service_id,p_proposal_id,p_idempotency_key,btrim(p_concept),p_quantity,p_unit_price,coalesce(p_discount_amount,0),v_tax,v_total,p_due_on,auth.uid(),v_revision,v_snapshot)
  returning * into v_row;
  return v_row;
end $$;

revoke all on function public.smyl_post_charge(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,date) from public,anon;
grant execute on function public.smyl_post_charge(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,date) to authenticated;
