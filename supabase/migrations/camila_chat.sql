-- Etapa 5 de infraestructura: chat unificado con Meta (WhatsApp, Messenger,
-- Instagram). Fase 1: una sola clínica conectada (la del dueño de Smyl) --
-- el modelo ya queda listo para que cada tenant conecte su propia cuenta
-- más adelante, pero el alta de canales hoy es manual (vía SQL Editor,
-- pegando el access_token que Meta entrega al configurar la app) -- no hay
-- todavía un flujo de autoservicio (Embedded Signup) para que cualquier
-- dentista conecte su propio WhatsApp. Ver docs/HANDOFF.md.
--
-- Nota: NO se agrega una FK a camila_pacientes -- esa tabla es referenciada
-- por app.html (`.from('camila_pacientes')`) pero NO existe como tabla real
-- en esta base de datos (confirmado por introspección directa el
-- 2026-08-05, mismo patrón ya visto con camila_notificaciones/
-- camila_precios). Un `references camila_pacientes(id)` habría hecho
-- fallar esta migración completa. paciente_id queda como uuid suelto, listo
-- para convertirse en FK real el día que camila_pacientes exista de verdad.

create table if not exists public.camila_canales (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  canal text not null check (canal in ('whatsapp', 'messenger', 'instagram')),
  id_externo text not null, -- phone_number_id (whatsapp) / page_id (messenger) / ig_business_id (instagram)
  nombre text, -- etiqueta humana para el panel, ej. "WhatsApp +52 33..."
  access_token text not null, -- token de Meta -- SOLO lo lee el service role (Edge Functions), nunca el cliente ni el staff
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (canal, id_externo)
);

alter table public.camila_canales enable row level security;

-- Credenciales sensibles: solo el dueño, nunca el staff -- mismo criterio
-- que ya se usa para precios/config en camila_tenants.
create policy camila_canales_select_dueno on public.camila_canales
  for select to authenticated using (camila_es_dueno(tenant_id));
create policy camila_canales_insert_dueno on public.camila_canales
  for insert to authenticated with check (camila_es_dueno(tenant_id));
create policy camila_canales_update_dueno on public.camila_canales
  for update to authenticated using (camila_es_dueno(tenant_id)) with check (camila_es_dueno(tenant_id));
create policy camila_canales_delete_dueno on public.camila_canales
  for delete to authenticated using (camila_es_dueno(tenant_id));

create table if not exists public.camila_conversaciones (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  canal_id uuid not null references public.camila_canales(id) on delete cascade,
  contacto_id_externo text not null, -- número (whatsapp) o PSID/IGSID (messenger/instagram)
  nombre_contacto text,
  paciente_id uuid, -- sin FK a propósito, ver nota arriba
  modo text not null default 'ia' check (modo in ('ia', 'humano')),
  no_leidos integer not null default 0,
  ultimo_mensaje_en timestamptz,
  ultimo_mensaje_texto text,
  created_at timestamptz not null default now(),
  unique (canal_id, contacto_id_externo)
);

alter table public.camila_conversaciones enable row level security;

-- Cualquier miembro de la clínica (dueño o staff) ve/atiende la bandeja --
-- no hay INSERT para el cliente: las conversaciones las crea el webhook
-- (service role) al llegar el primer mensaje del paciente.
create policy camila_conv_select_miembros on public.camila_conversaciones
  for select to authenticated using (camila_es_miembro(tenant_id));
create policy camila_conv_update_miembros on public.camila_conversaciones
  for update to authenticated using (camila_es_miembro(tenant_id)) with check (camila_es_miembro(tenant_id));

create table if not exists public.camila_mensajes (
  id uuid primary key default gen_random_uuid(),
  conversacion_id uuid not null references public.camila_conversaciones(id) on delete cascade,
  direccion text not null check (direccion in ('entrante', 'saliente')),
  autor text not null check (autor in ('paciente', 'ia', 'staff')),
  texto text,
  id_externo_meta text, -- id del mensaje en Meta -- evita duplicar si el webhook reintenta el mismo evento
  enviado_en timestamptz not null default now()
);

alter table public.camila_mensajes enable row level security;

-- Solo SELECT para el cliente -- los mensajes los crea siempre el service
-- role (meta-webhook para entrantes, meta-send para salientes), nunca un
-- INSERT directo del cliente, para que la tabla sea el registro real de lo
-- que de verdad se envió/recibió vía Meta, no de lo que alguien intentó.
create policy camila_msg_select_miembros on public.camila_mensajes
  for select to authenticated using (
    exists (
      select 1 from public.camila_conversaciones c
      where c.id = conversacion_id and camila_es_miembro(c.tenant_id)
    )
  );

create index if not exists camila_mensajes_conversacion_idx on public.camila_mensajes (conversacion_id, enviado_en);
create index if not exists camila_conversaciones_tenant_idx on public.camila_conversaciones (tenant_id, ultimo_mensaje_en desc);
