# Contrato de aceptación — simulación v104

## Objetivo

Evitar que una fotografía válida falle antes de generar y evitar que una
propuesta ya pagada se descarte por un control visual dudoso. La edición sigue
limitada a las seis coronas 13–12–11–21–22–23.

## Causas corregidas

1. v103 cruzaba la máscara de seis coronas con una segunda segmentación
   genérica de “tratamiento”. La variación entre ambas podía bloquear una foto
   válida antes de llamar a GPT Image.
2. El detector de líneas evaluaba también el límite cervical, donde es normal
   encontrar color gingival rojizo, y podía confundirlo con un borde técnico.
3. Un rechazo visual eliminaba la propuesta ya generada, obligando a pagar otra
   llamada para volver a verla.
4. Los fallos previos a la generación no conservaban etapa ni identificador y
   aparecían como un error local genérico.

## Contrato v104

1. Se ejecuta una sola segmentación: las seis coronas individuales.
2. La máscara editable es la unión de las coronas fuente y destino, recortada
   por una expansión controlada de las propias coronas fuente. No existe una
   máscara gingival secundaria.
3. El margen cervical de cada objetivo conserva la coordenada del diente
   original. La longitud sólo puede crecer hacia incisal y como máximo 12 %.
4. El detector ignora el tercio cervical para clasificar líneas rojizas. Un
   bloqueo exige continuidad y afectación bilateral; indicios débiles se
   reportan para revisión clínica.
5. La falta de separación, el cambio conservador, la textura o el tono son
   hallazgos de revisión y no eliminan una propuesta anatómicamente protegida.
6. Los bloqueos duros se reservan para contrato/proveedor incorrectos, cambios
   fuera de máscara, cobertura insegura o un artefacto técnico confirmado.
7. Toda propuesta recibida se conserva para revalidación local. El botón debe
   mostrar “Revalidar resultado” y no llamar otra vez al generador.
8. Cada error conserva identificador y etapa desde el inicio del proceso.
9. Fuera de las seis coronas, la composición final debe ser idéntica por píxel
   a la fotografía original.

## Condición de producción

La v104 debe superar scripts inline, regresión de contrato, pruebas de máscara,
sintaxis del backend y revisión responsive. Las pruebas locales no consumen una
generación y no autorizan por sí mismas el despliegue o la publicación.
