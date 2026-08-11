# SMYL — reglas para Codex (GPT)

SMYL es un SaaS dental: `simulacion.html` (paciente) y `revision-clinica.html`
(dentista) generan simulaciones de carillas con IA sobre Supabase. App móvil
nativa envuelta con Capacitor en `mobile/`.

## Reparto de trabajo (vigente)

- **Codex (tú)**: diseño visual, frontend, UX, maquetación, CSS, componentes
  de interfaz, copy en pantalla. Trabajas principalmente en el HTML/CSS/JS de
  `simulacion.html` y `revision-clinica.html` que sea puramente visual/UX.
- **Claude Code**: arquitectura, backend, Supabase (Edge Functions, SQL,
  RLS, Storage), integraciones de IA (prompts de generación, OpenAI/Claude),
  seguridad, infraestructura móvil (Capacitor/Android/iOS), bugs de lógica.

## Antes de empezar

1. Lee `docs/HANDOFF.md` — ahí Claude y tú se dejan notas de qué se tocó
   recientemente y qué está en curso. Si algo que ibas a tocar aparece ahí
   como "en curso" por el otro lado, avisa en el chat con el usuario antes
   de modificarlo.
2. Antes de crear, revisar o modificar una simulación de carillas, lee
   `docs/CARILLAS_SIMULATION_CONTEXT.md` completo y úsalo como referencia de
   color VITA, anatomía, proporciones, material y diseño de sonrisa. La
   preferencia expresa del usuario y la preservación de la foto original
   prevalecen si existe conflicto.
3. Al terminar una sesión de cambios, agrega una entrada nueva en
   `docs/HANDOFF.md` (fecha, qué tocaste, qué archivos, cualquier cosa que
   el otro agente deba saber).

## No toques sin avisar primero

- `supabase/functions/**` (Edge Functions) — lógica de backend/IA.
- `supabase/migrations/**` — esquema de base de datos.
- Prompts de generación de IA dentro de `generateSimulation()`
  (simulacion.html) y `construirPromptCarillasIA()` (revision-clinica.html)
  — son configuración clínica/de IA, no diseño visual.
- `mobile/android/**`, `mobile/ios/**`, `capacitor.config.json` —
  configuración nativa.
- Claves, tokens o secrets — nunca los pegues en código ni en el chat.

## Reglas generales

- No inventes datos de pacientes reales ni subas fotos reales al repo.
- No cambies el esquema de Supabase sin una migración en
  `supabase/migrations/`.
- Después de editar `simulacion.html` o `revision-clinica.html`, sincroniza
  las copias en `mobile/www/` (`cp simulacion.html mobile/www/simulacion.html`,
  igual para revision-clinica.html) para que la app nativa quede al día.
- Cambios pequeños y enfocados; evita tocar módulos fuera de lo pedido.
- Antes de dar por terminado: revisa visualmente en escritorio, tablet y
  celular.
