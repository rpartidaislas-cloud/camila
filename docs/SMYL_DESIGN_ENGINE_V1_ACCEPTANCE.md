# SMYL Design Engine v1.4 — contrato de aceptación

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

Una salida `design-v1.4` sólo es válida cuando:

1. El plano contiene exactamente 13–12–11–21–22–23.
2. Cada pieza genera una corona paramétrica completa y continua.
3. La anatomía procede de `trazarSiluetaPlanoDental`; las máscaras segmentadas
   de origen no se usan para recortar el material final.
4. El suavizado del perímetro crece hacia dentro y no abre píxeles sobre encía,
   labios, piel, arcada inferior ni premolares.
5. La imagen de salida inicia como una copia de la foto original. Sólo los
   píxeles cubiertos por una de las seis coronas reciben material cerámico.
6. Cada pieza se rasteriza exactamente una vez. No existe una capa de
   neutralización, relleno cromático o máscara fuente superpuesta.
7. Los píxeles candidatos a esmalte se reducen a hitos estadísticos suaves
   —centro, ancho, cervical e incisal— y nunca se dibujan directamente.
8. El flujo principal no consulta cupos, no incrementa usos, no llama a
   `segment-teeth` y retorna antes de preparar `editMaskBase64` o llamar al
   proveedor de generación de imágenes.
9. El resultado se etiqueta como orientativo y exige revisión clínica de
   anatomía, margen gingival y tono.

## Biblioteca y controles implementados

- Familias: `rectangular-soft`, `oval` y `triangular`.
- Roles anatómicos distintos: centrales, laterales y caninos; la cúspide
  canina es redondeada y ligeramente mesial, nunca un vértice geométrico.
- Tamaño global conservador, anclado al margen cervical detectado.
- Alturas individuales 13–23, limitadas a un rango seguro y dirigidas hacia
  incisal.
- Tonos VITA, tono actual, intensidad y acabado cerámico.
- Estratificación óptica en una sola capa: dentina cervical cálida, cuerpo de
  esmalte, mamelones internos, opalescencia, halo incisal, microtextura,
  periquimatos, surcos de desarrollo y reflexión especular.
- Iluminación, luminancia y dirección de reflejo muestreadas de cada pieza.
  La luminancia global se limita a ±2.5 % para que la sombra intraoral aporte
  relieve sin volver gris una corona completa.
- Mezcla controlada del sustrato y opacidad decreciente hacia incisal.
- Re-render desde la foto original para evitar acumulación de capas.
- Localizador `local-landmarks-v4`: usa percentiles de luminancia/croma para
  corregir seis cajas suaves sin convertir el resultado cromático en máscara.
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
Debe mostrar `locator: local-landmarks-v4`, seis coronas en cada una de las tres
familias, `continuousCrowns: true`, `singleLayer: true`, las siete capas
ópticas declaradas y `outsideTreatment: original-pixel-source`.

## Próximo gate

Ejecutar una sola prueba controlada con foto frontal nítida y autorizada. Antes
de publicarla se revisarán: encaje cervical, eje y proporción de cada pieza,
corredores bucales, naturalidad del material, tono y conservación exacta de
tejidos. Cualquier fallo se corrige en geometría/render; no se compensa con una
cadena de generaciones pagadas.
