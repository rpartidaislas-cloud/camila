# Especificación: contexto de sucursal por conversación (SMYL ↔ LANA)

Para: quien mantiene LANA (`camila-api`, compilador de contexto y webhooks de canales).
De: SMYL. Estado: **propuesta para acordar**; SMYL aún no implementó nada de esto.

## 1. Problema

Una clínica de SMYL puede tener varias sucursales con direcciones, horarios, dentistas y servicios distintos.
Hoy el asistente de LANA solo lee **un texto por clínica**: lo que la clínica escribe en *Capacitar IA* y publica
(`tenants.config_json.ia_config.smyl_training`). Ese texto:

- es una **copia** del momento en que se publicó (si cambia un horario o un dentista, el asistente no se entera);
- es el **mismo para todas las conversaciones**, aunque cada paciente hable de una sucursal distinta;
- no permite ofrecer **horarios reales**.

SMYL ya hizo lo que le corresponde del lado de la clínica (PR #191): el texto de sucursales incluye dirección,
horario y dentistas de cada sede, y la instrucción «pregunta la sucursal si hay más de una». Esto es el paso siguiente.

## 2. Qué ya existe y no cambia

- LANA resuelve la clínica (tenant) de cada conversación por el canal (número de WhatsApp, página de Messenger/Instagram).
- SMYL guarda la sucursal de cada conversación en `smyl_conversation_branches(tenant_id, conversation_id, branch_id, source)`,
  con `source` = `manual` (la eligió una persona) o `ai` (SMYL la dedujo por palabras clave del mensaje). SMYL, no LANA, es la
  fuente de verdad de a qué sucursal pertenece una conversación.
- Los datos de sucursales viven solo en SMYL: `smyl_branches`, `smyl_clinic_hours`, `smyl_professional_branches`,
  `smyl_professionals`, `smyl_professional_services`, `smyl_services`.
- Autenticación LANA → SMYL ya usada en `appointment-negotiations` (callback): cuerpo crudo firmado con **HMAC-SHA256**,
  cabecera `X-SMYL-Signature: sha256=<hex>`, secreto de ≥ 32 caracteres, `occurred_at` con tolerancia de ±5 min.

## 3. Propuesta

SMYL expone **una función HTTP** (`lana-branch-context`) con tres acciones. LANA la consulta; nunca al revés.

### 3.1 `context` — qué sucursal es y cómo es

Se llama **antes de generar cada respuesta** de una conversación (LANA puede cachear la respuesta hasta 60 s por conversación).

Solicitud:

```json
{
  "contract_version": 1,
  "action": "context",
  "tenant_id": "<uuid>",
  "conversation_id": "<uuid>",
  "channel": "whatsapp",
  "occurred_at": "2026-11-17T18:04:05.000Z"
}
```

Respuesta `200`:

```json
{
  "ok": true,
  "contract_version": 1,
  "status": "assigned",
  "branch_count": 3,
  "branch": {
    "id": "<uuid>", "name": "Sucursal Plaza Sol", "source": "ai",
    "address": "Plaza Sol Local 25, Zapopan, Jalisco", "phone": "3300000002",
    "timezone": "America/Mexico_City",
    "hours": [{ "weekday": 1, "opens": "10:00", "closes": "20:00" }],
    "team": [{ "id": "<uuid>", "name": "Dra. Mónica Reyes", "specialty": "Ortodoncia" }],
    "services": [{ "id": "<uuid>", "name": "Limpieza dental", "duration_minutes": 45 }]
  },
  "branches": [{ "id": "<uuid>", "name": "Sucursal Centro" }, { "id": "<uuid>", "name": "Sucursal Plaza Sol" }],
  "generated_at": "2026-11-17T18:04:05.210Z"
}
```

`status` (valores cerrados):

| `status` | Significa | Qué debe hacer LANA |
|---|---|---|
| `single_branch` | La clínica tiene una sola sucursal activa. `branch` viene lleno. | Usarla sin preguntar. |
| `assigned` | La conversación ya tiene sucursal (`source` = `manual` o `ai`). | Responder con esos datos. |
| `unassigned` | Hay varias sucursales y la conversación no tiene una. `branch` es `null`, `branches` trae nombres exactos. | Preguntar al paciente cuál prefiere, con esos nombres, **antes** de hablar de horarios, direcciones o agendar. |
| `not_applicable` | Sin sucursales configuradas o función desactivada para la clínica. | Seguir con el contexto publicado de siempre. |

`hours[].weekday`: 0 = domingo … 6 = sábado, hora **local** de `timezone`. Una sucursal puede tener varios bloques el mismo día.

### 3.2 `set_branch` — el paciente eligió sucursal

Cuando el paciente responde a la pregunta (p. ej. «en Plaza Sol»), LANA lo informa y SMYL guarda la asignación con
`source: "ai"` (nunca pisa una asignación `manual`).

```json
{ "contract_version": 1, "action": "set_branch", "tenant_id": "<uuid>", "conversation_id": "<uuid>",
  "branch_id": "<uuid>", "occurred_at": "…" }
```

Respuesta: `{ "ok": true, "status": "assigned", "branch": { … igual que en context … } }`.
Si ya había una `manual` distinta: `409` con `{ "error": "branch_locked", "branch": { … la vigente … } }` y LANA usa esa.
`branch_id` que no pertenece a `tenant_id` o está inactiva → `404`.

### 3.3 `availability` — horarios libres reales (opcional, fase 2b)

```json
{ "contract_version": 1, "action": "availability", "tenant_id": "<uuid>", "conversation_id": "<uuid>",
  "service_id": "<uuid>", "branch_id": "<uuid>", "from": "2026-11-18T00:00:00-06:00", "to": "2026-11-25T00:00:00-06:00",
  "limit": 6, "occurred_at": "…" }
```

Respuesta: `{ "ok": true, "slots": [{ "starts_at": "…", "ends_at": "…", "branch_id": "…", "professional_id": "…",
"professional_name": "…" }] }` con la **misma regla** que la agenda de SMYL (horario de sucursal y dentista, servicio que hace,
sillón libre, bloqueos, citas y apartados vigentes). LANA **ofrece** horarios; no agenda. Elegir uno crea en SMYL una *solicitud
con apartado de 10 minutos* que una persona confirma (flujo actual `smyl_inbox_create_appointment_request` →
confirmación humana). Esa acción `reserve` se especificará aparte cuando 3.1 y 3.2 estén probadas.

## 4. Cómo debe usarlo el compilador de LANA

1. El bloque **«Sucursal de esta conversación»** va después del contexto de la clínica y **manda** sobre los datos de
   sucursales del texto publicado (dirección, horario, dentistas, servicios).
2. No inventar horarios ni dentistas que no vengan en el bloque. Si falta un dato: decir que la clínica lo confirmará.
3. `unassigned` y más de una sucursal → una sola pregunta corta con los nombres exactos; sin horarios hasta tener respuesta.
4. Mencionar horas siempre en la zona horaria de la sucursal.
5. Los límites clínicos existentes siguen igual (no diagnosticar, no prescribir, no revelar expedientes).
6. **Fallo abierto:** si SMYL no responde en 1.5 s o devuelve error, LANA responde con el contexto publicado de la clínica
   y lo registra; nunca deja sin respuesta al paciente ni bloquea el chat.

Alternativa a evaluar por LANA: en vez de precargar `context`, exponer las tres acciones como **herramientas del modelo**
(`get_branch_context`, `set_conversation_branch`, `check_availability`). SMYL recomienda **precargar `context` en cada turno**
(es barato y evita que el modelo olvide consultarlo) y usar herramientas solo para `set_branch` y `availability`.

## 5. Seguridad y privacidad

- Autenticación: HMAC sobre el cuerpo crudo (sección 2), comparación en tiempo constante, rechazo si `occurred_at` está fuera
  de ±5 min. Secreto propio de esta función (`SMYL_LANA_CONTEXT_SECRET`), distinto del de negociaciones, rotable.
- Solo datos **no clínicos** de la clínica: nada de nombres de pacientes, expedientes, cobros ni citas de terceros.
  Los horarios libres no revelan quién ocupa los demás.
- `tenant_id` lo resuelve LANA por el canal; SMYL lo usa como ámbito de cada consulta y **solo** devuelve sucursales de ese
  tenant. Un `conversation_id` desconocido para SMYL es válido (aún no tiene sucursal) y responde `unassigned`.
- Límite de uso: 600 solicitudes por minuto por tenant; superar → `429` con `Retry-After`.
- Todas las respuestas llevan `Cache-Control: no-store`.

## 6. Errores

`400` solicitud o `contract_version` inválidos · `403` firma inválida o fuera de tiempo · `404` sucursal/servicio inexistente ·
`409` `branch_locked` · `429` límite · `500` error interno (LANA aplica fallo abierto). Cuerpo: `{ "ok": false, "error": "<código>" }`.

## 7. Pruebas de aceptación (a cumplir juntos)

1. **Dos clínicas:** misma conversación de ejemplo en dos tenants; cada una recibe solo sus sucursales y datos.
2. **Clínica de una sucursal:** `single_branch`; el asistente no pregunta nada.
3. **Tres sucursales sin asignar:** el asistente pregunta con los tres nombres exactos y no da horarios.
4. **Respuesta del paciente:** el asistente llama `set_branch`; el siguiente mensaje usa la dirección y el horario de esa sede, y
   la bandeja de SMYL muestra la sucursal en la conversación.
5. **Asignación manual previa:** `set_branch` devuelve `409` y el asistente sigue con la sucursal manual.
6. **Cambio de horario en SMYL:** en ≤ 60 s la siguiente respuesta usa el horario nuevo (sin volver a publicar la capacitación).
7. **SMYL caído o lento (> 1.5 s):** el asistente responde con el contexto publicado.
8. **Firma inválida / reloj desfasado:** `403`, sin datos.
9. **Zona horaria:** una sucursal en otra zona horaria que la clínica se muestra en la suya.

## 8. Despliegue

1. SMYL construye y prueba `lana-branch-context` (acciones 3.1 y 3.2) con pruebas automáticas y un simulador; la despliega la
   clínica con `supabase functions deploy lana-branch-context --no-verify-jwt` y define `SMYL_LANA_CONTEXT_SECRET`.
2. LANA activa el bloque por clínica con un interruptor (`ia_config.branch_context = true`), empezando por una clínica de prueba.
3. Piloto de una semana; medir: % de conversaciones con sucursal asignada antes del primer horario, tiempo de respuesta de SMYL,
   veces que se usó el fallo abierto.
4. Después, acción `availability` (3.3) y, aparte, `reserve`.

## 9. Preguntas abiertas para LANA

1. ¿Presupuesto de latencia por turno y dónde se puede insertar una consulta previa a la generación?
2. ¿Prefieren precarga, herramientas del modelo, o ambas?
3. ¿LANA ya persiste la sucursal por conversación o puede hacerse solo en SMYL (propuesta)?
4. ¿Canales con particularidades (Instagram/Messenger sin teléfono) que afecten qué conversación se identifica?
5. ¿Dónde y cómo se rota el secreto compartido?
