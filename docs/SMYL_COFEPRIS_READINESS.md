# SMYL · Preparación sanitaria y regulatoria

**Estado:** herramienta de preparación. No es una certificación, autorización ni resolución de COFEPRIS.

## Tres responsabilidades separadas

1. **SMYL como plataforma:** seguridad, integridad del expediente, trazabilidad, conservación y, cuando corresponda, clasificación o registro del software clínico.
2. **La clínica como establecimiento:** avisos, responsable sanitario, profesionales, instalaciones, radiología, RPBI, publicidad y operación cotidiana.
3. **El profesional:** calidad de la nota, revisión de evidencia, consentimiento informado, firma y decisión clínica.

Una clínica no queda autorizada porque complete el indicador de SMYL. El centro conserva únicamente metadatos administrativos —folio, vigencia, referencia y notas— y nunca debe recibir información de pacientes.

## Expediente mínimo sugerido para cada clínica

| Área | Evidencia esperada | Cuándo puede no aplicar |
| --- | --- | --- |
| Establecimiento | Aviso de funcionamiento y, cuando corresponda, responsable sanitario | El responsable sanitario depende de la modalidad y servicios del establecimiento |
| Profesionales | Cédula profesional y documentos de especialidad anunciada | No aplica la exención: cada profesional activo debe acreditarse |
| Expediente | Registro diario, política de conservación y consentimientos por procedimiento | No aplica la exención |
| Privacidad | Aviso propio de la clínica, domicilio y medios ARCO | No aplica la exención |
| Radiología | Licencia/autorización y programa de protección radiológica | Sólo si la clínica no posee ni opera equipos de rayos X; debe documentarse el motivo |
| RPBI | Contrato, manifiestos o evidencia del manejo aplicable | Debe justificarse conforme a los residuos realmente generados |
| Publicidad | Aviso o permiso aplicable a campañas y medios usados | Debe justificarse cuando no exista publicidad sujeta a trámite |

## Reglas de uso dentro de SMYL

- No registrar nombres de pacientes, diagnósticos, imágenes ni notas clínicas.
- Un requisito **Verificado** requiere folio, referencia o ubicación controlada del comprobante.
- **No aplica** requiere una justificación y sólo está habilitado para requisitos condicionales.
- Una vigencia vencida cambia automáticamente el estado a **Vencido**.
- La confirmación conserva usuario y fecha en auditoría.
- Los archivos originales deben permanecer en un repositorio administrativo privado con acceso restringido.

## Controles que no puede confirmar la clínica por cuenta de SMYL

- Clasificación de la IA clínica como SIRES, apoyo clínico o Software como Dispositivo Médico.
- Registro sanitario o exención formal cuando corresponda.
- Sistema de calidad, gestión de riesgos y control de cambios del software regulado.
- Validación externa de seguridad, aislamiento entre tenants y recuperación.
- Matriz de trazabilidad de NOM-004, NOM-013 y NOM-024.
- Tecnovigilancia y etiquetado regulatorio cuando el software sea dispositivo médico.

Estos controles deben publicarse desde el proceso central de liberación de SMYL y no pueden marcarse como aprobados desde el panel de una clínica.

## Conservación del expediente

SMYL aplica una guardia técnica mínima de cinco años desde la actividad clínica más reciente. Mientras la retención o una conservación legal estén vigentes, el paciente puede archivarse o seudonimizarse, pero el registro no debe borrarse físicamente.

La guardia es un mínimo técnico. Una obligación contractual, sanitaria, judicial o local puede exigir un periodo mayor.

## Fuentes oficiales de referencia

- [NOM-004-SSA3-2012, expediente clínico](https://sidof.segob.gob.mx/notas/docFuente/5272787)
- [NOM-013-SSA2-2015, prevención y control de enfermedades bucales](https://dof.gob.mx/normasOficiales/6264/salud2a11_C/salud2a11_C.html)
- [NOM-024-SSA3-2012, sistemas de registro electrónico en salud](https://sidof.segob.gob.mx/notas/docFuente/5280847)
- [NOM-241-SSA1-2025, buenas prácticas de fabricación de dispositivos médicos](https://diariooficial.segob.gob.mx/normasOficiales/9497/salud/salud.html)
- [Guía COFEPRIS para el registro sanitario de dispositivos médicos](https://www.gob.mx/cofepris/documentos/guia-para-la-obtencion-del-registro-sanitario-de-dispositivos-medicos)
- [Aviso de funcionamiento de establecimientos de salud](https://www.gob.mx/public/tramites/detalleTramite.xhtml?homoclave=COFEPRIS-05-036)
- [Guía de autoverificación de consultorios](https://www.gob.mx/cofepris/documentos/guia-autoverificacion-establecimientos-de-atencion-medica-ambulatoria-o-consultorios-medicos-generales-y-de-especialidad)

## Revisión antes de producción

La clínica y SMYL deben obtener revisión profesional jurídica y sanitaria. Completar este expediente no cambia el estado del `SMYL_SECURITY_RELEASE_GATE.md`, no libera el uso con datos clínicos reales y no sustituye una inspección o resolución de autoridad.
