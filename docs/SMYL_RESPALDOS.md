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
Estación administrativa (Windows) con `age`, `tar`, **Docker Desktop abierto** («Engine running») y la CLI de Supabase enlazada al proyecto de producción (`npx supabase link --project-ref rpxshsiwoxdbuevjjpfw`).
La clave **privada** de `age` vive en otro lugar (gestor de contraseñas / USB guardado); al script sólo se le da la pública. Usa rutas **sin espacios** (`C:\SmylBackups`, `C:\SmylLlaves`).

```text
# Una sola vez
mkdir C:\SmylLlaves ; mkdir C:\SmylBackups
age-keygen -o C:\SmylLlaves\smyl-age.txt           # guarda este archivo en 2 lugares seguros, NUNCA junto a los respaldos

# Cada vez (las variables sólo duran mientras la ventana esté abierta)
cd "$HOME\camila" ; git pull
$env:SMYL_BACKUP_CONFIRM = "EXPORT_ENCRYPTED_CLINICAL_BACKUP"
$env:SMYL_BACKUP_AGE_RECIPIENT = (Select-String -Path C:\SmylLlaves\smyl-age.txt -Pattern 'public key: (age1\S+)').Matches.Groups[1].Value
$sec = Read-Host "Contraseña de la base de datos" -AsSecureString     # no se ve al teclearla
$env:SUPABASE_DB_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
node scripts/create-encrypted-backup.mjs --dry-run --out=C:\SmylBackups\2026-11-09
node scripts/create-encrypted-backup.mjs --out=C:\SmylBackups\2026-11-09
```
La contraseña (Settings → Database → Reset database password) sólo vive en esa variable de la ventana; nunca se escribe en archivos ni se imprime
(si aparece en un mensaje de error, el script la oculta). El script detecta solo la versión de la CLI (`--linked` en 2.x, `--remote` en 3.x) y activa
`--experimental` para Storage; el resultado de `--dry-run` indica `cli`, `project_flag` y `storage_experimental`.

Verificación inmediata (en la estación con la clave privada). Descifra a un temporal que se borra solo y no imprime datos:

```text
node scripts/verify-encrypted-backup.mjs --bundle=C:\SmylBackups\2026-11-09 --identity=C:\SmylLlaves\smyl-age.txt
```
Debe dar `PASS`. Comprueba: manifiesto, carpeta sin archivos en claro, tamaño y SHA-256 de cada archivo, que se
descifra con la clave privada, que el esquema/datos traen `camila_tenants`, que **`auth.users` está incluido**
(sin él nadie podría iniciar sesión tras restaurar) y que el número de objetos de Storage coincide con el manifiesto
bucket por bucket.

Si la verificación falla por `auth.users`: el volcado de datos no incluyó cuentas; vuelve a generarlo con
`supabase db dump --linked --data-only --schema auth` y revisa la versión de la CLI antes de confiar en el paquete.

## Capa 3 — simulacro de restauración (una vez ya, luego cada trimestre)
Objetivo: medir **RPO** (cuánto dato se pierde) y **RTO** (cuánto tarda volver) con números reales. Todo en PowerShell, desde una carpeta **aparte** del repo.

**Regla de seguridad:** el simulacro nunca debe apuntar a producción. Por eso se hace en una carpeta nueva enlazada **sólo** al proyecto desechable;
así, un comando escrito de más no puede tocar `rpxshsiwoxdbuevjjpfw`.

1. **Cronómetro y proyecto desechable.** Anota la hora de inicio. En el panel de Supabase crea un proyecto **nuevo** (p. ej. `smyl-simulacro`), con contraseña propia. Anota su *ref* (la parte de `db.<ref>.supabase.co`).
2. **Carpeta del simulacro enlazada sólo al desechable:**
   ```text
   mkdir C:\smyl-simulacro ; cd C:\smyl-simulacro
   npx supabase init
   npx supabase login
   npx supabase link --project-ref <REF_DESECHABLE>
   ```
   Verifica con `npx supabase projects list`: el proyecto marcado como enlazado debe ser **el desechable**, no `rpxshsiwoxdbuevjjpfw`.
3. **Descifra** en esa carpeta (llave privada fuera de ella):
   ```text
   $b = "C:\SmylBackups\2026-11-08" ; $k = "D:\llaves\smyl-age.txt"
   foreach ($n in "roles.sql","schema.sql","data.sql","storage.tar") { age --decrypt -i $k -o $n "$b\$n.age" }
   ```
4. **Base de datos.** Contraseña con caracteres especiales → codifícala para URL (`@` = `%40`, `#` = `%23`, `/` = `%2F`).
   ```text
   $db = "postgresql://postgres:<CONTRASEÑA>@db.<REF_DESECHABLE>.supabase.co:5432/postgres"
   psql $db -f roles.sql                      # puede avisar «role already exists»: es normal, el proyecto nuevo ya trae los roles de Supabase
   psql -v ON_ERROR_STOP=1 --single-transaction --file schema.sql --command "SET session_replication_role = replica" --file data.sql $db
   ```
   `session_replication_role = replica` desactiva disparadores y llaves foráneas mientras se cargan los datos. Con `--single-transaction`, si algo falla no queda un
   proyecto a medias: se corrige y se repite.
5. **Historial de migraciones:** compara `select count(*) from supabase_migrations.schema_migrations;` entre producción y el desechable (Dashboard → SQL Editor, sólo lectura). Deben coincidir.
6. **Storage.** `tar -xf storage.tar -C storage` y, por cada bucket, `npx supabase storage cp --linked --recursive storage\<bucket> ss:///<bucket>` (los buckets deben existir antes en el
   proyecto desechable: créalos con el mismo nombre y el mismo carácter público/privado). Nunca insertes filas en `storage.objects`. Compara cantidad por bucket con `manifest.json` y el SHA-256 de al menos 10 objetos
   (`Get-FileHash <archivo> -Algorithm SHA256` contra el archivo original descifrado).
7. **Comprueba la aplicación:** iniciar sesión con una cuenta real de prueba (depende de `auth.users`), que RLS aísla dos clínicas
   (`scripts/two-tenant-isolation.mjs` apuntado al desechable), que las URL firmadas funcionan y que las funciones privadas exigen JWT.
8. **Detén el cronómetro.** RTO = tiempo total desde el paso 1; RPO = hora del respaldo contra hora del simulacro.
9. **Evidencia sin datos clínicos:** llena una copia de `docs/restore-evidence.example.json` y valida
   `node scripts/validate-restore-evidence.mjs --evidence=restore-evidence.json`.
10. **Limpieza:** borra el proyecto desechable en el panel y la carpeta `C:\smyl-simulacro` (contiene datos clínicos descifrados), y vacía la papelera.

El validador sólo lee el JSON: **la evidencia vale tanto como la honestidad de quien la llena**.

### Si algo falla
| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| `ABORTADO · Docker no responde` | Docker Desktop cerrado | Ábrelo y espera «Engine running» |
| `ABORTADO · supabase storage ls falló` | Proyecto no enlazado o sesión vencida | `npx supabase login` y `npx supabase link --project-ref rpxshsiwoxdbuevjjpfw` (en `projects list` Smyl debe tener ●) |
| `ABORTADO · Define la contraseña … SUPABASE_DB_PASSWORD` | Falta la variable de la ventana actual | Repite el bloque con `Read-Host` |
| `ABORTADO · El proyecto tiene buckets sin respaldo: X` | Bucket creado a mano que el script no conoce | Agrégalo a `BUCKETS` en `scripts/create-encrypted-backup.mjs` (o `SMYL_BACKUP_ALLOW_UNLISTED=1` sabiendo que quedará sin respaldo) |
| La verificación dice que falta `auth.users` | El volcado de datos no incluyó cuentas | No confíes en ese paquete; repite con `--schema auth` según la versión de la CLI |
| `psql` no se reconoce | Falta el cliente de PostgreSQL o no se reinició PowerShell | `winget install PostgreSQL.PostgreSQL`, cierra y abre PowerShell |
| `permission denied` al restaurar `schema.sql` | Se restauró sobre un proyecto con datos | Usa un proyecto desechable **nuevo y vacío** |

## Frecuencia recomendada
- Paquete cifrado + verificación: semanal (diario si el plan de Supabase no tiene respaldos).
- Revisión del panel de Supabase: mensual.
- Simulacro completo: el primero ahora; después trimestral y tras cualquier cambio grande de esquema o de Storage.
- Guarda al menos 2 copias del paquete en lugares distintos y la clave privada en un tercero.
