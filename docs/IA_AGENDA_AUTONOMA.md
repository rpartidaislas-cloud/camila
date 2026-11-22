# Agenda autónoma con IA (plan)

Estado: **plan, nada implementado**. Fecha: 2026-11-22.
Meta: que el asistente de IA del chat revise disponibilidad real (clínica, sucursal, profesional, horario) y agende citas **sin que una persona intervenga**, ofreciendo opciones **pocas, ordenadas y coherentes**.

## 1. Qué ya existe (leído en el repo)

| Pieza | Qué hace hoy |
|---|---|
| `smyl_inbox_available_slots_v2` | Horarios libres reales: horario de sucursal y de profesional, servicios que hace cada quien, sillón, bloqueos, citas y apartados; zona horaria por sucursal; hasta 30 resultados. |
| `smyl_inbox_create_appointment_request` | Crea una solicitud con **apartado de 10 minutos**, idempotente, con candados por profesional y sillón, y revalida el horario al guardar. |
| `smyl_inbox_confirm_appointment_request` | Convierte la solicitud en cita confirmada y programa el recordatorio de 24 h. |
| Sucursal por conversación | `smyl_conversation_branches` (la elige una persona o la deduce SMYL). |
| Avisos | Recordatorios, plantilla «nueva cita» para el profesional, botones de confirmar/reprogramar del paciente (callback firmado). |
| Tablero de disponibilidad (Agenda) | Ya explica por qué un día no tiene horarios y propone alternativas (`smyl-schedule-board.js`). |

## 2. Qué falta (y por qué hoy no es posible sin una persona)

1. **Quien agenda debe ser una persona con permiso `schedule.manage`.** Las funciones anteriores rechazan a cualquier otro actor.
2. **Exigen un paciente vinculado a la conversación.** Si el contacto es nuevo y no tiene registro, se rechaza («Vincula un paciente antes…»).
3. **El asistente vive en LANA y no puede consultar SMYL.** Solo lee un texto que la clínica publica. El contrato para que LANA consulte horarios existe como propuesta (`docs/LANA_CONTEXTO_POR_SUCURSAL.md`, acción `availability`), pero **la función `lana-branch-context` no está construida** y no se verificó qué hace hoy LANA del lado del asistente.
4. **No hay política de la clínica** sobre qué puede agendar sola la IA, con cuánta anticipación, ni límites por paciente.
5. **No hay un motor que decida qué horarios mostrar.** La lista cruda de 30 horarios no sirve para un chat: confunde.

## 3. Diseño

### 3.1 Puente firmado SMYL ↔ LANA: función `lana-scheduling`
Misma firma HMAC que `appointment-negotiations` (cuerpo crudo, ±5 min). LANA la usa como **herramientas del modelo**:

- `context`: sucursal de la conversación, servicios agendables, política de la clínica y zona horaria.
- `suggest`: devuelve **hasta 3 opciones** ya ordenadas y etiquetadas (ver 3.2).
- `book`: reserva la opción elegida (idempotente por mensaje del paciente).
- `change` (fase posterior): reprogramar o cancelar con la misma política.

El modelo **no calcula ni inventa horarios**: solo presenta lo que devuelve SMYL.

### 3.2 Cómo se eligen las opciones (determinista, no es IA)
- Una sola sucursal (la de la conversación; si hay varias y no está asignada, el asistente pregunta primero).
- **Máximo 3 opciones**, siempre con día, hora local, profesional y sede.
- Diversificadas: la **primera disponible**, otra de **distinta franja** (mañana/tarde) y otra de **otro día**.
- Prioridad al **profesional de continuidad** si el paciente ya fue atendido; si pidió uno, solo ese.
- Respeta anticipación mínima y máxima, comida y bloqueos (ya los cubre la función de horarios).
- Si no hay nada: dice **por qué** (con el mismo motor de explicaciones de Agenda) y ofrece ampliar fechas, otra sucursal o lista de espera.

Ejemplo de mensaje:
> Tengo estas opciones en Sucursal Centro para tu valoración:
> 1) Mar 25 · 10:00 a. m. · Dra. Fernanda
> 2) Mar 25 · 4:30 p. m. · Dr. Andrés
> 3) Jue 27 · 11:00 a. m. · Dra. Fernanda
> Responde 1, 2 o 3.

### 3.3 Actor y permisos
Rol de sistema **«Asistente IA»** con permisos mínimos: crear solicitudes y citas **solo desde conversaciones propias** y servicios permitidos. Sin acceso a expediente clínico, cobros ni datos de otros pacientes.

### 3.4 Pacientes nuevos
Opción por clínica: (a) solo agenda a pacientes ya registrados, o (b) crea un registro mínimo (nombre, teléfono del canal y, si es menor, nombre del tutor) marcado «creado por IA, pendiente de completar». Recomendado (b) desde el nivel 2, nunca con datos clínicos.

### 3.5 Niveles de autonomía (por clínica, apagado por defecto)
1. **Solo sugiere.** La IA ofrece horarios y aparta 10 min; una persona confirma (casi todo existe).
2. **Agenda sola** los servicios permitidos (p. ej. valoración inicial) y avisa al equipo. **Piloto recomendado.**
3. Además **reprograma y cancela** dentro de la política.

### 3.6 Salvaguardas
- Apartado de 10 minutos mientras el paciente responde; revalidación al reservar; si choca, ofrece otras opciones sin rodeos.
- Idempotencia: el mismo mensaje del paciente nunca crea dos citas.
- Límites: máximo de citas activas por teléfono y por día; tres rondas sin acuerdo → pase a una persona.
- Cada cita lleva la etiqueta **«Agendada por IA»** en Agenda, con acción visible para deshacer.
- Aviso al profesional (plantilla ya existente) y recordatorio de 24 h (ya existente).
- Auditoría de cada acción y consumo en créditos de IA.
- Menores de edad: nunca se agenda sin datos del tutor.

## 4. Fases

| Fase | Entrega | Depende de |
|---|---|---|
| 0 | Acordar con quien mantiene LANA cómo se exponen las herramientas (latencia, firma). | LANA |
| 1 | Motor `suggest` + botón **«Sugerir horarios»** en el diálogo «Agendar cita» del chat para el equipo. Mismo motor que usará la IA; ya sirve a las personas. | Nada externo |
| 2 | Función `lana-scheduling` (`context`, `suggest`) con simulador y pruebas de dos clínicas. | Fase 0 |
| 3 | `book` con apartado y confirmación humana (nivel 1). | Fase 2 |
| 4 | Política en **Capacitar IA** + nivel 2 (agenda sola) y creación mínima de pacientes. | Fase 3 |
| 5 | Reprogramar y cancelar (nivel 3). | Fase 4 |
| 6 | Métricas: % de citas por IA, conflictos, asistencia frente a las agendadas por personas. | Fase 4 |

## 5. Pruebas de aceptación
- Dos clínicas a la vez: ninguna ve horarios ni pacientes de la otra.
- Nunca se ofrece un horario que luego se rechace (se compara contra la validación real).
- Seis conversaciones piden el mismo horario a la vez: solo una lo obtiene y las demás reciben alternativas.
- Repetir el mensaje no duplica la cita.
- Sin horarios: el mensaje explica por qué y propone una salida.
- Servicio no permitido o menor sin tutor: pasa a una persona.
- SMYL lento o caído: el asistente avisa que la clínica confirmará, sin inventar horarios.

## 6. Decisiones del dueño del producto
1. Nivel de autonomía inicial (1 o 2).
2. ¿Puede la IA crear el registro de un paciente nuevo?
3. Servicios que puede agendar sola.
4. Quién expone las herramientas del lado de LANA (este repo no contiene ese código).
5. Texto de consentimiento: el paciente debe saber que agenda un asistente de IA.
