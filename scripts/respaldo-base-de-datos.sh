#!/usr/bin/env bash
# Respaldo manual de la base de datos de SMYL (Supabase) con pg_dump.
# Uso:   SUPABASE_DB_URL='postgresql://postgres:CONTRASEÑA@db.XXXX.supabase.co:5432/postgres' ./scripts/respaldo-base-de-datos.sh [carpeta]
# La cadena de conexión está en Supabase → Project Settings → Database → Connection string (URI). NO la guardes en el repositorio.
# Guarda el archivo .dump FUERA del repositorio y en un lugar distinto a Supabase (disco externo, otro almacenamiento en la nube).
# Importante: esto respalda la BASE DE DATOS. Los archivos de Storage (fotos, radiografías, documentos) NO van aquí; ver docs/RESPALDOS.md.
set -euo pipefail
: "${SUPABASE_DB_URL:?Falta SUPABASE_DB_URL (ver el encabezado de este script).}"
DEST="${1:-./respaldos}"
mkdir -p "$DEST"
STAMP="$(date +%Y-%m-%d_%H%M)"
OUT="$DEST/smyl-$STAMP.dump"
command -v pg_dump >/dev/null || { echo "Falta pg_dump (instala el cliente de PostgreSQL 15 o superior)."; exit 1; }
# Formato personalizado (-Fc): comprimido y restaurable con pg_restore. Sin dueños ni permisos de la instancia de origen.
pg_dump "$SUPABASE_DB_URL" --format=custom --no-owner --no-privileges --schema=public --schema=auth --file="$OUT"
# Comprobación mínima: el archivo debe poder listarse y no estar vacío.
pg_restore --list "$OUT" >/dev/null
SIZE="$(du -h "$OUT" | cut -f1)"
echo "Respaldo listo: $OUT ($SIZE)"
echo "Siguiente paso: probar la restauración en una base de PRUEBA (ver docs/RESPALDOS.md). Un respaldo que no se ha restaurado no cuenta."
