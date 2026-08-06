-- Etapa 5 de infraestructura: chat unificado con Meta (WhatsApp, Messenger,
-- Instagram) -- arquitectura MULTI-TENANT desde el día uno (decisión del
-- usuario 2026-08-06, mismo patrón que ya usa su otro producto "LANA"):
-- una sola App de Meta + un solo System User "Tech Provider" con token
-- PERMANENTE (vive como Secret compartido `META_TOKEN` de las Edge
-- Functions, ver meta-webhook/meta-send) opera sobre las cuentas de
-- WhatsApp/Messenger/Instagram de TODAS las clínicas. Por eso
-- camila_canales NO guarda ningún token -- solo guarda los identificadores
-- de la cuenta de cada clínica (phone_number_id/page_id/ig_business_id),
-- que es lo único que cambia por tenant. El alta de canales hoy sigue
-- siendo manual (INSERT vía SQL Editor) porque el flujo de autoservicio
-- (Embedded Signup, para que cualquier dentista conecte su propia cuenta
-- desde el panel) es una fase posterior -- ver docs/HANDOFF.md.
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
  waba_id text, -- solo aplica a whatsapp -- identificador de la cuenta de WhatsApp Business, distinto del phone_number_id
  nombre text, -- etiqueta humana para el panel, ej. "WhatsApp +52 33..."
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (canal, id_externo)
);

alter table public.camila_canales enable row level security;

-- Solo el dueño ve/administra qué cuentas de Meta están conectadas a su
-- clínica -- mismo criterio que precios/config en camila_tenants. No
-- guarda ningún token (ver comentario arriba), pero sigue siendo
-- información de negocio sensible (qué número/página/cuenta de IG está
-- vinculada), no algo que el staff necesite tocar.
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

-- Sin esto, cuando se construya la bandeja en tiempo real (Supabase
-- Realtime), el payload.old de un UPDATE solo trae la primary key -- toda
-- lógica de "avisar solo si X cambió de verdad" (ej. no_leidos subió,
-- alguien más ya la atendió) vería el resto de las columnas como
-- undefined y fallaría en silencio. Encontrado por la skill de referencia
-- meta-multitenant-chat (PR #5, extraída de un bug real ya visto en
-- producción en otro proyecto) -- barato agregarlo ahora que corregirlo
-- después de que ya esté en producción.
alter table public.camila_conversaciones replica identity full;

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
