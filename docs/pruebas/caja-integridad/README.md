# Pruebas de integridad de caja (Postgres local)

Verifican `supabase/migrations/20261127120000_smyl_finance_cash_integrity.sql`. Requieren una base local con el esquema de Finanzas y el usuario
dueño de la clínica de prueba; ajusta los ids de sucursal/paciente a los de tu base.

- `escenario-reembolsos.sql` (13 comprobaciones): corte congelado, reembolso desde la caja de SALIDA, efectivo sin caja o con caja cerrada se rechaza,
  transferencia exige referencia y no resta efectivo, histórico sigue en la caja del pago original, idempotencia y tope del importe.
- `setup.sql` + `p1…p4`: dos carreras reales con dos conexiones.
  1. `p1_close_holds` + `p2_pay_into_closing`: un cobro que llega mientras se cierra la caja se RECHAZA («La caja ya fue cerrada»).
  2. `p3_pay_holds` + `p4_close_into_paying`: un cierre que llega mientras se cobra ESPERA y cuenta el cobro.
  Se lanzan en paralelo (`p1` y `p3` retienen el bloqueo 4 s).
