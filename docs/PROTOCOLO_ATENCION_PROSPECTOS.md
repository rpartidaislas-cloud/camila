# Protocolo de atención a prospectos de SMYL (dentistas) — del primer contacto a la clínica conectada a LANA

Versión 1 · 27 de noviembre de 2026 · Propuesta de trabajo.
Lo marcado como **[Propuesta]** (tiempos, precios de excepción, pruebas gratis) es decisión comercial: ajústalo antes de usarlo.
Lo demás describe lo que hoy hace la plataforma.

## 0. Para qué sirve

Dejar a cada dentista interesado **funcionando con LANA en sus canales** (WhatsApp, y Messenger/Instagram si los usa) siguiendo siempre los mismos pasos, con criterios claros para avanzar, pausar o descartar. LANA ya opera como Tech Provider; este protocolo cubre lo que ocurre **antes y durante** la conexión.

| Rol | Quién | Responsabilidad |
|---|---|---|
| Comercial | Quien atiende al prospecto | Etapas 1 a 4: contacto, calificación, demo y cierre |
| Onboarding | Quien conecta la clínica | Etapas 5 a 8: preparación, alta, piloto y seguimiento |
| Soporte técnico (LANA) | Ricardo / equipo LANA | Fallos de Embedded Signup, webhooks y plantillas |

## 1. Visión general

```
Contacto → Calificación → Demo → Propuesta y alta → Preparación → Sesión de conexión → Piloto (7 días) → Activa
   ≤1 h        ≤1 día     ≤3 días      ≤2 días          ≤3 días        60–90 min        supervisado      día 30
```
**[Propuesta]** Los tiempos son metas de atención, no promesas al prospecto.

Cada prospecto tiene **un solo estado**: `Nuevo` · `Calificado` · `Demo agendada` · `Propuesta enviada` · `Cuenta creada` · `En preparación` · `Conectado` · `Piloto` · `Activo` · `Pausado` · `Descartado`.
Registra siempre el motivo al pausar o descartar.

## 2. Etapa 1 — Primer contacto (meta: responder en 1 hora hábil)

**Entradas:** botón «Crear mi cuenta» de la landing, mensaje directo, referido, evento.

**Datos mínimos a registrar** (solo lo necesario; nunca datos de pacientes):
- Nombre, clínica, ciudad, teléfono y correo.
- Origen del contacto y **fecha en que aceptó que lo contactemos** (SMYL es responsable de estos datos; ver `privacidad.html`).
- Número de dentistas y de sedes.
- Cómo atiende hoy a sus pacientes por mensajes: ¿usa la app **WhatsApp Business** o el WhatsApp normal? ¿el número es de la clínica o personal? ¿Tiene Facebook o Instagram del consultorio?
- Cuántos mensajes recibe al día (aproximado) y qué software usa hoy.
- Qué le duele más: citas perdidas, mensajes sin responder, seguimiento, cobros.

**Mensaje base:**
> Hola, Dr./Dra. {nombre}, gracias por tu interés en SMYL. Soy {nombre} del equipo. Para recomendarte la mejor forma de empezar, ¿me cuentas en 3 líneas cómo atiendes hoy los mensajes de tus pacientes y qué quisieras mejorar? Si prefieres, agendamos una llamada de 15 minutos.

**Salida:** contacto registrado y respuesta enviada. Si no responde: un recordatorio a los 2 días y otro a los 7; después, `Pausado` (sin más insistencia).

## 3. Etapa 2 — Calificación (go / no-go)

| Criterio | Sí continúa | Atención |
|---|---|---|
| Atiende pacientes con cédula profesional propia o de un socio | ✔ | Sin cédula no podrá firmar notas ni recetar |
| Tiene un número para conectar (dedicado, o WhatsApp Business app) | ✔ | Solo WhatsApp personal sin respaldo: explicar opciones antes de seguir |
| La persona que decide puede ser administradora de su Business de Meta, o crearlo | ✔ | Si el Business lo administra un tercero (agencia), involucrarlo desde el inicio |
| Entiende que la IA **no diagnostica** y que un humano revisa lo clínico | ✔ | Si espera lo contrario: aclarar o descartar |
| Quiere enviar promociones masivas | ✘ por ahora | LANA solo acepta plantillas de utilidad fuera de la ventana de 24 h; las de marketing no |

**Salida:** `Calificado`, `Pausado` (con motivo) o `Descartado` (con motivo).

## 4. Etapa 3 — Demo (20–30 min)

Guion sugerido:
1. **Su problema** en sus palabras (2 min).
2. **Conversación real** en la bandeja: el asistente se presenta como asistente, responde con información de la clínica, agenda y **pasa a una persona** cuando hace falta.
3. **Agenda y ficha del paciente** (citas, historia clínica, consentimientos).
4. **Cómo se conecta** (Configuración → Canales): número dedicado o conservar el WhatsApp Business app (coexistencia, **en beta**).
5. **Qué NO hace:** no diagnostica, no receta, no promete resultados.
6. Precio y plan.

**Honestidad con el prospecto (no prometer):**
- Plantillas de WhatsApp: **Meta las aprueba** y puede tardar o rechazarlas.
- Ventana de 24 horas: fuera de ella solo salen plantillas aprobadas.
- Coexistencia en beta: las respuestas desde el celular pausan al asistente en esa conversación; **el historial de chats anteriores todavía no se importa**.
- Resultados de simulaciones de sonrisa: orientativos, nunca garantizados.

## 5. Etapa 4 — Propuesta y alta de cuenta

| Plan | Precio | Análisis con IA al mes |
|---|---|---|
| Esencial | $399 MXN/mes | 15 |
| Profesional | $799 MXN/mes | 40 |
| Premium | $1,499 MXN/mes | 100 |

- La cuenta se crea desde la landing: `app.html?registro=1&plan=esencial|profesional|premium`. El cobro es con Stripe.
- **[Propuesta]** Descuentos o pruebas gratis: definir quién las autoriza y registrar cada excepción.
- Al crear la cuenta pasa a `Cuenta creada`. Programar la sesión de conexión dentro de los 3 días siguientes.

## 6. Etapa 5 — Preparación (antes de la sesión)

Enviar esta lista al dentista y **no agendar la conexión hasta que esté lista**:

**Meta**
- [ ] La persona que conecta es **administradora** del Business Portfolio de Meta de la clínica (o lo crea en la sesión).
- [ ] Sabe su usuario y contraseña de Facebook y puede recibir códigos de verificación.
- [ ] Nombre del consultorio tal como lo mostrará WhatsApp (Meta lo revisa).

**Número de WhatsApp**
- [ ] Decisión tomada: **número exclusivo** o **conservar el WhatsApp Business app**.
- [ ] Exclusivo: línea que pueda recibir SMS o llamada para el código, y que no esté en uso en otro WhatsApp que quiera conservar.
- [ ] Coexistencia: tiene instalada la app **WhatsApp Business** actualizada. Los requisitos exactos de Meta cambian; el equipo debe revisarlos en su documentación vigente antes de la sesión.
- [ ] Si usa Messenger o Instagram: Página de Facebook y cuenta profesional de Instagram vinculadas.

**Datos de la clínica** (para configurar el asistente)
- [ ] Sucursales con **calle y ciudad** completas (también salen en recetas y en el aviso de privacidad).
- [ ] Horarios, servicios y rangos de precio que el asistente puede mencionar, y preguntas frecuentes.
- [ ] Dentistas del equipo, cada uno con **cédula profesional** e institución que expidió el título.
- [ ] Correo de contacto de privacidad de la clínica.

**Salida:** `En preparación` → checklist completo.

## 7. Etapa 6 — Sesión de conexión (60–90 min, con el dueño)

La conexión la hace **el dueño** de la clínica (solo él puede conectar canales). Orden en la app:

1. **Configuración → Clínica**: sucursales con domicilio y horarios.
2. **Equipo**: dar de alta a los profesionales con su cédula.
3. **Configuración → Canales → «Activar canales para mi clínica»** (aprovisiona su cuenta en LANA).
4. **WhatsApp → Conectar**, eligiendo el modo (exclusivo o coexistencia). Se abre la ventana de LANA con Embedded Signup. El dueño inicia sesión con Facebook, elige su Business y su número y acepta.
5. Volver a SMYL y **verificar el estado**: debe decir «Mensajería activa» y mostrar el canal conectado.
6. Repetir para Messenger e Instagram si aplica.
7. **Capacitar el asistente**: identidad y voz, descripción de la clínica, sucursales, servicios, preguntas frecuentes y flujo de atención. Publicar y probar en el laboratorio privado antes de activar.
8. **Plantillas de WhatsApp** (Configuración → Plantillas): solicitar a Meta las del catálogo que usará (recordatorio de cita, confirmación, aviso de privacidad). Quedan pendientes hasta que Meta las apruebe.
9. **Prueba real** con el celular del dueño: un mensaje entrante, la respuesta del asistente, una cita agendada y una conversación que pase a una persona.
10. **Privacidad**: confirmar que el aviso de privacidad de la clínica queda completo (domicilio y correo) y explicar el consentimiento de WhatsApp de cada paciente.

**Criterio de salida:** canal conectado + asistente publicado + prueba real exitosa → `Conectado`.

## 8. Etapa 7 — Piloto supervisado (primeros 7 días)

- Los 3 primeros días, revisar las conversaciones **todos los días** con el dueño (5–10 min): ¿respondió bien?, ¿escaló cuando debía?, ¿inventó algo?
- Corregir el asistente en la capacitación y volver a publicar (cada publicación queda como versión).
- Confirmar que las plantillas pendientes ya fueron aprobadas o rechazadas; si fue rechazo, pedir una versión nueva.
- **Salida a `Piloto` → `Activo`:** 7 días sin errores graves del asistente y el dueño sabe cómo tomar una conversación.

## 9. Etapa 8 — Seguimiento

| Día | Contacto | Qué se revisa |
|---|---|---|
| 1 | Mensaje | ¿Llegaron mensajes? ¿Algún error? |
| 3 | Llamada corta | Calidad de respuestas, dudas |
| 7 | Llamada | Cierre del piloto, plantillas, equipo |
| 14 | Mensaje | Uso del asistente, citas por el chat |
| 30 | Llamada | Resultados, plan adecuado, siguientes pasos |

**Clínica activada** (meta mínima al día 30): al menos 1 conversación atendida por el asistente, 1 cita agendada por el chat, plantillas de recordatorio aprobadas y 2 integrantes del equipo con acceso.

## 10. Problemas frecuentes y a quién escalar

| Problema | Primera acción | Escalar a |
|---|---|---|
| Embedded Signup se cierra o falla | Reintentar en ventana nueva; confirmar que el usuario es administrador del Business | LANA |
| «El número ya está registrado» | Confirmar si el número está en otro WhatsApp/WABA; no borrar la cuenta del dentista sin su aprobación | LANA |
| El estado dice «Requiere atención» | Verificar conexión desde SMYL | LANA |
| Plantilla rechazada | Leer el motivo, ajustar el texto y solicitar una versión nueva | Onboarding |
| El asistente responde algo inadecuado | Pausar al asistente en esa conversación y corregir la capacitación | Onboarding + LANA |
| Un paciente pide acceso, corrección, cancelación u oposición de sus datos | La clínica es la responsable: registrar la solicitud en Configuración → Privacidad y derechos | Clínica |
| Un mensaje contiene datos sensibles mandados por error | No reenviarlo; seguir el runbook de incidentes de seguridad | Seguridad |

## 11. Reglas de conducta con los prospectos

- **No prometer diagnósticos, resultados garantizados, ni frases como «el mejor» o «sin dolor»** (publicidad de servicios de salud; ver `docs/COFEPRIS_CLASIFICACION_IA.md`).
- **No pedir ni recibir datos de pacientes** durante la prospección. Para demos usar datos de ejemplo.
- Contactar solo a quien aceptó o lo pidió; ofrecer siempre salir de la lista.
- Datos del prospecto: guardar solo lo necesario y por el tiempo en que la relación esté activa.
- Nunca pedir contraseñas ni códigos de verificación al dentista: los escribe él en la ventana de Meta.

## 12. Medición

Por semana: contactos nuevos · calificados · demos hechas · cuentas creadas · conectados · activos al día 30 · **tiempo promedio de contacto a conectado** · motivos de descarte y de pausa.

## 13. Qué falta para operar este protocolo

1. **Dónde llevar a los prospectos.** SMYL no tiene hoy un lugar para el pipeline de dentistas prospecto (el «Pipeline» de la app es de los pacientes de cada clínica). Mientras tanto, una hoja de cálculo con los estados de la sección 1. Si conviene, se puede construir un formulario «Quiero una demo» en la landing que guarde el contacto con su consentimiento.
2. **Decisiones comerciales** marcadas como [Propuesta]: tiempos, pruebas gratis, descuentos.
3. **Validar con LANA** los requisitos actuales de Meta para coexistencia y para número exclusivo, y mantenerlos al día en la lista de la sección 6.
4. **Probar el protocolo completo con una primera clínica** y ajustarlo con lo que salga.
