# Facturación en producción · lista de puesta en marcha

Lo que es software ya está en SMYL; esta lista cubre lo que requiere a una persona. Hazla en orden, por clínica piloto.

## 1. Configuración de la clínica (4/4 en Configuración → Cobros → Facturación)
1. Datos fiscales de la clínica **revisados** (RFC, razón social, régimen, CP).
2. CSD cargado y su RFC coincide con el de la clínica (SMYL lo comprueba).
3. Carta Manifiesto firmada (Facturapi marca la organización como lista para producción).
4. Servicios con clave SAT, impuestos y formas de pago **confirmados por el contador** («Falta la confirmación de tu contador» desaparece).

## 2. Validación con el contador (antes de emitir)
Con 3 comprobantes de **sandbox** (consulta normal, pago parcial, anticipo) el contador confirma: clave de producto/servicio, objeto de impuesto, IVA 0 %/exento en servicios médicos, forma y método de pago, uso del CFDI. Anota fecha y nombre; es lo que respalda el paso 4 de arriba.

## 3. Interruptores del servidor (Supabase → Edge Functions → Secrets), apagados por defecto
| Secreto | Valor | Qué habilita |
|---|---|---|
| `FACTURAPI_USER_KEY`, `FACTURAPI_ENCRYPTION_KEY` | los de producción | crear organizaciones y guardar llaves cifradas |
| `FACTURAPI_LIVE_STAMPING` | `1` | timbrar CFDI reales |
| `FACTURAPI_LIVE_CANCELLATION` | `1` | cancelar CFDI reales (además pide escribir **CANCELAR EN PRODUCCION**) |

Enciende `FACTURAPI_LIVE_STAMPING` solo después del paso 2. `FACTURAPI_LIVE_CANCELLATION` se enciende después de la prueba del paso 4 (cancelar requiere haber emitido).
Tras cambiar un secreto, redespliega `facturapi` (`docs/bundles/facturapi.single-file.ts`).

## 4. Prueba controlada en producción
1. En la clínica piloto pulsa «Activar producción» (texto **FACTURAR EN PRODUCCION**).
2. Emite **una** factura real de bajo monto a un RFC propio.
3. Descarga XML/PDF y valida el UUID en el portal del SAT.
4. Cancélala desde SMYL con motivo 02. Si el receptor debe aceptar, usa «Verificar cancelación» y confirma el acuse.
5. Revisa `smyl_cfdi_stamp_events` (el campo `detail.live` queda en `true`).
6. Si algo falla: «Volver a pruebas» en la misma pantalla, y apaga los secretos del paso 3.

## 5. Después
- Alerta de Finanzas «Factura en proceso de timbrado» (CFDI enviado hace más de 1 h): usa «Reconciliar».
- Los motivos 01 (con sustitución) y 04 requieren el UUID del CFDI relacionado.
