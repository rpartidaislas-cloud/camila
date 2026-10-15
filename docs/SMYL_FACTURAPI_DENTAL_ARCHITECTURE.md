# SMYL Facturación dental · arquitectura independiente

Estado: diseño aprobado; etapas 1 y 2 implementadas localmente. No hay
timbrado ni conexión de producción habilitados.

## Frontera obligatoria

SMYL se conecta directamente con Facturapi desde funciones privadas de su
propio proyecto Supabase. LANA no participa como API, base de datos, almacén,
intermediario ni respaldo. No se copian funciones ni tablas de LANA.

Cada clínica mantiene una organización fiscal independiente. Sus llaves de
prueba/producción, CSD y archivos fiscales nunca llegan al navegador ni se
comparten con otra clínica. El navegador sólo solicita operaciones autorizadas
y recibe estados y metadatos sanitizados.

## Fuente de verdad

- SMYL: clínica, paciente, receptor fiscal, tratamiento, cargos, pagos y
  autorización humana.
- Facturapi: organización fiscal, validación externa y comprobante timbrado.
- Storage privado de SMYL: copia controlada de XML y PDF por tenant.
- SAT/PAC: estado fiscal definitivo.

El expediente clínico, odontograma, fotografías, antecedentes y notas nunca se
mandan a Facturapi. Sólo se transmite lo necesario para el CFDI.

## Ciclo mínimo

1. Preparar borrador inmutable desde cargos y pagos confirmados.
2. Validar emisor, receptor, conceptos y política dental.
3. Validar en sandbox con la organización Facturapi de la clínica.
4. Pedir confirmación humana mostrando importe, receptor y modo prueba/real.
5. Reservar una solicitud idempotente antes de llamar al proveedor.
6. Timbrar una sola vez y conservar UUID, respuesta y archivos privados.
7. Si se pierde la respuesta, marcar `resultado_por_confirmar`; nunca reintentar
   automáticamente una operación fiscal ambigua.
8. Conciliar estados, complementos, sustituciones y cancelaciones.

Estados canónicos: `draft`, `validated`, `submitting`, `issued`,
`result_unknown`, `rejected`, `cancellation_pending`, `cancelled`.

## Reglas odontológicas

- Servicio profesional dental: sugerencia `ObjetoImp 02`, IVA exento, unidad
  `E48`; permanece pendiente hasta revisión del emisor/contador.
- Ortodoncia, cirugía, higiene e imagen conservan clase y ClaveProdServ propia.
- Producto dental vendido por separado nunca hereda automáticamente la exención
  del honorario.
- Estética dental no se presenta automáticamente como deducción personal.
- D01/D02 sólo se sugieren cuando receptor, régimen y forma de pago son
  compatibles; efectivo muestra advertencia y no bloquea la factura.
- Pago total confirmado decide PUE; saldo pendiente decide PPD/99 y genera
  complementos al recibir pagos.
- Si servicio y precio ya están definidos, el abono es parcialidad, no anticipo.

## Etapas siguientes

1. Política fiscal dental y catálogo — implementada localmente.
2. Organización Facturapi independiente por clínica y almacenamiento seguro —
   implementada localmente para llaves `sk_test_`.
3. Timbrado sandbox, idempotencia y reconciliación.
4. PUE, PPD, complementos, notas de crédito y anticipos.
5. Cancelación/sustitución, XML/PDF privados y envío.
6. Piloto con contador y activación individual de modo real.

Ninguna etapa puede activar modo real globalmente. La activación será por
clínica, con confirmación explícita y capacidad de volver a sandbox sin alterar
los comprobantes ya emitidos.

## Operación segura de la etapa 2

- El dueño conecta la llave Test de la organización desde Caja > Preparación
  CFDI. SMYL verifica `GET /v2/organizations/me` directamente con Facturapi.
- La llave queda cifrada con AES-GCM y asociada criptográficamente al
  `tenant_id`; intercambiar ciphertext entre clínicas invalida el descifrado.
- La tabla de conexión no concede `SELECT` ni escrituras a `anon` o
  `authenticated`. Sólo la función privada, mediante `service_role`, accede al
  material cifrado.
- El navegador recibe nombre e ID de organización, huella parcial, ambiente y
  fechas de verificación. Nunca recibe ciphertext, IV ni la llave original.
- Conectar, verificar y desconectar dejan eventos sin datos clínicos ni
  secretos. Desconectar elimina el material cifrado y conserva los borradores.
- El despliegue requiere el secreto de plataforma
  `SMYL_FACTURAPI_ENCRYPTION_KEY`: 32 bytes aleatorios codificados en Base64.
  No debe reutilizarse una clave de Gmail, LANA u otra integración.
