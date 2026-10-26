const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');

(async () => {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'artifacts');
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
    for (const [width, height] of [
      [1440, 960],
      [1024, 900],
      [390, 844],
    ]) {
      const page = await browser.newPage({ viewport: { width, height } });
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
        const button = document.querySelector('.layout .btn');
        const topbar = document.querySelector('.topbar');
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
      if (width > 768 && measurements.navFont !== '14px') {
        throw new Error(`Navegación inesperada a ${width}px: ${measurements.navFont}`);
      }
      if (width > 768 && measurements.navHeight < 44) {
        throw new Error(`Objetivo de navegación menor de 44px a ${width}px`);
      }
      if (width > 768 && measurements.buttonHeight < 42) {
        throw new Error(`Botón menor de 42px a ${width}px`);
      }
      if (measurements.topbarHeight < 64) {
        throw new Error(`Barra superior menor de 64px a ${width}px`);
      }

      await page.screenshot({
        path: path.join(output, `smyl-shell-${width}.png`),
        fullPage: true,
      });
      await page.close();
    }
  } finally {
    await browser.close();
  }

  console.log('QA visual del shell completado: 1440, 1024 y 390 px.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
