# Piloto SMYL rápido + LANA — integración local

## Implementado

- Copia aislada `camila-lana-integration`, rama `codex/smyl-lana-integration`, basada en camila con sus modificaciones locales preservadas. No se cambió ninguna de las dos carpetas fuente.
- `simulacion-rapida.html` integra la experiencia aprobada ceramica16, conservada sin sustituir `simulacion.html` (flujo clínico previo).
- Panel `app.html` ofrece simulación rápida y mantiene acceso al flujo clínico/editor.
- `/nueva/` lleva por defecto al flujo rápido profesional. `experiencia=clinica` conserva el destino anterior. No es un enlace público autenticado para pacientes: requiere sesión del dentista y coincidencia de clínica.
- Al guardar un caso de LANA se incluyen sus campos de cita. Solo después de confirmar persistencia en nube se solicita la notificación existente. Se muestra confirmación de LANA únicamente con respuesta `ok:true`. Fallos no regeneran imágenes. Desde HTTP local no se notifica.
- Guardar sin origen LANA no dispara webhook. Nuevo caso elimina la asociación anterior.

## Verificación sin coste

`node tests/lana-quick.test.mjs`

`node tests/lana-integration.test.mjs`

`tests/quick-modes-browser.cjs` con PLAYWRIGHT_MODULE y EDGE_BINARY: interfaz en 1366, 768 y 390, generación simulada, sin API real.

## Antes de publicar

1. Revisar diff y contrato del backend de imagen contra el despliegue real. El backend local mantiene el enrutamiento sin máscara/guía y pasa el prompt visual sin prefijo clínico; no se modificó el proveedor ni el modelo.
2. Confirmar migración LANA, dominio HTTPS autorizado y secretos en servidor. No se configuraron ni desplegaron en esta tarea.
3. Ejecutar caso sintético autorizado de extremo a extremo con clínica piloto y receptor LANA de pruebas; verificar almacenamiento privado, caducidad de imagen, deduplicación y resultado correcto. Las pruebas locales no validan disponibilidad remota ni calidad generativa.
4. La notificación existente no es una cola durable ni garantiza entrega única. Antes de habilitar automatización pública necesita outbox persistente, identificador estable de evento y deduplicación en receptor. No hacer reintentos generando otra imagen.

## Siguiente etapa pendiente (no anunciar como lista)

- Captura de paciente mediante token temporal, sin PII en URL ni credenciales del dentista.
- Validación previa de calidad, consentimiento versionado, límites por contacto y clínica, vencimiento y eliminación.
- Trabajo de generación en cola usando el mismo prompt versionado, con cupo reservado de forma atómica y estado de revisión profesional.
- Webhook de estado a LANA, aprobación del dentista y entrega. La API `analizar-foto` anterior sigue siendo análisis, no generación del después.
- Identificar el repositorio/receptor activo de LANA antes de cambiarlo. No se tocó código de LANA ni se enviaron mensajes.
