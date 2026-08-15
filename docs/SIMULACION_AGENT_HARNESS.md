# Harness multiagente para `simulacion.html`

## Objetivo

Revisar y mejorar `simulacion.html` mediante evidencia reproducible, cambios
pequeños y validación independiente. El harness evita que varios agentes editen
el mismo archivo a la vez y que una corrección visual rompa captura, alineación,
comparación, almacenamiento o publicación.

Este protocolo no autoriza por sí mismo cambios clínicos, prompts, modelos,
costos, credenciales o backend. Cada ejecución debe declarar su alcance.

## Roles

### 1. Orchestrator — propietario de la ejecución

- Convierte la solicitud en criterios de aceptación observables.
- Registra commit base, rama, archivos permitidos y cambios ajenos protegidos.
- Asigna tareas de solo lectura a Explorer y Reviewer.
- Autoriza un único paquete de implementación al Implementer.
- Entrega el mismo build al Tester y decide si se publica o se revierte.
- Es la única función autorizada para integrar, hacer commit y publicar.

### 2. Explorer — investigación de solo lectura

- Traza el flujo completo desde captura hasta resultado y comparación.
- Localiza funciones, estado, almacenamiento, llamadas remotas y temporizadores.
- Reproduce el problema sin editar y conserva consola, red, capturas y pasos.
- Identifica código duplicado, rutas muertas y dependencias entre módulos.
- Entrega hipótesis priorizadas; no propone una reescritura sin evidencia.

### 3. Reviewer — revisión técnica y de riesgo

- Revisa los hallazgos del Explorer contra el código real.
- Evalúa composición, escalado, coordenadas, proporción, máscaras y asincronía.
- Señala riesgos de privacidad, credenciales, costo y datos clínicos.
- Clasifica hallazgos como bloqueante, alto, medio o mejora.
- Define qué no debe cambiar y qué regresiones debe buscar el Tester.

### 4. Implementer / Fixer — único editor

- Recibe un alcance aprobado y modifica sólo los archivos permitidos.
- Prefiere arreglar la causa raíz con el cambio mínimo verificable.
- No relaja validaciones para ocultar errores ni cambia prompts por intuición.
- Añade instrumentación temporal sólo si se retira antes del commit.
- Entrega diff, explicación causal y pruebas locales ejecutadas.

### 5. Tester — validación independiente

- Prueba el build del Implementer sin modificarlo.
- Ejecuta matriz funcional, visual, responsive, red lenta y reintentos.
- Compara original/simulación con puntos de referencia estables.
- Reporta aprobado o rechazado con evidencia; no corrige durante la prueba.

### Especialista clínico — aprobación humana recomendada

No es un agente de código. Un odontólogo debe decidir si anatomía, proporción,
tono y comunicación al paciente son clínicamente aceptables. El resultado de
IA continúa siendo orientativo.

## Artefactos obligatorios por ejecución

Crear una carpeta temporal `artifacts/simulacion-harness/<fecha>-<caso>/` que
no se incluye en Git y contenga:

1. `brief.md`: problema, alcance, commit base y criterios de aceptación.
2. `explorer.md`: mapa del flujo, reproducción, consola, red e hipótesis.
3. `review.md`: riesgos, prioridades y límites de implementación.
4. `implementation.md`: archivos, diff resumido y causa corregida.
5. `test-report.md`: matriz, evidencia y resultado final.
6. `screenshots/`: original, resultado y comparador en posiciones equivalentes.

Nunca guardar claves, tokens, datos identificables de pacientes ni fotografías
clínicas reales dentro del repositorio. Para pruebas usar imágenes sintéticas o
casos expresamente anonimizados y autorizados.

## Flujo de ejecución

### Puerta 0 — congelar la base

- Registrar `git status -sb`, rama y SHA.
- Enumerar cambios ajenos que deben preservarse.
- Definir un caso reproducible y el navegador/dispositivo objetivo.
- Prohibir edición si no existe una comparación original/resultado válida.

### Puerta 1 — explorar

Explorer entrega:

- diagrama captura → preparación → API → respuesta → composición → comparador;
- lista de transformaciones de escala, recorte y coordenadas;
- tiempos, reintentos y mensajes de error;
- tres hipótesis como máximo, ordenadas por evidencia.

### Puerta 2 — revisar

Reviewer confirma o descarta cada hipótesis y prepara un contrato de cambio:

- archivos permitidos;
- funciones permitidas;
- invariantes que deben permanecer intactas;
- pruebas obligatorias y condiciones de rechazo.

### Puerta 3 — implementar

Implementer trabaja sobre una rama `codex/simulacion-<objetivo>` y realiza un
solo paquete lógico. Si descubre una causa distinta, se detiene y devuelve el
caso al Orchestrator en lugar de ampliar silenciosamente el alcance.

### Puerta 4 — probar

Tester ejecuta exactamente el commit candidato. Un fallo bloqueante regresa al
Implementer con pasos reproducibles. Tras una corrección se repite toda la
matriz afectada, no únicamente el caso fallido.

### Puerta 5 — integrar y publicar

Orchestrator comprueba diff y estado, integra una sola vez, publica, espera el
despliegue y repite una prueba breve sobre la URL pública. No se considera
terminado sólo porque el push haya concluido.

## Matriz mínima de pruebas

| Área | Comprobación | Criterio |
|---|---|---|
| Entrada | Foto vertical, horizontal y de baja resolución | Sin recorte inesperado ni deformación |
| Identidad | Rostro, labios, encías, fondo e iluminación | Permanecen visualmente intactos fuera de dientes |
| Alineación | Original y resultado en comparador | Mismos puntos faciales y mismo encuadre |
| Dentición | Arcada superior visible | Cobertura completa, sin invadir inferiores ni tejidos |
| Realismo | Anatomía, contactos, textura y tono | Sin efecto calcomanía, teclado o blanco plano |
| Interacción | Antes/después y ajuste manual | Sin saltos al mover la división |
| Responsive | 390×844, 820×1180 y 1440×900 | Sin desbordamiento ni controles inaccesibles |
| Red | Lenta, timeout, error y reintento | Termina o falla con mensaje y estado recuperable |
| Persistencia | Recargar y volver al caso | No pierde fotos ni mezcla pacientes |
| Publicación | URL pública | Sirve el SHA aprobado y no una versión anterior |

## Condiciones automáticas de rechazo

- Cambia píxeles fuera de la región dental autorizada.
- Original y simulación no comparten geometría de visualización.
- Falta una pieza objetivo o aparece contenido sobre dientes inferiores.
- Se oculta un error de red mostrando un resultado parcial como aprobado.
- Se expone una clave o se envía información adicional no declarada.
- El cambio requiere ajustar manualmente cada caso para verse alineado.
- El Tester no puede reproducir la evidencia del Implementer.

## Plantilla de encargo al Orchestrator

```text
Objetivo:
Caso reproducible:
Resultado actual:
Resultado esperado:
Archivos permitidos:
Áreas prohibidas:
Dispositivos objetivo:
Criterios de aceptación:
¿Autoriza publicación?: no, hasta aprobar el informe del Tester
```

## Regla de oro

Explorer descubre, Reviewer cuestiona, Implementer cambia, Tester intenta
romper y Orchestrator decide. Ningún agente aprueba su propio trabajo.
