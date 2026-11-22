# Respaldos de SMYL

Documento vivo. **Estado al 2026-11-22: sin evidencia de respaldo ni de restauración probada** (es una de las 5 evidencias externas que pide `SMYL_SECURITY_RELEASE_GATE.md`).

## Qué hay que proteger
| Qué | Dónde vive | ¿Lo cubre el respaldo de la base de datos? |
|---|---|---|
| Pacientes, citas, historia clínica, cobros, consentimientos | Postgres de Supabase | Sí |
| Usuarios y accesos | Esquema `auth` de Supabase | Sí (el script lo incluye) |
| Fotos, radiografías, documentos, firmas en archivo | Storage de Supabase | **No**: se respalda aparte |
| Código y migraciones | GitHub | Sí (el repositorio) |
| Claves de las Edge Functions | Panel de Supabase → Edge Functions → Secrets | No: anótalas en un gestor de contraseñas |

## Opciones (de menos a más protección)
1. **Hoy, a mano (gratis):** `scripts/respaldo-base-de-datos.sh`. Sirve como punto de partida, pero depende de que alguien lo corra.
2. **Plan Pro de Supabase:** respaldos diarios automáticos con retención de 7 días y descarga desde el panel (Database → Backups). Es lo mínimo razonable para datos clínicos.
3. **Pro + Point-in-Time Recovery (PITR):** permite volver a un minuto exacto, por ejemplo justo antes de un borrado por error. Es un complemento de pago.

Los precios y límites de Supabase cambian: confírmalos en su página antes de decidir.

## Qué hacer, en orden
1. Decidir plan (opción 2 como mínimo).
2. Correr el respaldo manual **una vez ahora** y guardarlo fuera de Supabase.
3. **Probar la restauración** en un proyecto o base de prueba, nunca en producción:
   ```
   createdb smyl_prueba
   pg_restore --no-owner --no-privileges -d smyl_prueba ./respaldos/smyl-AAAA-MM-DD_HHMM.dump
   ```
   Revisar que existan las tablas y que las cuentas de pacientes, citas y consentimientos tengan filas.
4. Respaldar Storage: descargar los buckets con el CLI de Supabase (`supabase storage cp -r ss:///BUCKET ./carpeta`) o con una herramienta compatible con S3 desde el panel de Storage.
5. Anotar la fecha y el resultado abajo.

## Bitácora de respaldos y pruebas de restauración
| Fecha | Qué se hizo | Resultado | Quién |
|---|---|---|---|
| | | | |
