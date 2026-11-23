# Suscripciones de SMYL con Openpay (reemplaza a Stripe)

Estado: **fase 1 hecha** (catálogo y pantalla de planes). **Fase 2 pendiente**: el cobro. Para empezarla hace falta la cuenta de Openpay.

## Qué ya está (fase 1)

- `app.html`: catálogo `PLANES` con Esencial $299, Profesional $899 y Premium $1,499 (anual $2,990 / $8,990 / $14,990), selector mensual/anual y
  marca «Recomendado». Sin referencias a Stripe en el navegador.
- Los botones «Elegir plan» y «Gestionar suscripción» avisan que el pago con tarjeta se está activando; no fallan en silencio.
- Límite de usuarios mostrado por plan: Esencial 3, Profesional 10, Premium sin tope. (Hoy es solo el texto de ayuda en Equipo; ver «Entitlements».)

## Qué se necesita de Openpay (lo aporta quien administra la cuenta de SMYL)

Cuenta **propia de SMYL** (no la de cada clínica: la de las clínicas va por LANA para cobrar a pacientes).

- `OPENPAY_MERCHANT_ID` y `OPENPAY_PRIVATE_KEY` (secrets de la Edge Function; nunca en el código ni en el navegador) y la llave pública para tokenizar tarjeta en el navegador.
- Sandbox primero (`sandbox-api.openpay.mx`), producción después (`api.openpay.mx`).
- En Openpay: crear los 6 planes (3 mensuales, 3 anuales) y guardar sus `plan_id` en una tabla de SMYL, no en el cliente.
- Confirmar que la cuenta tiene habilitadas las **suscripciones** (cobro recurrente con tarjeta) y 3D Secure.

## Diseño de la fase 2

1. **Tokenizar la tarjeta en el navegador** con `openpay.js` (la tarjeta nunca toca nuestros servidores) y el `device_session_id` antifraude.
2. Edge Function `openpay-subscribe` (JWT del dueño): crea/recupera el *customer* de Openpay ligado al `tenant_id`, guarda la tarjeta
   y crea la suscripción con el `plan_id` que **el servidor** deduce de `planKey` + periodo (el navegador nunca manda precio ni plan_id).
3. Edge Function `openpay-webhook` (firma/usuario-contraseña del webhook de Openpay + reconsulta del cargo a la API antes de actuar):
   `charge.succeeded` activa o renueva el plan y la fecha de vencimiento; `charge.failed` y `subscription.cancelled` degradan con
   periodo de gracia. Idempotente por `event id`.
4. Gestión propia (Openpay no trae portal): cambiar tarjeta, cambiar de plan (con prorrata simple: el nuevo plan aplica al siguiente
   cobro), cancelar y ver recibos. Pantalla en Configuración → Plan y suscripción.
5. Paquetes extra (tokens, almacenamiento, timbres): hoy `smyl-consumables-*` usa Stripe Checkout. Pasan a **cargos únicos de Openpay**
   (checkout alojado o cargo con la tarjeta guardada). La acreditación ya es idempotente por pedido; solo cambia el proveedor.
6. Retirar `stripe-checkout`, `stripe-portal`, `stripe-webhook` y `_shared/stripe-plans.ts` cuando ya no haya suscriptores en Stripe.
   (En el cliente nunca hubo Price IDs configurados, así que no hay clínicas cobradas por ahí desde la pantalla de planes.)

## Entitlements (qué incluye cada plan) — fase 3

Hoy el servidor limita por **diagnósticos al mes** (`limite_diagnosticos`, `PLAN_LIMITES` 15/40/100). El modelo nuevo es otro:
tokens de IA, GB, timbres, sucursales y usuarios por plan. Hay que:

- Tabla `smyl_plan_entitlements(plan, tokens_mes, gb, timbres_mes, sucursales, usuarios, descuento_paquetes)` como única fuente.
- Acreditar tokens/timbres incluidos cada ciclo (Premium sin caducidad) en las carteras de consumo existentes.
- Aplicar los límites de sucursales y usuarios en el servidor (RLS/RPC), no solo en pantalla.
- Descuento de paquetes extra por plan al calcular el precio en el servidor.

## Riesgos y decisiones abiertas

- **Costo de Meta** por las plantillas de mensajes automáticos fuera de la ventana de 24 h: decidir si se incluye un tope por plan.
- **Facturación (CFDI) de las propias mensualidades de SMYL** a las clínicas: no está definida.
- **Migración**: clínicas existentes y su plan actual (esencial/profesional/premium) conservan clave; los precios nuevos aplican a altas nuevas.
