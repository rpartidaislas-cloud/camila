# Contrato LANA ↔ SMYL · Agenda con IA (sugiere y, si la clínica lo permite, deja una solicitud)

Función: `lana-scheduling` (Edge Function de SMYL). `context` y `suggest` son de solo lectura; `request` (task-id smyl-agenda-ia-solicitud) deja una **solicitud pendiente** en «Agenda → Por aprobar». **Nunca confirma una cita.** No devuelve datos de pacientes.

## Seguridad
- `POST` con cuerpo JSON ≤ 8 KB. Cabecera `X-SMYL-Signature: sha256=<hex>` = HMAC-SHA256 del **cuerpo crudo** con el secreto `SMYL_LANA_SCHEDULING_SECRET` (≥ 32 caracteres; el mismo valor en LANA).
- `occurred_at` (ISO 8601) debe estar a ±5 min de la hora del servidor.
- Límite: 20 consultas/minuto por conversación. Respuestas con `Cache-Control: no-store`.
- Apagado por defecto por clínica: se enciende en Configuración → Agenda → «Agenda con IA» y se eligen los servicios permitidos. El nivel `suggest` (solo sugerir) y el nivel `request` (además deja solicitudes; casilla «También puede dejar la solicitud en Por aprobar») los elige la clínica.
- Con el nivel `request`, `suggest` y `request` exigen `lana_tenant_id` (la cuenta de LANA vinculada a la clínica: `camila_tenants.config.integraciones.lana.lana_tenant_id`; si no coincide, `403 lana_mismatch`).

## Cuerpo común
`{ "contract_version": 1, "action": "context" | "suggest", "tenant_id": "<uuid>", "conversation_id": "<id LANA>", "occurred_at": "<ISO>" }`

### `context`
Responde `{ ok, enabled, level, status: single_branch|assigned|unassigned|not_applicable, branch, branches, services, policy{min_lead_hours,horizon_days,max_options:3}, generated_at }`, o `{ ok:true, enabled:false }` si está apagado.

**Agregado (2026-11-25):** el contexto también devuelve `professionals: [{ id, name, branch_ids[] }]` (profesionales activos y las sedes donde atienden; solo nombre público, nunca contacto ni datos clínicos) para que el asistente pueda pedir horarios con uno en concreto (`professional_id` en `suggest`).

### `suggest`
Agrega: `service_id` (obligatorio, de los permitidos); opcionales `branch_id`, `professional_id` (fija profesional), `preferred_professional_id` (preferencia, p. ej. quien atendió antes), `from`/`to` (ISO, ventana ≤ 31 días dentro de la política) y `exclude` (claves ya ofrecidas, para «otras opciones»).
Responde `{ ok, status: ok|few|none, branch, options[{index,key,tag,starts_at,ends_at,local_label,timezone,service_id,service_name,professional_id,professional_name,branch_id,branch_name}], message_hint, explanation, next_step, other_branches_available }`.
Máximo 3 opciones, de una sola sucursal, en hora local de la sucursal. LANA debe ofrecerlas tal cual y pedir confirmación a una persona del equipo; nunca prometer el horario.

**Agregado (2026-11-25) — `more: true` en `suggest`:** «más opciones». El servidor excluye los horarios que ya ofreció en esta conversación en las últimas 2 horas (los lee de `smyl_assistant_slot_offers`; el cliente no tiene que recordarlos). Equivale a pasar `exclude` con esas claves. Si no queda nada nuevo, responde `status: none` con `options: []`.

### `request` (solo con el nivel `request`)
Cuerpo: `{ ..., "action": "request", "lana_tenant_id": "<uuid>", "offer_key": "<uuid de suggest>", "option_index": 1|2|3, "name": "<2-80 caracteres>", "contact": "<teléfono de 10 dígitos o correo>", "privacy_consent": true, "privacy_notice_version": "chat-appointment-v1" }`.
- La opción debe pertenecer a una **oferta guardada por el propio servidor** (`suggest` con nivel `request` devuelve `offer_key`; vence a los 30 min). No se puede inventar un horario.
- `privacy_consent` debe ser `true`: LANA solo lo manda si el paciente autorizó EN EL CHAT que se use su nombre y medio de contacto para gestionar su cita. Se guarda solo nombre y contacto (sin datos clínicos), con fecha de consentimiento y versión del aviso; **no crea paciente ni expediente**; se depuran a los 90 días.
- Crea una solicitud `pending` (source `assistant`) con el horario **apartado 10 minutos**; el equipo la acepta o la rechaza en «Por aprobar». Idempotente: la misma oferta y opción devuelve `status: "duplicate"`.
- Topes: máximo 2 solicitudes pendientes por conversación y 30 del asistente por clínica por hora.
- Responde `{ ok, status: created|duplicate, request{id,starts_at,ends_at,local_label,hold_expires_at,service_name,branch_name}, message_hint, next_step: "wait_for_clinic" }`. LANA debe decir siempre que **todavía no está confirmada**.

## Errores
`403 bad_signature | disabled | service_not_allowed | lana_mismatch`, `503 not_configured`, `400 invalid_request | expired_request | invalid_period | consent_required | invalid_contact`, `404 offer_not_found`, `409 offer_already_used | slot_taken`, `410 offer_expired`, `429 capped`, `404 branch_not_found`, `409 branch_required | no_branches`, `429 rate_limited`, `502 upstream_error`.

## Pendiente
Agendar sin una persona (`book`) no está permitido. Reagendar/cancelar y propuestas/pagos desde el chat quedan fuera de este paso.

**Agregado (2026-11-26):** cada elemento de `professionals` incluye `service_ids` (ids de los servicios que realiza, desde `smyl_professional_services`). Si el campo falta, no se sabe qué realiza; un arreglo vacío significa que no realiza ninguno.
