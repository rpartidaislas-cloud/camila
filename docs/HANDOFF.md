# Bitácora compartida — SMYL

Este archivo es la memoria compartida entre Codex (diseño/frontend) y Claude
Code (arquitectura/backend/infra). Ninguno de los dos agentes recuerda lo que
hizo el otro entre sesiones — así que antes de tocar algo, lee la entrada más
reciente que mencione ese archivo, y al terminar deja tu propia entrada.

Formato de cada entrada: fecha, agente, qué se tocó, qué debe saber el otro.
Las entradas más nuevas van arriba.

---

## 2026-07-30 — Claude Code

**Tocado:** `simulacion.html`, `revision-clinica.html`, `mobile/www/*.html`

- Arreglado: "Ajustar alineación" no se guardaba — el modo pantalla completa
  usaba `object-fit:contain` y la vista normal `object-fit:cover`, así que
  el ajuste se veía movido al salir. Ahora ambos modos usan el mismo
  `object-fit`/`object-position`. Si Codex toca CSS de `.ba-wrap`,
  `.ba-fullscreen`, `.ba-base img` o `.ba-over img`, cuidado con reintroducir
  ese mismo mismatch.
- Reforzado el prompt de generación de IA (en ambos archivos) para evitar
  que tonos VITA oscuros cambien el color/iluminación del resto de la foto.
- Creado este archivo y `AGENTS.md` — reparto de trabajo: Codex = diseño/
  frontend, Claude = todo lo demás (backend, Supabase, IA, seguridad, móvil).

**Pendiente / en curso:** auditoría de seguridad de Supabase (RLS, Storage
público) — ver hallazgos abajo, no confirmados aún contra la base de datos
real porque el conector de Supabase no está habilitado en esta sesión.

### Hallazgo de seguridad (evidencia en código, no confirmado en vivo)

El bucket `camila-fotos` se usa con URLs `/storage/v1/object/public/...`
(ver `subirResultadoAStorage()` en simulacion.html y el equivalente en
revision-clinica.html) — esto implica que el bucket está configurado como
**público**: cualquiera con el link puede ver la foto sin autenticarse, sin
expiración. Esto incluye simulaciones generadas de pacientes reales.
Recomendación: mover a bucket privado + URLs firmadas con expiración. No se
ha tocado el código todavía porque cambia el contrato de cómo
`revision-clinica.html` consume esas URLs — requiere coordinarlo antes de
implementar.

También pendiente de confirmar en vivo: si la política RLS de `camila_casos`
(que ya exige `auth.uid()`, ver comentario en `CFG` de simulacion.html)
realmente limita cada dentista a ver solo sus propios casos vía `tenant_id`,
o si cualquier cuenta logueada puede leer casos de otro tenant.
