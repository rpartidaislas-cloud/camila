const { chromium } = require('../../promodesk-smyl-stage4/node_modules/playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const fixture = path.join(__dirname, 'fixtures', 'smyl-inbox-stage7-preview.html');
const output = path.join(root, 'artifacts', 'inbox-v33');
const sizes = [[1440, 960], [1024, 900], [390, 844]];

function nextPath(name) {
  const ext = path.extname(name), stem = path.basename(name, ext);
  let file = path.join(output, name), suffix = 2;
  while (fs.existsSync(file)) file = path.join(output, `${stem}-${suffix++}${ext}`);
  return file;
}

async function inspect(page, mobile) {
  return page.evaluate(({ mobile }) => {
    const minimum = mobile ? 44 : 42;
    const visible = (el) => {
      if (!(el instanceof Element) || el.hidden || el.closest('[hidden],[inert]') || el.matches('.smyl-inbox-sr,[aria-hidden="true"]')) return false;
      const style = getComputedStyle(el), rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
    };
    const label = (el) => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const selector = (el) => el.id ? `#${CSS.escape(el.id)}` : `${el.localName}.${Array.from(el.classList).slice(0, 3).map((name) => CSS.escape(name)).join('.')}`;
    const microtext = [], undersized = [];
    document.querySelectorAll('#p-inbox *').forEach((el) => {
      if (!visible(el)) return;
      const direct = Array.from(el.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent || '').join(' ').trim();
      const text = direct || (el.matches('input,textarea') ? el.getAttribute('placeholder') || el.value : '');
      const size = Number.parseFloat(getComputedStyle(el).fontSize);
      if (text && size > 0 && size < 12) microtext.push({ selector: selector(el), text: text.slice(0, 80), size });
    });
    document.querySelectorAll('#p-inbox button,#p-inbox a[href],#p-inbox input:not([type="file"]):not([type="hidden"]),#p-inbox select,#p-inbox textarea,#p-inbox summary').forEach((el) => {
      if (!visible(el) || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
      const rect = el.getBoundingClientRect();
      if (rect.width < minimum || rect.height < minimum) undersized.push({ selector: selector(el), label: label(el), width: +rect.width.toFixed(1), height: +rect.height.toFixed(1) });
    });
    const overlap = [], box = (query) => document.querySelector(query)?.getBoundingClientRect();
    const head = box('.smyl-inbox-thread-head'), body = box('.smyl-inbox-thread-body'), composer = box('.smyl-inbox-composer');
    if (head && body && head.bottom > body.top + 1) overlap.push('cabecera sobre historial');
    if (body && composer && body.bottom > composer.top + 1) overlap.push('historial bajo compositor');
    return { overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, microtext, undersized, overlap };
  }, { mobile });
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless:true, executablePath:process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', args:['--allow-file-access-from-files'] });
  const results = [];
  try {
    for (const [width, height] of sizes) {
      const mobile = width <= 760;
      const page = await browser.newPage({ viewport:{ width, height }, hasTouch:mobile, reducedMotion:'reduce' });
      const errors = []; page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${pathToFileURL(fixture).href}?focus=1${mobile ? '&mobile=1' : ''}`, { waitUntil:'load' });
      await page.waitForFunction(() => document.documentElement.dataset.previewReady === 'true');
      await page.addStyleTag({ content:'*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
      const metrics = await inspect(page, mobile), screenshot = nextPath(`inbox-${width}.png`);
      await page.screenshot({ path:screenshot, fullPage:true });
      results.push({ width, errors, screenshot:path.relative(root, screenshot).replace(/\\/g, '/'), ...metrics });
      await page.close();
    }
  } finally { await browser.close(); }
  const report = nextPath('report.json'); fs.writeFileSync(report, JSON.stringify(results, null, 2) + '\n');
  const failed = results.filter((item) => item.errors.length || item.overflow || item.microtext.length || item.undersized.length || item.overlap.length);
  console.log(JSON.stringify({ report:path.relative(root, report).replace(/\\/g, '/'), passed:results.length-failed.length, failed:failed.length, results:results.map((item) => ({ width:item.width, overflow:item.overflow, microtext:item.microtext.length, undersized:item.undersized.length, overlap:item.overlap.length, errors:item.errors.length })) }, null, 2));
  failed.forEach((item) => { console.error(`\n${item.width}px`); item.microtext.slice(0,10).forEach((x) => console.error(` text ${x.size}px ${x.selector} ${x.text}`)); item.undersized.slice(0,10).forEach((x) => console.error(` target ${x.width}x${x.height} ${x.selector} ${x.label}`)); item.overlap.forEach((x) => console.error(` overlap ${x}`)); });
  if (failed.length) process.exitCode = 1;
})().catch((error) => { console.error(error); process.exitCode = 1; });
