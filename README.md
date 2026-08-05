# 🦷 CAMILA
**Cotización y Análisis Médico Inteligente para La Estética dental**

## Archivos
- `index.html` — Landing + Auth (planes, registro, login)
- `app.html`   — App del dentista (diagnóstico 360 + cotizador)
- `admin.html` — Panel de control (gestión de dentistas)

## Acceso admin
- Usuario: `admin`
- Contraseña: `camiladmin2025`

## Código de acceso del curso
- `CAMILA2025`

## API Key
Abre `app.html` y reemplaza `TU_API_KEY_AQUI` con tu API Key de Anthropic.

## Supabase
- Proyecto propio "Smyl": `rpxshsiwoxdbuevjjpfw`
  (`lgjdzaqjrmmzyrenevfm` es LANA, un proyecto/app distinto y sin relación
  con Camila -- no confundirlos)
- Tablas: `camila_tenants`, `camila_casos`, `camila_notificaciones`,
  `camila_pacientes`. `camila_precios` y `camila_cotizaciones` no existen
  como tablas -- los precios viven en `camila_tenants.config.precios`
  (ver docs/HANDOFF.md 2026-08-04/05) y las cotizaciones no se persisten
  server-side todavía.

## GitHub Pages
- URL: `https://rpartidaislas-cloud.github.io/camila/`

## Superadmin
- Producto: `camila` en columna `producto` de tabla `tenants`
