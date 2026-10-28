# SMYL — Radiografía asistida: Etapas 0–6 (baseline, esquema v2, contratos, control de calidad, localización, revisión por pieza, informe firmado e historia longitudinal)

**Fecha:** 2026-10-28 · **Autor:** Claude Code · **Plan:** `docs/CLAUDE_RADIOGRAPH_AI_IMPLEMENTATION_PLAN.md`
**Estado:** código y pruebas listos; **nada aplicado ni desplegado**. Con las banderas apagadas el
comportamiento publicado es idéntico al actual (sólo existen tablas/funciones nuevas sin uso).

## Alcance de esta entrega

| Incluido | Excluido (etapas posteriores) |
| --- | --- |
| 5 banderas cerradas por defecto + piloto por clínica (`20261028100000`) | Validación clínica (Etapa 7) y CBCT/DICOM (Etapa 8) |
| Registro de motores sin credenciales, un motor activo por tipo | Proveedor real de QC (hoy sólo `simulated` y un adaptador HTTP genérico sin proveedor elegido) |
| Fuentes inmutables, correcciones, vínculos, auditoría de acceso (`20261028110000`) | UI de revisión por pieza, odontograma asistido, informe en pantalla (Etapas 3-5) |
| Ejecuciones IA idempotentes, candidatos inmutables, decisiones versionadas (`20261028120000`) | Comparador longitudinal (Etapa 6), validación clínica (7), CBCT/DICOM (8) |
| Informes: borrador, firma con hash, adendas, exportación (`20261028130000`) | Cualquier cambio en `segment-teeth`, flujo v1 o `mobile/**` |
| Contratos v2 JS/TS + validadores SQL + 86 vectores canónicos | |
| Edge Function `radiograph-qc` + `_shared/radiograph-image.ts`, `radiograph-provider.ts`, `radiograph-qc-core.ts` (Etapa 2) | Motor dental real (`DentalXrayProvider` http genérico; ningún proveedor elegido) |
| Edge Function `radiograph-analyze` + `DentalXrayProvider` simulado + `smyl-radiograph-review-model-v2.js` (Etapa 3) | Comparador longitudinal (Etapa 6): el botón «Comparar con anterior» existe deshabilitado con motivo |
| Mesa de revisión por pieza `smyl-radiograph-review-v2.js/.css` + botón en el expediente (Etapa 4) | |
| Informe clínico asistido `smyl-radiograph-report.js/.css`: borrador sólo con confirmadas, redacción asistida con guarda, diferencias, firma, adendas, exportación (Etapa 5) | Mediciones de nivel óseo / distancias (bloqueadas hasta validar técnica y calibración) |
| Historia longitudinal: migración `20261028140000` (fuentes comparables con veredicto, vínculo profesional, cronología 360) + `smyl-radiograph-longitudinal.js/.css` (Etapa 6) | |
| Pruebas estáticas (24), PGlite en Postgres real (13), Etapa 2 (14), Etapa 3 (9), Etapa 4 (7 + navegador en 1280/820/390/320), Etapa 5 (6 + navegador en 1280/390), Etapa 6 (5 + navegador en 1280/390) | |

## Etapa 2 — `radiograph-qc` (control de calidad)

```text
Navegador ──POST {sourceId} + JWT──► radiograph-qc
  1. requireUser (sesión, miembro activo)
  2. asUser.rpc smyl_radiograph_request_ai_run(source,'qc')   ← la base decide: tenant, clinical.write,
     alcance del paciente, bandera qc_v2, motor activo, idempotencia (devuelve la ejecución viva)
  3. [service_role] lee smyl_radiograph_sources y descarga Storage por storage_path (nunca una URL del cliente)
  4. verifica tamaño, sha256, MIME por firma binaria, dimensiones (64–12000) y orientación EXIF
  5. provider.analyze(fuente verificada, AbortSignal)          ← timeout 5–120 s (RADIOGRAPH_QC_TIMEOUT_MS)
  6. parseRadiographQc + modelo == motor registrado            ← falla cerrado
  7. [service_role] smyl_radiograph_complete_ai_run(completed | failed | unconfirmed)
```

- **Proveedor:** `RADIOGRAPH_QC_PROVIDER=simulated` (determinista: clase por relación de aspecto,
  `orientation_suspect` por EXIF, `compression_artifacts` por bytes/píxel; pistas de prueba sólo
  vía chunk PNG `tEXt smyl.sim`) o `http` (URL https en hosts permitidos, `redirect:'error'`,
  tope de respuesta 256 KB, credencial sólo en secretos). Sin variable → 503 y no se registra nada.
- **Timeout incierto** → ejecución `unconfirmed/timeout`, respuesta 504; una nueva solicitud se
  bloquea (409) hasta reconocimiento explícito. **Nunca** reintenta sola.
- **Archivo falso / hash distinto / tamaño distinto / dimensiones fuera de rango** → ejecución
  `failed/source_invalid` (422) sin llamar al motor. **Respuesta incompleta** → `failed/invalid_output`
  (502) sin guardar salida parcial. **Duplicado** → reutiliza la ejecución completada sin coste.
- Logs: sólo ids, códigos y conteos (probado: nunca bytes, base64, explicaciones ni rutas).
- Despliegue: `supabase functions deploy radiograph-qc` o pegar `docs/bundles/radiograph-qc.single-file.ts`
  en el panel. Secretos necesarios: `RADIOGRAPH_QC_PROVIDER` (y, para `http`, `RADIOGRAPH_QC_URL`,
  `RADIOGRAPH_QC_API_KEY`, `RADIOGRAPH_QC_PROVIDER_NAME`, `RADIOGRAPH_QC_MODEL_NAME`,
  `RADIOGRAPH_QC_MODEL_VERSION`, `RADIOGRAPH_PROVIDER_HOSTS`). El motor también debe existir y estar
  `enabled` en `smyl_radiograph_engines` con el mismo proveedor/nombre/versión, si no el RPC rechaza.
- **No desplegada.** Con la bandera `radiograph.qc_v2` apagada la función responde 403 aunque se despliegue.

## Etapa 3 — `radiograph-analyze`, odontograma asistido

```text
Navegador ──POST {sourceId, kind: tooth_localization | finding_candidates}──► radiograph-analyze
  mismo orden que QC: requireUser → RPC como usuario (bandera tooth_ai_v1, permiso, alcance,
  motor activo y **QC completado con el análisis en applicableAnalyses**) → service_role → verificación
  del archivo → DentalXrayProvider.localizeTeeth / analyzeCandidates → contrato (sourceId y modelo
  deben coincidir) → smyl_radiograph_complete_ai_run → candidatos inmutables + decisiones `pending`.
```

- **Proveedor dental simulado** (`RADIOGRAPH_DENTAL_PROVIDER=simulated`): polígonos normalizados
  deterministas por clase de estudio (32 piezas en panorámica, 8 en bitewing, 3 en periapical),
  probabilidad FDI 0.92 / 0.8 anteriores (con alternativa vecina), terceros molares `partial`.
  Una pieza que "no ve" simplemente no se emite: **nunca afirma ausencia**. No inventa señales
  clínicas: sólo emite las que piden pistas de prueba (`finding:<categoría>@<fdi>`).
- **Decisión profesional ampliada:** la corrección admite `visibility` (`complete|partial|not_evaluable`)
  además de `fdi`, `label`, `geometry` (SQL/JS/TS alineados). Renumerar = `corrected{fdi}`;
  no evaluable = `corrected{visibility:'not_evaluable'}`; dividir/unir **no está soportado** y el
  modelo lo rechaza explícitamente. Cada decisión conserva autor, fecha, revisión, candidato y
  motor (vía `run.engine`).
- **Odontograma canónico:** igual que v1 (`radiographNotes` en `smyl-dental-record.js`), la
  evidencia se deriva **en tiempo de lectura** con `SmylRadiographReviewModelV2.odontogramEvidence`
  sólo de decisiones `confirmed|corrected`; `not_evaluable` no entra; `apparently_missing` produce
  el texto "no implica ausencia: confirmar clínicamente" y `neverAutoAbsent:true`. Nada escribe
  `doc.teeth` ni cambia su `status`. `toothMap` entrega por candidato FDI efectivo, banda de
  confianza (alta ≥0.85 / media ≥0.6 / baja), estado, visibilidad y conflictos (dos candidatos
  vivos en la misma pieza).
- Despliegue: `supabase functions deploy radiograph-analyze` o `docs/bundles/radiograph-analyze.single-file.ts`;
  secretos `RADIOGRAPH_DENTAL_PROVIDER` (+ `RADIOGRAPH_DENTAL_URL/API_KEY/PROVIDER_NAME/MODEL_NAME/MODEL_VERSION`
  para `http`), motor `tooth_localization` y `finding_candidates` registrados y `enabled`, bandera
  `radiograph.tooth_ai_v1`. **No desplegada.** `smyl-radiograph-review-model-v2.js` aún no se carga
  en ninguna página ni en `sw.js`/`mobile/www` (Etapa 4).

## Etapa 4 — Mesa de revisión por pieza (`smyl-radiograph-review-v2.js`)

- **Acceso:** botón «Revisión por pieza (v2)» en el visor de radiografías del expediente
  (`smyl-dental-record.js`), oculto hasta que `smyl_radiograph_ai_capabilities()` devuelva
  `radiograph.qc_v2=true` y lectura clínica. No asume que sólo la dueña revisa: cada acción la
  autoriza la base (`clinical.write`, alcance del paciente, revisión esperada). El flujo v1
  («Revisar con apoyo de IA») sigue intacto.
- **Pasos en pantalla:** 1) registrar fuente con consentimiento explícito + `radiograph-qc`;
  2) tarjeta de calidad (tipo sugerido con probabilidad, banderas con severidad, análisis
  bloqueados, corrección profesional del tipo) y botones «Localizar piezas» / «Buscar señales»
  (deshabilitados si QC los bloquea o la bandera `tooth_ai_v1` está apagada); 3) una tarjeta por
  candidato con **Base visual sugerida**, **Confianza del modelo** (banda + % + motor/versión),
  **Limitaciones** (del candidato y de la calidad) y **Valoración profesional** (pieza FDI,
  visibilidad, nota). Acciones: **Confirmar**, **Guardar corrección** (sólo con cambios; pasa por
  `parseDecisionPayload`), **Descartar**, **Editar contorno** (vértices arrastrables sobre SVG
  normalizado) / **Deshacer contorno**, y **Comparar con anterior** deshabilitado con motivo
  hasta la Etapa 6.
- **Recortes** derivados al vuelo del original en `<canvas>` (no se guardan). **Overlay** SVG en
  coordenadas normalizadas sobre la imagen; seleccionar, editar y deshacer sólo reemplazan el
  overlay (la imagen no se recarga ni salta el scroll). El visor (zoom al centro, paneo, pellizco,
  teclado) es el mismo `viewportNavigation` de v1, ahora exportado.
- **Nunca color como único indicador:** símbolo + texto en tarjetas (`○ Por confirmar`,
  `✓ Confirmada`, `✎ Corregida`, `✕ Descartada`), etiqueta `símbolo + número` en el overlay y
  patrón de trazo por estado (discontinuo / continuo / punteado); leyenda textual.
- **Accesibilidad:** lista `role=listbox` con `aria-current`/`aria-selected`, navegación
  ↑/↓/Inicio/Fin, estado `aria-live`, recorte con `role=img`, objetivos ≥ 42 px (44 px en móvil).
- **Robustez:** borradores (nota, renumeración, contorno) viven en memoria hasta decidir; cerrar con
  borrador pide confirmación; sin conexión el borrador se conserva y se explica; `PT409` recarga y
  explica; un timeout del motor queda `unconfirmed` y no se reintenta solo.
- **Aceptación de la etapa:** ninguna señal pendiente entra al odontograma ni al informe (modelo
  v2 + RPC de firma); la corrección no borra el candidato (probado: `fdiCandidate` original
  intacto, decisión `corrected{fdi}` revisión 2); cada acción es auditable
  (`smyl_radiograph_decision_versions`, `smyl_radiograph_access_events`) y recuperable
  (reconsiderar crea otra revisión; probado descartar → confirmar = revisión 3).
- **Evidencia visual:** `node tests/smyl-radiograph-review-v2-browser.cjs` genera
  `artifacts/radiograph-review-v2-v47/{desktop,tablet,mobile,mobile-320}.png` con datos sintéticos
  (no se versionan). Publicación: `smyl-radiograph-review.js?v=5`, `smyl-dental-record.js?v=17`,
  nuevos `smyl-radiograph-contracts.js?v=1`, `smyl-radiograph-review-model-v2.js?v=1`,
  `smyl-radiograph-review-v2.js?v=1`, `.css?v=1`; caché PWA `radiograph-review-v2-v47`;
  `mobile/www` sincronizado y `mobile/scripts/sync-web.js` ampliado.

## Etapa 5 — Informe clínico asistido y firma (`smyl-radiograph-report.js`)

- **Acceso:** botón «Informe radiográfico (N confirmados)» en la cabecera de la mesa v2, sólo con
  la bandera `radiograph.report_v1`. Abre un diálogo propio sobre la mesa.
- **Borrador sólo con decisiones confirmadas/corregidas** (`buildDraft`): piezas evaluables y
  señales; `apparently_missing` se redacta como "aparentemente no visible; no implica ausencia".
  Limitaciones técnicas se prellenan desde el QC (tipo, calidad, banderas, análisis no aplicados).
  Al reabrir se conservan texto y prioridad del profesional por candidato y se retiran, con aviso,
  los hallazgos que dejaron de estar confirmados.
- **Cinco secciones separadas** (descripción radiográfica, limitaciones técnicas, correlación
  clínica por realizar, preguntas/datos faltantes, estudios complementarios considerados por el
  profesional) y prioridades por hallazgo (rutina / pronto / urgente) configurables por el dentista.
- **Redacción asistida** («Ordenar y redactar con apoyo de IA»): usa el proxy `claude` existente
  con **texto estructurado, nunca la imagen**; el modelo sólo puede devolver un orden de los
  hallazgos (permutación exacta) y redactar cuatro secciones (nunca estudios complementarios).
  `parseAssist` descarta la respuesta completa si añade o quita hallazgos, menciona piezas sin
  hallazgo o usa afirmaciones de certeza/diagnóstico (`hasForbiddenClaim`), y explica por qué.
- **Previsualización de diferencias** (`diff`): piezas mencionadas en el texto sin hallazgo
  confirmado (aviso para el profesional, bloqueo para la IA), afirmaciones de certeza (sólo IA) y
  descripción vacía (la firma la exige). Se actualiza en vivo (`aria-live`).
- **Firma:** confirmación explícita; requiere `clinicalApprove`; el servidor valida de nuevo que
  todos los hallazgos sigan confirmados/corregidos, guarda usuario, profesional, fecha, versión,
  hash SHA-256 y snapshot de decisiones; después el documento es de sólo lectura y únicamente se
  agregan **adendas** (contenido + motivo). **Exportación** JSON (auditada como `export`) y **vista
  para imprimir** con hallazgos, secciones, firma, trazabilidad del motor, adendas y aviso de
  no-diagnóstico.
- **Aceptación de la etapa (probada):** ningún candidato pendiente o descartado aparece
  (modelo + navegador + PGlite); la firma es inmutable (trigger + UI de sólo lectura); la adenda
  conserva la versión anterior (`smyl_radiograph_report_versions`); la exportación muestra autoría
  y limitaciones.
- Publicación: `smyl-radiograph-report.js?v=1`, `.css?v=1`, `smyl-radiograph-review-v2.js?v=2`;
  caché PWA `radiograph-report-v48`; `mobile/www` y `sync-web.js` sincronizados.

## Etapa 6 — Historia longitudinal (`20261028140000` + `smyl-radiograph-longitudinal.js`)

- **Emparejamiento explícito, nunca silencioso.** `smyl_radiograph_comparable_sources(source)` lista las
  demás fuentes del mismo paciente con veredicto `comparable` / `incompatible` y motivo
  (`different_study_type` por tipo efectivo —última corrección profesional—, `missing_qc`,
  `unusable_quality`), más el vínculo profesional vigente. Requiere `clinical.read`, alcance del
  paciente y la bandera `radiograph.longitudinal_v1`. La misma regla vive en el navegador
  (`compatibility`) para que la UI explique lo mismo que el servidor.
- **Vínculo profesional** `smyl_radiograph_link_studies(a,b,kind,reason)`: `comparable` o
  `incompatible`, idempotente; cambiar de opinión revoca el anterior y conserva el historial
  (índice único parcial `where revoked_at is null`); audita `compare`.
- **Comparador** desde «Comparar con anterior» en la mesa v2 (habilitado sólo si hay un estudio
  comparable; si no, el título explica por qué). Selector con cada estudio y su motivo; los
  incompatibles no se abren. Dos visores (el anterior se descarga por su ruta conocida) con zoom
  compartido, desplazamiento sincronizado, alternancia anterior/actual y contornos confirmados.
- **Tres categorías separadas** (`pairByTooth`): diferencias de adquisición (QC: clase, calidad,
  banderas), cambios propuestos por la IA (dependen de candidatos pendientes), cambios confirmados
  por el profesional (ambos lados decididos y distintos), además de "sin cambio confirmado" y
  "sin decisión en uno de los estudios". **Sin mediciones** de nivel óseo ni distancias
  (`measurements:null` + aviso visible) hasta validar técnica, calibración y repetibilidad.
- **Ficha 360:** `smyl_patient_timeline` se re-crea con dos eventos resumidos —`radiograph_source`
  (tipo efectivo, id de estudio) y `radiograph_report` (estado, revisión)— sin documento, rutas,
  hashes ni consentimiento; mismas puertas por permiso y alcance. `smyl-patient-360.js?v=15` los
  etiqueta y los abre en la sección canónica de Tratamiento.
- **Corrección heredada:** al re-crear `smyl_patient_timeline` se añaden alias a la primera rama del
  `union` (`event_at`, `event_type`, …). Sin ellos, Postgres responde «column timeline.event_at does
  not exist»; el texto original de `20261027130000` no los tiene (ver pendientes).
- **Aceptación (probada):** estudios incompatibles no se comparan y el usuario ve por qué (PGlite +
  navegador); la cronología no expone texto clínico y rechaza roles sin alcance (PGlite).

## Flujo de datos (Etapa 1)

```text
Estudio v1 (smyl_dental_records.document.studies[])      ← ya existe; archivo privado en smyl-radiographs
   │ smyl_radiograph_register_source(ids)  [clinical.write + alcance + bandera qc_v2]
   ▼
smyl_radiograph_sources (inmutable: ruta copiada del expediente, sha256, MIME, consentimiento)
   │ smyl_radiograph_request_ai_run(source, kind) [bandera + motor activo + QC previo aplicable]
   ▼
smyl_radiograph_ai_runs (requested) ── idempotency_key = sha256(hash|proveedor|modelo|versión|contrato)
   │ smyl_radiograph_complete_ai_run(...)  [SÓLO service_role; valida contrato; inmutable después]
   ▼
smyl_radiograph_candidates (salida del modelo, inmutable) ──► smyl_radiograph_decisions (pending)
   │ smyl_radiograph_decide_candidate(rev, confirmed|corrected|rejected) [clinical.write, PT409]
   ▼
smyl_radiograph_reports (draft → signed con hash + snapshot de decisiones; después sólo adendas)
   [sign: clinical.approve + ficha de profesional; bloquea las decisiones; luego no se reconsideran sin adenda]
   │ smyl_radiograph_export_report  [clinical.read; sólo firmados; audita 'export']
   ▼
smyl_radiograph_access_events (register/open/send_to_engine/engine_result/correct/decide/report_draft/sign_report/addendum/export)
```

Cuatro clases de datos separadas, como pide el plan: **fuente** (`sources`), **salida del modelo**
(`ai_runs.output`, `candidates`), **decisión profesional** (`decisions`, `source_corrections`) y
**documento clínico** (`reports`, `addenda`). La salida del modelo nunca sobrescribe una decisión.

## Amenazas consideradas y control

| Amenaza | Control |
| --- | --- |
| Cliente envía una URL/ruta arbitraria para que el servidor la descargue | El RPC sólo acepta ids; ruta, hash, MIME y tamaño se copian del expediente guardado. CHECK rechaza esquemas `xx://`, `..`, rutas absolutas. |
| Lectura cruzada entre clínicas / miembro desactivado / rol sin alcance | RLS `clinical.read` + `smyl_can_access_patient(...,'clinical')` en todas las tablas; RPCs pasan por `smyl_radiograph_guard`. Probado en PGlite con dueña de otra clínica, miembro inactivo, odontólogo fuera del equipo tratante y recepción. |
| Navegador encendiendo banderas o leyendo motores/credenciales | Tablas de banderas y motores sin grants ni políticas; CHECK rechaza llaves de secretos en `config`; `smyl_radiograph_ai_capabilities()` devuelve sólo booleanos. |
| Navegador cerrando una ejecución con una salida inventada | `smyl_radiograph_complete_ai_run` revocada para `authenticated`; sólo service_role. |
| Salida del modelo alterada después del hecho | Trigger: `requested → terminal` una sola vez; luego UPDATE/DELETE → 42501. Candidatos y versiones inmutables. |
| Doble cobro / duplicado por reintento | Índice único parcial por `(fuente, tipo, idempotency_key)` entre ejecuciones vivas; repetir devuelve la misma fila. |
| Reintento automático tras timeout incierto | `unconfirmed` bloquea una nueva solicitud salvo `p_acknowledge_unconfirmed=true` explícito. |
| Análisis sobre imagen no utilizable | `request_ai_run` exige QC completado con `status<>'unusable'` y el análisis en `applicableAnalyses`. |
| Candidato sin evidencia / texto diagnóstico | Contrato exige ≥1 región geométrica y rechaza `diagnós*`, `confirmad*`, `certeza`, `definitiv*`… en etiqueta/explicación. |
| Informe firmado con hallazgos pendientes o descartados | `sign_report` cuenta hallazgos cuya decisión no sea `confirmed|corrected` → 23514. |
| Edición silenciosa de un informe firmado | Trigger bloquea cualquier UPDATE/DELETE de un informe firmado (incluso service_role); sólo adendas. Hash sha256 del documento. |
| Conflicto de edición concurrente | Revisión esperada en decisiones e informes → `PT409`; advisory locks por fuente/candidato/informe. |
| Decisión cambiada después de firmar (o en carrera con la firma) | `sign_report` toma `for update` las decisiones referenciadas y guarda `signed_decisions`; `decide_candidate` rechaza (23514) un candidato incluido en un informe firmado → adenda. |
| Oráculo de existencia de ids entre clínicas | Las búsquedas iniciales filtran por `smyl_current_tenant()`; un uuid ajeno y uno inexistente responden igual. Ids propuestos por el cliente que ya existan → "Identificador no disponible". |
| `TRUNCATE` con llave de servicio (no dispara triggers de fila) | `revoke truncate … from service_role` en todas las tablas nuevas. |
| Exportación sin rastro | `export_report` registra `export` (el cliente sólo puede registrar `open`) y nunca expone `storage_path`. |
| Divergencia navegador/servidor/SQL en textos | Recorte Unicode (`smyl_radiograph_trim` ≡ `String.prototype.trim`) y longitud por code points en los tres; vectores con saltos de línea, NBSP/BOM y emojis. |

## Despliegue (cuando se autorice) y rollback

1. Aplicar en orden `20261028100000` → `110000` → `120000` → `130000` → `140000` con el workflow manual
   `.github/workflows/smyl-radiografia-ia-etapa-1-migracion.yml` (`workflow_dispatch`; corre las
   pruebas de contrato, comprueba prerrequisitos, aplica sólo lo que falta, verifica banderas en
   `false`, ACL cerrada y RLS, y registra las versiones). Son idempotentes.
2. Verificar: 5 filas en `smyl_radiograph_feature_flags` con `enabled=false`; cero filas en
   `smyl_radiograph_engines`; `smyl_radiograph_ai_capabilities()` devuelve todas las banderas en
   `false` para cualquier usuario.
3. Edge Function `radiograph-qc`: desplegar sólo después de las migraciones y con `RADIOGRAPH_QC_PROVIDER=simulated`
   para el piloto; registrar el motor `simulated / smyl-sim-xray / 0.1.0` (kind `qc`, contrato 1) y encender
   `radiograph.qc_v2` para la clínica piloto en `smyl_radiograph_flag_tenants`. Sin frontend todavía.
4. **Rollback:** las migraciones son aditivas. Para revertir basta con no encender banderas; si se
   desea retirar el esquema, eliminar en orden inverso las tablas `smyl_radiograph_report_addenda`,
   `…_report_versions`, `…_reports`, `…_decision_versions`, `…_decisions`, `…_candidates`,
   `…_ai_runs`, `…_access_events`, `…_study_links`, `…_source_corrections`, `…_sources`,
   `…_flag_tenants`, `…_engines`, `…_feature_flags` y las funciones `smyl_radiograph_*`. El flujo v1
   (`smyl_radiograph_reviews`) no depende de nada de esto.

## Cómo probar

```bash
node --test tests/radiograph-contracts-v2.test.mjs tests/radiograph-migrations-stage1.test.mjs tests/radiograph-qc-stage2.test.mjs tests/radiograph-analyze-stage3.test.mjs tests/radiograph-review-v2-stage4.test.mjs tests/radiograph-report-stage5.test.mjs tests/radiograph-longitudinal-stage6.test.mjs
```

```bash
node tests/smyl-radiograph-longitudinal-browser.cjs
```

```bash
node tests/smyl-radiograph-review-v2-browser.cjs
```

```bash
node tests/smyl-radiograph-report-browser.cjs
```

```bash
npm install --no-save --no-package-lock @electric-sql/pglite
```

```bash
node --test tests/radiograph-pglite-stage1.test.mjs
```

La suite PGlite aplica `tests/fixtures/radiograph-contracts/pglite-base.sql` (réplica de los helpers
de autorización desplegados) y las cuatro migraciones dos veces (idempotencia). Si la librería no
está disponible la suite se omite sin fallar.

## Pendientes explícitos

- **Inventario de producción (Etapa 0.3):** desde esta sesión el MCP de Supabase no tiene permiso
  sobre `rpxshsiwoxdbuevjjpfw`; confirmar manualmente qué migraciones están aplicadas (la última
  registrada en HANDOFF es `20261027130000`) y las versiones de las Edge Functions antes de aplicar.
- **Retención y eliminación:** decisión tomada en esta entrega: la evidencia sigue el ciclo de
  vida del expediente — borrar al paciente o a la clínica arrastra fuentes, ejecuciones, candidatos,
  decisiones e informes (cascada permitida por `pg_trigger_depth() > 1`); cualquier `UPDATE`/`DELETE`
  directo sigue bloqueado. Falta la política de retención temporal de originales/derivados/logs y
  del archivo en Storage antes de producción (plan §8).
- **Firma:** requiere `clinical.approve` **y** ficha activa en `smyl_professionals`; una dueña o
  administradora sin ficha de profesional no puede firmar (23514).
- **Límite de frecuencia de `open`:** `smyl_radiograph_log_access` no deduplica; un usuario con
  `clinical.read` podría inflar `smyl_radiograph_access_events`. Evaluar dedupe por ventana en Etapa 4.
- **`smyl_patient_timeline` desplegada (`20261027130000`):** verificar en producción si la función
  responde o falla con «column timeline.event_at does not exist»; PGlite reproduce el fallo con el
  texto original. La migración `20261028140000` la re-crea corregida; si se aplica, el problema desaparece.
- **Bucket:** las fuentes v2 fijan `bucket='smyl-radiographs'` (el del flujo v1). La Etapa 2 debe
  leer el archivo desde Storage por esa ruta y validar hash/MIME/dimensiones reales.
- **`width/height`** de la fuente siguen `null`: QC los verifica en servidor pero la fuente es inmutable;
  si se quieren persistir, irán en una tabla derivada en Etapa 3.
- **Proveedor dental real:** `DentalXrayProvider` http es genérico; el motor especializado (plan §7) no está elegido ni validado. Sin él, el piloto sólo ve el simulado (geometrías sintéticas, no anatomía).
- **Proveedor real de QC:** no se ha elegido ninguno (plan §7: licencia, residencia de datos, evidencia de
  validación). El adaptador HTTP es genérico y debe ajustarse al contrato del proveedor elegido.
- **Doble ejecución concurrente:** dos peticiones simultáneas sobre la misma fuente comparten la ejecución
  `requested`; ambas llaman al motor y la segunda que cierra es rechazada como inmutable si difiere. Coste
  duplicado posible sólo en esa carrera; se mitigará con un estado `running` en Etapa 3 si el proveedor cobra.
- **Permiso de firma:** se reutiliza `clinical.approve` (el mismo que firma notas clínicas);
  recepción/asistente no lo tienen por defecto. Si se quiere un permiso específico de firma
  radiográfica hay que ampliar el CHECK de `smyl_role_permissions` en una migración nueva.
- **UI:** la mesa v2 muestra candidatos del proveedor **simulado** mientras no haya motor real; la
  pantalla lo etiqueta como candidato del modelo con su nombre/versión, pero el piloto no debe
  presentarse como localización anatómica real hasta la Etapa 7.
- **Redacción asistida y consumo:** pasa por el proxy `claude` y su control de cupo/plan; si la
  clínica no tiene `ANTHROPIC_API_KEY` o cupo, el botón devuelve el error del servicio y el borrador
  no cambia. La guarda es determinista pero no sustituye la lectura del profesional del texto final.
