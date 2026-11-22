# SMYL ante COFEPRIS: funciones de IA y publicidad (documento para revisión legal)

Fecha: 22 de noviembre de 2026. Preparado a partir del código vigente para que un asesor regulatorio decida la
clasificación sanitaria de cada función. **No es una opinión legal.** Describe qué hace cada función, qué afirma,
qué salvaguardas tiene y qué preguntas quedan abiertas.

## 1. Pregunta central

COFEPRIS puede considerar **dispositivo médico** (software como dispositivo médico, SaMD) a un programa cuyo uso
previsto sea diagnosticar, prevenir, vigilar o tratar una enfermedad. Si una función de SMYL entra en esa definición,
necesitaría clasificación de riesgo y, en su caso, registro sanitario. El criterio que se siguió en el producto es:
**SMYL no diagnostica; muestra apoyos que un profesional confirma o descarta, y el criterio clínico es siempre suyo.**

## 2. Inventario de funciones con IA

| Función | Qué hace | Quién ve el resultado | Salvaguardas en el código | Riesgo regulatorio a valorar |
|---|---|---|---|---|
| Simulación de sonrisa (`simulacion.html`, `claude`, `segment-teeth`) | Genera una imagen estética ilustrativa a partir de la foto del paciente. | Profesional y paciente. | Casilla de consentimiento de IA; aviso visible «ilustrativa, no es diagnóstico, no garantiza resultados»; reglas del servidor que prohíben diagnosticar y prometer. | Bajo si se mantiene como estética e ilustrativa. Revisar como **publicidad** si se comparte. |
| Propuesta estética orientativa (`simulacion.html` → `claude`) | Puntaje de armonía estética, observaciones estéticas, plan y cotización orientativos. | Profesional y paciente. | Reglas fijas: solo aspectos estéticos, sin enfermedades ni urgencias; «orientativo, requiere valoración en consulta». | Medio: un «plan» y un «puntaje» podrían leerse como valoración clínica. Confirmar redacción. |
| Revisión de radiografías (`radiograph-analyze`, `claude` acción radiografía) | Señala zonas candidatas (densidad, contorno, restauraciones, soporte) para que el profesional revise. | Solo el profesional. | El servidor rechaza textos de diagnóstico (`FORBIDDEN_CLAIM`); cada señal queda pendiente hasta que el profesional la confirma, corrige o rechaza; la conclusión la escribe el profesional; protocolo de validación en `docs/RADIOGRAPH_VALIDATION_PROTOCOL.md`; motor en modo simulado. | **El más sensible.** Aunque no emite diagnóstico, «señalar hallazgos» en radiografías es el caso típico de SaMD de apoyo a la decisión clínica. Requiere clasificación formal antes de activarlo con un modelo real. |
| Revisión de fotografías clínicas (`claude` acción fotos clínicas) | Sugerencias de observación por foto, que el profesional confirma. | Solo el profesional. | Prompt «NO diagnosticas», filtro de términos, estado pendiente hasta confirmación humana, consentimiento de IA del paciente. | Medio: igual que radiografías, en menor grado. |
| Foto recibida por WhatsApp (`analizar-foto`) | Solo revisa si la foto sirve para una simulación y, si sirve, genera una simulación ilustrativa; pide revisión de la clínica. | Paciente (mensajes fijos) y clínica. | Ya **no** devuelve diagnóstico, tratamientos ni urgencia; la IA solo elige de una lista cerrada; sin consentimiento de IA no procesa nada. | Bajo tras el cambio del 22/11/2026. |
| MILA (dictado, transcripción, entrevista previa, conversación) | Transcribe y ordena lo que dicen el profesional o el paciente; la entrevista solo recaba antecedentes. | Profesional. | Prompts sin diagnóstico ni indicaciones; borradores que el profesional revisa y firma; consentimiento de IA del paciente; `store:false`. | Bajo (herramienta de documentación). |
| Resumen periodontal (`periodontal-summary`) | Resume mediciones capturadas por el profesional. | Profesional. | «No diagnostiques, no puntúes riesgo». | Bajo. |
| Asistente del perfil público (`public-profile-assistant`) | Responde dudas generales y de agenda. | Público. | «Nunca diagnosticas, nunca prometes resultados, no das indicaciones médicas»; ante urgencias remite a la clínica o al 911. | Bajo; revisar como **publicidad**. |

## 3. Publicidad de servicios de salud

Aplicable: Ley General de Salud (arts. 300 a 312) y su Reglamento en Materia de Publicidad.

Lo que ya existe en el producto:

- Perfil público con cédula profesional, institución que expidió el título, cédula de especialidad y número de
  **aviso o permiso de publicidad** (campo nuevo; lo llena la clínica).
- La base rechaza en el titular y la biografía frases prohibidas o engañosas: garantías, «sin dolor», superlativos,
  «100 %», «milagro», «cura», resultados inmediatos o permanentes.
- Casos antes/después: requieren autorización escrita del paciente, anonimización y aprobación de la clínica.
- Reseñas: solo tras una cita completada, moderadas por la clínica.

Preguntas para el asesor:

1. ¿Qué perfiles necesitan **aviso** y cuáles **permiso** de publicidad, y quién lo tramita (el profesional, la clínica o SMYL como plataforma)?
2. ¿Pueden mostrarse **casos antes/después** y **testimonios** en el perfil? ¿Con qué leyendas obligatorias?
3. ¿La simulación de sonrisa compartida con el paciente es publicidad? ¿Necesita leyenda adicional?
4. ¿La moderación de reseñas por la clínica (que podría ocultar las negativas) es aceptable o debe publicarse todo lo que no tenga datos personales?

## 4. Preguntas abiertas de clasificación

1. Revisión de radiografías con IA: ¿clase de riesgo y vía regulatoria (registro sanitario o no) si se activa con un modelo real?
2. Revisión de fotografías clínicas: ¿mismo tratamiento que radiografías?
3. Propuesta estética orientativa: ¿la redacción actual («armonía estética», «orientativo») basta para excluirla de SaMD?
4. ¿Se requiere etiquetado o leyenda específica en pantalla para las funciones de apoyo (NOM-137 / lineamientos de software)?

## 5. Mientras se resuelve

- Mantener el lenguaje «apoyo», «señal», «orientativo»; nunca «diagnóstico» en producto ni en ventas.
- No activar el motor real de radiografías sin la clasificación del punto 4.1.
- Toda salida clínica de IA queda pendiente hasta confirmación de un profesional con cédula.
