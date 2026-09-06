# SMYL — Fases 2A–2B: laboratorio de segmentación dental

## Objetivo

Comprobar si un modelo SAM ligero puede convertir puntos guía sobre una
fotografía frontal en máscaras dentales útiles antes de integrarlo al editor de
seis carillas.

## Alcance inicial

- Página aislada: `segmentacion-dental-poc.html`.
- La fotografía se redimensiona y procesa dentro del navegador.
- No se envía a Supabase, Hugging Face ni otro servicio.
- El navegador descarga una vez el modelo cuantizado
  `Xenova/slimsam-77-uniform` y puede conservarlo en caché.
- Un punto positivo incluye una región; un punto negativo excluye encía,
  labios u otros dientes.
- La máscara binaria puede descargarse como PNG para revisión.
- Incluye una sonrisa geométrica sintética para pruebas técnicas sin usar una
  fotografía personal.

SlimSAM es la línea base porque existe una implementación oficial y probada con
Transformers.js. MobileSAM se evaluará como segundo candidato con el mismo
protocolo; no se integrará a producción sólo por ser más ligero.

## Protocolo de evaluación

Probar las mismas diez fotografías autorizadas, sin incorporarlas al
repositorio:

1. sonrisa frontal centrada;
2. sonrisa amplia;
3. exposición dental limitada;
4. dientes rotados o apiñados;
5. iluminación cálida;
6. iluminación fría;
7. sombra unilateral;
8. labial intenso;
9. reflejos especulares fuertes;
10. fondo y piel de tonos diversos.

Para cada foto registrar por diente: cantidad de puntos necesarios, confianza,
tiempo de máscara, invasión de encía/labio, inclusión de dientes vecinos y si
el borde cervical/proximal/incisal es aprovechable.

## Criterio para avanzar

- Al menos 9 de 10 fotografías deben permitir obtener los seis dientes.
- Ninguna máscara aprobada puede invadir labios o dientes inferiores.
- Al menos 90 % de las piezas deben requerir como máximo tres puntos guía.
- La segmentación debe ejecutarse sin subir la fotografía y sin credenciales.
- La revisión profesional debe aprobar el contorno antes de convertirlo a la
  geometría vectorial de SMYL.

Esta prueba evalúa segmentación visual, no diagnóstico ni aptitud clínica del
tratamiento.

## Fase 2B — separación de seis piezas

- El operador registra un centro por pieza en orden FDI `13-12-11-21-22-23`.
- Para calcular una pieza, su centro es el único punto positivo y los centros
  de las otras cinco piezas se convierten automáticamente en puntos negativos.
- Cada pieza conserva su máscara binaria independiente; la vista superpuesta
  usa seis colores únicamente para revisión.
- Se pueden añadir exclusiones manuales a la pieza seleccionada cuando invada
  encía, labio o un espacio vecino.
- El mapa PNG exportado conserva una etiqueta cromática distinta por pieza.
- Si la superposición acumulada entre máscaras supera 8%, el laboratorio
  bloquea la descarga y solicita afinamiento.
- El selector de candidato prioriza la máscara que contiene su propio centro y
  no contiene ninguno de los otros cinco; si esa condición falla, el resultado
  se marca como inválido y tampoco puede exportarse.
