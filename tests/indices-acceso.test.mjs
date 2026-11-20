import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../supabase/migrations/20261122090000_smyl_indices_acceso.sql', import.meta.url), 'utf8');

test('los índices nuevos son aditivos e idempotentes: no tocan datos, políticas ni funciones', () => {
  const sentencias = sql.replace(/--.*$/gm, '').split(';').map((x) => x.trim()).filter(Boolean);
  for (const s of sentencias) assert.match(s, /^(begin|commit|create index if not exists [a-z_0-9]+\s+on public\.[a-z_]+)/, s.slice(0, 60));
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /\b(drop|delete|update|alter|grant|revoke|insert)\b/i);
});

test('cada índice cubre una columna realmente usada y existe en el esquema', () => {
  const schema = fs.readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter((f) => f.endsWith('.sql')).map((f) => fs.readFileSync(new URL('../supabase/migrations/' + f, import.meta.url), 'utf8')).join('\n');
  for (const [tabla, columnas] of [['smyl_radiograph_report_addenda', ['report_id', 'created_at']], ['mila_recordings', ['retention_until']], ['mila_tool_calls', ['session_id']], ['mila_clinical_notes', ['paciente_id']]]) {
    const def = schema.match(new RegExp('create table (?:if not exists )?(?:public\\.)?' + tabla + '[ (][\\s\\S]*?\\n\\);'))[0];
    for (const c of columnas) assert.match(def, new RegExp('\\b' + c + '\\b'), tabla + '.' + c);
  }
});

test('la versión de la migración es única', () => {
  const versions = fs.readdirSync(new URL('../supabase/migrations/', import.meta.url)).map((f) => f.split('_')[0]);
  assert.equal(versions.filter((v) => v === '20261122090000').length, 1);
});
