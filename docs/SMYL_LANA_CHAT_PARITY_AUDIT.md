# Auditoría de paridad: Chat de SMYL y LANA

**Fecha:** 14 de octubre de 2026  
**Decisión:** SMYL usa LANA como motor canónico mediante un puente autenticado.
No se copiarán tokens, webhooks, conversaciones ni mensajes a una segunda base.

## Resultado ejecutivo

El Inbox de SMYL no es un chat aislado: ya lee y opera el historial real de
LANA a través de las funciones `lana-inbox`, `lana-channels` y
`lana-connection`. La ruta correcta para llegar a paridad no es incrustar
`admin.html` de LANA ni copiar su código comercial, sino ampliar el contrato
compartido y presentar en SMYL las mismas capacidades operativas con contexto
dental.

## Capacidades que ya comparten el motor de LANA

- WhatsApp, Messenger e Instagram como canales canónicos.
- Historial paginado, sincronización incremental y cola optimista.
- Texto, imágenes, documentos, audio, ubicación, respuesta citada y reenvío.
- Estado de envío, reintento controlado, destacado y borrado lógico.
- Asignación de conversaciones, pausa humana, reanudación con contexto y
  resolución de solicitudes.
- Ventana de 24 horas, plantillas aprobadas y mensajes programados.
- Copilot para borradores y resúmenes, con evaluación auditable.
- Ficha 360 y vínculo explícito a paciente/caso sin copiar el expediente a
  LANA.
- Métricas operativas, límites y preparación de piloto.

## Brechas reales frente a la experiencia completa de LANA

| Prioridad | Brecha | Decisión para SMYL |
| --- | --- | --- |
| P0 | Desconectar una cuenta conectada | Añadir revocación real, no un botón aparente. |
| P0 | Paridad del estado de conexión | Toda alta/baja se resuelve en LANA y SMYL sólo recibe estado público. |
| P1 | Fijar conversaciones y filtros avanzados | Exponer `fijado`, pausadas y etapa dental por el contrato del Inbox. |
| P1 | Pipeline visual | Reutilizar el pipeline de LANA con etapas dentales, no comerciales. |
| P1 | Buscar dentro del hilo | Agregar búsqueda paginada en servidor, no sólo filtrar lo cargado. |
| P1 | Biblioteca de compartidos | Agrupar imágenes, documentos y enlaces del hilo canónico. |
| P1 | Notificaciones y sonido | Usar eventos del puente; evitar dos fuentes de Realtime. |
| P2 | Emoji y nota de voz nativa | Compartir el mismo compositor/capacidades del canal. |
| P2 | Borradores por conversación | Persistencia local cifrada por sesión o servidor, nunca texto clínico global. |
| P2 | Acciones masivas | Sólo para asignación/etapa; nunca para respuestas clínicas automáticas. |

## Lo que no debe trasladarse

LANA contiene módulos de productos, artes, órdenes de trabajo y cotización
industrial. Copiarlos al Inbox dental crearía ruido y mezclaría dominios. En
SMYL se sustituyen por paciente, expediente, odontograma, caso, simulación,
propuesta dental, cita, seguimiento y consentimiento.

## Plan de convergencia

1. **Canales seguros:** desconexión real de Meta, confirmación, estados y
   pruebas de reconexión.
2. **Bandeja de trabajo:** fijados, pausadas, búsqueda de hilo, notificaciones
   y biblioteca de archivos.
3. **Pipeline dental:** etapas configurables y movimiento accesible, con
   Ficha 360 siempre disponible.
4. **Compositor compartido:** emoji, nota de voz, borradores, atajos y paridad
   de capacidades por canal.
5. **Piloto profesional:** pruebas con tráfico real, dos usuarios simultáneos,
   mensajes fuera de orden, pérdida de red, reconexión y verificación móvil.
6. **Decisión operativa:** consolidar preparación, evidencia e incidentes en
   tres puertas explícitas, con métricas y siguiente control para cada alerta.

La herramienta de la etapa 5 ya está implementada: el dueño controla el ciclo y
registra evidencia de cada escenario, mientras el cierre permanece bloqueado si
la salud técnica se degrada o falta alguna comprobación. La ejecución con una
clínica y dispositivos reales sigue siendo una validación operativa pendiente;
no se sustituye con datos simulados ni con una afirmación automática.

La etapa 6 también está implementada: SMYL calcula una lectura ejecutiva a
partir del estado canónico de LANA y sólo muestra `listo para aprobación` cuando
las tres puertas están confirmadas. No presenta SLA, tendencias ni resultados
clínicos que la integración todavía no mida.

## Criterio de terminado

La paridad se considera completa cuando una operación admitida por LANA puede
ejecutarse desde SMYL con el mismo resultado canónico y el mismo control de
permisos, salvo las funciones comerciales excluidas de forma expresa. La
apariencia por sí sola no cuenta como paridad.
