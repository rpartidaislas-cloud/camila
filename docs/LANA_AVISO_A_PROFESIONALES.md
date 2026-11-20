# Especificación: avisar al profesional de sus citas por WhatsApp (SMYL ↔ LANA)

Para: quien mantiene LANA (`camila-api`, inbox y envío de plantillas de WhatsApp).
De: SMYL. Estado: **propuesta para acordar**; SMYL aún no implementó el envío.

## 1. Problema

SMYL quiere avisar por WhatsApp a cada dentista cuando se le agenda una cita («tienes una cita nueva, atiende el chat en SMYL»),
usando el teléfono que la clínica captura en la ficha del profesional (`smyl_professionals.contact_phone`).

Hoy SMYL solo puede escribir por LANA a una **conversación existente** (`POST /inbox/conversations/{id}/messages`). Un dentista
solo tiene conversación si antes escribió a la clínica y la vinculó él mismo desde su cuenta de SMYL
(`smyl_professional_whatsapp_links`). Un dentista sin cuenta, o que nunca ha escrito, queda sin aviso, y SMYL no puede iniciar un
chat nuevo a partir de un número.

## 2. Qué ya existe y no cambia

- Una conexión de WhatsApp por clínica (coexistencia o dedicada); LANA conserva credenciales de Meta y teléfonos.
- Plantillas Utility aprobadas en Meta, listadas por `GET /inbox/whatsapp/templates?status=all`.
- Envío por conversación con `Idempotency-Key` y `template_id` + `template_variables`.
- Autenticación SMYL → LANA ya usada por `appointment-reminders` y `appointment-negotiations` (`lanaRequest`, cabeceras de sistema).

## 3. Propuesta

Un endpoint nuevo de LANA, invocado solo por SMYL con las mismas credenciales de sistema:

`POST /inbox/whatsapp/template-to-phone`

```json
{
  "phone": "+523398765432",
  "template_id": "uuid-de-la-plantilla-aprobada",
  "template_variables": ["Martes 25 de noviembre", "10:30 a. m.", "Sucursal Centro"],
  "purpose": "professional_notice"
}
```

Cabecera obligatoria: `Idempotency-Key` (SMYL manda un UUID estable por aviso: reintentar no duplica).

Respuesta `200`:

```json
{ "ok": true, "conversation_id": "uuid", "message": { "id": "wamid..." } }
```

Comportamiento esperado de LANA:

1. Normaliza el número a E.164 (SMYL manda el texto que escribió la clínica; si no se puede, responde `400` con `error` legible).
2. Busca o **crea** la conversación de WhatsApp de la clínica con ese número y envía la plantilla en ella.
3. Devuelve el `conversation_id`; SMYL lo guarda en `smyl_professional_whatsapp_links` para los avisos siguientes (y para que el
   profesional pueda responder y atender el chat).
4. Errores esperados y distintos: `400` número inválido, `404` plantilla no aprobada, `409` el número ya pertenece a una
   conversación de paciente (SMYL decide qué hacer), `429` límite de Meta.

Sin conversaciones nuevas visibles para el equipo: estas conversaciones deben marcarse con `purpose` para que SMYL las trate como
«profesional» y no como paciente nuevo.

## 4. Plantilla que usará SMYL

Utility, sin datos clínicos ni nombre del paciente:

> Hola {{1}}, tienes una cita nueva el {{2}} a las {{3}} en {{4}}. Revisa tu agenda en SMYL y atiende el chat desde ahí.

Variables: nombre del profesional, fecha, hora, sucursal. (Se agregará al catálogo de SMYL como `cita_agendada_profesional_v1`.)

## 5. Qué hará SMYL cuando LANA lo tenga

- Migración: columna de último aviso en `smyl_professional_whatsapp_links` y registro de entregas por cita.
- `appointment-reminders`: nuevo tipo de mensaje `professional` (misma ventana de envío 9:00–20:00 y mismos reintentos),
  solo si la clínica lo enciende y el profesional tiene `contact_phone`.
- Aviso por cita **creada o movida** desde que se enciende (nunca retroactivo), igual que la confirmación al paciente.

## 6. Decisiones que necesitamos de LANA

1. ¿Se puede crear la conversación a partir de un número (punto 3.2) o Meta/coexistencia lo impide en algún modo?
2. ¿Cómo marcan estas conversaciones para que no aparezcan como pacientes en la bandeja?
3. ¿Límites de envío o costo adicional por plantilla a números nuevos?

## 7. Mientras tanto

Sin este endpoint, SMYL solo podría avisar a los profesionales que ya vincularon su chat (cubre pocos). La ficha de Equipo ya
captura el teléfono y marca quién está listo para recibir citas; el envío queda pendiente de esta respuesta.
