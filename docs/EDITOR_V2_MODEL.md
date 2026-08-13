# SMYL Editor paramétrico v2 — contrato de las etapas 1–2

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
  "version": 2,
  "updatedAt": "ISO-8601",
  "selectedId": "11",
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
      "shape": "natural-soft",
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
