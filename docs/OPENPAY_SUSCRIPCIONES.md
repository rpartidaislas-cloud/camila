# Suscripciones de SMYL con Openpay (reemplaza a Stripe)

Estado: **construido y probado en SANDBOX** (lógica contra la API real de sandbox; pantalla en navegador con el módulo de Openpay simulado).
**Falta**: desplegar, probar con la pantalla real y pasar a producción. Los entitlements (qué incluye cada plan) son la fase 3.

## Qué hay

| Pieza | Archivo |
|---|---|
| Catálogo y utilidades puras | `supabase/functions/_shared/openpay-plans.mjs` |
| Lógica de cobro (probada) | `supabase/functions/_shared/openpay-billing-core.mjs` |
| Conexión a Openpay y a la base | `supabase/functions/_shared/openpay-runtime.ts` |
| Acciones del dueño (JWT) | `supabase/functions/openpay-billing/` → `docs/bundles/openpay-billing.single-file.ts` |
| Avisos de pago (sin JWT) | `supabase/functions/openpay-billing-webhook/` → `docs/bundles/openpay-billing-webhook.single-file.ts` |
| Tablas | `supabase/migrations/20261123140000_smyl_openpay_billing.sql` |
| Pantalla (planes, pago, gestionar) | `smyl-billing.js` + modal «Elige tu plan» en `app.html` |
| Crear los planes en Openpay | `scripts/openpay-create-plans.mjs` |

## Cómo funciona

1. El dueño elige plan y periodo. El navegador carga `openpay.js`, **convierte la tarjeta en un token directamente con Openpay** y manda a SMYL solo
   `plan_key + periodo + token + sesión de dispositivo`. Nunca se manda precio, `plan_id` ni número de tarjeta.
2. `openpay-billing` (solo el dueño) resuelve el `plan_id` en `smyl_billing_plans`, crea el cliente y la tarjeta, y suscribe. **El primer cobro es inmediato**;
   si el banco lo rechaza no cambia nada. Al cambiar de plan se crea la nueva y después se cancela la anterior (sin prorrata).
3. Al activarse: `camila_tenants.plan`, `activo`, `vence_en` (= próximo cobro + 3 días de gracia) y `limite_diagnosticos` (valores de hoy: 15/40/100).
4. `openpay-billing-webhook`: Openpay avisa de cada cobro; el aviso solo identifica a la clínica y **se reconsulta la API** (no se cree el contenido). Idempotente por evento.
   Un cobro fallido deja la cuenta activa durante la gracia; vencida, se apaga. Cancelar = dejar de renovar, con acceso hasta el fin del periodo pagado.

## Topes y decisiones tomadas

- Openpay limita **cada cobro de un plan a $10,000**. Premium anual ($14,990) se cobra en **2 pagos semestrales de $7,495** (mismo total). Si en producción el tope es mayor, se puede cambiar a un cobro anual.
- Anual = 10 meses al precio mensual (2 gratis): $2,990 / $8,990 / $14,990.
- **Sin prorrata** al cambiar de plan: el plan nuevo cobra completo desde hoy.

## Despliegue (en este orden)

1. **Migración**: pegar `supabase/migrations/20261123140000_smyl_openpay_billing.sql` en el SQL Editor (trae los 6 planes de SANDBOX ya registrados).
2. **Secrets** en Supabase → Edge Functions → Secrets (nunca en el código ni en el chat):
   `OPENPAY_MERCHANT_ID`, `OPENPAY_PRIVATE_KEY` (sk_…), `OPENPAY_PUBLIC_KEY` (pk_…), `OPENPAY_ENV` = `sandbox`,
   `OPENPAY_WEBHOOK_USER` y `OPENPAY_WEBHOOK_PASSWORD` (los inventas tú: contraseña larga y aleatoria).
3. **Funciones**: crear `openpay-billing` (con verificación de JWT **encendida**) y `openpay-billing-webhook` (verificación de JWT **apagada**) pegando sus archivos de `docs/bundles/`.
4. **Webhook en Openpay** (panel de sandbox → Webhooks): URL `https://<proyecto>.supabase.co/functions/v1/openpay-billing-webhook`, usuario y contraseña = los del paso 2,
   eventos `charge.succeeded`, `charge.failed`, `subscription.charge.failed`. Openpay manda un evento `verification` con un código: queda en los registros de la función
   y en `smyl_billing_events` (`event_key = 'verification:<código>'`); cópialo en el panel de Openpay para activarlo.
5. Probar en la app: Configuración → Cuenta y seguridad → Plan y suscripción → «Cambiar plan» con la tarjeta `4111 1111 1111 1111` (fecha futura, CVV 123).
   Rechazo: `4000 0000 0000 0002`. Verificar en `smyl_billing_subscriptions` y en `camila_tenants`.

## Paso a producción

1. En Openpay producción: confirmar que la cuenta tiene **suscripciones** habilitadas.
2. `OPENPAY_MERCHANT_ID=… OPENPAY_PRIVATE_KEY=sk_… OPENPAY_ENV=production node scripts/openpay-create-plans.mjs` (Node 22; ejecútalo en tu equipo) → imprime el SQL para registrar los `plan_id` de producción.
3. Cambiar los secrets a producción (`OPENPAY_ENV=production`, llaves de producción), crear el webhook de producción y repetir la prueba con una tarjeta real de bajo monto.

## Riesgos y pendientes

- **El comercio de Openpay es compartido con LANA** (cobros de pacientes de las clínicas): LANA tiene sus propios webhooks `charge.succeeded` en el mismo comercio y recibirá también los cobros de suscripciones de SMYL.
  SMYL ignora los cobros de clientes que no son suyos; falta confirmar que LANA haga lo mismo. Recomendado: **un comercio de Openpay separado para las suscripciones de SMYL**
  (contabilidad limpia y sin cruce de avisos).
- **Fase 3 (entitlements)**: hoy el servidor limita por diagnósticos al mes. Falta acreditar tokens, GB y timbres incluidos, aplicar sucursales/usuarios en servidor y descuentos en paquetes extra.
- **Paquetes extra** (`smyl-consumables-*`) siguen con Stripe; pasan a cargos únicos de Openpay.
- Facturación (CFDI) de las propias mensualidades de SMYL: sin definir. Prorrata al cambiar de plan: sin definir.
- Hay un cobro de prueba por cada corrida de sandbox; no hay dinero real.
