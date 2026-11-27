# Rotación de la llave de cifrado de LANA

SMYL guarda el código de enlace de LANA cifrado (AES-GCM) con `SMYL_LANA_ENCRYPTION_KEY`. Cada credencial anota
`key_version` (las anteriores a este cambio no lo tienen y cuentan como versión `1`). Se puede cambiar la llave
sin desconectar a nadie.

## Variables (Supabase → Edge Functions → Secrets)

| Variable | Qué es |
| --- | --- |
| `SMYL_LANA_ENCRYPTION_KEY` | Llave vigente, 32 bytes en base64. |
| `SMYL_LANA_ENCRYPTION_KEY_VERSION` | Etiqueta de la vigente. Por omisión `1`. |
| `SMYL_LANA_ENCRYPTION_KEY_PREVIOUS` | Llave anterior, solo mientras dura la rotación. |
| `SMYL_LANA_ENCRYPTION_KEY_PREVIOUS_VERSION` | Etiqueta de la anterior (si la vigente es numérica, por omisión es la vigente − 1). |

## Procedimiento

1. Genera la llave nueva: `openssl rand -base64 32`.
2. Guarda la actual como `..._PREVIOUS` (con su versión) y la nueva como `SMYL_LANA_ENCRYPTION_KEY` con `..._VERSION=2`
   (o la siguiente). **No borres la anterior todavía.**
3. Vuelve a desplegar `lana-connection` y todas las funciones que usan `_shared/lana-linked.ts`
   (`lana-inbox`, `lana-channels`, `lana-context`, `lana-attention`, `lana-training`, `lana-ia-interruptor`,
   `appointment-negotiations`, `appointment-reminders`). Mientras tanto todo sigue funcionando: se descifra con la
   llave que indica `key_version` y, si falla, con la otra.
4. Cada clínica pasa a la llave nueva cuando su dueño pulsa **Verificar** en Canales (acción `verify`) o con la
   acción `rotate_key`, que solo vuelve a cifrar y no llama a LANA. Con `GET ?action=status` el campo `encryption`
   dice `current` o `pending_rotation`.
5. Revisa que ninguna clínica siga pendiente:

   ```sql
   select id, nombre
   from camila_tenants
   where config #>> '{integraciones,lana,api_key_ciphertext}' is not null
     and coalesce(config #>> '{integraciones,lana,key_version}', '1') <> '2';
   ```

6. Cuando la consulta no devuelva filas, borra `SMYL_LANA_ENCRYPTION_KEY_PREVIOUS(_VERSION)`.

## Si algo sale mal

- Mensaje «No se pudo descifrar la credencial…»: la llave anterior ya no está o la versión es incorrecta. Vuelve a poner
  la anterior en `..._PREVIOUS`; si se perdió, esa clínica debe reconectar con un código de enlace nuevo.
- Las llaves nunca se escriben en código, en chats ni en la base de datos; solo en Secrets.
