# Arquitectura profesional SMYL + LANA

**Estado:** decisión de producto aprobada  
**Fecha:** 12 de octubre de 2026  
**Alcance:** separación de producto, reutilización segura de infraestructura y
hoja de ruta del sistema de gestión dental.

## Decisión

SMYL es el producto que compra y utiliza la clínica dental. Tiene su propia
marca, navegación, usuarios, base de datos clínica, permisos, soporte,
facturación y ciclo de despliegue. Ningún dentista necesita abrir el panel de
LANA ni conocer una API key.

LANA es un proveedor interno de capacidades de comunicación e IA. Conserva
OAuth de Meta, tokens, webhooks, entrega de mensajes, estado canónico de las
conversaciones y ejecución del asistente. Se consume exclusivamente mediante
un contrato servidor a servidor versionado.

Los patrones maduros de LANA —RLS, auditoría, idempotencia, colas, límites,
movimientos inmutables, archivos privados y observabilidad— pueden convertirse
en componentes compartidos. El código se porta y adapta a SMYL; las bases de
datos de producción no se mezclan.

## Vista de la solución

```text
Dentista / equipo
       |
       v
SMYL web y app móvil
       |
       +--> Supabase SMYL
       |    pacientes, expedientes, agenda, inventario,
       |    tratamientos, pagos, archivos y auditoría clínica
       |
       +--> Edge Functions SMYL
               |
               | contrato privado, autenticado y versionado
               v
          Servicios LANA
          Meta, webhooks, conversaciones, mensajes y runtime IA
               |
               v
       WhatsApp / Messenger / Instagram
```

## Propiedad de cada dominio

| Dominio | Fuente de verdad | Regla |
| --- | --- | --- |
| Clínica, sucursales y sillones | SMYL | Nunca se administra desde LANA. |
| Equipo, roles y permisos dentales | SMYL | La sesión del navegador solo pertenece a SMYL. |
| Pacientes y expediente | SMYL | No se replica el expediente completo en LANA. |
| Agenda y citas | SMYL | LANA solo recibe la disponibilidad mínima necesaria por API. |
| Odontograma y planes | SMYL | Toda decisión clínica requiere un profesional. |
| Inventario y compras | SMYL | Se adapta el motor probado; no se consulta el inventario vivo de LANA. |
| Caja, pagos y facturación | SMYL | Datos y comprobantes pertenecen a la clínica en SMYL. |
| OAuth y tokens de Meta | LANA | Nunca llegan al navegador ni a tablas clínicas. |
| Conversaciones y mensajes | LANA | SMYL presenta una proyección segura en su Inbox. |
| Capacitación y runtime del asistente | LANA | SMYL es la única interfaz visible para editar, probar y publicar. |
| Vínculo conversación-paciente | Ambos, por identificadores | No autoriza copiar historial ni expediente. |

## Núcleo compartido

Compartir infraestructura significa reutilizar contratos, librerías y patrones
probados, no compartir una base de datos ni una interfaz administrativa.

El núcleo común debe mantenerse como módulos versionados y desplegarse de forma
independiente en cada producto:

- resolución de tenant, actor y rol;
- helpers de RLS y autorización por capacidad;
- auditoría inmutable;
- idempotencia y control de concurrencia;
- almacenamiento privado y URL firmadas;
- cuotas, límites y medición de consumo;
- colas, reintentos y bandeja de fallos;
- trazas, salud operativa y alertas;
- convenciones de errores y contratos API.

LANA y SMYL pueden actualizar ese núcleo en versiones distintas. Una regresión
en un producto no debe obligar a desplegar el otro.

## Frontera de seguridad

1. El navegador se autentica únicamente contra SMYL.
2. SMYL resuelve `tenant_id`, `actor_id`, rol y permiso en servidor; no confía
   en identificadores enviados libremente por el cliente.
3. Solo una Edge Function de SMYL puede llamar a LANA.
4. La credencial de integración se cifra en reposo, se rota y nunca vuelve al
   navegador.
5. Cada petición declara versión de contrato, clave de idempotencia y un
   identificador de correlación.
6. Los DTO devuelven el mínimo necesario. Una conversación no concede acceso a
   un expediente y un paciente no concede acceso al historial de chat.
7. Toda mutación relevante deja actor, tenant, fecha, resultado y motivo en una
   bitácora inmutable.

## Contratos entre productos

La integración actual de chat conserva el contrato
`SMYL_LANA_CHAT_CONTRACT_V1.md`. Las nuevas capacidades deben añadirse como
versiones compatibles, nunca como consultas directas a tablas del otro
producto.

Ejemplos:

- `GET /channels/status`: estado público de canales, sin tokens.
- `GET /inbox/conversations`: proyección operativa del Inbox.
- `POST /inbox/send`: envío autorizado e idempotente.
- `POST /assistant/training/publish`: publica una versión inmutable.
- `GET /availability`: LANA consulta slots que SMYL decidió exponer.
- `POST /appointment-requests`: crea una solicitud; SMYL confirma la cita.

La agenda clínica nunca se duplica en LANA. El asistente puede consultar
disponibilidad y solicitar una cita mediante herramientas acotadas, pero SMYL
mantiene la transacción y la auditoría.

## Inventario dental

El motor de inventario se adapta a vocabulario y reglas dentales dentro de la
base de SMYL:

| Patrón reutilizable | En SMYL |
| --- | --- |
| Producto | Insumo o material dental |
| Variante | Presentación / unidad |
| Almacén | Clínica / gabinete |
| Movimiento | Entrada, consumo, ajuste, merma o traslado |
| Orden de compra | Pedido a proveedor |
| Venta / producción | Procedimiento completado |

SMYL agrega lote, caducidad, esterilización, trazabilidad de implantes y consumo
por paciente. Los movimientos confirmados son inmutables; las correcciones se
hacen con movimientos compensatorios.

## Etapas de construcción

### Etapa 0 — separación visible y contrato

**Estado: completada.**

- Eliminar la marca LANA de la experiencia del dentista.
- Presentar `Canales e IA`, `Mensajes` y `SMYL Asistente` dentro de SMYL.
- Mantener nombres técnicos internos para no romper endpoints ni migraciones.
- Congelar este documento como regla de arquitectura.

### Etapa 1 — núcleo de clínica

**Estado: completada y desplegada en SMYL.** Detalle técnico en
`SMYL_CLINIC_CORE.md`.

- Clínicas, sucursales, consultorios/sillones y horarios.
- Miembros, especialidades, roles y permisos por módulo.
- Auditoría y aislamiento multi-tenant.
- Onboarding que deje una clínica operable sin configuración técnica.

### Etapa 2 — agenda diaria

**Estado: completada y desplegada en SMYL.**

- Profesionales, recursos, servicios y duración.
- Día/semana, creación y reprogramación de citas.
- Llegada, atención, ausencia, cancelación y bloqueo de horario.
- Recordatorios y solicitudes desde el asistente sin confirmar en falso.

### Etapa 3 — expediente dental completo

**Estado: completada y desplegada en SMYL.**

- Historia médica, odontograma, notas, evidencias y consentimientos.
- Plan de tratamiento, presupuestos y seguimiento por cita.
- Línea de tiempo clínica y acceso auditado.

### Etapa 4 — inventario y compras

**Estado: completada y desplegada en SMYL.** Detalle técnico en
`SMYL_DENTAL_INVENTORY.md`.

- Catálogo, proveedores, existencias, lotes y caducidad.
- Compras, recepción, traslados, consumos y mermas.
- Consumo por procedimiento y alertas accionables.

### Etapa 5 — caja y facturación

- Cargos del plan, pagos parciales, saldos y cortes.
- Recibos, devoluciones y CFDI según la operación autorizada.

### Etapa 6 — laboratorio y analítica

- Casos de laboratorio, entregas, retrabajos y costos.
- Producción, conversión, ocupación, cobranza e inventario.

## Puerta de aceptación

Una etapa no está terminada por mostrar una pantalla. Debe cumplir:

- datos reales y tenant-scoped;
- permisos por rol verificados en servidor;
- estados vacíos, carga, error y recuperación;
- idempotencia en mutaciones sensibles;
- auditoría suficiente para soporte;
- responsive web/móvil y accesibilidad básica;
- pruebas de contrato, RLS y flujo principal;
- despliegue independiente y rollback documentado.

## Regla de producto

Si una función obliga al dentista a abrir LANA, expone credenciales, duplica
datos clínicos o necesita acceso directo entre bases, la solución viola esta
arquitectura y debe rediseñarse antes de publicarse.
