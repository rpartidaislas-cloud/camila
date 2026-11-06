# Auditoría del panel admin de SMYL — robustez y escalabilidad (2026-11-06)

Alcance: panel profesional (`app.html` + ~75 scripts `smyl-*.js`) y el backend de Supabase que lo sirve. **No** incluye el simulador. Complementa la auditoría del 2026-10-26 (`AUDITORIA_ROBUSTEZ_SEGURIDAD_ESCALABILIDAD_SMYL_2026-10-26.md`).

Método: cuatro análisis independientes (operación, robustez del cliente, escalabilidad por pantalla con mediciones en navegador, costo de RLS con datos sembrados). Cada hallazgo indica si fue **[V] verificado** en código/medición o **[H] hipótesis/estimación**.

> Los cuatro análisis están integrados. La sección 6 resume la medición de RLS.

## 1. Veredicto

| Escenario | Veredicto |
|---|---|
| 1 clínica, hasta ~3,000 pacientes | **Usable, con 3 defectos medidos** (Caja, "Sin citas todavía", lista de pacientes). |
| ~200 clínicas en la misma base | **La base aguanta; lo que se degrada es operación**: tabla de auditoría sin retención, sin CI, sin alertas, sin cuota de IA por clínica. |
| ~1,000 usuarios concurrentes | **No listo sin cambios**: sondeo de Mensajes cada 5 s y 38–46 peticiones en el arranque por sesión. Hay que quitar polling y recortar el arranque antes. |
| Robustez general | **Sin P0 confirmados** en el cliente, pero hay P1 de "éxito falso" y pantallas en blanco sin aviso. |

## 2. Hallazgos P0 (corregir primero)

1. **[V] Caja: congelamiento de 6.5–6.9 s** con volumen alto, por costo cúbico (`smyl-finance.js` ~22/29/79).
2. **[V] "Sin citas todavía" es falso para ~64 % de los pacientes** cuando la clínica supera el tope de 1,000 filas (`smyl-clinic.js` ~609–610). Dato clínico incorrecto mostrado como cierto.
3. **[V] Lista de pacientes completa en el DOM** (73 mil nodos con 5,000 pacientes) y búsqueda sin debounce.

## 3. Hallazgos P1

Robustez / correctitud
- **[V] Guardados de configuración reportan éxito aunque haya `{error}`** (`guardarPerfil` traga el error y avisa "Perfil guardado") y pueden **sobrescribir `config` con una copia vieja** (riesgo de revertir la conexión LANA escrita por `lana-connection`).
- **[V] `toggleMiembroActivo` ignora el error.**
- **[V] Formularios de finanzas (11/11) sin deshabilitar el botón y con la llave de idempotencia creada al enviar** → doble clic = doble cobro/registro.
- **[V] Rol por defecto "dueño" si la consulta de rol falla** (`app.html` ~2586–2597): falla abierta en la UI (el servidor sigue protegiendo).
- **[V] Pantallas en blanco sin aviso** si falla un script de Agenda/Mensajes/Finanzas (solo 2 de 75 scripts avisan; `ir()` ~3039).

Costo y abuso de IA
- **[V] El proxy `claude` acepta `model` y `max_tokens` del cliente** (`supabase/functions/claude/index.ts` ~1069–1070): cualquier sesión puede pedir el modelo más caro.
- **[V] El análisis radiográfico no consume cuota por clínica** (solo se registra en `smyl_ai_usage_log`; `SMYL_CONSUMABLES_ENFORCED` está en false). **[H]** Costo estimado ≈ USD 0.24 típico / 0.51 peor caso por análisis (dos llamadas); ~USD 24/mes por clínica a 100 análisis, ~USD 4,800/mes con 200 clínicas.

Escalabilidad
- **[V] El arranque carga todos los pacientes para un `select`** (`app.html` ~2672–2676).
- **[V] Agenda: 32–33 peticiones por clic** y truncamiento al cambiar de mes.
- **[V] Directorio y Caja leen tablas sin límite ni orden.**
- **[V] Carga en frío** (Fast 3G + CPU 4×): FCP 5.4 s, listo 9.8 s; 128 archivos estáticos, 848 KB gzip (2.98 MB crudo); 89 % del JS no se necesita para Inicio.
- **[H]** `smyl_audit_events` ≈ 90–130 mil filas/clínica/año → 18–26 M filas (30–50 GB) con 200 clínicas, sin retención ni particiones.

Operación
- **[V] Sin CI**: 11 workflows, todos manuales; 238 archivos de prueba que nadie corre automáticamente al hacer push/PR.
- **[V] No hay comparación reproducible repo vs. producción de migraciones** (119 migraciones, 5 vacías, 7 base `camila_*` sin versionar).
- **[V] Bundles de Edge Functions se pegan a mano** (34 bundles; 8 funciones sin bundle); workflows usan `supabase/setup-cli@v1` con `version: latest`.
- **[V] Observabilidad casi nula**: errores por `alert()`, sin alertas al dueño, `security-monitor` no alerta; sin simulacro de backup ni RPO/RTO definidos.

## 4. Hallazgos P2 (resumen)

- Doble envío en agenda/inventario; verificación de duplicados falla abierta (`smyl-clinic.js` ~767); sin manejo global de sesión expirada; sin cola offline; sin `beforeunload` en agenda/finanzas/paciente 360/inventario.
- Insignia de no leídos se congela tras 3 fallos (`smyl-inbox.js` ~1937).
- Radiografía: sin cronómetro, 500 en vez de 504 al agotar tiempo, reintento vuelve a cobrar; descarga el original completo.
- `count:'exact'` sin `head`; peticiones de arranque duplicadas; inventario carga todos los pacientes.
- Candado de agenda usa `p_starts_at::date` (UTC) sin restricción de exclusión (migraciones de tiempo extra).
- Recordatorios con `limit(200)`; `meta-send` sin `AbortController`; supabase-js desde CDN (jsDelivr); `CACHE_VERSION` manual; `window.onerror` con `alert`.
- Pruebas: ~74 de 231 ejecutan código; ~154 solo leen el fuente; ninguna ejecuta pagos, agenda o permisos.

Lo que está bien: patrón de guardado de pacientes, borrador/idempotencia de Mensajes, sin fugas en 25 ciclos de navegación.

## 5. Dependencias externas (puntos únicos de falla)

LANA (chat/IA), una sola llave de Anthropic, OpenAI/Gemini, Replicate, Meta, Stripe, Google Calendar, jsDelivr, GitHub Pages, pg_cron.

## 6. Costo de RLS por fila (medido en PGlite con datos sembrados)

Aviso: PGlite es Postgres en WASM de un hilo; los ms absolutos **no** representan a Supabase, sirven las razones relativas y el crecimiento. Se cargaron las migraciones reales y se sembraron 5 clínicas (hasta 100 mil pacientes y 250 mil citas en total).

- **[V] Las políticas `pacientes_read` y `smyl_appointments_read` evalúan 5 funciones por fila** (`smyl_has_permission`, `smyl_effective_scope`, `smyl_current_professional_id`, `smyl_scope_rank`, `smyl_can_access_patient`), cada una con consultas. El costo es lineal en filas evaluadas (~50 µs/fila titular, 95–115 µs/fila staff) y el planner estima mal la selectividad (2,209 estimadas vs 20,000 reales), por lo que cada página reevalúa todo el tenant.
- **Impacto por tamaño de clínica** (count/top-N sobre todos los pacientes, vs. sin RLS): hasta 1,000 pacientes tolerable (0.05–0.25 s); a 5,000, 0.25–0.6 s por consulta (x100–x600) y la carga completa de pacientes 1.6–3 s; a 20,000, count/top50 de 1–2 s y la carga completa 10–18 s en WASM (la app solo trae 10,000 de 20,000). En Supabase real se espera 5–10× menos **[H]**; confirmar en staging.
- **[V] Citas no son problema** (x2–x5): el costo depende de las filas devueltas.
- **[V] Corrección medida:** el patrón `(select smyl_has_permission(...))` **no** ayuda (queda correlacionado). Sí ayuda calcular conjuntos que no dependen de la fila (helpers `stable security definer` como `smyl_tenants_with_permission`, `smyl_patient_ids_in_scope`, `smyl_my_professional_ids`, usados con `tenant_id in (select …)`): a 20 mil pacientes, count 965→7 ms, carga completa 9.6 s→0.5 s (titular y clínica) y 9.9 s→0.2 s (staff `own`), con conjuntos de ids idénticos al original en los 4 perfiles. Citas del mes quedan a la par que sin RLS. SQL de referencia en la carpeta de trabajo del análisis (sql/variants.sql, sql/pol_v2.sql).
- **No cubierto:** `pacientes_edit` y demás tablas con el mismo patrón (notas, historias, archivos, finanzas) no se midieron; usuarios en varias clínicas con distinto alcance no se probaron.
- **Auditoría (`smyl_audit_row`)**: UPDATE masivo ×2.6–2.8; ~2.1 KB por evento (before+after). **[H]** ~100 MB por clínica al año con 10 mil citas; las tablas con documentos jsonb de hasta 64 KB guardan el documento dos veces por cambio (por lectura de código, sin medir). Leer la bitácora con `audit.read` por fila: 432 ms para 19,600 filas; `ORDER BY … LIMIT 50` es barato.
- **Hallazgo lateral [H, por lectura de migraciones]:** una clínica nueva no recibe filas en `smyl_role_scopes` (la migración 20261015040000 solo sembró los roles existentes ese día), de modo que un usuario de recepción tendría alcance `own` y vería 0 pacientes. Falta confirmar si otro camino (Edge Function/RPC) las siembra en producción.

## 7. Plan de acción

**Fase 0 — Ganancias rápidas (1–2 días, bajo riesgo)**
1. `claude`: ignorar `model`/`max_tokens` del cliente (lista cerrada por función en el servidor).
2. Revisar `{error}` en todos los guardados de configuración y no sobrescribir `config` con copia vieja (actualizar solo las claves propias, o `jsonb ||` en servidor).
3. Finanzas: deshabilitar botón al enviar y crear la llave de idempotencia al abrir el formulario.
4. `toggleMiembroActivo` y duplicados: manejar el error; rol por defecto = sin permisos si falla la consulta.
5. Aviso visible cuando un panel no carga (en lugar de pantalla en blanco).

**Fase 1 — Defectos medidos de escala (1 semana)**
6. Caja: reescribir con índices/mapas (O(n)), paginar y ordenar.
7. "Sin citas todavía": consultar por paciente (o RPC con conteo) en vez de inferir de un tope de 1,000.
8. Lista de pacientes: paginación o virtualización + debounce en búsqueda; quitar la carga de todos los pacientes del arranque (buscador remoto).
9. Agenda: consolidar las 32 peticiones en una consulta por rango.
10. RLS: reescribir `pacientes_read`/`smyl_appointments_read` con conjuntos precalculados (sección 6), con prueba de equivalencia por perfil y pgTAP; después las demás tablas con el mismo patrón. Verificar en staging de Supabase y confirmar la siembra de `smyl_role_scopes` en clínicas nuevas.

**Fase 2 — Operación (1–2 semanas)**
11. CI en push/PR: `npm test` + validación de bundles + chequeo de migraciones.
12. Reconciliar migraciones repo vs. producción y fijar la versión del CLI en los workflows.
13. Cuota por clínica y límites de tasa para IA (activar `SMYL_CONSUMABLES_ENFORCED` tras medir); alertas de costo.
14. Retención/particionado de `smyl_audit_events`; cron de recordatorios sin tope fijo.
15. Reporte de errores del cliente a una tabla/servicio y alertas al dueño; simulacro de restauración con RPO/RTO documentados.

**Fase 3 — Estructural (1–2 meses)**
16. Minificar + empaquetar y cargar por ruta (≈ −140 KB gzip por minificar, ≈ −170 KB gzip en carga inicial con carga por ruta; estimaciones).
17. Reemplazar sondeo de Mensajes por Realtime/suscripción con retroceso exponencial.
18. Restricción de exclusión en agenda (rangos) y candado por zona horaria de la clínica.
19. Autoalojar supabase-js y versionar `CACHE_VERSION` en el build.
20. Pruebas que ejecuten pagos, agenda y permisos (hoy ~66 % solo leen el fuente).

## 8. No verificado

Estimaciones de costo de IA, crecimiento de auditoría y ahorro por empaquetado son modelos con supuestos, no mediciones en producción. No se midió carga concurrente real contra el proyecto de producción.

## 9. Estado de implementación (actualizado al cierre de la sesión del 2026-11-06)

| # | Punto del plan | Estado |
|---|---|---|
| 1 | `claude`: modelo y `max_tokens` del cliente acotados | Hecho (requiere desplegar el bundle) |
| 2 | Guardados de configuración con error real y sin pisar claves ajenas | Hecho |
| 3 | Finanzas: sin doble envío | Hecho (llave de idempotencia por envío; el bloqueo evita el segundo) |
| 4 | `toggleMiembroActivo` y rol fail-closed | Hecho |
| 5 | Aviso cuando un panel no carga | Hecho |
| 6 | Caja lineal | Hecho (equivalencia probada; prueba de regresión en `tests/finance-account-math.test.mjs`) |
| 7 | «Sin citas todavía» veraz | Hecho |
| 8 | Lista de pacientes paginada / búsqueda diferida / arranque sin carga total | Hecho |
| 9 | Agenda: configuración estática reutilizada al navegar | Hecho (de 32 peticiones se evitan 14 por clic; el resto sigue) |
| 10 | RLS por conjuntos + alcances de rol en clínicas nuevas | Hecho (migraciones 20261106100000/110000; requiere ejecutar el workflow) |
| 11 | CI en push/PR | Hecho (`pruebas.yml`; 2 pruebas conocidas excluidas) |
| 12 | Reconciliar migraciones repo vs producción | Herramienta lista (`smyl-migraciones-reconciliar.yml`, solo lectura); falta ejecutarla y resolver diferencias |
| 13 | Cuota de IA por clínica (radiografía) | Hecho (tope diario/mensual, falla cerrado; requiere desplegar el bundle) |
| 14 | Retención de `smyl_audit_events` | Hecho (compactación a 24 meses; requiere ejecutar el workflow) |
| 15 | Reporte de errores del cliente | Hecho (registro `smyl_client_errors` + aviso discreto en lugar de `alert()`; requiere ejecutar el workflow). **Alertas al dueño/equipo: pendiente** — hoy los errores se consultan en la tabla, nadie recibe aviso automático |
| 16 | Minificar/empaquetar y carga por ruta | **Pendiente** (decisión: cambia el despliegue y rompe pruebas que fijan cada script) |
| 17 | Sondeo de Mensajes | Parcial: sondeo adaptativo hecho; Realtime depende de LANA (contrato SMYL↔LANA) |
| 18 | Anti-empalme + candado de agenda | Hecho (restricción de exclusión; requiere ejecutar el workflow) |
| 19 | supabase-js local | Hecho |
| 20 | Pruebas que ejecuten pagos, agenda y permisos | Parcial: pagos (Caja) y IA (topes) ejecutan código real; agenda y permisos en base de datos se verificaron con PGlite pero no están en el repo |

Pendientes con decisión de producto: ventana de retención (24 meses por omisión), políticas por clínica, y si se adopta un paso de compilación.
