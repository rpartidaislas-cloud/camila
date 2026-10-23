# SMYL — etapa 8: backend seguro de compras consumibles

**Responsable:** Claude Code  
**Estado inicial:** frontend publicado; backend de compra no implementado  
**Regla de operación:** conservar `SMYL_CONSUMABLES_ENFORCED=false` y los
productos sin venta hasta aprobar todos los criterios de esta etapa.

## Objetivo

Cerrar el ciclo servidor de paquetes adicionales para MILA, IA y Meta sin
mezclarlo con la suscripción SaaS existente y sin confiar en datos comerciales
del navegador. Un pago sólo acredita saldo después de un webhook de Stripe
firmado, conciliado e idempotente.

El frontend ya consume estos contratos:

- `smyl-consumables-checkout` con `product_id` e `idempotency_key`;
- `smyl-consumables-checkout-status` con `checkout_id`;
- regreso a `consumos.html?checkout=success&checkout_id=...` o
  `consumos.html?checkout=cancel&checkout_id=...`.

## Puerta cero: prueba de alcance de Agenda

Antes de desplegar pagos, dejar la suite completa en verde. La migración
`20261022122000_smyl_appointment_request_scope_guard.sql` ya contiene la
validación de destino con `smyl_can_access_schedule_row(...)` antes de crear la
cita. La prueba falla porque busca una cadena con `\n` mientras el archivo usa
`\r\n`.

Corregir sólo la prueba para normalizar saltos de línea o usar una expresión
regular. No retirar, mover después de `smyl_create_appointment` ni suavizar la
validación SQL existente.

## 1. Separación comercial obligatoria

No reutilizar `stripe-checkout` ni convertir `stripe-webhook` en un webhook
mixto. Esas funciones administran la suscripción y el estado de
`camila_tenants`; una compra consumible pertenece a un libro mayor distinto.

Crear funciones independientes:

1. `smyl-consumables-checkout` — autenticada.
2. `smyl-consumables-checkout-status` — autenticada.
3. `smyl-consumables-webhook` — pública únicamente para Stripe y protegida por
   verificación criptográfica de la firma sobre el cuerpo sin modificar.

Configurar JWT obligatorio para las dos primeras y deshabilitarlo sólo en el
webhook. El webhook nunca acepta CORS como mecanismo de autenticación.

## 2. Persistencia mínima

Crear una migración nueva y reversible; no modificar migraciones aplicadas.
El diseño puede adaptarse a las convenciones actuales, pero debe cubrir:

### `smyl_checkout_sessions`

- `id` UUID interno y referencia pública opaca distinta del ID de Stripe;
- `tenant_id`, `product_id`, `requested_by`;
- `idempotency_key`;
- `provider`, `provider_checkout_id`, `provider_payment_id`;
- snapshot inmutable de recurso, unidades, precio menor y moneda;
- estado `created | pending | completed | failed | expired | refunded`;
- `created_at`, `updated_at`, `completed_at`, `refunded_at`;
- referencia al movimiento de crédito y, cuando aplique, al reverso.

Restricciones mínimas:

- única por `(tenant_id, idempotency_key)`;
- única por proveedor e identificador de checkout;
- unidades y precio positivos;
- moneda y recurso dentro del catálogo admitido;
- transición de estados controlada en servidor.

### `smyl_payment_events`

- ID del evento de Stripe único;
- tipo, checkout interno y fecha recibida;
- hash o referencia de conciliación, estado de proceso e intento;
- error operativo acotado, sin cuerpo completo ni información de tarjeta.

Las tablas deben tener RLS. El cliente autenticado no puede insertar,
actualizar ni eliminar sesiones, eventos, saldos o movimientos. La lectura de
estado debe pasar por la función/RPC que valide tenant y permiso comercial.

## 3. Checkout autenticado

`smyl-consumables-checkout` debe:

1. Validar JWT y resolver usuario, tenant y rol desde el servidor.
2. Exigir permiso comercial de propietario o administrador definido por SMYL.
3. Validar UUIDs y limitar tamaño de la solicitud.
4. Consultar `smyl_consumable_products` por `product_id` y exigir producto
   activo, precio, moneda, recurso y unidades válidos.
5. Crear o recuperar la sesión interna con la misma clave idempotente.
6. Crear Stripe Checkout en modo `payment`, usando únicamente el snapshot del
   servidor.
7. Enviar a Stripe sólo identificadores internos seguros en metadata; nunca
   paciente, conversación, prompt, diagnóstico, teléfono o nombre clínico.
8. Construir URLs de regreso desde una variable permitida y validar HTTPS y
   host explícito.
9. Guardar el ID de Stripe en servidor y devolver sólo:

```json
{ "checkout_url": "https://checkout.stripe.com/…", "checkout_id": "opaque-id" }
```

Reintentar la misma solicitud debe devolver la misma sesión utilizable o un
estado terminal explícito; nunca crear dos cobros.

## 4. Webhook y acreditación atómica

`smyl-consumables-webhook` debe verificar `stripe-signature` con un secreto
propio del endpoint antes de interpretar el evento. Procesar sólo la lista
permitida de eventos que resulte necesaria, incluyendo confirmación, expiración,
fallo asíncrono y reembolso.

La confirmación debe ejecutarse en una única transacción/RPC servidor:

1. bloquear la sesión interna;
2. comprobar proveedor, checkout, moneda e importe contra el snapshot;
3. insertar el evento si no existe;
4. acreditar con el helper canónico del ledger y una clave de origen
   determinista;
5. enlazar el movimiento y marcar `completed`;
6. devolver el resultado ya existente si Stripe repite el evento.

La redirección del navegador, el estado de una PaymentIntent consultado desde
el cliente o la presencia de `checkout=success` nunca acreditan saldo.

El reembolso genera un movimiento append-only de reverso o `refund`; no elimina
ni reescribe el crédito original. Repetir el webhook de reembolso no duplica el
reverso.

## 5. Consulta de estado

`smyl-consumables-checkout-status` debe validar JWT, resolver tenant y comprobar
que el checkout pertenece a ese tenant. Nunca buscar sólo por el identificador
opaco. Respuesta permitida:

```json
{
  "status": "pending | completed | failed | expired | refunded",
  "credited_resource": "ai_credits",
  "credited_units": 100,
  "confirmed_at": "2026-10-23T18:00:00Z"
}
```

No devolver identificadores de Stripe, metadata, precio interno, coste del
proveedor, otros tenants, tarjetas ni datos clínicos. Aplicar `Cache-Control:
no-store` y respuestas de error genéricas que no permitan enumerar checkouts.

## 6. Pruebas obligatorias

- Una clave idempotente repetida crea una sola sesión de pago.
- Un usuario de otra clínica no puede consultar ni inferir el checkout.
- Un usuario sin permiso comercial no puede comprar.
- Cambiar el precio del catálogo después de iniciar no cambia el snapshot.
- `checkout=success` sin webhook no acredita.
- El mismo webhook 2 o 20 veces produce un solo crédito.
- Importe, moneda, producto o metadata discordante bloquean acreditación.
- Evento fuera de orden converge al estado correcto.
- Fallo y expiración no crean movimientos.
- Reembolso repetido crea un solo reverso y conserva el movimiento original.
- Nadie autenticado puede escribir directamente sesiones, eventos o wallets.
- Ningún registro o log contiene PHI, mensaje, prompt, audio ni credenciales.
- La suite completa, incluida Agenda, queda verde en LF y CRLF.

## 7. Secuencia de despliegue

1. Corregir la prueba CRLF de Agenda y ejecutar toda la suite.
2. Aplicar migración y verificar RLS/revocaciones en un proyecto de prueba.
3. Desplegar checkout y consulta de estado con productos aún inactivos.
4. Desplegar webhook y registrar su secreto específico.
5. Probar pago exitoso, cancelado, expirado, duplicado y reembolso con Stripe
   test mode.
6. Conciliar manualmente ledger, sesión y evento.
7. Activar un solo producto sintético para una clínica piloto.
8. Mantener `SMYL_CONSUMABLES_ENFORCED=false` durante dos ciclos conciliados.

## Criterio de salida

Esta etapa termina únicamente cuando toda la matriz pasa, la suite completa
está verde, no existen escrituras directas del navegador y un reporte de prueba
demuestra que reintentos y webhooks duplicados no alteran el saldo más de una
vez. No habilitar cobros reales ni enforcement como parte de esta etapa.
