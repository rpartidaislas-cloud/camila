# Centro de evidencia clínica de SMYL — contrato v1

## Objetivo

SMYL organiza la evidencia del paciente por **modalidad** y por **objetivo clínico**, sin convertir la presencia o ausencia de un archivo en diagnóstico. El profesional decide qué evidencia es pertinente para cada caso.

La simulación estética permanece fuera de este centro. Puede consultarse desde su espacio propio, pero no se presenta como evidencia clínica ni alimenta automáticamente el odontograma.

## Las seis modalidades

| Modalidad | Contenido | Uso principal en SMYL | Estado v1 |
|---|---|---|---|
| Fotografías | Extraorales, intraorales, oclusales, localizadas y seguimiento | Aspecto visible, tejidos blandos y comparación fotográfica | Carga conectada al expediente |
| Rayos X 2D | Periapical, bitewing y panorámica; contrato para oclusal, FMX y cefalometría | Observación radiográfica y relación por pieza o región | JPG/PNG conectado; subtipos no soportados se bloquean antes de cargar |
| Escaneos y modelos | Arcadas, mordida, preparación, modelo de estudio y escaneo facial | Geometría, oclusión y planificación | Contrato listo; carga 3D deshabilitada hasta disponer de almacenamiento y visor especializados |
| Evaluaciones clínicas | Periodontograma, pruebas pulpares, movilidad, oclusión, ATM, tejidos blandos y riesgo de caries | Mediciones y respuestas obtenidas en consulta | Contrato listo; editor estructurado pendiente |
| Informes y documentos | Radiología, patología, laboratorio, interconsulta, consentimiento y valoración médica | Resultado emitido por terceros y soporte documental | Carga conectada al expediente |
| CBCT y 3D | CBCT/DICOM, CT y MRI | Navegación multiplanar y evaluación especializada | Sólo contrato/metadatos; carga e interpretación deshabilitadas |

## Rutas clínicas visibles

Estas rutas son listas de contexto, no órdenes de estudio ni protocolos automáticos:

| Objetivo | Fuentes que SMYL puede reunir |
|---|---|
| Caries y restauradora | Exploración/medición clínica, fotografía intraoral y radiografía seleccionada por el profesional |
| Endodoncia | Síntomas, pruebas pulpares, percusión/palpación, prueba de mordida, movilidad y evidencia periapical |
| Periodoncia | Periodontograma, fotografías intraorales y la imagen que el profesional considere pertinente |
| Ortodoncia | Fotografías, panorámica o cefalometría cuando corresponda, y escaneos/modelos |
| Implantes y cirugía | Plan protésico, modelo/escaneo e imagen 2D o 3D indicada por el profesional |
| Lesiones y patología | Descripción clínica, fotografía de evolución, región anatómica e informe especializado o histopatológico |

SMYL muestra qué fuentes ya existen y cuáles faltan. Nunca interpreta una fuente faltante como indicación para exponer al paciente a radiación.

## Capas de información

1. **Estudio:** modalidad, subtipo, fecha, región, indicación clínica y control de calidad.
2. **Original:** archivo inmutable o referencia al archivo canónico existente.
3. **Vínculos:** pieza FDI, superficie, arcada, cuadrante, región de tejidos blandos y contexto del expediente.
4. **Hallazgo:** observación profesional, candidato de IA o contenido importado.
5. **Decisión profesional:** confirmar, corregir o descartar. Una sugerencia de IA siempre nace pendiente.
6. **Informe:** borrador, versiones, firma profesional y adendas; la firma conserva una instantánea verificable del contenido revisado.
7. **Auditoría:** creación, apertura, vínculos, decisiones, firma y adendas sin copiar innecesariamente texto clínico sensible.

## Una sola fuente de verdad

- El centro nuevo **lee y abre** los archivos y radiografías canónicos del expediente existente.
- No crea un segundo odontograma ni duplica binarios.
- El resumen compacto puede seguir mostrando ocho archivos; el centro utiliza la historia completa.
- Los vínculos revocados o sustituidos se conservan en la historia, en vez de borrarse.

## Permisos

- `clinical.read`: consultar evidencia y abrir originales autorizados.
- `clinical.write`: cargar archivos, registrar mediciones y redactar observaciones.
- `clinical.approve`: decidir candidatos de IA, confirmar hallazgos y firmar informes.
- El alcance por paciente y las políticas del servidor son la autoridad; ocultar un botón no sustituye la autorización.

## Seguridad clínica de IA

- La IA puede producir únicamente candidatos pendientes con proveedor, modelo, ejecución y confianza identificables.
- El navegador no puede atribuirse una respuesta de IA ni fabricar la identidad del modelo.
- Ningún candidato modifica el odontograma, el diagnóstico, el plan o el informe firmado sin decisión profesional.
- El original, la sugerencia, la corrección y la decisión final se conservan por separado.
- Un informe sólo puede firmarse cuando el original requerido está disponible y el control de calidad no es `pending` ni `unusable`.

## Estado de activación

Las migraciones `20261108120000` y `20261108130000` quedaron aplicadas directamente al proyecto SMYL el 8 de noviembre de 2026.
El puente de permisos de equipo para Storage, expediente y RPC radiográficos forma parte de esa activación. Las diez tablas del
centro quedaron creadas sin importar ni reescribir evidencia heredada.

Antes de habilitar todas las acciones para usuarios finales:

1. Probar con sesiones reales propietario, odontólogo asignado/no asignado, sólo lectura, escritura sin aprobación, aprobación, miembro desactivado, otra clínica y anónimo.
2. Conectar una entrada de IA atestada en servidor antes de aceptar candidatos automáticos.
3. Implementar el adaptador o importación controlada de evidencia heredada para evitar dos fuentes de verdad.
4. Mantener escaneos 3D y CBCT/DICOM deshabilitados hasta contar con almacenamiento, validación, visor y motor especializados.

## Límites de v1

El centro v1 organiza y relaciona evidencia. No sustituye la historia clínica, la exploración, el juicio profesional, un informe radiológico ni un diagnóstico. Tampoco recomienda radiografías de rutina ni presenta una simulación estética como resultado clínico.
