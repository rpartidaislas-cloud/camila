# Inventario y compras dental de SMYL

## Objetivo

La etapa 4 incorpora inventario operativo dentro de SMYL, separado de LANA y adaptado a una clínica dental. El saldo no es un campo editable: se calcula desde un libro de movimientos confirmados para conservar trazabilidad de cada entrada y salida.

## Alcance funcional

- Catálogo de materiales, medicamentos, implantes, instrumental, esterilización y consumibles administrativos.
- Proveedores y ubicaciones por sucursal, gabinete, área clínica, esterilización o carro móvil.
- Órdenes de compra y recepciones parciales o completas.
- Lotes, caducidad y número de serie según el control definido por insumo.
- Entradas, traslados, consumos clínicos, mermas y ajustes.
- Consumo vinculado opcionalmente a paciente, cita y profesional; obligatorio para insumos configurados con trazabilidad por paciente.
- Mínimos por insumo y ubicación, alertas de reposición y caducidad próxima.
- Compensaciones para corregir movimientos sin modificar el registro original.
- Materiales esperados por servicio preparados en `smyl_service_materials` para la automatización operativa posterior.

## Modelo de integridad

Las existencias se reconstruyen sumando cantidades que entran a una ubicación y restando las que salen. Los movimientos y sus líneas son inmutables. Una equivocación se corrige con un movimiento opuesto ligado al original.

Las operaciones sensibles usan RPC transaccionales e idempotencia:

- `smyl_post_inventory_movement`
- `smyl_create_purchase_order`
- `smyl_receive_purchase_order`
- `smyl_cancel_purchase_order`
- `smyl_reverse_inventory_movement`

La recepción crea el lote y el movimiento de entrada en la misma transacción. La salida valida existencia por ubicación, insumo y lote bajo bloqueo transaccional, por lo que dos usuarios no pueden consumir la misma última existencia simultáneamente.

## Seguridad

Todas las tablas usan `tenant_id` y RLS. `inventory.read` permite consultar; `inventory.manage` administra catálogo y ejecuta movimientos. El navegador no puede insertar ni modificar directamente compras, lotes o el libro de movimientos.

Los implantes u otros insumos críticos pueden activar lote, serie y trazabilidad obligatoria por paciente. Los lotes caducados no se consumen clínicamente: deben registrarse como merma.

## Implementación

- Migraciones `20261012300000` a `20261012320000`.
- Interfaz `smyl-inventory.js` y `smyl-inventory.css`.
- Pruebas `tests/dental-inventory-stage4.test.mjs`.

## Siguiente etapa

La etapa 5 es caja y facturación: cargos desde el plan, pagos parciales, saldos, recibos, devoluciones, cortes y preparación para CFDI bajo autorización explícita.
