# Equipo de prueba (3 sucursales y 6 dentistas ficticios)

Datos ficticios para probar Agenda, Mensajes y el asistente sin tocar pacientes reales.

| Archivo | Para qué |
|---|---|
| `equipo-de-prueba.sql` | Crea las sucursales, sillones, dentistas, horarios y servicios. Se puede correr varias veces. |
| `equipo-de-prueba-limpiar.sql` | Lo borra todo (solo lo que tiene id `7e57…` de esa clínica). |
| `pacientes-y-citas-de-prueba.sql` | **Después del equipo:** 30 pacientes ficticios, 4 bloqueos y ~300 citas de los 14 días anteriores y los 14 siguientes. Repetible. |
| `pacientes-y-citas-de-prueba-limpiar.sql` | Borra esos pacientes, citas y bloqueos (córrelo ANTES de `equipo-de-prueba-limpiar.sql`). |
| `organizacion-del-equipo.html` | Ábrelo en el navegador: horario semanal por sucursal, quién hace cada servicio y las reglas de disponibilidad. |

## Cómo usarlo

1. **Usa una clínica de prueba**, no la real: el asistente de WhatsApp/Instagram podría ofrecerle a pacientes reales horarios con dentistas que no existen. Para tenerla, registra otra cuenta en SMYL con otro correo. El script se niega a correr en una clínica con profesionales o citas reales.
2. Supabase → **SQL Editor** → New query → pega `equipo-de-prueba.sql`.
3. Cambia `PEGA-AQUI-EL-ID-DE-LA-CLINICA` por el id de la clínica de prueba. Para verlo: `select id, nombre, email from public.camila_tenants;`
4. **Run**. El último resultado es el horario semanal de cada dentista.
5. Cuando termines: `equipo-de-prueba-limpiar.sql` con el mismo id. Si una sucursal o dentista ya tiene cobros, caja, notas clínicas o inventario, **se desactiva en vez de borrarse**.

La clínica nueva trae su propia sucursal («Clínica principal»); queda como cuarta sucursal sin dentistas.

## Pacientes y citas de prueba

Corre `pacientes-y-citas-de-prueba.sql` en la misma clínica **después** de `equipo-de-prueba.sql` (mismo id). Las citas respetan las reglas reales (horario de sucursal y dentista, servicio que hace, sillón libre, bloqueos, sin empalmar al paciente); donde no cabe una, no se crea, así que Plaza Sol (un solo sillón) se ve más saturada. Las pasadas quedan terminadas, con algunas «No vino» y canceladas; las futuras, confirmadas.

- **No crea recordatorios**: nadie recibe mensajes. Los teléfonos son falsos (`3300001xxx`) y los correos `@ejemplo.invalid`.
- Se calcula a partir de hoy: si lo vuelves a correr otro día, agrega los días nuevos y conserva lo anterior.
- Con la agenda llena puedes probar: el calendario de «Agendar cita» con días de pocos/ningún horario, el tablero de «Nueva cita» explicando por qué un dentista no está libre (sillón, bloqueo, cita), el día con vacaciones de la Dra. Valeria (a 10–12 días), la junta del Dr. Andrés y el mantenimiento del sillón de Plaza Sol, y cancelar o reagendar citas.
- Para borrar: `pacientes-y-citas-de-prueba-limpiar.sql` y luego `equipo-de-prueba-limpiar.sql`.

## Qué probar (todo comprobado con la regla real de disponibilidad)

En «Agendar cita» del chat, con el servicio indicado:

1. **Quién aparece por servicio.** «Endodoncia» solo muestra al Dr. Andrés (mar y jue, de 10:00 a 17:30 por los 90 min). «Valoración dental integral» muestra a cinco dentistas; la Dra. Mónica no.
2. **Un dentista en varias sucursales.** La Dra. Valeria está en Centro lun/mié/vie y en Plaza Sol mar/jue. Elige su nombre y mira cómo cambia la sucursal por día.
3. **Cierres.** Los domingos no hay horarios. Centro no ofrece nada entre 14:00 y 15:00.
4. **Filtro por sucursal.** «Valoración dental integral» en Lomas Verdes solo muestra al Dr. Rodrigo y al Dr. Iván.
5. **El sillón único.** Plaza Sol tiene un solo sillón. El martes agenda una cita con la Dra. Valeria a las 12:00: la Dra. Fernanda deja de ofrecer 12:00–12:45 aunque esté libre, y a las 13:00 vuelve.
6. **Citas del día.** Agenda varias citas el mismo día y elige ese día en el calendario: aparecen solas debajo de los horarios.
7. **Sucursal por el chat.** Escribe desde un Instagram o WhatsApp de prueba «quiero cita en Plaza Sol» y revisa que la conversación quede asignada a esa sucursal.

## Para probar después (no incluido aquí)

- **Cancelar / reagendar** citas ya creadas y crear bloqueos nuevos desde la Agenda.
- **Permisos por sucursal.** Un usuario de recepción con alcance a una sola sucursal debe ver solo los chats y citas de la suya.
- **Precios por sucursal, inventario por sucursal y recordatorios.** Para los recordatorios usa solo tu propio número.

## Diagnóstico de la confirmación automática de citas

`confirmacion-de-cita-diagnostico.sql` (solo lectura). Tras encender «Confirmación al agendar» y agendar una cita de prueba
a un paciente con chat de WhatsApp vinculado, pégalo en el SQL Editor: muestra la configuración, el estado de cada mensaje
(`pending/sent/failed/cancelled` con su `last_error`), si la cita cumple las reglas y si el paciente tiene chat vinculado.
