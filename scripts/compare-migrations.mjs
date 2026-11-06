#!/usr/bin/env node
// Compara las migraciones del repo con las versiones registradas en producción (supabase_migrations.schema_migrations).
// Sólo lectura. Uso local con un volcado:  node scripts/compare-migrations.mjs aplicadas.json
// (aplicadas.json = ["20261012190000", ...]). En CI lo usa .github/workflows/smyl-migraciones-reconciliar.yml.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function versionDeArchivo(nombre) {
  const m = /^(\d{12,14})_.+\.sql$/.exec(nombre);
  return m ? m[1] : null;
}

// Clasifica cada archivo y cada versión aplicada. Los archivos sin versión numérica (camila_*.sql, stripe_billing.sql, …)
// son esquema base sin versionar: no se pueden comparar y se listan aparte.
export function reconciliar(archivos, aplicadas) {
  const repo = new Map();
  const sinVersion = [];
  for (const f of archivos) {
    const v = versionDeArchivo(f);
    if (v) repo.set(v, f); else if (f.endsWith('.sql')) sinVersion.push(f);
  }
  const aplicadasSet = new Set((aplicadas || []).map(String));
  const faltanEnProduccion = [...repo.keys()].filter((v) => !aplicadasSet.has(v)).sort().map((v) => ({ version: v, archivo: repo.get(v) }));
  const soloEnProduccion = [...aplicadasSet].filter((v) => !repo.has(v)).sort();
  const placeholders = [...repo.entries()].filter(([, f]) => /legacy_remote_placeholder/.test(f)).map(([v]) => v).sort();
  return { faltanEnProduccion, soloEnProduccion, placeholders, sinVersion: sinVersion.sort(), totalRepo: repo.size, totalAplicadas: aplicadasSet.size };
}

export function resumen(r) {
  const l = [];
  l.push(`Repo: ${r.totalRepo} migraciones versionadas · Producción: ${r.totalAplicadas} registradas · Placeholders legacy: ${r.placeholders.length}`);
  l.push(`En el repo y NO aplicadas en producción: ${r.faltanEnProduccion.length}`);
  r.faltanEnProduccion.forEach((x) => l.push(`  - ${x.version}  ${x.archivo}`));
  l.push(`Aplicadas en producción y SIN archivo en el repo: ${r.soloEnProduccion.length}`);
  r.soloEnProduccion.forEach((v) => l.push(`  - ${v}`));
  l.push(`Esquema base sin versión (no comparable): ${r.sinVersion.length}`);
  r.sinVersion.forEach((f) => l.push(`  - ${f}`));
  return l.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');
  const archivos = fs.readdirSync(dir);
  const aplicadas = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const r = reconciliar(archivos, aplicadas);
  console.log(resumen(r));
  process.exit(r.faltanEnProduccion.length || r.soloEnProduccion.length ? 1 : 0);
}
