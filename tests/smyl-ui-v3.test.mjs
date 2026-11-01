import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const template=read('smyl-ui-template-v3.css');
const directory=read('smyl-professional-directory.css');
const app=read('app.html');
const audit=read('docs/AUDITORIA_VISUAL_SMYL_2026-10-25.md');

test('SMYL UI v3 define una escala tipográfica cerrada y legible',()=>{
  for(const token of [
    '--smyl-ui-text-page','--smyl-ui-text-section','--smyl-ui-text-title',
    '--smyl-ui-text-body','--smyl-ui-text-body-sm','--smyl-ui-text-label','--smyl-ui-text-meta'
  ]) assert.match(template,new RegExp(token));
  const tiny=[...template.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/gi)]
    .filter(match=>Number(match[1])<12);
  assert.equal(tiny.length,0,'la plantilla nueva no debe introducir texto menor de 12 px');
});

test('la plantilla incluye los patrones operativos comunes',()=>{
  for(const component of [
    '.smyl-ui-page-header','.smyl-ui-tabs','.smyl-ui-card','.smyl-ui-field',
    '.smyl-ui-upload','.smyl-ui-button','.smyl-ui-notice','.smyl-ui-empty','.smyl-ui-list-item'
  ]) assert.match(template,new RegExp(component.replace('.','\\.')));
  assert.match(template,/prefers-reduced-motion/);
  assert.match(template,/focus-visible/);
  assert.match(template,/@media \(max-width: 42rem\)/);
});

test('Directorio profesional es el piloto y carga la nueva plantilla',()=>{
  assert.match(app,/smyl-ui-template-v3\.css\?v=6/);
  assert.match(directory,/SMYL UI v3 pilot/);
  assert.match(directory,/--directory-type-meta:var\(--smyl-ui-text-meta,12px\)/);
  assert.match(directory,/::file-selector-button/);
});

test('SMYL UI v3 gobierna el shell después de los estilos históricos',()=>{
  assert.match(app,/<body class="[^"]*smyl-ui-governed[^"]*">/);
  const governance=app.indexOf('smyl-ui-template-v3.css?v=6');
  assert.ok(governance>app.indexOf('smyl-professional-v3.css?v=7'));
  assert.ok(governance>app.indexOf('smyl-dialog-system.css?v=2'));
  assert.match(template,/Gobierno del panel · etapa 2/);
  assert.match(template,/body\.smyl-ui-governed \.sidebar \.nav-item/);
  assert.match(template,/body\.smyl-ui-governed \.layout \.fg :is\(input, select, textarea\)/);
  assert.match(template,/body\.smyl-ui-governed \.smyl-inbox-page/);
});

test('el sidebar adapta el patrón expandido y compacto leído desde Figma',()=>{
  assert.match(template,/Sidebar Figma · adaptación SMYL/);
  assert.match(template,/--smyl-sidebar-expanded:\s*16rem/);
  assert.match(template,/--smyl-sidebar-collapsed:\s*5\.5rem/);
  assert.match(template,/backdrop-filter:\s*blur\(24px\) saturate\(140%\)/);
  assert.match(template,/body\.smyl-ui-governed\.smyl-management-v3\.smyl-sidebar-collapsed \.sidebar/);
  assert.match(template,/--smyl-ui-primary:\s*#0b1b2e/);
  assert.match(template,/\.pro-nav-flyout/);
  assert.match(template,/content:\s*attr\(data-tooltip\)/);
});

test('la política v3.2 gobierna también los módulos heredados y el Inicio',()=>{
  for(const alias of ['--color-primary:','--azul:','--violeta:','--bg:','--radius:']) {
    assert.match(template,new RegExp(alias));
  }
  assert.match(template,/:is\(#smyl-daily-home, \.daily-home\) \.daily-home-hero/);
  assert.match(template,/:is\(#smyl-daily-home, \.daily-home\) \.daily-home-metrics/);
  assert.match(template,/\.sidebar \.sb-user :is\(\.plan-chip, \.uso-wrap\).*display:\s*none !important/);
  assert.match(app,/class="smyl-sidebar-quick"/);
});

test('la deuda tipográfica queda medida y no puede crecer silenciosamente',()=>{
  const files=fs.readdirSync(root).filter(name=>name.endsWith('.css')).map(name=>read(name));
  files.push(app);
  const tiny=files.flatMap(source=>[...source.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/gi)])
    .filter(match=>Number(match[1])<12);
  assert.ok(tiny.length<=888,`la deuda de microtexto subió de 888 a ${tiny.length}`);
  assert.match(audit,/2,202/);
  assert.match(audit,/40/);
  assert.match(audit,/888/);
});
