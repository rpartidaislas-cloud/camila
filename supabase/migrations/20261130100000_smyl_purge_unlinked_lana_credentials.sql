-- SMYL · Borra las credenciales de mensajería que quedaron guardadas tras «Desvincular».
-- Antes, desvincular movía el enlace cifrado a integraciones.lana_desvinculada «para poder restaurarlo», pero ninguna
-- función lo restauraba ni lo leía: era una credencial viva guardada sin uso. Desde ahora desvincular la borra.
-- Esta migración limpia las que ya existían. Deja el rastro sin secretos (huella, fechas, quién desvinculó).
-- Aditiva e idempotente; no toca integraciones.lana (el enlace activo).

begin;

update public.camila_tenants
   set config = jsonb_set(
         config,
         '{integraciones,lana_desvinculada}',
         ((config #> '{integraciones,lana_desvinculada}') - 'api_key_ciphertext' - 'api_key_iv')
           || jsonb_build_object('credencial_borrada', true),
         false
       )
 where jsonb_typeof(config #> '{integraciones,lana_desvinculada}') = 'object'
   and ((config #> '{integraciones,lana_desvinculada}') ? 'api_key_ciphertext'
        or (config #> '{integraciones,lana_desvinculada}') ? 'api_key_iv');

commit;
