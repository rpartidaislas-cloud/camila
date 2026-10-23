# SMYL — medición centralizada de uso, etapa 2

**Estado:** contrato listo para implementación de backend  
**Responsable de implementación:** Claude Code  
**Fecha:** 23 de octubre de 2026  
**Regla de salida:** mantener `SMYL_CONSUMABLES_ENFORCED=false`

## 1. Resultado esperado

SMYL debe reunir en un solo centro de consumo cuatro familias de uso sin
mezclarlas ni estimarlas desde el navegador:

1. MILA por tiempo de sesión procesado.
2. Funciones de IA por créditos comerciales y tokens técnicos auditables.
3. Mensajería de Meta por canal y categoría facturable.
4. Almacenamiento por espacio real ocupado y cuota contratada.

El dentista verá unidades comprensibles: minutos, créditos, mensajes y GB. Los
tokens, modelos, costes de proveedor, firmas e identificadores internos son
datos administrativos de SMYL y no deben exponerse al personal de la clínica.

Esta etapa centraliza y concilia la medición. No activa cobros, bloqueos,
recargas automáticas ni débitos negativos.

## 2. Principios no negociables

- Toda medición se genera en servidor. El cliente nunca declara cantidad,
  coste, saldo ni si una operación es facturable.
- El libro mayor es append-only. Una corrección se registra como ajuste o
  reembolso; nunca se reescribe un movimiento confirmado.
- Cada evento tiene una clave idempotente determinista. Un reintento devuelve
  el resultado existente y no descuenta dos veces.
- Fallos técnicos no consumen. Si el proveedor cobró pero el producto no se
  entregó, la conciliación genera un reembolso explícito.
- Ningún evento de consumo almacena prompts, transcripciones, mensajes,
  diagnósticos, nombres de pacientes, teléfonos ni otra información clínica.
- El historial conserva la tarifa y versión de conversión aplicadas al momento
  del evento. Un cambio futuro de precio no altera consumos anteriores.
- La escritura manual en expediente, agenda o chat no consume créditos de IA.

## 3. Modelo de recursos

### 3.1 Recursos comerciales

| Recurso objetivo | Unidad interna | Unidad visible | Estado |
|---|---:|---:|---|
| `mila_seconds` | segundo procesado | minuto | Conservar |
| `ai_credits` | crédito calculado | crédito | Conservar y ampliar |
| `meta_messages` | mensaje facturable | mensaje | Nuevo recurso canónico |
| `whatsapp_messages` | mensaje enviado | mensaje | Compatibilidad temporal |

`whatsapp_messages` no debe desaparecer abruptamente. La migración debe:

1. crear `meta_messages`;
2. trasladar o reflejar saldos sin pérdida;
3. mantener lectura compatible para clientes existentes;
4. etiquetar el canal en cada evento nuevo;
5. retirar el alias únicamente después de conciliar dos periodos completos.

Instagram y Messenger no deben simular un saldo cero mientras LANA no entregue
eventos firmados. La interfaz mostrará “pendiente de conexión” o “sin datos”.

### 3.2 Almacenamiento

La nube no es inicialmente una cartera consumible. Es una medición de capacidad
con cuota:

- `used_bytes`: espacio ocupado confirmado.
- `quota_bytes`: límite vigente del plan.
- `measured_at`: momento de la fotografía.
- desglose por categoría: fotografías/radiografías clínicas, documentos,
  audio temporal de MILA y otros archivos privados.

Se recomienda una tabla de fotografías por tenant, por ejemplo
`smyl_storage_snapshots`, con filas inmutables o reconciliables. Si después se
decide cobrar uso incremental, registrar `storage_byte_hours` o
`storage_gb_days` como telemetría separada; no descontar “GB” de una cartera.

Los activos públicos del producto y archivos técnicos de la aplicación quedan
fuera del consumo de la clínica. El audio temporal de MILA debe respetar su
política de retención y dejar de contar cuando la eliminación sea confirmada.

## 4. Contrato de telemetría de IA

Cada invocación exitosa de una función de IA crea un evento técnico asociado a
su movimiento comercial. `smyl_usage_events.metadata` puede contener:

```json
{
  "operation": "mila_clinical_note",
  "function": "mila-actions",
  "provider": "anthropic|openai",
  "model": "provider-model-id",
  "input_tokens": 0,
  "output_tokens": 0,
  "cache_creation_input_tokens": 0,
  "cache_read_input_tokens": 0,
  "provider_cost_micros": 0,
  "rate_version": "ai-2026-10-v1",
  "credit_units": 1,
  "request_id": "provider-or-server-request-id"
}
```

Reglas:

- Usar los valores reportados por el proveedor, no estimaciones del navegador.
- Los campos inexistentes se guardan como `null`, no como cero inventado.
- `provider_cost_micros` y tokens sólo son visibles para administración interna
  de SMYL.
- `operation`, `rate_version` y `credit_units` sí alimentan conciliación y
  soporte, sin revelar contenido clínico.
- Toda función generativa debe declarar su operación y conversión antes de
  participar en cobro duro.

## 5. Conversión y tarifas versionadas

Crear una fuente de verdad versionada, por ejemplo `smyl_metering_rates`, con:

- recurso;
- operación;
- unidad comercial;
- fórmula o cantidad de créditos;
- vigencia desde/hasta;
- versión inmutable;
- estado borrador/activa/retirada;
- actor y fecha de aprobación.

El evento debe copiar la `rate_version` y el resultado aplicado. Nunca recalcular
el pasado usando la tarifa actual. Los precios de venta, impuestos, promociones
y caducidad pertenecen al catálogo comercial; no deben mezclarse con el coste
del proveedor.

## 6. Eventos LANA → SMYL para Meta

LANA conserva la integración canónica con Meta: credenciales, webhooks,
ventanas de servicio y entrega. SMYL conserva el saldo comercial y el historial
visible para la clínica.

La comunicación será servidor a servidor, firmada y con protección contra
replay. Carga mínima recomendada:

```json
{
  "event_id": "lana-event-unique-id",
  "tenant_external_id": "mapped-tenant-id",
  "channel": "whatsapp|instagram|messenger",
  "direction": "inbound|outbound",
  "category": "service|marketing|utility|authentication|unknown",
  "billable": true,
  "quantity": 1,
  "occurred_at": "2026-10-23T12:00:00Z"
}
```

No enviar cuerpo del mensaje, nombre, teléfono, usuario social, archivos ni
identificadores del paciente. SMYL verifica en servidor el mapeo tenant LANA ↔
tenant SMYL; nunca acepta un `tenant_id` arbitrario del navegador.

La firma debe cubrir cuerpo, marca de tiempo y nonce. Rechazar firmas inválidas,
eventos fuera de ventana y `event_id` repetidos. Un evento entrante puede servir
para analítica, pero sólo los eventos definidos por la política comercial
generan movimiento en `meta_messages`.

## 7. Lecturas que necesita la interfaz

Exponer RPC o endpoints de sólo lectura con paginación y RLS:

### `smyl_usage_overview(period)`

Devuelve por recurso:

- saldo o cuota vigente;
- uso del periodo;
- porcentaje sólo cuando exista un límite real;
- fecha de renovación cuando esté configurada;
- estado `available`, `pending`, `unlimited`, `warning` o `exhausted`.

### `smyl_usage_history(cursor, filters)`

Devuelve movimientos paginados con recurso, tipo, cantidad, saldo posterior,
operación, fecha y etiqueta segura. Nunca devuelve metadata técnica sensible.

### `smyl_usage_breakdown(period, group_by)`

Disponible sólo para dueño/administrador de clínica. Agrupa por día, operación,
canal o sucursal cuando el evento tenga una atribución validada. No expone el
coste interno de SMYL.

El frontend publicado puede seguir leyendo las tablas actuales durante la
transición, pero debe migrar a estas lecturas antes de habilitar compras o
bloqueos.

## 8. Seguridad y permisos

- Sólo `service_role` o funciones servidoras autorizadas escriben ledger,
  eventos, snapshots o tarifas.
- RLS limita toda lectura por tenant.
- Dueño y administrador ven saldos, consumo, historial y desglose comercial.
- Personal clínico puede ver únicamente el estado operativo necesario; no ve
  compras, precios internos ni telemetría del proveedor.
- Administración de SMYL puede auditar tokens y costes en una superficie
  separada del panel de la clínica.
- Operaciones administrativas quedan en auditoría inmutable con actor, razón,
  correlación y fecha.
- No registrar secretos, API keys, access tokens de Meta ni payloads clínicos.

## 9. Idempotencia y conciliación

Clave recomendada por origen:

- MILA: sesión + tramo procesado + operación.
- IA: request ID servidor/proveedor + operación.
- Meta: `event_id` emitido por LANA.
- Storage: tenant + instante/ciclo del snapshot.
- Compra: proveedor de pagos + payment/checkout event ID.

Toda función de consumo debe ejecutar en una transacción: validar evento,
resolver tarifa, registrar evento, crear movimiento y actualizar saldo. En modo
piloto, si no hay saldo suficiente, registrar `meter_only` sin saldo negativo.

La conciliación diaria compara eventos técnicos contra movimientos. Debe
reportar huérfanos, duplicados, cantidades discordantes, sesiones MILA sin
cierre y webhooks pendientes. La reparación genera nuevas entradas; no edita el
historial.

## 10. Despliegue por fases

1. **Medición sombra:** todos los servicios emiten eventos; no cobran.
2. **Conciliación:** tablero interno y revisión diaria de diferencias.
3. **Conversión comercial:** aprobar tarifas versionadas y límites del plan.
4. **Compras y reembolsos:** acreditar únicamente desde webhook firmado.
5. **Avisos:** 70 %, 85 % y 100 %, sin bloquear durante el piloto.
6. **Piloto de enforcement:** una clínica, reserva/confirmación/reembolso
   probados y dos ciclos conciliados.
7. **Expansión:** habilitación gradual y rollback inmediato por tenant.

`SMYL_CONSUMABLES_ENFORCED=true` queda expresamente fuera de esta etapa.

## 11. Matriz mínima de aceptación

- El mismo evento recibido 2 o 20 veces produce un solo movimiento.
- Un fallo antes de entregar resultado no consume; un fallo posterior se
  concilia mediante reembolso rastreable.
- Cambiar una tarifa no modifica importes ni créditos históricos.
- Un usuario de otro tenant no puede leer ni inferir saldos, historial o uso.
- Un usuario clínico sin permiso comercial no puede ver compras ni costes.
- Los eventos no contienen texto clínico, mensajes, audio ni datos del paciente.
- WhatsApp, Instagram y Messenger se distinguen sin crear saldos falsos.
- Un tenant no vinculado con LANA no puede inyectar eventos Meta.
- El snapshot de nube coincide con Storage dentro de la tolerancia definida y
  elimina del total archivos cuya baja ya fue confirmada.
- La interrupción y reanudación de MILA no duplica segundos.
- El historial soporta paginación estable y filtros sin saltos ni duplicados.
- Con enforcement apagado, una cartera vacía registra medición sin número
  negativo ni bloqueo del servicio.

## 12. Entregables para Claude Code

1. Migraciones, índices, RLS y rollback.
2. Funciones servidoras de registro, lectura y conciliación.
3. Adaptadores para todas las funciones de IA existentes.
4. Endpoint firmado LANA → SMYL y tabla de mapeo de tenants.
5. Medidor de Storage por tenant y política de retención verificable.
6. Pruebas de idempotencia, aislamiento multi-tenant, roles y reembolsos.
7. Datos de prueba sintéticos, sin información real de pacientes.
8. Informe de dos ciclos en modo sombra antes de solicitar enforcement.

No modificar la experiencia visual de `consumos.html` salvo para adoptar los
nuevos endpoints de lectura o estados reales definidos aquí.
