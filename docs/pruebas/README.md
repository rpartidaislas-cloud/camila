# Equipo de prueba (3 sucursales y 6 dentistas ficticios)

Datos ficticios para probar Agenda, Mensajes y el asistente sin tocar pacientes reales.

| Archivo | Para qué |
|---|---|
| `equipo-de-prueba.sql` | Crea las sucursales, sillones, dentistas, horarios y servicios. Se puede correr varias veces. |
| `equipo-de-prueba-limpiar.sql` | Lo borra todo (solo lo que tiene id `7e57…` de esa clínica). |
| `organizacion-del-equipo.html` | Ábrelo en el navegador: horario semanal por sucursal, quién hace cada servicio y las reglas de disponibilidad. |

## Cómo usarlo

1. **Usa una clínica de prueba**, no la real: el asistente de WhatsApp/Instagram podría ofrecerle a pacientes reales horarios con dentistas que no existen. Para tenerla, registra otra cuenta en SMYL con otro correo. El script se niega a correr en una clínica con profesionales o citas reales.
2. Supabase → **SQL Editor** → New query → pega `equipo-de-prueba.sql`.
3. Cambia `PEGA-AQUI-EL-ID-DE-LA-CLINICA` por el id de la clínica de prueba. Para verlo: `select id, nombre, email from public.camila_tenants;`
4. **Run**. El último resultado es el horario semanal de cada dentista.
5. Cuando termines: `equipo-de-prueba-limpiar.sql` con el mismo id. Si una sucursal o dentista ya tiene cobros, caja, notas clínicas o inventario, **se desactiva en vez de borrarse**.

La clínica nueva trae su propia sucursal («Clínica principal»); queda como cuarta sucursal sin dentistas.

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

- **Pacientes ficticios y citas.** Para ver el calendario con carga real y la saturación de sillones.
- **Bloqueos** (vacaciones, junta) y **cancelar / reagendar**.
- **Permisos por sucursal.** Un usuario de recepción con alcance a una sola sucursal debe ver solo los chats y citas de la suya.
- **Precios por sucursal, inventario por sucursal y recordatorios.** Para los recordatorios usa solo tu propio número.
