# Seguridad de SMYL — avance por etapas

Estado al 14 de octubre de 2026.

1. **Contención crítica — terminada.** Sesión real obligatoria en funciones
   privadas, secretos fuera del navegador y limpieza de configuración insegura.
2. **Privacidad del navegador — terminada.** Los expedientes y fotografías ya
   no usan almacenamiento persistente local como respaldo clínico.
3. **Archivos clínicos — terminada.** Cuarentena, validación binaria y SHA-256,
   bloqueo de PDF activo, rutas por clínica y enlaces firmados de cinco minutos.
4. **Ciclo de vida y eliminación — terminada.** Política de retención por tipo,
   borrado verificable, limpieza de pendientes y reescaneo conservador de legado.
5. **Monitoreo y respuesta — terminada.** Señales de acceso, exportaciones
   trazables, tablero privado, investigación documentada y runbook.
6. **Validación previa al lanzamiento — preparación terminada.** Base sin
   errores de lint, dependencias web fijadas, matriz de abuso, puerta automática
   y contrato de prueba entre clínicas. El lanzamiento con datos clínicos sigue
   bloqueado hasta ejecutar el pentest y las pruebas externas indicadas abajo.

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

## Alcance de la etapa 4

Cada bucket privado tiene una política explícita: 24 horas para cuarentenas
abandonadas, 7 días para cargas limpias nunca vinculadas y ningún borrado
automático de evidencia vinculada. Antes de borrar se vuelve a comprobar que la
ruta no aparezca en expedientes, radiografías, casos, propuestas o perfiles;
después se confirma que Storage ya no entregue el objeto y se conserva una
bitácora privada del resultado.

El mantenimiento se inicia automáticamente después de una sesión profesional y
se limita a una ejecución por clínica cada 12 horas. También reanaliza hasta tres
objetos `legacy` por ciclo. Un objeto histórico dudoso cambia a
`legacy_review`, continúa disponible y requiere decisión humana: el proceso no
destruye evidencia antigua por una heurística nueva.

La tabla de seguridad funciona como manifiesto de integridad, con MIME, tamaño y
SHA-256 verificados. Una copia externa cifrada y una prueba periódica de
restauración siguen siendo una dependencia operativa del proveedor; no se afirma
que los objetos de Storage estén incluidos en los respaldos de base de datos.

## Alcance de la etapa 5

SMYL conserva telemetría privada y separada por clínica para cuatro familias de
señales: nuevos entornos de acceso, volumen de exportaciones, rechazo o
mantenimiento de archivos y cambios reiterados de privilegios. Los datos de red
y navegador se transforman en el servidor en una huella SHA-256 con un pepper;
no se guardan ni se devuelven direcciones IP o agentes de usuario.

Los PDF clínicos, propuestas, recibos y reportes CSV de la aplicación principal
deben registrar primero la exportación. Los identificadores se almacenan como
huellas irreversibles y el tablero muestra únicamente conteos, severidad,
tiempos y evidencia agregada: nunca nombres, diagnósticos o fotografías.

El Centro de seguridad requiere `audit.read`. Permite poner una señal en
investigación o resolverla con una nota, y registra esa decisión en la bitácora.
Las alertas se presentan como indicios para verificación humana, no como una
declaración automática de intrusión. El procedimiento operativo está en
`docs/SMYL_SECURITY_INCIDENT_RUNBOOK.md`.

## Alcance de la etapa 6

La revisión de PostgreSQL encontró y corrigió tres errores reales: una columna
ambigua en inventario, aritmética temporal inválida en el reporte ejecutivo y
la resolución incorrecta de `digest` en el registro de exportaciones. Después
se limpiaron las advertencias restantes; el analizador remoto termina sin
errores ni advertencias.

El cliente Supabase del navegador quedó fijado a una versión exacta y la puerta
automática comprueba secretos literales, JWT de funciones privadas, cuarentena,
bitácoras privadas, correcciones versionadas y paridad web/móvil. La matriz de
abuso y la decisión de salida están en `SMYL_SECURITY_ABUSE_MATRIX.md` y
`SMYL_SECURITY_RELEASE_GATE.md`.

Esta etapa no se presenta como validación independiente consumada: faltan la
prueba viva con dos clínicas sintéticas, un pentest externo, restauración de
base y objetos, análisis antimalware administrado y confirmación de rotación de
credenciales históricas. Hasta documentar esas evidencias, no deben cargarse
datos clínicos reales.
