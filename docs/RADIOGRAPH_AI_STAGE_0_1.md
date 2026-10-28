# SMYL — Radiografía asistida: Etapas 0, 1 y 2 (baseline, esquema v2, contratos y control de calidad)

**Fecha:** 2026-10-28 · **Autor:** Claude Code · **Plan:** `docs/CLAUDE_RADIOGRAPH_AI_IMPLEMENTATION_PLAN.md`
**Estado:** código y pruebas listos; **nada aplicado ni desplegado**. Con las banderas apagadas el
comportamiento publicado es idéntico al actual (sólo existen tablas/funciones nuevas sin uso).

## Alcance de esta entrega

| Incluido | Excluido (etapas posteriores) |
| --- | --- |
| 5 banderas cerradas por defecto + piloto por clínica (`20261028100000`) | `radiograph-analyze` y adaptador de localización dental (Etapa 3) |
| Registro de motores sin credenciales, un motor activo por tipo | Proveedor real de QC (hoy sólo `simulated` y un adaptador HTTP genérico sin proveedor elegido) |
| Fuentes inmutables, correcciones, vínculos, auditoría de acceso (`20261028110000`) | UI de revisión por pieza, odontograma asistido, informe en pantalla (Etapas 3-5) |
| Ejecuciones IA idempotentes, candidatos inmutables, decisiones versionadas (`20261028120000`) | Comparador longitudinal (Etapa 6), validación clínica (7), CBCT/DICOM (8) |
| Informes: borrador, firma con hash, adendas, exportación (`20261028130000`) | Cualquier cambio en `segment-teeth`, flujo v1 o `mobile/**` |
| Contratos v2 JS/TS + validadores SQL + 86 vectores canónicos | |
| Edge Function `radiograph-qc` + `_shared/radiograph-image.ts`, `radiograph-provider.ts`, `radiograph-qc-core.ts` (Etapa 2) | |
| Pruebas estáticas (24), PGlite en Postgres real (11) y Etapa 2 (14) | |

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

1. Aplicar en orden `20261028100000` → `110000` → `120000` → `130000` con el workflow manual
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
node --test tests/radiograph-contracts-v2.test.mjs tests/radiograph-migrations-stage1.test.mjs tests/radiograph-qc-stage2.test.mjs
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
- **Vínculos longitudinales:** `smyl_radiograph_study_links` existe con RLS pero sin RPC de
  escritura (Etapa 6).
- **Bucket:** las fuentes v2 fijan `bucket='smyl-radiographs'` (el del flujo v1). La Etapa 2 debe
  leer el archivo desde Storage por esa ruta y validar hash/MIME/dimensiones reales.
- **`width/height`** de la fuente siguen `null`: QC los verifica en servidor pero la fuente es inmutable;
  si se quieren persistir, irán en una tabla derivada en Etapa 3.
- **Proveedor real de QC:** no se ha elegido ninguno (plan §7: licencia, residencia de datos, evidencia de
  validación). El adaptador HTTP es genérico y debe ajustarse al contrato del proveedor elegido.
- **Doble ejecución concurrente:** dos peticiones simultáneas sobre la misma fuente comparten la ejecución
  `requested`; ambas llaman al motor y la segunda que cierra es rechazada como inmutable si difiere. Coste
  duplicado posible sólo en esa carrera; se mitigará con un estado `running` en Etapa 3 si el proveedor cobra.
- **Permiso de firma:** se reutiliza `clinical.approve` (el mismo que firma notas clínicas);
  recepción/asistente no lo tienen por defecto. Si se quiere un permiso específico de firma
  radiográfica hay que ampliar el CHECK de `smyl_role_permissions` en una migración nueva.
- **UI:** `smyl-radiograph-contracts.js` no se carga en ninguna página ni en `sw.js`/`mobile/www`
  todavía; se incorporará cuando exista pantalla (Etapa 4) y entonces se sincronizará la copia móvil.
