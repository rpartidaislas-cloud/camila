# Ficha clínica 360 de SMYL

## Objetivo

La etapa 3 convierte el perfil del paciente en un expediente dental longitudinal. No sustituye los módulos clínicos ya construidos: los reúne con antecedentes, notas, citas y archivos bajo la misma identidad de paciente y el mismo tenant de SMYL.

## Experiencia de producto

- Resumen de alertas, alergias, estado de antecedentes, notas firmadas, última cita y archivos.
- Historia médica y dental estructurada, versionada en cada guardado.
- Notas SOAP en borrador, firma clínica inmutable y correcciones mediante adendas fechadas.
- Historial de citas enlazado con servicio y profesional.
- Fotografías, radiografías, consentimientos, recetas y PDF en almacenamiento privado.
- Línea de tiempo común para citas, notas y archivos.
- Accesos directos al odontograma, simulaciones/casos y plan de tratamiento existentes.

## Seguridad

Toda fila clínica incluye `tenant_id` y relación compuesta con el paciente. La lectura requiere `clinical.read`, la captura `clinical.write` y la firma/adenda `clinical.approve`. El navegador no tiene permisos de escritura directa sobre antecedentes, notas ni metadatos de archivos: las mutaciones pasan por RPC con validación de tenant y control de revisión.

El bucket `smyl-clinical-files` es privado, limita archivos a 20 MB y acepta únicamente JPEG, PNG, WebP y PDF. Las rutas incluyen clínica, paciente e identificador de archivo. La lectura usa URL firmada temporal; no se expone una URL pública ni existe borrado directo desde el cliente. Los intentos de carga que no llegan a registrarse pueden limpiarse mediante una acción restringida que rechaza archivos ya incorporados a un expediente.

## Integridad clínica

- Los antecedentes conservan todas sus versiones.
- Los borradores usan revisión optimista para no sobrescribir cambios concurrentes.
- Una nota firmada ya no puede editarse.
- Una corrección posterior se agrega como adenda sin alterar la nota original.
- Las operaciones relevantes alimentan la auditoría de SMYL.

## Archivos de implementación

- Migraciones `20261012270000` a `20261012290000`.
- Interfaz `smyl-patient-360.js` y `smyl-patient-360.css`.
- Pruebas `tests/patient-360-stage3.test.mjs`.

## Siguiente etapa

La etapa 4 es inventario y compras dental: catálogo, proveedores, lotes, caducidades, existencias por sede, recepción, traslados, consumos por procedimiento y mermas con trazabilidad.
