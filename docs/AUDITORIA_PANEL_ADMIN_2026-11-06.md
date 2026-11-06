# Auditoría del panel admin de SMYL — robustez y escalabilidad (2026-11-06)

Alcance: panel profesional (`app.html` + ~75 scripts `smyl-*.js`) y el backend de Supabase que lo sirve. **No** incluye el simulador. Complementa la auditoría del 2026-10-26 (`AUDITORIA_ROBUSTEZ_SEGURIDAD_ESCALABILIDAD_SMYL_2026-10-26.md`).

Método: cuatro análisis independientes (operación, robustez del cliente, escalabilidad por pantalla con mediciones en navegador, costo de RLS con datos sembrados). Cada hallazgo indica si fue **[V] verificado** en código/medición o **[H] hipótesis/estimación**.

> Estado: el benchmark de costo de RLS (cuarto análisis) seguía corriendo al redactar esto; sus cifras se agregan en la sección 6 cuando llegue. Nada de lo de abajo depende de él.

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

## 6. Costo de RLS

Pendiente del benchmark (ms con/sin RLS a 1,000 / 5,000 / 20,000 pacientes y variante optimizada de políticas). Se agregará aquí.

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

**Fase 2 — Operación (1–2 semanas)**
10. CI en push/PR: `npm test` + validación de bundles + chequeo de migraciones.
11. Reconciliar migraciones repo vs. producción y fijar la versión del CLI en los workflows.
12. Cuota por clínica y límites de tasa para IA (activar `SMYL_CONSUMABLES_ENFORCED` tras medir); alertas de costo.
13. Retención/particionado de `smyl_audit_events`; cron de recordatorios sin tope fijo.
14. Reporte de errores del cliente a una tabla/servicio y alertas al dueño; simulacro de restauración con RPO/RTO documentados.

**Fase 3 — Estructural (1–2 meses)**
15. Minificar + empaquetar y cargar por ruta (≈ −140 KB gzip por minificar, ≈ −170 KB gzip en carga inicial con carga por ruta; estimaciones).
16. Reemplazar sondeo de Mensajes por Realtime/suscripción con retroceso exponencial.
17. Restricción de exclusión en agenda (rangos) y candado por zona horaria de la clínica.
18. Autoalojar supabase-js y versionar `CACHE_VERSION` en el build.
19. Pruebas que ejecuten pagos, agenda y permisos (hoy ~66 % solo leen el fuente).

## 8. No verificado

Estimaciones de costo de IA, crecimiento de auditoría y ahorro por empaquetado son modelos con supuestos, no mediciones en producción. No se midió carga concurrente real contra el proyecto de producción.
