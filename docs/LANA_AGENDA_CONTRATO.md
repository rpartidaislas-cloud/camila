# Contrato LANA ↔ SMYL · Agenda con IA (nivel 1: solo sugiere)

Función: `lana-scheduling` (Edge Function de SMYL, solo lectura). No agenda, no aparta y no devuelve datos de pacientes.

## Seguridad
- `POST` con cuerpo JSON ≤ 8 KB. Cabecera `X-SMYL-Signature: sha256=<hex>` = HMAC-SHA256 del **cuerpo crudo** con el secreto `SMYL_LANA_SCHEDULING_SECRET` (≥ 32 caracteres; el mismo valor en LANA).
- `occurred_at` (ISO 8601) debe estar a ±5 min de la hora del servidor.
- Límite: 20 consultas/minuto por conversación. Respuestas con `Cache-Control: no-store`.
- Apagado por defecto por clínica: se enciende en Configuración → Agenda → «Agenda con IA» y se eligen los servicios permitidos.

## Cuerpo común
`{ "contract_version": 1, "action": "context" | "suggest", "tenant_id": "<uuid>", "conversation_id": "<id LANA>", "occurred_at": "<ISO>" }`

### `context`
Responde `{ ok, enabled, level, status: single_branch|assigned|unassigned|not_applicable, branch, branches, services, policy{min_lead_hours,horizon_days,max_options:3}, generated_at }`, o `{ ok:true, enabled:false }` si está apagado.

### `suggest`
Agrega: `service_id` (obligatorio, de los permitidos); opcionales `branch_id`, `professional_id` (fija profesional), `preferred_professional_id` (preferencia, p. ej. quien atendió antes), `from`/`to` (ISO, ventana ≤ 31 días dentro de la política) y `exclude` (claves ya ofrecidas, para «otras opciones»).
Responde `{ ok, status: ok|few|none, branch, options[{index,key,tag,starts_at,ends_at,local_label,timezone,service_id,service_name,professional_id,professional_name,branch_id,branch_name}], message_hint, explanation, next_step, other_branches_available }`.
Máximo 3 opciones, de una sola sucursal, en hora local de la sucursal. LANA debe ofrecerlas tal cual y pedir confirmación a una persona del equipo; nunca prometer el horario.

## Errores
`403 bad_signature | disabled | service_not_allowed`, `503 not_configured`, `400 invalid_request | expired_request | invalid_period`, `404 branch_not_found`, `409 branch_required | no_branches`, `429 rate_limited`, `502 upstream_error`.

## Pendiente (fuera de este paso)
Nivel 2 (apartar con `reserve`) requiere acuerdo aparte. La herramienta del lado de LANA la implementa quien mantiene LANA.
