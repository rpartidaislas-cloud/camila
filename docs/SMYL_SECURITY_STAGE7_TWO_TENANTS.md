# Etapa 7 — prueba dinámica entre dos clínicas

## Estado

**Arnés preparado; ejecución pendiente de un proyecto Supabase desechable.**

La prueba se niega a ejecutar si detecta el identificador del proyecto de
producción. Requiere dos cuentas propietarias pertenecientes a clínicas
distintas y crea exclusivamente pacientes e inventario sintéticos.

## Cobertura

- Lectura de pacientes e inventario de otra clínica.
- Actualización e inserción con `tenant_id` ajeno.
- RPC clínica con IDs válidos pertenecientes al otro tenant.
- Realtime con control positivo propio antes de probar el evento cruzado.
- Descarga Storage: la clínica propietaria debe leer un objeto sintético ya
  verificado como `clean`; la otra clínica debe recibir rechazo.

El informe contiene estados, códigos HTTP y una huella del proyecto. No guarda
URL, correos, contraseñas, tokens, nombres reales ni identificadores clínicos.

## Variables requeridas

```text
SMYL_ISOLATION_CONFIRM=DISPOSABLE_TWO_TENANT_PROJECT
SMYL_ISOLATION_PROJECT_URL=https://PROYECTO-DE-PRUEBAS.supabase.co
SMYL_ISOLATION_ANON_KEY=...
SMYL_ISOLATION_USER_A_EMAIL=...
SMYL_ISOLATION_USER_A_PASSWORD=...
SMYL_ISOLATION_USER_B_EMAIL=...
SMYL_ISOLATION_USER_B_PASSWORD=...
SMYL_ISOLATION_CLEAN_OBJECT_B=tenant-b/paciente-b/carpeta/archivo-sintetico.png
```

La ruta de Storage debe apuntar a un PNG/JPEG sintético que ya pasó la función
de verificación. No usar fotografías, documentos o nombres de pacientes.

## Ejecución

```text
node scripts/two-tenant-isolation.mjs --report=artifacts/security/stage7-report.json
```

- `PASS`: todos los controles positivos y negativos funcionaron.
- `INCOMPLETE`: faltó Storage o Realtime no tuvo control positivo.
- `BLOCKED`: al menos una frontera permitió acceso cruzado.

Un resultado distinto de `PASS` mantiene bloqueado el lanzamiento clínico. Los
registros sintéticos se conservan únicamente durante la vida del proyecto
desechable; el proyecto completo debe eliminarse después de guardar el informe.
