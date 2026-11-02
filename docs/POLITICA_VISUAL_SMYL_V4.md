# Guía visual SMYL v4

**Versión:** 4.0 (etapa 1 en implementación)
**Estado:** criterio de diseño (no norma rígida): cuando algo se vea mejor de otra forma, manda el criterio de
diseño y esta guía se actualiza
**Decisión:** Ricardo, 2026-11-02 — "que sea como la del repo, que tiene mejor personalidad, pero con los colores
que actualmente usa SMYL" y "aplica lo que quede mejor desde una perspectiva de diseño gráfico, no forzosamente la
política visual".
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
| Radios | 0–4 px, tarjetas rectas | **Se adapta:** 8 px controles, 10 px tarjetas, 12 px paneles (ver nota) |
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
- Sus esquinas casi rectas. Casi todas las pantallas de SMYL ya usan 8–12 px (≈1 400 radios fijos en 60 `.css`);
  un shell afilado junto a pantallas redondeadas se vería inconsistente y obligaría a reescribirlas. El carácter de
  Datta viene de la tipografía, la sombra difusa, las filas de la barra y la cabecera, no de la esquina.

## 4. Implementación

- `smyl-ui-datta-v4.css` (se carga la **última** en `app.html`): tokens `--smyl-ui-radius-*`, sombra, fuente y
  reglas del shell acotadas a `.layout`. Solo forma, sombra y tipografía; ningún color nuevo (lo vigila
  `tests/smyl-ui-datta-v4.test.mjs`). Para revertir basta quitar su `<link>`.
- Open Sans se pide junto a Inter en el mismo enlace de Google Fonts.
- Copia en `mobile/www/` y entrada en el precache de `sw.js`.

## 5. Plan de migración

1. **Etapa 1 (esta):** tokens, tipografía, barra lateral, cabecera, tarjetas, botones y tablas del shell.
2. **Etapa 2:** revisar pantalla por pantalla (Agenda, Pacientes, Radiografía, Casos) con capturas reales y
   unificar lo que desentone: tarjetas con borde frente a tarjetas con sombra, pesos de encabezado, espaciados.
   No hace falta migrar los radios: el sistema 8/10/12 px ya coincide con lo que usan.
3. **Etapa 3:** diálogos, superficies públicas y tipografía en gráficas y tablas densas.

## 6. Reglas para pantallas nuevas

- Preferir los tokens `--smyl-ui-*` para radio, sombra y fuente.
- Un color nuevo debe pasar contraste AA (4,5:1 en texto); ese es el único límite duro.
- Tarjeta = sin borde + `--smyl-ui-shadow-card`. Sin sombras de color en botones.

## 7. Atribución

Valores de diseño tomados de Datta Able Free (MIT, © CodedThemes). No se incluye su código; la licencia exige
conservar el aviso solo al copiar partes sustanciales.
