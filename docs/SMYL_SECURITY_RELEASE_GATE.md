# Puerta de lanzamiento de seguridad de SMYL

**Estado actual: NO AUTORIZADO para datos clínicos reales.**

La revisión automatizada del repositorio y de PostgreSQL es una condición
necesaria, pero no equivale a un pentest externo ni demuestra por sí sola el
aislamiento en un entorno vivo con dos clínicas.

## Controles que deben quedar verdes

- Suite funcional completa y prueba específica de seguridad.
- `supabase db lint --linked --level warning` sin errores de función.
- Cliente web con versión exacta; funciones privadas con JWT obligatorio.
- Sin secretos privados literales en HTML, JavaScript o Edge Functions.
- Migraciones de RLS, archivos privados, cuarentena, retención y auditoría
  aplicadas en producción.
- Smoke tests sin sesión responden 401 en funciones privadas.
- Web y aplicación móvil contienen las mismas pantallas sensibles.

## Evidencia externa obligatoria antes de lanzar

1. **Prueba dinámica de dos clínicas.** En un proyecto desechable, intentar
   lectura, escritura, RPC, Realtime y Storage de A contra B. Debe existir un
   informe firmado con cero cruces. El arnés reproducible está preparado en
   `scripts/two-tenant-isolation.mjs`; todavía no se ha ejecutado porque no hay
   un proyecto de pruebas separado conectado a esta sesión.
2. **Pentest externo.** Alcance mínimo: autenticación, RLS/IDOR, archivos,
   funciones públicas, LANA/Meta, abuso de exportaciones y sesión móvil.
3. **Restauración real.** Restaurar base y objetos cifrados en un entorno
   aislado y medir pérdida/tiempo; el backup administrado de PostgreSQL no
   sustituye el respaldo de Storage.
4. **Análisis antimalware administrado.** La cuarentena actual bloquea formatos
   y PDF activo, pero no se presenta como antivirus completo.
5. **Rotación histórica.** Confirmar revocación de cualquier clave privada que
   haya aparecido en commits anteriores y revisar consumo del proveedor.

## Criterio de decisión

El lanzamiento clínico sólo cambia a **AUTORIZADO** cuando los cinco puntos
externos tienen responsable, fecha, evidencia y cero hallazgos críticos o
altos abiertos. Un hallazgo medio requiere aceptación de riesgo escrita,
mitigación y fecha límite. La aprobación comercial no puede omitir esta puerta.

Para repetir la comprobación local:

```text
node scripts/security-release-gate.mjs
node --test tests/*.test.mjs
npx supabase db lint --linked --level warning
```
