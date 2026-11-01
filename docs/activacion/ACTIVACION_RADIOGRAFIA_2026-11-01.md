# Activar la revisión de radiografía (Mesa de Luz) en producción

**Qué es:** el frontend de la Mesa de Luz ya está publicado, pero la IA con cuadros, mapa de piezas y consumo medido necesita
**4 migraciones de base de datos** y **volver a desplegar la función `claude`**. Son dos pasos manuales (~10 min). Proyecto: SMYL.

## Paso 0 · Ver qué falta (1 min, solo lectura)
1. Supabase → proyecto **SMYL** (`rpxshsiwoxdbuevjjpfw`) → **SQL Editor** → New query.
2. Pega `radiografia-2026-11-01-verificacion.sql` y pulsa **Run**.
3. Debe salir `prerequisito_revisiones = true`. Si sale `false`, **para**: faltan las migraciones base de radiografía (avísame).
   Las otras 4 columnas en `false` son lo que vas a activar.

## Paso 1 · Aplicar las 4 migraciones (2 min)
1. SQL Editor → New query.
2. Pega **todo** `radiografia-2026-11-01.sql` (son las 4 migraciones en el orden correcto) y pulsa **Run**.
3. Debe terminar en *Success*. Si se corta, vuelve a ejecutarlo completo: es idempotente.
4. Vuelve a correr el archivo de verificación: las **5 columnas deben quedar en `true`**.

## Paso 2 · Desplegar la función `claude` (5 min)
1. Supabase → **Edge Functions** → **claude** → **Code** (o *Edit function*).
2. Selecciona todo el código, bórralo y pega el contenido de `docs/bundles/claude.single-file.ts` (~94 KB, 1715 líneas).
3. **Deploy**. Deja activado **Enforce JWT verification** (la función debe seguir exigiendo sesión).
4. No hay secretos nuevos: usa los que ya tiene (`ANTHROPIC_API_KEY`, etc.).
5. El bundle es el generado del código actual de `main` (verificado igual al regenerarlo).

## Paso 3 · Probar (3 min)
1. Abre la app y recarga con **Ctrl+F5**.
2. Paciente → estudio radiográfico → revisar con IA (cuesta 2 llamadas de IA por análisis).
3. Debes ver: la **Mesa de Luz** (campo oscuro), señales con **diente** y **cuadros punteados** sobre la imagen, y arriba el aviso si
   alguna señal quedó sin ubicar.
4. Abre **Plan y consumo**: debe aparecer el análisis con costo, tokens y tiempo.

## Si algo falla
| Síntoma | Causa probable | Qué hacer |
| --- | --- | --- |
| La IA responde pero **sin cuadros** en la imagen | No se redesplegó `claude` | Repite el Paso 2 |
| Al **guardar** la revisión falla en la base | Falta la migración del modelo (Paso 1) | Repite el Paso 1 y verifica |
| **Plan y consumo** vacío o aviso en logs | Falta la tabla de consumo (Paso 1) | Repite el Paso 1 |
| Error de **espera / tiempo agotado** | El esfuerzo `high` tarda cerca del límite (120 s) | Avísame: se vuelve a `medium` en `_shared/radiograph-claude.ts` y se redespliega |
| Error 429 | Límite de uso del proveedor de IA | Espera un minuto y reintenta |
| «Observación radiográfica no válida (r#)…» | La IA devolvió un campo fuera del contrato | Mándame la línea completa del diagnóstico |

## Aviso de costo
Con el mapa de piezas, cada análisis hace **dos llamadas** de IA: el costo por análisis sube casi al doble. No se promete exactitud:
es una ayuda para que el dentista revise, no un diagnóstico.
