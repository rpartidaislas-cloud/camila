# Piloto privado SMYL ↔ Muse · 27 de noviembre de 2026

Estado: implementación y pruebas locales. No desplegado ni conectado a una cuenta real de Muse. No se han enviado mensajes a pacientes o doctores. Falta elegir clínica y doctor, completar la configuración externa y probar el recorrido real. El piloto permanece desactivado por defecto.

## Alcance implementado

- Configuración → Canales → Muse: el titular habilita la clínica, el permiso de respuesta y cada persona del piloto. Cada usuario autoriza su propia conexión y puede revocarla.
- Una credencial aleatoria por usuario y clínica, almacenada únicamente como SHA-256; vence a los siete días. Se muestra una vez, en un campo protegido, para el almacén seguro de credenciales del conector privado. No se pega en conversaciones ni se guarda en el navegador. Esto es autenticación por token del piloto, **no un OAuth de Muse ya validado**.
- Cuatro operaciones separadas en `muse-pilot.openapi.yaml`: listar chats propios, consultar un chat, preparar un texto, enviar el borrador aprobado. No hay proxy general, finanzas, expediente, consultas SQL, cambio de permisos ni toma de chats ajenos.
- Los permisos se comprueban en cada operación mediante las reglas actuales de chat de SMYL. Además, el piloto exige asignación personal, clínica activa, pertenencia vigente, sucursal permitida, autorización del titular y consentimiento individual. Ser dentista no concede acceso por sí mismo.
- El borrador conserva destinatario, texto, versión de asignación, vencimiento y confirmación. Un reclamo atómico permite un solo intento de envío. LANA recibe la identidad real del doctor y la misma referencia de envío; aplica sus reglas de canal, historial e intervención humana. `accepted` significa aceptado por LANA; no entrega ni lectura confirmadas.
- Cuando el resultado es incierto se conserva `unknown`; no se reenvía automáticamente. Un borrador nuevo no debe usarse como reintento de un resultado incierto.
- Avisos genéricos por WhatsApp del profesional vinculado; no incluyen nombres, diagnósticos, contenido del chat ni enlaces públicos al paciente. Se ofrecen los últimos estados en la configuración personal.
- LANA conserva los canales y mensajes. Los webhooks actuales siguen recibiendo mensajes; una cola registra cambios de la conversación y entrega eventos firmados a SMYL. Las asignaciones realizadas por coordinación también generan aviso. Dos trabajos de servidor procesan las colas cada minuto sin depender del navegador; es entrega eventual, no una garantía de tiempo real.

## Experiencia del doctor

1. Coordinación asigna el chat solicitado al doctor mediante el flujo actual de SMYL. No se concede acceso por una mención del nombre en texto libre; si el destinatario es ambiguo, coordinación lo resuelve.
2. El doctor recibe un aviso genérico en su WhatsApp vinculado. Puede abrir SMYL o entrar a **su conversación con Muse en WhatsApp** y pedir los chats pendientes.
3. Muse consulta únicamente los chats asignados y muestra el destinatario y el texto propuesto.
4. El doctor aprueba el envío. La respuesta sale por el canal oficial de la clínica hacia el paciente y queda en LANA/SMYL con atribución al doctor.

Responder directamente al aviso genérico no constituye una respuesta al paciente. No se ha implementado un intérprete de mensajes libres en el WhatsApp personal ni un webhook de push nativo de Muse: la compatibilidad de avisos proactivos de un conector privado debe verificarse con Meta. El piloto usa WhatsApp/LANA para los avisos y Muse para consultar y responder.

## Activación ordenada

1. Confirmar clínica, usuario profesional activo y cuenta de Muse. Usar primero conversaciones y teléfonos de prueba, sin datos de pacientes.
2. Aplicar **solo** las migraciones de este cambio en sus proyectos respectivos, revisando antes el historial remoto. No ejecutar un push indiscriminado de todas las migraciones de los worktrees.
   - SMYL: `20261127150000_smyl_muse_pilot.sql`.
   - LANA: `20261127150000_smyl_muse_events.sql`.
3. Desplegar `camila-api` y `smyl-muse-events` en LANA; `muse-manage`, `muse-connector`, `muse-events`, `muse-alerts` en SMYL. Cada endpoint autentica su propia clase de solicitud; respetar `supabase/config.toml`.
4. Configurar `SMYL_MUSE_WEBHOOK_SECRET` con el mismo secreto nuevo aleatorio de al menos 32 caracteres en ambos servidores, por un canal seguro. No sustituir el secreto de los callbacks de agenda. Mantener las claves de transporte LANA y Supabase únicamente en servidor.
5. Verificar `pg_cron`, `pg_net` y `service_role_key` en Vault. Ejecutar `scripts/sql/smyl-muse-workers.sql` en LANA y `scripts/sql/muse-pilot-workers.sql` en SMYL. Comprobar ejecución y respuesta HTTP; sin esos trabajos no hay avisos continuos.
6. Publicar la interfaz y sus copias móviles. Solicitar desde Plantillas de WhatsApp la nueva `smyl_chat_pendiente_profesional_v1`; **esperar aprobación y categoría UTILITY**. No reutilizar una plantilla de agenda para este propósito.
7. El titular habilita solo el usuario elegido. El doctor vincula su WhatsApp mediante el flujo existente y autoriza su conexión personal en Muse. Si no dispone de un campo seguro de credenciales en su cuenta de Muse, no pegar el secreto en el chat: detener la conexión y adaptar la autenticación soportada.
8. Registrar el OpenAPI como conector privado en Muse. Clasificar `enviarRespuesta` como **escritura sensible con aprobación humana en cada uso**, `prepararRespuesta` como escritura de borrador sin envío, y las otras dos como lectura. La confirmación de texto en el payload no demuestra por sí sola una acción humana: se requiere verificar la barrera de aprobación del cliente Muse. Mantener respuestas deshabilitadas hasta observar esa aprobación en la prueba real.
9. Verificar lectura, aviso, aprobación, envío único, pausa de IA, historial y atribución; después revocar permisos, cambiar sucursal/asignación y desconectar. Todas las operaciones posteriores deben denegarse. Repetir el evento y la llamada de envío: no duplicar mensajes. Probar la ventana de WhatsApp cerrada y un resultado incierto.

No se declara el piloto operativo hasta completar estos pasos con evidencia. La publicación en el catálogo público de conectores Muse es otro proceso y no está incluida.

## Operación y retención

- Se reintentan eventos firmados con ID estable y espera creciente, hasta ocho intentos. Los avisos solo reintentan comprobaciones previas al envío; los envíos inciertos requieren revisión. Estados de cola nunca significan que el doctor o el paciente hayan leído el mensaje.
- Borradores vencidos se limpian en el siguiente ciclo; el contenido se retira al terminar un intento. Borradores residuales se eliminan en 24 horas, eventos en 30 días y auditoría mínima en 90 días. Sin los trabajos de servidor, la limpieza no corre.
- La auditoría no contiene textos ni secretos. Los únicos textos temporales adicionales son borradores de salida; no hay segunda base de mensajes.
- Deshabilitar la clínica o el usuario impide nuevas consultas; revocar la conexión invalida su clave. No elimina información ya compartida con el historial de Muse.
- Pausa operativa: desactivar el piloto desde SMYL y, si hace falta, suspender ambos trabajos con las instrucciones incluidas en los SQL. No borrar tablas ni migraciones para pausar.

## Validación local

- PostgreSQL en PGlite con las funciones reales de permisos de chat: clínica, sucursal, desactivación, permisos de respuesta, reasignación, revocación, vencimiento, límite de solicitudes, reclamo concurrente y acceso directo denegado.
- Ejecución de los handlers del conector con transporte simulado: identidad, destinatario y texto estables, confirmación requerida, separación entre herramientas, duplicados, revocación y entrega incierta.
- Navegador real con datos simulados en 1440, 768 y 390 px: consentimiento, campo de credencial oculto, eliminación al salir, sin desbordamiento ni errores de JavaScript. Capturas locales en `output/muse-pilot/`.
- Cola de LANA: desactivada por defecto, separación de clínicas, eventos sin datos clínicos, deduplicación y recuperación de un trabajador interrumpido.
- Regresiones del catálogo de plantillas y del enrutamiento de LANA.

Fuentes de integración consultadas: [Muse Platform](https://platform.muse.ai/docs), [conectores personalizados](https://www.meta.com/en-gb/help/superintelligence/1687253048996149/) y [Muse en WhatsApp](https://ai.meta.com/muse). La autorización y el comportamiento de la cuenta elegida aún deben verificarse; no se presume soporte universal de push ni un flujo OAuth específico.
