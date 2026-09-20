# SMYL v102 — seis carillas con geometría numérica controlada

## Objetivo

La v102 elimina la contradicción que seguía presente en v101: el frontend
ordenaba seguir una `IMAGE 2`, mientras el backend de máscara alfa no enviaba
ninguna segunda imagen. GPT Image recibe ahora una sola referencia visual —el
recorte original de la sonrisa— y seis envolventes dentales expresadas como
coordenadas normalizadas.

## Contrato del render

1. La única imagen visual es el recorte PNG original del paciente.
2. La máscara alfa es obligatoria y fija el límite máximo de edición.
3. Sólo se tratan 13–12–11–21–22–23; premolares, dientes inferiores y piezas
   no enumeradas permanecen fuera del encargo.
4. Cada carilla recibe `centerX`, `cervicalY`, `incisalY`, `width` y `height`
   normalizados al recorte, además de su rol de central, lateral o canino.
5. El backend exige GPT Image 2 para `contractVersion: "v102"`. Una
   configuración distinta o una máscara ausente se rechazan antes de descontar
   cuota.
6. No se envía un plano rasterizado, una guía coloreada ni una segunda imagen.

## Preservación y aceptación

- La fotografía original es siempre la base de composición.
- Todo píxel fuera de la máscara final debe ser idéntico al original.
- La máscara final es la unión controlada de las seis coronas fuente, las seis
  siluetas destino y una tolerancia intraoral pequeña para contactos y bordes.
- Se bloquean cambios insuficientes, superficies planas, líneas técnicas,
  coronas fusionadas, falta de separación entre piezas y A1 excesivamente
  amarillo.
- Los controles se ejecutan localmente sobre el resultado compuesto; no se
  repite una segmentación del render ni se ejecuta una segunda generación
  automática.

## Salida a producción

La v102 permanece local hasta que:

1. pasan las pruebas de sintaxis, máscara, geometría y regresión visual;
2. web y móvil son idénticos;
3. se revisa escritorio, tablet y celular;
4. una prueba controlada produce un candidato visualmente presentable;
5. el usuario autoriza expresamente desplegar backend y publicar frontend.

