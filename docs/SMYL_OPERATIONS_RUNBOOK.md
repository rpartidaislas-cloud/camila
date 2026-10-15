# Manual operativo y puerta de lanzamiento de SMYL

**Versión:** 1.0  
**Fecha:** 12 de octubre de 2026  
**Alcance:** operación de la plataforma dental SMYL. LANA continúa aislada como proveedor interno de mensajería e IA.

## Criterio de salida

Una clínica está lista cuando el Centro de lanzamiento muestra 100 % y la aprobación final está registrada. Esa señal no sustituye obligaciones legales ni certifica por sí sola respaldos del proveedor: confirma que la configuración observable y las verificaciones internas de la clínica se completaron.

## Responsabilidades

- **Propietario/administrador:** roles, contacto de incidentes, privacidad, capacitación, simulacro de recuperación y aprobación final.
- **Responsable clínico:** cédulas, protocolos, notas, consentimientos y revisión de accesos clínicos.
- **Recepción:** agenda, identidad del paciente, recordatorios y escalamiento.
- **Inventario/finanzas:** lotes, caducidades, cortes de caja, conciliación y comprobantes.
- **SMYL:** disponibilidad del producto, control de acceso, auditoría, aislamiento multi-tenant y recuperación de plataforma.
- **LANA:** transporte de Meta y runtime del asistente; nunca es repositorio del expediente clínico.

## Apertura diaria

1. Confirmar acceso con cuenta individual; no compartir contraseñas.
2. Revisar agenda, solicitudes pendientes y fallos de recordatorios.
3. Abrir caja por persona y sucursal cuando se reciba efectivo.
4. Revisar insumos bajo mínimo y caducidades próximas.
5. Confirmar salud de canales antes de depender del asistente.

Cuando la clínica active facturación desde SMYL, revisar además la Puerta
fiscal: emisor vigente, servicios sin claves pendientes y conexión sandbox/PAC
en estado verificable. Una confirmación manual nunca sustituye la respuesta del
proveedor.

## Cierre diario

1. Terminar o reclasificar citas abiertas.
2. Firmar notas clínicas completas; las correcciones posteriores son adendas.
3. Cerrar caja, documentar diferencias y conciliar pagos.
4. Revisar mensajes ambiguos, fallos y conversaciones en atención humana.
5. No exportar expedientes a dispositivos personales ni canales no autorizados.

## Incidentes

1. Pausar el canal o proceso afectado sin borrar evidencia.
2. Registrar hora, actor, alcance, pacientes potencialmente afectados y capturas sin PHI innecesaria.
3. Revocar sesiones o accesos comprometidos y preservar la bitácora.
4. Escalar al contacto registrado en el Centro de lanzamiento.
5. Reanudar únicamente después de documentar causa, corrección y validación.

## Recuperación

- Validar periódicamente que los respaldos administrados del proyecto SMYL estén activos según el plan contratado en Supabase.
- Ejecutar un simulacro en un entorno aislado; nunca restaurar sobre producción para “probar”.
- Verificar base, objetos privados, autenticación y funciones antes de declarar recuperado el servicio.
- Registrar fecha, responsable, tiempos y resultado. El Centro de lanzamiento guarda la confirmación, no una copia del respaldo.

## Privacidad y conservación

- Definir aviso de privacidad, responsable, finalidad, derechos ARCO y periodos de conservación aplicables a la clínica.
- Usar archivos privados y URLs firmadas; no convertir buckets clínicos en públicos.
- Dar acceso mínimo por rol y retirar inmediatamente cuentas de personal que ya no trabaja en la clínica.
- No copiar historias clínicas completas a LANA. Solo se comparte el contexto mínimo autorizado para una acción de mensajería.

## Despliegue y reversión

1. Aplicar migraciones en orden y conservar el SHA publicado.
2. Ejecutar pruebas focalizadas y suite completa.
3. Validar escritorio y móvil con datos sintéticos.
4. Publicar primero activos y después verificar HTTP, PWA y funciones.
5. Si aparece una regresión, revertir al commit anterior de la aplicación; las migraciones de datos se corrigen con una nueva migración, nunca borrando historial.

## Límites de esta versión

- El borrador y la prevalidación CFDI no equivalen a timbrado SAT; requieren un
  PAC autorizado. Un plan de cancelación local tampoco cancela el comprobante.
- El Centro de lanzamiento no sustituye monitoreo externo ni prueba automáticamente los respaldos de Supabase.
- La conexión de canales y el piloto de Meta se validan desde Canales e IA e Inbox; no se aprueban falsamente desde este checklist.
