# Política visual SMYL v3

**Versión:** 3.2
**Estado:** normativa
**Fecha de entrada en vigor:** 25 de octubre de 2026
**Ámbito:** web, PWA, aplicación móvil y superficies públicas de SMYL
**Propietario:** Producto y Diseño SMYL

## 1. Propósito

SMYL debe sentirse como una plataforma clínica contemporánea: precisa, calmada,
humana y tecnológicamente confiable. La identidad visual se construye con azul
marino, superficies claras, tipografía legible, profundidad moderada y movimiento
discreto.

Esta política adopta del concepto de Figma la navegación flotante, la transición
entre estados expandido y compacto, la selección luminosa, el uso disciplinado
de radios y la divulgación progresiva. No copia sus fondos decorativos, colores,
avatares, contenido, iconos ni elementos de sistema operativo.

Los patrones de componentes se apoyan además en las guías de 21st.dev sobre
dashboards, botones, tarjetas, formularios, tablas y estados. 21st.dev se usa
como catálogo de referencias y contratos de interacción, no como una fuente de
componentes que deban instalarse o copiarse sin revisión.

Referencia de dirección visual:
[Sidebar Navigation Menu for Dashboard](https://www.figma.com/design/RPnW9PDDz8lo6VKU3fkVSA/Sidebar-Navigation-Menu-for-Dashboard-%E2%80%93-Animation--Dark---Light-Versions---Community-?node-id=80-1461&m=dev),
en particular los frames `Dark` (`105:1897`) y `Light` (`105:2295`).

## 2. Decisión principal de marca

El **azul marino es el color principal de SMYL**. Se usa para identidad,
navegación, acciones primarias y estructura. El turquesa es un acento funcional;
no compite con el azul marino ni lo sustituye.

La proporción recomendada en una pantalla operativa es:

- 70–80 % superficies claras y espacio de trabajo.
- 15–25 % azul marino para estructura, navegación y acciones.
- Hasta 10 % de acentos y colores semánticos.

La aplicación no se convierte en una interfaz completamente oscura. La
navegación azul marino sirve como ancla y el contenido clínico conserva fondos
claros para favorecer lectura, comparación y concentración.

## 3. Carácter visual

SMYL debe sentirse:

- **Clínico, no hospitalario:** ordenado y preciso sin resultar frío.
- **Premium, no ornamental:** profundidad y detalle al servicio de la jerarquía.
- **Compacto, no apretado:** alta densidad con controles y texto legibles.
- **Tecnológico, no futurista:** la IA y el movimiento nunca dominan la tarea.
- **Humano, no informal:** lenguaje directo, identidad clara y estados honestos.

Toda superficie debe permitir comprender en menos de cinco segundos:

1. dónde está la persona;
2. qué requiere atención;
3. cuál es la acción principal;
4. qué estado tiene la información.

## 4. Sistema de color

### 4.1 Paleta principal

| Token | Valor | Uso |
| --- | ---: | --- |
| `--smyl-navy-950` | `#071826` | Profundidad, pie de navegación |
| `--smyl-navy-900` | `#0B1B2E` | Azul marino principal |
| `--smyl-navy-800` | `#123149` | Superficie elevada oscura |
| `--smyl-navy-700` | `#19445F` | Hover y bordes oscuros |
| `--smyl-navy-600` | `#245B78` | Controles secundarios oscuros |
| `--smyl-canvas` | `#F3F7FA` | Fondo general operativo |
| `--smyl-surface` | `#FFFFFF` | Tarjetas, tablas y formularios |
| `--smyl-surface-subtle` | `#EAF0F4` | Agrupación secundaria |
| `--smyl-ink` | `#0B1B2E` | Texto y títulos sobre claro |
| `--smyl-text-secondary` | `#465B6C` | Texto secundario |
| `--smyl-text-muted` | `#657887` | Metadatos legibles |
| `--smyl-border` | `#CAD6DF` | Bordes y divisores |

### 4.2 Acento y semántica

| Token | Valor | Uso |
| --- | ---: | --- |
| `--smyl-accent` | `#0F766E` | Selección y disponibilidad |
| `--smyl-accent-bright` | `#4AB8AD` | Indicadores y brillo decorativo |
| `--smyl-accent-subtle` | `#E7F6F4` | Fondo de selección clara |
| `--smyl-success` | `#087A55` | Operación confirmada |
| `--smyl-warning` | `#966300` | Revisión o riesgo moderado |
| `--smyl-danger` | `#B42318` | Error o acción destructiva |
| `--smyl-info` | `#175CD3` | Información verificable |
| `--smyl-focus` | `#66CFC4` | Foco sobre azul marino |
| `--smyl-focus-light` | `#175CD3` | Foco sobre superficies claras |

### 4.3 Reglas de uso

- El azul marino es la única acción primaria de marca.
- El turquesa identifica selección, disponibilidad y continuidad; no se usa
  como botón primario general.
- Verde, ámbar y rojo conservan significado semántico y nunca decorativo.
- Ningún estado depende solamente del color; siempre incluye texto, icono o
  cambio de forma.
- Los degradados se limitan a superficies de marca, navegación y visualización
  de profundidad. No se aplican a formularios, tablas ni texto.
- Un botón azul marino usa texto blanco. Un acento turquesa claro usa texto azul
  marino, no blanco.
- Las fotografías clínicas se muestran sobre fondos cromáticamente neutros.

Combinaciones base verificadas: blanco sobre azul marino principal, 17.35:1;
azul marino sobre turquesa brillante, 7.23:1; texto secundario sobre blanco,
7.06:1; texto atenuado sobre blanco, 4.58:1.

## 5. Tipografía

Familia oficial: `Inter, system-ui, -apple-system, "Segoe UI", sans-serif`.
Pesos permitidos: 400, 500, 600 y 700.

| Rol | Tamaño / línea | Peso |
| --- | ---: | ---: |
| Título de página | 28–36 / 1.15 | 700 |
| Título de sección | 22 / 28 px | 600 |
| Título de tarjeta | 16 / 22 px | 600 |
| Texto principal | 15 / 22 px | 400 |
| Texto operativo | 14 / 20 px | 400–500 |
| Etiqueta o control | 13 / 18 px | 500–600 |
| Metadato | 12 / 16 px | 400–600 |

Reglas:

- 12 px es el mínimo para texto funcional.
- Las mayúsculas sólo se permiten en cejas breves y encabezados de navegación.
- Los títulos usan estilo oración.
- No se reduce la tipografía en móvil; se reorganiza el contenido.
- Importes, horas y métricas comparables usan números tabulares.

## 6. Lenguaje e instrucciones

SMYL usa la menor cantidad de palabras que permita comprender y actuar con
seguridad. Cada frase visible debe orientar, identificar, confirmar o prevenir
un error. Si no cumple una de esas funciones, se elimina.

### 6.1 Límites de extensión

| Elemento | Extensión preferida | Máximo recomendado |
| --- | ---: | ---: |
| Título de página | 2–5 palabras | 7 palabras |
| Título de sección | 1–4 palabras | 6 palabras |
| Navegación o tab | 1–2 palabras | 3 palabras |
| Botón | 1–3 palabras | 4 palabras |
| Etiqueta de campo | 1–4 palabras | 6 palabras |
| Ayuda de campo | 1 oración | 14 palabras |
| Error junto al campo | 1 oración | 16 palabras |
| Toast | 2–8 palabras | 12 palabras |
| Título de estado vacío | 2–5 palabras | 7 palabras |
| Explicación de estado vacío | 12–24 palabras | 30 palabras |
| Título de modal | 2–6 palabras | 8 palabras |

Estos límites evitan ruido, no justifican truncar identidad, tratamientos,
riesgos o consecuencias. Cuando la precisión clínica necesita más palabras, la
claridad y la seguridad tienen prioridad.

### 6.2 Reglas de escritura

- Una frase comunica una sola idea.
- Una instrucción comienza con un verbo y usa voz activa.
- Se usa español claro de México y términos conocidos por el equipo clínico.
- Se evita jerga técnica, administrativa o interna. Si un término es necesario,
  se explica una vez y después se usa de forma consistente.
- Se eliminan introducciones como `Por favor`, `Para poder`, `Procede a` y
  `Es importante mencionar que`.
- Se evita repetir el título en el subtítulo o la instrucción inmediata.
- Los números se escriben con cifras cuando ayudan a escanear: `3 citas`, no
  `tres citas`.
- No se usan signos de admiración, emojis o tono promocional en tareas clínicas.
- Se usa divulgación progresiva: lo esencial queda visible y el detalle vive en
  `Ver detalles`, `Más opciones` o una vista específica.

### 6.3 Acciones, errores y confirmaciones

- Un botón combina verbo y objeto cuando el resultado necesita explicación:
  `Guardar cambios`, `Agendar cita`, `Enviar mensaje`. Se acepta una expresión
  convencional más breve, como `Nueva cita`, cuando es inequívoca en contexto.
- Se evita `Aceptar`, `Sí`, `Continuar` o `Listo` cuando puede nombrarse la
  acción concreta.
- Un error dice qué ocurrió y cómo resolverlo. No usa códigos internos como
  mensaje principal.
- Una confirmación nombra la acción y su consecuencia, especialmente si es
  irreversible.
- Un estado de éxito confirma el resultado sin adverbios ni celebración.
- La interfaz conserva las palabras escritas después de un error.

| Evitar | Usar |
| --- | --- |
| `Proceder con la creación de una nueva cita` | `Nueva cita` |
| `Los cambios fueron guardados exitosamente` | `Cambios guardados` |
| `Por favor ingresa el número de teléfono` | `Ingresa el teléfono` |
| `Ha ocurrido un error inesperado` | `No pudimos guardar. Reintenta.` |
| `¿Deseas continuar con la eliminación?` | `¿Eliminar esta cita?` |

### 6.4 Presentación del texto

- Los párrafos operativos contienen una o dos oraciones breves.
- Una línea de lectura mantiene aproximadamente 45–75 caracteres.
- La ayuda de campo ocupa idealmente una línea y nunca más de dos.
- Las mayúsculas se reservan para cejas de hasta tres palabras.
- No se usa reducción de tamaño, opacidad baja o tracking excesivo para hacer
  caber texto que debe editarse.
- Una instrucción aparece junto al control o decisión que explica; no en una
  tarjeta, tooltip o modal separados sin necesidad.
- Un tooltip aclara un icono o término breve. Nunca contiene información
  clínica esencial, instrucciones largas o el único mensaje de error.

### 6.5 Regla de simplificación

Antes de aprobar una pantalla se aplica este orden:

1. Eliminar contenido duplicado.
2. Sustituir frases por términos conocidos.
3. Mostrar sólo la instrucción del paso actual.
4. Mover detalle opcional a divulgación progresiva.
5. Reducir contenedores y adornos que separan texto relacionado.
6. Verificar que la simplificación conserve identidad, alcance y consecuencia.

## 7. Espaciado, forma y profundidad

### 7.1 Retícula

La retícula base es de 4 px. Se prefieren separaciones de 8, 12, 16, 20, 24,
32 y 48 px. Los elementos relacionados se mantienen próximos; las tareas
distintas se separan con espacio antes que con otro contenedor.

### 7.2 Radios

| Componente | Radio |
| --- | ---: |
| Control compacto | 8 px |
| Campo y botón | 10 px |
| Opción de navegación | 12 px |
| Tarjeta elevada o popover | 16 px |
| Sidebar flotante | 28 px |
| Estado o filtro breve | 999 px |

El radio de 28 px identifica el shell de navegación. No se propaga a todas las
tarjetas de contenido.

### 7.3 Bordes y sombras

- Los bordes normales son de 1 px y bajo contraste.
- Las tarjetas operativas prefieren borde antes que sombra.
- El sidebar puede usar `0 32px 64px -32px rgba(7,24,38,.62)`.
- Un popover puede usar `0 18px 40px -20px rgba(7,24,38,.48)`.
- El brillo de color sólo se permite en la opción activa o el foco de
  navegación. Nunca comunica por sí solo un estado.
- No se apilan sombras coloreadas en tarjetas o controles de formulario.

### 7.4 Transparencia

La navegación puede usar fondo azul marino con 92–98 % de opacidad y
`backdrop-filter` de hasta 24 px. La legibilidad tiene prioridad sobre el efecto
de vidrio. Formularios, tablas y ventanas clínicas permanecen opacos.

## 8. Navegación lateral canónica

### 8.1 Geometría

- Ancho expandido: 256 px.
- Ancho compacto: 88 px.
- Margen exterior: 12 px.
- Radio exterior: 28 px.
- Altura: viewport menos 24 px.
- Separación mínima con el contenido: 20 px.
- El control de expansión nunca invade la cabecera de la página.

### 8.2 Cabecera de identidad

La cabecera contiene como máximo:

- marca SMYL;
- avatar o inicial de la clínica;
- nombre de la clínica;
- nombre o rol de la persona;
- control para cambiar de clínica cuando corresponda.

El bloque completo no debe ocupar más de 144 px de altura. Cuotas, diagnósticos
y datos administrativos se muestran en una vista contextual, no en la cabecera
permanente.

### 8.3 Opciones

- Altura mínima: 48 px.
- Icono: 22 px, trazo aproximado de 1.75 px.
- Separación icono–texto: 12 px.
- Radio: 12 px.
- Texto: 14 px, peso 500; activo 600.
- Área activa de ancho completo.
- La barra de selección mide 3 × 28 px y usa turquesa.
- El fondo activo combina azul marino elevado y un brillo turquesa tenue.

### 8.4 Estado compacto

- Conserva exactamente el mismo orden y significado que el estado expandido.
- Cada icono muestra tooltip en hover y foco.
- Una opción con subnavegación abre un flyout accesible, inspirado en el patrón
  de Figma.
- El tooltip no sustituye `aria-label` ni nombre accesible.
- La selección sigue siendo evidente sin depender del tooltip.
- En dispositivos táctiles no se depende de hover.

### 8.5 Secciones, badges y pie

- Los encabezados de sección usan 12 px y contraste suficiente.
- Mensajes, Alertas y citas pendientes pueden mostrar badges numéricos.
- Los badges representan datos reales; nunca actividad de demostración.
- El pie reserva una acción contextual: `Nueva cita`, `Abrir LANA` o la tarea
  prioritaria definida por el módulo.
- `Cerrar sesión` vive en el menú de identidad y no compite con el trabajo.

## 9. Iconografía

- Se utiliza una sola familia de iconos lineales.
- Tamaño normal: 20 px; navegación: 22 px; acción destacada: 24 px.
- Grosor óptico: 1.75 px.
- No se usan círculos, cuadrados o rombos genéricos como iconos de módulos.
- Los iconos clínicos deben ser reconocibles y culturalmente neutros.
- Un icono ambiguo siempre se acompaña de texto, tooltip o nombre accesible.
- No se usan emojis en navegación, controles o estados clínicos.

## 10. Sistema canónico de componentes

### 10.1 Botones y acciones

Jerarquía:

1. Primaria: fondo azul marino, texto blanco.
2. Secundaria: superficie clara, borde azul gris y texto azul marino.
3. Terciaria o `ghost`: texto o icono sin contenedor permanente.
4. Destructiva: tratamiento rojo aplicado a la jerarquía necesaria; no crea
   una quinta categoría de botón.

Sólo hay una acción primaria por contexto. El turquesa puede indicar selección
o continuidad, pero no crea una segunda acción primaria.

Anatomía:

- Altura: 42 px en escritorio y 44 px en superficies táctiles.
- Padding horizontal: 16 px; separación icono–texto: 8 px; radio: 10 px.
- Un botón sólo de icono mide al menos 40 × 40 px en escritorio y 44 × 44 px
  en táctil; siempre tiene `aria-label` y tooltip.
- Los botones de una misma fila conservan altura, alineación y separación.
- La etiqueta describe el resultado y normalmente empieza con un verbo:
  `Guardar cambios`, `Agendar cita` o `Descargar reporte`. Una expresión breve
  y conocida puede reemplazarlo cuando sea más clara.

Todo botón implementa seis estados: `default`, `hover`, `active`,
`focus-visible`, `loading` y `disabled` o `aria-disabled`.

- `loading` conserva el ancho; mantiene la etiqueta o reserva su espacio, usa
  `aria-busy` y bloquea el doble envío.
- `disabled` debe seguir siendo legible. Si la persona puede corregir la causa,
  se prefiere mantener la acción disponible y explicar el error al ejecutarla.
- `focus-visible` nunca se elimina sin reemplazo.
- Una acción que navega es un enlace real con `href`; una acción de formulario
  usa `type="submit"`.
- Los efectos brillantes o animados se reservan para una única acción
  excepcional y nunca se repiten en una cuadrícula.

### 10.2 Tarjetas y paneles

Una tarjeta promete que todo su contenido pertenece a la misma tarea,
decisión o entidad. No se usa sólo para agregar borde o fondo.

Tipos permitidos:

| Tipo | Contenido | Acción |
| --- | --- | --- |
| Tarea | Título, contexto, estado y siguiente paso | Una principal |
| Métrica | Etiqueta, valor, periodo y comparación | Enlace al detalle |
| Resumen | Encabezado, dos o tres datos y estado | Opcional |
| Media clínica | Imagen, identidad, fecha y contexto | Abrir revisión |

Reglas:

- Anatomía estable: cabecera, cuerpo y pie sólo cuando cada zona tiene función.
- Padding habitual: 20–24 px; separación interna: 12–16 px; radio: 16 px para
  tarjetas elevadas y 12 px para tarjetas operativas.
- Se evita tarjeta dentro de tarjeta.
- Las tarjetas de una misma cuadrícula reservan una altura coherente. Los
  títulos pueden limitarse a dos líneas sólo si el nombre completo permanece
  accesible y existe una vista de detalle.
- Una tarjeta navegable contiene un enlace real. El contenedor no recibe
  `onclick`; puede usarse un enlace extendido cuando el texto no necesita
  selección.
- Las imágenes declaran ancho y alto, conservan relación de aspecto, tienen
  fallback y usan carga diferida fuera del primer viewport.
- Los efectos de blur, gradiente, sombra y seguimiento de cursor no se acumulan
  en grids; la repetición multiplica el costo de composición.
- Los paneles flotantes deben justificar su elevación mediante contexto,
  superposición o interacción temporal.

### 10.3 Métricas de dashboard

- Cada tarjeta contiene una cifra dominante, una etiqueta y un periodo.
- Toda variación explica contra qué se compara: `vs. semana anterior`, no sólo
  `+12 %`.
- Los números usan `font-variant-numeric: tabular-nums` y se alinean de forma
  consistente.
- El skeleton reserva la altura final para evitar que el dashboard salte al
  cargar.
- La jerarquía es una métrica principal, su tendencia y después el desglose.
- Una gráfica siempre ofrece una tabla equivalente visible u operable.

### 10.4 Listas y tablas

- Las tarjetas sirven para explorar hasta aproximadamente doce elementos. Para
  buscar, comparar o revisar más registros se usa una lista o tabla.
- Las tablas usan `table`, `thead`, `tbody`, `th`, `scope` y `caption`; no una
  cuadrícula de `div`.
- Texto a la izquierda; importes, cantidades y horas comparables a la derecha.
- El ordenamiento muestra columna y dirección con `aria-sort`.
- Los filtros activos aparecen como chips removibles sobre la tabla.
- La selección se conserva entre páginas y siempre muestra el total elegido.
- A partir de ocho columnas se ofrece control de visibilidad o prioridad.
- En móvil se elige entre scroll horizontal con primera columna fija, una vista
  resumida por registro o un subconjunto con detalle. No se reduce el texto para
  hacer caber todas las columnas.

### 10.5 Formularios

- Altura mínima de campo: 48 px.
- Etiquetas visibles; el placeholder no sustituye la etiqueta.
- El foco usa azul informativo sobre claro y turquesa sobre azul marino.
- Los formularios secuenciales no superan dos columnas.
- La primera validación ocurre al salir del campo; después de un error se
  actualiza mientras la persona corrige; al enviar se valida el conjunto y las
  reglas del servidor.
- El error aparece junto al campo y explica cómo corregirlo. El control usa
  `aria-invalid` y enlaza el mensaje mediante `aria-describedby`.
- Un formulario largo añade un resumen de errores enlazado a cada campo y
  mueve el foco al resumen después de un envío fallido.
- No se deshabilita `Guardar` o `Continuar` sin explicar qué falta.
- Los valores escritos se conservan después de un error.

### 10.6 Tabs y navegación contextual

- Las tabs alternan vistas ligeras de una misma entidad. Si cada vista merece
  título, descripción o URL propia, se usa navegación de páginas.
- Si el estado necesita compartirse, recargarse o volver atrás, la tab activa
  se conserva en la URL.
- Sólo la tab activa tiene `tabindex="0"`; flechas cambian de tab y `Home` y
  `End` llevan a los extremos.
- La activación automática se usa sólo si cambiar de panel no dispara una
  consulta costosa.
- Una tab compacta sólo de icono conserva tooltip y nombre accesible.

### 10.7 Modal, drawer, sheet y popover

- Modal: decisión bloqueante o formulario breve ligado al contexto actual.
- Drawer lateral: detalle de un registro sin perder la lista de origen.
- Sheet inferior: equivalente táctil para móvil.
- Popover: información o selección breve, no una tarea que requiere envío.
- Una tarea con más de una pantalla o que necesita compartir, imprimir o
  recargar debe ser una página con URL.

Todo overlay bloqueante mueve el foco al abrir, lo contiene, cierra con
`Escape`, vuelve al disparador, vuelve inerte el fondo y bloquea el scroll sin
mover el layout. Un formulario con cambios no guardados no se cierra al tocar el
backdrop sin confirmación.

### 10.8 Toasts, alertas y notificaciones

- Toast: confirmación transitoria de una acción reciente. Dura 4–6 segundos sin
  acción y 6–10 segundos con acción; se pausa en hover y foco.
- Se apilan como máximo tres y todos usan una única posición de aplicación.
- Un error accionable se muestra junto al origen; no sólo en un toast.
- Una alerta permanece inline mientras la condición siga vigente.
- El centro de notificaciones conserva historial, leído/no leído, conteo real y
  acción para marcar todo como leído.
- El contenedor de toasts existe desde la carga y usa `aria-live`; un toast con
  una acción requiere foco gestionado.
- La única copia de información importante nunca vive en un toast.

### 10.9 Carga, vacío, sin resultados, permiso y error

Estos estados no comparten mensaje ni comportamiento:

- **Carga:** skeleton con la geometría aproximada del contenido final. Nunca se
  muestra el estado vacío mientras la consulta sigue pendiente.
- **Primer uso:** explica qué contendrá la pantalla y ofrece la acción que crea
  el primer elemento.
- **Sin resultados:** repite búsqueda y filtros, permite limpiarlos y propone
  una alternativa cercana.
- **Sin permiso:** identifica la restricción y el siguiente paso autorizado.
- **Error:** explica qué ocurrió, qué se conservó y cómo reintentar o pedir
  ayuda.

Los estados usan un máximo de tres fragmentos: título, explicación breve y una
acción. Las ilustraciones son opcionales y nunca sustituyen la explicación.

### 10.10 Tratamientos visuales especiales

Estos patrones de 21st.dev pueden adaptarse a SMYL con alcance limitado:

- **Bento operativo:** permitido únicamente en Inicio o resúmenes. Contiene una
  tarjeta dominante y entre dos y cuatro apoyos; el tamaño representa prioridad
  real, no variedad decorativa. No se usa en formularios, inventarios ni listas
  clínicas.
- **Spotlight card:** permitido para una recomendación de LANA, una alerta
  prioritaria o una llamada a la acción contextual. El halo es tenue, permanece
  dentro de la tarjeta y tiene una versión estática; nunca sigue el cursor sobre
  información clínica ni comunica el estado por sí solo.
- **Tabs expandibles:** permitidas en barras estrechas si la opción activa
  revela su etiqueta y las demás conservan tooltip y nombre accesible. No
  sustituyen la navegación primaria.
- **Elevación interactiva:** una tarjeta accionable puede subir hasta 2 px y
  reforzar borde o sombra durante 140–180 ms. El contenido no cambia de tamaño
  ni desplaza elementos vecinos.
- **Skeleton con shimmer:** permitido durante carga si la animación es lenta,
  no distrae y se elimina con `prefers-reduced-motion`.

No se permiten en el producto operativo botones liquid glass, metal líquido,
cursores personalizados, fondos WebGL, brillos neón, perspectiva 3D o efectos
que sigan el puntero. Pueden evaluarse en campañas públicas sólo mediante una
excepción documentada y una prueba de rendimiento.

## 11. Movimiento

El movimiento explica cambio de estado y continuidad espacial.

| Interacción | Duración | Curva |
| --- | ---: | --- |
| Hover o presión | 140–180 ms | `ease-out` |
| Tooltip o popover | 160–200 ms | `ease-out` |
| Expandir o compactar sidebar | 240–280 ms | `cubic-bezier(.22,1,.36,1)` |
| Abrir panel o ventana | 180–240 ms | `cubic-bezier(.22,1,.36,1)` |

Reglas:

- No se usan rebotes, rotaciones decorativas ni animaciones continuas.
- La geometría del contenido no salta durante hover.
- Etiquetas e iconos no desaparecen antes de que el contenedor pueda alojar el
  nuevo estado.
- `prefers-reduced-motion` elimina transformaciones no esenciales y reduce las
  transiciones a un cambio prácticamente inmediato.

## 12. Responsive

- **1280 px o más:** sidebar expandido por defecto.
- **768–1279 px:** sidebar compacto por defecto, expandible.
- **Menos de 768 px:** drawer lateral o navegación móvil equivalente.
- **Menos de 480 px:** una columna y acciones prioritarias de ancho completo.

La navegación nunca se oculta sin una alternativa. El contenido se reordena
antes de reducir texto o controles. Los objetivos táctiles frecuentes miden al
menos 44 × 44 px.

Matriz mínima de revisión: 1440 × 900, 1280 × 720, 1024 × 768, 768 × 1024,
390 × 844, 360 × 800, 320 × 568 y zoom del navegador a 200 %.

## 13. Accesibilidad

Estándar mínimo: WCAG 2.2 AA.

- Texto normal: contraste mínimo 4.5:1.
- Texto grande y límites esenciales: 3:1.
- Foco visible de al menos 2 px.
- Orden visual y orden del DOM coinciden.
- Todo control funciona con teclado.
- Flyouts y tooltips se abren también con foco y se cierran con `Escape`.
- Ningún estado depende únicamente de color, brillo o movimiento.
- El reflujo a 320 px conserva contenido y acciones esenciales.
- La ampliación a 200 % no oculta la tarea principal.

## 14. Límites de la inspiración de Figma

Se adopta:

- navegación flotante;
- dualidad expandido/compacto;
- radio exterior amplio;
- selección con profundidad tenue;
- flyout contextual en modo compacto;
- movimiento breve y coordinado.

Se adapta:

- el fondo oscuro se convierte en azul marino SMYL;
- el naranja se reemplaza por azul marino y turquesa;
- los contactos se convierten en estados operativos reales;
- la tarjeta promocional se convierte en una acción clínica contextual.

No se copia:

- fondos de macOS, semáforos de ventana o elementos decorativos del concepto;
- avatares, nombres, textos o activos gráficos;
- iconos sin correspondencia con los módulos de SMYL;
- opacidades que reduzcan contraste o dificulten lectura clínica.

## 15. Arquitectura técnica

- Los tokens canónicos viven en una hoja compartida.
- Los componentes consumen tokens semánticos; no usan hexadecimales locales
  cuando existe un token.
- Un módulo puede definir geometría funcional, no una identidad paralela.
- Web y `mobile/www` conservan paridad.
- Un cambio visual no modifica permisos, datos, eventos o lógica clínica.
- Todo componente incluye normal, hover, focus, disabled, loading, error y
  responsive cuando apliquen.
- Las excepciones documentan motivo, alcance, responsable y fecha de revisión.

## 16. Puerta de aprobación visual

Un cambio visual sólo puede publicarse cuando cumple lo siguiente:

- [ ] Usa azul marino como color principal y respeta la proporción de color.
- [ ] Utiliza tokens, tipografía, radios, iconos y espacios autorizados.
- [ ] Títulos, botones, etiquetas e instrucciones respetan los límites de texto.
- [ ] Cada instrucción comunica una idea y empieza con una acción clara.
- [ ] No hay texto duplicado ni información esencial escondida en tooltips.
- [ ] La simplificación conserva identidad, contexto y consecuencias clínicas.
- [ ] Tiene una sola acción primaria por contexto.
- [ ] Botones y acciones cubren sus seis estados sin cambiar de tamaño al cargar.
- [ ] Cards, listas y tablas corresponden al volumen y al modo de lectura.
- [ ] Formularios muestran errores junto al campo y conservan lo escrito.
- [ ] Carga, vacío, sin resultados, permiso y error se distinguen claramente.
- [ ] Overlays gestionan entrada, contención, salida y retorno del foco.
- [ ] Los efectos especiales tienen alcance, alternativa estática y presupuesto
      de movimiento definidos.
- [ ] La navegación expandida y compacta conservan paridad funcional.
- [ ] Los iconos compactos tienen tooltip, foco y nombre accesible.
- [ ] No hay texto funcional menor de 12 px.
- [ ] Contraste, teclado, reflujo y `prefers-reduced-motion` están validados.
- [ ] Fue revisado en la matriz responsive mínima.
- [ ] No contiene datos clínicos ficticios o sensibles de relleno.
- [ ] Web y PWA contienen la misma versión visual.
- [ ] La revisión visual y las pruebas de regresión quedaron documentadas.

## 17. Orden de adopción

1. Tokens de color, foco, radio y elevación.
2. Navegación lateral, iconografía y tooltips del modo compacto.
3. Cabecera de identidad y acción contextual inferior.
4. Botones, campos, badges y estados.
5. Páginas de trabajo diario: Inicio, Agenda, Pacientes y Mensajes.
6. Operación y configuración.
7. Superficies públicas y SMYL Studio, conservando sus necesidades específicas.

Las pantallas heredadas se migran por etapas. No se corrigen creando otra
paleta, otro tamaño local o una nueva familia de componentes.

## 18. Referencias de componentes

- [21st.dev: dashboards](https://docs.21st.dev/blog/react-dashboard-components)
- [21st.dev: botones](https://docs.21st.dev/blog/react-button-components)
- [21st.dev: tarjetas](https://docs.21st.dev/blog/react-card-components)
- [21st.dev: formularios](https://docs.21st.dev/blog/react-form-components)
- [21st.dev: tablas](https://docs.21st.dev/blog/react-data-table-components)
- [21st.dev: sidebars](https://docs.21st.dev/blog/react-sidebar-component-examples)
- [21st.dev: diálogos y drawers](https://docs.21st.dev/blog/react-modal-dialog-components)
- [21st.dev: estados vacíos](https://docs.21st.dev/blog/react-empty-state-components)
- [21st.dev: notificaciones](https://docs.21st.dev/blog/react-toast-notification-components)
- [21st.dev: tabs](https://docs.21st.dev/blog/react-tabs-components)
- [21st.dev: biblioteca de componentes](https://21st.dev/community/components)
