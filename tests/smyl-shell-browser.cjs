const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve(__dirname, '..');
  const output = process.env.SMYL_QA_OUTPUT || path.join(root, 'artifacts');
  const fixture = pathToFileURL(path.join(root, 'app.html')).href;

  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_PATH ||
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--allow-file-access-from-files'],
  });

  try {
    for (const [width, height, hasTouch = false] of [
      [1440, 960],
      [1024, 700],
      [820, 1024, true],
      [768, 1024, true],
      [390, 844, true],
      [320, 640, true],
    ]) {
      const page = await browser.newPage({ viewport: { width, height }, hasTouch, reducedMotion: 'reduce' });
      await page.route(/^https?:/, route => route.abort());
      await page.goto(fixture, { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => {
        document.querySelector('#auth-gate-overlay')?.remove();
        document.querySelector('.layout')?.classList.add('is-visible');
        document.querySelectorAll('.pantalla').forEach((node) =>
          node.classList.toggle('activa', node.id === 'p-dashboard'),
        );
      });
      await page.waitForTimeout(250);

      const measurements = await page.evaluate(() => {
        const nav = document.querySelector('.sidebar .nav-item');
        const topbar = document.querySelector('.topbar');
        const button = [...topbar.querySelectorAll('button')].find(el => el.getClientRects().length);
        return {
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          navFont: nav ? getComputedStyle(nav).fontSize : null,
          navHeight: nav ? nav.getBoundingClientRect().height : null,
          buttonHeight: button ? button.getBoundingClientRect().height : null,
          topbarHeight: topbar ? topbar.getBoundingClientRect().height : null,
        };
      });

      if (measurements.overflow) {
        throw new Error(`Desbordamiento horizontal del shell a ${width}px`);
      }
      if (width > 768 && measurements.navFont !== '13px') {
        throw new Error(`Navegación inesperada a ${width}px: ${measurements.navFont}`);
      }
      if (width > 768 && measurements.navHeight !== (hasTouch ? 44 : 38)) {
        throw new Error(`Altura inesperada en el menú a ${width}px: ${measurements.navHeight}`);
      }
      if (width > 768 && measurements.buttonHeight < 42) {
        throw new Error(`Botón menor de 42px a ${width}px`);
      }
      if (measurements.topbarHeight < 64) {
        throw new Error(`Barra superior menor de 64px a ${width}px`);
      }

      await page.screenshot({
        path: path.join(output, `smyl-shell-${width}.png`),
      });
      const sidebar = page.locator('.sidebar');
      const toggle = sidebar.locator('.pro-sidebar-toggle');
      if (width > 768) {
        assert.equal((await sidebar.boundingBox()).width, 216);
        const originalWidth = (await page.locator('.main').boundingBox()).width;
        await toggle.click();
        assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
        assert.equal((await sidebar.boundingBox()).width, 64);
        assert.equal((await page.locator('.main').boundingBox()).width - originalWidth, 152);
        await sidebar.locator('summary[aria-label="Negocio"]').click();
        await sidebar.locator('.pro-nav-flyout [data-route="historial"]').click({ trial: true, timeout: 3000 });
        await page.screenshot({ path: path.join(output, `smyl-compacto-${width}.png`) });
        await page.reload();
        await page.locator('.layout').evaluate(el => el.classList.add('is-visible'));
        assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
        assert.equal((await sidebar.boundingBox()).width, 64);
      } else {
        assert.equal(await sidebar.isVisible(), false);
        const more = page.getByRole('button', { name: 'Más', exact: true });
        assert.ok((await more.boundingBox()).height >= 44);
        await more.tap();
        const panel = page.getByRole('dialog', { name: 'Más opciones' });
        for (const control of await panel.locator('button:visible, summary:visible').all()) {
          const bounds = await control.boundingBox();
          assert.ok(bounds.width >= 44 && bounds.height >= 44, await control.textContent());
        }
        await page.screenshot({ path: path.join(output, `smyl-menu-${width}.png`) });
        await panel.getByRole('button', { name: 'Cerrar menú' }).tap();
        assert.equal(await more.getAttribute('aria-expanded'), 'false');
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }

  console.log('Menú verificado en escritorio, tablet y celular.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
