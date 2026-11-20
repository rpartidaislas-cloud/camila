import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let chromium = null;
try { ({ chromium } = require('playwright')); } catch (e) { chromium = null; }
const fixture = 'file://' + fileURLToPath(new URL('./fixtures/smyl-select-menu-preview.html', import.meta.url));
const skip = chromium ? false : 'Playwright/Chromium no disponible';

test('computadora: el selector del menú lateral abre el menú propio, marca la activa y cambia con clic', { skip }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(fixture);
    await page.click('#sb-branch-select');
    const menu = page.locator('.smyl-select-menu.is-dark');
    await menu.waitFor();
    assert.deepEqual(await menu.locator('.smyl-select-menu-label').allTextContents(), ['Circulo Medico Dental', 'Sucursal Centro', 'Sucursal Lomas Verdes', 'Sucursal Plaza Sol', 'Todos los consultorios']);
    assert.equal(await menu.locator('[aria-selected=true] .smyl-select-menu-label').textContent(), 'Sucursal Centro');
    assert.equal(await menu.locator('.smyl-select-menu-sep').count(), 1, 'separa la vista global');
    assert.equal(await menu.locator('.smyl-select-menu-badge').first().textContent(), 'C');
    const fs = await menu.locator('.smyl-select-menu-label').first().evaluate((n) => getComputedStyle(n).fontSize);
    assert.equal(fs, '13px');
    await menu.getByText('Todos los consultorios').click();
    assert.equal(await page.locator('.smyl-select-menu').count(), 0, 'se cierra al elegir');
    assert.equal(await page.inputValue('#sb-branch-select'), 'all');
    assert.deepEqual(await page.evaluate(() => window.changes), ['sb-branch-select=all']);
    await page.click('#sb-branch-select');
    await page.mouse.click(900, 700);
    assert.equal(await page.locator('.smyl-select-menu').count(), 0, 'clic fuera lo cierra');
  } finally { await browser.close(); }
});

test('computadora: filtros de Agenda compactos, con búsqueda y teclado; los demás selectores no cambian', { skip }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(fixture);
    assert.equal(await page.locator('#schedule-branch').evaluate((n) => getComputedStyle(n).fontSize), '13px');
    assert.equal(await page.locator('#otro').evaluate((n) => getComputedStyle(n).fontSize), '16px');
    await page.focus('#schedule-branch');
    await page.keyboard.press('Enter');
    const menu = page.locator('.smyl-select-menu:not(.is-dark)');
    await menu.waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.className), 'smyl-select-menu-search', '7 opciones: aparece el buscador');
    assert.equal(await menu.locator('.smyl-select-menu-label').first().textContent(), 'Todas las sucursales', 'la global va arriba si ya iba arriba');
    await page.keyboard.type('lomas');
    assert.deepEqual(await menu.locator('.smyl-select-menu-label').allTextContents(), ['Sucursal Lomas Verdes']);
    await page.keyboard.press('Enter');
    assert.equal(await page.inputValue('#schedule-branch'), 'b3');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'schedule-branch', 'regresa el foco');
    await page.keyboard.press('ArrowDown');
    await menu.waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.smyl-select-menu').count(), 0);
    assert.equal(await page.inputValue('#schedule-branch'), 'b3', 'Escape no cambia nada');
    await page.click('#schedule-room');
    assert.equal(await page.locator('.smyl-select-menu .smyl-select-menu-search').count(), 0, 'pocas opciones: sin buscador');
    assert.equal(await page.locator('.smyl-select-menu .smyl-select-menu-badge:not(.is-global)').count(), 0, 'sillones sin iniciales');
  } finally { await browser.close(); }
});

test('celular: no intercepta, se usa el selector del sistema y conserva 16 px', { skip }, async () => {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await page.goto(fixture);
    assert.equal(await page.locator('#schedule-branch').evaluate((n) => getComputedStyle(n).fontSize), '16px');
    await page.locator('#schedule-branch').dispatchEvent('mousedown');
    assert.equal(await page.locator('.smyl-select-menu').count(), 0);
  } finally { await browser.close(); }
});
