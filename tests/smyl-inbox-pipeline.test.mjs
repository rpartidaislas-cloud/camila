import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const js = read('../smyl-inbox.js');
const css = read('../smyl-inbox.css');
const app = read('../app.html');
const worker = read('../sw.js');

test('Mensajes ofrece la vista Pipeline junto a Conversaciones y la recuerda', () => {
  assert.match(js, /data-inbox-view="list"/);
  assert.match(js, /data-inbox-view="pipeline"/);
  assert.match(js, /function setInboxView/);
  assert.match(js, /sessionStorage\.setItem\('smyl_inbox_view'/);
  assert.match(js, /classList\.toggle\('view-pipeline'/);
});

test('el pipeline agrupa por etapa de LANA y cambia la etapa con el mismo endpoint', () => {
  assert.match(js, /function pipelineColumns/);
  assert.match(js, /'Sin etapa'/);
  const move = js.slice(js.indexOf('async function moveConversationStage'), js.indexOf('function setInboxView'));
  assert.match(move, /action: 'stage'/);
  assert.match(move, /target_stage_id: stageId \|\| null/);
  assert.match(move, /conversation\.stage_id = previous/);
});

test('las tarjetas se mueven arrastrando o con «Mover a» y solo con permiso', () => {
  const card = js.slice(js.indexOf('function pipelineCard'), js.indexOf('function renderPipeline'));
  assert.match(card, /canOperate\(item, 'messages\.manage'\)/);
  assert.match(card, /card\.draggable = movable/);
  assert.match(card, /dragstart/);
  assert.match(card, /'Mover a'/);
  assert.match(card, /setInboxView\('list'\); openConversation\(item\.id\)/);
});

test('el pipeline no marca como leídas conversaciones que nadie abrió', () => {
  assert.match(js, /window\.innerWidth > 760 && state\.view !== 'pipeline'/);
});

test('el tablero es horizontal en escritorio y desliza por columna en celular', () => {
  assert.match(css, /\.smyl-inbox-pipeline-board\{[^}]*overflow-x:auto/);
  assert.match(css, /\.smyl-inbox-page\.view-pipeline \.smyl-inbox-workspace>:not\(dialog\)\{display:none\}/);
  assert.match(css, /scroll-snap-type:x mandatory/);
  assert.match(css, /@media\(hover:none\)\{\.smyl-inbox-pipeline-move\{display:grid\}/);
});

test('web, móvil y PWA publican el pipeline', () => {
  assert.equal(read('../mobile/www/smyl-inbox.js'), js);
  assert.equal(read('../mobile/www/smyl-inbox.css'), css);
  assert.match(app, /smyl-inbox\.js\?v=36/);
  assert.match(app, /smyl-inbox\.css\?v=34/);
  assert.match(worker, /smyl-inbox\.js\?v=36/);
  assert.match(worker, /smyl-inbox\.css\?v=34/);
});

test('sin canales conectados el Inbox muestra una sola explicación en lugar de lista, hilo y compositor vacíos', () => {
  const js = read('../smyl-inbox.js');
  const css = read('../smyl-inbox.css');
  assert.match(js, /function renderOffline\(host\)/);
  assert.match(js, /workspace\.dataset\.state = 'offline'/);
  assert.match(js, /Conecta tus canales para atender mensajes aquí/);
  assert.match(js, /window\.ir\('conexiones'\)/);
  assert.match(js, /replace\(\/\\bde LANA\\b\/g, 'del servicio de mensajería'\)/);
  assert.match(css, /#p-inbox \[hidden\]\{display:none!important\}/);
  assert.match(css, /\.smyl-inbox-workspace\[data-state="offline"\]>main/);
});
