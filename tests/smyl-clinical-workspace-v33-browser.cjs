const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');

function loadPlaywright() {
  const workspace = path.resolve(__dirname, '..', '..');
  const requests = [
    { label: 'dependencia local o NODE_PATH', request: 'playwright' },
    process.env.PLAYWRIGHT_MODULE
      ? { label: 'PLAYWRIGHT_MODULE', request: process.env.PLAYWRIGHT_MODULE }
      : null,
    ...[
      'promodesk-smyl-stage4',
      'promodesk-smyl-meta-bridge',
      'promodesk-chat-mobile',
      'promodesk-lana-logo-smyl',
      'promodesk-pagos-ux-lana',
    ].map((project) => ({
      label: `workspace/${project}`,
      request: path.join(workspace, project, 'node_modules', 'playwright'),
    })),
  ].filter(Boolean);

  const attempted = [];
  for (const candidate of requests) {
    try {
      return {
        api: require(candidate.request),
        source: require.resolve(candidate.request),
      };
    } catch (error) {
      attempted.push(`${candidate.label}: ${error.code || error.message}`);
    }
  }

  throw new Error([
    'No se encontró Playwright. No es necesario instalarlo si ya existe en otro proyecto del workspace.',
    'Define PLAYWRIGHT_MODULE con la ruta absoluta a node_modules/playwright o NODE_PATH con el node_modules que lo contiene.',
    `Intentos: ${attempted.join(' | ')}`,
  ].join('\n'));
}

const playwright = loadPlaywright();
const { chromium } = playwright.api;

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'artifacts', 'clinical-workspace-v33');

async function initShell(page) {
  await page.addInitScript(() => {
    if (window.supabase?.createClient) return;
    const noSession = async () => ({ data: { session: null }, error: null });
    const query = () => {
      const response = { data: [], error: null, count: 0 };
      const builder = {
        then(resolve, reject) { return Promise.resolve(response).then(resolve, reject); },
      };
      for (const method of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'neq', 'in', 'gte', 'lte', 'lt', 'gt', 'order', 'limit', 'range', 'single', 'maybeSingle']) {
        builder[method] = () => builder;
      }
      return builder;
    };
    const realtime = {
      on() { return realtime; },
      subscribe() { return realtime; },
      unsubscribe() {},
    };
    const client = {
      auth: {
        getSession: noSession,
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        signOut: async () => ({ error: null }),
      },
      from: query,
      rpc: async () => ({ data: null, error: null }),
      channel: () => realtime,
      removeChannel: async () => ({ error: null }),
      functions: { invoke: async () => ({ data: null, error: null }) },
    };
    window.supabase = { createClient: () => client };
  });
}

async function prepareShell(page) {
  await page.addStyleTag({ content: [
    '#auth-gate-overlay,.modal-bg,.fab-overlay,.panel-admin-mobile,[aria-modal="true"]{display:none!important}',
    'body{overflow:auto!important}',
    '.layout{display:flex!important}',
  ].join('') });

  await page.evaluate(() => {
    const state = Object.freeze({
      tenant: {
        id: '00000000-0000-4000-8000-000000000033',
        nombre: 'Clínica SMYL QA',
        plan: 'profesional',
      },
      user: {
        nombre: 'Dra. Camila Torres',
        email: 'camila.qa@example.test',
      },
      dashboard: {
        appointments: 6,
        patients: 128,
        unread: 3,
        pending: 2,
      },
    });
    window.__SMYL_QA_SHELL_STATE__ = state;
    window.tenantId = state.tenant.id;
    window.tenantData = { ...state.tenant, config: {} };
    window.authUser = { id: state.tenant.id, email: state.user.email };

    document.querySelector('#auth-gate-overlay')?.remove();
    document.querySelector('.layout')?.classList.add('is-visible');
    document.body.style.overflow = '';

    for (const screen of document.querySelectorAll('.pantalla')) {
      screen.classList.toggle('activa', screen.id === 'p-dashboard');
    }

    const title = document.querySelector('#topbar-title');
    if (title) title.textContent = 'Inicio';
    const subtitle = document.querySelector('#topbar-sub');
    if (subtitle) subtitle.textContent = 'Resumen operativo de hoy';
    const name = document.querySelector('#sb-nombre');
    if (name) name.textContent = state.user.nombre;
    const avatar = document.querySelector('#sb-avatar');
    if (avatar) avatar.textContent = 'CT';
    const clinic = document.querySelector('#sb-clinica');
    if (clinic) clinic.textContent = state.tenant.nombre;

    const overlays = document.querySelectorAll([
      '.modal-bg',
      '.fab-overlay',
      '.panel-admin-mobile',
      '.smyl-command-overlay',
      '.smyl-command-palette',
      '.pro-task-overlay',
      '.pro-task-dialog',
      '[aria-modal="true"]',
    ].join(','));
    for (const overlay of overlays) {
      overlay.classList.remove('visible', 'open', 'is-open', 'closing');
      overlay.hidden = true;
      overlay.setAttribute('aria-hidden', 'true');
    }
    for (const control of document.querySelectorAll('[aria-expanded="true"]')) {
      control.setAttribute('aria-expanded', 'false');
    }

    const greeting = document.querySelector('[data-home-greeting]');
    if (greeting) greeting.textContent = 'Buenos días, Camila';
    const summary = document.querySelector('[data-home-summary]');
    if (summary) summary.textContent = 'Tu clínica está al día. Tienes dos solicitudes por revisar.';
    const updated = document.querySelector('[data-home-updated]');
    if (updated) updated.textContent = 'Datos de prueba · 09:30';

    const metrics = document.querySelector('[data-home-metrics]');
    if (metrics) {
      metrics.dataset.count = '4';
      metrics.innerHTML = [
        `<button type="button" class="daily-home-metric" data-route="agenda"><span>Citas hoy</span><strong>${state.dashboard.appointments}</strong><small>4 confirmadas</small></button>`,
        `<button type="button" class="daily-home-metric" data-route="pacientes"><span>Pacientes</span><strong>${state.dashboard.patients}</strong><small>3 nuevos este mes</small></button>`,
        `<button type="button" class="daily-home-metric" data-route="inbox" data-tone="attention"><span>Mensajes</span><strong>${state.dashboard.unread}</strong><small>Sin leer</small></button>`,
        `<button type="button" class="daily-home-metric" data-route="agenda" data-tone="active"><span>Solicitudes</span><strong>${state.dashboard.pending}</strong><small>Por confirmar</small></button>`,
      ].join('');
    }

    const next = document.querySelector('[data-home-next]');
    if (next) next.innerHTML = [
      '<div class="daily-home-next-list daily-home-timeline">',
      '<button type="button"><time>10:00 am</time><span><strong>Ana Torres</strong><small>Valoración estética</small></span><i>Confirmada</i></button>',
      '<button type="button"><time>11:30 am</time><span><strong>Luis Mendoza</strong><small>Revisión clínica</small></span><i>Por llegar</i></button>',
      '</div>',
    ].join('');

    const priorities = document.querySelector('[data-home-priorities]');
    if (priorities) priorities.innerHTML = [
      '<div class="daily-home-priority-list">',
      '<article data-urgent="1"><i></i><div><span>POR CONFIRMAR</span><strong>Sofía Ramírez</strong><small>Solicitó una cita para mañana</small></div><button type="button">Revisar</button></article>',
      '<article><i></i><div><span>SEGUIMIENTO</span><strong>Cotización pendiente</strong><small>Enviar recordatorio al paciente</small></div><button type="button">Abrir</button></article>',
      '</div>',
    ].join('');

    const chats = document.querySelector('[data-home-chats]');
    if (chats) chats.innerHTML = [
      '<button type="button" class="daily-home-chat" data-priority="human"><span class="smyl-inbox-avatar">AT</span><span class="daily-home-chat-copy"><span class="daily-home-chat-top"><strong>Ana Torres</strong><time>09:18</time></span><span class="daily-home-chat-preview">¿Tienen espacio para una valoración esta semana?</span><span class="daily-home-chat-meta"><span class="daily-home-chat-channel">Instagram</span><span class="daily-home-chat-flag">Necesita asesor</span></span></span></button>',
      '<button type="button" class="daily-home-chat" data-priority="unread"><span class="smyl-inbox-avatar">LM</span><span class="daily-home-chat-copy"><span class="daily-home-chat-top"><strong>Luis Mendoza</strong><time>08:54</time></span><span class="daily-home-chat-preview">Gracias, confirmo mi cita de mañana.</span><span class="daily-home-chat-meta"><span class="daily-home-chat-channel">WhatsApp</span><span class="daily-home-chat-flag is-unread">1 sin leer</span></span></span></button>',
    ].join('');
  });
}

const fixtures = [
  {
    name: 'shell',
    file: path.join(root, 'app.html'),
    settleMs: 250,
    init: initShell,
    prepare: prepareShell,
  },
  {
    name: 'ui-v33',
    file: path.join(__dirname, 'fixtures', 'smyl-ui-v33-clinical-workspace.html'),
  },
  {
    name: 'agenda',
    file: path.join(__dirname, 'fixtures', 'smyl-agenda-visual-v3-preview.html'),
  },
  {
    name: 'pacientes',
    file: path.join(__dirname, 'fixtures', 'smyl-patients-v32-preview.html'),
  },
];

const viewports = [
  { name: '1440x960', width: 1440, height: 960 },
  { name: '1024x900', width: 1024, height: 900 },
  { name: '390x844', width: 390, height: 844, mobile: true },
];

function uniqueArtifactPath(baseName) {
  const extension = path.extname(baseName);
  const stem = path.basename(baseName, extension);
  let candidate = path.join(output, baseName);
  let suffix = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(output, `${stem}-${suffix}${extension}`);
    suffix += 1;
  }
  return candidate;
}

async function inspectPage(page, mobile) {
  return page.evaluate(({ checkTouchTargets }) => {
    const visible = (element) => {
      if (!(element instanceof Element) || element.hidden || element.closest('[hidden],[inert]')) return false;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      const rect = element.getBoundingClientRect();
      const intersectsViewport = rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
      return rect.width > 0 && rect.height > 0 && intersectsViewport && element.getClientRects().length > 0;
    };

    const selectorFor = (element) => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const parts = [];
      let node = element;
      while (node && node !== document.body && parts.length < 4) {
        let part = node.localName;
        if (!part) break;
        const classes = Array.from(node.classList).slice(0, 2);
        if (classes.length) part += `.${classes.map((name) => CSS.escape(name)).join('.')}`;
        const parent = node.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((item) => item.localName === node.localName);
          if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
        }
        parts.unshift(part);
        node = parent;
      }
      return parts.join(' > ');
    };

    const directText = (element) => Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent || '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    const controlText = (element) => {
      if (element instanceof HTMLInputElement) return element.value || element.placeholder || '';
      if (element instanceof HTMLTextAreaElement) return element.value || element.placeholder || '';
      if (element instanceof HTMLSelectElement) return element.selectedOptions[0]?.textContent || '';
      return '';
    };

    const microtext = [];
    for (const element of document.querySelectorAll('body *')) {
      if (!visible(element)) continue;
      const style = getComputedStyle(element);
      const fontSize = Number.parseFloat(style.fontSize);
      const text = directText(element) || controlText(element);
      if (text && fontSize > 0 && fontSize < 12) {
        microtext.push({
          selector: selectorFor(element),
          text: text.slice(0, 80),
          fontSize,
        });
      }

      for (const pseudo of ['::before', '::after']) {
        const pseudoStyle = getComputedStyle(element, pseudo);
        const content = pseudoStyle.content;
        const pseudoSize = Number.parseFloat(pseudoStyle.fontSize);
        if (
          content &&
          content !== 'none' &&
          content !== 'normal' &&
          content !== '""' &&
          content !== "''" &&
          pseudoStyle.display !== 'none' &&
          pseudoStyle.visibility !== 'hidden' &&
          pseudoSize > 0 &&
          pseudoSize < 12
        ) {
          microtext.push({
            selector: `${selectorFor(element)}${pseudo}`,
            text: content.slice(0, 80),
            fontSize: pseudoSize,
          });
        }
      }
    }

    const touchTargets = [];
    if (checkTouchTargets) {
      const selector = [
        'a[href]',
        'button',
        'input:not([type="hidden"])',
        'select',
        'textarea',
        'summary',
        '[role="button"]',
        '[role="link"]',
        '[role="tab"]',
        '[tabindex]:not([tabindex="-1"])',
      ].join(',');

      for (const element of document.querySelectorAll(selector)) {
        if (!visible(element) || element.matches(':disabled,[aria-disabled="true"],[data-qa-touch-exempt]')) continue;

        const style = getComputedStyle(element);
        if (style.pointerEvents === 'none') continue;

        // Los enlaces dentro de texto corrido no se comportan como controles táctiles aislados.
        if (element instanceof HTMLAnchorElement && style.display === 'inline' && element.closest('p,li,small')) continue;

        // Un checkbox/radio pequeño es válido cuando su etiqueta completa ofrece el área de 44 px.
        if (element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)) {
          const label = element.closest('label') || (element.id && document.querySelector(`label[for="${CSS.escape(element.id)}"]`));
          const labelRect = label?.getBoundingClientRect();
          if (labelRect && labelRect.width >= 44 && labelRect.height >= 44) continue;
        }

        const rect = element.getBoundingClientRect();
        if (rect.width < 44 || rect.height < 44) {
          touchTargets.push({
            selector: selectorFor(element),
            label: (element.getAttribute('aria-label') || element.textContent || element.getAttribute('placeholder') || '')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 80),
            width: Number(rect.width.toFixed(1)),
            height: Number(rect.height.toFixed(1)),
          });
        }
      }
    }

    const documentWidth = document.documentElement.scrollWidth;
    const viewportWidth = document.documentElement.clientWidth;
    return {
      documentWidth,
      viewportWidth,
      horizontalOverflow: documentWidth > viewportWidth + 1,
      microtext,
      touchTargets,
    };
  }, { checkTouchTargets: mobile });
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_PATH ||
      process.env.SMILA_CHROME_PATH ||
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--allow-file-access-from-files'],
  });

  const report = [];
  try {
    for (const fixture of fixtures) {
      if (!fs.existsSync(fixture.file)) throw new Error(`Fixture inexistente: ${fixture.file}`);

      for (const viewport of viewports) {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: 1,
          reducedMotion: 'reduce',
          locale: 'es-MX',
          timezoneId: 'America/Mexico_City',
          hasTouch: Boolean(viewport.mobile),
        });
        const page = await context.newPage();
        const pageErrors = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));

        if (fixture.init) await fixture.init(page);
        await page.goto(pathToFileURL(fixture.file).href, { waitUntil: 'load' });
        await page.evaluate(async () => {
          if (document.fonts?.ready) await document.fonts.ready;
        });
        await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
        if (fixture.settleMs) await page.waitForTimeout(fixture.settleMs);
        if (fixture.prepare) await fixture.prepare(page);

        const metrics = await inspectPage(page, Boolean(viewport.mobile));
        const screenshot = uniqueArtifactPath(`${fixture.name}-${viewport.name}.png`);
        await page.screenshot({ path: screenshot, fullPage: true });

        report.push({
          fixture: fixture.name,
          viewport: viewport.name,
          screenshot: path.relative(root, screenshot).replace(/\\/g, '/'),
          pageErrors,
          ...metrics,
        });
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  const reportPath = uniqueArtifactPath('report.json');
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const failures = report.filter((item) =>
    item.horizontalOverflow ||
    item.microtext.length > 0 ||
    item.touchTargets.length > 0,
  );
  const warningPages = report.filter((item) => item.pageErrors.length > 0);

  console.log(JSON.stringify({
    playwrightSource: playwright.source,
    report: path.relative(root, reportPath).replace(/\\/g, '/'),
    captures: report.length,
    passed: report.length - failures.length,
    failed: failures.length,
    warningPages: warningPages.length,
    results: report.map((item) => ({
      fixture: item.fixture,
      viewport: item.viewport,
      overflow: item.horizontalOverflow,
      microtext: item.microtext.length,
      touchTargets: item.touchTargets.length,
      pageErrors: item.pageErrors.length,
    })),
  }, null, 2));

  if (failures.length) {
    console.error('\nHallazgos de QA:');
    for (const item of failures) {
      console.error(`- ${item.fixture} @ ${item.viewport}: overflow=${item.horizontalOverflow}, microtexto=${item.microtext.length}, objetivos<44=${item.touchTargets.length}, errores=${item.pageErrors.length}`);
      for (const finding of item.microtext.slice(0, 5)) {
        console.error(`  microtexto ${finding.fontSize}px · ${finding.selector} · ${finding.text}`);
      }
      for (const finding of item.touchTargets.slice(0, 5)) {
        console.error(`  objetivo ${finding.width}x${finding.height}px · ${finding.selector} · ${finding.label}`);
      }
      for (const error of item.pageErrors.slice(0, 3)) console.error(`  pageerror · ${error}`);
    }
    process.exitCode = 1;
  }

  if (warningPages.length) {
    console.warn('\nAdvertencias JavaScript de los fixtures (no bloqueantes para este gate visual):');
    for (const item of warningPages) {
      for (const error of item.pageErrors.slice(0, 3)) {
        console.warn(`- ${item.fixture} @ ${item.viewport} · ${error}`);
      }
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
