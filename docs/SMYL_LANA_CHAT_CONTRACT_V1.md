# Contrato SMYL ↔ LANA para Chat v1

**Estado:** implementación local completa hasta la puerta de piloto  
**Versión de protocolo:** `1.5`  
**Fecha:** 20 de octubre de 2026

Este documento convierte la arquitectura funcional del Chat de SMYL en una
frontera técnica verificable. Complementa `SMYL_CHAT_ARCHITECTURE.md` y
prevalece cuando exista duda sobre qué sistema es dueño de un dato.

## 1. Decisión de propiedad

LANA es la fuente canónica de canales, conversaciones y mensajes. Conserva:

- OAuth y Embedded Signup de Meta;
- tokens, webhooks y adaptadores de WhatsApp, Messenger e Instagram;
- identidad externa del contacto, historial, estados de entrega y ventana de
  WhatsApp;
- pausa humano/IA, asignación operativa y ejecución del asistente;
- versión publicada de la capacitación que utiliza el runtime.

SMYL es la fuente canónica dental. Conserva:

- clínica, miembros y permisos propios;
- pacientes y expediente confirmado;
- citas, casos, fotografías privadas, simulaciones y revisión clínica;
- propuestas, consentimientos y seguimientos;
- el vínculo confirmado entre una conversación LANA y un paciente/caso SMYL.

No se crea una segunda bandeja canónica ni se replican los mensajes en tablas
de SMYL. Una vista local puede mantener estado efímero de interfaz, pero siempre
se reconcilia contra LANA.

## 2. Identidad y autenticación

Existe una relación única y auditable:

```text
tenant SMYL 1 ─── 1 tenant LANA
```

La API key identifica al tenant LANA y sólo se usa entre Edge Functions. SMYL
la cifra con AES-256-GCM. SMYL nunca recibe `access_token`, `refresh_token`,
`api_key` en claro en el navegador, secretos de webhook ni credenciales de
`service_role`.

El navegador se autentica ante SMYL con Supabase Auth. Cada Edge Function:

1. resuelve el tenant desde la sesión, nunca desde un `tenant_id` enviado por
   el cliente;
2. verifica rol y asignación cuando corresponda;
3. descifra la credencial LANA solamente en memoria;
4. llama un endpoint permitido de LANA;
5. devuelve al navegador un DTO mínimo sin credenciales.

Las solicitudes incluyen:

```http
Authorization: Bearer <api-key-cifrada-en-reposo>
X-SMYL-LANA-Contract-Version: 1.5
```

## 3. Contrato de API

Endpoints existentes que continúan durante la transición:

| Método | Ruta | Uso |
|---|---|---|
| `GET` | `/contract` | Versión, propiedad y capacidades públicas del contrato. |
| `GET` | `/conversations` | Bandeja paginada del tenant. |
| `GET` | `/conversations/:id` | Identidad mínima para vinculación confirmada. |
| `GET` | `/conversations/:id/messages` | Hilo solicitado por un usuario autorizado. |
| `GET` | `/attention` | Señales operativas sin copiar contenido. |
| `POST` | `/attention/:id/resolve` | Resuelve la señal; no borra ni reactiva IA. |
| `POST` | `/send` | Compatibilidad de envío de texto durante la transición. |
| `GET/PUT` | `/context` | Contexto dental actual compatible. |
| `POST` | `/context/preview` | Prueba sin envío ni persistencia de conversación. |

Endpoints de las etapas 1 y 2 con implementación local:

| Método | Ruta | Uso |
|---|---|---|
| `POST` | `/provision` | Crear o vincular tenant LANA de forma idempotente (credencial de plataforma). |
| `GET` | `/channels` | Estado sanitario de los tres canales, sin tokens. |
| `POST` | `/channels/:channel/setup-session` | URL firmada, de un uso y corta duración. |
| `DELETE` | `/channels/:channel` | Desconexión explícita, autorizada y auditable (1.5). |
| `GET` | `/training` | Borrador y versión publicada. |
| `PUT` | `/training/draft` | Guardar sin afectar producción. |
| `POST` | `/training/validate` | Validación clínica y estructural. |
| `POST` | `/training/publish` | Publicación atómica y versionada. |
| `GET` | `/training/versions` | Historial y restauración controlada. |
| `POST` | `/training/restore` | Copiar una versión inmutable a un nuevo borrador; no publica. |
| `POST` | `/training/preview` | Prueba exacta del compilador de producción. |

Endpoints de la etapa 3 con implementación local:

| Método | Ruta | Uso |
|---|---|---|
| `GET` | `/inbox` | Bandeja paginada y filtrada conforme al actor autenticado. |
| `GET` | `/inbox/sync` | Cambios incrementales para sincronización segura. |
| `GET` | `/inbox/conversations/:id/messages` | Hilo canónico con paginación anterior o incremental. |
| `POST` | `/inbox/conversations/:id/messages` | Envío manual idempotente y pausa humana automática. |
| `POST` | `/inbox/conversations/:id/read` | Marca lectura y limpia no leídos. |
| `POST` | `/inbox/conversations/:id/assign` | Toma o asigna la conversación según rol. |
| `POST` | `/inbox/conversations/:id/release` | Libera una asignación operativa. |
| `POST` | `/inbox/conversations/:id/pause` | Pausa a LANA para atención humana. |
| `POST` | `/inbox/conversations/:id/resume` | Reactiva a LANA sin enviar un mensaje. |
| `POST` | `/inbox/conversations/:id/resolve` | Cierra la solicitud de intervención humana. |

Extensiones implementadas localmente en las etapas 4 a 7:

| Método | Ruta | Uso |
|---|---|---|
| `POST` | `/inbox/conversations/:id/attachments` | Medio privado validado por capacidad del canal. |
| `GET/POST` | `/inbox/conversations/:id/messages/:messageId/*` | Detalle mínimo, destacado, soft-delete y reenvío autorizados. |
| `POST` | `/inbox/conversations/:id/copilot` | Borrador o resumen interno; nunca envía. |
| `POST` | `/inbox/conversations/:id/copilot/feedback` | Evaluación atribuida sin autoentrenamiento. |
| `POST` | `/inbox/conversations/:id/resume-context` | Reanudación IA/humano con contexto revisado. |
| `GET` | `/inbox/whatsapp/templates` | Plantillas `UTILITY` activas y aprobadas del tenant. |
| `GET/POST` | `/inbox/conversations/:id/scheduled` | Consulta o crea un programado idempotente. |
| `POST` | `/inbox/conversations/:id/scheduled/:scheduledId/cancel` | Cancela un pendiente o reintento aún no tomado. |
| `POST` | `/inbox/conversations/:id/scheduled/:scheduledId/retry` | Recupera un fallo sólo cuando Meta confirmó que es seguro. |
| `POST` | `/inbox/conversations/:id/automation` | Excepción de reactivación por conversación. |
| `GET` | `/inbox/operations` | Métricas, consumo, alertas, límites y puerta del piloto. |

Extensiones de las versiones 1.3 a 1.5, desplegadas en LANA el 20 de octubre
de 2026 (promodesk #1234 y #1235):

| Método | Ruta | Uso |
|---|---|---|
| `POST` | `/inbox/whatsapp/templates` | Solicitar una plantilla de WhatsApp a Meta (1.3, capacidad `template_create`). |
| `GET` | `/inbox/stages` | Etapas del embudo del tenant (`chat_segmentos`) para el Pipeline. |
| `POST` | `/inbox/conversations/:id/pin` | Fijar una conversación. |
| `POST` | `/inbox/conversations/:id/unpin` | Quitar la fijación. |
| `POST` | `/inbox/conversations/:id/stage` | Mover a una etapa del tenant; registra `stage_changed`. |
| `GET` | `/inbox/conversations/:id/search` | Búsqueda dentro de un hilo. |
| `GET` | `/inbox/conversations/:id/shared` | Archivos y enlaces compartidos en el hilo. |
| `GET` | `/inbox/quick-replies` | Respuestas rápidas del tenant. |
| `POST` | `/inbox/pilot` | Puerta de piloto del Inbox. |
| `DELETE` | `/channels/:channel` | Desconectar un canal (sustituye a `disconnect`). |

Pendiente para la 1.6: sucursal y prioridad en el DTO, filtros por responsable,
etapa y sucursal, lectura de `copilot/feedback`, ventanas de 24 h y CRUD de
etapas con semilla dental.

La identidad del actor no procede del navegador: `lana-inbox` la resuelve de
la sesión de SMYL y LANA sólo acepta las cabeceras internas enviadas por esa
Edge Function. El navegador tampoco recibe el identificador externo del
contacto ni la credencial vinculada.

`POST /provision` no estará disponible con la API key de una clínica que aún
no existe. Usará una credencial de plataforma separada, limitada a alta y
vinculación. El flujo para una cuenta LANA existente seguirá aceptando el
código de enlace actual.

## 4. Idempotencia y concurrencia

Toda operación que cree, envíe, publique, vincule o desconecte acepta:

```http
Idempotency-Key: <uuid estable generado por SMYL>
```

LANA debe persistir tenant, operación, clave, hash del payload y resultado. La
misma clave con el mismo payload devuelve el resultado original; con un payload
distinto devuelve `409`. Las operaciones de sólo lectura no requieren clave.

El vínculo conversación-paciente permanece único por
`tenant_id + lana_conversation_id`. Los eventos de Meta se deduplican en LANA
antes de producir mensajes, acciones o respuestas de IA.

## 5. DTO y minimización

La bandeja puede recibir identificador opaco, canal, nombre visible, hora,
no-leídos, asignación, prioridad y estado IA/humano. La Ficha 360 solicita los
datos clínicos directamente a SMYL mediante identificadores vinculados.

Quedan prohibidos en cualquier respuesta hacia el navegador:

- tokens o secretos;
- claves privadas o cabeceras de autorización;
- configuración interna de proveedores;
- datos de otro tenant;
- fotografías o expedientes sin autorización y URL firmada;
- inferencias de IA presentadas como hechos clínicos confirmados.

## 6. Capacidades conservadoras por canal

Hasta que `/channels` informe una capacidad, el frontend la considera no
disponible. En v1 todos los canales permiten bandeja y texto. Medios, citas,
ubicación, plantillas, audio, respuestas citadas y ventana de 24 horas se
habilitan únicamente cuando el adaptador real los anuncie.

El frontend nunca deduce capacidades por nombre de canal ni presenta una
acción que LANA vaya a rechazar.

## 7. Fallos y auditoría

Errores utilizan HTTP real y un cuerpo estable:

```json
{
  "error": {
    "code": "stable_machine_code",
    "message": "Mensaje seguro para el usuario",
    "request_id": "uuid"
  }
}
```

La compatibilidad actual con `{ "error": "texto" }` se mantiene hasta que los
clientes adopten el sobre v1. Nunca se registran tokens ni contenido clínico en
logs. Cada mutación registra tenant, actor, operación, objetivo, resultado,
versión del contrato y fecha.

Los programados usan `retrying` para rechazo transitorio y `dead_letter` para
un resultado terminal o que requiere revisión. `retry_safe=false` significa
que Meta pudo haber aceptado el mensaje; ningún cliente puede forzar su
reenvío. Los límites temporales devuelven `429` con `retry_after_seconds` y
`reset_at`. El endpoint operativo devuelve sólo conteos, estados y códigos;
nunca contenido del chat, teléfonos, tokens o datos clínicos.

## 8. Gates de las siguientes etapas

- **Etapa 1:** aprovisionamiento y conexiones Meta desde SMYL.
- **Etapa 2:** capacitación dental con borrador/publicación/versiones.
- **Etapa 3:** Inbox completo consumiendo LANA como fuente canónica.
- **Etapa 4:** Ficha 360 y vínculos clínicos confirmados.
- **Etapa 5:** Copilot interno, reanudación contextual y feedback auditable.

La etapa 4 implementa medios únicamente sobre capacidades declaradas por cada
adaptador. Los archivos clínicos viven en almacenamiento privado y se entregan
con URL firmada de corta duración. Destacar y soft-delete son mutaciones
idempotentes y auditadas en LANA. La Ficha 360 se resuelve en SMYL después de
un handoff confirmado y sólo expone campos permitidos; el vínculo clínico
persiste identificadores, nunca una segunda copia del mensaje o de la imagen.

Ninguna etapa puede introducir tokens de Meta en SMYL, confiar en un tenant del
body, copiar el historial como segunda fuente o ejecutar una acción clínica a
partir de texto libre del modelo.

La etapa 5 agrega tres operaciones autenticadas sobre una conversación:
`copilot`, `copilot/feedback` y `resume-context`. El servidor de SMYL deriva
tenant, actor y snapshot dental; LANA vuelve a validar acceso, asignación y
capacitación publicada. Copilot lee como máximo el tramo reciente del historial
canónico, devuelve `sends_message: false` y sólo expone un catálogo de
herramientas disponible según hechos confirmados.

El navegador no puede marcar una simulación como autorizada. Esa capacidad se
deriva del estado de envío profesional existente en SMYL. El feedback se guarda
de forma inmutable e idempotente y no publica conocimiento. Reanudar exige que
el miembro revise el resumen; una RPC lo registra, elimina la solicitud humana
y despausa al asistente dentro de la misma operación auditada. Los webhooks lo
incorporan sólo en la primera respuesta posterior como contexto no
autoritativo; nunca sustituye una herramienta ni confirma hechos clínicos.
