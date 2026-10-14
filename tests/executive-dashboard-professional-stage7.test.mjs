import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../app.html');
const script = read('../smyl-reports.js');
const styles = read('../smyl-reports.css');
const worker = read('../sw.js');

test('dirección recibe prioridades verificables y accesos al módulo responsable', () => {
  assert.match(script, /RESUMEN PARA DIRECCIÓN/);
  assert.match(script, /prioridades verificables/);
  assert.match(script, /ninguna acción se ejecuta desde este tablero/);
  for (const route of ['caja', 'agenda', 'inventario']) {
    assert.match(script, new RegExp(`route:'${route}'`));
  }
  assert.match(styles, /\.reports-brief-list/);
});

test('el tablero permite periodos rápidos y tendencias según permisos', () => {
  for (const days of ['7', '30', '90']) {
    assert.match(script, new RegExp(`data-report-days=\\"${days}\\"`));
  }
  assert.match(script, /data-chart-mode="finance"/);
  assert.match(script, /data-chart-mode="schedule"/);
  assert.match(script, /if\(state\.chartMode==='finance'&&!c\.finance\)/);
  assert.match(script, /if\(state\.chartMode==='schedule'&&!c\.schedule\)/);
});

test('la lectura ejecutiva no confunde actividad con calidad u ocupación', () => {
  assert.match(script, /Actividad agendada no equivale a ocupación de sillones/);
  assert.match(script, /no mide resultado clínico/);
  assert.match(script, /no es evaluación de desempeño ni calidad/);
  assert.match(script, /No es una cohorte ni mide resultados clínicos/);
});

test('web, móvil y PWA publican la etapa siete sincronizada', () => {
  assert.equal(app, read('../mobile/www/app.html'));
  assert.equal(script, read('../mobile/www/smyl-reports.js'));
  assert.equal(styles, read('../mobile/www/smyl-reports.css'));
  assert.match(app, /smyl-reports\.js\?v=3/);
  assert.match(app, /smyl-reports\.css\?v=3/);
  assert.match(worker, /smyl-v225-inbox-report/);
  assert.match(worker, /smyl-reports\.js\?v=3/);
  assert.match(worker, /smyl-reports\.css\?v=3/);
});
