# Política visual y de producto SMYL

**Versión:** 2.0

**Estado:** normativa heredada

**Ámbito:** web, PWA, aplicación móvil, superficies públicas y herramientas
internas de SMYL

**Propietario:** Producto y Diseño SMYL

**Última actualización:** 16 de octubre de 2026

> La dirección de interfaz, navegación, color, profundidad y movimiento fue
> sustituida el 25 de octubre de 2026 por la
> [Política visual SMYL v3.2](POLITICA_VISUAL_SMYL_V3.md). Las reglas clínicas,
> de privacidad y de autenticidad de imagen de este documento continúan
> vigentes cuando no contradicen la política v3.

## 1. Propósito

SMYL es una plataforma profesional para la operación de clínicas dentales. Su
interfaz debe transmitir precisión, calma, orden, criterio clínico y confianza.
No debe percibirse como una plantilla genérica, un panel administrativo
sobrecargado ni una demostración decorativa de inteligencia artificial.

La interfaz existe para ayudar al equipo a comprender, decidir y actuar. Cada
elemento visible debe responder al menos una de estas preguntas:

1. ¿Dónde estoy?
2. ¿Qué requiere atención?
3. ¿Qué dato necesito para decidir?
4. ¿Cuál es la siguiente acción segura?
5. ¿Qué ocurrió después de realizarla?

Si un elemento no ayuda a responder alguna, debe eliminarse, reducirse o
moverse a divulgación progresiva.

## 2. Promesa visual

SMYL debe sentirse:

- **Clínico, sin ser frío.** Preciso y limpio, pero humano.
- **Profesional, sin ser corporativo genérico.** La odontología se reconoce en
  los flujos, no mediante adornos.
- **Compacto, sin ser pequeño.** Alta densidad con lectura cómoda.
- **Calmado, sin ser plano.** La jerarquía procede del espacio, el contraste y
  la composición, no de tamaños exagerados.
- **Inteligente, sin parecer automático.** La IA sugiere; el profesional
  revisa, modifica y aprueba.
- **Confiable, sin aparentar certeza inexistente.** Estados, permisos y límites
  se comunican de forma explícita.

## 3. Principios no negociables

### 3.1 Una tarea dominante por superficie

Cada página, panel o ventana tiene una intención principal. Sólo una acción
puede usar el mayor peso visual. Las acciones secundarias son neutras y las
terciarias se presentan como texto, icono o menú.

### 3.2 La jerarquía precede a la decoración

Título, contexto, contenido y acciones deben distinguirse aun en escala de
grises. Color, iconos y sombras refuerzan la estructura; nunca la sustituyen.

### 3.3 El tamaño responde al contenido

Ninguna ventana conserva una altura grande para rellenar un estado vacío. Los
diálogos crecen cuando aparece contenido real y se contraen cuando sólo deben
explicar un bloqueo, una confirmación o un siguiente paso.

### 3.4 Menos niveles visuales

No usar una tarjeta dentro de otra salvo que exista una relación funcional que
lo exija. Un diálogo no debe contener otro marco que repita borde, radio,
cabecera y fondo.

### 3.5 La información clínica nunca es decoración

No usar fotografías, nombres, tratamientos, métricas ni estados inventados
para rellenar espacios. Los datos de demostración sólo existen en fixtures de
QA claramente identificados.

### 3.6 La identidad no se infiere

Paciente, profesional, clínica, sucursal y tenant son entidades diferentes.
Nunca se muestra el nombre del tenant o de una sucursal como sustituto del
paciente. Un dato desconocido se comunica como pendiente; no se adivina.

### 3.7 La accesibilidad forma parte de la calidad visual

Contraste, foco, teclado, áreas táctiles, reflujo y estados comprensibles son
requisitos de diseño, no correcciones posteriores.

## 4. Tres contextos, una sola identidad

### 4.1 SMYL Operativo

Se usa en Inicio, Mensajes, Pacientes, Agenda, Tratamientos, Caja, Inventario,
Reportes, Directorio y Configuración.

- Fondo claro y superficies blancas.
- Azul clínico como acción principal.
- Azul tinta para estructura y texto.
- Teal sólo para disponibilidad, selección y confirmaciones operativas.
- Densidad compacta.
- Bordes discretos y sombras excepcionales.
- Fotografías sólo cuando son parte del expediente o de una tarea clínica.

### 4.2 SMYL Studio

Se usa en simulación, comparación fotográfica, revisión de imágenes, guías y
edición visual asistida.

- Fondo carbón y superficies grafito.
- Texto claro de alto contraste.
- Violeta reservado para IA, selección y acción principal del estudio.
- La zona inmediata a la fotografía es cromáticamente neutra.
- Las guías, máscaras y controles conservan significado clínico estable.

### 4.3 SMYL Paciente

Se usa en perfiles públicos, solicitud de cita, consentimientos y formularios
compartidos.

- Hereda color, tipografía y componentes de SMYL Operativo.
- Reduce densidad y utiliza lenguaje más explicativo.
- No muestra navegación administrativa ni datos internos.
- No constituye un tercer tema visual.

### 4.4 Regla de transición

Una ventana operativa abierta desde el chat conserva SMYL Operativo. Una tarea
de simulación puede abrir SMYL Studio como espacio dedicado. Nunca se aplica un
tema oscuro a una ventana operativa sólo para hacerla parecer avanzada.

## 5. Sistema de color

### 5.1 Paleta operativa

| Token | Valor | Uso |
|---|---:|---|
| `--smyl-canvas` | `#F4F7FA` | Fondo general |
| `--smyl-surface` | `#FFFFFF` | Superficie principal |
| `--smyl-surface-subtle` | `#F8FAFC` | Agrupación secundaria |
| `--smyl-ink` | `#102239` | Títulos y texto principal |
| `--smyl-text-secondary` | `#526173` | Texto de lectura |
| `--smyl-text-muted` | `#667586` | Ayuda y metadatos |
| `--smyl-border` | `#D7E0E8` | Divisores y contornos |
| `--smyl-border-strong` | `#B7C4D1` | Hover o control activo |
| `--smyl-primary` | `#194391` | Acción principal operativa |
| `--smyl-primary-hover` | `#12366F` | Hover de acción primaria |
| `--smyl-primary-subtle` | `#EDF3FC` | Selección azul suave |
| `--smyl-accent` | `#0F766E` | Disponibilidad y selección |
| `--smyl-accent-hover` | `#115E59` | Hover teal |
| `--smyl-accent-subtle` | `#EAF7F5` | Selección teal suave |
| `--smyl-success` | `#087A55` | Confirmación real |
| `--smyl-warning` | `#966300` | Riesgo o revisión pendiente |
| `--smyl-danger` | `#B42318` | Error o acción destructiva |
| `--smyl-info` | `#175CD3` | Información verificable |
| `--smyl-focus` | `#2563EB` | Foco visible |
| `--smyl-backdrop` | `rgba(10,24,38,.54)` | Fondo de ventanas |

### 5.2 Paleta Studio

| Token | Valor | Uso |
|---|---:|---|
| `--studio-canvas` | `#0B1016` | Fondo del estudio |
| `--studio-surface` | `#121821` | Superficie principal |
| `--studio-raised` | `#18212C` | Superficie elevada |
| `--studio-border` | `#2B3744` | Divisores |
| `--studio-text` | `#F1F5F9` | Texto principal |
| `--studio-text-secondary` | `#B2BECA` | Texto secundario |
| `--studio-action` | `#7667E8` | IA y acción primaria |
| `--studio-focus` | `#7EB4FF` | Foco visible |
| `--guide-axis` | `#F5F7F9` | Ejes |
| `--guide-curve` | `#D29A35` | Curva de sonrisa |
| `--guide-valid` | `#39A879` | Proporciones validadas |

### 5.3 Reglas de color

- El azul es la única acción primaria de SMYL Operativo.
- El teal no reemplaza al azul en botones principales.
- Verde significa éxito; ámbar, atención; rojo, error o destrucción.
- El violeta identifica IA y Studio; no es un acento operativo general.
- Un grupo de controles usa un solo color de acento.
- Ningún estado depende únicamente del color.
- Los degradados sólo se permiten en marca o visualizaciones materiales donde
  comuniquen volumen; no en botones, paneles o estados vacíos.

## 6. Tipografía

### 6.1 Familia y pesos

- Familia: `Inter, system-ui, -apple-system, "Segoe UI", sans-serif`.
- Pesos permitidos: 400, 500, 600 y 700.
- No usar pesos inventados como 620, 650, 680 o 750.
- No usar 800 o 900 en la interfaz operativa.

### 6.2 Escala operativa de escritorio

| Rol | Tamaño / línea | Peso | Uso |
|---|---:|---:|---|
| Título de página | 24 / 32 px | 700 | Una vez por vista |
| Título de módulo | 20 / 28 px | 600 | Workspace principal |
| Título de ventana | 18 / 24 px | 600 | Diálogos y paneles |
| Título de sección | 14 / 20 px | 600 | Bloques de contenido |
| Cuerpo | 13 / 20 px | 400 | Lectura principal |
| Control | 13 / 18 px | 500 | Campos y selectores |
| Botón | 13 / 18 px | 600 | Acciones |
| Etiqueta | 12 / 16 px | 500 | Etiquetas de campo |
| Ayuda o metadato | 11 / 16 px | 400 | Texto auxiliar |
| Microetiqueta | 10 / 14 px | 600 | Uso excepcional |
| Métrica | 20–28 / 1.15 | 700 | Cifra prioritaria |

### 6.3 Escala móvil

- Título de página: 22 px.
- Título de ventana: 18 px.
- Cuerpo: 14 px.
- Campos de entrada: 16 px para evitar ampliación automática.
- Botones: 14 px.
- Etiquetas y ayuda: 12 px.

### 6.4 Reglas tipográficas

- Nunca usar texto funcional por debajo de 10 px.
- Ninguna instrucción clínica, error o acción puede usar menos de 11 px.
- Una ventana pequeña no usa más de cuatro roles tipográficos.
- Mayúsculas sólo en una microetiqueta útil, nunca encima de cada título.
- No combinar mayúsculas, negrita, color y espaciado amplio.
- Los títulos usan estilo oración: “Agendar cita”, no “AGENDAR CITA”.
- No escalar un título para llenar espacio.
- Los valores importantes no se truncan sin una forma inmediata de consultar
  el contenido completo.
- Cifras financieras y métricas usan números tabulares.

## 7. Espaciado y densidad

SMYL usa una retícula base de 4 px.

| Token | Valor | Uso habitual |
|---|---:|---|
| `--space-1` | 4 px | Separación mínima |
| `--space-2` | 8 px | Elementos relacionados |
| `--space-3` | 12 px | Controles dentro de un grupo |
| `--space-4` | 16 px | Padding compacto |
| `--space-5` | 20 px | Padding de panel |
| `--space-6` | 24 px | Separación de secciones |
| `--space-8` | 32 px | Cambio de bloque mayor |
| `--space-10` | 40 px | Respiración de página |
| `--space-12` | 48 px | Composición amplia |

Reglas:

- Elementos relacionados se separan 4–8 px.
- Grupos funcionales se separan 12–16 px.
- Secciones distintas se separan 20–24 px.
- No aumentar simultáneamente tipografía, padding y radio para crear énfasis.
- Escritorio es compacto; móvil aumenta el área táctil, no todos los textos.

## 8. Forma, borde y elevación

### 8.1 Radios

| Componente | Radio |
|---|---:|
| Indicador pequeño | 4 px |
| Elemento compacto | 6 px |
| Campo, botón y selector | 8 px |
| Tarjeta y panel | 10 px |
| Ventana | 12 px |
| Superficie móvil completa | 0 px |
| Etiqueta o filtro breve | 999 px |

Las píldoras sólo se usan para etiquetas, estados y filtros breves. Nunca para
formularios, botones largos o contenedores de contenido.

### 8.2 Bordes

- Borde predeterminado: 1 px `--smyl-border`.
- Un bloque no repite borde si ya está contenido por una superficie clara.
- Hover intensifica el borde; no mueve el componente.
- Selección usa fondo suave y borde de acento, sin halo decorativo.

### 8.3 Sombras

| Token | Valor |
|---|---|
| `--shadow-control` | `0 1px 2px rgba(16,34,57,.05)` |
| `--shadow-floating` | `0 8px 24px rgba(16,34,57,.10)` |
| `--shadow-dialog` | `0 24px 64px rgba(10,24,38,.18)` |

- Las tarjetas normales usan borde, no sombra.
- Prohibidas las sombras coloreadas y los resplandores.
- No sumar sombras en paneles internos.
- No usar `backdrop-filter` en ventanas operativas.

## 9. Iconografía

- Una sola familia de iconos lineales.
- Tamaño general: 16 px; navegación: 18 px.
- Grosor óptico aproximado: 1.75 px.
- Todo icono ambiguo lleva texto o nombre accesible.
- No usar emojis en navegación, estados, controles o mensajes clínicos.
- `+`, `−`, `×`, flechas y lupa son aceptables cuando son universales.
- Cerrar usa `×`, con etiqueta accesible “Cerrar”.
- Los iconos no sustituyen paciente, estado o tratamiento.

## 10. Arquitectura de páginas

### 10.1 Orden visual

1. Contexto del módulo.
2. Título y explicación breve.
3. Estado o prioridad verificable.
4. Acción principal.
5. Herramientas de búsqueda o filtro.
6. Contenido de trabajo.
7. Ayuda, auditoría o acciones excepcionales.

### 10.2 Ancho y lectura

- Las páginas operativas aprovechan el ancho sin estirar bloques de texto.
- Un párrafo de ayuda no supera aproximadamente 70 caracteres por línea.
- Formularios secuenciales no usan más de dos columnas.
- Barras de filtros usan varias columnas sólo si cada selección queda completa.

### 10.3 Divulgación progresiva

- Mostrar de inicio los dos o tres controles que resuelven la mayoría de casos.
- Filtros de baja frecuencia viven en “Más filtros”.
- Configuración, auditoría y peligro no compiten con el trabajo diario.
- Un acordeón sólo se usa si el contenido es opcional y predecible por su
  título.

## 11. Sistema de ventanas

### 11.1 Patrones

| Patrón | Uso |
|---|---|
| Confirmación | Decidir, cancelar o eliminar |
| Formulario breve | Capturar una unidad sencilla |
| Formulario medio | Crear o editar una entidad |
| Flujo operativo | Tarea acotada con contexto y resultados |
| Workspace | Agenda, comparación o tabla real |
| Panel lateral | Contexto complementario sin abandonar la tarea |
| Vista completa | Más de dos pasos o fotografía clínica |

No usar un diálogo para ocultar una página completa. Si una tarea necesita
navegación interna, varias secciones largas o más de un área de scroll, debe ser
una vista dedicada.

### 11.2 Tamaños oficiales

| Tamaño | Ancho máximo | Uso |
|---|---:|---|
| `XS` | 400 px | Confirmación |
| `S` | 520 px | Captura breve |
| `M` | 680 px | Formulario o estado guiado |
| `L` | 840 px | Flujo con resultados |
| `Workspace` | 960 px | Agenda o herramienta real |

Reglas:

- Ancho real: `min(ancho oficial, 100vw - 32px)`.
- Altura inicial: automática.
- Altura máxima: `calc(100dvh - 48px)`.
- Una ventana vacía nunca reserva la altura de resultados.
- Sólo el cuerpo se desplaza; cabecera y pie permanecen estables.
- Nunca existen dos scrolls verticales visibles.
- El backdrop oscurece; no difumina excesivamente.
- Ninguna ventana operativa supera 960 px salvo excepción documentada.

### 11.3 Anatomía

**Cabecera**

- Altura visual: 56–64 px.
- Padding: 16 px 20 px.
- Título: 18 px.
- Una línea opcional de contexto de 11–12 px.
- Cierre: 36 × 36 px en escritorio y 44 × 44 px en móvil.
- No acumular microtítulo, icono decorativo, título y chips redundantes.

**Cuerpo**

- Padding: 20 px en escritorio y 16 px en móvil.
- Una sola superficie principal de lectura.
- Grupos separados por espacio o divisor, no tarjetas repetidas.
- Mensajes de ayuda aparecen junto al control correspondiente.

**Pie**

- Altura habitual: 60–64 px.
- Una acción primaria y hasta dos secundarias.
- Acciones destructivas se separan físicamente.
- El pie desaparece cuando no existe una decisión persistente.

### 11.4 Interacción

- `Escape` cierra sólo cuando no se descarta una decisión irreversible.
- La ventana atrapa el foco y lo devuelve al control que la abrió.
- Clic en backdrop no descarta formularios con cambios.
- No se permiten ventanas dentro de ventanas.
- No usar `window.confirm` como parte de la experiencia final.
- No usar `!important` como fundamento del sistema nuevo.

### 11.5 Comportamiento por contenido

- Confirmación: XS, altura automática.
- Formulario breve: S.
- Formulario medio o bloqueo: M.
- Resultados tabulares: L.
- Agenda con horarios reales: Workspace.
- Agenda sin horarios o configuración: M, sin calendario vacío gigante.
- Error recuperable: conserva contexto y ofrece reintento.
- Error de permiso: explica el permiso sin mostrar controles imposibles.

## 12. Botones y acciones

### 12.1 Jerarquía

1. **Primaria:** azul SMYL, texto blanco.
2. **Secundaria:** fondo blanco, borde neutro, texto principal.
3. **Terciaria:** texto o icono sin contenedor dominante.
4. **Destructiva:** rojo únicamente cuando la acción lo sea.

### 12.2 Dimensiones

- Escritorio: 36 px.
- Acción destacada: 40 px sólo cuando la tarea lo justifique.
- Botón compacto: 32 px dentro de una barra con contexto claro.
- Móvil o `pointer: coarse`: 44 px.
- Padding horizontal: 12–16 px.
- Texto: 13 px en escritorio y 14 px en móvil.

### 12.3 Reglas

- Usar verbos específicos: “Guardar cita”, “Confirmar pago”.
- Evitar “Aceptar”, “Continuar” o “Sí” cuando la consecuencia no es obvia.
- Sólo una acción primaria por contexto.
- Una acción deshabilitada explica qué falta.
- Acciones automáticas o irreversibles muestran alcance antes de ejecutarse.

## 13. Formularios y filtros

- Etiqueta siempre visible sobre el control.
- Placeholder es ejemplo, no etiqueta.
- Ayuda debajo del campo sólo cuando evita un error real.
- Error junto al campo, con lenguaje accionable.
- Campos de escritorio: 36 px.
- Campos móviles: 44–48 px y texto de 16 px.
- Máximo tres filtros primarios visibles en una ventana.
- Fechas relacionadas se agrupan como rango.
- Sucursal y profesional muestran su dependencia.
- Valores clínicos y financieros incluyen unidad y zona horaria cuando aplica.

Anchos mínimos antes de reacomodar:

| Campo | Ancho mínimo |
|---|---:|
| Servicio | 240 px |
| Sucursal | 180 px |
| Profesional | 180 px |
| Fecha | 148 px |
| Acción | 112 px |

Si no caben, se crea otra fila. Nunca se comprimen hasta cortar todos los
valores.

## 14. Estados del sistema

### 14.1 Carga

- Conservar estructura para evitar saltos.
- Skeleton sólo donde el contenido esperado es conocido.
- Mantener visibles contexto y filtros.
- Anunciar el estado asíncrono de forma accesible.
- No cambiar varias veces el tamaño de la ventana en una búsqueda.

### 14.2 Vacío

Debe comunicar:

1. qué falta;
2. por qué importa; y
3. una acción útil si el usuario puede resolverlo.

Usa icono lineal máximo de 32 px, título de 14 px, una frase de 12–13 px y
padding vertical de 24–32 px. No usa ilustración grande, degradado, métrica
falsa ni altura fija.

### 14.3 Error

- Explicar qué no se completó.
- Conservar datos introducidos cuando sea seguro.
- Diferenciar red, permiso, validación y conflicto.
- Ofrecer reintento sólo cuando realmente puede funcionar.
- No representar un error técnico como “sin datos”.

### 14.4 Éxito

- Confirmación breve y cercana a la acción.
- Sin celebraciones o confeti en tareas clínicas o financieras.
- Comunicar el estado verificable: “Cita confirmada”, no “¡Listo!”.

### 14.5 Configuración incompleta

- Identificar la causa específica.
- Presentar una única ruta de resolución.
- Si el rol carece de permiso, indicar quién puede resolverlo.
- No mostrar una herramienta vacía que todavía no puede utilizarse.

## 15. Agenda como patrón de referencia

La Agenda dentro del chat será el primer Workspace aprobado bajo esta política.

### 15.1 Cabecera

- Título: “Agendar cita”.
- Contexto: `Paciente · Clínica / Sucursal`.
- Sin calendario decorativo ni texto “sin salir del chat”.
- Cierre mediante `×` accesible.
- El paciente nunca se sustituye por tenant, clínica o sucursal.

### 15.2 Flujo

1. Confirmar identidad del paciente.
2. Elegir servicio.
3. Elegir sucursal si existen varias.
4. Elegir profesional o equipo compatible.
5. Navegar periodo.
6. Seleccionar hasta tres horarios.
7. Agregar opciones al mensaje para revisión humana.

### 15.3 Filtros

- Primera línea: servicio, sucursal y profesional.
- Segunda barra: periodo y navegación anterior/siguiente.
- “Fechas personalizadas” revela Desde/Hasta sólo cuando se solicita.
- No mostrar simultáneamente cuatro píldoras, dos fechas y cinco campos.
- “Actualizar” se reemplaza por una acción inequívoca o por actualización
  automática; nunca se combinan ambos modelos.

### 15.4 Estados y tamaño

- Falta de configuración: M, altura automática, una acción contextual.
- Sin horarios: M, acción “Ver siguientes 7 días” y secundaria “Cambiar
  filtros”.
- Lista breve: L.
- Agenda semanal real: Workspace, hasta 960 px.
- El pie aparece sólo cuando existe una selección.
- En móvil, los días son grupos verticales; no columnas parcialmente ocultas.

### 15.5 Resultados

- Máximo cuatro días visibles en escritorio.
- Cada horario muestra hora, duración, profesional, especialidad y sucursal.
- Toda la tarjeta es seleccionable.
- Selección usa borde, fondo tenue e indicador; no otro botón verde.
- El pie resume `n horarios seleccionados` y ofrece una sola acción primaria:
  “Agregar opciones al mensaje”.

## 16. Tarjetas, tablas y métricas

### 16.1 Tarjetas

- Se usan para unidades independientes o seleccionables.
- No sustituyen automáticamente una sección.
- Padding habitual: 16 px.
- Título: 14 px; descripción: 12–13 px.
- Sin sombra cuando ya están delimitadas por el fondo o la cuadrícula.

### 16.2 Tablas

- Texto principal: 12–13 px; metadatos: 11 px.
- Filas: 40–48 px según complejidad.
- Acciones frecuentes visibles; acciones excepcionales en menú.
- En móvil, convertir a lista estructurada si la tabla pierde legibilidad.

### 16.3 Métricas

- Una cifra grande incluye periodo, unidad y fuente comprensible.
- No confundir actividad con desempeño clínico.
- No mostrar métricas sin datos suficientes.
- Máximo cuatro métricas principales por franja.

## 17. Fotografía clínica y simulación

- Mantener encuadre, proporción, resolución, iluminación y color general de la
  fotografía original.
- Fuera de las superficies dentales tratadas, conservar el original píxel a
  píxel siempre que el proceso lo permita.
- No embellecer piel, labios, encías, cabello, ojos ni fondo.
- No recortar para llenar; usar `contain` y conservar relación de aspecto.
- Antes y después usan exactamente la misma transformación.
- Controles y etiquetas no cubren dientes, labios o referencias anatómicas.
- Blanco identifica ejes, ámbar curva de sonrisa y verde proporciones.
- “Simulación” se identifica siempre como tal.
- Toda imagen clínica se considera sensible aunque no muestre el rostro.
- No prometer fidelidad diagnóstica de color en pantallas no calibradas.
- Original y derivado se conservan como versiones diferenciadas y trazables.
- Al compartir públicamente se eliminan metadatos EXIF sensibles.

## 18. Imágenes en módulos operativos

- Agenda, Caja, Inventario y Reportes no usan fotografía de stock de relleno.
- No mostrar fotografías clínicas como avatares en calendarios o tableros.
- Usar iniciales o iconos lineales cuando se requiera identificación visual.
- Las ilustraciones sólo se justifican si enseñan un proceso difícil de
  explicar con texto, datos o iconografía.
- No simular pacientes, resultados o actividad inexistente.

## 19. Movimiento y retroalimentación

- Duración habitual: 120–220 ms.
- Apertura de ventana: opacidad y desplazamiento máximo de 8 px.
- Sin rebotes, zoom dramático o animaciones continuas.
- Respetar `prefers-reduced-motion`.
- Hover no cambia geometría ni provoca saltos.
- Estado presionado visible sin depender sólo de animación.

## 20. Accesibilidad

Estándar mínimo: WCAG 2.2 AA.

- Texto normal: contraste mínimo 4.5:1.
- Texto grande y límites esenciales: mínimo 3:1.
- Objetivo táctil de producto: 44 × 44 px en móvil.
- Ningún objetivo interactivo queda por debajo de 24 × 24 px sin el espaciado
  o alternativa equivalente exigida por WCAG.
- Foco visible con contorno continuo de al menos 2 px y contraste suficiente.
- Ventanas con foco inicial, trampa, `Escape` y retorno al origen.
- Orden visual y orden del DOM coinciden.
- Contenido y controles refluyen a 320 px sin pérdida funcional ni scroll
  horizontal, salvo visualizaciones bidimensionales esenciales.
- Estados y selección no dependen únicamente del color.
- Zoom de navegador a 200% no oculta acciones o contenido esencial.
- Mensajes asíncronos usan una región viva apropiada.

## 21. Responsive

### 21.1 Rangos funcionales

- Amplio: 1280 px o más.
- Medio: 768–1279 px.
- Estrecho: menos de 768 px.
- Compacto: menos de 480 px.

El contenido decide el punto exacto en que una distribución deja de ser
legible; los rangos no representan dispositivos específicos.

### 21.2 Principios

- Reordenar antes de reducir.
- Apilar antes de truncar.
- Ocultar sólo información secundaria recuperable.
- Mantener la misma secuencia mental.
- En móvil, una acción fija no cubre el último contenido desplazable.
- En poca altura, reducir espacio antes que fuente.
- Una cuadrícula esencial puede desplazarse en su eje, pero cada panel sigue
  siendo legible a 320 px.

### 21.3 Matriz mínima de revisión

- 1440 × 900.
- 1280 × 720.
- 1024 × 768.
- 768 × 1024.
- 390 × 844.
- 360 × 800.
- 320 × 568 para reflujo.
- Zoom del navegador a 200%.

## 22. Voz y contenido

- Español natural, preciso y profesional.
- Frases cortas y verbos concretos.
- Títulos describen la tarea: “Agendar cita”, no “Agenda · Sin salir del
  chat”.
- Evitar marketing, exclamaciones y emojis en flujos clínicos.
- Nombrar objeto y consecuencia: “Cancelar cita”, no sólo “Cancelar”.
- “SMYL sugiere”; el profesional “revisa” y “aprueba”.
- No mostrar tenant, payload, webhook, RLS u otros términos internos.
- No prometer sincronización, envío o confirmación sin evidencia del servidor.

## 23. Privacidad visual

- Mostrar la mínima información clínica necesaria para la tarea.
- Listas generales no muestran diagnósticos, notas ni archivos clínicos.
- No persistir contenido sensible en fixtures, capturas o demostraciones.
- En superficies compartidas, ocultar datos hasta una intención explícita.
- Un acceso denegado no revela que existe un paciente o expediente.
- Un modo de privacidad debe poder ocultar nombre, teléfono y fotografía al
  compartir pantalla.

## 24. Señales prohibidas

- Ventanas grandes para estados vacíos.
- Texto operativo menor de 10 px.
- Títulos de ventana mayores de 18 px sin excepción aprobada.
- Pesos 800/900 o valores tipográficos inventados.
- Radios superiores a 12 px en SMYL Operativo.
- Tarjetas flotantes, halos, degradados y sombras sin función.
- Más de una acción primaria en el mismo contexto.
- Cinco o más filtros expuestos en una sola fila.
- Nombres importantes truncados permanentemente.
- Píldoras para acciones largas.
- Iconos de familias diferentes o emojis funcionales.
- Bordes completos en cada nivel de anidación.
- Datos clínicos falsos para llenar una pantalla.
- Tenant mostrado como paciente, profesional o sucursal.
- `window.confirm` como experiencia final.
- `!important` como estrategia del sistema visual.
- Hexadecimales y tamaños arbitrarios cuando existe un token.

## 25. Arquitectura técnica

### 25.1 Fuente única

Los tokens canónicos viven en una hoja compartida. Los módulos consumen
variables semánticas y no redefinen la identidad completa.

Capas:

1. Tokens de marca y semánticos.
2. Reset y tipografía.
3. Primitivos: botón, campo, etiqueta, tarjeta, ventana y estado.
4. Patrones: filtros, tablas, agenda, ficha y compositor.
5. Ajustes específicos del módulo.

### 25.2 Reglas de implementación

- Un módulo puede definir geometría específica, no una paleta paralela.
- Toda excepción documenta motivo, alcance y fecha de revisión.
- Web y `mobile/www` conservan paridad para activos compartidos.
- Un cambio visual no modifica identificadores, eventos, permisos ni lógica.
- Componentes nuevos reutilizan primitivas antes de crear otra variante.
- No se publica un componente sin estados normal, hover, focus, disabled,
  loading, error y responsive cuando apliquen.
- Los alias heredados sólo existen durante una migración con fecha de retiro.

## 26. Gobierno y migración

### 26.1 Orden de decisión

1. Seguridad y exactitud clínica.
2. Comprensión de la tarea.
3. Accesibilidad.
4. Coherencia del sistema.
5. Eficiencia y densidad.
6. Refinamiento estético.

### 26.2 Flujo para componentes nuevos

1. Definir tarea, usuario y estado principal.
2. Elegir un patrón existente.
3. Diseñar normal, vacío, carga, error y permiso.
4. Revisar escritorio, tableta y móvil.
5. Validar teclado, foco, contraste y reflujo.
6. Comparar con una pantalla de referencia aprobada.
7. Publicar sólo con evidencia visual y pruebas de regresión.

### 26.3 Orden de migración

1. Tokens, botón, campo, etiqueta y foco.
2. Ventanas XS/S/M/L/Workspace.
3. Agenda dentro del chat como referencia.
4. Agenda general, Caja e Inventario.
5. Ventanas restantes del chat.
6. Acceso y overlays heredados.
7. Studio como variante independiente.

Hasta aprobar la Agenda no se propagan ajustes locales al resto de ventanas.

## 27. Lista de aceptación

### Jerarquía

- [ ] La tarea principal se entiende en menos de cinco segundos.
- [ ] Existe una sola acción primaria por contexto.
- [ ] Título, contexto, contenido y acciones se distinguen sin color.
- [ ] No hay datos redundantes en la cabecera.

### Tipografía y densidad

- [ ] Se utilizan los roles tipográficos definidos.
- [ ] No hay texto funcional menor de 10 px.
- [ ] Los títulos de ventana son 18/24 px.
- [ ] Los valores importantes no están truncados permanentemente.
- [ ] Peso, tamaño y color no compiten simultáneamente.

### Ventanas

- [ ] Patrón y tamaño corresponden a la tarea.
- [ ] El estado vacío usa altura automática.
- [ ] Sólo el cuerpo controla el scroll.
- [ ] Cabecera y pie permanecen estables.
- [ ] Cerrar, `Escape` y retorno de foco funcionan.

### Componentes

- [ ] Radio, borde, sombra y espacio usan tokens.
- [ ] No hay tarjetas o bordes anidados sin función.
- [ ] Hover, focus, disabled, loading y error están diseñados.
- [ ] El color semántico corresponde al estado real.

### Responsive y accesibilidad

- [ ] La matriz mínima fue revisada visualmente.
- [ ] La interfaz refluye a 320 px.
- [ ] Acciones frecuentes cumplen el objetivo táctil de producto.
- [ ] El foco es visible y el orden de teclado es lógico.
- [ ] Contraste de texto y controles fue verificado.
- [ ] `prefers-reduced-motion` funciona.

### Clínica, privacidad y autenticidad

- [ ] Paciente, clínica, sucursal y profesional están identificados.
- [ ] No hay datos sensibles innecesarios o ficticios.
- [ ] Una sugerencia de IA no parece decisión clínica confirmada.
- [ ] Fotografías y comparadores conservan encuadre y escala.
- [ ] La interfaz no promete una operación no confirmada por el servidor.

### Distribución

- [ ] Web, PWA y móvil contienen la misma versión visual.
- [ ] Las pruebas de regresión relevantes están aprobadas.
- [ ] La revisión visual fue documentada antes de publicar.

## 28. Referencias normativas

- [WCAG 2.2 — Contraste mínimo](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- [WCAG 2.2 — Tamaño mínimo de objetivos](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- [WCAG 2.2 — Apariencia del foco](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html)
- [WCAG 2.2 — Reflow](https://www.w3.org/WAI/WCAG22/quickref/#reflow)

## 29. Excepciones

Una excepción sólo se acepta cuando:

1. existe una necesidad clínica, de accesibilidad o de plataforma verificable;
2. la solución normal no satisface esa necesidad;
3. se documentan motivo y alcance;
4. no crea otro sistema visual paralelo; y
5. incluye una fecha o condición de revisión.

“Se ve mejor”, “así venía el componente” o “no hubo tiempo” no son criterios de
excepción.
