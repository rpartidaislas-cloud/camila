# Privacidad, consentimientos y derechos ARCO en SMYL

Documento vivo: cada decisión nueva se agrega, nunca se borra una fila de la bitácora.
Texto legal del aviso: **borrador** (`modelo-provisional-2`). Un abogado debe revisarlo antes de usarlo con pacientes reales.

## Qué hay y dónde está

| Pieza | Qué hace | Dónde |
|---|---|---|
| Aviso de privacidad firmado | Guarda el texto exacto, su versión, la firma y quién/cómo firmó | `smyl_patient_consents` · `smyl-privacy-notice.js` |
| Firma en la clínica | Consultorio → «Pedir firma». Pide las 3 decisiones | `smyl-consultorio.js` |
| Firma desde el celular del paciente | Enlace de un solo uso, vence a las 48 h. Página pública sin cuenta | `aviso-firma.html` · `smyl_consent_links` · RPC `smyl_create_consent_link`, `smyl_consent_link_info`, `smyl_consent_link_sign` |
| Decisiones por finalidad | IA, WhatsApp, promociones; cada cambio es un registro inmutable | `smyl_patient_privacy_events` · `smyl_set_patient_privacy_choice` |
| Solicitudes ARCO | Registro con plazo de 20 días hábiles | `smyl_data_rights_requests` · pantalla «Privacidad y derechos» |
| Sección en el expediente | «6 · Privacidad» en la Historia clínica | `smyl-patient-privacy-panel.js` |
| Aviso de posible solicitud en el chat | Detecta frases claras de ARCO y deja registrar con un clic | `smyl-privacy-inbox.js` |
| Aviso automático por WhatsApp | A pacientes nuevos, con la plantilla `aviso_privacidad_v1`. Apagado por defecto | `privacy-notice-dispatch` · `smyl_privacy_settings` · `smyl_consent_dispatches` |
| Candado de IA | Si el paciente negó la IA, no se manda a un proveedor externo | `_shared/privacy.ts` + `privacy-core.mjs` |

## Regla del candado de IA

- Solo se bloquea cuando el paciente **negó o retiró** el permiso (`revoked`). Sin decisión (`unknown`) sigue como antes.
- Si no se puede comprobar (error de base de datos) se bloquea: ante la duda no se manda nada a un tercero.
- Es una protección del flujo de la clínica, no una frontera de seguridad: lo aplica el servidor, pero depende de que el panel diga de qué paciente son los datos.

### Funciones con candado
`claude` (fotos clínicas) · `periodontal-summary` · `radiograph-analyze` · `mila-interview` (la entrevista previa pasa a formulario sin IA) · `cloud-classify` (por el paciente del archivo) · `fiscal-extract` (el panel manda `patient_id`).

### Funciones SIN candado y por qué
| Función | Motivo | Qué haría falta |
|---|---|---|
| `segment-teeth`, `analizar-foto` | El simulador trabaja con «casos» (`camila_casos`) que no están ligados a un paciente en el esquema | Ligar cada caso del simulador a un paciente y mandarlo en la llamada |
| `mila-transcribe`, `mila-clinical-dictation` | Reciben solo audio; el panel no manda paciente | Que el panel mande el paciente al dictar |

## Despliegue de Edge Functions (Verify JWT)

| Función | JWT |
|---|---|
| `claude`, `radiograph-analyze`, `cloud-classify`, `fiscal-extract`, `whatsapp-templates` | Activado |
| `mila-interview` (entra por token de QR), `periodontal-summary`, `privacy-notice-dispatch` | Desactivado (revisan sesión y permiso dentro del código) |

**Los paquetes de `docs/bundles` se pegan en el panel de Supabase.** Un nombre repetido entre módulos `_shared` rompe la función al arrancar (BOOT_ERROR) aunque el código fuente se vea bien. `tests/bundles-privacidad-compilan.test.mjs` los compila tal como se pegan. Regla: un módulo `_shared` **no** reexporta nombres importados (`export { ... }`).

## Límites conocidos
- El aviso automático depende de que alguien abra SMYL (corre desde el navegador). Sin panel abierto no sale. Hacerlo 100 % automático requiere una tarea programada con una variante de servidor de `smyl_create_consent_link`.
- La detección de solicitudes ARCO en el chat solo reconoce frases claras y solo en texto (no notas de voz), con el hilo abierto.
- LANA no contesta nada legal por sí sola: borrar o entregar datos exige que una persona verifique quién escribe.
- `smyl_consent_link_sign` guarda el texto del aviso que manda la página; un portador del enlace podría enviar otro texto para ESE paciente. El riesgo se limita a ese enlace de un solo uso.

## Bitácora

| Fecha | Caso | Qué se hizo |
|---|---|---|
| 2026-11-20 | Etapa 1: pantalla «Privacidad y derechos», decisiones por paciente, exportación | Migración `20261123100000` |
| 2026-11-21 | Firma desde el celular del paciente | Migración `20261124100000`, `aviso-firma.html` (asistente de 3 pasos) |
| 2026-11-21 | Candado de IA en 4 funciones | `_shared/privacy.ts` |
| 2026-11-21 | Sección «Privacidad» en el expediente; firma en pantalla con 3 decisiones | `smyl-patient-privacy-panel.js` |
| 2026-11-21 | Aviso de posible solicitud ARCO en el chat | `smyl-privacy-inbox.js` |
| 2026-11-21 | Aviso automático a pacientes nuevos | Migración `20261124200000`, `privacy-notice-dispatch` |
| 2026-11-21 | Error propio: bundles con declaración duplicada (BOOT_ERROR) en las 4 funciones con candado | Corregido; candado extendido a `cloud-classify` y `fiscal-extract`; prueba de compilación de bundles |
