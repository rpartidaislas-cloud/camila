/* SMYL · Varios consultorios — Fase 2: consultorio activo y selector.
 *
 * Qué hace: muestra bajo el logo el consultorio que se está administrando y deja cambiar entre los que la persona puede ver
 * (las sedes salen de la función smyl_my_branches(), que ya aplica su rol y su alcance). Quien tiene el permiso
 * `branches.all` (administrador global) además puede elegir «Todos los consultorios».
 *
 * Importante: esto es SELECCIÓN, no seguridad. Filtra lo que se muestra; quién puede leer qué lo decide la base de datos
 * (Fase 3). Con un solo consultorio no aparece nada y no se filtra nada: la clínica se ve exactamente igual que antes.
 *
 * Cómo filtra: los módulos consultan con window.sb.from(tabla).select(...). Aquí se envuelve `select` solo para las tablas con
 * sede, así agenda, cobros y caja muestran solo el consultorio activo sin reescribir cada consulta. La elección se guarda en
 * localStorage y se lee de forma síncrona, para que ninguna consulta salga sin filtro mientras la sesión termina de cargar.
 */
(function (root, factory) {
  var model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model; else root.SmylBranchScope = model;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // `root` es parámetro del envoltorio UMD y no existe dentro de esta función: sin esta línea, init() y el resto lanzaban
  // «root is not defined» en cuanto había clínica (visto con conexión lenta, justo después de iniciar sesión).
  var root = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this);

  var ALL = 'all';
  var STORE_PREFIX = 'smyl-active-branch:';
  // Tablas operativas que llevan sede. `nulls`: la sede es opcional, así que los registros sin sede se siguen viendo.
  var SCOPED_TABLES = {
    smyl_appointments: { nulls: false },
    smyl_finance_payments: { nulls: false },
    smyl_cash_sessions: { nulls: false },
    smyl_finance_charges: { nulls: true },
    smyl_proposals: { nulls: true }
  };

  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var state = { tenant: null, branches: [], canAll: false, active: null, ready: false, installed: false };

  // Elige el consultorio activo: lo guardado si sigue siendo válido; si no, el principal de la persona, la sede predeterminada
  // o la primera disponible. «Todos» solo existe para quien tiene `branches.all`.
  function pickActive(branches, canAll, saved) {
    var list = Array.isArray(branches) ? branches : [];
    if (!list.length) return null;
    if (saved === ALL) return canAll && list.length > 1 ? ALL : fallback(list);
    if (saved && list.some(function (b) { return b.branch_id === saved; })) return saved;
    return fallback(list);
  }
  function fallback(list) {
    var pick = list.find(function (b) { return b.is_primary; }) || list.find(function (b) { return b.is_default; }) || list[0];
    return pick.branch_id;
  }

  // ¿Cómo se filtra esta tabla con el consultorio activo? null = no se filtra.
  function scopeRule(table, active) {
    if (!active || active === ALL || !UUID_RE.test(String(active))) return null;
    var cfg = SCOPED_TABLES[table];
    if (!cfg) return null;
    return cfg.nulls
      ? { type: 'or', value: 'branch_id.eq.' + active + ',branch_id.is.null' }
      : { type: 'eq', column: 'branch_id', value: active };
  }
  function applyRule(builder, rule) {
    if (!rule || !builder) return builder;
    return rule.type === 'or' ? builder.or(rule.value) : builder.eq(rule.column, rule.value);
  }

  function storeKey(tenant) { return STORE_PREFIX + tenant; }
  function readSaved(tenant) {
    try { return tenant ? root.localStorage.getItem(storeKey(tenant)) : null; } catch (e) { return null; }
  }
  function writeSaved(tenant, value) {
    try { if (tenant) root.localStorage.setItem(storeKey(tenant), value); } catch (e) {}
  }

  // Envuelve sb.from para que select() de las tablas con sede salga ya filtrado. Insert/update/delete/rpc no se tocan.
  function install(sb) {
    if (!sb || state.installed || typeof sb.from !== 'function') return;
    var original = sb.from.bind(sb);
    sb.from = function (table) {
      var builder = original(table);
      if (!SCOPED_TABLES[table] || !builder || typeof builder.select !== 'function') return builder;
      var select = builder.select.bind(builder);
      builder.select = function () {
        var out = select.apply(null, arguments);
        return applyRule(out, scopeRule(table, state.active));
      };
      return builder;
    };
    state.installed = true;
  }

  function label(active) {
    if (active === ALL) return 'Todos los consultorios';
    var b = state.branches.find(function (x) { return x.branch_id === active; });
    return b ? b.name : '';
  }

  function render() {
    var host = root.document && root.document.getElementById('sb-branch-scope');
    if (host && host.parentNode) host.parentNode.removeChild(host);
    var show = state.branches.length > 1;
    if (root.document && root.document.body) root.document.body.classList.toggle('branch-scope-all', state.active === ALL);
    if (!show || !root.document) return;
    var logo = root.document.querySelector('.sb-logo');
    if (!logo) return;
    var box = root.document.createElement('div');
    box.id = 'sb-branch-scope';
    box.className = 'sb-branch';
    var title = root.document.createElement('label');
    title.setAttribute('for', 'sb-branch-select');
    title.textContent = 'Consultorio';
    var select = root.document.createElement('select');
    select.id = 'sb-branch-select';
    select.setAttribute('aria-label', 'Consultorio que administras');
    state.branches.forEach(function (b) {
      var o = root.document.createElement('option'); o.value = b.branch_id; o.textContent = b.name; select.appendChild(o);
    });
    if (state.canAll) {
      var all = root.document.createElement('option'); all.value = ALL; all.textContent = 'Todos (vista global)'; select.appendChild(all);
    }
    select.value = state.active;
    select.onchange = function () { choose(select.value); };
    box.appendChild(title); box.appendChild(select);
    logo.parentNode.insertBefore(box, logo.nextSibling);
  }

  // Cambiar de consultorio recarga la página: cada módulo guarda en memoria lo que cargó y así todos quedan en el mismo consultorio.
  function choose(value) {
    if (value !== ALL && !state.branches.some(function (b) { return b.branch_id === value; })) return;
    if (value === ALL && !state.canAll) return;
    writeSaved(state.tenant, value);
    state.active = value;
    try { root.dispatchEvent(new root.CustomEvent('smyl:branch-change', { detail: { branch: value, label: label(value) } })); } catch (e) {}
    if (root.location && typeof root.location.reload === 'function') root.location.reload();
  }

  async function refresh() {
    var sb = root.sb;
    if (!sb || typeof sb.rpc !== 'function' || !state.tenant) return;
    var res = await sb.rpc('smyl_my_branches');
    if (res.error) return;
    var rows = res.data || [];
    state.branches = rows;
    state.canAll = rows.some(function (r) { return r.can_all; });
    var saved = readSaved(state.tenant);
    var next = pickActive(rows, state.canAll, saved);
    var multi = rows.length > 1;
    // Con un solo consultorio (o ninguno visible) no se filtra nada: la clínica se ve igual que antes.
    state.active = multi ? next : null;
    state.ready = true;
    if (multi && next !== saved) writeSaved(state.tenant, next);
    render();
    // Primera vez con varios consultorios (o lo guardado ya no es válido): se recarga una vez para que todo salga filtrado.
    // Ya quedó guardado lo elegido, así que no hay ciclo.
    // Solo si la elección se pudo guardar y releer: con el almacenamiento bloqueado (modo privado, algunos WebView) recargar daría un bucle.
    if (multi && saved !== next && readSaved(state.tenant) === next && root.location && typeof root.location.reload === 'function') root.location.reload();
  }

  // Se llama justo después de resolver la clínica de la sesión. La parte síncrona deja el filtro listo con lo guardado.
  function init() {
    state.tenant = root.tenantId || null;
    if (!state.tenant) return Promise.resolve();
    var saved = readSaved(state.tenant);
    state.active = saved && (saved === ALL || UUID_RE.test(saved)) ? saved : null;
    install(root.sb);
    return refresh().catch(function () {});
  }

  return {
    ALL: ALL, SCOPED_TABLES: SCOPED_TABLES,
    pickActive: pickActive, scopeRule: scopeRule, applyRule: applyRule,
    install: install, init: init, choose: choose,
    get: function () { return state.active; },
    isAll: function () { return state.active === ALL; },
    branches: function () { return state.branches.slice(); },
    _state: state
  };
});
