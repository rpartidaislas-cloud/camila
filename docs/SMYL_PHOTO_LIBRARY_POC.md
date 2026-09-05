# SMYL — prototipo de biblioteca fotográfica 2D

## Alcance

`biblioteca-carillas.html` es un laboratorio local para evaluar una familia
fotográfica Natural A1 antes de sustituir el generador público. Reutiliza tres
coronas maestras —central, lateral y canino— para componer las seis piezas
13–12–11–21–22–23.

El usuario puede cargar una fotografía, mover la arcada completa, ajustar
ancho, altura, curva, separación, integración y temperatura, comparar contra
el original y descargar un PNG. La fotografía cargada no sale del navegador.

La ruta principal del simulador usa ahora el contrato `hybrid-2d-v3`. Después
de detectar seis dientes, construye automáticamente una segunda imagen PNG
transparente con las coronas de esta biblioteca colocadas en las envolventes
13–12–11–21–22–23. GPT Image recibe la fotografía como IMAGE 1, esta guía
fotográfica como IMAGE 2 y una máscara alfa aplicada a IMAGE 1. El compositor
local conserva después todos los píxeles exteriores a la región autorizada.

La privacidad del laboratorio y la del render automático son distintas: la
foto elegida en `biblioteca-carillas.html` permanece local; cuando el usuario
solicita una simulación automática desde `simulacion.html`, se envía al backend
el recorte dental necesario para la inferencia, como ya hacía el motor público.

## Activos

- `assets/dental-library/natural-a1-v1/central-r1.png`
- `assets/dental-library/natural-a1-v1/lateral-r1.png`
- `assets/dental-library/natural-a1-v1/canine-r1.png`

Los activos finales conservan fondo uniforme `#05070A`. El compositor elimina
ese fondo en memoria, obtiene alfa suave y recorta la corona antes de colocarla.
La extracción integrada evita depender de editores externos y permite revisar
los activos originales sin pérdida.

## Prompt de material usado

Se utilizó la herramienta ImageGen integrada. Especificación común:

```text
Use case: photorealistic-natural
Asset type: reusable 2D dental veneer library sprite for a clinical smile-design web app
Primary request: create one isolated maxillary [central incisor / lateral incisor / canine] veneer crown, viewed perfectly straight-on from the facial/labial side, without root, gingiva or neighboring teeth.
Style/medium: ultra-photorealistic dental product photography, layered feldspathic porcelain, translucent enamel rather than opaque white plastic.
Lighting: neutral calibrated softbox from upper-left, restrained specular highlight, cervical warmth, internal dentin body, subtle incisal translucency and opalescent halo, fine vertical microtexture and subtle perikymata.
Composition: one complete crown centered on a square canvas, frontal orthographic-like view, no rotation or perspective distortion.
Constraints: preserve the complete anatomical silhouette; no root, gum, lips, face, labels, watermark or border; avoid denture, cartoon, flat SVG, chalk and plastic appearance.
```

Prescripción anatómica por pieza:

```text
Central: width-to-height around 78%, softly rounded line angles, slight natural asymmetry and gently curved incisal edge.
Lateral: about 72% of central width, slightly shorter, rounded distoincisal angle and delicate incisal curve.
Canine: narrower than central, stronger cervical body, facial ridge, low rounded mesial-offset cusp and softened distal slope.
```

Paso final para los archivos utilizados:

```text
Replace only the surrounding background with one perfectly uniform solid near-black studio background, RGB 5,7,10 (#05070A). Preserve the tooth exactly—full silhouette, scale, anatomy, color, texture, translucency and highlights. No checkerboard, vignette, texture, gradient, reflection, shadow, crop, text or watermark.
```

## Límites conocidos

- Es una demostración de material y colocación, no una simulación clínica.
- La colocación inicial funciona con el rostro guía incluido; otras fotografías
  requieren ajuste manual.
- Todavía no elimina automáticamente el esmalte original que sobresalga de la
  nueva silueta ni detecta márgenes cervicales.
- La familia contiene una sola morfología por tipo y un solo tono base.

## Siguiente gate

Desplegar conjuntamente el frontend y la Edge Function y evaluar
`hybrid-2d-v3` con fotografías de prueba autorizadas. La salida debe conservar
seis dientes independientes, usar la biblioteca como referencia sin mostrar
bordes de sprite y mantener idénticos los píxeles exteriores a la máscara.
Después se añaden familias y tonos adicionales.
