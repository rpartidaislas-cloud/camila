# SMYL · Contrato de ortodoncia longitudinal v1

## Objetivo

Crear un seguimiento ortodóntico profesional dentro de **Ficha del paciente → Tratamiento → En tratamiento**. El módulo debe reunir el plan aprobado, los controles clínicos, la evidencia existente y la retención, sin duplicar archivos ni convertir una simulación estética en evidencia clínica.

Agenda queda fuera de este alcance. El módulo puede mostrar una cita ya vinculada a una nota y registrar un **intervalo recomendado**, pero no crea, confirma ni modifica citas.

## Entrega frontend inicial

La primera entrega se apoya en contratos seguros que SMYL ya tiene:

- el plan clínico revisado identifica que hay servicios con categoría `orthodontic`;
- cada control se guarda como borrador de `smyl_clinical_notes` con `note_type = 'progress'`;
- la decisión y firma siguen el proceso canónico de Ficha 360;
- una nota firmada permanece inmutable y una corrección posterior se agrega como adenda;
- Fotografías e Imágenes y estudios continúan siendo la única biblioteca de originales;
- el módulo sólo muestra referencias seguras preparadas en memoria por Ficha 360;
- no guarda estado clínico en `localStorage` ni crea otra fuente de verdad.

El documento estructurado de una nota utiliza:

```json
{
  "subjective": "Lo referido por el paciente",
  "objective": "Hallazgos observados",
  "assessment": "Conclusión profesional",
  "plan": "Siguiente objetivo e indicaciones",
  "orthodontics": {
    "schema": 1,
    "treatmentId": "capítulo activo, si existe",
    "controlType": "adjustment",
    "phase": "active",
    "appliance": {
      "type": "fixed | aligner | mixed | retention",
      "arches": "upper | lower | both",
      "currentAligner": 12,
      "totalAligners": 24,
      "upperWire": "",
      "lowerWire": "",
      "elastics": ""
    },
    "changes": [],
    "cooperation": "",
    "hygiene": "",
    "discomfort": "",
    "incidents": [],
    "evidenceStudyIds": [],
    "nextControl": {
      "recommendedWeeks": 4,
      "objectives": []
    },
    "patientInstructions": []
  }
}
```

El avance se expresa con hechos clínicos objetivos —por ejemplo, `alineador 12 de 24`— y nunca con un porcentaje genérico inventado.

## Límite explícito de la primera entrega

Sin una migración adicional, una nota, una fotografía o una radiografía no tienen una llave foránea autoritativa hacia un caso ortodóntico. El campo `treatmentId` dentro del JSON ayuda a presentar la información, pero no sustituye una relación validada por el servidor.

Por ello la interfaz inicial:

- no afirma que existe un “caso ortodóntico canónico”;
- no mezcla actividad clínica general con progreso ortodóntico;
- no elimina ni mueve archivos;
- no infiere movimientos dentales a partir de simulaciones;
- no ofrece visor STL/3D ni cefalometría estructurada, porque todavía no existen;
- conserva “Borrador” y “Firmado” como estados distintos y visibles.

## Contrato backend recomendado para Claude

### `smyl_orthodontic_cases`

Una fila por capítulo ortodóntico. Usar nombres no ambiguos: `treatment_chapter_id` y `orthodontic_case_id`; evitar `treatment_id` fuera de contexto porque ese nombre ya identifica items del plan en otras áreas.

Campos mínimos:

- `id uuid primary key`;
- `tenant_id uuid not null`;
- `patient_id uuid not null`;
- `treatment_chapter_id uuid not null unique references smyl_treatments(id)`;
- `revision integer not null`;
- `modality text`: `fixed`, `aligner`, `mixed`, `retention`;
- `arches text`: `upper`, `lower`, `both`;
- `phase text`: `records`, `planning`, `active`, `finishing`, `retention`, `closed`;
- `document jsonb not null`;
- `consent_id uuid null`;
- `started_on`, `expected_end_on`;
- actores y fechas de creación/actualización.

El estado abierto/cerrado del capítulo continúa siendo autoritativo en `smyl_treatments`. El caso agrega la fase ortodóntica; no duplica el ciclo de vida general.

Documento de plan v1:

```json
{
  "schema": 1,
  "problemList": [],
  "objectives": [],
  "baseline": {
    "dentition": "",
    "overjetMm": null,
    "overbitePercent": null,
    "crowdingUpperMm": null,
    "crowdingLowerMm": null,
    "midlineUpperMm": null,
    "midlineLowerMm": null,
    "molarRight": "",
    "molarLeft": "",
    "canineRight": "",
    "canineLeft": "",
    "notes": ""
  },
  "mechanics": {
    "applianceType": "",
    "arches": "",
    "extractions": [],
    "ipr": [],
    "anchorage": [],
    "auxiliaries": [],
    "estimatedMonths": null
  },
  "retention": {
    "upper": "",
    "lower": "",
    "duration": "",
    "instructions": []
  },
  "limitations": []
}
```

### `smyl_orthodontic_case_versions`

Historial append-only del documento completo por revisión:

- `tenant_id`, `orthodontic_case_id`, `revision`;
- snapshot JSON;
- actor y fecha;
- bloqueo optimista por `expected_revision`;
- ningún `update` o `delete` de versiones anteriores.

### `smyl_orthodontic_controls`

Índice del control estructurado; el contenido clínico sigue viviendo en la nota firmable:

- `id`, `tenant_id`, `patient_id`, `orthodontic_case_id`;
- `clinical_note_id unique references smyl_clinical_notes(id)`;
- `sequence` y `occurred_at`;
- `control_type`: `baseline`, `bonding`, `adjustment`, `aligner_delivery`, `aligner_change`, `refinement`, `emergency`, `deband`, `retention`.

La creación de nota e índice debe ser una sola transacción. Una nota firmada se protege con el contrato actual de firma, cédula, reautenticación, hash, versiones y adendas.

### Evidencia

Ampliar el enlace de contexto de evidencia, sin copiar binarios:

- contexto `orthodontic_case` validado contra `smyl_orthodontic_cases`;
- vínculo opcional adicional a `clinical_note` para el control;
- rol de la fuente: `baseline`, `progress`, `issue`, `final`, `retention`;
- comparación sólo entre vistas compatibles;
- el original privado, su hash, revisión y revocación continúan en el Centro de evidencia.

Una simulación de sonrisa sólo puede mostrarse en un bloque separado como **referencia visual no clínica**.

### RPC propuestas

- `smyl_get_orthodontic_case(p_patient_id)`;
- `smyl_create_orthodontic_case(p_treatment_chapter_id, p_document)`;
- `smyl_update_orthodontic_case(p_id, p_expected_revision, p_document)`;
- `smyl_transition_orthodontic_phase(p_id, p_expected_revision, p_phase)`;
- `smyl_create_orthodontic_control(...)`;
- `smyl_list_orthodontic_controls(p_orthodontic_case_id)`;
- `smyl_link_orthodontic_evidence(p_orthodontic_case_id, p_study_id, p_clinical_note_id, p_role)`.

Todas deben validar `tenant_id`, acceso al paciente y el capítulo. La escritura directa a las tablas debe permanecer cerrada.

## Permisos y auditoría

- `clinical.read`: consultar plan, controles y enlaces de evidencia;
- `clinical.write`: preparar plan y controles en borrador;
- `clinical.approve`: activar plan, cambiar fase y firmar;
- `smyl_can_access_patient` en toda lectura y mutación;
- auditoría de creación, actualización, transición, firma y enlace de evidencia;
- sin borrado de controles firmados ni versiones;
- el consentimiento debe enlazarse al caso antes de transitar a `active`.

## Riesgos a resolver antes de la persistencia canónica

1. `smyl_treatments` permite hoy un solo capítulo activo por paciente; un caso largo de ortodoncia puede convivir con restauraciones o periodoncia. El backend debe decidir si amplía esa regla o separa “episodio principal” de tratamientos concurrentes.
2. Las notas y citas actuales se atribuyen a capítulos por fechas, no por FK; el contrato nuevo debe exigir vínculo explícito.
3. Los conteos generales de Ficha 360 no representan progreso ortodóntico.
4. Los permisos del archivo de simulación no son iguales a los del Centro de evidencia.
5. El refresco del expediente corre con frecuencia; el módulo ortodóntico no debe consultar red en cada refresco. Debe cargar por evento, usar caché y refrescar después de una escritura confirmada.

## Criterios de aceptación

- mismo resultado en web y PWA a 1440, 834, 390 y 320 px;
- sin scroll horizontal ni dos barras fijas superpuestas;
- una sola acción principal por vista;
- crear un control nunca agenda ni envía mensajes;
- el guardado produce un borrador visible y la firma ocurre en el flujo protegido existente;
- editar una nota genérica conserva su bloque `orthodontics`;
- controles firmados se distinguen de borradores y no se editan;
- evidencia se abre desde la biblioteca canónica;
- ningún dato clínico se guarda en almacenamiento local;
- simulaciones permanecen identificadas como referencia no clínica.
