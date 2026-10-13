# SMYL · Caja y finanzas dentales (etapa 5)

## Alcance

Esta etapa incorpora cuentas por paciente, cargos vinculables a cita/servicio,
pagos, aplicación de saldos, anticipos, reembolsos, recibos internos, sesiones y
cortes de caja, movimientos de efectivo y expediente fiscal. Es infraestructura
propia de SMYL y no usa las tablas ni los webhooks de Stripe que cobran la
suscripción del SaaS.

## Reglas operativas

- Cargos, pagos, aplicaciones, reembolsos, ajustes y recibos se confirman mediante
  RPC transaccionales e idempotentes. El navegador solo puede leerlos.
- Un cargo pagado no se cancela directamente. El reembolso restituye el saldo
  aplicado y conserva la trazabilidad del movimiento original.
- Los anticipos quedan como saldo a favor del paciente.
- El efectivo exige una caja abierta en la misma sucursal. El corte calcula fondo
  inicial + cobros − reembolsos + entradas − salidas y conserva la diferencia.
- Cada pago genera un folio de recibo interno. El recibo declara expresamente que
  no es CFDI.
- Los datos fiscales se validan y congelan en un borrador por pago. No existe
  timbrado, cancelación SAT ni envío automático hasta conectar un PAC autorizado.
- `finance.read` permite consulta y `finance.manage` habilita las acciones. RLS
  mantiene todo tenant-scoped y las operaciones sensibles se auditan.

## Archivos

- `supabase/migrations/20261012330000_smyl_finance.sql`
- `supabase/migrations/20261012340000_smyl_finance_actions.sql`
- `smyl-finance.js`
- `smyl-finance.css`

## Pendiente deliberado

La integración real de CFDI requiere elegir proveedor PAC, credenciales,
certificados, pruebas de timbrado/cancelación y funciones servidor a servidor.
No debe implementarse desde el navegador ni confundirse con la facturación de la
suscripción de SMYL.
