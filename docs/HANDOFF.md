# Bitácora compartida — SMYL

## 2026-10-31 — Claude — Radiografía con Claude Opus 5.5 y medición del consumo

- **Modelo fijado por el servidor.** Nueva acción `analyze_dental_radiograph_v1` en la Edge Function `claude`
  (módulo `_shared/radiograph-claude.ts`): modelo `claude-opus-5-5`, esfuerzo `medium` (Opus 5.5 lo trae por
  defecto; subir a `high` en `RADIOGRAPH_EFFORT` cuando la medición muestre que cabe en el tiempo), `max_tokens`
  12000, corte a 100 s y esquema JSON forzado (`output_config.format`), con `tooth`/`x`/`y` como `null` real.
  Solo sesión profesional (`user.id === tenant`). La respuesta al navegador lleva solo bloques de texto.
- **Cliente** (`smyl-radiograph-analysis-client.js` v6): usa la acción, ya no manda modelo ni `max_tokens`, y
  envía la imagen hasta 2576 px / 3.75 MP (antes 1568 px / 1.15 MP). La normalización del texto `"null"` del PR
  anterior se conserva como segunda red.
- **Revisión guardada**: `analysis.model` acepta `claude-sonnet-4-6` (revisiones anteriores) y `claude-opus-5-5`
  tanto en `smyl-radiograph-review-model.js` (v4) como en la base (migración `20261031130000`, que redefine
  `smyl_validate_radiograph_review` con una sola condición cambiada).
- **Medición**: tabla `smyl_ai_usage_log` (migración `20261031120000`) con tokens reales, tiempo, resultado y costo
  estimado por análisis; sin imágenes ni datos de pacientes. Solo escribe la Edge Function; la clínica lee el
  resumen con `smyl_ai_usage_summary()` (permiso `clinic.manage`). Tarjeta nueva «Análisis de radiografía» en
  Plan y consumo → MILA e IA (`consumos.html`, `smyl-consumption.js/css` v7).
- **Para activar (a mano):** 1) aplicar las dos migraciones en el SQL Editor, en ese orden; 2) volver a desplegar
  `claude` (pegar `docs/bundles/claude.single-file.ts` en el dashboard). Hasta aplicar la migración de modelo,
  guardar una revisión hecha con Opus fallaría en la base.
- Archivos: `supabase/functions/claude/index.ts`, `supabase/functions/_shared/radiograph-claude.ts`,
  `docs/bundles/claude.single-file.ts`, 2 migraciones, cliente/modelo/consumo + copias móviles,
  `app.html`/`sw.js` (caché `radiograph-opus-v58`), `tests/radiograph-opus-usage.test.mjs`.

## 2026-10-31 — Claude — Radiografía: «diente "null" no es un número FDI válido»

- Causa: el análisis de radiografías usa Claude (`claude-sonnet-4-6`, API de Anthropic, vía la
  Edge Function `claude`) sin esquema JSON forzado. El contrato del prompt decía
  `"tooth":"... o null JSON"` y el modelo respondía a veces el **texto** `"null"` en vez del
  `null` de JSON; la validación estricta lo rechazaba y la revisión quedaba «sin resultado».
- `smyl-radiograph-analysis-client.js` v5: `splitLocations` convierte el texto `null`/`none`/`n/a`
  o vacío en `null` antes de validar; cualquier otro diente inválido sigue rechazándose. El
  prompt aclara «el literal JSON null sin comillas (nunca el texto 'null')».
- Idea pendiente (no hecha, requiere desplegar la Edge Function): forzar un esquema JSON en el
  servidor como ya se hace con el análisis de fotos (`output_config` + `json_schema`).
- Archivos: cliente y copia móvil, `app.html`/`sw.js` (+ copias, caché `radiograph-null-v57`),
  `tests/radiograph-v1-locations.test.mjs`.

## 2026-10-31 — Claude — Adiós al «brinco» al entrar y a la expulsión del expediente

- Causa: cuando salía una versión nueva, `app.html` recargaba la página en cuanto el
  service worker tomaba el control. Pasaba unos segundos después de entrar (el «brinco») y,
  si estabas en un expediente, la recarga volvía al módulo Pacientes sin el expediente abierto.
  En la primera visita `clients.claim()` también disparaba esa recarga.
- Ahora: la primera visita no recarga; con una versión nueva y la pestaña visible aparece un
  aviso «Hay una versión nueva de SMYL» con **Actualizar** / **Después**; si la pestaña queda
  oculta, se actualiza sola sin que se note.
- Archivos: `app.html` y `mobile/www/app.html`, `sw.js` y `mobile/www/sw.js` (caché
  `quiet-update-v56`), `tests/pwa-quiet-update.test.mjs`. Sin cambios de datos ni de backend.

## 2026-10-31 — Claude Code — Radiografía v1: la IA propone la ubicación de cada señal

- El prompt del visor v1 (`smyl-radiograph-analysis-client.js`) ya no prohíbe coordenadas: pide `x`, `y` por
  observación (centro aproximado de la zona, normalizado 0–1 desde la esquina superior izquierda de la imagen
  recibida, `null` si no puede ubicarla con prudencia). Es solo una propuesta.
- **Sin migración:** la base valida con claves exactas el informe (`observations`), así que `splitLocations` separa
  `x`/`y` antes de `parseReport` y `completed()` los copia a `items[].x/y` (la base ya acepta pendientes con
  ubicación en 0..1). Valores inválidos se descartan. El informe guardado no cambia.
- UI: la señal pendiente con ubicación muestra su marcador amarillo y "Ubicación propuesta: compruébala…". El dentista
  sigue moviendo y confirmando cada señal; confirmar exige notas.
- **No verificado con el modelo real:** la precisión de las coordenadas de un LLM sobre una panorámica es limitada;
  hay que probar con una radiografía real. Solo aplica a análisis NUEVOS (los ya guardados no tienen ubicación).
- Cachés: `analysis-client.js?v=4`, `review-model.js?v=3`, `review.js?v=10`. Pruebas: 898/898.
- Recordatorio: GitHub Pages publica desde `claude/camila-claude-clinical-analysis-sywxjv`, no desde `main`.

## 2026-10-27 — Codex — Equipo y roles sin empalmes v47

- `Equipo, roles y profesionales` responde ahora al ancho real del módulo con
  container queries. La tarjeta `Por completar` sólo ocupa una columna lateral
  cuando existe espacio suficiente; en la composición habitual se apila sin
  cubrir los selectores de rol o sede.
- Cada integrante conserva una sola ficha, pero `Rol` y `Sede principal` viven
  dentro de un bloque de controles acotado. Los selectores tienen ancho máximo,
  la acción de activar/desactivar ocupa una columna propia y el diseño baja de
  cuatro a dos y una columnas según el espacio disponible.
- El encabezado mantiene juntas `Invitar integrante` y `Agregar doctor`, la
  pestaña compacta se llama `Equipo y roles` en pantalla y conserva su nombre
  accesible completo. El estado vacío de pendientes comunica `Todo al día` sin
  una tarjeta sobredimensionada ni texto repetitivo.
- Web, fuente móvil y PWA quedan sincronizadas con
  `smyl-clinic-admin.js?v=7`, `smyl-clinic-admin.css?v=8` y cache
  `team-layout-v47`. No se modificaron datos, permisos, RLS, migraciones ni
  funciones de backend.
- QA: **790/790** pruebas. La fixture específica se revisó a 1785, 1280, 820 y
  390 px: cero empalmes, cero overflow horizontal, todos los selectores dentro
  de su ficha y acciones de al menos 42 px.
## 2026-10-28 — Claude Code — Radiografía asistida: revisión adversarial final y correcciones

- Cuatro revisiones independientes (SQL, Edge, interfaz, flujo clínico) pidieron cambios; todo corregido en
  **código y pruebas**, **sin aplicar ni desplegar nada** (migraciones y Edge Functions siguen pendientes de
  autorización expresa). Detalle en `docs/RADIOGRAPH_AI_STAGE_0_1.md` → «Revisión adversarial final».
- Migraciones editadas (aún no aplicadas en ningún entorno): `20261028100000` (piloto vs pausa, ajustes de
  plataforma, motor simulado cerrado), `110000`, `120000` (reclamo atómico, topes, filtro normalizado), `130000`,
  `140000`, `150000` (métricas por universo completo, bloqueos de validación). **Nueva** e independiente:
  `20261028090000_smyl_patient_timeline_alias_fix.sql`. Atención: ella y `140000` cambian la cronología de la
  Ficha 360 de todas las clínicas.
- Edge: `radiograph-qc`, `radiograph-analyze`, `_shared/radiograph-{qc-core,provider,image,contracts}.ts`
  endurecidos; bundles regenerados con `scripts/bundle-edge-function.mjs` (ahora soporta `import type`, sin
  alterar los bundles ajenos).
- Web/PWA/`mobile/www` sincronizados (`review-v2.js?v=5`, contratos/informe/longitudinal/validación `?v=2`, cache
  `…-radiograph-hardening-v51`). Workflow manual actualizado (prerrequisitos, humo de cronología, PGlite en CI).
- Tests: suite completa y navegador (1280/820/390/320) verdes; PGlite 17 pruebas. Nuevo ajuste `SMYL_REQUIRE_PGLITE=1`.
- Pendiente humano: proveedor real, retención/borrado, revisión regulatoria, sincronización al odontograma.

## 2026-10-28 — Claude Code — Radiografía asistida: Etapa 7 (infraestructura de validación clínica)

- Migración **nueva, no aplicada** `20261028150000_smyl_radiograph_validation.sql`: conjuntos de
  evaluación con `training_exposure` (un informe se rechaza si hay exposición), referencia anotada
  por varios profesionales (inmutable; consenso por mayoría, empate excluido, adjudicación con
  aprobación), `smyl_radiograph_validation_metrics` (TP/FP/FN, sensibilidad, especificidad de piezas
  sobre 32 FDI, precisión, calibración, desacuerdo, operación, `truthSource`),
  `smyl_radiograph_monitoring`, incidentes, `smyl_radiograph_record_validation_report` (snapshot
  inmutable, criterios evaluados por el peor grupo, veredicto, hash, bloquea el conjunto),
  `smyl_radiograph_set_tenant_flag` (pausa por clínica con `clinic.manage`; la fila del tenant ahora
  gana sobre la bandera global) y `smyl_radiograph_model_disclosure`.
- Nuevo `smyl-radiograph-validation.js` + `.css` (panel sólo con `clinical.approve`) y divulgación de
  motor/validación/límites en la mesa v2 (v=4). Protocolo en `docs/RADIOGRAPH_VALIDATION_PROTOCOL.md`
  (borrador para revisión profesional y regulatoria; COFEPRIS / NOM-004 / LFPDPPP pendientes).
- Workflow manual actualizado para aplicar también `140000` y `150000` (16 políticas).
- QA: PGlite (15: métricas con valores conocidos, empate 0.5 / 0.9677 → adjudicación 1.0,
  informe rechazado por exposición, veredicto, inmutabilidad, pausa que bloquea el RPC de ejecución,
  divulgación por clínica), `tests/radiograph-validation-stage7.test.mjs` (5) y navegador
  `tests/smyl-radiograph-validation-browser.cjs` (1280/390). Nada aplicado ni desplegado.

## 2026-10-28 — Claude Code — Radiografía asistida: Etapa 6 (historia longitudinal)

- Migración **nueva, no aplicada** `20261028140000_smyl_radiograph_longitudinal.sql`:
  `smyl_radiograph_comparable_sources` (veredicto comparable/incompatible con motivo por tipo
  efectivo, QC faltante o no utilizable; bandera `radiograph.longitudinal_v1`),
  `smyl_radiograph_link_studies` (vínculo profesional idempotente y revocable, audita `compare`) y
  `smyl_patient_timeline` re-creada con eventos resumidos `radiograph_source` / `radiograph_report`
  sin texto clínico. La migración **no aplicada** `20261028110000` pasa a índice único parcial
  para vínculos revocables y admite la acción `compare`.
- **Hallazgo preexistente:** en Postgres real (PGlite) el texto original de `smyl_patient_timeline`
  (`20261027130000`) falla con «column timeline.event_at does not exist» porque la primera rama del
  `union` no tiene alias. La re-creación de `20261028140000` los añade. Conviene verificar en
  producción si la cronología de la Ficha 360 está respondiendo.
- Nuevo `smyl-radiograph-longitudinal.js` + `.css`: compatibilidad (misma regla que el servidor),
  diferencias de adquisición, emparejamiento por pieza en tres categorías (adquisición / propuesto
  por IA / confirmado por el profesional) sin mediciones, comparador con dos visores (zoom compartido,
  desplazamiento sincronizado, alternancia) y registro del par. `smyl-radiograph-review-v2.js?v=3`
  activa «Comparar con anterior» sólo con estudios comparables y explica los demás;
  `smyl-patient-360.js?v=15` etiqueta y abre los nuevos eventos en Tratamiento.
- Web, PWA (`radiograph-longitudinal-v49`) y `mobile/www` sincronizados; pines actualizados en
  pruebas históricas (`smyl-patient-360.js?v=15`, lista de tipos de la cronología).
- QA: PGlite (13: veredictos, bandera, vínculo idempotente/revocado, cronología sin texto y con
  alcance), `tests/radiograph-longitudinal-stage6.test.mjs` (5) y navegador
  `tests/smyl-radiograph-longitudinal-browser.cjs` (1280/390). Suite **867/867**. Nada aplicado ni
  desplegado.

## 2026-10-28 — Claude Code — Radiografía asistida: Etapa 5 (informe clínico asistido y firma)

- Nuevo `smyl-radiograph-report.js` + `.css`: borrador construido sólo con decisiones confirmadas o
  corregidas (pendientes, descartadas y no evaluables fuera), cinco secciones separadas, prioridades
  por hallazgo, previsualización en vivo de diferencias entre datos estructurados y texto, firma con
  confirmación (usuario, profesional, fecha, versión y hash en el servidor), adendas y exportación
  JSON + vista para imprimir con autoría, limitaciones, trazabilidad del motor y aviso.
- Redacción asistida por el proxy `claude` existente **con texto estructurado, nunca la imagen**; el
  modelo sólo ordena y redacta: `parseAssist` descarta toda la respuesta si añade/quita hallazgos,
  menciona piezas sin hallazgo o usa certezas/diagnósticos, y explica el motivo. Estudios
  complementarios nunca los redacta la IA.
- `smyl-radiograph-review-v2.js?v=2` añade «Informe radiográfico (N confirmados)» detrás de la
  bandera `radiograph.report_v1`. Web, PWA (`radiograph-report-v48`) y `mobile/www` sincronizados.
- QA: `tests/radiograph-report-stage5.test.mjs` (6) y `tests/smyl-radiograph-report-browser.cjs`
  (1280/390): sólo los confirmados aparecen, la redacción que añade pieza 25 y una certeza se
  descarta y la limpia se aplica sin tocar estudios complementarios, borrador rev. 1, firma rev. 2
  inmutable con hash, adenda, exportación auditada e impresión. Suite **860/860**. Sin migraciones ni
  Edge Functions nuevas; nada aplicado ni desplegado.

## 2026-10-28 — Claude Code — Radiografía asistida: Etapa 4 (mesa de revisión por pieza v2)

- Nuevo `smyl-radiograph-review-v2.js` + `smyl-radiograph-review-v2.css`: una tarjeta por
  candidato (pieza o señal) con Base visual sugerida, Confianza del modelo, Limitaciones y
  Valoración profesional; recorte derivado al vuelo; overlay SVG normalizado con contorno editable
  (vértices) y reversible; acciones Confirmar / Guardar corrección / Descartar / Comparar con
  anterior (deshabilitado con motivo hasta Etapa 6). Estado siempre con símbolo + texto + patrón de
  trazo; `listbox` con teclado; `aria-live`; objetivos de 42–44 px.
- Flujo en pantalla: consentimiento explícito → `smyl_radiograph_register_source` → `radiograph-qc`
  → tarjeta de calidad con corrección profesional del tipo → `radiograph-analyze` (localización /
  señales, deshabilitados si QC bloquea o falta la bandera) → decisiones vía
  `smyl_radiograph_decide_candidate` (revisión esperada; `PT409` recarga y explica; sin conexión el
  borrador se conserva). Detrás de la bandera `radiograph.qc_v2`; el permiso lo decide la base.
- `smyl-radiograph-review.js?v=5` sólo exporta `viewportNavigation` (visor único: zoom al centro,
  paneo, pellizco, teclado). `smyl-dental-record.js?v=17` añade el botón «Revisión por pieza (v2)»,
  oculto hasta que `smyl_radiograph_ai_capabilities()` lo habilite; «Revisar con apoyo de IA» (v1)
  no cambia.
- Web, `mobile/www` y PWA sincronizados: nuevos `smyl-radiograph-contracts.js?v=1`,
  `smyl-radiograph-review-model-v2.js?v=1`, `smyl-radiograph-review-v2.js?v=1`, `.css?v=1`; caché
  `radiograph-review-v2-v47`; `mobile/scripts/sync-web.js` ahora copia también los módulos
  radiográficos. Pines de versión actualizados en las pruebas históricas (v33–v41).
- QA: suite **854/854**; navegador real (Playwright) en 1280, 820, 390 y 320 px sin overflow:
  registro con consentimiento, QC, localización + señales (7 tarjetas / 7 contornos), teclado,
  confirmar, renumerar (original intacto, revisión 2), descartar y reconsiderar (revisión 3),
  contorno editable y deshacer, pérdida de red con borrador conservado, cierre con confirmación,
  zoom centrado. Sin migraciones ni Edge Functions nuevas; nada aplicado ni desplegado.

## 2026-10-28 — Claude Code — Radiografía asistida: Etapa 3 (localización dental y odontograma asistido)

- Edge Function **nueva** `supabase/functions/radiograph-analyze/` (`kind: tooth_localization |
  finding_candidates`; bundle en `docs/bundles/`). Mismo orden de seguridad que QC; la base exige
  además QC completado con el análisis aplicable y la bandera `radiograph.tooth_ai_v1`.
- `_shared/radiograph-provider.ts`: `DentalXrayProvider` (interfaz), `SimulatedDentalXrayProvider`
  determinista (polígonos normalizados por clase de estudio; no afirma ausencias ni inventa señales)
  y `HttpDentalXrayProvider` sobre el adaptador http común. `_shared/radiograph-qc-core.ts` pasa a
  `runRadiographAnalysis(kind, …)`; `runRadiographQc` se conserva.
- Corrección profesional admite `visibility` (migración **no aplicada** `20261028120000`, JS y TS).
- Nuevo `smyl-radiograph-review-model-v2.js` (solo modelo, sin UI/red): `toothMap` (FDI efectivo,
  banda de confianza, estado, conflictos), `renumberPayload`, `notEvaluablePayload`, `geometryPayload`,
  `splitOrMerge` (rechazado) y `odontogramEvidence` (solo confirmadas/corregidas; `apparently_missing`
  nunca se vuelve "ausente"; no escribe `doc.teeth`). No se carga aún en páginas ni `sw.js`/`mobile/www`.
- Pruebas `tests/radiograph-analyze-stage3.test.mjs` (9) + paridad JS/TS de `parseDecisionPayload`
  y caso `visibility` en PGlite. Suite **847/847**. Nada aplicado ni desplegado; `segment-teeth`,
  v1, UI y `mobile/**` intactos. Detalle en `docs/RADIOGRAPH_AI_STAGE_0_1.md`.

## 2026-10-28 — Claude Code — Radiografía asistida: Etapa 2 (control de calidad) y workflow de migración

- Edge Function **nueva** `supabase/functions/radiograph-qc/` (bundle en
  `docs/bundles/radiograph-qc.single-file.ts`) con módulos `_shared/radiograph-image.ts`
  (MIME real, dimensiones PNG/JPEG, orientación EXIF, sin decodificar), `_shared/radiograph-provider.ts`
  (interfaz `RadiographQcProvider`, proveedor `simulated` determinista, adaptador `http` sin
  redirecciones y con hosts permitidos) y `_shared/radiograph-qc-core.ts` (núcleo sin Deno, probado en Node).
- Orden de seguridad: la base autoriza con la sesión del usuario (`smyl_radiograph_request_ai_run`)
  antes de cualquier uso de `service_role`; el archivo se descarga por la ruta conocida de la fuente;
  se verifican tamaño, sha256, MIME por firma, dimensiones y orientación; la respuesta se valida con el
  contrato y se guarda completa e inmutable. Timeout incierto → `unconfirmed`, sin reintento automático.
- `20261028120000` (no aplicada) añade el código de falla `source_invalid`. Workflow manual
  `.github/workflows/smyl-radiografia-ia-etapa-1-migracion.yml` listo para aplicar las cuatro
  migraciones con verificación; **no se ha disparado**. Nada aplicado ni desplegado.
- Pruebas `tests/radiograph-qc-stage2.test.mjs` (14): panorámica, periapical, bitewing, rotada,
  borrosa, recortada, sub/sobreexpuesta, no utilizable, archivo falso, hash/tamaño distintos,
  respuesta incompleta, motor con otra versión, timeout, duplicado, sin motor, logs sin datos.
  Suite completa **838/838**. No se tocó `segment-teeth`, flujo v1, UI ni `mobile/**`.

## 2026-10-28 — Claude Code — Radiografía asistida: Etapas 0 y 1 (banderas, esquema v2, contratos)

- Entrega de datos y contratos sin cambios de comportamiento: cuatro migraciones **nuevas e
  idempotentes** `20261028100000_smyl_radiograph_ai_flags`, `…110000_smyl_radiograph_sources_v2`,
  `…120000_smyl_radiograph_ai_runs` y `…130000_smyl_radiograph_reports`. **No aplicadas.**
- Banderas `radiograph.qc_v2`, `tooth_ai_v1`, `report_v1`, `longitudinal_v1`, `cbct_v1`
  apagadas por defecto, con piloto por clínica; registro de motores (proveedor/modelo/versión/
  contrato) sin credenciales y con interruptor global. El navegador sólo ve booleanos vía
  `smyl_radiograph_ai_capabilities()`.
- Esquema: fuentes inmutables (ruta/hash copiados del expediente v1, nunca del cliente),
  correcciones append-only, vínculos longitudinales, auditoría de acceso/exportación, ejecuciones
  IA idempotentes con salida original inmutable, candidatos y decisiones profesionales
  versionadas (`pending → confirmed | corrected | rejected`, conflicto `PT409`), informes con
  firma por hash y adendas. RLS por `clinical.read` + `smyl_can_access_patient`; escritura sólo
  por RPC `SECURITY DEFINER`; el cierre del motor es exclusivo de `service_role`.
- Contratos v2 (`smyl-radiograph-contracts.js`, `supabase/functions/_shared/radiograph-contracts.ts`
  y validadores SQL) con 86 vectores canónicos en `tests/fixtures/radiograph-contracts/`.
  Rechazan campos extra, enumeraciones abiertas, probabilidades fuera de [0,1], FDI inválida,
  geometrías degeneradas, candidatos sin región y texto con afirmaciones diagnósticas.
- Pruebas: `tests/radiograph-contracts-v2.test.mjs` (paridad JS/TS), `tests/radiograph-migrations-stage1.test.mjs`
  (contrato estático) y `tests/radiograph-pglite-stage1.test.mjs` (Postgres real en memoria:
  aislamiento entre clínicas, miembro desactivado, rol sin alcance, idempotencia, inmutabilidad,
  firma; se omite si falta `@electric-sql/pglite`). Suite completa **824/824**.
- Revisión adversarial independiente (segunda ronda, mismo día): decisiones bloqueadas y
  congeladas al firmar (`for update` + `signed_decisions`; reconsiderar exige adenda), recorte y
  longitud de texto alineados JS/TS/SQL (Unicode, code points), cascada de borrado de
  paciente/clínica permitida y borrado directo bloqueado, `revoke truncate` a `service_role`,
  sin oráculo de existencia de ids entre clínicas, trigger de revisión en decisiones, firma sólo
  con ficha de profesional, cliente sólo registra `open`, CHECK anti-secretos profundo en motores.
- No se tocó `segment-teeth`, el flujo v1 (`smyl_radiograph_reviews`), Edge Functions
  desplegadas, UI, `sw.js` ni `mobile/**`. Detalle, amenazas, despliegue/rollback y pendientes en
  `docs/RADIOGRAPH_AI_STAGE_0_1.md`.

## 2026-10-27 — Codex — Ficha 360 v4.5 y cronología segura

- La actividad longitudinal de la Ficha 360 integra, en una sola secuencia y
  sin duplicar fuentes, citas, evoluciones, archivos, odontograma, revisiones
  fotográficas y radiográficas, planes, cotizaciones, movimientos
  administrativos/CFDI y vínculos de conversación. La interfaz agrupa sólo los
  dominios disponibles y cada movimiento abre su módulo canónico.
- El RPC `smyl_patient_timeline` conserva su contrato de seis columnas y añade
  límites, orden determinista y controles explícitos por tenant, permiso y
  alcance del paciente. El resultado nunca devuelve cuerpos clínicos, mensajes,
  direcciones de archivos, conceptos, importes, RFC, datos fiscales ni errores
  del proveedor.
- La migración
  `20261027130000_smyl_patient_timeline_v2.sql` corrige también las lecturas
  directas históricamente amplias de odontograma, evidencia, planes,
  cotizaciones y vínculos LANA. Los perfiles con alcance propio o por equipo
  tratante sólo pueden consultar a sus pacientes; agenda, finanzas y mensajes
  conservan además sus permisos y alcances específicos.
- La aplicación es aditiva sobre los datos: no transforma, elimina ni copia
  expedientes. El workflow manual
  `smyl-ficha-360-timeline-migracion.yml` comprueba dependencias, aplica de forma
  idempotente, valida `SECURITY DEFINER`, `search_path`, ACL, índices y políticas,
  y registra la versión únicamente después de verificar el resultado.
- Web, `mobile/www` y PWA quedan sincronizados en
  `smyl-patient-360.js?v=14`, `smyl-patient-360.css?v=9` y caché
  `patient-timeline-v45`. QA: **785/785** pruebas, **9/9** controles del release
  gate y navegador en 1440, 1024, 768, 390, 320 px y reflujo equivalente al
  200 %, sin overflow y con objetivos táctiles de 44 px.

## 2026-10-27 — Codex — Ficha conectada del paciente v4.4

- El Resumen del expediente se convierte en una portada 360 legible: una sola
  siguiente acción y seis áreas enlazadas a sus fuentes canónicas — Historia
  clínica, Evoluciones, Tratamiento, Estudios y archivos, Atención y citas y,
  sólo con permiso financiero, Administrativo. Ningún registro se copia ni se
  crea una segunda fuente de verdad.
- Tratamiento consume únicamente los estados de lectura existentes de
  `SmylCaseWorkspace`, `SmylDentalProgress` y `SmylClinicalWorkflow`. La ficha
  distingue evaluación disponible, evaluación en curso y borrador guardado;
  no presenta ningún plan como aprobado sin una confirmación real.
- La actividad longitudinal permite filtrar Citas, Evoluciones y Archivos y
  abre cada registro en su visor o módulo original. Este primer alcance conserva
  el contrato actual de `smyl_patient_timeline`; planes, odontograma, cobros y
  mensajes requerirán una ampliación backend posterior antes de aparecer en la
  misma cronología.
- La política visual usa jerarquía navy/teal/ámbar, texto mínimo de 12 px,
  foco visible, una acción primaria y objetivos táctiles de 44 px en móvil. Se
  validaron 1440, 1024, 768, 390, 320 px y reflujo equivalente a zoom 200 %, sin
  overflow horizontal.
- Web, `mobile/www` y PWA quedan sincronizados en
  `smyl-patient-360.js?v=13`, `smyl-patient-360.css?v=9` y caché
  `patient-summary-v44`. `mobile/scripts/sync-web.js` incorpora ahora ambos
  archivos para evitar divergencias futuras.
- Entrega exclusivamente frontend: sin cambios de esquema, RLS, Storage, Edge
  Functions ni prompts/modelos clínicos. QA: **778/778** pruebas, **9/9**
  controles de seguridad y prueba de navegador de la nueva portada aprobada.

## 2026-10-27 — Codex — Navegación radiográfica centrada v4.3

- El zoom de los visores manual y asistido conserva el punto observado en vez
  de crecer desde la esquina superior izquierda. Al volver a la vista original
  se restablecen escala, centro, brillo, contraste e inversión.
- Con la imagen ampliada se puede recorrer horizontal y verticalmente mediante
  arrastre con mouse o lápiz, gesto táctil de un dedo y teclado. En móvil, el
  gesto estándar de separar dos dedos amplía y juntarlos reduce el zoom.
- El botón `Revisar con apoyo de IA` deja de fallar en silencio: abre la mesa
  asistida cuando el expediente está guardado y muestra dentro del visor una
  explicación concreta cuando faltan guardar cambios, permiso clínico o carga
  del módulo. No se ampliaron permisos ni se modificó la validación profesional.
- Se añadieron pruebas de navegador para centro focal, paneo, reinicio, gesto
  táctil y los estados del acceso a IA en 1280, 820, 390 y 320 px. La política
  visual SMYL se conserva y web/PWA quedan sincronizadas.
- Entrega frontend sin cambios de esquema, RLS, almacenamiento, Edge Functions
  ni modelos clínicos: `smyl-radiograph-review.js?v=4`,
  `smyl-dental-record.js?v=16`, `smyl-radiograph-workbench.css?v=3` y cache
  `radiograph-navigation-v43`.

## 2026-10-27 — Codex — Mesa profesional de lectura radiográfica v4.2

- Los visores manual y asistido comparten ahora una anatomía clínica coherente
  con la política visual SMYL: imagen original protegida, herramientas de
  visualización, señales estructuradas y una sola tarea activa a la vez.
- En escritorio, la revisión asistida utiliza una mesa 70/30; en tablet y móvil
  se ordena como imagen → señales → guardado. Las señales son alcanzables a
  320 px, no se superponen y los controles táctiles miden al menos 44 px.
- Zoom, contraste, brillo e inversión sólo afectan la vista. La marcación manual
  requiere activar `Marcar zona`; tocar la imagen pasivamente ya no crea
  observaciones. Los marcadores y las tarjetas conservan numeración estable.
- Las sugerencias de IA permanecen ámbar hasta decisión profesional; las
  confirmadas usan teal y las anotaciones manuales del dentista se distinguen
  como información clínica verificada. Los diálogos nativos se reemplazaron por
  confirmaciones SMYL accesibles y el original nunca se modifica.
- Se añadieron pruebas de modelo, contratos y navegador para 1280, 820, 390 y
  320 px, además de paridad exacta entre web y `mobile/www`. QA final:
  **775/775** pruebas, sin overflow horizontal ni regresiones de interacción.
- Entrega exclusivamente frontend: no cambian esquema, RLS, almacenamiento,
  Edge Functions ni prompts/modelos clínicos. Un diagnóstico radiográfico
  validado requiere una etapa backend y regulatoria independiente.
- Web/PWA quedan sincronizadas con `smyl-radiograph-review.js?v=3`,
  `smyl-dental-record.js?v=15`, `smyl-radiograph-workbench.css?v=2` y cache
  `reading-workbench-v42`.

## 2026-10-27 — Claude — Horas libres calculadas en el servidor

- Migración nueva `20261027120000_smyl_schedule_free_slots.sql`: función
  `smyl_schedule_free_slots` (SECURITY DEFINER, solo `authenticated`, exige
  `schedule.manage` en la clínica de la sesión). Usa la misma regla que
  `smyl_validate_service_appointment_slot` (horario de la clínica y del
  profesional, citas con preparación, bloqueos y apartados de solicitudes
  pendientes). Devuelve solo horarios, nunca datos de citas ni pacientes.
- `smyl-schedule.js` v27: Nueva cita y Cambiar horario piden las horas a la
  función. Si no está aplicada (`PGRST202`) vuelven al cálculo del navegador,
  así que nada se rompe antes de aplicar la migración.
- Con alcance de datos «propio» ya no aparecen libres horas ocupadas por otro
  profesional en el mismo sillón. `smyl_create_appointment` sigue siendo la
  autoridad final al guardar.
- Verificado en PGlite: 400 escenarios comparados contra el cálculo del
  navegador sin diferencias, y pruebas de permisos y aislamiento entre clínicas.
  Prueba nueva: `tests/smyl-schedule-free-slots.test.mjs`.
- Pendiente de quien tenga acceso: pegar la migración en el SQL Editor de
  Supabase.

## 2026-10-26 — Codex — Inicio como mesa de trabajo diaria v12

- El Inicio deja de repetir acciones del menú y se ordena por la jornada real:
  primero `Ahora y después`, después los indicadores con actividad,
  `Requiere atención`, conversaciones `Por responder` y al final el resumen
  mensual.
- Los cuatro indicadores ya no muestran ruido en cero. Cuando no existe
  actividad aparece una sola confirmación `Todo al día por ahora`; cuando sí
  existe, sólo se muestran las señales relevantes.
- Las tarjetas de Meta permanecen siempre a la vista con las conversaciones
  recientes de WhatsApp, Instagram y Messenger. Las que requieren atención o
  están sin leer se ordenan primero; el dashboard no expone el texto del mensaje.
- `Configura tu clínica` sigue siendo exclusivo del propietario, comienza
  plegado y ahora vive al final del Inicio para no desplazar el trabajo diario.
- No cambian consultas, alcance de tenant, permisos ni escritura de datos. Web,
  fuente móvil y PWA quedan sincronizadas en Inicio JS v10, CSS v12,
  configuración v5 y cache `daily-workbench-v12-meta-cards-v13`.
- QA: **757/757** pruebas; revisión visual a 1440, 820 y 390 px sin overflow,
  tarjetas en cero ni accesos redundantes.

## 2026-10-26 — Codex — Revisión asistida por evidencia v3.5

- La historia de evidencia muestra ahora el estado de interpretación de cada
  sesión fotográfica y cada radiografía compatible: `IA disponible`,
  sugerencias `por confirmar`, revisión completada o respuesta no confirmada.
  Escaneos, PDF y demás archivos se identifican como `Revisión profesional`
  porque el analizador clínico actual no admite esos formatos.
- Una franja de control resume pendientes y observaciones confirmadas. El copy
  deja explícito que la IA sólo propone zonas por comprobar y que nada pasa al
  odontograma hasta que el profesional lo confirma.
- Cada radiografía abre ahora su estudio exacto mediante el visor canónico; las
  fotografías reutilizan su revisión profesional existente. No se creó un
  segundo analizador, fuente de datos ni mecanismo de guardado.
- Se conserva el consentimiento explícito ya existente para enviar cada
  estudio compatible, la separación entre sugerencias y hallazgos confirmados,
  y la revisión privada. No se modificaron prompts, Edge Functions, esquema,
  RLS ni almacenamiento.
- Web, fuente móvil y PWA quedan sincronizadas con
  `smyl-dental-record.js?v=12`, `smyl-case-workspace.js?v=13`,
  `smyl-case-workspace.css?v=10` y cache `evidence-ai-v35`. QA:
  **751/751** pruebas y revisión responsiva a 1280, 820, 390 y 320 px.

## 2026-10-26 — Codex — Nuevo diseño sale de la navegación principal

- `Nuevo diseño` deja de mostrarse como módulo persistente en el sidebar y la
  barra móvil. La simulación conserva su ruta y sus datos, y se abre desde la
  acción contextual `Nueva simulación` o desde el historial de Simulaciones.
- Navegación web/PWA avanza a v15; no hay cambios de modelo, permisos ni datos.

## 2026-10-26 — Codex — Navegación principal simplificada

- `Tratamientos` y `Alertas` dejan de aparecer como módulos independientes en
  el sidebar, la hoja móvil y el buscador global `Ir a…`.
- El plan y la propuesta conservan su modelo y sus permisos, pero se abren como
  una tarea contextual desde el expediente del paciente. Al entrar, el encabezado
  dice `Propuesta del paciente` en lugar de presentar un módulo global.
- El centro de pendientes no se elimina: continúa disponible desde la campana
  superior y el Inicio sigue mostrando las prioridades de la clínica.
- La ventana `Nuevo paciente` se reordenó en Datos esenciales, Atención,
  consentimiento y datos adicionales. Usa una sola superficie, controles de
  48 px, alerta clínica diferenciada, texto breve y acción contextual
  `Crear paciente` / `Guardar cambios`.
- Web, fuente móvil y PWA quedan sincronizadas en navegación v14, buscador v3,
  shell profesional v6, pacientes JS v15/CSS v8 y caché
  vigente con sufijo `simplified-navigation-patient-intake-v33`.
- QA combinada: **747/747** pruebas; revisión visual a 1280, 820 y 390 px sin overflow
  horizontal, con controles de 48 px y acciones siempre visibles.

## 2026-10-26 — Codex — Historia compacta de evidencia clínica v3.4

- Tratamiento incorpora una historia de evidencia cronológica dentro de
  `Evaluación clínica`: reúne fotografías del caso, estudios radiográficos y
  archivos clínicos recientes sin duplicarlos ni convertir la simulación de
  sonrisa en evidencia diagnóstica.
- La vista resume los tres orígenes, ordena los registros por fecha y abre cada
  elemento mediante su visor canónico. `Ver todos los archivos` lleva al
  expediente privado del paciente, que continúa siendo la única fuente de
  verdad y conserva sus controles de acceso.
- La API de lectura para el tratamiento entrega únicamente metadatos seguros;
  no expone rutas de almacenamiento, huellas, notas ni contenido clínico al
  componente visual. La apertura vuelve a validar paciente, clínica y permiso.
- En móvil se muestran los tres indicadores y los registros más recientes en
  una composición compacta; el resto permanece disponible en Archivos. Se
  validaron 1280, 820, 390 y 320 px, con acciones de 42/44 px y sin overflow.
- Web, fuente móvil y PWA quedan sincronizadas con
  `smyl-patient-360.js?v=10`, `smyl-dental-record.js?v=11`,
  `smyl-case-workspace.js?v=12`, `smyl-case-workspace.css?v=9` y cache
  `evidence-history-v34`. No hubo migraciones, cambios de RLS, esquema o
  almacenamiento. QA: **744/744** pruebas y control visual responsivo aprobado.

## 2026-10-26 — Codex — Odontograma clínico longitudinal v3.3

- Tratamiento incorpora un odontograma FDI interactivo de 32 piezas dentro de
  `Evaluación clínica`. Resume el expediente dental vigente sin crear una
  segunda fuente de verdad; al seleccionar una pieza abre el editor canónico
  existente para revisar o registrar su evolución.
- El mapa distingue por origen las anotaciones clínicas, fotografías
  confirmadas y radiografías confirmadas. Los filtros `Todo`, `Clínica`,
  `Fotografías` y `Rayos X` permiten aislar cada capa sin perder el contexto.
- Las sugerencias de IA se muestran con trazo discontinuo y estado
  `IA por revisar`; nunca se convierten automáticamente en hallazgos ni se
  mezclan visualmente con evidencia confirmada. La decisión continúa bajo
  control del profesional.
- La tarjeta informa piezas relacionadas, conteos por fuente y pendientes. En
  móvil se apila, conserva acciones táctiles de 44 px y ofrece acceso explícito
  al odontograma completo. Se validaron 1280, 820, 390 y 320 px, 32 piezas y
  cuatro filtros, sin overflow horizontal.
- Web, fuente móvil y PWA quedan sincronizadas con
  `smyl-dental-record.js?v=10`, `smyl-case-workspace.js?v=11`,
  `smyl-case-workspace.css?v=8` y cache `smart-odontogram-v33`. No hubo
  migraciones, cambios de RLS ni cambios de esquema. QA: **722/722** pruebas y
  control visual responsivo aprobado.

## 2026-10-26 — Codex — Tratamiento alineado a la política visual v3.2

- Tratamiento pasa de cuatro pasos técnicos a tres decisiones clínicas:
  `Evaluación`, `Plan` y `Seguimiento`. Las rutas internas anteriores se
  conservan como alias para no romper accesos desde Agenda, Pacientes o
  cotizaciones.
- Un panel superior muestra la siguiente acción, etapa, estado del plan y
  próxima cita. Una banda clínica separada lleva a alertas y antecedentes antes
  de preparar el tratamiento.
- Evaluación reúne documentación y odontograma como apartados distintos. Ya no
  presenta `Sin fotos` junto a `Analizar fotografías`: permite continuar sin
  imágenes o abrir el odontograma; si existen fotografías, conserva el análisis
  asistido y exige confirmación profesional.
- El plan existente, sus permisos y su fuente de datos no cambiaron. Cotización,
  presentación mySmyl y continuidad del caso quedan en `Autorización y
  seguimiento`; ninguna acción afirma envío automático.
- La interfaz usa superficies blancas, acción primaria navy, turquesa sólo para
  selección/estado y controles de 42 px en escritorio y 44 px en móvil. Se
  revisó a 1280, 820, 390 y 320 px sin overflow horizontal.
- Web, fuente móvil y PWA quedan sincronizadas con
  `smyl-case-workspace.js?v=10`, `smyl-case-workspace.css?v=7`,
  `smyl-patient-360.css?v=8` y cache `treatment-ux-v32`. No hubo migraciones,
  cambios de RLS ni cambios de esquema. QA: **718/718** pruebas y control visual
  responsivo aprobado.

## 2026-10-26 — Codex — Plantillas de WhatsApp organizadas por uso

- El catálogo pasó de una lista plana a seis categorías operativas: Citas,
  Tratamientos y seguimiento, Pagos y facturación, Documentos y expediente,
  Equipo y operación, y Reactivación y campañas.
- La pantalla muestra filtros horizontales con conteos y agrupa las tarjetas
  bajo títulos y descripciones breves. Las tres plantillas iniciales del flujo
  de agenda llevan la marca `Recomendada`.
- Se añadieron propuestas para confirmar llegada, laboratorio listo, control
  pendiente, datos fiscales, saldo actualizado, documentos y coordinación de
  la agenda profesional. El catálogo suma 51 plantillas y conserva la separación
  estricta Utility/Marketing, baja para Marketing y validación de Meta.
- Web, fuente móvil, caché PWA, catálogo de Edge Functions y bundle manual
  quedaron sincronizados en catálogo v3 y pantalla/CSS v4. El sincronizador
  móvil ahora incluye también `smyl-templates.js/.css`.
- QA visual revisada en el navegador integrado con filtros desplazables y
  tarjetas de una columna en ancho reducido; pruebas enfocadas aprobadas.

## 2026-10-26 — Codex — Historia clínica alineada a la política visual v3.2

- La pestaña abre en lectura clínica, no en un formulario: muestra primero las
  alertas que pueden modificar la atención, fecha de actualización, cobertura
  del expediente y versión. El resto se agrupa por salud médica, antecedentes
  dentales, hábitos e información complementaria mediante revelado progresivo.
- `Actualizar historia` abre una edición guiada por secciones. Alertas y
  alergias permanecen visibles; los demás apartados se expanden sólo cuando el
  médico los necesita. Hay una sola acción primaria y se explica que guardar
  crea una nueva versión.
- En móvil los controles alcanzan 44–48 px, los datos se apilan sin overflow y
  la barra de acciones pasa al flujo normal para no cubrir campos. En escritorio
  permanece accesible al final de la ventana durante la edición.
- Se conserva el mismo documento clínico versionado, sus permisos y todos los
  campos existentes. No hubo migraciones, cambios de RLS ni automatización de
  decisiones clínicas.
- Web, fuente móvil y PWA quedan sincronizadas con
  `smyl-patient-360.js?v=9`, `smyl-patient-360.css?v=7` y cache
  `history-ux-v32`. QA: **28/28** pruebas enfocadas, **711/711** suite completa
  y revisión Chrome a 1280, 390 y 320 px, sin overflow horizontal y con una sola
  acción primaria visible.

## 2026-10-26 — Codex — Pacientes alineado a la política visual v3.2

- El directorio deja la tarjeta exterior con tarjetas repetidas y usa una sola
  superficie operativa: tabla semántica en escritorio y tarjetas compactas sólo
  en móvil. Mantiene una única acción primaria, búsqueda etiquetada, resumen y
  estados separados para carga, error, vacío y cero resultados.
- Cada fila prioriza identidad, contacto, próxima atención y estado del
  expediente. `Agendar` y `Abrir expediente` tienen nombres accesibles por
  paciente; los iconos decorativos se sustituyeron por SVG y el alta usa campos
  de 48 px con jerarquía en sentence case.
- Ficha 360 conserva su recorrido clínico, pero su raíz deja de crear una tarjeta
  contenedora adicional. Acciones primarias usan navy, turquesa queda para
  selección/estado y los controles respetan 42 px en escritorio y 44 px táctiles.
- Web, fuente móvil y PWA quedan sincronizadas con `smyl-clinic.js?v=14`,
  `smyl-clinic.css?v=7` y cache `patients-visual-v32`. No hubo cambios de base de
  datos, permisos ni migraciones.
- QA: 30/30 pruebas clínicas del módulo, 21/21 pruebas de política visual, suite
  completa aprobada y revisión Chrome a 1440, 1024, 390 y 320 px más reflujo
  ampliado, sin overflow horizontal. Quedan como mejoras posteriores la búsqueda
  paginada para clínicas con miles de pacientes y ampliar el corte de agenda
  superior a 1,000 registros.

## 2026-10-26 — Codex — Confirmaciones de citas por WhatsApp desplegadas

- Agenda envía la plantilla Utility al profesional al preparar una confirmación
  y, cuando acepta, envía la propuesta al paciente. Cada tarjeta distingue
  `enviado`, `respuesta recibida`, `fallido` o `pendiente` y conserva botones
  explícitos para registrar una respuesta manual si el canal falla.
- La nueva función `appointment-negotiations` valida permisos, plantilla
  aprobada e idempotencia. El callback público exige HMAC SHA-256 sobre el cuerpo
  original, una antigüedad máxima de cinco minutos y correlación exacta con la
  entrega; no guarda texto del mensaje, teléfono ni identidad del paciente.
- La migración `20261026210000_smyl_negotiation_whatsapp_delivery.sql` agrega
  vínculos profesional↔conversación LANA, entregas y deduplicación de eventos.
  Las decisiones de WhatsApp son sólo para `service_role` y vuelven a validar
  disponibilidad antes de avanzar la negociación.
- Cada profesional vincula voluntariamente su propia conversación desde
  Mensajes con `Usar como mi WhatsApp profesional`; no se presupone que su correo
  de SMYL y su cuenta de Google o WhatsApp sean iguales.
- El catálogo incluye botones exactos: profesional `Confirmar / Cambiar horario /
  Rechazar`; paciente `Aceptar / Ver otras opciones / Hablar con clínica`. El
  aviso al profesional omite nombre, diagnóstico y tratamiento del paciente.
- Revisión visual aprobada a 390, 820 y 1180 px. Se corrigió la tarjeta de
  confirmación para apilar acciones en tableta y conservar texto legible. Web y
  fuente móvil usan Agenda JS v26 e Inbox JS v38. Tras integrar la seguridad P0
  y el ajuste de recordatorios, la suite completa quedó en **695/695**.
- Las migraciones `20261026190000`, `20261026200000` y `20261026210000` ya
  están aplicadas en producción. `invite-staff`, `appointment-negotiations` y
  `whatsapp-templates` quedaron desplegadas en SMYL. Las migraciones antiguas
  `20261022130000`, `20261022140000` y `20261024090000` siguen pendientes y no
  se aplicaron durante este despliegue.
- LANA incorpora `_shared/smyl-negotiation-callback.ts` en
  `promodesk-smyl-meta-bridge`: sólo reenvía quick replies si el `wamid`
  original pertenece a una solicitud SMYL, resuelve `external_tenant_id` y
  firma el cuerpo. `whatsapp-webhook` quedó desplegado en el proyecto LANA.
- El mismo `SMYL_NEGOTIATION_WEBHOOK_SECRET` generado localmente quedó
  configurado en ambos proyectos; no se guardó en archivos ni se mostró.
  Smoke tests: SMYL sin sesión `401`, firma falsa `403`, LANA sin firma Meta
  `403`. Pendiente para la prueba real: solicitar/aprobar las dos plantillas en
  Meta, vincular el WhatsApp del profesional y ejecutar una cita de prueba.
- Las migraciones de seguridad `20261026220000` y `20261026230000` también se
  aplicaron en producción. La segunda endurece el trigger usando la misma tabla
  `smyl_staff_invitations`: tenant, UUID de invitación y correo deben coincidir.
  `invite-staff` y `appointment-reminders` fueron desplegadas después; el
  recordatorio ya usa `am/pm` sin el doble punto.

## 2026-10-26 — Codex — Motor de confirmación de citas por capas

- Agenda cambia `Por aprobar` por `Por confirmar` y separa cada decisión:
  profesional, paciente y confirmación final. La tarjeta muestra estado, ronda,
  horario propuesto, vencimiento y sólo las acciones pertinentes.
- La migración `20261026200000_smyl_appointment_negotiations.sql` agrega estado
  canónico, propuestas y eventos auditables por tenant. Hay una sola propuesta
  abierta por destinatario, reservas de 5–30 minutos y un máximo de tres rondas;
  después se escala a coordinación manual.
- El profesional sólo puede responder por su propio perfil salvo que el usuario
  tenga `schedule.manage`. Las tablas son de lectura para usuarios autenticados;
  las escrituras pasan por RPC con validación de permisos y disponibilidad.
- La confirmación final reutiliza `smyl_accept_appointment_request`, por lo que
  conserva las mismas reglas de sucursal, servicio, profesional, espacio y
  traslapes. Al crear la cita dispara recordatorios y sincronización con Google.
- Esta entrega registra respuestas manuales desde Agenda y lo dice explícitamente.
  Todavía no envía ni procesa botones reales de WhatsApp; el siguiente paso es
  conectar las plantillas Utility con un callback firmado e idempotente.
- Web y fuente móvil usan Agenda JS v25/CSS v18. Revisión local en escritorio,
  tablet y móvil aprobada; suite completa: **681/681**.
- **No desplegado ni publicado.** Falta aplicar la migración y desplegar la capa
  de transporte de WhatsApp antes de una prueba real de punta a punta.

## 2026-10-26 — Codex — Profesionales sólo por invitación (base del flujo inteligente)

- Mi clínica deja de crear perfiles profesionales sin cuenta. `Invitar profesional`
  solicita nombre, correo, especialidad, cédula y primera sucursal; la persona
  aparece como invitación pendiente hasta aceptar el correo.
- La migración `20261026190000_smyl_professional_invitations.sql` crea un registro
  trazable con vencimiento y RLS. Al aceptar, el trigger de Auth vincula la cuenta,
  crea el profesional, asigna sucursal principal y rol odontólogo en una sola
  transacción. El correo de acceso no obliga a usar la misma cuenta de Google.
- `invite-staff` valida que la sucursal pertenezca al tenant, guarda la invitación
  antes de enviar y la elimina si Supabase Auth rechaza el envío.
- El catálogo añade las plantillas Utility `cita_confirmacion_profesional_v1`
  (Confirmar / Cambiar horario / Rechazar) y `cita_propuesta_paciente_v1`
  (Aceptar / Ver otras opciones / Hablar con clínica), sin datos clínicos en el
  aviso al profesional.
- Web, PWA y fuente móvil avanzan a clinic-admin JS v5/CSS v6 y catálogo v2.
  Revisión visual local aprobada en escritorio; suite completa: **676/676**.
- **No desplegado ni publicado.** Antes de producción: aplicar la migración,
  desplegar `invite-staff`, solicitar/aprobar las plantillas en Meta y realizar
  una invitación de prueba. El motor de negociación y el webhook de botones son
  la siguiente etapa; todavía no se envían estos avisos automáticamente.

## 2026-10-26 — Claude: recordatorios sin el doble punto «p.m..»

- `supabase/functions/appointment-reminders/index.ts`: la variable `time` ahora sale como «5:00 pm» (antes «5:00 p.m.»). Las plantillas
  ponen un punto después de la hora (por ejemplo «…a las {{4}}. Si necesitas…»), así que el paciente recibía «p.m..». Archivo único
  regenerado en `docs/bundles/appointment-reminders.single-file.ts`.
- **Desplegado 2026-10-26:** `appointment-reminders` ya usa esta versión en el proyecto SMYL; los recordatorios automáticos salen sin «p.m..».
- `smyl-schedule-message.js` (v2): el envío desde la ficha de la cita usa el mismo formato, así que ambos caminos dicen lo mismo.
- Pruebas actualizadas: `10:30 am` en el despacho de recordatorios y `5:00 pm` en el módulo de mensajes.
- Nota de contexto: el flujo manual `smyl-buscar-pacientes-migracion.yml` volvió a fallar el 26/10 en 2 segundos, sin pasos ni registro
  (el trabajo ni llega a arrancar). El flujo `smyl-agenda-tiempo-extra-migracion.yml` sí corrió bien el 22/10, lo que indica que el secreto
  `SUPABASE_ACCESS_TOKEN` existe. Falta ver el aviso en la página del trabajo (puede ser un tema de la cuenta de GitHub Actions).
## 2026-10-26 — Codex — Sincronización bidireccional de Google Calendar

- Se implementó el modelo acordado: SMYL→Google automático y Google→SMYL bajo
  revisión humana. Cada conexión pertenece a una clínica, usuario y profesional
  activo; exige `schedule.manage` y nunca mezcla citas entre tenants.
- La migración `20261026170000_smyl_google_calendar_sync.sql` añade vínculos
  cita↔evento, cola idempotente, solicitudes `reschedule/cancel/create`, trigger
  de agenda, tokens incrementales y estado de canales `watch`.
- Nuevas funciones `google-calendar-sync` y `google-calendar-webhook`: refresh
  token sólo en servidor, reintentos, `nextSyncToken`, recuperación de `410`,
  validación del canal y renovación. Google recibe horario, sede y servicio,
  pero no paciente ni notas clínicas.
- Agenda añade `Por revisar`: aceptar mover/cancelar usa las RPC canónicas;
  rechazar restaura Google. Un evento nuevo abre Nueva cita y sólo se vincula
  después de completar paciente, servicio, sede y profesional.
- Web y `mobile/www` usan `smyl-schedule.js?v=24` y
  `smyl-google-calendar.{js,css}?v=2`; la caché PWA conserva su prefijo v263 y
  añade el sufijo `google-calendar-bidirectional-review`.
- Sigue pendiente la verificación manual de Google Cloud y activar
  `GOOGLE_CALENDAR_OAUTH_READY=true`.
- Migración `20261026170000` aplicada y marcada en remoto. El secreto interno
  fue creado y las tres funciones (`oauth`, `sync`, `webhook`) quedaron
  desplegadas; los smoke tests anónimos devolvieron `401` como corresponde.
- Suite completa: **672/672 pruebas**. Fixture visual de `Por revisar` comprobado
  en escritorio y reglas responsive revisadas para móvil.

## 2026-10-26 — Codex — Agenda visual v3 y OAuth de Google Calendar

- Agenda adopta la política v3.2: portada navy, copy breve, tres métricas tipo
  bento, tabs y selector de vista con estados navy, foco accesible y estado vacío
  con tipografía legible. Se eliminó la repetición visual `Agenda / Agenda` usando
  `Organiza tu día` dentro del módulo.
- Cambios en `smyl-schedule.js?v=23` y `smyl-schedule.css?v=17`; web/PWA se
  mantienen sincronizadas y el script de sincronización ya incluye ambos
  archivos. Fixture visual nuevo en
  `tests/fixtures/smyl-agenda-visual-v3-preview.html`.
- La suite completa terminó con **668/668 pruebas** y la revisión visual de
  escritorio fue satisfactoria. Los commits `5619f37` y `f9494c6` quedaron
  publicados; GitHub Pages `40356048562` terminó correctamente.
- Google Calendar incorpora OAuth servidor con scope mínimo `calendar.events`,
  `state` de un solo uso, PKCE, tokens cifrados, estado y desconexión. La
  migración `20261026160000` y `google-calendar-oauth` están desplegadas; el
  frontend añade una conexión verificable en Agenda y no almacena tokens.
- Se reutiliza el cliente OAuth existente de Gmail y se creó una clave de
  cifrado independiente. La activación queda bloqueada por
  `GOOGLE_CALENDAR_OAUTH_READY` hasta que el usuario verifique la cuenta de
  Google Cloud, habilite Calendar API y registre el callback documentado. La
  pestaña de Google Cloud quedó abierta en la pantalla de verificación de
  `apps@smyldesign.ai`; no se solicitó ni manipuló la contraseña.

## 2026-10-26 — Codex — Política visual v3.2 aplicada a todo el producto

- La revisión en producción confirmó que la primera entrega sólo cambiaba con
  claridad el shell y los componentes nuevos. Esta pasada conecta las variables
  históricas (`--azul`, `--violeta`, `--bg`, `--radius` y `--color-*`) con los
  tokens v3.2 para que la política alcance también los módulos heredados.
- Inicio incorpora un hero azul marino, métricas tipo bento y mayor contraste
  entre niveles. Cards, formularios, tablas, tabs y estados de foco comparten
  ahora bordes, radios, superficies y profundidad.
- Plan y consumo dejan de competir con la navegación en todo el producto. La
  acción `Nueva cita` queda en el HTML base y abre directamente el flujo de
  agenda, incluso antes de que termine la mejora progresiva por JavaScript.
- Web y `mobile/www` quedan sincronizados con
  `smyl-ui-template-v3.css?v=5`, `smyl-navigation.js?v=13` y una nueva caché
  PWA. No se modificaron backend, funciones, migraciones ni datos clínicos.
- Commit funcional `b37ef80` publicado en `main` y en la fuente de GitHub
  Pages. El despliegue `40341112395` terminó correctamente y producción se
  verificó tanto por recursos servidos como mediante inspección visual.

## 2026-10-26 — Codex — Política visual v3.2 publicada

- Commit funcional `1ce5e06` integrado en `main` y en la rama configurada de
  GitHub Pages `claude/camila-claude-clinical-analysis-sywxjv`.
- El despliegue `40339508746` terminó correctamente. Producción respondió `200`
  y confirmó `smyl-ui-template-v3.css?v=4`, el primario `#0B1B2E`,
  `smyl-navigation.js?v=12`, tooltips y la acción rápida `Nueva cita`.
- La entrega se rebasó sobre `f2fc45f`, conservando el nuevo Inicio, y la suite
  completa posterior a la integración terminó con **660/660 pruebas**.
- No se desplegaron funciones, migraciones, secretos ni cambios de backend.

## 2026-10-26 — Claude: Inicio más claro (lenguaje de la Agenda, saludo coherente, primeros pasos plegados)

- Se sube la propuesta que estaba en la rama `wip/inicio`, unida con el `main` actual. El usuario vio el antes y el después en capturas.
- `smyl-daily-home.js` (v9) / `.css` (v11): el saludo ya no dice «todo en orden» cuando hay pendientes: «Buenas noches. Tienes 3 pendientes
  hoy.» / «Todo al día por hoy.» (sale de la misma fuente que el panel de Pendientes). Estados con el vocabulario de la Agenda (Ya llegó,
  En consulta, Terminada, No vino) y horas como «5:00 pm». Tarjetas: «En la clínica» (ya llegaron o en consulta) y «Por aprobar». Títulos
  «Pendientes de hoy» y «Citas de hoy». Los cuatro atajos de abajo solo se ven en pantallas sin menú lateral (< 1024 px).
- `smyl-task-center.js` (v5): textos de agenda más simples (también en la campana y en Alertas): «N pacientes en la clínica», «N citas sin
  marcar», «N citas por aprobar», «N avisos sin enviar», «N pacientes no vinieron».
- `smyl-clinic-setup.js` (v4) / `.css` (v2): «Configura tu clínica» empieza plegada y muestra solo el siguiente paso con «Ver los N pasos»;
  la preferencia sigue guardándose por clínica.
- Se conserva lo de PR #48: Inicio pide solo los nombres de los pacientes de hoy (`namesFor`). `app.html`, `sw.js` y `mobile/www/`
  sincronizados; se actualizaron las pruebas que fijaban textos y versiones.
## 2026-10-25 — Codex — Implementación visual v3.2

- La política v3.2 ya gobierna el shell compartido: azul marino `#0B1B2E`
  como primario, superficies claras, turquesa sólo como acento y radios,
  bordes y sombras normalizados.
- Botones, cards y campos heredados reciben los mismos tokens. Los botones
  incorporan hover, foco, presión, deshabilitado y carga con movimiento
  reducido cuando el sistema lo solicita.
- El sidebar conserva 256 px expandido y pasa a 88 px compacto. La identidad
  se reduce a una fila; plan y consumo quedan fuera de la navegación
  persistente y siguen disponibles en Mi cuenta.
- Se añadió la acción contextual `Nueva cita`, tooltips accesibles por hover o
  teclado y un flyout para `Negocio` en modo compacto. Las rutas y la
  preferencia guardada no cambian.
- Se simplificó el shell a `Inicio`, `Nueva tarea` y `Nueva simulación`, sin
  cambiar reglas clínicas ni lógica de datos.
- Web y `mobile/www` usan `smyl-ui-template-v3.css?v=4`,
  `smyl-navigation.js?v=12` y la caché PWA incluye el sufijo
  `visual-policy-32`. El script de sincronización ahora incluye navegación.
- Figma no expone keyframes en el frame de referencia; se conservó una
  transición CSS de 260 ms con la curva normativa y soporte para
  `prefers-reduced-motion`, sin inventar una animación ajena al diseño.
- Pruebas de contrato específicas: **24 aprobadas**. Suite completa:
  **660 pruebas aprobadas**, sin fallos.

## 2026-10-25 — Codex — Política visual SMYL v3.2

- Se creó `docs/POLITICA_VISUAL_SMYL_V3.md` como normativa visual vigente,
  basada en los patrones de los frames `Dark` (`105:1897`) y `Light`
  (`105:2295`) del sidebar de referencia en Figma.
- El azul marino (`#0B1B2E`) queda definido como color principal de SMYL; el
  turquesa pasa a ser acento funcional para selección, continuidad y foco.
- La política normaliza paleta, proporción de color, tipografía, radios,
  profundidad, sidebar expandido/compacto, tooltips, flyouts, iconografía,
  movimiento, responsive, accesibilidad y puerta de aprobación visual.
- La revisión de las guías oficiales de 21st.dev añadió contratos canónicos
  para botones, cards, métricas, tablas, formularios, tabs, overlays,
  notificaciones y estados de carga/vacío/error. La fuente se usa como
  referencia; no se instalaron componentes externos.
- Se añadió una política de lenguaje breve: límites de palabras por componente,
  instrucciones de una idea, botones con verbo y objeto, errores accionables,
  divulgación progresiva y una prueba explícita para simplificar sin perder
  identidad, alcance o seguridad clínica.
- `docs/POLITICA_IMAGEN_SMYL.md` se conserva como normativa heredada para sus
  reglas clínicas, de privacidad y autenticidad de imagen, pero deja de gobernar
  la dirección visual cuando contradice v3.
- Cambio exclusivamente documental: no modifica interfaz, datos, backend ni
  despliegue.

## 2026-10-25 — Codex — Sidebar inspirado en Figma, expandido y compacto

**Tocado:** shell de `app.html`, plantilla visual compartida, caché PWA,
copia móvil, vista de QA y pruebas de contrato.

- Se leyó con el MCP de Figma el nodo `80:1461` del archivo comunitario
  “Sidebar Navigation Menu for Dashboard” y se usó el frame oscuro
  `105:1897` como referencia visual.
- El sidebar conserva la arquitectura y todas las rutas reales de SMYL, pero
  adopta una superficie flotante translúcida, radio amplio, perfil encapsulado,
  estado activo luminoso y botón lateral como en la referencia.
- El modo expandido mide 256 px y el compacto 80 px. La preferencia existente
  en `smyl_sidebar_collapsed` se mantiene; etiquetas e iconos ahora transicionan
  con una curva suave y `prefers-reduced-motion` desactiva el movimiento.
- En compacto aparece una marca `S`, permanecen visibles avatar, iconos,
  alertas y cierre de sesión; títulos nativos conservan el nombre de cada ruta.
- La navegación móvil no cambia: debajo de 768 px el sidebar se retira y sigue
  gobernando la barra inferior existente.
- `smyl-ui-template-v3.css` avanza a `?v=3` en web y PWA. `mobile/www` quedó
  sincronizado mediante `npm run sync:web`.
- QA visual aprobada a 1440 px (expandido y compacto), 1024 px y 390 px. La
  suite completa terminó con **660 pruebas aprobadas** tras integrar `main`.
- No se tocaron backend, migraciones, RLS, secretos, lógica clínica ni rutas.

## 2026-10-25 — Codex — SMYL UI v3 gobierna shell, controles e Inbox

**Tocado:** `app.html`, plantilla visual compartida, shell/navegación,
componentes heredados, Inbox, PWA, copia móvil y pruebas visuales.

- `smyl-ui-template-v3.css` deja de cargarse entre hojas históricas y pasa al
  final del `<head>`, por lo que ahora es la fuente normativa efectiva del
  panel en vez de ser sobrescrita por cada módulo.
- El opt-in `smyl-ui-governed` unifica tokens, navegación, barra superior,
  botones, iconos de acción, tarjetas, etiquetas, campos y focos sin cambiar
  la composición funcional de cada módulo.
- Navegación primaria usa 14 px y 44 px de alto; etiquetas y controles heredan
  la escala oficial. En móvil, botones alcanzan 44 px y campos usan 16 px para
  preservar lectura y evitar zoom automático.
- Mensajes conserva su workspace especializado, pero comparte tipografía de
  conversación, búsqueda, títulos y compositor con la plantilla general.
- Se añadió QA reproducible del shell a 1440, 1024 y 390 px. No hubo
  desbordamiento horizontal y las medidas canónicas se comprobaron sobre el
  CSS computado.
- Suite completa: **651 pruebas aprobadas**. Web, PWA y `mobile/www` quedaron
  sincronizados. No se tocaron backend, migraciones, RLS, secretos ni lógica
  clínica.

**Siguiente etapa recomendada:** migrar Trabajo diario por módulo, empezando
por Agenda y Pacientes 360, retirando gradualmente reglas tipográficas locales
en vez de agregar nuevas excepciones.

---

## 2026-10-26 — Claude: Configuración fase 2b (contenido dentro de Configuración)

- `smyl-settings-hub.js` (v3) / `.css` (v3): las tarjetas con `embed` (Sucursales y horario, Equipo y roles, Facturación, Cobros y pagos,
  Corte de caja, Plantillas de WhatsApp y Recordatorios de cita) se muestran dentro del panel de Configuración, con un botón para volver a
  la sección. No se copia ni se reescribe nada: se **reubica el mismo elemento** (la pantalla `#p-<ruta>` o la tarjeta
  `#schedule-reminders-card`) y una marca de posición (`<!--settings-hub-->`) guarda dónde estaba; al volver a la lista, al cambiar de
  sección o al ir a cualquier otra ruta (`ir()` restaura antes de navegar) regresa a su lugar. Los módulos lo siguen encontrando por su id,
  así que `smyl-reminders.js` no vuelve a montar su tarjeta (solo lo hace si no existe) y ninguna pantalla se duplica.
- Si el elemento no existe (módulo sin cargar o sin permiso), la tarjeta cae al comportamiento anterior: navega a la pantalla.
- CSS: el título grande de la pantalla incrustada se oculta (ya lo muestra la barra de Configuración) y en celular la columna usa
  `minmax(0,1fr)` para que Finanzas no se salga por la derecha.
- Siguen navegando a su pantalla (sin incrustar): Servicios y tarifas, Inventario, Horarios de la agenda, Canales/Asistente/Probar (OAuth y
  flujos propios), Mi cuenta, Marca, Directorio, Lanzamiento y Seguridad. Fase 3 (lo «Próximamente») y `wip/inicio` siguen pendientes.

## 2026-10-26 — Claude: Configuración fase 2 (enlaces directos, volver y Plantillas dentro de Canales)

- `smyl-settings-hub.js` (v2) / `.css` (v2): cada tarjeta abre la pestaña exacta de su pantalla con `target` (selector que se
  pulsa al llegar): Sucursales y horario / Equipo y roles (`[data-ca-tab]` de Mi clínica), Facturación / Cobros y pagos / Corte de
  caja (`[data-finance-tab]` de Finanzas), Canales / Asistente / Probar al asistente (`[data-connection-tab]`) y Recordatorios
  (`[data-schedule-tab="settings"]`). Tarjetas nuevas: Equipo y roles, Corte de caja, Asistente de mensajes y Probar al asistente.
- Botón «Volver a Configuración» arriba de la pantalla destino cuando se llegó desde Configuración; se oculta al ir a otra ruta.
- `smyl-navigation.js` (v11): «Plantillas de WhatsApp» sale del grupo Mensajería (ahora solo Mensajes) y vive en Configuración >
  Canales; la ruta sigue registrada en el contenedor oculto y cuenta como destino de Configuración en el menú.
- `app.html`, `sw.js`, `mobile/www/` sincronizados. Pruebas: se actualizó la de Mensajería (`smyl-whatsapp-templates`).
- Falta la fase 3 (lo «Próximamente»: formas de pago y anticipo, perfil público de WhatsApp, colaboraciones), que necesita migración y
  contrato con LANA. Rama local `wip/inicio` sin subir.

## 2026-10-26 — Claude: Configuración fase 1 (pantalla con el orden de LANA)

- Pedido del usuario: ordenar el configurador de SMYL como el panel de LANA (Negocio, Ventas y cobros, Catálogo, Canales,
  Experiencia). Es trabajo de navegación y de pantalla; se hizo a petición expresa.
- Nuevo `smyl-settings-hub.js` / `.css` (v1): ruta `configuracion` con las 5 secciones de LANA más «Seguridad y
  lanzamiento». Cada tarjeta lleva a la pantalla que ya existe (Mi clínica, Mi cuenta, Finanzas, Servicios y tarifas,
  Inventario, Agenda > Horarios y servicios, Canales, Plantillas, Recordatorios, Marca, Directorio, Lanzamiento,
  Seguridad). Lo que aún no existe sale como «Próximamente»: formas de pago y anticipo, perfil público de WhatsApp,
  colaboraciones. Solo navega: no escribe datos ni toca secretos.
- Avisos de estado de solo lectura (horario, WhatsApp, plantilla, recordatorios, servicios) con las mismas verificaciones de
  «Configura tu clínica»; `SmylClinicSetup.results()` es el nuevo accesorio (`smyl-clinic-setup.js` v3). Si no se puede
  verificar, la tarjeta no muestra aviso. Para quien no es propietario no hay avisos.
- `smyl-navigation.js` (v10): el grupo «Configuración» de nueve entradas pasó a un solo acceso. «Simulaciones» (es un
  historial de trabajo) se movió al grupo Negocio. Las rutas que ya no tienen botón (clinica, directorio, colaboraciones,
  conexiones, lanzamiento, seguridad, sim-config, mi-cuenta) quedan registradas en un contenedor oculto
  (`.pro-nav-registry`): otros módulos (`smyl-clinic-admin`, `smyl-connections`, `smyl-readiness`) agregan su botón al menú
  si no lo encuentran, y sin ese registro reaparecerían sueltos. «Configuración» se marca mientras estás en cualquiera de esas
  pantallas (`data-also`).
- `smyl-professional-v3.js` (v5): título y subtítulo de la nueva ruta. `app.html`, `sw.js` y `mobile/www/` sincronizados.
- Siguen las fases 2 (juntar recordatorios, plantillas, facturación y equipo dentro de sus secciones) y 3 (lo «Próximamente»,
  con migración y contrato con LANA). Rama local `wip/inicio` sin subir, a la espera del usuario.
## 2026-10-25 — Codex — Auditoría visual, SMYL UI v3 y biblioteca de casos

**Tocado:** auditoría/documentación visual, plantilla CSS compartida, Directorio
profesional, administrador de casos, carga web/PWA, sincronización móvil,
fixtures y pruebas de contrato.

- La auditoría de 54 archivos midió 2,202 declaraciones tipográficas, 40
  tamaños distintos y 888 declaraciones menores de 12 px tras integrar la recuperación de LANA. El informe completo
  y el plan por etapas quedaron en `docs/AUDITORIA_VISUAL_SMYL_2026-10-25.md`.
- `smyl-ui-template-v3.css` define la plantilla operativa nueva: siete niveles
  tipográficos (mínimo visible 12 px), campos de 48 px, botones consistentes,
  shell, pestañas, tarjetas, listas, carga de archivos, avisos y estados vacíos.
- Directorio profesional es el piloto: normaliza tipografía efectiva, ayudas,
  vista previa y CV; el nombre del PDF se actualiza al seleccionarlo y el control
  nativo deja de mostrar texto truncado redundante.
- Casos se convierte en biblioteca: formulario oculto hasta `Agregar caso`,
  lista de casos existentes, edición de borradores y `Quitar del perfil` para
  propietarios. Esta acción reutiliza `smyl_review_professional_case(...,
  'paused', ...)`; conserva fotos y autorización. No se agregó una eliminación
  definitiva ni una RPC inexistente.
- Web y `mobile/www` usan Directorio JS/CSS v12; PWA precarga
  `smyl-ui-template-v3.css?v=1`. Se agregó una prueba que impide aumentar la
  deuda base de microtexto y otra que valida componentes/accesibilidad de v3.
- QA visual aprobada a 1440, 1024 y 390 px para Ficha, Confianza/CV y Casos, sin
  desbordamiento horizontal. No se modificaron migraciones, Edge Functions,
  RLS, secretos, prompts ni datos clínicos.

**Siguiente etapa recomendada:** migrar shell/navegación de `app.html` y retirar
estilos tipográficos incrustados. Mantener la línea base ≤888 hasta que cada
módulo sustituya sus reglas heredadas por los tokens v3.

---

## 2026-10-24 — Claude: backend seguro de compras consumibles, etapa 8 (implementada, sin cobros reales)

Implementa `docs/CLAUDE_CONSUMABLES_STAGE8.md`. Productos siguen `active=false` y
`SMYL_CONSUMABLES_ENFORCED=false`. **No se activaron cobros reales**: la matriz de
Stripe test mode (paso 5 de la secuencia) requiere las claves que configura Ricardo.

### Puerta cero
- `tests/appointment-request-scope-guard.test.mjs`: normaliza `\r\n` → `\n` al leer la
  migración. La validación SQL de `20261022122000` no se tocó.

### Migración `20261024090000_smyl_consumables_checkout.sql` (reversible; bloque ROLLBACK al final)
- `smyl_checkout_sessions`: `public_ref` opaco (`chk_` + 32 hex) distinto del id de Stripe,
  snapshot inmutable (recurso, unidades, `price_minor`, moneda) congelado por trigger, estados
  `created|pending|completed|failed|expired|refunded` con trigger de transiciones, únicos por
  `(tenant_id, idempotency_key)` y `(provider, provider_checkout_id)`, enlace a
  `ledger_entry_id` / `refund_ledger_entry_id`, `refunded_units`, `refund_shortfall_units`.
- `smyl_payment_events`: único por `(provider, provider_event_id)`, `process_status`
  `processed|duplicate|ignored|rejected|error`, `attempt`, hash de conciliación, error ≤300.
- RLS en ambas **sin políticas** para `anon/authenticated` (revoke all): el navegador no lee ni
  escribe nada directo.
- RPC `service_role`: `smyl_consumables_checkout_begin` (idempotente con advisory lock),
  `smyl_consumables_checkout_attach`, `smyl_payment_event_record`,
  `smyl_consumables_confirm_payment` (una transacción: `for update`, verifica importe, moneda,
  metadata checkout/tenant, registra evento, acredita con `smyl_credit` y clave
  `purchase:<checkout_id>`, marca `completed`; repetido → `already_completed`),
  `smyl_consumables_mark_closed` (failed/expired sin movimiento; ignora si ya es terminal),
  `smyl_consumables_refund` (reverso `adjustment` con `source_type='package_refund'`, clave
  `refund:<checkout>:<event>`, proporcional al importe devuelto; si la clínica ya consumió,
  lo no reversible queda en `refund_shortfall_units` para conciliación manual).
- RPC `authenticated`: `smyl_consumables_can_purchase(tenant)` (`finance.manage` o
  `clinic.manage`) y `smyl_consumables_checkout_status(public_ref)` (solo tenant propio con
  permiso; devuelve `status, credited_resource, credited_units, confirmed_at`).

### Edge Functions
- `smyl-consumables-checkout` (JWT ON): `requireUser` → permiso → `begin` → Stripe Checkout
  `mode=payment` con `price_data` del snapshot, `metadata {smyl_checkout_id, smyl_tenant_id,
  smyl_product_id, smyl_kind:'consumable'}`, `idempotencyKey` por checkout, expira a 30 min,
  URLs de regreso desde `APP_URL` validado (HTTPS + host en lista). Reintento con la misma
  clave devuelve la misma URL si sigue abierta; estados terminales → 409 con `status`.
  Respuesta: `{checkout_url, checkout_id}`.
- `smyl-consumables-checkout-status` (JWT ON): valida `chk_…`, llama la RPC con el JWT del
  usuario, `Cache-Control: no-store`, 404 genérico para inexistente/ajeno.
- `smyl-consumables-webhook` (JWT OFF, sin CORS): verifica `stripe-signature` sobre el cuerpo
  crudo con `STRIPE_CONSUMABLES_WEBHOOK_SECRET`; sólo `checkout.session.completed` (acredita
  únicamente si `payment_status='paid'`), `async_payment_succeeded`, `async_payment_failed`,
  `checkout.session.expired`, `charge.refunded`; ignora sesiones sin `smyl_kind='consumable'`.
  Error de RPC → 500 para que Stripe reintente.
- `supabase/config.toml` actualizado; `tests/security-containment-stage1.test.mjs` lo verifica.

### Pruebas
- `tests/consumables-checkout-stage8.test.mjs` (13 pruebas estáticas sobre migración y funciones:
  separación comercial, JWT/firma, entrada mínima del navegador, idempotencia, snapshot
  inmutable, acreditación sólo por webhook, duplicados/fuera de orden, reembolso append-only,
  RLS/grants, metadata sin PHI, URLs de regreso, rollback, enforcement apagado).
- Suite completa en verde: `node --test tests/*.test.mjs`.
- **Pendiente (requiere Stripe test mode y claves):** pago exitoso, cancelado, expirado, webhook
  duplicado ×20, reembolso repetido, conciliación ledger↔sesión↔evento. Criterio de salida de
  la etapa NO cumplido hasta correr esa matriz; por eso productos y cobros siguen apagados.

### Secretos que debe configurar Ricardo (Supabase → Edge Functions → Secrets)
- `STRIPE_SECRET_KEY` — ya existe (usar `sk_test_…` para la matriz).
- `STRIPE_CONSUMABLES_WEBHOOK_SECRET` — **nuevo**, `whsec_…` del endpoint
  `/functions/v1/smyl-consumables-webhook` (distinto de `STRIPE_WEBHOOK_SECRET`).
- `APP_URL` — ya existe; debe ser `https://app.smyldesign.ai` (o el host de GitHub Pages).
- `SMYL_CONSUMABLES_ENFORCED` — mantener `false`.

### Despliegue exacto
1. SQL Editor: `20261024090000_smyl_consumables_checkout.sql` (versión Dashboard sin
   `begin/commit`, `$$`→`$body$`; el bloque ROLLBACK es comentario).
2. Verificar RLS: `select * from smyl_checkout_sessions` con un usuario autenticado debe fallar
   por permisos; `select smyl_consumables_checkout_status('chk_x')` debe devolver null.
3. Edge Functions desde `docs/bundles/*.single-file.ts`: `smyl-consumables-checkout` (Verify
   JWT ON), `smyl-consumables-checkout-status` (ON), `smyl-consumables-webhook` (OFF).
4. Stripe → Webhooks → endpoint nuevo con los 5 eventos → copiar `whsec_` a
   `STRIPE_CONSUMABLES_WEBHOOK_SECRET`.
5. Activar **un** producto sintético (`update smyl_consumable_products set active=true,
   price_minor=1000 where id='ai-100'`) sólo para la clínica piloto y correr la matriz en test
   mode (tarjeta 4242…, `stripe trigger checkout.session.completed` repetido, reembolso desde
   el Dashboard). Conciliar `smyl_usage_ledger` ↔ `smyl_checkout_sessions` ↔
   `smyl_payment_events`.
6. Volver a `active=false` hasta aprobar dos ciclos conciliados.

**Para Codex:** `source_type='package_refund'` es nuevo en el ledger; agregar etiqueta en
`sourceLabels` ("Reembolso de paquete"). El reverso aparece como `adjustment` (signo −).

---

## 2026-10-23 — Codex: paquete ejecutable para backend de consumibles, etapa 8

**Se auditó el punto de partida y se dejó una especificación de implementación
cerrada para Claude Code en `docs/CLAUDE_CONSUMABLES_STAGE8.md`.**

- Las funciones de suscripción `stripe-checkout` y `stripe-webhook` no deben
  mezclarse con las compras de minutos, créditos o mensajes.
- La etapa define tres funciones separadas, persistencia mínima, RLS, estados,
  conciliación atómica, reembolsos y pruebas multi-tenant/idempotentes.
- El fallo actual de `appointment-request-scope-guard.test.mjs` es un falso
  negativo por CRLF: la validación SQL de destino sí existe antes de crear la
  cita. Claude debe robustecer la prueba, no retirar la defensa.
- Los productos deben permanecer inactivos y
  `SMYL_CONSUMABLES_ENFORCED=false` hasta completar pruebas y dos ciclos de
  medición conciliada.

**Pendiente para Claude Code:** ejecutar la especificación completa. Codex no
modificó Edge Functions, migraciones, RLS, secretos, Stripe ni saldos.

## 2026-10-23 — Codex: regreso de pago verificable, etapa 7

**El centro de consumo ya maneja el regreso del checkout sin confiar en la
URL ni acreditar saldo desde el navegador.**

- `checkout=success` inicia una consulta autenticada a
  `smyl-consumables-checkout-status`; no representa un pago confirmado.
- La interfaz distingue confirmación, conciliación pendiente, cancelación,
  fallo, expiración y reembolso con mensajes compactos dentro de la misma
  pantalla.
- Sólo el estado `completed` confirmado por servidor actualiza la lectura de
  saldo; los pendientes se revisan manualmente, sin sondeo continuo.
- La referencia opaca del checkout se conserva temporalmente en
  `sessionStorage`; nunca se guardan tenant, precio, paciente, producto ni
  saldo.
- Los parámetros de regreso se limpian de la barra de dirección después de
  leerlos y el flujo cancelado declara que no hubo cargo.
- Web y móvil avanzan a consumo JS/CSS v6 y PWA
  `smyl-v262-checkout-return`.

**Pendiente para Claude Code:** implementar y probar la Edge Function de
estado, propiedad multi-tenant, webhook firmado y conciliación idempotente.
Codex no modificó backend, secretos, saldos ni proveedor de pago.

## 2026-10-23 — Codex: compra segura de paquetes preparada, etapa 6

**La interfaz de paquetes está lista para habilitar compras sin confiar en
precios ni tenants enviados por el navegador.**

- Sólo productos activos, con precio e identificador entregados por servidor,
  muestran la acción Comprar.
- La revisión previa resume paquete y total en un diálogo accesible y
  responsive; los productos no configurados continúan como “Próximamente”.
- El cliente llama a `smyl-consumables-checkout` enviando exclusivamente
  `product_id` e `idempotency_key` y acepta únicamente una URL HTTPS.
- La interfaz declara que el saldo se acredita por webhook seguro, nunca por
  regresar del checkout, cerrar la ventana o recargarla.
- El contrato de servidor, expiración, reembolso e idempotencia quedó
  documentado.
- Web y móvil avanzan a consumo JS/CSS v5 y PWA
  `smyl-v261-secure-checkout`.

**Pendiente para Claude Code:** implementar la Edge Function, proveedor de
pago, tabla de sesiones, webhook firmado, acreditación y reembolsos. Mantener
productos inactivos hasta completar pruebas. Codex no modificó backend,
secretos, precios ni saldos.

## 2026-10-23 — Codex: historial conciliable y exportación segura, etapa 5

**El historial de consumo ya está preparado para revisión administrativa sin
exponer telemetría interna ni información clínica.**

- Añade filtros por recurso, movimiento y periodo: mes actual, 90 días o todo
  lo cargado.
- Con las RPC consolidadas, los filtros se procesan en servidor y el cursor
  permite cargar más movimientos sin repetir filas.
- Durante la transición, los filtros siguen funcionando sobre las 100 filas
  seguras del libro mayor actual.
- La exportación CSV contiene únicamente fecha, recurso, origen, movimiento,
  cantidad y saldo posterior; neutraliza fórmulas y excluye identificadores,
  tokens, costes, prompts y datos clínicos.
- Si existen más páginas, la interfaz aclara que se exportó sólo lo cargado.
- Web y móvil avanzan a consumo JS/CSS v4 y PWA
  `smyl-v260-usage-history`.

**Pendiente para Claude Code:** implementar filtros y cursor opaco en
`smyl_usage_history` conforme al contrato. No se modificaron backend, RLS,
funciones ni cobros.

## 2026-10-23 — Codex: avisos de consumo confirmados, etapa 4

**El centro de consumo ya traduce límites reales en avisos útiles sin llenar la
pantalla ni bloquear el trabajo clínico.**

- Los avisos permanecen ocultos si el servidor no entrega una cuota real.
- Con lectura consolidada aparecen a 70 %, 85 % y 100 %, distinguiendo aviso,
  prioridad y límite alcanzado.
- En `billing_mode = meter_only` la interfaz aclara que el servicio no será
  bloqueado durante el piloto.
- Cada aviso enlaza al detalle del recurso y funciona también en móvil.
- La política y sus umbrales quedaron incorporados al contrato técnico.
- Web y móvil avanzan a consumo JS/CSS v3 y PWA
  `smyl-v259-usage-alerts`.

**Pendiente para Claude Code:** devolver `limit_units`, `used_units`, `status`
y `plan.billing_mode` desde `smyl_usage_overview`. No se modificaron backend,
RLS, funciones, saldos ni enforcement.

## 2026-10-23 — Codex: cliente preparado para medición centralizada, etapa 3

**Plan y consumo ya puede adoptar las lecturas consolidadas sin romper el
panel mientras el backend está pendiente.**

- El cliente intenta primero `smyl_usage_overview` y `smyl_usage_history` con
  los argumentos y respuestas documentados en el contrato de etapa 2.
- Si las RPC todavía no existen o fallan, vuelve de manera segura a
  `smyl_wallets` y `smyl_usage_ledger`; el estado visual informa que se trata
  de una lectura compatible durante la transición.
- Se añadió compatibilidad con `meta_messages` y se conserva
  `whatsapp_messages` como recurso histórico sin perder saldos.
- Almacenamiento acepta snapshots reales cuando el servidor los entregue y
  sigue mostrando estado pendiente, nunca `0 GB`, mientras no existan.
- Web y móvil comparten la misma implementación. PWA avanza a
  `smyl-v258-usage-api-ready`.

**Pendiente para Claude Code:** crear las RPC con el contrato exacto de
`docs/SMYL_USAGE_METERING_STAGE2.md`. Hasta entonces la interfaz permanece
operativa con las tablas existentes. No se modificaron funciones, migraciones,
RLS, secretos ni cobros.

## 2026-10-23 — Codex: contrato de medición centralizada, etapa 2

**Se dejó lista la especificación de servidor para consolidar MILA, IA, Meta y
nube sin activar cobros.**

- Nuevo contrato: `docs/SMYL_USAGE_METERING_STAGE2.md`.
- Se separan cartera comercial, telemetría técnica y almacenamiento por cuota.
- Se define transición segura de `whatsapp_messages` a `meta_messages`, con
  canal explícito y sin perder saldos históricos.
- Se especifican eventos firmados LANA → SMYL sin cuerpo de mensajes ni datos
  del paciente, junto con idempotencia, conciliación y mapeo seguro de tenants.
- Tokens y coste de proveedor quedan en auditoría interna; la clínica continúa
  viendo minutos, créditos, mensajes y GB.
- Se detallan lecturas para el frontend, permisos por rol, tarifas versionadas,
  snapshots de Storage, fases de despliegue y matriz de aceptación.

**Pendiente para Claude Code:** implementar migraciones, RLS, funciones,
adaptadores de IA, receptor firmado de LANA, snapshots de nube y pruebas. Debe
mantener `SMYL_CONSUMABLES_ENFORCED=false` hasta completar dos ciclos de
conciliación. Codex no modificó backend, secretos, saldos ni producción.

## 2026-10-23 — Codex: Plan y consumo, etapa visual y de lectura

**La pantalla aislada de consumibles se convirtió en un centro de control inspirado en la claridad de LANA, adaptado al vertical dental de SMYL.**

- `Consumos` pasa a llamarse `Plan y consumo` en el panel y en MILA.
- La nueva navegación contextual separa Resumen, MILA e IA, Canales de Meta,
  Almacenamiento e Historial sin mezclar saldos de recursos distintos.
- Resumen conserva como fuente real `smyl_wallets`, `smyl_consumable_products`
  y `smyl_usage_ledger`; calcula actividad del periodo con movimientos del
  servidor y no inventa límites ni precios.
- El historial muestra hasta 100 movimientos, permite filtrar por recurso y
  tipo, distingue consumo, medición piloto, crédito, reembolso y ajuste, y
  conserva el saldo posterior.
- WhatsApp aparece como medición disponible; Instagram y Messenger se marcan
  pendientes de consolidación desde LANA. Nube aparece pendiente y no como
  `0 GB`, evitando una cifra falsa antes del medidor por tenant.
- La vista explica que la escritura manual no consume, que el dentista opera
  con créditos y que tokens de entrada/salida/caché pertenecen a la auditoría
  administrativa del servidor.
- Web y móvil comparten `smyl-consumption.js` v1 y
  `smyl-consumption.css` v1. PWA avanza a `smyl-v257-plan-consumption`.

**Pendiente para Claude Code:** ampliar el contrato de recursos para nube y
canales Meta; centralizar tokens de todas las funciones de IA; firmar eventos
LANA → SMYL; definir límites/periodos/paquetes y mantener
`SMYL_CONSUMABLES_ENFORCED=false` hasta validar dos ciclos. No se modificaron
Edge Functions, migraciones, RLS, secretos ni cobros.

## 2026-10-22 — Codex: sistema visual unificado del expediente

**La ficha deja de apilar el resumen nuevo sobre el workspace clínico anterior.**

- La cabecera del expediente ahora contiene una sola identidad del paciente,
  datos de contacto, acceso protegido y una única entrada al asistente.
- Resumen, Historia clínica, Tratamiento y Archivos se comportan como áreas
  excluyentes: sólo se muestra una a la vez. El workspace de tratamiento ya no
  aparece debajo del resumen.
- Se ocultaron dentro de Tratamiento la segunda cabecera, los accesos rápidos,
  el texto introductorio y la navegación duplicada del workspace legado; se
  conservan sus editores, estados y protecciones clínicas.
- Se normalizó la tipografía a una escala legible de 11, 12, 14, 17 y 24 px;
  desaparecen los textos operativos de 8–9 px y el asistente duplicado del
  bloque de siguiente paso.
- Web y móvil avanzan a Patient 360 JS v8/CSS v6. Las nuevas URLs versionadas
  actualizan los recursos sin cambiar el identificador general de caché PWA.

**Alcance:** frontend/UX únicamente. No se modificaron Supabase, RLS, prompts,
secretos ni datos clínicos.

## 2026-10-22 — Codex: expediente clínico compacto y asistente de ficha

**El expediente deja de repetir tableros y abre con una lectura clínica breve,
orientada a la siguiente acción.**

- Se eliminó el resumen de etapa 2 que duplicaba antecedentes, odontograma,
  plan y seguimiento sobre la misma pantalla.
- La navegación principal se redujo a Resumen, Historia clínica, Tratamiento y
  Archivos; las acciones secundarias del paciente viven bajo “Más acciones”.
- Los estados sin información dejaron de mostrarse como alertas positivas; las
  alertas clínicas aparecen únicamente cuando existen.
- Historia clínica abre en modo lectura y el formulario sólo aparece cuando un
  rol con permiso selecciona Editar.
- Se añadió el Asistente de ficha: resume datos existentes, identifica campos
  por confirmar y propone el siguiente paso. Es apoyo de flujo, no diagnostica,
  no modifica registros y toda acción requiere revisión profesional.
- Esta primera capa funciona localmente sobre información ya autorizada en la
  ficha. La conexión generativa con Claude debe usar el secreto
  `ANTHROPIC_API_KEY` únicamente desde una Edge Function protegida.
- Web y móvil avanzan a Patient 360 JS v7/CSS v5, compatibilidad Stage 2 v2 y
  shell profesional JS v4/CSS v7.

**Validación:** sintaxis JavaScript aprobada, suite completa 427/427 en verde y
revisión visual del resumen y del asistente en navegador local.

## 2026-10-22 — Claude → Codex: asistente del perfil público, fase 1 (backend listo)

El usuario aprobó un asistente de IA dentro de la ficha pública: responde con la ficha publicada,
ofrece huecos reales y crea la solicitud desde la conversación. Backend hecho; falta la UI.

### Backend (Claude)
- Migración `20261022140000_smyl_public_profile_assistant.sql`:
  - `smyl_public_available_slots(tenant, professional, branch, service, from, days, step, limit)` →
    jsonb `[{starts_at, ends_at}]`. Reutiliza `smyl_validate_service_appointment_slot` por candidato
    (clínica, profesional, citas con preparación, sillón, bloqueos, apartados). Solo `service_role`.
  - `smyl_public_assistant_conversations` (transcript, `visitor_key`, `appointment_request_id`,
    caduca a 30 días). Lectura: equipo con `smyl_can_edit_professional_profile` o `schedule.manage`.
  - `smyl_assistant_conversation_for_request(p_request_id)` → `{id, status, created_at, messages}`
    para Agenda (requiere `schedule.read`).
- Edge Function `public-profile-assistant` (anónima, Verify JWT OFF, tope 60 msg/h por IP, 40 turnos
  por conversación). Modelo con la ficha en system prompt cacheado; herramientas
  `consultar_disponibilidad` y `crear_solicitud` (misma RPC que el formulario, exige consentimiento
  explícito). Registra `request_sent` en métricas.

### Contrato para la UI (`POST /functions/v1/public-profile-assistant`, header `apikey`)
```json
// abrir:   { "profile_slug": "dr-hernan-partida", "action": "start", "visitor_id": "<uuid localStorage>" }
// mensaje: { "profile_slug": "…", "conversation_id": "<uuid>", "visitor_id": "…", "message": "¿Cuánto cuestan las carillas?" }
```
Respuesta: `{ conversation_id, reply, blocks, can_book, request_id?, resumed?, history? }`
- `blocks[]`: `{type:"slots", branch_id, service_id, options:[{starts_at, label}]}` → pintar como
  **botones**; al tocar uno, enviar como mensaje "Quiero el <label>" (el modelo recibe el texto).
  `{type:"request_created", request_id}` → tarjeta "Solicitud enviada · la clínica te contactará".
- `can_book=false` → la ficha no habilita solicitudes (mismo `requestReady` del formulario); el
  asistente solo responde dudas y remite al teléfono.
- `resumed=true` en `start` → hay historial (`history[]` con `{role,text,at,blocks?}`): pintarlo y
  saludar con "Hola de nuevo".
- Errores: `429` (tope), `503` (sin ANTHROPIC_API_KEY), `502` (modelo), `404` (perfil no publicado).

### UI a maquetar (Codex)
1. Burbuja flotante abajo-derecha en `dentista.html` con foto/inicial y "Pregúntale al consultorio";
   en móvil convive con la barra fija (botón "Chat" a la izquierda de WhatsApp).
2. Panel de chat (ancho 380, alto 560; móvil pantalla completa): cabecera con nombre + "Asistente
   automático · la clínica confirma", lista de mensajes, chips de inicio ("¿Qué tratamientos hay?",
   "¿Dónde está la clínica?", "Quiero una valoración"), input con botón enviar, aviso fijo
   "No sustituye una valoración profesional".
3. Bloques: horarios como botones (2–3 por fila), tarjeta de solicitud creada, tarjetas de
   tratamiento cuando el texto mencione uno (opcional, v2).
4. `visitor_id`: uuid en `localStorage` (`smyl_visitor`) para retomar en 24 h; `conversation_id`
   en `sessionStorage`.
5. Agenda → Por aprobar: si `source='patient_portal'` y existe conversación
   (`sb.rpc('smyl_assistant_conversation_for_request', {p_request_id})`), botón "Ver conversación"
   que abre el transcript en un diálogo de solo lectura.
6. Métrica: llamar `smylTrack('cta_click')` al abrir el chat (ya existe en `dentista.html`).

### Despliegue (usuario)
Migración en SQL Editor (sin `begin/commit`, `$$`→`$body$`), función `public-profile-assistant`
con Verify JWT **OFF**; usa el secret `ANTHROPIC_API_KEY` ya existente.

---

## 2026-10-22 — Claude: ningún módulo se queda en 1,000 pacientes

- `smyl-daily-home.js` (v8): Inicio ya no descarga a todos los pacientes; pide solo los nombres de las citas y solicitudes de
  hoy (`namesFor`, lotes de 100 con `.in('id', …)`).
- `smyl-inventory.js` (v7), `smyl-clinic.js` (v13, selector de pacientes del caso) y `smyl-case-client.js` (v2): piden la lista
  por páginas de 1,000 (hasta 10,000) con `.range()`; antes PostgREST la cortaba en 1,000 sin avisar.
- Con esto queda resuelto el pendiente anotado en la entrada de «Pacientes con próxima cita». `app.html`, `sw.js` y
  `mobile/www/` sincronizados.

## 2026-10-22 — Claude: alinear captación pública con las decisiones del usuario (Turnstile opcional, publicado basta)

Dos ajustes sobre `1e7c76f` (Codex: captación segura), decididos con el usuario:

1. **Turnstile vuelve a ser opcional.** `dentista.html` tenía la site key `0x4AAA…` que no está
   configurada (el widget mostraba "Troubleshoot") y `public-appointment-request` respondía 503 sin
   `TURNSTILE_SECRET_KEY`: el formulario público quedó inutilizable en producción. Ahora:
   `TURNSTILE_SITE_KEY = ""` en `dentista.html` (y copia móvil); la función verifica Turnstile **solo si**
   el secret existe; sin él siguen el honeypot y el tope por IP. Cuando el usuario cree el widget en
   Cloudflare (hostname `app.smyldesign.ai`): poner la site key en `dentista.html` y el secret en
   Supabase Secrets, y la protección se activa sola. Test actualizado en
   `tests/public-appointment-intake-continuity.test.mjs`.
2. **Publicado basta para recibir solicitudes.** `smyl_create_public_appointment_intake` exigía
   `verification_status = 'verified'`; como desde v10 el dueño publica sin verificación, toda ficha
   publicada-sin-verificar quedaba visible pero rechazaba solicitudes. Nueva migración
   `20261022130000_smyl_public_intake_published_only.sql` quita esa condición; la verificación sigue
   como insignia (`verified_profile`). Se conservan foto, presentación, bio, especialidad y cédula
   como requisitos.

3. **El perfil público también exigía verificación para mostrar el formulario.** `dentista.html`
   calculaba `canRequest` con `verified_profile`, así que una ficha publicada-sin-verificar mostraba
   "Disponibilidad en actualización" sin formulario. Ahora `requestReady()` replica los requisitos de
   la RPC (acepta pacientes, servicio, sede, foto, presentación ≥12, bio ≥80, especialidad, cédula).
   Si falta alguno, se mantiene el estado "Disponibilidad en actualización" + "Llamar a la clínica".

**Estado de producción (importante para Codex):** hasta hoy la BD de producción NO tenía las 4
migraciones de `1e7c76f`. El usuario las aplica junto con la nueva (en orden 1→5, versiones para
el Dashboard sin `begin/commit`) y redespliega `public-appointment-request` desde
`docs/bundles/`. Codex: no cambiar la política de Turnstile sin avisar; la decisión del usuario es
"opcional hasta que exista la clave".

---

## 2026-10-22 — Claude → Codex: revisión UX del módulo Agenda (aprobada por el usuario)

Revisión de `smyl-schedule.js` / `.css` con el usuario. Todo lo de abajo es maquetación/UX
(Codex); Claude deja los datos listos donde se indica. Orden = prioridad.

### A. Pestaña "Horarios y servicios" → renombrar a "Horarios" y dejar solo eso
Hoy mezcla tres bloques sin relación y el único crítico (Disponibilidad) está al final.
1. **Quitar "Recordatorios por WhatsApp"** de Agenda. Vive en Mensajes/Conexiones. Si se
   conserva un acceso aquí, una sola línea: "Recordatorios desactivados · [Activar]"; nunca las
   cuatro cajas de contadores cuando está desactivado.
2. **Reducir "Servicios activos"** a una línea: "5 servicios activos · Editar catálogo →"
   (`window.ir('precios')`). Es solo lectura; no merece una tarjeta.
3. **Disponibilidad como semana, no como tarjetas repetidas**: una fila por profesional con
   Lun–Dom y el rango en cada celda (`09:00–18:00`); clic en celda = editar/agregar ese día.
   Hoy "Dr. Hernán Partida · Lun 09:00–18:00" ×5 parece un error.
4. **Horario de la clínica en la misma pantalla**, arriba del de profesionales
   (`state.clinicHours`, tabla `smyl_clinic_hours`), para que se vea "la clínica abre 9–18,
   yo atiendo 10–17" sin ir a Mi clínica. Mi clínica puede seguir mostrándolo.
5. **Vacío útil**: profesional sin horario → fila en rojo "Sin horario — no se le pueden
   agendar citas · [Agregar]". Es la causa #1 del error al crear cita (`hoursIssues()`).

### B. Arranque en vacío (clínica nueva)
Checklist arriba del calendario cuando falte algo; desaparece al completarse:
`1 Horario de la clínica · 2 Horario del profesional · 3 Al menos un servicio · 4 Comparte tu perfil`.
Se calcula desde `state` sin consultas nuevas: `state.clinicHours.some(h=>h.active)`,
`state.hours.some(h=>h.active)`, `state.services.some(s=>s.active)`. Para "perfil publicado"
consultar `smyl_professional_profiles` (`status='published'`) una vez al cargar; si Codex prefiere
que Claude lo agregue a `load()`, avisar en esta bitácora.

### C. Chips de métricas en cero
`0 citas hoy · 0 faltan por llegar · 0 en consulta` no informa. Si `todayAppointments()` está
vacío: un solo texto "Sin citas hoy · próxima: jueves 10:00" (buscar la siguiente `confirmed`
en `state.appointments`). Chips solo cuando hay algo que contar (`renderMetrics`).

### D. Pestaña "Por aprobar" — hablar como humano
Quitar "Solicitud, no confirmación" y "Apartado vencido; volver a validar" (jerga de backend).
Cada tarjeta: nombre · **origen** (`source`: `patient_portal` = "Desde tu perfil público",
`assistant` = "Pidió por el asistente") · tratamiento · "Prefiere jue 10:00" · **teléfono con
botón WhatsApp** (`state.patients[].telefono`, `https://wa.me/52<10 dígitos>`) · un solo botón
primario "Agendar". El apartado temporal se muestra solo si está vigente, como "Horario
apartado hasta 10:45".

### E. Cabecera
"Bloquear horario" no debe pesar igual que "Nueva cita". Pasarlo a secundario o a un menú "···"
junto con "Agregar horario".

### F. Feedback que no se va
`#schedule-feedback` ("Cita ampliada: +15 min en total · Cerrar") se queda hasta que el usuario
lo cierra. Auto-ocultar a los 5 s (errores se quedan). Ver `notify()`.

### G. Móvil
La semana de 7 columnas con eje de horas (v17) no cabe en 390 px. En `<720px` vista **Día** por
defecto, con ‹ › para moverse; Semana disponible pero no inicial.

### H. Leyenda de colores
Las citas ya usan `color_token` del profesional, pero no hay leyenda. Con 2+ profesionales,
fila "● Dr. Partida ● Dra. X" arriba del calendario; clic filtra (`state.professional`).

### Lo que NO se toca (está bien)
Panel "Pendientes de hoy" y sus prioridades, ficha de cita con transiciones de estado, motivos de
cancelación en chips, validación de choques (`bookingSnapshot`) antes de guardar, horas libres
como botones (v17).

---

## 2026-10-22 — Claude: semana compacta (ajuste tras el comentario del usuario)

- El usuario no quedó convencido con la semana con eje de horas: ocupaba mucha pantalla casi vacía y la cita de las 5 pm
  quedaba fuera de la vista. Eligió «calendario compacto».
- `smyl-schedule-grid.js` (v2): `compact(windows, spans, horas)` limita el rango a lo que ocupan las citas y bloqueos con una
  hora de margen, mínimo 5 horas y sin salir del horario completo; sin citas devuelve todo el horario.
- `smyl-schedule.js` (v19) / `.css` (v13): escala de 1.2 px por minuto (antes 1.4); la semana abre compacta y un enlace al pie
  («Ver todo el horario (9 am a 6 pm)» / «Mostrar solo las citas») cambia al horario completo y se recuerda en
  `localStorage` (`smyl_schedule_week_full`). La altura de la hora viaja al CSS como `--wk-hour`, ya no hay constantes
  duplicadas. Tarjetas de 45 min con menos relleno para que quepan tres líneas.
- Conciliado con `bff1adf` (tiempo extra por cita): las versiones quedaron en `smyl-schedule.js?v=21` y `.css?v=15`, y las horas
  libres ahora cuentan el tiempo extra elegido (`duration + extra`), porque sin eso sugerían horas que el servidor rechazaba.
- Pendiente (no subido): rama local `wip/inicio` con el repaso de lenguaje del Inicio (saludo coherente con los pendientes,
  textos del centro de tareas, primeros pasos plegados mostrando el siguiente). Falta revisar con el usuario.

## 2026-10-22 — Claude: Pacientes con próxima cita, «Agendar cita» y carga completa

- `smyl-clinic.js` (v12) / `.css` (v6): la lista de Pacientes pide los registros por páginas de 1,000 (`fetchAllPatients`, hasta
  10,000); PostgREST corta cada respuesta a 1,000 filas y a partir de ahí los pacientes desaparecían en silencio. Los demás
  módulos que listan pacientes (`smyl-daily-home`, `smyl-inventory`, `smyl-clinic.js` `loadPatientSelect`) siguen con ese tope.
- Cada fila muestra «Próxima cita: jue 22 oct · 11:30 am», «Última visita: …» o «Sin citas todavía» (dos consultas de solo
  lectura a `smyl_appointments`; si fallan, la lista queda sin esa línea) y un botón «Agendar cita».
- `window.filtrarPacientes` ahora la define `smyl-clinic.js`: sin acentos, varias palabras, teléfono con espacios o guiones.
  La búsqueda de la pantalla de Pacientes sigue siendo del lado del cliente (sobre todo lo cargado).
- `smyl-schedule.js` (v18): `SmylSchedule.bookFor(paciente)` abre Nueva cita con el paciente elegido y origen `manual`
  (`forPatient` sigue siendo solo para cotizaciones aceptadas).
- `app.html`: placeholder de la búsqueda más corto. `sw.js` y `mobile/www/` sincronizados. Siguen fallando 3 pruebas que ya
  fallaban en `main`.

## 2026-10-22 — Claude → Codex: rediseño del perfil profesional (mockup aprobado)

### Para Codex: maquetar a partir de los mockups
El usuario aprobó un rediseño visual del módulo de perfil profesional. Los mockups
aprobados están en `docs/mockups/perfil-dentista/` (HTML autocontenido; abrir en
navegador o leer el markup). Canvas original: https://claude.ai/artifact/NKC5nnTjayCDH1rLdNLCpJ

- `perfil-escritorio.html` → rediseño de `dentista.html` (perfil público, escritorio)
- `perfil-movil.html` → el mismo perfil a 390px (barra fija inferior con WhatsApp + Solicitar cita)
- `editor-ficha.html` → rediseño del editor en `smyl-professional-directory.js/.css`

**Tokens visuales del mockup**: fondo `#F5F4EF`, tinta `#16211E`, verde `#1E5C4E`
(oscuro `#163F36`, tinte `#E8F1EE`), muted `#5B6B66`, borde `#E3E6E2`,
WhatsApp `#DDF5E6`/`#0B3D1F`, estrellas `#B8892B`. Tipografía: Fraunces (títulos)
+ Manrope (texto), ambas en Google Fonts.

**Perfil público (`dentista.html`)** — en orden de impacto:
1. Hero oscuro: foto grande circular, sello "Cédula verificada" (usar `verified_profile`),
   nombre serif 52px, especialidad · clínica, estrellas + conteo (de `public-patient-reviews`),
   botones WhatsApp (usar `public_phone`, mensaje prellenado) y Solicitar cita.
2. Franja de confianza (4 celdas): experiencia · idiomas · acepta pacientes · sede.
3. Tratamientos como tarjetas con ícono (de `services`), con "desde $X" opcional.
4. Formación como línea de tiempo (año a la izquierda).
5. Casos antes/después con control deslizable (los datos ya llegan de `public-professional-cases`).
6. Reseñas como tarjetas con estrellas y avatar de inicial.
7. Aside derecho: formulario de cita reducido a 3 campos visibles (nombre, teléfono, tratamiento);
   ubicación y fecha pueden ir colapsados o inferirse si hay una sola sede. El honeypot
   `website` DEBE conservarse. Debajo, tarjeta "Dónde atiende" con mapa y horarios.
8. Móvil: barra fija inferior WhatsApp + Solicitar cita.

**Editor (`smyl-professional-directory.js`)**:
1. Un solo bloque de progreso (anillo + checklist con enlaces "Subir"/"Agregar").
2. Foto se sube haciendo clic en el avatar (preview circular inmediato).
3. Idiomas y enfoque como chips con autocompletado (catálogo sugerido en el mockup).
4. Botón "Redactar con IA" en Presentación → Claude está haciendo la Edge Function
   `smyl-profile-copy` (ver abajo); la UI puede dejar el botón listo con un stub.
5. Formación/membresías como entradas estructuradas (año · título · institución).
6. Vista previa derecha = hero del perfil público, idéntico.
7. Slug pre-llenado desde el nombre; guardado automático de borrador.

### Backend listo (Claude) — contratos para el frontend

**1. Redactar con IA — `POST /functions/v1/smyl-profile-copy`** (sesión requerida, `Authorization: Bearer <jwt>` + `apikey`)
```json
{ "professional_id": "<uuid>", "display_name": "…", "specialty": "…", "clinic_name": "…", "city": "…",
  "years_experience": 5, "languages": ["Español"], "treatment_focus": ["Carillas"],
  "education": ["2018 · Cirujano Dentista · UNAM"], "memberships": [],
  "accepts_new_patients": true, "tone": "cercano|equilibrado|formal",
  "current_headline": "…", "current_bio": "…", "instructions": "más corto" }
```
Respuesta `200`: `{ "headline": "…", "bio": "…", "missing": ["Agrega la universidad…"] }`.
Errores: `400` (faltan nombre y especialidad/tratamiento), `403` (no puede editar ese perfil), `422` (no se pudo redactar), `429/502/504`.
Requiere el secret `ANTHROPIC_API_KEY` en Supabase (ya existe para la función `claude`).
Mostrar `missing` como lista de pendientes bajo el texto generado; los botones "Más cercano/Más formal" solo cambian `tone`.

**2. Métricas — eventos anónimos + resumen**
- Migración `20261022010000_smyl_profile_events.sql`: tabla `smyl_profile_events` + RPC `smyl_profile_metrics(p_professional_id, p_days)`.
- `dentista.html` ya registra `view` al pintar y `share_click` al compartir; expone `window.smylTrack(kind)` para que el nuevo diseño llame `smylTrack('whatsapp_click')` y `smylTrack('cta_click')` en los botones. `request_sent` lo registra el backend al enviar una solicitud.
- Editor: `sb.rpc('smyl_profile_metrics', { p_professional_id, p_days: 30 })` devuelve
  `{ views, unique_visitors, whatsapp_clicks, cta_clicks, share_clicks, requests, by_day:[{day,views,requests}], top_referrers:[{host,views}] }`.
  Pintarlo como tarjeta "Tu perfil esta semana" en el editor.

**3. Open Graph al compartir** — `infra/cloudflare/og-perfil-worker.js` (ver README ahí). Requiere que el usuario lo despliegue en Cloudflare (no es código del repo en runtime). Falta subir `og-default.png` (1200×630) a la raíz para perfiles sin foto — Codex puede generarlo.

**4. Anti-spam** — ya existía honeypot (`website`) + límite por IP en `public-appointment-request`; no se tocó. El campo honeypot DEBE conservarse en el rediseño del formulario.

**Despliegue pendiente (usuario)**: aplicar migración en producción (SQL Editor), desplegar `smyl-profile-copy`, `public-profile-event` y `public-appointment-request` (bundles en `docs/bundles/` si se generan, o `supabase functions deploy`), y el Worker de Cloudflare.

---

## 2026-10-22 — Claude: fix error 42501 al guardar ficha ya publicada

### Qué se hizo
- **Nueva migración** `20261022000000_smyl_fix_published_profile_save.sql`: reemplaza `smyl_save_professional_profile` con una versión que solo exige `team.manage` para PUBLICAR por primera vez o para PAUSAR un perfil. Si el perfil ya está en estado `published`, cualquier usuario con `smyl_can_edit_professional_profile` puede seguir guardando cambios sin necesitar `team.manage`.
- **Raíz del problema**: la versión anterior bloqueaba cualquier guardado con `status='published'` independientemente de si era un cambio de estado o solo una actualización de contenido. El frontend siempre devuelve el estado actual del perfil, por lo que cada click en "Guardar cambios" en un perfil publicado disparaba la excepción 42501 → los datos nunca se escribían en BD → se perdían al recargar.

### Archivos tocados
- `supabase/migrations/20261022000000_smyl_fix_published_profile_save.sql` (nueva)
- `docs/HANDOFF.md`

### Pendiente
- Aplicar la migración en producción (`rpxshsiwoxdbuevjjpfw`) via Supabase Dashboard → SQL Editor (igual que la migración de backfill anterior).

---

## 2026-10-22 — Claude: Nueva cita con horas libres como botones

- `smyl-schedule-slots.js` (v1, nuevo): cálculo puro de horas libres. Copia la regla de
  `smyl_validate_service_appointment_slot`: horario de la clínica y del profesional, citas confirmadas/llegó/en consulta con
  su preparación antes y después, sillón, bloqueos activos y apartados vigentes de solicitudes; no cruza la medianoche y
  respeta la zona horaria de la sucursal (probado con Ciudad de México y Tijuana).
- `smyl-schedule.js` (v17) / `.css` (v12): en Nueva cita y Cambiar horario aparecen 7 días (cerrados deshabilitados) y los
  horarios libres cada 30 min (15 si no hay ninguno). Un toque pone la hora y, si no hay sillón elegido, el primero libre.
  Consulta citas, bloqueos y apartados de la sucursal para el día elegido (caché de 30 s); si falla, avisa y deja escribir la
  hora a mano.
- **Son sugerencias.** El servidor sigue validando al confirmar (`smyl_create_appointment`). Con alcance de datos «propio» la
  consulta no ve citas de otros profesionales, así que un choque de sillón puede aparecer libre y el servidor lo rechazará.
  La versión definitiva sería una función SQL `security invoker` por usuario (la existente, `smyl_inbox_available_slots`, solo
  está abierta a `service_role`); requiere migración y no se hizo porque el conector de Supabase no tiene permiso.
- `app.html`/`sw.js`/`mobile/www/` sincronizados. Siguen fallando 3 pruebas que ya fallaban en `main`.

## 2026-10-22 — Claude: Agenda, semana con eje de horas

- `smyl-schedule-grid.js` (v1, nuevo): funciones puras de la cuadrícula (`bounds`, `lanes`, `slotAt`, `size`, `toMinutes`),
  probadas en `tests/smyl-schedule-grid.test.mjs`.
- `smyl-schedule.js` (v15) / `.css` (v10): la semana ahora es un calendario con eje de horas (`renderWeekGrid`): citas con la
  altura de su duración (1.4 px por minuto, constante `WK_PX`; el fondo de líneas horarias del CSS usa 84 px por hora y debe
  seguir a esa constante), citas encimadas lado a lado, bloqueos rayados, horas cerradas en gris, días y horas pasadas
  atenuados, línea roja de «ahora» que se mueve cada minuto, y clic en un hueco para abrir Nueva cita (con vista previa
  «+ 12:30 pm» al pasar el cursor, ajustada a 15 min). La semana sin citas conserva su pantalla vacía con «Agendar una cita».
  Si `SmylScheduleGrid` no cargó, se usa la vista de tarjetas anterior (`renderWeekCards`).
- En celular (ancho ≤ 700 px) la Agenda abre en vista Día; la semana sigue disponible con desplazamiento horizontal.
- Las etiquetas de hora de la vista Día usan el mismo formato («9 am»). El título del periodo en Día y Mes ya no pone
  mayúscula en «De».
- Conciliado con el cambio de otra sesión (hueco clicable y línea de ahora en la vista Día, `b40c881`): se conservó su vista Día
  y se sumó la cuadrícula semanal; las versiones quedaron en `smyl-schedule.js?v=16` y `smyl-schedule.css?v=11`.
- `app.html`/`sw.js` y `mobile/www/` sincronizados. Siguen fallando 3 pruebas que ya fallaban en `main` (directorio, casos y
  reseñas, por versiones de assets del directorio).

## 2026-10-22 — Claude: Agenda con lenguaje claro, ficha de cita nueva y mensajes desde la ficha

- Pedido del usuario: la Agenda se sentía complicada (mucho texto, lenguaje técnico), mejorar la ficha de la cita y poder
  enviar plantillas de Meta desde ahí. Es trabajo visual que normalmente es de Codex; el usuario lo pidió expresamente
  aquí. Si Codex tenía algo en curso en `smyl-schedule.js`, hay que reconciliar con este cambio.
- `smyl-schedule.js` (v14) / `.css` (v9):
  - Resumen del día en una franja de chips (citas hoy, faltan por llegar, en consulta; «por aprobar» y avisos solo si
    hay). «Pendientes de hoy» se oculta cuando no hay nada. Encabezado sin texto de relleno.
  - Filtros de sucursal, equipo y sillón se ocultan solos cuando solo hay una opción. En Nueva cita la sucursal se
    oculta si hay una sola (el valor sigue preseleccionado).
  - Horas como «5:00 pm» y rangos «5:00 a 5:45 pm»; la semana muestra «Sin citas / 9:00 am a 6:00 pm / + Agendar» y
    «Cerrado»; tarjetas de cita con letra más grande y sin avatar en semana.
  - Lenguaje: Tratamiento, Atiende, Sillón, Nota para recepción, Citas por aprobar, Horarios y servicios, No vino, Ya
    llegó, En consulta, Terminada. Se quitó el texto técnico de «Control de reserva» (ahora «Resumen»).
  - Ficha de la cita rediseñada (`openAppointment`): encabezado con avatar, estado y fecha; datos en filas; una sola
    acción principal según el estado; «No vino» y «Cancelar cita» como acciones secundarias.
  - Cancelar ya no usa `window.prompt`: cuadro con motivos rápidos (`openCancel`); el motivo se manda igual a
    `smyl_transition_appointment`.
- Nuevo `smyl-schedule-message.js` (v1): «Escribirle al paciente» dentro de la ficha. Sin backend nuevo:
  - Chat del paciente: `camila_lana_handoffs` (lectura por RLS de miembro), el mismo vínculo que usa el recordatorio.
  - WhatsApp: plantillas aprobadas de `lana-inbox?action=templates`; se cruzan por nombre con `SmylTemplateCatalog`
    para llenar las variables con datos de la cita (mismo formato que `appointment-reminders`). Datos libres o
    faltantes (cómo llegar, teléfono de la sucursal) se piden al equipo, nunca se envían vacíos. Envío:
    `lana-inbox` `action:'send'`, `type:'template'`, con `Idempotency-Key`. Requiere `messages.respond` (si no, la
    sección se oculta; el servidor lo vuelve a validar).
  - Instagram y Messenger: texto libre (con el catálogo como punto de partida) por `type:'text'`; LANA decide si la
    ventana de 24 h lo permite y el error se muestra tal cual. No probado contra LANA real.
  - Si el paciente no tiene chat vinculado o no hay plantillas aprobadas, la sección lo dice y lleva a Mensajes o
    Plantillas.
- `app.html`/`sw.js`: scripts `smyl-schedule.js?v=14`, `smyl-schedule.css?v=9`, `smyl-schedule-message.js?v=1`; copias
  en `mobile/www/` sincronizadas. Pruebas: `tests/smyl-schedule-message.test.mjs` y varias pruebas de copy actualizadas.
- Pendiente conocido (no mío): 3 pruebas fallan ya en `main` (`professional-directory`, `professional-cases-stage2`,
  `verified-patient-reviews-stage3`): fijan versiones viejas de assets del directorio. Además
  `mobile/www/smyl-professional-directory.{js,css}` están desincronizados con la raíz.
- Nota: `appointment-reminders` (backend) formatea la hora como «5:00 p.m.» y las plantillas ya traen punto después,
  así que el recordatorio automático puede salir con «p.m..». La ficha lo corrige al enviar; el recordatorio
  automático queda igual.

## 2026-10-22 — Codex: perfil público profesional y captación segura de citas (v255)

### Qué se hizo
- **Perfil público rediseñado** (`dentista.html`, `smyl-public-profile.css`): jerarquía editorial clínica, retrato y credenciales, servicios, sedes, opiniones verificadas, casos autorizados, datos estructurados y solicitud de cita en tres pasos. La solicitud se presenta como preferencia, nunca como cita confirmada.
- **Responsive y accesibilidad**: escritorio en dos columnas; tableta y móvil en una; contenido de confianza antes del formulario; credenciales colapsables en móvil; controles táctiles de al menos 44 px; CTA móvil contextual que desaparece cuando el formulario está visible; sin desbordamiento horizontal a 1440, 834, 390 y 320 px.
- **Publicación profesional protegida** (`smyl-professional-directory.js`): sólo cuentan servicios activos, cambiar cédula o CV retira la ficha de publicación y la pasa a revisión, y un CV recién subido se elimina si el guardado falla.
- **Captación pública aislada** (`20261021170000_smyl_public_appointment_intake.sql`): nombre, contacto, preferencias y mensaje viven fuera de `camila_pacientes`; una RPC de servicio valida perfil, servicio y sede en la misma transacción. RLS permite que sólo el equipo con alcance operativo lea la captación.
- **Revisión humana en Agenda** (`smyl-schedule.js`, `smyl-schedule.css`): la solicitud pública muestra sus preferencias, obliga a buscar o registrar al paciente, exige `schedule.manage` + `patients.manage`, llama `smyl_link_public_appointment_intake` y sólo entonces abre la confirmación de horario.
- **Publicación gradual segura** (`20261021180000_smyl_professional_publication_guard.sql`): una ficha heredada publicada permanece visible durante su actualización, pero sólo obtiene `verified_profile=true` y puede captar solicitudes cuando tiene verificación humana, foto, contenido mínimo, especialidad, cédula, sede y servicio activos. Cambiar CV o cédula sí la devuelve a revisión.
- **Retención preparada** (`20261022121000_smyl_public_intake_retention.sql`): función privada `service_role` para expirar solicitudes y borrar PII vencida por lotes; la auditoría conserva trazabilidad y consentimiento sin duplicar datos de contacto.
- **Decisiones de Agenda dentro del alcance** (`20261022122000_smyl_appointment_request_scope_guard.sql`): aceptar o rechazar exige acceso a la solicitud original; aceptar también valida el profesional y la sede de destino antes de crear la cita. Conocer una UUID no permite tomar solicitudes de otro dentista o sucursal.
- **Protección antiabuso cerrada** (`public-appointment-request`): si falta `TURNSTILE_SECRET_KEY`, el endpoint responde 503 y no guarda captaciones. El bundle de despliegue fue regenerado desde la fuente vigente.
- **Paridad web/PWA**: HTML, CSS, JS y service worker quedaron sincronizados; Agenda publica `smyl-schedule.js?v=14` y `smyl-schedule.css?v=9`; el sistema visual usa `smyl-design-system-v2.css?v=2`.

### Verificación
- Turnstile se monta de forma explícita al abrir el paso de contacto, evitando la carrera entre la carga del script y el perfil dinámico.
- 38/38 pruebas focalizadas de perfil público, captación, Agenda, búsqueda de pacientes, sistema visual y paridad pasan.
- Suite completa: 571/571 pruebas pasan en Windows; los harnesses de Edge Functions ya manejan rutas y finales de línea de forma portable.
- QA visual aprobada en 1440, 834, 390 y 320 px; sin overflow, formulario ordenado y CTA contextual.
- `node --check` aprobado para `smyl-schedule.js` y `smyl-professional-directory.js`.
- El bundle `docs/bundles/public-appointment-request.single-file.ts` coincide con el handler actual.

### Archivos principales
- `dentista.html`, `smyl-public-profile.css`
- `smyl-professional-directory.js`, `smyl-professional-directory.css`
- `smyl-schedule.js`, `smyl-schedule.css`
- `app.html`, `sw.js` y copias equivalentes en `mobile/www/`
- `supabase/functions/public-appointment-request/index.ts`
- `docs/bundles/public-appointment-request.single-file.ts`
- `supabase/migrations/20261021170000_smyl_public_appointment_intake.sql`
- `supabase/migrations/20261021180000_smyl_professional_publication_guard.sql`
- `supabase/migrations/20261022121000_smyl_public_intake_retention.sql`
- `supabase/migrations/20261022122000_smyl_appointment_request_scope_guard.sql`
- `tests/appointment-request-scope-guard.test.mjs`
- `tests/public-professional-profile-redesign.test.mjs`
- `tests/public-appointment-intake-continuity.test.mjs`

### Pendiente antes de producción
1. Aplicar las cuatro migraciones en orden (`20261021170000`, `20261021180000`, `20261022121000`, `20261022122000`) y desplegar `public-appointment-request` con `--no-verify-jwt`.
2. Configurar y comprobar `TURNSTILE_SECRET_KEY`; el formulario falla cerrado a propósito si falta.
3. Aprobar formalmente el plazo de retención (actualmente 90 días) antes de programar la ejecución diaria de `smyl_purge_expired_public_appointment_intakes`.
4. Publicar los archivos web sólo después de completar los tres puntos anteriores.

---

## 2026-10-21 — Claude: feedback en "Enviar a revisión" y fallback Safari (v9)

### Qué se hizo
- **Feedback visual en "Enviar a revisión"** (`smyl-professional-directory.js`, `save()`): el botón `[data-profile-finish]` ahora muestra "Enviando…" y se deshabilita durante el guardado; se restaura en el `finally`.
- **Fallback cross-browser para `event.submitter`** (Safari < 15.4 no lo soporta): en `bindForm()` se añade un click handler en cada `[data-save-status]` que guarda `form.dataset.pendingStatus` antes del submit; `save()` lee ese valor como fallback.
- **`console.error`** en el catch de `save()` para que los errores sean visibles en DevTools.
- **Scroll al feedback** después de guardar, para que el mensaje sea visible aunque el formulario sea largo.
- **Versión bumpeada a v9** en `app.html` y `mobile/www/app.html`.

### Archivos tocados
- `smyl-professional-directory.js`
- `app.html` (v9)
- `mobile/www/app.html`

---

## 2026-10-21 — Claude: checklist se actualiza en tiempo real (v8)

### Qué se hizo
- **`updateProfileLive` extiende actualización al checklist DOM** (`smyl-professional-directory.js`): antes el anillo/porcentaje se actualizaba en vivo pero el checklist leía solo del perfil guardado en BD. Ahora `updateProfileLive` también actualiza los íconos ✓/●, la etiqueta "requerido", y el encabezado del checklist en tiempo real conforme el usuario escribe.
- **Versión bumpeada a v8** en `app.html` y `mobile/www/app.html`.

### Archivos tocados
- `smyl-professional-directory.js`
- `app.html` (v8)
- `mobile/www/app.html`

---

## 2026-10-21 — Claude: mejoras UX en formulario de ficha profesional (v7)

### Qué se hizo
- **Checklist de completitud en Step 4** (`smyl-professional-directory.js`): nueva función `readinessChecklist(progress)` que reemplaza el mensaje vago "Estás muy cerca" con un checklist visual agrupado por paso (Identidad, Presentación, Confianza). Cada ítem muestra ✓/● con etiqueta "requerido" en los obligatorios y botón "Ir a completar →" por grupo si faltan campos.
- **Contadores de caracteres** en bio (mínimo 40 / máximo 1600) y headline (máximo 160). Se actualizan en tiempo real con `input`/`change`. El contador pone el número en rojo cuando no llega al mínimo, verde cuando lo cumple.
- **Feedback visual en "Guardar borrador"**: botón cambia texto a "Guardando…" y se deshabilita durante el guardado; se restaura en el `finally` independientemente del resultado.
- **CSS nuevos** (`smyl-professional-directory.css`): `.directory-checklist-*`, `.directory-char-hint`, `.btn:active`.
- **Versión bumpeada a v7** en `app.html`.
- `mobile/www/app.html` sincronizado.

### Nota para el usuario
El checklist del Step 4 lee del perfil guardado en la BD, no del formulario en vivo. Si se llena la bio en Step 2 y parece que el checklist no actualiza, hay que hacer clic en "Guardar borrador" primero — después del guardado, el panel recarga y el checklist refleja el estado real.

### Archivos tocados
- `smyl-professional-directory.js`
- `smyl-professional-directory.css`
- `app.html` (v7)
- `mobile/www/app.html`



## 2026-10-21 — Claude: auditoría de seguridad y CORS restrictivo en Edge Functions

### Qué se hizo
- **`_shared/cors.ts`** reescrito: exporta `makeCors(req)` que refleja el `Origin` del request solo si está en la lista permitida (`https://app.smyldesign.ai`, `https://rpartidaislas-cloud.github.io`); incluye `Vary: Origin`. Para endpoints públicos o server-to-server exporta `corsPublic` (sigue siendo `*`).
- **`_shared/limits.ts`**: añadido `Retry-After: 60` en respuestas HTTP 429.
- **22 Edge Functions privadas migradas** de `const CORS = { "Access-Control-Allow-Origin": "*", ... }` a módulo a `const CORS = makeCors(req)` dentro de `Deno.serve`, eliminando el wildcard en endpoints autenticados:
  - `whatsapp-templates`, `security-monitor`, `file-lifecycle-maintenance`, `invite-staff`, `lana-channels`
  - `lana-webhook`, `lana-attention`, `lana-connection`, `lana-handoff`, `lana-context`, `lana-training`
  - `secure-clinical-file`, `sign-segmentation-masks`, `meta-send`, `appointment-reminders`
  - `mila-actions`, `mila-realtime-session`, `mila-transcribe`
  - `claude` (x-tenant-id en allowed headers para modo prospecto), `lana-inbox` (requirePermission movido dentro del handler), `segment-teeth` (usa `corsHeaders`; usa `serve` de deno.land/std)
- **5 funciones mantenidas con `*`** (legítimamente públicas/server-to-server): `public-appointment-request`, `public-patient-reviews`, `public-professional-cases`, `guardar-lead-prospecto`, `analizar-foto`.
- **Bundles regenerados** en `docs/bundles/` para todas las funciones modificadas.
- **`stripe-checkout`, `stripe-portal`**: migradas por separado a `makeCors(req)` + `Cache-Control: no-store` en respuestas de facturación (no usan `requireUser` sino autenticación directa por JWT). Total: **24 funciones privadas migradas**.

### Casos especiales de CORS
- `lana-handoff`, `lana-training`, `lana-inbox`: añaden `idempotency-key` a `Access-Control-Allow-Headers`.
- `claude`, `segment-teeth`: añaden `x-tenant-id` (modo prospecto anónimo).
- `lana-attention`, `lana-connection`, `lana-context`, `lana-training`, `lana-inbox`: métodos `GET, POST, PUT, OPTIONS`.

### Para desplegar
Cada función modificada necesita redesplegarse en Supabase. Usar los bundles de `docs/bundles/` o los archivos fuente en `supabase/functions/`. No hay cambios de esquema ni de migraciones.

### Pendiente (sin código — requiere acción en Cloudflare)
1. **Headers de seguridad** vía Cloudflare → Rules → Transform Rules → Modify Response Header:
   - `X-Content-Type-Options: nosniff`
   - `X-Frame-Options: SAMEORIGIN`
   - `Referrer-Policy: strict-origin-when-cross-origin`
   - `Permissions-Policy: camera=(self), microphone=(self), geolocation=(), payment=()`
   - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
   - `Content-Security-Policy` (ver notas abajo)
2. **Cloudflare Turnstile** en `public-appointment-request` — requiere site key de Cloudflare Dashboard.

**CSP recomendada** (requiere validación manual en dev — tiene `unsafe-inline` porque la app usa muchos scripts inline):
```
default-src 'none'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://*.supabase.co https://storage.googleapis.com; connect-src 'self' https://*.supabase.co wss://*.supabase.co; worker-src 'self' blob:; frame-src https://checkout.stripe.com https://billing.stripe.com; object-src 'none'; base-uri 'self'; form-action 'self'
```


## 2026-10-21 — Claude: preparación para app.smyldesign.ai (dominio propio)

- Dominio `smyldesign.ai` en Hostinger; el panel irá en `app.smyldesign.ai` (GitHub Pages con dominio propio, donde la app
  vive en la raíz y no en `/camila/`).
- `sw.js`: `scoped()` sustituye el prefijo `/camila/` de la precarga por el alcance real del service worker (sirve en
  ambos hosts; los literales `/camila/` se conservan porque muchas pruebas los fijan).
- `manifest-app.json`, `manifestapp.json`, `manifest.json`: `start_url`, `scope` y atajos relativos (antes `/camila/...`).
- `index.html`: en `app.smyldesign.ai` redirige a `app.html` (otros hosts conservan la página).
- `my-smyl-portal.js` (v4): el enlace privado del paciente usa el dominio desde el que se abre el panel; en la app
  nativa o en localhost conserva la URL de producción de respaldo.
- **Falta (no está hecho a propósito):** el archivo `CNAME` en la raíz del repo. Se agrega solo cuando el registro DNS
  `app` ya resuelve; si se publica antes, `rpartidaislas-cloud.github.io/camila` redirige a un dominio que aún no existe.
  Pasos del lado de Supabase (URL del sitio y de redirección de Auth) y variables `APP_URL` / `SMYL_PUBLIC_APP_URL`
  de las funciones `invite-staff`, `stripe-checkout` y `lana-channels`: ver la respuesta al usuario.

## 2026-10-21 — Claude: menos «brincos» al cargar el panel y al entrar a Mensajes

- Medí los saltos de diseño (layout-shift) en un navegador de pruebas. Entrar a Mensajes, Agenda o Pacientes casi no
  mueve nada; los saltos reales estaban al arrancar y en el Inicio:
  1. `app.html`: `<body class="smyl-professional smyl-management-v3">` y el estado del menú contraído se aplican
     antes del primer pintado. Antes los ponían scripts diferidos, y todo el panel se re-estilizaba (barra lateral
     12→14 px de relleno, 8 px de salto en el menú): salto de 0.135.
  2. `smyl-clinic-setup.js` (v2): guarda su última altura y reserva el hueco desde el primer cuadro; antes la
     tarjeta «Configura tu clínica» empujaba todo el Inicio ~380 px al llegar (0.15).
  3. `smyl-daily-home.js` (v7) / `.css` (v10): ya no vuelve a mostrar esqueletos si hay datos (solo la primera vez),
     «Este mes» reserva su espacio si ya se mostró antes, y los esqueletos de chats y prioridades miden lo mismo que
     su contenido.
- `smyl-inbox.js` (v36): precarga la bandeja a los 2.5 s en segundo plano (lista, equipo, etapas, respuestas rápidas)
  para que Mensajes no se arme a la vista. `autoOpenFirst()` abre la primera conversación solo cuando el Inbox está
  activo (abrirla la marca como leída), también al entrar si la precarga terminó antes.
- Resultado medido en el Inicio con datos de prueba: 0.45 → ~0.01 de salto acumulado. Pruebas 518/518.

## 2026-10-21 — Claude: Mensajes sin canales conectados

- Bug: con el Inbox sin respuesta se veían a la vez la lista vacía, el panel «Continúa el siguiente caso» y un hilo
  fantasma (avatar vacío, «IA activa», compositor), desalineados. Causa: `.smyl-inbox-thread{display:flex}` ganaba al
  atributo `hidden`. `smyl-inbox.css` (v34) agrega `#p-inbox [hidden]{display:none!important}`.
- `smyl-inbox.js` (v35): cuando la lista falla y no hay conversaciones, el espacio de trabajo pasa a
  `data-state="offline"` y muestra una sola tarjeta centrada: logos de WhatsApp/Instagram/Messenger, «Conecta tus
  canales para atender mensajes aquí», botones «Conectar canales» (`ir('conexiones')`) e «Intentar de nuevo» y el
  detalle técnico sin el nombre del motor. Se quita solo al cargar conversaciones. El Pipeline conserva su mensaje.
- Prueba nueva en `tests/smyl-inbox-pipeline.test.mjs`. Suite 516/516.

## 2026-10-20 — Claude: Inicio, lista «Configura tu clínica»

- Nuevo `smyl-clinic-setup.js` / `.css` (v1), cargado después de `smyl-daily-home.js`: tarjeta bajo la cabecera del
  Inicio, solo para el propietario (`miRolEquipo === 'dueño'`), con 5 pasos verificados en solo lectura: horario
  (`smyl_clinic_hours` activos), primer paciente (`camila_pacientes`), WhatsApp conectado (función `lana-channels`),
  plantilla de Utilidad aprobada (función `whatsapp-templates`, `list`) y recordatorios activos
  (`smyl_reminder_settings.enabled`). Si un dato no se puede consultar, el paso queda pendiente con el aviso «No
  pudimos verificarlo ahora» (nunca se marca como listo por error). Se oculta sola al completar los 5 pasos.
- «Ocultar pasos / Ver pasos» se recuerda por clínica en `localStorage` (con try/catch); sin preferencia, en celular
  empieza plegada. Sin migraciones ni funciones nuevas.
- El paso de plantillas necesita la función `whatsapp-templates` desplegada (ya lo está) y la ruta de LANA.
- Pruebas: `tests/smyl-clinic-setup.test.mjs`. Suite 505/505.

## 2026-10-20 — Claude: Inicio, paso B (indicadores del mes, alertas unificadas, agenda de hoy)

- `smyl-daily-home.js` (v6) / `.css` (v8): (1) «Qué requiere atención» usa los mismos pendientes que el Centro de
  alertas (`SmylTaskCenter.getTasks()` y el evento `smyl:task-center-updated`, que ahora trae `items`), así el
  contador de la campana y el Inicio ya no se contradicen; con más de 5, enlace «Ver las N alertas». Si el
  Centro aún no cargó, usa el cálculo anterior de citas y solicitudes. (2) «Hoy en la agenda» es una línea de
  tiempo con todas las citas del día, estado de cada una y marca de «Ahora»; vacía ofrece Agendar cita / Abrir
  agenda. (3) Sección «Este mes»: Cobrado, Por cobrar, Pacientes nuevos y Asistencia, con cambio frente al mes
  anterior (mismos días). Cobros y asistencia salen de `smyl_executive_dashboard` (ya aplica permisos; sin permiso
  financiero se ocultan Cobrado y Por cobrar); pacientes nuevos cuenta `camila_pacientes.created_at`.
- `smyl-task-center.js` (v4): expone `getTasks` y agrega `items` al evento. Sin migraciones ni funciones nuevas.
- Pendiente del paso A que no se hizo: lista «Configura tu clínica» (WhatsApp conectado, plantilla aprobada,
  recordatorios activos, horario, primer paciente).

## 2026-10-20 — Claude: Inicio más compacto y «Chats recientes» al estilo del tablero de LANA

- `smyl-daily-home.js` (v5) / `.css` (v6): cabecera compacta con botones pequeños (Agendar cita, Cotizar, Cobrar:
  32 px en escritorio, 40 px en celular) y nueva tira «Chats recientes» (hasta 6 tarjetas: avatar con logo del
  canal, último mensaje, hora, «Necesita asesor» o «N sin leer»; clic abre la conversación). En celular la tira
  se desliza en horizontal.
- `smyl-inbox.js` (v34): `SmylInbox.fetchRecent(limit)`, `buildAvatar`, `timeLabel`, `channelLabel`. `fetchRecent`
  pide la lista sin tocar el estado ni los filtros del buzón y sin abrir ninguna conversación (abrirla la marcaría
  como leída).
- El panel grande «Conversaciones que necesitan a tu equipo» (`#lana-attention-dashboard`) ya no se muestra en el
  Inicio; su módulo sigue cargando porque alimenta el contador «Mensajes».
- Bug real encontrado: `smyl-professional-v3.css` redefine el hero con `.smyl-management-v3 …` (padding 5px 0 y
  título de 40 px), por eso el saludo salía pegado al borde («uenas»). Las reglas nuevas usan `#smyl-daily-home` para no
  depender del orden de las hojas.
- Pruebas: `daily-home-continuity` ampliada; `smyl-inbox-clean-header` cuenta 5 `channelBadge(` (la API nueva).

## 2026-10-20 — Claude: solicitar plantillas de WhatsApp desde SMYL (LANA por detrás)

- Nueva Edge Function `supabase/functions/whatsapp-templates/index.ts` (+ `docs/bundles/whatsapp-templates.single-file.ts`
  para pegar en el panel; `verify_jwt = true` en `config.toml`). Acciones: `list` (propietario o `messages.read`)
  y `request` (**solo propietario**, solo ids del catálogo revisado de SMYL, nunca texto libre; se vuelve a
  validar con las reglas de Meta). Habla con LANA (`camila-api`) con identidad del actor + `Idempotency-Key`;
  SMYL no guarda tokens de Meta y solo Meta aprueba.
- Catálogo compartido: `scripts/sync-template-catalog.mjs` genera `_shared/whatsapp-template-catalog.mjs` desde
  `smyl-template-catalog.js` (una prueba verifica que esté al día). `scripts/bundle-edge-function.mjs` ahora
  tipa los parámetros de `.mjs` y falla si una importación compartida usa alias.
- UI (`smyl-templates.js` v2, `.css` v3): estados por tarjeta (Por solicitar / En revisión de Meta / Aprobada /
  Rechazada con el motivo traducido, aviso si Meta reclasificó la categoría), botón «Solicitar a Meta» con
  diálogo de confirmación (una a la vez, aviso de opt-in en Marketing), deshabilitado para no propietarios.
  «Copiar para LANA» queda como respaldo si la función aún no está desplegada.
- Pruebas: `tests/whatsapp-templates-request.test.mjs` (simulación real del bundle) y ampliaciones en
  `smyl-whatsapp-templates.test.mjs`. Suite completa 489/489 + nuevas.
- **Depende de LANA** (repo `promodesk`, rama local `claude/smyl-plantillas-solicitar`): `POST
  /inbox/whatsapp/templates` y `GET ?status=all` en `camila-api`, contrato 1.3. Hasta que se despliegue ahí,
  la lista muestra «No pudimos consultar el estado» y funciona el respaldo manual.
- Despliegue SMYL: crear la función `whatsapp-templates` en el panel pegando el archivo único.

## 2026-10-20 — Claude: revisión automática (cron) de recordatorios

- `supabase/config.toml`: `appointment-reminders` pasa a `verify_jwt = false` (el cron no tiene
  sesión y las claves `sb_publishable_…` no son JWT). Es seguro porque el handler autentica
  toda petición (sesión o `x-smyl-cron-secret` en tiempo constante); una prueba verifica que nada
  toque datos antes de autenticar. **En el panel hay que apagar «Verify JWT» de la función.**
- Pasos completos (extensiones, secreto en Vault + secret de Edge Functions, prueba manual,
  `cron.schedule` cada 15 min y cómo verificar) en `docs/RECORDATORIOS_CITA.md`.

## 2026-10-20 — Claude: recordatorios, simulación completa y corrección al apagarlos

- Nueva `tests/appointment-reminders-dispatch.test.mjs` (16 escenarios): corre el archivo único
  `docs/bundles/appointment-reminders.single-file.ts` con una base en memoria y una LANA falsa.
- **Bug corregido en `supabase/functions/appointment-reminders/index.ts`:** `save_settings` con
  `enabled:false` validaba la plantilla contra LANA, así que no se podía apagar si LANA fallaba o
  la plantilla ya no existía. Ahora apagar solo marca `enabled=false`, cancela lo que estaba en
  cola (también en LANA) y conserva la plantilla elegida. **Hay que volver a desplegar la función**
  (pegar el archivo único actualizado en Supabase → Edge Functions → appointment-reminders → Code).
- Pendiente fuera del repo: tener una plantilla aprobada en LANA, configurarla en Agenda →
  Disponibilidad y validar con una cita real que LANA acepte el programado y reporte «enviado».

## 2026-10-20 — Claude: sección «Mensajería» + Plantillas de WhatsApp para dentistas

**Archivos nuevos: `smyl-template-catalog.js`, `smyl-templates.js`, `smyl-templates.css`,
`tests/smyl-whatsapp-templates.test.mjs`. Cambios: `smyl-navigation.js` (v9), `smyl-inbox.js` (v33),
`smyl-reminders.js` (v2), `app.html`, `sw.js`, copias en `mobile/www/`.**

- Menú: nueva sección **Mensajería** (como «Mensajería/Campañas» de LANA) con **Mensajes**
  (sale de «Trabajo diario») y **Plantillas de WhatsApp**. `MESSAGING` en `smyl-navigation.js`;
  en celular es un grupo del panel «Más». «Mensajes» muestra el total de conversaciones sin leer
  (`refreshUnreadBadge` consulta `action=list&filter=unread&limit=1` cada 90 s; no abre nada).
- `smyl-template-catalog.js`: 38 plantillas para clínicas dentales (27 Utilidad, 11 Marketing)
  como datos + `validate()` con las reglas de Meta (variables, longitudes, opt-out, sin promoción
  en Utilidad, sin datos sensibles, sin ligas). Una prueba valida cada plantilla y comprueba que
  el validador sí rechaza 17 casos incorrectos. `recordatorio_cita_24h_v1` usa las mismas
  variables que el recordatorio automático de la Agenda.
- `smyl-templates.js`: pantalla con filtros, vista previa tipo WhatsApp, «Copiar para LANA» y,
  si `lana-inbox?action=templates` responde, el estado «Aprobada en LANA» (por nombre exacto).
- **Límite importante:** SMYL no puede crear plantillas en LANA/Meta (el proxy `lana-inbox` solo
  lista `/inbox/whatsapp/templates`). Hay que copiarlas y solicitarlas desde LANA. Si en el futuro
  LANA expone un endpoint de alta, se podría añadir un botón «Solicitar» (sería trabajo de
  `supabase/functions/lana-inbox`).
- LANA solo acepta plantillas UTILITY fuera de la ventana de 24 h, por eso las de Marketing
  quedan marcadas y requieren opt-in del paciente.
- **Para Codex:** `input,select{font-size:16px!important}` global (app.html ~línea 726) agranda
  los filtros de la pantalla en escritorio; sigue pendiente.

## 2026-10-20 — Claude: chat, segunda tanda de limpieza (barra delgada, pestañas, burbujas, compositor)

**Archivos: `smyl-inbox.js` (v32), `smyl-inbox.css` (v33), copias en `mobile/www/`, pruebas actualizadas.**

- Se quitó el bloque grande «CENTRO DE ATENCIÓN DENTAL / Mensajes / descripción / contadores».
  Quedó una barra delgada con el selector Conversaciones | Pipeline y Avisos /
  Operación / Sincronización. El `<h1>` se conserva oculto (`.smyl-inbox-sr`). En celular
  la barra se oculta dentro de un hilo. Las pruebas que afirmaban ese texto se
  actualizaron: ya no existe `renderInboxOverview` ni `data-inbox-overview`.
- Pestañas como LANA: Todas · Sin leer · Por atender · Mías («Sin leer» salió del panel Filtros).
- Burbujas: ya no llevan «Paciente» / «Equipo de la clínica» (solo «SMYL Asistente»);
  el rótulo queda como texto para lectores de pantalla. La fecha es una píldora con Hoy / Ayer.
  En celular «Responder / Más» aparece al tocar la burbuja (`state.actionsOpenId`).
- Compositor: una fila con Adjuntar · Respuesta rápida · Sugerir arriba del campo; el
  estado del borrador va a la derecha, y la nota de cifrado pasó a tooltip. El aviso de
  ventana de WhatsApp solo se muestra si está por vencer o ya venció.
- **Para Codex:** si quieres retocar el diseño, los estilos nuevos están al final de
  `smyl-inbox.css` bajo «Segunda tanda de limpieza».

## 2026-10-20 — Claude: encabezado del chat más limpio (logos de canal, interruptor de IA, barra «te pone al día»)

**Archivos: `smyl-inbox.js` (v31), `smyl-inbox.css` (v32), copias en `mobile/www/`, `tests/smyl-inbox-clean-header.test.mjs`.**

- Logos de canal (WhatsApp, Instagram, Messenger) como SVG propios en `CHANNEL_MARKS`,
  en una insignia (`.smyl-inbox-channel-badge`) en la esquina del avatar de la lista,
  del encabezado y del Pipeline. Se quitó el chip de texto con el nombre del canal.
- Encabezado: el chip de estado y el botón Tomar control / Reanudar IA pasan a un
  interruptor (`[data-thread-mode]`, `role="switch"`). Solo «Agendar cita» queda
  visible; Expediente, Cotizar y Cobrar están en el menú ⋯. En anchos angostos
  el interruptor muestra solo el control, sin texto.
- `renderThreadNotices` ahora pinta la barra «SMYL te pone al día» con datos que ya
  existen (pidió persona, tiempo sin respuesta, próxima cita, etapa); no llama a la
  API. Reemplaza el recuadro rojo.
- **Para Codex:** la siguiente tanda propuesta (no hecha) es quitar el bloque
  grande «CENTRO DE ATENCIÓN DENTAL / Mensajes», limpiar las etiquetas de las
  burbujas y mostrar «Responder / Más» solo al pasar el cursor.

## 2026-10-19 — Claude: fase 4, recordatorios de cita por WhatsApp + Mensajes a todo el ancho + sidebar contraíble

**Detalle y despliegue en `docs/RECORDATORIOS_CITA.md`. La migración y la
Edge Function aún NO están desplegadas en Supabase.**

- Nuevos:
  - `supabase/migrations/20261019010000_smyl_appointment_reminder_delivery.sql`:
    columnas de proveedor en `smyl_appointment_reminders`, la tabla
    `smyl_reminder_settings`, el trigger `smyl_appointments_reminder_sync` y la
    RPC `smyl_claim_appointment_reminders` (solo service_role).
  - `supabase/functions/appointment-reminders/index.ts`: acciones
    `settings`, `save_settings` y `dispatch`, más un modo cron opcional con
    `x-smyl-cron-secret`.
  - `smyl-reminders.js`: la tarjeta en Agenda → Disponibilidad, el diálogo de
    configuración y la entrega oportunista.
  - Tests: `tests/smyl-appointment-reminders.test.mjs` y
    `tests/smyl-sidebar-collapse.test.mjs`.
- Cambios mínimos:
  - `smyl-schedule.js`: etiquetas de estado; el query ahora pide
    `reminder_type` (antes faltaba y siempre decía "Personalizado"); se
    dispara la entrega al crear, reprogramar o cambiar el estado.
  - `smyl-inbox.js`: dispara la entrega al confirmar una cita desde el chat.
  - `smyl-schedule.css`: estilos de la tarjeta.
  - `supabase/config.toml`: entrada `verify_jwt = true`.
- **Para Codex:** el diálogo reutiliza `#schedule-dialog` y el sistema
  `smyl-dialog-*`, que envuelve el contenido en `.smyl-dialog-body`. Por eso
  los selectores de `.schedule-reminders-form` son de descendiente, no `>`.
- Sidebar: `smyl-navigation.js` agrega `.pro-sidebar-toggle`. Con
  `body.smyl-sidebar-collapsed` el sidebar queda en 72px, solo con iconos. La
  preferencia se guarda en `localStorage` (`smyl_sidebar_collapsed`).
  Mensajes ocupa todo el ancho en escritorio mediante
  `.contenido:has(>.smyl-inbox-page.activa)` en `smyl-inbox.css`.
- Versiones:
  - `smyl-schedule.js?v=11`, `smyl-schedule.css?v=6`
  - `smyl-reminders.js?v=1`
  - `smyl-inbox.js?v=30`, `smyl-inbox.css?v=31`
  - `smyl-navigation.js?v=8`, `smyl-navigation.css?v=3`

## 2026-10-19 — Claude: rediseño del chat (Mensajes) estilo LANA, fases 1–3

**Archivos: `smyl-inbox.js`, `smyl-inbox.css`, `app.html` (recarga de la
PWA y ruta), `sw.js`, copias en `mobile/www/`, tests de versiones y
`tests/smyl-inbox-pipeline.test.mjs` (nuevo). Versiones actuales:
`smyl-inbox.js?v=29`, `smyl-inbox.css?v=30`.**

- Fase 1 — tipografía según `POLITICA_IMAGEN_SMYL.md` §6 (mensajes 13px,
  botones 600 13px, mínimo 11px; pesos solo 400/500/600/700) y cabecera del
  hilo con las acciones del paciente en la misma fila. Con container queries
  pasan al menú ••• cuando la cabecera es angosta.
- Fase 2 — avisos dentro del hilo ("El paciente pidió hablar con una
  persona" + "Marcar resuelta"; ventana de WhatsApp vencida + "Enviar
  plantilla") y menú ••• con acciones, responsable y "Marcar solicitud
  resuelta".
- Fase 3 — vista **Pipeline**: selector "Conversaciones | Pipeline" en la
  cabecera de Mensajes. Muestra columnas por etapa de LANA (`action:'stages'`),
  ordenadas por `position`. Las tarjetas se mueven arrastrando o con «Mover a»,
  que se ve siempre en pantallas táctiles y al pasar el cursor en escritorio.
  Usa el mismo `POST action:'stage'` con actualización optimista y reversión.
  Solo se mueve con `messages.manage`. La vista elegida se guarda en
  `sessionStorage` (los tests prohíben `localStorage` en el inbox).
- `app.html`: `ir()` guarda la ruta en `sessionStorage` y la restaura al
  recargar. Al actualizarse el service worker se recarga en cuanto nadie
  está escribiendo (antes esperaba a que la pestaña se ocultara y el
  usuario no veía los cambios).
- **Para Codex (pendiente, no tocado):** `app.html` línea ~726 tiene
  `input,textarea,select{font-size:16px!important}` global. Fuerza 16px en
  todos los campos también en escritorio (la política pide 13px; 16px solo
  en móvil para evitar el zoom de iOS). Lo correcto sería limitarlo a
  `@media(max-width:760px),(hover:none)`, pero afecta todos los módulos y
  requiere revisión visual completa.
- Pendiente: Fase 4 (recordatorios automáticos de cita) y ocultar
  "Responder / Más" de cada burbuja en celular hasta tocar el mensaje.

## 2026-10-19 — Claude: limpieza de `!important` en el shell "pro" + pregunta abierta para Codex sobre la paleta teal/sage

**Contexto: siguiendo el Nivel 4 del plan de alineación con
`docs/POLITICA_IMAGEN_SMYL.md` (que prohíbe `!important` "as foundation of
the new system"), revisé y limpié los 10 archivos CSS del shell profesional
("pro shell") que lo usaban: `smyl-finance.css`, `smyl-reports.css`,
`smyl-readiness.css`, `smyl-inventory.css`, `smyl-clinic.css`,
`smyl-clinic-admin.css`, `smyl-panel.css`, `smyl-proposals.css`,
`smyl-connections.css`, `smyl-navigation.css` y `smyl-inbox.css`.**

- Metodología: para cada `!important`, busqué si existía alguna regla
  competidora con igual o mayor peso en todo el repo. Donde no había
  competidor, lo quité sin más. Donde sí había (casi siempre: la misma clase
  reutilizada en otro archivo con el mismo peso, o una regla más específica
  tipo `.algo>p`), subí la especificidad del selector en vez de volver a usar
  `!important` — por ejemplo `p.connections-form-message` en vez de
  `.connections-form-message`, o `.pro-primary-nav .pro-nav-item` en vez de
  `.pro-nav-item`. Cada cambio se verificó con Playwright (headless Chromium)
  comparando el valor computado antes/después contra el HEAD sin modificar,
  no solo leyendo el CSS.
- Quedaron **9 `!important` genuinamente necesarios** en todo el shell pro,
  todos documentados en los commits correspondientes, con dos patrones
  recurrentes:
  1. Pelean contra otro `!important` que ya existe en el `<style>` base de
     `app.html` (p. ej. `.bottom-nav{display:flex!important}`,
     `.btn-hamburger{display:none!important}`) — no hay especificidad que le
     gane a un `!important` sin usar `!important` también.
  2. Pelean contra un `style=""` en línea en el HTML (p. ej.
     `.topbar-left{gap:8px!important}` contra un `style="gap:10px"` inline) —
     mismo problema: lo en línea sólo pierde ante `!important`.
  3. El bloque de `@media(prefers-reduced-motion:reduce)` y los bloques de
     `@media print` — usos aceptados de `!important` por accesibilidad e
     impresión.
- Efecto colateral importante que puede interesarte para tu propio trabajo en
  estos archivos: **cada vez que cambié el contenido de un CSS/JS, tuve que
  subir su `?v=N` en los `<link>`/`<script>` de `app.html` y en la lista
  `STATIC_FILES` de `sw.js`**, porque el service worker de la PWA cachea cada
  archivo por su URL exacta (`cache-first`). Si editas estos archivos sin
  subir el número, el navegador de un visitante que ya cargó la app antes
  sigue viendo la versión vieja indefinidamente, sin importar cuántas veces
  se despliegue. Vale la pena revisar esto en cualquier cambio futuro a estos
  archivos.
- **Pregunta abierta para que la revises tú (decisión de diseño, no técnica):**
  al inventariar estos 10 archivos encontré que 6 de ellos —
  `smyl-navigation.css`, `smyl-proposals.css`, `smyl-clinic-admin.css`,
  `smyl-connections.css`, `smyl-panel.css` y `smyl-clinic.css` — comparten una
  paleta de color propia, distinta de los tokens `--smyl-*` de
  `smyl-design-system-v2.css` y distinta también de los `--color-*` del
  `:root` de `app.html`: tonos teal/sage (`#dce2dd`, `#fdfdf9`, `#233c3d`,
  `#657777`, `#526465`, `#215d60`, `#286653`, entre otros), no documentada en
  `POLITICA_IMAGEN_SMYL.md`. Los otros 4 (`smyl-finance.css`,
  `smyl-reports.css`, `smyl-readiness.css`, `smyl-inventory.css`) usan en
  cambio una paleta azul-gris distinta (`#f8fafc`, `#e7edf2`, `#65758b`,
  `#dfe6ef`). No toqué los valores de color de ninguno de los dos grupos —
  solo until y especificidad de `!important` — porque no sé si el teal/sage es
  una identidad visual intencional del shell profesional que debería
  documentarse en la política, o si es deriva accidental que debería migrarse
  a los tokens `--smyl-*`. Te lo dejo a ti para decidir y, si aplica,
  documentar en `POLITICA_IMAGEN_SMYL.md` o planear la migración.
- Verificación: suite completa en verde (106/106) después de cada commit;
  todos los cambios ya están fusionados en `main`.

---

## 2026-10-18 — Claude: pulido de accesibilidad en sidebar de app.html

**Petición del usuario: hacer la UI más "profesional" en `app.html`. Antes de
tocar nada a fondo, confirmé que `smyl-navigation.js` (trabajo de Codex del
16/10, Política Visual v2) ya reemplaza por completo el contenido de
`.sidebar .nav-items` en runtime (`organizeDesktop()`, línea ~107), generando
`<button>` reales en vez de los `<div class="nav-item">` estáticos del HTML.**

- Añadí `tabindex="0"`/`role="button"` a los 11 `<div class="nav-item">`
  estáticos con un script y los revertí al descubrir que son código muerto
  (JS los reemplaza antes de que el usuario interactúe) — no quedó rastro en
  el HTML final.
- Cambios que sí son efectivos porque aplican por clase compartida o tocan un
  nodo que `smyl-navigation.js` no toca:
  - `.nav-item` — transición explícita (`background-color,color,box-shadow`
    en vez de `all`), `letter-spacing:.1px` y un anillo `:focus-visible`
    (requisito de la sección 20 de `POLITICA_IMAGEN_SMYL.md`). Verificado con
    Playwright que no duplica el `ir()` al presionar Enter sobre un botón de
    nav real.
  - `.sb-user` (tarjeta de cuenta del dentista, arriba del nav — no la toca
    `smyl-navigation.js`) — ahora es interactiva: `onclick="ir('mi-cuenta')"`,
    `tabindex`/`role="button"`, hover/focus-visible y un chevron, al estilo
    "workspace switcher" de apps SaaS premium (referencia: componente
    "Dashboard Sidebar" de 21st.dev). Delegación de teclado (Enter/Espacio)
    añadida en JS sólo para `.sb-user`, no para `.nav-item`, justamente para
    no interferir con los `<button>` nativos de Codex.
- No toqué tokens (`--color-*`), ni until migré nada al sistema `--smyl-*` de
  la Política v2 — la sección 26.3 de esa política indica no propagar ajustes
  locales a otras ventanas hasta aprobar Agenda como referencia, así que esto
  se quedó como pulido dentro del sistema legacy ya existente en `app.html`.
- No se tocó `supabase/functions/**`, prompts de IA, ni `mobile/`. Verificado
  localmente (servidor estático + Playwright/Chromium headless): el sidebar
  renderiza, el foco es visible, y no hay errores de consola nuevos (los que
  aparecen — fallo al cargar el CDN de Supabase — son del sandbox sin acceso
  a internet externo, no del código).

**Si vas a tocar `.sidebar`/`.nav-items` en `app.html`:** recuerda que el
contenido real que ve el usuario lo genera `smyl-navigation.js`, no el HTML
estático — edita ahí (o en CSS por clase) en vez del markup inicial.

### 2026-10-18 — Claude: foco inicial y trampa de foco en el gate de acceso

**Mismo pulido "profesional" solicitado por el usuario, segunda pieza:
`#auth-gate-overlay` (login/registro en `app.html`) no tenía foco inicial ni
trampa de foco — Tab se escapaba al dashboard de fondo mientras el modal
estaba abierto, lo que viola la sección 11.4/20 de
`POLITICA_IMAGEN_SMYL.md`.**

- `switchAuthGateTab()` ahora enfoca el primer campo del panel visible al
  cambiar de pestaña (correo en login, nombre en registro).
- Al cargar, el correo de login recibe foco automáticamente (el overlay se
  muestra siempre por defecto al cargar `app.html`, no hay botón trigger que
  lo abra, así que no aplica "devolver foco al origen" — sólo trampa + foco
  inicial).
- Un listener de `keydown` en el overlay cicla Tab/Shift+Tab sólo entre sus
  controles visibles. Verificado con Playwright: ambos bordes (primer/último
  campo) ciclan correctamente y el foco nunca sale del modal.
- No toqué la lógica de `hacerLoginAppGate()`/`hacerRegistroAppGate()` ni
  nada de Supabase — sólo accesibilidad de foco.

### 2026-10-18 — Claude: fila del Inbox más cercana a LANA (`smyl-inbox.css`)

**El usuario pidió que el chat "se pareciera más al de LANA" (misma cuenta,
repo `promodesk`). Clonado en modo lectura para comparar código real, no solo
la captura que mandó.**

- Hallazgo clave: el Inbox de SMYL (stages 1-3, ver entradas de abajo) ya
  iguala o supera a LANA en funcionalidad — fijado, etapas, biblioteca
  compartida, bulk actions, ventana 24h, copilot. El audit
  `SMYL_LANA_CHAT_PARITY_AUDIT.md` (14/10) ya está mayormente resuelto; no
  hace falta re-auditar aquí.
- La brecha real era visual, acotada a `.smyl-inbox-row` y sus hijos:
  - Varios `font-size` por debajo de 10px (`7px`-`9px` en metadatos, chips de
    etapa, hora) violaban el propio mínimo de la sección 6.4 de
    `POLITICA_IMAGEN_SMYL.md`. Subidos a 10px donde aplica a la fila de
    conversación (no toqué los diálogos de operaciones/piloto/reportes, que
    son otra superficie y no la vio el usuario).
  - `.smyl-inbox-avatar` pasó de `border-radius:9px` a `50%` (circular, como
    WhatsApp/Messenger/Instagram nativos y como LANA).
  - `.smyl-inbox-attention` ("Por atender") pasó de texto-sobre-tinte suave a
    pill sólida blanco-sobre-rojo (`#B42318`, el mismo valor que
    `--smyl-danger` en la política, aunque este archivo todavía no usa
    variables), igualando el peso visual del badge "Necesita asesor" de LANA
    sin tomar su violeta — sigue siendo rojo semántico de SMYL.
- No toqué `smyl-inbox.js` (lógica, fetch, Supabase) ni los paneles de
  operación/piloto/reporte — sólo CSS de la fila de conversación.
- Verificado en una página aislada con Playwright (sin datos reales, porque
  Supabase no es alcanzable desde este sandbox): se ve el resultado en
  `inbox-row-preview.png` del scratchpad de esa sesión.

### 2026-10-20 — Claude: el gate de acceso es página propia, no modal sobre el dashboard difuminado

**Pedido explícito del usuario: que el login/registro sea una pantalla dedicada,
sin ver el dashboard difuminado detrás.**

- `.layout` (sidebar + contenido) ahora arranca en `display:none` y solo se
  muestra (`.layout.is-visible`) dentro de `continuarConUsuario()`, el único
  punto donde ya hay sesión confirmada. Antes estaba siempre montado y
  visible detrás del overlay de login.
- `#auth-gate-overlay` perdió el `backdrop-filter:blur(6px)` y el fondo
  translúcido oscuro (`rgba(15,23,42,.4)`); ahora usa un fondo sólido claro
  (`var(--color-surface-raised)`), así que se lee como una página propia, no
  como un modal flotando sobre otra pantalla.
- No toqué `mostrarNuevaPassword()` ni `mostrarSetPasswordInvitado()`
  (overlays intermedios de recuperación/invitación) — ocurren antes de que
  `.layout` se muestre, así que ya no tienen nada que difuminar detrás; no
  hacía falta tocarlos para este pedido.
- Verificado con Playwright en escritorio (1440×900) y móvil (390×844):
  `.layout` confirmado en `display:none` antes de autenticar, sin errores de
  consola nuevos.

**Segunda pasada el mismo día ("se ve muy simple"): login de dos paneles.**

- `#auth-gate-overlay` ahora tiene clase `ag-page` y dos hijos: `<aside
  class="ag-brand">` (panel de identidad: eyebrow, titular, texto y tres
  bullets con check vectorial, copy 100 % SMYL/dental, sin LANA) y
  `.ag-form-panel > .ag-card` (logo real `icons/smyl_logo.png`, "Bienvenido
  de nuevo", pestañas, formularios intactos y un pie `.ag-foot`).
- Todos los IDs y handlers (`ag-tab-*`, `ag-l-*`, `ag-r-*`, `ag-btn-*`,
  `switchAuthGateTab`, trampa de foco) se conservan sin cambios; sólo cambió
  el contenedor visual. Los estilos salieron del inline a clases `.ag-*` junto
  a las pestañas existentes.
- El fondo del panel de marca es un degradado explícito navy→azul clínico
  (`#0B1B2E → #12366F → #194391`). No usa `--gradient-primary` porque
  `smyl-panel.css` (`.smyl-professional`) lo aplana a teal sólido `#215d60` y
  el panel salía apagado. Es la única superficie "de marca" del gate; el resto
  sigue plano, como pide la política.
- Responsive: ≤840px se oculta el panel de marca y queda la columna del
  formulario; ≤480px reduce paddings y logo. Verificado sin scroll horizontal
  en 1440, 900 y 390 px, con la pestaña Registro (la más alta) cabiendo en
  390×844 sin desbordar.
- `prefers-reduced-motion` desactiva la entrada animada de la tarjeta.

**Tercera pasada (propuesta aprobada visualmente por el usuario): estilo
"dos paneles claros", tomando como referencia el login de LANA pero con
identidad SMYL.**

- Panel izquierdo claro (`#F4F6FB`) con logo real arriba, eyebrow con guion
  azul, titular grande en tinta ("Cada paciente, del primer mensaje a la
  cita."), tres pasos numerados con icono y línea conectora (`.ag-steps`:
  Agenda / Asiste con IA / Da seguimiento) y pie con check de aislamiento por
  organización. Por pedido explícito del usuario el copy **no** menciona
  simulación de carillas; habla de agenda y del asistente con IA.
- Divisor vertical de 3px en `--color-primary` entre paneles.
- Tarjeta blanca con borde + `shadow-floating`, eyebrow/título/subtítulo
  dinámicos por pestaña (`#ag-eyebrow`, `#ag-title`, `#ag-subtitle`, los
  cambia `switchAuthGateTab`), campos de 48px, "¿Olvidaste tu contraseña?"
  en la fila de la etiqueta (sigue siendo `#ag-btn-recovery`), botón de ojo
  `toggleAuthGatePass()` con `aria-pressed`, botón primario "Entrar a SMYL" /
  "Crear mi cuenta" (también actualizados los textos que el JS restaura tras
  el loading) y pie "Conexión protegida · SMYL".
- Las antiguas pestañas se volvieron un enlace de alternancia al pie de la
  tarjeta ("¿Aún no tienes cuenta? Registrarme" / "¿Ya tienes cuenta? Iniciar
  sesión"): mismos IDs `ag-tab-*` y `switchAuthGateTab`, `role="button"` en vez
  de `tab`, la opción activa se oculta vía CSS. Se movieron físicamente al
  final del DOM para que el orden de Tab coincida con el visual (verificado:
  Entrar → Registrarme → vuelve al correo).
- No se añadió "Continuar con Google": Supabase no tiene ese proveedor
  configurado y la política prohíbe prometer lo que el servidor no respalda.
  Si se quiere, es trabajo de backend (habilitar provider + `signInWithOAuth`).
- En ≤840px el panel izquierdo se oculta y aparece un logo compacto arriba de
  la tarjeta (`.ag-card-logo`). Verificado en 1600, 900 y 390 px sin scroll
  horizontal; el logo del panel usa `align-self:flex-start` porque el `aside`
  flex-column lo estiraba.

### 2026-10-20 — Claude (sesión login): regresión de paridad corregida + diagnóstico de Mensajes

- **Regresión mía:** el PR #21 rediseñó `app.html` (gate de acceso de dos
  paneles, `.layout.is-visible`) sin copiar a `mobile/www/app.html`; 44/479
  pruebas de paridad web↔móvil quedaron rojas en `main`. Corregido con
  `cp app.html mobile/www/app.html` → 479/479 (`node --test tests/*.test.mjs`).
- Nuevo `docs/SMYL_MENSAJES_DIAGNOSTICO.md`: auditoría del módulo Mensajes
  contra el spec de 7 etapas del usuario sobre `main` = c671911 (estado por
  etapa con evidencia, higiene multi-tenant, contratos, deuda CSS, pruebas,
  riesgos de colisión y propuesta de reparto). Punto clave: hay **otra sesión
  de Claude** rediseñando el chat en paralelo (fases 1–4), así que el reparto
  propuesto es: esta sesión → backend / contratos / tenant / permisos /
  pruebas; la otra → visual/UX en `smyl-inbox.js/css`. Una sola sesión toca
  `smyl-inbox.*` por día.
- Sin cambios de lógica en este commit.

### 2026-10-20 — Claude (sesión login/backend): P0 branding — sin "LANA" en la interfaz de SMYL

**Primer ítem del reparto acordado en `SMYL_MENSAJES_DIAGNOSTICO.md` §G.**

- Reemplazadas las 17 cadenas visibles con "LANA" en `smyl-inbox.js` (búsqueda
  en hilo, informe del piloto, respuestas rápidas), `smyl-templates.js` (×11),
  `smyl-template-catalog.js`, `smyl-reminders.js`, `smyl-clinic.js`,
  `smyl-proposals.js` (×2) y `smyl-readiness.js`. Criterio: la aprobación la
  da **Meta** ("Aprobada por Meta"), el lugar donde se solicita es "tu panel de
  mensajería", los errores hablan de "el servicio de mensajería" y el botón de
  copia pasa a "Copiar datos de solicitud". Botón de propuestas: "Seguimiento
  por mensajería". No se tocaron identificadores (`lana-inbox`, `SmylLana`,
  `formatForLana`, clase `lana-entry`) ni comentarios de código.
- "Bordados Express" **no existe en el código**; si reaparece en pantalla, la
  fuente es un dato devuelto por el motor (respuestas rápidas, plantillas,
  nombre de asignado) — pendiente de rastrear con sesión real.
- Nueva prueba `tests/smyl-branding-isolation.test.mjs`: inspecciona literales
  de cadena con texto de UI en `smyl-*.js` (raíz y `mobile/www`) y nodos de
  texto de `app.html`, `index.html`, `revision-clinica.html`,
  `simulacion.html`; falla ante `\bLANA\b`, `\bLana\b` o "Bordados Express".
  Permite identificadores sin espacios.
- Actualizadas dos pruebas que esperaban el copy antiguo
  (`lana-inbox-productivity-stage3`, `smyl-whatsapp-templates`). Suite:
  **481/481**.
- **Cache-busting diferido a propósito.** Intenté subir los `?v=` de los 7
  activos y `CACHE_VERSION`, pero 55 archivos de prueba fijan
  `smyl-v254-visible-shell-v4` y ~28 fijan los `?v=` actuales (62 fallos).
  Actualizarlos es territorio de la sesión visual, que lo hace en cada
  entrega; por eso **no** se tocaron `app.html`, `sw.js` ni sus copias en este
  commit. Consecuencia: las PWA ya instaladas verán el copy nuevo hasta el
  siguiente bump. Petición a la sesión visual: en su próxima entrega incluir
  `smyl-inbox.js`, `smyl-templates.js`, `smyl-template-catalog.js`,
  `smyl-reminders.js`, `smyl-readiness.js`, `smyl-clinic.js` y
  `smyl-proposals.js` en el bump.
- Copias en `mobile/www/` de esos 7 archivos sincronizadas.
- Nota para la sesión visual: este commit toca `smyl-inbox.js` sólo en tres
  cadenas de texto; si hay conflicto, conservar el copy sin "LANA".

### 2026-10-20 — Claude (sesión backend): alta de pacientes — permiso verificado al abrir y errores separados

**Reporte del usuario: "Guardar paciente" fallaba con "Tu sesión no tiene
permiso para esta acción. Revisa la cuenta con la que ingresaste."**

- Causa: la política `pacientes_create` (migración `20261015040000`) exige
  `tenant_id = smyl_current_tenant()` **y** `smyl_has_permission(tenant_id,
  'patients.manage')`; Postgres responde `42501` y
  `smyl-clinical-model.js` lo traducía al mismo texto que `PGRST301`
  (sesión caducada). `camila_usuarios.id` es PK, así que no hay ambigüedad de
  clínica; el rechazo viene de una cuenta sin rol con «Pacientes · gestionar»
  (o membresía inactiva) o de sesión vencida. No se pudo consultar la base
  desde esta sesión; el usuario puede confirmar en consola con
  `sb.rpc('smyl_current_tenant')` y `sb.rpc('smyl_has_permission',{p_tenant_id:
  tenantId,p_permission:'patients.manage'})`.
- `smyl-clinical-model.js`: `42501` → "Tu rol en esta clínica no permite esta
  acción…"; `PGRST301` → "Tu sesión expiró…" (antes era un solo mensaje).
- `smyl-clinic.js`: `patientPermissionCheck()` llama a esas dos RPC al abrir el
  modal; si la base rechazaría el alta, muestra el motivo (permiso / clínica
  distinta / sesión) en `#patient-feedback` y deshabilita `#patient-save-button`.
  Si las RPC no existen (`PGRST202`) no bloquea. Nueva línea
  `#patient-clinic-line` bajo el título: "Se guardará en <clínica>." El
  `catch` de `savePatient` también distingue `42501`/`PGRST301`.
- Nueva prueba `tests/smyl-patient-intake-permissions.test.mjs`. Versiones:
  `smyl-clinic.js?v=9`, `smyl-clinical-model.js?v=3` en `app.html` y `sw.js`
  (no las fijan otras pruebas; `CACHE_VERSION` no se tocó). Copias móviles
  sincronizadas.
- Pendiente (siguiente entrega acordada): rediseño del alta — duplicados por
  teléfono/correo, teléfono normalizado con prefijo, origen del paciente,
  sucursal/profesional, alertas médicas, consentimiento WhatsApp, y abrir la
  Ficha 360 con siguiente acción al guardar.

### 2026-10-21 — Claude (sesión backend): la Agenda busca pacientes en el servidor

`smyl-schedule.js?v=13` / `smyl-schedule.css?v=8`. **Aviso a la sesión visual:** toqué
`smyl-schedule.js` (carga de pacientes y el combobox de Nueva cita).

- **Problema:** la Agenda descargaba a todos los pacientes y filtraba en el navegador. PostgREST
  corta en 1000 filas sin avisar, así que a partir de ahí había pacientes inalcanzables.
- **Carga:** ahora trae sólo los 200 más recientes (`updated_at desc`) y `ensurePatients()` completa
  por id, en lotes de 100, los pacientes de las citas y solicitudes visibles. También lo usa
  `SmylSchedule.forPatient()`. Reprogramar y revisar solicitud ofrecen sólo al paciente de la cita.
- **Búsqueda:** `smyl_search_patients(p_tenant_id, p_query, p_limit)` (migración
  `20261021120000_smyl_search_patients.sql`, **SECURITY INVOKER**): nombre, apellido, correo y
  teléfono sin distinguir acentos ni mayúsculas, todos los términos deben coincidir, máximo 6
  términos y 20 resultados, `%` `_` `\` literales y un teléfono con espacios o guiones se busca
  completo. Como es invoker, la política de lectura y el alcance del rol deciden qué ve cada
  persona; además exige el tenant de la sesión. Sin texto devuelve los más recientes.
- **Cliente:** espera de 250 ms, secuencia para descartar respuestas tardías, estado «Buscando…»
  y aviso si la búsqueda falla.
- **Degradación:** si la función aún no existe (`PGRST202`/`42883`) hace una consulta directa con
  `ilike` sobre el texto con y sin acentos (40 candidatos, filtrados en el navegador). En ese
  modo **no** encuentra «dona» si el nombre es «Doña»; la función de la base sí.
- **Pendiente de producción:** aplicar la migración con el flujo manual
  `.github/workflows/smyl-buscar-pacientes-migracion.yml` (necesita el secreto
  `SUPABASE_ACCESS_TOKEN`) o con el conector de Supabase. El conector de la sesión perdió el
  permiso, así que no se aplicó ni se ensayó en la base real.
- **Verificado:** la función en un Postgres de prueba con RLS (acentos, comodines, teléfono,
  límites, otra clínica, paciente fuera del alcance); la interfaz en Chromium con 1500 pacientes
  simulados (alguien fuera de los 200 recientes se encuentra, una sola consulta al teclear
  «doña», el nombre de una cita antigua se resuelve) y también sin la función.
- **No cubierto:** la pantalla Pacientes (`todosLosPacientes`) y el selector de casos siguen
  cargando y filtrando en el navegador.

### 2026-10-21 — Claude (sesión backend): el asistente de la Agenda crea servicios y sillones

`smyl-schedule-setup.js?v=2` / `smyl-schedule-setup.css?v=2`. Amplía el asistente de la entrada
siguiente; sigue sin tocar `smyl-schedule.js`.

- **Servicios** (paso obligatorio «Un servicio con profesional asignado»): botón «Crear servicios»
  abre un diálogo con diez servicios comunes del catálogo dental
  (`SmylServiceCatalogModel.presets`), tres marcados si la clínica no tiene ninguno. Inserta con
  `presetInsert`, así que `fiscal_status` queda `pending`, no inventa precios y el trigger de
  versionado del catálogo actúa igual que en Servicios y tarifas. Omite los que ya existen por
  plantilla o por nombre (índices únicos `smyl_services_template_idx` y `smyl_services_name_idx`,
  que ignoran acentos y mayúsculas en el plan). Con la casilla «Asignarlos a todos los
  profesionales activos» también asigna los servicios existentes que nadie realiza.
- **Sillones** (paso opcional): crea «Sillón 1…N» sólo en sucursales que no tienen ninguno. Es
  opcional porque, con sillones configurados, la RPC exige elegir uno en cada cita; el diálogo lo
  advierte. Cuando lo obligatorio está completo queda un aviso compacto «Tu Agenda ya acepta
  citas» con «Agregar sillones» y «Ahora no»; descartarlo se guarda en `localStorage`
  (`smyl_schedule_rooms_hint_<tenant>`).
- **Permisos distintos por escritura**, como las políticas: servicios `settings.manage`, asignación
  `schedule.manage`, sillones `clinic.manage`. Sin alguno se omite esa parte y se explica.
- Dos llamadas por flujo de servicios (insertar y asignar), cada una atómica; si la segunda falla
  se avisa y reintentar es seguro (el plan se recalcula y `ignoreDuplicates` evita pares repetidos).
- Pruebas: `tests/smyl-schedule-setup.test.mjs` (19) y la interfaz real en Chromium con Supabase
  simulado (servicios con y sin asignación, sillones, aviso opcional).
- **No verificado contra producción:** al terminar, el conector de Supabase de la sesión perdió el
  permiso (error -32600, también en lecturas), así que las inserciones de servicios y sillones no
  se ensayaron en la base real como sí se hizo con los horarios. Las políticas y los índices únicos
  se leyeron antes de escribir el código.

### 2026-10-21 — Claude (sesión backend): asistente de puesta en marcha de la Agenda

**Aviso a la sesión visual:** módulo nuevo `smyl-schedule-setup.js` + `.css` (v1), cargado
justo después de `smyl-schedule.js`. No modifica `smyl-schedule.js`; sólo se engancha a
`ir('agenda')` y observa `#schedule-hours-list` y `#schedule-services-list` para refrescarse.

- **Qué hace:** tarjeta «Prepara tu Agenda para recibir citas» bajo `#schedule-feedback`,
  visible sólo con `schedule.manage` y mientras falte algo. Cinco comprobaciones con datos
  reales: sucursal activa, horario de la clínica por sucursal, profesional asignado a una
  sucursal, horario de cada profesional y servicio con profesional asignado. Cada pendiente
  lleva a donde se arregla (Mi clínica o la pestaña Servicios y disponibilidad).
- **Horario estándar:** botón y diálogo (reutiliza `#schedule-dialog`) con días (Lun–Vie por
  defecto), apertura y cierre, y vista previa de lo que se creará. Crea el horario de cada
  sucursal y de cada profesional en bloque.
  - Respeta lo existente: sólo rellena los días sin bloque activo; repetirlo no crea nada.
  - El horario del profesional se recorta al de la clínica ese día (la base exige ambos).
    Si la sucursal no abre en ese rango se omite y se avisa.
  - Permisos como la base: clínica requiere `clinic.manage`, profesional `schedule.manage`.
    Sin el primero sólo se crea lo del profesional.
  - Escribe con `upsert` por la llave única (reactiva un bloque quitado antes) y sin borrar
    nada. Son dos tablas, así que dos llamadas atómicas; si la segunda falla se dice y
    reintentar es seguro.
- **Verificado contra producción** (clínica «Dd», identidad del titular, transacción
  deshecha): las mismas sentencias insertan 5 + 5 horarios y `smyl_create_appointment`
  acepta después una cita el viernes a las 12:00. No quedó nada guardado.
- Pruebas: `tests/smyl-schedule-setup.test.mjs` (lógica en Node con `vm`) y la interfaz real en
  Chromium con Supabase simulado (escritorio y móvil).
- La tarjeta «Configura tu clínica» de Inicio (`smyl-clinic-setup.js`) sigue igual: su paso
  «Define tu horario de atención» lleva a Agenda, donde ahora está este asistente.
- Límites: el asistente no crea sucursal, profesional ni servicio (sólo los señala), y no
  gestiona sillones.

### 2026-10-21 — Claude (sesión backend): Nueva cita con búsqueda de paciente y alta rápida

**Aviso a la sesión visual:** toqué `smyl-schedule.js` y `smyl-schedule.css` a petición
del usuario (el formulario «Nueva cita»). Si había algo en curso ahí, conviene
rebasar sobre esto.

- **Causa de «no me deja confirmar»:** la clínica «Dd» no tiene ningún horario
  semanal (`smyl_clinic_hours` ni `smyl_professional_hours` vacías), así que la RPC
  rechaza toda cita con «fuera del horario de la clínica». El mensaje se mostraba
  en la página *detrás* del diálogo modal, de modo que parecía que el botón no hacía
  nada. **Acción pendiente del usuario:** configurar horarios en Agenda → Disponibilidad.
- Errores dentro del diálogo: `notify(…, 'error')` ahora también pinta el mensaje en
  `[data-dialog-error]` (con `role="alert"`) encima de los botones si hay un diálogo
  abierto; se limpia al editar el formulario.
- Control de reserva: `hoursIssues()` replica la regla de la base en la hora local
  de la sucursal (`Intl` con `branch.timezone`): avisa si la sucursal o el profesional
  no tienen horario semanal y si la cita cae fuera. Esos avisos bloquean el envío,
  igual que los que ya existían.
- Paciente: `patientField()` sustituye el desplegable (sólo en cita nueva; reprogramar
  y revisar solicitud siguen con paciente fijo). Combobox accesible (`role=combobox`,
  flechas, Enter, Escape), búsqueda sin acentos por nombre, correo y teléfono, hasta 8
  resultados. La consulta de pacientes de la Agenda ahora trae `telefono,email`.
- Alta rápida: última opción de la lista, «Registrar “texto” como paciente nuevo»,
  abre un panel con nombre, apellido, teléfono y correo (prellenado según lo escrito).
  Antes de guardar consulta `smyl_patient_duplicates` (con respaldo local) y ofrece
  «Usar este paciente» o «Es otra persona»; inserta en `camila_pacientes` con
  `tenant_id` de la sesión y deja al paciente seleccionado. Un 42501 explica que el
  rol no puede registrar pacientes.
- Versiones: `smyl-schedule.js?v=12`, `smyl-schedule.css?v=7`; siete pruebas antiguas
  que fijaban v11/v6 ahora aceptan versiones posteriores.
- Pruebas: `tests/smyl-schedule-patient-search.test.mjs`. Además se ejecutó la interfaz
  real en Chromium con Supabase simulado (zona de México): búsqueda, teclado, duplicado,
  alta, fuera de horario, confirmación con los parámetros correctos y vista móvil.
- Límite conocido: la Agenda carga todos los pacientes de la clínica y busca en el
  navegador; con más de 1000 habría que buscar en el servidor.

### 2026-10-21 — Claude (sesión backend): migración del alta de pacientes v2 aplicada en producción

- `20261020150000_smyl_patient_intake_v2` quedó **aplicada** en el proyecto
  `rpxshsiwoxdbuevjjpfw` con la herramienta de Supabase, en tres tramos
  independientes (columnas y llaves, disparador de consentimiento, búsqueda de
  duplicados) y registrada en el historial con esa versión. Las 18 fichas
  existentes quedaron intactas.
- El ensayo completo en una sola transacción se colgó tres veces en la herramienta
  (60 s) sin dejar sesiones ni bloqueos en la base; por partes, todo pasó. La causa
  no se confirmó. Sólo cambió el disparador: `search_path = pg_catalog` en vez de
  `''` y `create or replace trigger`; el archivo del repo ya refleja eso.
- Verificado con la identidad del titular dentro de una transacción deshecha:
  origen, sucursal, profesional y alertas se guardan, el consentimiento sella su
  fecha, el duplicado por correo y por teléfono en formato 52 se detecta, y otra
  clínica no ve nada. No quedó ninguna fila de prueba.
- Efecto: el alta de `app.html` deja de caer al modo básico y avisa de duplicados con
  la búsqueda real. El flujo manual de #28 sigue siendo válido y no repite nada:
  detecta el esquema completo.
- **Sigue pendiente en producción:** `20261019010000_smyl_appointment_reminder_delivery`.

### 2026-10-21 — Claude (sesión backend): el titular no podía dar de alta ni ver pacientes

**Síntoma:** en la clínica «Dd», `r.partida.islas@gmail.com` no podía guardar
pacientes (42501) y no veía ninguno de los 8 existentes, aunque la pantalla decía
que faltaba el permiso «Pacientes · gestionar».

**Causa (comprobada en producción, proyecto `rpxshsiwoxdbuevjjpfw`):**
`smyl_effective_scope` sólo devolvía `clinic` a quien tuviera una fila activa de
`dueño` en `camila_usuarios`. Esa cuenta es el titular por identificador
(id = clínica) y es anterior a la etapa 4 del equipo: no tiene fila. Caía en
`own` sin ficha de profesional, así que `smyl_can_access_patient` era falso y
la política de lectura rechazaba toda fila, incluida la recién insertada (por
eso fallaba sólo al pedirla de vuelta). El permiso (`smyl_has_permission`) sí lo
tenía. Sólo dos clínicas estaban así: «Dd» y una vacía sin usuarios.

**Aplicado en producción (con el usuario de acuerdo):**
1. Migración `20261021004700_smyl_titular_effective_scope` (aplicada con la
   herramienta de Supabase; el archivo del repo lleva la misma versión): el
   titular de una clínica activa recibe `clinic` en todos los dominios, igual que
   ya recibe todos los permisos y la clínica en las otras dos funciones. Probada
   antes dentro de una transacción deshecha: alta permitida, 9 pacientes
   visibles (8 + el de prueba) y 0 de otras clínicas.
2. Fila de `dueño` para esa cuenta en `camila_usuarios` (nombre «Dd», correo de
   su cuenta). El trigger de equipo le asignó el rol Propietario y su sucursal.
   Verificado después con su identidad.

**Código:** `smyl-clinic.js` v11: ante un 42501 vuelve a preguntar el permiso y,
si existe, dice que falla el alcance de datos y no el permiso. Pruebas en
`tests/smyl-titular-scope.test.mjs`.

**Pendiente de producción (no aplicado):** el esquema de producción llega a
`20261016193000` más la de hoy. Faltan `20261019010000_smyl_appointment_reminder_delivery`
y `20261020150000_smyl_patient_intake_v2` (esta última con su flujo manual).
Mientras tanto el alta guarda sólo los datos básicos.

### 2026-10-20 — Claude (sesión backend): flujo manual de la migración de pacientes

- Nuevo `.github/workflows/smyl-pacientes-alta-v2-migracion.yml` (sólo
  `workflow_dispatch`) para aplicar `20261020150000_smyl_patient_intake_v2.sql`
  en el proyecto de SMYL (`rpxshsiwoxdbuevjjpfw`, el de `supabase/config.toml`).
  Comprueba que existan las tablas y funciones de las que depende y se detiene
  sin cambiar nada si falta alguna; aplica, verifica columnas, llaves, trigger,
  función y permisos, y registra la versión con `supabase migration repair`.
- **Requiere el secreto de repositorio `SUPABASE_ACCESS_TOKEN`** en este repo
  (Settings > Secrets and variables > Actions); el repo no tenía flujos antes.
- La migración se ejecutó antes en un Postgres real (PGlite) con la función de
  teléfono auténtica: idempotencia, sellado y borrado de la fecha de
  consentimiento, restricciones de origen y alertas, llaves compuestas por
  clínica (otra clínica rechazada, borrar sucursal deja el campo nulo), y la
  búsqueda de duplicados (formatos 521 y +52, correo en mayúsculas, exclusión
  del propio paciente, sin permiso, otra clínica, fuera de alcance, límite de 5,
  `authenticated` sí y `anon` no). El JavaScript del flujo se ejecutó contra ese
  mismo Postgres en tres escenarios: completo, sin prerrequisitos y ya aplicada.

### 2026-10-20 — Claude (sesión backend): contrato 1.6, lado de SMYL

**LANA ya sirve el contrato 1.6 (promodesk #1239 y #1240). Este cambio lo expone
a través del proxy `lana-inbox`; la interfaz es de la sesión visual.**

- `supabase/functions/lana-inbox/index.ts`:
  - `GET ?action=list` reenvía y valida `assignee` (`me`, `unassigned`, uuid),
    `stage_id` y `branch_id` (uuid o `none`), `priority`, `ai` (`ai|human`) y
    `window` (`open|expiring|expired|none`). Valor inválido → 400 con mensaje.
    La respuesta sigue pasando por `filterConversationPayload` (alcance por rol).
  - `GET ?action=ai_feedback&days&limit&rating` → feedback del copiloto, sólo
    propietario.
  - `POST action=priority` y `action=branch` (`messages.manage` + alcance de la
    conversación). La sucursal se valida contra `smyl_branches` del tenant y su
    nombre sale de la base, nunca del navegador; un rol con alcance limitado sólo
    usa sus sucursales (`smyl_member_branches`). `branch_id: null` la quita.
  - `POST action=stage_create | stage_update | stage_reorder | stage_seed_dental`
    (sólo propietario) → rutas `/inbox/stages…` de LANA. `stage_update` acepta
    `name` y `archived`; `stage_reorder` recibe `stage_ids`.
- `_shared/lana-contract.mjs`: cabecera `X-SMYL-LANA-Contract-Version` 1.6.
  **Hay que redesplegar** `lana-inbox`, `lana-connection` y `claude`.
- `docs/SMYL_LANA_CHAT_CONTRACT_V1.md` documenta 1.6 y la tabla de acciones.
- Pruebas: `tests/lana-inbox-contract-1-6.test.mjs`; la validación de filtros se
  ejercitó además con Bun sobre el código real.

**Para la sesión visual** (no toqué `smyl-inbox.js` ni `smyl-inbox.css`):
- El DTO de cada conversación trae `priority`, `branch_id` y `branch_name`.
- Ya hay contrato para: panel de filtros avanzados (responsable, etapa,
  sucursal, prioridad, IA/humano, ventana 24 h), selector de prioridad y de
  sucursal en el encabezado, tarjeta del Pipeline con sucursal, vista de calidad
  de IA para el propietario y administración de etapas (crear, renombrar,
  archivar, reordenar, «Usar etapas dentales»).
- Detectar capacidad con `GET /contract` (`inbox.filters`, `inbox.priorities`)
  en vez de asumirla; con LANA < 1.6 las acciones nuevas devuelven 404.
- Plegar una etapa es preferencia de pantalla: guardarla en el navegador.
- La configuración de etapas no queda auditada (brecha conocida).

### 2026-10-20 — Claude (sesión backend): contrato SMYL↔LANA sube a 1.5

- LANA fusionó en `main` promodesk #1234 (rutas 1.5: `DELETE /channels/:channel`,
  `GET /inbox/stages`, `pin`/`unpin`/`stage`, `search`, `shared`,
  `quick-replies`, `pilot`) y #1235 (plantillas, 1.3); #1238 añade el flujo
  manual de Actions que aplica la migración `20261020200000` (renombrada desde
  `20261014200000` para no quedar fuera de orden). El usuario lo ejecutó; no
  pude verlo desde la API, así que conviene comprobarlo con `GET /contract`
  (debe anunciar 1.5).
- Este cambio: `supabase/functions/_shared/lana-contract.mjs` pasa de `"1.0"` a
  `"1.5"` (cabecera `X-SMYL-LANA-Contract-Version`; LANA sólo la devuelve, no la
  valida), pruebas actualizadas, bundles de `docs/bundles` regenerados y
  `SMYL_LANA_CHAT_CONTRACT_V1.md` documenta 1.3–1.5.
- **Requiere redesplegar** las Edge Functions de SMYL que importan el módulo
  (`lana-connection`, `lana-inbox`, `claude`) para que la cabecera cambie.
- Siguiente tramo (1.6, en LANA): sucursal y prioridad en el DTO, filtros por
  responsable/etapa/sucursal, lectura de feedback del copiloto, ventanas de
  24 h y CRUD de etapas con semilla dental. Quedan fuera los commits de agenda
  en `meta-webhook`/`whatsapp-webhook` de `codex/smyl-meta-bridge`.

### 2026-10-20 — Claude (sesión backend): alta de pacientes v2 (entrega b)

**Objetivo del usuario: un alta de pacientes "profesional" que no deje crear
duplicados y capture lo que la clínica necesita.**

- Migración **preparada, no aplicada**
  `20261020150000_smyl_patient_intake_v2.sql`: columnas `origen`, `branch_id`,
  `professional_id` (FK compuestas a sucursal/profesional, `on delete set
  null`), `alertas_medicas text[]`, `consentimiento_whatsapp` +
  `consentimiento_whatsapp_at` (trigger que sella/borra la fecha); RPC
  `smyl_patient_duplicates(tenant,email,telefono,exclude)` para `authenticated`,
  que reutiliza `smyl_normalize_contact_phone()` (misma regla que la
  vinculación automática del chat) y respeta `patients.read` +
  `smyl_can_access_patient`.
- `app.html` (modal `#modal-paciente`): teléfono con prefijo de país
  (`#mp-tel-cc`, MX +52 por defecto) + número, correo, aviso de duplicados
  (`#mp-duplicados`), sección de atención (sucursal —oculta si hay <2—,
  profesional responsable, cómo nos conoció), alertas médicas como etiquetas
  (`#mp-alerta-input` → `#mp-alertas`), consentimiento de WhatsApp
  (`#mp-consent-wa`) y "Más datos · opcional" plegado (nacimiento, sexo,
  notas). Botón sin emoji. IDs originales conservados.
- `smyl-clinic.js`: `phoneKey()`/`composePhone()`/`splitPhone()` (guarda
  `+52 3312345678`; al editar separa prefijo y número), `findDuplicates()` con
  debounce al escribir teléfono/correo y **antes de guardar** (bloquea hasta
  "Abrir su ficha" o "Es otra persona, continuar"); si la RPC no existe
  (`PGRST202`) compara contra la lista cargada. Catálogos de sucursales y
  profesionales por RLS (`smyl_branches`, `smyl_professionals`, activos).
  Guardado con `Object.assign(data, extra)`; si la base responde `PGRST204`
  (columnas inexistentes) reintenta sólo con los campos básicos y deja aviso
  en la lista de Pacientes. Se quitó la recolocación por JS de la sección
  opcional: ya viene en el markup.
- `smyl-clinic.css`: `.modal-paciente`, `.mp-phone`, `.mp-chip(s)`,
  `.mp-check`, `.mp-dup*`, una columna en ≤600px. Columnas del modal con
  `minmax(0,1fr)` (el campo de teléfono las ensanchaba) y márgenes propios para
  el aviso de duplicados y «Más datos», porque `smyl-dialog-system.css` deja
  el padding del modal en 0 y sólo da 20px a los `.form-grid` directos.
  Verificado en Chromium (1280 y 390 px) con Supabase simulado.
- Pruebas: `tests/smyl-patient-intake-v2.test.mjs` (migración, markup, lógica,
  paridad y versiones); la de permisos acepta `smyl-clinic.js` v10+. Versiones
  `smyl-clinic.js?v=10`, `smyl-clinic.css?v=5` en `app.html` y `sw.js`.
- Pendiente de esta línea: tira de "siguiente acción" al abrir la Ficha 360
  tras guardar (agendar valoración / bienvenida por WhatsApp) — corresponde a
  la sesión visual junto con el Paciente 360 por pestañas; importación CSV.

## 2026-10-16 — Codex: política visual visible en Inicio y navegación

**La segunda pasada lleva la política v2 a la superficie que el dentista ve al
entrar, con una diferencia de composición perceptible y no sólo de tokens.**

- Inicio se reconstruyó como una mesa clínica compacta: encabezado operativo de
  24 px, una acción primaria, métricas en una sola banda y paneles sin alturas
  vacías artificiales.
- El azul clínico `#194391` pasa a ser la acción dominante; el teal queda
  limitado a disponibilidad y estado operativo.
- La barra superior se compactó, la acción global se llama “Nueva tarea” y el
  fondo general adopta el canvas `#F4F7FA` del sistema normativo.
- En pantallas pequeñas se elimina la segunda navegación superior: las cinco
  áreas principales viven en una barra inferior persistente con objetivos
  táctiles de 48 px.
- Accesos, indicadores, prioridades y agenda comparten una escala de 10–24 px,
  pesos 400/500/600/700, radios de 6–12 px y bordes sin sombras decorativas.
- Web, aplicación móvil y PWA avanzan a Inicio CSS v3, JS v4, shell CSS v4 y caché
  `smyl-v254-visible-shell-v4`.

**Validación:** 427/427 pruebas aprobadas y revisión visual de la portada en
1440×1000 y composición responsive estrecha.

## 2026-10-16 — Codex: Política Visual SMYL v2 normativa

**La identidad visual deja de depender de ajustes locales y queda definida como
un sistema profesional, medible y migrable para toda la plataforma.**

- Se reemplazó la política anterior, centrada principalmente en simulación, por
  tres contextos coordinados: SMYL Operativo, SMYL Studio y SMYL Paciente.
- Se fijaron tokens canónicos de color, tipografía, espacio, radio, borde,
  sombra, foco y movimiento; el azul es la acción operativa, el teal comunica
  disponibilidad/selección y el violeta queda reservado para IA y Studio.
- La escala tipográfica limita las ventanas a títulos de 18 px y elimina pesos
  arbitrarios, texto funcional microscópico y jerarquías basadas en tamaño.
- El sistema de ventanas define XS/S/M/L/Workspace, altura según contenido,
  una sola acción primaria, scroll único y comportamiento móvil accesible.
- Agenda queda establecida como el primer Workspace de referencia: compacta
  cuando falta configuración y amplia sólo cuando existen horarios reales.
- Se incorporaron reglas de privacidad visual, fotografía clínica, voz,
  responsive, WCAG 2.2 AA, gobierno técnico, migración y lista de aceptación.
- Un contrato automatizado protege los principios esenciales de la versión 2.
- Esta etapa modifica documentación normativa, no la interfaz publicada.

**Siguiente paso recomendado:** implementar tokens y primitivas, reconstruir
Agenda como referencia y solicitar aprobación visual antes de migrar otras
ventanas.

## 2026-10-16 — Codex: Agenda con densidad visual equilibrada

**La Agenda dentro del chat deja de sentirse sobredimensionada y conserva una
jerarquía clara en escritorio, tableta y celular.**

- El título baja a 21 px, los controles a 13 px y los textos de apoyo a 10–11
  px; el estado vacío usa 16 px para dejar de competir con la acción principal.
- Los controles miden 38 px en escritorio y 44 px en celular, manteniendo buena
  accesibilidad táctil sin inflar la interfaz.
- La ventana se compacta a 1000 px de ancho y 620 px en su estado vacío, con
  menos relleno, una sombra más ligera y una lectura más ordenada.
- En escritorio los filtros caben en una sola línea; en tableta se redistribuyen
  en dos y en celular ocupan el ancho disponible sin desbordarse.
- Web, aplicación móvil y PWA avanzan a Inbox CSS v20 y caché
  `smyl-v251-agenda-visual-density`.

**Validación:** revisión visual satisfactoria en 1280×720, pruebas de Inbox y
suite completa aprobadas, paridad web/móvil y compuerta de seguridad en verde.

## 2026-10-16 — Codex: vínculo automático seguro y jerarquía visual de Agenda

**Abrir una conversación identifica al paciente sin trabajo repetitivo y la
Agenda recupera una escala visual uniforme, legible y más tranquila.**

- Al abrir el chat, SMYL compara correo y teléfono canónico dentro de la clínica:
  vincula una coincidencia única o crea un contacto provisional cuando la
  identidad es nueva y verificable.
- Los duplicados o conversaciones sin correo/teléfono quedan para resolución
  humana; no se selecciona automáticamente al primer candidato.
- Abrir un chat nunca crea por sí solo un expediente o caso clínico. El caso se
  genera únicamente al iniciar una acción clínica explícita.
- La operación exige permisos, respeta tenant y alcance del paciente, usa
  idempotencia y bloqueos transaccionales para evitar vínculos duplicados.
- El contexto clínico vuelve a comprobar el alcance clínico aunque el usuario
  pueda leer la conversación.
- La Agenda usa ahora una escala tipográfica consistente de 10 a 23 px,
  controles de 42 px (46 px en móvil), mejor contraste y una distribución
  responsiva verificada en escritorio, tableta y celular.
- Web, aplicación móvil y PWA avanzan a Inbox JS v25, CSS v19, handoff v5 y
  caché `smyl-v250-chat-patient-hardening`.
- La resolución manual pasó al mismo puente autorizado del Inbox, el origen
  provisional persiste después de recargar y todos los flujos clínicos comparten
  un lock por conversación para impedir casos duplicados.
- La migración de vínculo seguro y las funciones `lana-inbox` y `lana-handoff`
  quedaron desplegadas en Supabase.

**Validación:** 418/418 pruebas aprobadas, compuerta de seguridad en verde,
base remota sin advertencias de esquema y revisión visual satisfactoria en
1280×720, 820×900 y 390×844.

## 2026-10-16 — Codex: Agenda guiada y recuperable desde Mensajes

**Agendar desde el chat ahora conduce al equipo incluso cuando falta el paciente
o no existen espacios en el periodo consultado.**

- La ventana avisa cuando la conversación todavía no está vinculada y ofrece
  `Vincular o crear paciente` sin abandonar el Inbox.
- Se agregaron periodos rápidos (`Esta semana`, `Próximos 15 días`, `Próxima
  semana`) y se conserva la selección manual de fechas.
- El estado vacío diferencia configuración incompleta de una consulta sin
  espacios, permite ampliar a todo el equipo y busca el próximo horario en un
  periodo posterior de 30 días.
- Cuando no hay opciones se oculta la acción final inservible y la ventana se
  compacta; con resultados conserva la agenda semanal y la selección de hasta
  tres alternativas.
- Los nombres de clínica y sucursal conservan su texto completo como ayuda, y
  la distribución fue validada en escritorio y celular.
- Web, aplicación móvil y PWA avanzan a Inbox JS v23 y CSS v18. No se modificó
  backend, migraciones ni el cálculo canónico de disponibilidad.

**Validación:** 409/409 pruebas aprobadas y revisión visual satisfactoria en
escritorio y celular, con paciente vinculado/no vinculado y con horarios/estado
vacío. Puerta automática de seguridad en verde.

## 2026-10-16 — Codex: identidad de clínica y estado vacío de Agenda

**La agenda del chat queda centrada y deja de confundir el nombre de la
conversación de Meta con la identidad clínica o del paciente.**

- El encabezado toma el nombre de la clínica desde `tenantData`; cuando se
  selecciona una sede, muestra el nombre de esa sucursal. Si hay varias y no se
  eligió una, comunica explícitamente `todas las sucursales`.
- El paciente aparece en una etiqueta independiente sólo desde la ficha clínica
  vinculada; si no existe vínculo, se muestra `Paciente por vincular`.
- La ventana usa centrado fijo, mayor ancho útil, filtros sin recortes, icono de
  agenda y una jerarquía visual consistente con SMYL.
- El estado sin horarios deja de ser texto suelto: ahora tiene explicación y
  accesos para consultar los siguientes siete días o restablecer sede/equipo.
- El estado vacío y la carga ocupan una sola columna en celular, evitando el
  desplazamiento incorrecto heredado de la agenda semanal.
- Web, aplicación móvil y PWA avanzan a Inbox JS v22 y CSS v17. No se modificó
  backend ni migraciones.

**Validación:** 409/409 pruebas aprobadas, puerta de seguridad en verde y
revisión visual satisfactoria en agenda con espacios, estado vacío y celular.

## 2026-10-16 — Codex: agenda visual por profesional dentro del chat

**La ventana de cita deja de mostrar un área vacía y presenta la disponibilidad
real como agenda semanal, manteniendo al equipo dentro de la conversación.**

- Al abrir, selecciona el primer servicio disponible y consulta automáticamente
  los horarios del periodo; el botón queda como actualización manual.
- El tablero agrupa los espacios por día y muestra hora, duración, profesional,
  especialidad/rol dental y sucursal. Los filtros permiten limitar la vista por
  servicio, sede o integrante del equipo sin navegar al módulo Agenda.
- Escritorio muestra hasta cuatro días en paralelo. En celular conserva una
  columna amplia por día con desplazamiento horizontal y acciones táctiles.
- La acción administrativa para registrar o confirmar aparece sólo después de
  elegir una opción o cuando ya existe una solicitud, reduciendo ruido visual.
- Web, aplicación móvil y PWA avanzan a Inbox JS v21 y CSS v16. No se modificó
  backend, migraciones ni el cálculo canónico de disponibilidad.

**Validación:** 409/409 pruebas aprobadas, puerta de seguridad en verde y
revisión visual satisfactoria en escritorio y celular.

## 2026-10-16 — Codex: agenda integrada dentro de Mensajes

**Agendar una cita ya no saca al equipo de la conversación: ambos accesos del
Inbox abren la misma ventana de disponibilidad sobre el chat activo.**

- La barra de atención y la acción contextual `Agendar cita` usan el flujo
  integrado; se eliminó la navegación inconsistente al módulo Agenda.
- La ventana aparece inmediatamente y después consulta servicios, sedes y
  profesionales. Mientras carga bloquea los campos para evitar acciones dobles
  y mantiene los errores dentro de la propia ventana.
- El encabezado identifica al paciente y explica que la conversación no se
  cerrará, reduciendo el riesgo de preparar opciones para el hilo equivocado.
- En escritorio funciona como ventana sobre el chat; en celular ocupa la
  pantalla disponible y al cerrarse devuelve al mismo hilo.
- Web, aplicación móvil y PWA avanzan a Inbox JS v20. No cambió el backend, las
  migraciones ni la separación de datos entre SMYL y LANA.

**Validación:** 408/408 pruebas aprobadas, puerta de seguridad en verde,
JavaScript válido y revisión visual satisfactoria en escritorio y móvil.

## 2026-10-16 — Codex: bandeja enfocada del Inbox, etapa 3 final

**La reorganización visual de Mensajes queda completa: la cola muestra primero
el trabajo diario y conserva las herramientas de menor frecuencia bajo demanda.**

- La bandeja deja visibles únicamente `Todas`, `Por atender` y `Mías`, cada una
  con su conteo. `Sin leer`, `En atención`, `Fijadas`, canal, selección múltiple
  y actualización viven en un panel `Filtros` compacto.
- Cada conversación muestra un solo estado operativo (`Por atender`, `Con el
  equipo` o `IA activa`), además de canal, responsable y etapa en segundo nivel;
  se retiró la repetición de etiquetas que saturaba la lectura.
- El panel de filtros se superpone sin reducir la cola y responde de forma
  equivalente en escritorio y celular. La prueba visual usa una versión propia
  para evitar falsos resultados por caché.
- Los recursos avanzan a Inbox JS v19 y CSS v15 en web, aplicación móvil y
  precaché PWA. No cambió el contrato de backend ni la fuente canónica de LANA.

**Validación final sobre la rama vigente de producción:** 405/405 pruebas
aprobadas, puerta de seguridad en verde y
revisión visual satisfactoria en escritorio y celular, incluyendo apertura y
cierre de filtros. Las tres etapas de optimización del chat están terminadas.
Publicación funcional confirmada en GitHub Pages desde `3bd331c`; el sitio
público entregó Inbox JS v19, CSS v15, filtros progresivos y el cajón lateral.

## 2026-10-16 — Codex: contexto progresivo del Inbox, etapa 2

**Mensajes deja de reservar una tercera columna permanente: el hilo gana espacio
y los datos del paciente aparecen únicamente cuando el equipo los solicita.**

- El escritorio usa dos columnas para bandeja y conversación. La ficha lateral
  se convirtió en un cajón superpuesto, con fondo de enfoque y cierre explícito,
  tanto en escritorio como en tableta y celular.
- `Siguiente acción` permanece visible al abrir el cajón; responsable,
  organización, asistente, ventana de WhatsApp, automatización, programados,
  Copilot, cita, disponibilidad y Ficha 360 se agrupan en secciones desplegables.
- SMYL abre automáticamente sólo las secciones que requieren atención: solicitud
  humana, cita pendiente, paciente por vincular o conversación sin responsable.
- El estado abierto de cada sección se conserva por conversación durante la
  sesión para evitar que una actualización del hilo desarme el espacio de trabajo.
- Web y móvil permanecen sincronizados y se añadió una prueba dedicada a la
  distribución, al comportamiento progresivo y a la paridad de ambos paquetes.

**Validación:** 378/378 pruebas aprobadas, puerta de seguridad en verde y
revisión visual satisfactoria en escritorio, tableta y celular, incluyendo
apertura y cierre del cajón. No se modificaron backend, migraciones, RLS, datos
clínicos ni integraciones de Meta. La etapa 3 debe simplificar la bandeja,
filtros y densidad móvil.

## 2026-10-16 — Codex: enfoque conversacional del Inbox, etapa 1

**Mensajes reduce el ruido visible sin retirar funciones: la conversación y la
acción inmediata quedan en primer plano.**

- La cabecera del hilo muestra paciente, canal, responsable, estado y una sola
  acción operativa (`Tomar control` o `Reanudar IA`). Búsqueda, archivos,
  fijación y detalles pasan al menú `Más`.
- El compositor deja visibles `+`, mensaje, Copilot y enviar. Adjuntos,
  respuestas rápidas, plantilla, programación, voz, ubicación y emoji se
  conservan en un menú colapsable que también funciona con la ventana de
  WhatsApp vencida.
- Cada mensaje presenta únicamente `Responder` y `Más`; destacar, reenviar,
  eliminar, revisión clínica y evaluación de IA se revelan bajo demanda.
- La continuidad de expediente y rol permanece disponible para tecnologías de
  asistencia sin añadir texto visual a la cabecera.
- Web y móvil permanecen sincronizados. Se añadió una prueba específica y el
  fixture del Inbox admite el estado `focus` para QA sin diálogos superpuestos.

**Validación:** 374/374 pruebas aprobadas, puerta de seguridad en verde y
revisión visual satisfactoria en escritorio y celular, incluyendo apertura de
herramientas y acciones secundarias. No se modificaron backend, migraciones,
RLS, datos clínicos ni integraciones de Meta. La etapa 2 debe convertir el
panel derecho en un cajón colapsable con secciones progresivas.

## 2026-10-16 — Codex: respuesta visible al activar el micrófono

**MILA ya no queda aparentemente inmóvil cuando el navegador retiene la
solicitud del micrófono.**

- Los controles de voz se enlazan inmediatamente, sin esperar a que termine la
  carga de sesión, pacientes y consumos.
- Al pulsar `Activar`, la interfaz muestra `Solicitando permiso…` y confirma que
  está esperando la autorización del dispositivo.
- Si el navegador integrado no presenta el permiso en diez segundos, MILA
  recupera el botón y explica dónde habilitarlo en navegador o Android.
- Una autorización que llegue después del límite se cierra de forma segura para
  no dejar el micrófono activo en segundo plano.

**Validación:** contrato actualizado para el estado pendiente, la recuperación
por timeout y la vinculación inmediata de la interfaz.

## 2026-10-16 — Codex: micrófono y experiencia simple de MILA

**MILA queda centrada en una sola acción de voz y ahora diagnostica el acceso
al micrófono antes de grabar o conversar.**

- Se eliminó la columna explicativa y se redujo la portada a selector de
  paciente, autorización, modos `Transcribir`/`Conversar` y botón central.
- La interfaz distingue micrófono listo, permiso pendiente, permiso bloqueado,
  dispositivo ausente y micrófono ocupado; muestra instrucciones específicas
  para navegador o Android y permite volver a comprobarlo.
- Ambos flujos de voz usan la misma validación de acceso, sin cambiar las
  confirmaciones clínicas, la grabación privada ni las acciones de backend.
- Android declara `android.permission.RECORD_AUDIO`, requisito que faltaba en
  la app nativa. Web y `mobile/www` conservan paridad.
- Se añadieron contratos para el permiso nativo, la recuperación del micrófono
  y la reducción de ruido visual.

**Validación:** 393/393 pruebas aprobadas, scripts de MILA válidos y
`git diff --check` sin errores. La copia nativa se regenerará con el siguiente
`npm run cap:sync` del entorno de compilación.

## 2026-10-15 — Codex: expediente simple y simulaciones separadas

**La ficha del paciente reduce su navegación a Resumen, Expediente, Tratamiento
y Actividad; las simulaciones dejan de presentarse como evidencia clínica.**

- La cabecera comunica el estado del paciente y una sola siguiente acción.
- Expediente reúne accesos secundarios a antecedentes, odontograma,
  evoluciones, estudios y documentos sin convertirlos en ocho pestañas iguales.
- El recorrido usa `Documentación clínica` para fotografías originales,
  radiografías y archivos; la galería antes/después ya no se renderiza dentro de
  ese bloque.
- `Simulaciones de sonrisa` conserva su ruta independiente y desde la ficha sólo
  aparece una referencia explícitamente orientativa con accesos para consultar
  o crear una simulación.
- El menú y la portada dejan de llamar `Historial` a las simulaciones y separan
  la ruta clínica de la herramienta visual.
- No cambió el modelo de datos, los permisos, la auditoría ni los archivos
  existentes. Web, móvil y PWA avanzan a los recursos versionados de esta etapa.

**Validación:** 383/383 pruebas aprobadas, puerta de seguridad completa en
verde y `git diff --check` sin errores. Publicado en GitHub Pages mediante el
commit `1d58f42`.

**Despliegue backend:** las migraciones `20261015030000` a `20261015050000`
quedaron aplicadas en producción y `lana-inbox` quedó activa en la versión 19.
El historial local también incorpora las migraciones remotas concurrentes
`20261015123000` y `20261015160000`; `supabase db lint --linked --level warning`
terminó sin errores.

## 2026-10-15 — Codex: alcances efectivos en Mensajes y Finanzas

**La configuración flexible de roles ya se aplica del lado del servidor en la
bandeja, Ficha 360, caja y CFDI; no depende de ocultar botones en la interfaz.**

- `lana-inbox` resuelve el alcance más amplio de los roles activos. Con alcance
  limitado sólo entrega conversaciones asignadas al integrante o vinculadas a
  pacientes que pertenecen a su práctica, equipo o sucursales.
- El mismo control bloquea enlaces directos, mensajes, archivos, Copilot,
  Agenda desde el chat, organización y reenvíos cuyo origen no sea accesible.
- Los indicadores globales del Inbox sólo están disponibles con alcance de
  clínica, evitando revelar conteos de conversaciones ajenas.
- `20261015050000_smyl_chat_finance_scopes.sql` filtra cargos, pagos,
  devoluciones, recibos, cajas, perfiles fiscales, borradores y cancelaciones
  por paciente o sucursal. La configuración fiscal del emisor sigue siendo de
  alcance clínico completo.
- Triggers impiden que operaciones privilegiadas creen o modifiquen movimientos
  fuera del alcance del usuario; la cuenta privada de integraciones conserva su
  funcionamiento.

**Validación:** 379/379 pruebas aprobadas, pruebas específicas de alcance y
puerta de seguridad en verde, sin errores de formato. La implementación está
preparada localmente; migraciones `20261015030000` a `20261015050000` todavía
no se aplican ni publican hasta un despliegue controlado.

## 2026-10-15 — Codex: alcances configurables por rol

**Cada rol puede combinar libremente sus funciones con un alcance de datos:
propio, equipo tratante, sucursales asignadas o toda la clínica.**

- Mi clínica v4 agrega selectores de alcance independientes para Pacientes,
  Agenda, Expediente clínico, Mensajes y Finanzas, y resume la configuración en
  cada tarjeta de rol.
- `20261015040000_smyl_role_data_scopes.sql` crea los alcances, el equipo
  tratante paciente-profesional y operaciones seguras para guardar roles y
  asignar profesionales.
- Los roles existentes reciben valores iniciales: administración/recepción y
  finanzas conservan la operación amplia; odontólogos parten de acceso propio;
  asistentes clínicos parten del equipo tratante. Todo puede editarse.
- RLS restringe pacientes, citas, horarios, bloqueos, solicitudes, eventos,
  recordatorios, antecedentes, notas, versiones, adendas y archivos según el
  alcance configurado. Triggers protegen también escrituras realizadas mediante
  funciones privilegiadas.
- Un administrador delegado no puede conceder un alcance superior al suyo. El
  servicio privado conserva el acceso necesario para integraciones verificadas.
- Web y móvil permanecen sincronizados y la PWA carga Mi clínica v4.

**Validación:** 374/374 pruebas aprobadas, puerta de seguridad en verde,
sintaxis JavaScript válida y paridad web/móvil confirmada. Las migraciones
`20261015030000` y `20261015040000` siguen preparadas, no aplicadas ni
publicadas. Mensajes y Finanzas ya almacenan el alcance elegido, pero su filtrado
específico se completa en sus respectivas etapas para no cambiar contratos del
puente LANA ni del libro financiero sin pruebas dedicadas.

## 2026-10-15 — Codex: roles configurables por funciones

**Los perfiles dejaron de presentarse como paquetes rígidos: la clínica puede
crear roles y activar o desactivar funciones mediante pastillas.**

- `Mi clínica > Equipo, roles y profesionales` incluye un editor agrupado para
  clínica, pacientes, agenda, cotizaciones, mensajes, caja e inventario.
- Los siete roles iniciales continúan como plantillas editables; Propietario se
  conserva protegido para evitar perder el control de la clínica.
- La migración `20261015030000_smyl_custom_roles.sql` agrega una operación
  transaccional para crear/editar roles y reemplazar sus funciones. Un
  administrador delegado sólo puede conceder funciones que él mismo posee.
- La asignación de roles acepta a integrantes con `team.manage`, conserva la
  protección del propietario e impide asignar un rol con privilegios superiores.
- Web y móvil usan Mi clínica v3 y mantienen paridad byte a byte.

**Validación:** 369/369 pruebas aprobadas, puerta de seguridad en verde,
`supabase db lint --linked --level warning` sin errores y paridad web/móvil
confirmada. La migración está preparada pero no se aplicó ni se publicó en
este turno. Siguiente etapa: alcances configurables por agenda, sucursal,
profesional y equipo tratante, con RLS real sobre pacientes y citas.

## 2026-10-15 — Codex: Agenda, integridad previa al chatbot

**Agenda manual y disponibilidad conversacional ya comparten reglas clínicas
para tiempos de preparación, profesionales, sucursales y sillones.**

- La migración `20261015020000_smyl_schedule_integrity_v2.sql` introduce una
  validación canónica con el servicio explícito. Compara los buffers anteriores
  y posteriores tanto de la cita nueva como de las citas existentes, además de
  bloqueos, horarios profesionales, horario de clínica y recursos físicos.
- `smyl_inbox_available_slots_v2` genera espacios alineados cada 15 minutos en
  la zona horaria de cada sede, asigna un sillón disponible cuando existen
  espacios configurados y excluye citas, bloqueos y apartados conversacionales
  activos. La función anterior se conserva como adaptador compatible.
- Las solicitudes de Inbox guardan `preferred_room_id` y un apartado temporal
  de diez minutos. El vencimiento libera el espacio, pero la solicitud continúa
  pendiente para revisión humana; LANA no crea citas confirmadas.
- Crear, reprogramar y aceptar solicitudes usan las mismas reglas. La interfaz
  corrige el profesional preferido, filtra por servicio y sede, exige sillón
  cuando corresponde, muestra el tiempo clínico protegido y usa intervalos de
  15 minutos dentro del horario configurado.
- Web y móvil usan Agenda JS v10. La migración fue aplicada al proyecto Supabase
  enlazado y el lint remoto no reportó errores.
- El puente privado `lana-inbox` ya tenía disponibles las operaciones de
  consulta, elección y confirmación humana. El adaptador compatible conserva
  ese contrato y hace que esas operaciones reciban las reglas reforzadas sin
  exponer la base clínica ni credenciales de Meta al navegador.

**Validación:** 362/362 pruebas aprobadas sobre la rama integrada del Inbox,
puerta de seguridad en verde,
paridad web/móvil confirmada y revisión visual satisfactoria en escritorio,
tablet y celular con información demostrativa. La siguiente etapa es permitir
que el runtime del asistente de LANA invoque únicamente la consulta de
disponibilidad y prepare opciones; la confirmación de la cita seguirá siendo
una acción explícita del equipo.

## 2026-10-15 — Codex: costeo histórico y kits auditados

**Las salidas nuevas de inventario ya congelan un costo calculado en servidor
y los materiales de un kit pueden retirarse con permiso y auditoría.**

- La migración `20261015010000_smyl_inventory_costing_v1.sql` calcula costo
  promedio ponderado por lote —o por insumo cuando no hay lote— a partir de
  recepciones y ajustes de entrada confirmados, excluyendo entradas compensadas.
- `smyl_post_inventory_movement` ignora cualquier costo enviado por el
  navegador para traslados, consumos, mermas y ajustes de salida. El servidor
  deriva el valor y lo congela en la línea; si no existe evidencia, conserva
  `null` en lugar de inventar cero. Sólo un ajuste de entrada puede aportar un
  costo manual.
- No se revalorizaron ni modificaron movimientos históricos inmutables. La
  interfaz usa el costo congelado cuando existe y marca los registros anteriores
  con la referencia actual de compras recibidas.
- `smyl_remove_service_material` resuelve tenant y permiso `inventory.manage`
  en servidor, elimina únicamente la relación solicitada y escribe el estado
  anterior en `smyl_audit_events`. No se concedió `DELETE` directo a la tabla.
- Inventario permite retirar materiales con confirmación y aclara que los
  consumos ya registrados no cambian. Web y móvil usan JS v6, CSS v5 y caché
  PWA `smyl-v245-server-costing`.
- Se recuperaron del historial remoto las migraciones ya aplicadas
  `20261014030000` y `20261014040000`, ausentes en el checkout, para volver a
  alinear repositorio y Supabase sin reparar ni alterar el historial remoto.

**Validación:** 336/336 pruebas aprobadas, puerta de seguridad en verde,
paridad web/móvil confirmada, migración aplicada al proyecto Supabase enlazado
y lint remoto de esquema sin errores. GitHub Pages terminó correctamente y el
sitio público entregó Inventario v6, CSS v5, retiro auditado y caché
`smyl-v245-server-costing`. La revisión automática del navegador local quedó
limitada porque la política de la herramienta rechazó el acceso a loopback; no
se intentó eludir esa protección.

## 2026-10-15 — Codex: costos de referencia y uso de materiales

**Inventario incorpora una lectura económica operativa sin presentar
estimaciones como utilidad contable. No se modificaron migraciones, RLS, RPC ni
datos clínicos.**

- Se agregó la pestaña `Costos y uso`, protegida por el permiso de lectura de
  Inventario y alimentada únicamente con compras, kits y movimientos existentes.
- El costo de referencia por insumo usa cantidades realmente recibidas y su
  costo unitario; los pedidos no recibidos y los precios faltantes no se
  convierten silenciosamente en cero.
- Cada tratamiento muestra costo estimado del kit, precio de referencia, uso
  observado y el resto antes de honorarios, laboratorio, impuestos y otros
  gastos. La interfaz evita llamarlo margen o utilidad.
- La cobertura identifica materiales sin precio, consumos con costo incompleto
  y merma estimada. Los movimientos compensados se excluyen de la lectura.
- Web y copia móvil usan Inventario JS v5, CSS v4 y caché PWA
  `smyl-v244-treatment-costs`.
- Para disponer de costo real histórico, el backend debe congelar de forma
  confiable el costo de salida al confirmar cada consumo. La función actual
  acepta `unit_cost`, pero el cliente de consumo lo envía vacío; no se trasladó
  esa responsabilidad sensible al navegador.

**Validación:** 332/332 pruebas aprobadas, puerta de seguridad en verde,
paridad byte a byte entre web y móvil y vista de QA responsive revisada con
información demostrativa no real. Publicación confirmada en GitHub Pages con
Inventario v5, CSS v4 y caché `smyl-v244-treatment-costs` entregados por el
sitio público.

## 2026-10-15 — Codex: kits de materiales por tratamiento

**Inventario ya prepara el consumo clínico desde el tratamiento de la cita,
sin modificar migraciones, RLS, RPC ni datos clínicos.**

- `Catálogo y configuración` incorpora `Kits por tratamiento`: el equipo con
  `inventory.manage` puede asociar insumos y cantidades habituales a cada
  servicio mediante la tabla existente `smyl_service_materials`.
- Desde `Paciente > Citas y materiales`, `Material utilizado` transmite también
  el servicio de la cita. Inventario carga el kit, paciente, cita, profesional
  y motivo, y permite ajustar, agregar o quitar filas antes de confirmar.
- Todos los materiales se envían juntos al RPC transaccional existente
  `smyl_post_inventory_movement`; se siguen validando lote vigente,
  caducidad, trazabilidad por paciente, existencia e idempotencia.
- La interfaz explica el flujo con menos captura repetitiva, muestra controles
  por material y responde en escritorio y móvil. Web y copia móvil usan
  inventario JS v4, CSS v3, Paciente 360 v5 y caché PWA
  `smyl-v243-treatment-kits`.
- No se agregó eliminación persistente de elementos del kit: la tabla actual
  concede `insert/update`, pero no `delete`, a `authenticated`. Retirarlos de
  la configuración requiere una etapa posterior de backend/permisos; sí se
  pueden omitir libremente del consumo de una atención.

**Validación:** 331/331 pruebas aprobadas, puerta de seguridad en verde,
paridad byte a byte entre web y móvil y revisión visual local con datos
demostrativos no reales. Publicación confirmada en GitHub Pages con Inventario
v4, Paciente 360 v5 y caché `smyl-v243-treatment-kits` entregados por el sitio.

## 2026-10-14 — Codex: ficha administrativa y consumo por atención

**Se conectaron Pacientes, Caja e Inventario desde la experiencia web sin
modificar esquema, RLS, funciones ni información clínica.**

- `Datos fiscales` dejó de ser una acción global de Caja. El receptor se
  consulta y actualiza en `Paciente > Administrativo`, protegido por permisos
  `finance.read` y `finance.manage` y separado de la historia clínica.
- La preparación de CFDI envía a la ficha correcta cuando falta información
  del receptor. El emisor y la preparación del PAC continúan en Finanzas.
- Las citas en curso o completadas muestran `Material utilizado` a quienes
  tienen `inventory.manage`. El registro abre Inventario como consumo clínico
  con paciente, cita, profesional y motivo precargados.
- El movimiento mantiene el RPC transaccional existente, selección de lote,
  bloqueo de caducados, trazabilidad y correcciones compensatorias.
- Se actualizaron las copias web/móvil y la caché PWA
  `smyl-v242-patient-operations`.

**Validación:** 330/330 pruebas aprobadas, puerta de seguridad en verde,
revisión visual completada en escritorio y composición móvil con una ficha
demostrativa sin datos reales, y publicación confirmada en GitHub Pages.

## 2026-10-14 — Codex: directorio profesional guiado

**El directorio dejó de presentarse como un formulario largo y ahora comunica
avance, próximos pasos y una recompensa visible. No se modificó backend, RLS,
Storage ni información clínica.**

- La ficha muestra porcentaje de avance, barra, pendientes concretos y cuatro
  pasos: identidad, presentación, confianza y publicación.
- Ficha, casos autorizados y reseñas verificadas son espacios separados; sólo
  se muestra una tarea principal a la vez.
- El formulario usa `Anterior` y `Siguiente`, conserva `Guardar borrador` y
  habilita la acción final únicamente cuando están los requisitos esenciales.
- La vista pública se actualiza mientras se escribe y permite previsualizar una
  fotografía local antes de subirla.
- Se renovó la imagen visual con jerarquía más clara, carga de archivos amable,
  progreso circular, guía contextual y adaptación móvil simplificada.
- Web y copia móvil usan los mismos activos v5; caché PWA
  `smyl-v241-guided-directory`.

**Validación:** 327/327 pruebas aprobadas, puerta de seguridad en verde,
revisión visual local completada y publicación confirmada en GitHub Pages.

## 2026-10-14 — Codex: recuperación del acceso a SMYL

**Se pausó la preparación de la etapa 9 para corregir el bloqueo de acceso
reportado por el usuario. No se tocaron RLS, funciones, migraciones ni datos.**

- La puerta de acceso de `app.html` permite solicitar un enlace seguro para
  crear una contraseña nueva y procesa el regreso de Supabase dentro de SMYL.
- Se corrigió un error de sintaxis previo en el render de recomendaciones que
  detenía todo el bloque principal de JavaScript; por eso tampoco llegaban a
  existir las funciones de inicio de sesión. Una prueba nueva compila todos los
  scripts inline de `app.html` para impedir que vuelva a publicarse así.
- La respuesta de recuperación es neutra: no confirma si el correo pertenece a
  una cuenta. Los errores de credenciales, correo pendiente y límite de intentos
  ahora se explican en español.
- Una suscripción vencida ya no expulsa al profesional de sus expedientes. El
  panel queda disponible para consulta y renovación, mientras los consumos de
  pago siguen gobernados por los controles del servidor. Una cuenta suspendida
  sí continúa cerrando la sesión.
- Web y copia móvil se mantienen iguales; la caché PWA avanzó a
  `smyl-v240-auth-recovery`.

**Validación:** la puerta cargó completa en un origen local aislado y la ayuda
de recuperación respondió sin enviar un correo real. La etapa 9 de seguridad
continúa pausada hasta confirmar el acceso en producción.

## 2026-10-14 — Codex: seguridad, etapa 8 preparada para recuperación

**El kit de respaldo/restauración está listo; no se exportaron datos de
producción ni se simuló un proveedor antimalware inexistente.**

- `create-encrypted-backup.mjs` vuelca roles, esquema y datos del proyecto
  vinculado, copia nueve buckets mediante Storage API, cifra cuatro artefactos
  con `age` y produce un manifiesto SHA-256 sin secretos.
- La salida debe ser nueva, estar fuera del repositorio y contener únicamente
  artefactos cifrados. Los temporales se crean bajo el directorio temporal
  validado y se eliminan en `finally`.
- `validate-restore-evidence.mjs` exige destino desechable, migraciones/lint,
  conteos y hashes de objetos, aislamiento, URLs vencidas, JWT y RPO/RTO.
- `SMYL_MANAGED_ANTIMALWARE_CONTRACT.md` define cuarentena fail-closed, DPA,
  retención, evidencia mínima y pruebas limpia/EICAR/timeout. Su estado es
  explícitamente `No aprobado` hasta contratar e integrar un proveedor.
- El modo seco del respaldo fue verificado con las herramientas instaladas;
  las cinco pruebas enfocadas aprobaron.

**Pendiente para cerrar la etapa:** ejecutar un respaldo cifrado en estación
dedicada, restaurarlo en un proyecto desechable, medir RPO/RTO y completar las
pruebas con un proveedor antimalware contratado.

## 2026-10-14 — Codex: seguridad, etapa 7 preparada para dos clínicas

**El arnés de aislamiento está listo, pero no se ejecutó contra producción.**

- `scripts/two-tenant-isolation.mjs` exige dos cuentas propietarias sintéticas,
  resuelve el tenant desde sesión y prueba pacientes, inventario, RPC clínica,
  Realtime y Storage.
- El ejecutor rechaza explícitamente el project ref productivo y requiere la
  confirmación literal `DISPOSABLE_TWO_TENANT_PROJECT`.
- Realtime sólo se declara aprobado si primero recibe un evento propio de
  control. Storage sólo se aprueba con un objeto sintético `clean` que B pueda
  leer y A no.
- El reporte conserva únicamente estados, códigos y una huella del proyecto;
  no imprime URL, correos, contraseñas, tokens ni IDs clínicos.
- `docs/SMYL_SECURITY_STAGE7_TWO_TENANTS.md` documenta preparación, variables,
  ejecución y criterios. Las pruebas estáticas del arnés aprueban 5/5.

**Pendiente para cerrar la etapa:** crear/conectar un proyecto Supabase
desechable, provisionar dos clínicas ficticias y ejecutar hasta obtener `PASS`.
No ejecutar este arnés contra la base productiva.

## 2026-10-14 — Codex: seguridad, etapa 6 de validación previa al lanzamiento

**La preparación técnica quedó en verde; el uso con datos clínicos reales sigue
bloqueado hasta validación externa.**

- `20261014180000_smyl_security_validation_fixes.sql` corrige tres errores
  detectados en producción: inventario ambiguo, serie diaria inválida y hash de
  exportación sin resolución explícita de pgcrypto.
- `20261014181000_smyl_security_lint_cleanup.sql` elimina las advertencias de
  tipos y variables antiguas. `supabase db lint --linked --level warning`
  termina sin hallazgos.
- El cliente web de Supabase quedó fijado en `2.117.3`, versión estable revisada,
  y web/móvil permanecen sincronizados en `smyl-v239-security-validation`.
- `scripts/security-release-gate.mjs` revisa dependencias flotantes, secretos
  literales, JWT, cuarentena, bitácoras privadas, correcciones y paridad.
- La matriz de abuso y la puerta de salida documentan pruebas entre dos
  clínicas, IDOR/Storage, archivos, roles, funciones, exportaciones y LANA/Meta.
- Validación local: 310/310 pruebas aprobadas. Migraciones aplicadas en la base
  vinculada. Esto no equivale a un pentest externo.

**Bloqueadores de lanzamiento clínico:** prueba dinámica de dos tenants en un
proyecto desechable, pentest externo, simulacro de restauración de PostgreSQL y
Storage, antimalware administrado y confirmación de rotación de claves
históricamente expuestas.

## 2026-10-14 — Codex: seguridad, etapa 5 de monitoreo y respuesta

**SMYL ya detecta señales, registra exportaciones y guía la respuesta sin exponer PHI.**

- `20261014170000_smyl_security_monitoring.sql` crea bitácoras privadas para
  huellas de acceso, exportaciones y señales. Todas tienen RLS, cero permisos
  directos para navegador y operaciones exclusivas de `service_role`.
- `security-monitor` exige sesión real y deriva actor y clínica en servidor. La
  IP y el agente del navegador sólo se usan en memoria para una huella SHA-256
  con pepper; nunca se persisten ni regresan al cliente.
- Se observan varios entornos por usuario, exportaciones concentradas, archivos
  rechazados, errores de mantenimiento, legado pendiente y cambios repetidos de
  roles. Son señales de revisión, no afirmaciones automáticas de intrusión.
- PDF clínico, propuesta PDF, recibo y reporte CSV registran la exportación antes
  de crear el documento. Los identificadores de entidad se guardan como hashes.
- `smyl-security-center.js/css` agrega Seguridad a la configuración, muestra
  métricas y señales, y permite investigar o resolver con nota auditada. Las
  señales abiertas también llegan al Centro de alertas.
- `docs/SMYL_SECURITY_INCIDENT_RUNBOOK.md` documenta contención, verificación,
  preservación, corrección, cierre y escalamiento sin copiar datos clínicos.
- Web y móvil están sincronizados en `smyl-v238-security-monitoring`.

**Siguiente etapa:** validación independiente: aislamiento entre clínicas,
dependencias, matriz de abuso y pentest antes de usar datos clínicos reales.

## 2026-10-14 — Codex: seguridad, etapa 4 de ciclo de vida

**SMYL limpia cargas abandonadas sin borrar evidencia clínica vinculada.**

- `20261014160000_smyl_file_lifecycle.sql` define retención por bucket: 24 h
  para cuarentena pendiente, 1 h para residuos rechazados y 7 días para cargas
  limpias nunca vinculadas. `linked_auto_delete=false` es obligatorio.
- Antes de eliminar, `smyl_file_is_referenced` revisa Ficha 360, casos,
  radiografías, propuestas, perfiles y casos profesionales. Después, la función
  confirma que Storage ya no entregue el objeto y registra resultado, motivo,
  actor y fecha en una bitácora privada inmutable para usuarios normales.
- `file-lifecycle-maintenance` exige una sesión real y deriva el tenant en el
  servidor. Se dispara al iniciar sesión, se limita a una ejecución cada 12 h
  por clínica y procesa lotes acotados.
- Hasta tres objetos históricos se reanalizan por ciclo. Los válidos pasan a
  `clean`; los dudosos pasan a `legacy_review` pero permanecen disponibles para
  revisión humana. Nunca se destruye automáticamente un archivo histórico.
- El analizador binario se centralizó en `_shared/file-security.ts` para que la
  carga nueva y el reescaneo apliquen exactamente las mismas reglas.
- El manifiesto conserva MIME, tamaño y SHA-256. El respaldo externo cifrado y
  las pruebas de restauración siguen siendo una dependencia operativa externa;
  no se confunden los backups de PostgreSQL con los objetos de Storage.

**Siguiente etapa de seguridad:** monitoreo y respuesta a incidentes: alertas de
acceso anómalo, trazabilidad de exportaciones, tablero de seguridad y runbooks.

## 2026-10-14 — Codex: seguridad, etapa 3 de archivos clínicos

**Los archivos privados quedan en cuarentena hasta que el servidor verifica su contenido.**

- La migración `20261014150000_smyl_secure_clinical_files.sql` cubre fotografías
  de casos, radiografías, archivos de Ficha 360, comparativas de propuestas,
  CV y casos profesionales. Cada objeto nuevo nace como `pending`; los RPC no
  pueden vincularlo a un registro y las políticas no permiten leerlo hasta que
  quede `clean`.
- `secure-clinical-file` exige sesión profesional, resuelve la clínica en el
  servidor, valida ruta, límite, firma binaria real, tamaño y SHA-256. Los PDF
  con JavaScript, acciones automáticas, adjuntos, RichMedia o XFA se rechazan y
  el objeto se elimina. Esto es cuarentena y análisis de contenido; no se
  presenta como sustituto de un motor antimalware especializado.
- Los objetos previos se etiquetan `legacy`, preservando operación sin afirmar
  que fueron inspeccionados por el control nuevo. Quedan disponibles para una
  campaña posterior de reescaneo.
- `smyl-secure-files.js` integra la verificación en web y móvil antes de guardar
  expedientes, radiografías, casos, propuestas o documentos profesionales.
- Las máscaras privadas de segmentación dejaron de usar enlaces de un año:
  duran cinco minutos, guardan una ruta privada y `sign-segmentation-masks`
  renueva el acceso al reabrir el caso, con sesión y tenant verificados.
- Producción: migración aplicada; `secure-clinical-file`,
  `sign-segmentation-masks` y `segment-teeth` desplegadas con JWT obligatorio.
  Smoke test sin sesión: `401`. Validación local: 294/294 pruebas aprobadas.

**Siguiente etapa de seguridad:** retención y borrado verificable, reescaneo de
objetos `legacy`, limpieza automática de cuarentenas abandonadas y respuesta a
incidentes con alertas y trazabilidad de exportaciones.

## 2026-10-14 — Codex: seguridad, etapa 2 de privacidad en navegador

**Los expedientes clínicos dejaron de persistirse en el navegador.**

- `smyl-browser-privacy.js` elimina residuos de versiones anteriores para
  pacientes, casos, cotizaciones, vistas compartidas, avances con fotografías
  y el IndexedDB del editor. La limpieza es selectiva: no borra la sesión de
  Supabase ni preferencias inocuas de interfaz.
- Panel, simulación completa, simulación rápida y editor ya no usan
  `localStorage`, `sessionStorage` o IndexedDB como respaldo clínico. Un caso o
  paciente sólo se anuncia como guardado después de confirmación de Supabase;
  si falla la red, permanece únicamente en la pestaña y se ofrece reintentar.
- El dashboard y el historial consultan la nube y muestran un error explícito
  en vez de sustituirlo por una copia local que pudiera estar desactualizada.
- La antigua vista pública construida con `camila_caso_preview` quedó retirada;
  compartir debe hacerse desde Mi SMYL mediante el flujo privado y revocable.
- Se escaparon nombres, correos, notas, resultados de IA y campos del historial
  antes de insertarlos en HTML; las imágenes sólo aceptan fuentes controladas.
- Web y móvil están sincronizadas con `smyl-v235-clinical-browser-privacy`.
  Validación: 288/288 pruebas aprobadas, incluidas cinco nuevas de privacidad.

**Siguiente etapa de seguridad:** endurecer subida/descarga de archivos
clínicos: buckets privados, rutas por clínica, MIME/tamaño real, enlaces
firmados cortos, antivirus/cuarentena y eliminación verificable.

## 2026-10-14 — Codex: seguridad, etapa 1 de contención crítica

**Las funciones privadas ya no aceptan una publishable key como identidad.**

- `_shared/auth.ts` rechaza todo token que no resuelva a una sesión real y
  falla cerrado si no puede determinar la clínica del usuario.
- `claude`, `segment-teeth`, equipo, Meta y los puentes privados de LANA se
  redesplegaron con el helper corregido. `claude` y `segment-teeth` quedaron
  además con `verify_jwt=true`; una prueba en vivo con la llave pública devuelve
  `401` antes de procesar entradas o consumir IA.
- La aplicación eliminó el fallback que enviaba una clave de Anthropic desde el
  navegador. La migración `20261014140000_smyl_provider_secret_cleanup.sql`
  eliminó claves de proveedor de `camila_tenants.config` y evita reinsertarlas.
- La simulación pública sin cuenta queda pausada intencionalmente. Perfil,
  solicitudes de cita y reseñas siguen públicos. El siguiente diseño debe usar
  una capacidad limitada y de corta duración, nunca `tenant_id` como autoridad.
- `supabase/config.toml` registra qué funciones exigen JWT y cuáles son
  excepciones públicas verificadas. Stripe conserva validación de firma propia.
- Web y PWA móvil están sincronizadas con `smyl-v234-security-containment`.
  Validación: 283/283 pruebas aprobadas y smoke tests remotos `401` para
  `claude`, `segment-teeth`, `lana-inbox` e `invite-staff` con llave pública.

**Pendiente externo inmediato:** revocar y regenerar desde los proveedores la
clave de Anthropic que apareció en cuatro commits históricos, revisar consumo y
rotar cualquier otra clave que hubiera coexistido con ella.

## 2026-10-14 — Codex: reseñas verificadas por cita

**El directorio ya recoge y publica opiniones originadas en atenciones reales.**

- La clínica genera desde el perfil un enlace único para una cita terminada.
  El token dura 14 días, funciona una vez y en la base sólo se conserva su
  hash SHA-256; una cita no puede producir más de una reseña.
- `resena.html` permite calificar, comentar y elegir primer nombre, iniciales
  o anonimato. Paciente, cita y expediente nunca se exponen en la respuesta
  pública.
- Toda reseña entra como `review`. Sólo administración puede publicarla,
  rechazarla con motivo u ocultarla; el texto del paciente no se edita.
- La ficha pública muestra promedio global, total y las seis opiniones más
  recientes aprobadas. Las consultas públicas pasan por la Edge Function
  `public-patient-reviews`; las escrituras anónimas a tablas están revocadas.
- Web y PWA móvil quedan sincronizadas con `smyl-v233-verified-reviews`.
- Validación final: 278/278 pruebas aprobadas, migración aplicada, función
  desplegada y QA visual del panel, formulario y ficha pública.

**Archivos clave:** `resena.html`, `dentista.html`,
`smyl-professional-directory.js/css`,
`supabase/migrations/20261014130000_smyl_verified_patient_reviews.sql`,
`supabase/functions/public-patient-reviews/index.ts`.

## 2026-10-14 — Codex: casos profesionales autorizados

**El perfil público ya admite una galería antes/después con control clínico.**

- Cada caso se vincula a una cita terminada y al profesional que la atendió.
  El paciente y la cita permanecen exclusivamente en el panel privado.
- Antes de enviar a revisión se exigen fotografía inicial, fotografía final,
  autorización firmada en PDF y confirmaciones de consentimiento y
  anonimización. La administración puede aprobar, rechazar o pausar.
- El bucket `smyl-professional-cases` es privado. La función pública entrega
  sólo metadatos aprobados y URLs firmadas que vencen en diez minutos; no
  expone paciente, cita, autorización, rutas ni notas de revisión. Los archivos
  quedan bloqueados contra reemplazo o borrado durante revisión y publicación.
- La ficha del dentista incluye `Casos autorizados` y una advertencia clara:
  los resultados varían y requieren valoración profesional.
- Web y PWA móvil quedan sincronizadas con `smyl-v232-professional-cases`.
- Validación final: 273/273 pruebas aprobadas, migraciones aplicadas, función
  pública desplegada y QA visual en escritorio y móvil con material sintético.

**Archivos clave:** `smyl-professional-directory.js/css`, `dentista.html`,
`supabase/migrations/20261014110000_smyl_professional_cases.sql`,
`supabase/functions/public-professional-cases/index.ts`.

## 2026-10-14 — Codex: verificación profesional interna

**El directorio distingue información declarada de documentación revisada.**

- El profesional solicita revisión únicamente después de registrar cédula y
  cargar su CV privado. La administración de la clínica decide verificar o
  solicitar una corrección; cada cambio queda bajo la auditoría existente.
- La ficha pública muestra la insignia sólo cuando el estado es `verified`.
  El texto aclara que se trata de revisión documental interna y no de una
  consulta automática a un registro gubernamental.
- Cambiar la cédula o reemplazar el CV invalida la verificación previa. Los CV
  nuevos usan una ruta versionada y el anterior se elimina después de guardar
  correctamente la nueva referencia.
- La vista pública sólo expone el booleano y la fecha de verificación; notas,
  revisor, CV y datos internos permanecen privados.
- Web y PWA móvil quedan sincronizadas con
  `smyl-v231-professional-verification`.
- Validación final: 267/267 pruebas aprobadas y QA visual del panel y del
  perfil público en escritorio y móvil.

**Archivos clave:** `smyl-professional-directory.js/css`, `dentista.html`,
`supabase/migrations/20261014100000_smyl_professional_verification.sql`.

## 2026-10-14 — Codex: directorio profesional, CV y solicitud pública de cita

**Nueva capacidad vertical:** cada profesional de la clínica puede tener una
ficha dental pública tipo directorio, administrada desde SMYL y compartible por
enlace o código QR.

- El panel `Directorio profesional` permite editar nombre, especialidad,
  cédula, titular, biografía, experiencia, idiomas, tratamientos, formación,
  asociaciones, foto y disponibilidad para nuevos pacientes.
- El PDF del CV se guarda en el bucket privado `smyl-professional-cv` (PDF,
  máximo 10 MB). Nunca aparece en la vista pública ni en su consulta anónima.
- Las fichas pasan por `Borrador → En revisión → Publicado`; publicar o pausar
  requiere administración de equipo. El dentista vinculado puede preparar su
  propia ficha sin acceder a las de otra clínica.
- `dentista.html?perfil=<slug>` presenta únicamente información autorizada,
  sedes y servicios. El paciente puede compartir la ficha y enviar una
  solicitud de cita; la solicitud entra a Agenda como `pending` y nunca crea
  ni confirma una cita automáticamente.
- La nueva función `public-appointment-request` valida perfil, sede y servicio,
  aplica límite por IP y honeypot, crea/reutiliza el contacto y registra la
  solicitud. No copia expedientes ni se integra con LANA.
- Web y PWA móvil quedan sincronizadas con `smyl-v230-professional-directory`.
  QA visual aprobado en escritorio y móvil, sin errores de consola.
- Validación final: 266/266 pruebas aprobadas. Migración y función pública
  desplegadas; navegación publicada comprobada en GitHub Pages.

**Archivos clave:** `smyl-professional-directory.js/css`, `dentista.html`,
`supabase/migrations/20261014090000_smyl_professional_directory.sql`,
`supabase/functions/public-appointment-request/index.ts` y sus copias PWA.

## 2026-10-14 — Codex: tareas clínicas simples por paciente

**Agendar, cotizar y cobrar dejan de depender de que el usuario conozca la
estructura del panel.**

- Inicio y la barra superior presentan las tres tareas frecuentes en lenguaje
  directo. El usuario elige el proceso, busca al paciente y continúa en el
  módulo canónico con el contexto precargado.
- El expediente ofrece accesos directos `Agendar`, `Cotizar` y `Cobrar` para el
  paciente abierto. La cotización conserva como requisito el plan clínico
  revisado y Caja conserva permisos, validación de saldos y confirmación.
- El selector consulta únicamente pacientes del tenant autenticado. No copia
  expedientes, diagnósticos ni notas dentro del lanzador y no ejecuta ninguna
  acción automáticamente.
- No hay cambios de backend. Web y bundle móvil están sincronizados; PWA usa
  `smyl-v229-doctor-task-flows`.

## 2026-10-14 — Codex: estado vacío operativo de Agenda

**La semana sin citas dejó de mostrarse como siete columnas blancas sin
información y ahora guía a recepción con disponibilidad real.**

- Cuando no hay citas ni bloqueos, Semana presenta una síntesis compacta, días
  con cobertura, horarios configurados y una única acción principal para
  preparar la primera cita.
- Los días vacíos dentro de una semana ocupada distinguen `Disponible` de `Sin
  horario`; seleccionar un horario sólo abre el formulario y conserva la
  validación atómica al confirmar.
- Se amplió `POLITICA_IMAGEN_SMYL.md`: los módulos operativos no usan fotografía
  clínica, avatares fotográficos ni stock decorativo. Utilizan iniciales,
  iconografía lineal y datos reales.
- No hay cambios de backend. Web y bundle móvil están sincronizados; PWA usa
  `smyl-v228-schedule-empty-state`.

## 2026-10-14 — Codex: Agenda profesional multivista

**La agenda adopta los patrones útiles del calendario de referencia sin añadir
React ni sustituir el contrato clínico existente.**

- Recepción puede alternar entre Mes, Semana, Día y Lista. Mes permite saltar
  al día; Lista agrupa las próximas dos semanas; Día organiza horarios por
  profesional.
- Los horarios de Día son seleccionables y preparan el formulario con fecha y
  profesional. Ningún clic reserva directamente: la confirmación conserva el
  RPC atómico, permisos, disponibilidad, duración y control de traslapes.
- Las citas muestran iniciales, servicio, espacio, responsable y estado con un
  acento visual consistente por profesional, sin imágenes externas.
- No hay cambios de base de datos ni funciones remotas. Web y bundle móvil
  están sincronizados; PWA usa `smyl-v227-schedule-multiview`.

## 2026-10-14 — Codex: Etapa 8, alertas operativas compartidas

**El Centro de alertas ya muestra los bloqueos y avisos operativos del Inbox y
lleva al equipo directamente al diagnóstico correspondiente.**

- Los incidentes críticos y las advertencias se agrupan por severidad para que
  una falla no produzca varias tareas repetidas.
- La integración publica sólo código, severidad, mensaje operativo, conteo y
  estado agregado del piloto. No transporta conversaciones, evidencia,
  pacientes, expedientes ni credenciales.
- La acción de cada alerta abre Mensajes y su panel de salud operativa; no
  modifica estados ni ejecuta reintentos por sí sola.
- No hay cambios de base de datos, migraciones ni funciones remotas en esta
  etapa. Web y bundle móvil están sincronizados; PWA usa
  `smyl-v226-inbox-alerts`.
- Pendiente deliberado: ejecutar el piloto real de clínica y documentar sus
  cinco escenarios humanos antes de autorizar la salida.

## 2026-10-14 — Codex: Etapa 7, informe operativo del piloto

**El dueño ya puede revisar e imprimir un informe del piloto preparado para
dirección o soporte sin exportar conversaciones, credenciales ni información
clínica.**

- El informe reúne el corte de operación, la decisión vigente, seis indicadores
  agregados, las tres puertas de salida, las cinco evidencias y las incidencias
  activas con su siguiente control.
- La evidencia se presenta con responsable y fecha cuando LANA los proporciona;
  las pruebas pendientes se distinguen expresamente y nunca se completan solas.
- `Imprimir o guardar PDF` genera una vista local y revisable. No carga el
  contenido en otro servicio ni crea una copia automática en la base de datos.
- El documento declara sus límites: no certifica resultados clínicos,
  cumplimiento normativo, entrega final de mensajes ni niveles de servicio.
- Web y bundle móvil están sincronizados; PWA usa
  `smyl-v225-inbox-report`. El piloto real sigue pendiente de ejecución humana.

## 2026-10-14 — Codex: Etapa 6, decisión operativa del piloto

**El estado del Inbox ya traduce métricas y evidencia en una decisión de salida
comprensible para el dueño de la clínica, sin inventar SLA ni completar pruebas
humanas automáticamente.**

- El panel separa tres puertas verificables: preparación técnica, cinco pruebas
  reales en clínica y ausencia de incidentes críticos.
- Una lectura ejecutiva muestra avance, fecha de actualización y estados `no
  apto`, `en curso`, `pausado`, `listo para aprobación` o `aprobado`.
- Los indicadores resumen conversaciones por atender, envíos recientes,
  evidencias, canales activos, reintentos y cola de fallos usando únicamente el
  estado canónico entregado por LANA.
- Cada alerta incorpora el siguiente control recomendado. No reenvía mensajes,
  resuelve incidentes ni afirma tiempos de respuesta que el sistema no mida.
- Web y bundle móvil están sincronizados; PWA usa
  `smyl-v224-inbox-operations`. La ejecución real del piloto continúa pendiente
  hasta que una clínica documente las cinco pruebas en dispositivos reales.

## 2026-10-14 — Codex: Etapa 5, piloto profesional del Inbox

**Mensajes ya incorpora un ciclo de validación controlado, persistente y
exclusivo del dueño para llevar la integración SMYL–LANA a una clínica real sin
confundir pruebas automáticas con evidencia humana.**

- El dueño puede iniciar, pausar, reanudar, cerrar y reiniciar un piloto sólo
  cuando la puerta técnica está lista. El resto del equipo ve el avance en modo
  de sólo lectura.
- El cierre exige cinco comprobaciones con evidencia breve: tráfico real,
  operación simultánea de dos usuarios, mensajes fuera de orden, pérdida y
  recuperación de red, y uso desde un dispositivo móvil real.
- La interfaz declara que no envía mensajes de prueba ni fabrica evidencia. El
  estado se guarda en la configuración privada de LANA, conserva las últimas
  claves idempotentes y evita sobrescribir cambios concurrentes del tenant.
- Se corrigió además el acceso contextual a Archivos compartidos, que apuntaba
  a un nombre de función inexistente y generaba un error al abrir un hilo.
- Web y bundle móvil están sincronizados; PWA usa
  `smyl-v223-inbox-pilot`. Suite SMYL 246/246, pruebas enfocadas del puente
  LANA 26/26, build de LANA correcto y QA visual en escritorio, tableta y móvil
  sin overflow ni errores de consola.
- Pendiente deliberado: ejecutar y documentar las cinco pruebas con una clínica,
  dos usuarios y dispositivos reales. El software no las marca por sí solo.

## 2026-10-14 — Codex: Etapa 4, compositor compartido del Inbox

**Mensajes ya ofrece un compositor profesional alineado con las capacidades
canónicas de LANA, manteniendo el envío bajo revisión humana.**

- Se añadió selector accesible de emoji y notas de voz para WhatsApp. La
  grabación sólo prepara un adjunto compatible; nunca se envía al detenerla.
- Las notas de voz respetan ventana de 24 horas, permisos, límites de archivo y
  la misma ruta autenticada de adjuntos que LANA ya procesa.
- Cada conversación conserva su borrador en texto cifrado AES-GCM durante la
  sesión. No se guarda texto clínico legible ni se usa almacenamiento global.
- Cambiar de hilo protege el borrador anterior; enviarlo o dejarlo vacío elimina
  su copia cifrada. Los atajos y Copilot también pasan por el mismo borrador.
- Web y bundle móvil están sincronizados; PWA usa
  `smyl-v222-inbox-composer`. Suite completa 242/242 y QA visual en escritorio
  y móvil sin overflow.

## 2026-10-14 — Codex: Etapa 3, productividad diaria del Inbox

**Mensajes incorpora herramientas de productividad sobre el chat canónico de
LANA, sin copiar conversaciones ni credenciales dentro de SMYL.**

- La búsqueda de la bandeja y del historial completo se ejecuta en servidor;
  también se añadió una biblioteca paginada de archivos y enlaces compartidos.
- Las respuestas rápidas existentes en LANA se insertan como borrador. El
  profesional siempre revisa y decide el envío.
- La selección múltiple permite únicamente asignar responsable o mover etapa;
  no admite envíos masivos ni operaciones sobre el expediente clínico.
- Los avisos sonoros requieren activación expresa y sólo viven durante la
  sesión; no almacenan contenido ni datos del paciente.
- Web y bundle móvil están sincronizados; PWA usa
  `smyl-v221-inbox-productivity`. Suite SMYL 238/238, puente LANA 7/7, build de
  LANA correcto y QA visual en escritorio, tableta y móvil sin overflow ni
  errores de consola.

## 2026-10-14 — Codex: Etapa 2, organización profesional del Inbox

**Mensajes ya permite organizar el trabajo del equipo desde SMYL usando las
conversaciones, responsables y etapas canónicas de LANA, sin duplicar el chat.**

- Se añadieron filtros `Fijadas` y `En atención`, indicador de conversación
  fijada, etapa visible en cada fila y controles para fijar o quitar de fijadas.
- El panel de atención permite asignar responsable y cambiar la etapa de la
  conversación. Las mutaciones son idempotentes, auditadas y validadas por
  tenant en LANA.
- El puente privado incorpora consulta de etapas y acciones `pin`, `unpin` y
  `stage`; las credenciales y los datos canónicos siguen fuera del navegador.
- La migración `20261014200000_smyl_inbox_organization.sql` fue aplicada y
  registrada únicamente en LANA. `camila-api` y `lana-inbox` quedaron
  desplegadas.
- Web y bundle móvil están sincronizados; PWA usa
  `smyl-v220-inbox-organization`. Suite completa 233/233, puente 6/6 y QA
  visual en escritorio, tableta y móvil sin errores de consola.

## 2026-10-14 — Codex: desconexión segura de Meta y auditoría de paridad del chat

**Canales e IA ya permite al dueño desconectar Messenger o Instagram sin
mostrar ni copiar credenciales al navegador.**

- La acción pasa por `lana-channels` y el API canónico de LANA. LANA cancela
  primero la suscripción con Meta y después elimina la credencial local; el
  historial de conversaciones se conserva.
- La interfaz muestra una confirmación explícita con la cuenta afectada y no
  habilita la operación para miembros sin permiso de administración.
- WhatsApp permanece sin desconexión automática hasta definir la revocación de
  su configuración específica; no se presenta una acción falsa.
- La auditoría `docs/SMYL_LANA_CHAT_PARITY_AUDIT.md` confirma que el Inbox ya
  utiliza LANA como motor y enumera las brechas de experiencia pendientes. La
  dirección es ampliar el puente, no duplicar el chat ni la base de datos.
- Web y bundle móvil están sincronizados; PWA usa
  `smyl-v219-channel-disconnect`.

## 2026-10-14 — Codex: Etapa 9, sistema profesional de ventanas

**Las ventanas operativas de SMYL comparten una estructura visual y de
interacción única, sin modificar sus operaciones ni validaciones de servidor.**

- La capa `smyl-dialog-system` normaliza Inventario, Finanzas, Agenda,
  Servicios, Clínica, Ficha 360, Casos, Cotizaciones, Mensajes y LANA.
- Cada formulario obtiene encabezado con cierre visible, cuerpo desplazable,
  acciones fijas, tamaños coherentes y presentación centrada en escritorio.
- Los campos obligatorios se identifican, el primer campo inválido se lleva a
  la vista y los cambios sin guardar se protegen antes de cerrar.
- En móvil, las ventanas usan toda la pantalla con cabecera y acciones seguras;
  los visores clínicos especializados conservan su interfaz propia.
- No se modificaron migraciones, RLS, RPC ni Edge Functions. Web y bundle móvil
  están sincronizados; PWA usa `smyl-v218-dialog-system-stage9`. Suite completa
  232/232 y QA visual a 1366, 834 y 390 px sin overflow, errores de página ni
  botones sin etiqueta.

## 2026-10-14 — Codex: Etapa 8, preparación operativa de la clínica

**Mi clínica ya guía al administrador para completar sedes, espacios, horarios,
equipo y cobertura profesional antes de operar la agenda.**

- El nuevo indicador de preparación resume cuatro áreas verificables y lleva al
  apartado exacto que requiere atención, sin ejecutar cambios automáticamente.
- Cada sucursal muestra espacios activos, días y bloques de atención, además de
  un estado `Lista para agenda` o `Por completar` basado sólo en su configuración
  visible de espacios y horarios.
- Equipo y profesionales señalan faltantes de rol o sede. La guía de roles
  explica sus permisos actuales antes de que el propietario los asigne.
- El porcentaje es una guía de configuración y declara expresamente que no es
  certificación clínica, laboral, fiscal ni sanitaria.
- No se modificaron migraciones, RLS ni Edge Functions. Web y bundle móvil están
  sincronizados; PWA usa `smyl-v217-clinic-readiness-stage8`. Suite completa
  228/228 y QA visual a 1366, 834 y 390 px sin overflow, errores de página ni
  botones sin etiqueta.

## 2026-10-14 — Codex: Etapa 7, tablero ejecutivo profesional

**Reportes ya funciona como mesa de control para dirección, con prioridades
accionables y límites explícitos sobre lo que cada indicador significa.**

- `Resumen para dirección` reúne cartera, inasistencias, alertas de inventario
  y cajas abiertas usando únicamente datos agregados y permisos existentes.
  Cada prioridad abre el módulo responsable; el tablero no ejecuta acciones.
- Se incorporaron periodos rápidos de 7, 30 y 90 días, filtro por sucursal y
  selector de tendencia entre ingresos confirmados y citas cuando el rol tiene
  acceso al módulo correspondiente.
- Demanda por servicio y actividad del equipo se presentan como carga operativa,
  no como evaluación de desempeño, calidad clínica u ocupación de sillones.
- El recorrido de tratamientos conserva sus cinco hitos independientes y deja
  claro que no representa una cohorte ni una tasa de conversión.
- No se modificaron migraciones, RLS ni Edge Functions. Web y bundle móvil están
  sincronizados; PWA usa `smyl-v216-executive-dashboard-stage7`. Suite completa
  224/224 y QA visual a 1366, 834 y 390 px sin overflow, errores de página ni
  botones sin etiqueta.

## 2026-10-13 — Codex: Etapa 6, inventario y trazabilidad profesional

**Inventario ya prioriza faltantes, lotes de riesgo y recepciones abiertas como
trabajo operativo, no sólo como filas de existencias.**

- La bandeja `Control operativo` separa insumos bajo mínimo, lotes caducados,
  próximas caducidades y compras por recibir. Sus acciones abren el filtro o
  módulo correspondiente sin modificar existencias automáticamente.
- Existencias incorpora filtros por atención, mínimo y caducidad; cada insumo
  muestra ubicación, estado, trazabilidad por paciente y cantidad sugerida para
  alcanzar el objetivo configurado.
- El consumo clínico excluye lotes caducados y presenta un control previo de
  lote, caducidad, serie y paciente. Las validaciones del servidor y el RPC
  atómico existente continúan siendo la autoridad final.
- Las órdenes muestran porcentaje y unidades recibidas. El libro de movimientos
  sigue inmutable y las correcciones continúan registrándose como compensaciones.
- No se modificaron migraciones, RLS ni Edge Functions. Web y bundle móvil están
  sincronizados; PWA usa `smyl-v215-inventory-operations-stage6`. Suite completa
  220/220 y QA visual a 1366, 834 y 390 px sin overflow, errores de página ni
  botones sin etiqueta.

## 2026-10-13 — Codex: Etapa 5, caja y seguimiento financiero profesional

**Finanzas ya permite priorizar la cobranza y confirmar cómo se aplicará cada
pago antes de registrarlo.**

- El foco financiero reúne cartera vencida, saldos a favor y cortes pendientes;
  cada hallazgo conduce a la cuenta o acción correspondiente y deja explícito
  que el sistema no ejecuta cargos automáticos.
- Las cuentas por paciente muestran importe pagado, total del tratamiento,
  porcentaje cubierto, saldo y vencimiento. Los filtros separan casos por
  atender, con saldo, liquidados y todos.
- Antes de confirmar un pago se presenta un control de aplicación con importe,
  monto asignado a cargos, remanente como saldo a favor y referencia. Los pagos
  en efectivo requieren una caja abierta en la sucursal seleccionada.
- Todos los importes y estados se derivan de cargos, pagos, aplicaciones y
  reembolsos existentes; no se modificaron RPC, migraciones ni reglas RLS.
- Web y bundle móvil están sincronizados; PWA usa
  `smyl-v214-financial-followup-stage5`. Suite completa 215/215 y QA visual a
  1366, 834 y 390 px sin overflow, errores de página ni botones sin etiqueta.

## 2026-10-13 — Codex: Etapa 4, agenda y operación clínica profesional

**Agenda ya presenta cada reserva como coordinación de tiempo, profesional y
consultorio, no sólo como una cita en una lista.**

- Las tarjetas muestran inicio y término reales, servicio, profesional,
  consultorio o sillón y estado de atención; la vista también puede filtrarse
  por espacio clínico.
- El formulario calcula duración y hora de término desde el catálogo, muestra
  especialidad y espacio, y advierte si el profesional no ofrece el servicio,
  no pertenece a la sucursal o el consultorio no corresponde a la sede.
- Estas comprobaciones sólo guían al equipo. Las RPC existentes conservan la
  decisión final y vuelven a validar permisos, disponibilidad y traslapes.
- El detalle de la cita separa nota operativa de información clínica y muestra
  el estado verificable de los recordatorios sin afirmar que fueron entregados.
- Web y bundle móvil están sincronizados; PWA usa
  `smyl-v213-clinical-schedule-stage4`. Suite completa 211/211 y QA visual a
  1366, 834 y 390 px sin overflow, errores de página ni botones sin etiqueta.

## 2026-10-13 — Codex: Etapa 3, plan y cotización profesional

**El plan revisado y la cotización ya conservan una relación comprensible entre
conceptos, piezas FDI, superficies e importes.**

- El editor muestra un control de propuesta con número de conceptos, conceptos
  vinculados al mapa, precios pendientes y revisiones fiscales pendientes.
- `Ir al pendiente` lleva al primer concepto que requiere atención, sin guardar,
  aprobar ni enviar automáticamente.
- La propuesta para el paciente conserva el odontograma y ahora agrega una
  leyenda que explica qué tratamiento corresponde a cada pieza y superficie.
- El documento compartido sigue excluyendo antecedentes, alertas, medicamentos
  y notas clínicas internas. Las claves fiscales continúan sujetas a revisión.
- Web, impresión y bundle móvil están sincronizados; PWA usa
  `smyl-v212-treatment-quote-stage3`. Suite completa 207/207 y QA visual a 1366,
  834 y 390 px sin overflow, errores de página ni botones sin etiqueta.

## 2026-10-13 — Codex: Etapa 2, expediente y odontograma profesional

**La ficha del paciente ya presenta antecedentes, odontograma, plan y
seguimiento como un solo estado clínico operativo.**

- El resumen deriva sus indicadores exclusivamente de los módulos existentes:
  antecedentes, alertas visibles, piezas anotadas, estados en seguimiento o
  realizados, tratamientos y evoluciones recientes. No consulta otra fuente ni
  duplica información clínica.
- La siguiente acción conserva un orden neutral: completar antecedentes,
  revisar odontograma, construir plan o registrar evolución. Son accesos al
  trabajo profesional; nunca constituyen diagnóstico o recomendación automática.
- Cada tarjeta abre la sección correspondiente sin perder el paciente actual.
  Las notas firmadas, permisos clínicos y controles de auditoría no cambian.
- Web y bundle móvil están sincronizados; PWA usa
  `smyl-v211-patient-record-stage2`. Suite completa 203/203 y QA visual a 1366,
  834 y 390 px sin overflow, errores de página ni botones sin etiqueta.

## 2026-10-13 — Codex: Etapa 1, Servicios y tarifas profesional

**El catálogo dental ya comunica qué está listo para operar y qué requiere
atención antes de llegar a Agenda o a una cotización.**

- El resumen distingue servicios listos, activos, sin precio y con revisión
  fiscal pendiente; una barra muestra el avance real de configuración.
- El filtro `Por completar` reúne servicios activos sin tarifa o sin revisión
  fiscal. Cada fila etiqueta claramente `Listo para operar`, `Por completar` o
  `Disponible`, y cambia la acción principal a `Completar` cuando corresponde.
- La búsqueda también contempla el nombre presentado al paciente. Los usuarios
  sin `settings.manage` reciben una vista explícita de sólo lectura.
- No cambia el catálogo clínico, RLS ni las migraciones. Web y bundle móvil
  están sincronizados; PWA usa `smyl-v210-service-catalog-stage1`.
- Suite completa 199/199. QA visual a 1366, 834 y 390 px sin overflow, errores
  de página ni botones sin etiqueta.

## 2026-10-13 — Codex: Panel profesional de gestión v3 publicado

**La experiencia completa se consolidó como un sistema de gestión dental, no
como una colección de herramientas:** la navegación principal ahora sigue la
jornada de la clínica con Inicio, Agenda, Pacientes, Tratamientos, Finanzas y
Mensajes; Servicios y tarifas, Inventario y Reportes quedan como áreas de
negocio claramente diferenciadas.

- Inicio prioriza la operación del día y mantiene accesos directos a las áreas
  canónicas. La acción global es `Nueva cita` y el móvil conserva cinco destinos
  útiles sin saturar la barra inferior.
- La ficha del paciente incorpora una barra de continuidad para agendar,
  trabajar el tratamiento, registrar evolución, cobrar o escribirle sin perder
  el contexto del paciente.
- Tratamientos expone el recorrido completo: valoración, plan, cotización,
  aceptación, atención y cierre. No se inventan decisiones clínicas ni estados.
- El sistema visual usa jerarquía más compacta, superficies sobrias, navegación
  azul marino y estados teal consistentes en escritorio, tablet y móvil.
- Es una consolidación frontend: no modifica tablas, permisos ni migraciones.
  Web y bundle móvil están sincronizados; PWA usa
  `smyl-v209-professional-management`. Suite completa 195/195 y QA visual a
  1366, 834 y 390 px sin overflow, errores de página ni botones sin etiqueta.

## 2026-10-13 — Codex: Etapa 8 de cierre profesional terminada

**Reportes ya muestra el recorrido operativo de los tratamientos sin exponer
expedientes:** aceptación de cotización, creación de cargos, primera cita,
terminación de la cita y evolución clínica firmada se resumen por periodo.

- Son hitos agregados de toda la clínica, no una cohorte ni una tasa de
  conversión. Cada cifra se cuenta por la fecha de su propio evento y puede
  pertenecer a tratamientos distintos.
- Cada paso respeta su permiso (`proposal.read`, `finance.read`,
  `schedule.read` o `clinical.read`); el usuario sin acceso ve el paso
  restringido y nunca recibe identificadores de pacientes.
- Agenda ahora admite de forma explícita `accepted_proposal` como origen. Esto
  cierra el defecto que impedía guardar la primera cita preparada desde una
  cotización aceptada.
- La migración aditiva `20261013080000_smyl_treatment_operations_v1.sql` quedó
  aplicada y verificada en Supabase. Web/PWA usan
  `smyl-v208-professional-pilot`; suite completa 191/191 y QA visual a 1366,
  834 y 390 px sin overflow, errores de página ni botones sin etiqueta.

## 2026-10-13 — Codex: Etapa 7 de ejecución clínica terminada

**Agenda y Ficha clínica ya continúan la atención sin perder el contexto de la
cita:** cuando el paciente llegó, está en atención o la cita terminó, el equipo
puede abrir una evolución SOAP vinculada al paciente, cita y profesional.

- La acción `Registrar evolución` sólo aparece en estados clínicamente
  pertinentes; `Abrir ficha` continúa disponible por separado para consulta.
- Si la cita ya tiene un borrador, se reabre en lugar de duplicarlo. Una nota
  firmada permanece inmutable y remite a una adenda para cualquier corrección.
- `clinical.read`, `clinical.write` y `clinical.approve` siguen separados. La
  interfaz no completa hallazgos ni cambia el estado de la cita por sí sola.
- Web/PWA usan `smyl-v207-treatment-execution`. Suite completa 187/187 y QA
  visual a 1366, 834 y 390 px sin overflow, errores de página ni acciones
  inaccesibles; el diálogo móvil ahora tiene desplazamiento interno seguro.

## 2026-10-13 — Codex: Etapa 6 de activación de tratamiento terminada

**Una cotización aceptada ya puede convertirse de forma controlada en trabajo
operativo:** desde la misma versión el equipo abre Caja para crear cargos o
Agenda para preparar la primera cita del paciente.

- Aprobar internamente ya no basta para crear cargos. El servidor exige un
  evento `accepted` de la misma revisión vigente; conserva la idempotencia de
  lotes anteriores y nunca duplica movimientos.
- Presentaciones muestra una puerta de activación con estados claros. Caja y
  Agenda mantienen permisos separados y vuelven a validar importes,
  disponibilidad, profesional, sucursal y espacio.
- Agenda recibe al paciente preseleccionado, pero deja al equipo elegir servicio,
  profesional y horario. La aceptación comercial se declara distinta del
  consentimiento informado y no agenda ni cobra automáticamente.
- La migración aditiva `20261013070000_smyl_treatment_activation_v1.sql` quedó
  aplicada y verificada en Supabase. Web/PWA usan
  `smyl-v206-treatment-activation`; suite completa 183/183 y QA visual a 1366,
  834 y 390 px sin overflow, errores de página ni botones sin etiqueta.

## 2026-10-13 — Codex: Etapa 5 de cola comercial publicada

**Presentaciones ahora funciona como un tablero accionable y no sólo como
historial:** el equipo identifica qué cotizaciones debe completar, presentar,
revisar por vigencia o actualizar por petición del paciente.

- Cuatro indicadores resumen versiones por presentar, respuestas pendientes,
  cotizaciones que requieren acción y aceptación. La tasa usa exclusivamente
  decisiones registradas y muestra su denominador; un silencio nunca se cuenta
  como rechazo.
- La cola distingue borrador, lista para presentar, esperando decisión,
  vigencia vencida, cambios solicitados, aceptada y no aceptada. Las tareas se
  ordenan por prioridad verificable y actualización, sin inventar un SLA.
- Se añadieron búsqueda local y filtros Por atender, Todas, Aceptadas y
  Borradores. Los indicadores declaran que corresponden a las últimas 100
  propuestas visibles y reutilizan la lectura RLS existente, sin nueva tabla ni
  migración.
- Web/PWA usan `smyl-v205-commercial-proposals`. Suite completa 178/178 y QA
  visual a 1366, 834 y 390 px sin overflow, errores de página ni botones sin
  etiqueta.

## 2026-10-13 — Codex: Etapa 4 de seguimiento de cotizaciones publicada

**SMYL ya distingue aprobación profesional, presentación y decisión comunicada
por el paciente:** cada versión aprobada conserva una línea de tiempo auditable
sin presentar el registro interno como firma o consentimiento informado.

- El equipo autorizado registra `presented`, `accepted`, `declined` o
  `changes_requested`, junto con medio, fecha y una nota; rechazo y solicitud
  de cambios exigen contexto escrito.
- El servidor obliga a presentar primero la versión, acepta sólo la revisión
  aprobada vigente, bloquea decisiones posteriores a un estado terminal y usa
  un UUID del cliente para reintentos idempotentes.
- `proposal.followup` queda separado de lectura, edición, aprobación y Caja.
  Titular, administración y odontólogo lo reciben por defecto; RLS mantiene la
  lectura dentro de la clínica y las inserciones directas permanecen revocadas.
- La migración aditiva `20261013060000_smyl_proposal_followup_v1.sql` quedó
  aplicada en Supabase. Web/PWA usan `smyl-v204-proposal-followup`; suite
  completa 174/174 y QA visual a 1366, 834 y 390 px sin overflow, errores de
  página ni botones sin etiqueta.

## 2026-10-13 — Codex: Etapa 3 de cotizaciones delegadas publicada

**El equipo clínico ya puede consultar, preparar y aprobar cotizaciones sin
compartir la cuenta titular ni recibir acceso implícito a Caja:** la autorización
se aplica tanto en la interfaz como en Supabase.

- Se agregaron los permisos independientes `proposal.read`, `proposal.write` y
  `proposal.approve`. Titular, administración y dentista reciben el flujo
  clínico completo; finanzas recibe lectura para mantener continuidad operativa.
- Las políticas RLS de propuestas, versiones y fotografías privadas, además de
  los RPC de guardado, aprobación y exportación, validan tenant y permiso en el
  servidor. La migración aditiva
  `20261013050000_smyl_proposal_permissions_v1.sql` quedó aplicada y sincronizada
  en Supabase.
- Crear cargos continúa protegido por `finance.manage`: aprobar un tratamiento
  no concede permisos de cobro. Los perfiles de sólo lectura abren propuestas
  guardadas sin controles de edición.
- Web/PWA usan `smyl-v203-delegated-proposals`. Suite completa 170/170 y QA
  visual a 1366, 834 y 390 px sin overflow, errores de página ni botones sin
  etiqueta; el odontograma conserva sus controles clínicos compactos.

## 2026-10-13 — Codex: Etapa 2 del recorrido de atención publicada

**Agenda, expediente, odontograma, plan y cotización ahora se presentan como un
solo recorrido del paciente:** la interfaz conserva el contexto clínico y
separa la cotización de la presentación visual opcional.

- La ficha usa una cabecera única con identidad, contacto, alertas, próxima
  cita y accesos rápidos a resumen, antecedentes, notas clínicas y citas.
- El recorrido profesional muestra Evidencias → Odontograma → Plan →
  Cotización. La cotización se habilita con el plan revisado; la presentación
  mySmyl sigue siendo opcional y requiere una simulación disponible.
- Desde Agenda, cualquier rol con `clinical.read` puede abrir la ficha y la
  atención del paciente. La cotización comercial conserva por ahora la política
  existente de cuenta titular; no se debilitó RLS desde el frontend.
- Web/PWA usan `smyl-v202-patient-care-flow`. Suite completa 165/165 y QA a
  1366, 834 y 390 px sin overflow, errores, botones sin etiqueta ni objetivos
  táctiles menores de 38 px.

## 2026-10-13 — Codex: Etapa 1 del panel profesional dental publicada

**Servicios y tarifas ya es una función principal del negocio y los permisos
clínicos respetan el rol configurado:** se consolidó la base para continuar la
evolución del panel por etapas sin duplicar fuentes de verdad.

- El catálogo pasó a `Negocio > Servicios y tarifas` y se eliminó de Agenda la
  edición paralela de precio, duración y activación. Agenda conserva un acceso
  directo al catálogo canónico.
- El catálogo sigue cubriendo especialidades, precios, duración, unidad clínica
  y sugerencias SAT editables, con lectura para operación y gestión reservada a
  `settings.manage`.
- La ficha clínica dejó de depender de `owner`: `clinical.read`,
  `clinical.write` y `clinical.approve` gobiernan consulta, edición, revisión y
  propuesta. La migración aditiva
  `20261013040000_smyl_professional_permissions_v1.sql` quedó aplicada y
  sincronizada en Supabase.
- Web/PWA usan `smyl-v201-professional-foundation`. Suite completa 161/161 y QA
  visual a 1366, 834 y 390 px sin overflow, errores de página ni botones sin
  etiqueta.

## 2026-10-13 — Codex: simulación rápida cerrada sin pendientes

**La suite queda completamente verde (157/157):** se restauró el objetivo
independiente de carillas en el flujo guiado y en los ajustes profesionales,
sin obligar al dentista a combinarlo con alineación.

- El menú rápido ofrece Carillas, Alinear y Alinear + carillas; conserva la
  selección de arcada y tono VITA y mantiene el aviso de simulación orientativa.
- La lógica ya no transforma silenciosamente `veneers` en `combined`; el motor
  existente recibe la modalidad clínica elegida.
- Las pruebas históricas de LANA/simulación se alinearon con la arquitectura
  vigente: la frontal gobierna el diseño, la intraoral sólo aporta evidencia y
  el cambio de tono no dispara una generación pagada.
- Web/PWA sincronizadas con `smyl-v200-quick-veneers`. QA visual a 1366, 834 y
  390 px: tres objetivos visibles, sin overflow ni errores de página.

## 2026-10-13 — Codex: cierre de etapas fiscales previo al PAC

**Entregas 4–6 cerradas hasta sus dependencias externas:** SMYL ya separa
emisor/receptor, diagnostica readiness fiscal y prepara cancelación/sustitución
sin afirmar acciones que todavía no ocurrieron en SAT/PAC.

- Nueva migración aditiva `20261013030000_smyl_cfdi_lifecycle_v1.sql`, aplicada
  tras dry-run como única pendiente: perfiles de emisor, preparación PAC sin
  secretos, planes de cancelación y RPC transaccionales con RLS/auditoría.
- Los borradores v3 congelan emisor, receptor y conceptos. La prevalidación
  local v2 revisa ambos perfiles, claves fiscales y totales, pero conserva
  `requires_pac_catalog_validation=true`.
- Motivos de cancelación 01–04 preparados; 01 exige UUID sustituto. Sólo un
  CFDI con estado `issued` puede generar un plan y `planned` significa
  exclusivamente intención local, no solicitud enviada.
- Caja presenta una Puerta fiscal de cinco controles y enlaza la lista oficial
  de PAC del SAT. No captura certificados, claves o contraseñas.
- Web/PWA usan `smyl-v199-cfdi-lifecycle`. QA sintética a 1366, 834 y 390 px
  sin overflow ni errores. Validación focalizada 17/17; suite completa 155/157,
  conservando únicamente los dos fallos preexistentes de `lana-quick` y
  `quick-guided-flow`. La conexión PAC real continúa bloqueada hasta que el
  propietario elija proveedor y proporcione acceso sandbox de forma segura.

## 2026-10-13 — Codex: propuesta aprobada, cargos y prevalidación CFDI

**Entrega 3 terminada hasta el límite seguro previo al PAC:** una propuesta
aprobada se convierte explícitamente en cargos y el pago puede preparar un
borrador CFDI 4.0 con conceptos congelados.

- `smyl_post_proposal_charges` bloquea y valida la revisión aprobada, crea un
  cargo por concepto positivo y conserva snapshot de propuesta, servicio y
  claves fiscales. La unicidad por propuesta/revisión e idempotency key evita
  duplicados incluso ante reintentos.
- `smyl_prepare_cfdi_draft_v2` exige pago totalmente aplicado, sin reembolsos,
  y congela receptor y conceptos. `smyl_validate_cfdi_draft_sandbox` revisa
  reglas locales y marca aprobado/bloqueado sin cambiar el borrador a emitido.
- La migración aditiva `20261013020000_smyl_proposal_finance_v1.sql` fue
  aplicada en producción tras un dry-run que confirmó que era la única
  pendiente. No se conectó ni transmitió a SAT/PAC y no se tocaron Stripe,
  Gmail, LANA o Meta.
- Propuestas incorpora “Crear cargos en Caja”; Caja permite elegir propuesta,
  sede, vencimiento y confirmación explícita. Fiscal distingue prevalidación
  local de validación/timbrado futuro por PAC sandbox.
- Web/PWA sincronizadas con `smyl-v198-proposal-finance`. QA sintética aprobada
  a 1366, 834 y 390 px, sin overflow ni errores de consola. Suite completa:
  150/152; permanecen sólo los fallos preexistentes de `lana-quick` y
  `quick-guided-flow`.
- Archivos principales: `smyl-finance.js/.css`, `smyl-proposals.js`, copias en
  `mobile/www/`, la migración y `tests/proposal-finance-v1*`.
- Siguiente decisión obligatoria: elegir proveedor PAC y credenciales de
  sandbox, confirmar con contador las claves/impuestos y diseñar cancelación,
  sustitución y conciliación antes de habilitar timbrado real.

## 2026-10-13 — Codex: plan clínico y cotización dental v2

**Entrega 2 terminada:** catálogo, plan, odontograma y propuesta comparten un
contrato versionado sin convertir la automatización en diagnóstico.

- Cada tratamiento conserva ID, fase, servicio/revisión/snapshot, piezas FDI y
  superficies. Los documentos schema 1 siguen normalizándose para lectura.
- El profesional señala las piezas en el odontograma; “sin marca” significa
  únicamente “sin pieza asociada”, nunca “sano”.
- La propuesta toma nombre, precio y modalidad del snapshot revisado, calcula
  cantidades por pieza o superficie y muestra al paciente un mini mapa sin
  antecedentes, alergias ni notas internas.
- Nueva migración aditiva
  `20261013010000_smyl_treatment_proposal_v2.sql`, aplicada en producción tras
  dry-run. Los RPC v2 validan snapshots y coincidencia con el plan revisado;
  los RPC antiguos permanecen intactos para el historial.
- Web/PWA sincronizadas con `smyl-v197-treatment-quote-map`. No se tocaron
  LANA, Gmail, Meta, prompts de IA, Storage, Stripe ni configuración nativa.
- QA sintética aprobada a 1366, 834 y 390 px, sin overflow; en móvil cada línea
  de cotización se presenta como tarjeta legible. Validación focalizada 8/8;
  suite completa 145/147, con los dos fallos preexistentes de `lana-quick` y
  `quick-guided-flow`.
- Archivos principales: `smyl-clinical-model.js`, `smyl-clinic.js/.css`,
  `smyl-proposal-model.js`, `smyl-proposal-print.js`,
  `smyl-proposals.js/.css`, sus copias en `mobile/www/`, la migración y
  `tests/treatment-proposal-v2.test.mjs`.
- Siguiente entrega recomendada: propuesta aprobada → cargos idempotentes →
  CFDI en sandbox, sin afirmar timbrado real hasta integrar y probar un PAC.

## 2026-10-13 — Codex: etapa 7, cierre de navegación profesional

**Reorganización terminada en frontend:** el workspace incorpora un acceso
global por tarea y completa el recorrido operativo sin agregar otra fuente de
datos ni alterar los contratos clínicos.

- `Ir a…` y el atajo `Ctrl/Cmd + K` reúnen Trabajo diario, Clínica,
  Administración y Configuración; la búsqueda ocurre únicamente en memoria.
- El selector funciona con teclado, conserva el foco, añade un salto al
  contenido y actualiza el título de la vista para facilitar orientación y
  accesibilidad.
- La presentación responsive fue validada a 1366, 834 y 390 px; la búsqueda y
  navegación por flechas funcionan y no se detectaron errores de consola.
- Web y PWA móvil quedan sincronizadas con el caché
  `smyl-v194-professional-close`. No se cambió backend, RLS, LANA, Meta,
  mutaciones, seguridad ni lógica clínica.
- Validación focalizada: 17/17. Suite completa: 137/139; permanecen únicamente
  los dos fallos preexistentes de `lana-quick` y `quick-guided-flow` en el flujo
  independiente de simulación rápida.
- Con esta etapa quedan terminadas las siete etapas de reorganización. El
  siguiente paso recomendado es un piloto controlado con una clínica real y
  observación de uso, no otra ronda de expansión de interfaz.

## 2026-10-13 — Codex: etapa 6 de continuidad, recuperación del workspace

**Reorganizado en frontend:** el panel conserva el contexto visible al perder
conexión y ofrece recuperación explícita sin recargar toda la aplicación.

- Una franja accesible distingue desconexión y restablecimiento; advierte no
  repetir envíos ni cobros mientras el resultado sea incierto.
- `Reintentar` actualiza únicamente el módulo activo mediante su API pública:
  Inicio, Agenda, Mensajes, Alertas, Inventario, Caja, Reportes o Preparación.
- Los indicadores de carga usan `aria-busy` y una región viva para lectores de
  pantalla. La reconexión no borra datos que el equipo ya estaba consultando.
- No se cambiaron mutaciones, backend, RLS, LANA, Meta ni lógica clínica. Web y
  PWA usan `smyl-v193-resilient-workspace`.
- Validación focalizada: 13/13; QA de desconexión aprobado en móvil, sin
  errores de consola.
- La etapa final es navegación global y auditoría de accesibilidad para cerrar
  la reorganización profesional.

## 2026-10-13 — Codex: etapa 5 de continuidad, Centro de alertas

**Reorganizado en frontend:** Notificaciones separa pendientes operativos de
novedades informativas y deja de marcar todo como leído al abrir la pantalla.

- Reúne señales de Agenda, Mensajes e Inventario como acciones agregadas, con
  origen, rol responsable, prioridad y acceso al módulo que las resuelve.
- Las alertas no tienen una marca falsa de “atendida”: desaparecen únicamente
  cuando cambia el estado verificable en su fuente canónica.
- Las novedades de SMYL conservan lectura local por clínica y ya no se mezclan
  con citas, conversaciones, recordatorios ni existencias.
- Alertas aparece en el menú diario de escritorio, en la hoja móvil y como
  acceso desde Inicio; la barra móvil principal conserva sus cuatro tareas.
- Se reutilizan RLS, permisos y RPC de lectura existentes. No se cambió
  backend, migraciones, LANA, Meta ni datos clínicos. Caché:
  `smyl-v192-action-center-gmail`.
- Validación focalizada: 13/13. Suite amplia: 129/131; permanecen los dos
  fallos preexistentes de `lana-quick` y `quick-guided-flow`. QA visual
  aprobado a 1366, 834 y 390 px, sin overflow ni errores de consola.
- La siguiente etapa es unificar carga, error, desconexión y recuperación en
  los módulos operativos para que el equipo siempre sepa qué puede hacer.
## 2026-10-13 — Codex: catálogo dental v1 publicado

**Integrado sobre la versión vigente:** se auditó el flujo servicios → agenda →
plan → odontograma → propuesta → finanzas y se creó la primera entrega del
catálogo.

- Se recuperaron las migraciones clínicas históricas que faltaban en la rama
  publicada para que el esquema sea auditable y reproducible.
- Nuevo menú opt-in de más de 55 servicios en 13 áreas, con búsqueda,
  activación, edición, desactivación, precio, duración, unidad clínica y estado
  de revisión fiscal.
- Nueva migración aditiva `20261013000000_smyl_service_catalog.sql`: amplía
  `smyl_services` y añade snapshots inmutables en `smyl_service_versions`, con
  RLS de agenda. Se aplicó en producción el 2026-10-13 después de un dry-run
  que confirmó que era la única migración pendiente.
- Las claves SAT se muestran como sugerencias editables; no se confunde unidad
  clínica con unidad fiscal ni se afirma que el CFDI borrador ya timbre.
- Se documentó el contrato de schema v2 para enlazar plan, dientes FDI,
  cotización y cargos sin autodiagnóstico ni filtración del historial médico.
- Web/PWA usan el contrato de caché `smyl-v195-dental-catalog`. Gmail/OAuth,
  LANA/Meta, prompts, Storage, Stripe y configuración nativa no fueron tocados.
- Publicado en GitHub Pages y comprobado en el panel profesional: carga las 62
  plantillas y las 13 áreas sin activar ni modificar servicios de la clínica.
- Validación local: catálogo y contrato LANA 5/5; suite amplia 141/143. Persisten únicamente
  los dos fallos preexistentes de `lana-quick` y `quick-guided-flow`. QA visual
  aprobada a 1366, 834 y 390 px; web/PWA tienen hashes idénticos.

## 2026-10-13 — Codex: etapa 4 de continuidad, Inicio de jornada

**Reorganizado en frontend:** Inicio deja de ser un resumen de créditos y se
convierte en el tablero operativo diario de la clínica.

- Resume citas de hoy, pacientes en clínica, solicitudes pendientes y
  conversaciones que necesitan atención; cada indicador abre Agenda o
  Mensajes, que siguen siendo la fuente de trabajo canónica.
- Ordena como prioridades las llegadas, citas en atención, horarios vencidos,
  solicitudes e inasistencias. También muestra las próximas citas del día.
- Añade accesos directos para crear una cita, registrar un paciente, abrir la
  bandeja y continuar expedientes, sin duplicar formularios ni decisiones.
- Reutiliza las consultas RLS ya existentes con `tenant_id`. Mensajes publica
  al tablero solamente totales operativos; no copia ni expone el historial.
- No se cambió backend, LANA, Meta, migraciones, permisos ni contratos de
  envío. Web y PWA móvil usan `smyl-v190-daily-home`.
- Validación focalizada: 13/13. Suite amplia: 124/126; permanecen los dos
  fallos preexistentes de `lana-quick` y `quick-guided-flow`. QA visual
  aprobado a 1366, 834 y 390 px, sin errores de consola.
- La siguiente etapa recomendada es consolidar alertas y notificaciones para
  que cada pendiente tenga un único origen, responsable y destino de acción.

## 2026-10-13 — Codex: etapa 3 de continuidad, Mensajes por paciente

**Reorganizado en frontend:** Mensajes funciona ahora como centro de atención
dental y presenta primero el trabajo que requiere al equipo.

- La bandeja prioriza conversaciones fijadas, solicitudes de humano, mensajes
  sin leer y conversaciones asignadas al usuario antes de ordenar por fecha.
- Un resumen visible explica qué necesita atención dentro del filtro actual y
  distingue visualmente solicitudes humanas y mensajes nuevos.
- Cada hilo muestra una `Siguiente acción` con acceso directo a responder,
  vincular/abrir el expediente y consultar Agenda cuando existe una cita.
- El encabezado del hilo reúne canal, estado del asistente, responsable y
  vínculo con expediente. Las herramientas del compositor usan nombres claros
  en vez de abreviaturas y conservan la revisión humana antes de enviar.
- No se cambió backend, LANA, Meta, Supabase, permisos ni contratos de envío.
  Web y PWA móvil usan `smyl-v189-patient-messages`.
- Validación focalizada del Inbox: 27/27. Suite amplia: 120/122; permanecen los
  dos fallos preexistentes de `lana-quick` y `quick-guided-flow`. QA visual
  aprobado a 1366, 834 y 390 px, sin errores de consola.
- La siguiente etapa recomendada es convertir `Inicio` en un tablero de jornada
  que conecte Pacientes, Agenda y Mensajes sin duplicar sus datos.

## 2026-10-13 — Codex: etapa 2 de continuidad, Agenda operativa

**Reorganizado en frontend:** la Agenda incorpora una cola única de prioridades
para que recepción y clínica sepan qué requiere acción ahora.

- Ordena citas cuyo horario pasó sin cambio de estado, pacientes que llegaron o
  están en atención, solicitudes pendientes, recordatorios fallidos o vencidos,
  próximas citas e inasistencias que requieren seguimiento.
- Añade un resumen diario de recordatorios y conecta el detalle de la cita con
  el expediente del paciente y, para inasistencias o cancelaciones, Mensajes.
- Se reutilizan las consultas RLS y RPC seguras existentes. No se cambiaron
  migraciones, seguridad, transiciones ni contratos de backend, y el asistente
  continúa sin confirmar citas automáticamente.
- Web y PWA móvil quedan sincronizadas con el caché
  `smyl-v188-operational-agenda`; la vista fue revisada a 1366, 834 y 390 px.
- Validación focalizada: 15/15. Suite amplia: 116/118; permanecen los dos
  fallos preexistentes de `lana-quick` y `quick-guided-flow`. Sin errores de
  consola en la vista de QA.
- La siguiente etapa recomendada es ordenar `Mensajes` como centro de atención
  y seguimiento, enlazado con pacientes, Agenda y canales Meta.

## 2026-10-12 — Codex: etapa 1 de continuidad del flujo clínico

**Reorganizado en frontend:** la ficha del paciente muestra ahora un recorrido
navegable y verificable de `Evidencias → Revisión → Plan → Presentación`.

- La acción principal cambia según el siguiente pendiente y abre el módulo
  correcto sin desmontar editores ni perder borradores locales.
- Cada paso conserva su estado existente; no se introdujo una fuente de verdad
  nueva ni se cambió ningún criterio clínico, aprobación o contrato de backend.
- El último paso se renombró `Presentación y seguimiento`. Después de crear un
  enlace en la sesión aparece el acceso a `Mensajes`; SMYL sigue aclarando que
  no confirma ni ejecuta un envío automático.
- Se actualizó `smyl-case-workspace.js/css`, sus copias PWA, `app.html`, `sw.js`
  y pruebas. Caché: `smyl-v187-clinical-flow`.
- Validación focalizada: 22/22. Suite amplia: 113/115; permanecen los dos fallos
  preexistentes documentados de `lana-quick` y `quick-guided-flow`. QA visual
  aprobado a 1366, 834 y 390 px, sin errores de consola.

## 2026-10-12 — Codex: arquitectura de información y navegación profesional

**Reorganizado:** el panel deja de presentar todos los módulos al mismo nivel y
se ordena según la frecuencia real de trabajo en una clínica dental.

- Primer nivel: `Inicio`, `Pacientes`, `Agenda` y `Mensajes`.
- `Administración`: inventario, caja/cobros y reportes.
- `Configuración`: clínica, canales/asistente, preparación operativa,
  simulaciones, presentaciones, precios, marca y cuenta.
- `Canales y asistente` separa ahora las tareas en tres pestañas: `Canales`,
  `SMYL Asistente` y `Laboratorio`, sin modificar OAuth, Meta, LANA, secretos,
  permisos ni contratos de backend.
- La barra móvil conserva solo las cuatro tareas diarias; el resto queda en un
  menú agrupado. Web y PWA móvil están sincronizadas con el caché
  `smyl-v186-information-architecture`.
- Archivos principales: `smyl-navigation.js`, `smyl-navigation.css`,
  `app.html` y `sw.js` (más sus copias en `mobile/www`).
- Validación: 49/49 pruebas focalizadas, sintaxis JavaScript válida y revisión
  responsiva de escritorio/móvil sin errores de consola.

## 2026-10-12 — Codex: acceso visible a Canales e IA

**Corrección de navegación:** `Canales e IA` dejó de estar oculto dentro de
“Herramientas y configuración”. Ahora aparece en el menú principal de
escritorio, junto a `Mensajes`, y como `Canales` en la navegación móvil.

- No se cambió OAuth, Meta, LANA, secretos ni el contrato de conexión.
- El flujo continúa limitado al propietario de la clínica y mantiene tokens en
  LANA; este cambio solo hace visible la entrada que ya existía.

## 2026-10-12 — Codex: etapa 7, cierre profesional y preparación operativa

**Implementado:** Centro de lanzamiento con diagnóstico tenant-scoped,
confirmaciones auditadas y manual operativo.

- `smyl_operational_readiness_report()` comprueba configuración de clínica,
  agenda, roles y riesgos de caja/recordatorios sin devolver pacientes ni PHI.
- Solo `settings.manage` puede consultar o confirmar controles. La aprobación
  final se rechaza mientras exista cualquier requisito automático o manual.
- Las confirmaciones de privacidad, capacitación, recuperación y soporte dejan
  actor y fecha en la bitácora; pueden reabrirse sin borrar historial.
- El manual distingue controles verificables de responsabilidades del proveedor:
  no afirma que exista un respaldo ni monitoreo externo sin evidencia.
- Migración `20261012360000`. Detalle en `docs/SMYL_OPERATIONS_RUNBOOK.md`.
- Con esto concluyen las siete etapas de conversión a plataforma dental; la
  siguiente actividad recomendada es un piloto real controlado por clínica.

## 2026-10-12 — Codex: etapa 6, reportes ejecutivos

**Implementado:** tablero agregado por periodo y sucursal con indicadores de
agenda, cobranza, equipo, servicios, inventario y riesgos operativos.

- `smyl_executive_dashboard()` devuelve únicamente agregados y aplica permisos
  por dominio; no entrega pacientes, expedientes, fotografías ni notas.
- Incluye tendencia diaria, asistencia, inasistencias, ingresos netos, saldo por
  cobrar, demanda por servicio, actividad profesional y alertas operativas.
- El CSV se genera localmente con datos agregados. No transmite información a
  LANA ni a terceros.
- Migración `20261012350000`. Detalle en `docs/SMYL_EXECUTIVE_REPORTS.md`.
- La siguiente y última etapa es **Cierre profesional y preparación operativa**.

## 2026-10-12 — Codex: etapa 5, caja y finanzas dentales

**Implementado:** cuenta por paciente, cargos, pagos, anticipos, aplicaciones,
reembolsos, recibos internos, apertura/corte de caja, ajustes y expediente fiscal.

- El libro financiero es independiente de Stripe y de cualquier infraestructura
  de LANA. Mutaciones confirmadas usan RPC idempotentes y auditadas.
- El saldo se deriva de cargos, aplicaciones y reembolsos; no hay saldo editable.
- Efectivo requiere sesión abierta por usuario/sucursal y el corte conserva la
  diferencia entre esperado y contado.
- CFDI queda en preparación: perfil fiscal y borrador congelado por pago. No se
  anuncia timbrado ni envío SAT sin un PAC autorizado.
- Migraciones `20261012330000` y `20261012340000`. Detalle en
  `docs/SMYL_DENTAL_FINANCE.md`.
- La siguiente etapa recomendada es **Reportes operativos y tablero ejecutivo**.

## 2026-10-12 — Codex: etapa 4, inventario y compras dental desplegado

**Publicado en Supabase SMYL:** catálogo, proveedores, ubicaciones, niveles de
reposición, compras, recepciones, lotes, movimientos y materiales por servicio.

- Las existencias se derivan del libro de movimientos; no existe un saldo
  editable. Recepciones, traslados, consumos, mermas y ajustes son atómicos.
- Los movimientos confirmados son inmutables. Una corrección crea una
  compensación ligada al original y, si era recepción, ajusta también el pedido.
- Lote, caducidad, serie y trazabilidad por paciente se habilitan por insumo.
  Un lote caducado no puede consumirse clínicamente.
- Compras y movimientos usan idempotencia y bloqueo transaccional para evitar
  recepciones duplicadas o existencias negativas por concurrencia.
- `inventory.read` e `inventory.manage` gobiernan RLS y acciones; el navegador
  no escribe directamente en compras, lotes ni movimientos.
- Se aprovisionaron 27 almacenes principales, uno por sucursal existente. Web
  y PWA móvil sincronizadas; caché `smyl-v182-dental-inventory`.
- Migraciones `20261012300000` a `20261012320000`. Detalle en
  `docs/SMYL_DENTAL_INVENTORY.md`.
- La siguiente etapa es **Caja y facturación**.

## 2026-10-12 — Codex: etapa 3, Ficha clínica 360

**Desplegada en Supabase SMYL:** expediente longitudinal con
antecedentes versionados, notas SOAP, firma inmutable, adendas, archivos privados
y línea de tiempo de citas, notas y evidencias.

- Los módulos existentes de odontograma, simulaciones/casos y plan de
  tratamiento se conservan y ahora tienen navegación desde la Ficha 360.
- `clinical.read`, `clinical.write` y `clinical.approve` separan lectura,
  captura y firma. Las mutaciones clínicas pasan por RPC y control optimista.
- El bucket `smyl-clinical-files` es privado, tenant/paciente-scoped, limita
  tipo y tamaño y entrega URLs firmadas temporales.
- Las notas firmadas no se editan: toda corrección posterior es una adenda.
- Web y PWA móvil sincronizadas; caché `smyl-v182-dental-inventory`.
- Migraciones `20261012270000` a `20261012290000`. Detalle en
  `docs/SMYL_PATIENT_360.md`.
- La siguiente etapa es **Inventario y compras dental**.

## 2026-10-12 — Codex: etapa 2, agenda diaria dental desplegada

**Publicado en Supabase SMYL:** servicios, disponibilidad profesional, citas,
bloqueos, solicitudes del asistente, eventos y recordatorios; acciones atómicas
para confirmar, reprogramar y cambiar estados.

- La agenda valida sede, horario de clínica, disponibilidad, profesional,
  servicio, sillón/consultorio, citas concurrentes y bloqueos antes de confirmar.
- Llegada, atención, término, inasistencia y cancelación siguen una máquina de
  estados. Reprogramar y cambiar estado usan control optimista para no pisar
  cambios de otra sesión.
- SMYL Asistente solo crea solicitudes pendientes. Una persona con permiso de
  agenda debe revisarlas y convertirlas explícitamente en cita; no hay
  confirmaciones automáticas ni autoridad clínica delegada a LANA.
- Se agenda un recordatorio de 24 horas cuando corresponde. Reprogramar o cerrar
  la cita invalida recordatorios anteriores; la entrega futura podrá usar el
  motor servidor a servidor sin compartir la base clínica.
- RLS y privilegios SQL están cerrados: citas, bloqueos, solicitudes, eventos y
  recordatorios son de solo lectura para el navegador y se mutan por RPC.
- El panel incorpora Agenda día/semana, filtros, servicios, disponibilidad,
  bloqueos, estados y solicitudes. Web/PWA sincronizadas; caché
  `smyl-v182-dental-inventory`.
- Migraciones `20261012230000` a `20261012260000` aplicadas y
  registradas. Detalle en `docs/SMYL_DAILY_SCHEDULE.md`.
- La siguiente etapa es **Ficha clínica 360**.

## 2026-10-12 — Codex: etapa 1 de plataforma, núcleo de clínica desplegado

**Publicado en Supabase SMYL:** cuatro migraciones para sucursales, espacios,
horarios, equipo, roles, permisos, profesionales y auditoría. No se consultan ni
comparten tablas de LANA.

- Se crearon 10 tablas tenant-scoped con RLS y 29 políticas; 27 clínicas
  existentes recibieron una sede principal y 25 propietarios su rol inicial.
- Las asignaciones de rol/sede, el cambio de sucursal principal y el alta de
  profesional usan RPC transaccionales. Los horarios se serializan y rechazan
  traslapes; una restricción diferida impide dejar una clínica activa sin sede
  principal.
- Un integrante invitado inicia con el rol mínimo **Recepción**; los permisos
  clínicos o administrativos requieren asignación explícita del propietario.
- El panel incorpora **Mi clínica** para sucursales, sillones/consultorios,
  horarios, equipo, roles, sedes y profesionales. Web y PWA están sincronizadas
  y el caché subió a `smyl-v179-clinic-core`.
- Validación: 11 pruebas enfocadas aprobadas, SQL compilado en PostgreSQL
  embebido, migraciones registradas, lectura anónima sin filas y mutación
  anónima `401`. QA visual aprobado a 1440 px y 390 px sin overflow.
- El asesor de Supabase conserva hallazgos históricos fuera de esta etapa en
  `landing_catalogo`, `camila_tenants_publico` y Auth; no se modificaron a
  ciegas. Detalle en `docs/SMYL_CLINIC_CORE.md`.
- La siguiente etapa es **Agenda diaria** sobre este núcleo: servicios,
  disponibilidad, citas, estados, bloqueos, recordatorios y solicitudes del
  asistente sin confirmaciones falsas.

## 2026-10-12 — Codex: etapa 0 de plataforma, frontera profesional SMYL + LANA

**Decisión de producto aplicada:** SMYL es la única plataforma visible para la
clínica. LANA permanece como proveedor interno de mensajería e IA mediante API
servidor a servidor; no es un segundo panel para el dentista.

- Se añadió `docs/SMYL_PLATFORM_BOUNDARY.md` con propiedad de dominios,
  frontera de seguridad, núcleo técnico reutilizable y seis etapas para
  convertir SMYL en un sistema de gestión dental completo.
- La interfaz ahora presenta **Canales e IA**, **Mensajes** y **SMYL
  Asistente**. Se retiró la marca LANA del copy visible de conexiones, Inbox,
  atención, preparación de expediente y presentaciones; los nombres técnicos
  internos se conservaron para no romper endpoints ni migraciones.
- El inventario futuro vivirá en la base de SMYL y reutilizará el patrón de
  movimientos inmutables de LANA, adaptado a lotes, caducidad, esterilización,
  implantes y consumo por paciente.
- Web y PWA móvil quedaron sincronizadas; caché actualizado a
  `smyl-v178-product-boundary`. Se añadieron pruebas explícitas de la frontera
  de producto.
- No se modificaron bases de datos, Edge Functions, secretos, Meta ni el panel
  de LANA. La siguiente etapa técnica es **Núcleo de clínica**: sucursales,
  consultorios/sillones, horarios, miembros, roles y permisos por módulo.

## 2026-10-12 — Codex: SMYL queda separado de la interfaz de LANA

**Corrección directa de producto:** Ricardo confirmó que SMYL se manejará por
separado de LANA. El dentista opera Inbox, expedientes, capacitación y canales
desde SMYL; LANA queda como motor/API protegido y no como una segunda interfaz
que el profesional deba abrir.

- Se retiró de LANA el botón “Expediente SMYL” y su duplicado del menú del chat.
- SMYL ya no acepta el deep link público `?ir=lana-handoff`, no muestra
  “Abrir/Volver a LANA” y no enlaza desde la ficha del paciente al admin de
  LANA.
- **Preparar expediente** sigue disponible dentro del Inbox de SMYL y usa la
  conexión cifrada servidor a servidor para resolver identidad y vincular el
  caso, sin copiar el historial.
- Se conserva la infraestructura LANA necesaria para WhatsApp, Messenger,
  Instagram y respuestas de IA. La separación es de producto e interfaz, no
  una duplicación del motor.

## 2026-10-12 — Codex: etapa 8, infraestructura publicada y piloto preparado

**Publicado en producción:** migraciones LANA 1–7 y dependencia de programados;
migraciones SMYL de aprovisionamiento y vínculos clínicos; funciones de
conexión, capacitación, Inbox, webhooks, conectores y trabajador; web/PWA de
SMYL y panel de conexión alojado por LANA.

- La app está disponible en
  `https://rpartidaislas-cloud.github.io/camila/app.html`; el conector de
  canales en `https://app.get-lana.com/smyl-channel-connect.html`.
- Se verificaron historial de migraciones, RLS, grants de RPC, cron único,
  respuestas `401` sin sesión y publicación de activos. Validación final:
  LANA 34/34 y SMYL 44/44 pruebas enfocadas.
- `Dd` tiene siete pacientes y una conexión cifrada que coincide con la
  integración LANA heredada, pero no tiene usuario profesional activo,
  capacitación publicada ni canales. `dr` tiene un usuario activo, datos
  vacíos y aún no está conectado; es la recomendación para probar el
  aprovisionamiento automático nuevo.
- **El piloto no se declara completo:** falta que Ricardo elija la clínica,
  conectar los tres canales con sus dueños, publicar contexto dental, ejecutar
  mensajes sintéticos y observar una jornada controlada antes de pacientes.
- Registro detallado en LANA:
  `docs/agent-context/smyl-chat-piloto-real-etapa8.md`.

## 2026-10-11 — Codex: etapa 7 técnica, endurecimiento y puerta de piloto

**Tocado en SMYL:** `smyl-inbox.js/css` y copia móvil, `app.html`, `sw.js`,
`lana-inbox`, arquitectura, contrato/documentación, fixture visual y pruebas.

**Tocado en LANA:** `camila-api`, trabajador de mensajes programados, helper de
WhatsApp, contrato de Inbox, migración
`20261011260000_smyl_inbox_hardening_pilot.sql`, contexto de agente y pruebas.

- El Inbox muestra salud operativa, alertas, volumen, consumo de IA, canales y
  una lista verificable de preparación del piloto sin exponer PHI.
- Los límites se consumen atómicamente por tenant/actor. Los envíos sólo se
  reintentan automáticamente ante rechazo transitorio explícito de Meta; un
  resultado ambiguo pasa a revisión humana para no duplicar mensajes.
- La cola de fallos conserva intentos, siguiente ejecución y causa. El reintento
  manual es autorizado, tenant-scoped e idempotente.
- Validación específica aprobada en ambos repositorios, checks de sintaxis y
  bundle aprobados, y revisión visual responsive en escritorio, tableta y móvil.
  La suite amplia de SMYL conserva dos fallos preexistentes y ajenos al Inbox en
  pruebas de simulación rápida (`lana-quick` y `quick-guided-flow`).
- **No publicado:** falta aplicar migraciones y desplegar funciones/web en orden,
  elegir una clínica y completar el piloto real con canales conectados. Esa
  activación quedó como tarea separada y requiere autorización explícita.

## 2026-10-11 — Codex: etapa 6, WhatsApp avanzado en el Inbox

**Tocado en SMYL:** `smyl-inbox.js/css` y copia móvil, `app.html`, `sw.js`,
`lana-inbox`, arquitectura, documentación y pruebas.

**Tocado en LANA:** `camila-api`, trabajador de mensajes programados, contrato
de Inbox, migración `20261011250000_smyl_whatsapp_advanced.sql`, contexto de
agente y pruebas.

- LANA calcula y devuelve la ventana de 24 horas; la UI avisa cuando está por
  vencer o vencida, y el servidor bloquea contenido libre fuera de ventana.
- Sólo plantillas `UTILITY` activas y aprobadas, pertenecientes al tenant,
  pueden reabrir WhatsApp. Las variables se validan en LANA antes del envío.
- Los programados guardan actor, payload, hash y clave de idempotencia. El
  trabajador revalida la política al ejecutar y reconcilia la persistencia
  antes de un reintento para evitar duplicados.
- El equipo puede heredar, desactivar o ajustar por conversación la
  reactivación y el comportamiento próximo al cierre; las reglas son
  atómicas, auditadas e idempotentes. SMYL muestra recordatorios y permite
  cancelar pendientes sin recibir credenciales de Meta.
- Verificación local: Deno y sintaxis aprobados; 17 pruebas enfocadas de LANA y
  19 regresiones de SMYL aprobadas. Revisión visual responsive aprobada en
  escritorio, tablet y móvil con datos simulados; el QA corrigió la altura del
  workspace y evitó que el compositor ensanchara el hilo.
- **No publicado:** falta aplicar la migración, desplegar `camila-api`, el
  trabajador programado y `lana-inbox`, publicar web/PWA y completar un piloto
  con plantillas reales aprobadas por Meta.

## 2026-10-11 — Codex: etapa 3, Inbox operativo SMYL sobre LANA

**Tocado:** `app.html`, `smyl-inbox.js/css`, PWA móvil, `sw.js`, función
`lana-inbox`, contrato/documentación, pruebas y el repositorio LANA
(`camila-api` y migración `20261011220000_smyl_inbox_operational.sql`).

- SMYL ofrece una bandeja responsive para WhatsApp, Messenger e Instagram,
  con filtros, no leídos, hilo paginado, carga incremental y control de
  atención. LANA sigue siendo la única fuente de conversaciones y mensajes.
- El navegador usa su sesión SMYL; tenant, actor y rol se resuelven en servidor.
  La API key vinculada, los tokens de Meta y el identificador externo del
  contacto no salen de las Edge Functions.
- Los envíos manuales usan una cola optimista por conversación y una clave
  idempotente estable para reintento/reconciliación. Si el proveedor aceptó el
  mensaje pero no pudo confirmarse la persistencia, la UI exige actualizar el
  hilo antes de reenviar para evitar duplicados.
- Responder pausa automáticamente a LANA. El equipo puede tomar/liberar,
  pausar/reanudar y resolver solicitudes según su rol; las mutaciones se
  serializan y auditan en LANA.
- La actualización “en vivo” usa sincronización incremental segura cada cinco
  segundos mientras la pantalla está visible; no entrega credenciales de
  Realtime de LANA al navegador de SMYL.
- Pruebas focalizadas de interfaz, rutas, contrato, concurrencia, idempotencia
  y migración PostgreSQL pasan; los chequeos Deno y la revisión visual en
  escritorio/móvil también pasan.
- **No publicado:** falta aplicar primero la migración en LANA, desplegar
  `camila-api`, desplegar `lana-inbox`, publicar web/PWA y ejecutar un piloto
  real con dos usuarios y los tres canales.

## 2026-10-11 — Codex: etapa 2, Capacitar IA dental versionada

**Tocado:** `smyl-connections.js/css`, PWA móvil, función `lana-training`,
documentación, pruebas y el repositorio LANA (`camila-api`, compilador dental y
migración `20261011210000_smyl_dental_training.sql`).

- El contexto inmediato se sustituyó por borrador, validación y publicación:
  guardar ya no cambia lo que LANA responde a pacientes.
- La capacitación estructura identidad, clínica, servicios, FAQ, citas,
  precios, datos administrativos, escalamiento y autonomía. Los límites de no
  diagnosticar, prescribir, interpretar imágenes, prometer resultados o
  revelar expedientes son código fijo y no campos editables.
- Publicar crea una versión inmutable y actualiza el runtime dentro de la misma
  transacción, con revisión optimista, `Idempotency-Key`, RLS cerrado y bitácora
  inmutable. Restaurar solo crea un nuevo borrador; no altera producción.
- El laboratorio puede alternar entre borrador y publicación y usa
  `bloqueContextoSmyl`, el mismo compilador de los webhooks reales. No envía ni
  persiste una conversación.
- Pruebas focalizadas de frontend, contrato, compilador y migración pasan. El
  chequeo Deno de las nuevas funciones pasa; `camila-api` conserva cuatro
  errores de tipos preexistentes del SDK de Anthropic y el adaptador Meta.
- **No publicado:** falta aplicar primero la migración en LANA, desplegar
  `camila-api`, desplegar `lana-training` en SMYL, publicar los activos y hacer
  una prueba controlada con una clínica.

## 2026-10-11 — Codex: etapa 0, contrato ejecutable SMYL ↔ LANA

**Tocado:** `docs/SMYL_CHAT_ARCHITECTURE.md`,
`docs/SMYL_LANA_CHAT_CONTRACT_V1.md`,
`docs/LANA_INTEGRATION.md`, helper `lana-contract.mjs`, clientes Edge de LANA,
pruebas de contrato y el repositorio LANA (`camila-api`).

- Se congeló la frontera: LANA conserva canales, tokens, webhooks,
  conversaciones y mensajes; SMYL conserva pacientes, expedientes, citas,
  casos, simulaciones, propuestas y vínculos confirmados.
- Las llamadas salientes de SMYL ahora normalizan rutas contra una lista
  permitida y anuncian la versión `1.0`; no se aceptan hosts, rutas ni
  fragmentos arbitrarios.
- LANA expone un manifiesto autenticado sin secretos en `GET /contract` y
  devuelve la versión del contrato en sus respuestas.
- Se documentaron los endpoints actuales y los gates de aprovisionamiento,
  canales y capacitación de las siguientes etapas. No hubo migración,
  despliegue, conexión con Meta ni copia de mensajes.

## 2026-10-11 — Codex: etapa 6, bandeja clínica de atención LANA

**Tocado:** `app.html`, `smyl-lana-attention.js/css`, `sw.js`, nueva función
`lana-attention`, documentación, pruebas y `camila-api` en el repositorio
LANA.

- El inicio muestra una lista real de conversaciones que LANA marcó para
  asesor o que recibieron respuesta mientras la IA está pausada.
- Cada fila permite abrir el chat exacto en LANA y preparar/reutilizar el
  expediente mediante el flujo seguro de la etapa 4. Se indica si el
  expediente ya está vinculado.
- SMYL recibe solo metadatos operativos; no copia mensajes, resúmenes de chat,
  teléfonos, correos ni credenciales de Meta.
- El dueño puede marcar una solicitud como resuelta. La operación replica el
  cierre de LANA, pero no envía mensajes, no elimina la conversación y no
  reanuda la IA. El personal mantiene acceso de lectura y al flujo de
  expediente.
- Sin migraciones nuevas. La interfaz adapta el patrón compacto de lista de
  tareas/estado consultado en 21st.dev a la identidad visual existente.

## 2026-10-11 — Codex: etapa 5, laboratorio privado de respuestas LANA

**Tocado:** `app.html`, `smyl-connections.js/css`, `sw.js`, función
`lana-context`, helper `lana-linked.ts`, pruebas y el repositorio LANA
(`camila-api`).

- **LANA y canales** incorpora un laboratorio de conversación con escenarios
  de precio/horario, dolor/urgencia y solicitud de diagnóstico por fotografía.
- La respuesta la genera la IA real de LANA con el contexto actualmente
  guardado, el nivel de autonomía y las mismas barreras clínicas. No se crea
  una conversación, no se persiste el historial de prueba y no se envía nada
  a WhatsApp, Messenger o Instagram.
- El historial temporal vive solo en memoria del navegador, se limita a ocho
  turnos y puede limpiarse. El endpoint limita tamaños de entrada y convierte
  `SOLICITAR_ASESOR` en un estado visible, sin mostrar marcadores internos.
- Solo el dueño de la clínica puede ejecutar pruebas. Cada respuesta respeta el
  límite mensual y registra su consumo como `smyl_preview` en LANA.
- La interfaz adopta el patrón de acciones sugeridas consultado en 21st.dev,
  adaptado a los tokens y lenguaje clínico de SMYL, sin copiar dependencias.

## 2026-10-11 — Codex: etapa 4, expediente desde LANA + contexto real de atención

**Tocado:** `app.html`, `smyl-connections.js/css`, `smyl-lana-handoff.js/css`,
`sw.js`, migración `20261011120000_lana_conversation_handoffs.sql`, funciones
`lana-handoff` y `lana-context`, y el repositorio LANA (`camila-api`, webhooks
de WhatsApp/Meta y panel admin).

- Desde una conversación de LANA se puede abrir SMYL con un enlace firmado por
  la integración servidor a servidor. SMYL solo consulta identidad y canal;
  no copia el historial del chat ni recibe credenciales de Meta.
- Antes de crear el expediente se muestra una revisión explícita. Se proponen
  coincidencias por correo o últimos 10 dígitos del teléfono y el profesional
  decide si reutiliza un paciente o crea uno nuevo.
- `camila_confirmar_lana_handoff` serializa la confirmación con advisory lock y
  la restricción única `(tenant_id, lana_conversation_id)`, por lo que un doble
  clic no duplica paciente, caso ni enlace.
- El enlace persistente conecta conversación, paciente y caso. El expediente
  puede volver al chat en LANA y LANA puede volver al expediente en SMYL.
- **LANA y canales** incorpora un contexto editable de clínica, servicios,
  ubicación, horarios, FAQ, tono, reglas de escalamiento y nivel de autonomía.
  SMYL lo sincroniza con el tenant real de LANA; no ejecuta una IA paralela.
- Los webhooks reales de WhatsApp, Messenger e Instagram inyectan ese contexto
  en la respuesta de LANA. Se conservan límites fijos: no diagnosticar,
  prescribir, prometer resultados, interpretar fotos ni revelar expedientes;
  ningún artefacto clínico de SMYL se comparte sin revisión y envío humano.
- Solo el dueño de la clínica puede modificar el contexto; el personal puede
  consultarlo y usar el flujo de expediente dentro de su tenant.

## 2026-10-10 — Codex: etapa 3, enlace real LANA verificado

**Tocado:** `docs/LANA_INTEGRATION.md`, despliegues `lana-connection` (SMYL)
y `camila-api` (LANA), migración de LANA `20260930120000_camila_integraciones`.

- La clínica autenticada se resolvió de forma única en SMYL y se emparejó con
  una sola cuenta activa de LANA mediante la cuenta exacta, sin usar datos de
  pacientes ni seleccionar por nombre aproximado.
- La tabla `camila_integraciones`, sus políticas y sus dos triggers se
  aplicaron en LANA y la versión quedó registrada en
  `supabase_migrations.schema_migrations`.
- Se corrigió en LANA la normalización de rutas de `camila-api`, que en
  producción recibía `/camila-api/...` y devolvía 404. Fix publicado en el
  `main` de `promodesk`, commit `c8c83871`, y función redeplegada.
- Se creó una credencial LANA para esa cuenta, SMYL la validó y guardó solo
  ciphertext AES-GCM, IV y huella. `connect` y `verify` terminaron en estado
  `conectada`; la interfaz pública muestra **LANA conectada**.
- La prueba fue sintética: límite 1, sin imprimir contenido clínico, sin
  registrar webhook y con cero mensajes enviados a WhatsApp, Messenger o
  Instagram.
- El secreto de arranque de un solo uso se eliminó y `lana-connection` se
  volvió a desplegar con su autenticación normal; no quedó una puerta
  administrativa temporal en código ni en secretos.

## 2026-10-10 — Codex: etapa 2, centro seguro LANA + Meta

**Tocado:** `app.html`, `smyl-panel.js`, `smyl-connections.js/css`, `sw.js`,
`supabase/functions/lana-connection/index.ts`, `docs/LANA_INTEGRATION.md` y
`tests/lana-connection-stage2.test.mjs`.

- Se añadió al panel el centro **LANA y canales** con estado real de enlace,
  verificación manual y acceso a LANA para WhatsApp, Messenger e Instagram.
- LANA permanece como única dueña de los webhooks y credenciales de Meta;
  SMYL no duplica la bandeja ni recibe tokens de Meta.
- El código de enlace de `camila-api` se valida servidor a servidor y se
  guarda cifrado con AES-256-GCM dentro de la configuración del tenant. La
  credencial nunca vuelve al navegador ni se persiste en almacenamiento web.
- Solo el dueño puede conectar o reemplazar el código; el staff puede ver el
  estado y verificarlo. La entrega clínica conserva aprobación humana.
- Se reutiliza `camila-api`, ya desplegada en LANA; no se modificaron ni
  desplegaron los webhooks de Meta/WhatsApp de LANA.
- `lana-connection` quedó desplegada como versión 1 con verificación JWT;
  `SMYL_LANA_ENCRYPTION_KEY` quedó configurado como secreto del proyecto.
- La comprobación pública detectó un primer arranque en frío superior a 12 s;
  el cliente ahora espera hasta 20 s y la PWA avanzó a
  `smyl-v165-lana-connection-cold-start`.

## 2026-10-10 — Codex: cierre de producto, etapa 1

**Tocado:** `app.html`, `smyl-panel.js`, `smyl-panel.css`, `sw.js` y
`tests/professional-panel-stage1.test.mjs`.

- El dashboard muestra explícitamente las cuatro etapas clínicas existentes:
  Evidencias, Revisión clínica, Plan de tratamiento y Compartir.
- Se añadieron accesos orientados a tareas para registrar evidencia, continuar
  expedientes y preparar propuestas, sin inventar estados ni automatizaciones.
- Los accesos primarios de creación abren el mismo simulador profesional; el
  formulario heredado de Valoración y diseño deja de aparecer en navegación.
- Se retiró Colaboraciones de la navegación de producción y su lugar en móvil
  ahora abre Marca y simulación; Presentaciones también queda accesible allí.
- Los prompts internos de proveedores quedan ocultos al dentista. Los precios
  se presentan como referencias que requieren revisión y aprobación profesional.
- Caché PWA actualizado a `smyl-v163-clinical-stage-dashboard` y activos del
  panel a `v=3`.
- No se tocaron backend, Supabase, prompts, permisos ni archivos nativos.

## 2026-10-09 — Codex: panel clínico v18 publicado

**Tocado:** `app.html`.

- Se publicó el refresh visual del panel con identidad Harbor Blue y teal,
  jerarquía clínica más clara, onboarding del dashboard y tarjetas refinadas.
- El flujo de nuevo diseño incorpora progreso adaptable y áreas de carga con
  prioridad clínica; la navegación móvil usa cinco destinos y acción central.
- La integración se aplicó sobre la rama vigente de GitHub Pages y preserva
  el expediente, revisión clínica, radiografías y demás lógica reciente.
- QA aprobado: scripts inline, consola limpia y revisión responsive sin
  desbordes horizontales.
- **No se tocaron backend, Supabase, prompts, archivos nativos ni simuladores.**

## 2026-09-27 — Publicación solicitada: recorrido y laterales v112

Se publica el recorrido Fotografías/Opciones/Resultado y el ajuste de región
oblicua con prompt v27. Pruebas locales pasan; sin generaciones pagadas.
No incluye cambios ajenos de app.html/simulacion.html. El error 402 se
investigó: el POST usa un usuario distinto, sin correo, al dueño con saldo.
No se modificaron Auth, cupos ni backend. Pendiente iniciar sesión correcta
y validar calidad de alineación con una generación real; no está certificada.

## 2026-09-27 — Laterales: anclaje en coordenadas de recorte (local)

Detector oblicuo permite bandas por encima de la mitad del recorte. Unión
sin landmarks usa esa banda observada y no el rectángulo fijo inferior;
si no detecta esmalte, falla explícitamente conservando el candidato pagado.
Con landmarks mantiene cobertura de ambas arcadas. Localizador face-mouth-v2;
ajuste local reconoce contrato visual-preview-v3. Prompt lateral permite
cambio de silueta proyectada y unión cervical local al mover corona completa.
Guía oficial OpenAI de edición consultada para separar cambios e invariantes.
Prueba sintética de bandas altas pasa en cinco vistas; pruebas previas de
composición y 45 combinaciones de prompt pasan. No prueba clínica/anatómica.
Sin generación pagada, sin publicación, pendiente comparar imágenes reales.
Frontend v27, caché v112; copias móviles sincronizadas.

## 2026-09-27 — Recorrido y diseño unificados (local)

smyl-workflow.js/css reorganizan el simulador en Fotografías, Opciones y
Resultado. Una entrada, ocho vistas agrupadas, cámara/archivo por vista,
cambio de primera foto y carga sin generar. Se admite una lateral como única
foto en la ruta visual existente. Intraorales independientes y opcionales.
Herramientas profesionales se agrupan bajo Más herramientas; VITA completo
se despliega bajo demanda. Sin cambios de prompts ni backend; no promete
corregir anatomía. Pruebas en 390/768/1366 con generaciones interceptadas,
carga, selección de principal, arcada, conservación de tono al alinear y
ausencia de desbordamiento. Copias móviles sincronizadas y caché v111.
No publicado; app.html y simulacion.html tienen cambios previos ajenos que
se conservan. La reorganización se aplica a simulacion-rapida.html.

## 2026-09-27 — Publicación autorizada de corrección oblicua

Publicación de frontend y PWA con visual-simulation v26 y caché
v110-oblique-visible-change. La ruta para perfiles, vista 3/4 e intraorales
laterales exige un cambio visible de posición de corona y descarta como
insuficiente una salida que solo cambie tono, brillo o textura. Pasan pruebas
de instrucciones oblicuas, referencias multivista, ocho vistas, referencia
opcional, scripts y flujo rápido. Sin cambios de backend o esquema y sin
consumir una generación durante la publicación. Sigue requiriendo validación
con una nueva generación real; no incorpora segmentación ni garantía anatómica.

## 2026-09-27 — Corrección whitening-only en vistas oblicuas (local)

La primera prueba real de intraoral lateral confirmó que la salida directa
solo blanqueaba. Se reforzó la ruta oblicua: exige reposicionamiento visible
de corona completa en todas las piezas identificables, permite conservar solo
la pieza ambigua, y rechaza internamente una salida cuyo único cambio sea
tono/brillo. Combined exige alineación visible antes del acabado cerámico.
No segmenta ni valida automáticamente piezas y no garantiza que el modelo
obedezca; requiere otra generación real autorizada. Sin publicar ni generar
otra imagen durante este ajuste.

## 2026-09-26 — Corrección de instrucciones oblicuas (local)

Hallazgo: combined/complete exigían colocar caninos y centrales de ambos
lados aun en perfiles. visual-simulation.js usa ahora ruta oblicua separada
para left/right/tresCuartos/intraoralLeft/intraoralRight, sin plantilla frontal.
Conserva posteriores, identidad visible, profundidad y arcada no seleccionada;
material-only mantiene su ruta. Referencia: mismo lado o intraoral frontal;
no lado opuesto ni diseño frontal generado como anatomía oblicua.
Prueba oblique-prompt: 45 combinaciones más selección de referencias.
NO implementa segmentación automática, máscara por pieza ni evaluación
anatómica posterior. NO resuelve por sí sola la fusión ni el borrado al mezclar.
Pendiente prueba real con originales y comparación salida directa/integrada.
Sin publicación, cambios de modelo, backend ni consumo de generación.

## 2026-09-26 — Publicación autorizada de ocho vistas

Publicación de frontend y PWA v108-eight-views. Cinco pruebas locales pasan.
Sin cambios adicionales de servidor, esquema ni generación pagada. Mantiene
limitación del expediente en nube descrita abajo. Se excluyen artifacts y
cambios ajenos de app.html y simulacion.html de esta publicación.

## 2026-09-26 — Ocho vistas opcionales (local, sin publicar)

case-views.js organiza Rostro y sonrisa (cinco) e Intraorales (tres).
Inicio permite frontal o intraoral principal; S.photos[0] conserva la principal
en flujo rápido. Carga/reemplazo/quitar opcionales no invoca IA; invalida
resultado asociado, no sobrescribe otras vistas. Laterales intraorales usan
encuadre completo. Miniaturas permiten selección y Generar esta vista.
Referencia original preferida por lado, sin garantía anatómica. Sin cambios
de backend ni esquema: persistencia local incluye ocho fotos; exportación
histórica a campos de expediente sigue limitada al esquema anterior.
Pruebas case-views, optional-reference y regresiones; demo local sin pacientes.
Caché v108, copias móviles sincronizadas. No generación pagada.

## 2026-09-26 — Intraoral opcional en configuración rápida (local)

Tarjeta no bloqueante en simulacion-rapida.html: añadir/cambiar intraoral,
vista previa y quitar apoyo sin sustituir frontal ni generar imágenes.
Validación de archivo y bloqueo de botones durante lectura; conserva la foto
anterior si falla. Prueba tests/optional-reference.test.mjs.
Es sugerencia general, NO detector automático de calidad ni conteo dental.
No incluye todavía las categorías de ocho vistas. Sin cambios de backend en
esta sesión. Mantiene dependencia de Edge indicada abajo, sin publicación.
Caché v107 y copias móviles sincronizadas.

## 2026-09-25 — Referencia intraoral original, frontal primero (local)

La frontal ya no depende de una generación intraoral previa. La intraoral
original opcional se envía como apoyo anatómico con contrato
same-patient-original-v1, separado de una referencia de diseño aceptado.
El consentimiento muestra las dos fotos y declara el envío de ambas.
Sin marcas manuales ni conteo automático validado: este cambio de roles no
certifica conservación dental. Pendiente prueba real y despliegue conjunto:
publicar primero Edge claude y luego frontend v24 / caché v106.
No se ha ejecutado generación pagada ni publicado durante este cambio.

## 2026-09-25 — Flujo sencillo solicitado por el usuario

Retirada la revisión manual obligatoria y sus recursos del simulador y caché.
El módulo experimental sigue en el repositorio, desconectado del flujo.
Selección independiente de arcada (arriba/abajo/ambos), tres objetivos y guía
con 16 tonos. Alinear sin carillas conserva el color: selector desactivado.
No se cambia el backend ni se promete conteo automático. Sin nueva generación.
Copias móviles sincronizadas; caché v105-simple-photo-flow preparado.

## 2026-09-25 — Revisión manual previa de piezas visibles (local, no publicado)

Nuevo dental-review.js/css: ampliación desde mouthRegion, reencuadre manual,
marcas móviles por arcada sin asumir seis piezas, eliminación y controles de
teclado/táctiles. Los extremos y separaciones definen intervalos visibles;
no es segmentación ni asignación FDI. Incertidumbre explícita por arcada permite
continuar sin confirmar un conteo. Confirmación inválida tras editar marcas.
visual-simulation.js abre la revisión antes del consentimiento y envía las
coordenadas normalizadas como instrucciones adicionales, guardadas en metadatos.
No toca píxeles de entrada, no cambia Edge ni garantiza anatomía/correspondencia.
Material-only y revisión de candidatos existentes no repiten esta etapa.
No se publicaron cambios ni se generaron imágenes para esta implementación.

## 2026-09-24 — Intraoral opcional y selección de referencia

`photo-reference.js` propone intraoral si existe; sin ella propone frontal.
Una foto omite el selector. Con varias se puede elegir cualquier referencia;
si no es la frontal se genera/acepta primero y las demás heredan la guía visual.
Cada generación conserva consentimiento. Si generar o preparar la referencia
falla, solo continúa independientemente tras confirmación explícita.
Retirados los dos botones manuales de la barra y la función/carga duplicadas.
Copias móviles sincronizadas, caché v103. Pruebas de navegación en 390/768/1280.
Esto adapta el flujo; NO garantiza correspondencia geométrica automática ni
anatomía exacta y no reemplaza la validación visual pendiente con casos reales.


## 2026-09-24 — Transferencia geométrica asistida experimental

Nuevo dental-transfer.js/css y botón Vincular dientes en simulación rápida.
Transformación afín local por pieza: contorno, tres anclajes y recorte visible
marcados por el usuario. Reutiliza píxeles intraorales; no genera ni envía fotos.
Solo frontal y extraoral de frente; laterales/3/4 pendientes. No es automático:
proporciones dependen de los anclajes e iluminación requiere revisión manual.
Incluye cancelar, quitar pieza y confirmación antes de guardar.
Pruebas matemáticas y browser sintético a 1280/768/390: correspondencia, rechazo
de degeneración, píxeles protegidos, guardado y disposición adaptable.
Pendiente validar con caso real y automatizar correspondencias fiables.
Copias móviles sincronizadas, caché v102. Sin consumo de IA.


## 2026-09-24 — Carga propia frontal + intraoral

- `Opciones avanzadas` separa ahora el ejemplo sintético de la carga real.
  `Cargar mis fotos · frontal + intraoral` solicita explícitamente ambos
  archivos, muestra el estado de cada uno y mantiene desactivado el avance
  hasta tener dos imágenes válidas de hasta 20 MB.
- Las dos fotografías se ajustan localmente antes de guardarlas. No se llama
  al generador al elegir archivos; la generación empieza únicamente después
  de escoger configuración y confirmar en la guía VITA.
- El flujo propio activa el mismo contrato pareado: intraoral como diseño
  maestro y frontal adaptada a esa identidad. El botón sintético se renombró
  `Ejemplo precargado · frontal + intraoral` para evitar confundirlo con una
  carga desde el dispositivo.
- Caché PWA `smyl-v99-own-paired-upload`; copias web/móvil sincronizadas y
  todas las suites locales aprobadas. No se ejecutó IA ni se enviaron fotos.

## 2026-09-23 — Identidad dental maestra entre frontal, intraoral, perfiles y 3/4

- `simulacion-rapida.html` guarda una sola `dentalDesignMaster` por caso. En
  la prueba frontal + intraoral se genera primero la intraoral y se usa como
  referencia anatómica maestra; si no existe, la frontal queda como maestra.
- Las vistas posteriores se mantienen bajo demanda para no multiplicar costo,
  pero al generar perfil derecho, perfil izquierdo, 3/4, frontal o intraoral
  reciben el diseño maestro aceptado: jerarquía central/lateral/canino, bordes
  incisales, contactos, arco, tono VITA y material. La pose, tejidos, luz y
  perspectiva proceden siempre de la fotografía objetivo.
- `visual-simulation.js` usa el contrato `visual-preview-v2-multiview` y envía
  una segunda imagen PNG del mismo tamaño como referencia, sin pegarla ni
  registrarla píxel a píxel. Estado y recuperación de avance conservan qué
  vista es maestra.
- `supabase/functions/claude/index.ts` reconoce
  `same-patient-master-v1` y da a GPT Image instrucciones específicas de
  transferencia multivista. No se cambiaron cuotas, autenticación, RLS,
  Storage ni secretos.
- Edge Function `claude` versión 77 desplegada y verificada `ACTIVE`, con
  `verify_jwt=false` preservado. Caché PWA
  `smyl-v98-multiview-dental-identity`; copias web/móvil sincronizadas.
- QA local: todas las suites existentes más
  `tests/multiview-dental-identity.test.mjs` pasan. No se ejecutó una
  generación de imagen ni se enviaron fotografías durante la verificación.

## 2026-09-20 — Publicación preparada: simulador rápido y localizador automático

- Se integró `simulacion-rapida.html` sobre la rama pública actual sin reemplazar la biblioteca dental, el editor vectorial ni la segmentación ya existentes.
- Frontal, perfiles, 3/4 y extraoral reutilizan Face Landmarker para calcular el recorte y la zona inicial desde la boca real; intraoral conserva el detector dental. Si MediaPipe no está disponible se usa el respaldo anterior y el ajuste manual permanece accesible.
- La PWA de paciente abre ahora el simulador rápido; el panel profesional conserva su propio manifiesto. Caché `smyl-v93-auto-smile-localizer`, `visual-composition.js` v5 y copias web/móvil sincronizadas.
- El simulador incluye selección VITA comprobable, alineación completa + carillas en una generación, comparación frontal/intraoral pareada y puente aislado hacia LANA. La publicación del frontend no despliega migraciones ni Edge Functions de Supabase.
- QA previo: contratos LANA, scripts, geometría facial simulada, composición visual, regresión de simulación y paridad web/móvil aprobados sin generar una imagen nueva.

## 2026-09-06 — Codex: Fase 2B, separación individual de seis dientes

**Tocado localmente:** `segmentacion-dental-poc.html`,
`segmentacion-dental-poc.js`, `segmentacion-dental-worker.js`,
`tests/segmentation-poc.test.mjs`, `docs/SMYL_SEGMENTATION_POC.md` y
`docs/HANDOFF.md`.

- El laboratorio dejó de tratar varios puntos positivos como una sola región.
  Ahora registra centros en orden FDI `13-12-11-21-22-23` y ejecuta seis
  decodificaciones independientes.
- En cada decodificación, el centro de la pieza activa es positivo y los otros
  cinco centros son exclusiones automáticas. Las exclusiones manuales quedan
  asociadas únicamente a la pieza seleccionada.
- La vista combina seis máscaras con colores distintos y el PNG exportado
  conserva la identidad de cada pieza. Una superposición mayor a 8% bloquea la
  descarga para evitar aceptar una arcada fusionada.
- La selección de máscara verifica además que incluya el centro propio y
  excluya los otros cinco centros; un incumplimiento invalida la exportación.
- Sigue siendo un laboratorio aislado y local: no se tocaron producción,
  backend, Supabase, prompts, copias móviles ni configuración nativa.
- Corrección UX: el selector de fotografías ya no queda bloqueado mientras se
  descarga SlimSAM. El archivo puede elegirse inmediatamente y el análisis
  espera al modelo en segundo plano.
- Corrección de caché: el Worker de segmentación lleva versión explícita para
  impedir que la Fase 2B se ejecute contra el Worker antiguo de la Fase 2A. La
  interfaz explica además los números FDI con nombres comunes.
- Refinamiento 2B: cada máscara incorpora exclusiones automáticas en los
  límites interproximales y por encima/debajo de la pieza. Si una máscara sigue
  invadiendo otro centro, la interfaz identifica y resalta en rojo su número.
- Se añadió `assets/references/smyl-segmentation-reference-v1.png`, fotografía
  hiperrealista generada de una adulta ficticia para pruebas controladas. La
  prueba reportada por el usuario obtuvo 53% de confianza, 4.6% de cobertura y
  fallos en 13, 11, 21 y 23, confirmando que SlimSAM no es apto como segmentador
  dental principal incluso con una captura favorable.
- El selector permite volver a elegir el mismo archivo, acepta JPG/PNG/WebP
  aunque Windows omita el MIME y muestra una explicación específica para HEIC.

## 2026-09-06 — Codex: Fase 2A, laboratorio local de segmentación

**Tocado localmente:** `segmentacion-dental-poc.html`,
`segmentacion-dental-poc.js`, `segmentacion-dental-worker.js`,
`tests/segmentation-poc.test.mjs`, `docs/SMYL_SEGMENTATION_POC.md` y
`docs/HANDOFF.md`.

- Se creó un laboratorio aislado para validar segmentación antes de conectarla
  al flujo público. La foto se redimensiona a un máximo de 1600 px y se procesa
  íntegramente en un Web Worker; no se envía a Supabase ni a un proveedor.
- La línea base usa `Xenova/slimsam-77-uniform`, modelo cuantizado compatible
  con la implementación oficial de Transformers.js. MobileSAM queda como
  segundo candidato a comparar con el mismo protocolo, no como integración
  asumida.
- El usuario puede añadir puntos positivos o negativos, ver confianza,
  cobertura y tiempo, limpiar la selección y descargar una máscara PNG binaria.
- El laboratorio incorpora una sonrisa geométrica sintética para validar el
  ciclo técnico completo sin usar ni inventar datos de pacientes.
- El modelo se descarga desde Hugging Face durante la primera carga y se guarda
  en la caché del navegador. No usa tokens ni claves.
- QA real en navegador completado con la sonrisa sintética: un solo punto aisló
  un incisivo sin invadir sus vecinos, con 2.0% de cobertura y 549 ms de
  decodificación de máscara. También se verificó la composición en escritorio,
  tablet (834 px) y móvil (390 px).
- El protocolo de diez fotografías y los criterios de avance están en
  `docs/SMYL_SEGMENTATION_POC.md`. No se tocaron producción, backend, prompts,
  Supabase, copias móviles ni configuración nativa.

## 2026-09-05 — Codex: Fase 1, editor vectorial de seis carillas

**Tocado localmente:** `simulacion.html`, `mobile/www/simulacion.html`,
`sw.js`, `tests/simulation-blueprint.test.mjs` y `docs/HANDOFF.md`.

- El editor profesional ya inicializa seis contornos individuales en orden FDI
  `13-12-11-21-22-23` desde la fotografía frontal. Cada corona conserva ocho
  controles semánticos normalizados: margen cervical, paredes proximales y
  borde incisal.
- Los puntos se seleccionan y arrastran directamente sobre la fotografía. Se
  puede restablecer una corona o las seis, y la edición queda guardada en el
  caso sin depender de la resolución de la imagen.
- `Aplicar diseño` dejó de enviar la anatomía a una nueva generación cuando
  existen contornos válidos. El plano profesional se materializa con
  `renderizarSimulacionBibliotecaV1`, se reinserta sobre la fotografía original
  y no consume cuota de IA. Si faltan seis contornos, el editor se bloquea en
  vez de volver silenciosamente a la ruta generativa.
- `trazarSiluetaPlanoDental` acepta ahora `vectorContour` y le da prioridad
  sobre el perfil detectado. `prepararPlanoDentalIndividual` integra esos seis
  límites exactos y marca el resultado como `vector-editor-v1`.
- Se añadió una demostración sintética sólo para QA con
  `?debugUI=1&vectorEditorDemo=1`. La verificación visual cubrió escritorio,
  tableta y móvil; también confirmó arrastre y restablecimiento del incisivo
  11. En 834 px el panel pasa a la parte inferior plegable para no reducir el
  lienzo.
- Caché PWA `smyl-v92`; web y móvil sincronizados. Las tres suites locales
  pasan. Esta fase no tocó backend, prompts, RLS, Storage ni configuración
  nativa, y todavía no se ha publicado.

## 2026-09-05 — Codex: hybrid-2d-v4 con geometría del paciente bloqueada

**Tocado localmente:** `simulacion.html`, `mobile/www/simulacion.html`,
`supabase/functions/claude/index.ts`, `sw.js`,
`tests/simulation-blueprint.test.mjs`, `tests/dental-library-photo.test.mjs`
y `docs/HANDOFF.md`.

- La validación pública de `91d5bf6` demostró que una guía registrada seguía
  siendo sólo una sugerencia para GPT Image: al recibir una región continua,
  el modelo podía ignorar los perfiles individuales y reconstruir una fila
  genérica de seis carillas.
- El nuevo contrato `hybrid-2d-v4` invierte el flujo. IMAGE 1 ya es la
  reconstrucción local de las seis coronas, calculada desde la anatomía de la
  paciente; IMAGE 2 es la fotografía original y sólo sirve como referencia de
  luz, grano y color. El proveedor deja de diseñar formas y actúa únicamente
  como terminador del material cerámico.
- La máscara alfa ya no es una cinta de sonrisa: contiene exactamente seis
  interiores de corona y bloquea encía, labios, dientes inferiores y cualquier
  píxel exterior. El compositor final vuelve a aplicar esas mismas seis
  regiones sobre la fotografía original.
- El backend exige `patient-geometry-lock-v1`, da nombres semánticos a ambas
  imágenes y añade una instrucción específica que prohíbe redibujar, clonar,
  ensanchar o regularizar las coronas. El control de presentación comprueba el
  contrato v4, seis regiones y `geometryLocked=true`.
- Calidad `v44`, caché PWA `smyl-v91`. Web y móvil están sincronizados; las
  tres suites locales pasan. La vista sintética de QA confirmó `PASS`, seis
  regiones, geometría bloqueada y cobertura objetivo completa sin usar fotos.
- **Publicado:** función `claude` y GitHub Pages actualizados con el contrato
  v4. Commit funcional `05371e5`; la URL pública se verificó sirviendo la
  etiqueta `build hybrid-2d-v4` y el contrato correspondiente.

## 2026-09-05 — Codex: compatibilidad del servicio con la guía anatómica

**Tocado localmente:** `simulacion.html`, `mobile/www/simulacion.html`,
`supabase/functions/claude/index.ts`, `sw.js`,
`tests/simulation-blueprint.test.mjs`, `tests/dental-library-photo.test.mjs`
y `docs/HANDOFF.md`.

- El intento público con soporte `d73ca2d-0b2e-4793-a3ae-e1182f2ef4e0`
  terminó antes de llamar a GPT Image: la función desplegada de `claude`
  aceptaba `hybrid-2d-v3` únicamente cuando `guideLibraryVersion` era
  `natural-a1-v1`, mientras el cliente nuevo enviaba
  `patient-anatomy-warp-v2`. La validación ocurre antes de consumir el límite,
  por lo que este rechazo no debe contar como generación.
- El servicio local reconoce ahora ambas variantes para conservar
  compatibilidad. La nueva rama `isPatientAnatomyGuide` usa una instrucción
  específica donde IMAGE 1 conserva la anatomía primaria e IMAGE 2 describe
  las seis coronas propias de la paciente, no una arcada de biblioteca.
- Para evitar que la guía nueva duplique todo el peso de la fotografía,
  `renderizarGuiaAnatomicaPacienteV2` mantiene las mismas dimensiones y el
  registro píxel a píxel, pero deja transparente todo lo que está fuera de las
  seis coronas. No vuelve a usar sprites ni recortes maestros.
- El clasificador muestra una actualización incompleta cuando cliente y servicio
  no comparten versión, en vez del mensaje genérico. Calidad `v43`, caché PWA
  `smyl-v90`; web y móvil sincronizados y pruebas locales aprobadas.
- **Pendiente de despliegue:** la función `claude` todavía no se desplegó. El
  proyecto no tiene `supabase/config.toml` y el flujo prospecto depende de la
  verificación interna de `requireUser`; desplegar con `--no-verify-jwt` requiere
  autorización explícita para conservar la configuración pública actual.

## 2026-09-05 — Codex: guía registrada desde la anatomía del paciente

**Tocado localmente:** `simulacion.html`, `mobile/www/simulacion.html`,
`sw.js`, `tests/simulation-blueprint.test.mjs`,
`tests/dental-library-photo.test.mjs` y `docs/HANDOFF.md`.

- La validación pública de `515041e` confirmó el defecto descrito por Ricardo:
  la textura parecía real, pero la biblioteca se estaba escalando y rotando
  dentro de seis siluetas, por lo que el conjunto podía leerse como fotografías
  recortadas y pegadas sobre la dentadura.
- La generación ya no recibe la biblioteca fotográfica posicionada como
  anatomía primaria. `renderizarGuiaAnatomicaPacienteV2` construye IMAGE 2 desde
  las seis coronas originales de la paciente, conserva el registro píxel a
  píxel de la fotografía y anticipa sobre ese volumen el material VITA elegido.
  La biblioteca queda disponible como referencia/laboratorio, pero no impone
  forma, tamaño ni perspectiva en el flujo público.
- El contrato del generador declara ahora IMAGE 1 como fuente anatómica primaria
  y obliga a seguir por pieza el margen cervical, límites proximales, eje,
  convexidad y trayectoria incisal. Se eliminó la instrucción que convertía las
  coronas maestras en referencia anatómica principal.
- El localizador `local-contours-v7` eleva el perfil transversal de 9 a 17
  secciones por diente para describir con mayor continuidad la emergencia
  cervical, el cuerpo proximal y el borde incisal. La ruta sigue haciendo una
  sola solicitud de imagen y conserva el respaldo sin dependencias nuevas.
- Calidad `v42`, caché PWA `smyl-v89`; web y móvil sincronizados. Pruebas de
  biblioteca, scripts inline y contrato híbrido aprobadas. La carga local de
  escritorio mostró la etiqueta nueva sin errores visibles; no se inició sesión,
  no se ejecutó una generación y no se usaron fotografías durante QA.

## 2026-09-05 — Codex: guía 2D conservadora y armonización fotográfica

**Tocado localmente:** `simulacion.html`, `mobile/www/simulacion.html`,
`sw.js`, `tests/simulation-blueprint.test.mjs`,
`tests/dental-library-photo.test.mjs` y `docs/HANDOFF.md`.

- La evidencia comparativa mostró por primera vez seis coronas completas y
  aproximadamente alineadas, pero con volumen excesivo, fila rígida, valor
  blanco uniforme y poca separación interproximal. Se conservó esa ruta como
  base en vez de sustituir nuevamente el motor.
- Hybrid-2d-v3 usa ahora `local-contours-v6` como localizador estándar en el
  navegador. La segmentación generativa deja de ejecutarse antes del render
  principal: una propuesta nueva hace una sola solicitud de imagen pagada.
- El plano reduce el crecimiento máximo, aumenta la jerarquía central/lateral,
  abre contactos de forma limitada y refuerza una curva incisal suave. La guía
  fotográfica recorta cada corona maestra con su contorno detectado, añade una
  rotación posterior mínima y sombras cortas en los cinco contactos.
- Después del render, `photo-harmonizer-v2` actúa únicamente dentro de las seis
  máscaras objetivo: comprime blancos recortados, recupera 20 % de la variación
  luminosa fuente, conserva la emergencia cervical y añade sombra de convexidad
  proximal. El exterior continúa procediendo exactamente de la foto original.
- No se modificaron prompts, Edge Functions, Supabase ni secretos. Calidad
  `v41`, caché PWA `smyl-v88`; pruebas de scripts, biblioteca y contrato
  aprobadas. La carga local de escritorio fue correcta; no se ejecutó ninguna
  generación ni se usaron fotografías durante QA.

## 2026-09-05 — Codex: reintento seguro ante saturación de GPT Image 2

**Tocado localmente:** `supabase/functions/claude/index.ts`,
`simulacion.html`, `mobile/www/simulacion.html`, `sw.js`,
`tests/simulation-blueprint.test.mjs`, `tests/dental-library-photo.test.mjs`
y `docs/HANDOFF.md`.

- El intento nuevo de hybrid-2d-v3 con soporte
  `db8234c9-c06d-45f4-9e68-c4ac9d8714e1` avanzó más allá del localizador
  dental, pero terminó con HTTP 429 antes de recibir una imagen.
- La Edge Function permite ahora un solo reintento interno cuando OpenAI
  responde 429 transitorio. Respeta `Retry-After` con espera limitada y usa el
  mismo `requestId`; el control del plan se ejecuta una sola vez para toda la
  acción. No se reintentan errores de saldo, facturación o cuota insuficiente.
- No se reintentan cortes de red ni respuestas ambiguas, porque en esos casos
  el proveedor podría haber comenzado una generación. La excepción se limita
  al rechazo HTTP 429 explícito previo al stream.
- La interfaz distingue ahora la saturación del proveedor del límite temporal
  antiabuso por conexión, para que el siguiente código de soporte no vuelva a
  ocultar dos causas distintas bajo el mismo mensaje.
- Caché PWA `smyl-v87`. No se ejecutaron generaciones ni se enviaron fotos
  durante esta corrección.

## 2026-09-04 — Codex: respaldo automático para la localización de seis dientes

**Tocado localmente:** `simulacion.html`, `mobile/www/simulacion.html`,
`sw.js`, `tests/simulation-blueprint.test.mjs`,
`tests/dental-library-photo.test.mjs` y `docs/HANDOFF.md`.

- El intento público con soporte `08112e66-3064-4b18-b5e1-c878c70fccde`
  terminó antes de guardar una imagen generada: el botón ofreció una nueva
  propuesta, no revalidar la anterior. Esto acotó el fallo a la localización
  previa de los seis dientes o a la entrega del servicio, no a la biblioteca
  fotográfica ni al control visual posterior.
- La segmentación remota deja de ser un punto único de fallo. Si no responde,
  entrega una respuesta incompleta o no confirma seis piezas, el flujo usa
  `local-contours-v5` para calcular automáticamente seis anclajes y continúa
  con GPT Image 2 y la biblioteca `natural-a1-v1`. El localizador no pinta
  dientes ni sustituye el render fotográfico.
- El respaldo conserva los controles duros: calidad de captura, seis coronas,
  región continua, protección de la arcada inferior e igualdad exacta de todos
  los píxeles exteriores. Su uso queda registrado como revisión de alineación.
- El mismo `requestId` pasa ahora por `segment-teeth` y la generación para que
  el código de soporte sea rastreable. Las respuestas vacías o truncadas se
  leen con el lector robusto compartido y el mensaje de segmentación ya no se
  oculta bajo un error genérico.
- Calidad `v40`, caché PWA `smyl-v86`; web y móvil sincronizados. No se ejecutó
  una generación ni se enviaron fotografías durante la corrección.

## 2026-09-04 — Codex: hybrid-2d-v3 con biblioteca fotográfica Natural A1

**Tocado localmente:** `biblioteca-carillas.html`,
`assets/dental-library/natural-a1-v1/*`, `simulacion.html`,
`mobile/www/simulacion.html`, `dental_library.html`, `sw.js`,
`tests/dental-library-photo.test.mjs`, `docs/SMYL_PHOTO_LIBRARY_POC.md` y
`docs/HANDOFF.md`.

- Se añadió un laboratorio independiente y reversible con coronas maestras
  fotográficas para central, lateral y canino. Las tres piezas se reflejan y
  componen como 13–12–11–21–22–23 sobre el rostro guía o una fotografía que
  permanece local en el navegador.
- El usuario puede arrastrar la arcada, ajustar ancho, altura, curva,
  separación, integración y temperatura, alternar original/biblioteca y
  descargar el PNG resultante.
- La carga local quedó como primer paso visible mediante el CTA “Subir mi
  foto”; acepta imágenes del dispositivo y conserva el ejemplo como opción
  secundaria.
- Los PNG finales usan fondo uniforme `#05070A`; el laboratorio genera alfa y
  recorte en memoria. El primer intento de transparencia generado por la
  herramienta llegó sin canal alfa y no se integró al producto.
- `simulacion.html` enlaza el laboratorio desde “Forma general”. La biblioteca
  se activa en el motor público v3 sin modificar cuotas.
- El flujo automático ya compone una guía PNG transparente con las seis piezas
  fotográficas sobre las envolventes detectadas y la envía como IMAGE 2. La
  foto del paciente sigue siendo IMAGE 1 y la máscara alfa sólo se aplica a
  ella. Contrato nuevo `hybrid-2d-v3`; el backend conserva compatibilidad con
  `hybrid-2d-v2`.
- Se actualizó el prompt del cliente y `supabase/functions/claude/index.ts`
  para transferir anatomía/material desde `natural-a1-v1`, rechazar contratos
  v3 sin esa biblioteca y registrar el modo de guía fotográfica.
- Edge Function `claude` versión 68 desplegada y verificada `ACTIVE`; conservó
  `verify_jwt=false`. Frontend autorizado para publicarse desde la rama de
  GitHub Pages. El despliegue no ejecutó una simulación, no subió fotografías
  y no consumió una generación.
- Caché PWA `smyl-v85`. En GitHub Pages la web carga la copia del repositorio
  desde `raw.githubusercontent.com`, que responde con CORS `*`; la app móvil y
  otros hosts usan `assets` desde su raíz. Los nombres `*-v3.png` evitan el
  caché negativo de rutas descartadas y el mismo HTML funciona en ambos medios.
  Sintaxis, prueba de integración, regresión v3 y QA visual aprobados en
  escritorio y 390×844, sin errores de consola.

## 2026-09-04 — Codex: hybrid-2d-v2.3, mostrar primero y revisar después

**Tocado localmente:** `simulacion.html`, `mobile/www/simulacion.html`,
`sw.js`, `tests/simulation-blueprint.test.mjs`,
`docs/SMYL_HYBRID_2D_V2_ACCEPTANCE.md` y `docs/HANDOFF.md`.

- La propuesta guardada superó los falsos positivos cromático e interproximal,
  pero se perdió al recargar entre versiones porque la imagen temporal excedió
  el almacenamiento ligero del navegador. El sistema terminó ofreciendo una
  generación nueva sin que el usuario pudiera ver la anterior.
- v2.3 separa seguridad determinista de calidad visual. Contrato, proveedor,
  región conectada, cobertura e igualdad exacta fuera de máscara siguen siendo
  barreras duras. Naturalidad, placa aparente, separación, textura, magnitud de
  cambio y parches pasan al reporte visible de revisión clínica.
- Una generación pagada que ya cruzó la protección determinista llega siempre
  al comparador. Calidad `v38`, caché PWA `smyl-v79`; backend sin cambios.
  Pruebas de scripts, contrato y máscaras aprobadas; web y móvil idénticos.
  Publicado en GitHub Pages; no se ejecutó otra generación.

## 2026-09-03 — Codex: hybrid-2d-v2.2, contactos naturales sin falso rechazo

**Tocado localmente:** `simulacion.html`, `mobile/www/simulacion.html`,
`sw.js`, `tests/simulation-blueprint.test.mjs`,
`docs/SMYL_HYBRID_2D_V2_ACCEPTANCE.md` y `docs/HANDOFF.md`.

- Al revalidar la primera propuesta, v2.1 superó el control cromático pero
  exigió cinco líneas interdentales oscuras exactas y la ocultó como “anatomía
  no presentable”. Los contactos naturales claros o cerrados no cumplen esa
  suposición aunque las seis regiones dentales estén presentes.
- v2.2 sólo confirma fusión cuando coinciden las señales de placa plana,
  uniformidad y pérdida estructural. Menos de cuatro separadores visibles se
  registra como revisión interproximal; ya no bloquea por sí solo.
- Calidad `v37`, caché PWA `smyl-v78`. La propuesta pagada permanece
  revalidable sin otra generación. Pruebas aprobadas y publicación realizada
  en GitHub Pages; el backend `claude` permanece sin cambios en versión 67.

## 2026-09-02 — Codex: hybrid-2d-v2.1, estructura dura y cromática revisable

**Tocado localmente:** `simulacion.html`, `mobile/www/simulacion.html`,
`sw.js`, `tests/simulation-blueprint.test.mjs`,
`docs/SMYL_HYBRID_2D_V2_ACCEPTANCE.md` y `docs/HANDOFF.md`.

- La primera generación pública de v2 llegó correctamente, pero el control
  agrupó color rojizo, sombras y placa fusionada bajo el mismo bloqueo de
  “bordes artificiales”. La propuesta pagada quedó guardada para revalidación.
- v2.1 mantiene como barreras duras la placa plana/fusionada, dientes no
  separados, parches incompletos, cobertura, región continua e integridad de
  píxeles. Posibles bordes cromáticos y sombras pasan a revisión clínica.
- Calidad `v36`, caché PWA `smyl-v77`. Pruebas de scripts, contrato y máscaras
  aprobadas; web y móvil quedaron idénticos. El botón `Revalidar resultado`
  puede recuperar la propuesta guardada sin volver a llamar al generador
  cuando no exista un defecto estructural.
- Publicado en GitHub Pages desde la rama configurada; el backend no cambió y
  permaneció en `claude` versión 67. La publicación no subió fotografías ni
  consumió una generación.

## 2026-09-02 — Codex: hybrid-2d-v2, región continua y bloqueo de parches

**Tocado localmente:** `simulacion.html`, `mobile/www/simulacion.html`,
`sw.js`, `supabase/functions/claude/index.ts`,
`tests/simulation-blueprint.test.mjs`,
`docs/SMYL_HYBRID_2D_V2_ACCEPTANCE.md` y `docs/HANDOFF.md`.

- La evidencia pública de v1 mostró fragmentos blancos sobre esmalte original:
  la máscara de seis coronas separadas volvía a recortar el render y el control
  visual trataba los defectos como revisión en lugar de bloquearlos.
- v2 crea una sola cinta suave alrededor de las seis coronas fuente/objetivo.
  Esa región se usa tanto para la edición GPT Image 2 como para la composición;
  las siluetas 13–23 quedan sólo como control geométrico y evidencia de calidad.
- El contrato bloquea carillas con menos de 42 % de cambio, cambios ausentes en
  cualquiera de los tercios cervical/medio/incisal, placa plana, artefactos o
  menos de seis coronas visualmente independientes.
- Fuera de la región continua se conserva la restauración exacta de píxeles.
  Calidad `v35`, caché PWA `smyl-v76`, contrato `hybrid-2d-v2`.
- Pruebas de scripts, contrato y máscaras aprobadas. La vista sintética confirmó
  una trayectoria conectada y cobertura completa, sin fotografías ni llamadas
  a servicios.
- Edge Function `claude` versión 67 desplegada y verificada `ACTIVE`; conservó
  `verify_jwt=false` con autorización explícita del usuario. El frontend v2 se
  publica en GitHub Pages desde la rama configurada
  `claude/camila-claude-clinical-analysis-sywxjv`; `main` permanece intacta.
- La publicación no ejecutó una simulación, no subió fotografías y no consumió
  una generación. Queda pendiente validar el resultado con una fotografía
  expresamente autorizada.

## 2026-09-02 — Codex: hybrid-2d-v1, geometría invisible y render fotográfico

**Tocado localmente:** `simulacion.html`, `mobile/www/simulacion.html`,
`sw.js`, `supabase/functions/claude/index.ts`,
`tests/simulation-blueprint.test.mjs`,
`docs/SMYL_HYBRID_2D_V1_ACCEPTANCE.md` y `docs/HANDOFF.md`.

- Se desactiva como salida principal el compositor Canvas `design-v1.5`, que
  producía superficies con apariencia de capa pegada. Su código queda sólo
  como rollback local; la bandera activa es `SMYL_HYBRID_2D_ENABLED`.
- La ruta nueva vuelve a segmentar seis coronas superiores reales y construye
  una máscara alfa exclusivamente coronal. Genera además un plano morfológico
  2D del mismo tamaño con seis siluetas 13–23; ese plano es control invisible,
  no una capa visual ni el resultado final.
- El contrato `hybrid-2d-v1` exige GPT Image 2, foto PNG, máscara PNG y plano
  PNG antes de aceptar la generación. La Edge Function envía foto y plano como
  dos entradas, aplica la máscara a la foto y prohíbe reproducir fondos,
  rellenos, contornos o marcas del plano.
- Después de generar, el navegador reutiliza la máscara validada antes del
  pago y recompone desde la fotografía original. Cualquier diferencia fuera
  de las seis coronas sigue bloqueándose de forma determinista.
- Calidad `v34`, caché PWA `smyl-v75`. Pruebas locales de scripts, contrato y
  máscaras aprobadas. QA responsivo aprobado en 390×844, 834×1194 y 1440×900,
  sin desbordamiento horizontal ni errores de consola.
- Edge Function `claude` versión 66 desplegada y verificada `ACTIVE`; conservó
  `verify_jwt=false` por autorización explícita del usuario. El frontend híbrido
  se publicó en GitHub Pages desde su rama configurada
  `claude/camila-claude-clinical-analysis-sywxjv`; `main` quedó intacta.
- La publicación y su verificación no ejecutaron una simulación, no subieron
  fotografías y no consumieron una generación. Sigue pendiente una validación
  controlada con una fotografía expresamente autorizada.

## 2026-09-02 — Codex: design-v1.5, carillas ancladas a la anatomía fotográfica

**Tocado localmente:** `simulacion.html`, `mobile/www/simulacion.html`,
`sw.js`, `tests/simulation-blueprint.test.mjs`,
`tests/design-engine-v1-demo.html`,
`docs/SMYL_DESIGN_ENGINE_V1_ACCEPTANCE.md` y `docs/HANDOFF.md`.

- La captura real de v1.4 mostró que la estratificación óptica mejoró, pero las
  seis cajas todavía se redistribuían sobre una retícula ideal y producían
  dientes grandes, uniformes y separados de su anatomía fuente.
- `local-contours-v5` toma nueve perfiles transversales por diente y los
  convierte en curvas suaves. La clasificación cromática sólo calcula esos
  perfiles: sus píxeles nunca se pintan ni llegan al resultado.
- El objetivo conserva 88 % de la posición fotográfica y limita a 12 % la
  armonización bilateral; ancho, longitud y centro sólo cambian dentro de
  márgenes conservadores. Contactos, perspectiva y margen cervical tienen
  prioridad sobre una proporción matemática rígida.
- El compositor mezcla más sustrato, conserva aproximadamente el doble de
  microcontraste fuente y reduce la opacidad del material. Sigue aplicando
  dentina, esmalte, mamelones, opalescencia, halo y microtextura en una sola
  capa por pieza.
- Build `design-v1.5`, calidad `v33`, caché PWA `smyl-v74`.
- Pruebas automáticas y QA sintético aprobados en escritorio, tableta 834×1194
  y móvil 390×844, sin fotografías de pacientes. Publicado en GitHub Pages;
  pendiente de una validación controlada con imagen expresamente autorizada.
- No se modificó backend, prompts de IA ni configuración nativa.

## 2026-09-02 — Codex: design-v1.4, compositor cerámico de una capa

**Tocado localmente:** `simulacion.html`, `mobile/www/simulacion.html`,
`sw.js`, `tests/simulation-blueprint.test.mjs`,
`tests/design-engine-v1-demo.html`,
`docs/SMYL_DESIGN_ENGINE_V1_ACCEPTANCE.md` y `docs/HANDOFF.md`.

- Design-v1.3 fue revertido en el commit `e48e581` porque una máscara cromática
  se pintaba debajo de las coronas y producía bordes serrados, duplicados y
  fragmentos blancos. La reversión segura se publicó antes de esta reconstrucción.
- Design-v1.4 vuelve a una única silueta Bézier continua por pieza. El análisis
  cromático sólo genera hitos estadísticos suaves de posición y tamaño mediante
  `local-landmarks-v4`; ningún píxel de esa clasificación se pinta directamente.
- El destino cubre conservadoramente la caja fuente para evitar halos del
  esmalte antiguo sin añadir una segunda capa.
- `resolverEstratificacionCarillaV4` modela dentina cervical, cuerpo de esmalte,
  mamelones, opalescencia, halo incisal, microtextura/periquimatos y reflejo
  especular. La opacidad disminuye hacia incisal y mezcla una porción controlada
  del sustrato fotográfico.
- La luminancia ambiental queda limitada a ±2.5 %, evitando caninos grises por
  la sombra de la boca. Cada pieza conserva variaciones ópticas pequeñas para
  evitar una fila clonada.
- Build `design-v1.4`, calidad `v32`, caché PWA `smyl-v73`.
- QA sólo con retrato sintético: pruebas inline/contrato/máscara aprobadas y
  revisión visual de las tres familias. No se añadió ninguna foto de paciente.
- No se modificó backend, prompts de IA ni configuración nativa.

## 2026-09-01 — Codex: design-v1.2, anatomía y esmalte natural

**Tocado localmente:** `simulacion.html`, `mobile/www/simulacion.html`,
`sw.js`, `tests/simulation-blueprint.test.mjs`,
`tests/design-engine-v1-demo.html`,
`docs/SMYL_DESIGN_ENGINE_V1_ACCEPTANCE.md` y `docs/HANDOFF.md`.

- La captura de producción mostró que design-v1.1 ya generaba seis coronas,
  pero todavía parecían pegatinas: opacidad excesiva, dientes repetidos y
  caninos con una cúspide geométrica demasiado marcada.
- Design-v1.2 conserva por pieza la luminancia, el contraste y la dirección
  de reflejo de la foto fuente; combina esa firma con calidez cervical,
  microtextura, surcos suaves y translucidez incisal.
- La opacidad equilibrada baja de `.96` a `.84`; el borde incisal reduce aún
  más su opacidad para dejar profundidad del sustrato en lugar de blanco plano.
- Las proporciones quedan dentro de la referencia del proyecto: centrales
  75–80 % ancho/alto, laterales 72 % y caninos 76 % del ancho central. La
  cúspide canina ahora es baja, redondeada y ligeramente mesial.
- Localizador `local-band-v2`, calidad `v30`, caché PWA `smyl-v71`.
- QA sin fotografías de paciente: pruebas inline/contrato/máscara aprobadas y
  demo sintética revisada en escritorio, tableta 834×1194 y móvil 390×844.
- No se modificó backend, prompts de IA ni configuración nativa.

## 2026-09-01 — Codex: hotfix design-v1.1, motor local sin bloqueo de plan

**Tocado localmente:** `simulacion.html`, `mobile/www/simulacion.html`,
`sw.js`, `tests/simulation-blueprint.test.mjs`,
`tests/design-engine-v1-demo.html` y
`docs/SMYL_DESIGN_ENGINE_V1_ACCEPTANCE.md`.

- La captura con soporte `7f0f2e80-0d03-43fa-b6ab-ab23041d26da` confirmó
  que design-v1 todavía llamaba a `segment-teeth`. Esa función usa GPT Image
  y valida el cupo del plan, por lo que el render local nunca comenzaba cuando
  la clínica había agotado sus simulaciones.
- Design-v1.1 ya no consulta el límite mensual, no renueva autorización de IA,
  no incrementa usos y no llama al segmentador remoto.
- `local-band-v1` detecta en el navegador la banda de esmalte del recorte y la
  transforma en seis cajas 13–12–11–21–22–23. La biblioteca paramétrica sigue
  siendo la única fuente de la anatomía final.
- Build `design-v1.1`, calidad `v29`, caché PWA `smyl-v70`.
- QA sintético: scripts inline, contrato del motor, 12 pruebas de máscara y
  revisión visual de las tres familias en escritorio y 390×844.
- No se modificó ni desplegó backend. La fotografía de la captura no se leyó,
  subió ni incorporó a pruebas.

## 2026-09-01 — Codex: Design Engine v1 local, seis coronas completas

**Tocado localmente:** `simulacion.html`, `mobile/www/simulacion.html`,
`sw.js`, `tests/simulation-blueprint.test.mjs`,
`tests/design-engine-v1-demo.html` y
`docs/SMYL_DESIGN_ENGINE_V1_ACCEPTANCE.md`.

- La ruta principal ya no pide a un generador fotográfico que invente la
  anatomía dentro de una máscara segmentada. La segmentación sólo localiza los
  seis anteriores; una biblioteca paramétrica construye 13–12–11–21–22–23.
- Cada corona se rasteriza como una silueta completa, con suavizado hacia
  dentro. Fuera de esas seis siluetas la salida parte del píxel original, por
  lo que no puede aparecer la franja rectangular observada en v103–v105.
- El material cerámico conserva iluminación y microtextura de la toma, añade
  profundidad cervical/incisal y reproduce el tono VITA elegido sin llamar al
  proveedor de generación de imágenes.
- El editor alimenta el motor determinista: familia circular, triangular o
  rectangular, tamaño global y alturas individuales 13–23. Cada actualización
  se recompone desde la fotografía clínica original; no acumula renders.
- Build `design-v1`, calidad `v28`, caché PWA `smyl-v69`. Web y móvil son
  idénticos.
- QA sin datos de paciente ni generación pagada: scripts inline, contrato de
  motor, 12 pruebas de máscara y regresión visual sintética aprobados en
  escritorio y 390×844.
- Publicado en GitHub Pages desde el commit funcional `b282e2d`; verificación
  pública `HTTP 200`, build `design-v1` y motor local habilitado.
- **La publicación no ejecutó una simulación, no subió fotografías y no
  consumió una generación de imagen.** El siguiente gate es una prueba
  controlada con una fotografía expresamente autorizada.

## 2026-08-31 — Codex: v105 local, la propuesta pagada siempre se muestra

**Tocado localmente:** `simulacion.html`, `mobile/www/simulacion.html`,
`sw.js`, `supabase/functions/claude/index.ts`,
`tests/simulation-blueprint.test.mjs` y
`docs/SIMULATION_V105_ACCEPTANCE.md`.

- La captura posterior a v104 confirmó que el generador y la máscara sí
  terminaron, pero el detector local volvió a ocultar la propuesta por una
  inferencia de bordes artificiales.
- v105 conserva como barreras duras únicamente el contrato, el proveedor, las
  seis coronas, la cobertura de máscara y la igualdad exacta fuera de máscara.
- Bordes rojizos u oscuros, placa aparente, separación, textura, tono,
  simetría y magnitud de cambio son hallazgos de revisión y ya no bloquean el
  comparador.
- El detector de posibles marcas cromáticas tampoco descarta: adjunta una
  advertencia visible al reporte de revisión.
- Una propuesta conservada por v104 puede revalidarse localmente con v105 sin
  pedir otra imagen a GPT.
- Build `v105`, calidad `v27`, caché PWA `smyl-v68`.
- QA aprobado sin IA: scripts inline, regresión v105, 12 pruebas de máscara,
  sintaxis TypeScript y revisión responsive a 390×844, 834×1194 y 1440×900.
- Edge Function `claude` versión 65 desplegada y verificada `ACTIVE`, con
  `verify_jwt=false` preservado. El frontend v105 quedó autorizado para
  GitHub Pages.
- **La publicación no ejecutó la simulación ni consumió otra generación.**

## 2026-08-31 — Codex: v104 local, una máscara y propuestas recuperables

**Tocado localmente:** `simulacion.html`, `mobile/www/simulacion.html`,
`sw.js`, `supabase/functions/claude/index.ts`,
`tests/simulation-blueprint.test.mjs` y
`docs/SIMULATION_V104_ACCEPTANCE.md`.

- Los soportes `local-mthf2shh` y
  `51749c65-cc22-44d7-a697-2069054ce10b` separaron dos fallos: un bloqueo
  previo sin trazabilidad y un falso positivo posterior por bordes rojizos.
- Se eliminó la segunda segmentación genérica de tratamiento. La máscara se
  deriva exclusivamente de las seis coronas fuente y sus objetivos.
- Los objetivos conservan el margen cervical y sólo pueden crecer hacia
  incisal un máximo conservador de 12 %.
- El detector ya no interpreta la zona cervical gingival como línea técnica;
  exige continuidad y afectación bilateral. Las dudas estéticas pasan a
  revisión recomendada.
- Una propuesta recibida ya no se elimina por fallar un control local. Se
  conserva para `Revalidar resultado` sin otra llamada pagada y se intenta
  incluir en el avance guardado cuando existe espacio en el navegador.
- Cada error conserva identificador y etapa desde el inicio.
- Build `v104`, calidad `v26`, caché PWA `smyl-v67`.
- QA aprobado sin IA: scripts inline, contrato v104, 12 pruebas de máscara,
  sintaxis TypeScript y revisión responsive a 390×844, 834×1194 y 1440×900.
- Edge Function `claude` versión 64 desplegada y verificada `ACTIVE`, con
  `verify_jwt=false` preservado. El frontend v104 quedó autorizado para
  GitHub Pages.
- **La publicación no ejecutó la simulación ni consumió otra generación.**

## 2026-08-31 — Codex: v103, seis máscaras coronales sin franja gingival

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`, `sw.js`,
`supabase/functions/claude/index.ts`, `tests/simulation-blueprint.test.mjs` y
`docs/SIMULATION_V103_ACCEPTANCE.md`.

- La captura posterior a v102 confirmó un parche rectangular sobre labio y
  encía. La causa era determinista: seis bandas cervicales rectangulares se
  unían en una sola franja horizontal editable.
- v103 elimina por completo esa franja. La máscara es sólo la unión de seis
  coronas fuente/destino; encía, labios, piel y el resto de la fotografía
  permanecen fuera de edición.
- El borde se suaviza hacia dentro, sin abrir nuevos píxeles sobre tejido.
- Un control previo bloquea si la máscara sale más de 0.3 % de las seis
  envolventes coronales.
- El control visual inspecciona el perímetro de cada corona para rechazar
  contornos rojizos u oscuros y marcas técnicas.
- Build `v103`, calidad `v25`, caché PWA `smyl-v66`. Web y móvil son idénticos.
- QA aprobado: scripts inline, contrato v103, 12 pruebas de máscara, sintaxis
  TypeScript y revisión a 1440×900, 834×1194 y 390×844.
- Publicado en GitHub Pages desde el commit funcional `0d6d86c`; backend
  Supabase `claude` activo en la versión 63. La comprobación pública devolvió
  `build v103 — seis máscaras coronales` y el contrato de máscara v103.
- La publicación y la verificación no consumieron una generación de imagen.

## 2026-08-31 — Codex: v102 con seis destinos numéricos

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`, `sw.js`,
`supabase/functions/claude/index.ts`, `tests/simulation-blueprint.test.mjs` y
`docs/SIMULATION_V102_ACCEPTANCE.md`.

- La fotografía del paciente es la única referencia visual; se eliminó la
  contradicción que pedía una segunda imagen que el contrato no enviaba.
- El tratamiento queda limitado a 13–12–11–21–22–23 y a su encía inmediata.
  El diseño se transmite como seis envolventes numéricas independientes.
- GPT Image 2 recibe una máscara alfa PNG. Fuera de ella se restaura la foto
  original por píxel; premolares, arcada inferior, labios y rostro se excluyen.
- El backend exige GPT Image 2, imagen PNG y máscara PNG antes de consumir
  cuota; no existe fallback silencioso para v102.
- Build `v102`, calidad `v24`, caché PWA `smyl-v65`. Web y móvil son idénticos.
- QA local aprobado: scripts inline, contrato v102, 12 pruebas de máscara,
  sintaxis TypeScript y revisión a 1440×900, 834×1194 y 390×844.


## 2026-08-27 — Codex: una sola máscara previa y preservación por píxel

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`, `sw.js` y
`tests/simulation-blueprint.test.mjs`.

- El soporte `8a964724-d71e-4189-a4fb-eb3093cf01cd` confirmó otro falso rechazo
  posterior a una generación ya pagada: la segunda segmentación del render no
  pudo volver a confirmar la misma zona dental.
- El compositor ya no llama `segmentarParDental()` sobre la imagen generada.
  Reutiliza la máscara de tratamiento y el mapa dental 13–23 que fueron
  validados antes de generar, por lo que revalidar no repite una inferencia
  variable ni vuelve a depender del conteo de piezas del render.
- La seguridad final ahora es determinista: el render se recorta dentro de la
  máscara previa y se comparan todos los píxeles exteriores contra la fotografía
  original. Cualquier diferencia exterior bloquea el resultado; anatomía, tono
  y cobertura siguen visibles como revisión clínica.
- Las cachés de máscara y plano ahora incluyen una firma de la fotografía. Dos
  pacientes o capturas con las mismas dimensiones ya no pueden reutilizar por
  accidente una máscara anterior sólo por compartir ancho y alto.
- Build `v99`, calidad `v21`, caché PWA `smyl-v60`. Publicación a `main` y
  GitHub Pages autorizada por el usuario.

## 2026-08-27 — Codex: entrega segura con hallazgos en revisión clínica

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`, `sw.js` y
`tests/simulation-blueprint.test.mjs`.

- Se separaron los bloqueos anatómicos deterministas de los controles visuales
  variables. La app sólo detiene la entrega cuando la máscara no puede asegurar
  que el cambio permanezca en dientes superiores y encía directamente asociada.
- Los hallazgos de geometría, tono, textura, proporción o cambio insuficiente se
  consolidan sin duplicados y aparecen en `Resultado recomendado para revisión`;
  ya no convierten una propuesta protegida en el error genérico posterior al
  pago.
- Las marcas técnicas siguen siendo un rechazo real de presentabilidad y ahora
  eliminan la imagen temporal para que el botón solicite una propuesta nueva.
  También se añadieron mensajes específicos para compatibilidad con errores
  visuales e integración de versiones anteriores.
- QA local: dos scripts inline válidos, flujo de entrega segura/revisión clínica
  aprobado y 12 verificaciones de máscaras superadas; copias web/móvil
  idénticas. Build `v98`, calidad `v20`, caché PWA `smyl-v59`. **No se publicó
  ni desplegó.**

## 2026-08-27 — Codex: consolidación de fragmentos y revalidación sin nueva generación

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`, `sw.js` y
`tests/simulation-blueprint.test.mjs`.

- El soporte `468c3035-f084-4a1f-a181-e6885581107a` confirmó que OpenAI sí
  entregó la imagen y que el fallo ocurrió después: la segmentación lado a lado
  devolvió 46 componentes y la protección anatómica local rechazó la máscara.
- Los componentes ahora se agrupan por `fdi/parentFdi`, se separa la arcada
  superior por geometría y se elige una sola secuencia canónica de seis piezas
  13–23. Sólo las máscaras que pertenecen a esas seis piezas entran al
  compositor; los fragmentos no se cuentan como dientes independientes.
- El corredor final queda limitado a esas seis piezas y su encía directamente
  asociada. Tiene límites superiores, laterales e inferiores explícitos; fuera
  de ellos siempre se restaura la fotografía original.
- Cuando una generación pagada falla únicamente en el control local, la imagen
  cruda queda en memoria durante esa pantalla. El primer botón vuelve a ejecutar
  segmentación y validación sin llamar otra vez a generación; si también falla,
  se elimina y recién entonces se ofrece crear otra propuesta.
- Los errores de protección anatómica muestran ahora la causa concreta en lugar
  del genérico. Build `v95`, calidad `v17`, caché PWA `smyl-v56`.
- QA local: scripts inline válidos, 12 pruebas de máscara y caso sintético de 46
  fragmentos consolidados a 13–23 superados; copias web/móvil idénticas. **No se
  publicó ni desplegó.**

## 2026-08-26 — Codex: plano geométrico individual 13–23 y rechazo de simulaciones inertes

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`, `sw.js` y
`supabase/functions/claude/index.ts`; se añadió
`tests/simulation-blueprint.test.mjs` y `tests/inline-scripts.test.mjs`.

- Antes de llamar a GPT Image, la app segmenta la arcada superior y construye
  un objetivo geométrico explícito para las seis piezas anteriores 13–23. El
  plano conserva la línea media y el tamaño detectado, pero define centrales,
  laterales y caninos separados, proporciones jerárquicas y curva incisal.
- La Edge Function recibe ese plano como segunda imagen PNG, con las mismas
  dimensiones que el recorte clínico. Se usa sólo como referencia geométrica;
  la primera imagen continúa siendo la fotografía del paciente y la máscara de
  edición sigue limitando los píxeles modificables a dientes superiores y encía
  directamente asociada.
- El control local compara la geometría generada contra el plano y descarta una
  propuesta que no mejore una anatomía que necesitaba corrección. También son
  rechazo obligatorio un cambio casi imperceptible y un A1 visiblemente
  amarillo; ya no pueden salir sólo como advertencia orientativa.
- QA local: scripts inline y TypeScript válidos, 12 pruebas de máscaras
  superadas y prueba sintética del plano 13–23: un resultado idéntico fue
  rechazado y el objetivo geométrico aceptado. Build `v94`, calidad `v16`,
  caché PWA `smyl-v55`.
- Producción: Edge Function `claude` versión 59 quedó `ACTIVE` con su
  configuración existente `verify_jwt=false`; el frontend se publicó mediante
  GitHub Pages desde la rama de producción de este proyecto.

## 2026-08-26 — Codex: contrato único de carillas y control visual activo

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html` y `sw.js`.

- La orden efectiva a GPT Image se consolidó en un único contrato jerárquico:
  alcance protegido, correspondencia uno a uno, roles 13–23, curva y contactos,
  cerámica estratificada, encía conservadora y preservación absoluta del resto.
  Se dejan de enviar juntos los bloques anatómicos repetidos que competían entre
  sí y favorecían una fila genérica de dientes blancos.
- El análisis facial ya no contradice la máscara: admite únicamente un ajuste
  conservador de la encía superior directamente asociada a las carillas.
- El control visual local existente se conectó al resultado compuesto real. Ya
  no basta con detectar seis cajas: textura óptica plana, proporciones centrales
  impropias, cobertura incompleta, línea media o bordes centrales incoherentes
  pueden descartar el render antes de mostrárselo al paciente.
- La fotografía original continúa siendo la base determinista; sólo sobreviven
  píxeles generados dentro de dientes superiores y encía asociada. Build `v93`,
  control de calidad `v15`, caché PWA `smyl-v54`. **No se publicó ni desplegó**.
- QA local: scripts inline válidos, 12 verificaciones de máscaras superadas,
  caso sintético natural aceptado y fila plana/repetida rechazada; copias
  web/móvil idénticas y sin desbordamiento horizontal a 390×844, 834×1194 y
  1440×900, sin errores de consola.
- La revisión visual externa con Claude quedó fuera de este cambio: requiere
  autorización explícita para enviar la foto clínica original y el resultado a
  Anthropic, incluso cuando Claude se utilice solamente como revisor.

## 2026-08-25 — Codex: validador relativo tolera fragmentos de segmentación

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html` y `sw.js`.

- El soporte `3cb132aa-eec1-4fd1-a66f-2b7529fc1192` confirmó generación OpenAI
  exitosa en calidad alta (70.6 s), máscara `treatment` correcta con 12
  componentes y 25 componentes en la segmentación posterior lado a lado. El
  componente impar adicional podía desplazar la selección de los seis dientes
  centrales y producir un falso rechazo anatómico.
- El control v14 parte ahora de los seis dientes anteriores originales y busca
  una subsecuencia generada en el mismo orden y corredor. Los fragmentos extra
  se omiten antes de calcular centrales, laterales, caninos, simetría y curva.
- Las proporciones se evalúan de forma relativa: una característica original
  fuera del promedio no se castiga si la propuesta la conserva o mejora. Se
  mantiene el bloqueo para pérdida real de correspondencia, piezas fusionadas,
  desplazamientos/anchos extremos, fila incisal plana con anchos clonados o dos
  deterioros anatómicos simultáneos.
- QA local sintético: un séptimo fragmento entre centrales se tolera y registra;
  una fila de seis dientes planos y repetidos se rechaza. Scripts inline válidos,
  12 pruebas de máscaras superadas, copias web/móvil idénticas. Build `v92`,
  caché PWA `smyl-v53`.

## 2026-08-25 — Codex: edición limitada a dientes maxilares y encía

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`, `sw.js`,
`supabase/functions/claude/index.ts` y `supabase/functions/segment-teeth/index.ts`.

- La generación prepara primero una máscara GPT `target: "treatment"` que sólo
  admite dientes maxilares visibles y su encía asociada. Excluye de forma
  explícita arcada inferior, labios, lengua, piel, vello y resto del rostro.
- El recorte clínico se envía como PNG y la Edge Function valida firma, tamaño,
  dimensiones y canal alfa antes de adjuntar la máscara a `/v1/images/edits`.
  Fuera de esa máscara OpenAI recibe una zona opaca no editable.
- La fotografía original sigue siendo la única base del resultado. Después de
  generar, el navegador recorta nuevamente la IA con la misma región, limita su
  borde inferior respecto a la arcada superior detectada y restaura todos los
  píxeles exteriores desde el original. Así, un cambio de piel, labio, lengua o
  dientes inferiores producido por el modelo no llega a la imagen presentada.
- La encía puede refinarse sólo de forma conservadora: papilas y cénits con
  textura, color y asimetría biológica; se rechazan bandas rosas planas. El
  control de anatomía dental endurece proporciones centrales, jerarquía de
  laterales/caninos, simetría, curva incisal y repetición de anchos.
- Las segmentaciones son pasos internos de una simulación y ya no descuentan
  usos adicionales del plan; la generación principal sigue descontando una vez
  y se mantienen los límites por clínica e IP.
- QA local: scripts inline válidos, archivos TypeScript aceptados por el parser
  de Node, 12 verificaciones de `mask-utils` superadas y `git diff --check`
  limpio salvo avisos CRLF. Caché PWA `smyl-v52`. **No se publicó ni desplegó**.

## 2026-08-23 — Codex: segmentación GPT admite recortes panorámicos

**Tocado:** `supabase/functions/segment-teeth/index.ts`,
`supabase/functions/segment-teeth/mask-utils.ts` y su prueba local.

- El código de soporte `289a2f40-f9f7-4344-ae72-f8089e2e5bb2` confirmó que
  la generación principal terminó correctamente en OpenAI (74.2 s), pero el
  segmentador rechazó el recorte lado a lado antes de llamar a GPT porque su
  relación era mayor que 3:1. La segmentación fallida no consumió una segunda
  inferencia ni un segundo cobro.
- Los recortes panorámicos o verticales extremos se centran ahora sobre un
  lienzo negro con relación máxima 3:1, sin recortar, estirar ni deformar la
  fotografía. Tras recibir la máscara, el servidor elimina esos márgenes y
  proyecta componentes y cajas a las coordenadas exactas del recorte original.
- El prompt declara el margen negro como zona no segmentable. El contrato
  `masks`, las máscaras SVG individuales, FDI, Storage privado, autenticación y
  límites de gasto permanecen iguales; no hubo cambios de frontend/PWA.
- Prueba local ampliada a 12 verificaciones (panorámico, vertical y recorte de
  bitmap), sintaxis válida y `git diff --check` limpio salvo avisos CRLF.
  `segment-teeth` versión 33 quedó desplegada, `ACTIVE` y con su configuración
  previa `verify_jwt=false`. No se ejecutó una segmentación pagada durante QA.
- El intento posterior `114854bb-5076-4d1c-b8a2-d66d52dc1ce0` confirmó el
  arreglo panorámico: GPT recibió un lienzo `1440x480`, completó la máscara en
  20.4 s y produjo componentes utilizables. La entrega falló después porque el
  bucket privado `camila-masks` sólo admitía `image/png` y las máscaras
  deterministas nuevas son SVG. En producción se conservó el bucket privado y
  se amplió su lista a `image/png, image/svg+xml`; no se abrió acceso público ni
  se modificaron políticas, fotografías o límites de tamaño.

## 2026-08-23 — Codex: segmentación dental migrada de SAM 3 a GPT Image 2

**Tocado:** `supabase/functions/segment-teeth/index.ts`,
`supabase/functions/segment-teeth/mask-utils.ts` y su prueba local.

- Por decisión del usuario, `segment-teeth` deja de llamar al SAM 3
  generalista hospedado en Replicate. Reutiliza el Secret `OPENAI_API_KEY` y
  el snapshot estable `gpt-image-2-2026-04-21`; ya no depende de
  `REPLICATE_API_TOKEN`.
- GPT recibe el recorte dental y devuelve una máscara binaria alineada, blanca
  sobre negra. El servidor no confía directamente en esa imagen: aplica
  umbrales de luminancia/cobertura, separa componentes conexos, descarta ruido
  y blobs fusionados, conserva cajas/FDI y publica una máscara SVG individual
  por componente. El contrato JSON `masks` no cambia para las apps existentes.
- La llamada usa streaming con una imagen parcial y la respuesta JSON envía
  whitespace de keepalive cada 8 s. Esto evita repetir el corte de Safari por
  una conexión ociosa durante una operación larga; sólo se conserva la máscara
  final y no existe reintento automático que pueda duplicar costo.
- Defaults server-side: `OPENAI_SEGMENTATION_QUALITY=medium` y timeout 120 s;
  ambos admiten override por Secret sin publicar otra app. La función mantiene
  autenticación, límites por clínica/IP, Storage privado y guardado en
  `camila_casos`.
- Prueba local `mask-utils.test.mjs`: componentes separados, descarte de ruido,
  escalado de cajas, SVG por pieza, restricciones de tamaño y rechazo de
  coberturas inválidas. `segment-teeth` versión 31 quedó desplegada y `ACTIVE`
  con `verify_jwt=false`; no se ejecutó una segmentación pagada durante QA.

## 2026-08-23 — Codex: streaming para evitar cortes entre Supabase y OpenAI

**Tocado:** `supabase/functions/claude/index.ts`.

- El código de soporte `0a4c451f-14b1-4ecb-89df-e827f8a52cfc` llegó a la
  función y comenzó una edición con GPT Image 2, pero a los 30 s la conexión
  saliente entre Supabase y `api.openai.com` terminó con `connection reset`.
  OpenAI no alcanzó a devolver headers ni imagen y nunca se llamó a
  `segment-teeth`; la clave, el saldo y el teléfono no fueron la causa.
- La edición usa ahora el streaming SSE oficial de `/v1/images/edits` con
  imágenes parciales. La función consume esos avances sólo para mantener viva
  la conexión y entrega exclusivamente el JPEG final; el modelo, calidad,
  prompt y contrato binario del cliente no cambian.
- Se mantiene una sola llamada pagada, sin reintento ni fallback automático
  ante un fallo de red incierto. Además se envía `X-Client-Request-Id` con el
  `requestId` de SMYL, para que OpenAI pueda localizar solicitudes cuyo
  `x-request-id` no haya alcanzado a regresar.
- Edge Function `claude` versión 56 desplegada y verificada `ACTIVE`, conservó
  `verify_jwt=false` por autorización explícita del usuario. El empaquetado
  remoto validó la función. No se ejecutó una generación pagada durante QA.
- El código posterior `20a0015a-0f8d-4404-8c52-32055317cdf8` confirmó que
  el stream upstream quedó resuelto: OpenAI entregó tres parciales, HTTP 200 y
  un JPEG de 156,278 bytes en 70.3 s. Sin embargo, el iPhone no invocó
  `segment-teeth`: la conexión navegador→Supabase también permanecía ociosa
  hasta el final.
- En `responseMode:'binary'` la función devuelve ahora un JPEG transmitido:
  envía SOI y pequeños segmentos COM válidos con cada avance, después adjunta
  el JPEG final sin repetir SOI. Safari recibe actividad desde el primer
  parcial, mientras el cliente existente sigue viendo un `image/jpeg` normal;
  no requiere nueva app, Storage ni otra generación.
- Edge Function `claude` versión 57 desplegada y verificada `ACTIVE`.

## 2026-08-23 — Codex: entrega binaria de la simulación en iOS

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`,
`supabase/functions/claude/index.ts`, `sw.js`.

- El código de soporte `42514beb-7ff6-46cd-9ca0-5bd20c95acc8` confirmó otra
  generación OpenAI exitosa (HTTP 200, 71.8 s), pero esta vez no existió una
  invocación posterior a `segment-teeth`: el JPEG en base64 dentro del JSON no
  alcanzó la siguiente etapa del navegador móvil.
- El cliente pide ahora `responseMode:'binary'`; OpenAI conserva exactamente el
  mismo modelo, calidad y prompt, pero la Edge Function devuelve el JPEG como
  cuerpo binario con metadatos mínimos en headers. El modo JSON queda compatible
  para clientes antiguos y Gemini.
- La app crea una URL `blob:` sólo en memoria, ejecuta los controles dentales y
  la revoca siempre al terminar. No se guarda una copia temporal en Storage y
  se evita el aumento aproximado de 33 % propio de base64/JSON.
- Todos los fallos posteriores a una generación pagada conservan ahora el
  `requestId`, aunque ocurran antes de componer la máscara. Build `v90`, caché
  PWA `smyl-v51`; scripts inline válidos y copias web/móvil idénticas.
- Edge Function `claude` desplegada y verificada activa. No se ejecutó una
  generación adicional durante QA.

## 2026-08-23 — Codex: reintento seguro al crear la segmentación dental

**Tocado:** `supabase/functions/segment-teeth/index.ts`.

- El código de soporte `b90bde8c-7fd8-4940-9413-f706d272cd52` confirmó una
  generación OpenAI exitosa (HTTP 200, 70.2 s) seguida por un HTTP 500 de
  `segment-teeth`; las otras 27 invocaciones conservadas del segmentador
  respondieron 200.
- `callReplicate()` repite una sola vez exclusivamente cuando el endpoint de
  creación rechaza explícitamente la solicitud con 429 o 5xx. En esos estados
  no se creó una predicción, por lo que no se duplica inferencia ni costo.
  Fallos de red inciertos no se reintentan.
- El catch principal registra ahora el error interno en los logs de la función,
  para que una nueva captura pueda diagnosticarse sin depender del texto
  genérico del teléfono.
- No se modificaron OpenAI, prompts, frontend, fotografías, esquema ni
  Secrets. `segment-teeth` fue desplegada y verificada en producción; no se
  ejecutó una inferencia adicional durante QA.

## 2026-08-23 — Codex: anatomía dental estricta y GPT Image 2 en calidad alta

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`,
`supabase/functions/claude/index.ts`, `docs/AI_COST_CONTROL.md`,
`docs/AI_IMAGE_AB_HARNESS.md`, `sw.js`.

- Una propuesta real llegó a mostrarse con centrales anchos y cuadrados,
  laterales sin jerarquía, caninos diluidos y una línea incisal plana. El
  resultado no era apto ni siquiera como orientación para el paciente.
- El análisis facial ya no puede pedir extremos de 70–90 % de ancho/alto ni
  coronas de 88–112 %: centrales quedan acotados a 75–80 % y el tamaño aparente
  a 94–106 %. El patrón braquifacial deja de traducirse como “cuadrado y ancho”.
- La edición recibe un gate anatómico prioritario por piezas 13–23: identidad
  individual, dominancia central sin volumen excesivo, laterales 70–78 % y
  0.5–1.0 mm más cortos, caninos reconocibles, troneras, curva incisal y relieve
  facial. Preferencias clínicas opcionales no pueden sobrescribirlo.
- El control local usa las cajas individuales que ya devuelve la segmentación,
  sin otra inferencia: bloquea menos de seis anteriores, fallback sin anatomía
  verificable y combinaciones de proporción central anormal, laterales iguales,
  fila plana, anchuras clonadas o caninos atípicos. Una sola desviación aislada
  queda como advertencia para tolerar perspectiva.
- GPT Image 2 usa ahora calidad `high`; `OPENAI_IMAGE_QUALITY=medium` conserva
  rollback server-side. El timeout admite hasta 85 s y producción se configura
  en 80 s. Sigue existiendo una sola llamada pagada, sin reintentos ni fallback
  automático.
- Pruebas: scripts inline válidos; caso sintético natural aceptado; fila plana,
  piezas fusionadas y máscara de respaldo rechazadas; vistas 390×844,
  834×1194 y 1440×900 sin desbordamiento horizontal. Build `v89`, caché
  `smyl-v50`. Edge Function `claude` versión 51 desplegada y activa; Secrets
  `OPENAI_IMAGE_QUALITY` y `OPENAI_IMAGE_TIMEOUT_MS` configurados.

## 2026-08-23 — Codex: distingue esmalte VITA cálido de tejido rosado

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`, `sw.js`.

- Una segunda generación real siguió bloqueándose: el detector anterior podía
  clasificar beige dental cálido y sombras cervicales como tejido por usar sólo
  diferencias RGB amplias.
- La clasificación exige ahora saturación cromática y una relación azul/verde
  propia de rosa/magenta, o un rojo fuertemente saturado. Tonos marfil, beige y
  marrón dental quedan fuera aunque el canal rojo sea dominante.
- Se conserva la exclusión protectora de `v87` y el bloqueo cuando el tejido
  real invade más de 28 % de la máscara. No se tocaron GPT Image 2, backend ni
  prompts. Build visual `v88`, caché PWA `smyl-v49`.

## 2026-08-23 — Codex: excluye tejido rosado sin perder la propuesta

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`, `sw.js`.

- Un resultado real de GPT Image 2 llegó correctamente, pero el control local
  descartó toda la propuesta por un borde rosado pequeño dentro de la máscara.
- La composición resta ahora de la máscara cualquier píxel con apariencia de
  labio/encía en la foto original o en el render, con un margen corto. En esas
  zonas permanece la fotografía original; el color sólo EXCLUYE píxeles de IA
  y nunca se usa para agregarlos.
- Una contaminación extensa (más de 28 % de la máscara) continúa bloqueando la
  entrega. Los bordes pequeños pasan como advertencia para revisión clínica y
  se conservan fuera de la capa generada.
- No se modificaron backend, proveedor, modelo ni prompts. Build visual `v87`,
  caché PWA `smyl-v48`; verificado con lienzos sintéticos y vistas responsive.

## 2026-08-23 — Codex: GPT Image 2 como proveedor predeterminado server-side

**Tocado:** `supabase/functions/claude/index.ts`, `docs/AI_COST_CONTROL.md`,
`docs/AI_IMAGE_AB_HARNESS.md`.

- La generación de simulaciones toma ahora el proveedor predeterminado desde
  `SMYL_IMAGE_PROVIDER`; producción usa `openai` con el snapshot fijo
  `gpt-image-2-2026-04-21`. La clave permanece sólo en Supabase Secrets.
- El navegador público no puede elegir proveedor. Un profesional autenticado
  conserva el override A/B; si el servidor vuelve a Gemini, la ruta OpenAI
  experimental sigue exigiendo su bandera.
- No existe fallback automático ni doble cobro: cada acción llama una sola vez
  al proveedor efectivo y mantiene los topes actuales por plan/IP. Gemini es
  el rollback inmediato cambiando el Secret a `gemini`.
- No se modificaron prompts clínicos, frontend, fotos, esquema ni aplicación
  móvil. Claude continúa a cargo del análisis textual.

## 2026-08-22 — Codex: composición acotada por la máscara dental original

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`, `sw.js`.

- La máscara segmentada de los dientes superiores originales pasa a ser el
  límite anatómico confiable de la composición. El render sólo puede extender
  ese contorno entre uno y cinco píxeles cuando ambas máscaras coinciden;
  labios, encía y dientes inferiores continúan saliendo de la foto original.
- Las variaciones de área, anchura o centro en la segmentación del render se
  conservan como advertencias para revisión, pero ya no descartan una propuesta
  completa. La ausencia de máscara del lado generado usa la arcada original
  como recorte seguro, sin respaldo por color ni ampliación libre.
- Siguen bloqueando la entrega una máscara original ausente/incompleta, una
  extensión anatómica anormal o tejido rosado dentro de la capa protegida. Los
  mensajes ahora distinguen segmentación, cobertura y protección de tejidos.
- No se modificaron backend, prompts, fotografías ni llamadas de IA. Verificado
  con scripts inline válidos y vistas locales de 390×844, 834×1194 y 1440×900
  sin desbordamiento. Caché PWA `smyl-v47`, build visual `v86`.

## 2026-08-22 — Codex: evita falsos rechazos de arcada superior curva

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`, `sw.js`.

- Corregida la selección local de máscaras: el umbral vertical anterior podía
  dividir una sola sonrisa curva en dos filas y descartar centrales o laterales
  como si fueran dientes inferiores. La app conserva una arcada continua y sólo
  separa mandíbula cuando existe una distancia de tamaño dental real.
- La composición mantiene el cierre de seguridad: fuera de la máscara dental
  siguen sobreviviendo exclusivamente píxeles de la fotografía original; no se
  añadió respaldo por color ni se relajó la detección de labio/encía.
- Los fallos locales de composición conservan ahora el `requestId` real de la
  generación, la etapa y métricas no sensibles. Un rechazo de calidad etiqueta
  el botón como `Generar otra propuesta` para dejar claro que no es un retry de
  red. Caché PWA actualizado a `smyl-v46`, build visual `v85`.
- Verificado sin IA ni fotografías: cuatro scripts inline válidos; casos
  sintéticos de arcada única, curva marcada, dos filas y una pieza inferior;
  revisión local en 390×844, 834×1194 y 1440×900 sin desbordamiento visible.

## 2026-08-21 — Codex: recuperación y diagnóstico de fallos de generación

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`, `sw.js`.

- Antes de cada llamada de IA profesional se verifica la sesión y se renueva
  el token si está próximo a vencer; el modo prospecto conserva su acceso por
  enlace de clínica.
- Las respuestas de la Edge Function se leen de forma tolerante: se preservan
  estado HTTP y `requestId` aunque el cuerpo esté vacío, incompleto o no sea
  JSON. La interfaz diferencia sesión, plan, tamaño, demanda, red, timeout y
  errores 5xx sin mostrar nombres de proveedores.
- Cada fallo deja un código de soporte visible y un registro técnico mínimo en
  `sessionStorage`, sin fotografías ni datos del paciente. Las fotos y el
  avance continúan intactos. Caché PWA actualizado a `smyl-v45`.

## 2026-08-19 — Codex: módulo privado de calibración de simulaciones

**Tocado:** `calibracion.html`, `sw.js`.

- Se añadió un harness visual interno para comparar la fotografía original y
  la simulación final, con división arrastrable, mapa de cambios y señales de
  riesgo sobre protección exterior, cambio dental, tejido rosado y cobertura.
- El profesional puede registrar proveedor/modelo, tiempo, costo, decisión,
  fallos y observaciones; el historial local se exporta en CSV o JSON.
- Las fotografías se procesan sólo en memoria y no se guardan ni se envían a
  IA. El historial conserva únicamente métricas y alias anónimos, sin nombres
  ni imágenes de pacientes.
- La ruta exige sesión activa y limita el acceso en interfaz a propietarios y
  administradores. El análisis es orientativo y nunca sustituye la decisión
  clínica. Se agregó la ruta al caché PWA `smyl-v43`.


## 2026-08-17 — Codex: composición anatómica cerrada de arcada superior

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`, `sw.js`.

- El flujo público deja de usar definitivamente la clasificación del esmalte
  por color para componer la simulación.
- Original y render se segmentan juntos en una sola solicitud; las piezas se
  unen en una región anatómica continua de la arcada superior. No se mueven ni
  reconstruyen dientes individualmente.
- La fotografía original es la base inmutable y fuera de la máscara no
  sobrevive ningún píxel generado. Se validan área, cobertura bilateral,
  centro y desplazamiento antes de mostrar el resultado.
- Una segunda barrera detecta tejido rosado dentro de la capa dental. Ante
  máscara insegura, labio/encía o cobertura parcial, el flujo falla cerrado y
  pide regenerar; no existe respaldo por color. Caché PWA `smyl-v42`.

## 2026-08-17 — Codex: bloquea tejido labial en la composición dental

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`, `sw.js`.

- Un resultado real mostró una franja horizontal de labio sobre las coronas:
  la ventana elíptica de composición seguía admitiendo tejido rosado generado.
- La recomposición ahora usa una máscara continua de esmalte derivada de la
  foto original, dilatada y suavizada para aceptar el nuevo contorno sin
  segmentar ni numerar dientes. Labios y encía generados quedan excluidos.
- El resultado queda en estado `review`, nunca aprobado automáticamente, y
  exige revisión bilateral/anatómica/VITA. Caché PWA `smyl-v41`.

## 2026-08-17 — Codex: restaura prescripción completa de carillas

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`, `sw.js`.

- Corregida una sobrescritura de `stylePrompt`: la prescripción extensa de
  cobertura bilateral, jerarquía central/lateral/canino, contactos, curva
  incisal y cerámica estratificada se construía y luego era reemplazada por
  una versión breve. Ahora ambas instrucciones se acumulan.
- El generador vuelve a exigir continuidad en todos los dientes maxilares
  visibles, variación anatómica y preservación de la arcada inferior/tejidos.
- El mensaje verde ya no afirma aprobación clínica automática; solicita
  revisión profesional. Caché PWA actualizado a `smyl-v40`.

## 2026-08-17 — Codex: composición limitada a la sonrisa sin deformar el rostro

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`, `sw.js`.

- Corregido un override JavaScript que todavía imponía `object-fit:fill` en el
  comparador y podía estirar rostros pese a que el CSS ya usaba `cover`.
- La IA conserva un recorte amplio como contexto de generación, pero al
  recomponer sólo se transfiere una banda dental continua con feather elíptico.
  No se segmentan ni etiquetan piezas; nariz, bigote, labios, piel y expresión
  permanecen formados por píxeles de la fotografía original.
- Esto elimina el borde horizontal/rectangular visible en algunos resultados y
  evita que la mitad “con carillas” sustituya una zona grande del rostro.
- Caché PWA actualizado a `smyl-v39`. Las simulaciones ya guardadas no se
  reprocesan; hay que generar una nueva para comprobar la composición corregida.

## 2026-08-16 — Codex: proporción fotográfica clínica sin deformación

**Tocado:** `simulacion.html`, `photo-adjust.js`, `mobile/www/simulacion.html`,
`mobile/www/photo-adjust.js`, `sw.js`.

- El recorte deja de heredar la proporción arbitraria del teléfono: las vistas
  de rostro usan un marco 4:5 y las tomas clínicas horizontales, 4:3.
- El comparador reemplaza `object-fit:fill` por `object-fit:cover`; original y
  simulación llenan el mismo marco mediante recorte central proporcional, sin
  estirar ni comprimir la anatomía facial.
- Caché PWA actualizado a `smyl-v38`.

## 2026-08-16 — Codex: edición previa de cada fotografía

**Tocado:** `simulacion.html`, `photo-adjust.js`, `mobile/www/simulacion.html`,
`mobile/www/photo-adjust.js`, `sw.js`.

- Toda foto procedente de cámara nativa, cámara integrada o galería pasa por
  una revisión no destructiva antes de guardarse.
- El usuario puede arrastrar para recortar, pellizcar para ampliar, enderezar
  entre −15° y +15°, girar 90°, restablecer, cancelar o confirmar.
- Sólo al pulsar `Usar foto` se exporta y comprime la fotografía editada; la
  validación frontal y la persistencia reciben esa misma versión.
- Caché PWA actualizado a `smyl-v37`.

## 2026-08-16 — Codex: zoom del navegador bloqueado en la experiencia móvil

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`, `sw.js`.

- La aplicación ya no permite que Safari/Chrome amplíen la interfaz completa:
  viewport fijo y bloqueo de `gesturestart`, `gesturechange` y `gestureend`.
- El comparador conserva el arrastre de un dedo exclusivamente para la línea
  antes/después. El zoom propio del editor de diseño permanece disponible,
  porque transforma sólo su canvas y no el documento.
- Caché PWA actualizado a `smyl-v36`.

## 2026-08-16 — Codex: comparador táctil aislado de la interfaz

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`, `sw.js`.

- El lienzo antes/después ahora usa `touch-action:none`, contención de
  overscroll y eventos táctiles no pasivos dentro de la fotografía.
- Arrastrar con un dedo mueve sólo la línea comparadora; gestos múltiples en
  ese lienzo ya no amplían ni desplazan la página completa. El modo manual de
  alineación recibe la misma protección.
- Se conserva el zoom accesible del navegador fuera del comparador y el zoom
  controlado del editor de diseño. Caché PWA actualizado a `smyl-v35`.
- Proveedor vigente: Gemini por omisión (`gemini-2.5-flash-image` primero).
  GPT Image 2 continúa desplegado sólo como opción experimental y el frontend
  no envía `imageProvider:"openai"`.

## 2026-08-16 — Codex: primera foto clínica nativa en web móvil

**Tocado:** `simulacion.html`, `sw.js`.

- Corregido el alcance de la solución: no sólo el diagnóstico, sino también
  `startCam()` del flujo público detecta iPhone/iPad/Android y abre desde la
  primera foto `s-cam-native`, sin intentar `getUserMedia`.
- Las seis tomas permanecen en la misma secuencia nativa; escritorio conserva
  la cámara integrada con cuadrícula y su respaldo nativo.
- Caché PWA actualizado a `smyl-v34`.

## 2026-08-16 — Codex: diagnóstico móvil por cámara nativa

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`, `sw.js`.

- La prueba física confirmó pantalla negra al forzar video web en iPhone.
- En iPhone/iPad y Android, el diagnóstico ahora omite `getUserMedia` y abre
  directamente el selector `capture` del sistema, igual que el flujo clínico
  estable de SMYL. El video en vivo se conserva sólo para escritorio.
- Una fotografía tomada desde el sistema valida cámara y permiso; el archivo
  sólo se lee para comprobar dimensiones y después se descarta.
- Estado de diagnóstico actualizado a v2 para no reutilizar errores guardados
  de la prueba anterior. Caché PWA actualizado a `smyl-v33`.

## 2026-08-16 — Codex: fotograma real en diagnóstico de cámara

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`, `sw.js`.

- El diagnóstico ya no aprueba la cámara sólo porque `video.play()` resuelva:
  espera metadatos y dimensiones antes de marcarla como funcional.
- Añadidos `autoplay`, `playsinline` y `webkit-playsinline` para Safari/iOS,
  además de un segundo intento compatible sin `facingMode` cuando el primero
  concede permiso pero no entrega imagen.
- Si ningún intento produce fotograma, lo reporta como fallo de video en vivo
  y dirige a la captura nativa que realmente usa SMYL, sin bloquear las seis
  pruebas de cámara/galería.
- Caché PWA actualizado a `smyl-v32`. Falta confirmar el fotograma en los
  dispositivos físicos que presentaron la pantalla negra.

## 2026-08-15 — Codex: diagnóstico físico de cámara sin consumo de IA

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`, `sw.js`.

- Nueva entrada interna `simulacion.html?diagnostico=1`. Gana antes del login,
  prospecto y recuperación de casos, y utiliza una pantalla/estado propios.
- Verifica contexto seguro, disponibilidad de `getUserMedia`, permiso y cámara
  en vivo; también guía una prueba de las seis posiciones, incluida frontal
  obligatoria y cinco vistas opcionales, usando cámara nativa o galería.
- Registra rotación, salida y regreso desde segundo plano y persistencia local.
  Las fotografías sólo se abren para leer dimensiones/tipo/tamaño: no se
  guardan, no se incluyen en el reporte y no se escriben en `S.photos`.
- El reporte local se puede copiar o descargar como JSON y declara de forma
  explícita `containsImages:false`, `usesAI:false` y
  `consumesSimulation:false`.
- `processPhotos()` queda bloqueado defensivamente mientras el parámetro de
  diagnóstico está activo. No se llama a Claude, Gemini, GPT Image ni al
  contador del plan.
- Prueba local responsive aprobada en 390×844, 820×1180 y 1440×900: una sola
  pantalla activa, sin login visible ni desbordamiento horizontal. La prueba
  real de permisos/cámara/rotación/segundo plano sigue requiriendo iPhone y
  Android físicos.
- Caché PWA actualizado a `smyl-v31`.

## 2026-08-15 — Codex: editor por niveles (etapa 6)

**Tocado:** simulación web/móvil y caché.

- El editor conserva todas sus funciones clínicas, pero deja visible primero el
  diseño dental. Proporciones, color/material y encía avanzada se abren sólo
  cuando el profesional los necesita.
- Las guías principales permanecen directas; añadir líneas verticales u
  horizontales pasa a Más guías, reduciendo la saturación de la barra.
- Se simplificaron los nombres de acciones: Guías, Vista, Desplazar y
  Regenerar, sin cambiar IDs, parámetros, zoom, controles táctiles ni llamada
  de regeneración.
- Verificado: cuatro secciones y cuatro resúmenes por copia, IDs del editor sin
  duplicados, controles de agrupación conservados y tres scripts inline válidos
  tanto en web como en móvil.


## 2026-08-14 — Codex: selección VITA con acción visible (etapa 5)

**Tocado:** simulación web/móvil y caché.

- La selección actual y el botón para continuar aparecen inmediatamente después del carrusel, sin obligar a recorrer comparaciones y opciones avanzadas.
- El texto del botón se simplificó a `Continuar con este tono` o `Aplicar este tono` según el contexto.
- El resumen rápido se actualiza al elegir un tono o conservar el tono observado en la fotografía.
- VITA Classical muestra sus 16 códigos, incorporando A3.5 y C4. Los colores de pantalla siguen siendo ilustrativos, no una medición clínica calibrada.

## 2026-08-14 — Codex: separación paciente/profesional (etapa 4)

**Tocado:** simulación web/móvil, documentación y caché.

- El acceso profesional conserva inicio de sesión, editor, revisión clínica y diagnóstico ampliado.
- El enlace público `?clinica=<id>` usa lenguaje para paciente, pide una frontal obligatoria y presenta las otras cinco vistas como opcionales.
- Editor, revisión clínica y diagnóstico ampliado quedan ocultos en el enlace público; el paciente conserva el resultado y la solicitud de contacto.
- Los selectores de dispositivo y la etiqueta de build ya no aparecen en producción. Para revisión interna se habilitan con `?debugUI=1`.

## 2026-08-14 — Codex: control de costo y telemetría IA (etapa 3)

**Tocado:** simulación web/móvil, función claude, documentación y caché.

- La generación de imagen pagada ya no se reintenta automáticamente ante una
  desconexión. Cada pulsación genera como máximo una solicitud desde el cliente.
- Simulación inicial, regeneración manual y revisión del editor crean un
  identificador y explican el motivo de la solicitud.
- La función devuelve proveedor, modelo, intentos internos, duración y uso
  reportado por Gemini; el cliente conserva el último registro en memoria.
- Se documentó la ruta actual de dos pasos y el protocolo futuro para comparar
  Gemini con GPT Image 2 sin sustituir el proveedor de producción a ciegas.

## 2026-08-14 — Codex: flujo fotográfico unificado (etapa 2)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`, `sw.js`.

- Una sola secuencia define las seis vistas: frontal, derecha, izquierda,
  tres cuartos, intraoral y extraoral.
- Solo la frontal es obligatoria para la simulación rápida. Las otras cinco
  se pueden saltar y permanecen como documentación opcional del expediente.
- Se eliminaron los contadores heredados de tres y cuatro fotografías; cámara
  integrada, galería, cámara nativa, reanudación y progreso usan `VIEWS.length`.
- La captura no llama a la IA por cada fotografía. Al cerrar la secuencia se
  analiza la frontal y se genera únicamente su simulación; las tomas opcionales
  quedan guardadas para uso posterior.
- Se impide iniciar el procesamiento sin una fotografía frontal y se explica
  al usuario cómo continuar, sin perder el avance.

## 2026-08-14 — Codex: estabilización UX del simulador (etapa 1)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- Se corrigieron los handlers rotos de `Nueva foto` y `Enviar al paciente`.
- `Nueva foto` confirma antes de reemplazar las tomas; cancelar conserva la
  simulación visible. Compartir antes de guardar explica el paso requerido y
  lleva el foco al nombre del paciente.
- Los errores globales y de generación conservan el detalle técnico en la
  consola, pero presentan al usuario categorías sencillas (sesión, plan,
  conexión, espera, fotografía o calidad) sin stack, líneas ni mensajes
  internos de segmentación.
- La web muestra de inmediato `Abriendo cámara...` mientras resuelve permisos
  o prepara el respaldo nativo. La app móvil mantiene su cámara nativa directa,
  por lo que no incorpora esa espera.
- Verificado: scripts inline válidos en ambas copias, handlers resueltos, sin
  espacios inválidos en el diff y carga responsive local a 390×844 sin
  desbordamiento horizontal. No se llamaron APIs ni se usaron fotos reales.
- La publicación incluye la cuadrícula de captura build v81 que ya estaba
  preparada en `simulacion.html`, como base de la siguiente etapa de
  unificación del flujo fotográfico.

## 2026-08-14 — Codex: resumen operativo del expediente (etapa 17)

**Tocado:** `editor-v2.html`, `editor-v2.js`,
`docs/SIMULACION_AGENT_HARNESS.md`.

- El caso seleccionado muestra paciente, folio, estado, actividad, avance de
  ruta, fotografías, tomas técnicamente aptas y versiones guardadas.
- La próxima acción se deriva del primer paso aún no completado y abre
  directamente su sección existente; no crea una segunda ruta paralela.
- Los pendientes esenciales se presentan como recordatorios locales sin
  bloquear ni cambiar el contenido del expediente.
- Validado con un caso ficticio en 1440×900, 820×1180 y 390×844: la próxima
  acción abrió fotografía, el resumen permaneció dentro del viewport y no hubo
  errores de consola.
- Se documentó un harness para futuras revisiones de `simulacion.html` con
  Orchestrator, Explorer, Reviewer, Implementer/Fixer y Tester, incluyendo
  artefactos, puertas de calidad y condiciones de rechazo.

## 2026-08-14 — Codex: panel profesional de casos (etapa 16)

**Tocado:** `editor-v2.html`, `editor-v2.js`.

- La biblioteca local ahora funciona como panel de trabajo: resume casos
  totales, en revisión y aprobados, sin migrar ni renombrar expedientes.
- Se añadieron búsqueda, filtros por estado y tarjetas con paciente, folio,
  fecha, avance de la ruta, fotografías, versiones y estado clínico.
- Las acciones existentes de continuar, duplicar, eliminar y crear caso se
  conservaron sobre el mismo almacenamiento local `smyl.case-library`.
- El estado activo y los filtros se expresan visualmente sin modificar fotos,
  simulaciones, prompts ni servicios de IA.

## 2026-08-14 — Codex: ruta clínica guiada (etapa 15)

**Tocado:** `editor-v2.html`, `editor-v2.js`.

- Se añadió una ruta visible de seis pasos: caso, fotografía, calibración,
  diseño, revisión y entrega, sin ocultar ni bloquear las herramientas actuales.
- El dentista puede entrar directamente a cualquier etapa; `Anterior` y
  `Siguiente` desplazan a la sección correspondiente y explican el objetivo.
- Los requisitos ligeros impiden avanzar con una frontal ausente, calibración
  sin centrar o revisión sin versión guardada, pero no eliminan trabajo.
- Paso actual y completados viajan dentro de `smyl.case-package`; los paquetes
  anteriores reciben un estado inicial compatible al abrirse.
- Validado en 1440×900, 820×1180 y 390×844: sin desbordamiento horizontal,
  navegación directa, bloqueo explicativo, persistencia al guardar y cero
  errores de consola.

## 2026-08-14 — Codex: calibración facial manual (etapa 14)

**Tocado:** `editor-v2.html`, `editor-v2.js`.

- Línea media, plano interpupilar y plano oclusal se ajustan sobre la foto intacta.
- La frontal del caso se recupera desde IndexedDB y el diseño puede centrarse como grupo.
- Calibración validada, persistente, reversible y compatible con móvil; sin errores de consola.
- Es una referencia manual orientativa, sin landmarks, segmentación ni diagnóstico.

## 2026-08-14 — Codex: control técnico fotográfico local (etapa 13)

**Tocado:** `editor-v2.html`, `editor-v2.js`.

- Cada fotografía nueva se analiza localmente antes de registrarse en el caso:
  resolución, exposición, contraste y una estimación orientativa de nitidez.
- El expediente diferencia tomas técnicamente aptas de aquellas que conviene
  repetir y explica el motivo sin bloquear el resto del flujo clínico.
- Las fotografías guardadas con versiones anteriores conservan compatibilidad
  y pueden evaluarse después con el botón `Evaluar`.
- El resultado técnico queda dentro de los metadatos del caso y se sanea al
  importar paquetes; la imagen continúa en IndexedDB y no se envía a servicios
  externos.
- Validado con imágenes sintéticas: una toma de 200×150 oscura fue advertida,
  una de 1200×900 con detalle fue aprobada, el diseño móvil mantuvo las tarjetas
  dentro del viewport y no hubo errores de consola. Es una ayuda de captura,
  no una validación diagnóstica ni clínica.

## 2026-08-14 — Codex: captura fotográfica guiada editor-v2 (etapa 12)

**Tocado:** `editor-v2.html`, `editor-v2.js`.

- El registro fotográfico abre una cámara integrada para frontal, perfiles
  derecho/izquierdo y vista 3/4; intraoral y extraoral permanecen como
  registros libres desde galería.
- El visor usa cuadrícula de tercios, referencia facial e instrucciones
  específicas por posición. La captura frontal utiliza la cámara delantera,
  conserva la resolución disponible y se guarda en IndexedDB dentro del caso.
- Galería permanece como respaldo cuando falta permiso o soporte de cámara.
  Las solicitudes tardías se invalidan y todas las pistas se detienen al
  cerrar, cambiar de toma o salir de la página.
- Validado en navegador y móvil: cuatro accesos guiados, seis accesos de
  galería, variante de perfil, cierre con flujo desconectado y cero errores de
  consola. Sigue aislado de simulación, IA, Supabase y la app móvil vigente.

## 2026-08-13 — Codex: entrega del caso editor-v2 (etapa 8)

**Tocado:** `editor-v2.html`, `editor-v2.js`, `docs/EDITOR_V2_MODEL.md`.

- Se añadió una presentación HTML autocontenida para paciente/laboratorio con
  antes, propuesta, resumen morfológico, piezas visibles y referencias VITA.
- Permite vista previa, descarga HTML e impresión/guardado PDF desde navegador.
- Las notas clínicas se excluyen por defecto y requieren selección explícita;
  toda entrega exige confirmar previamente la revisión de datos.
- Incluye advertencia visible sobre el carácter orientativo de la simulación.
- Prueba headless: documento válido, dos imágenes incrustadas, datos del caso,
  notas privadas excluidas y función de impresión presente.

---

## 2026-08-13 — Codex: expediente local editor-v2 (etapa 7)

**Tocado:** `editor-v2.html`, `editor-v2.js`, `docs/EDITOR_V2_MODEL.md`.

- Se agregó un expediente local separado con folio, identificador del paciente,
  estado del caso y notas.
- El expediente guarda una copia versionada del diseño actual y permite
  recuperar ambos de forma atómica.
- Los archivos de referencia se registran sólo por metadatos; no se guardan ni
  exportan sus bytes, evitando llenar `localStorage` y reduciendo exposición.
- Se añadió exportación/importación del paquete `smyl.case-package` versión 1.
- Prueba headless: folio, paciente, estado y diseño de seis piezas restaurados
  después de alterarlos. Sigue siendo un laboratorio local, no un EHR regulado.

---

## 2026-08-13 — Codex: comparar y exportar editor-v2 (etapa 6)

**Tocado:** `editor-v2.html`, `editor-v2.js`, `docs/EDITOR_V2_MODEL.md`.

- Se añadió una vista modal antes/después a partir de una sola fotografía
  original intacta y del diseño paramétrico actual.
- El editor exporta un PNG del resultado y una comparativa PNG en dos paneles.
  Ambos conservan las dimensiones y la relación de aspecto de la fuente.
- El render de salida elimina guías clínicas, puntos, numeración, selección y
  controles; sólo compone las carillas visibles sobre la fotografía.
- La generación ocurre enteramente en memoria y no llama servicios externos.
- Prueba headless: modal funcional y paneles antes/después idénticos de 360×720.
  Continúa aislado del flujo público, de IA y de segmentación.

---

## 2026-08-13 — Codex: control profesional editor-v2 (etapa 5)

**Tocado:** `editor-v2.html`, `editor-v2.js`, `docs/EDITOR_V2_MODEL.md`.

- Se añadió simetría bilateral opcional para replicar geometría, forma,
  material y visibilidad en la pieza contralateral, con posición y rotación
  reflejadas respecto de la línea media.
- Cada pieza se puede ocultar y volver a mostrar sin eliminarla del diseño. La
  capa orientativa de cinco papilas se activa de forma independiente.
- Se incorporó historial de 60 estados con deshacer/rehacer, incluidos los
  atajos `Ctrl/Cmd+Z` y `Ctrl/Cmd+Shift+Z`.
- El contrato JSON pasó a versión 5 y migra diseños 1–4 agregando `visible` y
  las opciones `symmetry`/`papillae` de forma compatible.
- Prueba headless completa: simetría 11↔21, cinco papilas, ocultación bilateral,
  undo/redo y render responsive. No se conectó al simulador ni a la IA.

---

## 2026-08-13 — Codex: color y material editor-v2 (etapa 4)

**Tocado:** `editor-v2.html`, `editor-v2.js`, `docs/EDITOR_V2_MODEL.md`.

- Se añadió caracterización óptica por pieza: referencias VITA B1, A1, B2, D2
  y A2; ajustes de valor, croma y translucidez incisal; y texturas lisa,
  natural o caracterizada.
- Los cambios son locales, reversibles y no modifican geometría ni fotografía.
  El profesional puede aplicarlos a una pieza o copiarlos a 13–23 mediante una
  acción explícita.
- El estado JSON pasó a versión 4. Los diseños versiones 1–3 migran agregando
  material A1 natural por defecto.
- Validado: independencia por pieza, aplicación global, cambio visible del
  gradiente, persistencia exacta, responsive y cero errores de consola.
- La paleta es orientativa y no pretende sustituir fotografía calibrada,
  espectrofotómetro ni selección clínica de tono.

---

## 2026-08-13 — Codex: familias morfológicas editor-v2 (etapa 3)

**Tocado:** `editor-v2.html`, `editor-v2.js`, `docs/EDITOR_V2_MODEL.md`.

- El laboratorio incorpora familias rectangular suave, ovalada y triangular.
  Cada familia tiene contornos diferentes para centrales, laterales y caninos;
  aplicar una familia completa no clona una sola anatomía seis veces.
- La forma puede cambiarse en una sola pieza sin modificar posición, altura,
  ancho nominal ni rotación, o aplicarse de manera simétrica a 13–23.
- RED y las siete líneas de contacto ahora calculan el ancho visible real de la
  familia activa, evitando perder proporciones al cambiar el contorno.
- El estado JSON pasó a versión 3. Los diseños versiones 1–2 migran en memoria
  y la forma heredada `natural-soft` se mapea a `rectangular-soft`.
- Validado: independencia por pieza, tres variantes anatómicas por familia,
  compatibilidad con RED y guías, persistencia y cero errores de consola.
- Sigue aislado del flujo vigente; no toca IA, prompts, Supabase, segmentación,
  simulador principal ni copias móviles.

---

## 2026-08-13 — Codex: guías clínicas funcionales editor-v2 (etapa 2)

**Tocado:** `editor-v2.html`, `editor-v2.js`, `docs/EDITOR_V2_MODEL.md`.

- Se conectaron dos curvas paramétricas al modelo: incisal y gingival. Sus
  controles recalculan las seis coronas 13–23 manteniendo intacta la fotografía.
- Se añadieron siete límites verticales de proporción (extremos y cinco
  contactos) y una regla RED configurable 62–80% que distribuye centrales,
  laterales y caninos de forma simétrica respecto de la línea media.
- El contrato JSON pasó a versión 2 e incluye `guides`. Los diseños versión 1
  se migran en memoria agregando valores clínicos predeterminados.
- Validado en navegador: dos curvas, doce puntos, siete líneas, cambio real de
  geometría, aplicación RED, persistencia exacta y presentación responsive.
- Continúa siendo un laboratorio aislado. No se modificaron el simulador
  vigente, prompts, Supabase, segmentación, IA ni las copias móviles.

---

## 2026-08-13 — Codex: prototipo paramétrico aislado editor-v2 (etapa 1)

**Tocado:** `editor-v2.html`, `editor-v2.js`, `docs/EDITOR_V2_MODEL.md`.

- Se creó un laboratorio separado del flujo público con seis piezas superiores
  FDI 13–23 como objetos SVG independientes. Cada pieza se puede seleccionar,
  trasladar, cambiar de ancho y altura incisal, rotar y restaurar sin afectar a
  las demás.
- El diseño usa un estado JSON versionado (`smyl.veneer-design`, versión 1),
  guardado/recuperado local y exportable/importable sin incluir la fotografía.
- La fotografía opcional sólo se abre en memoria. El lienzo adopta su relación
  de aspecto exacta y las coordenadas se normalizan respecto de toda la imagen,
  evitando asumir que las tomas siempre son 4:3.
- Validado en escritorio y viewport móvil: seis objetos, controles
  independientes, persistencia geométrica exacta y cero errores de consola.
- No se modificaron `simulacion.html`, prompts, Supabase, segmentación, IA ni
  copias móviles como parte de esta entrega. El prototipo se publica únicamente
  como ruta de laboratorio y no está conectado al flujo principal. No integrar
  hasta recibir aprobación visual del usuario.

---

## 2026-08-11 — Codex: la curva regenera las carillas existentes (build v80)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`, `sw.js`

- `Aplicar diseño` ya no vuelve a enviar la fotografía clínica original: usa como entrada la simulación de carillas que está visible en el editor. Así la segunda pasada modifica ese diseño en lugar de reconstruir casi el mismo resultado inicial.
- La prescripción numérica exige aterrizar cada borde incisal 13–23 en su destino, mantener fijo el margen gingival y producir una extensión o reducción visible cuando la curva difiere del contorno actual.
- La revisión del editor se identifica explícitamente como una segunda pasada; se prohíbe restablecer el contorno anterior o devolver la entrada sin cambios.
- Se añadió una comparación local del corredor dental. Si la IA devuelve prácticamente la misma banda dental, el resultado se descarta y se informa que la curva no fue aplicada, en vez de mostrar silenciosamente la misma imagen.
- Indicador visible actualizado a `build v80`; caché PWA `smyl-v23`.

---

## 2026-08-11 — Codex: curva clínica sin marcas técnicas (build v79)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`, `sw.js`

- Se eliminó la segunda imagen negra con curva magenta, puntos cian y etiquetas dentales que el editor enviaba a la IA; podía interpretarse como contenido y terminar dibujada sobre las carillas.
- La curva de sonrisa ahora se transmite exclusivamente como una prescripción numérica normalizada de los seis bordes incisales (13–23). Se fijan los márgenes gingivales y se reconstruye cada corona hacia su destino, conservando anatomía individual, dominio de centrales, laterales algo más cortos y transición canina.
- `generateSimulation()` vuelve a enviar una sola fotografía clínica y ya no incluye `guideImageBase64`.
- Se añadió una barrera local previa a la composición que busca agrupaciones cian o magenta dentro de la banda dental. Un resultado con puntos, líneas o marcas técnicas se descarta en vez de aprobarse como simulación clínica.
- Indicador visible actualizado a `build v79`; caché PWA `smyl-v22`.

---

## 2026-08-11 — Codex: lienzo móvil prioritario y pinch-to-zoom

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`, `sw.js`

- En móvil, el panel de ajustes abre recogido como una bandeja inferior de 56 px para que la fotografía ocupe la mayor parte de la pantalla; puede abrirse y cerrarse sin perder valores.
- La barra de fotografía y tamaño de guía ocupa una sola fila desplazable en vez de dos filas.
- El gesto de dos dedos ahora amplía/reduce la fotografía entre 100% y 400%, mantiene el punto focal bajo los dedos y permite trasladar la imagen durante el gesto.
- El escalado de proporciones permanece disponible mediante `Tamaño de guía`, evitando que el mismo gesto tenga dos significados.
- No se modificaron la generación, los prompts ni los parámetros clínicos.

---

## 2026-08-11 — Codex: política visual y reorganización segura del editor

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`, `sw.js`, `docs/POLITICA_IMAGEN_SMYL.md`

- Se creó una política de imagen de producto clínico/editorial para evitar el aspecto de interfaz genérica generada por IA: paleta, tipografía, fotografía, iconos, interacción, voz y lista de verificación.
- Se reorganizó el editor sin cambiar IDs ni funciones: las guías tienen encabezado propio; fotografía, movimiento, zoom y tamaño de guía quedaron en una barra independiente fuera del lienzo.
- El panel lateral ahora distingue recomendación clínica, forma y posición, proporciones dentales, color/material y ajustes avanzados de encía.
- Se retiraron emojis de los controles del editor y se sustituyeron degradados, brillos y halos por superficies sólidas y una jerarquía más sobria.
- No se modificaron prompts, generación, Supabase ni lógica clínica. Las funciones existentes conservan sus firmas y eventos.

---

Este archivo es la memoria compartida entre Codex (diseño/frontend) y Claude
Code (arquitectura/backend/infra). Ninguno de los dos agentes recuerda lo que
hizo el otro entre sesiones — así que antes de tocar algo, lee la entrada más
reciente que mencione ese archivo, y al terminar deja tu propia entrada.

Formato de cada entrada: fecha, agente, qué se tocó, qué debe saber el otro.
Las entradas más nuevas van arriba.

---

## 2026-08-11 (20) — Codex (regeneración vinculada al arco incisal)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`,
`supabase/functions/claude/index.ts`, `sw.js`.

- La regeneración desde el editor ya no comunica la curva únicamente como
  coordenadas textuales. Genera un mapa geométrico PNG temporal, normalizado
  al mismo recorte clínico, con la curva final y los seis objetivos 13–23.
- La Edge Function admite esa segunda imagen como referencia de control para
  Gemini. El prompt distingue expresamente la foto clínica (entrada 1) del
  mapa geométrico (entrada 2), exige que las coronas terminen en los objetivos
  y prohíbe reproducir líneas, puntos, etiquetas o fondo del mapa.
- La prescripción incisal pasó al inicio del bloque clínico para que nunca sea
  truncada por el límite de longitud. Mantiene márgenes gingivales fijos y
  obliga a redimensionar cada corona hacia su borde incisal.
- Indicador visible actualizado a `build v76`; caché PWA `smyl-v19`.

## 2026-08-11 (19) — Codex (calce canónico Antes/Después y panel táctil amplio)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- El comparador descarta al entrar cualquier traslación, escala o ajuste
  manual heredado de otra visita/generación. Antes y Después parten siempre
  de `{x:0,y:0,scale:1}` y ocupan el mismo rectángulo derivado exclusivamente
  de las dimensiones de la fotografía original.
- Ambas capas usan el mismo mapeo de píxeles en la vista normal; en pantalla
  completa usan `contain` en común para conservar toda la fotografía sin
  recortes ni deformaciones diferenciales.
- La curva amarilla ahora puede trasladarse libremente en X/Y. Se añadió un
  panel táctil amplio separado de la foto: permite mover la curva completa,
  ajustar el arco, los extremos o una pieza 13–23 sin que el dedo cubra la
  sonrisa. Los gestos son relativos y no producen saltos al tocar.
- Indicador visible actualizado a `build v75`.

## 2026-08-11 (18) — Codex (manija principal y control remoto del arco)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- La curva amarilla incorpora una manija central `ARCO`. Su desplazamiento
  vertical modifica la profundidad/concavidad del arco sin trasladar toda la
  sonrisa; las manijas de los extremos continúan controlando los lados.
- Se añadió un selector explícito para `Punto principal`, `Extremos` y cada
  pieza 13–23. El objetivo seleccionado permanece resaltado y se muestra en
  un estado textual para evitar ambigüedad clínica.
- El nuevo `Control remoto` permite seleccionar primero el objetivo y después
  arrastrar desde cualquier zona vacía de la fotografía. Se aplica sólo el
  desplazamiento del dedo, sin saltar la guía hasta el punto de contacto, de
  modo que el dedo no cubre la curva durante el ajuste. Puede desactivarse
  para volver al arrastre directo.
- `curvaCentroOffset` y la preferencia del control remoto se guardan con el
  caso; los casos anteriores se migran en memoria. Los seis objetivos
  normalizados enviados al regenerador ya incorporan la nueva geometría.
  Indicador visible actualizado a `build v74`.

## 2026-08-11 (17) — Codex (curva incisal vinculada al tamaño dental)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- La curva amarilla dejó de ser sólo una referencia visual: contiene seis
  objetivos incisales identificados como 13, 12, 11, 21, 22 y 23. Arrastrar
  la curva mueve el objetivo del conjunto; cada punto o su control permite
  alargar/acortar individualmente la corona dentro de ±20 %.
- El margen gingival y el punto de emergencia quedan fijos. El cambio ocurre
  únicamente hacia el borde incisal; las anchuras aparentes siguen el método
  de proporción verde elegido y centrales, laterales y caninos conservan su
  jerarquía anatómica.
- `edPrescripcionIncisalPrompt()` convierte los seis objetivos a coordenadas
  normalizadas del mismo recorte clínico enviado a la IA. El regenerador
  recibe esas coordenadas como prescripción obligatoria, sin estirar píxeles,
  segmentar dientes ni mover labios, encías, cara o arcada inferior.
- El cálculo del recorte se centralizó en `calcularRectRecorteDental()` para
  que editor y regenerador compartan exactamente el mismo sistema de
  coordenadas. Indicador visible actualizado a `build v73`.

## 2026-08-11 (16) — Codex (proporciones dentales configurables)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- La antigua guía fija `Proporción` ahora se presenta como `Proporciones` y
  conserva siete líneas verdes, pero su distribución cambia entre cuatro
  métodos: Adaptativa (RED 70 % como referencia no rígida), RED ajustable
  (62–80 %), Proporción áurea y Golden Percentage (25/15/10 por hemiarcada).
- Se separó explícitamente la distribución horizontal aparente de la relación
  ancho/alto de los incisivos centrales. Los casos guardados anteriores se
  migran en memoria a `proporcionMetodo: adaptativa` y `red: 70`.
- La opción elegida no es sólo visual: `construirPromptEditor()` envía al
  regenerador el método, sus valores y la relación ancho/alto. Las
  instrucciones de proporción se colocan primero para no quedar fuera del
  límite del bloque clínico secundario.
- La guía sigue siendo móvil, escalable con pellizco e independiente de las
  otras guías; también conserva el modo de agrupación existente. Indicador
  visible actualizado a `build v72`.

## 2026-08-11 (15) — Codex (restaura simulación continua y sólo alinea)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- Retirado del flujo rápido el filtro cromático por píxel de v70, que podía
  descartar esmalte amarillo como si fuera tejido y producir dientes sin
  cambio, fragmentos o bordes rotos.
- Restaurada la composición continua del recorte generado que previamente
  daba el resultado natural. La única corrección posterior es el registro
  automático limitado de posición, escala y giro contra el recorte original.
- No se segmentan dientes, no se crean máscaras de color y no se perfora la
  simulación. Sólo se suaviza el perímetro exterior del recorte. Control
  interno v10; indicador visible `build v71`.

## 2026-08-11 (14) — Codex (impide falso anclaje en bigote)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- Corregido un falso positivo del localizador de banda dental que podía tomar
  vello/piel del bigote como esmalte, aplicar allí la capa generada y dejar los
  dientes originales sin cambio.
- En retratos, la búsqueda y su respaldo quedan confinados a la altura real de
  la boca; la ventana final tiene un límite superior que impide alcanzar el
  bigote. Las tomas intraorales conservan un rango específico más amplio.
- El criterio de esmalte exige ahora suficiente luminancia y relaciones de
  color que admiten tonos naturales amarillos sin confundirlos con vello.

## 2026-08-11 (13) — Codex (registro automático y composición dental localizada)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- La simulación rápida continúa sin segmentación ni emparejamiento por piezas.
  Se añadió una detección geométrica de una sola banda dental continua,
  utilizada exclusivamente para centrar el resultado generado sobre la
  sonrisa original.
- La fotografía original vuelve a ser la base inmutable. De la imagen de IA
  sólo se transfiere una ventana dental continua con transición suave;
  labios, encías, piel, apertura bucal y resto del rostro permanecen formados
  por píxeles originales.
- El registro combina una alineación global limitada con una corrección final
  de traslación de la banda dental. No escala la anatomía generada, por lo que
  conserva los cambios intencionales de forma y tamaño de las carillas.
- La protección cromática interna evita copiar tejido rojo/rosado y sombras
  profundas desde la IA, reduciendo el efecto de boca elevada o de carilla
  superpuesta. Control interno actualizado a v8.

## 2026-08-11 (12) — Codex (simulación rápida directa, sin segmentación)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`, `AGENTS.md`,
`docs/CARILLAS_SIMULATION_CONTEXT.md`.

- Por decisión expresa del usuario, `generateSimulation()` ya no llama al
  segmentador antes ni después de generar, no empareja piezas y no recolorea
  dientes mediante máscaras. El tono VITA vuelve a solicitarse directamente
  dentro del prompt de imagen.
- El resultado completo del recorte clínico se integra sobre la fotografía
  maestra con un feather suave sólo en los bordes externos del recorte. Así se
  evita el aspecto gris/recortado de las carillas y se conserva fuera del
  recorte el rostro original.
- Las funciones de segmentación permanecen disponibles para el editor y sus
  herramientas opcionales, pero ya no forman parte de la simulación rápida.
- La referencia clínica/estética de carillas quedó versionada en
  `docs/CARILLAS_SIMULATION_CONTEXT.md`; `AGENTS.md` obliga a leerla antes de
  cualquier cambio futuro relacionado con simulaciones.

## 2026-08-10 (11) — Codex (separa bloqueo técnico de revisión estética)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- El control v6 sólo cancela la simulación por una ausencia real de piezas.
  Tono, textura, línea media, bordes, cobertura parcial y proporciones se
  conservan como revisión del editor, no como error para el paciente.
- Las diferencias naturales de tono entre piezas se guardan únicamente como
  métrica interna. Distancia/proporción del emparejamiento también pasan a
  advertencias, mientras que menos piezas que el original sigue bloqueando.

## 2026-08-10 (10) — Codex (emparejamiento tolerante a fragmentos extra)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- Cuando la segunda segmentación devuelve candidatos extra (por ejemplo 11
  contra 9 originales), el comparador elige la subsecuencia ordenada de menor
  costo en vez de desplazar todas las piezas por índice.
- Los sobrantes se excluyen del análisis y la máscara final se limita al
  corredor dental original. Menos piezas o una incompatibilidad anatómica
  real siguen rechazándose. Control actualizado a v5.

## 2026-08-10 (9) — Codex (corrige falso rechazo A1/piezas)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- A1 se mezcla con fuerza mínima de 82 % dentro de la máscara para eliminar
  amarillo residual sin perder la luminancia, textura ni reflejos generados.
- El control pieza por pieza ya no confunde un cambio visual conservador con
  una carilla ausente. Ahora la presencia se decide por solapamiento real de
  las máscaras original/generada y por la correspondencia anatómica previa.
- Las diferencias tonales aisladas quedan como revisión; una cobertura física
  insuficiente sigue siendo un rechazo crítico. Control actualizado a v4.

## 2026-08-10 (8) — Codex (flujo dental determinista antes/después)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- La arcada superior original se segmenta **antes** de llamar al generador.
  El conteo y orden de piezas se convierten en contrato explícito del prompt.
- El prompt de imagen quedó reducido a anatomía, cobertura y material. El
  tono VITA ya no compite con la forma durante la generación: se calibra
  después, sólo dentro de la máscara superior, conservando textura y luces.
- El resultado vuelve a segmentarse y se compara pieza por pieza con el mapa
  original. Diferencias de conteo, posición o proporción rechazan la imagen.
- Se eliminó el compositor heurístico de respaldo: si falla segmentación,
  correspondencia o control crítico, nunca se muestra una simulación parcial.
- El control visual sube a versión 3. No se consumió una generación real de
  imagen durante validación; las pruebas locales cubren sintaxis, estructura,
  sincronización móvil y limpieza del diff.

## 2026-08-10 (7) — Codex (cobertura dental completa y rechazo de carillas ausentes)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- El prompt exige contar y restaurar todas las piezas superiores visibles de
  extremo a extremo, con seis anteriores obligatorias y premolares visibles,
  además de continuidad bilateral, línea media e incisales nivelados.
- La segmentación ahora recibe original y resultado lado a lado en una sola
  inferencia. Compara las piezas esperadas con las generadas sin añadir otra
  llamada respecto al flujo anterior.
- El control local mide cambio y consistencia de color por pieza; detecta un
  diente sin carilla, menos piezas, cobertura lateral incompleta, línea media
  desplazada y centrales desnivelados.
- Los fallos críticos se muestran en rojo como `Simulación incompleta` y ya no
  pueden aparecer como aprobados. Los reportes antiguos quedan invalidados
  hasta generar de nuevo con la versión 2 del control.
- La tira de resultados muestra una sola miniatura por tipo de vista, evitando
  dos tarjetas `Frontal` para el mismo resultado.
- La prueba visual local por navegador fue bloqueada por la política para URLs
  `file://`; se mantuvieron pruebas de sintaxis, diff y sincronización.
## 2026-08-10 (6) — Codex (diseño individual por diente y control visual local)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- El prompt de simulación dejó de tratar la sonrisa como una sola zona blanca:
  define por separado centrales, laterales y caninos, sus proporciones,
  contactos, troneras, eje clínico, línea media y arco de sonrisa. Permite
  corregir el contorno coronal sin mover encía, boca, rostro ni toda la arcada.
- Las intensidades ahora se presentan como `Natural`, `Armónico` y
  `Hollywood`; incluso la última conserva anatomía individual y evita dientes
  clonados, opacos o sobredimensionados.
- La referencia visual A1 se midió desde el activo fotográfico incluido en la
  app (`sRGB 236, 234, 233`) y se describe como marfil casi neutro con calidez
  mínima, no beige ni amarillo. No sustituye una calibración clínica.
- Añadido un control automático local, sin nuevas llamadas ni costo de IA,
  que revisa cobertura, cambio real, textura óptica, amarillez A1, cantidad de
  piezas superiores, simetría central y proporción ancho/alto. Su resultado es
  orientativo y solicita revisión cuando hay indicios de error.
- El cambio rápido de tono invalida la aprobación anterior y pide comprobar
  nuevamente la coincidencia VITA y la naturalidad del esmalte.
- No se modificó backend ni se añadieron reintentos automáticos. La generación
  sigue siendo una sola llamada; la segmentación posterior limita la
  composición a las coronas superiores detectadas.
- La validación visual automatizada quedó bloqueada por el sandbox de Windows;
  se realizaron comprobaciones de sintaxis, diff y sincronización.
## 2026-08-10 (5) — Codex (elimina halo amarillo y refuerza cerámica/anatomía)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- Sustituida la transición interior de 2–4 px por antialias cercano a 1 px,
  con alfa sesgado hacia la restauración. Evita que reaparezca el esmalte
  original como contorno amarillo sin expandir la máscara sobre encía.
- El prompt exige cobertura completa de la cara vestibular, sin doble borde,
  halo amarillo ni exposición del diente viejo; refuerza centrales dominantes,
  laterales más estrechos/cortos, caninos individualizados, arco incisal y
  troneras naturales.
- El color VITA ahora se describe como cerámica ópticamente estratificada
  bajo la iluminación original: dentina cervical, cuerpo, translucidez
  incisal, mamelones, opalescencia, áreas de espejo y sombras de convexidad.
- El recorte facial de generación es más cerrado alrededor de la sonrisa para
  dedicar más resolución efectiva a la anatomía dental. La reinserción sigue
  realizándose sobre la fotografía maestra intacta.

---

## 2026-08-10 (4) — Codex (integración de carillas sin efecto de sobreposición)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- Integrado el feather interior de la máscara generado por Claude: suaviza el
  canto de recorte sin expandir píxeles sobre encía o labios.
- Endurecido el filtro de arcada superior. Si hay dos filas dentales claras,
  se separan por el mayor espacio vertical entre centros y sólo se compone la
  fila superior; FDI queda como respaldo para tomas de una sola fila.
- Si no existen ni coordenadas válidas ni identificación FDI, la simulación
  falla de forma explícita en lugar de copiar todas las máscaras y alcanzar
  dientes inferiores.

---

## 2026-08-10 (3) — Codex (carillas anatómicas: generación local de alta resolución)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- La simulación facial ya no manda la fotografía completa a generación. Se
  obtiene un recorte clínico de la sonrisa a resolución nativa, se genera y
  segmenta únicamente en ese recorte, y después se reinserta en las
  coordenadas exactas de la fotografía maestra. Esto da muchos más píxeles a
  la anatomía dental y mantiene intactos rostro, labios, encías y encuadre.
- Se eliminó la instrucción que forzaba "8 a 10" coronas, porque promovía
  dientes estrechos, repetidos y de apariencia protésica. Ahora existe
  correspondencia uno-a-uno con cada diente superior realmente visible, sin
  inventar piezas ni cambiar los dientes inferiores.
- El prompt exige jerarquía morfológica: centrales dominantes, laterales algo
  menores y caninos con transición propia; además prohíbe expresamente el
  patrón de teclas de piano/chiclets, la fila de dentadura, el blanco plano y
  los bordes incisales idénticos.
- No se realizó una generación pagada durante la validación. La prueba final
  debe hacerse con una fotografía clínica real y revisar el resultado a 100 %
  antes de usarlo como material de presentación al paciente.

---

## 2026-08-10 (2) — Claude Code (CAUSA REAL del "No se pudo generar tu simulación": segment-teeth nunca tuvo credenciales en el proyecto Smyl)

**Tocado:** `supabase/functions/segment-teeth/index.ts`, `simulacion.html`,
`mobile/www/simulacion.html`.

Tras hacer que la pantalla de error mostrara el motivo real (ver entrada
anterior), la siguiente captura del celular dijo por fin la verdad:
**`Error: supabaseUrl is required`**. Con eso el diagnóstico fue directo.

`segment-teeth/index.ts` leía sus credenciales así:
```
const SB_URL = Deno.env.get("SB_URL") || "";
```
— **solo** los secrets manuales `SB_URL`/`SB_SERVICE_ROLE_KEY`, sin caer a
`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, que Supabase inyecta sola en
toda Edge Function. Esos secrets manuales existían en el proyecto viejo
(`gfogifozhhbzxhcbecgf`) y **nunca se configuraron en "Smyl"**, así que
`createClient("", "")` reventaba en cada llamada. `_shared/auth.ts` y
`_shared/limits.ts` ya usaban el fallback correcto desde siempre — solo
este archivo se quedó atrás cuando se migró de proyecto.

**Por qué no se había notado:** hasta hace pocos días nada del flujo normal
llamaba a `segment-teeth` (solo `revision-clinica.html`, que casi no se
usaba). Los cambios recientes de Codex hicieron que la **composición de
cada simulación** la invoque, así que el bug latente pasó a romper el flujo
principal.

Arreglado con el mismo orden de preferencia que el resto
(`SUPABASE_URL || SB_URL`), más una guarda al inicio del handler que
responde un mensaje claro si faltan `SUPABASE_URL`/`SERVICE_ROLE_KEY` o
`REPLICATE_API_TOKEN`, en vez de reventar a media simulación con un error
críptico.

**Lección para la próxima:** dos rondas completas se perdieron persiguiendo
hipótesis equivocadas (cupo agotado, tope por IP) porque
`mostrarErrorProceso()` disfrazaba TODO de "problema de conexión". Ya se
corrigió para mostrar cualquier mensaje real; **no volver a meter errores
detrás de un mensaje genérico** — el costo de depurar a ciegas desde una
captura de celular es altísimo.

**Falta verificar en producción:** que `REPLICATE_API_TOKEN` esté
configurado como secret en Smyl y que el bucket `camila-masks` exista ahí
(la función lo usa para subir las máscaras). Si falta cualquiera de los
dos, la guarda nueva lo dirá claro en el mensaje de error.

---

## 2026-08-10 — Claude Code (fix: "No se pudo generar tu simulación" — el cupo del plan se agotaba 4x más rápido de lo debido)

**Tocado:** `supabase/functions/_shared/limits.ts`,
`supabase/functions/claude/index.ts`, `simulacion.html`,
`mobile/www/simulacion.html`.

Ricardo reportó que la simulación fallaba con "Hubo un problema de
conexión generando tu simulación". Al revisar el código, ese mensaje es
el **genérico por defecto** de `mostrarErrorProceso()` — solo se muestra
cuando el error NO es caída de red ni timeout. O sea: el servidor sí
estaba respondiendo con un motivo real, y la UI lo estaba disfrazando de
problema de conexión (mandando a "Reintentar" ante errores que reintentar
no arregla nunca). Tres bugs distintos, uno de ellos causa raíz:

1. **CAUSA RAÍZ — cada llamada a la Edge Function `claude` descontaba un
   "diagnóstico" del plan.** Una sola simulación hace **4+ llamadas**
   (`validarEncuadreFrontal`, `analizarConClaude`, `analyzeWithClaude`,
   `generateSimulation`), y tres de ellas están envueltas en
   `conReintento` (hasta 2 intentos cada una) → hasta **7 descuentos por
   simulación**. Un plan de 40 "diagnósticos/mes" daba ~10 simulaciones
   reales, y darle a "Reintentar" cerca del límite consumía MÁS cupo.
   Esto no se notaba antes de hoy porque el contador no se aplicaba de
   verdad (ver entrada 2026-08-05 (3): `app.html` mandaba la llave
   anónima, y el staff ni siquiera podía generar) — al arreglar eso hoy,
   el contador empezó a funcionar y se agotó rápido con las pruebas del
   día.
   **Fix:** solo `action === 'generate_image'` descuenta del plan. Las
   llamadas de análisis pasan por `checkLimitSinConsumir()` (nueva en
   `limits.ts`) que verifica clínica real/activa/con cupo pero NO
   incrementa. Para poder decidir según la acción hubo que mover el
   `req.json()` ANTES del chequeo de límite (antes iba después a
   propósito, para no parsear bodies grandes si el tenant ya estaba
   agotado — se pierde esa micro-optimización a cambio de cobrar bien).
2. **CORS incompleto para el modo prospecto** (bug que introduje yo el
   mismo día): `simulacion.html` en modo prospecto manda el header
   `X-Tenant-Id`, pero `claude/index.ts` no lo declaraba en
   `Access-Control-Allow-Headers` — el navegador cortaba la llamada en el
   preflight y el paciente veía "problema de conexión" sin que su
   conexión tuviera nada que ver. Agregado `x-tenant-id`.
3. **El error real se ocultaba.** `mostrarErrorProceso()` solo
   distinguía "Load failed" y timeouts; cualquier otro error (incluidos
   los 402 de límite de plan) caía al genérico de conexión. Ahora los
   errores que traen un motivo del servidor se marcan explícitamente
   (`errorDelServidor()`, pone `e.esDelServidor = true` en los 3 sitios
   que hacen `throw` con `data.error`) y se muestran tal cual. De paso,
   `conReintento` ya no reintenta esos errores — reintentar un "plan
   agotado" solo retrasa el aviso y gasta otra llamada.

**Ajuste de dimensionamiento relacionado:** el tope por IP del modo
anónimo son 5 llamadas/hora. Como una simulación son ~4 llamadas, un
prospecto quedaba bloqueado a media primera simulación. Se separó un
`PROSPECTO_HOURLY_LIMIT` (default 20/hora ≈ 5 simulaciones por IP) para
el modo prospecto, dejando el estricto de 5 para el anónimo puro (sin
link de clínica). El cupo del plan de la clínica sigue siendo el límite
real de gasto; el de IP es solo anti-abuso.

**Falta aplicar en producción:** redesplegar `claude`
(`supabase functions deploy claude --use-api`). `simulacion.html` se
publica solo por GitHub Pages.

**ACTUALIZACIÓN tras revisar la base de datos con Ricardo:** la hipótesis
del cupo agotado era **incorrecta** — `diagnosticos_usados` estaba en 0 de
40, plan activo y vigente, y ambas RPC (`camila_consumir_diagnostico`,
`camila_anon_rate_check`) sí existen en el proyecto Smyl. Ese 0 es la
pista real: si el contador nunca subió pese a un día entero de pruebas,
las llamadas **no estaban llegando con sesión de dentista** — caían al
camino anónimo (`tenantId` null en `requireUser`), cuyo tope era de 5
llamadas/hora por IP. Con ~4 llamadas por simulación, la segunda
simulación de cada hora se bloqueaba con "Demasiadas solicitudes sin
iniciar sesión", que la pantalla mostraba como "problema de conexión".
El tope anónimo se subió de 5 a 20/hora (≈5 simulaciones) por la misma
razón que el de prospecto. **Falta confirmar por qué la sesión no llega
al Edge Function** cuando se usa la simulación desde el celular — puede
ser simplemente que no había sesión iniciada ahí, o algo más de fondo;
revisar `camila_anon_usage` (si tiene filas con contador alto, confirma
el diagnóstico) antes de dar el tema por cerrado.

**CONFIRMADO Y CERRADO (2026-08-10):** `camila_anon_usage` tenía 3 filas,
las tres con `contador = 5` clavado en el tope — huella inequívoca de que
las llamadas entraban por el camino anónimo y se bloqueaban. Peor: un
`count` sobre `camila_casos` dio **2 huérfanos de 2 totales, 0 en la
clínica** — o sea, el 100% de las simulaciones hechas hasta ahora quedaron
fuera del panel del dentista. Se reasignaron a mano con un `update
camila_casos set tenant_id = '<id>' where tenant_id is null or tenant_id =
'local'`.

**Decisión tomada con Ricardo a raíz de eso: se ELIMINÓ el modo anónimo de
`simulacion.html`.** El "login opcional" que se había pedido en su momento
era la causa raíz de los casos huérfanos (y de que no se cargara marca ni
precios, y de que el cupo del plan nunca se cobrara). Ahora hay
exactamente dos entradas, ninguna anónima:
  1. Dentista/staff con sesión → `entrarConSesion()`.
  2. Paciente por link público `?clinica=<tenant_id>` →
     `entrarComoProspecto()` (sin cuenta, pero con clínica identificada).
Sin ninguna de las dos, `pedirSesionParaEntrar()` (reemplaza a la
eliminada `entrarSinSesion()`) bloquea la app con el overlay de login, con
un aviso amarillo explicando por qué, el botón × oculto, y
`cerrarLoginSim()` con guarda para que no se pueda esquivar.
**Ojo para quien siga:** el tope anónimo por IP (`ANON_HOURLY_LIMIT`) ya
casi no aplica a nadie con este cambio — solo quedaría para llamadas
directas a la Edge Function sin pasar por la UI. El que importa ahora es
`PROSPECTO_HOURLY_LIMIT`.

**Pendiente de confirmar con Ricardo:** cuánto cupo le queda realmente
(`select nombre, diagnosticos_usados, limite_diagnosticos, activo,
vence_en from camila_tenants;`). Si ya está en el tope, el fix de arriba
evita que se vuelva a agotar tan rápido, pero el contador actual hay que
resetearlo a mano — el consumo de hoy fue casi todo de pruebas, no de
pacientes reales.
## 2026-08-09 (4) — Codex (timeout de generación móvil)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

La espera cliente para `generate_image` subió de 110s a 150s porque la Edge
Function puede recorrer varios modelos Gemini y superar 110s con demanda alta.
Además `conReintento()` ya no repite timeouts ni errores semánticos: sólo
reintenta desconexiones reales (`Load failed`, `Failed to fetch`,
`NetworkError`). Antes un timeout podía iniciar otra generación mientras la
primera seguía corriendo, duplicando tiempo y posible costo.

---

## 2026-08-09 (3) — Codex (elimina encía roja de la simulación)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

La composición dejó de unir la máscara de dientes originales con la máscara
del resultado. Esa unión copiaba encía generada en las zonas donde cambiaba el
contorno de una corona y producía líneas rojizas entre dientes. Ahora sólo se
copia la máscara anatómica de las carillas generadas y se filtra a FDI 1x/2x
(arcada superior); la arcada inferior permanece idéntica al original.

El prompt también fija el tratamiento rápido en 8–10 carillas superiores
visibles, exige un cambio morfológico perceptible y conserva jerarquía de
centrales, laterales y caninos. El respaldo local continúa disponible si
Replicate falla, sin mostrar nunca la cara completa generada.

---

## 2026-08-09 (2) — Codex (recuperación si falla la segmentación remota)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

La segmentación anatómica con Replicate deja de ser un punto único de fallo:
si la inferencia, la descarga de máscaras o CORS falla, la generación recupera
automáticamente el compositor dental local anterior. Nunca se usa como
respaldo la cara completa generada por IA. Esto mantiene la simulación
operativa mientras se conserva la mayor precisión cuando `segment-teeth`
responde correctamente.

---

## 2026-08-06 — Claude Code (skill de Meta multi-tenant)

**Tocado:** `.claude/skills/meta-multitenant-chat/` (nuevo, solo agregado —
nada existente tocado).

Agregada una skill de referencia para conectar WhatsApp + Messenger +
Instagram en modo multi-tenant (un solo Meta App/System User "Tech
Provider" sirviendo el número/página propio de cada dentista/clínica, un
solo webhook que resuelve a qué tenant pertenece cada mensaje). Se extrajo
de una implementación real en otro proyecto (LANA), generalizada para
adaptarse a cualquier esquema de Supabase — no asume las tablas de SMYL,
hay que adaptar nombres al invocarla. Se activa sola si alguien pide
conectar WhatsApp/Messenger/Instagram, o con `/meta-multitenant-chat`. No
es una implementación — es la guía + plantillas (SQL, Edge Function,
Embedded Signup) para cuando de verdad se construya esto en SMYL.

---

## 2026-08-09 — Codex (composición dental anatómica para simulación)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`,
`supabase/functions/segment-teeth/index.ts`.

Se reemplazó la máscara heurística de color/luminancia por la unión de dos
máscaras anatómicas: dentición original + carillas generadas. Fuera de esa
unión la salida procede exclusivamente de la fotografía original. La primera
ejecución segmenta ambas vistas lado a lado en una sola inferencia; la máscara
original queda cacheada y las regeneraciones sólo segmentan el diseño nuevo.

`segment-teeth` acepta el modo prospecto mediante `X-Tenant-Id` y
`checkAndConsumeLimitProspecto`, además del límite autenticado habitual. Se
añadió `x-tenant-id` a CORS. No se modificaron secretos, buckets ni RLS.

No se ejecutó una generación real durante QA para no gastar el cupo; sí se
validó sintaxis y se desplegó la Edge Function.

---

## 2026-08-06 (3) — Claude Code (etapa 6: modo "prospecto" — pacientes se simulan su propia sonrisa desde casa)

**Tocado:** `supabase/migrations/camila_prospecto.sql` (nuevo),
`supabase/functions/guardar-lead-prospecto/index.ts` (nuevo),
`supabase/functions/_shared/limits.ts`, `supabase/functions/claude/index.ts`,
`simulacion.html`, `mobile/www/simulacion.html`, `app.html`.

Decisión del usuario: además del flujo de dentista (login obligatorio,
foto tomada EN consulta), `simulacion.html` necesita un segundo modo para
que un paciente potencial se tome su propia foto desde su casa, como
gancho de marketing/generación de leads. Se acordaron 3 decisiones de
diseño con el usuario antes de construir:
1. **Dos links distintos**, no una pantalla de elección — el dentista
   comparte un link público propio (`app.html` → tarjeta nueva "Link para
   pacientes potenciales" → `copiarLinkProspecto()`, genera
   `simulacion.html?clinica=<tenant_id>`).
2. **El lead se captura DESPUÉS de ver el resultado** (menor fricción) —
   mismo formulario que ya existía para que el dentista archive un caso
   (`#fn`/`#ft`/`#fe`/`#fn-notas`), reetiquetado en runtime.
3. **Mismo archivo, no uno aparte** — reutiliza toda la cámara/IA/
   cotización que ya existe; solo cambia el punto de entrada y el copy de
   la pantalla de resultado.

**Dos huecos de RLS reales que había que cerrar** (un prospecto no tiene
NINGUNA sesión, ni siquiera la de staff que sí resuelve `camila_es_miembro`):

1. `camila_tenants` no era legible sin sesión — sin esto, el link no
   podría mostrar ni el nombre de la clínica ni sus precios reales. Se
   resuelve con una vista nueva, `camila_tenants_publico`
   (`camila_prospecto.sql`), que expone SOLO `nombre`+`config` (nunca
   `email`/`plan`/`diagnosticos_usados`/`stripe_*`) — aprovecha que en
   Postgres una vista corre con los privilegios de quien la CREÓ, no de
   quien la consulta, así que puede exponer esas dos columnas a `anon`
   sin abrir ninguna política RLS en `camila_tenants` misma (que sigue
   100% protegida). `loadPrecios()` y la nueva `entrarComoProspecto()` la
   usan en vez de `camila_tenants` cuando `CFG.modoProspecto`.
2. `camila_casos` tampoco aceptaba INSERT sin sesión — el lead se habría
   perdido en silencio. Se resuelve con la Edge Function nueva
   `guardar-lead-prospecto` (service role, valida que el `tenant_id` sea
   real/activo antes de insertar, whitelist explícita de columnas
   aceptadas del body para que un prospecto no pueda colar columnas que
   no le corresponden). **A propósito NO se abrió una política de INSERT
   para `anon` en `camila_casos`** — esa tabla ya tuvo un episodio real de
   RLS abierta (`camila_casos_abierto_temporal`, ver entrada del
   2026-07-30) y no valía la pena repetir ese riesgo por esta función.
   Nueva columna `es_prospecto boolean` para distinguir estos casos de los
   que crea el propio dentista/staff (aditiva, no rompe nada existente).

**Tercer hueco, de gasto no de lectura:** las llamadas a la Edge Function
`claude` (análisis + generación de imagen) tampoco tenían forma de saber
"esta llamada sin sesión es un prospecto de la clínica X, aplícale SU
tope real" -- antes solo existían dos caminos (sesión real, o anónimo
genérico 5/hora/IP sin ningún tenant). Se agregó un tercero:
`simulacion.html` manda el `tenant_id` en un header `X-Tenant-Id` cuando
está en modo prospecto (`headersEdgeIA()`, nuevo helper -- las 4 llamadas
a la Edge Function `claude` ahora pasan por ahí), y `claude/index.ts` lo
usa vía la función nueva `checkAndConsumeLimitProspecto()`
(`_shared/limits.ts`) que exige **los dos** controles: el tope real del
plan de esa clínica (protege su cupo pagado, y de paso confirma que el
`tenant_id` es real) Y el tope genérico por IP encima (protege contra que
alguien intente drenar el cupo de una clínica ajena a punta de scripts
solo por conocer su link público). `segment-teeth` no se tocó -- el modo
prospecto no usa el editor clínico avanzado.

**Flujo completo en `simulacion.html`:** `checkLogin()` ahora revisa
`?clinica=<id>` ANTES que cualquier sesión -- si está presente, gana
siempre y entra a `entrarComoProspecto()` (nunca muestra el overlay de
login). El resultado final (`show('s-res')`) dispara
`aplicarCopyProspecto()` (idempotente, se reetiqueta cada vez que se
regenera/cambia tono) que cambia "Guardar en expediente" por "¿Te gustó
tu nueva sonrisa?" y el botón por "Quiero agendar mi cita". Al guardar,
`guardarCaso()` ahora bifurca: modo prospecto llama a
`guardar-lead-prospecto`, modo dentista sigue con el INSERT directo de
siempre. `showCasoGuardado()` también bifurca -- en modo prospecto no
muestra "Enviar al paciente" (el prospecto YA es el paciente) ni "Ver en
panel admin" (no tiene sesión para entrar ahí), solo la confirmación de
que su interés quedó registrado.

**Falta aplicar en producción:** correr `camila_prospecto.sql` en el SQL
Editor, y desplegar `guardar-lead-prospecto`
(`supabase functions deploy guardar-lead-prospecto --use-api`) más
redesplegar `claude` (el header `X-Tenant-Id` es código nuevo en ese
archivo). Verificar como siempre en el dashboard que se suban los
archivos correctos.

**No probado en vivo:** todo el flujo de prospecto de punta a punta
(abrir el link sin sesión, ver marca/precios reales, generar la
simulación, dejar los datos, y confirmar que el caso aparece en
Historial de `app.html` marcado `es_prospecto=true`) -- necesita las
migraciones aplicadas y las funciones desplegadas primero.

---

## 2026-08-06 (2) — Claude Code (etapa 5, corrección: chat de Meta pasa a ser multi-tenant desde el diseño)

**Tocado:** `supabase/migrations/camila_chat.sql`,
`supabase/functions/meta-send/index.ts`. `meta-webhook/index.ts` no
necesitó cambios (nunca usó un token por canal, ver abajo). Ninguno de
los 3 se había aplicado/desplegado todavía, así que se corrigieron en su
lugar en vez de crear una migración nueva encima.

**Decisión del usuario:** Smyl también debe ser multi-tenant en su
conexión con Meta, igual que su otro producto "LANA" (compartió la
arquitectura completa de LANA como referencia). Cambia el modelo de
credenciales de la entrada anterior (2026-08-06 (1)):

- **Antes:** cada fila de `camila_canales` guardaba su propio
  `access_token` -- un token por canal por clínica.
- **Ahora:** un solo **System User "Tech Provider"** con token
  **permanente** (Secret `META_TOKEN`, compartido por todas las
  clínicas) firma todas las llamadas a la Graph API. `camila_canales` ya
  NO guarda ningún token -- solo los identificadores de cuenta de cada
  clínica (`id_externo` = phone_number_id/page_id/ig_business_id, más
  `waba_id` nuevo para WhatsApp). Esto es exactamente lo que hace falta
  para que, más adelante, cada dentista pueda conectar su propia cuenta
  vía Embedded Signup sin que la plataforma tenga que guardar ni rotar un
  token por cliente.
- `meta-send/index.ts`: ya no lee `access_token` de `camila_canales`,
  usa `META_TOKEN` (env var) para las tres llamadas de envío.
- `meta-webhook/index.ts`: sin cambios -- nunca leyó ni usó un token
  (solo recibe y guarda mensajes, no manda nada), así que ya era
  compatible con el modelo nuevo sin tocar nada.
- El alta de canales SIGUE siendo manual por ahora (INSERT vía SQL
  Editor con el `phone_number_id`/`waba_id`/`page_id` real de cada
  clínica) — el autoservicio (Embedded Signup, botón "Conectar
  WhatsApp" en el panel) es una fase posterior, no bloquea probar el
  flujo completo con la clínica de Ricardo.

**Además:** se escribió y se le entregó al usuario (como archivo, no
como parte de este repo) una guía completa y portable —SQL + Edge
Functions Deno + frontend con Embedded Signup + bandeja con Realtime—
para que su OTRO programa ("LANA" u otro, tiene su propio repo/Supabase)
implemente el mismo patrón multi-tenant. Esa guía no vive en este repo a
propósito.

**Sigue pendiente, sin cambios respecto a la entrada anterior:** aplicar
la migración, desplegar las 2 funciones, configurar los Secrets
(ahora **`META_TOKEN`** en vez de guardar tokens por fila, más
`META_APP_SECRET`/`META_WEBHOOK_VERIFY_TOKEN` igual que antes), y
conseguir el token permanente del System User desde Meta (Configuración
de la Empresa → Usuarios del sistema) en vez del token temporal de 24h
de la pantalla de pruebas -- ese temporal solo sirve para probar el
handshake, no para dejarlo en producción.

---

## 2026-08-06 — Claude Code (etapa 5: chat unificado con Meta — WhatsApp/Messenger/Instagram, fase 1)

**Tocado:** `supabase/migrations/camila_chat.sql` (nuevo),
`supabase/functions/meta-webhook/index.ts` (nuevo),
`supabase/functions/meta-send/index.ts` (nuevo).
Sin tocar `app.html`/`simulacion.html`/`revision-clinica.html` todavía.

El usuario quiere un chat integrado con Meta (IG + Messenger + WhatsApp),
con dos capas: (1) bandeja unificada donde el dentista/staff responde a
mano, (2) chatbot con IA encima (lo que ya anuncia el plan Profesional
como "Chatbot de pacientes" sin que existiera). Se armó un plan completo
(compartido con el usuario como Artifact) y se empezó por lo que no
depende de que Meta apruebe nada: el modelo de datos y las dos Edge
Functions de mensajería. **Decisión de producto acordada con el
usuario:** fase 1 conecta SOLO la clínica del propio dueño de Smyl (una
app de Meta separada de LANA) — NO el modelo "cada dentista conecta su
propia cuenta" (eso requiere que Meta apruebe a Smyl como Tech
Provider/Embedded Signup, un trámite mucho más largo que no tiene caso
pedir antes de probar que el chat funciona con un cliente real).

1. **`camila_chat.sql`** — 3 tablas nuevas:
   - `camila_canales`: las cuentas de Meta conectadas por clínica
     (`tenant_id`, `canal` whatsapp/messenger/instagram, `id_externo`
     -- phone_number_id/page_id/ig_business_id según el canal --,
     `access_token`). RLS: **solo dueño** (`camila_es_dueno`), nunca
     staff — son credenciales, mismo criterio que precios/config en
     `camila_tenants`. El alta de canales hoy es manual (INSERT directo
     vía SQL Editor con el token que entrega Meta) — no hay UI de
     "Conectar WhatsApp" todavía, eso es fase futura (Embedded Signup).
   - `camila_conversaciones`: un hilo por contacto por canal. RLS:
     cualquier miembro de la clínica (`camila_es_miembro`) puede
     ver/actualizar (para atender la bandeja) — sin INSERT de cliente,
     las crea el webhook.
   - `camila_mensajes`: cada mensaje individual, con `id_externo_meta`
     para no duplicar si Meta reintenta el webhook. RLS: **solo SELECT**
     para el cliente — los INSERT siempre los hace el service role
     (`meta-webhook` para entrantes, `meta-send` para salientes), así la
     tabla es el registro real de lo que se envió/recibió de verdad, no
     de lo que alguien intentó desde el cliente.
   - **Ojo, importante:** `paciente_id` en `camila_conversaciones` es un
     `uuid` SUELTO, sin FK. `camila_pacientes` NO existe como tabla real
     en esta base de datos (confirmado por introspección directa el
     2026-08-05 — la referencia en `app.html` es del mismo patrón de
     tabla fantasma ya visto con `camila_notificaciones`/
     `camila_precios`). Una FK a esa tabla habría hecho fallar esta
     migración completa. Si algún día `camila_pacientes` se crea de
     verdad, ahí sí conviene agregar la FK.
2. **`meta-webhook`**: recibe los tres canales en una sola URL (Meta usa
   el campo `object` del payload para decir cuál es). Verifica la firma
   `X-Hub-Signature-256` (HMAC-SHA256 con `META_APP_SECRET`) antes de
   procesar nada — sin esto, cualquiera que supiera la URL podría inyectar
   mensajes falsos como si vinieran de un paciente real. Responde el
   `hub.challenge` en el GET de verificación si `META_WEBHOOK_VERIFY_TOKEN`
   coincide. Siempre responde 200 aunque falle el procesamiento interno
   (si no, Meta reintenta el mismo evento en bucle).
3. **`meta-send`**: la usa el dentista/staff desde `app.html` (cuando se
   construya esa pantalla) para responder. Verifica que la conversación
   pertenezca a su clínica (`requireUser` + comparar `tenant_id`, mismo
   patrón que el resto de las Edge Functions), llama al endpoint de Graph
   API que corresponda, y guarda el mensaje saliente.

**Falta aplicar en producción:** correr `camila_chat.sql` en el SQL
Editor, y desplegar las 2 funciones nuevas
(`supabase functions deploy meta-webhook --use-api` /
`supabase functions deploy meta-send --use-api`, verificar en el
dashboard que se suban `index.ts` + `_shared/auth.ts` para `meta-send` --
`meta-webhook` no depende de `_shared/`, no manda sesión de usuario).
Además hacen falta 3 Secrets nuevos en Supabase:
`META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` (uno inventado por
Ricardo), y configurar la URL del webhook en el dashboard de Meta
apuntando a `.../functions/v1/meta-webhook`.

**No probado en vivo, no puede probarse todavía:** ninguna de las dos
funciones se ha ejecutado contra credenciales reales de Meta — el shape
exacto de cada payload (especialmente WhatsApp `contacts`/`messages`, y
`is_echo` en Messenger/Instagram) está basado en la documentación de
Meta, no verificado contra tráfico real. Cuando Ricardo tenga la app de
Meta creada con el número de prueba de WhatsApp, hay que probar el flujo
completo antes de dar por buena la fase 1.

**Pendiente (siguiente parte de esta misma etapa):** pantalla "💬
Mensajes" en `app.html` (bandeja + hilo + responder), y después el
chatbot con IA (fase 2, reutiliza la Edge Function `claude` con un prompt
nuevo que tenga contexto de precios/horarios/FAQ de la clínica). Ver el
Artifact del plan completo compartido con el usuario el mismo día.

---

## 2026-08-05 (3) — Claude Code (fix: staff no podía generar nada — etapa 4 quedó incompleta el mismo día)

**Tocado:** `supabase/functions/_shared/auth.ts`, `supabase/functions/_shared/limits.ts`,
`supabase/functions/claude/index.ts`, `supabase/functions/segment-teeth/index.ts`,
`revision-clinica.html`, `mobile/www/revision-clinica.html`, `app.html`.
Sin migración nueva.

Una auditoría pedida por el usuario (agentes en paralelo revisando
app.html/simulacion.html/revision-clinica.html) encontró que la etapa 4
de hoy (dueño+staff) se cableó solo en el cliente de 2 de 5 puntos —
`claude/index.ts`, `segment-teeth/index.ts` y `revision-clinica.html`
seguían usando `user.id`/`auth.uid()` directo como si fuera el
`tenant_id`, cierto solo para el dueño. Efecto real antes de este fix:
un staff invitado no podía generar NINGÚN diagnóstico/simulación desde
`simulacion.html` (402 "no se encontró tu clínica"), y si daba de alta
un caso nuevo directo en `revision-clinica.html` (la puerta de entrada
principal del dentista en la app móvil) el caso se guardaba con éxito
aparente pero con un `tenant_id` que no pertenece a ninguna clínica real
— invisible para el dueño y el resto del equipo.

1. **`_shared/auth.ts`**: `AuthResult` ahora incluye `tenantId` (además de
   `user`), resuelto por una función nueva `resolverTenantId(userId)` que
   consulta `camila_usuarios` — mismo patrón que ya usaba el cliente
   (`cargarTenantConfig()` en simulacion.html, `continuarConUsuario()` en
   app.html). Para el dueño sigue siendo igual a `user.id` (comportamiento
   sin cambios); para staff resuelve la clínica de quien lo invitó.
   **Cualquier código nuevo que use `requireUser()` debe usar `tenantId`,
   nunca `user.id`, para topes de gasto, RPCs o escrituras con
   `tenant_id`** — dejé un comentario grande en la interfaz explicándolo.
2. **`_shared/limits.ts`**: `checkAndConsumeLimit()` renombró su segundo
   parámetro de `userId` a `tenantId` (mismo comportamiento, solo
   clarifica qué es realmente).
3. **`claude/index.ts` y `segment-teeth/index.ts`**: usan el `tenantId`
   resuelto por `requireUser()` en vez de `user?.id` para
   `checkAndConsumeLimit()`. En `segment-teeth` esto también corrige el
   `.eq("tenant_id", tenantId)` del `UPDATE` que guarda la segmentación —
   antes, para un staff, ese `UPDATE` nunca encontraba la fila del caso
   real (que tiene el `tenant_id` del dueño) y la segmentación se perdía
   sin error visible.
4. **`revision-clinica.html` / mobile**: `_entrarSesionClinica()` ahora es
   `async` y, justo después de fijar la sesión, consulta `camila_usuarios`
   por el `auth.uid()` de quien inició sesión — si es staff, corrige
   `tenantIdSesion`/el campo `#tenantId` a la clínica real ANTES de
   `autoCargarCasoDesdeUrl()`. Aplicado quirúrgicamente (no se copió el
   archivo completo) porque la copia móvil ya tenía otras diferencias
   pendientes de sincronizar (ver auditoría UX del mismo día) que no eran
   parte de este fix.
5. **`app.html`**: `ejecutarAnalisisIA()` y `generarBeforeAfter()` mandaban
   `Authorization: Bearer SUPA_KEY` (la llave pública) en vez del
   `access_token` de la sesión real — la auditoría confirmó que esto no
   solo evadía el tope de gasto de la etapa 1, sino que **ningún dentista
   consumía su cupo pagado real desde esas dos pantallas** (quedaban
   sujetos al tope anónimo de 5/hora sin importar su plan). Ahora ambas
   piden `sb.auth.getSession()` y usan el `access_token` real, con
   `SUPA_KEY` solo como último fallback si no hay sesión. Este fix
   dependía de los puntos 1-3 (si se hacía al revés, el staff habría
   quedado bloqueado con 402 en vez de generar sin límite).

**Falta aplicar en producción:** desplegar las dos Edge Functions
actualizadas —

```
supabase functions deploy claude --use-api
supabase functions deploy segment-teeth --use-api
```

— y verificar en el dashboard (tab Code) que se suban `index.ts` +
`_shared/auth.ts` + `_shared/limits.ts` (además de `_shared/limits.ts`
para claude/segment-teeth, ya se sabe por experiencias anteriores que
hay que confirmarlo, no basta el mensaje de "Deployed"). Los cambios de
`app.html`/`revision-clinica.html` se publican solos vía GitHub Pages.
**No pude probar en vivo** que un staff real ahora sí pueda generar un
diagnóstico end-to-end (necesito una cuenta de staff con sesión real) —
Ricardo, si tienes forma de probarlo con la cuenta que invitaste antes,
avísame el resultado.

**Pendiente de la misma auditoría, no atacado todavía** (ver el reporte
completo que se le compartió al usuario como Artifact el mismo día):
escala de "score" inconsistente (0-10 en app.html vs 0-100 en
simulacion.html), protocolo de fotos y cuestionario pre-simulación sin
ningún efecto real, `tenant_id` no determinista (`'local'` vs `null`)
para casos guardados sin sesión, `mobile/www/revision-clinica.html`
desincronizado en CSS de segmentación y de `.tooth-chip-remove`, y la
URL/key de Supabase hardcodeada 5 veces (2 de ellas dentro del mismo
archivo/función en revision-clinica.html).

---

## 2026-08-05 (2) — Claude Code (infraestructura multi-tenant, etapa 4: dueño + staff con permisos distintos)

**Tocado:** `supabase/migrations/camila_team.sql` (nuevo),
`supabase/functions/invite-staff/index.ts` (nuevo), `app.html`,
`simulacion.html`, `mobile/www/simulacion.html`.

Modelo elegido con el usuario (opción "dueño + staff con permisos
distintos", invitación **por correo** vía `admin.inviteUserByEmail`):
tabla nueva `camila_usuarios` vincula un `auth.users` a un `tenant_id` con
`rol` ('dueño'/'staff'). El dueño sigue siendo la fila cuyo
`id = tenant_id` (sin cambios ahí); el staff son cuentas NUEVAS invitadas
por el dueño desde `app.html` (tarjeta "Mi Equipo", solo visible para
dueño).

1. **RLS reescrita con dos funciones `SECURITY DEFINER`**
   (`camila_es_dueno`, `camila_es_miembro`) para evitar recursión de
   políticas. `camila_tenants` SELECT ahora acepta a cualquier miembro
   (antes solo `id = auth.uid()`) -- el staff necesita leer
   branding/precios/límite de su clínica. `camila_tenants` INSERT/UPDATE
   **no se tocó** -- sigue exigiendo `id = auth.uid()`, así que el staff
   automáticamente no puede tocar precios/config/plan sin que hiciera
   falta ninguna política nueva para eso. `camila_casos` SELECT/INSERT/
   UPDATE ahora usan `camila_es_miembro()` en vez de comparar
   `tenant_id = auth.uid()::text` directo.
   - **Ojo con esto si se toca la migración:** `camila_casos.tenant_id` es
     `text`, y `simulacion.html` en modo sin sesión a veces escribe el
     literal `'local'` ahí (`CFG.tenantId || 'local'` en `guardarCaso()`,
     confirmado leyendo el código, no soy quien lo escribió así). Un
     `tenant_id::uuid` directo en una política revienta la consulta
     COMPLETA (`invalid input syntax for type uuid`) en cuanto toca una
     fila así -- no la descarta, tira todo el `SELECT`/`INSERT`/`UPDATE`
     para cualquiera. Se agregó `camila_uuid_seguro()` (cast con
     `exception when others return null`) para blindar esto.
   - No se agregó política de `DELETE` en `camila_casos` -- ya no existía
     antes de esta migración (nadie, ni el dueño, puede borrar un caso vía
     RLS hoy), no era parte de esta etapa cambiar eso.
2. **Provisioning (`camila_crear_tenant_en_signup`, ya existía desde la
   etapa 2) actualizado**: si el signup trae `tenant_id_invitado` en
   `user_metadata` (lo pone `invite-staff`), la cuenta se une como staff a
   esa clínica en vez de crear una nueva. Si no, sigue creando su propia
   clínica como antes, y AHORA también se da de alta a sí mismo en
   `camila_usuarios` (rol dueño) -- backfill incluido para dueños que ya
   existían antes de esta migración.
3. **Edge Function nueva `invite-staff`**: valida que quien llama sea
   dueño de una clínica real, hace cumplir el tope de usuarios por plan
   (`esencial: 1, profesional: 3, premium: sin tope` -- mismos números que
   ya anunciaba `app.html` en `PLANES.*.features`, antes solo como texto
   de marketing sin ningún efecto real), y llama
   `admin.auth.admin.inviteUserByEmail` con `tenant_id_invitado` en los
   metadatos y `redirectTo: .../app.html?invite=1`.
4. **Cliente:**
   - `app.html`: `continuarConUsuario()` ahora resuelve la clínica real
     antes de leer `camila_tenants` (consulta `camila_usuarios` por el
     `auth.uid()` de quien inició sesión; si no es dueño, usa el
     `tenant_id` de ahí). Nueva variable global `miRolEquipo`. Nueva
     tarjeta "Mi Equipo" (listar/invitar/desactivar, solo dueño) en la
     pantalla de precios. Nuevo flujo `?invite=1` +
     `mostrarSetPasswordInvitado()`: cuando alguien abre el link del
     correo de invitación, supabase-js ya le crea sesión automáticamente
     (`detectSessionInUrl`) pero SIN contraseña -- se le pide ponerla
     antes de entrar (si no, quedaría sin forma de volver a entrar cuando
     expire el token). Los botones de guardar precios/config/branding se
     deshabilitan para staff (`aplicarRestriccionesStaff()`) -- no es la
     restricción de seguridad real (esa la da RLS), es solo para no
     mostrar un botón que fallaría en silencio (PostgREST no marca error
     cuando RLS descarta un UPDATE por falta de permiso, solo actualiza 0
     filas).
   - `simulacion.html`/mobile: `cargarTenantConfig()` ahora resuelve
     primero si quien inició sesión es staff (vía `camila_usuarios`) antes
     de pedir `camila_tenants` -- si no, sus casos se habrían guardado con
     un `tenant_id` que no pertenece a ninguna clínica. Se cuidó el
     timing: `CFG.tenantId` se sigue fijando SÍNCRONO de entrada (como
     antes, para no romper `checkResumePrompt()` que corre justo después
     en `entrarConSesion()`) y solo se corrige tras el fetch si resulta
     ser staff -- para cuando el flujo real llega a guardar un caso ya está
     resuelto.

**Falta aplicar en producción (yo no tengo acceso a Supabase ni a la CLI
del usuario):**
- Correr `supabase/migrations/camila_team.sql` en el SQL Editor.
- `supabase functions deploy invite-staff --use-api` (usar `--use-api`:
  la CLI de Ricardo no tiene Docker corriendo, ver la entrada del
  2026-08-04 (1) para el porqué). **Verificar en el dashboard, tab
  "Code", que se subieron los 2 archivos** (`index.ts` +
  `_shared/auth.ts`) -- ya pasó una vez que un deploy subió el código
  viejo por un `git pull` no hecho antes de desplegar, ver esa misma
  entrada.
- **No pude probar el flujo de invitación en vivo** (no tengo forma de
  recibir un correo real ni de abrir el link mágico desde este entorno) --
  Ricardo necesita probarlo de punta a punta: invitar a un correo real
  desde "Mi Equipo" en `app.html`, abrir el correo, confirmar que
  `?invite=1` muestra el prompt de contraseña y que después de eso puede
  ver/crear casos de la misma clínica del dueño.
- Si el envío de correos de Supabase Auth no está configurado con SMTP
  propio, usa el servicio compartido de Supabase (rate-limited, ya se
  usaba para confirmar cuentas nuevas per el trigger de la etapa 2) --
  puede tardar o caer en spam. No es nuevo de esta etapa, mismo mecanismo
  que ya usaba el registro normal.

**Pendiente (etapa 5, no arrancada):** observabilidad/alertas de costo.

---

## 2026-08-05 — Claude Code (bug crítico: app.html/index.html/editor.html apuntaban al proyecto Supabase abandonado)

**Tocado:** `app.html`, `index.html`, `editor.html`, `README.md`. Sin
migración — solo constantes de configuración en el cliente.

**Hallazgo, mientras se investigaba para la etapa 4 (multi-usuario):**
`simulacion.html` migró hace tiempo al proyecto real "Smyl"
(`rpxshsiwoxdbuevjjpfw`) — tiene hasta un comentario explícito diciendo
que el proyecto viejo "quedó fuera del circuito por completo". Pero
`app.html`, `index.html` y `editor.html` **nunca se actualizaron** —
seguían con `SUPA_URL`/`SUPA_KEY` del proyecto abandonado
`gfogifozhhbzxhcbecgf`. Efecto real: el login/signup, `camila_casos` y
los precios que un dentista guardaba desde `app.html` (incluida la
"etapa 3" de precios por clínica que se acababa de terminar) iban a una
base de datos que el resto de la app ya no lee — separación silenciosa de
datos entre páginas de la misma app, sin ningún error visible.

También se descubrió que el `README.md` tenía la causa raíz de la
confusión: decía "mismo proyecto que LANA: `lgjdzaqjrmmzyrenevfm`" —  eso
es un proyecto de Supabase de OTRA app, sin relación con Camila. Quien
siga ese README termina en el dashboard equivocado. Corregido.

**Fix:** las 3 páginas ahora usan `SUPA_URL = rpxshsiwoxdbuevjjpfw` con la
misma `sb_publishable_...` key que ya usaba `simulacion.html`.

**Impacto en Stripe (revisado antes de tocar nada, no bloqueaba el fix):**
`STRIPE_CHECKOUT_URL`/`STRIPE_PORTAL_URL` en `app.html` se derivan de
`SUPA_URL`, así que ahora apuntan a
`rpxshsiwoxdbuevjjpfw/functions/v1/stripe-checkout`/`stripe-portal` — pero
esas Edge Functions (más `stripe-webhook`) probablemente solo estén
desplegadas en el proyecto viejo (ver auditoría de Stripe en la entrada
del 2026-07-30, nunca se confirmó al 100% ni con qué nombre). No es
urgente porque el cobro real ya estaba deliberadamente sin terminar
(`STRIPE_PRICE_IDS` vacíos) — pero **antes de activar cobros de verdad**
hay que desplegar `stripe-checkout`/`stripe-portal`/`stripe-webhook` al
proyecto `rpxshsiwoxdbuevjjpfw` y reconfigurar sus secrets
(`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `APP_URL`) ahí, además de
apuntar el webhook de Stripe a la URL nueva.

**No tocado a propósito:** `revisionclinica.html` (sin guión) también
tiene una referencia al proyecto viejo, pero es un duplicado huérfano sin
ninguna referencia entrante en el repo (`revision-clinica.html`, CON
guión, es el archivo real y ya apunta al proyecto correcto) — no vale la
pena arriesgar tocarlo.

**Pendiente inmediato:** re-correr la introspección de esquema/RLS para
etapa 4 (multi-usuario por clínica) en el proyecto CORRECTO
(`rpxshsiwoxdbuevjjpfw`, no `lgjdzaqjrmmzyrenevfm`) — se pidió antes de
este hallazgo y salió "0 rows" porque el usuario estaba en el proyecto de
LANA.

---

## 2026-08-04 (2) — Claude Code (infraestructura multi-tenant, etapa 3: precios reales por clínica)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`, `app.html`.
Sin migración nueva — reutiliza la columna `camila_tenants.config` (jsonb)
que ya existe, mismo patrón que el branding en `config.sim`.

Decisión de producto (el usuario dijo "vamos etapa 3" sin objetar la
recomendación que le planteé, así que seguí adelante con ella, dejándolo
documentado por si hay que ajustarlo): **precios por clínica**, guardados
en `camila_tenants.config.precios` como un mapa `{id: precio}` (solo
overrides sobre `PRECIOS_DEFAULT`, igual que ya hacía el localStorage
viejo) — no una tabla `camila_precios` nueva.

- `app.html`: `guardarPrecios()` ahora hace `PATCH` a Supabase (antes SOLO
  escribía a `localStorage`, nunca llegaba a la base de datos — por eso
  `simulacion.html` nunca podía verlos). Sigue el mismo patrón que
  `guardarConfig()` ya usaba: lee `tenantData.config`, le mezcla
  `.precios`, hace `update({config})` completo (¡importante! un PATCH con
  solo `{precios:...}` habría borrado `config.sim`/branding si existiera —
  por eso siempre se manda el objeto `config` completo, mezclado). Si el
  `PATCH` falla, el `localStorage` local (que sí se sigue escribiendo)
  sirve de respaldo en ese dispositivo, con aviso claro al usuario de que
  no sincronizó.
  `getPrecios()` ahora prefiere `tenantData.config.precios` (ya cargado
  desde Supabase al iniciar sesión) sobre el `localStorage` viejo.
- `simulacion.html`/mobile: `loadPrecios()` apuntaba a una tabla
  `camila_precios` que **nunca existió** — el fetch fallaba en silencio
  (404) y siempre caía a `PRECIOS_DEFAULT`, sin importar lo que el
  dentista hubiera configurado en `app.html` (que, de cualquier forma,
  hasta este cambio tampoco llegaba a Supabase — los dos lados del bug se
  arreglan juntos). Ahora lee `camila_tenants.config.precios` con la
  sesión del dentista logueado.

**Nota para Codex, no urgente:** los dos archivos tienen listas
`PRECIOS_DEFAULT` con IDs ligeramente distintos — `app.html` incluye
`implante` y `corona` que `simulacion.html` no tiene. No es un bug nuevo
(ya eran independientes antes de este cambio) ni lo toqué: si un dentista
configura precio para `implante`/`corona` en el panel, `simulacion.html`
simplemente lo ignora (no cotiza esos dos conceptos, nunca lo hizo). Si en
algún momento se quiere que el catálogo sea exactamente el mismo en ambos
lados, avisen antes de unificarlo por si alguno de los dos ya depende de
la lista corta a propósito.

**Pendiente (etapas 4-5 del plan de infra):** decidir si hace falta
multi-usuario por clínica, observabilidad/alertas de costo. Etapas 1 y 2
(tope de gasto server-side + provisioning automático) quedaron en la
entrada del 2026-08-04 (1) — sus migraciones y el deploy de Edge Functions
ya se aplicaron en producción el 2026-08-05, ver el aviso al final de esa
misma entrada.

---

## 2026-08-04 — Claude Code (infraestructura multi-tenant, etapas 1 y 2)

**Tocado:** `supabase/migrations/camila_tenant_provisioning.sql` (nuevo),
`supabase/migrations/camila_limits.sql` (nuevo),
`supabase/functions/_shared/limits.ts` (nuevo),
`supabase/functions/claude/index.ts`, `supabase/functions/segment-teeth/index.ts`,
`simulacion.html`, `mobile/www/simulacion.html`, `app.html`.

Arranca el plan de infraestructura SaaS multi-tenant que pidió el usuario
(revisó `revision-clinica.html`/`simulacion.html` y pidió empezar por las
etapas 1 y 2 de un plan de 5 etapas discutido en el chat, no en este
archivo). Faltan las migraciones SIN APLICAR en la base de datos real — ver
abajo.

1. **Etapa 1 — tope de gasto server-side.** `claude/index.ts` (Gemini +
   Anthropic) y `segment-teeth/index.ts` (Replicate) NO validaban
   `limite_diagnosticos`/`diagnosticos_usados` en el servidor — el tope
   solo existía en el cliente, así que una llamada directa al Edge
   Function (sin pasar por la UI) generaba sin ningún límite. Nuevo
   `_shared/limits.ts` (`checkAndConsumeLimit`) llamado justo después de
   `requireUser` en ambas funciones:
   - Con sesión real: RPC `camila_consumir_diagnostico(tenant_id)` —
     UPDATE atómico (`for update` + condición) que rechaza si
     `!activo`, `vence_en` pasado, o `diagnosticos_usados >=
     limite_diagnosticos`, e incrementa en la misma transacción si pasa.
   - Sin sesión (el modo anónimo que dejamos abierto el 2026-08-01/02 por
     pedido explícito — `_shared/auth.ts` sigue sin tocarse, sigue
     dejando pasar `user: null`): tope duro de 5/hora por IP (`ANON_HOURLY_LIMIT`,
     configurable) vía RPC `camila_anon_rate_check`, tabla nueva
     `camila_anon_usage`. No reemplaza el login, solo evita gasto sin
     ningún techo si el link se comparte.
   - Ambas funciones de Postgres son `SECURITY DEFINER` con `EXECUTE`
     revocado a `anon`/`authenticated` a propósito — si quedaran
     invocables por RPC público, cualquiera podría pasar el `tenant_id`
     de OTRA clínica como parámetro y drenarle su cupo sin generar nada
     real. Solo las Edge Functions (service role) las llaman.
   - **Efecto secundario que sí toqué para evitar doble conteo**: ahora
     que el servidor incrementa `diagnosticos_usados` en cada llamada
     real, dejé de dejar que el cliente también lo hiciera con un PATCH
     de valor absoluto (`registrarDiagnosticoUsado()` en
     `simulacion.html`/mobile, y el bloque equivalente en `app.html`)
     porque esos dos escritores corriendo a la vez se pisaban entre sí
     (carrera + el valor absoluto del cliente podía revertir el conteo
     real del servidor). Ahora esas dos funciones SOLO actualizan la
     copia local en memoria (`CFG.diagnosticosUsados` /
     `tenantData.diagnosticos_usados`) para que el chequeo previo de esta
     misma sesión no deje pasar de más — ya no escriben a la base de
     datos, el servidor es la única fuente de verdad para el valor
     persistido.
2. **Etapa 2 — provisioning de tenant en el servidor.** El `INSERT` a
   `camila_tenants` después de `signUp()` corría desde el cliente
   (`simulacion.html`, `app.html`) — si fallaba (red, tab cerrado, o el
   caso ya documentado de confirmación de correo activada, donde
   `signUp()` no da sesión y RLS rechaza el insert hasta el siguiente
   login) el usuario quedaba con cuenta en Auth pero sin fila de tenant.
   `app.html` tenía un parche para recrear la fila en
   `continuarConUsuario()`; `simulacion.html` NO tenía ningún parche — un
   dentista que se registra ahí y nunca visita `app.html` se quedaba
   atorado. Nuevo trigger `camila_on_auth_user_created` (AFTER INSERT en
   `auth.users`) crea la fila automáticamente con los mismos defaults que
   ya usaba el parche de `app.html` (plan `profesional`, límite 40, vence
   en 1 mes), leyendo `raw_user_meta_data` (`nombre`/`plan`/
   `limite_diagnosticos`, ya se mandaban en `options.data` del `signUp()`
   existente — no hubo que tocar eso). `ON CONFLICT (id) DO NOTHING`, así
   que el `INSERT` client-side existente se deja tal cual — con el
   trigger la fila ya existe, ese insert simplemente no encuentra nada
   que hacer.

**ACTUALIZACIÓN 2026-08-05 — ya aplicado en producción.** El usuario
(Ricardo) corrió las dos migraciones a mano en el SQL Editor del proyecto
"Smyl" y desplegó ambas Edge Functions desde su máquina con
`supabase functions deploy claude --use-api` y
`supabase functions deploy segment-teeth --use-api` (su instalación de
Supabase CLI no tenía Docker, `--use-api` empaqueta del lado del servidor
sin necesitarlo). Ojo con algo que sí pasó y vale la pena dejar
documentado: la primera vez que corrió el deploy, su carpeta local tenía
el código de antes del 2026-08-04 (no había hecho `git fetch`/`pull` desde
el 08-01, y `git status` decía "up to date" porque eso solo compara contra
el último fetch cacheado, no contra GitHub en vivo) — el primer deploy
subió `claude`/`segment-teeth` SIN `_shared/limits.ts`, function
funcionalmente idéntica a la de antes de estas dos etapas. Se detectó
revisando el tab "Code" de cada función en el dashboard (el log de
`supabase functions deploy` no avisa de nada raro, solo lista los archivos
que sí subió) antes de darlo por bueno, se hizo `git pull` y se volvió a
desplegar — el segundo deploy sí incluyó los tres archivos
(`index.ts`, `_shared/limits.ts`, `_shared/auth.ts`). **Si alguien más
despliega Edge Functions manualmente:** después de desplegar, revisar el
tab "Code" en el dashboard y confirmar que `_shared/limits.ts` (y
cualquier otro `_shared/*` que la función importe) aparece en la lista de
archivos — no basta con que el comando diga "Deployed Functions".

**Pendiente (etapas 4-5 del plan, no arrancadas):** decidir si hace falta
multi-usuario por clínica, observabilidad/alertas de costo. Etapa 3
(precios por clínica) ya se hizo — ver la entrada de arriba
(2026-08-04 (2)). Ver el chat para el plan completo de 5 etapas si hace
falta retomarlo.

---

## 2026-08-03 — Codex (máscara dental continua, sin dientes fragmentados)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- Se corrigió la máscara estrictamente dental que podía dejar bordes dentados,
  picos y fragmentos blancos al clasificar cada píxel de manera aislada.
- La clasificación admite ahora esmalte más cálido y oscuro, manteniendo una
  exclusión explícita para el rojo dominante de labios y encía.
- Se añadió cierre morfológico para unir fragmentos y rellenar pequeños huecos
  sin expandir el contorno, seguido de componentes conexos que eliminan motas
  demasiado pequeñas para corresponder a una región dental.
- El borde continúa suavizándose solo hacia dentro; fondo PNG, dimensiones y
  alineación 1:1 permanecen iguales a la fotografía original.

## 2026-08-03 — Codex (composición estrictamente dental y empalme 1:1)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- `componerConOriginal()` dejó de copiar un óvalo completo de boca. Ahora
  construye una máscara píxel a píxel dentro de esa región y acepta solamente
  cambios con apariencia de esmalte; labios, encía, piel y barba permanecen
  tomados de la fotografía original.
- La máscara elimina motas, suaviza exclusivamente hacia dentro del diente y
  rechaza resultados vacíos o anormalmente grandes. Si falla, la aplicación
  muestra error: ya no usa la cara completa generada por IA como respaldo.
- La salida se exporta como PNG del mismo ancho y alto del original para no
  recomprimir el fondo. Cada simulación restablece la alineación a `0,0,100%`,
  pues la composición ya queda empalmada en coordenadas 1:1.
- El cambio aplica tanto a la primera simulación como a regeneraciones hechas
  desde el editor.

## 2026-08-03 — Codex (espaciado clínico de la guía de proporción)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- Las siete líneas verdes delimitan ahora seis espacios con pesos exactos y
  simétricos: `0.618 | 1.0 | 1.618 | 1.618 | 1.0 | 0.618`.
- Los pesos se normalizan al ancho actual de la guía: los extremos permanecen
  en sus bordes y la cuarta línea queda exactamente en el eje central.
- La distribución se recalcula automáticamente al cambiar tamaño mediante
  botones o pellizco; arrastre y agrupamiento permanecen intactos.

## 2026-08-03 — Codex (guía de proporción con siete líneas)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- La guía verde de “Proporción” pasa de cinco a siete líneas verticales.
- Se añadieron dos divisiones áureas intermedias, simétricas respecto al eje
  central y dentro de los límites existentes de la guía.
- El pellizco, arrastre, agrupamiento, color y brillo no cambian.

## 2026-08-03 — Codex (comparador sin recorte vertical)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- El comparador antes/después ya no limita su altura normal a `58vh`.
- La altura ahora se calcula con `ancho visible × proporción natural` de la
  fotografía original, por lo que las tomas verticales muestran también la
  barbilla, cuello y borde inferior sin recorte.
- La misma regla se reaplica al salir de “Ajustar alineación”, evitando que el
  recorte reaparezca después de usar esa herramienta.
- Original y simulación conservan exactamente la misma caja y alineación.

## 2026-08-03 — Codex (pellizco de proporción, paneo y foto original)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- La guía “Proporción” admite gesto de dos dedos: separarlos aumenta ancho y
  alto, juntarlos los reduce, manteniendo el centro de la guía y respetando
  los límites de la fotografía.
- Al ampliar la fotografía aparece disponible “Mover foto”. Mientras está
  activo, arrastrar desplaza la fotografía ampliada hasta sus bordes; las
  guías viajan con el canvas y conservan su alineación. Volver a 100% restaura
  posición y modo de movimiento.
- Se añadió “Ver original” sobre la fotografía. Alterna en un toque entre la
  toma original y la simulación, sin cerrar el editor ni perder zoom, paneo,
  guías o parámetros; el texto cambia a “Ver simulación” al comparar.
- No se modificaron prompts, backend ni lógica clínica.

## 2026-08-03 — Codex (proporción verde y zoom de fotografía)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- Las líneas de la guía “Proporción” ahora se dibujan en verde fosforescente
  (`#39FF14`) con brillo de contraste; su chip activo usa el mismo código
  visual.
- Se añadieron controles independientes de zoom para la fotografía del editor:
  `−`, porcentaje/restablecer y `+`, desde 100% hasta 300% en pasos de 25%.
- El zoom transforma conjuntamente la fotografía y las guías, conservando su
  alineación y sin reutilizar los controles de escala de la guía activa.
- El zoom vuelve a 100% cada vez que se abre el editor. No se modificaron
  prompts, backend ni lógica clínica.

## 2026-08-02 — Codex (líneas horizontales y verticales múltiples)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- Las guías “Línea media” y “Línea incisal” se presentan ahora como “Línea
  vertical” y “Línea horizontal”. Los controles clínicos del panel conservan
  sus nombres porque siguen alimentando el prompt de regeneración.
- Las líneas se dibujan en blanco, con sombra de contraste, y abarcan toda la
  altura o anchura de la fotografía. Las horizontales inclinadas también
  alcanzan ambos bordes de la imagen.
- Se pueden agregar y eliminar líneas verticales u horizontales adicionales.
  Cada una tiene estado, posición, selección y persistencia independientes;
  el agrupamiento incluye dinámicamente todas las líneas visibles.
- Compatibilidad: los casos anteriores reciben `lineasExtra: []`. No se
  modificaron prompts, backend ni lógica clínica.

## 2026-08-02 — Codex (manija de curvatura de sonrisa)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- La guía “Curva sonrisa” incorpora una manija naranja en el extremo derecho.
  Al arrastrarla verticalmente, los dos extremos de la curva suben o bajan de
  forma simétrica mientras el punto central permanece fijo.
- Arrastrar el resto del canvas conserva el comportamiento anterior: mueve la
  guía activa o todas las visibles cuando están agrupadas. La manija ajusta
  únicamente la curva, incluso con las guías agrupadas.
- El ajuste se guarda en `EDITOR_PARAMS.curvaExtremos`; los casos anteriores
  reciben `0` y conservan exactamente la geometría visual previa.
- No se modificaron prompts, backend ni lógica clínica.

## 2026-08-02 — Codex (guías independientes y agrupables)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- Línea media, línea incisal, curva de sonrisa y proporción dejaron de
  compartir la única `zone`: cada una conserva ahora su propia posición y
  escala dentro de `guideZones`.
- La última guía tocada queda marcada como objetivo; arrastrar o usar `+/-`
  modifica solamente esa guía mientras las demás permanecen fijas.
- Se añadió “Agrupar guías”. Al activarlo, las guías visibles se trasladan y
  escalan juntas conservando su separación; al desagrupar vuelven a editarse
  individualmente.
- Compatibilidad: los casos anteriores inicializan las cuatro zonas desde la
  antigua `zone`. No se modificaron prompts, backend ni lógica clínica.

---

## 2026-08-02 — Codex (guía VITA dentro del editor)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- Se reemplazó el `<select>` “Escala de color (VITA)” del editor por una
  guía visual horizontal con las 14 muestras de `VITA_CLASSICAL` que ya usa
  SMYL, incluyendo fotografía de la carilla, logotipo y código.
- La selección actual queda resaltada, se centra al elegirla y actualiza
  `EDITOR_PARAMS.diseno.vita`, por lo que el tono elegido se conserva en el
  prompt existente al regenerar.
- Se mantiene la opción “Conservar el tono de la simulación actual”. No se
  modificaron prompts, backend, Supabase ni recursos clínicos.

---

## 2026-08-02 — Codex (regeneración visible desde el editor)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- Causa de “Regenerar no hace nada”: `show()` sólo quitaba `.active` de
  `.screen`, mientras el editor es `.ed-screen`. El resultado podía
  actualizarse por debajo y el editor permanecía cubriéndolo.
- `show()` ahora cierra tanto `.screen` como `.ed-screen`, lo que también
  corrige el botón de cerrar del editor.
- El botón superior “Aplicar diseño” ahora muestra “Generando...” y se
  bloquea junto con el botón inferior hasta terminar o fallar la llamada.
- No se modificaron prompts, Edge Functions, Supabase ni lógica clínica.

---

## 2026-08-02 — Codex (acceso visible al editor)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- Se detectó que `#s-editor` y `abrirEditorDiseno()` existían, pero ninguna
  acción visible invocaba la función; por eso el editor morfológico era
  inaccesible desde el flujo normal.
- Se agregó en la pantalla de resultado, antes de “Revisión clínica
  avanzada”, el botón principal “Editar diseño de carillas”. Abre el editor
  existente donde se controlan forma, tamaño, proporción, textura y tono.
- No se cambió la lógica de generación, prompts, backend ni Supabase.

---

## 2026-08-02 — Codex

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

**Por pedido explícito del usuario** se amplió la simulación para que forma y
tamaño se basen en un análisis visible facial, dentolabial y dental, además del
tono VITA:

- `CLAUDE_ANALISIS_SYSTEM_PROMPT` ahora devuelve forma recomendada (circular,
  triangular o rectangular), tamaño relativo, relación ancho/alto de centrales,
  línea de sonrisa, corredores bucales, soporte labial y caracterización. La
  posición de reposo debe marcarse `no_valorable` cuando la foto sonriendo no
  permite medirla; no se inventan medidas.
- `construirPromptGemini()` incorpora anatomía primaria, secundaria y
  terciaria, estratificación cerámica, mamelones, halo incisal, zonas de espejo
  y sombra, microtextura y periquimatos moderados. Se reforzó no modificar
  labios, encías, mordida, apertura, iluminación ni encuadre.
- El editor muestra una tarjeta de recomendación faciodentolabial y permite
  aplicarla. Se agregaron controles de forma, tamaño 88–112%, relación
  ancho/alto 70–90% y caracterización superficial.
- Casos guardados antes de estos campos reciben defaults compatibles.
- No se modificaron Edge Functions, base de datos ni configuración nativa.
  Sintaxis validada en web y móvil. La revisión visual automatizada quedó
  impedida porque el navegador aislado no puede acceder a `file://` ni al
  servidor local del host.

---

## 2026-08-01 — Codex

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- Agregada `recolorearDientes(imagenBaseUrl, colorObjetivoRgb)`: recoloración
  local con Canvas 2D para reutilizar una simulación ya generada y aplicar
  tonos VITA sin nuevas llamadas de red o IA.
- La máscara combina la elipse de boca solamente como zona de búsqueda con
  clasificación por luminosidad/saturación/matiz, limpieza de ruido,
  componentes conectados y feather interior para excluir labios, encía y
  piel.
- La máscara se guarda en caché por imagen para que los siguientes tonos sólo
  recompongan el color. No se modificaron `VITA_CLASSICAL`,
  `vitaLabPantallaSim`, `labARgbSim` ni `shade.color`.
- Validación de sintaxis aprobada en las copias web y móvil. La función queda
  disponible para conectarla desde la interfaz que permita cambiar el tono de
  una simulación ya generada.

---

## 2026-07-31 (3) — Claude Code

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

**Por pedido explícito del usuario** (para reducir aún más el riesgo de que
`claude` Edge Function se pase del límite de tiempo de la plataforma, y
porque tiene sentido clínico aparte): se invirtió el orden del flujo.

- `processPhotos()` ya NO llama a `analyzeWithClaude()` (el diagnóstico
  completo — score/hallazgos/plan/cotización, hasta 6 fotos en una sola
  llamada, la más lenta y pesada) de forma automática. Sigue llamando a
  `analizarConClaude()` (1 sola foto, análisis de proporciones faciales
  solo para afinar el prompt de generación) y luego `generateSimulation()`
  igual que antes — el paciente ve su simulación más rápido, sin esperar el
  diagnóstico.
- Nuevo botón "Solicitar diagnóstico" en la pantalla de resultado (`#s-res`)
  — nuevo `<div id="diag-request-box">` (CTA, visible cuando `S.diagnosis`
  es `null`) y `<div id="diag-content">` (envuelve el score-banner/
  hallazgos/plan/cotización que ya existían, oculto hasta que hay
  diagnóstico). Nueva función `solicitarDiagnostico()` llama a
  `analyzeWithClaude()` bajo demanda y `renderDiagnostico()` (extraída del
  antiguo `showResult()`) pinta el resultado.
- **`analyzeWithClaude()` sigue leyendo `S.photos`** (las fotos originales
  "antes"), nunca `S.result`/`S.results` (las simulaciones generadas) — no
  hizo falta guardar nada nuevo para esto, el estado ya los mantenía
  separados; solo había que mover CUÁNDO se llama, no arreglar una fuga de
  qué foto se manda.
- **No toqué** `guardarCaso()` (Guardar en expediente) — ya toleraba
  `S.diagnosis` nulo (`d = S.diagnosis || {}`, guarda 0/arrays vacíos), así
  que un dentista puede seguir guardando un caso con solo la simulación,
  sin pedir diagnóstico primero. Si eso no es lo que se quiere (forzar a
  pedir diagnóstico antes de guardar/compartir), es una decisión de
  producto aparte, no la tomé por mi cuenta.
- Textos del loader (`ps3`/`ps4` en `#s-proc`) actualizados — ya no dicen
  "Generando diagnóstico clínico"/"Calculando cotización" (ya no pasa en
  ese paso) sino "Ajustando proporciones faciales"/"Aplicando el tono de
  tus carillas".

**Si Codex toca `#s-res`, `showResult`, `renderResPhotos` o el CSS de
`.cta-box`/`.score-banner`**: ojo con el nuevo `#diag-request-box`/
`#diag-content` — son hermanos dentro de `.res-body`, y `renderDiagnostico()`
alterna cuál se muestra según `S.diagnosis`.

---

## 2026-07-31 (2) — Claude Code

**Tocado:** `supabase/functions/claude/index.ts`.

**CAUSA REAL encontrada** (con datos del dashboard de Supabase, no
especulación): en Invocations, cada POST real a la función `claude`
devolvía **503** (100% de las veces), mientras que los OPTIONS (preflight)
daban 200 normal. 503 = la plataforma mató la función por pasarse de su
límite de **2 segundos de tiempo de CPU real por invocación** — límite fijo
en TODOS los planes de Supabase (Free y Pro), no cuenta el tiempo esperando
a Anthropic/OpenAI (eso es I/O), solo cómputo real. Todo lo que se ajustó
antes (entrada (1) de hoy, y los timeouts de la sesión anterior) apuntaba a
límites de *tiempo de espera*, que nunca fueron la causa real.

**Corregido:** en `generate_image`, la conversión de la foto de base64 a
bytes usaba `Uint8Array.from(atob(str), c => c.charCodeAt(0))` — itera el
string como iterable (no por índice) e invoca una función por cada
carácter; para una foto de ~1MB en base64 son ~1M llamadas lentas, capaces
de agotar los 2s de CPU por sí solas. Reemplazado por un for indexado con
`charCodeAt(i)`, mucho más rápido para el JIT.

**Agregado:** marcas de tiempo (`performance.now()`) en cada paso del
handler (después de `requireUser`, después de `req.json()`, después de
serializar el body para Anthropic con su tamaño en KB, después del fetch,
después de parsear la respuesta). Si la función se vuelve a matar, el log
va a decir exactamente hasta dónde llegó — ya no hace falta seguir
adivinando.

**Si esto no resuelve el 503 del todo:** lo más probable es que el cuello
de botella esté en el parseo/serialización del JSON cuando van las 6 fotos
juntas (`analyzeWithClaude` en `simulacion.html`, ~1-2MB de body). La
solución en ese caso sería reducir el tamaño de las fotos que se mandan a
analizar (resolución/calidad más baja específicamente para el análisis, no
para lo que ve el paciente) — no se tocó todavía porque falta confirmar con
las marcas de tiempo si de verdad es ahí donde se va el CPU.

**Desplegado:** commit `01c263a`, pusheado. Falta que el usuario corra
`supabase functions deploy claude` y pruebe de nuevo.

---

## 2026-07-31 (1) — Claude Code

**Tocado:** `supabase/functions/_shared/auth.ts`.

**Contexto:** falla persistente en producción — la generación se quedaba
"Tardó demasiado" y en DevTools aparecía como "CORS error" (proceso de la
Edge Function muerto por el propio límite de la plataforma, sin devolver
headers). Ya se había agregado un `fetchConTimeout` (AbortController, 90s)
alrededor de las llamadas a Anthropic/OpenAI en `claude/index.ts`
(commit `c56e309`), pero la falla siguió idéntica después de desplegarlo.

**Causa encontrada:** `requireUser()` en `_shared/auth.ts` llama a
`admin.auth.getUser(jwt)` **antes** de que el código con el `fetchConTimeout`
llegue a ejecutarse, y esa llamada no tenía ningún límite de tiempo propio.
Si esa llamada específica se cuelga, la plataforma mata el proceso antes de
que el fix anterior siquiera entre en juego — explica por qué el síntoma no
cambió nada después de ese primer fix.

**Fix:** `Promise.race` con un timeout de 8s alrededor de
`admin.auth.getUser(jwt)`. Si se tarda, ahora responde 401 con CORS
("No se pudo verificar la sesión a tiempo...") en vez de dejar que la
plataforma corte el proceso a ciegas.

**Desplegado:** commit `dcd7938`, pusheado. **Falta que el usuario corra
`supabase functions deploy claude` de nuevo** (este archivo es compartido,
así que se despliega junto con la función `claude`) y pruebe otra vez —
no confirmado en vivo todavía.

**Si esto tampoco resuelve el "CORS error" real:** el siguiente paso es
obtener los logs reales de la Edge Function desde el dashboard de Supabase
(Project → Edge Functions → claude → Logs) durante una falla en vivo —
nunca se logró ver un log real de una invocación fallida en esta sesión,
todo el diagnóstico fue por síntomas del lado del navegador (DevTools).

---

## 2026-07-30 (5) — Claude Code

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

**Por pedido explícito del usuario** (y porque coincide con las fallas de
generación que reportó ese mismo día -- ver entradas de chat, probablemente
varias llamadas paralelas a OpenAI en calidad alta agotando tiempo/cuota):
`processPhotos()` ya NO genera automáticamente la simulación de las 6
vistas en paralelo -- **solo genera la frontal**. Las demás (perfiles,
extraoral, intraoral, 3/4) quedan sin generar hasta que el dentista/
paciente elige esa vista y le da "Generar esta vista" (mismo botón que
"Generar de nuevo", ahora con etiqueta dinámica según si la vista ya tiene
resultado). Claude sigue analizando las 6 fotos igual que antes (no cambió
`analyzeWithClaude()`) -- esto solo afecta qué vistas se mandan a generar
imagen con OpenAI.

Funciones tocadas: `processPhotos()` (ya no hace el `Promise.all` de las 6
vistas), `cambiarVistaBA()` (ya no bloquea con alert al cambiar a una vista
sin generar -- muestra la foto "antes" en ambos lados del slider),
`renderResPhotos()` (marca "· sin generar" en la miniatura), nueva
`actualizarBotonGenerar()` (cambia la etiqueta del botón), y
`regenerarSimulacion()` (ahora también llama a `registrarDiagnosticoUsado()`
-- toda generación real de imagen cuenta contra el límite del plan, no solo
la automática).

**Si Codex toca la pantalla de resultados (`#s-res`, `renderResPhotos`,
`cambiarVistaBA`, el botón `#btn-regenerar`)**: ojo con este flujo -- ya no
todas las vistas tienen `S.results[view]` poblado por default, el código
que las use debe tolerar `null`.

---

## 2026-07-30 (4) — Claude Code

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- **Límite de plan (`limite_diagnosticos`/`diagnosticos_usados`) no se
  aplicaba en el flujo principal.** Solo `app.html` (su propia herramienta
  de análisis, aparte del flujo de simulación) lo hacía cumplir.
  `simulacion.html` — el que de verdad genera con Claude + OpenAI en cada
  foto, el gasto real de IA — no chequeaba ni incrementaba nada. Se agregó:
  `cargarTenantConfig()` ahora también trae `plan/limite_diagnosticos/
  diagnosticos_usados/activo`; `processPhotos()` bloquea con alert si ya se
  agotó el límite (antes de generar, no después); `registrarDiagnosticoUsado()`
  incrementa el contador tras una generación exitosa.
- **Esto sigue siendo enforcement del lado del cliente**, igual que en
  `app.html` — no hay nada en el Edge Function `claude` que verifique el
  límite server-side. Alguien que llame al Edge Function directamente
  (con una sesión válida, ya no se puede sin login) podría saltárselo. No
  agregué el enforcement server-side porque implica una decisión
  de producto que no me correspondía tomar sola (¿qué cuenta como "un
  diagnóstico"? ¿la simulación completa de un caso, o cada foto/vista
  generada por separado? `simulacion.html` genera hasta 6 fotos por caso).
  Queda pendiente si se quiere cerrar del todo antes de lanzar cobros reales.

### Auditoría de Stripe (sin tocar código, solo lectura)

`stripe-checkout`/`stripe-portal`/`stripe-webhook` están bien escritos
(verifican firma, no exponen secrets), pero el cobro real está
deliberadamente sin terminar: `STRIPE_PRICE_IDS` en `app.html` están vacíos
a propósito (ya hay un aviso puesto: "Falta terminar de configurar el
cobro"). Antes de activarlo de verdad falta, como mínimo:
- Precios reales de Stripe (decisión de negocio, no técnica).
- Confirmar que `stripe-checkout`/`stripe-portal` estén desplegadas con ese
  nombre exacto (la última vez que pude ver el proyecto real antes de que
  el conector se desconectara, solo vi `checkout` y `stripe-webhook`
  desplegadas, no `stripe-checkout`/`stripe-portal` — sin confirmar 100%,
  el conector se cayó a media revisión).
- `stripe-webhook` tenía `verify_jwt: true` a nivel de plataforma de
  Supabase -- Stripe no manda un JWT de Supabase en sus webhooks, así que
  es probable que Supabase rechace los eventos antes de que la función los
  procese. Hay que desactivar esa verificación para ese endpoint específico.
- `APP_URL` (usado para success/cancel/return de Stripe) tiene un valor por
  defecto que no es ningún dominio real del proyecto -- hay que configurar
  el secret real.

---

## 2026-07-30 (3) — Claude Code

**Tocado:** `simulacion.html`, `supabase/functions/claude/index.ts`,
`supabase/functions/segment-teeth/index.ts`,
`supabase/functions/_shared/auth.ts`, `supabase/migrations/camila_tenants.sql`,
base de datos del proyecto Supabase "Smyl".

Se resolvieron los 2 pendientes que había dejado abiertos en la entrada
anterior:

1. **`camila_tenants` no existía** — se recreó (migración
   `supabase/migrations/camila_tenants.sql`, ya aplicada en vivo) con el
   esquema exacto que `simulacion.html`/`index.html`/`app.html` ya
   asumían: `id` (= auth.uid() del dentista), `nombre`, `email`, `plan`,
   `limite_diagnosticos`, `diagnosticos_usados`, `activo`, `vence_en`,
   `config` (jsonb), más `stripe_customer_id`/`stripe_subscription_id` que
   `stripe_billing.sql` ya asumía. RLS: cada dentista solo ve/edita su
   propia fila. También corregí `cargarTenantConfig()` en simulacion.html,
   que le mandaba el anon key en vez del token de sesión (con RLS activo,
   nunca iba a poder leer nada así).
   - **`camila_precios` sigue sin existir, a propósito no la toqué**: el
     único lugar que la lee (`loadPrecios()` en simulacion.html) no manda
     `tenant_id` en el query y ya cae de forma segura a `PRECIOS_DEFAULT` si
     falla — pero el editor de precios en `app.html` (`guardarPrecios()`)
     solo guarda en `localStorage`, nunca en Supabase. O sea que aunque
     recreara la tabla, nunca se llenaría con nada real: la función de
     "precios por clínica" está a medio construir entre estos dos archivos
     y no coinciden en el diseño. Esto necesita una decisión de producto
     (¿precios son por tenant? ¿cómo se sincronizan?) antes de tocar
     código — no lo inventé por mi cuenta.
2. **Acceso anónimo a los Edge Functions que gastan dinero real** —
   `_shared/auth.ts` (`requireUser`) aceptaba explícitamente la publishable
   key sin sesión como fallback ("por pedido explícito" según el comentario
   viejo). Se revirtió: ahora cualquier llamada sin una sesión válida se
   rechaza con 401. Afecta a `claude` (Anthropic + OpenAI) y `segment-teeth`
   (Replicate) — las dos únicas funciones que importan este archivo
   compartido. Ya desplegadas (`claude` v18, `segment-teeth` v13).

**Si Codex ve errores 401 en algún flujo que antes "funcionaba sin login"**:
es esperado, era el hueco de seguridad que se cerró. Si hace falta un modo
de acceso sin cuenta para algo específico (demo pública, por ejemplo), debe
diseñarse aparte (token de un solo uso con alcance limitado), no reabriendo
el fallback anónimo genérico.

---

## 2026-07-30 (2) — Claude Code

**Tocado:** `simulacion.html`, `revision-clinica.html`,
`supabase/functions/segment-teeth/index.ts`, `mobile/www/*.html`, base de
datos y Storage del proyecto Supabase "Smyl" (rpxshsiwoxdbuevjjpfw).

Se cerró el hallazgo de seguridad de la entrada anterior — confirmado en
vivo y arreglado, no solo documentado:

1. **`camila_casos` (RLS)** — tenía políticas `qual: true` para `anon`
   (SELECT/INSERT/UPDATE) más una política extra `camila_casos_abierto_temporal`
   con acceso total para `anon` y `authenticated`. Cualquiera con la
   publishable key (visible en el código fuente del cliente) podía leer o
   escribir cualquier caso de cualquier clínica. Se reemplazaron por
   políticas que exigen `tenant_id = auth.uid()::text`, solo para
   `authenticated` — coincide con lo que el resto del código ya asumía
   (`app.html`, `revision-clinica.html` ya filtran así, solo la política
   real no lo exigía).
2. **Buckets `camila-fotos` y `camila-masks`** — estaban marcados `public =
   true` (fotos/simulaciones de pacientes reales accesibles sin login, sin
   expiración, con URLs semi-predecibles). Ahora `public = false`. Existía
   una política `camila_fotos_insert_own_folder` que en teoría ya exigía que
   la carpeta raíz = `auth.uid()`, pero el código subía a `casoId/...` (no
   `tenantId/casoId/...`), así que nunca cuadraba y alguien había dejado
   `storage_camila_abierto_temporal` (anon+authenticated, acceso total)
   como parche. Se corrigió la causa raíz:
   - `simulacion.html` (`subirResultadoAStorage`) y `revision-clinica.html`
     (`generarSimulacionIA`, `subirFotoLocal`) ahora suben a
     `{tenantId}/{casoId}/...` y piden una URL FIRMADA (`firmarUrlStorage()`,
     ~1 año de expiración) en vez de construir `/object/public/...` a mano.
   - `segment-teeth/index.ts` ahora usa `createSignedUrl()` en vez de
     `getPublicUrl()` para las máscaras (corre con service role, no le
     afecta RLS). Ya desplegado (v12).
   - Storage RLS: política de SELECT/UPDATE nueva para `camila-fotos`
     (misma condición de carpeta). `camila-masks` no tiene políticas para
     `authenticated` a propósito — solo la Edge Function (service role) la
     toca.

**Si Codex toca `subirResultadoAStorage`, `subirFotoLocal`,
`generarSimulacionIA`, o cualquier lugar que construya una URL de Storage a
mano (`/object/public/...`)**: ya no funciona así, el bucket es privado.
Usar `firmarUrlStorage(path)` (existe en ambos archivos) en vez de armar la
URL directamente.

**Efecto secundario esperado:** `revision-clinica.html` tenía un modo
"login opcional" (si no hay sesión, caía a la publishable key). Ese modo ya
no puede leer/escribir `camila_casos` ni Storage sin sesión real —
requerirá login siempre que no venga de una sesión ya iniciada en
`simulacion.html`/`app.html` (incluida vía localStorage compartido, que es
el caso normal). Es un cambio de comportamiento intencional, no un bug.

**Pendiente, NO resuelto, decisión del usuario:**
- `supabase/functions/_shared/auth.ts` (`requireUser`) acepta explícitamente
  la publishable key sin sesión como fallback ("por pedido explícito").
  Esto significa que cualquiera con la URL puede seguir gastando créditos
  reales de Anthropic/OpenAI/Replicate llamando a los Edge Functions
  directamente, aunque ya no pueda guardar el resultado en la base de datos.
  No se tocó porque fue una decisión explícita anterior del usuario y afecta
  costos — necesita su confirmación antes de revertirlo.
- Tablas `camila_tenants` y `camila_precios` (usadas por
  `simulacion.html`/`app.html` para registro de clínica, branding y
  precios) **no existen** en la base de datos real. Registro de clínica
  nueva y refresco de precios/marca probablemente fallan en silencio ahora
  mismo. No se tocó — es un problema funcional aparte, no de seguridad.
- Otros hallazgos de `get_advisors` (no relacionados a SMYL, pertenecen a
  otro proyecto/negocio que comparte cuenta de Supabase): `landing_catalogo`
  sin RLS, y varias tablas con RLS activo pero sin políticas
  (`creditos_usuarios`, `historial_uso`, `programas`, `registros`). Fuera de
  alcance, no tocado.

---

## 2026-07-30 (1) — Claude Code

**Tocado:** `simulacion.html`, `revision-clinica.html`, `mobile/www/*.html`

- Arreglado: "Ajustar alineación" no se guardaba — el modo pantalla completa
  usaba `object-fit:contain` y la vista normal `object-fit:cover`, así que
  el ajuste se veía movido al salir. Ahora ambos modos usan el mismo
  `object-fit`/`object-position`. Si Codex toca CSS de `.ba-wrap`,
  `.ba-fullscreen`, `.ba-base img` o `.ba-over img`, cuidado con reintroducir
  ese mismo mismatch.
- Reforzado el prompt de generación de IA (en ambos archivos) para evitar
  que tonos VITA oscuros cambien el color/iluminación del resto de la foto.
- Creado este archivo y `AGENTS.md` — reparto de trabajo: Codex = diseño/
  frontend, Claude = todo lo demás (backend, Supabase, IA, seguridad, móvil).

**Pendiente / en curso:** auditoría de seguridad de Supabase (RLS, Storage
público) — ver hallazgos abajo, no confirmados aún contra la base de datos
real porque el conector de Supabase no está habilitado en esta sesión.

### Hallazgo de seguridad (evidencia en código, no confirmado en vivo)

El bucket `camila-fotos` se usa con URLs `/storage/v1/object/public/...`
(ver `subirResultadoAStorage()` en simulacion.html y el equivalente en
revision-clinica.html) — esto implica que el bucket está configurado como
**público**: cualquiera con el link puede ver la foto sin autenticarse, sin
expiración. Esto incluye simulaciones generadas de pacientes reales.
Recomendación: mover a bucket privado + URLs firmadas con expiración. No se
ha tocado el código todavía porque cambia el contrato de cómo
`revision-clinica.html` consume esas URLs — requiere coordinarlo antes de
implementar.

También pendiente de confirmar en vivo: si la política RLS de `camila_casos`
(que ya exige `auth.uid()`, ver comentario en `CFG` de simulacion.html)
realmente limita cada dentista a ver solo sus propios casos vía `tenant_id`,
o si cualquier cuenta logueada puede leer casos de otro tenant.
## 2026-08-15 — Etapa 7: proveedor de imagen experimental controlado

**Tocado:** `supabase/functions/claude/index.ts`,
`docs/AI_COST_CONTROL.md`, `docs/AI_IMAGE_AB_HARNESS.md`

- Gemini sigue siendo el proveedor predeterminado de producción.
- Se añadió GPT Image 2 como candidato explícito mediante
  `imageProvider: "openai"`, sin fallback ni reintentos automáticos.
- La ruta candidata exige usuario profesional autenticado, API key y
  `OPENAI_IMAGE_EXPERIMENT_ENABLED=true`; las validaciones ocurren antes de
  consumir el límite del plan.
- El contrato de respuesta mantiene `source`, `model` y telemetría de
  generación; además registra el `x-request-id` del proveedor cuando existe.
- El experimento utiliza `/v1/images/edits`, entradas `image[]`, calidad media
  y un timeout configurable de 45 s (máximo 55 s).
- Se documentó un harness ciego de 20+ casos, rúbrica clínica, fallos críticos,
  métricas de costo/latencia y criterios de migración/rollback.

**Importante:** desplegar el código no activa OpenAI. La bandera permanece
apagada si el Secret no existe. No exponer un selector al paciente.

**Despliegue verificado:** Edge Function `claude` versión 47, activa y con su
configuración existente `verify_jwt=false`. `OPENAI_API_KEY` está configurada,
pero `OPENAI_IMAGE_EXPERIMENT_ENABLED` no existe, por lo que el candidato sigue
apagado. Prueba de humo sin foto y sin sesión: `HTTP 403` con “La prueba OpenAI
requiere una sesión profesional”; se rechaza antes del límite y del proveedor.

---

## 2026-08-21 — Limpieza funcional y revisión harness de simulación

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`, `sw.js`

- Se simplificó la selección VITA: la decisión principal y su CTA permanecen
  visibles; acabado, intensidad y comparación pasan a un bloque avanzado.
- Las cinco tomas opcionales se identifican como documentación, sin sugerir que
  el caso está incompleto ni empujar generaciones pagadas adicionales.
- La pantalla de espera ya no expone nombres de proveedores internos.
- El gate comercial del resultado queda reservado al enlace prospecto y no
  interrumpe al profesional autenticado.
- La revisión automática usa lenguaje orientativo y evita declarar una
  aprobación clínica definitiva.
- Se corrigió el aislamiento del progreso: clave por clínica + usuario; el modo
  prospecto usa almacenamiento de sesión y cerrar sesión borra el avance activo.
- Se corrigió el bloque de acciones de casos para que se restaure al iniciar un
  paciente nuevo y el mensaje de WhatsApp sin diagnóstico ya no envía campos
  vacíos ni una cotización de cero.
- No se tocaron prompts, Edge Functions, RLS, Storage ni configuración nativa.
- La revisión completa quedó documentada en
  `artifacts/simulacion-harness/2026-08-21-product-cleanup/`.

**Pendiente separado:** política visible de conservación/borrado de fotografías,
validación server-side de cuotas/consumo y prueba real autenticada de cámara, IA,
nube y envío al paciente.

---

## 2026-09-19 — Claude Code — 402 mal clasificado como falta de cupo

**Síntoma reportado:** la generación fallaba con "No hay simulaciones
disponibles / Revisa el plan de la clínica" pese a haber acreditado usos
adicionales en Supabase.

**Causa real:** el tenant tenía `vence_en` en el pasado. Tanto
`_shared/limits.ts` como la RPC `camila_consumir_diagnostico` evalúan
`plan_vencido` ANTES que `limite_alcanzado`, así que el cupo nunca se
consultaba: acreditar usos no podía desbloquear nada.

**Por qué se confundió:** `clasificarErrorParaUsuario()` en `simulacion.html`
colapsaba cualquier HTTP 402 en el mensaje de falta de cupo, descartando el
texto que el backend sí manda y que `leerRespuestaEdge()` ya dejaba en
`error.message`. Los cuatro motivos (`tenant_no_encontrado`, `plan_inactivo`,
`plan_vencido`, `limite_alcanzado`) se veían idénticos en pantalla.

**Tocado:** `simulacion.html` + copia en `mobile/www/`
(`clasificarErrorParaUsuario`), y pruebas en
`tests/simulation-blueprint.test.mjs` para los cuatro motivos.

**Sin tocar:** no se modificó ningún dato en Supabase. El vencimiento del
plan es una decisión de facturación y quedó pendiente de autorización.

---

## 2026-09-24 — Fotografías propias sin ejemplos precargados en la PWA

**Tocado:** `simulacion-rapida.html`, copia en `mobile/www/`, `sw.js` y pruebas.

- Los accesos a pacientes sintéticos y al par frontal + intraoral de ejemplo
  quedan ocultos en la PWA normal; solo aparecen con `?debugUI=1`.
- La opción visible para el profesional continúa siendo `Cargar mis fotos ·
  frontal + intraoral`, con un archivo propio por cada vista.
- Si una versión anterior dejó guardado un caso con fotografías sintéticas, el
  progreso se descarta automáticamente para que no vuelva a mostrarse como si
  fueran fotografías elegidas por el usuario.
- Caché actualizado a `smyl-v100-no-synthetic-resume` y copia móvil sincronizada.
- Suite completa de pruebas aprobada. No se enviaron fotografías ni se consumió IA.

---

## 2026-09-24 — Bloqueo de conteo dental entre intraoral y frontal

**Tocado:** `visual-simulation.js`, `simulacion-rapida.html`, copias en
`mobile/www/`, `sw.js`, `supabase/functions/claude/index.ts` y pruebas.

- Nuevo contrato `visual-preview-v3-tooth-lock` con referencia
  `same-patient-master-v2`.
- La intraoral maestra es autoritativa para identidad, orden, límites
  interproximales y proporciones relativas de los dientes correspondientes.
  Se prohíbe fusionar 11–21, absorber un lateral, dividir una pieza o sustituir
  dos dientes estrechos/superpuestos por una corona sobredimensionada.
- La frontal sigue siendo autoritativa para rostro, labios, encía, oclusión,
  iluminación y perspectiva. Si está borrosa, la IA debe resolver límites desde
  la intraoral en lugar de inferirlos del desenfoque.
- La guía intraoral ahora se ajusta completa con `contain`; antes `cover` podía
  recortar dientes laterales/caninos en fotografías con distinta proporción.
- Caché actualizado a `smyl-v101-cross-view-tooth-lock`; copias móviles
  sincronizadas y suite completa aprobada.
- Edge Function `claude` desplegada en producción como versión 78, `ACTIVE`,
  `verify_jwt=false`, con `_shared/limits.ts` y `_shared/auth.ts` incluidos.
- No se generó ninguna simulación ni se consumió cupo durante la validación.

---

## 2026-10-11 — Etapa 1 del chat: activar LANA y conectar Meta desde SMYL

**Tocado en SMYL:** `smyl-connections.js/.css` y copia móvil,
`lana-connection`, nueva función `lana-channels`, migración
`20261011200000_lana_automatic_provisioning.sql`, contrato, documentación y
pruebas.

**Tocado en LANA:** `camila-api`, nueva función `smyl-provision`, nueva función
`smyl-channel-setup`, autorización temporal compartida para los tres conectores,
`smyl-channel-connect.html`, migración
`20261011190000_smyl_channel_onboarding.sql`, `config.toml` y pruebas.

- El dueño de la clínica puede activar LANA automáticamente. La llamada es
  servidor-a-servidor, usa una Idempotency-Key estable y la API key nunca llega
  al navegador. LANA busca claves nuevas por SHA-256 y mantiene un fallback
  exclusivo para filas legacy en texto plano.
- SMYL muestra el estado real de WhatsApp, Messenger e Instagram y abre una
  ventana LANA para cada conexión. El token de preparación vive diez minutos,
  está limitado a tenant + canal, se guarda solo como hash, viaja en fragmento
  y se consume en el primer intento.
- OAuth, Embedded Signup, tokens, webhooks, conversaciones y mensajes continúan
  en LANA. SMYL recibe únicamente estado público y el resultado de conexión.
- El flujo manual por código permanece como compatibilidad para cuentas LANA
  existentes. No se implementó una desconexión aparente: continúa pendiente
  hasta contar con revocación autorizada y auditable.
- No se desplegó ni se conectó una cuenta real. Antes de producción: aplicar
  ambas migraciones, configurar los secrets en los dos proyectos, desplegar las
  funciones/página y completar App Review, permisos, redirect URI, webhooks y
  Unified Onboarding v4 en Meta.

---

## 2026-10-11 — Etapa 4 del chat: medios y Ficha clínica 360

**Tocado en SMYL:** `smyl-inbox.js/.css` y copia móvil, `lana-inbox`, helper de
conexión LANA, migración `20261011230000_lana_clinical_message_links.sql`,
contrato, arquitectura, documentación y pruebas.

**Tocado en LANA:** `camila-api`, contrato de Inbox, migración
`20261011230000_smyl_inbox_media_context.sql`, TODO/contexto de agente y pruebas.

- El Inbox admite imagen, documento, audio, ubicación confirmada, respuesta
  citada, reenvío, destacado y soft-delete, respetando capacidades del canal.
- Los archivos permanecen privados en `salud-adjuntos`; LANA entrega URL
  firmadas por cinco minutos y no devuelve rutas internas al navegador.
- La Ficha 360 consulta el paciente/caso confirmado en SMYL y muestra cita,
  simulación, propuesta y fotografías cuando existen. No copia el expediente ni
  el historial de LANA.
- Una fotografía sólo entra a revisión clínica tras revalidar el mensaje
  canónico en LANA; SMYL persiste únicamente IDs de referencia con RLS e
  idempotencia.
- Verificación local: checks de Deno y sintaxis aprobados, 19 pruebas enfocadas
  aprobadas y revisión visual responsive en escritorio/móvil con datos simulados.
- No se aplicaron migraciones, no se desplegaron Edge Functions y no se publicó
  la PWA. Las acciones clínicas deterministas de citas/propuestas/seguimientos
  continúan en la etapa 5.

---

## 2026-10-11 — Etapa 5 del chat: SMYL Asistente y Copilot

**Tocado en SMYL:** `smyl-inbox.js/.css` y copia móvil, `lana-inbox`, versiones
de activos web/PWA, contrato, arquitectura, documentación y pruebas.

**Tocado en LANA:** `camila-api`, `whatsapp-webhook`, `meta-webhook`, helper de
reanudación, contrato de Inbox, migración
`20261011240000_smyl_assistant_copilot.sql`, TODO/contexto de agente y pruebas.

- El Inbox agrega Copilot interno con borradores y resúmenes construidos desde
  el hilo canónico; usar un borrador no lo envía.
- SMYL construye en servidor un snapshot dental de sólo lectura. LANA valida
  tenant, actor, asignación, capacitación publicada y consumo antes de llamar
  a IA; el navegador no aporta historial confiable ni autorización clínica.
- El catálogo de herramientas refleja humano, agenda configurada, servicios
  publicados y resultado autorizado sólo tras una acción profesional previa.
  Copilot no ejecuta ninguna herramienta ni modifica expediente, citas o
  capacitación.
- Reanudar LANA requiere revisar y confirmar un resumen; la transición se
  guarda de forma atómica, idempotente y auditada. Los tres webhooks consumen
  ese traspaso sólo en la primera respuesta posterior y sin tratarlo como una
  autorización. El feedback de respuestas es atribuible e inmutable y no se
  publica como conocimiento automáticamente.
- Verificación local: checks de Deno de `camila-api` y los tres webhooks,
  sintaxis del puente aprobada; 13 pruebas enfocadas de LANA, 78 regresiones
  relacionadas de webhooks y 12 pruebas enfocadas de SMYL aprobadas, incluida
  PostgreSQL embebida. Revisión visual responsive aprobada en escritorio y
  móvil con datos simulados.
- No se aplicó la migración, no se desplegaron Edge Functions y no se publicó la
  PWA. La salida a producción requiere autorización expresa y piloto controlado.

---

## 2026-10-14 — Etapa 2 del chat: disponibilidad dental verificable

**Tocado:** `smyl-inbox.js/.css` y copia móvil, `lana-inbox`, migración
`20261014030000_smyl_inbox_availability.sql`, fixture de QA y pruebas.

- El equipo puede consultar desde la conversación espacios reales por servicio,
  sucursal y profesional. La respuesta considera duración y buffers del
  servicio, horarios de clínica y profesional, asignación profesional-servicio,
  citas activas y bloqueos de agenda.
- La consulta se calcula en servidor con la agenda dental canónica, queda
  limitada a 31 días y 30 resultados, y exige `schedule.read`. La función SQL
  sólo está disponible para `service_role` y no crea reservas ni modifica citas.
- Elegir un espacio únicamente agrega un texto revisable al borrador. No envía
  mensajes, no promete disponibilidad y advierte que el horario se confirma
  después de que el paciente elija.
- Web y móvil quedaron sincronizados. La revisión visual automatizada no pudo
  ejecutarse porque el navegador aislado rechazó archivos y servidor locales;
  se agregó un escenario determinista al fixture para completar esa revisión en
  cuanto el entorno permita abrirlo.
- No se aplicó la migración, no se desplegó `lana-inbox` y no se publicó la PWA.
  Antes de producción se requiere revisión visual manual, aplicar la migración,
  desplegar la función y ejecutar una prueba real con agendas superpuestas.

---

## 2026-10-14 — Etapa 3 del chat: elección y confirmación de cita

**Tocado:** `smyl-inbox.js/.css` y copia móvil, `lana-inbox`, migración
`20261014040000_smyl_inbox_appointment_confirmation.sql`, fixture y pruebas.

- Un integrante con `schedule.manage` puede marcar que el paciente eligió un
  espacio. Esa primera acción crea una solicitud pendiente vinculada a la
  conversación, paciente, servicio, sede y profesional; todavía no crea cita.
- Confirmar requiere una segunda acción humana. La función privada vuelve a
  validar el horario bajo bloqueo transaccional y crea la cita, evento y
  recordatorio de 24 horas de forma atómica. Si el espacio cambió, rechaza la
  operación y obliga a consultar disponibilidad nuevamente.
- Ambos pasos son idempotentes, están limitados al tenant y exigen que la
  conversación ya tenga un paciente canónico vinculado. Las RPC sólo se
  conceden a `service_role`; el navegador no puede insertar solicitudes o citas
  directamente.
- Registrar o confirmar no envía mensajes. `Agregar al borrador` continúa como
  acción independiente y revisable por el equipo.
- Verificación local: sintaxis web/móvil aprobada, 10 pruebas enfocadas y 287
  pruebas completas aprobadas. La revisión visual automatizada sigue pendiente
  por el bloqueo del navegador aislado a recursos locales.
- No se aplicó la migración, no se desplegó `lana-inbox` y no se publicó la PWA.

---

## 2026-10-15 — Etapa 4 del chat: continuidad visible de Agenda

**Tocado:** `smyl-inbox.js/.css` y copia móvil, `lana-inbox`, fixture y pruebas.

- El panel lateral del chat muestra la última elección de Agenda con estado
  pendiente, confirmado, cancelado o cerrado, además de servicio, fecha,
  profesional y sede. La información se arma en servidor exclusivamente desde
  el vínculo paciente-conversación y tablas canónicas de SMYL.
- La consulta exige `schedule.read`, está limitada al tenant y no lee ni copia
  conversaciones desde LANA. Los usuarios sin acceso a Agenda no reciben esa
  continuidad.
- `Preparar confirmación` y `Preparar seguimiento` sólo colocan texto revisable
  en el compositor. El botón respeta `messages.respond`, la asignación del hilo
  y las reglas existentes de WhatsApp; nunca envía por sí solo.
- El contexto se actualiza al abrir el hilo, registrar una elección y confirmar
  una cita. Web y móvil permanecen idénticos.
- Verificación local: sintaxis aprobada, 9 pruebas enfocadas y 291 pruebas
  completas aprobadas. La revisión visual automatizada continúa pendiente por
  el aislamiento del navegador respecto de recursos locales.
- No requiere otra migración distinta de las etapas 2 y 3. No se desplegó
  `lana-inbox` ni se publicó la PWA.

---

## 2026-10-15 — Etapa 5 del chat: alternativas para el paciente

**Tocado:** `smyl-inbox.js/.css` y copia móvil, documentación y pruebas.

- Desde una consulta real de disponibilidad, el equipo puede elegir hasta tres
  horarios. La selección conserva servicio, sede, profesional y hora exactos;
  una búsqueda nueva elimina opciones anteriores para evitar sugerencias
  obsoletas.
- `Preparar opciones para el paciente` construye un borrador numerado que pide
  responder con la opción preferida y aclara que la clínica confirmará después.
  No aparta espacios, no registra solicitudes y no envía mensajes.
- La acción exige que el usuario pueda operar la conversación y tenga
  `messages.respond`. Después de la respuesta del paciente se utiliza el doble
  control existente: `Paciente eligió` y luego `Confirmar cita`.
- Web y móvil son idénticos y el pie de selección se adapta a pantallas pequeñas.
- Verificación local: 8 pruebas enfocadas y 295 pruebas completas aprobadas. La
  revisión visual automatizada continúa pendiente por el bloqueo de recursos
  locales en el navegador aislado.
- No requiere migración ni despliegue adicional de Edge Functions. No se publicó
  la PWA.

---

## 2026-10-15 — Publicación del flujo de citas desde Mensajes

- Se aplicaron y registraron en producción las migraciones `20261014030000` y
  `20261014040000`.
- Se verificaron en la base remota las operaciones privadas de disponibilidad,
  solicitud y confirmación; `lana-inbox` quedó activa en su versión 15.
- La entrega se integró sobre la rama pública más reciente, conservando los
  cambios posteriores de costos, materiales y operaciones clínicas.
- La PWA avanzó a `smyl-v245-inbox-appointments`; web y móvil cargan
  `smyl-inbox.js?v=16`, `smyl-inbox.css?v=13` y la capacitación de canales v12.
- Verificación final: 354 de 354 pruebas aprobadas, sin crear citas ni modificar
  expedientes reales.

---

## 2026-10-15 — Mensajes como centro profesional de atención

**Tocado:** `smyl-inbox.js/.css`, copias móviles, PWA, pruebas y documentación.

- La cabecera resume conversaciones por atender, mensajes sin leer y casos que
  ya están en atención humana; son conteos derivados de la bandeja actual.
- En escritorio se abre una sola vez la conversación prioritaria al cargar. La
  vista vacía conserva un botón explícito para continuar y explica el flujo en
  tres pasos.
- Cada hilo expone una barra de trabajo con Agenda, Expediente, Cotización y
  Cobro. Agenda usa la disponibilidad canónica ya implementada; las demás
  acciones reutilizan los módulos profesionales existentes y no duplican datos.
- Se amplió el espacio de conversación y Ficha 360, con adaptación específica
  para escritorio, tableta y celular. Web y móvil permanecen idénticos.
- PWA: `smyl-v247-inbox-professional`, `smyl-inbox.js?v=17` y
  `smyl-inbox.css?v=14`.
- Verificación local: sintaxis aprobada, 18 pruebas enfocadas y 362 pruebas
  completas aprobadas. No se modificó backend, esquema ni datos reales.

---

## 2026-10-15 — MILA voz y consumibles: piloto productivo

**Tocado:** `mila.html`, `consumos.html`, panel web y móvil, tres Edge
Functions de MILA, medición de WhatsApp/IA, migración
`20261015160000_mila_core_and_consumables.sql`, documentación y pruebas.

- MILA Transcribe graba con consentimiento explícito, mantiene activa la
  pantalla cuando el dispositivo lo permite, guarda el audio en un bucket
  privado y produce transcripción y nota clínica estructurada para revisión.
- MILA Conversa utiliza OpenAI Realtime desde una sesión efímera. Puede buscar
  pacientes y opciones reales de la clínica, pero una cita o cotización sólo se
  ejecuta después de mostrar una tarjeta de confirmación al usuario.
- Las citas se guardan en `smyl_appointments` con validación de disponibilidad,
  servicio y permisos. Las cotizaciones se crean únicamente como borrador en
  `smyl_proposals`, con precios del catálogo y un plan clínico vigente revisado.
- Se creó el módulo Consumos para minutos de MILA, mensajes de WhatsApp y
  créditos de IA. El piloto registra el uso de forma idempotente; los productos
  siguen inactivos y sin precio y `SMYL_CONSUMABLES_ENFORCED=false`, por lo que
  todavía no bloquea funciones ni realiza cobros.
- Producción: migración aplicada y registrada; bucket `mila-audio` confirmado
  privado; `mila-realtime-session`, `mila-transcribe`, `mila-actions`,
  `meta-send` y `analizar-foto` desplegadas y activas. Las cinco rechazaron una
  prueba sin credenciales con HTTP 401.
- Verificación local: 8 de 8 contratos específicos de MILA y 391 de 391 pruebas
  del repositorio aprobadas en ejecución serial. Web, PWA y fuente móvil quedan
  sincronizados para la publicación.

---

## 2026-10-16 — Política visual SMYL v2 aplicada

**Tocado:** sistema compartido de tokens y ventanas, Agenda dentro de Mensajes,
copias móviles, PWA, fixtures y contratos visuales.

- Se creó `smyl-design-system-v2.css` como fuente canónica de color, tipografía,
  espacio, radios, foco, elevación y movimiento reducido para SMYL Operativo.
- El sistema compartido de ventanas adopta títulos de 18 px, controles de 36 px,
  radio de 12 px, acción primaria azul, fondo sin desenfoque y tamaños oficiales
  S/M/Workspace; en móvil conserva controles táctiles de 44 px y campos de 16 px.
- “Agendar cita” quedó como patrón de referencia: cabecera sin decoración
  redundante, contexto paciente-clínica, tres filtros esenciales, fechas bajo
  divulgación progresiva, tamaño automático sin espacios vacíos y agenda de hasta
  960 px sólo cuando existen resultados.
- Cada horario es seleccionable como una unidad accesible; el pie aparece sólo
  con selección y concentra una sola acción: agregar opciones al mensaje.
- QA visual revisada en escritorio y 390 × 844; web y móvil están sincronizados.
  La PWA avanzó a `smyl-v252-visual-policy-v2`, con Inbox v26/CSS v21 y sistema
  de ventanas CSS v2.
- Verificación final: 427 de 427 pruebas aprobadas. No se modificaron backend,
  esquema, credenciales ni datos clínicos reales.

## 2026-10-22 — Claude — Agenda: hueco clicable, línea de ahora, hora a 15 min
- `smyl-schedule.js` v15 / `.css` v10 (web + `mobile/www`): etiqueta "+ Nueva cita · hora" al pasar
  sobre un hueco de la vista Día, línea roja de la hora actual, bloques con color del profesional,
  y la hora precargada en Nueva cita se redondea a 15 min (antes `17:02` fallaba el `step=900`).
- Pendiente (requiere backend): tiempo adicional por cita (+15/+30/+60). `smyl_create_appointment`
  y `smyl_validate_service_appointment_slot` fuerzan `fin = inicio + duración del servicio`.

## 2026-10-22 — Claude — Tiempo extra por cita (UI + migración pendiente de aplicar)
- `smyl-schedule.js` v19 / `.css` v13: selector "Tiempo extra" en Nueva cita (envía `p_extra_minutes` sólo si > 0) y
  chips +15/+30/+60/Quitar en la ficha de la cita (`smyl_set_appointment_extra`).
- Migración `supabase/migrations/20261022120000_smyl_appointment_extra_time.sql` **sin aplicar ni probada contra Postgres**.
  Proyecto SMYL = `rpxshsiwoxdbuevjjpfw` (la herramienta de Supabase de la sesión no tiene acceso a él).
  Se aplica con el workflow manual `.github/workflows/smyl-agenda-tiempo-extra-migracion.yml`
  (Actions > Run workflow; requiere el secreto `SUPABASE_ACCESS_TOKEN`). Hasta entonces, usar el extra da error.

## 2026-10-22 — Claude — Agenda (vista Día): arrastrar para estirar y mover citas
- `smyl-schedule.js` v21 / `.css` v15: en la vista Día, el asa del borde inferior de cada cita vigente estira
  el tiempo (bloques de 15 min, nunca menos que la duración del tratamiento, máx. +240) con
  `smyl_set_appointment_extra`; arrastrar el cuerpo de una cita confirmada la mueve de hora con
  `smyl_reschedule_appointment` (misma columna/profesional; sólo mouse, en táctil se usa "Cambiar horario").
  Etiqueta en vivo con la duración u hora nueva. Errores del servidor (choques, horario) se muestran y la cita vuelve a su lugar.
- Sin probar en navegador real todavía (sólo sintaxis y pruebas de texto).

## 2026-10-25 — Codex — Mensajes: espacio de trabajo clínico simplificado

- Se reorganizó Mensajes como una superficie de tres zonas: bandeja priorizada, conversación principal y Ficha 360 bajo demanda. La información secundaria queda oculta hasta solicitarla para reducir carga visual.
- La cola muestra estado y responsable como señales operativas principales; la conversación amplía su ancho, mejora la lectura de mensajes y unifica herramientas, redacción y envío en un solo compositor.
- La acción principal cambia según el contexto del paciente y el menú “Nueva acción” concentra agenda, expediente, cotización y cobro respetando las capacidades activas del rol y el alcance operativo.
- Ficha 360 abre como panel lateral accesible, conserva foco y contexto entre actualizaciones, se cierra con Escape y en móvil ocupa la pantalla completa sin generar desplazamiento horizontal.
- Se reforzó la actualización en segundo plano: continúa consultando novedades mientras el usuario escribe, pero difiere el repintado visual para no interrumpir la respuesta.
- Web y fuente móvil quedaron sincronizadas en `smyl-inbox.js?v=37` y `smyl-inbox.css?v=35`; no hubo cambios de base de datos, funciones, credenciales ni datos clínicos.
- Verificación: 71/71 contratos de Mensajes y 46/46 contratos adyacentes aprobados; revisión visual en 1440, 1024, 768, 390 y 320 px sin desbordamiento. La suite completa aprobó 609/610; el único fallo corresponde a un contrato previo de MILA sobre `mobile/www/index.html`, archivo ajeno a esta entrega y ya modificado antes de iniciarla.

## 2026-10-25 — Codex — Formulario profesional y vista previa refinados

**Tocado:** `smyl-professional-directory.js/.css`, carga web/PWA, sincronización
móvil, pruebas de contrato y QA visual.

- El paso Identidad se reorganizó en fotografía, identidad profesional,
  credenciales/enlace y mensaje principal. Conserva los mismos nombres de campo
  y la RPC de guardado; no cambia esquema ni backend.
- Cuando sólo existe un profesional se eliminan la columna lateral y el resumen
  de equipo redundantes, dejando más espacio al formulario y a la vista previa.
- La fotografía se elige desde un avatar accesible y aparece inmediatamente en
  el formulario y en la vista previa.
- La vista previa ahora reproduce una ficha pública completa con hero, acciones,
  experiencia, idiomas, disponibilidad, tratamientos y presentación; nombre,
  especialidad, titular, bio y datos clave responden mientras se escribe.
- Se añadió una adaptación específica para tableta y móvil sin desbordamiento
  horizontal. QA visual aprobada a 1440, 1024 y 390 px.
- Web y `mobile/www` usan `smyl-professional-directory.js/.css?v=11`. El script
  `mobile/scripts/sync-web.js` ya incluye este módulo y `dentista.html` para evitar
  divergencias futuras.
- Verificación local: sintaxis aprobada y 15 de 15 pruebas enfocadas aprobadas.

## 2026-10-25 — Codex — Recuperación robusta del enlace LANA

- Se corrigió el falso bloqueo de Canales e IA: la verificación ya no consulta
  conversaciones; usa el endpoint autenticado y ligero `/contract`, con 25 s de
  margen para arranque en frío.
- `lana-connection` distingue credencial rechazada de incidencia transitoria.
  Sólo un 401/403 cambia el enlace a `requiere_atencion`; timeout, 429, 5xx o
  transporte conservan el estado previo y permiten reintentar sin crear otra
  integración.
- La función `lana-connection` fue desplegada en el proyecto SMYL
  `rpxshsiwoxdbuevjjpfw`. No hubo migraciones ni cambios de secretos.
- La interfaz ya no muestra “Activar” junto con “Verificar”. En estado de
  atención ofrece Verificar y, bajo divulgación progresiva, Reemplazar enlace.
  También agrega timeouts por operación, reconciliación tras una demora,
  cancelación de consultas obsoletas y reintento explícito de canales.
- Web y móvil quedaron sincronizados en `smyl-connections.js?v=13` y
  `smyl-connections.css?v=8`; PWA `smyl-v263-lana-connection-recovery`.
- Verificación: sintaxis aprobada, 13/13 pruebas enfocadas y 645/645 pruebas del
  repositorio aprobadas.

## 2026-10-26 — Claude — Seguridad P0 de la auditoría (alta de staff, XSS del Historial, vista pública)
Origen: `docs/AUDITORIA_ROBUSTEZ_SEGURIDAD_ESCALABILIDAD_SMYL_2026-10-26.md`.
- **P0-1 alta como staff de otra clínica:** migración `20261026230000_smyl_security_staff_invitations.sql`
  (usa `smyl_staff_invitations` + trigger `camila_crear_tenant_en_signup` que solo une como staff
  con invitación vigente, un solo uso, 14 días) y `invite-staff` actualizada (registra la invitación antes de
  invitar y la retira si el correo falla). **Aplicada en producción** junto con el despliegue de `invite-staff`.
- **P0-3 vista pública:** migración `20261026220000_smyl_security_public_tenant_view.sql`; `camila_tenants_publico`
  entrega solo `config.sim` y `config.precios` (lo único que leen `simulacion*.html`). Sigue listando id+nombre.
- **P0-2 XSS almacenado:** `app.html` (Historial, detalle del caso, "últimos casos" y PDF) escapa `telefono` y
  pasa score/totales/piezas por `smylNum`; `guardar-lead-prospecto` valida tipos y tamaños, limita el body
  (12 MB) y no deja pisar un caso existente de otra clínica (409). Copia móvil sincronizada.
- El workflow manual `.github/workflows/smyl-seguridad-p0-migracion.yml` conserva el procedimiento de recuperación/reaplicación.
- Verificación: ambas migraciones y la lógica del trigger se probaron en un Postgres real en memoria (PGlite):
  con el trigger original un atacante quedaba como staff de la clínica víctima; con el nuevo queda como dueño de
  su propia clínica; la invitación legítima funciona, es de un solo uso y vence. Pruebas en
  `tests/security-p0-audit-2026-10-26.test.mjs` (**695/695** en la suite integrada).
- Pendiente (siguiente fase de la auditoría): S2-S10, CSP, CI, etc. S1 quedó conciliado y aplicado en esta entrega.

## 2026-10-26 — Claude — S1: el dueño ya no puede editar su cuota/plan (auditoría)
- Migraciones `20261026240000_smyl_security_tenant_quota_guard.sql` y `20261026250000_smyl_security_signup_plan_guard.sql`: trigger `camila_proteger_cuota_tenant` sobre
  `camila_tenants` (BEFORE INSERT OR UPDATE). Solo restringe a las peticiones con rol `authenticated`/`anon`:
  UPDATE conserva plan, limite_diagnosticos, diagnosticos_usados, activo, vence_en, stripe_*, id y created_at
  (`nombre`, `email` y `config` siguen editables, que es lo único que escribe la app). INSERT desde el cliente:
  plan canónico (esencial/profesional/premium; otro -> profesional), límite derivado del plan (15/40/100),
  usados=0, vencimiento <= 1 mes, sin stripe_*. No afecta a `service_role` (stripe-webhook, Edge Functions), a
  `postgres` ni a las funciones SECURITY DEFINER (consumo de cuota de `camila_limits.sql`, trigger de alta).
- El trigger de alta `camila_crear_tenant_en_signup` ya no toma `limite_diagnosticos` del metadato del signup y
  valida `plan`; conserva la invitación verificada por el servidor.
- Se probó en un Postgres real en memoria (PGlite): PATCH malicioso bloqueado, `nombre`/`config` editables, webhook
  de Stripe (service_role) y consumo definer funcionan, INSERT malicioso saneado, RLS intacta, migración reaplicable.
- Workflow `smyl-seguridad-p0-migracion.yml` ahora aplica y verifica las cuatro migraciones conciliadas (idempotente).
- Las migraciones `20261026240000` y `20261026250000` quedaron aplicadas en producción; el guard de cuota y el alta profesional segura están activos.
- Decisión de producto que NO cambió: al registrarse se puede elegir cualquier plan (incluido premium) con un mes de
  prueba, igual que antes. Si no se desea, limitar el plan de entrada a 'profesional' en el trigger de alta.
- Pendiente de la auditoría: S2-S10 (segment-teeth, analizar-foto, permisos por rol en Edge Functions, URLs de 1 año,
  bucket público, Stripe priceId, retención), CSP, CI.

## 2026-10-27 — Claude — Auditoría P1: membresía activa, permisos por rol, SSRF y máscaras (Edge Functions)
Origen: `docs/AUDITORIA_ROBUSTEZ_SEGURIDAD_ESCALABILIDAD_SMYL_2026-10-26.md` (S2, S3, S4). **Solo Edge Functions: sin migraciones.**
- `_shared/auth.ts` + `_shared/auth-membership.ts`: `requireUser` ya respeta `camila_usuarios.activo`; una persona de staff
  desactivada recibe 403 (antes seguía resolviendo la clínica y usaba las funciones con service role). Nuevo
  `requirePermission(auth, cors, permiso)`: el dueño pasa; el staff solo si su rol activo tiene el permiso
  (`smyl_actor_has_permission_explicit`); falla cerrado (503 si la consulta falla).
- Permisos exigidos: `meta-send` → `messages.respond` (Recepción lo tiene); `mila-transcribe` y `mila-realtime-session` →
  `clinical.write`; `lana-webhook` → `clinical.write`; `sign-segmentation-masks` → `clinical.read`.
  **Efecto:** Recepción (sin permisos clínicos) ya no puede usar MILA, ver máscaras ni compartir simulaciones con LANA.
  `mila-actions` ya tenía su propia verificación; `secure-clinical-file` queda protegido por las políticas de Storage.
- `segment-teeth`: la imagen solo puede ser data URL de imagen o https de un host permitido (por defecto `*.supabase.co`;
  más con `SEGMENT_TEETH_ALLOWED_HOSTS`); sin redirecciones y con tope de 25 MB. `casoId` debe ser UUID y no puede ser de otra
  clínica; un prospecto anónimo no puede tocar casos reales (solo `es_prospecto=true` o inexistentes).
- `analizar-foto`: secreto de LANA comparado en tiempo constante; `tenant_id` validado como UUID (la ruta de Storage lo
  usa); `imagen_url` y `callback_url` solo https de hosts permitidos (`*.supabase.co` + `ANALIZAR_FOTO_ALLOWED_HOSTS`);
  la simulación se entrega con enlace **firmado de 7 días** (si firmar falla, cae a la URL pública anterior).
  **Si LANA usa un dominio propio en vez de `*.supabase.co`, hay que añadirlo en `ANALIZAR_FOTO_ALLOWED_HOSTS` o el análisis
  fallará con 400.** Conviene volver privado el bucket `camila-analisis` en el panel una vez desplegado.
- Bundles regenerados (`docs/bundles/`): todas las funciones que importan `_shared/auth.ts`, más nuevos `guardar-lead-prospecto`
  y `analizar-foto`. El bundle de `invite-staff` estaba desactualizado respecto de su código.
- **Pendiente (decisión de diseño): enlaces firmados de 1 año** (`firmarUrlStorage`, `expiresIn: 31536000`, en
  `simulacion.html`, `simulacion-rapida.html` y `revision-clinica.html`). Se guardan en `camila_casos.imagen_url` y la revisión
  clínica los reutiliza al reabrir un caso; acortarlos rompería los casos existentes. Requiere guardar la ruta y firmar al
  leer (revision-clinica: reapertura y lista de 50 miniaturas; app.html: Historial). No se tocó para no romper casos.
- Pruebas: `tests/security-functions-p1-2026-10-27.test.mjs` (ejecuta los validadores reales; suite 734/734).

## 2026-10-26 — Codex — Tratamiento v3.6: evolución longitudinal y cierre documentado

- La etapa Seguimiento ahora resume evoluciones, citas completadas, piezas en seguimiento y hallazgos confirmados sin exponer el contenido SOAP de las notas.
- Se añadió una ruta compacta Evaluación → Plan → Seguimiento y accesos directos para registrar una evolución, actualizar el odontograma y consultar el historial clínico.
- “Registrar evolución” abre el formulario canónico de la Ficha 360 preseleccionado como Evolución; conserva borradores, firma inmutable y adendas existentes.
- El estado “Listo para documentar cierre” sólo aparece cuando hay plan aprobado, odontograma sin cambios/pedientes y al menos una evolución firmada. No cambia estados de base de datos ni cierra casos automáticamente.
- `SmylPatientProgress` expone únicamente metadatos seguros de notas, citas y línea de tiempo; no entrega texto clínico. `SmylDentalProgress` añade conteos agregados del odontograma.
- Web y `mobile/www` quedaron sincronizados en `smyl-patient-360.js?v=11`, `smyl-dental-record.js?v=13`, `smyl-case-workspace.js?v=14` y `smyl-case-workspace.css?v=11`; PWA `evolution-closure-v36`.
- No hubo migraciones, funciones, credenciales ni cambios de esquema. QA enfocada: 27/27; revisión visual a 1280, 820, 390 y 320 px sin desbordamiento horizontal y con controles táctiles de 44 px en móvil.

## 2026-10-26 — Codex — Tratamiento v3.7: odontograma único y herramientas por fuente

- El mapa principal dejó de ser un filtro pasivo: Todo, Clínica, Fotografías y Rayos X activan un espacio contextual con métricas, explicación y acciones propias.
- Fotografías permite abrir directamente la carga de archivo clínico y la revisión asistida del caso; Rayos X abre el flujo canónico de carga, tipo, fecha e interpretación asistida.
- La IA se presenta como “Valoración asistida, no diagnóstico” y conserva el circuito confirmar/editar/descartar antes de incorporar observaciones al mapa.
- El segundo odontograma ya no compite con el principal. El editor canónico completo se conserva, sin duplicar datos, dentro de “Edición clínica avanzada” bajo divulgación progresiva.
- Se amplió la jerarquía visual del mapa, pestañas, métricas y panel contextual; en móvil las acciones se apilan y mantienen objetivos táctiles de 44 px.
- Web y `mobile/www` quedaron sincronizados en `smyl-patient-360.js?v=12`, `smyl-case-workspace.js?v=15` y `smyl-case-workspace.css?v=12`; PWA `source-workspace-v37`.
- No hubo migraciones, Edge Functions, prompts ni cambios de modelo clínico. Se reutilizan permisos, archivos, análisis, odontograma y guardado existentes.

## 2026-10-26 — Codex — Tratamiento v3.8: tarea clínica enfocada

- El odontograma principal queda como el único mapa dental visible. Al agregar una radiografía se oculta por completo el editor odontológico redundante y se muestra sólo la tarea radiográfica.
- La carga de estudios se organiza en tres pasos: describir el estudio, seleccionar el archivo y revisar/confirmar. Tipo, nombre, fecha, original privado y controles existentes se conservan sin crear otra fuente de datos.
- El panel cambia de título y contenido según la tarea activa. Las secciones canónicas continúan montadas para conservar borradores, guardado y protecciones, pero sólo una permanece visible a la vez.
- Se eliminó el acceso visual redundante a “Edición avanzada” desde el mapa y desde los modos Todo/Clínica. La pieza se edita directamente al seleccionarla en el odontograma principal.
- La superficie adopta la política visual SMYL: tarjeta blanca, acción primaria navy, turquesa sólo como estado, carga de archivo delimitada, revisión asistida separada y controles táctiles de 44 px en móvil.
- Web y `mobile/www` quedan sincronizados en `smyl-case-workspace.js?v=16`, `smyl-case-workspace.css?v=13` y caché `clinical-task-panel-v38`. No hubo migraciones, funciones, prompts ni cambios de datos clínicos.

## 2026-10-27 — Codex — Tratamiento v3.9: un solo odontograma visible

- Se eliminó el último acceso que todavía abría el odontograma canónico heredado debajo del mapa longitudinal. `Actualizar odontograma` ahora vuelve al único mapa visible en vez de desplegar una segunda representación.
- Seleccionar una pieza en el mapa principal continúa abriendo el diálogo canónico de esa pieza, por lo que se conservan observaciones, conducta, estado, versionado y guardado sin duplicar la arcada.
- El editor canónico completo permanece montado y oculto sólo para reutilizar el flujo de carga de radiografías. No puede abrirse en modo odontograma; al agregar un estudio muestra exclusivamente la sección radiográfica.
- Web y `mobile/www` quedan sincronizados en `smyl-case-workspace.js?v=17`, `smyl-case-workspace.css?v=14` y caché `single-odontogram-v39`. No hubo cambios de esquema, RLS, funciones, prompts ni datos clínicos.

## 2026-10-27 — Codex — Tratamiento v4.0: tarea radiográfica alineada a SMYL

- Se retiró la acción duplicada de la tarjeta “Siguiente acción”; la navegación y las acciones contextuales permanecen dentro de las tres etapas clínicas.
- “Agregar estudio radiográfico” adopta la política visual SMYL con encabezado turquesa discreto, pasos compactos, campos etiquetados, área de archivo delimitada y acción primaria navy.
- Tipo de estudio y archivo ahora tienen etiquetas visibles; el selector conserva los tipos existentes y la carga sigue aceptando únicamente JPG/PNG de hasta 20 MB.
- La revisión asistida se presenta como apoyo diferenciado con insignia IA y conserva el control profesional, consentimiento y guardado canónico existentes.
- Web y `mobile/www` quedan sincronizados en `smyl-dental-record.js?v=14`, `smyl-case-workspace.js?v=18`, `smyl-case-workspace.css?v=15` y caché `radiograph-ui-v40`. No hubo cambios de esquema, RLS, funciones ni datos clínicos.

## 2026-10-27 — Codex — Equipo y roles v4.6: alta de doctores sin cuentas duplicadas

- “Invitar profesional” cambia a “Agregar doctor”. El correo se contrasta primero con los integrantes de la clínica: si ya existe, no se vuelve a llamar a `invite-staff` ni se muestra el error técnico de reinvitación.
- Una cuenta existente puede completar su perfil mediante la RPC segura `smyl_create_professional`; el flujo asigna el rol activo `odontologo`, la sede principal y reactiva el acceso sólo cuando el operador tiene los permisos existentes.
- Si el doctor ya estaba vinculado, el mismo diálogo actualiza nombre, especialidad, cédula, rol y sede y explica que no enviará otro correo. Los correos nuevos conservan la invitación segura por Edge Function.
- Equipo y profesionales dejan de duplicarse visualmente: cada persona tiene una sola fila con identidad, correo, etiqueta Doctor/Equipo, rol y sede. El panel secundario se reserva para invitaciones pendientes y perfiles sin acceso.
- La superficie completa se alinea a SMYL UI v3: texto funcional de al menos 12 px en estilos efectivos, controles de 42–48 px, tarjetas blancas, acción primaria navy, estados semánticos y reordenamiento responsive a 1200, 900, 760 y 440 px.
- Web y `mobile/www` quedan sincronizados en `smyl-clinic-admin.js?v=6`, `smyl-clinic-admin.css?v=7` y caché PWA `team-roles-v46`.
- No hubo migraciones ni cambios en Edge Functions. Se reutilizan RPC, RLS, membresías e invitaciones ya desplegadas; la corrección es de orquestación y UX del frontend.

## 2026-10-27 — Codex — Plan de implementación radiográfica para Claude Code

- Se documentó en `docs/CLAUDE_RADIOGRAPH_AI_IMPLEMENTATION_PLAN.md` la brecha entre la revisión 2D actual y un sistema radiográfico avanzado.
- El plan separa baseline, contratos, control de calidad, segmentación/FDI, revisión por pieza, informe firmado, historia longitudinal, validación clínica y CBCT/DICOM en nueve etapas (0–8) con criterios de aceptación.
- Se prohíbe reutilizar `segment-teeth` para rayos X: ese servicio corresponde a fotografías. La geometría radiográfica exige un adaptador y motor especializado.
- La Etapa 0 y 1 son el inicio recomendado: banderas cerradas, contratos v2, esquema versionado, RLS, auditoría e idempotencia, manteniendo compatibilidad con el flujo v1 publicado.
- No se modificó código clínico, migraciones, Edge Functions, datos ni producción en esta entrega; es un handoff de arquitectura y ejecución para Claude Code.

## 2026-10-30 — Claude — Auditoría P1 restantes: Stripe, retención, lecturas por permiso
Origen: `docs/AUDITORIA_ROBUSTEZ_SEGURIDAD_ESCALABILIDAD_SMYL_2026-10-26.md` (S5, S8, S9, S7). Dos migraciones + Edge Functions.
- **S8 Stripe** (`_shared/stripe-plans.ts`): el plan sale SOLO del Price ID configurado en el servidor
  (`STRIPE_PRICE_ESENCIAL/PROFESIONAL/PREMIUM`). `stripe-checkout` ignora el `priceId` del navegador (resuelve el precio desde
  el `planKey` validado; 400 si el plan es inválido, 503 si ese plan no tiene Price ID configurado) y solo el dueño puede
  contratar/abrir el portal (`requireUser` + `user.id === tenantId`). `stripe-webhook` ya no cae a `metadata.plan_key` ni a un
  límite por defecto: un precio desconocido registra la suscripción pero NO cambia el plan. Los errores ya no filtran `e.message`.
  Nota: `STRIPE_PRICE_IDS` del cliente (app.html) sigue vacío, o sea que el cobro aún no está activo del lado del navegador.
- **S9 retención** — migración `20261030100000_smyl_retention_purge_schedule.sql`: programa con pg_cron (03:17 y 03:23) las purgas
  `smyl_purge_expired_public_appointment_intakes` y `smyl_purge_expired_assistant_conversations`; idempotente; NO falla si
  pg_cron no está habilitado (avisa). El audio de MILA vencido (`mila_recordings.retention_until`, 30 días) lo purga
  `file-lifecycle-maintenance` (borra el archivo de `mila-audio` y luego la fila) cuando la clínica ejecuta su mantenimiento
  (oportunista, cada 12 h por clínica): **no es una garantía si una clínica nunca abre la app**; para garantía total haría falta
  un cron que invoque la función con un secreto.
- **S5 lecturas por permiso** — migración `20261030110000_smyl_membership_reads_to_permissions.sql`: chat
  (`camila_conversaciones/mensajes`, `camila_lana_handoffs`, `camila_lana_clinical_links`) exige `messages.read` (actualizar conversación:
  `messages.respond`); MILA (`mila_sessions/recordings/transcripts/clinical_notes/confirmations/tool_calls`) exige `clinical.read`.
  Probado en Postgres (PGlite) con roles reales: antes finanzas leía todos los chats y transcripciones de MILA; ahora solo quien
  tiene el permiso (dueño, odontólogo, administrador; recepción conserva el chat y pierde MILA). `camila_casos` y `camila_pacientes`
  NO se tocan (decisión de producto pendiente para casos: el flujo histórico de simulación lo usa el staff).
  Efecto: `smyl_has_permission` exige clínica activa incluso para el dueño (como el resto de tablas `smyl_*`).
- **S7 bucket `camila-analisis`**: `analizar-foto` ya entrega enlaces firmados (ver entrada del 2026-10-27). **Paso manual**: en el panel de
  Supabase → Storage → `camila-analisis` → Edit → desmarcar *Public*, DESPUÉS de desplegar `analizar-foto`. Las URLs públicas antiguas
  dejarán de abrir.
- Aplicar migraciones: workflow manual `.github/workflows/smyl-seguridad-p1-migracion.yml`.
- Bundles regenerados: `stripe-checkout`, `stripe-portal`, `stripe-webhook` (nuevo) y `file-lifecycle-maintenance`.
- **Sigue pendiente**: enlaces firmados de 1 año (necesita guardar ruta y firmar al leer) y los P1 de robustez/escalabilidad del informe.

## 2026-10-30 — Claude — Visor de radiografía v1: el diagnóstico dice qué campo falló
- `smyl-radiograph-review-model.js` (v2, web + `mobile/www`): `parseReport` ya no dice solo "Observación radiográfica no válida."; ahora cita la
  observación (r#) y el motivo concreto: diente que no es FDI ni null, categoría no permitida, observación > 500 o evidencia > 300 caracteres
  (con su longitud), campos distintos de los esperados, id fuera de r1–r12 o repetido. Los valores que cita la IA se limpian y recortan a 40
  caracteres y solo se muestran en pantalla. **El contrato NO se relajó**: se rechaza lo mismo que antes.
- Pruebas: `tests/radiograph-v1-observation-reason.test.mjs`.
- Siguiente paso: con el motivo real de la panorámica, decidir si se corrige el prompt, se fuerza un esquema JSON en la función `claude`
  (como ya se hace con las fotografías) o se tolera algún caso inofensivo (p. ej. `tooth: ""` como null).
