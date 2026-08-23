# Harness controlado: Gemini vs. GPT Image 2

## Objetivo

Comparar el proveedor vigente (Gemini) contra GPT Image 2 sin cambiar la
experiencia pública, sin reintentos invisibles y sin gastar dos generaciones
por una sola acción del paciente.

## Estado de seguridad

- El proveedor predeterminado lo decide `SMYL_IMAGE_PROVIDER` en el servidor;
  producción usa `openai` y Gemini queda como rollback.
- El cliente público no puede forzar ni cambiar el proveedor.
- Sólo una sesión profesional autenticada puede sobrescribirlo con
  `imageProvider` para una comparación A/B.
- Cuando el predeterminado es Gemini, pedir OpenAI en una prueba exige
  `OPENAI_IMAGE_EXPERIMENT_ENABLED=true`.
- Si la bandera o la API key faltan, la solicitud se rechaza antes de consumir
  el límite del plan.
- No existe fallback automático entre proveedores. Cada ejecución llama una
  sola vez al proveedor elegido.

## Secrets del entorno de prueba

```text
OPENAI_API_KEY=<clave del proyecto de pruebas>
SMYL_IMAGE_PROVIDER=openai
OPENAI_IMAGE_EXPERIMENT_ENABLED=true
OPENAI_IMAGE_MODEL=gpt-image-2-2026-04-21
OPENAI_IMAGE_TIMEOUT_MS=45000
```

Para apagar inmediatamente el experimento:

```text
SMYL_IMAGE_PROVIDER=gemini
OPENAI_IMAGE_EXPERIMENT_ENABLED=false
```

## Lote mínimo

Usar al menos 20 casos anonimizados y autorizados, repartidos entre:

- sonrisa frontal amplia y estrecha;
- dientes apiñados, separados y restaurados;
- exposición gingival baja, media y alta;
- iluminación uniforme y difícil;
- tonos VITA claros, medios y oscuros;
- piel, edad y anatomía facial diversas.

No usar nombres, teléfonos ni información clínica identificable en nombres de
archivo, prompts o planillas de evaluación.

## Ejecución por caso

1. Congelar la misma fotografía, recorte, prompt clínico, tono VITA y guía
   incisal.
2. Ejecutar una vez con `imageProvider: "gemini"`.
3. Ejecutar una vez con `imageProvider: "openai"`.
4. Guardar cada resultado con un código aleatorio A/B; el revisor no debe ver
   proveedor ni modelo.
5. Registrar `requestId`, proveedor, modelo, `elapsedMs`, `usage`, error y si
   el resultado fue clínicamente utilizable.
6. No repetir una generación fallida dentro de la misma observación. El
   reintento, si se autoriza, cuenta como una observación y un costo nuevos.

El cuerpo experimental conserva el contrato actual y solo añade:

```json
{
  "action": "generate_image",
  "imageProvider": "openai",
  "requestId": "ab-caso-001-openai",
  "requestReason": "controlled_ab_test"
}
```

## Rúbrica ciega (1 a 5)

Cada resultado lo revisan al menos dos profesionales:

1. Fidelidad de rostro, labios, encía, iluminación y encuadre.
2. Cobertura completa de las piezas superiores indicadas.
3. Anatomía dental individual y ausencia de dientes repetidos o plásticos.
4. Integración cervical e incisal, sin efecto de carilla sobrepuesta.
5. Curva de sonrisa, proporciones y alineación.
6. Naturalidad del tono VITA, translucidez, textura y variación óptica.
7. Utilidad para mostrar al paciente.

Además se marca como fallo crítico cualquiera de estos eventos:

- cambia cara, labios, encía, apertura, fondo o exposición;
- edita la arcada inferior cuando no fue solicitada;
- omite una pieza o agrega/elimina dientes;
- dibuja guías, puntos, texto o manchas fuera de los dientes;
- devuelve una imagen desalineada o con otra proporción.

## Métricas de operación

- tasa de resultados utilizables sin regeneración;
- tasa de fallos críticos;
- mediana y percentil 95 de `elapsedMs`;
- tasa de timeout/error por proveedor;
- costo estimado por intento;
- costo por resultado aprobado, que es la métrica económica principal.

## Criterio de migración

GPT Image 2 solo puede pasar a un piloto limitado si:

- mejora de forma consistente la rúbrica clínica;
- no aumenta los fallos críticos;
- su tasa de resultados utilizables compensa su costo y latencia;
- funciona dentro del timeout de la Edge Function en el percentil 95;
- la decisión se sostiene en el lote completo, no en ejemplos elegidos.

El piloto debe comenzar con una fracción pequeña de usuarios profesionales y
mantener Gemini disponible como rollback manual. No se habilitará selección de
proveedor en la interfaz del paciente.

## Documentación oficial

- https://developers.openai.com/api/docs/models/gpt-image-2
- https://developers.openai.com/api/docs/guides/image-generation

GPT Image 2 usa el endpoint `/v1/images/edits`, admite múltiples entradas
`image[]` y procesa sus entradas con alta fidelidad automáticamente; por eso
la implementación no envía `input_fidelity`.
