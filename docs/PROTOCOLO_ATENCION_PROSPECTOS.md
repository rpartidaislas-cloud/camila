# Protocolo de atención a prospectos de SMYL (dentistas) — del primer contacto a la clínica conectada a LANA

Versión 3 · 27 de noviembre de 2026 · Propuesta de trabajo. (v2: guía detallada de la conexión con Meta, sección 7.1. v3: cómo plantear el acceso a Facebook, sección 7.1.10.)
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
4. **WhatsApp → Conectar**, eligiendo el modo (exclusivo o coexistencia). Se abre la ventana de LANA con Embedded Signup. El dueño inicia sesión con Facebook, elige su Business y su número y acepta. **Guía detallada en la sección 7.1.**
5. Volver a SMYL y **verificar el estado**: debe decir «Mensajería activa» y mostrar el canal conectado.
6. Repetir para Messenger e Instagram si aplica.
7. **Capacitar el asistente**: identidad y voz, descripción de la clínica, sucursales, servicios, preguntas frecuentes y flujo de atención. Publicar y probar en el laboratorio privado antes de activar.
8. **Plantillas de WhatsApp** (Configuración → Plantillas): solicitar a Meta las del catálogo que usará (recordatorio de cita, confirmación, aviso de privacidad). Quedan pendientes hasta que Meta las apruebe.
9. **Prueba real** con el celular del dueño: un mensaje entrante, la respuesta del asistente, una cita agendada y una conversación que pase a una persona.
10. **Privacidad**: confirmar que el aviso de privacidad de la clínica queda completo (domicilio y correo) y explicar el consentimiento de WhatsApp de cada paciente.

**Criterio de salida:** canal conectado + asistente publicado + prueba real exitosa → `Conectado`.

### 7.1 Guía detallada: conectar a la clínica con Meta

Meta cambia sus pantallas y requisitos con frecuencia. Esta guía describe el recorrido general y lo que muestra SMYL; **lo marcado «verificar» debe confirmarse con LANA o en la documentación vigente de Meta antes de prometérselo al dentista.**

#### 7.1.1 Qué explicarle al dentista (1 minuto)
- **Business Portfolio** (la «cuenta empresarial» de Meta): es la que posee los activos de la clínica. Debe ser de la clínica, no de una agencia.
- **Cuenta de WhatsApp Business (WABA)**: la cuenta de WhatsApp de la clínica dentro de ese portfolio; contiene el número.
- **LANA** es el socio tecnológico (Tech Provider) autorizado por Meta para operar los canales; SMYL **no recibe ni guarda las claves de Meta**. Verificar con LANA qué permisos recibe y cómo puede la clínica revocarlos, para contestarlo con exactitud.

#### 7.1.2 Antes de abrir la ventana (verificar en vivo)
- [ ] El navegador **permite ventanas emergentes**: la conexión se abre en una ventana aparte; si se bloquea, SMYL lo avisa.
- [ ] Mejor desde **computadora**, con el celular a la mano para códigos y, en coexistencia, para escanear.
- [ ] La persona está iniciada en Facebook con la cuenta que **administra** el Business Portfolio. Las cuentas de Facebook nuevas o con restricciones suelen dar problemas (verificar).
- [ ] Conectó **el dueño** de la clínica en SMYL (el equipo puede ver el estado, pero no conectar).
- [ ] Decidió el modo (7.1.3 o 7.1.4).

#### 7.1.3 Modo A: «Conservar mi WhatsApp» (coexistencia, en beta)
Lo que SMYL le muestra al dentista **antes** de abrir Meta:
- Necesita la app **WhatsApp Business** actualizada.
- Grupos y llamadas siguen **solo en el celular**.
- Los chats anteriores **no se importan todavía**; los mensajes nuevos sí llegan a SMYL.
- Responder desde el celular **pausa al asistente** en esa conversación.

Pasos:
1. En SMYL: Configuración → Canales → WhatsApp → **«Conectar mi número actual»**.
2. En la ventana de Meta: iniciar sesión, elegir o crear el Business Portfolio.
3. Meta pide vincular la app WhatsApp Business del celular (normalmente escaneando un código QR) y aceptar permisos (verificar el flujo vigente).
4. Volver a SMYL y comprobar el estado: debe decir **«WhatsApp + SMYL»**, y el historial «no se importa todavía».
5. Recordarle: mantener la app WhatsApp Business activa en el celular; Meta exige uso periódico para conservar el enlace (verificar el plazo con LANA).

#### 7.1.4 Modo B: «Usar un número exclusivo»
Lo que SMYL le muestra antes de abrir Meta:
- El número debe estar **libre de WhatsApp y de WhatsApp Business**.
- Si ya está en una app, la migración puede **perder su historial local**.
- Se recomienda una **línea nueva** para este modo.

Pasos:
1. En SMYL: **«Conectar número nuevo»**.
2. En la ventana de Meta: crear o elegir la cuenta de WhatsApp Business (WABA) dentro del portfolio.
3. Escribir el número y **verificarlo** con el código por SMS o llamada.
4. Elegir el **nombre para mostrar**. Meta lo revisa: debe corresponder al nombre real de la clínica o del profesional. Puede quedar en revisión unos días.
5. Aceptar los términos y volver a SMYL. Estado esperado: **«Sólo SMYL»**.

#### 7.1.5 Messenger e Instagram (si los usa)
- **Messenger:** quien conecta debe ser **administrador con control total** de la Página de Facebook.
- **Instagram:** la cuenta debe ser **profesional** (Empresa o Creador) y estar **vinculada a la Página** de Facebook. En la configuración de mensajes de Instagram debe permitirse el acceso de herramientas conectadas (verificar la ruta vigente en la app de Instagram).
- En SMYL: **Conectar** en cada canal → elegir Página o cuenta → autorizar los permisos de mensajes.

#### 7.1.6 Después de conectar: verificaciones
- [ ] El estado de la conexión dice **«Mensajería activa»** y el canal muestra nombre y número.
- [ ] Un mensaje de prueba **desde otro teléfono** llega a la bandeja de SMYL.
- [ ] El asistente responde y, cuando se le pide una persona, **escala**.
- [ ] En coexistencia: una respuesta enviada desde el celular aparece en SMYL y pausa al asistente en esa conversación.
- [ ] Plantillas solicitadas a Meta (quedan «pendientes» hasta su aprobación).

#### 7.1.7 Límites y costos de Meta: decidir antes de ofrecerlo
- **Verificación del negocio de la clínica:** no siempre es necesaria para empezar, pero influye en los límites de mensajes iniciados por la clínica (verificar con LANA). Definir cuándo se recomienda hacerla.
- **Calidad del número:** si muchos pacientes bloquean o reportan los mensajes, Meta puede limitarlo. Por eso solo se escribe a quien dio su consentimiento de WhatsApp.
- **Costos:** Meta cobra los mensajes de plantilla según su tarifa vigente. **Decidir quién los paga** (método de pago de la propia cuenta de WhatsApp de la clínica o facturación a través de LANA) e incluirlo en la propuesta, para que el dentista no se sorprenda.

#### 7.1.8 Fallas típicas de la conexión con Meta

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| La ventana no abre o se queda en blanco | Ventanas emergentes bloqueadas | Permitirlas para SMYL y reintentar |
| No aparece su Business Portfolio | La cuenta de Facebook no es administradora | Que el administrador lo agregue o conecte con él presente |
| «El número ya está registrado» | Está en WhatsApp, WhatsApp Business u otra cuenta | Elegir coexistencia, o liberar el número advirtiendo la posible pérdida de historial local |
| No llega el código de verificación | Línea sin señal o reintentos seguidos | Probar llamada de voz y esperar; no reintentar muchas veces seguidas (puede bloquearse temporalmente) |
| Nombre para mostrar rechazado | No corresponde al negocio | Ajustarlo al nombre real de la clínica y reenviar |
| Meta pide verificar identidad o negocio | Revisión de seguridad de Meta | Completarla con los documentos de la clínica; escalar a LANA si se atora |
| Conectó pero no llegan mensajes | Webhook o canal equivocado | Verificar el estado en SMYL; escalar a LANA |
| Estado «Requiere atención» | Falló la validación de la conexión | Verificar de nuevo; si persiste, escalar a LANA |
| Instagram no aparece | Cuenta no profesional o sin Página vinculada | Convertirla a profesional y vincularla a la Página |

#### 7.1.9 Seguridad durante la conexión
- El dentista escribe contraseñas y códigos **solo en la ventana de Meta**. Nunca se piden por chat, llamada ni correo.
- Si se comparte pantalla, **no grabar** el momento de los códigos.
- Ningún dato de pacientes se maneja en la sesión de conexión.

#### 7.1.10 Cómo plantear el acceso a Facebook sin ser invasivos

**Principio:** nunca accedemos a la cuenta de Facebook del dentista. Él inicia sesión **dentro de la ventana de autorización de Meta**, elige qué quiere conectar y qué permisos concede. Nosotros no recibimos su contraseña, ni sus códigos, ni su perfil personal.

**Cuándo decirlo:** desde la **demo** (etapa 3), no el día de la sesión. Incluirlo también en la lista de preparación (sección 6), para que nada lo tome por sorpresa.

**Guion sugerido:**
> Dr./Dra., no necesitamos tu usuario ni tu contraseña de Facebook, y nunca te los vamos a pedir. Meta te muestra su propia pantalla de autorización: ahí inicias sesión tú, eliges la cuenta de WhatsApp (o la Página) de la clínica que quieres conectar y ves qué permisos das. Solo se conectan los mensajes de esa cuenta de la clínica; no tu perfil personal ni tus mensajes personales. Puedes quitar el acceso cuando quieras desde la configuración de tu empresa en Meta. Si prefieres, lo haces tú solo y nosotros te guiamos.

> **Verificar con LANA** los permisos exactos que solicita su app y la ruta para revocarlos, antes de decir esto literalmente.

**Tres formas de acompañar (que él elija):**
1. **Guía por escrito o video**, y lo hace solo.
2. **Llamada guiada sin compartir pantalla:** nosotros indicamos el paso y él ejecuta.
3. **Compartiendo pantalla, solo si él lo pide.** Se pausa o se deja de compartir al escribir contraseñas o códigos.

**Lo que NO se pide nunca:**
- Su contraseña de Facebook, de Instagram o de WhatsApp.
- Los códigos de verificación o de dos pasos.
- Que nos agregue como administradores de su Business Portfolio, ni que nos «preste» su cuenta personal. (Confirmar con LANA si su flujo necesita algún acceso de socio; si no lo necesita, no se pide.)

**Para que se sienta en control:**
- Leer **juntos** la pantalla de permisos de Meta antes de que acepte.
- Después de conectar, enviarle por correo un **resumen por escrito**: qué se conectó, qué permisos se dieron y cómo revocarlos.
- Recordarle que el asistente solo trabaja con la cuenta que él conectó y que puede **desconectar el canal** desde Configuración → Canales.

**Si el dentista dice «no me siento cómodo»:** no insistir. Ofrecer otra modalidad de acompañamiento, o que la conexión la haga la persona de su confianza que administra su Business. Registrar el motivo en el estado del prospecto.

**Sobre los pacientes:** ellos **no dan acceso a nada**. Solo escriben al número o a la Página de la clínica, como a cualquier negocio. Lo que sí debe existir es el aviso de privacidad de la clínica, que ya menciona a Meta y a LANA como proveedores, y el consentimiento de WhatsApp de cada paciente.

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
3. **Validar con LANA** todo lo marcado «verificar» en la sección 7.1 (requisitos de coexistencia y de número exclusivo, permisos que recibe LANA y su revocación, plazo de uso de la app Business) y mantenerlo al día.
4. **Decidir el cobro de los mensajes de plantilla** de Meta (sección 7.1.7) y reflejarlo en la propuesta.
5. **Probar el protocolo completo con una primera clínica** y ajustarlo con lo que salga.
