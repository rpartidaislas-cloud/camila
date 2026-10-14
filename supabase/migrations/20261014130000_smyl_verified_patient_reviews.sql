-- SMYL · Reseñas verificadas por cita terminada.
-- El token público se entrega una sola vez y sólo se conserva su hash SHA-256.

begin;

create table public.smyl_review_invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  professional_id uuid not null,
  patient_id uuid not null,
  appointment_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (tenant_id,appointment_id),
  unique (tenant_id,id),
  foreign key (tenant_id,professional_id) references public.smyl_professionals(tenant_id,id) on delete cascade,
  foreign key (tenant_id,patient_id) references public.camila_pacientes(tenant_id,id) on delete restrict,
  foreign key (tenant_id,appointment_id) references public.smyl_appointments(tenant_id,id) on delete restrict
);

create table public.smyl_patient_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  invitation_id uuid not null,
  professional_id uuid not null,
  patient_id uuid not null,
  appointment_id uuid not null,
  rating smallint not null check (rating between 1 and 5),
  body text not null check (char_length(body) between 20 and 1000),
  public_name text not null check (char_length(public_name) between 2 and 80),
  name_style text not null check (name_style in ('first_name','initials','anonymous')),
  status text not null default 'review' check (status in ('review','published','rejected','hidden')),
  moderation_note text check (char_length(moderation_note) <= 500),
  moderated_by uuid references auth.users(id) on delete set null,
  moderated_at timestamptz,
  submitted_at timestamptz not null default now(),
  published_at timestamptz,
  unique (tenant_id,invitation_id),
  unique (tenant_id,appointment_id),
  foreign key (tenant_id,invitation_id) references public.smyl_review_invitations(tenant_id,id) on delete restrict,
  foreign key (tenant_id,professional_id) references public.smyl_professionals(tenant_id,id) on delete cascade,
  foreign key (tenant_id,patient_id) references public.camila_pacientes(tenant_id,id) on delete restrict,
  foreign key (tenant_id,appointment_id) references public.smyl_appointments(tenant_id,id) on delete restrict
);

create index smyl_patient_reviews_public_idx
  on public.smyl_patient_reviews(tenant_id,professional_id,status,published_at desc);

alter table public.smyl_review_invitations enable row level security;
alter table public.smyl_patient_reviews enable row level security;
revoke all on public.smyl_review_invitations,public.smyl_patient_reviews from public,anon,authenticated;
grant select on public.smyl_review_invitations,public.smyl_patient_reviews to authenticated;
create policy smyl_review_invitations_read on public.smyl_review_invitations
  for select to authenticated using (public.camila_es_miembro(tenant_id));
create policy smyl_patient_reviews_read on public.smyl_patient_reviews
  for select to authenticated using (public.camila_es_miembro(tenant_id));

create trigger smyl_review_invitations_audit after insert or update or delete on public.smyl_review_invitations
  for each row execute function public.smyl_audit_row();
create trigger smyl_patient_reviews_audit after insert or update or delete on public.smyl_patient_reviews
  for each row execute function public.smyl_audit_row();

create or replace function public.smyl_create_review_invitation(
  p_professional_id uuid,p_appointment_id uuid,p_valid_days integer default 14
)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,extensions
as $$
declare
  v_tenant uuid:=public.smyl_current_tenant();
  v_appointment public.smyl_appointments;
  v_token text:=encode(gen_random_bytes(32),'hex');
  v_invitation public.smyl_review_invitations;
begin
  if v_tenant is null or not public.smyl_can_edit_professional_profile(v_tenant,p_professional_id) then
    raise exception using errcode='42501',message='No tienes permiso para solicitar esta reseña.';
  end if;
  select * into v_appointment from public.smyl_appointments
   where tenant_id=v_tenant and id=p_appointment_id and professional_id=p_professional_id and status='completed';
  if not found then
    raise exception using errcode='23514',message='Las reseñas sólo pueden solicitarse después de una cita terminada.';
  end if;
  if exists(select 1 from public.smyl_patient_reviews where tenant_id=v_tenant and appointment_id=p_appointment_id) then
    raise exception using errcode='23505',message='Esta cita ya tiene una reseña.';
  end if;

  insert into public.smyl_review_invitations(
    tenant_id,professional_id,patient_id,appointment_id,token_hash,expires_at,created_by
  ) values (
    v_tenant,p_professional_id,v_appointment.patient_id,p_appointment_id,
    encode(digest(v_token,'sha256'),'hex'),now()+make_interval(days=>greatest(1,least(30,coalesce(p_valid_days,14)))),auth.uid()
  ) on conflict (tenant_id,appointment_id) do update set
    token_hash=excluded.token_hash,expires_at=excluded.expires_at,used_at=null,revoked_at=null,created_by=auth.uid(),created_at=now()
  returning * into v_invitation;
  return jsonb_build_object('token',v_token,'invitation_id',v_invitation.id,'expires_at',v_invitation.expires_at);
end;
$$;
revoke all on function public.smyl_create_review_invitation(uuid,uuid,integer) from public,anon;
grant execute on function public.smyl_create_review_invitation(uuid,uuid,integer) to authenticated;

create or replace function public.smyl_submit_patient_review(
  p_token_hash text,p_rating integer,p_body text,p_name_style text
)
returns uuid language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare
  v_invite public.smyl_review_invitations;
  v_patient public.camila_pacientes;
  v_style text:=lower(btrim(coalesce(p_name_style,'')));
  v_public_name text;
  v_id uuid;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$' or p_rating not between 1 and 5
     or char_length(btrim(coalesce(p_body,''))) not between 20 and 1000
     or v_style not in ('first_name','initials','anonymous') then
    raise exception using errcode='22023',message='La reseña está incompleta.';
  end if;
  select * into v_invite from public.smyl_review_invitations
   where token_hash=p_token_hash for update;
  if not found or v_invite.revoked_at is not null or v_invite.used_at is not null or v_invite.expires_at<=now() then
    raise exception using errcode='P0002',message='Este enlace ya no está disponible.';
  end if;
  select * into v_patient from public.camila_pacientes
   where tenant_id=v_invite.tenant_id and id=v_invite.patient_id;
  v_public_name:=case v_style
    when 'anonymous' then 'Paciente verificado'
    when 'initials' then upper(left(coalesce(v_patient.nombre,''),1)||left(coalesce(v_patient.apellido,''),1))||'.'
    else split_part(btrim(coalesce(v_patient.nombre,'Paciente')),' ',1)
  end;
  insert into public.smyl_patient_reviews(
    tenant_id,invitation_id,professional_id,patient_id,appointment_id,rating,body,public_name,name_style,status
  ) values (
    v_invite.tenant_id,v_invite.id,v_invite.professional_id,v_invite.patient_id,v_invite.appointment_id,
    p_rating,btrim(p_body),v_public_name,v_style,'review'
  ) returning id into v_id;
  update public.smyl_review_invitations set used_at=now() where id=v_invite.id;
  return v_id;
end;
$$;
revoke all on function public.smyl_submit_patient_review(text,integer,text,text) from public,anon,authenticated;
grant execute on function public.smyl_submit_patient_review(text,integer,text,text) to service_role;

create or replace function public.smyl_moderate_patient_review(
  p_review_id uuid,p_decision text,p_note text default null
)
returns public.smyl_patient_reviews language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_decision text:=lower(btrim(coalesce(p_decision,''))); v_review public.smyl_patient_reviews;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'team.manage') then
    raise exception using errcode='42501',message='Solo la administración puede moderar reseñas.';
  end if;
  if v_decision not in ('published','rejected','hidden') then
    raise exception using errcode='22023',message='Decisión no válida.';
  end if;
  if v_decision='rejected' and char_length(btrim(coalesce(p_note,'')))<5 then
    raise exception using errcode='22023',message='Explica brevemente el motivo del rechazo.';
  end if;
  update public.smyl_patient_reviews set status=v_decision,
    moderation_note=nullif(left(btrim(coalesce(p_note,'')),500),''),moderated_by=auth.uid(),moderated_at=now(),
    published_at=case when v_decision='published' then coalesce(published_at,now()) end
   where tenant_id=v_tenant and id=p_review_id
     and ((status='review' and v_decision in ('published','rejected')) or (status='published' and v_decision='hidden'))
   returning * into v_review;
  if not found then raise exception using errcode='P0002',message='La reseña no está en un estado compatible con esta decisión.'; end if;
  return v_review;
end;
$$;
revoke all on function public.smyl_moderate_patient_review(uuid,text,text) from public,anon;
grant execute on function public.smyl_moderate_patient_review(uuid,text,text) to authenticated;

create or replace function public.smyl_public_review_summary(p_tenant_id uuid,p_professional_id uuid)
returns table(review_count bigint,average_rating numeric)
language sql stable security definer set search_path=pg_catalog,public
as $$
  select count(*),coalesce(round(avg(rating)::numeric,1),0)
  from public.smyl_patient_reviews
  where tenant_id=p_tenant_id and professional_id=p_professional_id and status='published';
$$;
revoke all on function public.smyl_public_review_summary(uuid,uuid) from public,anon,authenticated;
grant execute on function public.smyl_public_review_summary(uuid,uuid) to service_role;

comment on table public.smyl_patient_reviews is
  'Reseñas originadas exclusivamente por invitación de una cita terminada. Paciente y cita nunca son públicos.';

commit;
