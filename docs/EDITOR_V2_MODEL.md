# SMYL Editor paramétrico v2 — contrato de las etapas 1–4

## Propósito

Este laboratorio valida la edición geométrica local de seis carillas superiores
antes de conectar segmentación o generación con IA. La fotografía es una capa
inmutable, las carillas son objetos vectoriales independientes y las guías
clínicas son parámetros serializables del diseño.

## Alcance acumulado

- Piezas FDI: `13`, `12`, `11`, `21`, `22`, `23`.
- Selección individual por fotografía, lista o teclado.
- Traslación, escala horizontal, escala vertical y rotación por pieza.
- Guardado y restauración local mediante JSON versionado.
- Restablecimiento individual y completo.
- Importación opcional de una fotografía local; no se sube a ningún servidor.
- Persistencia de la fotografía fuera del estado JSON para evitar guardar datos
  clínicos dentro del navegador sin una decisión posterior de privacidad.
- Curvas incisal y gingival paramétricas que recalculan las seis alturas sin
  desplazar la fotografía.
- Siete límites verticales de proporción derivados de los contornos visibles.
- Aplicación explícita de proporción RED simétrica para centrales, laterales y
  caninos, conservando el contacto y la línea media.
- Familias morfológicas `rectangular-soft`, `oval` y `triangular`, con anatomía
  propia para central, lateral y canino. Se aplican por pieza o simétricamente
  a las seis piezas.
- Material por pieza con referencia VITA abreviada, valor, croma, translucidez
  incisal y textura. Su render es una previsualización local orientativa.

## Fuera de alcance

- No llama a OpenAI, Gemini, Claude, Replicate ni Supabase.
- No segmenta dientes.
- No modifica `simulacion.html`, el editor vigente ni la aplicación móvil.
- No genera resultados clínicos ni sustituye el criterio del dentista.
- Puede publicarse como laboratorio aislado, pero no se conecta al flujo
  principal durante esta etapa.

## Estado serializable

```json
{
  "schema": "smyl.veneer-design",
  "version": 5,
  "updatedAt": "ISO-8601",
  "selectedId": "11",
  "options": {
    "symmetry": false,
    "papillae": false
  },
  "guides": {
    "incisalCenter": 93.5,
    "incisalArc": 4.5,
    "gingivalCenter": 63.2,
    "gingivalArc": 2.2,
    "red": 70
  },
  "teeth": [
    {
      "id": "11",
      "role": "central",
      "side": "right",
      "x": 46.4,
      "y": 48.0,
      "width": 13.2,
      "height": 24.0,
      "rotation": 0,
      "shape": "rectangular-soft",
      "visible": true,
      "material": {
        "vita": "A1",
        "value": 0,
        "chroma": 0,
        "translucency": 35,
        "texture": "natural"
      },
      "gingivalAnchor": { "x": 0.5, "y": 0 },
      "incisalAnchor": { "x": 0.5, "y": 1 }
    }
  ]
}
```

Las coordenadas y dimensiones se expresan como porcentajes normalizados del
ancho y alto reales de la fotografía. El lienzo adopta la relación de aspecto
del archivo abierto. Esto permite reabrir diseños sin depender de píxeles, del
tamaño de pantalla o de que la fotografía sea horizontal o vertical.

## Reglas geométricas iniciales

- El margen gingival no se deforma durante la edición de altura: la corona se
  extiende o reduce hacia el borde incisal.
- Cada pieza conserva su identidad; no se clonan seis dientes iguales.
- Centrales: relación ancho/alto inicial cercana a 78%.
- Laterales: menor ancho y altura que los centrales.
- Caninos: transición lateral con contorno y borde incisal propios.
- Los límites de escala evitan valores degenerados, pero no pretenden validar
  por sí solos un tratamiento.
- La curva incisal define el destino inferior de cada corona y la gingival su
  origen superior; la altura se calcula entre ambos destinos.
- La regla RED es configurable entre 62% y 80%. Al aplicarla, el ancho visible
  del lateral es `central × RED` y el del canino `lateral × RED`.
- Las siete líneas verdes representan los dos extremos del conjunto y los cinco
  contactos interdentales; no son siete dientes ni diagnósticos automáticos.
- Los diseños de versión 1 se migran a versión 2 agregando las guías por defecto.
- Los diseños de versiones 1–2 se migran a versión 3 y la anatomía heredada
  `natural-soft` se conserva visualmente como `rectangular-soft`.
- Cambiar la familia no altera por sí mismo posición, ancho nominal, altura,
  rotación ni tono. Las proporciones RED miden el contorno real de la familia
  elegida antes de recalcular anchos y contactos.
- Los diseños versiones 1–3 migran a versión 4 agregando material A1 natural.
- El material se puede modificar por pieza o copiar a 13–23. No cambia ninguna
  coordenada ni deforma la fotografía; sólo altera el render vectorial local.
- Los diseños versiones 1–4 migran a versión 5 agregando visibilidad por pieza
  y las opciones profesionales `symmetry` y `papillae` desactivadas por defecto.
- La simetría es una decisión explícita: replica forma, geometría, material y
  visibilidad en la pieza contralateral, reflejando posición y rotación.
- Ocultar una pieza nunca la elimina del JSON. La capa de papilas es únicamente
  una referencia visual y no modifica los objetos dentales.
- El historial conserva hasta 60 estados íntegros del diseño y permite
  deshacer/rehacer sin afectar la fotografía abierta en memoria.

## Criterios de aceptación

1. Las seis piezas se pueden seleccionar de forma inequívoca.
2. Mover una pieza no desplaza ninguna otra.
3. Ancho, altura y rotación cambian sólo la pieza seleccionada.
4. Guardar, recargar y restaurar produce el mismo JSON y la misma geometría.
5. Restablecer una pieza no altera las demás.
6. El prototipo funciona con mouse, lápiz y toque.
7. Mover cualquiera de las curvas recalcula las seis coronas en tiempo real.
8. Aplicar RED conserva simetría respecto de la línea media y muestra siete
   límites proporcionales.
9. Guardar y recuperar conserva también las curvas y el valor RED.
10. Cambiar la forma de una pieza no cambia la anatomía de sus vecinas.
11. Aplicar una familia completa conserva tres anatomías diferenciadas según el
    rol: centrales, laterales y caninos nunca se convierten en seis clones.
12. Guardar y recuperar conserva las familias morfológicas seleccionadas.
13. Color y textura de una pieza no afectan a sus vecinas hasta usar la acción
    explícita de aplicar material a 13–23.
14. Guardar y recuperar conserva VITA, valor, croma, translucidez y textura.
15. Con simetría activa, cualquier cambio local se refleja exclusivamente en
    la pieza contralateral correspondiente; con simetría inactiva sigue siendo
    independiente.
16. Ocultar/mostrar conserva la pieza serializada y deshacer/rehacer recupera
    visibilidad, anatomía, geometría, material, guías y opciones.
17. La capa de papilas puede activarse y ocultarse sin cambiar los seis dientes.
18. La comparación usa la misma fotografía original para ambos paneles y
    conserva exactamente sus dimensiones y relación de aspecto.
19. El PNG de resultado excluye guías, puntos, etiquetas y contornos de
    selección; contiene sólo la fotografía y las carillas visibles.
20. La comparativa exportable coloca original y diseño lado a lado sin recortar
    ni deformar ninguno de los dos paneles.

## Salida visual de la etapa 6

- `Resultado PNG`: composición a resolución original, con las carillas visibles
  y sin elementos de la interfaz.
- `Comparativa PNG`: dos paneles del mismo tamaño, etiquetados **Antes** y
  **Diseño SMYL**.
- La exportación se construye en memoria. No sube fotografías, no modifica el
  JSON y no altera el historial del diseño.
- Esta composición sigue siendo paramétrica y orientativa; aún no está
  conectada con segmentación automática ni simulación generativa.

## Expediente local de la etapa 7

El expediente usa un contrato separado del diseño dental:

```json
{
  "schema": "smyl.case-package",
  "version": 1,
  "folio": "SMYL-20260813",
  "patient": "Identificador local",
  "status": "draft | review | approved",
  "notes": "Observaciones del caso",
  "files": [{ "name": "scan.stl", "type": "model/stl", "size": 1234 }],
  "design": { "schema": "smyl.veneer-design", "version": 5 }
}
```

- Guarda y recupera localmente los datos del caso junto con una copia completa
  del diseño actual.
- Los archivos sólo se registran como metadatos; su contenido no se incrusta en
  `localStorage` ni en el JSON exportado.
- El paquete se puede exportar/importar para auditoría o transferencia manual.
- Esta etapa no es todavía un expediente clínico regulado, no implementa
  cifrado, consentimiento, control de acceso ni almacenamiento remoto.

## Entrega del caso de la etapa 8

- Genera una presentación HTML autocontenida con fotografía original,
  composición propuesta, folio, paciente, estado y resumen del diseño.
- La presentación incluye una acción de impresión compatible con **Guardar como
  PDF** del navegador y un diseño responsive para teléfono y escritorio.
- Las notas están excluidas por defecto. Sólo se incorporan cuando el profesional
  activa explícitamente la opción correspondiente.
- Antes de previsualizar, descargar o imprimir se exige confirmar que los datos
  visibles fueron revisados.
- El documento incluye una advertencia permanente de que la simulación es
  orientativa y no sustituye diagnóstico, planificación ni consentimiento.
- Las imágenes quedan incrustadas dentro del HTML; por ello el archivo debe
  compartirse mediante un canal autorizado por la clínica.
