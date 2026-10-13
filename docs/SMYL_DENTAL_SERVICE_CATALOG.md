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
- Mantener una rama aislada y no reescribir migraciones históricas.
- Corregir el contrato de pruebas del service worker.

### Entrega 1 — catálogo v1

- Menú con buscador, categorías y filtros.
- Activación opt-in, alta personalizada, edición, desactivación y reactivación.
- Precio, duración, alcance clínico y datos SAT revisables.
- Historial de versiones, RLS por `schedule.read/manage` y auditoría existente.
- Paridad exacta web/PWA móvil.

### Entrega 2 — odontograma, plan y cotización v2

- Tratamientos con ID estable, fase, `service_id`, revisión de servicio, piezas
  FDI y superficies explícitas.
- Odontograma con capas separadas: hallazgo, existente, propuesto y realizado.
- Dentición temporal/mixta y superficies, sin interpretar “sin marca” como sano.
- Propuesta compatible con documentos schema 1 y nueva schema 2 con snapshot
  comercial/fiscal y mini mapa dental.
- Mostrar solo piezas aprobadas por el profesional; no incluir antecedentes,
  alergias ni notas internas en el documento comercial.

### Entrega 3 — finanzas

- Conversión explícita e idempotente de propuesta aprobada a cargos.
- Validar mismo tenant, paciente, sede, cita, servicio, revisión y vigencia.
- CFDI por conceptos y pruebas con PAC sandbox antes de cualquier timbrado real.

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

## Decisiones pendientes antes de producción

- Introspectar y comparar funciones/policies reales de odontograma, plan y
  propuestas antes de crear schema 2.
- Definir con contador/PAC las claves fiscales de la clínica; SAT establece que
  la identificación es responsabilidad del emisor.
- Acordar si los precios varían por sede, profesional, material o complejidad.
- Pilotear con datos sintéticos y una clínica; conservar rollback por bandera.

