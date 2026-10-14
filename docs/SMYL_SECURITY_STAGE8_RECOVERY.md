# Etapa 8 — recuperación y antimalware

## Estado

**Herramientas y criterios preparados; simulacro e integración externa
pendientes.** No se exportaron datos de producción durante esta etapa.

Supabase respalda PostgreSQL, pero los objetos de Storage y su metadata deben
tratarse como componentes distintos. El paquete de SMYL genera volcados lógicos,
copia los nueve buckets relevantes, cifra cada artefacto con `age` y crea un
manifiesto SHA-256. La carpeta final no admite SQL ni archivos clínicos en claro.

## Creación del paquete cifrado

Debe ejecutarse en una estación administrativa dedicada, con disco cifrado y
una clave pública `age`. La clave privada permanece fuera del equipo de origen.

```text
SMYL_BACKUP_CONFIRM=EXPORT_ENCRYPTED_CLINICAL_BACKUP
SMYL_BACKUP_AGE_RECIPIENT=age1...
node scripts/create-encrypted-backup.mjs --out=D:\smyl-backups\2026-10-14
```

Primero puede validarse el entorno con `--dry-run`. Los archivos temporales se
crean dentro del directorio temporal del sistema, se cifran y se eliminan en un
bloque `finally`; aun así, la estación debe considerarse sensible.

## Simulacro de restauración

1. Crear un proyecto Supabase nuevo y desechable.
2. Descifrar el paquete sólo en una estación aislada.
3. Restaurar roles, esquema, datos e historial de migraciones.
4. Restaurar objetos mediante la API/CLI de Storage, nunca insertando filas a
   mano en `storage.objects`.
5. Comparar conteos y SHA-256 de al menos diez objetos o todos si hay menos.
6. Ejecutar lint, suite completa y el arnés de dos clínicas.
7. Medir RPO y RTO reales y destruir el proyecto y temporales al terminar.
8. Registrar evidencia sin datos clínicos y validarla con:

```text
node scripts/validate-restore-evidence.mjs --evidence=restore-evidence.json
```

## Salida

La etapa sólo obtiene `PASS` cuando restauración e integridad coinciden, RLS y
URLs privadas funcionan, RPO/RTO están medidos y un proveedor antimalware
contratado aprueba archivo limpio, EICAR y timeout en modo fail-closed.
