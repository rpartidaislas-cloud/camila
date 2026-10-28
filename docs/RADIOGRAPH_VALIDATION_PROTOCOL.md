# SMYL — Protocolo de validación clínica de la revisión radiográfica asistida (Etapa 7)

**Estado:** borrador técnico para revisión profesional, regulatoria y de privacidad. No autoriza
uso diagnóstico. **Fecha:** 2026-10-28. **Infraestructura:** `20261028150000_smyl_radiograph_validation.sql`,
`smyl-radiograph-validation.js`.

## 1. Uso previsto (a confirmar por la clínica)

- **Qué hace:** propone, sobre radiografías dentales 2D (panorámica, periapical, aleta de mordida),
  la clase de estudio y su calidad, la localización de piezas con numeración FDI candidata y señales
  visuales candidatas, para que un odontólogo las **confirme, corrija o descarte**. Produce un informe
  firmado únicamente con decisiones profesionales.
- **Qué no hace:** no diagnostica, no mide nivel óseo ni distancias, no interpreta CBCT/DICOM, no
  decide tratamientos ni urgencias, no sustituye la lectura del profesional.
- **Usuarios:** odontólogos con permiso clínico de la clínica (`clinical.write`); firma y validación
  con `clinical.approve`. Recepción y asistentes: sólo lectura resumida.
- **Población:** pacientes de la clínica con radiografía 2D JPG/PNG de hasta 20 MB, ≥ 64 px por lado.
- **Exclusiones:** imágenes no utilizables según control de calidad, estudios que no sean dentales
  2D, dentición mixta cuando el motor no la cubra (definir con el proveedor), menores sin
  consentimiento del tutor, imágenes con datos identificables quemados.

## 2. Datos y separación entrenamiento / prueba

- SMYL no entrena modelos. Cada fuente de un conjunto de evaluación declara `training_exposure`
  (si el proveedor pudo haberla usado para entrenar). **Un informe de validación no puede
  registrarse si alguna fuente del conjunto está marcada con exposición** (regla del servidor).
- Conjuntos (`smyl_radiograph_eval_sets`): nombre, uso previsto, población, exclusiones, `split`
  `test` o `pilot`. Al registrar un informe, el conjunto queda bloqueado (`locked_at`).
- Tamaño mínimo recomendado antes de un veredicto: ≥ 30 estudios por tipo de estudio y por motor,
  con al menos 2 anotadores por estudio. Por debajo, el informe sólo documenta el piloto.

## 3. Referencia anotada por varios odontólogos

- Cada odontólogo anota por pieza (presente/ausente, geometría opcional) y por señal (categoría)
  **sin ver los candidatos del modelo** (recomendación operativa: anotar antes de ejecutar el motor
  o en una sesión separada).
- Consenso: mayoría simple; empate = desacuerdo sin resolver (se excluye de métricas y se cuenta en
  `referenceDisagreements`). Un profesional con `clinical.approve` puede **adjudicar** y su
  adjudicación prevalece. Las anotaciones son inmutables (historial completo).
- Cuando una fuente no tiene referencia, las métricas usan las decisiones del revisor
  (`truthSource = professional_decisions`) y lo declaran: hay sesgo de confirmación posible.

## 4. Métricas (por tarea, tipo de estudio efectivo y motor/versión)

| Tarea | TP / FP / FN | Sensibilidad | Especificidad | Precisión |
| --- | --- | --- | --- | --- |
| Localización de piezas | por pieza FDI (universo 32 permanentes) | sí | sí (TN = 32 − propuestas − FN) | sí |
| Señales candidatas | por (pieza, categoría) | sí | **no** (sin universo negativo fijo) | sí |

- **Calibración:** 5 franjas de confianza del modelo vs tasa de confirmación profesional.
- **Desacuerdo profesional:** (descartadas + corregidas) / decididas, por tarea y motor.
- **Operación:** ejecuciones, fallos por código, `unconfirmed` (timeouts), latencia media.
- Subgrupos: tipo de estudio (y dispositivo/sede cuando la clínica los registre; pendiente).

## 5. Prueba del equipo humano + IA

Antes de liberar clínicamente: comparar las decisiones del mismo profesional **con y sin**
asistencia sobre el mismo conjunto (orden aleatorio, lavado de al menos 2 semanas), midiendo
sensibilidad/precisión frente a la referencia, tiempo por estudio y tasa de aceptación acrítica
(candidatos confirmados que la referencia contradice). Esta prueba se documenta en las `notes` del
informe de validación; la plataforma todavía no automatiza el diseño cruzado (pendiente).

## 6. Criterios de salida (propuesta inicial; la clínica los fija)

Evaluados por el servidor sobre el **peor grupo** de cada tarea:

```json
[
  { "metric": "sensitivity", "task": "tooth_localization", "min": 0.95 },
  { "metric": "precision", "task": "tooth_localization", "min": 0.95 },
  { "metric": "specificity", "task": "tooth_localization", "min": 0.98 },
  { "metric": "sensitivity", "task": "finding_candidates", "min": 0.80 },
  { "metric": "precision", "task": "finding_candidates", "min": 0.60 },
  { "metric": "disagreementRate", "task": "finding_candidates", "max": 0.40 },
  { "metric": "unconfirmedRate", "task": "tooth_localization", "max": 0.02 }
]
```

El informe (`smyl_radiograph_record_validation_report`) guarda el snapshot de métricas, los
criterios, `criteria_met`, el veredicto (`approved_for_pilot` | `not_approved`), el motor y versión,
quién aprobó (usuario y profesional), fecha y hash. Es inmutable; una nueva evaluación crea otra versión.

## 7. Monitoreo, incidentes y desactivación

- `smyl_radiograph_monitoring`: series semanales por tarea y motor (volumen, fallos, timeouts,
  latencia, desacuerdo). Umbral sugerido de alerta: desacuerdo semanal > 1.5× el del informe aprobado
  o ≥ 3 incidentes abiertos de severidad alta.
- Incidentes (`smyl_radiograph_report_incident` / `close_incident`): cualquier profesional con
  `clinical.write` reporta; cierra quien aprueba.
- **Desactivación:** por clínica, `smyl_radiograph_set_tenant_flag(key,false)` (`clinic.manage`), sin
  despliegue; global, `smyl_radiograph_engines.enabled=false` o la bandera global (service_role).
- Cambio de motor o versión = nuevo informe de validación obligatorio (el informe registra `engines`).

## 8. Divulgación en la interfaz

`smyl_radiograph_model_disclosure()` entrega a la mesa de revisión el motor activo (proveedor,
nombre, versión, fecha, si es simulado), el último informe de validación de la clínica (versión,
veredicto, fecha) y los límites, que se muestran junto al control de calidad.

## 9. Regulatorio y privacidad (México) — pendiente de revisión legal

- Software que propone hallazgos sobre imágenes clínicas puede considerarse **dispositivo médico de
  software (SaMD)**; antes de usar afirmaciones diagnósticas, revisar con asesoría regulatoria la
  clasificación ante **COFEPRIS** y la aplicabilidad de normas de expediente clínico (NOM-004-SSA3-2012)
  y de protección de datos personales (LFPDPPP, datos sensibles de salud). Hasta entonces la UI debe
  seguir diciendo «revisión asistida» y «candidato», nunca «diagnóstico».
- Proveedor del motor: licencia de uso clínico, residencia y retención de datos, uso para
  entrenamiento, acuerdo de tratamiento de datos (plan §7) antes de enviar imágenes reales.
- Consentimiento informado específico para revisión asistida (ya registrado por fuente).

## 10. Pendientes de esta etapa

- Registrar dispositivo/sede de adquisición para subgrupos por equipo radiográfico.
- Automatizar el diseño con/sin asistencia (sección 5).
- Definir con la clínica los valores finales de los criterios de salida y el tamaño muestral.
- Elegir y evaluar un proveedor real; hasta entonces el único motor es simulado.
