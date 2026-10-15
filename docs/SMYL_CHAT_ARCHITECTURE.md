# Arquitectura del módulo de Chats de SMYL

**Versión:** 1.2  
**Fecha:** 11 de octubre de 2026  
**Referencia funcional:** arquitectura actual del Chat de LANA  
**Objetivo:** reproducir su solidez operativa, multi-tenant y omnicanal,
adaptándola al flujo dental de SMYL.

## 0. Acuerdo vinculante de implementación

SMYL adopta la arquitectura funcional de LANA mediante integración, no por
duplicación. El contrato técnico vigente es
`docs/SMYL_LANA_CHAT_CONTRACT_V1.md`.

```text
Meta → webhooks/adaptadores LANA → historial y runtime IA LANA
                                      │ API servidor a servidor
                                      ▼
                              experiencia dental SMYL
                              pacientes · citas · casos
```

- **LANA** conserva OAuth, tokens, webhooks, canales, conversaciones, mensajes,
  estados de entrega, pausa humano/IA y ejecución del asistente.
- **SMYL** conserva pacientes, expedientes, citas, fotografías privadas,
  casos, simulaciones, propuestas, consentimientos y seguimientos.
- La API key vincula un tenant SMYL con uno LANA; no reemplaza OAuth de Meta.
- Las referencias de este documento a `camila_conversaciones`,
  `camila_mensajes`, webhooks o adaptadores describen el dominio canónico que
  corre en LANA. No autorizan crear una segunda fuente de chat en SMYL.
- La interfaz Inbox vive en SMYL, pero consulta y muta LANA mediante Edge
  Functions autenticadas. Sólo los vínculos clínicos confirmados se persisten
  en SMYL.

## 1. Decisión de producto

El Chat de SMYL no será un componente independiente ni una ventana de soporte.
Será una capa de orquestación entre:

```text
canales + IA + clínica + pacientes + citas + fotografías
+ simulaciones + revisión clínica + propuestas + archivos + seguimiento
```

La réplica debe conservar la separación arquitectónica de LANA, pero no copiar
sus dominios comerciales que no corresponden a SMYL. Catálogo, Reglas de Arte,
pedidos y facturación comercial se reemplazan por expediente, casos,
simulaciones, plan sugerido, cotización dental, consentimiento y cita.

SMYL tendrá dos asistentes claramente distintos:

- **SMYL Asistente para pacientes:** responde en WhatsApp, Messenger e
  Instagram dentro de las reglas de la clínica. Puede orientar, recopilar
  fotografías, compartir resultados autorizados y solicitar una cita.
- **SMYL Copilot clínico:** asistente interno para dentistas y asesores. Resume
  el hilo, propone respuestas y organiza datos, pero no atiende directamente al
  paciente sin una acción o regla explícita.

## 2. Estado actual real

Existe una base inicial/legada con nombres `camila_*`, pero todavía no un
módulo equivalente. Bajo el acuerdo de la sección 0, cualquier pieza de chat
que permanezca en SMYL es transitoria o una proyección, nunca la fuente
canónica:

- `camila_canales`: registra identificadores de WhatsApp, Messenger e Instagram
  por `tenant_id`.
- `camila_conversaciones`: mantiene un resumen mínimo por contacto/canal.
- `camila_mensajes`: conserva texto entrante y saliente en una tabla unificada.
- `meta-webhook`: valida firma y recibe texto básico de los tres canales.
- `meta-send`: permite enviar texto desde una sesión autenticada.
- `app.html`: carga `smyl-inbox.js/css`, una bandeja operativa que consulta el
  hilo canónico de LANA mediante una Edge Function autenticada de SMYL.

Brechas críticas frente a LANA:

- No hay adjuntos reales, citas, reenvío, estados de entrega o soft-delete.
- No existe Ficha clínica 360, pipeline ni vinculación segura con pacientes.
- No hay ventana de 24 horas, plantillas ni mensajes programados.
- No existe feedback para mejorar al asistente.
- El webhook sólo cubre una parte de los tipos de evento y no tiene aún pruebas
  con tráfico real de Meta.

La etapa 3 ya cubre localmente asignación multiusuario, permisos operativos,
pausa/reanudación, cola optimista, reconciliación y la interfaz de Inbox. Las
brechas restantes pertenecen a medios/contexto dental, WhatsApp avanzado y al
piloto real de las etapas siguientes.

Por lo tanto, la base actual debe evolucionar mediante migraciones; no debe
presentarse como un chat terminado ni extenderse acumulando lógica en
`app.html`.

## 3. Arquitectura de alto nivel

```text
WhatsApp / Messenger / Instagram
                 │
                 ▼
        Webhooks verificados de Meta
                 │
       ┌─────────┴──────────┐
       ▼                    ▼
Historial normalizado    Estado operativo
camila_mensajes       camila_conversaciones
       │                    │
       └─────────┬──────────┘
                 ▼
       Orquestador conversacional SMYL
       + configuración de la clínica
       + memoria confirmada del paciente
       + citas, casos y simulaciones
       + herramientas clínicas seguras
                 │
          ┌──────┴────────┐
          ▼               ▼
 Respuesta automática  Solicitud de humano
          │               │
          └──────┬────────┘
                 ▼
       Inbox clínico multiusuario
                 │
       Respuesta manual mediante
       Edge Function segura
                 │
                 ▼
       Adaptador Graph API por canal
```

Se mantienen separados:

1. Adaptadores de canal.
2. Persistencia del historial.
3. Resumen y estado operativo de la conversación.
4. Orquestador de IA.
5. Herramientas deterministas de negocio/ clínica.
6. Interfaz del equipo.
7. Seguridad, permisos y auditoría.

## 4. Dominio clínico de SMYL

Cada conversación puede relacionarse con:

- Contacto del canal.
- Paciente confirmado.
- Cita.
- Uno o varios casos de diseño de sonrisa.
- Fotografías originales y documentación clínica.
- Simulaciones generadas y su estado de revisión.
- Propuesta o cotización dental.
- Consentimiento y autorizaciones de uso/compartición.
- Seguimientos y recordatorios.

La conversación no almacena copias libres de esos datos. Conserva vínculos a
las entidades canónicas y un resumen operacional para la bandeja.

## 5. Modelo de datos objetivo

Los nombres físicos actuales `camila_*` del dominio de chat se conservan en
LANA durante la transición para no romper código ni migraciones. SMYL no crea
copias paralelas de estas tablas; consume DTO versionados y conserva solamente
sus entidades clínicas y vínculos confirmados. El producto visible utiliza
SMYL.

### 5.1 `camila_conversaciones`

Una fila por:

```text
tenant_id + canal_id + contacto_id_externo
```

Campos actuales que permanecen:

- `id`, `tenant_id`, `canal_id`, `contacto_id_externo`.
- `nombre_contacto`, `paciente_id`.
- `no_leidos`, `ultimo_mensaje_en`, `ultimo_mensaje_texto`.
- `created_at`.

Campos que deben añadirse por migración:

```json
{
  "ultimo_mensaje_rol": "paciente | asistente | asesor",
  "ultimo_mensaje_paciente_at": "timestamp",
  "necesita_asesor": false,
  "resumen_asesor": null,
  "pausado": false,
  "pausado_desde": null,
  "asesor_ultima_respuesta_at": null,
  "auto_reactivar_ia_horas": null,
  "asignado_a": null,
  "segmento_id": null,
  "visto_asesor_en": null,
  "fijado": false,
  "destacada": false,
  "prioridad": "alta | media | baja | null",
  "perfil_ia": {},
  "perfil_ia_actualizado_at": null,
  "cita_id": null,
  "caso_activo_id": null,
  "origen_campana_url": null,
  "es_simulacion": false,
  "updated_at": "timestamp"
}
```

`modo` debe migrar gradualmente a `pausado`; un booleano con marcas temporales
describe mejor el control humano/IA que un texto aislado.

### 5.2 `camila_mensajes`

Se conserva una tabla normalizada para los tres canales, siempre que cada fila
registre el canal y los identificadores externos suficientes.

Campos que deben añadirse:

```json
{
  "tenant_id": "uuid",
  "rol": "user | assistant",
  "autor_tipo": "paciente | ia | asesor | sistema",
  "autor_usuario_id": "uuid | null",
  "media_url": "text | null",
  "media_tipo": "imagen | documento | audio | ubicacion | null",
  "media_nombre": "text | null",
  "media_tamano": "bigint | null",
  "responde_a_id": "uuid | null",
  "reenviado": false,
  "destacado": false,
  "estado_envio": "pendiente | enviado | entregado | leido | fallido",
  "error_envio": "text | null",
  "eliminado_at": "timestamp | null",
  "eliminado_por": "uuid | null",
  "metadata": {}
}
```

Requisitos de integridad:

- Índice único parcial para `id_externo_meta` cuando no sea nulo.
- El `tenant_id` de cada mensaje debe coincidir con el de su conversación.
- `responde_a_id` sólo puede señalar un mensaje de la misma conversación.
- Borrado lógico; nunca eliminar el registro de auditoría por una acción normal
  del usuario.

### 5.3 Tablas nuevas

- `camila_chat_segmentos`: pipeline configurable por clínica.
- `camila_chat_respuestas_rapidas`: atajos por tenant.
- `camila_chat_comentarios_ia`: evaluación y conducta ideal.
- `camila_chat_programados`: cola de mensajes futuros.
- `camila_paciente_ficha_items`: hechos confirmados por el equipo.
- `camila_paciente_seguimientos`: tareas y recordatorios.
- `camila_chat_adjuntos`: opcional si el detalle de medios supera el contrato de
  `camila_mensajes`.
- `camila_chat_eventos`: auditoría de asignación, pausa, reanudación, vínculo,
  borrado y acciones sensibles.

Las tablas de pacientes, citas, casos, simulaciones y cotizaciones deben ser
entidades canónicas; la Ficha 360 las consulta, no las duplica.

## 6. Identidad de contacto y paciente

SMYL diferencia:

1. **Identidad del canal:** nombre, foto y teléfono/PSID/IGSID de Meta.
2. **Contacto:** la persona que escribe.
3. **Paciente:** expediente canónico confirmado por la clínica.

Reglas:

- Mostrar en primer lugar el nombre del contacto.
- Sugerir paciente por teléfono normalizado, nunca vincular automáticamente.
- Confirmar sólo cuando exista un candidato inequívoco.
- Si hay varias coincidencias, mostrar conflicto y búsqueda manual.
- Permitir búsqueda por nombre, teléfono, correo o identificador de expediente.
- Crear paciente desde el chat con control de duplicados.
- Vincular no sobrescribe datos clínicos ni fiscales confirmados.
- `perfil_ia` sólo contiene inferencias; los hechos confirmados viven en la ficha
  canónica.

## 7. Vistas del módulo

### 7.1 Bandeja

Filtros mínimos:

- Todas.
- Sin leer.
- Por atender.
- Mías.
- Canal.
- Asignación.
- Pausadas/SMYL activo.
- Fijadas.
- Prioridad.
- Etapa clínica/comercial.

Cada fila muestra:

- Avatar y nombre del contacto.
- Paciente vinculado como dato secundario.
- Canal.
- SMYL Asistente activo o pausado.
- Asignación.
- Prioridad/etapa.
- No leídos.
- Último mensaje y hora.

Orden: fijadas primero; después por `ultimo_mensaje_en` descendente.

### 7.2 Pipeline dental

Columnas iniciales recomendadas:

1. Sin clasificar.
2. Nuevo prospecto.
3. Fotografías pendientes.
4. En análisis.
5. Revisión clínica.
6. Propuesta enviada.
7. Cita agendada.
8. Tratamiento aceptado.

Las clínicas pueden crear, renombrar, reordenar, plegar y archivar columnas.
Eliminar una columna devuelve sus conversaciones a “Sin clasificar”. Arrastrar
siempre tiene una alternativa accesible “Mover a”.

### 7.3 Calidad de IA

Reúne:

- Respuestas destacadas.
- Comentarios del equipo.
- Contexto anterior y posterior.
- Conducta o respuesta ideal.
- Propuesta de ajuste a instrucciones.

Ningún ajuste se publica automáticamente. Un administrador debe revisarlo y
aprobarlo.

### 7.4 Ventana de WhatsApp

- Abierta: más de cinco horas restantes.
- Próxima a vencer: cinco horas o menos.
- Vencida: sólo permite plantilla aprobada.

El contador se calcula desde `ultimo_mensaje_paciente_at` y se actualiza cada
minuto. Nunca habilitar texto libre fuera de la ventana si Meta no lo permite.

## 8. Hilo

Comportamientos obligatorios:

- Cargar el bloque reciente y paginar hacia atrás conservando scroll.
- Mantener el hilo abajo sólo si el usuario ya estaba abajo.
- Mostrar “Ir al final” cuando llega un mensaje durante revisión histórica.
- Cancelar consultas obsoletas al cambiar rápidamente de conversación.
- Aislar por conversación la cola optimista y sus fallos.
- Reconciliar mensaje temporal con eco de Realtime/Meta sin duplicarlo.
- Marcar leído y registrar `visto_asesor_en` al abrir.

Contenido soportado:

- Texto, imagen, documento, audio y ubicación según canal.
- Mensaje citado y reenviado.
- Autor visible: paciente, SMYL Asistente o miembro del equipo.
- Estado pendiente, enviado, entregado, leído o fallido.
- Destacado y borrado lógico.
- Tarjeta contextual para fotografía dental, simulación, cita o propuesta.

Acciones por mensaje:

- Responder citando.
- Reenviar dentro del mismo tenant.
- Destacar.
- Enviar a revisión clínica cuando sea una fotografía.
- Vincular a un caso.
- Borrar de SMYL mediante soft-delete.
- Reintentar o descartar un envío fallido.

## 9. Compositor

Funciones:

- Texto multilínea.
- Respuesta citada.
- Respuestas rápidas `/atajo`.
- Sugerencia y mejora de redacción mediante Copilot.
- Imagen, documento y portapapeles.
- Drag and drop en escritorio.
- Vista previa y eliminación antes de enviar.
- Nota de voz en WhatsApp.
- Ubicación de la clínica.
- Programar mensaje.
- Plantilla aprobada de WhatsApp.
- Compartir simulación revisada, propuesta o enlace de cita mediante tarjetas
  estructuradas, no copiando URLs a mano.

La disponibilidad se decide por una matriz de capacidades del canal. El
frontend nunca muestra una acción que el adaptador/backend rechazará.

## 10. Control humano e IA

Contrato:

```text
pausado = false → SMYL Asistente puede responder
pausado = true  → conserva entradas, pero no responde
```

Reglas:

- Una respuesta humana pausa automáticamente al asistente.
- El cambio manual de estado es visible y auditable.
- `pausado_desde` inicia el episodio humano.
- `asesor_ultima_respuesta_at` se actualiza con cada intervención.
- La reanudación recupera todo el contexto desde `pausado_desde`.
- Resolver una solicitud limpia `necesita_asesor` y `resumen_asesor`, pero no
  elimina ni “cierra” el historial.
- La reactivación automática considera configuración general, excepción por
  conversación, inactividad y ventana de WhatsApp.
- Cuando la IA solicita humano: marca la conversación, guarda un resumen y la
  ubica en “Por atender”.

## 11. Asignación multiusuario

Estados:

- Sin asignar.
- Asignada a un miembro del equipo.

Permisos:

- Dueño/admin: asigna o reasigna cualquier conversación del tenant.
- Asesor: toma una sin asignar, opera las propias y libera las propias.
- No puede operar conversaciones de otro usuario cuando la política del tenant
  lo prohíbe.

Validación doble:

1. RLS en consultas y actualizaciones del navegador.
2. Verificación explícita en cada Edge Function con `service_role`.

## 12. Ficha clínica 360

Panel contextual de la conversación:

- Datos del contacto y paciente confirmado.
- Alertas y notas internas no diagnósticas.
- Consentimientos.
- Citas y seguimientos.
- Casos y estado de revisión clínica.
- Fotografías y archivos compartidos.
- Simulaciones autorizadas/rechazadas.
- Propuestas y cotizaciones.
- Origen de campaña.
- Resumen sugerido por Copilot.

Regla fundamental:

- La IA propone información estructurada.
- El equipo confirma antes de guardarla en el expediente.
- La IA nunca sobrescribe datos clínicos, antecedentes o consentimiento.

“Compilar conversación” es manual y produce un borrador revisable.

## 13. Herramientas deterministas del asistente

El modelo redacta y propone intenciones. El código ejecuta operaciones reales:

- Consultar disponibilidad de citas.
- Crear una solicitud de cita.
- Compartir instrucciones fotográficas.
- Verificar si ya existen fotografías suficientes.
- Consultar estado de una simulación.
- Compartir únicamente resultados aprobados.
- Consultar servicios y precios configurados por la clínica.
- Crear una propuesta/cotización desde servicios reales.
- Solicitar asesor.
- Crear seguimiento.
- Asociar un archivo o fotografía a un caso.

Nunca confiar en un precio, diagnóstico, disponibilidad o estado de caso escrito
libremente por el modelo. Cada dato sale de una función determinista.

## 14. Contrato de respuesta manual

La función actual `meta-send` debe evolucionar o sustituirse por
`chat-responder` sin romper clientes durante la transición.

Debe exigir:

- Sesión real de Supabase Auth.
- Membresía en el tenant.
- Permiso sobre la conversación según asignación.
- Conversación real del mismo tenant.
- Compatibilidad del tipo de mensaje con el canal.

Flujo:

1. Validar autenticación, tenant, rol y asignación.
2. Resolver canal y credenciales únicamente en servidor.
3. Validar contenido/adjunto.
4. Enviar mediante el adaptador del canal.
5. Conservar `wamid` o `mid` real.
6. Persistir el mensaje.
7. Actualizar el resumen.
8. Pausar al asistente y registrar actividad humana.
9. Devolver la fila persistida para reconciliar el optimista.

## 15. Entrada por webhooks

Todos los webhooks y adaptadores de Meta se ejecutan en LANA. SMYL no registra
un segundo callback para WhatsApp, Messenger o Instagram. Todos los adaptadores
de LANA deben:

- Verificar firma de Meta sobre el body crudo.
- Resolver tenant por identificador de cuenta.
- Deduplicar antes de cualquier efecto.
- Persistir texto y adjuntos.
- Descargar medios en servidor y guardarlos en almacenamiento privado.
- Actualizar la conversación y no leídos.
- Aplicar debounce a ráfagas.
- Usar candado/idempotencia para evitar respuestas dobles.
- Consultar `pausado` antes de generar respuesta.
- Responder pronto a Meta y registrar fallos internos para reintento controlado.

No se debe responder siempre 200 descartando silenciosamente un procesamiento
fallido. La recepción y el trabajo pesado deben separarse mediante un registro de
evento/cola para poder reconocer el webhook rápidamente y reprocesar de forma
auditable.

## 16. Realtime y consistencia

Las suscripciones del Inbox se originan en LANA o en un stream autorizado por
su API; el navegador de SMYL no recibe credenciales de la base de LANA.
Suscripciones mínimas:

- `camila_conversaciones` filtrada por `tenant_id`.
- `camila_chat_segmentos` filtrada por `tenant_id`.
- Mensajes de la conversación abierta o mecanismo equivalente seguro.

La implementación de la etapa 3 usa ese mecanismo equivalente: `GET
/inbox/sync` consulta cambios incrementales cada cinco segundos mientras la
pantalla está visible, y el hilo abierto solicita sólo mensajes posteriores al
último confirmado. Esto conserva la frontera servidor a servidor, permite
reconciliar el eco de un envío y evita entregar al navegador una clave o token
de Realtime del proyecto de LANA.

La lista se actualiza con cualquier cambio operativo. El hilo sólo se recarga
cuando existe un mensaje nuevo o una acción que modifica su contenido.

Casos contemplados:

- Eventos fuera de orden.
- Cambio rápido de chat.
- Eco del propio envío.
- Doble webhook.
- Reintento de Meta.
- Teléfono normalizado de forma distinta.
- Dos pestañas o asesores operando simultáneamente.
- Desconexión temporal y posterior reconciliación.

## 17. Seguridad y privacidad

1. Todo registro pertenece explícitamente a un `tenant_id`.
2. RLS protege todas las consultas del navegador.
3. Tokens de Meta y `service_role` nunca llegan al cliente.
4. Cada Edge Function revalida tenant, rol y asignación.
5. Citar, reenviar, borrar o vincular exige pertenencia a la conversación.
6. Webhooks validan firma y deduplican eventos.
7. Operaciones sensibles son idempotentes o usan candados.
8. Adjuntos validan tipo, tamaño, extensión real y origen.
9. Fotografías dentales usan Storage privado y URL firmada temporal.
10. La IA no ejecuta acciones sin validación determinista.
11. Inferencias de IA no sustituyen datos confirmados.
12. Borrado lógico y acciones administrativas quedan auditados.
13. Conversaciones simuladas se identifican y aíslan de pacientes reales.
14. Notificaciones no exponen fotografía, diagnóstico ni datos sensibles en
    pantalla bloqueada.
15. La retención y eliminación de mensajes/fotografías se comunica y aplica por
    política del tenant y legislación aplicable.

## 18. Interfaz y responsive

Debe cumplir `docs/POLITICA_IMAGEN_SMYL.md`.

Escritorio:

- Bandeja redimensionable a la izquierda.
- Hilo en el centro.
- Ficha clínica 360 a la derecha.
- Pipeline y análisis de IA como vistas hermanas del Inbox.

Móvil:

- Inicia en bandeja.
- El hilo ocupa el viewport al abrir.
- Atrás vuelve primero a la bandeja.
- Ficha 360 abre como pantalla o bottom sheet.
- El compositor considera `visualViewport`, teclado virtual y safe areas.
- Menús potencialmente recortados se montan mediante portal.

Visual:

- Inter y tokens SMYL.
- App oscura sólo en experiencia/captura; Inbox administrativo claro.
- Azul clínico para acción; teal para estados auxiliares.
- Sin gradientes decorativos, brillos o emojis como controles.
- Iconos Lucide.
- WCAG 2.2 AA, teclado, foco, estados de carga/vacío/error/reintento.

## 19. Orden de construcción

### Etapa 0 — contrato y pruebas

- Congelar este documento y el contrato v1.
- Publicar una matriz conservadora de capacidades por canal.
- Probar frontera de tenant, rutas permitidas y ausencia de secretos.

### Etapa 1 — conexión de LANA y Meta desde SMYL

- Aprovisionar o vincular el tenant LANA de forma idempotente.
- Mostrar estado de WhatsApp, Messenger e Instagram sin tokens.
- Crear sesiones firmadas y de un uso para OAuth/Embedded Signup.

**Implementada localmente el 2026-10-11.** Falta aplicar migraciones, configurar
secrets, desplegar las Edge Functions y completar la configuración/App Review
de Meta antes de probar cuentas reales. La desconexión auditable continúa como
gate separado; la UI no simula esa capacidad.

### Etapa 2 — Capacitar LANA para odontología

- Configuración dental estructurada y límites clínicos no editables.
- Borrador, validación, publicación, versiones y restauración.
- Laboratorio que utiliza el mismo compilador que producción.

**Implementada localmente el 2026-10-11.** El editor de SMYL separa borrador
de publicación, valida estructura y contradicciones clínicas, conserva
versiones inmutables y restaura una versión como borrador sin cambiar
producción. La publicación es atómica, idempotente y escribe
`ia_config.smyl_training`, que compilan los mismos webhooks de WhatsApp,
Messenger e Instagram; el laboratorio puede comparar borrador y publicación
sin enviar mensajes. Falta aplicar la migración de LANA, desplegar primero
`camila-api` y después `lana-training`, y ejecutar una prueba real controlada.

### Etapa 3 — Inbox operativo

- Bandeja, hilo, paginación, lectura y Realtime desde LANA.
- Respuesta manual, cola optimista, error y reintento.
- Pausa humana automática, asignación y resolución.

**Implementada localmente el 2026-10-11.** SMYL incorpora bandeja responsive,
hilo paginado, filtros, no leídos, sincronización incremental, envío optimista
por conversación con reintento idempotente, pausa automática de LANA,
asignación por miembro y resolución de solicitudes humanas. LANA conserva los
mensajes y protege las mutaciones con actor autenticado, advisory lock,
idempotencia y auditoría inmutable. Falta aplicar la migración de LANA,
desplegar `camila-api` y `lana-inbox`, publicar los activos web/PWA y ejecutar
un piloto controlado con los tres canales.

### Etapa 4 — medios y contexto dental

- Imagen, documento, audio, ubicación y mensajes citados.
- Vinculación confirmada con paciente y Ficha clínica 360.
- Citas, casos, fotografías, simulaciones, propuestas y seguimientos.
- Pipeline, filtros, soft-delete, reenviar y destacar.

**Implementada localmente el 2026-10-11.** El Inbox admite adjuntar imágenes,
documentos y audio, compartir ubicación con confirmación explícita, responder
citando, reenviar, destacar y eliminar de forma lógica. Los binarios se guardan
en el bucket privado de salud y LANA entrega URL firmadas breves; el navegador
no recibe rutas permanentes ni credenciales. Una fotografía sólo puede entrar a
revisión clínica después de validar en LANA que el mensaje canónico existe y de
confirmar el vínculo conversación-paciente-caso en SMYL.

La Ficha 360 consulta datos canónicos de SMYL y muestra paciente, caso, conteo
de fotografías vinculadas, cita LANA, simulación y propuesta cuando ya existen;
no copia el expediente al historial de chat ni convierte inferencias en hechos.
Los filtros operativos continúan usando estados canónicos de LANA. Crear o
modificar citas, propuestas y seguimientos desde la conversación corresponde a
las herramientas deterministas de la etapa 5. Falta aplicar las dos migraciones,
desplegar `camila-api` y `lana-inbox`, publicar los activos web/PWA y validar los
tres adaptadores con cuentas Meta controladas.

### Etapa 5 — SMYL Asistente y Copilot

- Herramientas deterministas para citas, servicios y resultados autorizados.
- Solicitud de humano, resumen y reanudación con contexto.
- Feedback de calidad sin publicación automática.

**Implementada localmente el 2026-10-11.** SMYL incorpora un Copilot interno
que propone borradores y resúmenes a partir del hilo canónico de LANA y de un
snapshot clínico de sólo lectura construido en el servidor. La respuesta queda
marcada como borrador no enviado: usarla sólo la coloca en el compositor y
nunca ejecuta acciones, envía mensajes o publica capacitación.

El catálogo informa capacidades deterministas existentes para humano, agenda y
servicios publicados. Una simulación sólo se presenta como resultado autorizado
cuando ya fue enviada mediante el flujo profesional explícito de SMYL; Copilot
no puede autorizarla por sí mismo. Al devolver el control a LANA, el miembro
revisa y corrige el resumen antes de confirmar una reanudación atómica y
auditada. La evaluación de respuestas se guarda como feedback inmutable,
atribuible e idempotente, sin modificar automáticamente la capacitación. El
resumen confirmado se inyecta como contexto no autoritativo en la primera
respuesta posterior de LANA en WhatsApp, Messenger o Instagram; después deja
de incluirse para evitar contexto obsoleto.

Falta aplicar la migración de LANA, desplegar `camila-api`, `whatsapp-webhook`,
`meta-webhook` y `lana-inbox`, publicar los activos web/PWA y validar el flujo
con una clínica controlada. Las
acciones transaccionales nuevas de agenda, propuesta o seguimiento no se
delegan al modelo: deberán invocar herramientas de dominio con confirmación y
auditoría cuando se habiliten operativamente.

### Etapa 6 — WhatsApp avanzado

- Ventana de 24 horas, plantillas aprobadas y programados idempotentes.
- Reactivación controlada y recordatorios.

**Implementada localmente el 2026-10-11.** LANA calcula la ventana de servicio
desde el último mensaje real del paciente y la expone como abierta, próxima a
vencer o vencida. SMYL muestra ese estado en el hilo y en la Ficha 360, pero la
regla se vuelve a validar en servidor: cuando la ventana venció, texto libre,
medios, ubicación, respuesta citada y reenvío se rechazan aunque un cliente
alterado intente habilitarlos.

Para iniciar contacto fuera de la ventana sólo se admiten plantillas del mismo
tenant, activas, aprobadas por Meta y de categoría `UTILITY`. El catálogo y los
valores de las variables se validan otra vez en LANA antes del envío. Los
mensajes programados conservan actor, tipo, payload, hash y clave de
idempotencia; el trabajador vuelve a comprobar ventana o aprobación en el
momento de ejecución y reconcilia el mensaje persistido antes de reintentar,
evitando un segundo envío después de un fallo parcial.

Cada conversación permite heredar, desactivar o ajustar la reactivación por
inactividad y el comportamiento al acercarse el cierre de ventana. La mutación
se serializa, es idempotente y queda auditada; la interfaz muestra también el
último recordatorio y permite cancelar pendientes. SMYL no recibe tokens de
Meta ni copia el catálogo o la agenda de LANA.

Falta aplicar la migración de LANA, desplegar `camila-api`, el trabajador
`whatsapp-mensajes-programados-enviar` y `lana-inbox`, publicar los activos
web/PWA y validar en un piloto que Meta acepte las plantillas reales. Ningún
cambio de esta etapa fue aplicado a producción.

### Etapa 7 — endurecimiento y piloto

- Observabilidad, consumo, límites, reintentos, DLQ, métricas y alertas.
- Pruebas de concurrencia, desconexión y aislamiento multi-tenant.
- Piloto con una clínica antes de autoservicio multi-tenant.

**Implementación técnica local completada el 2026-10-11; piloto real
pendiente.** El contrato `1.2` agrega `GET /inbox/operations` y el reintento
manual seguro de programados. El panel de operación muestra volumen de
conversaciones, solicitudes humanas, envíos de 24 horas, consumo mensual de
IA, estado de los tres canales, retrasos del worker, fallos no resueltos y una
lista verificable de condiciones para iniciar el piloto.

Los límites se consumen mediante una RPC atómica y serializada por tenant,
actor, operación y ventana. El envío manual tiene un límite compartido por la
clínica; la agenda y Copilot tienen límites por miembro. Un exceso responde
`429`, indica el siguiente reinicio y queda auditado sin ejecutar el envío ni
la llamada de IA.

El trabajador de programados diferencia cuatro resultados:

1. éxito confirmado;
2. rechazo transitorio explícito de Meta, con hasta tres intentos y pausas de
   1, 5 y 15 minutos;
3. rechazo definitivo, que pasa a la cola de fallos;
4. resultado ambiguo o ejecución atorada después de contactar a Meta, que
   pasa a revisión y **no** se reenvía automáticamente.

Sólo los fallos donde Meta confirmó que no aceptó el mensaje admiten reintento
manual. La recuperación es idempotente, respeta asignación y tenant, y deja un
evento inmutable. Los programados atorados se reconcilian primero por
`programado_id`; si el mensaje ya existe se cierran como enviados sin repetir
la llamada al proveedor.

La prueba PostgreSQL embebida cubre consumo concurrente del límite, aislamiento
entre dos tenants, replay idempotente y rechazo de reintentos ambiguos. La UI
tiene estados reproducibles para escritorio, tableta y móvil. Esto deja la
plataforma **lista para preparar** un piloto, no autoriza activarlo: aún falta
aplicar migraciones, desplegar funciones, publicar activos y ejecutar con una
clínica real la matriz de recepción/envío por canal, desconexión, ventana de
WhatsApp, capacitación, pausa IA/humano, alertas y recuperación.

## 20. Criterios de aceptación

- Los tres canales alimentan una sola bandeja.
- Existe una fila resumen por conversación y un historial auditable.
- Realtime actualiza sin duplicar mensajes ni saltar de hilo.
- El equipo puede asignar, tomar control, pausar y reactivar al asistente.
- El asistente no responde mientras está pausado.
- Las asignaciones están protegidas en interfaz, RLS y backend.
- Los fallos de envío permanecen visibles y sólo son reintentables cuando el
  proveedor confirmó que no aceptó el mensaje; un resultado ambiguo exige
  revisión humana para evitar duplicados.
- Cada tipo de mensaje respeta capacidades del canal.
- Fuera de la ventana de WhatsApp se usan plantillas autorizadas.
- El contacto se vincula a un paciente sólo con confirmación.
- La Ficha 360 diferencia inferencias y datos confirmados.
- Una fotografía puede vincularse a un caso y entrar a revisión clínica.
- Sólo se comparte una simulación autorizada.
- Citas, precios y estados provienen de herramientas deterministas.
- Webhooks no generan dobles mensajes ni dobles respuestas.
- Ningún tenant puede leer u operar otro tenant.
- La experiencia funciona en escritorio y móvil.

## 21. Principio que no debe romperse

No concentrar la solución en `app.html`, una sola Edge Function o un gran prompt.
La interfaz puede parecerse a LANA, pero la equivalencia funcional sólo existe
si canal, historial, estado, IA, herramientas, permisos y auditoría permanecen
separados.

