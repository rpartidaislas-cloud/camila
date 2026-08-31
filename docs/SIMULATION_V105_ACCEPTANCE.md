# Contrato de aceptación — simulación v105

## Objetivo

Una propuesta que ya fue generada y permanece dentro de la máscara segura debe
llegar al comparador. Los controles automáticos de apariencia orientan la
revisión clínica, pero no vuelven a ocultar ni descartar una imagen pagada.

## Barreras duras

La presentación se bloquea únicamente cuando existe evidencia determinista de
alguno de estos casos:

1. el backend no confirma el contrato v105 o GPT Image 2;
2. cambió al menos un píxel fuera de la máscara protegida;
3. no se identificaron las seis piezas anteriores;
4. la máscara no cubre las coronas fuente o sus destinos;
5. la máscara salió de las seis envolventes coronales.

## Revisión, no descarte

Líneas rojizas, bordes oscuros, superficie plana, separación aparente,
textura, tono, magnitud del cambio, simetría y posibles marcas cromáticas se
registran como hallazgos. La propuesta se muestra con estado **Resultado
recomendado para revisión**.

## Revalidación sin costo

Una propuesta conservada por v104 debe poder pasar por el contrato v105 sin
otra llamada a GPT. La revalidación reutiliza el mismo archivo generado y sólo
repite composición y controles locales.

## Verificación

- scripts inline válidos;
- regresión v105;
- pruebas de máscara;
- sintaxis del backend;
- web y móvil idénticos;
- revisión responsive sin generación de IA.

