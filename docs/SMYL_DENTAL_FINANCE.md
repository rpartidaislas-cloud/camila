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

## Cierre fiscal previo al PAC — 2026-10-13

- El perfil fiscal del emisor se guarda por clínica, separado de los receptores,
  y exige confirmación explícita de revisión.
- La puerta fiscal comprueba emisor, servicios activos con claves revisadas,
  PAC seleccionado, autorización consultada, cuenta sandbox y política fiscal.
- Los borradores nuevos congelan emisor, receptor y conceptos antes de la
  prevalidación local. Esa prevalidación no consulta catálogos oficiales.
- La cancelación se prepara como intención local auditable con motivos 01–04.
  El motivo 01 exige UUID sustituto; el estado `planned` nunca significa que el
  SAT o el PAC recibió o aceptó una solicitud.
- No se almacenan certificados, contraseñas ni claves PAC en el navegador o en
  estas tablas. La futura integración debe ser servidor a servidor y comenzar
  únicamente en sandbox.
