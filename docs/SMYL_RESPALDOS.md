# SMYL · Respaldos y simulacro de restauración

Un respaldo sólo cuenta si se **verifica** y si alguna vez se **restauró de verdad**. Este documento separa
las tres capas y dice qué comprueba cada herramienta.

| Capa | Qué protege | Quién la hace | Cómo se sabe que funciona |
|---|---|---|---|
| 1. Respaldos administrados de Supabase | Base de datos (diario / PITR según plan) | Supabase | Panel → Database → Backups: fecha del último y plan. **Se revisa a mano.** |
| 2. Paquete cifrado SMYL | Base + 11 buckets de Storage, fuera de Supabase | `create-encrypted-backup.mjs` | `verify-encrypted-backup.mjs` (hash + descifrado + contenido) |
| 3. Simulacro de restauración | Que todo lo anterior realmente se puede levantar | Persona responsable | Evidencia validada con `validate-restore-evidence.mjs` |

Estado al 2026-11-08: la capa 2 estaba **sin probar** y tenía dos defectos (faltaban `smyl-professional-public` y
`mila-audio`; un fallo dejaba datos en claro en el temporal). Corregidos y cubiertos por `tests/backup-behaviour.test.mjs`.
La capa 3 **nunca se ha ejecutado**.

## Buckets cubiertos (11)
`camila-fotos`, `camila-masks`, `camila-analisis`, `smyl-case-photos`, `smyl-radiographs`, `smyl-clinical-files`,
`smyl-proposal-photos`, `smyl-professional-cv`, `smyl-professional-cases`, `smyl-professional-public`, `mila-audio`.
El script **falla cerrado** si el proyecto tiene un bucket que no está en esa lista (se creó a mano en el panel):
agrégalo a `BUCKETS`, o define `SMYL_BACKUP_ALLOW_UNLISTED=1` sabiendo que quedará sin respaldo.

## Capa 1 — revisar en el panel (5 minutos, mensual)
1. Database → Backups: ¿hay respaldos diarios? ¿cuál es la fecha del último? ¿hay PITR?
2. Si el plan no incluye respaldos, la capa 2 es la **única** copia: hazla al menos semanal.
3. Anota fecha y resultado en `docs/HANDOFF.md` o en el Centro de lanzamiento.

## Capa 2 — respaldo cifrado + verificación
Estación administrativa con disco cifrado, `age`, `tar`, Docker y la CLI de Supabase enlazada (`supabase link`).
La clave **privada** de `age` vive en otro lugar (gestor de contraseñas / USB guardado); aquí sólo la pública.

```text
age-keygen -o smyl-age.txt                       # una sola vez; guarda smyl-age.txt fuera del equipo de respaldos
SMYL_BACKUP_CONFIRM=EXPORT_ENCRYPTED_CLINICAL_BACKUP
SMYL_BACKUP_AGE_RECIPIENT=age1...                # la línea "Public key" de smyl-age.txt
node scripts/create-encrypted-backup.mjs --dry-run --out=D:\smyl-backups\2026-11-08
node scripts/create-encrypted-backup.mjs --out=D:\smyl-backups\2026-11-08
```

Verificación inmediata (en la estación con la clave privada). Descifra a un temporal que se borra solo y no imprime datos:

```text
node scripts/verify-encrypted-backup.mjs --bundle=D:\smyl-backups\2026-11-08 --identity=D:\llaves\smyl-age.txt
```
Debe dar `PASS`. Comprueba: manifiesto, carpeta sin archivos en claro, tamaño y SHA-256 de cada archivo, que se
descifra con la clave privada, que el esquema/datos traen `camila_tenants`, que **`auth.users` está incluido**
(sin él nadie podría iniciar sesión tras restaurar) y que el número de objetos de Storage coincide con el manifiesto
bucket por bucket.

Si la verificación falla por `auth.users`: el volcado de datos no incluyó cuentas; vuelve a generarlo con
`supabase db dump --linked --data-only --schema auth` y revisa la versión de la CLI antes de confiar en el paquete.

## Capa 3 — simulacro de restauración (una vez ya, luego cada trimestre)
Objetivo: medir **RPO** (cuánto dato se pierde) y **RTO** (cuánto tarda volver) con números reales.

1. Cronómetro. Crea un proyecto Supabase **nuevo y desechable** (nunca restaures sobre producción).
2. Descifra en una estación aislada: `age --decrypt -i smyl-age.txt -o roles.sql roles.sql.age` (igual con schema, data y storage.tar).
3. Restaura en este orden con `psql "<URL del proyecto desechable>"`: `roles.sql` → `schema.sql` → `data.sql`.
4. Aplica el historial de migraciones y compara el conteo con producción (`select count(*) from supabase_migrations.schema_migrations`).
5. Storage: descomprime `storage.tar` y sube cada bucket con `supabase storage cp --recursive <carpeta> ss:///<bucket>` (nunca
   insertando filas en `storage.objects`). Compara cantidad y SHA-256 de al menos 10 objetos.
6. Comprueba: iniciar sesión con una cuenta real de prueba, que RLS aísla dos clínicas (`scripts/two-tenant-isolation.mjs`
   contra el proyecto desechable), que las URL firmadas funcionan y que las funciones privadas exigen JWT.
7. Detén el cronómetro. RTO = tiempo total; RPO = hora del respaldo vs. hora del simulacro.
8. Llena `docs/restore-evidence.example.json` (sin datos clínicos) y valida:
   `node scripts/validate-restore-evidence.mjs --evidence=restore-evidence.json`
9. Destruye el proyecto desechable y los descifrados temporales.

El validador sólo lee el JSON: **la evidencia vale tanto como la honestidad de quien la llena**.

## Frecuencia recomendada
- Paquete cifrado + verificación: semanal (diario si el plan de Supabase no tiene respaldos).
- Revisión del panel de Supabase: mensual.
- Simulacro completo: el primero ahora; después trimestral y tras cualquier cambio grande de esquema o de Storage.
- Guarda al menos 2 copias del paquete en lugares distintos y la clave privada en un tercero.
