# Política visual SMYL v4

**Versión:** 4.0 (etapa 1 en implementación)
**Estado:** normativa para lo que se construya o migre desde 2026-11-02
**Decisión:** Ricardo, 2026-11-02 — "la política de imagen que sea como la del repo, que tiene mejor
personalidad, pero con los colores que actualmente usa SMYL".
**Relación con v3.2:** v4 sustituye la **personalidad** de v3.2 (formas, sombras, tipografía, estructura del
shell). **Los colores de SMYL no cambian** y las reglas de accesibilidad de v3.2 siguen vigentes
(`POLITICA_VISUAL_SMYL_V3.md`, secciones de color, contraste, foco y estados).

## 1. Referencia

[Datta Able Free React Admin Template](https://github.com/codedthemes/datta-able-free-react-admin-template)
(CodedThemes, licencia MIT, v4.1.0). Es una referencia de **lenguaje visual**, no una dependencia: SMYL es
HTML/JS sin React ni Bootstrap, así que no se instala ni se copia código; se traducen valores a los tokens
`--smyl-ui-*`.

## 2. Qué se adopta

| Elemento | Datta Able | SMYL v4 |
|---|---|---|
| Tipografía | Open Sans 14 px, encabezados ligeros (400–500) | Open Sans 14 px; título de página 18 px / 500; Inter queda de respaldo |
| Radios | 4 px controles; tarjetas rectas | 4 px controles y tarjetas; 6 px paneles flotantes |
| Tarjetas | sin borde, relleno 25 px, `0 1px 20px rgba(69,90,100,.08)` | sin borde, relleno 25 px, `0 1px 20px rgba(11,27,46,.08)` (misma sombra, tinte marino) |
| Barra lateral | 264 px, filas a ancho completo, marca de 3 px en la activa, subtítulos en mayúsculas | 264 px, filas a ancho completo, marca de 3 px **turquesa SMYL**, fondo activo `rgba(0,0,0,.18)` |
| Cabecera | 74 px, translúcida, sin borde | 74 px (64 px en móvil), translúcida, sin borde |
| Controles | alto ≈ 38 px, sin sombra de color | botón 38 px; tokens de campo y botón `smyl-ui` a 40 px |
| Tablas | filas aireadas, cabecera sutil | relleno 14 px, cabecera en mayúsculas 11 px |

## 3. Qué NO se adopta (y por qué)

- **Su paleta.** `#04a9f5` sobre blanco da contraste 2,63:1 (falla AA 4,5:1 para texto y botones con texto
  blanco); `#1de9b6` sobre blanco, 1,57:1; `#f4c22b`, 1,67:1. SMYL es una plataforma clínica donde se lee
  información de pacientes: se conservan el azul marino `#0b1b2e`/`#194391`, el turquesa `#0f766e`/`#38a99d`
  y los semánticos de v3.2.
- Sus iconos (Tabler/Phosphor/Feather), gráficas (ApexCharts), mapas ni sus páginas de ejemplo.
- Tarjetas con radio 0: se usan 4 px.

## 4. Implementación

- `smyl-ui-datta-v4.css` (se carga la **última** en `app.html`): tokens `--smyl-ui-radius-*`, sombra, fuente y
  reglas del shell acotadas a `.layout`. Solo forma, sombra y tipografía; ningún color nuevo (lo vigila
  `tests/smyl-ui-datta-v4.test.mjs`). Para revertir basta quitar su `<link>`.
- Open Sans se pide junto a Inter en el mismo enlace de Google Fonts.
- Copia en `mobile/www/` y entrada en el precache de `sw.js`.

## 5. Plan de migración

1. **Etapa 1 (esta):** tokens, tipografía, barra lateral, cabecera, tarjetas, botones y tablas del shell.
2. **Etapa 2:** Agenda, Pacientes y Radiografía. Hoy tienen ≈1 400 radios fijos (8–16 px) en 60 `.css` que
   los tokens no alcanzan; cada pantalla se migra a `var(--smyl-ui-radius-*)` con capturas antes/después.
3. **Etapa 3:** el resto de pantallas, diálogos (`--smyl-radius-dialog` sigue en 12 px hasta entonces) y
   superficies públicas.

## 6. Reglas para pantallas nuevas

- Usar solo tokens `--smyl-ui-*` para radio, sombra y fuente; no escribir radios en px.
- Un color nuevo exige tocar v3.2 y pasar su verificación de contraste.
- Tarjeta = sin borde + `--smyl-ui-shadow-card`. Sin sombras de color en botones.

## 7. Atribución

Valores de diseño tomados de Datta Able Free (MIT, © CodedThemes). No se incluye su código; la licencia exige
conservar el aviso solo al copiar partes sustanciales.
