# SMYL hybrid-2d-v2 — región continua y revisión clínica

## Objetivo

Generar seis carillas fotográficas completas en una edición 2D coherente. La
geometría individual 13–23 continúa siendo una referencia invisible, pero ya
no se usa para recortar el render diente por diente.

## Región de edición

- Una sola cinta suave rodea las seis coronas fuente y objetivo.
- La cinta cubre el 100 % de las seis siluetas y sus contactos.
- La zona puede incluir un margen mínimo de tejido como contexto, pero el
  prompt exige conservar encía, labios, dientes inferiores y premolares.
- Fuera de la cinta, el compositor restaura exactamente los píxeles de la
  fotografía original.
- El área de la región debe permanecer entre 0.15 % y 24 % del recorte.

## Rechazo obligatorio

El resultado no llega al comparador cuando ocurre cualquiera de estos casos:

- El backend no confirma `hybrid-2d-v2` y GPT Image 2.
- La región no es una única trayectoria conectada.
- Falta cobertura de las coronas fuente o de la geometría objetivo.
- Cambia cualquier píxel fuera de la región continua.

Estos fallos son deterministas y se evalúan sobre contrato, máscara y píxeles.
Una propuesta que no supera esta protección no llega al comparador.

## Revisión clínica sin bloqueo

Una generación pagada que ya superó la protección determinista se muestra en el
comparador. Las señales de líneas rojizas, sombras, placa aparente, contactos
cerrados, poca separación, textura uniforme, cambio conservador o parches
incompletos se registran como hallazgos visibles para revisión y regeneración
voluntaria. No vuelven a ocultar el resultado ni a provocar otro consumo por sí
solas.

## Validación local

```powershell
node --test tests/inline-scripts.test.mjs tests/simulation-blueprint.test.mjs supabase/functions/segment-teeth/mask-utils.test.mjs
node --experimental-strip-types --check supabase/functions/claude/index.ts
```

La vista `?debugUI=1&maskDemo=1` dibuja una entrada sintética sin fotografías
ni llamadas a servicios. Debe informar una región conectada, una trayectoria y
cobertura completa de fuente y objetivo.

## Límite clínico

El resultado sigue siendo una simulación orientativa 2D. No predice preparación
dental, espesor cerámico, oclusión ni el resultado clínico definitivo.
