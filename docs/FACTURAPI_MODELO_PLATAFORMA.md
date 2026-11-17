# Facturapi · modelo de plataforma para clínicas (plan)

Estado: **plan con API verificada en pruebas; sin implementar**. Fecha: 2026-11-17.
Hoy SMYL tiene el modelo «la clínica trae su propia cuenta y llave de Facturapi» (función `facturapi`, solo sandbox). Este documento propone el modelo para vender SMYL a muchas clínicas sin que cada una tenga que registrarse en Facturapi.

## 1. Idea en una frase

SMYL tiene **una sola cuenta de plataforma** en Facturapi. Por cada clínica crea una **organización** de Facturapi, le carga los datos fiscales y su **CSD** (certificado de sello digital), y timbra a su nombre. La clínica nunca toca Facturapi: solo captura sus datos fiscales y sube sus archivos del SAT dentro de SMYL.

## 2. Verificado contra la API real (2026-11-17, ambiente de pruebas, con una User Secret Key)

Se probó con una llave de usuario real, creando y borrando organizaciones desechables. No se emitió ninguna factura.

| Operación | Resultado |
|---|---|
| `GET /v2/organizations` | Lista las organizaciones de la cuenta de plataforma. |
| `POST /v2/organizations` `{name}` | Crea una organización vacía (200). |
| `PUT /v2/organizations/{id}/legal` | Exige `name`; acepta `legal_name`, `tax_system`, `address.zip`… **No acepta `tax_id`**: el RFC lo toma Facturapi del CSD (sin CSD asigna un RFC de prueba). |
| `PUT /v2/organizations/{id}/certificate` | Existe; espera archivos en multipart (`certificate_files_required` si no hay). **Falta probarlo con un CSD de prueba.** |
| `GET /v2/organizations/{id}/apikeys/test` | Devuelve la llave de pruebas como texto. |
| `GET /v2/organizations/{id}/apikeys/live` | Devuelve una lista (vacía mientras la organización no está lista para producción). |
| `DELETE /v2/organizations/{id}` | Borra la organización (200). |
| `GET /v2/organizations/me` con llave de organización | Es lo que usa hoy SMYL para verificar la llave (funciona). |

**Una organización necesita tres pasos para producción** (`pending_steps`): `legal` (datos fiscales), `certificate` (CSD) y **`manifiesto` (Firmar Carta Manifiesto)**. Cada organización trae además `is_production_ready`, `certificate.expires_at` y `certificate.serial_number`, útiles para alertas de vigencia.

**La Carta Manifiesto no tiene ruta en la API** (las rutas probadas responden 401/inexistente). Es un paso humano por clínica que hay que resolver (¿se firma en el panel de Facturapi? ¿con e.firma?). Es el principal bloqueo de producto para el onboarding.

**Aún sin verificar:** carga real de un CSD, cómo se firma el manifiesto, si hace falta un plan de pago para facturar en vivo (la organización existente tiene `plan: null` y está lista), límites de tasa y cómo avisa una cancelación.

## 2.1 Decisiones que son del dueño del producto (no técnicas)

1. **¿Quién paga el timbrado?** SMYL lo absorbe en el plan, se cobra por factura, o la clínica paga su propio plan de Facturapi. Cambia el modelo de datos de consumo.
2. **Acuerdo con Facturapi** para uso de plataforma (punto 3 de arriba). Sin esto, el plan puede ser inviable o más caro.
3. **Responsabilidad y consentimiento:** la clínica autoriza a SMYL a timbrar a su nombre y a custodiar temporalmente su CSD. Requiere texto en Términos y Aviso de privacidad (`terminos.html`, `privacidad.html`) revisado por un abogado.
4. **¿Se conserva el modo «traer mi propia cuenta»?** Recomendado sí, como opción avanzada (ya está construido).

## 3. Arquitectura propuesta

```
Navegador (clínica)            Edge Function `facturapi`            Facturapi
 datos fiscales ─────────────►  valida + permiso finance.manage
 .cer + .key + contraseña ───►  (multipart, solo en memoria) ─────► crea organización
                                                                    datos legales
                                                                    sube CSD
                                ◄───────────────────────────────── llave de la organización
                                cifra la llave (AES-GCM, tenant = AAD)
                                guarda: organization_id, llave cifrada, vigencia del CSD
```

- **Secretos del servidor:** `FACTURAPI_USER_KEY` (plataforma, llave de usuario) y `FACTURAPI_ENCRYPTION_KEY` (ya existe; pasa a ser versionada: `kid` para poder rotarla).
- **Por clínica se guarda:** `organization_id`, llave de organización cifrada, modo (`test`/`live`), huella, vigencia del CSD (no el CSD).
- **El CSD y su contraseña nunca se guardan en SMYL ni se registran en logs.** Viajan navegador → función → Facturapi, en memoria, y se descartan.
- **Comprobantes:** UUID, XML y PDF se guardan en Storage privado de SMYL (los datos pertenecen a la clínica según `SMYL_PLATFORM_BOUNDARY.md`). El SAT exige conservar el XML.

### Qué se reutiliza de lo ya construido
Tabla `smyl_facturapi_connections` (se amplía), cifrado AES-GCM (`_shared/facturapi-core.mjs`), la función `facturapi` (nuevas acciones), el perfil fiscal del emisor (`smyl_issuer_fiscal_profiles`), el reporte de preparación y la pantalla de cuatro pasos.

### Cambios de base de datos (migración nueva, no editar la existente)
- `smyl_facturapi_connections.environment` acepta `'test'` y `'live'` (hoy solo `'test'`).
- Columnas: `mode` (`platform`|`own_key`), `csd_valid_until`, `csd_serial`, `key_version`, y la posibilidad de tener llave de pruebas y de producción por clínica.
- Eventos nuevos en `smyl_facturapi_connection_events`: `organization_created`, `csd_uploaded`, `csd_removed`, `went_live`.
- Tabla de timbrado (fase 2): comprobantes emitidos con UUID, rutas de XML/PDF, estado y errores del proveedor.

## 4. Experiencia de la clínica (más simple que hoy)

Hoy: 4 pasos y uno de ellos exige crear cuenta en Facturapi y copiar una llave. Propuesto:

1. **Datos fiscales** de la clínica (igual que ahora).
2. **Sube tu e.firma de facturación (CSD):** arrastra `.cer`, `.key` y escribe la contraseña. Un botón: **Activar facturación**. SMYL hace el resto (crear organización, datos legales, CSD) y muestra «Listo · CSD vigente hasta …».
3. **Servicios con clave SAT** (igual).
4. **Revisión del contador** (igual).
5. **Pasar a producción** (nuevo, deliberado): resumen, confirmación explícita y registro de quién lo activó.

Todo empieza en **pruebas** para todas las clínicas; producción es un paso aparte y reversible solo por soporte.

Ayudas en pantalla: qué es el CSD y dónde se obtiene (SAT → Certisat Web), por qué **no** es la e.firma (FIEL), aviso de vencimiento (30/7 días), errores en lenguaje claro («la contraseña no corresponde a este certificado», «el RFC del certificado no coincide con el de la clínica»).

## 5. Seguridad

- Permiso `finance.manage` (y `finance.invoice` para timbrar) verificado en la función y en base de datos.
- Archivos: solo `.cer`/`.key`, tamaño máximo pequeño, verificación de tipo, no se escriben a disco.
- Contraseña del CSD: nunca en logs, errores ni auditoría; respuesta de error genérica.
- Límite de intentos por clínica (evita usar la función para adivinar contraseñas).
- Auditoría de cada acción sin material sensible.
- Aislamiento por clínica: llave cifrada con el `tenant_id` como dato autenticado (ya implementado); prueba de dos clínicas (`scripts/two-tenant-isolation.mjs`).
- Rotación: `FACTURAPI_ENCRYPTION_KEY` versionada con re-cifrado; la llave de usuario de plataforma se rota sin tocar las organizaciones.
- Baja de una clínica: borrar CSD en Facturapi y la llave guardada; conservar los comprobantes ya emitidos según la política de retención.
- Riesgo de concentración: la llave de usuario controla todas las organizaciones. Solo la función `facturapi` la lee; no se expone a ninguna otra.

## 6. Fases

| Fase | Entrega | Depende de |
|---|---|---|
| **0. Spike y decisiones** | Probar con una cuenta real: crear organización, subir CSD de prueba, obtener llave, emitir una factura de prueba. Cerrar las decisiones de §2.1. | Cuenta de plataforma en Facturapi |
| **1. Organizaciones y CSD (pruebas)** | Migración v2; acciones `provision` y `upload_csd`; paso 2 nuevo con carga de CSD; alertas de vigencia. | Fase 0 |
| **2. Timbrado (pruebas)** | Borrador → `submitted` → `issued`; guardar UUID/XML/PDF; idempotencia; errores legibles; descarga y envío al paciente. | Fase 1 |
| **3. Cancelación** | Motivos 01–04, estado de aceptación del SAT, sustitución. | Fase 2 |
| **4. Producción** | Paso «Pasar a producción», llave live, monitoreo, runbook de soporte. | Fase 2 y acuerdo comercial |
| **5. Operación** | Medición de consumo/cobro por timbre, alertas, reporte para soporte. | Decisión de §2.1-1 |

Orden recomendado: 0 → 1 → 2 → 4 → 3 → 5. La cancelación puede esperar a que haya facturas reales.

## 7. Pruebas de aceptación (por fase)

- Dos clínicas a la vez: cada una ve solo su organización, su CSD y sus comprobantes.
- Un CSD inválido, vencido o de otro RFC se rechaza con un mensaje claro y no deja basura en Facturapi ni en SMYL.
- La contraseña y los archivos no aparecen en logs, en el DOM ni en la base de datos.
- Repetir «Activar facturación» no duplica organizaciones (idempotente).
- Timbrar dos veces el mismo borrador produce una sola factura.
- Desconectar y volver a conectar conserva el historial.
- Si Facturapi no responde, la clínica ve un error claro y puede reintentar sin duplicar.

## 8. Qué NO incluye este plan
Facturación a públicos distintos de pacientes (nómina, complementos de pago PPD, notas de crédito) y reportes contables. Se evalúan después de producción.

## Fuentes consultadas
- [Changelog del SDK oficial de Facturapi](https://unpkg.com/facturapi@4.8.3/CHANGELOG.md) (métodos de organización, certificado y llaves).
- [Ejemplo público de carga de certificado con llave de usuario](https://gist.github.com/javorosas/ac177ee1b3c487153f66dc9377a495f7) (no oficial; verificar).
- [SDK de Node de Facturapi](https://github.com/FacturAPI/facturapi-node).
