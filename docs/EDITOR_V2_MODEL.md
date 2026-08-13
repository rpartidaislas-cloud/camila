# SMYL Editor paramétrico v2 — contrato de la etapa 1

## Propósito

Esta etapa valida la edición geométrica local de seis carillas superiores antes
de conectar guías clínicas, segmentación o generación con IA. La fotografía es
una capa inmutable y las carillas son objetos vectoriales independientes.

## Alcance de la primera entrega

- Piezas FDI: `13`, `12`, `11`, `21`, `22`, `23`.
- Selección individual por fotografía, lista o teclado.
- Traslación, escala horizontal, escala vertical y rotación por pieza.
- Guardado y restauración local mediante JSON versionado.
- Restablecimiento individual y completo.
- Importación opcional de una fotografía local; no se sube a ningún servidor.
- Persistencia de la fotografía fuera del estado JSON para evitar guardar datos
  clínicos dentro del navegador sin una decisión posterior de privacidad.

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
  "version": 1,
  "updatedAt": "ISO-8601",
  "selectedId": "11",
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

## Criterios de aceptación

1. Las seis piezas se pueden seleccionar de forma inequívoca.
2. Mover una pieza no desplaza ninguna otra.
3. Ancho, altura y rotación cambian sólo la pieza seleccionada.
4. Guardar, recargar y restaurar produce el mismo JSON y la misma geometría.
5. Restablecer una pieza no altera las demás.
6. El prototipo funciona con mouse, lápiz y toque.
