# Auditoría visual de SMYL y plantilla general UI v3

**Fecha:** 25 de octubre de 2026  
**Alcance medido:** `app.html` y 53 hojas CSS web de la raíz del proyecto.  
**Objetivo:** sustituir la acumulación de tamaños, tarjetas y controles aislados por una plantilla operativa única para todo el panel.

## Resumen ejecutivo

El problema principal no es una pantalla concreta. SMYL tiene varios sistemas visuales superpuestos. Cada módulo resolvió por separado tipografía, densidad, botones, campos, tarjetas y estados. Esto produce una interfaz que funciona, pero pierde jerarquía y se percibe irregular.

La medición encontró:

| Indicador | Resultado |
| --- | ---: |
| Archivos auditados | 54 |
| Declaraciones `font-size` | 2,202 |
| Tamaños tipográficos distintos | 40 |
| Declaraciones menores de 12 px | 888 |
| Archivos con texto menor de 12 px | 47 |
| Tamaños más repetidos | 12 px (478), 11 px (421), 13 px (280), 10 px (257), 9 px (127) |
| Estilos tipográficos incrustados en `app.html` | 136 |

**Diagnóstico:** cerca del 40 % de las declaraciones tipográficas medidas son menores de 12 px. La interfaz utiliza microtexto como recurso de organización y luego compensa con títulos grandes, generando saltos visuales entre 8, 9, 10, 11, 12, 13, 18, 24 y más píxeles dentro de la misma tarea.

## Hallazgos por prioridad

### P0 · Legibilidad y consistencia

1. **Exceso de microtexto.** Ayudas, etiquetas, estados, subtítulos, campos de archivo y datos de la vista previa aparecen entre 7 y 11 px.
2. **Demasiados escalones.** Cuarenta tamaños distintos impiden que el usuario aprenda qué significa visualmente cada nivel.
3. **Escala móvil reducida.** Algunos `@media` disminuyen todavía más la tipografía, justo donde se necesita mayor legibilidad y superficies táctiles.
4. **Jerarquía basada en mayúsculas diminutas.** Los microencabezados en mayúsculas se repiten en exceso y compiten con la información operativa.

### P1 · Formularios

1. **Campos con anatomía diferente.** Altura, radio, fondo, borde, ayuda y separación varían por módulo.
2. **Carga de archivos no diseñada como componente.** El control nativo queda incrustado dentro de tarjetas pequeñas, con textos truncados y acciones difíciles de interpretar.
3. **Acciones dispersas.** Guardar, siguiente, cancelar, publicar y actualizar cambian de posición y peso visual.
4. **Demasiadas tarjetas dentro de tarjetas.** La agrupación visual no siempre representa una decisión o una tarea distinta.

### P1 · Navegación y páginas

1. **Cabeceras variables.** Títulos entre 15 y 52 px conviven sin una regla compartida.
2. **Pestañas, pasos y filtros parecen componentes diferentes.** Aunque cumplen funciones similares, usan alturas, indicadores y fondos distintos.
3. **Vista previa secundaria demasiado densa.** Información relevante queda por debajo del umbral de lectura normal.
4. **Anchos de lectura sin límite estable.** Algunos formularios se extienden demasiado y otros se comprimen en columnas estrechas.

### P2 · Mantenimiento

1. **136 estilos incrustados** en `app.html` dificultan aplicar una escala central.
2. **La hoja `smyl-design-system-v2.css` existe, pero no gobierna el panel completo.** Sus variables se usan sobre todo en diálogos.
3. **Las correcciones se hacen al final de hojas locales.** Esto crea nuevas excepciones y aumenta la deuda visual.
4. **No existe una prueba automática contra texto menor de 12 px** ni contra nuevos tamaños no autorizados.

## Decisión de diseño

La nueva base se llama **SMYL UI v3** y vive en `smyl-ui-template-v3.css`. Se inspira en la composición modular de 21st.dev, sin copiar una plantilla concreta: shell de página, cabecera, pestañas, tarjetas, formularios, listas y estados deben compartir espacio, foco y tratamiento de errores.

Referencias de criterio:

- [21st.dev · React dashboard components](https://21st.dev/blog/react-dashboard-components): un dashboard es un sistema de shell, navegación, contenido, tablas y tarjetas; no una colección de tarjetas independientes.
- [21st.dev · Dashboard component libraries](https://docs.21st.dev/blog/dashboard-component-libraries): los componentes deben coincidir en espaciado, estados de foco y error para sentirse parte del mismo producto.
- [21st.dev · Form components](https://21st.dev/community/components/explore/react-html-form): formularios por pasos, carga de archivos y layouts deben construirse con patrones reutilizables.

## Escala tipográfica oficial

| Uso | Token | Tamaño |
| --- | --- | ---: |
| Título de página | `--smyl-ui-text-page` | 28–36 px fluido |
| Título de sección | `--smyl-ui-text-section` | 22 px |
| Título de tarjeta | `--smyl-ui-text-title` | 16 px |
| Texto principal | `--smyl-ui-text-body` | 15 px |
| Texto operativo | `--smyl-ui-text-body-sm` | 14 px |
| Etiqueta/control | `--smyl-ui-text-label` | 13 px |
| Metadato/ayuda | `--smyl-ui-text-meta` | 12 px |

### Reglas

- **12 px es el mínimo visible.** No se utilizará 7–11 px para contenido, estados, ayudas ni navegación.
- No se reduce la tipografía en móvil. Se amplían controles y se reordena el contenido.
- Mayúsculas sólo para una ceja breve de sección; nunca para instrucciones, etiquetas largas o párrafos.
- Sólo se permiten los siete niveles anteriores. Una excepción necesita documentación y revisión visual.
- Los números tabulares se reservan para importes, horas y métricas comparables.

## Plantilla general de página

```text
┌─ Cabecera de página ─────────────────────────────────────────┐
│ Contexto breve                    Acción primaria / estado   │
│ Título claro                                               │
│ Descripción de una línea                                    │
└──────────────────────────────────────────────────────────┘

┌─ Navegación contextual / pasos ─────────────────────────────┐
│ Sección activa │ Sección │ Sección                         │
└──────────────────────────────────────────────────────────┘

┌─ Tarjeta de tarea principal ────────────────┐  ┌─ Contexto ─┐
│ Título + explicación                         │  │ Resumen  │
│                                            │  │ o preview │
│ Formulario con campos de 48 px              │  │           │
│ Ayudas de 12 px                              │  └───────────┘
│                                            │
│ Acciones: secundaria              primaria │
└────────────────────────────────────────────┘
```

### Componentes canónicos

| Componente | Clase base | Regla |
| --- | --- | --- |
| Página | `.smyl-ui-page` | ancho máximo 1200 px, margen centrado |
| Cabecera | `.smyl-ui-page-header` | un título, una descripción y máximo dos acciones |
| Pestañas/pasos | `.smyl-ui-tabs`, `.smyl-ui-tab` | una sola navegación contextual por pantalla |
| Tarjeta | `.smyl-ui-card` | sólo agrupa una tarea o decisión |
| Formulario | `.smyl-ui-field` + controles | campo de 48 px, etiqueta de 13 px, ayuda de 12 px |
| Archivo | `.smyl-ui-upload` | icono, descripción y acción legible; sin control comprimido |
| Botón | `.smyl-ui-button` | 42 px escritorio, 44 px móvil |
| Estado vacío | `.smyl-ui-empty` | explica la causa y ofrece una sola acción |
| Lista | `.smyl-ui-list-item` | preferida sobre muchas tarjetas repetidas |
| Aviso | `.smyl-ui-notice` | reserva color semántico para información que cambia decisiones |

## Formulario profesional como piloto

El Directorio profesional será la pantalla piloto porque concentra los problemas detectados y permite validar el sistema completo:

1. Elevar ayudas y metadatos a 12 px.
2. Elevar etiquetas a 13 px y contenido de campos a 14 px.
3. Rediseñar el CV como componente de carga de archivo, no como control nativo comprimido.
4. Dejar un solo bloque de tarea por paso.
5. Convertir Casos en una biblioteca: `Agregar caso`, lista de casos y `Quitar del perfil` sin borrar evidencia clínica.
6. Mantener la vista previa como contexto secundario y nunca usar texto menor de 12 px.

## Orden de migración

### Etapa 1 · Base y pantalla piloto

- Cargar `smyl-ui-template-v3.css`.
- Normalizar Directorio profesional y administrador de casos.
- Agregar prueba que rechace nuevos valores tipográficos fuera de la escala.

### Etapa 2 · Shell y navegación

- **Completada el 25 de octubre de 2026.** `app.html`, barra superior, menú
  lateral, acciones y estados globales ya están gobernados por SMYL UI v3.
- La plantilla se carga al final y reemplaza efectivamente las medidas del
  shell heredado; la extracción física del bloque incrustado queda como
  limpieza técnica posterior, no como requisito visual.
- Navegación primaria usa 14 px y metadatos 12 px; botones, campos y focos
  comparten anatomía en escritorio y móvil.

### Etapa 3 · Trabajo diario

- Mensajes, Agenda, Pacientes 360 y Cotizaciones.
- Normalizar tablas/listas, filtros, formularios y paneles laterales.

### Etapa 4 · Operación y configuración

- Inventario, Finanzas, Consumo, Conexiones, Reportes y Seguridad.
- Reducir anidamiento de tarjetas y alinear estados vacíos/error/carga.

### Etapa 5 · Studio y superficies clínicas

- Mantener la identidad inmersiva de Studio, pero compartir controles, accesibilidad y escala mínima.
- Revisar Simulación y Revisión clínica sin alterar lógica ni prompts.

## Criterios de aceptación

- No hay texto funcional menor de 12 px.
- Cada pantalla usa un título de página, títulos de sección y texto operativo de la escala oficial.
- Campos miden al menos 48 px; acciones táctiles al menos 44 px en móvil.
- No hay estilos `font-size` incrustados nuevos.
- El formulario se puede completar a 320, 390, 768, 1024 y 1440 px sin desplazamiento horizontal.
- Foco, error, ayuda, estado deshabilitado y carga se ven iguales entre módulos.
- La tarjeta se usa para agrupar una tarea; las colecciones extensas usan lista o tabla.
- Una acción destructiva o de publicación siempre tiene texto explícito y confirmación proporcional al riesgo.

## Regla de gobierno

Todo componente nuevo debe construirse primero con SMYL UI v3. Los módulos heredados se migran por etapas; no se corrigen agregando otro tamaño local. Si falta un patrón, se amplía la plantilla compartida y después se consume desde el módulo.
