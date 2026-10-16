# MILA — arquitectura funcional y comercial

**Nombre:** MILA · Motor Inteligente de Lenguaje y Acciones
**Estado:** piloto integrado con el núcleo SMYL vigente; pendiente de prueba clínica controlada
**Fecha:** 2026-10-15

## 1. Objetivo

MILA es la infraestructura de voz de SMYL para el equipo dental. Tiene dos
experiencias que comparten seguridad, pacientes, auditoría y consumibles:

- **MILA Transcribe:** graba una consulta, transcribe el audio y genera un
  borrador clínico estructurado. El profesional debe aprobarlo o descartarlo.
- **MILA Conversa:** mantiene una conversación de voz y puede consultar datos o
  preparar acciones operativas. Una cita o cotización nunca se guarda sin una
  confirmación explícita en pantalla.

MILA no sustituye el criterio clínico, no produce diagnósticos definitivos y no
debe presentarse como expediente final antes de la revisión del dentista.

## 2. Flujo técnico

### Transcribe

1. El dentista selecciona opcionalmente un paciente y confirma el consentimiento.
2. La web solicita micrófono y un `Screen Wake Lock` para mantener encendida la
   pantalla durante la grabación.
3. El audio se envía autenticado a `mila-transcribe`.
4. La Edge Function valida usuario, clínica, paciente, tipo y tamaño.
5. El audio se guarda en el bucket privado `mila-audio` con retención de 30 días.
6. OpenAI transcribe el archivo.
7. Responses API transforma la transcripción en JSON clínico estricto.
8. Se guardan transcripción y nota con estado `borrador`.
9. Se registra el consumo real en segundos.
10. El dentista aprueba o descarta el borrador.

### Conversa

1. El navegador captura audio y crea una conexión WebRTC.
2. `mila-realtime-session` autentica la sesión y negocia la llamada con OpenAI;
   la llave estándar permanece exclusivamente en el servidor.
3. MILA conversa en español y utiliza cuatro herramientas iniciales:
   `buscar_paciente`, `buscar_opciones_clinica`, `preparar_cita` y
   `preparar_cotizacion`.
4. Las herramientas llegan a `mila-actions`, que vuelve a comprobar tenant,
   usuario, paciente y parámetros.
5. Preparar no significa ejecutar: se crea una fila temporal en
   `mila_confirmations` con expiración de 15 minutos.
6. El dentista confirma o cancela en pantalla.
7. Sólo entonces el backend crea una cita en `smyl_appointments` o un borrador
   en `smyl_proposals`, usando el plan clínico revisado vigente.
8. Al terminar se calcula el tiempo en servidor y se registra el consumo.

## 3. Seguridad y privacidad

- OpenAI y Supabase Service Role no se exponen al navegador.
- Todas las funciones exigen una sesión profesional real, incluso cuando el
  helper compartido conserva compatibilidad anónima para módulos antiguos.
- RLS utiliza `camila_es_miembro(tenant_id)` en toda información operativa.
- Las acciones se ejecutan desde el backend con lista permitida; GPT no recibe
  acceso a SQL ni decide precios.
- Citas y cotizaciones usan `smyl_services`, profesionales, sucursales y
  permisos reales de la clínica. No existen precios predeterminados en código.
- Una cotización por voz exige un plan clínico esquema 2 ya revisado y siempre
  se guarda como borrador, nunca como propuesta aprobada.
- Las llamadas de herramientas, confirmaciones y decisiones se auditan.
- El audio es privado, tiene fecha de retención y no se convierte en URL pública.
- La interfaz exige confirmar consentimiento antes de grabar.

## 4. Consumibles

### Unidades base

| Recurso | Unidad interna | Unidad comercial |
|---|---:|---:|
| `mila_seconds` | segundo | minuto |
| `whatsapp_messages` | mensaje enviado | paquete de mensajes |
| `ai_credits` | crédito por función | paquete de créditos |

La tabla `smyl_wallets` mantiene el saldo actual. `smyl_usage_ledger` es el
libro mayor idempotente y `smyl_usage_events` conserva telemetría de proveedor,
modelo y origen. El panel `consumos.html` lee estas fuentes; nunca calcula el
saldo con datos del dispositivo.

### Modo piloto y modo cobro

`SMYL_CONSUMABLES_ENFORCED=false` mantiene el piloto abierto: registra un
movimiento `meter_only` si no existe saldo, sin permitir números negativos.
Al cambiar a `true`, MILA y WhatsApp comprueban saldo antes de iniciar.

No debe activarse el cobro duro hasta completar reservas y conciliación para
sesiones interrumpidas, definir precios, conectar checkout y probar reembolsos.

### Paquetes preparados

- MILA: 60 y 300 minutos.
- WhatsApp: 1,000 mensajes.
- SMYL IA: 100 créditos.

Los paquetes nacen inactivos y sin precio. Esto es intencional: el catálogo
técnico queda listo sin inventar una decisión comercial.

## 5. Tablas

- Operación: `camila_pacientes`, `smyl_appointments`, `smyl_services`,
  `smyl_professionals`, `smyl_branches`, `smyl_clinical_plans` y
  `smyl_proposals`.
- Voz: `mila_sessions`, `mila_recordings`, `mila_transcripts`,
  `mila_clinical_notes`.
- Control: `mila_confirmations`, `mila_tool_calls`, `mila_audit_log`.
- Comercial: `smyl_wallets`, `smyl_consumable_products`,
  `smyl_usage_ledger`, `smyl_usage_events`.

## 6. Variables de entorno

```text
OPENAI_API_KEY
OPENAI_REALTIME_MODEL=gpt-realtime-2.1
OPENAI_REALTIME_VOICE=marin
OPENAI_REALTIME_TRANSCRIBE_MODEL=gpt-transcribe
OPENAI_TRANSCRIBE_MODEL=gpt-transcribe
OPENAI_MILA_NOTE_MODEL=gpt-5-mini
SMYL_CONSUMABLES_ENFORCED=false
```

## 7. Etapas de salida

1. **Base local:** esquema, RLS, auditoría, pantallas y Edge Functions.
2. **Despliegue de piloto:** aplicar migración, configurar secretos y desplegar
   las tres funciones MILA.
3. **Prueba interna:** Android y web con usuarios dueño/staff, micrófono,
   wake lock, notas, citas, cotizaciones y cortes de red.
4. **Calibración:** medir minutos y créditos reales sin cobrar durante un
   periodo acordado.
5. **Comercial:** definir precios, impuestos y caducidad; conectar Stripe y
   acreditar paquetes únicamente desde webhook firmado.
6. **Cobro controlado:** agregar reservas/conciliación y activar enforcement
   primero en una clínica piloto.
7. **Expansión:** recordatorios, tareas, búsqueda clínica y más acciones,
   cada una con permisos y confirmación definidos.

## 8. Límites de esta entrega

- “Hola MILA” no escucha con la app cerrada ni el teléfono bloqueado. Eso
  requeriría un servicio nativo persistente con implicaciones de batería,
  privacidad y revisión de tiendas. La pantalla se mantiene despierta sólo
  durante una sesión activa y visible.
- La compra de paquetes aún no está habilitada.
- `analizar-foto`, WhatsApp y MILA ya producen eventos medibles; el resto de
  funciones IA debe mapearse a créditos antes de activar cobro duro.
- Falta conciliación automática de conversaciones que cierren por pérdida de
  red sin alcanzar `finish_session`.
