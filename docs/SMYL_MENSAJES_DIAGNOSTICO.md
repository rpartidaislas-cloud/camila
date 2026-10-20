# Diagnóstico de brechas — módulo Mensajes de SMYL

**Fecha:** 20 de octubre de 2026
**Base auditada:** `main` = `c671911` (incluye el merge del PR #21 y los 38 commits
de la sesión paralela de Claude del 19–20 de octubre: "rediseño del chat estilo
LANA fases 1–3", "fase 4 recordatorios", "encabezado más limpio", "segunda
tanda", "Mensajería + plantillas").
**Contra qué se audita:** el spec de rediseño en 7 etapas entregado por el
usuario (bandeja, pipeline, filtros avanzados, canales, control IA/humano,
Paciente 360, ventana 24 h, productividad), con identidad propia de SMYL y sin
branding de LANA ni de otros tenants.
**Método:** lectura completa de `smyl-inbox.js`, `smyl-inbox.css`,
`smyl-patient-360.js`, `smyl-navigation.js`, `supabase/functions/lana-inbox`,
contratos (`SMYL_LANA_CHAT_CONTRACT_V1.md` v1.2, `SMYL_CHAT_ARCHITECTURE.md`,
`LANA_INTEGRATION.md`), entradas recientes de `HANDOFF.md`, ejecución de la
suite (`node --test tests/*.test.mjs`) y grep de higiene multi-tenant. Lo que
requiere sesión real de Supabase/LANA se marca como no verificable offline.

> Regla de lectura: **Hecho** sólo si el código lo implementa; no basta el
> mensaje de commit.

---

## Hallazgos transversales

1. **No es Codex, es otra sesión de Claude.** Las entradas de `HANDOFF.md` del
   19–20/10 que cubren el chat están firmadas por Claude. El reparto de la
   sección G se hace entre *esta* sesión (backend/contratos/tenant/pruebas) y
   *la otra sesión* (visual/UX), no entre Claude y Codex.
2. **Suite roja en `main` por el PR #21 (login).** 44/479 pruebas fallaban:
   todas de paridad web↔móvil, porque `app.html` se rediseñó y
   `mobile/www/app.html` no se sincronizó. Corregido en el mismo PR que
   introduce este documento (`cp app.html mobile/www/app.html` → 479/479).

---

## A. Estado por etapa del spec

### Etapa 1 — higiene, navegación, layout, CSS

| Punto | Estado | Evidencia / qué falta |
|---|---|---|
| "Bordados Express" / "Lana" en la UI | **Hecho en código** (ver B) | 0 ocurrencias de "Bordados Express" en el repo. "LANA" sólo como nombre del motor en copy operativo. Si se vio en pantalla, vino de datos devueltos por LANA. |
| Vistas hermanas Bandeja / Pipeline / Calidad de IA / Ventana 24 h | **Parcial** | `smyl-inbox.js:228` `.smyl-inbox-view-toggle` sólo `list`/`pipeline`; `setInboxView()` (544). No existen Calidad de IA ni Ventana 24 h. |
| 3 columnas en escritorio (300–320 / flexible / 300–320 plegable) | **Parcial** | El shell tiene 3 panes (js 235–258) pero `smyl-inbox.css:128` fuerza 2 columnas (`340px minmax(0,1fr)`, "Keep the stage 2 drawer authoritative"). El 360 es drawer, sin botón de plegar. |
| Tablet: 360 como drawer con botón visible | **Parcial** | Drawer sí (css 95–98); el disparador es el bloque avatar/nombre, no un botón explícito. |
| Móvil: bandeja → hilo → atrás; 360 como sheet | **Hecho** | `show-thread` (js 2275), `[data-inbox-back]` (2708), context absoluto (css 117). |
| Compositor con `visualViewport` y safe areas | **Parcial** | Safe-area sí (css 30). `visualViewport` no se usa. |
| Consolidación de `smyl-inbox.css` | **Falta** | Ver D. |

### Etapa 2 — bandeja, filtros, canales, filas

| Punto | Estado | Evidencia / qué falta |
|---|---|---|
| Filtros rápidos Todas / Sin leer / Por atender / Mías | **Hecho** | js 239; `visibleConversations()` 289–301; `filterCount()` 333. |
| Fila de canales con iconos (WhatsApp #25D366, Messenger, Instagram) | **Parcial** | Los SVG existen (`CHANNEL_MARKS` js 183–187) pero el filtro de canal es un `<select data-inbox-channel>` dentro del panel "Filtros" (js 241), oculto por defecto. No hay chips con icono ni `aria-label` por canal. |
| Filtros avanzados (canal, estado, responsable, sucursal, IA/humano, fijadas, etapa, prioridad) | **Parcial** | Existen canal, pausadas, fijadas (js 241). Faltan responsable, sucursal, IA/humano explícito, etapa, prioridad. El proxy sólo reenvía `filter, channel, limit, offset, q` (`lana-inbox/index.ts:612`). |
| Fila simplificada | **Parcial** | `renderList()` 399–433 ya muestra avatar+canal, nombre, hora, preview, un badge de estado, responsable, etapa, no leídos, fijada. Falta "paciente vinculado" (vive en `state.clinical[id]` y no se pinta). |
| Orden fijadas → atención → no leídas → recientes | **Hecho** | `mergeConversations()` 278–286 (añade "mías" antes de reciente). |

### Etapa 3 — encabezado, acciones, compositor, IA/humano

| Punto | Estado | Evidencia / qué falta |
|---|---|---|
| Encabezado en dos niveles | **Parcial** | Un solo nivel (js 250): avatar, nombre, canal · responsable, interruptor IA, carebar, menú ⋯. Falta sucursal (no hay campo en el DTO) y no hay segundo nivel. |
| Acción principal contextual + "Más acciones" | **Parcial** | `renderCareBar()` 1596–1622: "Agendar cita" siempre primaria; Expediente/Cotizar/Cobrar van al menú ⋯ por CSS (css 613). No cambia según estado (Identificar paciente / Responder / Confirmar horario / Enviar seguimiento). |
| Control único IA/humano con confirmación al reanudar | **Hecho** (con duplicidad) | `[data-thread-mode]` `role="switch"` (js 250, 1672–1678); `prepareResume()`/`confirmResume()` 644–668 con `resume_with_context`. El estado se repite en la fila y en la tarjeta "SMYL Asistente" del drawer (1454–1458). |
| Compositor compacto con "+" | **Hecho en estructura** | `[data-compose-more]` abre Plantilla/Programar/Nota de voz/Ubicación/Emoji (js 254). Adjuntar/Respuesta rápida/Sugerir siguen fuera del "+". |
| Capacidades reales por canal | **Parcial (hardcodeado)** | `renderWhatsappWindow()` 856–868 y `chooseAttachment()` 2441–2442 deducen por nombre de canal, lo que el contrato §6 prohíbe. |

### Etapa 4 — Paciente 360, vinculación, roles

| Punto | Estado | Evidencia / qué falta |
|---|---|---|
| Paciente 360 con 7 secciones y pestañas | **Falta** | El panel sigue siendo "Control de atención" (`renderContext()` 1374–1594); `organizeContextSections()` 1343–1372 lo convierte en **once `<details>`** consecutivos. El expediente real (`smyl-patient-360.js`, pestañas Resumen/Expediente/Tratamiento/Actividad, permisos por rol en `calculatePermissions`) vive fuera de Mensajes y se abre vía `openPatientContext()`. |
| Vinculación automática segura / "Confirmar identidad" | **Hecho** | `autoLinkConversationPatient()` 1820–1841 (`auto_patient_link`, razones `ambiguous`/`needs_identity`/`permission`); copy 1582–1586; RPC `smyl_auto_link_lana_conversation`. |
| Acceso por rol | **Hecho** | `hasPermission`/`canOperate` (js 33–40); `lana-inbox` revalida `messages.*`, `clinical.*`, `schedule.*`, `patients.manage`. |

### Etapa 5 — Pipeline dental

| Punto | Estado | Evidencia / qué falta |
|---|---|---|
| Vista visual real | **Hecho (básico)** | `renderPipeline()` 493–530; columnas = `state.stages` de LANA (`GET /inbox/stages`); drag&drop HTML5 + `<select>` "Mover a" (455–491); optimista con reversión en `moveConversationStage()` 532–542; `tests/smyl-inbox-pipeline.test.mjs`. |
| Las 8 etapas dentales | **Falta** | Las columnas son las que devuelva LANA; no hay semilla dental por tenant. |
| Configurar / reordenar / plegar / archivar por clínica | **Sin contrato** | `lana-inbox` sólo expone `stages` → `GET /inbox/stages` (index.ts:586). |
| Tarjeta con sucursal y tiempo sin respuesta | **Parcial** | `pipelineCard()` 455–469 tiene canal, responsable, IA, no leídos, hora; faltan sucursal y "tiempo sin respuesta". |
| Auditoría del cambio de etapa | **Parcial** | Delegada a LANA (contrato §7); SMYL no registra evento propio. |
| Drag accesible por teclado | **Falta** | Sólo pointer + select. |

### Etapa 6 — Ventana 24 h y Calidad de IA

| Punto | Estado | Evidencia / qué falta |
|---|---|---|
| Ventana 24 h como vista propia | **Falta** | Sólo por conversación: `liveWhatsappWindow()` 815–826, aviso en compositor 834–869, tarjeta en drawer 1460–1470. |
| Calidad de IA como vista propia | **Falta** | Sólo el diálogo "Evalúa esta respuesta" por mensaje (`openFeedback`/`submitFeedback` 670–690 → `/copilot/feedback`). No hay endpoint de lectura. |

### Etapa 7 — responsive, accesibilidad, estados

| Punto | Estado | Evidencia / qué falta |
|---|---|---|
| Responsive | **Parcial** | Breakpoints 1600/1320/1080/760 + container queries 900/600; funciona, pero con las definiciones triplicadas de D. |
| Accesibilidad | **Parcial** | Roles/aria correctos en toggle, switch, tablist; `focus-visible` en pipeline; textos < 10 px: 0. Pero ~25 `window.alert/confirm` (p. ej. js 540, 712, 2086, 2097), prohibidos por la política §11.4. |
| Estados carga / vacío / error / reintento | **Hecho** | Lista, hilo, pipeline, agenda, operaciones (374–398, 760–764, 502–507, 1977–2007). |

---

## B. Higiene multi-tenant (P0)

1. **"Bordados Express": 0 ocurrencias** en `app.html`, `smyl-*.js/css`,
   `index.html`, `revision-clinica.html`, `simulacion.html`, `mobile/www/*`,
   docs y tests. No está en el código de SMYL. Fuentes posibles del
   avistamiento (no verificables offline):
   - Textos devueltos por LANA y pintados tal cual: `renderQuickReplies()`
     js 2556–2561 (`item.shortcut/text`), `fillTemplateSelect()` 905
     (`template.name`), `applyConversationResult()` 2294–2295
     (`assigned_actor_name`), `state.team` (`action:'team'`).
   - La captura del propio panel de LANA que compartió el usuario.
   - Un tenant LANA mal vinculado (`LANA_INTEGRATION.md`, "Estado de
     producción", dice que se verificó por cuenta exacta).
   Severidad **alta** si es la primera opción. Fuente canónica: nombres de
   clínica/sucursal/asistente desde `tenantData.config.consultorio` /
   `tenantData.nombre`; miembros desde `smyl_members` / `action:'team'`
   filtrados por `tenant_id` en `lana-inbox` (index.ts:67–90).
2. **"LANA" visible al usuario** (branding del motor dentro de SMYL), severidad
   **media**, contradice el spec:
   - `smyl-inbox.js:267` ("La búsqueda se realiza en LANA…"), `:2555` ("Aún no
     hay respuestas rápidas configuradas en LANA."), `:1300` ("SMYL · Inbox
     conectado con LANA", informe impreso).
   - `smyl-templates.js:93,133,142,145,150,187,195–197` ("Aprobada en LANA",
     "Copiar para LANA", "Consultando LANA…", "Solicítala en LANA").
   - `smyl-reminders.js:159`; `smyl-clinic.js:108`; `smyl-proposals.js:233,265`
     ("Seguimiento con LANA", clase `lana-entry`); `smyl-readiness.js:16`.
   - Copias idénticas en `mobile/www/` (28 hits).
   Reemplazo canónico: "el motor de mensajería" / "tu cuenta de mensajería" /
   "Meta", o un token `MESSAGING_PROVIDER_LABEL`; la referencia técnica sólo
   en docs.
3. **Fallbacks genéricos** (no fuga, revisar copy): `availabilityClinicName()`
   js 1886–1889 → "Tu clínica dental"; `app.html:2864,4184` → "Mi Consultorio";
   `app.html:994` placeholder "Consultorio"; `app.html:4359` "Consultorio
   Dental"; js 1529–1530 "Profesional por confirmar" / "Sucursal por
   confirmar"; js 2294 "Miembro de SMYL"; 2295 "Asignada previamente".
4. **Aislamiento de cachés: correcto.** Borradores cifrados por sesión en
   `sessionStorage` con clave derivada del JWT (js 57–125), aislados por usuario
   y conversación. `smyl_inbox_view` en sessionStorage; `smyl_sidebar_collapsed`
   en localStorage (global, no sensible). El tenant lo resuelve `lana-inbox`
   con `requireUser` → `resolverTenantId(user.id)` (`_shared/auth.ts:36–80`),
   nunca desde el body.

---

## C. Contratos y backend

Contrato vigente: `SMYL_LANA_CHAT_CONTRACT_V1.md` v1.2. Proxy
`supabase/functions/lana-inbox/index.ts` (927 líneas), 33 acciones y lista
blanca de mutaciones por conversación (index.ts:849): `send read assign
release pause resume resolve pin unpin stage star unstar delete`.

| Necesidad del spec | Estado |
|---|---|
| Bandeja paginada, sync incremental, filtros `filter/channel/q` | **Soportado** (`/inbox`, `/inbox/sync`; index.ts:612) |
| Filtro por responsable, etapa, sucursal, prioridad en servidor | **Sin contrato** (`priority` no está en el DTO) |
| `sucursal`/`branch` en la conversación | **Sin contrato** — `branch_id` sólo en citas/disponibilidad |
| Fijar, asignar, pausar/reanudar, resolver, etapa | **Soportado** (whitelist 849; `stage` 900) |
| Etapas: leer | **Soportado** (`GET /inbox/stages`) |
| Etapas: crear / renombrar / reordenar / plegar / archivar por clínica | **Sin contrato** |
| Auditoría de cambio de etapa | **Parcial** — delegada a LANA (§7); SMYL no guarda evento |
| Ventana 24 h por conversación (`whatsapp_window.expires_at`) | **Soportado** (js 817) |
| Ventana 24 h agregada (lista por estado / tiempo restante) | **Sin contrato** |
| Plantillas UTILITY, programados, cancelar / reintentar | **Soportado** |
| Feedback de IA: escribir | **Soportado** (`/copilot/feedback`) |
| Feedback de IA: leer / listar para la vista Calidad | **Sin contrato** |
| Reanudación con contexto | **Soportado** (`/resume-context`) |
| Capacidades por canal anunciadas por `/channels` | **Parcial** — `lana-channels` existe; `smyl-inbox.js` no consume una matriz y deduce por nombre (856–868, 2441–2442) |
| Vinculación automática / confirmación manual | **Soportado** |
| Ficha clínica unificada para el 360 dentro del chat | **Parcial** — `clinical_context` devuelve paciente/caso/fotos/cita/simulación/propuesta; el detalle vive en `smyl-patient-360.js` con consultas directas por RLS |
| Recordatorios 24 h por WhatsApp | **Soportado localmente, no desplegado** (`appointment-reminders`, migración 20261019010000; `RECORDATORIOS_CITA.md`) |

Edge Functions relacionadas: `lana-inbox` (proxy), `lana-channels` (estado /
setup Meta), `lana-connection` (provisión / API key cifrada), `lana-context`,
`lana-training`, `lana-attention` (bandeja de atención en Inicio),
`lana-handoff` (puente legado), `lana-webhook` (eventos SMYL→LANA),
`appointment-reminders` (nuevo), `meta-send` / `meta-webhook` (legado).

---

## D. CSS y deuda técnica (`smyl-inbox.css`, 653 líneas)

- `.smyl-inbox-workspace{…}` definido **8 veces** con tres layouts
  contradictorios: 3 col (línea 9: `332px minmax(420px,1fr) 268px`), 2 col
  (94), 3 col (121: `340px minmax(520px,1fr) 318px`), 2 col "authoritative"
  (128) + overrides en 557 (`view-pipeline`). Breakpoints repetidos para el
  mismo selector en 29, 115–117, 123–125, 130–132. Gana la última (128): por
  eso el 360 es drawer y no columna.
- `grid-template-columns`: 73 ocurrencias.
- `@media`: 760 px ≈20 bloques dispersos, 1080 px ≈5, 1320 px ≈4, 1600 px (595),
  `hover:none` (593), `prefers-reduced-motion` (38), `print`; container queries
  `smyl-thread-head` 900/600 (541–542, 616).
- `!important`: **3** (81 ×2, 544 justificado). `font-size` < 10 px: **0**.
- Estructura: 20 comentarios de "stage" en orden cronológico (54 … 630): es un
  log de capas, no la organización Tokens / Layout / Bandeja / Hilo /
  Compositor / 360 / Pipeline / Diálogos / Responsive / A11y. Sin tokens
  locales: ≈40 hex sueltos en lugar de `--smyl-*`.
- También se redefinen `.smyl-inbox-top` (4, 120, 632) y `.smyl-inbox-context`
  (24, 95, 122, 129).
- `app.html:773` `input,textarea,select{font-size:16px!important}` fuerza
  16 px también en escritorio.
- Paridad: `mobile/www/` idéntico en `smyl-inbox.js/css`, `smyl-navigation.js`,
  `smyl-templates.js`, `smyl-reminders.js`; `mobile/www/app.html` difería en
  124 líneas (corregido en este PR).

---

## E. Pruebas

- Ejecución: no hay `package.json`; `node --test tests/*.test.mjs`
  (112 archivos, 479 pruebas, ≈9 s).
- Resultado en `main` antes de este PR: **435 pasan, 44 fallan** — todas de
  paridad web/móvil (`case-views`, `dental-transfer`, `inline-scripts`,
  `lana-quick`, `oblique-prompt`, `optional-reference`, `quick-guided-flow`,
  `segmentation-poc`, `simulation-blueprint`). Con `mobile/www/app.html`
  sincronizado: **479/479**.
- Cobertura existente: filtros/pestañas (`smyl-inbox-focus-stage1`,
  `queue-focus-stage3`, `clean-header`), pipeline (`smyl-inbox-pipeline`),
  360 (`patient-360-stage3`, `lana-stage4-media-ficha360`,
  `smyl-inbox-automatic-patient-link-stage8`), permisos
  (`smyl-inbox-role-permissions`), tenant (`security-tenant-isolation-stage7`,
  `lana-inbox-*`), plantillas/recordatorios (`smyl-whatsapp-templates`,
  `smyl-appointment-reminders`, `appointment-reminders-dispatch`), fixtures
  `tests/fixtures/smyl-inbox-stage6/7-preview.html`.
- **Sin pruebas**: filtros por responsable/etapa/sucursal, chips de canal,
  vistas Ventana 24 h y Calidad de IA (no existen), layout de 3 columnas /
  responsive real (las pruebas son de texto sobre HTML, no de render),
  accesibilidad por teclado del drag, y un contrato automatizado de branding
  ("no aparece LANA / Bordados en la UI").

---

## F. Riesgos de colisión con la sesión paralela

Archivos que la otra sesión cambia a diario (19–20/10): `smyl-inbox.js`
(v29→v33), `smyl-inbox.css` (v30→v33), `smyl-navigation.js/css`, `app.html`
(rutas/PWA), `sw.js`, `mobile/www/*`, `smyl-templates*.js`,
`smyl-reminders.js`, `supabase/functions/appointment-reminders`.

Ítems del spec claramente "en vuelo" ahí: encabezado del hilo y menú ⋯,
compositor, logos de canal, pipeline básico, plantillas, recordatorios,
limpieza de `!important`. Tocar `.smyl-inbox-top`, `renderCareBar`,
`renderThreadHeader`, el compositor o el bloque final de `smyl-inbox.css` sin
coordinar producirá conflictos. Además, cada cambio de JS/CSS obliga a subir
`?v=` en `app.html` y `sw.js` y a copiar a `mobile/www/`, lo que multiplica los
choques en `app.html` / `sw.js`.

---

## G. Propuesta de reparto

**Inmediato:** `mobile/www/app.html` sincronizado (hecho en este PR, suite en
verde).

### Esta sesión de Claude — backend, contratos, tenant, permisos, pruebas

1. **P0 branding.** Sustituir las cadenas "LANA" visibles (`smyl-inbox.js:267,
   1300, 2555`; `smyl-templates.js` ×8; `smyl-reminders.js:159`;
   `smyl-clinic.js:108`; `smyl-proposals.js:233,265`; `smyl-readiness.js:16`)
   y sus copias móviles; añadir `tests/smyl-branding-isolation.test.mjs` que
   falle si "LANA" / "Bordados" aparece en texto de UI. Investigar con sesión
   real el origen de "Bordados Express" (quick replies / team / plantillas).
2. **Contrato v1.3** (documentar en `SMYL_LANA_CHAT_CONTRACT_V1.md` e
   implementar en `lana-inbox`): `branch_id`/`branch_name` y `priority` en el
   DTO; filtros `assignee`, `stage_id`, `branch_id` en `/inbox`;
   `GET /inbox/feedback`; `GET /inbox/whatsapp/windows` (o filtro
   `window=open|expiring|expired`); CRUD de etapas (`/inbox/stages`
   POST/PATCH con `position`, `archived`, `collapsed`) y semilla de las 8
   etapas dentales por tenant. Donde LANA no lo exponga, documentar la brecha
   sin simular.
3. **Matriz de capacidades por canal** consumida desde `lana-channels`
   (`/channels`), reemplazando los `if (channel === 'whatsapp')` de
   `smyl-inbox.js:856–868, 2441–2442, 2371, 2461`.
4. **Auditoría local** de cambio de etapa / asignación desde `lana-inbox`, con
   prueba.
5. **DTO `clinical_context` ampliado** (citas, alertas, consentimientos,
   tratamiento activo, archivos, saldo por rol) para alimentar el Paciente 360
   del chat sin duplicar `smyl-patient-360.js`; permisos revalidados en
   servidor.
6. Reemplazar `window.confirm/alert` por `smyl-dialog-system` en los ~25
   flujos del Inbox (política §11.4), coordinado con la otra sesión.

### Otra sesión de Claude / Codex — visual y UX

1. Consolidar `smyl-inbox.css` en las 10 secciones del spec con tokens
   `--smyl-*` y **una sola** definición de `.smyl-inbox-workspace` por
   breakpoint (3 columnas 300–320 / flexible / 300–320 plegable; drawer ≤1080;
   móvil apilado). Bloquea todo lo demás.
2. Fila de chips de canal con `CHANNEL_MARKS` como filtro visible con
   `aria-label`; retirar el `<select>` del panel.
3. Panel de filtros avanzados sobre los filtros que exponga el contrato v1.3.
4. Vistas hermanas Calidad de IA y Ventana 24 h sobre los nuevos endpoints;
   acción principal contextual en `renderCareBar()` (regla por `needs_human`
   / `paused` / vínculo / cita).
5. Pipeline: sucursal y "tiempo sin respuesta" en la tarjeta, drag accesible
   por teclado, tablero de 8 etapas dentales cuando exista la semilla.
6. Paciente 360 con pestañas (Resumen / Citas / Expediente / Tratamiento /
   Archivos / Finanzas / Conversación) reemplazando los 11 `<details>` de
   `organizeContextSections()`.
7. `visualViewport` en el compositor móvil; limitar `app.html:773` a
   `@media (max-width:760px),(hover:none)`.

### Regla de convivencia

Una sola sesión toca `smyl-inbox.js` / `smyl-inbox.css` por día; la otra
trabaja en `supabase/functions/`, `docs/` y `tests/`. Todo cambio de activo
sube `?v=` en `app.html` y `sw.js` y se copia a `mobile/www/`. Nada de esto se
publica en producción sin la suite en verde y revisión visual en escritorio,
tableta y móvil.
