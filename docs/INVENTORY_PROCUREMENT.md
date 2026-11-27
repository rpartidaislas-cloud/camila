# Insumos, almacenes y compras

Implementación del 19 de noviembre de 2026. Publicación autorizada en PR #214. Las migraciones de sucursales `20261118140000` y de inventario `20261119100000` se aplicaron y registraron en producción antes de publicar el frontend; tablas, funciones, RLS y permisos fueron verificados.

## Recorrido del usuario

El inventario abre en **Productos → Todos**. Cada producto reúne sus existencias por almacén y da acceso a su proveedor habitual y sus alternativas. **Caducidad** muestra los lotes con saldo por ubicación y plazo (vencidos, 0–30 y 31–90 días).

1. **Productos → Más opciones → Administrar catálogo → Almacenes.** Crear, editar, desactivar y reactivar almacenes por sucursal. Se conservan los movimientos históricos. Para desactivar debe quedar sin existencias ni compras abiertas; un almacén con movimientos no puede cambiar de sucursal.
2. **Productos → Agregar producto.** Alta en tres pasos: datos, presentación/precio y controles/existencias. El código interno se genera si se deja vacío. La unidad de uso es la que se descuenta al atender; la presentación es lo que se compra. Alta, proveedor, existencia inicial y mínimos se confirman juntos. Se mantienen importación CSV y etiquetas.
3. **Proveedores.** Contactos, catálogo de insumos, clave del proveedor, precio por unidad de uso, plazo de entrega y plantillas independientes de WhatsApp y correo. Un insumo puede tener varios proveedores. Cambiar su proveedor habitual agrega la asociación y conserva las anteriores.
4. **Administrar catálogo → Kits por tratamiento.** Una lista completa de materiales con cantidades por atención, edición y retiro de filas y costo de referencia. Guardar el kit no descuenta existencias. El consumo real sigue registrándose desde la atención o el inventario.
5. **Compras → Preparar pedido.** La modalidad la fija la administración en Configuración → Clínica → Modalidad de compras. Cada sucursal compra a proveedores, o solicita al centro según la modalidad habilitada. El formulario de compra no permite cambiar esa decisión. Agregar faltantes considerando pedidos en tránsito, catálogo/compras habituales del proveedor o renglones manuales. Revisar proveedor, destino, cantidad, presentación y precio. El catálogo del proveedor propone una unidad por insumo y pide revisar cantidades.
6. **Borrador o emisión.** Un borrador puede guardar precios/proveedores pendientes para cotizar. Emitir exige que todos estén completos. Hay resumen general e impresión individual por proveedor, con desglose por almacén. La impresión permite guardar PDF desde el navegador. Las órdenes emitidas conservan precio y presentación; no revalúan movimientos anteriores.
7. **Mensaje y recepción.** WhatsApp y correo se preparan con los insumos de ese proveedor; el usuario revisa y envía desde su aplicación. No hay envío automático ni registro de entrega del mensaje. Las recepciones parciales o completas se confirman por almacén. Sólo entonces aumenta la existencia.

### Ejemplo de presentación

Tres cajas de 100 piezas a $250 por caja generan una orden por $750. El inventario recibe 300 piezas a $2.50. El documento conserva la presentación de caja aunque el catálogo cambie después. Al cambiar entre pieza y caja en el formulario se conserva la cantidad base; las sugerencias de reposición parten de cajas completas cuando el producto tiene una presentación definida.

Los precios son MXN con IVA incluido, de acuerdo con el módulo existente. Estos documentos son órdenes o solicitudes de cotización, no facturas fiscales.

## Integración

- `smyl-inventory-procurement.js` extiende el módulo existente mediante un adaptador; reutiliza permisos, recarga, confirmaciones, recepciones y libro de movimientos.
- `smyl-inventory.js` v22 y CSS v15; compras v2 y `smyl-inventory-routing.js` v1. El módulo se carga antes del inventario, en web y `mobile/www/app.html`. El sincronizador y la caché estática incluyen el recurso nuevo.
- Migración aditiva: `supabase/migrations/20261119100000_smyl_inventory_procurement.sql`. Requiere las migraciones previas de inventario, costos y alcance de sucursal, en particular `20261118140000_smyl_branch_scope.sql`.
- `smyl_supplier_items` almacena las asociaciones múltiples y precios. Se consulta con `inventory.manage` y se escribe mediante RPC o la asociación del proveedor habitual al guardar el insumo.
- `smyl_purchase_batches` conserva el borrador y el documento general, con versión para impedir sobrescrituras. Emitir crea órdenes existentes por **proveedor y almacén**, en una sola transacción. La vista y el documento por proveedor agrupan sus distintos destinos.
- `smyl_create_inventory_item`, `smyl_save_supplier_catalog`, `smyl_save_treatment_kit`, `smyl_save_purchase_batch`, `smyl_cancel_purchase_batch` validan tenant, permisos y datos en el servidor. Kits y catálogos comparan la versión previamente leída. Alta y emisión usan identificadores estables para reintentos.
- Compras requieren `inventory.manage` e `inventory.purchase`; existencia inicial requiere además el permiso efectivo de ajuste. Las modificaciones, recepciones y movimientos respetan el alcance de las sucursales. Se conserva la política histórica de lectura del inventario; no se amplía a esta entrega un rediseño de esa política.
- La protección de almacenes, proveedores y destinos también se aplica a rutas anteriores. Los bloqueos serializan el archivo de almacenes con movimientos y órdenes. No hay borrado del historial.
- Pedidos pendientes, documentos generales y sus renglones se cargan con paginación; no se limitan a las 100 órdenes recientes del módulo anterior.
- Sin la migración, los nuevos formularios de compra/catálogos muestran un aviso de indisponibilidad y no intentan guardar. El catálogo y las existencias existentes continúan consultables.

### Coordinación con permisos de costos

La bitácora del 15 de noviembre propone `inventory.costs`, todavía pendiente en la base tomada para esta entrega. No se implementó ni se simuló esa nueva regla aquí. Al integrarla deben cubrirse también `smyl_supplier_items.unit_cost`, `smyl_purchase_batches.lines[].unit_cost`, los totales/plantillas/impresión y las RPC nuevas. La política actual exige administración para los catálogos nuevos y administración + compras para los documentos; las fuentes históricas de costos no se reescriben.

## Verificación y activación

La vista `tests/fixtures/smyl-inventory-procurement-preview.html` usa datos ficticios y el módulo real con el sistema compartido de diálogos; no se carga desde la aplicación. El recorrido automatizado prueba almacenes, proveedor, alta de insumo, kit, borrador, emisión, documentos, aislamiento del mensaje por proveedor, recepción parcial, conservación del formulario ante un error y tamaños 1440, 834 y 390 px. También verifica que tablas y recepciones no queden recortadas.

Las pruebas PGlite cargan las migraciones reales, aplican dos veces la nueva y comprueban transacciones, permisos, aislamiento entre tenants, sucursales, reintentos, concurrencia por versión, presentaciones, recepción parcial, costos y bloqueos de archivo. Para exigir su ejecución, establecer `SMYL_REQUIRE_PGLITE=1` y `SMYL_PGLITE_DIR` al directorio que contiene `node_modules/@electric-sql/pglite`. Sin esa dependencia se omite esa prueba; no tomar una omisión como validación de base de datos. El navegador requiere Playwright y Chrome; admite `SMYL_NODE_MODULES`.

```sh
node --test tests/inventory-procurement-pglite.test.mjs tests/inventory-procurement.test.cjs tests/inventario-costos.test.mjs tests/inventario-fase3.test.mjs tests/inventario-fase4.test.mjs tests/dental-inventory-stage4.test.mjs tests/inventory-costing-stage8.test.mjs tests/inventory-operations-professional-stage6.test.mjs
node --test tests/inventory-procurement-browser.test.cjs
```

Para activar: aplicar primero la migración mediante el proceso de despliegue de SMYL; publicar después los archivos web sincronizados; comprobar con una cuenta autorizada la lectura y creación de un borrador en la sucursal correcta. No emitir pedidos ficticios ni escribir existencias de prueba en producción. La actualización de la aplicación nativa requiere su distribución habitual; sincronizar `mobile/www` no instala una versión nueva en los dispositivos.

La validación local de la entrega integrada tiene 49 pruebas de datos/modelo/inventario y un recorrido de navegador aprobados, además de los nueve controles estáticos del release gate. GitHub Actions no pudo iniciar sus jobs por un bloqueo de facturación preexistente de la cuenta. El lint de producción no detectó errores en las funciones nuevas; sí conserva un error ajeno de MILA en `smyl_mila_interview_usage_summary` y avisos de geometría radiográfica.


## Modalidad administrada y solicitudes al centro (19/11/2026)

Migración `20261119150000_smyl_inventory_purchasing_policy.sql`, aditiva y sin pedidos ni existencias de prueba. Requiere la migración de compras anterior. No se preselecciona una modalidad: el administrador debe guardarla una vez por tenant. Antes de configurarla siguen disponibles catálogo, existencias y recepción de órdenes anteriores.

- **Por sucursal:** el personal autorizado prepara su orden al proveedor y recibe en un almacén de su alcance.
- **Desde el centro:** las sucursales envían solicitudes internas (insumos, cantidad, almacén, fecha, prioridad y notas). El centro autoriza o rechaza cantidades, selecciona varias solicitudes y genera un borrador consolidado. Asigna proveedores/precios y emite órdenes que se reciben en el almacén central elegido. También puede surtir demanda no comprometida con existencias del centro.
- **Entrega real:** el centro registra material ya entregado físicamente. Se hace un traslado atómico del centro al almacén de la sucursal. Esta confirma después, sin repetir el movimiento. Admite entregas parciales y un lote por insumo por entrega; para dividir lotes se registran entregas sucesivas. No representa mercancía en tránsito. Una devolución se registra como traslado separado; no borra la entrega ni reabre automáticamente la solicitud.
- **Trazabilidad:** solicitudes `draft/submitted/approved/delivered/fulfilled/rejected/cancelled`, cantidades solicitadas/autorizadas/entregadas, asignaciones a compras y confirmaciones. La misma demanda no se incorpora dos veces. Las cantidades vinculadas no se pueden retirar de un borrador; para rehacerlo se cancela. Una compra pendiente debe recibirse o cancelarse antes de sustituir su cantidad asignada por existencias.
- **Administración:** `settings.manage` + `branches.all` para configurar. Centro: `inventory.manage` + `inventory.purchase` + `branches.all` y además administrador de modalidad o `inventory.central`. Solicitar requiere `inventory.read` + `inventory.request` (o administrar) y alcance de sucursal. Confirmar entrega interna requiere `inventory.receive` y alcance. Recibir compras requiere administrar + recibir. Se incorporan las funciones nuevas a Equipo → Roles, se preserva el acceso anterior de recepción y las cuentas nuevas reciben los valores equivalentes. Reaplicar la migración no restaura permisos que se hayan retirado.
- **Cambio de modalidad:** se bloquea si existen solicitudes abiertas, incluidas entregas sin confirmar. No altera órdenes históricas. Los borradores de la modalidad anterior deben cancelarse y recrearse; los pedidos emitidos siguen recibiéndose. El centro configurado no puede desactivarse ni cambiar de sucursal.
- **Servidor:** comprobaciones también en rutas anteriores de compra y en selección por sucursal. Tablas nuevas con lectura por RLS; escrituras únicamente mediante funciones. Versiones para edición concurrente, identidades estables en solicitudes/compras/entregas, bloqueo por tenant y auditoría. No hay envío automático a proveedores.

Verificación adicional: `tests/inventory-purchasing-policy-pglite.test.mjs` ejecuta migraciones reales con 9 escenarios de negocio, incluidos dos tenants, permisos separados, versiones, reintentos, restricciones al editar, cancelaciones, dos solicitudes del mismo material y recepciones/entregas parciales sin duplicación. `tests/inventory-purchasing-policy-browser.test.cjs` recorre administrador y sucursal con los formularios reales y datos ficticios en 1440/834/390 px. Se mantiene el recorrido anterior de catálogos, kits, documentos y compras.

Activación del seguimiento: migración `20261119150000` aplicada y registrada en el servidor de SMYL. Verificadas cinco tablas con RLS y sin escrituras directas, funciones públicas previstas y función heredada privada. Sin solicitudes ni configuraciones de tenant creadas por el despliegue. Validación integrada: 93 pruebas, dos recorridos de navegador y nueve controles de seguridad aprobados; lint de producción sin problemas nuevos.
