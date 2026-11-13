---
name: smyl-clinical-input
description: Diseña o modifica entradas clínicas rápidas de SMYL, como dictado dental, sin crear módulos paralelos ni eludir la confirmación profesional. Úsala en Valoración, odontograma y borradores clínicos; no para mensajería o notas administrativas.
---

# Entrada clínica SMYL

Antes de modificar una entrada clínica, lee `AGENTS.md`, las entradas recientes de `docs/HANDOFF.md`, `docs/POLITICA_VISUAL_SMYL_V4.md` y el modelo que valida el documento afectado.

## Invariantes

- Conserva el odontograma y su documento versionado como única fuente clínica.
- Trata voz, cámara o atajos como métodos de captura, no como módulos, diagnósticos ni guardados independientes.
- Una sugerencia debe pasar por una vista previa editable y una confirmación explícita del profesional antes de entrar al borrador.
- El borrador se persiste únicamente mediante el guardado canónico existente. No guardes desde callbacks de reconocimiento, IA o sensores.
- No sobrescribas registros anteriores. Respeta control de revisión, conflictos y el historial longitudinal.
- No persistas audio, texto provisional ni datos clínicos en logs, almacenamiento local o telemetría.
- Sin permiso, soporte o conexión, falla de forma recuperable y conserva intacto el flujo manual.

## Experiencia

- Añade como máximo una acción secundaria en el lugar donde ya ocurre la tarea.
- Usa tres estados claros: listo, escuchando y revisar. Expresa cada estado con texto; el color y la animación son secundarios.
- Para dictado dental, presenta `pieza FDI + superficie + hallazgo` como campos corregibles. Una frase incompleta o ambigua nunca se completa por inferencia.
- Mantén una sola acción primaria por momento, texto de al menos 12 px, objetivos táctiles de 44 px en móvil, foco visible, retorno de foco y `aria-live` para estados.
- Usa tokens, azul marino, turquesa, radios y sombras de SMYL. Evita nuevas dependencias visuales si los componentes actuales resuelven la tarea.
- Respeta `prefers-reduced-motion` y valida escritorio, tableta, 390 px y 320 px.

## Límites técnicos

- Reutiliza `SpeechRecognition || webkitSpeechRecognition` sólo tras una acción del usuario, con una frase por sesión y cierre explícito.
- Aborta el micrófono al cerrar, cambiar de paciente, cambiar de ruta o perder la sesión.
- Si el modelo vigente no tiene campos estructurados para una captura, guarda únicamente una representación compatible en el borrador actual y documenta la limitación. No amplíes esquemas, RPC, RLS o migraciones sin una solicitud específica.

## Verificación

- Prueba variantes es-MX, números FDI hablados, sinónimos de superficies, frases incompletas, piezas inválidas y ambigüedad.
- Demuestra que reconocer, cancelar o fallar no modifica ni guarda el expediente.
- Comprueba que confirmar alimenta el mismo borrador, conserva acción/estado previos y que sólo el guardado canónico crea una versión.
- Verifica permisos, API ausente, micrófono denegado, `no-speech`, error de red, teclado, foco y paridad entre web y `mobile/www`.
