# Insumos, almacenes y compras

Implementación del 19 de noviembre de 2026. Publicación autorizada en PR #214. Las migraciones de sucursales `20261118140000` y de inventario `20261119100000` se aplicaron y registraron en producción antes de publicar el frontend; tablas, funciones, RLS y permisos fueron verificados.

## Recorrido del usuario

1. **Catálogo → Almacenes.** Crear, editar, desactivar y reactivar almacenes por sucursal. Se conservan los movimientos históricos. Para desactivar debe quedar sin existencias ni compras abiertas; un almacén con movimientos no puede cambiar de sucursal.
2. **Catálogo → Insumos.** Alta en tres pasos: datos, presentación/precio y controles/existencias. El código interno se genera si se deja vacío. La unidad de uso es la que se descuenta al atender; la presentación es lo que se compra. Alta, proveedor, existencia inicial y mínimos se confirman juntos. Se mantienen importación CSV y etiquetas.
3. **Catálogo → Proveedores.** Contactos, catálogo de insumos, clave del proveedor, precio por unidad de uso, plazo de entrega y plantillas independientes de WhatsApp y correo. Un insumo puede tener varios proveedores. Cambiar su proveedor habitual agrega la asociación y conserva las anteriores.
4. **Catálogo → Kits por tratamiento.** Una lista completa de materiales con cantidades por atención, edición y retiro de filas y costo de referencia. Guardar el kit no descuenta existencias. El consumo real sigue registrándose desde la atención o el inventario.
5. **Compras → Preparar compra.** Elegir una clínica o compra consolidada. Agregar faltantes considerando pedidos en tránsito, catálogo/compras habituales del proveedor o renglones manuales. Revisar proveedor, destino, cantidad, presentación y precio. El catálogo del proveedor propone una unidad por insumo y pide revisar cantidades.
6. **Borrador o emisión.** Un borrador puede guardar precios/proveedores pendientes para cotizar. Emitir exige que todos estén completos. Hay resumen general e impresión individual por proveedor, con desglose por almacén. La impresión permite guardar PDF desde el navegador. Las órdenes emitidas conservan precio y presentación; no revalúan movimientos anteriores.
7. **Mensaje y recepción.** WhatsApp y correo se preparan con los insumos de ese proveedor; el usuario revisa y envía desde su aplicación. No hay envío automático ni registro de entrega del mensaje. Las recepciones parciales o completas se confirman por almacén. Sólo entonces aumenta la existencia.

### Ejemplo de presentación

Tres cajas de 100 piezas a $250 por caja generan una orden por $750. El inventario recibe 300 piezas a $2.50. El documento conserva la presentación de caja aunque el catálogo cambie después. Al cambiar entre pieza y caja en el formulario se conserva la cantidad base; se puede ajustar para comprar cajas completas.

Los precios son MXN con IVA incluido, de acuerdo con el módulo existente. Estos documentos son órdenes o solicitudes de cotización, no facturas fiscales.

## Integración

- `smyl-inventory-procurement.js` extiende el módulo existente mediante un adaptador; reutiliza permisos, recarga, confirmaciones, recepciones y libro de movimientos.
- `smyl-inventory.js` v21 y CSS v14; módulo nuevo v1. El módulo se carga antes del inventario, en web y `mobile/www/app.html`. El sincronizador y la caché estática incluyen el recurso nuevo.
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
