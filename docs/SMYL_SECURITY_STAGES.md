# Seguridad de SMYL — avance por etapas

Estado al 14 de octubre de 2026.

1. **Contención crítica — terminada.** Sesión real obligatoria en funciones
   privadas, secretos fuera del navegador y limpieza de configuración insegura.
2. **Privacidad del navegador — terminada.** Los expedientes y fotografías ya
   no usan almacenamiento persistente local como respaldo clínico.
3. **Archivos clínicos — terminada.** Cuarentena, validación binaria y SHA-256,
   bloqueo de PDF activo, rutas por clínica y enlaces firmados de cinco minutos.
4. **Ciclo de vida y eliminación — siguiente.** Política de retención por tipo,
   borrado verificable, limpieza de pendientes, reescaneo de legado y respaldo.
5. **Monitoreo y respuesta — pendiente.** Alertas, anomalías de acceso,
   exportaciones trazables, runbooks e investigación de incidentes.
6. **Validación independiente — pendiente.** Pruebas de aislamiento entre
   clínicas, revisión de dependencias y pentest antes de datos clínicos reales.

## Alcance de la etapa 3

Los seis buckets protegidos son privados. Un archivo nuevo se registra como
`pending`; una función autenticada descarga los bytes usando privilegio de
servidor, comprueba el tipo real, tamaño y SHA-256 y sólo entonces lo marca
`clean`. Si falla, queda `rejected` y el objeto se elimina. Las tablas clínicas
cuentan además con triggers que impiden vincular rutas pendientes o rechazadas.

Los objetos existentes se conservan como `legacy`; esto evita romper expedientes
actuales y permite reescanearlos en la etapa 4. El filtro actual bloquea formatos
falsos y capacidades activas peligrosas en PDF, pero no sustituye un motor AV
especializado. Antes de operar a gran escala conviene sumar escaneo administrado
y una cola de reanálisis.
