import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('migración: enlaces cita↔concepto con RLS, permisos y estado «covered»', () => {
  const sql = read('supabase/migrations/20261201200000_smyl_appointment_quote_links.sql');
  assert.match(sql, /create table if not exists public\.smyl_appointment_quote_links/);
  assert.match(sql, /alter table public\.smyl_appointment_quote_links enable row level security/);
  assert.match(sql, /revoke all on public\.smyl_appointment_quote_links from public, anon, authenticated/);
  for (const f of ['smyl_appointment_quote_candidates', 'smyl_link_appointment_quote_item', 'smyl_unlink_appointment_quote_item', 'smyl_appointment_quote_links_for'])
    assert.match(sql, new RegExp(`grant execute on function public\\.${f}`));
  assert.match(sql, /schedule\.manage/);
  assert.match(sql, /then 'covered'/);
  assert.match(sql, /Inicia primero el tratamiento/);
  assert.doesNotMatch(sql, /grant execute[^;]*to anon/);
});

test('Agenda y Cobros usan el enlace y el estado «Cubierta por cotización»', () => {
  const schedule = read('smyl-schedule.js'), finance = read('smyl-finance.js');
  assert.match(schedule, /covered:\['Cubierta por cotización','paid'\]/);
  assert.match(schedule, /smyl_appointment_quote_candidates/);
  assert.match(schedule, /smyl_link_appointment_quote_item/);
  assert.match(finance, /smyl_appointment_quote_links_for/);
  assert.match(finance, /quoteLinks\|\|\[\]\)\.forEach\(function\(l\)\{closed\[l\.appointment_id\]=1/);
});

test('web, PWA y móvil publican la misma versión', () => {
  for (const f of ['smyl-schedule.js', 'smyl-schedule.css', 'smyl-finance.js', 'app.html', 'sw.js'])
    assert.equal(read(f), read('mobile/www/' + f), f);
  assert.match(read('app.html'), /smyl-schedule\.js\?v=70/);
  assert.match(read('sw.js'), /cita-cotizacion-v1/);
});
