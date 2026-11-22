/* SMYL · Mensaje de confirmación de cita, completo y ordenado.
   Arma el texto que una persona revisa y envía por el chat al confirmar una cita: cuándo, con quién, dónde (dirección, enlace de mapa y
   cómo llegar), qué hacer antes y un enlace «Agregar a mi calendario». No consulta ni escribe datos y nunca envía nada solo.
   Los enlaces no llevan datos del paciente: solo la cita (servicio, fecha, sucursal) que él mismo recibe en el mensaje. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SmylVisitMessage = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function clean(value, max) { return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 400); }

  // «Av. Juárez 120, Zapopan, Jalisco, 45050» a partir de las partes que existan.
  function addressOf(branch) {
    if (!branch) return '';
    return [branch.address_line, branch.city, branch.state, branch.postal_code].map(function (part) { return clean(part, 120); }).filter(Boolean).join(', ');
  }

  function mapsLink(address) {
    var text = clean(address, 300);
    return text ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(text) : '';
  }

  function stamp(iso) {
    var date = new Date(iso); if (!Number.isFinite(date.getTime())) return '';
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  }

  // Enlace de Google Calendar (abre el evento ya armado). Sin servidor y sin datos del paciente.
  function calendarLink(options) {
    var start = stamp(options.starts_at); if (!start) return '';
    var fallbackEnd = new Date(new Date(options.starts_at).getTime() + 3600000);
    var end = stamp(options.ends_at) || stamp(fallbackEnd.toISOString());
    if (!end) return '';
    var title = [clean(options.service, 80), clean(options.clinic || options.branch, 80)].filter(Boolean).join(' · ') || 'Cita dental';
    var params = ['action=TEMPLATE', 'text=' + encodeURIComponent(title), 'dates=' + start + '/' + end];
    if (options.address) params.push('location=' + encodeURIComponent(clean(options.address, 300)));
    return 'https://calendar.google.com/calendar/render?' + params.join('&');
  }

  function whenText(iso, timeZone) {
    var date = new Date(iso); if (!Number.isFinite(date.getTime())) return '';
    function format(zone) {
      var day = { weekday: 'long', day: 'numeric', month: 'long' }, time = { hour: 'numeric', minute: '2-digit', hour12: true };
      if (zone) { day.timeZone = zone; time.timeZone = zone; }
      var d = date.toLocaleDateString('es-MX', day).replace(/^(\S+?),\s*/, '$1 '), t = date.toLocaleTimeString('es-MX', time).replace(/\s+/g, ' ');
      return d.charAt(0).toUpperCase() + d.slice(1) + ', ' + t;
    }
    try { return format(timeZone); } catch (error) { return format(undefined); }
  }

  /* data: { firstName, slot: { starts_at, ends_at, professional_name, branch_name, timezone }, service: { name, prep_instructions },
             branch: { name, address_line, city, state, postal_code, phone, arrival_notes, timezone }, clinic }
     Devuelve { text, links: { maps, calendar }, sections } (sections sirve para pruebas y vista previa). */
  function build(data) {
    data = data || {}; var slot = data.slot || {}, branch = data.branch || {}, service = data.service || {};
    var zone = slot.timezone || branch.timezone;
    var address = addressOf(branch), maps = mapsLink(address);
    var calendar = calendarLink({ starts_at: slot.starts_at, ends_at: slot.ends_at, service: service.name, clinic: data.clinic, branch: slot.branch_name || branch.name, address: address });
    var name = clean(data.firstName, 40);
    var lines = [(name ? name + ', tu' : 'Tu') + ' cita quedó confirmada.', ''];
    var when = whenText(slot.starts_at, zone);
    if (when) lines.push('Cuándo: ' + when);
    if (service.name) lines.push('Servicio: ' + clean(service.name, 100));
    if (slot.professional_name) lines.push('Con: ' + clean(slot.professional_name, 100));
    var place = clean(slot.branch_name || branch.name, 100);
    if (place || address) lines.push('Dónde: ' + [place, address].filter(Boolean).join(' · '));
    if (maps) lines.push('Mapa: ' + maps);
    var arrival = clean(branch.arrival_notes, 300);
    if (arrival) lines.push('Cómo llegar: ' + arrival);
    var prep = clean(service.prep_instructions, 400);
    if (prep) { lines.push(''); lines.push('Antes de tu cita: ' + prep); }
    if (calendar) { lines.push(''); lines.push('Agrégala a tu calendario: ' + calendar); }
    var phone = clean(branch.phone, 40);
    lines.push(''); lines.push(phone ? 'Si necesitas cambiarla, respóndenos por aquí o llámanos al ' + phone + '.' : 'Si necesitas cambiarla, respóndenos por aquí.');
    return {
      text: lines.join('\n'),
      links: { maps: maps, calendar: calendar },
      sections: { when: when, address: address, arrival: arrival, prep: prep },
    };
  }

  return { build: build, addressOf: addressOf, mapsLink: mapsLink, calendarLink: calendarLink, whenText: whenText };
});
