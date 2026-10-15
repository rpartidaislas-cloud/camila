# Núcleo de clínica de SMYL

**Estado:** desplegado

**Fecha:** 12 de octubre de 2026

**Proyecto Supabase:** SMYL (`rpxshsiwoxdbuevjjpfw`)

## Resultado

SMYL ya cuenta con una base operativa propia para administrar clínicas
dentales. No consulta tablas de LANA y no comparte su base de datos. El módulo
visible **Mi clínica** permite trabajar con:

- sucursales y sede predeterminada;
- sillones, consultorios y otros espacios reservables;
- horarios por día y por bloque, sin traslapes;
- integrantes, roles dentales y sede principal;
- profesionales que después aparecerán en la agenda;
- permisos por capacidad y bitácora de cambios.

## Modelo de datos

| Tabla | Responsabilidad |
| --- | --- |
| `smyl_roles` | Roles configurables por clínica. |
| `smyl_role_permissions` | Capacidades permitidas por rol. |
| `smyl_member_roles` | Rol operativo de cada integrante. |
| `smyl_branches` | Sucursales y sede principal. |
| `smyl_rooms` | Sillones, consultorios y recursos clínicos. |
| `smyl_clinic_hours` | Bloques de atención por sucursal y día. |
| `smyl_member_branches` | Sede principal del integrante. |
| `smyl_professionals` | Profesionales con o sin cuenta de acceso. |
| `smyl_professional_branches` | Sedes donde atiende un profesional. |
| `smyl_audit_events` | Bitácora append-only del núcleo operativo. |

Todas las relaciones relevantes incluyen `tenant_id` en sus llaves foráneas.
Esto impide enlazar accidentalmente usuarios, roles, espacios o profesionales
de clínicas diferentes.

## Roles iniciales

- Propietario
- Administrador
- Odontólogo
- Recepción
- Asistente clínico
- Inventario
- Finanzas

Los permisos se expresan por módulo, por ejemplo `clinic.manage`,
`schedule.manage`, `clinical.approve`, `inventory.manage` y `finance.manage`.
El navegador no decide esos permisos: RLS y las funciones transaccionales los
vuelven a comprobar en PostgreSQL.

Todo integrante invitado inicia con el rol **Recepción** (mínimo operativo). El
propietario debe asignar explícitamente un rol clínico o administrativo más
amplio cuando corresponda.

## Invariantes operativas

- Cada clínica activa conserva exactamente una sucursal principal activa.
- Los bloques de horario activos de una misma sede y día no pueden traslaparse.
- El propietario no puede perder el rol Propietario.
- Ningún integrante puede asignarse a sí mismo un rol con más privilegios.
- Un integrante o profesional solo puede vincularse a una sede de su tenant.
- Desactivar conserva el historial; las filas operativas no se borran desde la
  interfaz.
- Las asignaciones de rol, sede principal, sucursal principal y alta de
  profesional se ejecutan en transacciones atómicas.

## Despliegue

Se aplicaron y registraron estas migraciones:

1. `20261012190000_smyl_clinic_core.sql`
2. `20261012200000_smyl_clinic_core_actions.sql`
3. `20261012210000_smyl_professional_actions.sql`
4. `20261012220000_smyl_staff_default_role.sql`

Verificación en vivo:

- 10 tablas nuevas con RLS activo;
- 29 políticas de acceso;
- 27 clínicas con una sede principal válida;
- 25 propietarios con un único rol inicial;
- cuatro RPC operativas presentes;
- lectura anónima de sucursales devuelve cero filas;
- mutación anónima de sucursal devuelve `HTTP 401`.

El asesor de Supabase conserva hallazgos históricos ajenos a esta etapa
(`landing_catalogo`, `camila_tenants_publico` y configuración general de Auth).
No se introdujo un hallazgo crítico nuevo en el núcleo de clínica. Las RPC
marcadas como `SECURITY DEFINER` son intencionales: solo se conceden a
`authenticated`, resuelven actor y tenant desde `auth.uid()` y vuelven a
validar la capacidad antes de mutar.

## Interfaz

`smyl-clinic-admin.js` y `smyl-clinic-admin.css` crean el módulo **Mi clínica**
en web y PWA. El propietario administra; los demás integrantes reciben vista
de solo lectura o acciones de acuerdo con sus capacidades.

La revisión visual con datos ficticios confirmó escritorio de 1440 px y móvil
de 390 px sin desbordamiento horizontal. No se usaron datos de pacientes.

## Siguiente etapa

La etapa 2 usará este núcleo para construir la agenda diaria. Las citas deben
referenciar profesional, sucursal y espacio, respetar horarios, bloqueos y
concurrencia, y exponer a LANA únicamente disponibilidad mínima mediante el
contrato servidor a servidor.
