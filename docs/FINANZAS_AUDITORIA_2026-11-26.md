# Finanzas SMYL · avance sobre la auditoría de preparación operativa (2026-11-26)

Estado del Bloque 1 («obligatorio antes del piloto») y lo que sigue. Verificado contra el código de `main`; cada hallazgo se comprobó antes de corregirlo.

## Hecho (Bloque 1)

| # | Hallazgo | Estado |
|---|---|---|
| 1 | `smyl-pay`: enlaces de pago sin alcance por sucursal | **Corregido.** `list`, `cancel` y `create` ahora comprueban `smyl_can_access_finance_patient/branch` con la sesión de quien llama. 9 pruebas negativas (`tests/smyl-pay-branch-scope.test.mjs`). Hay paquete nuevo en `docs/bundles/smyl-pay.single-file.ts`. |
| 2 | Recibos que cambian después de emitirse | **Corregido.** La impresión y el envío usan `receipt.snapshot.allocations`; una aplicación posterior de un anticipo ya no reescribe el recibo. |
| 3 | Reembolso en efectivo sin caja de salida | **Corregido** (migración `20261127120000`). El reembolso guarda método, caja y sucursal de salida y referencia; efectivo exige caja abierta; transferencia/tarjeta/cheque exige referencia. Los reembolsos históricos siguen en la caja del pago original: ningún corte cerrado cambia. |
| 4 | Carrera entre cobro y cierre de caja | **Corregido.** Disparador que bloquea la sesión y la vuelve a comprobar en cobros en efectivo, entradas/salidas y reembolsos en efectivo. Probado con dos conexiones reales. |
| 5 | Suite financiera en rojo | **Verde:** 253 pruebas, 0 fallas. Se actualizaron versiones y expectativas obsoletas, un test que dependía de la hora del día, y todo texto < 12 px en `smyl-finance.css`. |
| 6 | Pruebas negativas entre sucursales | Hechas para enlaces de pago. |

## Antes de publicar (orden)

1. Aplicar la migración `20261127120000_smyl_finance_cash_integrity.sql` en el SQL Editor.
2. Desplegar la función `smyl-pay` con `docs/bundles/smyl-pay.single-file.ts`.
3. Publicar la app (la pantalla de reembolso manda parámetros nuevos: **sin la migración, reembolsar falla**).

## Pendiente

- **Bloque 2:** saldos calculados en el servidor (hoy el navegador carga hasta 10,000 filas); persistir la llave del intento de COBRO (en reembolso ya se conserva mientras el diálogo siga abierto); sucursal visible en cobros; conciliación estructurada; alertas de cajas abiertas; verificador de despliegue.
- **Bloque 3 (CFDI productivo):** configuración 4/4, credenciales productivas, cancelación productiva, validación con contador.
- **Bloque 4 (UX):** periodos de la tarjeta «Pagos hoy», títulos repetidos, mensajes de permisos específicos.
- **Operativo (no es software):** cerrar y conciliar la caja abierta desde el 9 de noviembre antes del piloto.
- Fuera de Finanzas: `main` tiene otras 57 pruebas en rojo ajenas a este trabajo (versiones y copias móviles de otros módulos).
