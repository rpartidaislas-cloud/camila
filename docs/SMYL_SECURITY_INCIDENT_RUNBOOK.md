# SMYL — respuesta a incidentes de seguridad

Versión operativa: 14 de octubre de 2026.

Este procedimiento aplica a señales relacionadas con sesiones, permisos,
exportaciones y archivos privados. Una alerta es un indicio que debe verificarse;
no equivale por sí sola a una intrusión ni autoriza borrar evidencia.

## Prioridad

- **Crítica:** exposición confirmada o credenciales administrativas comprometidas.
  Contener inmediatamente y escalar a dirección, responsable técnico y asesoría
  legal/privacidad.
- **Alta:** patrón anómalo con riesgo razonable, como múltiples archivos
  rechazados o exportaciones masivas. Revisar el mismo día.
- **Advertencia:** cambio de permisos, dispositivo o proceso fuera de lo usual.
  Verificar con la persona responsable.
- **Informativa:** tarea preventiva, por ejemplo un archivo histórico conservado
  para revisión humana.

## Procedimiento

1. **Contener.** Revocar sesiones o limitar temporalmente el permiso afectado.
   No eliminar usuarios, expedientes, objetos de Storage ni bitácoras.
2. **Verificar.** Confirmar con el miembro del equipo la hora, tipo de operación y
   finalidad. El panel evita mostrar datos clínicos; si hace falta revisar un
   expediente, hacerlo únicamente dentro del módulo autorizado.
3. **Preservar.** Conservar identificador de la señal, horas, registros de
   exportación y cambios de permisos. No copiar datos clínicos al ticket.
4. **Corregir.** Rotar credenciales comprometidas, reducir permisos, cerrar
   sesiones y corregir la causa técnica. Probar el control antes de reabrir.
5. **Documentar.** Registrar hechos comprobados, decisión, responsable y acción
   tomada. No incluir nombres de pacientes, diagnósticos ni fotografías.
6. **Escalar.** Si se confirma acceso no autorizado a información clínica,
   preservar evidencia y solicitar evaluación legal y técnica antes de decidir
   comunicaciones regulatorias o a pacientes.

## Evidencia mínima

- Identificador y severidad de la señal.
- Primera y última detección.
- Actor interno verificado, sin copiar credenciales.
- Operación y volumen observados.
- Acción de contención, resultado y persona responsable.
- Momento en que se cerró o se escaló el incidente.

## Límites actuales

El panel registra las exportaciones protegidas de la aplicación principal y
señales derivadas de SMYL. No sustituye los registros de Supabase Auth, del
proveedor de correo, de Meta ni de LANA. La conservación externa cifrada y la
prueba de restauración de objetos de Storage siguen siendo controles operativos
por configurar con el proveedor.
