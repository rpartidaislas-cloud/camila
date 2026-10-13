# SMYL — Catálogo dental, plan y cotización

## Objetivo

Unificar el flujo de la clínica sin convertir una cotización en expediente ni
permitir que la automatización decida tratamientos:

`catálogo activable → plan revisado → piezas/superficies → cotización versionada → cargo → CFDI`

La selección y aprobación clínica siempre pertenecen al odontólogo. Los
antecedentes y el odontograma aportan contexto; nunca agregan servicios por sí
solos.

## Menú inicial

La biblioteca opt-in incluye valoración y diagnóstico, prevención y limpieza,
restauradora, endodoncia, periodoncia, cirugía oral, prótesis, estética y
carillas, ortodoncia, implantología, odontopediatría, urgencias e imagen. Cada
clínica activa solo lo que ofrece y puede crear variantes propias.

Cada servicio conserva nombre interno y para paciente, categoría, especialidad,
duración, unidad clínica, modalidad de cobro, precio, moneda, claves fiscales,
estado de revisión fiscal, vigencia y revisión del catálogo. Desactivar un
servicio impide usarlo en nuevas citas, pero no borra su historial.

## Contrato clínico-fiscal

- La unidad clínica (`pieza`, `superficie`, `cuadrante`, `arcada`, `sesión`,
  `fase` o `paquete`) es independiente de la `ClaveUnidad` fiscal.
- `ClaveProdServ`, `ClaveUnidad` y `ObjetoImp` son configurables. Una plantilla
  puede sugerir una clave, pero se mantiene `pending` hasta que el emisor o su
  contador/PAC la confirma.
- Cada cambio relevante genera una revisión inmutable en
  `smyl_service_versions`.
- Una cotización futura debe copiar un snapshot del servicio; nunca consultar
  el precio actual para reconstruir una propuesta aprobada.
- El módulo actual de CFDI sigue siendo un borrador. No se presenta como
  timbrado ni como integración PAC.

## Entregas

### Entrega 0 — base reproducible

- Recuperar al repositorio las migraciones clínicas ya aplicadas que faltaban.
- Representar con marcadores sin SQL cinco versiones remotas antiguas cuyo
  cuerpo original no estaba disponible; no afirmar que esos objetos legacy son
  reconstruibles hasta recuperar su definición real.
- Archivar fuera del directorio ejecutable tres migraciones locales antiguas
  que no figuran como aplicadas remotamente; nunca usar `--include-all` por
  conveniencia.
- Mantener una rama aislada y no reescribir migraciones históricas.
- Corregir el contrato de pruebas del service worker.

### Entrega 1 — catálogo v1

- Menú con buscador, categorías y filtros.
- Activación opt-in, alta personalizada, edición, desactivación y reactivación.
- Precio, duración, alcance clínico y datos SAT revisables.
- Historial de versiones, RLS por `schedule.read/manage` y auditoría existente.
- Paridad exacta web/PWA móvil.

### Entrega 2 — odontograma, plan y cotización v2

- **Implementada y publicada el 2026-10-13.** Tratamientos con ID estable,
  fase, `service_id`, revisión de servicio, piezas
  FDI y superficies explícitas.
- El selector reutiliza el odontograma adulto existente y distingue piezas
  propuestas sin interpretar “sin marca” como sano. La dentición temporal y
  mixta permanece como ampliación futura; no se simula soporte que aún no existe.
- Lectura histórica compatible con documentos schema 1 y escritura nueva en
  schema 2 con snapshot
  comercial/fiscal y mini mapa dental.
- Mostrar solo piezas aprobadas por el profesional; no incluir antecedentes,
  alergias ni notas internas en el documento comercial.
- Los RPC `smyl_save_clinical_plan_v2` y `smyl_save_proposal_v2` validan en el
  servidor la revisión del catálogo y que cada línea comercial coincida con el
  plan clínico revisado. Los RPC anteriores se conservan para el historial.

### Entrega 3 — finanzas

- **Implementada el 2026-10-13 hasta la frontera previa al PAC.** La
  conversión es explícita e idempotente por propuesta/revisión y crea un cargo
  por concepto positivo después de validar tenant, paciente, sede activa y
  total aprobado.
- Cada lote conserva la propuesta completa; cada cargo conserva revisión,
  renglón y snapshot de servicio. Un reintento devuelve el lote existente y no
  duplica movimientos.
- El borrador CFDI 4.0 congela receptor y conceptos de un pago totalmente
  aplicado. La prevalidación local comprueba formato y presencia de claves,
  pero no consulta catálogos, no transmite y no timbra con SAT/PAC.
- Las pruebas con un PAC sandbox y los flujos de cancelación/sustitución quedan
  pendientes hasta elegir proveedor y confirmar la política fiscal con el
  contador de la clínica.

## Criterios de aceptación v1

1. La clínica puede buscar y activar una plantilla o crear un servicio propio.
2. Precio cero es válido; precio vacío permanece pendiente.
3. La clave SAT exige ocho dígitos y la unidad/ObjetoImp siguen opcionales hasta
   revisión fiscal.
4. Un cambio incrementa `catalog_revision` y guarda snapshot.
5. Un servicio inactivo no aparece para citas nuevas; citas históricas no se
   modifican.
6. Un tenant no puede leer ni mutar el catálogo de otro.
7. Un usuario sin `schedule.manage` puede consultar, pero no editar.
8. Web y PWA móvil son idénticas y funcionan a 390, 834 y 1366 px.

## Estado y siguientes decisiones

- La migración aditiva del catálogo v1 fue aplicada el 2026-10-13. La interfaz
  quedó integrada sobre el HEAD vigente de Pages y superó su regresión propia;
  la suite completa pasa 141/143 y conserva solo dos fallos anteriores del
  simulador rápido, ajenos al catálogo. El frontend se publicó y se comprobó
  en el panel profesional sin mutar el catálogo de la clínica.
- La migración `20261013010000_smyl_treatment_proposal_v2.sql` fue aplicada el
  2026-10-13 después de confirmar que era la única pendiente. Web y PWA usan el
  mismo contrato v2 y el caché `smyl-v197-treatment-quote-map`.
- El plan permite seleccionar servicio, fase, piezas FDI y superficies; la
  cotización hereda el precio de referencia, calcula por pieza/superficie,
  congela el snapshot fiscal y genera un mini odontograma sin historia clínica.
- QA sintética aprobada a 1366, 834 y 390 px, sin desbordamiento horizontal. La
  suite pasa 150/152 y conserva sólo los dos fallos anteriores del simulador
  rápido, ajenos a catálogo, plan, propuestas y finanzas.
- La migración `20261013020000_smyl_proposal_finance_v1.sql` fue aplicada el
  2026-10-13 tras un dry-run limpio. Web/PWA usan
  `smyl-v198-proposal-finance`; propuesta, cargos y borrador fiscal quedan
  enlazados sin transmisión externa automática.
- Definir con contador/PAC las claves fiscales de la clínica; SAT establece que
  la identificación es responsabilidad del emisor.
- Acordar si los precios varían por sede, profesional, material o complejidad.
- Siguiente entrega: seleccionar PAC, configurar únicamente su sandbox y
  probar validación de catálogos, timbrado, cancelación, sustitución y
  conciliación con datos sintéticos antes de cualquier CFDI real.

