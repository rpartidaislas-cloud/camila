# Control de costo y modelos de IA en SMYL

## Ruta actual de una simulación rápida

1. Se conserva una fotografía frontal obligatoria.
2. Claude analiza proporciones faciales sobre esa frontal.
3. El proveedor configurado en el servidor genera una sola propuesta de
   carillas para la frontal. En producción, `SMYL_IMAGE_PROVIDER=openai` usa
   GPT Image 2; Gemini queda disponible como rollback.
4. Las cinco fotografías opcionales se guardan como documentación y no
   disparan generación automática.
5. El diagnóstico clínico ampliado se solicita por separado, únicamente
   cuando el profesional lo necesita.

## Regla de cobro técnico

- Una pulsación de **Generar** produce como máximo una solicitud pagada de
  generación de imagen desde el navegador.
- El servidor intenta un solo proveedor y un solo modelo por defecto. Una
  pulsación no activa proveedores alternativos ocultos. Si el proveedor es
  Gemini, `GEMINI_IMAGE_MAX_ATTEMPTS` permite elevar deliberadamente su límite
  interno a 2 o 3 si se prioriza disponibilidad sobre costo.
- Las fallas de red no repiten automáticamente esa generación. El usuario
  decide si desea volver a intentarlo.
- Cada solicitud lleva requestId y requestReason.
- La respuesta registra provider, model, attempts, elapsedMs y usage cuando
  el proveedor lo informa.
- Si se habilitan modelos de respaldo, los intentos quedan visibles como
  attempts; así se puede detectar si una simulación consumió más de un intento
  en el proveedor.

## Proveedor de imagen en producción

`SMYL_IMAGE_PROVIDER` acepta `openai` o `gemini` y se resuelve únicamente en la
Edge Function. El navegador público no puede cambiarlo ni recibe credenciales.
La configuración vigente usa `openai` con el snapshot
`gpt-image-2-2026-04-21`. Para rollback inmediato:

```text
SMYL_IMAGE_PROVIDER=gemini
```

Una sesión profesional sí puede pedir un proveedor explícito para pruebas A/B.
El cliente público sólo puede usar el predeterminado del servidor y conserva
los mismos topes por plan/IP.

## Comparación controlada con OpenAI

El backend conserva una prueba A/B interna mediante `imageProvider`, exige
sesión profesional y no aparece en la interfaz del paciente. Si el proveedor
predeterminado vuelve a Gemini, solicitar OpenAI además exige
`OPENAI_IMAGE_EXPERIMENT_ENABLED=true`. La prueba se hará con la
misma fotografía, recorte y prescripción clínica:

- **Control:** Gemini actual.
- **Candidato:** gpt-image-2.
- **Métricas:** fidelidad fuera de dientes, cobertura de piezas, anatomía,
  alineación antes/después, tiempo total, tasa de error y costo por resultado
  aprobado.
- **Criterio de decisión:** no migrar por una sola imagen atractiva. Se exige
  un lote de casos representativo y revisión ciega.

El procedimiento, rúbrica, telemetría y rollback están definidos en
`docs/AI_IMAGE_AB_HARNESS.md`.

Documentación oficial de OpenAI:

- https://developers.openai.com/api/docs/models/gpt-image-2
- https://developers.openai.com/api/docs/guides/image-generation

La documentación oficial describe GPT Image 2 como el modelo actual de
generación y edición de imágenes y confirma que admite entrada y salida de
imagen. Precio, acceso y límites deben verificarse nuevamente al ejecutar la
prueba porque dependen de la cuenta y pueden cambiar.
