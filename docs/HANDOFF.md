# Bitácora compartida — SMYL

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
