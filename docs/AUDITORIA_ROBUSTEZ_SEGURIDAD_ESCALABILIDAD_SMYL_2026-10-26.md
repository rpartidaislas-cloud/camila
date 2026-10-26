# Auditoría de robustez, seguridad y escalabilidad de SMYL

**Fecha:** 26 de octubre de 2026 · **Alcance:** repo `camila` (web/PWA, 40 Edge Functions, 96 migraciones, app móvil)
**Método:** revisión estática en cuatro frentes (datos/RLS, aplicación, robustez, escalabilidad) y verificación manual de los hallazgos más graves contra el código.
**Límite importante:** NO se tuvo acceso a la base de producción (`rpxshsiwoxdbuevjjpfw`), ni se hicieron pruebas de carga ni de explotación. Cada hallazgo indica si está **[verificado en código]** o es **[hipótesis]**. Lo que depende de la configuración real de Supabase está en la sección "Qué hay que comprobar en producción".

---

## 1. Veredicto

| Dimensión | Estado | Resumen |
| --- | --- | --- |
| Seguridad | **Insuficiente hoy** (arreglable en días) | Las tablas `smyl_*` nuevas están bien hechas. La capa heredada `camila_*` tiene tres fallos graves verificados en el código. |
| Robustez | **Aceptable, con huecos operativos** | Buen diseño de datos (idempotencia, bloqueo optimista). Sin CI, sin proceso de migraciones reproducible, respaldo nunca probado. |
| Escalabilidad | **Aguanta 1000 usuarios en total con ajustes; no aguanta 1000 concurrentes** | Cuello de botella: sondeo de Mensajes cada 5 s hacia LANA. Caja trunca datos con ~500 cargos. |

**¿Puede aguantar 1000 usuarios?**
- **1000 usuarios en total** (p. ej. 200 clínicas × 5 personas): **sí, con 4–5 ajustes** antes de llegar a ~200 clínicas (sección 5).
- **1000 usuarios conectados a la vez:** **no, tal como está.** El sondeo de Mensajes generaría 150–190 invocaciones de función por segundo y decenas de millones al mes.
- **1000 clínicas:** requiere rediseño (cron, almacenamiento, retención).

**Antes de crecer, lo urgente no es la capacidad, es la seguridad:** con usuarios reales de otras clínicas, los tres hallazgos P0 permiten ver datos de pacientes de otra clínica.

---

## 2. Seguridad

### P0: corregir antes de captar más clínicas

**P0-1. Cualquier persona puede darse de alta como staff de otra clínica** [verificado en código; condición: registro abierto]
- `supabase/migrations/camila_team.sql:157-171`: el trigger `camila_crear_tenant_en_signup` toma `tenant_id_invitado` de `raw_user_meta_data` (dato que manda el propio navegador en `signUp`) y crea al usuario como staff activo de ese tenant.
- El UUID de una clínica no es secreto: sale de enlaces públicos (`simulacion.html?clinica=…`) y de la vista pública del P0-3.
- Impacto: lectura y escritura de `camila_casos` (diagnósticos, fotos), `camila_conversaciones`/`camila_mensajes`, `mila_*`; uso del cupo de IA de la víctima; envío de mensajes como la clínica con `meta-send`. Las tablas `smyl_*` exigen rol en `smyl_member_roles`, pero el trigger `20261012220000_smyl_staff_default_role.sql` asigna Recepción.
- Arreglo: aceptar la invitación solo si viene de `inviteUserByEmail` (tabla `camila_invitaciones` o `raw_app_meta_data`, que el cliente no puede escribir). Ignorar `plan` y `limite_diagnosticos` del metadato (`camila_team.sql:183-184`). Si ya no se usa el registro abierto, deshabilitarlo.

**P0-2. XSS almacenado anónimo que llega a la sesión del dentista** [verificado en código]
- `guardar-lead-prospecto` es público (`verify_jwt=false`) y guarda `telefono`, `score`, `total_cotizacion` sin validar tipo ni longitud (`supabase/functions/guardar-lead-prospecto/index.ts`).
- `app.html:3970-3973` imprime `score`, `total` y `c.telefono` en el Historial **sin `smylEsc`**. Un POST con `telefono:"<img src=x onerror=…>"` y el UUID de la clínica ejecuta código con la sesión del dentista.
- Sin CSP en `app.html`, y el token de Supabase está en `localStorage`: un XSS equivale a robo de sesión.
- Arreglo: escapar esas tres interpolaciones; validar tipos y tamaño en la función; añadir CSP (ver P2-3).

**P0-3. La vista pública expone la configuración completa de cada clínica** [verificado en código; producción por confirmar]
- `camila_prospecto.sql:31-36`: `camila_tenants_publico` = `select id, nombre, config` con `grant select … to anon`.
- `config.integraciones.lana` contiene `api_key_ciphertext`, `api_key_iv` y `fingerprint` de la clave de LANA (`lana-connection/index.ts`). El cifrado AES-GCM protege mientras la clave de cifrado no se filtre, pero la vista también enumera todos los UUID de clínicas (alimenta P0-1).
- Arreglo: exponer solo columnas explícitas (marca y precios), y mover las integraciones a una tabla solo del servidor.

### P1

| # | Hallazgo | Dónde | Estado |
| --- | --- | --- | --- |
| S1 | El dueño puede editar su propia cuota/plan (`limite_diagnosticos`, `activo`, `vence_en`): política `update` sin límite de columnas | `camila_tenants.sql:40-43` | verificado |
| S2 | `segment-teeth` sube máscaras a `camila-masks/{casoId}` con `casoId` del body y `upsert`, sin comprobar que el caso sea del tenant | `segment-teeth/index.ts:421-437` | reportado |
| S3 | SSRF autenticado: `segment-teeth` y `analizar-foto` hacen `fetch` a URLs arbitrarias; `analizar-foto` compara la clave con `!==` | `segment-teeth:125-135`, `analizar-foto:57,116,336` | reportado |
| S4 | Funciones con service role que no verifican rol ni `activo`: `meta-send`, `mila-*`, `secure-clinical-file`, `sign-segmentation-masks`. Cualquier miembro (incluso desactivado) envía WhatsApp como la clínica | `_shared/auth.ts:37-47`, `meta-send:66-100` | reportado |
| S5 | Tablas de conversaciones, mensajes, casos y `mila_*` se leen por "ser miembro", no por permiso clínico (anula `smyl_has_permission`) | `camila_chat.sql:81,102`, migración `mila` | reportado |
| S6 | URLs firmadas de **1 año** guardadas en `camila_casos` (el documento de seguridad dice 5 minutos) | `simulacion.html:7017`, `revision-clinica.html:2620` | reportado |
| S7 | Bucket `camila-analisis` público con imágenes de pacientes (no definido en migraciones) | `analizar-foto:328` | hipótesis |
| S8 | `stripe-checkout` acepta `priceId`/`planKey` del cliente; el plan puede elevarse pagando un precio barato | `stripe-checkout:35,57`, `stripe-webhook:55` | reportado |
| S9 | Retención declarada (30 días del audio, 90 de intakes) pero **ningún cron ejecuta las purgas** | `mila_recordings.retention_until`, `smyl_purge_*` | reportado |
| S10 | `guardar-lead-prospecto` hace `upsert` por `id` controlado por el cliente: puede reasignar un caso a otro tenant si se conoce el UUID | `guardar-lead-prospecto:70-90` | reportado |

### P2 y P3 (resumen)
- **P2-3. Sin CSP ni anti-clickjacking** en `app.html` y demás pantallas (solo `my-smyl*.html` la tienen). GitHub Pages no permite cabeceras: usar `<meta>` y, a medio plazo, un proxy (Cloudflare).
- **P2-4. Abuso de costos:** límites de IA fallan abiertos si la base se degrada (`_shared/limits.ts:89,99,116`); `public-appointment-request` sin límite de frecuencia visible; `x-forwarded-for` posiblemente falsificable.
- **P2-5. Android:** `allowBackup="true"` y `minifyEnabled false` (`mobile/android/…`).
- **Alcance por paciente incompleto:** `smyl_clinical_plans`, `smyl_proposals*` y `smyl_patient_timeline` no aplican `smyl_can_access_patient`: un rol con alcance "propio" ve planes ajenos.
- **Auditoría con datos clínicos:** `smyl_audit_events` guarda `before_data/after_data` completos (quien tenga `audit.read` ve contenido clínico).
- **Sin cifrado de columnas** para teléfono, email, notas y transcripciones (solo se cifran los tokens de integraciones).
- **LFPDPPP:** no hay flujo de cancelación/eliminación de paciente ni consentimiento registrado para enviar fotos a proveedores de IA.
- **Release gate** (`scripts/security-release-gate.mjs`) solo hace regex sobre 6 funciones: no habría detectado ninguno de los tres P0.

### Lo que está bien (verificado)
- `smyl_*` nuevas: RLS por tenant, `SECURITY DEFINER` con `search_path` fijo, `revoke … from public, anon`, sin `using(true)` para anon, sin IDOR por `p_tenant_id`.
- 9 buckets clínicos privados con ruta por tenant, cuarentena de archivos, tamaño, MIME real y SHA-256 (`secure-clinical-file`).
- Webhooks de Meta (HMAC con comparación de tiempo constante) y Stripe verificados; CORS con lista blanca.
- Frontend `smyl-*.js` escapa de forma consistente y la bandeja de Mensajes no usa `innerHTML` con contenido; sin `eval`/`new Function`.
- Sin `service_role` en el cliente (las claves en HTML son anon/publishable).

---

## 3. Robustez

| # | Sev. | Hallazgo | Dónde |
| --- | --- | --- | --- |
| R1 | P1 | **Sin CI:** ninguna prueba corre en push/PR; los 3 workflows son manuales. Un push a `main` se publica sin verificar | `.github/workflows/` |
| R2 | P1 | **Migraciones sin proceso reproducible:** 7 archivos `camila_*.sql` sin prefijo de versión, 5 placeholders vacíos; el estado real de la base no se compara contra el repo (ya nos ocurrió: apliqué contra el proyecto equivocado) | `supabase/migrations/`, `supabase/legacy-unapplied/` |
| R3 | P1 | **Posible doble reserva cerca de las 18:00 hora de México** [verificado en código la causa; no ejecutado]: el candado de la agenda usa `p_starts_at::date` (zona horaria de la sesión, UTC) y no hay restricción de exclusión. Citas que se traslapan a través de medianoche UTC toman candados distintos. Requiere dos reservas simultáneas. Mi migración de tiempo extra heredó el patrón | `20261015020000…:398`, `20261022120000…:205,236,266` |
| R4 | P1 | **LANA caída:** sin reintento ni circuit breaker; cada ciclo de sondeo cuelga una función hasta 12–15 s; error genérico al usuario | `_shared/lana-linked.ts:46-66`, `lana-inbox` |
| R5 | P1 | **Google Calendar:** una tarea que muere en `processing` nunca se reintenta, y dos ejecuciones pueden tomar la misma | `google-calendar-sync/index.ts:85-88` |
| R6 | P1 | **Respaldo nunca probado:** la herramienta existe y es sólida, pero "simulacro pendiente"; no se sabe si hay PITR ni RPO/RTO | `docs/SMYL_SECURITY_STAGE8_RECOVERY.md` |
| R7 | P2 | `window.onerror` muestra `alert()` con el stack al usuario; no se reporta al servidor | `app.html:2338-2345` |
| R8 | P2 | Offline: `supabase-js` viene de un CDN y probablemente no queda en caché → la app abre rota sin red [hipótesis] | `app.html:24`, `sw.js` |
| R9 | P2 | Service worker: instalación parcial silenciosa y `CACHE_VERSION` manual | `sw.js:200-210` |
| R10 | P2 | `meta-send` sin timeout ni idempotencia: reintento = mensaje doble | `meta-send/index.ts:42-61` |
| R11 | P2 | El cron de recordatorios no está en una migración (solo en docs) | `docs/RECORDATORIOS_CITA.md` |
| R12 | P2 | Observabilidad mínima: ~97 `console.*` sin estructura, sin alertas de fallos | Edge Functions |
| R13 | P2 | Despliegue de funciones manual, sin versión desplegada ni rollback | `docs/bundles/` |
| R14 | P3 | Pruebas: 138 de 155 archivos son regex sobre el código fuente; ninguna ejecuta SQL contra Postgres (la concurrencia de la agenda no tiene cobertura real) | `tests/` |

**Lo que está bien:** RPC de agenda idempotentes (`p_id`), bloqueo optimista con `updated_at`, recordatorios con `skip locked` y clave idempotente hacia LANA, `Idempotency-Key` en el Inbox, respaldo cifrado con manifiesto, HTML network-first en el service worker.

---

## 4. Escalabilidad y capacidad

**Supuestos:** 200 clínicas × 5 personas = 1000 usuarios; pico 30 % de concurrencia; 1 persona por clínica con Mensajes abierto 6 h/día. Los límites de Supabase son valores de referencia **a verificar contra su plan real**.

| Métrica | 1000 usuarios en total | 1000 concurrentes |
| --- | --- | --- |
| Invocaciones de función en pico (Mensajes, 24/min por persona) | ~80–90 /s | ~170–190 /s |
| Invocaciones al mes | ~35–40 M | ~76 M+ |
| Peticiones a PostgREST (≈200/persona-hora) | ~17 /s (30 /s en pico) | ~55 /s |
| Conexiones Realtime | 0 (no se usa) | 0 |
| Almacenamiento nuevo/mes (fotos sin comprimir) | ~96 GB (≈10 GB comprimiendo) | ~480 GB |
| Mensajes WhatsApp/mes | ~0.7 M | ~3.5 M |

### Cuellos de botella, en orden
1. **Sondeo de Mensajes cada 5 s** [verificado: `smyl-inbox.js:3021`]: ~24 llamadas/min por persona, cada una con Auth + 2–6 consultas + llamada a la API de LANA (otro proyecto Supabase, no auditado aquí). Se notaría desde ~100–150 personas con Mensajes abierto a la vez [hipótesis].
2. **Caja trunca en silencio** [verificado: `smyl-finance.js:47`]: carga con límites fijos (500 pacientes/cargos/pagos); con más de ~500 cargos (1–3 meses en una clínica activa) los saldos y "por cobrar" salen mal y los pacientes del 501 en adelante aparecen como "Paciente".
3. **Cron de recordatorios** limitado a 200 clínicas y secuencial (`appointment-reminders/index.ts:357-359`).
4. **Fotos sin recompresión antes de subir** (límites de 10–20 MB): el almacenamiento rebasa el plan en el primer mes con 200 clínicas.
5. **Límites de IA** compartidos (una clave por proveedor) y topes que fallan abiertos; MILA sin tope por defecto (`SMYL_CONSUMABLES_ENFORCED=false`).
6. Otros: selectores de pacientes sin paginar (`smyl-professional-directory.js:162`), cada acción de Agenda recarga ~18 peticiones, RLS con funciones por fila, tablas de auditoría sin retención.

### Lo que está bien
Sin Realtime (cero límite de conexiones), índices `(tenant_id, fecha)` en las tablas principales, Agenda pide por rango de fechas, Mensajes paginado en servidor, búsqueda de pacientes por RPC con tope, reportes agregados en SQL.

### Pruebas de carga recomendadas (no se pudo hacer ninguna)
1. **k6 contra `lana-inbox`:** 50/100/200/400 usuarios virtuales con `sync` cada 5 s durante 30 min; medir p95/p99, 5xx/429, arranques en frío y carga en LANA. Es la más importante.
2. **k6 contra PostgREST** con datos sembrados (5 000 pacientes, 50 000 citas por clínica de prueba), con cuenta titular y de personal con alcance restringido.
3. **Caja** con 1 500 cargos y 3 000 asignaciones para confirmar el truncado.
4. **Cron de recordatorios** con 300 clínicas × 25 recordatorios.
5. **20–50 simulaciones de imagen concurrentes** (429, memoria, tiempo).
6. **Lighthouse/WebPageTest** en un celular de gama media (~1.4 MB de JS, 69 scripts).
7. Seguimiento en producción: `pg_stat_statements`, métricas de funciones, tamaño semanal de tablas de auditoría.

---

## 5. Plan priorizado

**Fase 0: esta semana (seguridad; son cambios pequeños)**
1. P0-1: trigger de alta (invitaciones verificables) y revisar si el registro abierto sigue siendo necesario.
2. P0-2: `smylEsc` en el Historial (3 líneas) y validación de tipos en `guardar-lead-prospecto`.
3. P0-3: vista pública con columnas explícitas.
4. S1: bloquear la edición de columnas de facturación en `camila_tenants`.
5. Comprobar en producción los puntos de la sección 6.

**Fase 1: antes de ~50 clínicas**
6. CI en cada push/PR (`node --test` + release gate) y ampliar el gate con los casos de esta auditoría.
7. Permiso por rol y `activo` en las funciones con service role (`requirePermission`); S2, S3, S5, S6, S7, S8.
8. Candado de agenda por profesional/sala sin fecha (o fecha en zona de la sucursal) + restricción de exclusión como red de seguridad. Nueva migración; probar con dos conexiones en Postgres real.
9. Caja: paginación o RPC agregado + aviso de truncado. Sondeo de Mensajes a 15–20 s con backoff, fusionar `sync` y `loadThread`, caché de 60 s del actor y la clave por tenant.
10. Recompresión de fotos (2000–2560 px, JPEG 0.85) antes de subir.

**Fase 2: antes de ~200 clínicas**
11. Cron versionado en migración (recordatorios y purgas de retención) con concurrencia y paginación; circuit breaker hacia LANA.
12. Proceso de migraciones reproducible (renombrar los 7 `camila_*`, línea base, comparación repo-contra-remoto) y despliegue de funciones con versión.
13. Simulacro de restauración, RPO/RTO definidos, respaldo semanal programado.
14. Topes de IA que fallen cerrados y activar `SMYL_CONSUMABLES_ENFORCED`; cola global para generación de imágenes.
15. Pruebas de carga (sección 4) y alertas (errores 5xx, cron detenido, tasa de 429).

**Fase 3: cumplimiento y madurez**
16. LFPDPPP: flujo de derechos ARCO, consentimiento para proveedores de IA, redacción de datos clínicos en `smyl_audit_events`, cifrado de columnas sensibles.
17. CSP con proxy que ponga cabeceras, SRI en terceros, `allowBackup=false`, módulo de errores sin datos clínicos.

---

## 6. Qué hay que comprobar en producción (no se pudo desde aquí)
- **Auth:** ¿el registro (`signUp`) está abierto?, ¿exige confirmación de correo? (define si P0-1 es explotable hoy).
- **Vista `camila_tenants_publico`:** ¿sigue con `select id, nombre, config`?
- **Buckets:** ¿`camila-analisis` y `camila-fotos` son públicos o privados?
- **Plan de Supabase:** nivel, PITR/respaldos activos, cómputo, límites de invocaciones y conexiones.
- **Cron:** ¿existe `pg_cron` para `appointment-reminders` y para las purgas?
- **Migraciones aplicadas:** comparar `supabase_migrations.schema_migrations` con el repo; ¿están aplicados los `camila_*.sql`?
- **Zona horaria de la sesión** de la base (confirma R3).
- **LANA:** su capacidad y comportamiento bajo 5xx (otro repo/proyecto, fuera de esta auditoría).

## 7. Limitaciones de esta auditoría
Revisión estática; las afirmaciones marcadas como verificadas se comprobaron leyendo la línea citada, el resto proviene del análisis de los cuatro frentes y puede contener falsos positivos. No se auditaron en profundidad: `public-profile-assistant`, `google-calendar-*`, `whatsapp-templates`, `smyl-profile-copy`, Facturapi/CFDI, el portal del paciente, iOS, ni el sistema LANA. No sustituye una prueba de penetración ni una prueba de carga.
