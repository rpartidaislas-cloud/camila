# SMYL Design Engine v1.5 — contrato de aceptación

Fecha: 2026-09-01  
Estado: reconstrucción fotográfica publicada; pendiente de prueba
controlada con fotografía autorizada.

## Objetivo

Localizar seis dientes y transferir material cerámico conservando el centro,
eje, perspectiva, volumen y contorno suavizado de cada pieza fotografiada. La
geometría ideal sólo corrige de forma conservadora; nunca recoloca la dentadura
en una retícula genérica.

Esta versión resuelve estructuralmente el defecto observado en producción:
parches blancos rectangulares y costuras horizontales sobre dientes, encía o
labio. No intenta todavía igualar el acabado final de un CAD dental 3D.

## Contrato duro

Una salida `design-v1.5` sólo es válida cuando:

1. El plano contiene exactamente 13–12–11–21–22–23.
2. Cada pieza genera una carilla completa y continua sobre su diente fuente.
3. `extraerContornoDentalLocalV5` resume la fotografía en nueve secciones y
   `trazarContornoDentalFotograficoV5` las convierte en una curva continua; los
   píxeles clasificados nunca se pintan ni aparecen como borde dentado.
4. El suavizado del perímetro crece hacia dentro y no abre píxeles sobre encía,
   labios, piel, arcada inferior ni premolares.
5. La imagen de salida inicia como una copia de la foto original. Sólo los
   píxeles cubiertos por una de las seis coronas reciben material cerámico.
6. Cada pieza se rasteriza exactamente una vez. No existe una capa de
   neutralización, relleno cromático o máscara fuente superpuesta.
7. Los centros se conservan dentro de una deriva máxima conservadora; los
   contactos y la perspectiva fuente tienen prioridad sobre proporciones
   matemáticas rígidas.
8. El flujo principal no consulta cupos, no incrementa usos, no llama a
   `segment-teeth` y retorna antes de preparar `editMaskBase64` o llamar al
   proveedor de generación de imágenes.
9. El resultado se etiqueta como orientativo y exige revisión clínica de
   anatomía, margen gingival y tono.

## Biblioteca y controles implementados

- Familias: `rectangular-soft`, `oval` y `triangular`.
- Roles anatómicos distintos: centrales, laterales y caninos; la cúspide
  canina es redondeada y ligeramente mesial, nunca un vértice geométrico.
- Tamaño global conservador, anclado al margen cervical, centro y eje detectados.
- Alturas individuales 13–23, limitadas a un rango seguro y dirigidas hacia
  incisal.
- Tonos VITA, tono actual, intensidad y acabado cerámico.
- Estratificación óptica en una sola capa: dentina cervical cálida, cuerpo de
  esmalte, mamelones internos, opalescencia, halo incisal, microtextura,
  periquimatos, surcos de desarrollo y reflexión especular.
- Iluminación, luminancia, croma residual, microcontraste y dirección de reflejo
  muestreados de cada pieza para conservar el volumen de la fotografía.
- Mezcla dominante del sustrato fotográfico y opacidad decreciente hacia
  incisal; la cerámica recolorea el diente en lugar de taparlo con blanco plano.
- Re-render desde la foto original para evitar acumulación de capas.
- Localizador `local-contours-v5`: usa hitos y nueve perfiles transversales para
  conservar la silueta individual sin convertir el resultado cromático en máscara.
  Todo ocurre en el navegador y la fotografía no se transmite.

## Fuera de alcance de v1

- Modelo 3D real, escaneo intraoral, oclusión y planificación de laboratorio.
- Rotación/traslación libre por pieza y edición manual del contorno cervical.
- Validación clínica automática o promesa de resultado terapéutico.
- Publicación del prototipo o uso de una fotografía real sin autorización.

## Verificación local

```powershell
node --test tests\inline-scripts.test.mjs tests\simulation-blueprint.test.mjs supabase\functions\segment-teeth\mask-utils.test.mjs
```

La demo `tests/design-engine-v1-demo.html` usa un retrato totalmente sintético.
Debe mostrar `locator: local-contours-v5`, seis carillas en cada una de las tres
familias, `continuousCrowns: true`, `singleLayer: true`, `photoAnchored: true`,
las siete capas ópticas declaradas y `outsideTreatment: original-pixel-source`.

## Próximo gate

Ejecutar una sola prueba controlada con foto frontal nítida y autorizada. Antes
de publicarla se revisarán: encaje cervical, eje y proporción de cada pieza,
corredores bucales, naturalidad del material, tono y conservación exacta de
tejidos. Cualquier fallo se corrige en geometría/render; no se compensa con una
cadena de generaciones pagadas.
