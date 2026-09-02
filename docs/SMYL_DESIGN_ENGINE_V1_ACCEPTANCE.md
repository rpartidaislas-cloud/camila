# SMYL Design Engine v1.2 — contrato de aceptación

Fecha: 2026-09-01  
Estado: prototipo funcional publicado en GitHub Pages; pendiente de prueba
controlada con fotografía autorizada.

## Objetivo

Sustituir la composición de una imagen generada a través de máscaras dentales
fragmentadas por un flujo de diseño reproducible: localizar seis dientes,
construir seis coronas completas desde una biblioteca paramétrica y renderizar
material cerámico dentro de esas siluetas.

Esta versión resuelve estructuralmente el defecto observado en producción:
parches blancos rectangulares y costuras horizontales sobre dientes, encía o
labio. No intenta todavía igualar el acabado final de un CAD dental 3D.

## Contrato duro

Una salida `design-v1.2` sólo es válida cuando:

1. El plano contiene exactamente 13–12–11–21–22–23.
2. Cada pieza genera una corona paramétrica completa y continua.
3. La anatomía procede de `trazarSiluetaPlanoDental`; las máscaras segmentadas
   de origen no se usan para recortar el material final.
4. El suavizado del perímetro crece hacia dentro y no abre píxeles sobre encía,
   labios, piel, arcada inferior ni premolares.
5. La imagen de salida inicia como una copia de la foto original. Sólo los
   píxeles cubiertos por una de las seis coronas reciben material cerámico.
6. El flujo principal no consulta cupos, no incrementa usos, no llama a
   `segment-teeth` y retorna antes de preparar `editMaskBase64` o llamar al
   proveedor de generación de imágenes.
7. El resultado se etiqueta como orientativo y exige revisión clínica de
   anatomía, margen gingival y tono.

## Biblioteca y controles implementados

- Familias: `rectangular-soft`, `oval` y `triangular`.
- Roles anatómicos distintos: centrales, laterales y caninos; la cúspide
  canina es redondeada y ligeramente mesial, nunca un vértice geométrico.
- Tamaño global conservador, anclado al margen cervical detectado.
- Alturas individuales 13–23, limitadas a un rango seguro y dirigidas hacia
  incisal.
- Tonos VITA, tono actual, intensidad y acabado cerámico.
- Iluminación, luminancia, dirección de reflejo y microtextura muestreadas de
  cada pieza original.
- Opacidad equilibrada con el sustrato fotográfico, sombras interproximales,
  calidez cervical y translucidez incisal variable. No se admite un relleno
  blanco plano ni una fila de coronas ópticamente idénticas.
- Re-render desde la foto original para evitar acumulación de capas.
- Localizador `local-band-v2`: detecta la banda de esmalte por
  luminancia/croma dentro del recorte y construye las seis cajas anteriores
  sin transmitir la fotografía fuera del navegador.

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
Debe mostrar `locator: local-band-v2`, seis coronas en cada una de las tres
familias, `continuousCrowns: true` y
`outsideTreatment: original-pixel-source` tanto en escritorio como a 390×844.

## Próximo gate

Ejecutar una sola prueba controlada con foto frontal nítida y autorizada. Antes
de publicarla se revisarán: encaje cervical, eje y proporción de cada pieza,
corredores bucales, naturalidad del material, tono y conservación exacta de
tejidos. Cualquier fallo se corrige en geometría/render; no se compensa con una
cadena de generaciones pagadas.
