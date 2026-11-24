# Costos de proveedores y créditos de IA (interno de SMYL)

Migración: `supabase/migrations/20261124120000_smyl_provider_pricing.sql`. **Solo la ve y la edita quien administra SMYL** (SQL Editor); ninguna clínica tiene acceso.

## Por qué existe

Hoy 1 «crédito de IA» = 1 operación, sin importar el modelo: una simulación de sonrisa (imagen + análisis) cuesta mucho más que reescribir un mensaje y ambas cobran 1.
El plan promete «tokens» y el sistema no los mide. Esta tabla permite calcular el **costo real en pesos** de cada operación y cuántos créditos debería valer.

## Qué contiene

| Tabla | Para qué |
|---|---|
| `smyl_provider_prices` | Precio por métrica de cada modelo (tokens, imágenes, audio) con fecha de vigencia. **`price` vacío = pendiente.** |
| `smyl_cost_settings` | Tipo de cambio USD→MXN, margen de seguridad (por omisión 8 %), cuánto costo real vale 1 crédito (por omisión $0.50) y el múltiplo objetivo (3×, como tus timbres: $1.80 / $0.60). |
| `smyl_ai_operations` | Las operaciones que cobran créditos o segundos y lo que consume **una** de cada una. Las cantidades son **supuestos** hasta medirlas. |
| vista `smyl_operation_costs` | Costo en pesos, créditos sugeridos y qué precios faltan, por operación. |

Los modelos que ya trae son los que usa el código hoy: `gpt-image-2-2026-04-21`, `gpt-4o`, `gpt-5-mini`, `gpt-transcribe`, `gpt-realtime-2.1`, `claude-sonnet-4-6` y `claude-opus-4-5`.
**No trae ningún precio**: se toman del panel de cada proveedor, porque cambian.

## Cómo capturar los precios (en el SQL Editor)

1. **Tipo de cambio y margen**
```sql
update smyl_cost_settings set fx_usd_mxn = <tipo de cambio>, fx_buffer_pct = 8 where id;
```
2. **Precios.** `price` es lo que cobra el proveedor por `per_units` de la métrica (tokens: por 1,000,000; audio: por 60 segundos = un minuto; imagen: por imagen). Si el panel del proveedor está en USD, déjalo en USD.
```sql
update smyl_provider_prices set price = <USD por 1M tokens>, note = 'Panel de OpenAI, <fecha>'
 where provider = 'openai' and model = 'gpt-5-mini' and metric = 'input_tokens';
```
   Cuando un proveedor **cambie su precio**, no edites la fila: agrega una nueva con otra fecha y se conserva el historial.
```sql
insert into smyl_provider_prices(provider, model, metric, per_units, price, currency, effective_from, note)
values ('openai', 'gpt-5-mini', 'input_tokens', 1000000, <nuevo precio>, 'USD', '2027-01-01', 'Subió el precio');
```
3. **Ver el resultado**
```sql
select * from smyl_operation_costs;
```
   Una operación con `complete = false` todavía tiene precios sin capturar (la columna `missing` dice cuáles). **Nunca se inventa un costo.**

## Cómo leer los créditos sugeridos

`créditos = redondeo hacia arriba de (costo en pesos ÷ valor de 1 crédito)`, con mínimo 1. Con el valor por omisión ($0.50 de costo por crédito),
una operación de $0.06 vale 1 crédito y una de $2.40 vale 5. Ajusta `credit_value_mxn` para que tu crédito más barato valga 1.

## Qué NO está hecho todavía

- Las Edge Functions **siguen cobrando 1 crédito por operación**. Esto solo calcula y propone.
- Falta **registrar tokens y costo real** de cada llamada (hoy solo se guarda proveedor y modelo). Con eso los supuestos de `smyl_ai_operations` pasan a `medido`.
  El cálculo para hacerlo ya está en `supabase/functions/_shared/provider-cost.mjs`.
- Falta cambiar el mensaje del plan de «tokens» a «créditos de IA» y la vista interna de costo contra ingreso por clínica.
- `meta-send` sigue contando todos los mensajes de Meta; debe contar solo los que genera la IA.
- Timbres: costo $0.60 y precio $1.80 por timbre. No hay medidor de uso.
