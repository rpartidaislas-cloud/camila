# SMYL · Reportes y tablero ejecutivo (etapa 6)

## Objetivo

Convertir la operación diaria de la clínica en indicadores accionables sin
descargar expedientes ni datos de pacientes al navegador. El tablero integra
agenda, cobranza e inventario propios de SMYL.

## Indicadores

- Ingresos netos del periodo, facturación interna, reembolsos, ticket promedio
  y saldo vigente por cobrar.
- Citas, tratamientos completados, cancelaciones, inasistencias y porcentaje de
  asistencia.
- Tendencia diaria de cobranza o, si el usuario no puede ver finanzas, de citas.
- Demanda y terminación por servicio.
- Actividad por profesional, presentada como indicador operativo y no como
  evaluación de calidad clínica.
- Insumos bajo mínimo, lotes próximos a caducar, compras abiertas y cajas sin
  cerrar.

## Seguridad

`smyl_executive_dashboard()` valida clínica, periodo y sucursal. Cada bloque se
calcula únicamente cuando el usuario tiene `schedule.read`, `finance.read` o
`inventory.read`; de lo contrario devuelve una señal de acceso restringido. La
respuesta contiene agregados, nunca nombres, notas, fotografías ni expedientes
de pacientes. El periodo máximo es de 366 días.

El CSV se genera localmente con los mismos indicadores agregados visibles. No se
envía a LANA ni a servicios externos.
