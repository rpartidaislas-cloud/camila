# SMYL hybrid-2d-v1 — contrato de aceptación

## Objetivo

Generar una simulación fotográfica 2D de seis carillas anteriores superiores
sin dibujar dientes, esmalte, sombras ni estratificación con Canvas. La
geometría dental se usa exclusivamente como control invisible para la edición
de la fotografía.

## Entradas obligatorias

1. Recorte PNG de la fotografía original.
2. Máscara alfa PNG del mismo tamaño, transparente únicamente en la unión de
   las coronas fuente y destino 13–12–11–21–22–23.
3. Plano morfológico PNG del mismo tamaño con seis siluetas independientes.
4. Prescripción numérica redundante de centro, margen cervical, borde incisal,
   ancho y alto por pieza.
5. Tono VITA, acabado e intensidad elegidos.

La Edge Function debe rechazar el contrato antes de generar cuando falten GPT
Image 2, la máscara o el plano 2D. No existe fallback silencioso a Gemini ni al
compositor local.

## Salida válida

- El proveedor confirmado es GPT Image 2 y el contrato es `hybrid-2d-v1`.
- Se leen seis coronas diferenciadas, con centrales, laterales y caninos de
  anatomía propia; no una fila blanca uniforme.
- La cerámica conserva volumen fotográfico, iluminación, textura sutil,
  transición cervical y translucidez incisal.
- La encía, labios, dientes inferiores, premolares, piel y resto del rostro
  proceden píxel por píxel de la fotografía original.
- El plano 2D no aparece como fondo negro, relleno blanco, contorno, caja,
  punto, etiqueta ni marca técnica.
- El resultado queda marcado para revisión clínica; nunca se declara como
  predicción exacta del tratamiento.

## Rechazo obligatorio

- Falta una de las seis piezas o la segmentación no permite aislarlas.
- La máscara no cubre la corona original y su destino o sale de las seis
  envolventes protegidas.
- El backend no confirma GPT Image 2 y `hybrid-2d-v1`.
- Existe cualquier diferencia fuera de la máscara final.
- El resultado contiene elementos visibles del plano morfológico.

## Validación local

```powershell
node --test tests\inline-scripts.test.mjs tests\simulation-blueprint.test.mjs supabase\functions\segment-teeth\mask-utils.test.mjs
```

La prueba clínica final requiere una fotografía con autorización expresa y
una generación real. El QA sintético no demuestra realismo fotográfico.

