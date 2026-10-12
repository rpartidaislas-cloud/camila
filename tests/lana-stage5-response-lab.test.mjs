import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../app.html');
const connections = read('../smyl-connections.js');
const styles = read('../smyl-connections.css');
const contextEdge = read('../supabase/functions/lana-context/index.ts');
const trainingEdge = read('../supabase/functions/lana-training/index.ts');
const linked = read('../supabase/functions/_shared/lana-linked.ts');

test('SMYL includes a private assistant response laboratory with suggested clinical scenarios', () => {
  assert.match(connections, /LABORATORIO PRIVADO/);
  assert.match(connections, /Ningún mensaje sale de esta pantalla/);
  assert.match(connections, /Precio y horario/);
  assert.match(connections, /Dolor y urgencia/);
  assert.match(connections, /Foto y diagnóstico/);
  assert.match(styles, /connections-preview-chat/);
  assert.match(app, /smyl-connections\.js\?v=9/);
});

test('preview stays in browser memory and labels human escalation', () => {
  assert.match(connections, /previewHistory/);
  assert.match(connections, /historyForRequest/);
  assert.match(connections, /requires_human/);
  assert.match(connections, /Requiere intervención humana/);
  assert.match(connections, /Usa datos ficticios\. La prueba consume IA del plan y no se guarda como conversación/);
  assert.doesNotMatch(connections, /localStorage|sessionStorage/);
});

test('authenticated owner-only edge forwards previews to LANA with a bounded timeout', () => {
  assert.match(trainingEdge, /req\.method !== "GET"/);
  assert.match(trainingEdge, /`\/training\/\$\{String\(action\)\}`/);
  assert.match(trainingEdge, /Solo el dueño de la clínica puede modificar, publicar o probar/);
  assert.match(trainingEdge, /action === "preview" \? 30000 : 12000/);
  assert.match(contextEdge, /"\/context\/preview"/);
  assert.match(linked, /timeoutMs = 12000/);
  assert.match(linked, /setTimeout\(\(\) => controller\.abort\(\), timeoutMs\)/);
});
