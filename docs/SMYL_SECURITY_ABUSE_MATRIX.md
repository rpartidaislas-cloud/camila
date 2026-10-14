# Matriz de abuso de seguridad de SMYL

Esta matriz convierte los riesgos principales de una plataforma dental en
pruebas repetibles. No contiene datos reales de pacientes.

| Escenario | Intento que debe probarse | Resultado obligatorio | Control actual | Evidencia de salida |
|---|---|---|---|---|
| Lectura entre clínicas | Usuario A consulta pacientes, citas, expedientes, cobros o inventario de B por ID conocido | Cero filas o 403 | RLS, tenant derivado de sesión y permisos | Prueba dinámica con dos clínicas de laboratorio |
| Escritura entre clínicas | Usuario A altera o borra una entidad de B | Operación rechazada y sin cambios | RLS, RPC tenant-scoped y auditoría | Comparación antes/después en entorno desechable |
| IDOR de archivos | Reutilizar ruta o URL firmada de otro tenant | 403; URL vencida no se renueva | Bucket privado, rutas por tenant, firmado en servidor | Prueba de URL cruzada y expirada |
| Archivo engañoso | PDF con JavaScript o imagen cuyo MIME no coincide | Carga rechazada y objeto eliminado | Cuarentena, firma binaria, límites y manifiesto | Registro sin contenido clínico |
| Repetición de operación | Reenviar la misma cita, pago, mensaje o movimiento | Un solo efecto | Claves idempotentes y restricciones únicas | Conteo final y auditoría |
| Escalamiento de rol | Miembro modifica roles o permisos de administración | 403 y señal de seguridad | Permisos explícitos, RPC y monitor | Actor, acción y resultado |
| Función sin sesión | Invocar funciones clínicas con llave pública | 401 antes de datos o proveedor de IA | `verify_jwt=true` y sesión resuelta en servidor | Smoke test sin sesión |
| Abuso de exportación | Descargar repetidamente PDFs o CSV | Eventos auditados y alerta por volumen | Registro de exportaciones y ventana de 15 minutos | Alerta sin identificadores clínicos claros |
| Frontera LANA/Meta | Alterar tenant, conversación o canal desde SMYL | Rechazo; SMYL no recibe tokens ni historial ajeno | Puente servidor-servidor, asignación e idempotencia | Prueba contractual y piloto controlado |
| Formulario público | Automatizar solicitudes de cita o reseñas | Límite, honeypot y token de un uso | Funciones públicas acotadas | Prueba de abuso sin paciente real |
| XSS | Inyectar HTML en nombres, notas o mensajes | Se muestra como texto, no se ejecuta | Escape y fuentes controladas | Payload sintético en cada superficie |
| Persistencia local | Cerrar sesión tras abrir un expediente | No quedan fotos, expediente o diagnóstico en navegador | Limpieza selectiva y nube como origen | Inspección de Storage/IndexedDB |

## Reglas de ejecución

- Ejecutar las pruebas destructivas sólo en un proyecto Supabase desechable.
- Usar dos clínicas y usuarios sintéticos, sin reutilizar producción.
- Guardar únicamente IDs ficticios, tiempos, código de respuesta y conteos.
- Una sola lectura o escritura cruzada bloquea el lanzamiento y exige corregir,
  repetir toda la matriz y revisar el alcance del incidente.
