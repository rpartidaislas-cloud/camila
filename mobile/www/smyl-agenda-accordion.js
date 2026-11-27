/* SMYL · Agenda → Horarios y servicios: secciones plegables.
   Cada tarjeta de la pestaña (Servicios, Horario de tu equipo, Mensajes automáticos, Agenda con IA) se puede plegar; plegada deja una sola fila con un
   resumen («5 profesionales · 2 sin horario», «2 de 4 activos»…) para ver todo sin hacer scroll. El estado se recuerda por clínica y dispositivo.
   No cambia lo que hace cada tarjeta: solo agrega un botón al encabezado y oculta el cuerpo con CSS, así que sobrevive a que cada módulo repinte su contenido.
   Solo aplica dentro de la pestaña: la misma tarjeta incrustada en Configuración se ve siempre abierta. */
(function () {
  'use strict';

  var GRID = '#p-agenda [data-schedule-panel="settings"] .schedule-settings-grid';

  function storageKey() { return 'smyl_agenda_sections_' + (window.tenantId || ''); }
  function readState() { try { return JSON.parse(window.localStorage.getItem(storageKey()) || '{}') || {}; } catch (_) { return {}; } }
  function writeState(map) { try { window.localStorage.setItem(storageKey(), JSON.stringify(map)); } catch (_) {} }
  function keyOf(card) { return card.id || (card.querySelector('[id]') || {}).id || ''; }
  function titleOf(card) { var h = card.querySelector('.schedule-section-title h2'); return h ? h.textContent.trim() : 'sección'; }

  function setOpen(card, open, remember) {
    card.dataset.collapsed = open ? 'false' : 'true';
    var toggle = card.querySelector(':scope > .schedule-section-title > .sc-toggle');
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', (open ? 'Ocultar ' : 'Mostrar ') + titleOf(card));
    }
    if (remember) {
      var key = keyOf(card); if (!key) return;
      var map = readState(); map[key] = open; writeState(map);
    }
  }

  function updateChip(card) {
    var chip = card.querySelector(':scope > .schedule-section-title > .sc-toggle .sc-chip');
    if (!chip) return;
    var text = card.dataset.summary || '';
    chip.textContent = text; chip.hidden = !text;
    chip.dataset.tone = card.dataset.summaryTone || '';
  }

  function enhance(card) {
    var title = card.querySelector(':scope > .schedule-section-title');
    if (!title || card.dataset.acc === '1') return;
    card.dataset.acc = '1';
    var toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'sc-toggle';
    var chip = document.createElement('span'); chip.className = 'sc-chip'; chip.hidden = true;
    var chevron = document.createElement('span'); chevron.className = 'sc-chevron'; chevron.setAttribute('aria-hidden', 'true');
    toggle.append(chip, chevron); title.append(toggle);
    var saved = readState()[keyOf(card)];
    setOpen(card, saved === true, false);
    toggle.addEventListener('click', function () { setOpen(card, card.dataset.collapsed === 'true', true); });
    // Todo el encabezado es tocable (salvo sus propios botones), para que sea fácil en el celular.
    title.addEventListener('click', function (event) {
      if (event.target.closest('button, a, input, select, textarea, label')) return;
      setOpen(card, card.dataset.collapsed === 'true', true);
    });
    new MutationObserver(function () { updateChip(card); }).observe(card, { attributes: true, attributeFilter: ['data-summary', 'data-summary-tone'] });
    updateChip(card);
  }

  function toolbar(grid) {
    if (grid.previousElementSibling && grid.previousElementSibling.classList.contains('sc-toolbar')) return;
    var bar = document.createElement('div'); bar.className = 'sc-toolbar';
    function all(open) {
      var map = readState();
      grid.querySelectorAll(':scope > .schedule-card[data-acc="1"]').forEach(function (card) { setOpen(card, open, false); var key = keyOf(card); if (key) map[key] = open; });
      writeState(map);
    }
    [['Expandir todo', true], ['Contraer todo', false]].forEach(function (item) {
      var button = document.createElement('button'); button.type = 'button'; button.className = 'sc-toolbar-action'; button.textContent = item[0];
      button.addEventListener('click', function () { all(item[1]); }); bar.append(button);
    });
    grid.before(bar);
  }

  function scan() {
    var grid = document.querySelector(GRID); if (!grid) return false;
    grid.classList.add('sc-accordion');
    grid.querySelectorAll(':scope > .schedule-card').forEach(enhance);
    toolbar(grid);
    return true;
  }

  function init() {
    var tries = 0;
    (function wait() {
      var grid = document.querySelector(GRID);
      if (grid) {
        scan();
        // Las demás tarjetas (mensajes automáticos, Agenda con IA) se montan después: se pliegan al aparecer.
        new MutationObserver(scan).observe(grid, { childList: true });
      } else if (tries++ < 80) setTimeout(wait, 250);
    })();
    var previous = window.ir;
    if (typeof previous === 'function') {
      window.ir = function (route) { var result = previous.apply(this, arguments); if (route === 'agenda') setTimeout(scan, 0); return result; };
    }
  }

  window.SmylAgendaAccordion = Object.freeze({ scan: scan });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
