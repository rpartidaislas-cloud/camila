# Accesibilidad, dispositivos y despliegue gradual

## Puertas antes de ampliar producción

1. Flujo completo sin errores en 390×844, 820×1180 y 1440×900.
2. Navegación por teclado con foco visible en acceso, VITA, captura y editor.
3. Zoom del sistema permitido sin perder acciones esenciales.
4. Movimiento reducido respetado; ningún paso depende solo de una animación.
5. Estados de espera, éxito y error anunciados como texto, no solo por color.
6. Prueba real en Safari/iPhone y Chrome/Android para cámara, galería y retorno.
7. Sin claves, datos identificables ni fotografías clínicas en artefactos.

## Matriz mínima

| Entorno | Comprobación |
|---|---|
| iPhone Safari | Permisos, cuadrícula, seis pasos, fondo/primer plano, retorno de cámara |
| Android Chrome | Captura/galería, rotación, reanudación y teclado |
| Tablet | VITA, editor, paneles y gestos sin controles fuera de pantalla |
| Escritorio | Tab/Shift+Tab, Enter/Espacio, foco visible y zoom 200% |
| Red lenta | Feedback inmediato, timeout comprensible y reintento manual |

## Despliegue gradual

- **Interno:** casos sintéticos; logs y telemetría, sin pacientes.
- **Piloto:** 2–3 profesionales, máximo 10 casos autorizados por semana.
- **Limitado:** 10% de clínicas, con rollback documentado.
- **General:** solo tras dos semanas sin regresiones críticas.

Bloquean el avance: botón sin feedback, acción inaccesible con teclado/zoom,
pérdida de fotos, cambio de identidad, desalineación o incremento no explicado
de costo/error. Cada versión publicada debe registrar SHA, fecha, función Edge
y versión de caché para poder volver al último estado aprobado.

## Evidencia local — 2026-08-15

Validación por HTTP local de `simulacion.html`, sin fotografías y sin llamadas
a proveedores de IA:

| Tamaño | Resultado |
|---|---|
| 390×844 | Sin desbordamiento horizontal; acceso visible; zoom del navegador habilitado |
| 820×1180 | Sin desbordamiento horizontal |
| 1440×900 | Sin desbordamiento horizontal |

- El `viewport` permite escala hasta 5× y conserva `user-scalable=yes`.
- La interfaz respeta la preferencia de movimiento reducido.
- La pantalla de acceso expone diálogo, pestañas, campos y acción principal
  con semántica accesible.
- No se registraron errores ni advertencias de consola durante la carga y los
  cambios de tamaño.

Esta evidencia **no sustituye** las pruebas físicas pendientes en Safari/iPhone
y Chrome/Android: permisos reales, cámara, galería, rotación, retorno desde la
cámara, captura de los seis pasos y reanudación tras segundo plano.
