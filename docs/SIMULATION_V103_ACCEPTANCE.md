# Contrato de aceptación — simulación v103

## Objetivo

Generar seis carillas anteriores superiores (13–12–11–21–22–23) sin
modificar encía, labios, piel, dientes inferiores, premolares ni ningún otro
píxel de la fotografía.

## Causa corregida

La v102 añadía una franja cervical rectangular por cada corona. Al tocarse las
seis franjas formaban un bloque horizontal editable que podía incluir encía y
labio. La captura de regresión mostró precisamente ese parche, además de
contornos rojizos y bordes dentados alrededor de las coronas.

## Contrato v103

1. La fotografía del paciente es la única referencia visual.
2. La máscara editable es únicamente la unión de las seis coronas fuente y
   sus seis siluetas destino; no contiene una franja gingival.
3. Cada píxel editable debe quedar dentro de una envolvente fuente/destino de
   una de las seis piezas. Una fuga mayor a 0.3 % bloquea el proceso antes de
   llamar al generador.
4. El borde se suaviza sólo hacia dentro de la máscara. El desenfoque nunca
   agrega píxeles editables sobre tejido.
5. La composición final parte siempre de la fotografía original. Fuera de la
   máscara debe existir igualdad exacta de píxel.
6. Se bloquean líneas rojizas, contornos técnicos oscuros, superficies planas,
   coronas fusionadas y cualquier resultado sin seis piezas independientes.
7. El backend exige GPT Image 2, imagen PNG y máscara alfa PNG antes de
   consumir cuota.

## Condición de producción

La v103 debe superar pruebas automáticas, revisión responsive y una generación
controlada autorizada. Implementar o probar localmente no autoriza desplegar el
backend ni publicar el frontend.
