# Política de imagen y producto SMYL

## Propósito

SMYL debe percibirse como una herramienta clínica contemporánea creada por un equipo de producto dental, no como una interfaz decorativa generada por IA. La imagen debe transmitir precisión, calma, criterio profesional y confianza. Cada elemento visual tiene que ayudar a evaluar, comparar o decidir.

## Principios de identidad

1. **Clínico, no frío.** Superficies limpias, lenguaje claro y fotografías protagonistas; evitar una estética hospitalaria rígida.
2. **Precisión antes que espectáculo.** El estado y la función de un control deben reconocerse antes que su estilo.
3. **Una acción principal por contexto.** Las acciones secundarias nunca compiten visualmente con “Aplicar diseño” o “Generar simulación”.
4. **La fotografía es evidencia.** La interfaz acompaña la imagen clínica y no debe contaminarla con luces, halos o efectos decorativos.
5. **El profesional conserva el control.** La IA recomienda; el dentista revisa, modifica y aprueba.

## Lenguaje visual

### Color

- Fondo principal: carbón casi negro (`#0B0D10`).
- Superficie: grafito (`#121519`) y grafito elevado (`#181C21`).
- Texto principal: blanco suave (`#F5F7F9`); texto secundario: gris (`#9299A3`).
- Acento de producto: violeta SMYL (`#7667E8`), reservado para selección y acción principal.
- Verde: validación clínica, proporciones y estados correctos; nunca como decoración.
- Ámbar: curva de sonrisa y advertencias; nunca como acción principal.
- Rojo: error o acción destructiva exclusivamente.

No usar más de un color de acento dentro del mismo grupo de controles.

### Superficies y efectos

- Usar fondos sólidos. Los degradados sólo se justifican en la marca o en una visualización material donde comuniquen volumen real.
- Evitar resplandores, neón, halos y sombras coloreadas.
- Radio estándar de 8 a 10 px; las píldoras se reservan para etiquetas o filtros breves.
- Bordes sutiles de 1 px separan mejor que sombras grandes.

### Tipografía

- Familia: Inter o sans serif equivalente.
- Títulos breves y directos; evitar mayúsculas sostenidas salvo microetiquetas.
- Jerarquía recomendada: título 15–18 px, sección 11–13 px, control 11–13 px, ayuda 9–11 px.
- No combinar negritas, mayúsculas y colores en el mismo texto salvo en un estado crítico.

### Iconos

- Iconos lineales simples, del mismo grosor y tamaño visual (16–18 px).
- Todo icono ambiguo debe llevar etiqueta.
- No utilizar emojis en controles, mensajes clínicos o navegación.
- Los signos `+`, `−` y `×` son aceptables cuando su significado es universal.

## Fotografía clínica y simulación

- Mantener el encuadre, proporción, resolución, iluminación y color general de la fotografía original.
- Fuera de las superficies dentales tratadas, la imagen generada debe coincidir con el original píxel a píxel siempre que el proceso lo permita.
- No embellecer piel, labios, encías, cabello, ojos ni fondo.
- No recortar una fotografía para hacerla caber: usar `contain` o un encuadre explícito y conservar la relación de aspecto.
- El comparador antes/después debe usar exactamente la misma transformación para ambas capas.
- Las guías clínicas deben tener significado constante: blanco para ejes, ámbar para curva de sonrisa y verde para proporciones.
- Las etiquetas “Antes” y “Con carillas” describen estados; no deben parecer publicidad.

## Arquitectura de controles

El editor se organiza en este orden:

1. **Navegación:** cerrar, título, restablecer y aplicar.
2. **Guías de análisis:** verticales, horizontales, curva, proporciones y agrupación.
3. **Lienzo y fotografía:** original/simulación, mover, zoom de fotografía y tamaño de guía.
4. **Recomendación clínica:** punto de partida orientativo.
5. **Forma y posición:** línea media, línea incisal, arco, alturas, forma y tamaño.
6. **Proporciones dentales:** distribución anterior y ancho/alto.
7. **Color y material:** caracterización, guía VITA, valor, croma y translucidez.
8. **Ajustes avanzados:** encía y funciones de uso excepcional.

No mezclar controles de zoom fotográfico con controles de escala de guía. Cada grupo debe tener un nombre visible.

## Componentes e interacción

- Área táctil mínima: 44 × 44 px para acciones frecuentes en móvil; 34 px sólo para controles compactos acompañados por contexto claro.
- Un control seleccionado usa fondo y borde de acento, no un resplandor.
- Los controles relacionados viven en el mismo bloque; los bloques se separan con espacio y borde.
- Mostrar siempre valor y unidad en sliders.
- El botón de restablecer debe explicar qué restablece cuando existan varios niveles.
- El zoom debe conservar el centro visual y nunca ocultar permanentemente una parte de la foto.
- El botón “Ver original” debe alternar a “Ver simulación”; nunca debe crear una tercera representación.

## Voz y contenido

- Frases cortas, en español natural y profesional.
- Preferir verbos concretos: “Mover”, “Ajustar”, “Aplicar”, “Comparar”, “Restablecer”.
- Evitar expresiones promocionales dentro del flujo clínico, exclamaciones y emojis.
- Las recomendaciones automáticas se identifican como orientativas y requieren validación profesional.

## Señales que debemos evitar

- Muchos degradados violetas, brillos o tarjetas flotantes sin función.
- Todas las secciones con el mismo peso visual.
- Píldoras para acciones largas o formularios completos.
- Textos genéricos como “potenciado por IA” repetidos en pantalla.
- Iconos de estilos distintos, emojis y adornos no funcionales.
- Datos clínicos falsos usados sólo para rellenar una interfaz.

## Lista de verificación antes de publicar

- La acción principal se identifica en menos de dos segundos.
- Fotografía, zoom y guías están claramente separados.
- No hay controles superpuestos sobre dientes o referencias importantes.
- Escritorio, tableta y móvil conservan el mismo orden mental.
- Navegación por teclado, contraste y etiquetas accesibles están presentes.
- Original y simulación conservan encuadre y escala idénticos.
- No se modificaron identificadores, eventos ni lógica al hacer un ajuste puramente visual.
