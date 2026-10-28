# SMYL — plan de implementación para análisis radiográfico asistido por IA

**Responsable sugerido:** Claude Code

**Fecha del plan:** 2026-10-27

**Estado:** listo para ejecución por etapas; no implica que las funciones avanzadas ya existan

**Alcance:** radiografías dentales 2D primero; CBCT/DICOM como producto independiente

## 1. Objetivo y definición honesta del producto

Construir en SMYL un espacio de revisión radiográfica que:

1. preserve el estudio original y su procedencia;
2. evalúe si la imagen tiene calidad suficiente para el análisis solicitado;
3. proponga piezas, regiones y señales visuales como **candidatos**;
4. permita al dentista confirmar, corregir o descartar cada candidato;
5. produzca un informe profesional firmado únicamente a partir de hallazgos confirmados;
6. mantenga una historia longitudinal por estudio y pieza;
7. separe por completo el visor 2D del futuro módulo CBCT/DICOM.

Hasta contar con un motor especializado, datos de validación y revisión regulatoria, la interfaz debe decir **“revisión asistida”**, **“señal candidata”** o **“hallazgo por confirmar”**. No debe prometer diagnóstico automático, detección clínica certificada ni equivalencia con un dispositivo médico comercial.

## 2. Qué existe y debe conservarse

No reconstruir estos componentes sin una razón documentada:

- `smyl-radiograph-analysis-client.js`: una llamada consentida para revisar una radiografía 2D verificada.
- `smyl-radiograph-review-model.js`: contrato estricto del informe y estados `ready/requested/completed/unconfirmed`.
- `smyl-radiograph-review-store.js`: persistencia privada sin respaldo inseguro en navegador.
- `smyl-radiograph-review.js`: espacio de revisión con zoom, desplazamiento, marcador, edición, confirmación y descarte.
- `smyl-dental-record.js`: archivos originales, visor, odontograma y vinculación de observaciones confirmadas.
- `supabase/migrations/20261006010000_smyl_radiograph_reviews.sql`: original de IA inmutable, versiones, RLS y concurrencia optimista.
- `supabase/migrations/20261027130000_smyl_patient_timeline_v2.sql`: cronología de la ficha 360.
- `smyl-patient-360.js`: navegación longitudinal del expediente.

### Restricción crítica

`supabase/functions/segment-teeth` fue diseñado para fotografías de sonrisa/dientes visibles. **No reutilizarlo para radiografías.** Su asignación FDI por posición y sus máscaras fotográficas no constituyen segmentación radiológica.

## 3. Pendientes reales

### 3.1 Control de calidad

- Clasificar automáticamente panorámica, periapical, bitewing, serie intraoral o tipo desconocido.
- Detectar movimiento/desenfoque, recorte anatómico, exposición, contraste, superposición, compresión y orientación.
- Devolver probabilidades, límites y análisis aplicables; nunca una decisión opaca.
- Permitir que el dentista corrija el tipo de estudio.

### 3.2 Odontograma asistido

- Localizar cada pieza visible y proponer numeración FDI.
- Marcar piezas no evaluables y numeración incierta.
- Proponer candidatos de restauración, corona, implante, tratamiento endodóntico y pieza aparentemente no visible, sin convertirlos automáticamente en diagnóstico.
- Guardar geometría trazable por estudio, modelo y versión.

### 3.3 Revisión por pieza

- Tarjeta por pieza/región con recortes de las fuentes aplicables.
- Contorno o región de interés sobre la imagen, no sólo un punto.
- Etiqueta de evidencia, confianza calibrada y explicación de limitaciones.
- Acciones explícitas: `Confirmar`, `Corregir`, `Descartar`, `Comparar con anterior`.

### 3.4 Informe profesional

- Resumen radiográfico basado exclusivamente en hallazgos confirmados.
- Prioridades configurables por el dentista, preguntas clínicas e información faltante.
- Firma profesional, bloqueo de versión y adenda posterior; nunca edición silenciosa de un informe firmado.
- Exportación con trazabilidad del original, modelo y revisiones.

### 3.5 Historia longitudinal

- Comparación por paciente, pieza, región, fecha y tipo de estudio.
- Registro separado de cambio técnico, cambio aparente y cambio confirmado por el dentista.
- Comparador visual sincronizado y métricas sólo cuando el método esté validado.

### 3.6 CBCT/DICOM

- Ingesta DICOM, estudios/series/instancias y almacenamiento especializado.
- Visor axial, coronal, sagital, MPR y reconstrucción panorámica.
- Segmentación 3D únicamente con motor especializado y validado.
- Producto, permisos, infraestructura y validación separados del flujo 2D.

## 4. Arquitectura objetivo

```text
Archivo original
  -> Ingesta segura + hash + metadatos
  -> Control de calidad y clasificación
  -> Motor radiográfico especializado
  -> Resultado estructurado, inmutable y versionado
  -> Revisión humana por pieza/región
  -> Hallazgos confirmados
  -> Informe firmado
  -> Odontograma + historia longitudinal
```

Separar cuatro clases de datos:

1. **Fuente:** original, hash, tipo MIME, dimensiones, fecha, procedencia y consentimiento.
2. **Salida del modelo:** proveedor, nombre y versión del modelo, contrato, probabilidades, geometrías y limitaciones.
3. **Decisión profesional:** texto corregido, pieza, región, estado y responsable.
4. **Documento clínico:** informe firmado y adendas.

La salida del modelo nunca debe sobrescribir la decisión profesional.

## 5. Contratos propuestos

Crear contratos versionados en un módulo compartido, por ejemplo:

- `smyl-radiograph-contracts.js` para navegador y pruebas.
- `supabase/functions/_shared/radiograph-contracts.ts` para servidor.
- Vectores JSON canónicos en `tests/fixtures/radiograph-contracts/`.

### 5.1 Resultado de control de calidad

```json
{
  "schema": 1,
  "studyClass": {
    "value": "panoramic",
    "probability": 0.98,
    "alternatives": []
  },
  "quality": {
    "status": "usable",
    "flags": [
      {
        "code": "anterior_blur",
        "severity": "moderate",
        "region": { "kind": "polygon", "points": [] },
        "explanation": "..."
      }
    ]
  },
  "applicableAnalyses": ["tooth_localization", "restoration_candidates"],
  "blockedAnalyses": [
    { "code": "fine_periapical_detail", "reason": "..." }
  ],
  "model": { "provider": "...", "name": "...", "version": "..." }
}
```

Reglas:

- Probabilidades entre 0 y 1, sin convertirlas en porcentajes decorativos.
- Enumeraciones cerradas y campos extra rechazados.
- `unusable` bloquea análisis posteriores.
- El tipo corregido por el dentista se guarda aparte; no altera la salida original.

### 5.2 Pieza y geometría candidata

```json
{
  "sourceId": "...",
  "candidateId": "...",
  "fdiCandidate": "36",
  "fdiProbability": 0.91,
  "geometry": {
    "kind": "polygon",
    "coordinateSpace": "source-normalized",
    "points": [[0.1, 0.2], [0.2, 0.2], [0.2, 0.4]]
  },
  "visibility": "complete",
  "model": { "name": "...", "version": "..." }
}
```

No aceptar geometrías fuera de `[0,1]`, polígonos degenerados, IDs duplicados o piezas FDI inválidas.

### 5.3 Señal clínica candidata

```json
{
  "candidateId": "...",
  "toothCandidate": "36",
  "category": "restoration",
  "label": "Restauración radiopaca aparente",
  "confidence": 0.82,
  "evidenceLevel": "model_candidate",
  "regions": [],
  "explanation": "Patrón visual que requiere comprobación profesional.",
  "limitations": []
}
```

Estados profesionales permitidos:

```text
pending -> confirmed | corrected | rejected
```

Una corrección debe conservar el candidato original y crear una decisión profesional independiente.

## 6. Etapas de ejecución

## Etapa 0 — Baseline, seguridad y banderas

**Objetivo:** asegurar que la mejora no rompa el flujo 2D publicado.

1. Leer `AGENTS.md`, `docs/HANDOFF.md` y este documento.
2. Ejecutar toda la suite antes de modificar código.
3. Inventariar migraciones aplicadas y versiones desplegadas de funciones.
4. Crear banderas cerradas por defecto:
   - `radiograph.qc_v2`
   - `radiograph.tooth_ai_v1`
   - `radiograph.report_v1`
   - `radiograph.longitudinal_v1`
   - `radiograph.cbct_v1`
5. Registrar proveedor/modelo/versiones permitidas en configuración del servidor, nunca en el navegador.
6. Definir interruptor global para desactivar cada motor sin desplegar frontend.

**Aceptación:** comportamiento actual intacto cuando las banderas están apagadas; 100% de pruebas previas siguen aprobadas.

## Etapa 1 — Modelo de datos y contratos v2

**Objetivo:** tener trazabilidad antes de agregar IA.

Crear migraciones nuevas; no editar migraciones aplicadas. Diseñar como mínimo:

- fuentes radiográficas inmutables;
- ejecuciones de control de calidad;
- ejecuciones del modelo;
- candidatos por pieza/región;
- decisiones profesionales;
- informes, firmas y adendas;
- vínculos longitudinales entre estudios comparables;
- auditoría de acceso y exportación.

Requisitos:

- RLS por clínica y `smyl_can_access_patient`.
- Permisos separados `clinical.read`, `clinical.write` y aprobación/firma clínica existente o nueva, sin asumir que recepción puede firmar.
- concurrencia optimista y operaciones idempotentes;
- originales y salidas del modelo inmutables;
- retención y eliminación definidas antes de producción;
- ninguna URL firmada persistida como si fuera permanente; guardar ruta y firmar al leer.

**Aceptación:** pruebas PGlite de aislamiento entre clínicas, miembro desactivado, rol sin acceso, conflicto de revisión, repetición idempotente y bloqueo de edición de informe firmado.

## Etapa 2 — Ingesta 2D y control de calidad

**Objetivo:** clasificar la fuente y bloquear análisis no aplicables.

1. Crear una Edge Function dedicada, por ejemplo `radiograph-qc`; no ampliar `segment-teeth`.
2. Verificar sesión activa, membresía, permiso, paciente y archivo antes de usar `service_role`.
3. Obtener el archivo desde Storage privado mediante ruta conocida, no desde URL arbitraria del cliente.
4. Validar hash, MIME real, dimensiones, tamaño y orientación.
5. Guardar el inicio de la solicitud antes de invocar al proveedor.
6. Usar idempotency key por `source_hash + engine_version + contract_version`.
7. Validar la respuesta con esquema estricto y guardar original completo.
8. Mostrar tipo sugerido, calidad, banderas y análisis bloqueados; permitir corrección humana del tipo.

**No hacer:** reintentos automáticos después de un timeout incierto, aceptar redirecciones, registrar imágenes/base64 o datos clínicos en logs.

**Aceptación:** panorámica, periapical, bitewing, imagen rotada, borrosa, recortada, sub/sobreexpuesta, archivo falso, respuesta incompleta, timeout y duplicado tienen pruebas deterministas.

## Etapa 3 — Localización dental y odontograma asistido

**Objetivo:** mapa FDI verificable, nunca numeración silenciosa.

1. Integrar un motor radiográfico especializado mediante un adaptador de proveedor.
2. Guardar máscaras/polígonos en coordenadas normalizadas sobre el original.
3. Mostrar cada asignación FDI con estado de confianza.
4. Permitir renumerar, dividir, unir sólo cuando el flujo profesional lo soporte y marcar no evaluable.
5. Prohibir que una pieza “no visible” se convierta automáticamente en “ausente”.
6. Sincronizar únicamente decisiones confirmadas con el odontograma canónico.

**Aceptación:** el dentista puede corregir toda numeración; el original no cambia; cada corrección conserva autor, fecha, candidato y versión del modelo.

## Etapa 4 — Revisión detallada por pieza

**Objetivo:** convertir señales del motor en una tarea clínica clara.

1. Una tarjeta por pieza o región, no por texto arbitrario.
2. Recortes derivados al vuelo del original; no duplicar originales innecesariamente.
3. Overlay con geometría visible, editable y reversible.
4. Mostrar `Base visual sugerida`, `Confianza del modelo`, `Limitaciones` y `Valoración profesional`.
5. Acciones: confirmar, corregir, descartar y comparar.
6. Navegación teclado/táctil, zoom al centro, paneo y pellizco existentes.
7. Nunca usar color como único indicador.

**Aceptación:** ninguna señal pendiente entra al odontograma o informe; la corrección no borra el candidato; cada acción es auditable y recuperable.

## Etapa 5 — Informe clínico asistido y firma

**Objetivo:** generar un documento profesional, no un texto del modelo.

1. Construir el borrador sólo con decisiones confirmadas.
2. El LLM puede ordenar/redactar, pero no añadir piezas, diagnósticos, prioridades o estudios que no estén sustentados.
3. Separar:
   - descripción radiográfica;
   - limitaciones técnicas;
   - correlación clínica por realizar;
   - preguntas/datos faltantes;
   - estudios complementarios considerados por el profesional.
4. Previsualizar diferencias entre los datos estructurados y el texto generado.
5. Firmar con usuario, profesional, fecha, versión y hash del documento.
6. Después de firmar, sólo permitir adendas.

**Aceptación:** prueba que ningún candidato rechazado o pendiente aparece; firma inmutable; adenda conserva versión anterior; exportación muestra autoría y limitaciones.

## Etapa 6 — Historia longitudinal

**Objetivo:** comparar fuentes comparables sin inventar progresión.

1. Emparejar por paciente, tipo, pieza y geometría confirmada.
2. Mostrar lado a lado, sincronizar zoom/paneo y permitir alternancia.
3. Distinguir:
   - diferencias de adquisición;
   - cambios propuestos por IA;
   - cambios confirmados profesionalmente.
4. No calcular medidas de nivel óseo hasta validar técnica, calibración y repetibilidad.
5. Incorporar eventos resumidos en la ficha 360 y abrir la fuente canónica.

**Aceptación:** estudios incompatibles no se comparan automáticamente; el usuario ve por qué; la cronología no expone texto clínico a roles sin permiso.

## Etapa 7 — Validación clínica y liberación 2D

**Objetivo:** demostrar rendimiento real del sistema humano + IA.

Antes de producción clínica avanzada:

- definir uso previsto, usuarios, población y exclusiones;
- conjunto de entrenamiento independiente del conjunto de prueba;
- referencia anotada por varios odontólogos y resolución de desacuerdos;
- métricas por tarea, tipo de estudio, pieza, dispositivo y subgrupo;
- sensibilidad, especificidad, precisión, calibración, falsos negativos y falsos positivos;
- prueba del equipo humano con y sin asistencia;
- pruebas de aceptación por clínica;
- monitoreo de deriva, incidentes, versiones y botón de desactivación;
- revisión regulatoria y de privacidad aplicable en México antes de usar afirmaciones diagnósticas.

**Aceptación:** informe de validación versionado, criterios de salida aprobados y UI que comunica límites, modelo y fecha de actualización.

## Etapa 8 — CBCT/DICOM como proyecto independiente

**Objetivo:** no forzar volúmenes DICOM dentro de Storage/visor 2D.

Arquitectura recomendada:

```text
SMYL
  -> gateway autorizado por paciente/estudio
  -> archivo DICOM compatible con DICOMweb
  -> OHIF + Cornerstone3D para visualización
  -> adaptador de segmentación 3D validado
  -> resultados DICOM SEG/SR o contrato equivalente versionado
  -> confirmación profesional en SMYL
```

- Usar DICOMweb para búsqueda, almacenamiento y recuperación de objetos.
- Evaluar OHIF/Cornerstone3D como visor y Orthanc u otro archivo DICOM como backend.
- Mantener QIDO-RS/WADO-RS/STOW-RS detrás de autenticación y autorización propias; DICOMweb no resuelve por sí solo RLS multi-tenant.
- Guardar Study/Series/SOP Instance UID y metadatos permitidos; no usar nombres de archivo como identidad.
- No activar segmentación 3D hasta seleccionar y validar un motor especializado.
- No reutilizar el endpoint 2D ni convertir capturas de pantalla del CBCT en sustituto del volumen.

**Aceptación:** pruebas con estudios DICOM sintéticos/no identificables, series incompletas, multiframe, orientación, concurrencia, acceso cruzado y revocación.

## 7. Estrategia de proveedores

Crear interfaces, no dependencias directas desde la UI:

```ts
interface RadiographQcProvider {
  analyze(input: VerifiedRadiographSource): Promise<RadiographQcResultV1>;
}

interface DentalXrayProvider {
  localizeTeeth(input: VerifiedRadiographSource): Promise<ToothCandidateSetV1>;
  analyzeCandidates(input: VerifiedRadiographSource): Promise<FindingCandidateSetV1>;
}
```

El adaptador debe:

- ocultar credenciales;
- imponer timeout y tamaño;
- registrar coste sin datos sensibles;
- normalizar salida al contrato SMYL;
- rechazar campos inesperados;
- guardar versión exacta del proveedor;
- permitir proveedor simulado para pruebas;
- fallar cerrado cuando no pueda confirmar la respuesta.

No integrar un proveedor hasta revisar:

- licencia y derecho de uso clínico;
- ubicación y retención de datos;
- uso o no de datos para entrenamiento;
- acuerdos de tratamiento de datos;
- evidencia de validación para odontología, tipos de estudio y población objetivo;
- disponibilidad de API y estabilidad de versiones.

## 8. Seguridad y privacidad obligatorias

- Archivos privados, sin URLs públicas permanentes.
- Firma de URL sólo al leer y con expiración breve.
- Validar paciente, clínica, rol y miembro activo en servidor.
- Cifrado en tránsito y en reposo; secretos únicamente en Supabase/Vault.
- No aceptar URL arbitraria para que el servidor la descargue.
- No incluir nombre, correo, teléfono o historia completa si el motor no lo necesita.
- Auditoría de quién abrió, envió, corrigió, firmó y exportó.
- Política de retención para originales, derivados, cachés y logs.
- Exportaciones con autorización y eventos de auditoría.
- Borrado y revocación coherentes con obligaciones clínicas aplicables.

## 9. Pruebas mínimas por etapa

### Contratos

- JSON válido e inválido, campos extra, IDs duplicados, FDI inválida, geometría fuera de rango.
- compatibilidad de lectura v1/v2 y migración sin perder versiones.

### Seguridad

- dos clínicas, dos pacientes y roles diferentes;
- miembro inactivo;
- sesión vencida;
- acceso directo a Storage y RPC;
- SSRF, MIME falso, archivo sobredimensionado y hash distinto;
- conflicto de revisión y repetición idempotente.

### IA

- respuesta malformada, parcial, demasiado extensa o con afirmaciones no permitidas;
- timeout incierto sin reintento/cobro duplicado;
- cambio de modelo sin versión;
- imagen no utilizable sin candidatos;
- candidato sin evidencia geométrica.

### Interfaz

- escritorio, tableta, 390 y 320 px;
- teclado, lector de pantalla y objetivos táctiles;
- zoom/paneo/pellizco;
- pérdida de conexión y cambios sin guardar;
- comparación con anterior sólo cuando sea compatible.

### Producción

- migración idempotente y verificada;
- despliegue de función por versión;
- bandera apagada/encendida;
- rollback del frontend y del motor;
- monitoreo de errores, latencia, consumo y desacuerdo profesional.

## 10. Orden de archivos esperado

Claude Code debe proponer nombres finales, pero mantener cambios aislados:

```text
supabase/migrations/<timestamp>_smyl_radiograph_sources_v2.sql
supabase/migrations/<timestamp>_smyl_radiograph_ai_runs.sql
supabase/migrations/<timestamp>_smyl_radiograph_reports.sql
supabase/functions/radiograph-qc/index.ts
supabase/functions/radiograph-analyze/index.ts
supabase/functions/_shared/radiograph-contracts.ts
supabase/functions/_shared/radiograph-provider.ts
smyl-radiograph-contracts.js
smyl-radiograph-review-model-v2.js
smyl-radiograph-report.js
smyl-radiograph-longitudinal.js
tests/radiograph-*.test.mjs
tests/fixtures/radiograph-contracts/**
```

Copiar los archivos web modificados a `mobile/www/` y actualizar versiones de caché. No tocar `mobile/android/**` o `mobile/ios/**` sin autorización específica.

## 11. Criterios para no declarar una etapa terminada

Una etapa **no está terminada** si:

- sólo existe la pantalla o un fixture;
- el botón usa datos simulados;
- la salida no persiste de forma segura;
- no hay RLS/pruebas de aislamiento;
- el modelo no está identificado y versionado;
- no se conserva la salida original;
- no existe corrección profesional;
- la copia móvil quedó desactualizada;
- sólo se probó el caso feliz;
- se llama “diagnóstico” a una sugerencia no validada;
- se incluyó CBCT mediante capturas JPG en vez de DICOM.

## 12. Entregables por pull request

Cada PR debe contener:

1. alcance único y bandera correspondiente;
2. diagrama corto de flujo y amenazas;
3. migración nueva e idempotente cuando aplique;
4. contratos y adaptador simulable;
5. pruebas unitarias, seguridad y navegador;
6. evidencia visual sin datos reales;
7. plan de despliegue y rollback;
8. entrada en `docs/HANDOFF.md`;
9. lista explícita de lo que sigue pendiente.

No mezclar CBCT, control de calidad, informe y cambios visuales en un solo PR.

## 13. Instrucción inicial lista para Claude Code

Copiar este bloque como primer encargo:

> Trabaja en `docs/CLAUDE_RADIOGRAPH_AI_IMPLEMENTATION_PLAN.md`. Lee primero `AGENTS.md` y `docs/HANDOFF.md`. Audita el estado real del repositorio antes de modificarlo y comienza únicamente con la Etapa 0 y la Etapa 1. No implementes todavía detección clínica, segmentación radiográfica, informes generados ni CBCT. Conserva el flujo 2D actual y compatibilidad con documentos v1. Crea contratos v2 estrictos, banderas cerradas por defecto, esquema versionado, RLS por paciente/rol, idempotencia, auditoría y pruebas PGlite. No reutilices `segment-teeth`, no aceptes URLs arbitrarias y no presentes salidas de un LLM generalista como diagnóstico. Antes de editar migraciones o Edge Functions, registra en `docs/HANDOFF.md` qué vas a tocar. Entrega al final: archivos modificados, pruebas ejecutadas, migraciones/despliegues aún no aplicados, riesgos y pendientes. No publiques ni apliques migraciones sin autorización expresa del usuario.

## 14. Referencias técnicas y de validación

- DICOM PS3.18 define los servicios web para gestionar y distribuir objetos DICOM; la seguridad/autorización debe diseñarse aparte: <https://dicom.nema.org/medical/dicom/current/output/pdf/part18.pdf>
- OHIF trabaja con fuentes DICOMweb y Cornerstone3D aporta renderizado 2D/3D; sus modos permiten aislar flujos longitudinales o de segmentación: <https://docs.ohif.org/> y <https://docs.ohif.org/platform/modes/>
- El plugin DICOMweb de Orthanc implementa WADO-RS, QIDO-RS y STOW-RS: <https://orthanc.uclouvain.be/book/plugins/dicomweb.html>
- Los principios GMLP requieren ingeniería segura, datos representativos, separación entrenamiento/prueba, evaluación del equipo humano-IA y monitoreo del modelo desplegado: <https://www.fda.gov/medical-devices/artificial-intelligence-enabled-medical-devices/good-machine-learning-practice-medical-device-development-guiding-principles>
- IMDRF distingue asociación clínica, validación analítica/técnica y validación clínica, y exige evaluación durante el ciclo de vida: <https://www.imdrf.org/documents/software-medical-device-samd-clinical-evaluation>
